// funcoes/instagram.js
const puppeteer = require('puppeteer');

async function snapInsta(link) {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/chromium-browser', // Seu caminho ARM
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();

    try {
        await page.goto('https://snapinsta.to/en', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.type('#s_input', link);

        await Promise.all([
            page.click('button.btn.btn-default'),
            page.waitForSelector('.download-items__btn a', { timeout: 20000 })
        ]);

        const links = await page.$$eval('.download-items__btn a', as =>
            as.map(a => ({
                tipo: a.innerText.trim(),
                url: a.href
            }))
        );

        if (!links.length) throw new Error('Nenhum link encontrado.');

        return links;

    } catch (err) {
        throw new Error(`Erro ao extrair links: ${err.message}`);
    } finally {
        await browser.close();
    }
}

module.exports = snapInsta;
