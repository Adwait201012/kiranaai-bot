const { detectIntent } = require("../services/aiExtractionService");
const {
  logUdhaar,
  logWapas,
  getCustomerUdhaarTotal,
  getTodayHisaab,
  saveCustomerPhone,
  getCustomerPhone,
  getAllPendingUdhaar,
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
        "कस्टमर नंबर सेव - 'शर्मा जी number 9876543210'\n" +
        "कस्टमर रिमाइंडर - 'शर्मा जी को remind करो'\n" +
        "वॉइस मैसेज - कुछ भी बोलकर भेजिए, मैं समझ जाऊंगा!\n\n" +
        "हिंग्लिश, हिंदी या अंग्रेज़ी - जो भी आपको आरामदायक लगे!\n" +
        "चलिए शुरू करते हैं! 💪",
      TODAY_HISAAB: `आज का हिसाब:\nनया उधार: ₹${p.newUdhaar}\nवापस मिला: ₹${p.wapasReceived}\nनेट उधार आज: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "सभी का उधार:\nकोई पेंडिंग उधार नहीं है।\nकुल: Rs0",
      ALL_UDHAAR: `सभी का उधार:\n${p.lines}\nकुल: Rs${p.total}`,
      SAVE_NUMBER_ERROR: "कस्टमर का नाम या फोन नंबर समझ नहीं आया।",
      SAVE_NUMBER_OK: `${p.customerName} का नंबर सेव हो गया।`,
      REMINDER_NAME_ERROR: "किस कस्टमर को रिमाइंडर भेजना है, समझ नहीं आया।",
      REMINDER_NO_PHONE: `${p.customerName} का नंबर नहीं मिला। पहले "${p.customerName} number 9876543210" भेजें।`,
      REMINDER_CUSTOMER: `नमस्ते ${p.customerName} जी! आपका हमारे शॉप में ₹${p.amount} उधार बाकी है। कृपया जल्द चुकता करें। धन्यवाद!`,
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
        "Customer Number Save - 'Sharma ji number 9876543210'\n" +
        "Customer Reminder - 'Sharma ji ko remind karo'\n" +
        "Voice Messages - Kuch bhi bolke bhejo, main samjhunga!\n\n" +
        "Hinglish, Hindi ya English - jo bhi aapko comfortable lage!\n" +
        "Chalo shuru karte hain! 💪",
      TODAY_HISAAB: `Aaj ka hisaab:\nNaya udhaar: ₹${p.newUdhaar}\nWapas mila: ₹${p.wapasReceived}\nNet udhaar aaj: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "Sabka udhaar:\nKoi pending udhaar nahi hai.\nTotal: Rs0",
      ALL_UDHAAR: `Sabka udhaar:\n${p.lines}\nTotal: Rs${p.total}`,
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
        "Log Udhaar - 'Sharma ji owes 500'\n" +
        "Check Udhaar - 'How much udhaar for Sharma ji?'\n" +
        "Payment Received - 'Sharma ji paid 200'\n" +
        "Today's Summary - 'today report'\n" +
        "All Pending Udhaar - 'show all udhaar'\n" +
        "Save Customer Number - 'Sharma ji number 9876543210'\n" +
        "Send Reminder - 'remind Sharma ji'\n" +
        "Voice Messages - Send voice notes, I will understand!\n\n" +
        "Use Hinglish, Hindi, or English - as you prefer!\n" +
        "Let's get started! 💪",
      TODAY_HISAAB: `Today's summary:\nNew udhaar: ₹${p.newUdhaar}\nRepayment received: ₹${p.wapasReceived}\nNet udhaar today: ₹${p.netUdhaar}`,
      NO_PENDING_ALL: "All udhaar:\nNo pending udhaar.\nTotal: Rs0",
      ALL_UDHAAR: `All udhaar:\n${p.lines}\nTotal: Rs${p.total}`,
      SAVE_NUMBER_ERROR: "Could not understand customer name or phone number.",
      SAVE_NUMBER_OK: `${p.customerName}'s number has been saved.`,
      REMINDER_NAME_ERROR: "Could not understand which customer to remind.",
      REMINDER_NO_PHONE: `No number found for ${p.customerName}. First send "${p.customerName} number 9876543210".`,
      REMINDER_CUSTOMER: `Namaste ${p.customerName} ji! You have ₹${p.amount} udhaar pending at our shop. Please clear it soon. Thank you!`,
      REMINDER_OWNER_OK: `Reminder sent to ${p.customerName}.`,
      CHECK_NAME_ERROR: "Could not understand customer name.",
      CHECK_OK: `${p.customerName}'s total udhaar is ₹${p.amount}`,
      WAPAS_ERROR: "Name or amount is unclear for repayment entry.",
      WAPAS_OK: `${p.customerName} paid back ₹${p.amount}. Remaining udhaar: ₹${p.remaining}`,
      UDHAAR_ERROR: "Name or amount is unclear for udhaar entry.",
      UDHAAR_OK: `₹${p.amount} udhaar logged for ${p.customerName}.`,
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
    const language = normalizeLanguage(aiResult.language);

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
