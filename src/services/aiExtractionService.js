const Groq = require("groq-sdk");
const env = require("../config/env");

const client = new Groq({ apiKey: env.groqApiKey });

const SYSTEM_PROMPT = `## ROLE
You are an AI assistant for Indian MSMEs embedded in WhatsApp via Twilio (BharatBahi).
You understand Hindi, Hinglish, and English — including voice transcripts.

---

## PUCH COMMAND PROTOCOL
For EVERY incoming message, follow this exact sequence before responding:

### P — PROCESS
1. Normalise input: strip extra spaces, correct obvious OCR/ASR errors.
2. If input is a voice transcript, tag it as [VOICE] internally.
3. Extract: customer name, amount (₹), action keyword (udhaar/jama/baki/hisaab).
4. Convert all amounts to integers. "paanch sau" = 500. "5 hundred" = 500.

### U — UNDERSTAND
5. Classify intent: ADD_CREDIT | ADD_PAYMENT | CHECK_BALANCE | LIST_CUSTOMERS | UNCLEAR
6. If intent is UNCLEAR or confidence < 0.85, ask ONE clarifying question. Do NOT guess.
7. For [VOICE] inputs with ambiguous amounts, always confirm:
   "Maine suna: [name] ko ₹[amount] [udhaar/jama]. Sahi hai? (Haan/Nahi)"

### C — CHECK (anti-glitch guard)
8. Before writing any record, generate a message fingerprint:
   fingerprint = hash(sender_phone + customer_name + amount + action + minute_of_day)
9. If this fingerprint was already processed in the last 5 minutes → send:
   "Yeh entry pehle se save ho gayi hai. ✅ Dobara save nahi kiya."
   Then STOP. Do not write again.
10. Re-fetch current total from the database. NEVER calculate running total from
    previous bot messages. Always use the live DB value.

### H — HANDLE
11. On any DB error → reply: "Kuch technical dikkat aayi. 2 minute mein dobara try karein."
12. On name not found → show top 3 fuzzy matches and ask which one.
13. On session idle > 10 min → reset state silently, treat next message as fresh.
14. Log every action with: timestamp, sender, fingerprint, intent, status (success/skipped/error).

---

## RESPONSE FORMAT (always use this structure)
Done, ji! ✅

👤 Grahak: [Name]
💸 [Naya Udhaar / Jama]: ₹[amount]
📍 Aapka Total Udhaar: ₹[live_total_from_db]

Hisaab note ho gaya! 🗒️

---

## CRITICAL SYSTEM RULE: JSON OUTPUT ONLY
You are operating as the NLU (Natural Language Understanding) engine for the system.
You MUST NOT generate textual replies. You MUST return ONLY valid JSON representing the extracted data.
The actual validation, fingerprinting, and database operations will be handled by the backend system based on your JSON output.

Return ONLY valid JSON, no extra text:
{intent, customerName, amount, itemName, quantity, unit, phoneNumber, expenseCategory, employeeName, employeePhone, language}

Intent rules mapping:
ADD_CREDIT -> LOG_UDHAAR
ADD_PAYMENT -> LOG_WAPAS
CHECK_BALANCE -> CHECK_UDHAAR
LIST_CUSTOMERS -> SABKA_UDHAAR

(Fallback to these detailed rules for classification):
Message says Raju ko add karo/employee add karo/helper add karo with name and phone number → ADD_EMPLOYEE (extract employeeName and employeePhone)
Message has person name + kitna baaki/ka hisaab/kitna dena hai/udhaar check/baaki batao/baaki hai → CHECK_SINGLE_CUSTOMER_BALANCE (extract customerName only)
Message says last entry dikhao/last entry/pichli entry/abhi kya likha/last transaction/kya likha abhi/recent entries/pichle transactions → LAST_ENTRIES (extract customerName if provided)
Message says is mahine ka hisaab/monthly hisaab/is mahine kitna udhaar/mahine ka report/monthly report/is month ka hisaab/poore mahine ka → MONTHLY_SUMMARY
Message says chawal 5kg gaya/tel 2 litre bika/stock gaya/chawal 5 sell hua/nikala with item, quantity, unit → STOCK_OUT (extract itemName, quantity, unit)
Message has person name + amount + udhaar/baaki/credit → LOG_UDHAAR (CRITICAL RULE: If message contains BOTH a customer name, the word "udhaar" (or variants), AND a number/amount, ALWAYS classify as LOG_UDHAAR, regardless of whether "ka" is present. e.g. "Bihari ji ka udhaar 1000" = LOG_UDHAAR)
Message has person name + kitna udhaar/baaki kitna/ka udhaar (BUT NO NUMBER/AMOUNT) → CHECK_UDHAAR (e.g. "Bihari ji ka udhaar" = CHECK_UDHAAR)
Message has person name + amount + wapas/diya/paid/return/returned/payment/de diya/de diya usne/mil gaya/received/paid back/clear/cleared → LOG_WAPAS (NOTE: Words like return, returned, paid, payment, de diya, de diya usne, mil gaya, received, paid back, clear, cleared always imply repayment/payment received and MUST trigger LOG_WAPAS, never LOG_UDHAAR)
Message has ANY item/product + aaya/aai/mila/received/bought/order → INVENTORY_ADD
Message has item + kitna hai/stock kitna/remaining → CHECK_STOCK
Message says sabka stock/all stock/inventory dikhao → ALL_STOCK
Message says aaj ka hisaab/today summary/daily report → TODAY_HISAAB
Message says sabka udhaar/all credit/baaki list → SABKA_UDHAAR
Message has expense keywords like bill/rent/salary/kharcha/bijli/paid for expense → LOG_EXPENSE
Message says sab delete karo/clear my data/reset karo/sabka data delete karo/mera data delete/delete everything/sab kuch hatao/reset my account/data saaf karo/sab mitao → RESET_DATA
Message says hi/hii/hiii/hey/hello/helo/hlo/namaste/namasthe/nmste/ram ram/jai shree krishna/jai jinendra/haan/han/ha/help/halp/kya hai/kya karta hai/kya ho/start/shuru/chalu/good morning/good evening/gm/ge → GREETING
Message has person name + number/phone + save karo/number save/number store/contact save/save number/mobile save/no. save → SAVE_NUMBER (extract customerName and phoneNumber. phoneNumber must be the 10-digit number)
Message has person name + remind karo/reminder/call karo/WhatsApp karo/remind/contact karo → SEND_REMINDER (extract customerName)
Anything else → UNKNOWN

Number rules:
ALWAYS extract complete numbers: 100kg → quantity:100 unit:kg
NEVER extract partial numbers

Unit rules:
Extract standard units if mentioned (packet, pkt, kg, gram, box, piece, liter)
NEVER extract verbs as units. Words like 'aaya', 'aai', 'mila', 'diya', 'received' are VERBS, NOT units.
If no clear unit is mentioned, set unit to null.

Item vs person rule:
Human names (Sharma, Ramesh, Mohan, Sunita) → customerName
Products (chawal, aata, paracetamol, notebook, cement) → itemName
Key signal: if message has aaya/aai/mila → it's ALWAYS an item, never a person

Language rule:
Pure Hindi Devanagari script → hindi
Pure English → english
Hindi written in English alphabet / Mixed → hinglish
Always return the detected language`;

const ITEM_NORMALIZATION_PROMPT = `Normalize this product name to a short standard form. Rules:

Remove quantities, colors descriptions unless they differentiate the product
Keep brand name if mentioned
Keep flavor/variant if it differentiates (lays red vs lays green are different)
Make lowercase
Max 3-4 words
TRANSLITERATE any Hindi/regional words to English script (e.g., 'मैगी' → 'maggi', 'चावल' → 'chawal'). All output MUST be in English alphabet.
Examples:
'lays red packet chips' → 'lays red'
'lal red packet chips lays' → 'lays red'
'मैगी' → 'maggi'
'Maggi 2 minute noodles' → 'maggi noodles'
'paracetamol 500mg strips' → 'paracetamol 500mg'
'Dettol soap bar' → 'dettol soap'
'Bisleri mineral water bottle' → 'bisleri water'
'atta gehun ka 10kg' → 'aata'
'basmati chawal premium' → 'basmati chawal'
'Fevicol SH adhesive' → 'fevicol sh'
Return ONLY the normalized name, nothing else.`;

// Synchronous fallback (basic lowercase + trim) — used only when Groq is unavailable
function normalizeItemName(itemName) {
  if (!itemName) return null;
  return String(itemName).toLowerCase().trim();
}

// Async Groq-powered normalization — USE THIS before any Supabase inventory operation
async function normalizeItemNameWithGroq(itemName) {
  if (!itemName) return null;
  const rawName = String(itemName).trim();
  try {
    const completion = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0,
      messages: [
        { role: "system", content: ITEM_NORMALIZATION_PROMPT },
        { role: "user", content: rawName },
      ],
    });
    let result = (completion.choices?.[0]?.message?.content || "").trim().toLowerCase();

    // Strip surrounding quotes that LLM sometimes adds: "lays red" → lays red
    result = result.replace(/^['"]+|['"]+$/g, "").trim();
    // Strip trailing punctuation: lays red. → lays red
    result = result.replace(/[.,!?]+$/, "").trim();
    // Collapse any internal extra spaces
    result = result.replace(/\s+/g, " ").trim();

    // Safety: if result is empty or suspiciously long, fall back
    if (!result || result.length > 60) {
      console.warn(`[ItemNorm] Groq gave bad result for "${rawName}", using fallback`);
      return normalizeItemName(rawName);
    }

    console.log(`[ItemNorm] "${rawName}" → "${result}"`);
    return result;
  } catch (err) {
    console.error(`[ItemNorm] Groq call failed for "${rawName}", using fallback:`, err.message);
    return normalizeItemName(rawName);
  }
}

const HINDI_TRANSLITERATION_MAP = {
  "शर्मा": "sharma",
  "गुप्ता": "gupta",
  "वर्मा": "varma",
  "यादव": "yadav",
  "सिंह": "singh",
  "कुमार": "kumar",
  "जोशी": "joshi",
  "पटेल": "patel",
  "अग्रवाल": "agarwal",
  "तिवारी": "tiwari",
  "चौधरी": "chaudhary",
  "राम": "ram",
  "श्याम": "shyam",
  "राज": "raj",
  "सुरेश": "suresh",
  "रमेश": "ramesh",
  "महेश": "mahesh",
  "दिनेश": "dinesh",
  "मोहन": "mohan",
  "सोहन": "sohan",
  "जी": "ji",
  "भाई": "bhai",
  "देवी": "devi",
  "साहब": "sahab",
  "श्री": "shree"
};

function normalizeCustomerName(customerName) {
  if (!customerName) return null;
  
  let name = String(customerName);
  
  Object.entries(HINDI_TRANSLITERATION_MAP).forEach(([hi, en]) => {
    name = name.split(hi).join(en);
  });

  return name
    .toLowerCase()
    .replace(/\b(ji|bhai|ben|devi|sahab|sir|mr|mrs|ms|shree)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguage(message) {
  const text = String(message || "").trim();
  if (!text) return "hinglish";
  
  // Check for pure Hindi script
  if(/[\u0900-\u097F]/.test(text) && !/[a-zA-Z]/.test(text)) {
    return "hindi";
  }
  
  // Check for pure English
  if(!/[\u0900-\u097F]/.test(text) && /[a-zA-Z]/.test(text)) {
    return "english";
  }
  
  // Mixed = Hinglish
  return "hinglish";
}

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

async function detectIntent(messageText) {
  let parsed = {};
  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount < maxRetries) {
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
      
      // Validate required fields
      if (parsed.intent && typeof parsed.intent === 'string') {
        break;
      } else {
        throw new Error("Invalid intent format");
      }
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        console.error("Groq API failed after retries:", error.message);
        throw new Error("Network issue, try again!");
      }
    }
  }

  // Default fallback shouldn't be reached if it throws, but kept for safety
  if (!parsed.intent) {
    throw new Error("Network issue, try again!");
  }

  // Normalize extracted data
  // Note: itemName normalization via Groq is intentionally done in udhaarService
  // right before the Supabase call so it applies to ALL inventory paths.
  return {
    intent: parsed.intent || "UNKNOWN",
    customerName: parsed.customerName ? String(parsed.customerName).trim() : null,
    amount: parsed.amount ? Number(parsed.amount) : null,
    itemName: parsed.itemName ? normalizeItemName(parsed.itemName) : null,
    quantity: parsed.quantity ? Number(parsed.quantity) : null,
    unit: parsed.unit ? String(parsed.unit).toLowerCase() : null,
    phoneNumber: parsed.phoneNumber ? String(parsed.phoneNumber).trim() : null,
    expenseCategory: parsed.expenseCategory ? String(parsed.expenseCategory).trim() : null,
    employeeName: parsed.employeeName ? String(parsed.employeeName).trim() : null,
    employeePhone: parsed.employeePhone ? String(parsed.employeePhone).trim() : null,
    language: parsed.language ? String(parsed.language).toLowerCase() : detectLanguage(messageText)
  };
}

module.exports = {
  detectIntent,
  normalizeItemName,
  normalizeItemNameWithGroq,
  normalizeCustomerName,
  detectLanguage
};
