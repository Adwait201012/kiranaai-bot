const env = require("../config/env");

async function sendTextMessage({ to, text }) {
  const url = `https://graph.facebook.com/v23.0/${env.whatsappPhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsappAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp send failed: ${errorBody}`);
  }

  return response.json();
}

module.exports = { sendTextMessage };
