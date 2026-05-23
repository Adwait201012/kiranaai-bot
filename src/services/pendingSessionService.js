"use strict";

const { supabase } = require("../config/supabase");

const SESSION_TTL_MS = 10 * 60 * 1000;

async function getSession(phone) {
  if (!phone) return null;

  try {
    const { data, error } = await supabase
      .from("pending_sessions")
      .select("phone, session_type, session_data, created_at")
      .eq("phone", phone)
      .maybeSingle();

    if (error) {
      console.error("[pendingSession] getSession failed:", error.message);
      return null;
    }

    if (!data) return null;

    const age = Date.now() - new Date(data.created_at).getTime();
    if (age > SESSION_TTL_MS) {
      await deleteSession(phone);
      return null;
    }

    return data;
  } catch (err) {
    console.error("[pendingSession] getSession error:", err.message);
    return null;
  }
}

async function setSession(phone, sessionType, sessionData) {
  if (!phone || !sessionType) return false;

  try {
    const { error } = await supabase.from("pending_sessions").upsert(
      {
        phone,
        session_type: sessionType,
        session_data: sessionData || {},
        created_at: new Date().toISOString(),
      },
      { onConflict: "phone" }
    );

    if (error) {
      console.error("[pendingSession] setSession failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[pendingSession] setSession error:", err.message);
    return false;
  }
}

async function deleteSession(phone) {
  if (!phone) return;

  try {
    const { error } = await supabase.from("pending_sessions").delete().eq("phone", phone);
    if (error) {
      console.error("[pendingSession] deleteSession failed:", error.message);
    }
  } catch (err) {
    console.error("[pendingSession] deleteSession error:", err.message);
  }
}

module.exports = {
  getSession,
  setSession,
  deleteSession,
  SESSION_TTL_MS,
};
