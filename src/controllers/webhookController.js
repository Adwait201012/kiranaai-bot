const {
  detectIntent,
  detectLanguageFromText,
  normalizeInventoryItemName,
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

function normalizeLanguage(language) {
  const lang = String(language || "").toLowerCase().trim();
  if (lang === "hindi" || lang === "hinglish" || lang === "english") {
    return lang;
  }
  return "hinglish";
}

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

function buildText(language, key, params = {}) {
  const lang = normalizeLanguage(language);
  const p = params;

  const templates = {
    hindi: {
      GREETING_INTRO:
        "👋 नमस्ते! मैं VyaparAI हूं!\n" +
        "आप क्या करना चाहते हैं?\n" +
        "💰 उधार लॉग — शर्मा जी 500 उधार\n" +
        "🔍 उधार चेक — शर्मा जी कितना उधार\n" +
        "✅ पेमेंट लिया — शर्मा जी 200 वापस\n" +
        "📊 आज का हिसाब — आज का हिसाब\n" +
        "👥 सबका उधार — सबका उधार दिखाओ\n" +
        "📦 स्टॉक जोड़ें — चावल 50kg आया\n" +
        "📉 स्टॉक चेक — चावल कितना है\n" +
        "📋 सबका स्टॉक — सबका स्टॉक दिखाओ\n" +
        "📱 नंबर सेव — शर्मा जी number 9876543210\n" +
        "🔔 रिमाइंडर — शर्मा जी को remind करो",
      TODAY_HISAAB: `📊 आज का हिसाब\n💸 नया उधार: ₹${p.newUdhaar}\n✅ वापस मिला: ₹${p.wapasReceived}\n📌 नेट उधार: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "👥 सबका उधार\nकोई पेंडिंग उधार नहीं ✅\n💰 Total: ₹0",
      ALL_UDHAAR: `👥 सबका उधार\n${p.lines}\n💰 Total: ₹${p.total}`,
      INVENTORY_ADD_ERROR: "इन्वेंटरी जोड़ने के लिए वस्तु या मात्रा स्पष्ट नहीं है।",
      INVENTORY_ADD_OK: `📦 स्टॉक अपडेटेड!\n🏷️ ${p.itemName}\n➕ Added: ${p.quantity}${p.unitText}\n📊 Total: ${p.totalQuantity}${p.unitText}`,
      INVENTORY_ADD_MULTI: `📦 स्टॉक अपडेटेड!\n${p.lines}`,
      INVENTORY_ADD_MULTI_ITEM: `🏷️ ${p.itemName}\n➕ Added: ${p.quantity}${p.unitText}\n📊 Total: ${p.totalQuantity}${p.unitText}`,
      LOW_STOCK_ALERT: `⚠️ चेतावनी: ${p.itemName} कम है! सिर्फ ${p.quantity}${p.unitText} बचा है।`,
      STOCK_CHECK_ERROR: "किस वस्तु का स्टॉक देखना है, यह समझ नहीं आया।",
      STOCK_NOT_FOUND: `${p.itemName} स्टॉक में नहीं मिला।`,
      STOCK_CHECK_OK: `📉 स्टॉक चेक\n🏷️ ${p.itemName}\n📊 उपलब्ध: ${p.quantity}${p.unitText}`,
      ALL_STOCK_EMPTY: "स्टॉक खाली है 📭",
      ALL_STOCK: `📋 सबका स्टॉक\n${p.lines}`,
      SAVE_NUMBER_ERROR: "ग्राहक का नाम या फोन नंबर समझ नहीं आया।",
      SAVE_NUMBER_OK: `${p.customerName} का नंबर सेव ✅`,
      REMINDER_NAME_ERROR: "किस ग्राहक को याद दिलाना है, यह समझ नहीं आया।",
      REMINDER_NO_PHONE: `${p.customerName} का नंबर नहीं मिला। पहले "${p.customerName} number 9876543210" भेजें।`,
      REMINDER_CUSTOMER: `नमस्ते ${p.customerName} जी, ₹${p.amount} उधार बाकी है। कृपया भुगतान करें।`,
      REMINDER_OWNER_OK: `रिमाइंडर भेज दिया ✅`,
      CHECK_NAME_ERROR: "कस्टमर का नाम समझ नहीं आया।",
      CHECK_OK: `👤 ${p.customerName}\n💰 बाकी उधार: ₹${p.amount}`,
      WAPAS_ERROR: "वापस एंट्री के लिए नाम या अमाउंट क्लियर नहीं है।",
      WAPAS_OK: `✅ पेमेंट प्राप्त!\n👤 ${p.customerName}\n💵 वापस: ₹${p.amount}\n📌 बाकी: ₹${p.remaining}`,
      UDHAAR_ERROR: "उधार एंट्री के लिए नाम या अमाउंट क्लियर नहीं है।",
      UDHAAR_OK: `✅ हो गया!\n👤 ${p.customerName}\n💸 उधार: ₹${p.amount}\n📌 Total: ₹${p.total}`,
      UNKNOWN: "मैसेज समझ नहीं आया। कृपया फिर से लिखें।",
    },
    hinglish: {
      GREETING_INTRO:
        "👋 Namaste! Main VyaparAI hun!\n" +
        "Aap kya karna chahte ho?\n" +
        "💰 Udhaar log — Sharma ji 500 udhaar\n" +
        "🔍 Udhaar check — Sharma ji kitna udhaar\n" +
        "✅ Payment liya — Sharma ji 200 wapas\n" +
        "📊 Aaj ka hisaab — aaj ka hisaab\n" +
        "👥 Sabka udhaar — sabka udhaar dikhao\n" +
        "📦 Stock add — chawal 50kg aaya\n" +
        "📉 Stock check — chawal kitna hai\n" +
        "📋 Sabka stock — sabka stock dikhao\n" +
        "📱 Number save — Sharma ji number 9876543210\n" +
        "🔔 Reminder — Sharma ji ko remind karo",
      TODAY_HISAAB: `📊 Aaj ka hisaab\n💸 Naya udhaar: ₹${p.newUdhaar}\n✅ Wapas mila: ₹${p.wapasReceived}\n📌 Net udhaar: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "👥 Sabka udhaar\nKoi pending udhaar nahi ✅\n💰 Total: ₹0",
      ALL_UDHAAR: `👥 Sabka udhaar\n${p.lines}\n💰 Total: ₹${p.total}`,
      INVENTORY_ADD_ERROR: "Stock entry ke liye item ya quantity clear nahi hai.",
      INVENTORY_ADD_OK: `📦 Stock updated!\n🏷️ ${p.itemName}\n➕ Added: ${p.quantity}${p.unitText}\n📊 Total: ${p.totalQuantity}${p.unitText}`,
      INVENTORY_ADD_MULTI: `📦 Stock updated!\n${p.lines}`,
      INVENTORY_ADD_MULTI_ITEM: `🏷️ ${p.itemName}\n➕ Added: ${p.quantity}${p.unitText}\n📊 Total: ${p.totalQuantity}${p.unitText}`,
      LOW_STOCK_ALERT: `⚠️ Low Stock Alert!\n🏷️ ${p.itemName}: only ${p.quantity}${p.unitText} left!`,
      STOCK_CHECK_ERROR: "Kaunsa item ka stock check karna hai, samajh nahi aaya.",
      STOCK_NOT_FOUND: `${p.itemName} stock mein nahi mila.`,
      STOCK_CHECK_OK: `📉 Stock check\n🏷️ ${p.itemName}\n📊 Available: ${p.quantity}${p.unitText}`,
      ALL_STOCK_EMPTY: "Stock khaali hai 📭",
      ALL_STOCK: `📋 Sabka stock\n${p.lines}`,
      SAVE_NUMBER_ERROR: "Customer name ya phone number samajh nahi aaya.",
      SAVE_NUMBER_OK: `${p.customerName} ka number save ✅`,
      REMINDER_NAME_ERROR: "Kis customer ko reminder bhejna hai, samajh nahi aaya.",
      REMINDER_NO_PHONE: `${p.customerName} ka number nahi mila. Pehle "${p.customerName} number 9876543210" bhejein.`,
      REMINDER_CUSTOMER: `Namaste ${p.customerName} ji, ₹${p.amount} udhaar pending hai. Please payment kar dein.`,
      REMINDER_OWNER_OK: `Reminder bhej diya ✅`,
      CHECK_NAME_ERROR: "Customer ka naam samajh nahi aaya.",
      CHECK_OK: `👤 ${p.customerName}\n💰 Baaki udhaar: ₹${p.amount}`,
      WAPAS_ERROR: "Wapas entry ke liye naam ya amount clear nahi hai.",
      WAPAS_OK: `✅ Payment received!\n👤 ${p.customerName}\n💵 Wapas: ₹${p.amount}\n📌 Baaki: ₹${p.remaining}`,
      UDHAAR_ERROR: "Udhaar entry ke liye naam ya amount clear nahi hai.",
      UDHAAR_OK: `✅ Done!\n👤 ${p.customerName}\n💸 Udhaar: ₹${p.amount}\n📌 Total: ₹${p.total}`,
      UNKNOWN: "Message samajh nahi aaya. Please dobara bhejein.",
    },
    english: {
      GREETING_INTRO:
        "👋 Hello! I am VyaparAI!\n" +
        "What would you like to do?\n" +
        "💰 Log credit — Sharma ji 500 udhaar\n" +
        "🔍 Check credit — Sharma ji kitna udhaar\n" +
        "✅ Payment received — Sharma ji 200 wapas\n" +
        "📊 Today summary — aaj ka hisaab\n" +
        "👥 All credit — sabka udhaar dikhao\n" +
        "📦 Add stock — chawal 50kg aaya\n" +
        "📉 Check stock — chawal kitna hai\n" +
        "📋 All stock — sabka stock dikhao\n" +
        "📱 Save number — Sharma ji number 9876543210\n" +
        "🔔 Reminder — Sharma ji ko remind karo",
      TODAY_HISAAB: `📊 Today's summary\n💸 New credit: ₹${p.newUdhaar}\n✅ Received back: ₹${p.wapasReceived}\n📌 Net credit: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "👥 All credit\nNo pending amount ✅\n💰 Total: ₹0",
      ALL_UDHAAR: `👥 All credit\n${p.lines}\n💰 Total: ₹${p.total}`,
      INVENTORY_ADD_ERROR: "Item or quantity is unclear for stock entry.",
      INVENTORY_ADD_OK: `📦 Stock updated!\n🏷️ ${p.itemName}\n➕ Added: ${p.quantity}${p.unitText}\n📊 Total: ${p.totalQuantity}${p.unitText}`,
      INVENTORY_ADD_MULTI: `📦 Stock updated!\n${p.lines}`,
      INVENTORY_ADD_MULTI_ITEM: `🏷️ ${p.itemName}\n➕ Added: ${p.quantity}${p.unitText}\n📊 Total: ${p.totalQuantity}${p.unitText}`,
      LOW_STOCK_ALERT: `⚠️ Warning: ${p.itemName} stock is low! Only ${p.quantity}${p.unitText} remaining.`,
      STOCK_CHECK_ERROR: "Could not understand which item stock to check.",
      STOCK_NOT_FOUND: `No stock found for ${p.itemName}.`,
      STOCK_CHECK_OK: `📉 Stock check\n🏷️ ${p.itemName}\n📊 Available: ${p.quantity}${p.unitText}`,
      ALL_STOCK_EMPTY: "Stock is empty 📭",
      ALL_STOCK: `📋 All stock\n${p.lines}`,
      SAVE_NUMBER_ERROR: "Could not understand customer name or phone number.",
      SAVE_NUMBER_OK: `${p.customerName} number saved ✅`,
      REMINDER_NAME_ERROR: "Could not understand which customer to remind.",
      REMINDER_NO_PHONE: `No number found for ${p.customerName}. First send "${p.customerName} number 9876543210".`,
      REMINDER_CUSTOMER: `Hello ${p.customerName}, ₹${p.amount} is pending. Please pay soon.`,
      REMINDER_OWNER_OK: `Reminder sent ✅`,
      CHECK_NAME_ERROR: "Could not understand customer name.",
      CHECK_OK: `👤 ${p.customerName}\n💰 Pending credit: ₹${p.amount}`,
      WAPAS_ERROR: "Name or amount is unclear for repayment entry.",
      WAPAS_OK: `✅ Payment received!\n👤 ${p.customerName}\n💵 Paid: ₹${p.amount}\n📌 Remaining: ₹${p.remaining}`,
      UDHAAR_ERROR: "Name or amount is unclear for credit entry.",
      UDHAAR_OK: `✅ Done!\n👤 ${p.customerName}\n💸 Credit: ₹${p.amount}\n📌 Total: ₹${p.total}`,
      UNKNOWN: "Could not understand the message. Please try again.",
    },
  };

  return templates[lang][key] || templates.hinglish.UNKNOWN;
}

async function handleTodayHisaab({ ownerWaId, language }) {
  const today = await getTodayHisaab();
  const replyText = buildText(language, "TODAY_HISAAB", {
    newUdhaar: formatAmount(today.newUdhaar),
    wapasReceived: formatAmount(today.wapasReceived),
    netUdhaar: formatAmount(today.netUdhaar),
  });

  await sendTextMessage({
    to: ownerWaId,
    text: replyText,
  });
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

    if (isAudioMedia(mediaContentType) && mediaUrl) {
      const transcribedText = await transcribeTwilioAudio({
        mediaUrl,
        mediaContentType,
      });
      text = transcribedText;
    }

    if (!ownerWaId || !text) {
      return;
    }

    const aiResult = await detectIntent(text);
    const intent = aiResult.intent || "UNKNOWN";
    const customerName = (aiResult.customerName || "").trim();
    const amount = Number(aiResult.amount);
    const phoneNumber = (aiResult.phoneNumber || "").trim();
    const itemName = (aiResult.itemName || "").trim();
    const quantity = Number(aiResult.quantity);
    const unit = (aiResult.unit || "").trim();
    const inventoryItems = Array.isArray(aiResult.items) ? aiResult.items : [];
    // Enforce template language purely from owner's input text.
    const language = normalizeLanguage(detectLanguageFromText(text));

    if (intent === "GREETING") {
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "GREETING_INTRO"),
      });
      return;
    }

    if (intent === "TODAY_HISAAB") {
      await handleTodayHisaab({ ownerWaId, language });
      return;
    }

    if (intent === "SABKA_UDHAAR") {
      const result = await getAllPendingUdhaar();

      if (!result.customers.length) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "NO_PENDING_ALL"),
        });
        return;
      }

      const lines = result.customers.map(
        (item) => `${item.customerName}: ₹${formatAmount(item.total)}`,
      );
      const replyText =
        buildText(language, "ALL_UDHAAR", {
          lines: lines.join("\n"),
          total: formatAmount(result.grandTotal),
        });

      await sendTextMessage({ to: ownerWaId, text: replyText });
      return;
    }

    if (intent === "INVENTORY_ADD") {
      const validItems = inventoryItems
        .map((entry) => ({
          itemName: String(entry?.itemName || "").trim(),
          quantity: Number(entry?.quantity),
          unit: String(entry?.unit || "").trim(),
        }))
        .filter((entry) => entry.itemName && Number.isFinite(entry.quantity) && entry.quantity > 0);
      const hasMultiItems = validItems.length > 1;

      if (!hasMultiItems && (!itemName || !Number.isFinite(quantity) || quantity <= 0)) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "INVENTORY_ADD_ERROR"),
        });
        return;
      }

      if (hasMultiItems) {
        const lines = [];
        for (const entry of validItems) {
          const normalizedItemName = await normalizeInventoryItemName(entry.itemName);
          const row = await addInventoryStock({
            itemName: normalizedItemName || entry.itemName,
            quantity: entry.quantity,
            unit: entry.unit,
          });
          const quantityText = formatAmount(entry.quantity);
          const totalText = formatAmount(row.quantity);
          const unitText = row.unit ? ` ${row.unit}` : "";
          lines.push(
            buildText(language, "INVENTORY_ADD_MULTI_ITEM", {
              itemName: row.item_name || entry.itemName,
              quantity: quantityText,
              totalQuantity: totalText,
              unitText,
            }),
          );
          const low = getLowStockAlertInfo(row);
          if (low.isLow) {
            await sendTextMessage({
              to: ownerWaId,
              text: buildText(language, "LOW_STOCK_ALERT", {
                itemName: low.itemName || (row.item_name || entry.itemName),
                quantity: formatAmount(low.quantity),
                unitText: low.unit ? ` ${low.unit}` : "",
              }),
            });
          }
        }
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "INVENTORY_ADD_MULTI", { lines: lines.join("\n") }),
        });
        return;
      }

      const normalizedItemName = await normalizeInventoryItemName(itemName);
      const row = await addInventoryStock({
        itemName: normalizedItemName || itemName,
        quantity,
        unit,
      });
      const quantityText = formatAmount(quantity);
      const totalText = formatAmount(row.quantity);
      const unitText = row.unit ? ` ${row.unit}` : "";
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "INVENTORY_ADD_OK", {
          itemName: row.item_name || itemName,
          quantity: quantityText,
          totalQuantity: totalText,
          unitText,
        }),
      });
      const low = getLowStockAlertInfo(row);
      if (low.isLow) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "LOW_STOCK_ALERT", {
            itemName: low.itemName || (row.item_name || itemName),
            quantity: formatAmount(low.quantity),
            unitText: low.unit ? ` ${low.unit}` : "",
          }),
        });
      }
      return;
    }

    if (intent === "CHECK_STOCK") {
      if (!itemName) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "STOCK_CHECK_ERROR"),
        });
        return;
      }

      const normalizedItemName = await normalizeInventoryItemName(itemName);
      const stock = await getInventoryStock({ itemName: normalizedItemName || itemName });
      if (!stock) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "STOCK_NOT_FOUND", { itemName }),
        });
        return;
      }

      const quantityText = formatAmount(stock.quantity);
      const unitText = stock.unit ? ` ${stock.unit}` : "";
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "STOCK_CHECK_OK", {
          itemName: stock.item_name || itemName,
          quantity: quantityText,
          unitText,
        }),
      });
      return;
    }

    if (intent === "ALL_STOCK") {
      const rows = await getAllInventoryStock();
      if (!rows.length) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "ALL_STOCK_EMPTY"),
        });
        return;
      }

      const lines = rows.map((row) => {
        const quantityText = formatAmount(row.quantity);
        const unitText = row.unit ? ` ${row.unit}` : "";
        return `${row.item_name}: ${quantityText}${unitText}`;
      });

      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "ALL_STOCK", { lines: lines.join("\n") }),
      });
      return;
    }

    if (intent === "SAVE_NUMBER") {
      if (!customerName || !phoneNumber) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "SAVE_NUMBER_ERROR"),
        });
        return;
      }

      await saveCustomerPhone({
        customerName,
        phone: normalizeCustomerPhone(phoneNumber),
      });
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "SAVE_NUMBER_OK", { customerName }),
      });
      return;
    }

    if (intent === "SEND_REMINDER") {
      if (!customerName) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "REMINDER_NAME_ERROR"),
        });
        return;
      }

      const customerPhone = await getCustomerPhone({ customerName });
      if (!customerPhone) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "REMINDER_NO_PHONE", { customerName }),
        });
        return;
      }

      const total = await getCustomerUdhaarTotal({ customerName });
      const reminderText = buildText(language, "REMINDER_CUSTOMER", {
        customerName,
        amount: formatAmount(total),
      });

      await sendTextMessage({ to: customerPhone, text: reminderText });
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "REMINDER_OWNER_OK", { customerName }),
      });
      return;
    }

    if (intent === "CHECK_UDHAAR") {
      if (!customerName) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "CHECK_NAME_ERROR"),
        });
        return;
      }

      const total = await getCustomerUdhaarTotal({ customerName });
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "CHECK_OK", {
          customerName,
          amount: formatAmount(total),
        }),
      });
      return;
    }

    if (intent === "LOG_WAPAS") {
      if (!customerName || !Number.isFinite(amount) || amount <= 0) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "WAPAS_ERROR"),
        });
        return;
      }

      await logWapas({ customerName, amount });
      const remainingTotal = await getCustomerUdhaarTotal({ customerName });
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "WAPAS_OK", {
          customerName,
          amount: formatAmount(amount),
          remaining: formatAmount(remainingTotal),
        }),
      });
      return;
    }

    if (intent === "LOG_UDHAAR") {
      if (!customerName || !Number.isFinite(amount) || amount <= 0) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "UDHAAR_ERROR"),
        });
        return;
      }

      await logUdhaar({ customerName, amount });
      const latestTotal = await getCustomerUdhaarTotal({ customerName });
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "UDHAAR_OK", {
          customerName,
          amount: formatAmount(amount),
          total: formatAmount(latestTotal),
        }),
      });
      return;
    }

    await sendTextMessage({
      to: ownerWaId,
      text: buildText(language, "UNKNOWN"),
    });
  } catch (error) {
    console.error("Webhook processing error:", error.message);
  }
}

module.exports = { verifyWebhook, receiveWebhook };
