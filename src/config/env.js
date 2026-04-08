const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function requireEnvAny(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing environment variable. Provide one of: ${names.join(", ")}`);
}

module.exports = {
  port: process.env.PORT || 3000,
  whatsappVerifyToken: requireEnv("WHATSAPP_VERIFY_TOKEN"),
  whatsappAccessToken: requireEnvAny(["WHATSAPP_TOKEN", "WHATSAPP_ACCESS_TOKEN"]),
  whatsappPhoneNumberId: requireEnvAny([
    "PHONE_NUMBER_ID",
    "WHATSAPP_PHONE_NUMBER_ID",
  ]),
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseKey: requireEnv("SUPABASE_KEY"),
};
