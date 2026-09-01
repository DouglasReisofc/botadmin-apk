const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:4478";
const OUT_DIR = "/root/botadmin-local/tmp-admin-visual";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle2", timeout: 120000 });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: "contactgestorvip@gmail.com",
        password: "Dev7766@#$%",
        remember: true,
      }),
    });
  });

  await page.goto(`${BASE}/dashboard/admin?section=support`, {
    waitUntil: "networkidle2",
    timeout: 120000,
  });
  await sleep(3500);

  const thread = await page.$('[class*="threadButton"]');
  if (thread) {
    await thread.click();
    await sleep(1500);
  }

  const composer = await page.$('[class*="supportComposer"]');
  const metrics = composer
    ? await page.evaluate((el) => {
        const input = el.querySelector("input:not([type='file'])");
        const field = el.querySelector('[class*="supportComposerField"]');
        const inputBox = input?.getBoundingClientRect();
        const fieldBox = field?.getBoundingClientRect();
        return {
          hasInput: Boolean(input),
          inputWidth: inputBox?.width ?? 0,
          fieldWidth: fieldBox?.width ?? 0,
          composerFlex: getComputedStyle(el).display,
        };
      }, composer)
    : null;

  console.log("composer metrics", metrics);

  await page.screenshot({
    path: path.join(OUT_DIR, "support-composer-desktop.png"),
    fullPage: false,
  });
  console.log("saved", path.join(OUT_DIR, "support-composer-desktop.png"));

  await page.setViewport({ width: 390, height: 844 });
  await sleep(800);
  const mobileThread = await page.$('[class*="threadButton"]');
  if (mobileThread) {
    await mobileThread.click();
    await sleep(1200);
  }
  await page.screenshot({
    path: path.join(OUT_DIR, "support-composer-mobile.png"),
    fullPage: false,
  });
  console.log("saved", path.join(OUT_DIR, "support-composer-mobile.png"));

  if (!metrics?.hasInput || metrics.inputWidth < 120) {
    console.error("Composer layout looks broken");
    process.exitCode = 1;
  }

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});