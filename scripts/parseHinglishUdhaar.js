/**
 * parseHinglishUdhaar.js
 * Parses natural Hinglish udhaar/wapas messages.
 */

"use strict";

const CONFIDENCE_THRESHOLD = 0.85;

const CREDIT_KEYWORDS = [
  "udhaar", "udhar", "baaki", "credit", "liya", "liye", "le_liya",
  "le_gaya", "le_gayi", "maal", "samaan", "saman", "nikala",
];

const DEBIT_KEYWORDS = [
  "wapas", "vapas", "de_diya", "de_diye", "de_diya_usne", "mil_gaya",
  "mila", "mili", "received", "paid", "payment", "return", "returned",
  "clear", "cleared", "paid_back", "diya", "diye", "kiya",
];

const MULTI_WORD_PHRASES = [
  "le gaya", "le gayi", "le liya", "de diya", "de diye", "de diya usne",
  "mil gaya", "paid back", "wapas kiya",
];

const HONORIFICS = new Set(["ji", "bhai", "ben", "behen", "didi", "sahab", "sir"]);

const SPOKEN_AMOUNTS = [
  ["paanch hazaar", 5000],
  ["panch hazaar", 5000],
  ["teen hazaar", 3000],
  ["do hazaar", 2000],
  ["ek hazaar", 1000],
  ["paanch sau", 500],
  ["panch sau", 500],
];

const ASR_NAME_FIXES = [
  [/\bmotion\b/gi, "mohan"],
  [/\bdivy\b/gi, "diya"],
  [/\bdea\b/gi, "diya"],
  [/\bmotion\b/gi, "mohan"],
];

const NAME_KEYWORD_COLLISIONS = new Set(["diya", "liya", "mila"]);

// ── normaliseTranscript ───────────────────────────────────────────────────────

function normaliseTranscript(message) {
  let text = String(message || "")
    .replace(/₹/g, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of ASR_NAME_FIXES) {
    text = text.replace(pattern, replacement);
  }

  let lower = text.toLowerCase();
  for (const [phrase, value] of SPOKEN_AMOUNTS) {
    if (lower.includes(phrase)) {
      text = text.replace(new RegExp(phrase, "gi"), String(value));
      lower = text.toLowerCase();
    }
  }

  // Accidental trailing k on large numbers: 1000k → 1000
  text = text.replace(/\b(\d{3,})k\b/gi, "$1");

  // Expand 1K / 2k / 1.5k style
  text = text.replace(/\b(\d[\d,]*\.?\d*)\s*([kK])\b/g, (_, num) => {
    const n = parseFloat(String(num).replace(/,/g, ""));
    return String(Math.round(n * 1000));
  });

  return flattenMultiWordKeywords(text);
}

function flattenMultiWordKeywords(text) {
  let result = text.toLowerCase();
  const sorted = [...MULTI_WORD_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    const token = phrase.replace(/\s+/g, "_");
    result = result.split(phrase).join(token);
  }
  return result;
}

// ── amount ────────────────────────────────────────────────────────────────────

function extractAmount(text) {
  const match = text.match(/\b(\d[\d,]*\.?\d*)\b/);
  if (!match) return null;
  const raw = parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(raw) ? Math.round(raw) : null;
}

function stripAmount(text) {
  return text.replace(/\b\d[\d,]*\.?\d*\b/g, " ").replace(/\s+/g, " ").trim();
}

// ── type ────────────────────────────────────────────────────────────────────────

function detectType(lowerText) {
  const firstWord = lowerText.split(/\s+/)[0] || "";

  for (const kw of DEBIT_KEYWORDS) {
    if (NAME_KEYWORD_COLLISIONS.has(kw) && firstWord === kw) continue;
    if (lowerText.includes(kw)) return "debit";
  }
  for (const kw of CREDIT_KEYWORDS) {
    if (lowerText.includes(kw)) return "credit";
  }
  return null;
}

// ── name ─────────────────────────────────────────────────────────────────────────

function isValidCustomerName(name) {
  if (!name || typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (/\d/.test(trimmed)) return false;
  return true;
}

function titleCaseName(tokens) {
  return tokens
    .map((w) => {
      const lower = w.toLowerCase();
      if (HONORIFICS.has(lower)) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function buildKeywordSetForNameExtraction(lowerText) {
  const firstWord = lowerText.split(/\s+/)[0] || "";
  const keywordSet = new Set([
    ...CREDIT_KEYWORDS,
    ...DEBIT_KEYWORDS,
    ...MULTI_WORD_PHRASES.map((p) => p.replace(/\s+/g, "_")),
  ].map((k) => k.toLowerCase()));

  if (NAME_KEYWORD_COLLISIONS.has(firstWord)) {
    keywordSet.delete(firstWord);
  }

  return keywordSet;
}

function extractCustomerName(text) {
  const firstWord = text.split(/\s+/)[0] || "";
  const keywordSet = buildKeywordSetForNameExtraction(text);

  const stopWords = new Set([
    "ka", "ke", "ki", "ko", "ne", "se", "mein", "par", "hai", "tha",
    "the", "thi", "aur", "or", "aaj", "kal", "abhi", "ab", "bas",
    "please", "karo", "karna", "ho", "gaya", "gayi", "gaye",
    "wala", "wale", "wali", "usne", "unhone", "unka", "unke",
    "naam", "maal", "samaan", "saman", "from", "payment",
  ]);

  const tokens = stripAmount(text)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const nameTokens = tokens.filter(
    (t) => !keywordSet.has(t) && !stopWords.has(t)
  );

  if (!nameTokens.length) return null;

  const name = titleCaseName(nameTokens);
  return isValidCustomerName(name) ? name : null;
}

function calculateConfidence({ customerName, amount, type }) {
  let score = 0;
  if (type) score += 0.4;
  if (amount != null && amount > 0) score += 0.3;
  if (customerName && isValidCustomerName(customerName)) score += 0.3;
  return score;
}

// ── main ────────────────────────────────────────────────────────────────────────

function parseHinglishUdhaar(message) {
  const empty = {
    customerName: null,
    amount: null,
    type: null,
    confidence: 0,
    needsClarification: true,
    clarificationMessage: "Grahak ka naam kya hai?",
  };

  if (!message || typeof message !== "string") {
    return { ...empty, needsClarification: false };
  }

  const normalized = normaliseTranscript(message);
  const lower = normalized.toLowerCase();

  const amount = extractAmount(normalized);
  const type = detectType(lower);
  const customerName = extractCustomerName(lower);
  const confidence = calculateConfidence({ customerName, amount, type });

  let needsClarification = false;
  let clarificationMessage = null;

  if (!isValidCustomerName(customerName)) {
    needsClarification = true;
    clarificationMessage = "Grahak ka naam kya hai?";
  } else if (confidence < CONFIDENCE_THRESHOLD) {
    needsClarification = true;
    clarificationMessage = !amount
      ? "Kitne rupaye?"
      : "Grahak ka naam kya hai?";
  } else if (!type) {
    needsClarification = true;
    clarificationMessage = "Udhaar hai ya wapas? Example: 'Sharma ji 500 udhaar'";
  }

  return {
    customerName,
    amount,
    type,
    confidence,
    needsClarification,
    clarificationMessage,
  };
}

module.exports = {
  parseHinglishUdhaar,
  normaliseTranscript,
  calculateConfidence,
  isValidCustomerName,
  CONFIDENCE_THRESHOLD,
};

// ── SELF-TEST ───────────────────────────────────────────────────────────────────
if (require.main === module) {
  const testCases = [
    ["Sharma ji 500 udhaar", { customerName: "Sharma Ji", amount: 500, type: "credit" }],
    ["500 ka maal Ramesh ko", { customerName: "Ramesh", amount: 500, type: "credit" }],
    ["Mohan 200 de diye", { customerName: "Mohan", amount: 200, type: "debit" }],
    ["Raju bhai ne 1500 wapas kiya", { customerName: "Raju Bhai", amount: 1500, type: "debit" }],
    ["Chaudhary ji ka udhaar 750", { customerName: "Chaudhary Ji", amount: 750, type: "credit" }],
    ["Sharma 300 liya", { customerName: "Sharma", amount: 300, type: "credit" }],
    ["Sunita 1,000 wapas mili", { customerName: "Sunita", amount: 1000, type: "debit" }],
    ["Gupta sahab 2k udhaar", { customerName: "Gupta Sahab", amount: 2000, type: "credit" }],
    ["Ramesh ko 250 ka samaan diya", { customerName: "Ramesh", amount: 250, type: "debit" }],
    ["payment received from Mohan 400", { customerName: "Mohan", amount: 400, type: "debit" }],
    ["Sita ne 300 liye", { customerName: "Sita", amount: 300, type: "credit" }],
    ["1000 ka saman Radhika ke naam", { customerName: "Radhika", amount: 1000, type: "credit" }],
    ["Diya 1000 udhar", { customerName: "Diya", amount: 1000, type: "credit" }],
    ["paanch sau Mohan udhaar", { customerName: "Mohan", amount: 500, type: "credit" }],
  ];

  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  Hinglish Udhaar Parser — Test Results                       │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  let passed = 0;
  let failed = 0;

  for (const [msg, expected] of testCases) {
    const result = parseHinglishUdhaar(msg);
    const ok =
      result.customerName === expected.customerName &&
      result.amount === expected.amount &&
      result.type === expected.type;

    if (ok) {
      passed++;
      console.log(`✅ PASS: "${msg}"`);
    } else {
      failed++;
      console.log(`❌ FAIL: "${msg}"`);
      console.log(`   Expected: ${JSON.stringify(expected)}`);
      console.log(`   Got:      ${JSON.stringify({
        customerName: result.customerName,
        amount: result.amount,
        type: result.type,
        confidence: result.confidence,
      })}`);
    }
  }

  console.log("\n─".repeat(65));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
