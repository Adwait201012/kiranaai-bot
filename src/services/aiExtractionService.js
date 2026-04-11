const Groq = require("groq-sdk");
const env = require("../config/env");

const client = new Groq({ apiKey: env.groqApiKey });

const SYSTEM_PROMPT =
  "Classify kirana owner messages into exactly one intent: LOG_UDHAAR, CHECK_UDHAAR, LOG_WAPAS, TODAY_HISAAB, SABKA_UDHAAR, SAVE_NUMBER, SEND_REMINDER, INVENTORY_ADD, CHECK_STOCK, ALL_STOCK, GREETING, UNKNOWN. Return ONLY JSON with keys: intent, customerName, amount, phoneNumber, itemName, quantity, unit, items. For inventory, extract full quantity number (never truncate digits), any item name, and unit. For multi-item lines return items array: [{itemName, quantity, unit}]. Examples:\n'Sharma ji kitna udhaar' -> CHECK_UDHAAR, customerName: 'Sharma ji'\n'Ramesh kitna udhaar' -> CHECK_UDHAAR, customerName: 'Ramesh'\n'chawal kitna hai' -> CHECK_STOCK, itemName: 'chawal'\n'aata kitna hai' -> CHECK_STOCK, itemName: 'aata'\n'maggi stock kitna hai' -> CHECK_STOCK, itemName: 'maggi'\n'tel kitna bacha' -> CHECK_STOCK, itemName: 'tel'\nRule: If the subject is a PERSON NAME -> udhaar intent. If subject is a GROCERY/PRODUCT item -> stock intent. Person names are proper nouns. Grocery items are food/product names.";

const ITEM_NORMALIZE_PROMPT =
  "Normalize kirana item to one standard lowercase Indian name. Examples: chawal/rice/chaawal -> chawal, aata/atta/wheat flour -> aata, maggi/Maggi -> maggi. Return ONLY JSON: {\"normalizedItemName\":\"...\"}.";

const ALLOWED_INTENTS = new Set([
  "LOG_UDHAAR",
  "CHECK_UDHAAR",
  "LOG_WAPAS",
  "TODAY_HISAAB",
  "SABKA_UDHAAR",
  "SAVE_NUMBER",
  "SEND_REMINDER",
  "INVENTORY_ADD",
  "CHECK_STOCK",
  "ALL_STOCK",
  "GREETING",
  "UNKNOWN",
]);

const HINGLISH_HINT_WORDS = new Set([
  "udhaar",
  "udhar",
  "hisaab",
  "hisab",
  "kitna",
  "wapas",
  "aaya",
  "aayi",
  "dikhao",
  "sabka",
  "ka",
  "ko",
  "hai",
]);

const UNIT_WORDS =
  "(kg|g|gm|gram|grams|ltr|l|litre|liter|liters|ml|packet|packets|pack|packs|pcs|pc|piece|pieces|dozen|box|boxes)";

function normalizeJsonText(rawText) {
  const cleaned = String(rawText || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "");
  return cleaned
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"');
}

function getJsonObjectText(rawText) {
  const text = String(rawText || "");
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return text;
  }
  return text.slice(firstBrace, lastBrace + 1);
}

function detectLanguageFromText(messageText) {
  const text = String(messageText || "").trim();
  if (!text) {
    return "hinglish";
  }
  if (/[\u0900-\u097F]/.test(text)) {
    return "hindi";
  }
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (!words.length) {
    return "english";
  }
  return words.some((w) => HINGLISH_HINT_WORDS.has(w)) ? "hinglish" : "english";
}

function cleanupItemName(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/\b(aaj|today|got|received|added|add|aaya|aayi|aaye|inventory|stock|mein|me|ko|hai|kitna|kitni|dikhao|show|all|sabka|sabhi|ka|ki|aur|and)\b/g, " ")
    .replace(/\d{1,9}(?:\.\d+)?\s*(kg|g|gm|gram|grams|ltr|l|litre|liter|liters|ml|packet|packets|pack|packs|pcs|pc|piece|pieces|dozen|box|boxes)?/gi, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInventoryPart(partText) {
  const part = String(partText || "").trim();
  if (!part) {
    return null;
  }
  const qFirst = new RegExp(`(\\d{1,9}(?:\\.\\d+)?)\\s*(${UNIT_WORDS})?\\s+(.+)`, "i").exec(part);
  if (qFirst) {
    const quantity = Number(qFirst[1]);
    const unit = String(qFirst[2] || "pieces").toLowerCase();
    const itemName = cleanupItemName(qFirst[3]);
    if (itemName && Number.isFinite(quantity) && quantity > 0) {
      return { itemName, quantity, unit: unit || "pieces" };
    }
  }

  const qLast = new RegExp(`(.+?)\\s+(\\d{1,9}(?:\\.\\d+)?)\\s*(${UNIT_WORDS})?$`, "i").exec(part);
  if (qLast) {
    const itemName = cleanupItemName(qLast[1]);
    const quantity = Number(qLast[2]);
    const unit = String(qLast[3] || "pieces").toLowerCase();
    if (itemName && Number.isFinite(quantity) && quantity > 0) {
      return { itemName, quantity, unit: unit || "pieces" };
    }
  }

  const any = /(\d{1,9}(?:\.\d+)?)/.exec(part);
  const fallbackName = cleanupItemName(part);
  if (fallbackName) {
    return {
      itemName: fallbackName,
      quantity: any ? Number(any[1]) : 1,
      unit: "pieces",
    };
  }
  return null;
}

function parseInventoryItems(rawText) {
  const raw = String(rawText || "").replace(/\b(aaya|aayi|aaye|got|received|added)\b/gi, " ");
  const parts = raw.split(/\s*(?:aur|and|,|&)\s*/i).filter(Boolean);
  return parts.map(parseInventoryPart).filter(Boolean);
}

function inferInventoryFromText(messageText) {
  const raw = String(messageText || "").trim();
  const lower = raw.toLowerCase();

  if (/(^|\s)(sabka stock|sabhi stock|all stock|show all stock|inventory dikhao)(\s|$)/i.test(lower)) {
    return { intent: "ALL_STOCK" };
  }

  if (/\bstock\b/i.test(lower) && /(kitna|kitni|how much|quantity|hai|\?)/i.test(lower)) {
    return { intent: "CHECK_STOCK", itemName: cleanupItemName(raw) };
  }

  if (!/(aaya|aayi|aaye|got|received|added)/i.test(lower)) {
    return {};
  }

  const items = parseInventoryItems(raw);
  if (!items.length) {
    return {};
  }
  return {
    intent: "INVENTORY_ADD",
    itemName: items[0].itemName,
    quantity: items[0].quantity,
    unit: items[0].unit || "pieces",
    items,
  };
}

function fallbackIntent() {
  return {
    intent: "UNKNOWN",
    customerName: "",
    amount: null,
    phoneNumber: "",
    itemName: "",
    quantity: null,
    unit: "pieces",
    items: [],
    language: "hinglish",
  };
}

async function detectIntent(messageText) {
  const strictLanguage = detectLanguageFromText(messageText);
  let parsed = {};

  try {
    const completion = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: String(messageText || "") },
      ],
    });
    const output = completion.choices?.[0]?.message?.content || "";
    parsed = JSON.parse(normalizeJsonText(getJsonObjectText(output)));
  } catch {
    parsed = {};
  }

  const modelIntent = String(parsed.intent || "UNKNOWN").toUpperCase().trim();
  const intent = ALLOWED_INTENTS.has(modelIntent) ? modelIntent : "UNKNOWN";
  const inventoryFallback = inferInventoryFromText(messageText);

  return {
    intent: inventoryFallback.intent || intent,
    customerName: String(parsed.customerName || "").trim(),
    amount: Number.isFinite(Number(parsed.amount)) ? Number(parsed.amount) : null,
    phoneNumber: String(parsed.phoneNumber || "").trim(),
    itemName: String(inventoryFallback.itemName || parsed.itemName || "").trim(),
    quantity: Number.isFinite(Number(inventoryFallback.quantity))
      ? Number(inventoryFallback.quantity)
      : Number.isFinite(Number(parsed.quantity))
        ? Number(parsed.quantity)
        : null,
    unit: String(inventoryFallback.unit || parsed.unit || "pieces").trim().toLowerCase() || "pieces",
    items: Array.isArray(inventoryFallback.items)
      ? inventoryFallback.items
      : Array.isArray(parsed.items)
        ? parsed.items
            .map((it) => ({
              itemName: String(it?.itemName || "").trim(),
              quantity: Number(it?.quantity),
              unit: String(it?.unit || "pieces").trim().toLowerCase() || "pieces",
            }))
            .filter((it) => it.itemName)
        : [],
    language: strictLanguage,
  };
}

async function normalizeInventoryItemName(itemName) {
  const raw = String(itemName || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const completion = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ITEM_NORMALIZE_PROMPT },
        { role: "user", content: raw },
      ],
    });
    const output = completion.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(normalizeJsonText(getJsonObjectText(output)));
    const value = String(parsed?.normalizedItemName || "").trim().toLowerCase();
    return value || raw.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

module.exports = {
  detectIntent,
  detectLanguageFromText,
  normalizeInventoryItemName,
};
