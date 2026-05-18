const {
  detectIntent,
  detectLanguage,
} = require("../services/aiExtractionService");
const {
  logUdhaar,
  logWapas,
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
} = require("../services/udhaarService");
const { sendTextMessage } = require("../services/whatsappService");
const {
  isAudioMedia,
  transcribeTwilioAudio,
} = require("../services/audioTranscriptionService");
const { isAlreadyProcessed, markAsProcessed } = require("../utils/idempotency");

// In-memory map to track users who have requested data deletion and are pending confirmation.
// Key: owner WhatsApp ID, Value: { timestamp: Date.now(), language: string }
// Entries expire after 2 minutes to prevent stale confirmations.
const pendingDeleteConfirmation = new Map();
const DELETE_CONFIRM_PHRASE = "HAAN DELETE KARO";
const DELETE_CONFIRM_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

// In-memory map for two-step shop registration flow.
// Key: senderPhone (ownerWaId), Value: { timestamp: Date.now() }
// Once a user sends a registration trigger, we ask for shop name;
// their NEXT message is treated as the shop name.
const pendingShopName = new Map();
const REGISTRATION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// In-memory map for disambiguation sessions.
// Key: ownerWaId, Value: { timestamp, options: [], pendingAction: { intent, customerName, amount } }
const pendingDisambiguation = new Map();
const DISAMBIGUATION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// Regex to detect registration intent without calling Groq
const REGISTRATION_TRIGGER_RE =
  /\b(register\s*karo|shop\s*add\s*karo|shuru\s*karo|register|start)\b/i;

const verifyWebhook = (req, res) => {
  res.status(200).send("Twilio webhook is active");
};

function formatAmount(value) {
  const numberValue = Number(value || 0);
  return Number.isInteger(numberValue)
    ? String(numberValue)
    : numberValue.toFixed(2);
}

function normalizeCustomerPhone(phone) {
  const raw = String(phone || "").trim();
  if (raw.startsWith("+")) {
    return raw;
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return `+${digits}`;
}

function formatUnit(quantity, unit, language) {
  let u = String(unit || "").trim();
  if (!u) return "";
  
  if (language === 'english' && Number(quantity) > 1) {
    if (u === 'packet') u = 'packets';
    else if (u === 'piece') u = 'pieces';
    else if (u === 'box') u = 'boxes';
    else if (u === 'bottle') u = 'bottles';
  }
  
  return ` ${u}`;
}

function displayName(name) {
  const honorifics = ['ji', 'bhai', 'sahab', 'sir'];
  const lastName = String(name || '').trim().split(' ').pop().toLowerCase();
  if (honorifics.includes(lastName)) return name;
  return name + ' ji';
}

// Hardcoded reply templates based on language
const TEMPLATES = {
  hinglish: {
    GREETING: "Namaste! 🙏 Main BharatBahi hun.\n\nBas likho — main samajh lunga.\n\n'Sharma ji 500 udhaar' ya 'aaj ka hisaab' —\nseedha kaam shuru karo.",
    LOG_UDHAAR: "✅ Done!\n👤 {name}\n💸 Udhaar: ₹{amount}\n📌 Total: ₹{total}",
    CHECK_UDHAAR: "👤 {name}\n💰 Baaki: ₹{total}",
    LOG_WAPAS: "✅ Payment!\n👤 {name}\n💵 Wapas: ₹{amount}\n📌 Baaki: ₹{remaining}",
    TODAY_HISAAB: "📊 Aaj ka hisaab\n💸 Naya Udhaar: ₹{newUdhaar}\n✅ Wapas mila: ₹{wapasReceived}\n📌 Net pending aaj: ₹{netPending}\n💰 Kharcha: ₹{totalExpenses}",
    SABKA_UDHAAR: "👥 Sabka udhaar:\n{list}\n💰 Total: ₹{total}",
    INVENTORY_ADD: "📦 Stock updated!\n🏷️ {item}\n➕ Added: {qty}{unit}\n📊 Total: {total}{unit}",
    CHECK_STOCK: "📦 {item}\n📊 Stock: {qty}{unit}",
    ALL_STOCK: "📋 Sabka stock:\n{list}",
    LOW_STOCK: "⚠️ Low stock!\n🏷️ {item}: sirf {qty}{unit} bacha!",
    SAVE_NUMBER: "✅ {name} ka number save!",
    SEND_REMINDER: "📞 {name} ko call karo ya WhatsApp karo:\n{phone}\n\nUnka baaki: ₹{total}\nMessage bhej sakte ho:\n'{shopName} se — aapka ₹{total} udhaar baaki hai. Thoda time milne par de dena 🙏'",
    REMINDER_NOT_FOUND: "{name} ka number save nahi hai.\nPehle save karo: '{name} number 9876543210'",
    LOG_EXPENSE: "✅ Kharcha noted!\n💸 {category}: ₹{amount}\n📌 Aaj ka total kharcha: ₹{total}",
    CHECK_EXPENSE: "💸 Kharcha summary:\n{list}\n📌 Total: ₹{total}",
    RESET_CONFIRM: "⚠️ Kya aap sure hain? Aapka SABKA data delete ho jayega.\nConfirm karne ke liye 'HAAN DELETE KARO' bhejo",
    RESET_DONE: "✅ Aapka sabka data delete ho gaya! Fresh start!",
    RESET_CANCEL: "Delete cancel kar diya! Aapka data safe hai ✅",
    UNKNOWN: "🤔 Samajh nahi aaya. Hi bhejo to main sab features dikhaunga!",
    ERRORS: {
      NETWORK: "Network issue, try again!",
      DATABASE: "Kuch gadbad ho gayi, dobara try karo 🙏",
      NAME_REQUIRED: "Customer name required!",
      AMOUNT_REQUIRED: "Amount required!",
      ITEM_REQUIRED: "Item name required!",
      QUANTITY_REQUIRED: "Quantity required!",
      PHONE_REQUIRED: "Phone number required!",
    }
  },
  english: {
    GREETING: "👋 Hello! I am BharatBahi — your WhatsApp business assistant!\nI work for all types of businesses 🏪\n💰 Log credit — Sharma ji 500 udhaar\n🔍 Check credit — Sharma ji kitna udhaar\n✅ Payment received — Sharma ji 200 wapas\n� Add stock — chawal 50kg aaya\n📉 Check stock — chawal kitna hai\n� All stock — sabka stock dikhao\n� Log expense — bijli bill 500 diya\n� Today summary — aaj ka hisaab\n� All credit — sabka udhaar dikhao\n📱 Save number — Sharma ji number 9876543210\n🔔 Reminder — Sharma ji ko remind karo\nHindi, English or voice — whatever works for you! 🎙️",
    LOG_UDHAAR: "✅ Done!\n👤 {name}\n💸 Credit: ₹{amount}\n📌 Total: ₹{total}",
    CHECK_UDHAAR: "👤 {name}\n💰 Pending: ₹{total}",
    LOG_WAPAS: "✅ Payment received!\n👤 {name}\n💵 Paid: ₹{amount}\n📌 Remaining: ₹{remaining}",
    TODAY_HISAAB: "📊 Today's summary\n💸 New Credit: ₹{newUdhaar}\n✅ Received: ₹{wapasReceived}\n📌 Net pending today: ₹{netPending}\n💰 Expenses: ₹{totalExpenses}",
    SABKA_UDHAAR: "👥 All credit:\n{list}\n💰 Total: ₹{total}",
    INVENTORY_ADD: "📦 Stock updated!\n🏷️ {item}\n➕ Added: {qty}{unit}\n📊 Total: {total}{totalUnit}",
    CHECK_STOCK: "Stock: {qty}{unit}",
    ALL_STOCK: "📋 All stock:\n{list}",
    LOW_STOCK: "⚠️ Low stock!\n🏷️ {item}: only {qty}{unit} left!",
    SAVE_NUMBER: "✅ {name} number saved!",
    SEND_REMINDER: "✅ Reminder sent to {name}!\n💰 Credit: ₹{total}",
    LOG_EXPENSE: "✅ Expense noted!\n💸 {category}: ₹{amount}\n📌 Today's total expense: ₹{total}",
    CHECK_EXPENSE: "💸 Expense summary:\n{list}\n📌 Total: ₹{total}",
    RESET_CONFIRM: "⚠️ Are you sure? ALL your data will be deleted.\nTo confirm, send 'HAAN DELETE KARO'",
    RESET_DONE: "✅ All your data has been deleted! Fresh start!",
    RESET_CANCEL: "Delete cancelled! Your data is safe ✅",
    UNKNOWN: "🤔 Could not understand. Send 'hi' to see all features!",
    ERRORS: {
      NETWORK: "Network issue, try again!",
      DATABASE: "Kuch gadbad ho gayi, dobara try karo 🙏",
      NAME_REQUIRED: "Customer name required!",
      AMOUNT_REQUIRED: "Amount required!",
      ITEM_REQUIRED: "Item name required!",
      QUANTITY_REQUIRED: "Quantity required!",
      PHONE_REQUIRED: "Phone number required!",
      AUDIO_UNCLEAR: "Awaaz saaf nahi aayi, dobara bhejo 🎤",
    }
  },
  hindi: {
    GREETING: "👋 नमस्ते! मैं BharatBahi हूं — आपका WhatsApp business assistant!\nमैं हर तरह की दुकान के लिए काम करता हूं 🏪\n💰 उधार लॉग — शर्मा जी 500 उधार\n🔍 उधार चेक — शर्मा जी कितना उधार\n✅ पेमेंट लिया — शर्मा जी 200 वापस\n📦 स्टॉक जोड़ें — चावल 50kg आया\n📉 स्टॉक चेक — चावल कितना है\n📋 सबका स्टॉक — सबका स्टॉक दिखाओ\n💸 खर्चा लॉग — बिजली बिल 500 दिया\n📊 आज का हिसाब — आज का हिसाब\n👥 सबका उधार — सबका उधार दिखाओ\n📱 नंबर सेव — शर्मा जी number 9876543210\n🔔 रिमाइंडर — शर्मा जी को remind करो\nहिंदी, अंग्रेजी या voice — जो भी आपको आसान लगे! 🎙️",
    LOG_UDHAAR: "✅ हो गया!\n👤 {name}\n💸 उधार: ₹{amount}\n📌 कुल: ₹{total}",
    CHECK_UDHAAR: "👤 {name}\n💰 बाकी: ₹{total}",
    LOG_WAPAS: "✅ पेमेंट प्राप्त!\n👤 {name}\n💵 वापस: ₹{amount}\n📌 बाकी: ₹{remaining}",
    TODAY_HISAAB: "📊 आज का हिसाब\n💸 नया उधार: ₹{newUdhaar}\n✅ वापस मिला: ₹{wapasReceived}\n📌 नेट बाकी आज: ₹{netPending}\n💰 खर्चा: ₹{totalExpenses}",
    SABKA_UDHAAR: "👥 सबका उधार:\n{list}\n💰 कुल: ₹{total}",
    INVENTORY_ADD: "📦 स्टॉक अपडेटेड!\n🏷️ {item}\n➕ जोड़ा: {qty}{unit}\n📊 कुल: {total}{unit}",
    CHECK_STOCK: "📦 {item}\n📊 स्टॉक: {qty}{unit}",
    ALL_STOCK: "📋 सबका स्टॉक:\n{list}",
    LOW_STOCK: "⚠️ कम स्टॉक!\n🏷️ {item}: सिर्फ {qty}{unit} बचा है!",
    SAVE_NUMBER: "✅ {name} का नंबर सेव!",
    SEND_REMINDER: "📞 {name} को कॉल या WhatsApp करें:\n{phone}\n\nउनका बाकी: ₹{total}\nमैसेज भेज सकते हैं:\n'{shopName} से — आपका ₹{total} उधार बाकी है। थोड़ा टाइम मिलने पर दे देना 🙏'",
    REMINDER_NOT_FOUND: "{name} का नंबर सेव नहीं है।\nपहले सेव करें: '{name} number 9876543210'",
    LOG_EXPENSE: "✅ खर्चा नोट किया!\n💸 {category}: ₹{amount}\n📌 आज का कुल खर्चा: ₹{total}",
    CHECK_EXPENSE: "💸 खर्चा सारांश:\n{list}\n📌 कुल: ₹{total}",
    RESET_CONFIRM: "⚠️ क्या आप पक्के हैं? आपका सारा डेटा डिलीट हो जाएगा।\nConfirm करने के लिए 'HAAN DELETE KARO' भेजें",
    RESET_DONE: "✅ आपका सारा डेटा डिलीट हो गया! नई शुरुआत!",
    RESET_CANCEL: "डिलीट कैंसिल! आपका डेटा सुरक्षित है ✅",
    UNKNOWN: "🤔 समझ नहीं आया। हाय भेजें तो मैं सभी फीचर्स दिखाऊंगा!",
    ERRORS: {
      NETWORK: "Network issue, try again!",
      DATABASE: "Kuch gadbad ho gayi, dobara try karo 🙏",
      NAME_REQUIRED: "ग्राहक नाम आवश्यक!",
      AMOUNT_REQUIRED: "राशि आवश्यक!",
      ITEM_REQUIRED: "आइटम नाम आवश्यक!",
      QUANTITY_REQUIRED: "मात्रा आवश्यक!",
      PHONE_REQUIRED: "फोन नंबर आवश्यक!",
      AUDIO_UNCLEAR: "आवाज़ साफ़ नहीं आयी, दोबारा भेजें 🎤",
    }
  }
};

function getTemplate(language, key, params = {}) {
  const lang = TEMPLATES[language] || TEMPLATES.hinglish;
  let template = lang[key] || lang.UNKNOWN;
  
  // Replace parameters in template
  for (const [key, value] of Object.entries(params)) {
    template = template.replace(new RegExp(`{${key}}`, 'g'), value);
  }
  
  return template;
}

function getErrorTemplate(language, errorKey) {
  const lang = TEMPLATES[language] || TEMPLATES.hinglish;
  return lang.ERRORS[errorKey] || lang.ERRORS.NETWORK;
}

async function receiveWebhook(req, res) {
  // Twilio expects quick 200 response to acknowledge webhook.
  res.status(200).send("ok");

  try {
    const ownerWaId = req.body?.From;
    const incomingText = String(req.body?.Body || "").trim();
    const mediaContentType = req.body?.MediaContentType0;
    const mediaUrl = req.body?.MediaUrl0;
    // WhatsApp message ID for idempotency (Twilio wraps this in SmsMessageSid / MessageSid)
    const messageId = req.body?.MessageSid || req.body?.SmsMessageSid || null;

    // ── IDEMPOTENCY CHECK ─────────────────────────────────────────
    if (messageId && await isAlreadyProcessed(messageId)) {
      console.log(`[Idempotency] Duplicate message ${messageId} — skipping`);
      return;
    }

    let text = incomingText;

    // Handle audio messages
    if (isAudioMedia(mediaContentType) && mediaUrl) {
      try {
        const transcribedText = await transcribeTwilioAudio({
          mediaUrl,
          mediaContentType,
        });
        text = transcribedText;
        if (!text || text.length < 2) {
          await sendTextMessage({
            to: ownerWaId,
            text: getErrorTemplate(language || 'hinglish', 'AUDIO_UNCLEAR')
          });
          return;
        }
      } catch (error) {
        console.error('Audio transcription failed:', error.message);
        await sendTextMessage({
          to: ownerWaId,
          text: getErrorTemplate('hinglish', 'NETWORK')
        });
        return;
      }
    }

    if (!ownerWaId || !text) {
      return;
    }

    const resolvedOwnerPhone = await resolveOwnerPhone(ownerWaId);

    // Mark message as processed now that we've validated it has content
    if (messageId) await markAsProcessed(messageId, ownerWaId);

    // ── REGISTRATION GATE ─────────────────────────────────────────
    // Step A: If user is mid-registration (we asked for shop name), treat
    //         their next message as the shop name.
    if (pendingShopName.has(ownerWaId)) {
      const pending = pendingShopName.get(ownerWaId);
      pendingShopName.delete(ownerWaId); // always clear, one-shot

      if (Date.now() - pending.timestamp > REGISTRATION_EXPIRY_MS) {
        await sendTextMessage({
          to: ownerWaId,
          text: "Registration timeout ho gayi. Dobara 'Register karo' bhejo."
        });
        return;
      }

      // Apply title-case to shop name (Fix 3)
      const rawShopName = text.trim();
      if (!rawShopName) {
        await sendTextMessage({
          to: ownerWaId,
          text: "Shop ka naam nahi mila. Dobara 'Register karo' bhejo aur phir shop ka naam bhejo."
        });
        return;
      }

      const shopName = rawShopName
        .split(" ")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

      try {
        await registerShop({ ownerPhone: ownerWaId, shopName });
        await sendTextMessage({
          to: ownerWaId,
          text: getTemplate('hinglish', 'GREETING')
        });
      } catch (err) {
        await sendTextMessage({
          to: ownerWaId,
          text: err.message || "Registration nahi ho payi. Dobara try karo."
        });
      }
      return;
    }

    // Step B: Check if this owner_phone is registered at all.
    //         Employees resolve to their owner's phone, so a registered
    //         employee will pass this gate automatically.
    const registered = await isShopRegistered(resolvedOwnerPhone);
    if (!registered) {
      if (REGISTRATION_TRIGGER_RE.test(text)) {
        // Extract shop name from the same message (Fix 2)
        // Pattern: everything after the trigger keyword
        const shopNameMatch = text.replace(REGISTRATION_TRIGGER_RE, "").trim();
        if (shopNameMatch) {
          // Shop name found inline — register immediately (Fix 3: title-case)
          const shopName = shopNameMatch
            .split(" ")
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(" ");
          try {
            await registerShop({ ownerPhone: ownerWaId, shopName });
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate('hinglish', 'GREETING')
            });
          } catch (err) {
            await sendTextMessage({
              to: ownerWaId,
              text: err.message || "Registration nahi ho payi. Dobara try karo."
            });
          }
        } else {
          // No shop name in message — fall back to two-step flow
          pendingShopName.set(ownerWaId, { timestamp: Date.now() });
          await sendTextMessage({
            to: ownerWaId,
            text: "Apni shop ka naam kya hai? (sirf naam bhejo, jaise: Sharma General Store)"
          });
        }
      } else {
        await sendTextMessage({
          to: ownerWaId,
          text: "Pehle register karo — 'Register karo [aapki shop ka naam]' bhejo.\nExample: Register karo Sharma General Store"
        });
      }
      return;
    }
    // ── END REGISTRATION GATE ────────────────────────────────────

    // ── RESET_DATA confirmation check ──────────────────────────────
    // If this user has a pending delete confirmation, check their reply
    // BEFORE running Groq intent detection.
    if (pendingDeleteConfirmation.has(ownerWaId)) {
      const pending = pendingDeleteConfirmation.get(ownerWaId);
      pendingDeleteConfirmation.delete(ownerWaId); // always clear, one-shot

      // Check if confirmation has expired
      if (Date.now() - pending.timestamp > DELETE_CONFIRM_EXPIRY_MS) {
        await sendTextMessage({
          to: ownerWaId,
          text: getTemplate(pending.language || 'hinglish', 'RESET_CANCEL')
        });
        return;
      }

      const upperText = text.toUpperCase().trim();
      if (upperText === DELETE_CONFIRM_PHRASE) {
        try {
          await deleteAllOwnerData({ ownerPhone: resolvedOwnerPhone });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(pending.language || 'hinglish', 'RESET_DONE')
          });
        } catch (error) {
          console.error('deleteAllOwnerData failed:', error.message);
          await sendTextMessage({
            to: ownerWaId,
            text: getErrorTemplate(pending.language || 'hinglish', 'DATABASE')
          });
        }
      } else {
        await sendTextMessage({
          to: ownerWaId,
          text: getTemplate(pending.language || 'hinglish', 'RESET_CANCEL')
        });
      }
      return;
    }

    let aiResult;
    
    // ── DISAMBIGUATION check ──────────────────────────────
    if (pendingDisambiguation.has(ownerWaId)) {
      const session = pendingDisambiguation.get(ownerWaId);
      pendingDisambiguation.delete(ownerWaId); // clear it
      
      if (Date.now() - session.timestamp <= DISAMBIGUATION_EXPIRY_MS) {
        const choice = parseInt(text.trim(), 10);
        if (!isNaN(choice) && choice >= 1 && choice <= session.options.length) {
          const chosenCustomer = session.options[choice - 1];
          aiResult = session.pendingAction;
          aiResult.customerName = chosenCustomer.customer_name;
        }
      }
    }

    // Get intent from Groq first (if not already set by disambiguation)
    if (!aiResult) {
      try {
        aiResult = await detectIntent(text);
      } catch (error) {
        console.error('Groq detection failed:', error.message);
        await sendTextMessage({
          to: ownerWaId,
          text: getErrorTemplate('hinglish', 'NETWORK')
        });
        return;
      }
    }

    let {
      intent = "UNKNOWN",
      customerName,
      amount,
      itemName,
      quantity,
      unit,
      phoneNumber,
      expenseCategory,
      employeeName,
      employeePhone,
      language = "hinglish"
    } = aiResult;

    // Fallback logic for greetings
    if (intent === "UNKNOWN" && text.trim().split(/\s+/).length < 4) {
      intent = "GREETING";
    }

    // Handle different intents
    try {
      switch (intent) {
        case "GREETING":
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "GREETING")
          });
          break;

        case "CHECK_SINGLE_CUSTOMER_BALANCE": {
          if (!customerName) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }

          const customers = await searchCustomersByName({ customerName, ownerPhone: resolvedOwnerPhone });
          if (customers.length === 0) {
            const display = displayName(customerName);
            await sendTextMessage({
              to: ownerWaId,
              text: `${display} ka koi record nahi mila 🔍\nPehle udhaar log karo: '${customerName} 500 udhaar'`
            });
            return;
          } else if (customers.length === 1) {
            customerName = customers[0].customer_name;
          } else {
            pendingDisambiguation.set(ownerWaId, {
              timestamp: Date.now(),
              options: customers,
              pendingAction: aiResult
            });
            const optionsText = customers.map((c, i) => `${i + 1}. ${c.customer_name}`).join("\n");
            await sendTextMessage({
              to: ownerWaId,
              text: `Kaun sa ${customerName} — \n${optionsText}\n(number bhejo)`
            });
            break;
          }

          const balResult = await getCustomerBalance({ customerName, ownerPhone: resolvedOwnerPhone });
          const display = displayName(balResult.displayName);
          let balReply;
          if (!balResult.found) {
            balReply = `${display} ka koi record nahi mila 🔍\nPehle udhaar log karo: '${balResult.displayName} 500 udhaar'`;
          } else if (balResult.balance <= 0) {
            balReply = `${display} ka hisaab saaf hai ✅`;
          } else {
            balReply = `${display} ka baaki: ₹${formatAmount(balResult.balance)} 💰`;
          }
          await sendTextMessage({ to: ownerWaId, text: balReply });
          break;
        }

        case "LOG_UDHAAR": {
          if (!customerName || !amount || amount <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }

          const customers = await searchCustomersByName({ customerName, ownerPhone: resolvedOwnerPhone });
          if (customers.length === 0) {
            const newCust = await createCustomer({ customerName, ownerPhone: resolvedOwnerPhone });
            customerName = newCust.customer_name;
          } else if (customers.length === 1) {
            customerName = customers[0].customer_name;
          } else {
            pendingDisambiguation.set(ownerWaId, {
              timestamp: Date.now(),
              options: customers,
              pendingAction: aiResult
            });
            const optionsText = customers.map((c, i) => `${i + 1}. ${c.customer_name}`).join("\n");
            await sendTextMessage({
              to: ownerWaId,
              text: `Kaun sa ${customerName} — \n${optionsText}\n(number bhejo)`
            });
            break;
          }

          await logUdhaar({ customerName, amount, ownerPhone: resolvedOwnerPhone });
          let total = await getCustomerUdhaarTotal({ customerName, ownerPhone: resolvedOwnerPhone });
          if (customers.length === 0 && total < amount) {
            total = amount;
          }
          const safeTotal = Math.max(0, total);
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "LOG_UDHAAR", {
              name: displayName(customerName),
              amount: formatAmount(amount),
              total: formatAmount(safeTotal)
            })
          });
          break;
        }

        case "CHECK_UDHAAR": {
          if (!customerName) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }

          const customers = await searchCustomersByName({ customerName, ownerPhone: resolvedOwnerPhone });
          if (customers.length === 0) {
            const display = displayName(customerName);
            await sendTextMessage({
              to: ownerWaId,
              text: `${display} ka koi record nahi mila 🔍\nPehle udhaar log karo: '${customerName} 500 udhaar'`
            });
            return;
          } else if (customers.length === 1) {
            customerName = customers[0].customer_name;
          } else {
            pendingDisambiguation.set(ownerWaId, {
              timestamp: Date.now(),
              options: customers,
              pendingAction: aiResult
            });
            const optionsText = customers.map((c, i) => `${i + 1}. ${c.customer_name}`).join("\n");
            await sendTextMessage({
              to: ownerWaId,
              text: `Kaun sa ${customerName} — \n${optionsText}\n(number bhejo)`
            });
            break;
          }

          const remainingTotal = await getCustomerUdhaarTotal({ customerName, ownerPhone: resolvedOwnerPhone });
          if (remainingTotal <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: `${displayName(customerName)} ka hisaab saaf hai ✅`
            });
          } else {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "CHECK_UDHAAR", {
                name: displayName(customerName),
                total: formatAmount(remainingTotal)
              })
            });
          }
          break;
        }

        case "LOG_WAPAS": {
          if (!customerName || !amount || amount <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }

          const customers = await searchCustomersByName({ customerName, ownerPhone: resolvedOwnerPhone });
          if (customers.length === 0) {
            const newCust = await createCustomer({ customerName, ownerPhone: resolvedOwnerPhone });
            customerName = newCust.customer_name;
          } else if (customers.length === 1) {
            customerName = customers[0].customer_name;
          } else {
            pendingDisambiguation.set(ownerWaId, {
              timestamp: Date.now(),
              options: customers,
              pendingAction: aiResult
            });
            const optionsText = customers.map((c, i) => `${i + 1}. ${c.customer_name}`).join("\n");
            await sendTextMessage({
              to: ownerWaId,
              text: `Kaun sa ${customerName} — \n${optionsText}\n(number bhejo)`
            });
            break;
          }

          await logWapas({ customerName, amount, ownerPhone: resolvedOwnerPhone });
          const remaining = await getCustomerUdhaarTotal({ customerName, ownerPhone: resolvedOwnerPhone });
          
          if (remaining <= 0) {
            let saafMsg;
            const display = displayName(customerName);
            if (language === 'english') {
              saafMsg = `✅ Payment received!\n👤 ${display}\n💵 Paid: ₹${formatAmount(amount)}\n\n${display} ka hisaab saaf hai ✅`;
            } else if (language === 'hindi') {
              saafMsg = `✅ पेमेंट प्राप्त!\n👤 ${display}\n💵 वापस: ₹${formatAmount(amount)}\n\n${display} का हिसाब साफ़ है ✅`;
            } else {
              saafMsg = `✅ Payment!\n👤 ${display}\n💵 Wapas: ₹${formatAmount(amount)}\n\n${display} ka hisaab saaf hai ✅`;
            }
            await sendTextMessage({
              to: ownerWaId,
              text: saafMsg
            });
          } else {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "LOG_WAPAS", {
                name: displayName(customerName),
                amount: formatAmount(amount),
                remaining: formatAmount(remaining)
              })
            });
          }
          break;
        }

        case "MONTHLY_SUMMARY": {
          const monthData = await getMonthlyHisaab({ ownerPhone: resolvedOwnerPhone });
          
          let textMsg = `📊 ${monthData.monthName} ka hisaab:\n\n`;
          textMsg += `💸 Udhaar diya: ₹${formatAmount(monthData.totalUdhaar)}\n`;
          textMsg += `✅ Wapas mila: ₹${formatAmount(monthData.totalWapas)}\n`;
          textMsg += `⏳ Abhi bhi baaki: ₹${formatAmount(monthData.netPending)}\n`;
          textMsg += `👥 Customers: ${monthData.uniqueCustomerCount}\n`;
          
          if (monthData.netPending > 0) {
            textMsg += `\n₹${formatAmount(monthData.netPending)} abhi bhi lena baaki hai`;
          }
          
          await sendTextMessage({
            to: ownerWaId,
            text: textMsg
          });
          break;
        }

        case "TODAY_HISAAB":
          const today = await getTodayHisaab({ ownerPhone: resolvedOwnerPhone });
          console.log('[TODAY_HISAAB] data:', JSON.stringify(today));
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "TODAY_HISAAB", {
              newUdhaar: formatAmount(today.newUdhaar),
              wapasReceived: formatAmount(today.wapasReceived),
              netPending: formatAmount(today.netUdhaar),
              totalExpenses: formatAmount(today.totalExpenses)
            })
          });
          break;

        case "SABKA_UDHAAR":
          const result = await getAllPendingUdhaar({ ownerPhone: resolvedOwnerPhone });
          if (!result.customers.length && (!result.overpaidCustomers || !result.overpaidCustomers.length)) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "SABKA_UDHAAR", {
                list: "No pending udhaar ✅",
                total: "0"
              })
            });
          } else {
            let list = "";
            if (result.customers.length > 0) {
              list = result.customers
                .map(item => `${displayName(item.customerName)}: ₹${formatAmount(item.total)}`)
                .join("\n");
            }
            
            if (result.overpaidCustomers && result.overpaidCustomers.length > 0) {
              const overpaidList = result.overpaidCustomers
                .map(item => `✅ Saaf hisaab: ${displayName(item.customerName)} (₹${formatAmount(Math.abs(item.total))} zyada diya)`)
                .join("\n");
              if (list) list += "\n\n";
              list += overpaidList;
            }
            
            if (!list) list = "No pending udhaar ✅";

            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "SABKA_UDHAAR", {
                list,
                total: formatAmount(result.grandTotal)
              })
            });
          }
          break;

        case "INVENTORY_ADD":
          if (!itemName || !quantity || quantity <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'ITEM_REQUIRED')
            });
            return;
          }
          const row = await addInventoryStock({ itemName, quantity, unit, ownerPhone: resolvedOwnerPhone });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "INVENTORY_ADD", {
              item: row.item_name || itemName,
              qty: formatAmount(quantity),
              unit: formatUnit(quantity, row.unit, language),
              total: formatAmount(row.quantity),
              totalUnit: formatUnit(row.quantity, row.unit, language)
            })
          });
          
          // Check for low stock alert
          const lowStock = getLowStockAlertInfo(row);
          if (lowStock.isLow) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "LOW_STOCK", {
                item: lowStock.itemName,
                qty: formatAmount(lowStock.quantity),
                unit: lowStock.unit ? ` ${lowStock.unit}` : ""
              })
            });
          }
          break;

        case "STOCK_OUT": {
          if (!itemName || !quantity || quantity <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'ITEM_REQUIRED')
            });
            return;
          }

          const result = await deductInventoryStock({ itemName, quantity, ownerPhone: resolvedOwnerPhone });
          
          if (result.status === "NOT_FOUND") {
            await sendTextMessage({
              to: ownerWaId,
              text: `${itemName} inventory mein nahi mila 🔍\nPehle add karo: '${itemName} ${quantity} aaya'`
            });
            return;
          }

          if (result.status === "INSUFFICIENT") {
            await sendTextMessage({
              to: ownerWaId,
              text: `⚠️ Sirf ${formatAmount(result.item.quantity)} ${result.item.unit} ${result.item.item_name} bacha hai!`
            });
            return;
          }

          // SUCCESS
          await sendTextMessage({
            to: ownerWaId,
            text: `✅ ${result.item.item_name} ${formatAmount(quantity)} gaya. Baaki stock: ${formatAmount(result.item.quantity)} ${result.item.unit}`
          });

          // Check for low stock alert
          const lowStockOut = getLowStockAlertInfo(result.item);
          if (lowStockOut.isLow) {
            await sendTextMessage({
              to: ownerWaId,
              text: `⚠️ ${lowStockOut.itemName} ka stock kam ho raha hai!\nSirf ${formatAmount(lowStockOut.quantity)} ${lowStockOut.unit ? lowStockOut.unit : ""} bacha.`
            });
          }
          break;
        }

        case "CHECK_STOCK":
          if (!itemName) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'ITEM_REQUIRED')
            });
            return;
          }
          const stock = await getInventoryStock({ itemName, ownerPhone: resolvedOwnerPhone });
          if (!stock) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "CHECK_STOCK", {
                item: itemName,
                qty: "0",
                unit: ""
              })
            });
          } else {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "CHECK_STOCK", {
                item: stock.item_name || itemName,
                qty: formatAmount(stock.quantity),
                unit: formatUnit(stock.quantity, stock.unit, language)
              })
            });
          }
          break;

        case "ALL_STOCK":
          const allStock = await getAllInventoryStock({ ownerPhone: resolvedOwnerPhone });
          if (!allStock.length) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "ALL_STOCK", {
                list: "Stock is empty 📭"
              })
            });
          } else {
            const stockList = allStock
              .map(row => {
                const qty = formatAmount(row.quantity);
                const u = formatUnit(row.quantity, row.unit, language);
                return `${row.item_name}: ${qty}${u}`;
              })
              .join("\n");
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "ALL_STOCK", {
                list: stockList
              })
            });
          }
          break;

        case "SAVE_NUMBER": {
          // ── Validate name ──────────────────────────────────────────────
          if (!customerName) {
            await sendTextMessage({
              to: ownerWaId,
              text: "❌ Customer ka naam nahi mila.\nExample: 'Rahul ka number save karo 9876543210'"
            });
            break;
          }

          // ── Validate phone: exactly 10 digits, starting with 6-9 ──────
          const rawPhone = String(phoneNumber || "").replace(/\D/g, "");
          if (!rawPhone || rawPhone.length !== 10 || !/^[6-9]/.test(rawPhone)) {
            await sendTextMessage({
              to: ownerWaId,
              text: `❌ Phone number galat hai.\n${rawPhone ? `"${rawPhone}" valid Indian number nahi hai.` : "Number nahi mila."}\nSahi format: 'Rahul ka number save karo 9876543210'`
            });
            break;
          }

          const e164Phone = `+91${rawPhone}`;

          // ── Save (isolated try/catch → exactly ONE response always) ────
          try {
            await saveCustomerPhone({
              customerName,
              phone: e164Phone,
              ownerPhone: resolvedOwnerPhone
            });
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "SAVE_NUMBER", { name: displayName(customerName) })
            });
          } catch (saveErr) {
            console.error('[SAVE_NUMBER] saveCustomerPhone failed:', saveErr.message);
            const msg = String(saveErr.message || "");
            if (msg.includes("23505") || msg.includes("duplicate") || msg.includes("unique")) {
              await sendTextMessage({
                to: ownerWaId,
                text: `⚠️ ${displayName(customerName)} ka number (${e164Phone}) pehle se save hai.`
              });
            } else {
              await sendTextMessage({
                to: ownerWaId,
                text: `❌ Number save nahi ho paya. Thodi der baad try karo.\n(${msg || 'Database error'})`
              });
            }
          }
          break;
        }


        case "SEND_REMINDER": {
          if (!customerName) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'NAME_REQUIRED')
            });
            return;
          }
          const customerPhone = await getCustomerPhone({ customerName, ownerPhone: resolvedOwnerPhone });
          if (!customerPhone) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "REMINDER_NOT_FOUND", { name: customerName })
            });
            return;
          }
          const reminderTotal = await getCustomerUdhaarTotal({ customerName, ownerPhone: resolvedOwnerPhone });
          const safeReminderTotal = Math.max(0, reminderTotal);
          const shopInfo = await getShopDetails(resolvedOwnerPhone);
          const shopName = shopInfo?.shop_name || "BharatBahi shop";
          
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "SEND_REMINDER", {
              name: customerName,
              phone: customerPhone,
              total: formatAmount(safeReminderTotal),
              shopName: shopName
            })
          });
          break;
        }

        case "LOG_EXPENSE":
          if (!amount || amount <= 0) {
            await sendTextMessage({
              to: ownerWaId,
              text: getErrorTemplate(language, 'AMOUNT_REQUIRED')
            });
            return;
          }
          await logExpense({ 
            category: expenseCategory || "general", 
            amount, 
            description: expenseCategory || "general",
            ownerPhone: resolvedOwnerPhone
          });
          const todayExpenses = await getTodayExpenses({ ownerPhone: resolvedOwnerPhone });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "LOG_EXPENSE", {
              category: expenseCategory || "general",
              amount: formatAmount(amount),
              total: formatAmount(todayExpenses.total)
            })
          });
          break;

        case "CHECK_EXPENSE":
          const expenseData = await getTodayExpenses({ ownerPhone: resolvedOwnerPhone });
          if (!expenseData.expenses.length) {
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "CHECK_EXPENSE", {
                list: "Aaj koi kharcha nahi hua",
                total: "0"
              })
            });
          } else {
            const expenseList = expenseData.expenses
              .map(expense => `${expense.category}: ${formatAmount(expense.amount)}`)
              .join("\n");
            await sendTextMessage({
              to: ownerWaId,
              text: getTemplate(language, "CHECK_EXPENSE", {
                list: expenseList,
                total: formatAmount(expenseData.total)
              })
            });
          }
          break;

        case "RESET_DATA":
          // Store pending confirmation — actual deletion happens on next message
          pendingDeleteConfirmation.set(ownerWaId, {
            timestamp: Date.now(),
            language
          });
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "RESET_CONFIRM")
          });
          break;

        case "LAST_ENTRIES": {
          const entries = await getLastEntries({ ownerPhone: resolvedOwnerPhone, limit: 3, customerName });
          if (!entries.length) {
            await sendTextMessage({ to: ownerWaId, text: "Abhi tak koi entry nahi hai 📋" });
            break;
          }
          const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

          const lines = entries.map((entry, i) => {
            const entryIST = new Date(new Date(entry.created_at).getTime() + IST_OFFSET_MS);
            
            let hours = entryIST.getUTCHours();
            const minutes = entryIST.getUTCMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // the hour '0' should be '12'
            const minStr = minutes < 10 ? '0' + minutes : minutes;
            const timeLabel = `${hours}:${minStr} ${ampm}`;

            const amt = Math.abs(Number(entry.amount || 0));
            const type = Number(entry.amount || 0) >= 0 ? "udhaar" : "wapas";
            return `${i + 1}. ${entry.customer_name} — ₹${formatAmount(amt)} ${type} — ${timeLabel}`;
          });
          await sendTextMessage({
            to: ownerWaId,
            text: `📋 Aakhri ${entries.length} entries:\n${lines.join("\n")}`
          });
          break;
        }

        case "ADD_EMPLOYEE":
          if (ownerWaId !== resolvedOwnerPhone) {
            await sendTextMessage({
              to: ownerWaId,
              text: "Aap employee add nahi kar sakte. Sirf dukan ke owner ko permission hai."
            });
            return;
          }
          if (!employeeName || !employeePhone) {
            await sendTextMessage({
              to: ownerWaId,
              text: "Employee ka naam aur phone number dono zaruri hai."
            });
            return;
          }
          try {
            await addEmployee({ 
              ownerPhone: resolvedOwnerPhone, 
              employeePhone: normalizeCustomerPhone(employeePhone), 
              employeeName 
            });
            await sendTextMessage({
              to: ownerWaId,
              text: `${employeeName} ko add kar diya! 🎉 Ab ${employeeName} bhi shop ka hisaab rakh sakta hai — bas WhatsApp karo.`
            });
          } catch (e) {
            await sendTextMessage({
              to: ownerWaId,
              text: e.message || getErrorTemplate(language, 'DATABASE')
            });
          }
          break;

        default:
          await sendTextMessage({
            to: ownerWaId,
            text: getTemplate(language, "UNKNOWN")
          });
      }
    } catch (error) {
      console.error('Service operation failed:', error.message);
      await sendTextMessage({
        to: ownerWaId,
        text: getErrorTemplate(language, 'DATABASE')
      });
    }
  } catch (error) {
    console.error('Webhook processing error:', error.message);
    // Always send some reply, never crash
    const ownerWaId = req.body?.From;
    if (ownerWaId) {
      await sendTextMessage({
        to: ownerWaId,
        text: getErrorTemplate('hinglish', 'NETWORK')
      });
    }
  }
}

module.exports = { verifyWebhook, receiveWebhook };
