const { supabase } = require("../config/supabase");

async function logUdhaar({ customerName, amount }) {
  const { data, error } = await supabase
    .from("udhaar_logs")
    .insert([
      {
        customer_name: customerName,
        amount,
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return data;
}

async function logWapas({ customerName, amount }) {
  const { data, error } = await supabase
    .from("udhaar_logs")
    .insert([
      {
        customer_name: customerName,
        amount: -Math.abs(amount),
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return data;
}

async function getCustomerUdhaarTotal({ customerName }) {
  const { data, error } = await supabase
    .from("udhaar_logs")
    .select("amount")
    .ilike("customer_name", customerName);

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  const total = (data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return total;
}

async function getTodayHisaab() {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("udhaar_logs")
    .select("amount,created_at")
    .gte("created_at", startOfDay.toISOString())
    .lte("created_at", endOfDay.toISOString());

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  const rows = data || [];
  const newUdhaar = rows
    .filter((row) => Number(row.amount || 0) > 0)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const wapasReceived = rows
    .filter((row) => Number(row.amount || 0) < 0)
    .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);

  const netUdhaar = newUdhaar - wapasReceived;

  return {
    newUdhaar,
    wapasReceived,
    netUdhaar,
  };
}

async function saveCustomerPhone({ customerName, phone }) {
  const { data: existing, error: findError } = await supabase
    .from("customers")
    .select("id")
    .ilike("customer_name", customerName)
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw new Error(`Supabase fetch failed: ${findError.message}`);
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("customers")
      .update({ customer_name: customerName, phone_number: phone })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Supabase update failed: ${updateError.message}`);
    }
    return { id: existing.id, customer_name: customerName, phone_number: phone };
  }

  const { data, error } = await supabase
    .from("customers")
    .insert([{ customer_name: customerName, phone_number: phone }])
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return data;
}

async function getCustomerPhone({ customerName }) {
  const { data, error } = await supabase
    .from("customers")
    .select("phone_number")
    .ilike("customer_name", customerName)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  return data?.phone_number || null;
}

module.exports = {
  logUdhaar,
  logWapas,
  getCustomerUdhaarTotal,
  getTodayHisaab,
  saveCustomerPhone,
  getCustomerPhone,
};
