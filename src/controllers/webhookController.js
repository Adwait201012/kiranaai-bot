const {
  detectIntent,
  detectLanguageFromText,
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
        "नमस्ते! मैं VyaparAI हूं, आपका स्मार्ट किराना असिस्टेंट! 🤖\n" +
        "मैं आपकी इन चीजों में मदद कर सकता हूं:\n\n" +
        "उधार लॉग - 'शर्मा जी 500 उधार'\n" +
        "उधार चेक - 'शर्मा जी कितना उधार'\n" +
        "पेमेंट रिसीव्ड - 'शर्मा जी 200 वापस'\n" +
        "आज का हिसाब - 'आज का हिसाब'\n" +
        "सबका उधार - 'सबका उधार दिखाओ'\n" +
        "इन्वेंटरी जोड़ें - 'चावल 50kg आया'\n" +
        "स्टॉक चेक - 'चावल स्टॉक कितना है'\n" +
        "सारा स्टॉक - 'सभी का स्टॉक दिखाओ'\n" +
        "कस्टमर नंबर सेव - 'शर्मा जी number 9876543210'\n" +
        "कस्टमर रिमाइंडर - 'शर्मा जी को remind करो'\n" +
        "वॉइस मैसेज - कुछ भी बोलकर भेजिए, मैं समझ जाऊंगा!\n\n" +
        "हिंदी, हिंग्लिश या अंग्रेज़ी - जो भाषा लिखेंगे, उसी में जवाब मिलेगा!\n" +
        "चलिए शुरू करते हैं! 💪",
      TODAY_HISAAB: `आज का हिसाब:\nनया उधार: ₹${p.newUdhaar}\nवापस मिला: ₹${p.wapasReceived}\nनेट उधार आज: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "सभी का उधार:\nकोई पेंडिंग उधार नहीं है।\nकुल: Rs0",
      ALL_UDHAAR: `सभी का उधार:\n${p.lines}\nकुल: Rs${p.total}`,
      INVENTORY_ADD_ERROR: "इन्वेंटरी जोड़ने के लिए वस्तु या मात्रा स्पष्ट नहीं है।",
      INVENTORY_ADD_OK: `${p.itemName} ${p.quantity}${p.unitText} इन्वेंटरी में जोड़ दिया गया!`,
      STOCK_CHECK_ERROR: "किस वस्तु का स्टॉक देखना है, यह समझ नहीं आया।",
      STOCK_NOT_FOUND: `${p.itemName} का स्टॉक नहीं मिला।`,
      STOCK_CHECK_OK: `${p.itemName} का वर्तमान स्टॉक: ${p.quantity}${p.unitText}`,
      ALL_STOCK_EMPTY: "स्टॉक लिस्ट खाली है।",
      ALL_STOCK: `सारा स्टॉक:\n${p.lines}`,
      SAVE_NUMBER_ERROR: "ग्राहक का नाम या फोन नंबर समझ नहीं आया।",
      SAVE_NUMBER_OK: `${p.customerName} का नंबर सहेज दिया गया।`,
      REMINDER_NAME_ERROR: "किस ग्राहक को याद दिलाना है, यह समझ नहीं आया।",
      REMINDER_NO_PHONE: `${p.customerName} का नंबर नहीं मिला। पहले "${p.customerName} number 9876543210" भेजें।`,
      REMINDER_CUSTOMER: `नमस्ते ${p.customerName} जी! आपकी ₹${p.amount} उधारी बाकी है। कृपया जल्द भुगतान करें। धन्यवाद।`,
      REMINDER_OWNER_OK: `${p.customerName} को रिमाइंडर भेज दिया गया।`,
      CHECK_NAME_ERROR: "कस्टमर का नाम समझ नहीं आया।",
      CHECK_OK: `${p.customerName} का कुल उधार: ₹${p.amount} है`,
      WAPAS_ERROR: "वापस एंट्री के लिए नाम या अमाउंट क्लियर नहीं है।",
      WAPAS_OK: `${p.customerName} ने ₹${p.amount} वापस दिया। बाकी उधार: ₹${p.remaining}`,
      UDHAAR_ERROR: "उधार एंट्री के लिए नाम या अमाउंट क्लियर नहीं है।",
      UDHAAR_OK: `${p.customerName} का ₹${p.amount} उधार लॉग हो गया!`,
      UNKNOWN: "मैसेज समझ नहीं आया। कृपया फिर से लिखें।",
    },
    hinglish: {
      GREETING_INTRO:
        "Namaste! Main VyaparAI hun, aapka smart kirana assistant! 🤖\n" +
        "Main aapki in cheezon mein help kar sakta hun:\n\n" +
        "Udhaar Log - 'Sharma ji 500 udhaar'\n" +
        "Udhaar Check - 'Sharma ji kitna udhaar'\n" +
        "Payment Received - 'Sharma ji 200 wapas'\n" +
        "Aaj Ka Hisaab - 'aaj ka hisaab'\n" +
        "Sabka Udhaar - 'sabka udhaar dikhao'\n" +
        "Stock Add - 'chawal 50kg aaya'\n" +
        "Stock Check - 'chawal stock kitna hai'\n" +
        "All Stock - 'sabka stock dikhao'\n" +
        "Customer Number Save - 'Sharma ji number 9876543210'\n" +
        "Customer Reminder - 'Sharma ji ko remind karo'\n" +
        "Voice Messages - Kuch bhi bolke bhejo, main samjhunga!\n\n" +
        "Jo language mein message karoge, reply bhi usi language mein milega!\n" +
        "Chalo shuru karte hain! 💪",
      TODAY_HISAAB: `Aaj ka hisaab:\nNaya udhaar: ₹${p.newUdhaar}\nWapas mila: ₹${p.wapasReceived}\nNet udhaar aaj: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "Sabka udhaar:\nKoi pending udhaar nahi hai.\nTotal: Rs0",
      ALL_UDHAAR: `Sabka udhaar:\n${p.lines}\nTotal: Rs${p.total}`,
      INVENTORY_ADD_ERROR: "Stock entry ke liye item ya quantity clear nahi hai.",
      INVENTORY_ADD_OK: `${p.itemName} ${p.quantity}${p.unitText} inventory mein add ho gaya!`,
      STOCK_CHECK_ERROR: "Kaunsa item ka stock check karna hai, samajh nahi aaya.",
      STOCK_NOT_FOUND: `${p.itemName} ka stock nahi mila.`,
      STOCK_CHECK_OK: `${p.itemName} ka current stock: ${p.quantity}${p.unitText}`,
      ALL_STOCK_EMPTY: "Stock list khaali hai.",
      ALL_STOCK: `Sabka stock:\n${p.lines}`,
      SAVE_NUMBER_ERROR: "Customer name ya phone number samajh nahi aaya.",
      SAVE_NUMBER_OK: `${p.customerName} ka number save ho gaya.`,
      REMINDER_NAME_ERROR: "Kis customer ko reminder bhejna hai, samajh nahi aaya.",
      REMINDER_NO_PHONE: `${p.customerName} ka number nahi mila. Pehle "${p.customerName} number 9876543210" bhejein.`,
      REMINDER_CUSTOMER: `Namaste ${p.customerName} ji! Aapka hamare shop mein ₹${p.amount} udhaar baaki hai. Kripya jald chukta karein. Dhanyawad!`,
      REMINDER_OWNER_OK: `${p.customerName} ko reminder bhej diya gaya.`,
      CHECK_NAME_ERROR: "Customer ka naam samajh nahi aaya.",
      CHECK_OK: `${p.customerName} ka kul udhaar: ₹${p.amount} hai`,
      WAPAS_ERROR: "Wapas entry ke liye naam ya amount clear nahi hai.",
      WAPAS_OK: `${p.customerName} ne ₹${p.amount} wapas diya. Baaki udhaar: ₹${p.remaining}`,
      UDHAAR_ERROR: "Udhaar entry ke liye naam ya amount clear nahi hai.",
      UDHAAR_OK: `${p.customerName} ka ₹${p.amount} udhaar logged!`,
      UNKNOWN: "Message samajh nahi aaya. Please dobara bhejein.",
    },
    english: {
      GREETING_INTRO:
        "Hello! I am VyaparAI, your smart kirana assistant! 🤖\n" +
        "I can help you with:\n\n" +
        "Log Credit - 'Sharma ji owes 500'\n" +
        "Check Credit - 'How much credit for Sharma ji?'\n" +
        "Payment Received - 'Sharma ji paid 200'\n" +
        "Today's Summary - 'today report'\n" +
        "All Pending Credit - 'show all pending credit'\n" +
        "Add Stock - 'rice 50 kg aaya'\n" +
        "Check Stock - 'rice stock quantity'\n" +
        "All Stock - 'show all stock'\n" +
        "Save Customer Number - 'Sharma ji number 9876543210'\n" +
        "Send Reminder - 'remind Sharma ji'\n" +
        "Voice Messages - Send voice notes, I will understand!\n\n" +
        "The reply will always match your input language exactly.\n" +
        "Let's get started! 💪",
      TODAY_HISAAB: `Today's summary:\nNew credit: ₹${p.newUdhaar}\nRepayment received: ₹${p.wapasReceived}\nNet credit today: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "All credit:\nNo pending credit.\nTotal: Rs0",
      ALL_UDHAAR: `All credit:\n${p.lines}\nTotal: Rs${p.total}`,
      INVENTORY_ADD_ERROR: "Item or quantity is unclear for stock entry.",
      INVENTORY_ADD_OK: `${p.itemName} ${p.quantity}${p.unitText} added to inventory!`,
      STOCK_CHECK_ERROR: "Could not understand which item stock to check.",
      STOCK_NOT_FOUND: `No stock found for ${p.itemName}.`,
      STOCK_CHECK_OK: `${p.itemName} current stock: ${p.quantity}${p.unitText}`,
      ALL_STOCK_EMPTY: "Stock list is empty.",
      ALL_STOCK: `All stock:\n${p.lines}`,
      SAVE_NUMBER_ERROR: "Could not understand customer name or phone number.",
      SAVE_NUMBER_OK: `${p.customerName}'s number has been saved.`,
      REMINDER_NAME_ERROR: "Could not understand which customer to remind.",
      REMINDER_NO_PHONE: `No number found for ${p.customerName}. First send "${p.customerName} number 9876543210".`,
      REMINDER_CUSTOMER: `Hello ${p.customerName}! You have ₹${p.amount} pending at our shop. Please clear it soon. Thank you!`,
      REMINDER_OWNER_OK: `Reminder sent to ${p.customerName}.`,
      CHECK_NAME_ERROR: "Could not understand customer name.",
      CHECK_OK: `${p.customerName}'s total pending credit is ₹${p.amount}`,
      WAPAS_ERROR: "Name or amount is unclear for repayment entry.",
      WAPAS_OK: `${p.customerName} paid back ₹${p.amount}. Remaining credit: ₹${p.remaining}`,
      UDHAAR_ERROR: "Name or amount is unclear for credit entry.",
      UDHAAR_OK: `₹${p.amount} credit logged for ${p.customerName}.`,
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
      if (!itemName || !Number.isFinite(quantity) || quantity <= 0) {
        await sendTextMessage({
          to: ownerWaId,
          text: buildText(language, "INVENTORY_ADD_ERROR"),
        });
        return;
      }

      const row = await addInventoryStock({ itemName, quantity, unit });
      const quantityText = formatAmount(row.quantity);
      const unitText = row.unit ? ` ${row.unit}` : "";
      await sendTextMessage({
        to: ownerWaId,
        text: buildText(language, "INVENTORY_ADD_OK", {
          itemName: row.item_name || itemName,
          quantity: quantityText,
          unitText,
        }),
      });
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

      const stock = await getInventoryStock({ itemName });
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
