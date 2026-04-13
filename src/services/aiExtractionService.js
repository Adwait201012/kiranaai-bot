const Groq = require("groq-sdk");
const env = require("../config/env");

const client = new Groq({ apiKey: env.groqApiKey });

const SYSTEM_PROMPT = `You are BharatBahi, an AI business assistant for Indian small business owners (MSMEs). You work inside WhatsApp. Understand messages in Hindi, English and Hinglish. Detect intent and return ONLY valid JSON:
{
  intent: one of [LOG_UDHAAR, CHECK_UDHAAR, LOG_WAPAS, TODAY_HISAAB, SABKA_UDHAAR, SAVE_NUMBER, SEND_REMINDER, INVENTORY_ADD, CHECK_STOCK, ALL_STOCK, LOG_EXPENSE, CHECK_EXPENSE, GREETING, UNKNOWN],
  customerName: string or null,
  amount: number or null,
  itemName: string or null,
  quantity: number or null,
  unit: string or null,
  phoneNumber: string or null,
  expenseCategory: string or null,
  language: one of [hindi, hinglish, english]
}

Rules:

Extract FULL numbers correctly: 100kg = quantity 100 unit kg
Person names → udhaar intents. Product/item names → inventory intents
Expense examples: 'bijli bill 500 diya', 'rent 5000 gaya', 'staff ko 2000 diya' → LOG_EXPENSE
Normalize items: rice=chawal, wheat=aata, oil=tel
Customer fuzzy match: Sharma=sharma ji=Sharma Ji = same person
Language: Hindi script = hindi, English only = english, mixed = hinglish
Never return partial numbers
If unclear return UNKNOWN

Examples:
"Sharma ji kitna udhaar" -> {"intent": "CHECK_UDHAAR", "customerName": "Sharma ji", "amount": null, "itemName": null, "quantity": null, "unit": null, "phoneNumber": null, "expenseCategory": null, "language": "hinglish"}
"chawal kitna hai" -> {"intent": "CHECK_STOCK", "customerName": null, "amount": null, "itemName": "chawal", "quantity": null, "unit": null, "phoneNumber": null, "expenseCategory": null, "language": "hinglish"}
"aata 50kg aaya" -> {"intent": "INVENTORY_ADD", "customerName": null, "amount": null, "itemName": "aata", "quantity": 50, "unit": "kg", "phoneNumber": null, "expenseCategory": null, "language": "hinglish"}
"Sharma ji 500 udhaar" -> {"intent": "LOG_UDHAAR", "customerName": "Sharma ji", "amount": 500, "itemName": null, "quantity": null, "unit": null, "phoneNumber": null, "expenseCategory": null, "language": "hinglish"}
"bijli bill 500 diya" -> {"intent": "LOG_EXPENSE", "customerName": null, "amount": 500, "itemName": null, "quantity": null, "unit": null, "phoneNumber": null, "expenseCategory": "bijli bill", "language": "hinglish"}
"rent 5000 gaya" -> {"intent": "LOG_EXPENSE", "customerName": null, "amount": 5000, "itemName": null, "quantity": null, "unit": null, "phoneNumber": null, "expenseCategory": "rent", "language": "hinglish"}
"staff salary 10000" -> {"intent": "LOG_EXPENSE", "customerName": null, "amount": 10000, "itemName": null, "quantity": null, "unit": null, "phoneNumber": null, "expenseCategory": "staff salary", "language": "hinglish"}
"aaj ka kharcha" -> {"intent": "CHECK_EXPENSE", "customerName": null, "amount": null, "itemName": null, "quantity": null, "unit": null, "phoneNumber": null, "expenseCategory": null, "language": "hinglish"}`;

const ITEM_NORMALIZATION_MAP = {
  'rice': 'chawal',
  'wheat': 'aata',
  'oil': 'tel',
  'flour': 'aata',
  'atta': 'aata',
  'maggi': 'maggi',
  'sugar': 'cheeni',
  'salt': 'namak',
  'tea': 'chai',
  'coffee': 'coffee',
  'milk': 'doodh',
  'bread': 'bread',
  'butter': 'makhan',
  'ghee': 'ghee',
  'soap': 'sabun',
  'shampoo': 'shampoo',
  'toothpaste': 'toothpaste'
};

function normalizeItemName(itemName) {
  if (!itemName) return null;
  const normalized = String(itemName).toLowerCase().trim();
  return ITEM_NORMALIZATION_MAP[normalized] || normalized;
}

function normalizeCustomerName(customerName) {
  if (!customerName) return null;
  return String(customerName)
    .toLowerCase()
    .replace(/\b(ji|bhai|ben|devi|sahab|sir|mr|mrs|ms)\b/gi, " ")
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
      }
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        console.error("Groq API failed after retries:", error.message);
      }
    }
  }

  // Default fallback
  if (!parsed.intent) {
    parsed = {
      intent: "UNKNOWN",
      customerName: null,
      amount: null,
      itemName: null,
      quantity: null,
      unit: null,
      phoneNumber: null,
      language: detectLanguage(messageText)
    };
  }

  // Normalize extracted data
  return {
    intent: parsed.intent || "UNKNOWN",
    customerName: parsed.customerName ? normalizeCustomerName(parsed.customerName) : null,
    amount: parsed.amount ? Number(parsed.amount) : null,
    itemName: parsed.itemName ? normalizeItemName(parsed.itemName) : null,
    quantity: parsed.quantity ? Number(parsed.quantity) : null,
    unit: parsed.unit ? String(parsed.unit).toLowerCase() : null,
    phoneNumber: parsed.phoneNumber ? String(parsed.phoneNumber).trim() : null,
    expenseCategory: parsed.expenseCategory ? String(parsed.expenseCategory).trim() : null,
    language: parsed.language || detectLanguage(messageText)
  };
}

module.exports = {
  detectIntent,
  normalizeItemName,
  normalizeCustomerName,
  detectLanguage
};
