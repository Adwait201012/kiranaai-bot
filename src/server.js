const app = require("./app");
const env = require("./config/env");
const { startScheduledJobs } = require("./jobs/scheduledMessages");

app.listen(env.port, () => {
  console.log(`VyaparAI bot server running on port ${env.port}`);
  startScheduledJobs();
});
