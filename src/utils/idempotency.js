/**
 * idempotency.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents duplicate processing of WhatsApp webhook messages.
 *
 * Uses INSERT with unique message_id — concurrent duplicates get 23505 and skip.
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

/**
 * Atomically claim a message id before processing.
 *
 * @param {string} messageId
 * @param {string} ownerPhone
 * @returns {Promise<{ claimed: boolean }>}
 */
async function tryClaimMessage(messageId, ownerPhone) {
  if (!messageId) {
    return { claimed: true };
  }

  try {
    const { data, error } = await supabase
      .from("processed_messages")
      .insert({
        message_id: messageId,
        owner_phone: ownerPhone || "unknown",
      })
      .select("message_id");

    if (!error) {
      console.log(`[Idempotency] Claimed wamid: ${messageId}`);
      return { claimed: true };
    }

    if (error.code === "23505") {
      console.log(`[Idempotency] Duplicate wamid (not claimed): ${messageId}`);
      return { claimed: false };
    }

    console.error("[Idempotency] tryClaimMessage failed:", error.message);
    return { claimed: true };
  } catch (err) {
    console.error("[Idempotency] Unexpected error in tryClaimMessage:", err.message);
    return { claimed: true };
  }
}

module.exports = { tryClaimMessage };
