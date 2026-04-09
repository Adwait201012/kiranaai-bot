const Groq = require("groq-sdk");
const env = require("../config/env");

const SYSTEM_PROMPT =
  "You are a kirana store assistant. Extract customer name and amount from the message. Reply ONLY in JSON like this: {customerName: 'Sharma ji', amount: 500, type: 'udhaar'} or {customerName: 'Sharma ji', amount: 200, type: 'wapas'} or {type: 'unknown'} if not relevant";

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

function fallbackExtract(messageText) {
  const cleaned = String(messageText || "").trim().replace(/\s+/g, " ");
  const match = cleaned.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+(udhaar|wapas)$/i);
  if (!match) {
    return { type: "unknown" };
  }

  const customerName = match[1].trim();
  const amount = Number(match[2]);
  const type = match[3].toLowerCase();

  if (!customerName || Number.isNaN(amount) || amount <= 0) {
    return { type: "unknown" };
  }

  return { customerName, amount, type };
}

async function extractTransaction(messageText) {
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
    return fallbackExtract(messageText);
  }

  if (!parsed || typeof parsed !== "object") {
    return { type: "unknown" };
  }

  if (parsed.type === "udhaar" || parsed.type === "wapas") {
    const customerName = String(parsed.customerName || "").trim();
    const amount = Number(parsed.amount);

    if (!customerName || Number.isNaN(amount) || amount <= 0) {
      return fallbackExtract(messageText);
    }

    return { customerName, amount, type: parsed.type };
  }

  return fallbackExtract(messageText);
}

module.exports = { extractTransaction };
