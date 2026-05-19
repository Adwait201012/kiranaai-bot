/**
 * idempotency.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents duplicate processing of WhatsApp webhook messages.
 *
 * Use tryClaimMessage() once at the start of the handler (atomic INSERT).
 * If the row already exists, ignoreDuplicates returns no rows → duplicate delivery.
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
 * Atomically claim a wamid before processing. Safe under concurrent deliveries.
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
      .upsert(
        {
          message_id: messageId,
          owner_phone: ownerPhone || "unknown",
        },
        { onConflict: "message_id", ignoreDuplicates: true }
      )
      .select("message_id");

    if (error) {
      console.error("[Idempotency] tryClaimMessage failed:", error.message);
      return { claimed: true };
    }

    const claimed = Array.isArray(data) && data.length > 0;
    if (claimed) {
      console.log(`[Idempotency] Claimed wamid: ${messageId}`);
    } else {
      console.log(`[Idempotency] Duplicate wamid (not claimed): ${messageId}`);
    }
    return { claimed };
  } catch (err) {
    console.error("[Idempotency] Unexpected error in tryClaimMessage:", err.message);
    return { claimed: true };
  }
}

module.exports = { tryClaimMessage };
