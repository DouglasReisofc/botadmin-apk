import { readFileSync } from "node:fs";

import { saveAdminBotInterageConfig } from "lib/admin-botinterage-config";
import { ensureBotGroupSettingsTable } from "lib/db";

const main = async () => {
  const tokenPath = process.argv[2];
  if (!tokenPath) throw new Error("Token path is required.");

  const token = readFileSync(tokenPath, "utf8").trim();
  if (!token) throw new Error("Token is empty.");

  await ensureBotGroupSettingsTable();
  const config = await saveAdminBotInterageConfig({
    enabled: true,
    baseUrl: "https://chatgpt-api.botadmin.shop",
    token,
    model: "auto",
  });

  console.log(JSON.stringify(config));
};

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
