/**
 * formatMessages.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Formats WhatsApp messages for BharatBahi with a friendly Hinglish persona,
 * consistent emojis, bold formatting, lists, line breaks, and clear scannability.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

/**
 * Format currency to clean Indian style (e.g., 1,500)
 */
function formatAmount(amount) {
  if (amount === undefined || amount === null) return "0";
  const num = Number(amount);
  if (isNaN(num)) return "0";
  return num.toLocaleString("en-IN");
}

/**
 * Clean and capitalize customer names (e.g., "sharma ji" -> "Sharma Ji")
 */
function capitalizeName(name) {
  if (!name) return "";
  return String(name)
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * 1. Udhaar & Payment Confirmation Formatting
 * Returns a warm, bold, emoji-rich Hinglish receipt.
 * 
 * @param {string} customerName 
 * @param {number|string} amount 
 * @param {"credit"|"debit"|"udhaar"|"wapas"} type - credit/udhaar for giving, debit/wapas for payment
 * @param {number|string} total - Current balance
 */
function formatUdhaarEntry(customerName, amount, type, total = 0) {
  const name = capitalizeName(customerName);
  const amtStr = formatAmount(amount);
  const totStr = formatAmount(total);
  const isUdhaar = type === "credit" || type === "udhaar";

  if (isUdhaar) {
    return `Done, ji! ✅

👤 Grahak: ${name}
💸 Naya Udhaar: ₹${amtStr}
📍 Aapka Total Udhaar: ₹${totStr}

Hisaab note ho gaya! 🗒️`;
  } else {
    // Payment received / Wapas
    const suffix = Number(total) <= 0 
      ? `\n🎉 Hisaab Saaf Ho Gaya Hai! ✅` 
      : `\n📍 Aapka Total Udhaar: ₹${totStr}`;

    return `Done, ji! ✅

👤 Grahak: ${name}
💸 Jama: ₹${amtStr}${suffix}

Hisaab note ho gaya! 🗒️`;
  }
}

/**
 * 2. Inventory Low Stock Alert Formatting
 * 
 * @param {string} itemName 
 * @param {number|string} currentStock 
 * @param {string} unit 
 */
function formatLowStockAlert(itemName, currentStock, unit = "") {
  const item = capitalizeName(itemName);
  const qtyStr = formatAmount(currentStock);
  const unitStr = unit ? ` ${unit.trim()}` : "";

  return `⚠️ STOCK CRITICAL ⚠️

📦 Item: ${item}
📉 Bacha Stock: sirf ${qtyStr}${unitStr}!

Kripya jaldi se naya stock manga lijiye taaki grahak khali hath na jayein. 🙏`;
}

/**
 * 3. Daily Sales / Today's Summary Report Formatting
 *
 * @param {object} data - { newUdhaar, wapasReceived, netPending }
 */
function formatSalesReport(data) {
  const newUdhaar = formatAmount(data.newUdhaar || 0);
  const wapasReceived = formatAmount(data.wapasReceived || 0);
  const netPending = formatAmount(data.netPending || 0);

  return `📊 Aaj Ki Summary Report 📊

• 💸 Naya Udhaar Diya: ₹${newUdhaar}
• ✅ Payment Wapas Mila: ₹${wapasReceived}
• 📌 Net Pending Aaj Ka: ₹${netPending}

Aapka karobaar aise hi badhta rahe! 🏪✏️`;
}

function formatEmptyTodaySummary() {
  return `📊 Aaj ka koi hisaab nahi mila.

Koi entry add karni ho toh batayein!`;
}

/**
 * 4. Contact Saved Confirmation Formatting
 * 
 * @param {string} name 
 * @param {string} phone 
 */
function formatContactSaved(name, phone) {
  const cleanName = capitalizeName(name);
  // Ensure bold phone number
  const boldPhone = `${phone}`;

  return `Done, ji! ✅

👤 ${cleanName} ka number humne surakshit save kar liya hai!
📞 Contact Phone: ${boldPhone}

Ab aap inko aasaani se payment reminders bhej sakte hain. 😊`;
}

/**
 * 5. Apologetic Error Message Formatting
 * 
 * @param {string} errorMessage 
 */
function formatError(errorMessage) {
  let instruction = "Kripya ek baar check karke dobara koshish karein.";

  if (errorMessage.includes("name") || errorMessage.includes("naam")) {
    instruction = "Kripya grahak ka naam sahi se likhein. Example: 'Sharma ji 500 udhaar'";
  } else if (errorMessage.includes("amount") || errorMessage.includes("paise")) {
    instruction = "Kripya amount/paise sahi se likhein. Example: 'Sharma ji 500'";
  } else if (errorMessage.includes("phone") || errorMessage.includes("number")) {
    instruction = "Kripya 10-digit phone number likhein jo 6, 7, 8, ya 9 se shuru ho.";
  }

  return `Maaf kijiye, grahak ji! ❌

kuch gadbad hui hai: ${errorMessage}

👉 ${instruction}

Humse sampark karne ke liye dhanyawad! Kripya dobara try karein. 🙏`;
}

module.exports = {
  formatUdhaarEntry,
  formatLowStockAlert,
  formatSalesReport,
  formatEmptyTodaySummary,
  formatContactSaved,
  formatError,
  formatAmount,
  capitalizeName
};
