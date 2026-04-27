const { supabase } = require("../config/supabase");
const { normalizeItemNameWithGroq } = require("./aiExtractionService");
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

// Words that Groq sometimes incorrectly extracts as a unit — always invalid
const INVALID_UNITS = new Set([
  "aaya", "aai", "aya", "mila", "mili", "aaye", "laya", "laye",
  "diya", "diye", "liya", "liye", "hua", "hui", "hue",
  "received", "bought", "added", "came", "arrived",
  "null", "undefined", "none", "n/a", ""
]);

// Sanitize a unit string: reject verbs/junk, fall back to "pieces"
function sanitizeUnit(unit) {
  const raw = String(unit || "").trim().toLowerCase();
  if (INVALID_UNITS.has(raw)) {
    return "pieces";
  }
  return raw || "pieces";
}

function normalizeCustomerName(customerName) {
  if (!customerName) return null;
  return String(customerName)
    .toLowerCase()
    .replace(/\b(ji|bhai|ben|devi|sahab|sir|mr|mrs|ms)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function logUdhaar({ customerName, amount, ownerPhone }) {
  try {
    const { data, error } = await supabase
      .from("udhaar_logs")
      .insert([{
        customer_name: customerName,
        amount: Number(amount),
        owner_phone: ownerPhone,
      }])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert failed:', error.message);
      throw new Error('Database error. Try again!');
    }

    return data;
  } catch (error) {
    console.error('logUdhaar error:', error.message);
    throw error;
  }
}

async function logWapas({ customerName, amount, ownerPhone }) {
  try {
    const { data, error } = await supabase
      .from("udhaar_logs")
      .insert([{
        customer_name: customerName,
        amount: -Math.abs(Number(amount)),
        owner_phone: ownerPhone,
      }])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert failed:', error.message);
      throw new Error('Database error. Try again!');
    }

    return data;
  } catch (error) {
    console.error('logWapas error:', error.message);
    throw error;
  }
}

async function getCustomerUdhaarTotal({ customerName, ownerPhone }) {
  try {
    const normalizedSearchName = normalizeCustomerName(customerName);
    const { data, error } = await supabase
      .from("udhaar_logs")
      .select("customer_name,amount")
      .eq("owner_phone", ownerPhone);

    if (error) {
      console.error('Supabase fetch failed:', error.message);
      throw new Error('Database error. Try again!');
    }

    const total = (data || [])
      .filter((row) => {
        const normalizedRowName = normalizeCustomerName(row.customer_name);
        return normalizedRowName === normalizedSearchName || 
               normalizedRowName.includes(normalizedSearchName) || 
               normalizedSearchName.includes(normalizedRowName);
      })
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return total;
  } catch (error) {
    console.error('getCustomerUdhaarTotal error:', error.message);
    throw error;
  }
}

async function getTodayHisaab({ ownerPhone }) {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("udhaar_logs")
      .select("amount,created_at")
      .eq("owner_phone", ownerPhone)
      .gte("created_at", startOfDay.toISOString())
      .lte("created_at", endOfDay.toISOString());

    if (error) {
      console.error('Supabase fetch failed:', error.message);
      throw new Error('Database error. Try again!');
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
  } catch (error) {
    console.error('getTodayHisaab error:', error.message);
    throw error;
  }
}

async function saveCustomerPhone({ customerName, phone, ownerPhone }) {
  try {
    const normalizedSearchName = normalizeCustomerName(customerName);
    const { data: existingRows, error: findError } = await supabase
      .from("customers")
      .select("id,customer_name")
      .eq("owner_phone", ownerPhone);

    if (findError) {
      console.error('Supabase fetch failed:', findError.message);
      throw new Error('Database error. Try again!');
    }

    const existing = (existingRows || []).find((row) => {
      const normalizedRowName = normalizeCustomerName(row.customer_name);
      return normalizedRowName === normalizedSearchName || 
             normalizedRowName.includes(normalizedSearchName) || 
             normalizedSearchName.includes(normalizedRowName);
    });
    
    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("customers")
        .update({ customer_name: customerName, phone_number: phone })
        .eq("id", existing.id)
        .eq("owner_phone", ownerPhone);

      if (updateError) {
        console.error('Supabase update failed:', updateError.message);
        throw new Error('Database error. Try again!');
      }
      return { id: existing.id, customer_name: customerName, phone_number: phone };
    }

    const { data, error } = await supabase
      .from("customers")
      .insert([{ customer_name: customerName, phone_number: phone, owner_phone: ownerPhone }])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert failed:', error.message);
      throw new Error('Database error. Try again!');
    }

    return data;
  } catch (error) {
    console.error('saveCustomerPhone error:', error.message);
    throw error;
  }
}

async function getCustomerPhone({ customerName, ownerPhone }) {
  try {
    const normalizedSearchName = normalizeCustomerName(customerName);
    const { data, error } = await supabase
      .from("customers")
      .select("customer_name,phone_number")
      .eq("owner_phone", ownerPhone);

    if (error) {
      console.error('Supabase fetch failed:', error.message);
      throw new Error('Database error. Try again!');
    }

    const matched = (data || []).find((row) => {
      const normalizedRowName = normalizeCustomerName(row.customer_name);
      return normalizedRowName === normalizedSearchName || 
             normalizedRowName.includes(normalizedSearchName) || 
             normalizedSearchName.includes(normalizedRowName);
    });
    return matched?.phone_number || null;
  } catch (error) {
    console.error('getCustomerPhone error:', error.message);
    throw error;
  }
}

async function getAllPendingUdhaar({ ownerPhone }) {
  try {
    const { data, error } = await supabase
      .from("udhaar_logs")
      .select("customer_name,amount,created_at")
      .eq("owner_phone", ownerPhone)
      .order("created_at", { ascending: false });

    if (error) {
      console.error('Supabase fetch failed:', error.message);
      throw new Error('Database error. Try again!');
    }

    const totalsMap = new Map();
    const originalNameMap = new Map();
    
    for (const row of data || []) {
      const originalName = String(row.customer_name || "").trim();
      if (!originalName) {
        continue;
      }
      
      const normalizedName = normalizeCustomerName(originalName);
      const amount = Number(row.amount || 0);
      
      // Group by normalized name but keep track of original names
      const current = totalsMap.get(normalizedName) || 0;
      totalsMap.set(normalizedName, current + amount);
      
      // Store the first original name we encounter for this normalized name
      if (!originalNameMap.has(normalizedName)) {
        originalNameMap.set(normalizedName, originalName);
      }
    }

    const customers = Array.from(totalsMap.entries())
      .map(([normalizedName, total]) => ({ 
        customerName: originalNameMap.get(normalizedName) || normalizedName, 
        total 
      }))
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total);

    const grandTotal = customers.reduce((sum, item) => sum + item.total, 0);

    return { customers, grandTotal };
  } catch (error) {
    console.error('getAllPendingUdhaar error:', error.message);
    throw error;
  }
}

async function addInventoryStock({ itemName, quantity, unit, ownerPhone }) {
  try {
    // Step 1: Normalize via Groq FIRST — before any DB operation
    // Both "lays red packet chips" and "lal red packet chips lays" → "lays red"
    const normalizedItemName = await normalizeItemNameWithGroq(itemName) ||
      String(itemName || "").trim().toLowerCase();

    // Sanitize unit: reject Hindi verbs (aaya, mila, etc.) and other non-unit words
    const normalizedUnit = sanitizeUnit(unit);

    console.log(`[Inventory] ADD → raw: "${itemName}" → normalized: "${normalizedItemName}", qty: ${quantity}, unit: ${normalizedUnit}`);

    // Step 2: Search Supabase using the normalized name (ilike for case-insensitive exact match)
    // Since the DB always stores normalized names, this exact ilike will reliably match
    const { data: existing, error: findError } = await supabase
      .from("inventory")
      .select("id,item_name,quantity,unit,low_stock_threshold")
      .eq("owner_phone", ownerPhone)
      .ilike("item_name", normalizedItemName)
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error('Supabase fetch failed:', findError.message);
      throw new Error('Database error. Try again!');
    }

    if (existing?.id) {
      // Step 3a: Found → UPDATE quantity (item_name stays as the canonical normalized name)
      const nextQuantity = Number(existing.quantity || 0) + Number(quantity || 0);
      console.log(`[Inventory] MERGE → existing "${existing.item_name}" (id:${existing.id}), qty ${existing.quantity} + ${quantity} = ${nextQuantity}`);

      const { data, error: updateError } = await supabase
        .from("inventory")
        .update({
          quantity: nextQuantity,
          unit: normalizedUnit || existing.unit || "pieces",
        })
        .eq("id", existing.id)
        .eq("owner_phone", ownerPhone)
        .select("*")
        .single();

      if (updateError) {
        console.error('Supabase update failed:', updateError.message);
        throw new Error('Database error. Try again!');
      }

      return data;
    } else {
      // Step 3b: Not found → INSERT with normalized name (NEVER raw user input)
      console.log(`[Inventory] INSERT → new item "${normalizedItemName}" qty: ${quantity}`);

      const { data, error } = await supabase
        .from("inventory")
        .insert([{
          item_name: normalizedItemName,   // Always the short normalized name
          quantity: Number(quantity || 0),
          unit: normalizedUnit || "pieces",
          low_stock_threshold: DEFAULT_LOW_STOCK_THRESHOLD,
          owner_phone: ownerPhone,
        }])
        .select("*")
        .single();

      if (error) {
        console.error('Supabase insert failed:', error.message);
        throw new Error('Database error. Try again!');
      }

      return data;
    }
  } catch (error) {
    console.error('addInventoryStock error:', error.message);
    throw error;
  }
}

async function getInventoryStock({ itemName, ownerPhone }) {
  try {
    // Step 1: Normalize via Groq — same normalization as addInventoryStock
    // ensures CHECK_STOCK resolves any variant to the canonical stored name
    const normalizedItemName = await normalizeItemNameWithGroq(itemName) ||
      String(itemName || "").trim().toLowerCase();

    console.log(`[Inventory] CHECK → raw: "${itemName}" → normalized: "${normalizedItemName}"`);

    // Step 2: ilike exact match on normalized name (DB always stores normalized names)
    const { data: ilikeData, error: ilikeError } = await supabase
      .from("inventory")
      .select("*")
      .eq("owner_phone", ownerPhone)
      .ilike("item_name", normalizedItemName)
      .limit(1)
      .maybeSingle();

    if (ilikeError) {
      console.error('Supabase fetch failed:', ilikeError.length);
      throw new Error('Database error. Try again!');
    }

    if (ilikeData) {
      return ilikeData;
    }

    // Fallback: partial fuzzy match (e.g. user says "lays" and DB has "lays red")
    const { data: fuzzyData, error: fuzzyError } = await supabase
      .from("inventory")
      .select("*")
      .eq("owner_phone", ownerPhone)
      .ilike("item_name", `%${normalizedItemName}%`)
      .limit(1)
      .maybeSingle();

    if (fuzzyError) {
      console.error('Supabase fetch failed:', fuzzyError.message);
      throw new Error('Database error. Try again!');
    }

    return fuzzyData || null;
  } catch (error) {
    console.error('getInventoryStock error:', error.message);
    throw error;
  }
}

async function getAllInventoryStock({ ownerPhone }) {
  try {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .eq("owner_phone", ownerPhone)
      .order("item_name", { ascending: true });

    if (error) {
      console.error('Supabase fetch failed:', error.message);
      throw new Error('Database error. Try again!');
    }

    return data || [];
  } catch (error) {
    console.error('getAllInventoryStock error:', error.message);
    throw error;
  }
}

function getLowStockAlertInfo(row) {
  try {
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
  } catch (error) {
    console.error('getLowStockAlertInfo error:', error.message);
    return {
      isLow: false,
      quantity: 0,
      threshold: DEFAULT_LOW_STOCK_THRESHOLD,
      unit: "pieces",
      itemName: "",
    };
  }
}

async function logExpense({ category, amount, description, ownerPhone }) {
  try {
    const { data, error } = await supabase
      .from("expenses")
      .insert([{
        category: category || "general",
        amount: Number(amount),
        description: description || category,
        owner_phone: ownerPhone,
      }])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert failed:', error.message);
      throw new Error('Database mein dikkat hai, 1 minute mein try karo!');
    }

    return data;
  } catch (error) {
    console.error('logExpense error:', error.message);
    throw error;
  }
}

async function getTodayExpenses({ ownerPhone }) {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("expenses")
      .select("category,amount,description,created_at")
      .eq("owner_phone", ownerPhone)
      .gte("created_at", startOfDay.toISOString())
      .lte("created_at", endOfDay.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error('Supabase fetch failed:', error.message);
      throw new Error('Database mein dikkat hai, 1 minute mein try karo!');
    }

    const expenses = data || [];
    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    
    return {
      expenses,
      total,
      count: expenses.length
    };
  } catch (error) {
    console.error('getTodayExpenses error:', error.message);
    throw error;
  }
}

async function getMonthlyExpenses({ ownerPhone }) {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("expenses")
      .select("category,amount,description,created_at")
      .eq("owner_phone", ownerPhone)
      .gte("created_at", startOfMonth.toISOString())
      .lte("created_at", endOfMonth.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error('Supabase fetch failed:', error.message);
      throw new Error('Database mein dikkat hai, 1 minute mein try karo!');
    }

    const expenses = data || [];
    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    
    // Group by category
    const categoryTotals = expenses.reduce((acc, expense) => {
      const category = expense.category || 'general';
      acc[category] = (acc[category] || 0) + Number(expense.amount || 0);
      return acc;
    }, {});
    
    return {
      expenses,
      total,
      count: expenses.length,
      categoryTotals
    };
  } catch (error) {
    console.error('getMonthlyExpenses error:', error.message);
    throw error;
  }
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
  normalizeCustomerName,
  logExpense,
  getTodayExpenses,
  getMonthlyExpenses,
};
