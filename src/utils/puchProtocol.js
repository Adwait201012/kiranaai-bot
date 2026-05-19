"use strict";

const SESSION_IDLE_MS = 10 * 60 * 1000;
const CONFIDENCE_THRESHOLD = 0.85;
const LARGE_AMOUNT_THRESHOLD = 50000;

const SPOKEN_AMOUNTS = [
  ["paanch hazaar", 5000],
  ["panch hazaar", 5000],
  ["teen hazaar", 3000],
  ["do hazaar", 2000],
  ["ek hazaar", 1000],
  ["paanch sau", 500],
];

const WRITE_INTENTS = new Set(["LOG_UDHAAR", "LOG_WAPAS"]);
const NAME_KEYWORD_COLLISIONS = new Set(["diya", "liya", "mila"]);

/**
 * Normalise user text per PUCH PROCESS step 4.
 */
function normalizeInput(text, { isVoice = false } = {}) {
  let normalized = String(text || "")
    .replace(/₹/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = normalized.toLowerCase();
  for (const [phrase, value] of SPOKEN_AMOUNTS) {
    if (lower.includes(phrase)) {
      normalized = normalized.replace(new RegExp(phrase, "gi"), String(value));
    }
  }

  if (isVoice) {
    normalized = `[VOICE] ${normalized}`;
  }

  return normalized;
}

/**
 * Strip [VOICE] tag before sending to Groq.
 */
function stripVoiceTag(text) {
  return String(text || "").replace(/^\[VOICE\]\s*/i, "").trim();
}

/**
 * PUCH confidence: type +0.4, amount +0.3, name +0.3
 */
function calculateConfidence({ intent, amount, customerName }) {
  let score = 0;
  if (intent && intent !== "UNKNOWN" && intent !== "UNCLEAR") score += 0.4;
  if (amount != null && Number(amount) > 0) score += 0.3;
  if (customerName && String(customerName).trim()) score += 0.3;
  return score;
}

function needsWriteConfidence(intent) {
  return WRITE_INTENTS.has(intent);
}

function hasAmbiguousSpokenAmount(rawText) {
  const lower = String(rawText || "").toLowerCase();
  const spokenHints = ["sau", "hazaar", "hazar", "hajaar"];
  const hasSpoken = spokenHints.some((w) => lower.includes(w));
  const hasDigit = /\d/.test(lower);
  return hasSpoken && !hasDigit;
}

/**
 * If Diya/Liya/Mila is the first token before an amount, treat as name (PUCH rule 10).
 */
function applyNameCollisionHint(messageText) {
  const stripped = stripVoiceTag(messageText);
  const match = stripped.match(/^(\S+)\s+(\d[\d,]*)/i);
  if (!match) return messageText;

  const firstWord = match[1].toLowerCase();
  if (NAME_KEYWORD_COLLISIONS.has(firstWord)) {
    return `${messageText}\n[hint: "${match[1]}" is the customer name, not a payment keyword]`;
  }
  return messageText;
}

function buildClarifyingQuestion({ intent, customerName, amount, language }) {
  if (!customerName && WRITE_INTENTS.has(intent)) {
    return language === "english"
      ? "Whose account? Please send customer name."
      : "Kis grahak ka? Naam bhejiye.";
  }
  if (!amount && WRITE_INTENTS.has(intent)) {
    return language === "english" ? "How much (₹)?" : "Kitne rupaye?";
  }
  if (intent === "UNKNOWN" || intent === "UNCLEAR") {
    return language === "english"
      ? "Didn't catch that. Example: 'Sharma ji 500 udhaar'"
      : "Samajh nahi aaya. Example: 'Sharma ji 500 udhaar'";
  }
  return language === "english"
    ? "Please confirm name and amount."
    : "Naam aur rashi clear karein.";
}

function buildVoiceConfirmMessage({ customerName, amount, intent, language }) {
  const action =
    intent === "LOG_WAPAS"
      ? language === "english"
        ? "payment"
        : "jama"
      : language === "english"
        ? "credit"
        : "udhaar";
  const name = customerName || "?";
  const amt = amount != null ? amount : "?";
  return language === "english"
    ? `I heard: ${name} — ₹${amt} ${action}. Correct? (Yes/No)`
    : `Maine suna: ${name} ko ₹${amt} ${action}. Sahi hai? (Haan/Nahi)`;
}

function buildLargeAmountConfirmMessage(amount, language) {
  return language === "english"
    ? `₹${amount} — is this correct? (Yes/No)`
    : `₹${amount} — yeh sahi hai? (Haan/Nahi)`;
}

function isAffirmativeReply(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(haan|han|ha|yes|y|sahi|ok|okay|theek|thik|correct|ji)$/i.test(t);
}

function isNegativeReply(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(nahi|nah|no|n|galat|wrong|cancel)$/i.test(t);
}

function logPuchAction({ senderPhone, wamid, intent, confidence, status, extra }) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      sender_phone: senderPhone,
      wamid: wamid || null,
      intent: intent || null,
      confidence: confidence != null ? confidence : null,
      status,
      ...extra,
    })
  );
}

module.exports = {
  SESSION_IDLE_MS,
  CONFIDENCE_THRESHOLD,
  LARGE_AMOUNT_THRESHOLD,
  normalizeInput,
  stripVoiceTag,
  calculateConfidence,
  needsWriteConfidence,
  hasAmbiguousSpokenAmount,
  applyNameCollisionHint,
  buildClarifyingQuestion,
  buildVoiceConfirmMessage,
  buildLargeAmountConfirmMessage,
  isAffirmativeReply,
  isNegativeReply,
  logPuchAction,
  WRITE_INTENTS,
};
