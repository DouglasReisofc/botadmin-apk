const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const OUT_DIR = "/root/botadmin-local/tmp-admin-visual";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("saved", file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle2", timeout: 120000 });

  const loginResponse = await page.evaluate(async () => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: "contactgestorvip@gmail.com",
        password: "Dev7766@#$%",
        remember: true,
      }),
    });
    return { ok: response.ok, status: response.status };
  });
  console.log("login", loginResponse);

  await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "networkidle2", timeout: 120000 });
  await sleep(4000);
  const url = page.url();
  console.log("after login", url);

  if (!url.includes("/dashboard/admin")) {
    await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(3000);
  }

  await shot(page, "desktop-dashboard");

  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(2500);
  await shot(page, "mobile-dashboard");

  await page.setViewport({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(2000);

  const railButtons = await page.$$("aside button");
  if (railButtons[2]) {
    await railButtons[2].click();
    await sleep(1500);
    await shot(page, "desktop-support-section");
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});