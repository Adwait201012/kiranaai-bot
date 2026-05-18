const { supabase } = require('../config/supabase');

/**
 * 1. Robust Hinglish Amount Parser
 * Extracts amounts from strings like "1,000", "500", "2k", or "paanch sau"
 */
function extractAmount(text) {
  if (!text) return null;
  const lowerText = text.toLowerCase().trim();
  
  // A. Try to extract standard numeric digits first (handles commas, decimals, k/K suffixes)
  const numMatch = lowerText.match(/\b(\d[\d,]*\.?\d*)\s*([kK])?\b/);
  if (numMatch) {
    const rawNum = parseFloat(numMatch[1].replace(/,/g, ""));
    return numMatch[2] ? rawNum * 1000 : rawNum;
  }

  // B. Try Hinglish text numbers (Bonus feature for "paanch sau rupaye")
  const hindiNumbers = {
    'ek': 1, 'do': 2, 'teen': 3, 'chaar': 4, 'char': 4, 'paanch': 5, 'panch': 5,
    'che': 6, 'chhe': 6, 'saat': 7, 'aath': 8, 'nau': 9, 'das': 10
  };

  for (const [word, value] of Object.entries(hindiNumbers)) {
    if (lowerText.includes(word)) {
      if (lowerText.includes(`${word} sau`)) return value * 100;
      if (lowerText.includes(`${word} hazaar`) || lowerText.includes(`${word} hazar`)) return value * 1000;
      if (lowerText.includes(`${word} lakh`)) return value * 100000;
    }
  }

  // Catch standalone hundreds/thousands without a prefix
  if (lowerText.match(/\bsau\b/)) return 100;
  if (lowerText.match(/\bhazaar\b/) || lowerText.match(/\bhazar\b/)) return 1000;

  return null;
}

/**
 * 2. Udhaar Handler Function
 * Processes the message, saves to Supabase, and calculates total pending balance
 */
async function handleUdhaar(userPhone, messageText) {
  // Extract amount
  const amount = extractAmount(messageText);

  // Extract name (Takes everything before the number/keywords)
  const amountMatch = messageText.match(/\b\d[\d,]*\.?\d*\s*[kK]?\b/);
  let rawName = amountMatch ? messageText.substring(0, amountMatch.index) : messageText;
  const customerName = rawName.replace(/\b(ka|ko|ne|liye|udhaar|udhar|maal|saman|samaan|rupaye)\b.*$/i, '').trim() || 'Grahak';

  // Validation
  if (!amount || amount <= 0) {
    return "❌ Ji, kripya sahi amount likhein. Jaise: 'Sharma ji 500 udhaar'";
  }

  try {
    // Save to udhaar_ledger
    const { error: insertError } = await supabase
      .from('udhaar_ledger')
      .insert([
        {
          owner_phone: userPhone,
          customer_name: customerName,
          amount: amount,
          type: 'credit', // 'credit' signifies giving udhaar
          created_at: new Date().toISOString()
        }
      ]);

    if (insertError) throw insertError;

    // Fetch total udhaar for this customer to calculate running balance
    const { data: records, error: fetchError } = await supabase
      .from('udhaar_ledger')
      .select('amount, type')
      .eq('owner_phone', userPhone)
      .ilike('customer_name', customerName);

    if (fetchError) throw fetchError;

    let totalUdhaar = 0;
    for (const record of records) {
      if (record.type === 'credit' || record.type === 'udhaar') {
        totalUdhaar += Number(record.amount);
      } else if (record.type === 'debit' || record.type === 'wapas') {
        totalUdhaar -= Number(record.amount);
      }
    }

    // Return the beautifully formatted confirmation message
    return formatUdhaarEntry(customerName, amount, totalUdhaar);

  } catch (err) {
    console.error("Database error in handleUdhaar:", err.message);
    return "Maaf kijiye, kuch gadbad hui. Kripya dobara try karein. 🙏";
  }
}

/**
 * 3. Corrected Formatting Function
 * Returns the final WhatsApp-friendly string
 */
function formatUdhaarEntry(customerName, newAmount, totalAmount) {
  // Utility to format numbers with commas (Indian style: 1,500)
  const formatAmt = (amt) => Number(amt || 0).toLocaleString("en-IN");
  
  // Cleanly capitalize the customer's name
  const cleanName = String(customerName)
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  return `Done, ji! ✅\n\n👤 **Grahak:** ${cleanName}\n💸 **Naya Udhaar:** ₹**${formatAmt(newAmount)}**\n📌 **Aapka Total Udhaar:** ₹**${formatAmt(totalAmount)}**\n\nKripya hisaab dhyan rakhein! Aapka din accha rahe! 🙏`;
}

module.exports = {
  extractAmount,
  handleUdhaar,
  formatUdhaarEntry
};
