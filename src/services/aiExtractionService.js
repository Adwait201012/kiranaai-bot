const Groq = require("groq-sdk");
const env = require("../config/env");

const SYSTEM_PROMPT =
  "You are VyaparAI, a smart assistant for Indian kirana store owners. STRICT LANGUAGE RULE: Detect the language of the input message. If input is pure English (like 'Sharma ji owes 500' or 'hello'), reply ONLY in English. If input is pure Hindi (like 'शर्मा जी का उधार'), reply ONLY in Hindi. If input is Hinglish (like 'Sharma ji 500 udhaar' or 'namaste'), reply ONLY in Hinglish. NEVER mix languages. The reply language must be 100% identical to input language. Classify intent into: GREETING, LOG_UDHAAR, CHECK_UDHAAR, LOG_WAPAS, TODAY_HISAAB, SABKA_UDHAAR, SAVE_NUMBER, SEND_REMINDER, INVENTORY_ADD, CHECK_STOCK, ALL_STOCK, UNKNOWN. Inventory examples: 'chawal 50kg aaya', 'maggi 100 packet aaya' => INVENTORY_ADD with itemName, quantity, unit. 'chawal stock kitna hai' => CHECK_STOCK with itemName. 'sabka stock dikhao' => ALL_STOCK. Extract customerName, amount, phoneNumber, itemName, quantity, unit where relevant. Reply ONLY in JSON: {intent: 'LOG_UDHAAR', customerName: 'Sharma ji', amount: 500, language: 'hindi'}";

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
  const modelLanguage = String(parsed.language || "hinglish").toLowerCase().trim();
  const strictLanguage = detectLanguageFromText(messageText);

  return {
    intent,
    customerName,
    phoneNumber,
    amount: Number.isFinite(amount) ? amount : null,
    itemName,
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit,
    // Enforce language based on input text so replies always match user language.
    language: ALLOWED_LANGUAGES.has(strictLanguage)
      ? strictLanguage
      : ALLOWED_LANGUAGES.has(modelLanguage)
        ? modelLanguage
        : "hinglish",
  };
}

module.exports = { detectIntent, detectLanguageFromText };
