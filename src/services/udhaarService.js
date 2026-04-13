const { supabase } = require("../config/supabase");
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

function normalizeCustomerName(customerName) {
  if (!customerName) return null;
  return String(customerName)
    .toLowerCase()
    .replace(/\b(ji|bhai|ben|devi|sahab|sir|mr|mrs|ms)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function logUdhaar({ customerName, amount }) {
  try {
    const { data, error } = await supabase
      .from("udhaar_logs")
      .insert([{
        customer_name: customerName,
        amount: Number(amount),
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

async function logWapas({ customerName, amount }) {
  try {
    const { data, error } = await supabase
      .from("udhaar_logs")
      .insert([{
        customer_name: customerName,
        amount: -Math.abs(Number(amount)),
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

async function getCustomerUdhaarTotal({ customerName }) {
  try {
    const normalizedSearchName = normalizeCustomerName(customerName);
    const { data, error } = await supabase
      .from("udhaar_logs")
      .select("customer_name,amount");

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

async function getTodayHisaab() {
  try {
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

async function saveCustomerPhone({ customerName, phone }) {
  try {
    const normalizedSearchName = normalizeCustomerName(customerName);
    const { data: existingRows, error: findError } = await supabase
      .from("customers")
      .select("id,customer_name");

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
        .eq("id", existing.id);

      if (updateError) {
        console.error('Supabase update failed:', updateError.message);
        throw new Error('Database error. Try again!');
      }
      return { id: existing.id, customer_name: customerName, phone_number: phone };
    }

    const { data, error } = await supabase
      .from("customers")
      .insert([{ customer_name: customerName, phone_number: phone }])
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

async function getCustomerPhone({ customerName }) {
  try {
    const normalizedSearchName = normalizeCustomerName(customerName);
    const { data, error } = await supabase
      .from("customers")
      .select("customer_name,phone_number");

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

async function getAllPendingUdhaar() {
  try {
    const { data, error } = await supabase
      .from("udhaar_logs")
      .select("customer_name,amount");

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

async function addInventoryStock({ itemName, quantity, unit }) {
  try {
    const normalizedItemName = String(itemName || "").trim().toLowerCase();
    const normalizedUnit = String(unit || "pieces").trim().toLowerCase();

    // Check if item exists first
    const { data: existing, error: findError } = await supabase
      .from("inventory")
      .select("id,item_name,quantity,unit,low_stock_threshold")
      .ilike("item_name", normalizedItemName)
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error('Supabase fetch failed:', findError.message);
      throw new Error('Database error. Try again!');
    }

    if (existing?.id) {
      // UPDATE existing quantity by adding
      const nextQuantity = Number(existing.quantity || 0) + Number(quantity || 0);
      const { data, error: updateError } = await supabase
        .from("inventory")
        .update({
          quantity: nextQuantity,
          unit: normalizedUnit || existing.unit || "pieces",
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (updateError) {
        console.error('Supabase update failed:', updateError.message);
        throw new Error('Database error. Try again!');
      }

      return data;
    } else {
      // INSERT new row
      const { data, error } = await supabase
        .from("inventory")
        .insert([{
          item_name: normalizedItemName,
          quantity: Number(quantity || 0),
          unit: normalizedUnit || "pieces",
          low_stock_threshold: DEFAULT_LOW_STOCK_THRESHOLD,
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

async function getInventoryStock({ itemName }) {
  try {
    const normalizedItemName = String(itemName || "").trim().toLowerCase();
    
    // Try exact match first
    const { data: exactData, error: exactError } = await supabase
      .from("inventory")
      .select("*")
      .eq("item_name", normalizedItemName)
      .limit(1)
      .maybeSingle();

    if (exactError) {
      console.error('Supabase fetch failed:', exactError.message);
      throw new Error('Database error. Try again!');
    }

    if (exactData) {
      return exactData;
    }

    // Try case-insensitive match
    const { data: ilikeData, error: ilikeError } = await supabase
      .from("inventory")
      .select("*")
      .ilike("item_name", normalizedItemName)
      .limit(1)
      .maybeSingle();

    if (ilikeError) {
      console.error('Supabase fetch failed:', ilikeError.message);
      throw new Error('Database error. Try again!');
    }

    if (ilikeData) {
      return ilikeData;
    }

    // Try fuzzy match
    const { data: fuzzyData, error: fuzzyError } = await supabase
      .from("inventory")
      .select("*")
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

async function getAllInventoryStock() {
  try {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
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

async function logExpense({ category, amount, description }) {
  try {
    const { data, error } = await supabase
      .from("expenses")
      .insert([{
        category: category || "general",
        amount: Number(amount),
        description: description || category,
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

async function getTodayExpenses() {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("expenses")
      .select("category,amount,description,created_at")
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

async function getMonthlyExpenses() {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("expenses")
      .select("category,amount,description,created_at")
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
