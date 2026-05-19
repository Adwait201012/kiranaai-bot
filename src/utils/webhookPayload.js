"use strict";

/**
 * Parse inbound WhatsApp webhooks (Meta Cloud API or Twilio).
 * Processes only the first message in entry[0].changes[0].value.messages[0].
 * Ignores status-only webhooks (no messages[]).
 *
 * @param {object} body - req.body
 * @returns {null | {
 *   messageId: string,
 *   ownerWaId: string,
 *   text: string,
 *   mediaContentType: string | null,
 *   mediaUrl: string | null,
 *   source: "cloud_api" | "twilio"
 * }}
 */
function parseInboundWebhook(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  // Meta WhatsApp Cloud API
  if (body.object === "whatsapp_business_account" && Array.isArray(body.entry)) {
    const change = body.entry[0]?.changes?.[0];
    const value = change?.value;
    if (!value) {
      return null;
    }

    // Status updates only — no user message
    if (!Array.isArray(value.messages) || value.messages.length === 0) {
      return null;
    }

    const message = value.messages[0];
    if (!message?.id) {
      return null;
    }

    // Voice notes arrive as a separate webhook with a different wamid — skip them.
    if (message.type === "audio") {
      return null;
    }

    // Only handle plain text inbound messages (avoids double-processing with audio).
    if (message.type !== "text") {
      return null;
    }

    const ownerWaId = normalizeWaId(message.from);
    let text = "";
    let mediaContentType = null;
    let mediaUrl = null;

    if (message.text?.body) {
      text = String(message.text.body).trim();
    }

    if (!text) {
      return null;
    }

    const messageTimestamp = message.timestamp
      ? new Date(parseInt(message.timestamp, 10) * 1000)
      : null;

    return {
      messageId: message.id,
      ownerWaId,
      text,
      mediaContentType,
      mediaUrl,
      messageTimestamp,
      source: "cloud_api",
    };
  }

  // Twilio WhatsApp
  if (body.From) {
    const messageId = body.MessageSid || body.SmsMessageSid || null;
    if (!messageId) {
      return null;
    }

    const mediaType = String(body.MediaContentType0 || "").toLowerCase();
    if (mediaType.includes("audio")) {
      return null;
    }

    return {
      messageId,
      ownerWaId: normalizeWaId(body.From),
      text: String(body.Body || "").trim(),
      mediaContentType: body.MediaContentType0 || null,
      mediaUrl: body.MediaUrl0 || null,
      source: "twilio",
    };
  }

  return null;
}

function normalizeWaId(from) {
  const raw = String(from || "").trim();
  if (!raw) return raw;
  if (raw.startsWith("whatsapp:")) {
    return raw;
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `whatsapp:+91${digits}`;
  }
  return `whatsapp:+${digits}`;
}

module.exports = { parseInboundWebhook, normalizeWaId };
