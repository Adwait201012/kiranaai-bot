const express = require("express");
const {
  verifyWebhook,
  receiveWebhook,
} = require("../controllers/webhookController");

const router = express.Router();

router.get("/webhook", verifyWebhook);
router.post("/webhook", receiveWebhook);
// Separate path for Twilio configs only — not a duplicate of POST /webhook
router.post("/twilio/webhook", receiveWebhook);

module.exports = router;
