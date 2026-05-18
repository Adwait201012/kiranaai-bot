/**
 * idempotency.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents duplicate processing of WhatsApp webhook messages.
 *
 * WhatsApp Cloud API can deliver the same webhook multiple times.
 * Before processing any message, call `isAlreadyProcessed(messageId)`.
 * After successful processing, call `markAsProcessed(messageId, ownerPhone)`.
 *
 * Requires the `processed_messages` table (see shop_employees.sql):
 *   CREATE TABLE processed_messages (
 *     message_id   text PRIMARY KEY,
 *     owner_phone  text NOT NULL,
 *     processed_at timestamptz DEFAULT now()
 *   );
 *
 * Usage in webhookController.js:
 *   const { isAlreadyProcessed, markAsProcessed } = require("../utils/idempotency");
 *
 *   const messageId = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
 *   if (messageId && await isAlreadyProcessed(messageId)) {
 *     console.log(`[Idempotency] Duplicate message ${messageId} — skipping`);
 *     return;
 *   }
 *   // ... process message ...
 *   if (messageId) await markAsProcessed(messageId, ownerPhone);
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const { supabase } = require("../config/supabase");

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
      // On DB error, fail-open (process the message) to avoid silent drops
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
 * Mark a message as processed after successful handling.
 * Uses upsert so duplicate inserts don't throw (race condition safety).
 *
 * @param {string} messageId   WhatsApp message ID
 * @param {string} ownerPhone  Resolved owner phone (E.164)
 * @returns {Promise<void>}
 */
async function markAsProcessed(messageId, ownerPhone) {
  if (!messageId) return;

  try {
    const { error } = await supabase
      .from("processed_messages")
      .upsert(
        { message_id: messageId, owner_phone: ownerPhone || "unknown" },
        { onConflict: "message_id" }
      );

    if (error) {
      console.error("[Idempotency] markAsProcessed failed:", error.message);
    } else {
      console.log(`[Idempotency] Marked as processed: ${messageId}`);
    }
  } catch (err) {
    console.error("[Idempotency] Unexpected error in markAsProcessed:", err.message);
  }
}

module.exports = { isAlreadyProcessed, markAsProcessed };
