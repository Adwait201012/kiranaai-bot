const { supabase } = require("../config/supabase");
const { resolveShopId } = require("./shopService");
const { normalizeItemNameWithGroq } = require("./aiExtractionService");
const { distance } = require("fastest-levenshtein");
const { getISTDateRange } = require("../utils/istDate");
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

const HINDI_TRANSLITERATION_MAP = {
  "शर्मा": "sharma",
  "गुप्ता": "gupta",
  "वर्मा": "varma",
  "यादव": "yadav",
  "सिंह": "singh",
  "कुमार": "kumar",
  "जोशी": "joshi",
  "पटेल": "patel",
  "अग्रवाल": "agarwal",
  "तिवारी": "tiwari",
  "चौधरी": "chaudhary",
  "राम": "ram",
  "श्याम": "shyam",
  "राज": "raj",
  "सुरेश": "suresh",
  "रमेश": "ramesh",
  "महेश": "mahesh",
  "दिनेश": "dinesh",
  "मोहन": "mohan",
  "सोहन": "sohan",
  "जी": "ji",
  "भाई": "bhai",
  "देवी": "devi",
  "साहब": "sahab",
  "श्री": "shree"
};

function normalizeCustomerName(customerName) {
  if (!customerName) return null;
  
  let name = String(customerName);
  
  // Rule 1: Handle Hindi transliteration first
  Object.entries(HINDI_TRANSLITERATION_MAP).forEach(([hi, en]) => {
    name = name.split(hi).join(en);
  });

  return name
    .toLowerCase()
    // Rule 1: Remove honorifics (added 'g' as requested)
    .replace(/\b(ji|bhai|ben|behen|didi|sahab|sir|mr|mrs|ms|shree|g)\b/gi, " ")
    // Rule 1: Remove extra symbols but keep letters/numbers
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    // Rule 1: Remove extra spaces and trim
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Helper to determine if two normalized names match based on fuzzy rules.
 * Handles exact matches, partial matches, and Levenshtein distance (max 2).
 */
function isCustomerMatch(normalizedRow, normalizedSearch) {
  if (!normalizedRow || !normalizedSearch) return false;
  if (normalizedRow === normalizedSearch) return true;
  
  // Single letter or 2-letter names should NEVER fuzzy match to a different name.
  if (normalizedSearch.length <= 2 || normalizedRow.length <= 2) {
    return false;
  }
  
  // Rule 5: Levenshtein distance <= 2
  if (distance(normalizedRow, normalizedSearch) <= 2) return true;
  
  // Rule 3 & 4: Partial/Short name matching (includes)
  if (normalizedRow.includes(normalizedSearch) || normalizedSearch.includes(normalizedRow)) return true;
  
  return false;
}


async function resolveOwnerPhone(senderPhone) {
  try {
    const { data, error } = await supabase
      .from("shop_employees")
      .select("shop_owner_phone")
      .eq("employee_phone", senderPhone)
      .maybeSingle();

    if (error) {
      console.error('Supabase fetch failed for resolveOwnerPhone:', error.message);
      return senderPhone; // Fail-open: treat as own owner
    }

    // If found as an employee, return the shop owner's phone
    if (data && data.shop_owner_phone) {
      return data.shop_owner_phone;
    }

    // Not in shop_employees at all — return as-is (they may be unregistered)
    return senderPhone;
  } catch (error) {
    console.error('resolveOwnerPhone error:', error.message);
    return senderPhone;
  }
}

async function isShopRegistered(ownerPhone) {
  try {
    const ctx = await resolveShopId(ownerPhone);
    return !!ctx;
  } catch (error) {
    console.error("isShopRegistered error:", error.message);
    return false;
  }
}

async function getShopDetails(ownerPhone) {
  try {
    const ctx = await resolveShopId(ownerPhone);
    if (!ctx) return null;
    return { shop_name: ctx.shop_name };
  } catch (error) {
    console.error("getShopDetails error:", error.message);
    return null;
  }
}

async function registerShop({ ownerPhone, shopName }) {
  const trimmedName = String(shopName || "").trim();
  if (!trimmedName || trimmedName.length < 2) {
    return {
      success: false,
      message: "Dukaan ka naam kam se kam 2 characters ka hona chahiye.",
    };
  }

  try {
    const { data: existing } = await supabase
      .from("registered_shops")
      .select("id, shop_name")
      .eq("owner_phone", ownerPhone)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        message:
          `Aapki dukaan already registered hai: *${existing.shop_name}*\n` +
          `Join code ke liye likhein: "Join code do"`,
        shopName: existing.shop_name,
      };
    }

    const { data: shop, error: shopError } = await supabase
      .from("registered_shops")
      .insert({
        owner_phone: ownerPhone,
        shop_name: trimmedName,
      })
      .select()
      .single();

    if (shopError) {
      console.error("Shop insert error:", shopError.code, shopError.message, shopError.details);
      if (shopError.code === "23505") {
        return {
          success: false,
          message:
            "Aapka number pehle se registered hai. 'Join code do' likhein.",
        };
      }
      return {
        success: false,
        message: `❌ Registration nahi hua. Error: ${shopError.message}`,
      };
    }

    const { error: empError } = await supabase.from("shop_employees").insert({
      shop_id: shop.id,
      shop_owner_phone: ownerPhone,
      employee_phone: ownerPhone,
      employee_name: "Owner",
      is_owner: true,
    });

    if (empError) {
      console.error("Employee insert error:", empError.code, empError.message);
    }

    return {
      success: true,
      message:
        `✅ Dukaan registered!\n\n` +
        `🏪 Naam: *${shop.shop_name}*\n` +
        `📱 Aapka number: ${ownerPhone}\n\n` +
        `Employee add karne ke liye likhein: "Join code do"`,
      shopName: shop.shop_name,
    };
  } catch (error) {
    console.error("registerShop error:", error.message);
    return {
      success: false,
      message: `❌ Registration nahi hua. Error: ${error.message}`,
    };
  }
}

async function addEmployee({ ownerPhone, employeePhone, employeeName }) {
  try {
    const { data: shop, error: shopError } = await supabase
      .from("registered_shops")
      .select("id")
      .eq("owner_phone", ownerPhone)
      .single();

    if (shopError || !shop) {
      throw new Error("Pehle shop register karo.");
    }

    const { data, error } = await supabase
      .from("shop_employees")
      .insert([{
        shop_id: shop.id,
        shop_owner_phone: ownerPhone,
        employee_phone: employeePhone,
        employee_name: employeeName,
        is_owner: false,
      }])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert failed for addEmployee:', error.message);
      if (error.code === '23505') { // Unique violation
        throw new Error('Employee pehle se added hai!');
      }
      throw new Error('Database error. Try again!');
    }

    return data;
  } catch (error) {
    console.error('addEmployee error:', error.message);
    throw error;
  }
}

async function logUdhaar({ customerName, amount, ownerPhone, shopId, enteredBy }) {
  const roundedAmount = Math.round(Number(amount));
  if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
    console.error("logUdhaar rejected: invalid amount", amount);
    return { data: null, error: { message: "Invalid amount" } };
  }

  try {
    const { data, error } = await supabase
      .from("udhaar_logs")
      .insert([{
        customer_name: customerName,
        amount: roundedAmount,
        owner_phone: ownerPhone,
        shop_id: shopId || null,
        entered_by: enteredBy || ownerPhone,
      }])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert failed (logUdhaar):", error.message);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    console.error("logUdhaar error:", error.message);
    return { data: null, error };
  }
}

async function logWapas({ customerName, amount, ownerPhone, shopId, enteredBy }) {
  const roundedAmount = Math.round(Number(amount));
  if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
    console.error("logWapas rejected: invalid amount", amount);
    return { data: null, error: { message: "Invalid amount" } };
  }

  try {
    const { data, error } = await supabase
      .from("udhaar_logs")
      .insert([{
        customer_name: customerName,
        amount: -roundedAmount,
        owner_phone: ownerPhone,
        shop_id: shopId || null,
        entered_by: enteredBy || ownerPhone,
      }])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert failed (logWapas):", error.message);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    console.error("logWapas error:", error.message);
    return { data: null, error };
  }
}

function formatRupee(amount) {
  return Number(amount || 0).toLocaleString("en-IN");
}

function buildUdhaarTotalMessage(total) {
  const rounded = Math.round(Number(total) || 0);
  if (rounded < 0) {
    return (
      `📍 Advance/Overpayment: ₹${formatRupee(Math.abs(rounded))}\n` +
      `(Grahak ne zyada diya hai)`
    );
  }
  if (rounded === 0) {
    return `📍 Hisaab barabar! ✅ Koi udhaar nahi.`;
  }
  return `📍 Aapka Total Udhaar: ₹${formatRupee(rounded)}`;
}

function buildUdhaarSuccessReply({ customerName, amount, type, total }) {
  const totalMessage = buildUdhaarTotalMessage(total);
  const amountLabel = type === "credit" ? "Naya Udhaar" : "Wapas";
  return (
    `Done, ji! ✅\n\n` +
    `👤 Grahak: ${customerName}\n` +
    `💸 ${amountLabel}: ₹${formatRupee(amount)}\n` +
    `${totalMessage}\n\n` +
    `Hisaab note ho gaya! 🗒️`
  );
}

/**
 * Insert udhaar/wapas and return success reply. Caller must validate before calling.
 * Order: insert → on failure return error (no success reply) → fetch total → Done ji.
 */
async function handleUdhaar({
  customerName,
  displayName,
  amount,
  type,
  ownerPhone,
  shopId,
  enteredBy,
  insertFn,
}) {
  const { error: insertError } = await insertFn({
    customerName,
    amount,
    ownerPhone,
    shopId,
    enteredBy,
  });

  if (insertError) {
    console.error("handleUdhaar insert failed:", insertError.message);
    return {
      success: false,
      message: "❌ Hisaab save nahi hua. Dobara try karein.",
    };
  }

  let total;
  try {
    total = await getCustomerUdhaarTotal({ customerName, ownerPhone });
  } catch (fetchErr) {
    console.error("handleUdhaar total fetch failed:", fetchErr.message);
    return {
      success: false,
      saved: true,
      message:
        "✅ Entry save hui, lekin total fetch nahi hua. 'Sabka udhaar dikhao' likh kar check karein.",
    };
  }

  const nameForReply = displayName || customerName;
  return {
    success: true,
    total,
    message: buildUdhaarSuccessReply({
      customerName: nameForReply,
      amount,
      type,
      total,
    }),
  };
}

async function getCustomerUdhaarTotal({ customerName, ownerPhone }) {
  try {
    const canonicalName = String(customerName || "").trim();
    if (!canonicalName) {
      return 0;
    }

    const { data, error } = await supabase
      .from("udhaar_logs")
      .select("amount")
      .eq("owner_phone", ownerPhone)
      .eq("customer_name", canonicalName);

    if (error) {
      console.error("Supabase fetch failed:", error.message);
      throw new Error("Database error. Try again!");
    }

    return (data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  } catch (error) {
    console.error("getCustomerUdhaarTotal error:", error.message);
    throw error;
  }
}

async function getTodayHisaab({ ownerPhone }) {
  try {
    const { startISO, endISO } = getISTDateRange();

    console.log(`[getTodayHisaab] IST range UTC: ${startISO} → ${endISO} owner=${ownerPhone}`);

    const { data: udhaarData, error: udhaarError } = await supabase
      .from("udhaar_logs")
      .select("amount, created_at")
      .eq("owner_phone", ownerPhone)
      .gte("created_at", startISO)
      .lte("created_at", endISO);

    if (udhaarError) {
      console.error("Supabase fetch failed (udhaar_logs):", udhaarError.message);
      return { error: true, message: "❌ Summary fetch nahi hui. Dobara try karein." };
    }

    const rows = udhaarData || [];

    if (rows.length === 0) {
      return {
        isEmpty: true,
        entryCount: 0,
        newUdhaar: 0,
        wapasReceived: 0,
        netUdhaar: 0,
      };
    }

    const newUdhaar = rows
      .filter((row) => Number(row.amount || 0) > 0)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const wapasReceived = rows
      .filter((row) => Number(row.amount || 0) < 0)
      .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);

    const netUdhaar = newUdhaar - wapasReceived;

    return {
      isEmpty: false,
      entryCount: rows.length,
      newUdhaar,
      wapasReceived,
      netUdhaar,
    };
  } catch (error) {
    console.error("getTodayHisaab error:", error.message);
    return { error: true, message: "❌ Summary fetch nahi hui. Dobara try karein." };
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
      return isCustomerMatch(normalizedRowName, normalizedSearchName);
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
      return isCustomerMatch(normalizedRowName, normalizedSearchName);
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
      if (!originalName || originalName.length <= 2) {
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

    const allCustomers = Array.from(totalsMap.entries())
      .map(([normalizedName, total]) => ({ 
        customerName: originalNameMap.get(normalizedName) || normalizedName, 
        total 
      }))
      .filter((item) => item.total !== 0);

    const customers = allCustomers.filter(c => c.total > 0).sort((a, b) => b.total - a.total);
    const overpaidCustomers = allCustomers.filter(c => c.total < 0).sort((a, b) => a.total - b.total);

    const grandTotal = customers.reduce((sum, item) => sum + item.total, 0);

    return { customers, overpaidCustomers, grandTotal };
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
    const { startISO, endISO } = getISTDateRange();

    const { data, error } = await supabase
      .from("expenses")
      .select("category,amount,description,created_at")
      .eq("owner_phone", ownerPhone)
      .gte("created_at", startISO)
      .lte("created_at", endISO)
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

async function getMonthlyHisaab({ ownerPhone }) {
  try {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(Date.now() + IST_OFFSET_MS);
    const year = nowIST.getUTCFullYear();
    const month = nowIST.getUTCMonth();

    // IST 1st of month midnight → UTC
    const startOfMonth = new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS);
    // IST last day of month 23:59:59.999 → UTC
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const endOfMonth = new Date(Date.UTC(year, month, lastDay.getUTCDate(), 23, 59, 59, 999) - IST_OFFSET_MS);

    const { data, error } = await supabase
      .from("udhaar_logs")
      .select("customer_name,amount,created_at")
      .eq("owner_phone", ownerPhone)
      .gte("created_at", startOfMonth.toISOString())
      .lte("created_at", endOfMonth.toISOString());

    if (error) {
      console.error('Supabase fetch failed in getMonthlyHisaab:', error.message);
      throw new Error('Database error. Try again!');
    }

    const rows = data || [];
    const totalUdhaar = rows
      .filter(row => Number(row.amount || 0) > 0)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const totalWapas = rows
      .filter(row => Number(row.amount || 0) < 0)
      .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);

    const netPending = totalUdhaar - totalWapas;
    
    // Count unique customers using normalized names
    const uniqueCustomers = new Set();
    rows.forEach(row => {
      if (row.customer_name) {
        uniqueCustomers.add(normalizeCustomerName(row.customer_name));
      }
    });

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    return {
      totalUdhaar,
      totalWapas,
      netPending,
      uniqueCustomerCount: uniqueCustomers.size,
      monthName: monthNames[month]
    };
  } catch (error) {
    console.error('getMonthlyHisaab error:', error.message);
    throw error;
  }
}

async function getMonthlyExpenses({ ownerPhone }) {
  try {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(Date.now() + IST_OFFSET_MS);
    const year = nowIST.getUTCFullYear();
    const month = nowIST.getUTCMonth();

    // IST 1st of month midnight → UTC
    const startOfMonth = new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS);
    // IST last day of month 23:59:59.999 → UTC
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const endOfMonth = new Date(Date.UTC(year, month, lastDay.getUTCDate(), 23, 59, 59, 999) - IST_OFFSET_MS);

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

// Business data only — NEVER delete shops or shop_employees (owner would lose access).
const TABLES_TO_RESET = [
  { name: "udhaar_logs", ownerCol: "owner_phone" },
  { name: "inventory", ownerCol: "owner_phone" },
  { name: "expenses", ownerCol: "owner_phone" },
  { name: "customers", ownerCol: "owner_phone" },
];

async function deleteAllOwnerData({ ownerPhone }) {
  try {
    const shopDetails = await getShopDetails(ownerPhone);

    const results = await Promise.all(
      TABLES_TO_RESET.map(({ name, ownerCol }) =>
        supabase.from(name).delete().eq(ownerCol, ownerPhone)
      )
    );

    const errors = results.map((r) => r.error).filter(Boolean);
    if (errors.length > 0) {
      console.error(
        "deleteAllOwnerData partial errors:",
        errors.map((e) => e.message)
      );
      throw new Error("Database error during delete. Try again!");
    }

    console.log(`[RESET] Business data deleted for owner: ${ownerPhone}`);
    return { shopName: shopDetails?.shop_name || null };
  } catch (error) {
    console.error("deleteAllOwnerData error:", error.message);
    throw error;
  }
}

/**
 * Returns balance info for a single customer.
 * { found: boolean, balance: number, displayName: string }
 * Uses the same fuzzy normalizeCustomerName matching as getCustomerUdhaarTotal.
 */
async function getCustomerBalance({ customerName, ownerPhone }) {
  try {
    const normalizedSearch = normalizeCustomerName(customerName);

    const { data, error } = await supabase
      .from("udhaar_logs")
      .select("customer_name,amount")
      .eq("owner_phone", ownerPhone);

    if (error) {
      console.error('Supabase fetch failed in getCustomerBalance:', error.message);
      throw new Error('Database error. Try again!');
    }

    const rows = (data || []).filter((row) => {
      const normalizedRow = normalizeCustomerName(row.customer_name);
      return isCustomerMatch(normalizedRow, normalizedSearch);
    });

    if (!rows.length) {
      return { found: false, balance: 0, displayName: customerName };
    }

    // Use the first original name encountered as the display name
    const displayName = String(rows[0].customer_name || customerName).trim();
    const balance = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

    return { found: true, balance, displayName };
  } catch (error) {
    console.error('getCustomerBalance error:', error.message);
    throw error;
  }
}

async function getLastEntries({ ownerPhone, limit = 3, customerName = null, enteredBy = null }) {
  try {
    let query = supabase
      .from("udhaar_logs")
      .select("customer_name,amount,created_at")
      .eq("owner_phone", ownerPhone)
      .order("created_at", { ascending: false });

    if (enteredBy) {
      query = query.eq("entered_by", enteredBy);
    }

    if (customerName) {
      // If customerName provided, fetch more to allow for fuzzy filtering locally
      const { data, error } = await query.limit(50);
      if (error) {
        console.error('Supabase fetch failed in getLastEntries:', error.message);
        throw new Error('Database error. Try again!');
      }

      const normalizedSearch = normalizeCustomerName(customerName);
      const filtered = (data || []).filter(entry => {
        const normalizedEntry = normalizeCustomerName(entry.customer_name);
        return isCustomerMatch(normalizedEntry, normalizedSearch);
      });
      return filtered.slice(0, limit);
    } else {
      const { data, error } = await query.limit(limit);
      if (error) {
        console.error('Supabase fetch failed in getLastEntries:', error.message);
        throw new Error('Database error. Try again!');
      }
      return data || [];
    }
  } catch (error) {
    console.error('getLastEntries error:', error.message);
    throw error;
  }
}

async function searchCustomersByName({ customerName, ownerPhone }) {
  try {
    const normalizedSearch = normalizeCustomerName(customerName);
    
    const { data, error } = await supabase
      .from("customers")
      .select("id,customer_name,phone_number")
      .eq("owner_phone", ownerPhone);

    if (error) {
      console.error('Supabase fetch failed in searchCustomersByName:', error.message);
      throw new Error('Database error. Try again!');
    }

    const matched = (data || []).filter((row) => {
      const normalizedRow = normalizeCustomerName(row.customer_name);
      return isCustomerMatch(normalizedRow, normalizedSearch);
    });

    return matched;
  } catch (error) {
    console.error('searchCustomersByName error:', error.message);
    throw error;
  }
}

async function createCustomer({ customerName, phone = null, ownerPhone }) {
  try {
    const { data, error } = await supabase
      .from("customers")
      .insert([{ customer_name: customerName, phone_number: phone, owner_phone: ownerPhone }])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert failed in createCustomer:', error.message);
      throw new Error('Database error. Try again!');
    }

    return data;
  } catch (error) {
    console.error('createCustomer error:', error.message);
    throw error;
  }
}

async function deductInventoryStock({ itemName, quantity, ownerPhone }) {
  try {
    const stock = await getInventoryStock({ itemName, ownerPhone });
    if (!stock) {
      return { status: "NOT_FOUND", item: null };
    }

    const currentQty = Number(stock.quantity || 0);
    const requestedQty = Number(quantity || 0);

    if (currentQty < requestedQty) {
      return { status: "INSUFFICIENT", item: stock };
    }

    const nextQty = currentQty - requestedQty;

    const { data, error } = await supabase
      .from("inventory")
      .update({ quantity: nextQty })
      .eq("id", stock.id)
      .eq("owner_phone", ownerPhone)
      .select("*")
      .single();

    if (error) {
      console.error('Supabase update failed:', error.message);
      throw new Error('Database error. Try again!');
    }

    return { status: "SUCCESS", item: data };
  } catch (error) {
    console.error('deductInventoryStock error:', error.message);
    throw error;
  }
}

module.exports = {
  logUdhaar,
  logWapas,
  handleUdhaar,
  buildUdhaarSuccessReply,
  buildUdhaarTotalMessage,
  getCustomerUdhaarTotal,
  getCustomerBalance,
  getLastEntries,
  getTodayHisaab,
  getMonthlyHisaab,
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
  deleteAllOwnerData,
  resolveOwnerPhone,
  addEmployee,
  isShopRegistered,
  getShopDetails,
  registerShop,
  searchCustomersByName,
  createCustomer,
  deductInventoryStock,
};
