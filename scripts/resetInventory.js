/**
 * resetInventory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Safely resets one or more Supabase tables for a given owner phone.
 *
 * Usage:
 *   node scripts/resetInventory.js                        # inventory only
 *   node scripts/resetInventory.js --all                  # inventory + udhaar_logs + expenses
 *   node scripts/resetInventory.js --phone +919999999999  # target specific owner
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 *   (use the service-role key so RLS is bypassed for admin ops)
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const path = require("path");
const readline = require("readline");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { createClient } = require("@supabase/supabase-js");

// ── ENV ───────────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
// Prefer service-role key for admin scripts (bypasses RLS)
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ── CLI ARGS ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const resetAll = args.includes("--all");
const phoneIdx = args.indexOf("--phone");
const targetPhone = phoneIdx !== -1 ? args[phoneIdx + 1] : null;

// Business data only — NEVER add shops or shop_employees here.
// Deleting shops = owner loses bot access permanently.
const TABLES_TO_RESET = [
  { name: "udhaar_logs", ownerCol: "owner_phone" },
  { name: "inventory", ownerCol: "owner_phone" },
  { name: "expenses", ownerCol: "owner_phone" },
];

const TABLES = resetAll
  ? TABLES_TO_RESET
  : [{ name: "inventory", ownerCol: "owner_phone" }];

// ── CONFIRMATION PROMPT ───────────────────────────────────────────────────────
function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── NULL-SAFE DELETE ──────────────────────────────────────────────────────────
// .neq() skips NULLs in Postgres. Instead we use .gte('id', 0) or a raw
// RPC/filter trick. The safest approach with supabase-js is filtering on the
// primary-key column (id) which is always non-null.
async function deleteAllRows(tableName, ownerCol, ownerPhone) {
  let query = supabase
    .from(tableName)
    .delete({ count: "exact" })
    // id is always non-null → every row matches this tautology
    .not("id", "is", null);

  if (ownerPhone) {
    query = query.eq(ownerCol, ownerPhone);
  }

  const { error, count } = await query;

  if (error) {
    throw new Error(`[${tableName}] ${error.message}`);
  }

  return count ?? 0;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n⚠️   BharatBahi — Database Reset Utility");
  console.log("════════════════════════════════════════");
  if (targetPhone) {
    console.log(`🎯  Target owner : ${targetPhone}`);
  } else {
    console.log("🎯  Target       : ALL owners (no --phone filter)");
  }
  console.log(`📋  Tables       : ${TABLES.map((t) => t.name).join(", ")}`);
  console.log("");

  const warning = targetPhone
    ? `This will permanently delete ALL rows for owner "${targetPhone}" in the listed tables.`
    : "⚡ NO OWNER FILTER — this will delete EVERY row in the listed tables for ALL owners.";

  console.warn("⚠️  " + warning);
  console.log("");

  // Ask user to type the exact confirmation phrase
  const CONFIRM_PHRASE = "HAAN DELETE KARO";
  const answer = await confirm(
    `Type "${CONFIRM_PHRASE}" to confirm, or anything else to cancel:\n> `
  );

  if (answer !== CONFIRM_PHRASE) {
    console.log("\n🛑  Cancelled — no data was deleted.");
    process.exit(0);
  }

  console.log("\n⏳  Deleting…\n");

  let hasError = false;
  for (const { name, ownerCol } of TABLES) {
    try {
      const deleted = await deleteAllRows(name, ownerCol, targetPhone);
      console.log(`✅  ${name.padEnd(20)} — ${deleted} row(s) deleted`);
    } catch (err) {
      console.error(`❌  ${name.padEnd(20)} — FAILED: ${err.message}`);
      hasError = true;
    }
  }

  console.log("\n" + (hasError ? "⚠️  Completed with errors." : "🚀  All done — fresh start!"));
  process.exit(hasError ? 1 : 0);
}

main();
