const express = require("express");
const twilio = require("twilio");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const env = require("../config/env");
const {
  verifyWebhook,
  receiveWebhook,
} = require("../controllers/webhookController");

const router = express.Router();

/** Validate X-Twilio-Signature on Twilio deliveries; skip for Meta Cloud API webhooks */
function twilioWebhookIfPresent(req, res, next) {
  if (req.headers["x-twilio-signature"]) {
    return twilio.webhook({
      validate: true,
      authToken: env.twilioAuthToken,
      host: "vyaparai-bot.onrender.com",
      protocol: "https",
    })(req, res, next);
  }
  return next();
}

const whatsappLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const from = req.body?.From || req.body?.from;
    if (from) return String(from);
    return ipKeyGenerator(req);
  },
  handler: (_req, res) => {
    res.sendStatus(429);
  },
});

router.get("/webhook", verifyWebhook);
router.post("/webhook", whatsappLimiter, twilioWebhookIfPresent, receiveWebhook);
router.post(
  "/twilio/webhook",
  whatsappLimiter,
  twilioWebhookIfPresent,
  receiveWebhook
);

module.exports = router;
