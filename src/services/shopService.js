const { supabase } = require("../config/supabase");

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getOrCreateJoinCode(ownerPhone) {
  const { data: shop } = await supabase
    .from("registered_shops")
    .select("id, join_code, join_code_expires_at, shop_name")
    .eq("owner_phone", ownerPhone)
    .single();

  if (!shop) {
    return { error: "Shop not found. Please register first." };
  }

  const now = new Date();
  if (shop.join_code && new Date(shop.join_code_expires_at) > now) {
    const expiresIn = Math.ceil(
      (new Date(shop.join_code_expires_at) - now) / (1000 * 60 * 60)
    );
    return {
      code: shop.join_code,
      shopName: shop.shop_name,
      expiresInHours: expiresIn,
    };
  }

  let code;
  let attempts = 0;
  do {
    code = generateJoinCode();
    attempts++;
    if (attempts > 10) return { error: "Code generation failed." };
    const { data: existing } = await supabase
      .from("registered_shops")
      .select("id")
      .eq("join_code", code)
      .maybeSingle();
    if (!existing) break;
  } while (true);

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const { error: updateError } = await supabase
    .from("registered_shops")
    .update({
      join_code: code,
      join_code_expires_at: expiresAt.toISOString(),
    })
    .eq("owner_phone", ownerPhone);

  if (updateError) {
    return { error: "Code save nahi hua: " + updateError.message };
  }

  return {
    code,
    shopName: shop.shop_name,
    expiresInHours: 48,
  };
}

async function requestJoinShop(employeePhone, employeeName, joinCode) {
  const upperCode = joinCode.toUpperCase().trim();

  const { data: shop } = await supabase
    .from("registered_shops")
    .select("id, owner_phone, shop_name, join_code_expires_at")
    .eq("join_code", upperCode)
    .single();

  if (!shop) {
    return {
      error:
        "Yeh code galat hai ya expire ho gaya. Owner se naya code maangein.",
    };
  }

  if (new Date(shop.join_code_expires_at) < new Date()) {
    return {
      error: "Yeh join code expire ho gaya hai. Owner se naya code maangein.",
    };
  }

  const { data: existing } = await supabase
    .from("shop_employees")
    .select("id")
    .eq("shop_id", shop.id)
    .eq("employee_phone", employeePhone)
    .maybeSingle();

  if (existing) {
    return { error: "Aap pehle se is shop mein joined hain." };
  }

  const { data: pending } = await supabase
    .from("pending_join_requests")
    .select("id, status")
    .eq("shop_id", shop.id)
    .eq("employee_phone", employeePhone)
    .maybeSingle();

  if (pending?.status === "pending") {
    return {
      error:
        "Aapki request already pending hai. Owner ke approve karne ka wait karein.",
    };
  }

  const { error: upsertError } = await supabase
    .from("pending_join_requests")
    .upsert(
      {
        shop_id: shop.id,
        employee_phone: employeePhone,
        employee_name: employeeName || "Employee",
        status: "pending",
      },
      { onConflict: "shop_id,employee_phone" }
    );

  if (upsertError) {
    return { error: "Request save nahi hui: " + upsertError.message };
  }

  return {
    success: true,
    shopName: shop.shop_name,
    ownerPhone: shop.owner_phone,
  };
}

async function handleJoinApproval(ownerPhone, employeePhone, approved) {
  const { data: shop } = await supabase
    .from("registered_shops")
    .select("id, shop_name")
    .eq("owner_phone", ownerPhone)
    .single();

  if (!shop) return { error: "Shop not found." };

  const { data: request } = await supabase
    .from("pending_join_requests")
    .select("*")
    .eq("shop_id", shop.id)
    .eq("employee_phone", employeePhone)
    .eq("status", "pending")
    .single();

  if (!request) return { error: "Koi pending request nahi mili." };

  if (approved) {
    const { error } = await supabase.from("shop_employees").insert({
      shop_id: shop.id,
      shop_owner_phone: ownerPhone,
      employee_phone: employeePhone,
      employee_name: request.employee_name,
      is_owner: false,
    });
    if (error) return { error: "Employee add nahi hua: " + error.message };
  }

  await supabase
    .from("pending_join_requests")
    .update({
      status: approved ? "approved" : "rejected",
    })
    .eq("id", request.id);

  return {
    success: true,
    approved,
    employeeName: request.employee_name,
    shopName: shop.shop_name,
  };
}

async function ensureOwnerEmployeeRow(shop) {
  const { data: emp } = await supabase
    .from("shop_employees")
    .select("id")
    .eq("shop_id", shop.id)
    .eq("employee_phone", shop.owner_phone)
    .maybeSingle();

  if (emp) return;

  const { error } = await supabase.from("shop_employees").insert({
    shop_id: shop.id,
    shop_owner_phone: shop.owner_phone,
    employee_phone: shop.owner_phone,
    employee_name: "Owner",
    is_owner: true,
  });
  if (error) {
    console.error("ensureOwnerEmployeeRow failed:", error.message);
  }
}

async function resolveShopId(senderPhone) {
  const { data: ownedShop } = await supabase
    .from("registered_shops")
    .select("id, shop_name, owner_phone")
    .eq("owner_phone", senderPhone)
    .maybeSingle();
  if (ownedShop) {
    await ensureOwnerEmployeeRow(ownedShop);
    return {
      id: ownedShop.id,
      shop_name: ownedShop.shop_name,
      owner_phone: ownedShop.owner_phone,
      role: "owner",
    };
  }

  const { data: empRecord } = await supabase
    .from("shop_employees")
    .select("shop_id, shop_owner_phone, registered_shops(shop_name)")
    .eq("employee_phone", senderPhone)
    .maybeSingle();
  if (empRecord) {
    return {
      id: empRecord.shop_id,
      owner_phone: empRecord.shop_owner_phone,
      shop_name: empRecord.registered_shops?.shop_name,
      role: "employee",
    };
  }

  return null;
}

module.exports = {
  getOrCreateJoinCode,
  requestJoinShop,
  handleJoinApproval,
  resolveShopId,
};
