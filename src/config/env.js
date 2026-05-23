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
  twilioAccountSid: requireEnv("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: requireEnv("TWILIO_AUTH_TOKEN"),
  twilioWhatsappFrom: requireEnvAny(["TWILIO_WHATSAPP_NUMBER", "TWILIO_WHATSAPP_FROM"]),
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseKey: requireEnv("SUPABASE_KEY"),
  groqApiKey: requireEnv("GROQ_API_KEY"),
  nvidiaApiKey: process.env.NVIDIA_API_KEY,
};
