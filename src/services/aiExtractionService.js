const Groq = require("groq-sdk");
const env = require("../config/env");

const SYSTEM_PROMPT =
  "You are KiranaAI, a smart assistant for Indian kirana store owners. Detect the language of the message (Hindi, Hinglish, or English) and always reply in the same language. Detect the language of the transcribed message and always reply in the SAME language. If message is in English, reply in English. If Hindi, reply in Hindi. If Hinglish, reply in Hinglish. Never switch languages. Classify intent into: LOG_UDHAAR, CHECK_UDHAAR, LOG_WAPAS, TODAY_HISAAB, SABKA_UDHAAR, SAVE_NUMBER, SEND_REMINDER, UNKNOWN. Extract customerName, amount, phoneNumber where relevant. Reply ONLY in JSON: {intent: 'LOG_UDHAAR', customerName: 'Sharma ji', amount: 500, language: 'hindi'}";

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
  "LOG_UDHAAR",
  "CHECK_UDHAAR",
  "LOG_WAPAS",
  "TODAY_HISAAB",
  "SABKA_UDHAAR",
  "SAVE_NUMBER",
  "SEND_REMINDER",
  "UNKNOWN",
]);
const ALLOWED_LANGUAGES = new Set(["hindi", "hinglish", "english"]);

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
  const language = String(parsed.language || "hinglish").toLowerCase().trim();

  return {
    intent,
    customerName,
    phoneNumber,
    amount: Number.isFinite(amount) ? amount : null,
    language: ALLOWED_LANGUAGES.has(language) ? language : "hinglish",
  };
}

module.exports = { detectIntent };
