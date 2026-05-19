"use strict";

/**
 * Strip register prefix, brackets, and quotes from a shop name.
 */
function cleanShopName(input) {
  return String(input || "")
    .replace(/^register\s*/i, "")
    .replace(/[\[\]'""]/g, "")
    .trim();
}

function titleCaseShopName(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** "Register Sharma dukan", "register test shop", "Register [Sharma dukan]" */
const REGISTER_WITH_NAME_RE = /^register\s+(.+)/i;

/** Triggers without inline name → ask for shop name */
const REGISTER_PROMPT_ONLY_RE =
  /^(?:meri\s+dukaan?\s+register(?:\s*karo)?|naya\s+register|register\s*karo|shop\s*add\s*karo|shuru\s*karo|register|start)\s*$/i;

/**
 * @returns {{ type: "register", shopName: string } | { type: "prompt" } | null}
 */
function parseRegistrationIntent(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const withName = raw.match(REGISTER_WITH_NAME_RE);
  if (withName) {
    const shopName = cleanShopName(withName[1]);
    if (shopName.length >= 2) {
      return { type: "register", shopName: titleCaseShopName(shopName) };
    }
    return { type: "prompt" };
  }

  if (REGISTER_PROMPT_ONLY_RE.test(raw)) {
    const remainder = cleanShopName(
      raw.replace(REGISTER_PROMPT_ONLY_RE, "").trim()
    );
    if (remainder.length >= 2) {
      return { type: "register", shopName: titleCaseShopName(remainder) };
    }
    return { type: "prompt" };
  }

  return null;
}

function unknownUserMessage() {
  return (
    "Aapka number registered nahi hai.\n\n" +
    "Agar aap owner hain, apni dukaan ka naam likh kar bhejein.\n" +
    "Jaise: *Register Sharma General Store*\n\n" +
    "Agar kisi shop mein join karna hai:\n" +
    "Jaise: *Join ABC123*"
  );
}

module.exports = {
  cleanShopName,
  titleCaseShopName,
  parseRegistrationIntent,
  unknownUserMessage,
  REGISTER_WITH_NAME_RE,
};
