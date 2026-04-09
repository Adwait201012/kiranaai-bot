const express = require("express");
const webhookRoutes = require("./routes/webhookRoutes");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/", (_, res) => {
  res.json({ ok: true, service: "VyaparAI WhatsApp Bot" });
});

app.use("/", webhookRoutes);

module.exports = app;
