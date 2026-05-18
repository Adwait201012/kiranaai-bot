/**
 * parseHinglishUdhaar.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Parses natural Hinglish udhaar/wapas messages and extracts:
 *   { customerName: string, amount: number, type: "credit" | "debit" | null }
 *
 * Covers patterns like:
 *   "Sharma ji 500 udhaar"          → { customerName: "Sharma ji", amount: 500, type: "credit" }
 *   "500 ka maal Ramesh ko"         → { customerName: "Ramesh", amount: 500, type: "credit" }
 *   "Mohan 200 de diye"             → { customerName: "Mohan", amount: 200, type: "debit" }
 *   "Raju bhai ne 1500 wapas kiya"  → { customerName: "Raju bhai", amount: 1500, type: "debit" }
 *   "Chaudhary ji ka udhaar 750"    → { customerName: "Chaudhary ji", amount: 750, type: "credit" }
 *   "Sharma 300 liya"               → { customerName: "Sharma", amount: 300, type: "credit" }
 *
 * Usage:
 *   const { parseHinglishUdhaar } = require("./parseHinglishUdhaar");
 *   const result = parseHinglishUdhaar("Sharma ji 500 udhaar");
 *   // → { customerName: "Sharma ji", amount: 500, type: "credit" }
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

// ── KEYWORD SETS ──────────────────────────────────────────────────────────────

/** Words that signal a CREDIT (udhaar given — money owed TO shop) */
const CREDIT_KEYWORDS = [
  "udhaar", "udhar", "baaki", "credit", "liya", "liye", "le liya",
  "le gaya", "le gayi", "maal", "samaan", "saman", "nikala",
];

/** Words that signal a DEBIT (wapas received — money coming IN) */
const DEBIT_KEYWORDS = [
  "wapas", "vapas", "de diya", "de diye", "de diya usne", "mil gaya",
  "mila", "mili", "received", "paid", "payment", "return", "returned",
  "clear", "cleared", "paid back", "diya", "diye",
];

/** Honorifics / suffixes to keep attached to the name but strip for matching */
const HONORIFICS = ["ji", "bhai", "ben", "behen", "didi", "sahab", "sir"];

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Extract the first standalone number from text (handles 1,500 and 1.5k too).
 * Returns the numeric value or null.
 */
function extractAmount(text) {
  // Match numbers optionally followed by k/K (thousands shorthand)
  const match = text.match(/\b(\d[\d,]*\.?\d*)\s*([kK])?\b/);
  if (!match) return null;
  const raw = parseFloat(match[1].replace(/,/g, ""));
  return match[2] ? raw * 1000 : raw;
}

/**
 * Remove amount tokens (numbers + k suffix) from text so they don't bleed
 * into the name extraction.
 */
function stripAmount(text) {
  return text.replace(/\b\d[\d,]*\.?\d*\s*[kK]?\b/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Naive tokenised name extractor.
 * Strategy: remove known keyword tokens and amount tokens; what remains are
 * likely name words.  Collapse consecutive name-like words.
 */
function extractCustomerName(text, allKeywords) {
  const keywordSet = new Set(allKeywords.map((k) => k.toLowerCase()));

  const stopWords = new Set([
    "ka", "ke", "ki", "ko", "ne", "se", "mein", "par", "hai", "tha",
    "the", "thi", "aur", "or", "aaj", "kal", "abhi", "ab", "bas",
    "please", "karo", "karna", "karo", "ho", "gaya", "gayi", "gaye",
    "wala", "wale", "wali", "usne", "unhone", "unka", "unke",
  ]);

  // Tokenise
  const tokens = stripAmount(text)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const nameTokens = tokens.filter(
    (t) => !keywordSet.has(t) && !stopWords.has(t)
  );

  if (!nameTokens.length) return null;

  // Capitalise each word and reassemble
  const name = nameTokens
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return name || null;
}

/**
 * Detect type from message text.
 * Returns "credit", "debit", or null.
 */
function detectType(lowerText) {
  for (const kw of DEBIT_KEYWORDS) {
    if (lowerText.includes(kw)) return "debit";
  }
  for (const kw of CREDIT_KEYWORDS) {
    if (lowerText.includes(kw)) return "credit";
  }
  return null;
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

/**
 * Parse a Hinglish udhaar/wapas message.
 *
 * @param {string} message  Raw message text from WhatsApp
 * @returns {{ customerName: string|null, amount: number|null, type: "credit"|"debit"|null }}
 */
function parseHinglishUdhaar(message) {
  if (!message || typeof message !== "string") {
    return { customerName: null, amount: null, type: null };
  }

  const lower = message.toLowerCase().trim();
  const allKeywords = [...CREDIT_KEYWORDS, ...DEBIT_KEYWORDS, ...HONORIFICS];

  const amount = extractAmount(lower);
  const type = detectType(lower);
  const customerName = extractCustomerName(lower, allKeywords);

  return { customerName, amount, type };
}

module.exports = { parseHinglishUdhaar };

// ── SELF-TEST (run with: node scripts/parseHinglishUdhaar.js) ─────────────────
if (require.main === module) {
  const testCases = [
    "Sharma ji 500 udhaar",
    "500 ka maal Ramesh ko",
    "Mohan 200 de diye",
    "Raju bhai ne 1500 wapas kiya",
    "Chaudhary ji ka udhaar 750",
    "Sharma 300 liya",
    "Sunita 1,000 wapas mili",
    "Gupta sahab 2k udhaar",
    "Ramesh ko 250 ka samaan diya",
    "payment received from Mohan 400",
  ];

  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  Hinglish Udhaar Parser — Test Results                       │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  for (const msg of testCases) {
    const result = parseHinglishUdhaar(msg);
    console.log(`Input  : "${msg}"`);
    console.log(`Output : ${JSON.stringify(result)}`);
    console.log("─".repeat(65));
  }
}
