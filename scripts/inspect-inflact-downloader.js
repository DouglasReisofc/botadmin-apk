#!/usr/bin/env node
const { chromium } = require('playwright');

async function run(targetLink) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://inflact.com/instagram-downloader/video/', { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2000);
    const consent = await page.$('#onetrust-accept-btn-handler');
    if (consent) {
      await consent.click();
      await page.waitForTimeout(500);
    }
    const inputSelector = 'input[name="url"]';
    await page.fill(inputSelector, targetLink);
    const responsePromise = page.waitForResponse((resp) => resp.url().includes('/downloader/api/'), { timeout: 60000 });
    await page.click('button:has-text("Download video")');
    const resp = await responsePromise;
    console.log('Request URL:', resp.request().url());
    console.log('Request body:', resp.request().postData());
    console.log('Status:', resp.status());
    console.log('Body:', await resp.text());
  } finally {
    await browser.close();
  }
}

const link = process.argv[2];
if (!link) {
  console.error('Usage: node scripts/inspect-inflact-downloader.js <instagram-url>');
  process.exit(1);
}
run(link).catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
