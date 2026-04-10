const Groq = require("groq-sdk");
const env = require("../config/env");

const SYSTEM_PROMPT =
  "Classify the user message into one intent from: GREETING, LOG_UDHAAR, CHECK_UDHAAR, LOG_WAPAS, TODAY_HISAAB, SABKA_UDHAAR, SAVE_NUMBER, SEND_REMINDER, INVENTORY_ADD, CHECK_STOCK, ALL_STOCK, UNKNOWN. Return ONLY JSON. For inventory extraction, support ANY grocery/food item name in Hindi/English/Hinglish dynamically (do not hardcode item names). Return keys: intent, customerName, amount, phoneNumber, itemName, quantity, unit, items. For multi-item inventory messages, `items` should be an array like [{itemName, quantity, unit}, ...].";

const client = new Groq({ apiKey: env.groqApiKey });

function normalizeJsonText(rawText) {
  const cleaned = rawText.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
  return cleaned
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"');
}

function getJsonObjectText(rawText) {
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return rawText;
  }
  return rawText.slice(firstBrace, lastBrace + 1);
}

function fallbackIntent() {
  return {
    intent: "UNKNOWN",
    language: "hinglish",
  };
}

const ALLOWED_INTENTS = new Set([
  "GREETING",
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
  "UNKNOWN",
]);
const ALLOWED_LANGUAGES = new Set(["hindi", "hinglish", "english"]);
const HINGLISH_HINT_WORDS = new Set([
  "udhaar",
  "udhar",
  "hisaab",
  "hisab",
  "wapas",
  "kitna",
  "batao",
  "karo",
  "diya",
  "ne",
  "ka",
  "ko",
  "namaste",
  "namaskar",
  "pranam",
  "aji",
  "ajj",
  "aaj",
]);

function getLatinWordTokens(text) {
  const matches = String(text || "").toLowerCase().match(/[a-z]+/g);
  return matches || [];
}

function detectLanguageFromText(messageText) {
  const text = String(messageText || "").trim();
  if (!text) {
    return "hinglish";
  }

  // Devanagari range indicates Hindi script.
  if (/[\u0900-\u097F]/.test(text)) {
    return "hindi";
  }

  const tokens = getLatinWordTokens(text);
  if (tokens.length === 0) {
    return "english";
  }

  const hasHinglishMarker = tokens.some((token) => HINGLISH_HINT_WORDS.has(token));
  if (hasHinglishMarker) {
    return "hinglish";
  }

  return "english";
}

function parseNumberAndUnit(text) {
  const compact = text.match(
    /(\d+(?:\.\d+)?)\s*(kg|g|gm|gram|grams|ltr|l|ml|packet|packets|pcs|pc|piece|pieces|dozen|box|boxes)?\s*([^\s]+)?/i,
  );
  if (!compact) {
    return { quantity: null, unit: "pieces" };
  }

  const quantity = Number(compact[1]);
  const candidateUnit = String(compact[2] || compact[3] || "").toLowerCase().trim();
  const unit = /^(aaya|aayi|aaye|got|received|added|add)$/.test(candidateUnit)
    ? "pieces"
    : candidateUnit || "pieces";
  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit,
  };
}

function removeNoise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\b(aaj|today|got|received|added|add|aaya|aayi|aaye|inventory|stock|mein|me|ko|hai|kitna|kitni|dikhao|show|all|sabka|sabhi|ka|ki|aur|and)\b/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupItemName(raw) {
  // Keep user-provided item wording (e.g., "rice" vs "chawal") as-is semantically;
  // only remove action/noise tokens. No language-based item translation is applied.
  const text = String(raw || "")
    .toLowerCase()
    .replace(/\b(aaj|today|got|received|added|add|aaya|aayi|aaye|inventory|stock|mein|me|ko|hai|kitna|kitni|dikhao|show|all|sabka|sabhi|ka|ki|aur|and)\b/g, " ")
    .replace(/\d+(?:\.\d+)?\s*(kg|g|gm|gram|grams|ltr|l|ml|packet|packets|pcs|pc|piece|pieces|dozen|box|boxes)?/gi, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function parseInventoryPart(partText) {
  const part = String(partText || "").trim();
  if (!part) {
    return null;
  }

  const qFirst = part.match(
    /(\d+(?:\.\d+)?)\s*(kg|g|gm|gram|grams|ltr|l|ml|packet|packets|pcs|pc|piece|pieces|dozen|box|boxes)?\s+(.+)/i,
  );
  if (qFirst) {
    const quantity = Number(qFirst[1]);
    const unit = String(qFirst[2] || "").toLowerCase();
    const itemName = cleanupItemName(qFirst[3]);
    if (itemName && Number.isFinite(quantity) && quantity > 0) {
      return { itemName, quantity, unit };
    }
  }

  const qLast = part.match(
    /(.+?)\s+(\d+(?:\.\d+)?)\s*(kg|g|gm|gram|grams|ltr|l|ml|packet|packets|pcs|pc|piece|pieces|dozen|box|boxes)?$/i,
  );
  if (qLast) {
    const itemName = cleanupItemName(qLast[1]);
    const quantity = Number(qLast[2]);
    const unit = String(qLast[3] || "pieces").toLowerCase();
    if (itemName && Number.isFinite(quantity) && quantity > 0) {
      return { itemName, quantity, unit };
    }
  }

  const anyNumber = part.match(/(.+?)\s+(\d+(?:\.\d+)?)(?:\s+([^\s]+))?/i);
  if (anyNumber) {
    const itemName = cleanupItemName(anyNumber[1]);
    const quantity = Number(anyNumber[2]);
    const candidateUnit = String(anyNumber[3] || "").toLowerCase().trim();
    const unit = /^(aaya|aayi|aaye|got|received|added|add)$/.test(candidateUnit)
      ? "pieces"
      : candidateUnit || "pieces";
    if (itemName && Number.isFinite(quantity) && quantity > 0) {
      return { itemName, quantity, unit };
    }
  }

  const fallbackName = cleanupItemName(part);
  if (fallbackName) {
    return { itemName: fallbackName, quantity: 1, unit: "pieces" };
  }

  return null;
}

function parseInventoryItems(rawText) {
  const normalized = String(rawText || "")
    .replace(/\b(aaya|aayi|aaye|got|received|added)\b/gi, " ")
    .trim();
  const parts = normalized.split(/\s+(?:aur|and|,)\s+/i);
  const items = parts
    .map((part) => parseInventoryPart(part))
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.itemName}|${item.unit}|${item.quantity}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function inferInventoryFromText(messageText) {
  const raw = String(messageText || "").trim();
  const lower = raw.toLowerCase();

  const isAllStock =
    /(^|\s)(sabka stock|sabhi stock|all stock|show all stock|stock dikhao|inventory dikhao)(\s|$)/i.test(
      lower,
    );
  if (isAllStock) {
    return { intent: "ALL_STOCK" };
  }

  const isStockQuery =
    /stock/.test(lower) && /(kitna|kitni|how much|quantity|hai|\?)/.test(lower);
  if (isStockQuery) {
    return {
      intent: "CHECK_STOCK",
      itemName: cleanupItemName(raw),
    };
  }

  const isInventoryAdd =
    /(aaya|aayi|aaye|got|received|added)/.test(lower);
  if (!isInventoryAdd) {
    return {};
  }

  const parsedItems = parseInventoryItems(raw);
  if (parsedItems.length) {
    return {
      intent: "INVENTORY_ADD",
      itemName: parsedItems[0].itemName,
      quantity: parsedItems[0].quantity,
      unit: parsedItems[0].unit,
      items: parsedItems,
    };
  }

  const { quantity, unit } = parseNumberAndUnit(lower);
  const itemName = cleanupItemName(removeNoise(raw));
  return {
    intent: "INVENTORY_ADD",
    itemName,
    quantity,
    unit,
    items: itemName ? [{ itemName, quantity: quantity || 1, unit: unit || "pieces" }] : [],
  };
}

async function detectIntent(messageText) {
  const completion = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: messageText,
      },
    ],
  });

  const output = completion.choices?.[0]?.message?.content || "";

  const normalized = normalizeJsonText(getJsonObjectText(output));
  let parsed;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    return fallbackIntent();
  }

  if (!parsed || typeof parsed !== "object") {
    return fallbackIntent();
  }

  const intent = String(parsed.intent || "UNKNOWN").toUpperCase().trim();
  if (!ALLOWED_INTENTS.has(intent)) {
    return fallbackIntent();
  }

  const customerName = String(parsed.customerName || "").trim();
  const phoneNumber = String(parsed.phoneNumber || "").trim();
  const amount = Number(parsed.amount);
  const itemName = String(parsed.itemName || "").trim();
  const quantity = Number(parsed.quantity);
  const unit = String(parsed.unit || "").trim();
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map((entry) => ({
          itemName: String(entry?.itemName || "").trim(),
          quantity: Number(entry?.quantity),
          unit: String(entry?.unit || "").trim(),
        }))
        .filter((entry) => entry.itemName)
    : [];
  const modelLanguage = String(parsed.language || "hinglish").toLowerCase().trim();
  const strictLanguage = detectLanguageFromText(messageText);

  const inventoryFallback = inferInventoryFromText(messageText);
  const finalIntent = inventoryFallback.intent || intent;
  const finalItemName = inventoryFallback.itemName || itemName;
  const finalQuantity = Number.isFinite(inventoryFallback.quantity)
    ? inventoryFallback.quantity
    : quantity;
  const finalUnit = inventoryFallback.unit || unit;
  const finalItems = Array.isArray(inventoryFallback.items) && inventoryFallback.items.length
    ? inventoryFallback.items
    : items;

  return {
    intent: finalIntent,
    customerName,
    phoneNumber,
    amount: Number.isFinite(amount) ? amount : null,
    itemName: finalItemName,
    quantity: Number.isFinite(finalQuantity) ? finalQuantity : null,
    unit: finalUnit,
    items: finalItems,
    // Enforce language based on input text so replies always match user language.
    language: ALLOWED_LANGUAGES.has(strictLanguage)
      ? strictLanguage
      : ALLOWED_LANGUAGES.has(modelLanguage)
        ? modelLanguage
        : "hinglish",
  };
}

module.exports = { detectIntent, detectLanguageFromText };
