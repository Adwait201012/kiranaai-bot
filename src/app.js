const express = require("express");
const webhookRoutes = require("./routes/webhookRoutes");

const app = express();

app.use(express.json());

app.get("/", (_, res) => {
  res.json({ ok: true, service: "KiranaAI WhatsApp Bot" });
});

app.use("/", webhookRoutes);

module.exports = app;
