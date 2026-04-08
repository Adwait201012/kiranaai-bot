function parseUdhaarMessage(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const cleaned = text.trim().replace(/\s+/g, " ");

  // Example accepted: "Sharma ji 500 udhaar"
  const match = cleaned.match(/^(.+?)\s+(\d+)\s+udhaar$/i);
  if (!match) {
    return null;
  }

  const customerName = match[1].trim();
  const amount = Number(match[2]);

  if (!customerName || Number.isNaN(amount) || amount <= 0) {
    return null;
  }

  return { customerName, amount };
}

module.exports = { parseUdhaarMessage };
