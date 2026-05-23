"use strict";

const { supabase } = require("../config/supabase");

const SESSION_TTL_MS = 10 * 60 * 1000;

/** Stable key for pending_sessions.phone (matches webhook ownerWaId format). */
function normalizeSessionPhone(phone) {
  const raw = String(phone || "").trim();
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

async function getSession(phone) {
  const normalizedPhone = normalizeSessionPhone(phone);
  if (!normalizedPhone) return null;

  try {
    const { data, error } = await supabase
      .from("pending_sessions")
      .select("phone, session_type, session_data, created_at")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (error) {
      console.error(
        "[pendingSession] getSession failed:",
        JSON.stringify(error)
      );
      return null;
    }

    if (!data) return null;

    // Session TTL check must use created_at < now() - interval '10 minutes'
    const isExpired = new Date(data.created_at) < new Date(Date.now() - 10 * 60 * 1000);
    if (isExpired) {
      await deleteSession(normalizedPhone);
      return null;
    }

    return data;
  } catch (err) {
    console.error("[pendingSession] getSession error:", err.message);
    return null;
  }
}

async function setSession(phone, sessionType, sessionData) {
  const normalizedPhone = normalizeSessionPhone(phone);
  if (!normalizedPhone || !sessionType) return false;

  try {
    const { error } = await supabase.from("pending_sessions").upsert(
      {
        phone: normalizedPhone,
        session_type: sessionType,
        session_data: sessionData || {},
        created_at: new Date().toISOString(),
      },
      { onConflict: "phone" }
    );

    if (error) {
      console.error(
        "[pendingSession] setSession failed:",
        JSON.stringify(error)
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[pendingSession] setSession error:", err.message);
    return false;
  }
}

async function deleteSession(phone) {
  const normalizedPhone = normalizeSessionPhone(phone);
  if (!normalizedPhone) return;

  try {
    const { error } = await supabase
      .from("pending_sessions")
      .delete()
      .eq("phone", normalizedPhone);
    if (error) {
      console.error(
        "[pendingSession] deleteSession failed:",
        JSON.stringify(error)
      );
    }
  } catch (err) {
    console.error("[pendingSession] deleteSession error:", err.message);
  }
}

module.exports = {
  getSession,
  setSession,
  deleteSession,
  normalizeSessionPhone,
  SESSION_TTL_MS,
};
