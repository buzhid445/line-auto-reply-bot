import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp({ config });

app.listen(config.PORT, () => {
  console.log(`LINE GPT API server listening on http://localhost:${config.PORT}`);
});
