#!/usr/bin/env node

const { chromium } = require("playwright");

async function run(username = "douglasreis.dev") {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://inflact.com/instagram-viewer/profile/", {
    waitUntil: "load",
    timeout: 90000,
  });
  await page.waitForTimeout(3000);
  const inputSelector = 'input[name="url"]';
  await page.fill(inputSelector, username);
  await page.keyboard.press("Enter");

  const apiResponse = await page.waitForResponse(
    (resp) =>
      resp
        .url()
        .startsWith("https://inflact.com/downloader/api/viewer/profile"),
    { timeout: 60000 },
  );

  const body = await apiResponse.text();
  console.log(
    JSON.stringify(
      { status: apiResponse.status(), ok: apiResponse.ok(), body },
      null,
      2,
    ),
  );
  await browser.close();
}

run(process.argv[2]).catch((error) => {
  console.error("Failed:", error);
  process.exitCode = 1;
});
