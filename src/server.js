const app = require("./app");
const env = require("./config/env");

app.listen(env.port, () => {
  console.log(`KiranaAI bot server running on port ${env.port}`);
});
