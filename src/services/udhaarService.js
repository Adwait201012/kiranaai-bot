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

async function getAllPendingUdhaar() {
  const { data, error } = await supabase
    .from("udhaar_logs")
    .select("customer_name,amount");

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  const totalsMap = new Map();
  for (const row of data || []) {
    const name = String(row.customer_name || "").trim();
    if (!name) {
      continue;
    }
    const amount = Number(row.amount || 0);
    const current = totalsMap.get(name) || 0;
    totalsMap.set(name, current + amount);
  }

  const customers = Array.from(totalsMap.entries())
    .map(([customerName, total]) => ({ customerName, total }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);

  const grandTotal = customers.reduce((sum, item) => sum + item.total, 0);

  return { customers, grandTotal };
}

async function addInventoryStock({ itemName, quantity, unit }) {
  const normalizedItemName = String(itemName || "").trim();
  const normalizedUnit = String(unit || "").trim();

  const { data: existing, error: findError } = await supabase
    .from("inventory")
    .select("id,item_name,quantity,unit")
    .ilike("item_name", normalizedItemName)
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw new Error(`Supabase fetch failed: ${findError.message}`);
  }

  if (existing?.id) {
    const nextQuantity = Number(existing.quantity || 0) + Number(quantity || 0);
    const { data, error: updateError } = await supabase
      .from("inventory")
      .update({
        item_name: existing.item_name || normalizedItemName,
        quantity: nextQuantity,
        unit: normalizedUnit || existing.unit || "",
      })
      .eq("id", existing.id)
      .select("item_name,quantity,unit")
      .single();

    if (updateError) {
      throw new Error(`Supabase update failed: ${updateError.message}`);
    }

    return data;
  }

  const { data, error } = await supabase
    .from("inventory")
    .insert([
      {
        item_name: normalizedItemName,
        quantity: Number(quantity || 0),
        unit: normalizedUnit,
      },
    ])
    .select("item_name,quantity,unit")
    .single();

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return data;
}

async function getInventoryStock({ itemName }) {
  const normalizedItemName = String(itemName || "").trim();
  const { data, error } = await supabase
    .from("inventory")
    .select("item_name,quantity,unit")
    .ilike("item_name", normalizedItemName)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  return data || null;
}

async function getAllInventoryStock() {
  const { data, error } = await supabase
    .from("inventory")
    .select("item_name,quantity,unit")
    .order("item_name", { ascending: true });

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  return data || [];
}

module.exports = {
  logUdhaar,
  logWapas,
  getCustomerUdhaarTotal,
  getTodayHisaab,
  saveCustomerPhone,
  getCustomerPhone,
  getAllPendingUdhaar,
  addInventoryStock,
  getInventoryStock,
  getAllInventoryStock,
};
