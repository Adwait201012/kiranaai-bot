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
    `kiranaai-audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
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
      language: "hi",
    });

    return String(transcription.text || "").trim();
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

module.exports = {
  isAudioMedia,
  transcribeTwilioAudio,
};
