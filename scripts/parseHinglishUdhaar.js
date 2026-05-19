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

const ASR_NAME_FIXES = [
  [/\bdivy\b/gi, "diya"],
  [/\bdea\b/gi, "diya"],
  [/\bmotion\b/gi, "mohan"],
];

const NAME_KEYWORD_COLLISIONS = new Set(["diya", "liya", "mila"]);

/** Pre-process raw message before amount/name extraction */
function normaliseText(text) {
  let result = String(text || "")
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/(\d+)\s*k\b/gi, (_, n) => String(parseInt(n, 10) * 1000))
    .replace(/paanch\s*sau/gi, "500")
    .replace(/panch\s*sau/gi, "500")
    .replace(/ek\s*hazaar/gi, "1000")
    .replace(/do\s*hazaar/gi, "2000")
    .replace(/teen\s*hazaar/gi, "3000")
    .replace(/char\s*hazaar/gi, "4000")
    .replace(/paanch\s*hazaar/gi, "5000")
    .replace(/panch\s*hazaar/gi, "5000")
    .replace(/das\s*hazaar/gi, "10000")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of ASR_NAME_FIXES) {
    result = result.replace(pattern, replacement);
  }

  // Accidental trailing k: 1000k → 1000
  result = result.replace(/\b(\d{3,})k\b/gi, "$1");

  return flattenMultiWordKeywords(result);
}

function normaliseTranscript(message) {
  return normaliseText(message);
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

function extractAmount(text) {
  const match = text.match(/\b(\d[\d]*\.?\d*)\b/);
  if (!match) return null;
  const raw = parseFloat(match[1]);
  if (!Number.isFinite(raw)) return null;
  return Math.round(raw);
}

function stripAmount(text) {
  return text.replace(/\b\d[\d]*\.?\d*\b/g, " ").replace(/\s+/g, " ").trim();
}

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

/**
 * Three validation gates before any DB write (used by webhook handler).
 */
function validateParsedForWrite(parsed, expectedType) {
  if (!parsed.customerName || parsed.customerName.length < 2 || !isValidCustomerName(parsed.customerName)) {
    return {
      ok: false,
      message: "Grahak ka naam samajh nahi aaya. Naam batayein?",
    };
  }

  const amount = Math.round(Number(parsed.amount));
  if (!amount || amount <= 0) {
    return {
      ok: false,
      message: "Amount samajh nahi aaya. Kitne rupaye? (jaise: 2000)",
    };
  }

  if (!parsed.type) {
    return {
      ok: false,
      message: "Udhaar hai ya wapasi? Please confirm karein.",
    };
  }

  if (expectedType && parsed.type !== expectedType) {
    return {
      ok: false,
      message: expectedType === "credit"
        ? "Udhaar ke liye 'udhaar' likhein. Example: Sharma ji 2000 udhaar"
        : "Wapas ke liye 'wapas' likhein. Example: Sharma ji 500 wapas",
    };
  }

  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    return {
      ok: false,
      message: parsed.clarificationMessage || "Samajh nahi aaya. Example: 'Sharma ji 2000 udhaar'",
    };
  }

  return {
    ok: true,
    customerName: parsed.customerName,
    amount,
    type: parsed.type,
  };
}

function parseHinglishUdhaar(message) {
  const empty = {
    customerName: null,
    amount: null,
    type: null,
    confidence: 0,
    needsClarification: true,
    clarificationMessage: "Grahak ka naam samajh nahi aaya. Naam batayein?",
  };

  if (!message || typeof message !== "string") {
    return { ...empty, needsClarification: false };
  }

  const normalized = normaliseText(message);
  const lower = normalized.toLowerCase();

  const rawAmount = extractAmount(normalized);
  const amount = rawAmount != null ? Math.round(Number(rawAmount)) : null;
  const type = detectType(lower);
  const customerName = extractCustomerName(lower);
  const confidence = calculateConfidence({ customerName, amount, type });

  let needsClarification = false;
  let clarificationMessage = null;

  if (!isValidCustomerName(customerName)) {
    needsClarification = true;
    clarificationMessage = "Grahak ka naam samajh nahi aaya. Naam batayein?";
  } else if (!amount || amount <= 0) {
    needsClarification = true;
    clarificationMessage = "Amount samajh nahi aaya. Kitne rupaye? (jaise: 2000)";
  } else if (!type) {
    needsClarification = true;
    clarificationMessage = "Udhaar hai ya wapasi? Please confirm karein.";
  } else if (confidence < CONFIDENCE_THRESHOLD) {
    needsClarification = true;
    clarificationMessage = "Samajh nahi aaya. Example: 'Sharma ji 2000 udhaar'";
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
  normaliseText,
  calculateConfidence,
  isValidCustomerName,
  validateParsedForWrite,
  CONFIDENCE_THRESHOLD,
};

// ── SELF-TEST ───────────────────────────────────────────────────────────────────
if (require.main === module) {
  const testCases = [
    ["Sharma ji 500 udhaar", { customerName: "Sharma Ji", amount: 500, type: "credit" }],
    ["Sharma ji 2000 udhar", { customerName: "Sharma Ji", amount: 2000, type: "credit" }],
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

  const gateTests = [
    ["xyz", { ok: false }],
    ["Mohan udhar", { ok: false, hasAmountMsg: true }],
    ["2000 udhar", { ok: false, hasNameMsg: true }],
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
      })}`);
    }
  }

  console.log("\n── Validation gate tests ──\n");

  for (const [msg, expected] of gateTests) {
    const parsed = parseHinglishUdhaar(msg);
    const gate = validateParsedForWrite(parsed, parsed.type);
    let ok = gate.ok === expected.ok;
    if (expected.hasAmountMsg) ok = ok && gate.message.includes("Kitne rupaye");
    if (expected.hasNameMsg) ok = ok && gate.message.includes("naam");

    if (ok) {
      passed++;
      console.log(`✅ GATE PASS: "${msg}"`);
    } else {
      failed++;
      console.log(`❌ GATE FAIL: "${msg}" → ${JSON.stringify(gate)}`);
    }
  }

  console.log("\n─".repeat(65));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
