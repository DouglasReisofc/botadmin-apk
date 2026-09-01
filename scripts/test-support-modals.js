const puppeteer = require("puppeteer");

const BASE = process.env.BASE_URL || "http://127.0.0.1:4478";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}\n${e.stack}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`CONSOLE: ${msg.text()}`);
  });

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
  await sleep(4000);

  const selectFirstThread = async () => {
    const clicked = await page.evaluate(() => {
      const thread = document.querySelector('[class*="threadButton"]');
      if (thread) {
        thread.click();
        return true;
      }
      return false;
    });
    if (clicked) await sleep(1500);
    return clicked;
  };

  const openSheet = async () => {
    const btn = await page.$('button[aria-label="Ações do atendimento"]');
    if (btn) {
      await btn.click();
      await sleep(800);
      return true;
    }
    const dots = await page.$('button[aria-label="Mais ações"]');
    if (dots) {
      await dots.click();
      await sleep(800);
      return true;
    }
    return false;
  };

  const clickByText = async (text) => {
    return page.evaluate((needle) => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(needle),
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, text);
  };

  const closeModal = async () => {
    await page.evaluate(() => {
      const close = [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === "Fechar",
      );
      close?.click();
    });
    await sleep(600);
  };

  const hasThread = await selectFirstThread();
  if (!hasThread) {
    console.log("WARN: no support thread found — skipping modal interactions");
  } else {
    const sheetOpen = await openSheet();
    if (!sheetOpen) {
      console.log("WARN: could not open quick actions sheet");
    } else {
      await clickByText("Editar usuário");
      await sleep(1500);
      console.log("after edit user modal", errors.length);
      await closeModal();

      await openSheet();
      await clickByText("Editar plano");
      await sleep(2500);
      console.log("after plan modal", errors.length);
      await closeModal();

      await openSheet();
      await clickByText("Perfis e grupos");
      await sleep(1500);
      console.log("after profiles modal", errors.length);
      await closeModal();
    }
  }

  if (errors.length) {
    console.log("ERRORS:\n", errors.join("\n---\n"));
    process.exitCode = 1;
  } else {
    console.log("No client errors detected");
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});