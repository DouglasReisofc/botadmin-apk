import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env");
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    process.env[key] = value;
  }
} catch (error) {
  console.warn("Could not load .env", error);
}

async function main() {
  const { getInstanceByToken } = await import("lib/bot-instances");
  const { getInstanceSettings } = await import("lib/bot-instance-settings");

  const token = process.argv[2];
  if (!token) {
    console.error("Missing token arg");
    process.exit(1);
  }
  const instance = await getInstanceByToken(token);
  console.log("instance", instance);
  if (!instance) return;
  const settings = await getInstanceSettings(instance.id);
  console.log("settings", settings);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
