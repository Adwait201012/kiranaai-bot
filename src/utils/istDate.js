"use strict";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns UTC Date bounds for "today" in India (IST).
 * Use startUTC/endUTC in Supabase .gte/.lte on timestamptz columns.
 */
function getISTDateRange() {
  const now = new Date();
  const nowIST = new Date(now.getTime() + IST_OFFSET_MS);

  const startOfDayIST = new Date(nowIST);
  startOfDayIST.setUTCHours(0, 0, 0, 0);

  const endOfDayIST = new Date(nowIST);
  endOfDayIST.setUTCHours(23, 59, 59, 999);

  const startUTC = new Date(startOfDayIST.getTime() - IST_OFFSET_MS);
  const endUTC = new Date(endOfDayIST.getTime() - IST_OFFSET_MS);

  return { startUTC, endUTC, startISO: startUTC.toISOString(), endISO: endUTC.toISOString() };
}

module.exports = { getISTDateRange, IST_OFFSET_MS };
