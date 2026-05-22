const cron = require("node-cron");
const { supabase } = require("../config/supabase");
const { sendTextMessage } = require("../services/whatsappService");
const {
  getTodayHisaab,
  getAllPendingUdhaar,
} = require("../services/udhaarService");

// 9:00 AM IST = 3:30 AM UTC → "30 3 * * *"
// 9:00 PM IST = 3:30 PM UTC → "30 15 * * *"

function formatRupee(amount) {
  return Number(amount || 0).toLocaleString("en-IN");
}

async function getAllOwners() {
  const { data, error } = await supabase
    .from("registered_shops")
    .select("owner_phone, shop_name");

  if (error) {
    console.error("getAllOwners failed:", error.message);
    return [];
  }
  return data || [];
}

/** @returns {[string, number][] | null} customer name + positive balance */
async function getPendingUdhaar(ownerPhone) {
  try {
    const { customers } = await getAllPendingUdhaar({ ownerPhone });
    if (!customers.length) return null;
    return customers.map((c) => [c.customerName, c.total]);
  } catch (err) {
    console.error("getPendingUdhaar failed:", err.message);
    return null;
  }
}

async function getTodaySummary(ownerPhone) {
  try {
    const summary = await getTodayHisaab({ ownerPhone });
    if (summary.error) return null;
    if (summary.isEmpty) {
      return { newUdhaar: 0, wapas: 0, entries: 0, net: 0 };
    }
    return {
      newUdhaar: summary.newUdhaar,
      wapas: summary.wapasReceived,
      entries: summary.entryCount,
      net: summary.netUdhaar,
    };
  } catch (err) {
    console.error("getTodaySummary failed:", err.message);
    return null;
  }
}

async function sendMorningMessages() {
  console.log("[Scheduled] Running morning messages...");
  const owners = await getAllOwners();

  for (const { owner_phone, shop_name } of owners) {
    try {
      const pending = await getPendingUdhaar(owner_phone);
      const shopLabel = shop_name || "Dukaan";

      let msg = `🌅 Suprabhat, ${shopLabel}!\n\n`;
      msg += `BharatBahi aapke saath hai aaj bhi. 🙏\n\n`;

      if (!pending || pending.length === 0) {
        msg += `✅ Koi pending udhaar nahi hai!\n`;
        msg += `Aaj ka din accha rahega. 😊`;
      } else {
        const totalPending = pending.reduce((s, [, bal]) => s + bal, 0);
        msg += `📋 Pending Udhaar Summary:\n`;
        msg += `💰 Total Pending: ₹${formatRupee(totalPending)}\n\n`;

        pending.slice(0, 5).forEach(([name, bal]) => {
          msg += `• ${name}: ₹${formatRupee(bal)}\n`;
        });

        if (pending.length > 5) {
          msg += `...aur ${pending.length - 5} aur grahak\n`;
        }

        msg += `\n💡 Aaj collections pe focus karein!`;
      }

      await sendTextMessage({ to: owner_phone, text: msg });

      const { data: employees, error: empError } = await supabase
        .from("shop_employees")
        .select("employee_phone")
        .eq("shop_owner_phone", owner_phone)
        .eq("is_owner", false);

      if (empError) {
        console.error(`Employee fetch failed for ${owner_phone}:`, empError.message);
        continue;
      }

      for (const emp of employees || []) {
        const empMsg =
          `🌅 Suprabhat!\n\n` +
          `Aaj bhi ${shopLabel} ke liye mehnat karte rahein. 💪\n` +
          `Koi bhi udhaar add karne ke liye seedha likh dein!`;
        await sendTextMessage({ to: emp.employee_phone, text: empMsg });
      }
    } catch (err) {
      console.error(`Morning message failed for ${owner_phone}:`, err.message);
    }
  }
}

async function sendEveningMessages() {
  console.log("[Scheduled] Running evening messages...");
  const owners = await getAllOwners();

  for (const { owner_phone, shop_name } of owners) {
    try {
      const summary = await getTodaySummary(owner_phone);
      const pending = await getPendingUdhaar(owner_phone);
      const totalPending = pending
        ? pending.reduce((s, [, bal]) => s + bal, 0)
        : 0;
      const shopLabel = shop_name || "Dukaan";

      let msg = `🌙 Shubh Sham, ${shopLabel}!\n\n`;
      msg += `📊 Aaj Ka Hisaab:\n`;
      msg += `━━━━━━━━━━━━━━\n`;

      if (!summary || summary.entries === 0) {
        msg += `Aaj koi entry nahi hui.\n`;
      } else {
        msg += `💸 Naya Udhaar: ₹${formatRupee(summary.newUdhaar)}\n`;
        msg += `✅ Wapas Mila: ₹${formatRupee(summary.wapas)}\n`;
        msg += `📝 Total Entries: ${summary.entries}\n`;

        if (summary.net > 0) {
          msg += `📍 Aaj Net Udhaar: ₹${formatRupee(summary.net)}\n`;
        } else if (summary.net < 0) {
          msg += `📍 Aaj Net Collection: ₹${formatRupee(Math.abs(summary.net))}\n`;
        } else {
          msg += `📍 Aaj Hisaab Barabar! ✅\n`;
        }
      }

      msg += `\n💰 Total Pending Udhaar: ₹${formatRupee(totalPending)}\n`;
      msg += `\nKal phir milenge! 🙏 BharatBahi`;

      await sendTextMessage({ to: owner_phone, text: msg });
    } catch (err) {
      console.error(`Evening message failed for ${owner_phone}:`, err.message);
    }
  }
}

function startScheduledJobs() {
  cron.schedule("30 3 * * *", sendMorningMessages, { timezone: "UTC" });
  cron.schedule("30 15 * * *", sendEveningMessages, { timezone: "UTC" });

  console.log("Scheduled jobs started:");
  console.log("  Morning: 9:00 AM IST");
  console.log("  Evening: 9:00 PM IST");
}

module.exports = {
  startScheduledJobs,
  sendMorningMessages,
  sendEveningMessages,
};
