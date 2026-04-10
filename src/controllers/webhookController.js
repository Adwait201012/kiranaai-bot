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
      GREETING_INTRO: "नमस्ते 👋 मैं VyaparAI हूं।",
      TODAY_HISAAB: `आज: +₹${p.newUdhaar}, -₹${p.wapasReceived}, नेट ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "कोई पेंडिंग उधार नहीं ✅",
      ALL_UDHAAR: `उधार सूची:\n${p.lines}\nकुल ₹${p.total}`,
      INVENTORY_ADD_ERROR: "इन्वेंटरी जोड़ने के लिए वस्तु या मात्रा स्पष्ट नहीं है।",
      INVENTORY_ADD_OK: `${p.itemName}: ${p.quantity}${p.unitText} जोड़ दिया ✅ कुल: ${p.totalQuantity}${p.unitText}`,
      INVENTORY_ADD_MULTI: `जोड़ दिया ✅\n${p.lines}`,
      INVENTORY_ADD_MULTI_ITEM: `${p.itemName}: +${p.quantity}${p.unitText}, कुल ${p.totalQuantity}${p.unitText}`,
      LOW_STOCK_ALERT: `⚠️ चेतावनी: ${p.itemName} कम है! सिर्फ ${p.quantity}${p.unitText} बचा है।`,
      STOCK_CHECK_ERROR: "किस वस्तु का स्टॉक देखना है, यह समझ नहीं आया।",
      STOCK_NOT_FOUND: `${p.itemName} स्टॉक में नहीं मिला।`,
      STOCK_CHECK_OK: `${p.itemName}: ${p.quantity}${p.unitText} 📦`,
      ALL_STOCK_EMPTY: "स्टॉक खाली है 📭",
      ALL_STOCK: `स्टॉक:\n${p.lines}`,
      SAVE_NUMBER_ERROR: "ग्राहक का नाम या फोन नंबर समझ नहीं आया।",
      SAVE_NUMBER_OK: `${p.customerName} का नंबर सेव ✅`,
      REMINDER_NAME_ERROR: "किस ग्राहक को याद दिलाना है, यह समझ नहीं आया।",
      REMINDER_NO_PHONE: `${p.customerName} का नंबर नहीं मिला। पहले "${p.customerName} number 9876543210" भेजें।`,
      REMINDER_CUSTOMER: `नमस्ते ${p.customerName} जी, ₹${p.amount} उधार बाकी है। कृपया भुगतान करें।`,
      REMINDER_OWNER_OK: `रिमाइंडर भेज दिया ✅`,
      CHECK_NAME_ERROR: "कस्टमर का नाम समझ नहीं आया।",
      CHECK_OK: `${p.customerName}: ₹${p.amount} उधार`,
      WAPAS_ERROR: "वापस एंट्री के लिए नाम या अमाउंट क्लियर नहीं है।",
      WAPAS_OK: `${p.customerName}: ₹${p.amount} वापस ✅ बाकी ₹${p.remaining}`,
      UDHAAR_ERROR: "उधार एंट्री के लिए नाम या अमाउंट क्लियर नहीं है।",
      UDHAAR_OK: `${p.customerName}: ₹${p.amount} उधार जोड़ दिया ✅`,
      UNKNOWN: "मैसेज समझ नहीं आया। कृपया फिर से लिखें।",
    },
    hinglish: {
      GREETING_INTRO: "Namaste 👋 Main VyaparAI hun.",
      TODAY_HISAAB: `Aaj: +₹${p.newUdhaar}, -₹${p.wapasReceived}, net ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "Koi pending udhaar nahi ✅",
      ALL_UDHAAR: `Udhaar list:\n${p.lines}\nTotal ₹${p.total}`,
      INVENTORY_ADD_ERROR: "Stock entry ke liye item ya quantity clear nahi hai.",
      INVENTORY_ADD_OK: `${p.itemName}: ${p.quantity}${p.unitText} add ✅ total: ${p.totalQuantity}${p.unitText}`,
      INVENTORY_ADD_MULTI: `Add ho gaya ✅\n${p.lines}`,
      INVENTORY_ADD_MULTI_ITEM: `${p.itemName}: +${p.quantity}${p.unitText}, total ${p.totalQuantity}${p.unitText}`,
      LOW_STOCK_ALERT: `⚠️ Warning: ${p.itemName} stock low! Sirf ${p.quantity}${p.unitText} bacha hai.`,
      STOCK_CHECK_ERROR: "Kaunsa item ka stock check karna hai, samajh nahi aaya.",
      STOCK_NOT_FOUND: `${p.itemName} stock mein nahi mila.`,
      STOCK_CHECK_OK: `${p.itemName}: ${p.quantity}${p.unitText} 📦`,
      ALL_STOCK_EMPTY: "Stock khaali hai 📭",
      ALL_STOCK: `Stock:\n${p.lines}`,
      SAVE_NUMBER_ERROR: "Customer name ya phone number samajh nahi aaya.",
      SAVE_NUMBER_OK: `${p.customerName} ka number save ✅`,
      REMINDER_NAME_ERROR: "Kis customer ko reminder bhejna hai, samajh nahi aaya.",
      REMINDER_NO_PHONE: `${p.customerName} ka number nahi mila. Pehle "${p.customerName} number 9876543210" bhejein.`,
      REMINDER_CUSTOMER: `Namaste ${p.customerName} ji, ₹${p.amount} udhaar pending hai. Please payment kar dein.`,
      REMINDER_OWNER_OK: `Reminder bhej diya ✅`,
      CHECK_NAME_ERROR: "Customer ka naam samajh nahi aaya.",
      CHECK_OK: `${p.customerName}: ₹${p.amount} udhaar`,
      WAPAS_ERROR: "Wapas entry ke liye naam ya amount clear nahi hai.",
      WAPAS_OK: `${p.customerName}: ₹${p.amount} wapas ✅ baaki ₹${p.remaining}`,
      UDHAAR_ERROR: "Udhaar entry ke liye naam ya amount clear nahi hai.",
      UDHAAR_OK: `${p.customerName}: ₹${p.amount} udhaar add ✅`,
      UNKNOWN: "Message samajh nahi aaya. Please dobara bhejein.",
    },
    english: {
      GREETING_INTRO: "Hello 👋 I am VyaparAI.",
      TODAY_HISAAB: `Today: +₹${p.newUdhaar}, -₹${p.wapasReceived}, net ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "No pending credit ✅",
      ALL_UDHAAR: `Credit list:\n${p.lines}\nTotal ₹${p.total}`,
      INVENTORY_ADD_ERROR: "Item or quantity is unclear for stock entry.",
      INVENTORY_ADD_OK: `${p.itemName}: ${p.quantity}${p.unitText} added ✅ total: ${p.totalQuantity}${p.unitText}`,
      INVENTORY_ADD_MULTI: `Added ✅\n${p.lines}`,
      INVENTORY_ADD_MULTI_ITEM: `${p.itemName}: +${p.quantity}${p.unitText}, total ${p.totalQuantity}${p.unitText}`,
      LOW_STOCK_ALERT: `⚠️ Warning: ${p.itemName} stock is low! Only ${p.quantity}${p.unitText} remaining.`,
      STOCK_CHECK_ERROR: "Could not understand which item stock to check.",
      STOCK_NOT_FOUND: `No stock found for ${p.itemName}.`,
      STOCK_CHECK_OK: `${p.itemName}: ${p.quantity}${p.unitText} 📦`,
      ALL_STOCK_EMPTY: "Stock is empty 📭",
      ALL_STOCK: `Stock:\n${p.lines}`,
      SAVE_NUMBER_ERROR: "Could not understand customer name or phone number.",
      SAVE_NUMBER_OK: `${p.customerName} number saved ✅`,
      REMINDER_NAME_ERROR: "Could not understand which customer to remind.",
      REMINDER_NO_PHONE: `No number found for ${p.customerName}. First send "${p.customerName} number 9876543210".`,
      REMINDER_CUSTOMER: `Hello ${p.customerName}, ₹${p.amount} is pending. Please pay soon.`,
      REMINDER_OWNER_OK: `Reminder sent ✅`,
      CHECK_NAME_ERROR: "Could not understand customer name.",
      CHECK_OK: `${p.customerName}: ₹${p.amount} pending`,
      WAPAS_ERROR: "Name or amount is unclear for repayment entry.",
      WAPAS_OK: `${p.customerName}: ₹${p.amount} received ✅ left ₹${p.remaining}`,
      UDHAAR_ERROR: "Name or amount is unclear for credit entry.",
      UDHAAR_OK: `${p.customerName}: ₹${p.amount} credit added ✅`,
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
        (item) => `${item.customerName}: Rs${formatAmount(item.total)}`,
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
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "UDHAAR_OK", {
          customerName,
          amount: formatAmount(amount),
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
