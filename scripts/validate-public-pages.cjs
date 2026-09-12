const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

async function main() {
  const origin = process.env.PUBLIC_PREVIEW_ORIGIN || 'http://127.0.0.1:5175';
  const output = await fs.mkdtemp('/tmp/botadmin-public-validation-');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const width of [390, 1440]) {
      for (const theme of ['clean', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin, { waitUntil: 'networkidle' });
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
        await page.screenshot({ path: `${output}/landing-${width}-${theme}.png` });
        await page.locator('#showcase-track').scrollIntoViewIfNeeded();
        await page.locator('#showcase-track img').evaluateAll(async images => {
          await Promise.all(images.map(image => { image.loading = 'eager'; return image.decode(); }));
        });
        await page.screenshot({ path: `${output}/showcase-${width}-${theme}.png` });
        await page.getByRole('button', { name: 'Ver próximos exemplos' }).click();
        await page.waitForFunction(() => document.getElementById('showcase-track').scrollLeft > 100);
        await page.getByRole('button', { name: 'Ver exemplos anteriores' }).click();
        await page.waitForFunction(() => document.getElementById('showcase-track').scrollLeft < 3);
        await page.locator('summary').first().click();
        assert.equal(await page.locator('details').first().getAttribute('open'), '');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Landing horizontal overflow');
        for (const [route, heading] of [['/sign-in', 'Acessar sua conta'], ['/sign-up', 'Criar sua conta']]) {
          await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
          await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
          await page.getByRole('heading', { name: heading, exact: true }).waitFor();
          await page.locator('.local-auth-visual img').evaluate(image => image.decode());
          await page.screenshot({ path: `${output}/${route.slice(1)}-${width}-${theme}.png`, fullPage: true });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} horizontal overflow`);
          const inputs = await page.locator('.local-auth-card input:not([type=checkbox])').evaluateAll(items => items.map(input => ({ width: input.getBoundingClientRect().width, size: parseFloat(getComputedStyle(input).fontSize) })));
          assert(inputs.every(input => input.width > 150 && input.size >= 16), 'Input size or mobile zoom risk');
        }
        await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
        await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
        await page.getByRole('heading', { name: 'Recuperar senha' }).waitFor();
        assert.equal(errors.length, 0, errors.join('\n'));
        results.push({ width, theme, carousel: 'pass', images: 'pass', forms: 'pass', overflow: 'none', javascriptErrors: errors });
        await page.close();
      }
    }
    console.log(JSON.stringify({ output, results }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
