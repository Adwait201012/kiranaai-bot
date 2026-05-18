const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Groq = require("groq-sdk");
const env = require("../config/env");

const client = new Groq({ apiKey: env.groqApiKey });

function getFileExtension(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("webm")) return "webm";
  return "audio";
}

function isAudioMedia(mediaContentType) {
  const type = String(mediaContentType || "").toLowerCase();
  return type.includes("audio") || type.includes("ogg");
}

async function transcribeTwilioAudio({ mediaUrl, mediaContentType }) {
  const ext = getFileExtension(mediaContentType);
  const tempFilePath = path.join(
    os.tmpdir(),
    `vyaparai-audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
  );

  try {
    const response = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      auth: {
        username: env.twilioAccountSid,
        password: env.twilioAuthToken,
      },
    });

    fs.writeFileSync(tempFilePath, response.data);

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-large-v3-turbo",
      prompt: "This is an Indian shopkeeper speaking in Hindi, Hinglish, or English. Common words: udhaar, wapas, hisaab, chawal, tel, daal, aata, sharma, verma, pintu, raju. Numbers are amounts in rupees. Speech may be fast, informal, with Indori accent. Transcribe exactly.",
    });

    const rawText = String(transcription.text || "").trim();
    return cleanTranscription(rawText);
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

function cleanTranscription(text) {
  if (!text) return "";

  let cleaned = text.toLowerCase();

  // Common transcription errors for Indian business terms
  const replacements = {
    "ou dhaar": "udhaar",
    "u daar": "udhaar",
    "udaar": "udhaar",
    "his aab": "hisaab",
    "hishab": "hisaab",
    "hisab": "hisaab",
    "khar cha": "kharcha",
    "kharch": "kharcha",
    "wapas": "wapas",
    "vapas": "wapas",
    "waapas": "wapas",
  };

  for (const [wrong, right] of Object.entries(replacements)) {
    cleaned = cleaned.split(wrong).join(right);
  }

  // Remove filler words
  cleaned = cleaned.replace(/\b(um|uh|err|aaa|ah|oh)\b/gi, "");
  
  // Clean up punctuation and multiple spaces
  cleaned = cleaned.replace(/[.,!?;:]/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

module.exports = {
  isAudioMedia,
  transcribeTwilioAudio,
};
