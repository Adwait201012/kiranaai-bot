const { extractTransaction } = require("../services/aiExtractionService");
const {
  logUdhaar,
  logWapas,
  getCustomerUdhaarTotal,
  getTodayHisaab,
} = require("../services/udhaarService");
const { sendTextMessage } = require("../services/whatsappService");

const verifyWebhook = (req, res) => {
  res.status(200).send("Twilio webhook is active");
};

function parseUdhaarTotalQuery(text) {
  const cleaned = String(text || "").trim().replace(/\s+/g, " ");
  const kitnaMatch = cleaned.match(/^(.+?)\s+kitna\s+udhaar$/i);
  if (kitnaMatch) {
    return { customerName: kitnaMatch[1].trim() };
  }

  const bataoMatch = cleaned.match(/^(.+?)\s+ka\s+udhaar\s+batao$/i);
  if (bataoMatch) {
    return { customerName: bataoMatch[1].trim() };
  }

  return null;
}

function parseWapasMessage(text) {
  const cleaned = String(text || "").trim().replace(/\s+/g, " ");

  const wapasMatch = cleaned.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+wapas$/i);
  if (wapasMatch) {
    const amount = Number(wapasMatch[2]);
    if (Number.isNaN(amount) || amount <= 0) {
      return null;
    }
    return {
      customerName: wapasMatch[1].trim(),
      amount,
    };
  }

  const diyaMatch = cleaned.match(/^(.+?)\s+ne\s+(\d+(?:\.\d+)?)\s+diya$/i);
  if (diyaMatch) {
    const amount = Number(diyaMatch[2]);
    if (Number.isNaN(amount) || amount <= 0) {
      return null;
    }
    return {
      customerName: diyaMatch[1].trim(),
      amount,
    };
  }

  return null;
}

function isTodayHisaabQuery(text) {
  const cleaned = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  return cleaned.includes("aaj ka hisaab") || cleaned.includes("aaj ka report");
}

function formatAmount(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

async function handleTodayHisaab({ ownerWaId }) {
  const today = await getTodayHisaab();
  const replyText =
    `📊 Aaj ka hisaab:\n` +
    `💰 Naya udhaar: ₹${formatAmount(today.newUdhaar)}\n` +
    `✅ Wapas mila: ₹${formatAmount(today.wapasReceived)}\n` +
    `📌 Net udhaar aaj: ₹${formatAmount(today.netUdhaar)}`;

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
    const text = req.body?.Body;

    if (!ownerWaId || !text) {
      return;
    }

    if (isTodayHisaabQuery(text)) {
      await handleTodayHisaab({ ownerWaId });
      return;
    }

    const totalQuery = parseUdhaarTotalQuery(text);
    if (totalQuery) {
      const total = await getCustomerUdhaarTotal({
        customerName: totalQuery.customerName,
      });
      const replyText = `${totalQuery.customerName} ka kul udhaar: ₹${total} hai`;
      await sendTextMessage({
        to: ownerWaId,
        text: replyText,
      });
      return;
    }

    const wapasQuery = parseWapasMessage(text);
    if (wapasQuery) {
      await logWapas({
        customerName: wapasQuery.customerName,
        amount: wapasQuery.amount,
      });
      const remainingTotal = await getCustomerUdhaarTotal({
        customerName: wapasQuery.customerName,
      });
      const replyText = `✅ ${wapasQuery.customerName} ne ₹${wapasQuery.amount} wapas diya. Baaki udhaar: ₹${remainingTotal}`;
      await sendTextMessage({
        to: ownerWaId,
        text: replyText,
      });
      return;
    }

    const parsed = await extractTransaction(text);
    if (parsed.type === "unknown") {
      return;
    }

    if (parsed.type === "udhaar") {
      await logUdhaar({
        customerName: parsed.customerName,
        amount: parsed.amount,
      });

      const replyText = `✅ ${parsed.customerName} ka ₹${parsed.amount} udhaar logged!`;
      await sendTextMessage({
        to: ownerWaId,
        text: replyText,
      });
      return;
    }

    await logWapas({
      customerName: parsed.customerName,
      amount: parsed.amount,
    });

    const remainingTotal = await getCustomerUdhaarTotal({
      customerName: parsed.customerName,
    });
    const replyText = `✅ ${parsed.customerName} ne ₹${parsed.amount} wapas diya. Baaki udhaar: ₹${remainingTotal}`;
    await sendTextMessage({
      to: ownerWaId,
      text: replyText,
    });
  } catch (error) {
    console.error("Webhook processing error:", error.message);
  }
}

module.exports = { verifyWebhook, receiveWebhook };
