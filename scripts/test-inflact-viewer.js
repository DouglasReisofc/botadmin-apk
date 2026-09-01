#!/usr/bin/env node
const path = require("path");

const username = process.argv[2] || "douglasreis.dev";

(async () => {
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto("https://inflact.com/instagram-viewer/profile/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    const result = await page.evaluate(async (handle) => {
      const fd = new FormData();
      fd.append("url", handle);
      const resp = await fetch(
        "https://inflact.com/downloader/api/viewer/profile/?lang=en",
        {
          method: "POST",
          body: fd,
        },
      );
      const text = await resp.text();
      return { status: resp.status, body: text };
    }, username);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    setTimeout(() => {
      browser.close().catch(() => {});
    }, 1000);
  }
})();
