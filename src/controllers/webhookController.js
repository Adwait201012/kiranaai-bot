const {
  detectIntent,
  detectLanguage,
} = require("../services/aiExtractionService");
const {
  logUdhaar,
  logWapas,
  getCustomerUdhaarTotal,
  getTodayHisaab,
  saveCustomerPhone,
  getCustomerPhone,
  getAllPendingUdhaar,
  addInventoryStock,
  getInventoryStock,
  getAllInventoryStock,
  getLowStockAlertInfo,
} = require("../services/udhaarService");
const { sendTextMessage } = require("../services/whatsappService");
const {
  isAudioMedia,
  transcribeTwilioAudio,
} = require("../services/audioTranscriptionService");

const verifyWebhook = (req, res) => {
  res.status(200).send("Twilio webhook is active");
};

function formatAmount(value) {
  const numberValue = Number(value || 0);
  return Number.isInteger(numberValue)
    ? String(numberValue)
    : numberValue.toFixed(2);
}

function normalizeCustomerPhone(phone) {
  const raw = String(phone || "").trim();
  if (raw.startsWith("+")) {
    return raw;
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return `+${digits}`;
}

// Hardcoded reply templates based on language
const TEMPLATES = {
  hinglish: {
    GREETING: "👋 Namaste! Main VyaparAI hun!\n\n💰 Udhaar log — Sharma ji 500 udhaar\n🔍 Check — Sharma ji kitna udhaar\n✅ Payment — Sharma ji 200 wapas\n📊 Hisaab — aaj ka hisaab\n👥 Sabka — sabka udhaar dikhao\n📦 Stock — chawal 50kg aaya\n📉 Stock check — chawal kitna hai\n📋 Sabka stock — sabka stock dikhao\n📱 Number — Sharma ji number 9876543210\n🔔 Reminder — Sharma ji ko remind karo",
    LOG_UDHAAR: "✅ Done!\n👤 {name}\n💸 Udhaar: ₹{amount}\n📌 Total: ₹{total}",
    CHECK_UDHAAR: "👤 {name}\n💰 Baaki: ₹{total}",
    LOG_WAPAS: "✅ Payment!\n👤 {name}\n💵 Wapas: ₹{amount}\n📌 Baaki: ₹{remaining}",
    TODAY_HISAAB: "📊 Aaj ka hisaab\n💸 Udhaar: ₹{newUdhaar}\n✅ Wapas: ₹{wapasReceived}\n📌 Net: ₹{net}",
    SABKA_UDHAAR: "👥 Sabka udhaar:\n{list}\n💰 Total: ₹{total}",
    INVENTORY_ADD: "📦 Stock updated!\n🏷️ {item}\n➕ Added: {qty}{unit}\n📊 Total: {total}{unit}",
    CHECK_STOCK: "📦 {item}\n📊 Stock: {qty}{unit}",
    ALL_STOCK: "📋 Sabka stock:\n{list}",
    LOW_STOCK: "⚠️ Low stock!\n🏷️ {item}: sirf {qty}{unit} bacha!",
    SAVE_NUMBER: "✅ {name} ka number save!",
    SEND_REMINDER: "✅ {name} ko reminder bhej diya!\n💰 Udhaar: ₹{total}",
    UNKNOWN: "🤔 Samajh nahi aaya. Hi bhejo to main sab features dikhaunga!",
    ERRORS: {
      DATABASE: "Sorry, database error. Try again!",
      NAME_REQUIRED: "Customer name required!",
      AMOUNT_REQUIRED: "Amount required!",
      ITEM_REQUIRED: "Item name required!",
      QUANTITY_REQUIRED: "Quantity required!",
      PHONE_REQUIRED: "Phone number required!",
    }
  },
  english: {
    GREETING: "👋 Hello! I am VyaparAI!\n\n💰 Log credit — Sharma ji 500 udhaar\n🔍 Check credit — Sharma ji kitna udhaar\n✅ Payment received — Sharma ji 200 wapas\n📊 Today summary — aaj ka hisaab\n👥 All credit — sabka udhaar dikhao\n📦 Add stock — chawal 50kg aaya\n📉 Check stock — chawal kitna hai\n📋 All stock — sabka stock dikhao\n📱 Save number — Sharma ji number 9876543210\n🔔 Reminder — Sharma ji ko remind karo",
    LOG_UDHAAR: "✅ Done!\n👤 {name}\n💸 Credit: ₹{amount}\n📌 Total: ₹{total}",
    CHECK_UDHAAR: "👤 {name}\n💰 Pending: ₹{total}",
    LOG_WAPAS: "✅ Payment received!\n👤 {name}\n💵 Paid: ₹{amount}\n📌 Remaining: ₹{remaining}",
    TODAY_HISAAB: "📊 Today's summary\n💸 Credit: ₹{newUdhaar}\n✅ Received: ₹{wapasReceived}\n📌 Net: ₹{net}",
    SABKA_UDHAAR: "👥 All credit:\n{list}\n💰 Total: ₹{total}",
    INVENTORY_ADD: "📦 Stock updated!\n🏷️ {item}\n➕ Added: {qty}{unit}\n📊 Total: {total}{unit}",
    CHECK_STOCK: "📦 {item}\n📊 Stock: {qty}{unit}",
    ALL_STOCK: "📋 All stock:\n{list}",
    LOW_STOCK: "⚠️ Low stock!\n🏷️ {item}: only {qty}{unit} left!",
    SAVE_NUMBER: "✅ {name} number saved!",
    SEND_REMINDER: "✅ Reminder sent to {name}!\n💰 Credit: ₹{total}",
    UNKNOWN: "🤔 Could not understand. Send 'hi' to see all features!",
    ERRORS: {
      DATABASE: "Sorry, database error. Try again!",
      NAME_REQUIRED: "Customer name required!",
      AMOUNT_REQUIRED: "Amount required!",
      ITEM_REQUIRED: "Item name required!",
      QUANTITY_REQUIRED: "Quantity required!",
      PHONE_REQUIRED: "Phone number required!",
    }
  },
  hindi: {
    GREETING: "👋 नमस्ते! मैं VyaparAI हूं!\n\n💰 उधार लॉग — शर्मा जी 500 उधार\n🔍 उधार चेक — शर्मा जी कितना उधार\n✅ पेमेंट लिया — शर्मा जी 200 वापस\n📊 आज का हिसाब — आज का हिसाब\n👥 सबका उधार — सबका उधार दिखाओ\n📦 स्टॉक जोड़ें — चावल 50kg आया\n📉 स्टॉक चेक — चावल कितना है\n📋 सबका स्टॉक — सबका स्टॉक दिखाओ\n📱 नंबर सेव — शर्मा जी number 9876543210\n🔔 रिमाइंडर — शर्मा जी को remind करो",
    LOG_UDHAAR: "✅ हो गया!\n👤 {name}\n💸 उधार: ₹{amount}\n📌 कुल: ₹{total}",
    CHECK_UDHAAR: "👤 {name}\n💰 बाकी: ₹{total}",
    LOG_WAPAS: "✅ पेमेंट प्राप्त!\n👤 {name}\n💵 वापस: ₹{amount}\n📌 बाकी: ₹{remaining}",
    TODAY_HISAAB: "📊 आज का हिसाब\n💸 उधार: ₹{newUdhaar}\n✅ वापस मिला: ₹{wapasReceived}\n📌 नेट: ₹{net}",
    SABKA_UDHAAR: "👥 सबका उधार:\n{list}\n💰 कुल: ₹{total}",
    INVENTORY_ADD: "📦 स्टॉक अपडेटेड!\n🏷️ {item}\n➕ जोड़ा: {qty}{unit}\n📊 कुल: {total}{unit}",
    CHECK_STOCK: "📦 {item}\n📊 स्टॉक: {qty}{unit}",
    ALL_STOCK: "📋 सबका स्टॉक:\n{list}",
    LOW_STOCK: "⚠️ कम स्टॉक!\n🏷️ {item}: सिर्फ {qty}{unit} बचा है!",
    SAVE_NUMBER: "✅ {name} का नंबर सेव!",
    SEND_REMINDER: "✅ {name} को रिमाइंडर भेज दिया!\n💰 उधार: ₹{total}",
    UNKNOWN: "🤔 समझ नहीं आया। हाय भेजें तो मैं सभी फीचर्स दिखाऊंगा!",
    ERRORS: {
      DATABASE: "क्षमा करें, डेटाबेस त्रुटि। फिर से कोशिश करें!",
      NAME_REQUIRED: "ग्राहक नाम आवश्यक!",
      AMOUNT_REQUIRED: "राशि आवश्यक!",
      ITEM_REQUIRED: "आइटम नाम आवश्यक!",
      QUANTITY_REQUIRED: "मात्रा आवश्यक!",
      PHONE_REQUIRED: "फोन नंबर आवश्यक!",
    }
  }
};

function getTemplate(language, key, params = {}) {
  const lang = TEMPLATES[language] || TEMPLATES.hinglish;
  let template = lang[key] || lang.UNKNOWN;
  
  // Replace parameters in template
  for (const [key, value] of Object.entries(params)) {
    template = template.replace(new RegExp(`{${key}}`, 'g'), value);
  }
  
  return template;
}

function getErrorTemplate(language, errorKey) {
  const lang = TEMPLATES[language] || TEMPLATES.hinglish;
  return lang.ERRORS[errorKey] || lang.ERRORS.DATABASE;
}

async function receiveWebhook(req, res) {
  // Twilio expects quick 200 response to acknowledge webhook.
  res.status(200).send("ok");

  try {
    const ownerWaId = req.body?.From;
    const incomingText = String(req.body?.Body || "").trim();
    const mediaContentType = req.body?.MediaContentType0;
    const mediaUrl = req.body?.MediaUrl0;

    let text = incomingText;

    // Handle audio messages
    if (isAudioMedia(mediaContentType) && mediaUrl) {
      try {
        const transcribedText = await transcribeTwilioAudio({
          mediaUrl,
          mediaContentType,
        });
        text = transcribedText;
      } catch (error) {
        console.error('Audio transcription failed:', error.message);
        await sendTextMessage({
          to: ownerWaId,
          text: getErrorTemplate('hinglish', 'DATABASE')
        });
        return;
      }
    }

    if (!ownerWaId || !text) {
      return;
    }

    // Get intent from Groq first
    let aiResult;
    try {
      aiResult = await detectIntent(text);
    } catch (error) {
      console.error('Groq detection failed:', error.message);
      await sendTextMessage({
        to: ownerWaId,
        text: getErrorTemplate('hinglish', 'DATABASE')
      });
      return;
    }

    const {
      intent = "UNKNOWN",
      customerName,
      amount,
      itemName,
      quantity,
      unit,
      phoneNumber,
      language = "hinglish"
    } = aiResult;

    // Handle different intents
    try {
      switch (intent) {
        case "GREETING":
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "GREETING")
          });
          break;

        case "LOG_UDHAAR":
          if (!customerName || !amount || amount <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }
          await logUdhaar({ customerName, amount });
          const total = await getCustomerUdhaarTotal({ customerName });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "LOG_UDHAAR", {
              name: customerName,
              amount: formatAmount(amount),
              total: formatAmount(total)
            })
          });
          break;

        case "CHECK_UDHAAR":
          if (!customerName) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }
          const remainingTotal = await getCustomerUdhaarTotal({ customerName });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "CHECK_UDHAAR", {
              name: customerName,
              total: formatAmount(remainingTotal)
            })
          });
          break;

        case "LOG_WAPAS":
          if (!customerName || !amount || amount <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }
          await logWapas({ customerName, amount });
          const remaining = await getCustomerUdhaarTotal({ customerName });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "LOG_WAPAS", {
              name: customerName,
              amount: formatAmount(amount),
              remaining: formatAmount(remaining)
            })
          });
          break;

        case "TODAY_HISAAB":
          const today = await getTodayHisaab();
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "TODAY_HISAAB", {
              newUdhaar: formatAmount(today.newUdhaar),
              wapasReceived: formatAmount(today.wapasReceived),
              net: formatAmount(today.netUdhaar)
            })
          });
          break;

        case "SABKA_UDHAAR":
          const result = await getAllPendingUdhaar();
          if (!result.customers.length) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "SABKA_UDHAAR", {
                list: "No pending udhaar ✅",
                total: "0"
              })
            });
          } else {
            const list = result.customers
              .map(item => `${item.customerName}: ₹${formatAmount(item.total)}`)
              .join("\n");
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "SABKA_UDHAAR", {
                list,
                total: formatAmount(result.grandTotal)
              })
            });
          }
          break;

        case "INVENTORY_ADD":
          if (!itemName || !quantity || quantity <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'ITEM_REQUIRED')
            });
            return;
          }
          const row = await addInventoryStock({ itemName, quantity, unit });
          const unitText = row.unit ? ` ${row.unit}` : "";
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "INVENTORY_ADD", {
              item: row.item_name || itemName,
              qty: formatAmount(quantity),
              unit: unitText,
              total: formatAmount(row.quantity)
            })
          });
          
          // Check for low stock alert
          const lowStock = getLowStockAlertInfo(row);
          if (lowStock.isLow) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "LOW_STOCK", {
                item: lowStock.itemName,
                qty: formatAmount(lowStock.quantity),
                unit: lowStock.unit ? ` ${lowStock.unit}` : ""
              })
            });
          }
          break;

        case "CHECK_STOCK":
          if (!itemName) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'ITEM_REQUIRED')
            });
            return;
          }
          const stock = await getInventoryStock({ itemName });
          if (!stock) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "CHECK_STOCK", {
                item: itemName,
                qty: "0",
                unit: ""
              })
            });
          } else {
            const stockUnitText = stock.unit ? ` ${stock.unit}` : "";
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "CHECK_STOCK", {
                item: stock.item_name || itemName,
                qty: formatAmount(stock.quantity),
                unit: stockUnitText
              })
            });
          }
          break;

        case "ALL_STOCK":
          const allStock = await getAllInventoryStock();
          if (!allStock.length) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "ALL_STOCK", {
                list: "Stock is empty 📭"
              })
            });
          } else {
            const stockList = allStock
              .map(row => {
                const qty = formatAmount(row.quantity);
                const unit = row.unit ? ` ${row.unit}` : "";
                return `${row.item_name}: ${qty}${unit}`;
              })
              .join("\n");
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "ALL_STOCK", {
                list: stockList
              })
            });
          }
          break;

        case "SAVE_NUMBER":
          if (!customerName || !phoneNumber) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'PHONE_REQUIRED')
            });
            return;
          }
          await saveCustomerPhone({
            customerName,
            phone: normalizeCustomerPhone(phoneNumber)
          });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "SAVE_NUMBER", {
              name: customerName
            })
          });
          break;

        case "SEND_REMINDER":
          if (!customerName) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }
          const customerPhone = await getCustomerPhone({ customerName });
          if (!customerPhone) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'PHONE_REQUIRED')
            });
            return;
          }
          const reminderTotal = await getCustomerUdhaarTotal({ customerName });
          const reminderText = getTemplate(language, "REMINDER_CUSTOMER", {
            customerName,
            amount: formatAmount(reminderTotal)
          });
          await sendTextMessage({ to: customerPhone, text: reminderText });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "SEND_REMINDER", {
              name: customerName,
              total: formatAmount(reminderTotal)
            })
          });
          break;

        default:
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "UNKNOWN")
          });
      }
    } catch (error) {
      console.error('Service operation failed:', error.message);
      await sendTextMessage({
        to: ownerWaId,
        text: getErrorTemplate(language, 'DATABASE')
      });
    }
  } catch (error) {
    console.error('Webhook processing error:', error.message);
    // Always send some reply, never crash
    const ownerWaId = req.body?.From;
    if (ownerWaId) {
      await sendTextMessage({
        to: ownerWaId,
        text: getErrorTemplate('hinglish', 'DATABASE')
      });
    }
  }
}

module.exports = { verifyWebhook, receiveWebhook };
