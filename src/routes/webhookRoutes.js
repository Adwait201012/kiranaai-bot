const express = require("express");
const twilio = require("twilio");
const env = require("../config/env");
const {
  verifyWebhook,
  receiveWebhook,
} = require("../controllers/webhookController");

const router = express.Router();

/** Validate X-Twilio-Signature on Twilio deliveries; skip for Meta Cloud API webhooks */
function twilioWebhookIfPresent(req, res, next) {
  if (req.headers["x-twilio-signature"]) {
    return twilio.webhook({ validate: true, authToken: env.twilioAuthToken })(
      req,
      res,
      next
    );
  }
  return next();
}

router.get("/webhook", verifyWebhook);
router.post("/webhook", twilioWebhookIfPresent, receiveWebhook);
router.post("/twilio/webhook", twilioWebhookIfPresent, receiveWebhook);

module.exports = router;
