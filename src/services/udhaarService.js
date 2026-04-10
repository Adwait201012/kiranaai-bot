const { supabase } = require("../config/supabase");
const INVENTORY_TABLE = "inventory";
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bji\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesSimilar(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) {
    return false;
  }
  return x === y || x.includes(y) || y.includes(x);
}

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
    .select("customer_name,amount");

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  const total = (data || [])
    .filter((row) => namesSimilar(row.customer_name, customerName))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
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
  const { data: existingRows, error: findError } = await supabase
    .from("customers")
    .select("id,customer_name");

  if (findError) {
    throw new Error(`Supabase fetch failed: ${findError.message}`);
  }

  const existing = (existingRows || []).find((row) =>
    namesSimilar(row.customer_name, customerName),
  );
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
    .select("customer_name,phone_number");

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  const matched = (data || []).find((row) => namesSimilar(row.customer_name, customerName));
  return matched?.phone_number || null;
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

  const { data: existingExact, error: findExactError } = await supabase
    .from(INVENTORY_TABLE)
    .select("id,item_name,quantity,unit")
    .ilike("item_name", normalizedItemName)
    .limit(1)
    .maybeSingle();

  if (findExactError) {
    throw new Error(`Supabase fetch failed: ${findExactError.message}`);
  }

  let existing = existingExact;
  if (!existing?.id) {
    const { data: existingFuzzy, error: findFuzzyError } = await supabase
      .from(INVENTORY_TABLE)
      .select("id,item_name,quantity,unit")
      .ilike("item_name", `%${normalizedItemName}%`)
      .limit(1)
      .maybeSingle();
    if (findFuzzyError) {
      throw new Error(`Supabase fetch failed: ${findFuzzyError.message}`);
    }
    existing = existingFuzzy;
  }

  if (existing?.id) {
    const nextQuantity = Number(existing.quantity || 0) + Number(quantity || 0);
    const { data, error: updateError } = await supabase
      .from(INVENTORY_TABLE)
      .update({
        item_name: existing.item_name || normalizedItemName,
        quantity: nextQuantity,
        unit: normalizedUnit || existing.unit || "pieces",
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(`Supabase update failed: ${updateError.message}`);
    }

    return data;
  }

  const { data, error } = await supabase
    .from(INVENTORY_TABLE)
    .insert([
      {
        item_name: normalizedItemName,
        quantity: Number(quantity || 0),
        unit: normalizedUnit || "pieces",
      },
    ])
    .select("*")
    .single();

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return data;
}

async function getInventoryStock({ itemName }) {
  const normalizedItemName = String(itemName || "").trim();
  const { data: exactData, error: exactError } = await supabase
    .from(INVENTORY_TABLE)
    .select("*")
    .ilike("item_name", normalizedItemName)
    .limit(1)
    .maybeSingle();

  if (exactError) {
    throw new Error(`Supabase fetch failed: ${exactError.message}`);
  }

  if (exactData) {
    return exactData;
  }

  const { data: fuzzyData, error: fuzzyError } = await supabase
    .from(INVENTORY_TABLE)
    .select("*")
    .ilike("item_name", `%${normalizedItemName}%`)
    .limit(1)
    .maybeSingle();

  if (fuzzyError) {
    throw new Error(`Supabase fetch failed: ${fuzzyError.message}`);
  }

  return fuzzyData || null;
}

async function getAllInventoryStock() {
  const { data, error } = await supabase
    .from(INVENTORY_TABLE)
    .select("*")
    .order("item_name", { ascending: true });

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  return data || [];
}

function getLowStockAlertInfo(row) {
  const quantity = Number(row?.quantity || 0);
  const threshold = Number(row?.low_stock_threshold);
  const safeThreshold = Number.isFinite(threshold) ? threshold : DEFAULT_LOW_STOCK_THRESHOLD;
  return {
    isLow: quantity < safeThreshold,
    quantity,
    threshold: safeThreshold,
    unit: String(row?.unit || "pieces").trim() || "pieces",
    itemName: String(row?.item_name || "").trim(),
  };
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
  getLowStockAlertInfo,
};
