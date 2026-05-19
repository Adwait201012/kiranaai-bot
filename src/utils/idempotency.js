/**
 * idempotency.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents duplicate processing of WhatsApp webhook messages.
 *
 * WhatsApp Cloud API can deliver the same webhook multiple times.
 * Before processing any message, call `isAlreadyProcessed(messageId)`.
 * Before sending a reply, call `recordBeforeReply(messageId, ownerPhone)`.
 *
 * Requires the `processed_messages` table (see shop_employees.sql):
 *   CREATE TABLE processed_messages (
 *     message_id   text PRIMARY KEY,
 *     owner_phone  text NOT NULL,
 *     processed_at timestamptz DEFAULT now()
 *   );
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const { supabase } = require("../config/supabase");

/** In-flight lock: same Node process handling the same wamid concurrently */
const inFlight = new Map();

/**
 * @param {string} messageId
 * @param {() => Promise<void>} fn
 */
async function withMessageLock(messageId, fn) {
  if (!messageId) {
    return fn();
  }

  while (inFlight.has(messageId)) {
    await inFlight.get(messageId);
  }

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  inFlight.set(messageId, gate);

  try {
    return await fn();
  } finally {
    inFlight.delete(messageId);
    release();
  }
}

/**
 * Check if a message has already been processed.
 *
 * @param {string} messageId  WhatsApp message ID (wamid.xxx)
 * @returns {Promise<boolean>}
 */
async function isAlreadyProcessed(messageId) {
  if (!messageId) return false;

  try {
    const { data, error } = await supabase
      .from("processed_messages")
      .select("message_id")
      .eq("message_id", messageId)
      .maybeSingle();

    if (error) {
      console.error("[Idempotency] Check failed:", error.message);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error("[Idempotency] Unexpected error in isAlreadyProcessed:", err.message);
    return false;
  }
}

/**
 * INSERT before sending the WhatsApp reply. Returns false if this wamid was
 * already recorded (duplicate delivery / race).
 *
 * @param {string} messageId
 * @param {string} ownerPhone
 * @returns {Promise<boolean>} true if recorded, false if duplicate
 */
async function recordBeforeReply(messageId, ownerPhone) {
  if (!messageId) return true;

  try {
    const { error } = await supabase.from("processed_messages").insert({
      message_id: messageId,
      owner_phone: ownerPhone || "unknown",
    });

    if (error) {
      if (error.code === "23505") {
        console.log(`[Idempotency] Duplicate reply blocked: ${messageId}`);
        return false;
      }
      console.error("[Idempotency] recordBeforeReply failed:", error.message);
      return true;
    }

    console.log(`[Idempotency] Recorded before reply: ${messageId}`);
    return true;
  } catch (err) {
    console.error("[Idempotency] Unexpected error in recordBeforeReply:", err.message);
    return true;
  }
}

/**
 * @deprecated Use recordBeforeReply before outbound messages.
 */
async function markAsProcessed(messageId, ownerPhone) {
  return recordBeforeReply(messageId, ownerPhone);
}

module.exports = {
  isAlreadyProcessed,
  recordBeforeReply,
  markAsProcessed,
  withMessageLock,
};
