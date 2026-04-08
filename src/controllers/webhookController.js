const env = require("../config/env");
const { parseUdhaarMessage } = require("../utils/parseUdhaarMessage");
const { logUdhaar } = require("../services/udhaarService");
const { sendTextMessage } = require("../services/whatsappService");

function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === env.whatsappVerifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).send("Verification failed");
}

async function receiveWebhook(req, res) {
  // Respond quickly so Meta doesn't retry
  res.status(200).json({ received: true });

  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    const ownerWaId = message?.from;
    const text = message?.text?.body;

    if (!ownerWaId || !text) {
      return;
    }

    const parsed = parseUdhaarMessage(text);
    if (!parsed) {
      return;
    }

    await logUdhaar({
      customerName: parsed.customerName,
      amount: parsed.amount,
    });

    const replyText = `✅ ${parsed.customerName} ka ₹${parsed.amount} udhaar logged!`;
    await sendTextMessage({
      to: ownerWaId,
      text: replyText,
    });
  } catch (error) {
    console.error("Webhook processing error:", error.message);
  }
}

module.exports = { verifyWebhook, receiveWebhook };
