const { chromium } = require("playwright");

const origin = process.env.BOTADMIN_REACT_URL || "http://127.0.0.1:5173";
const screenshotPath = process.env.BOTADMIN_REACT_PROFILES_SCREENSHOT || "/tmp/botadmin-react-profiles.png";

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const requests = [];
  const patchPayloads = [];
  let instance = {
    id: 584,
    name: "Perfil de validação",
    phone: "5593999999999",
    sessionStatus: "desconectado",
    expiresAt: "2027-01-01T00:00:00.000Z",
    avatarUrl: null,
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    requests.push(`${method} ${url.pathname}`);
    const json = (payload, status = 200) => route.fulfill({
      status,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(payload),
    });
    if (url.pathname === "/api/auth/session") return json({ user: { id: 77, name: "QA Profiles", email: "qa@example.com" } });
    if (url.pathname === "/api/bot-instances" && method === "GET") return json({ instances: [instance] });
    if (url.pathname === "/api/bot-instances/584/profile" && method === "GET") {
      return json({
        instance,
        profile: {
          displayName: instance.name,
          pushName: "Perfil WhatsApp",
          statusText: "Disponível",
          jid: null,
          avatarUrl: null,
          sessionStatus: instance.sessionStatus,
        },
      });
    }
    if (url.pathname === "/api/bot-instances/584/proxy") return json({ proxy: { enabled: false } });
    if (url.pathname === "/api/bot-instances/584/settings") return json({ settings: { commandToggles: {} }, storage: null });
    if (url.pathname === "/api/bot-instances/584/profile" && method === "PATCH") {
      const payload = request.postDataJSON();
      patchPayloads.push(payload);
      instance = { ...instance, name: payload.instanceName || instance.name, phone: payload.phone || instance.phone };
      return json({ instance, profile: { displayName: instance.name, sessionStatus: "desconectado" }, phoneChanged: true, pairingRequired: true });
    }
    if (url.pathname === "/api/bot-instances/584/pair" && method === "POST") {
      return json({ data: { linkingCode: "ABC12345" }, message: "Código de pareamento gerado." });
    }
    return json({});
  });

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/dashboard/user?section=profiles`, { waitUntil: "domcontentloaded" });
  await page.getByText("Perfis WhatsApp", { exact: true }).waitFor();
  await page.getByText("Perfil de validação", { exact: true }).first().waitFor();

  // Pairing data must live only inside a modal, never in the profile page.
  await page.getByRole("button", { name: "Conectar WhatsApp" }).click();
  await page.getByRole("heading", { name: "Conectar WhatsApp" }).waitFor();
  await page.getByText("ABC12345", { exact: true }).waitFor();
  const inlinePairingCount = await page.locator(".pairing-inline").count();
  await page.getByRole("button", { name: "Fechar" }).click();

  // Number editing is a separate modal and requires a confirmation step.
  await page.getByRole("button", { name: /Editar/ }).click();
  await page.getByRole("heading", { name: "Editar instância" }).waitFor();
  await page.getByLabel("Número do WhatsApp").fill("5511999998888");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText("O número será substituído", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await page.getByRole("heading", { name: "Conectar WhatsApp" }).waitFor();
  await page.getByText("ABC12345", { exact: true }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    modalWidth: document.querySelector(".profile-pairing-modal")?.getBoundingClientRect().width || 0,
  }));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const result = {
    pairingModal: await page.getByRole("heading", { name: "Conectar WhatsApp" }).isVisible(),
    inlinePairingCount,
    patchPhone: patchPayloads.at(-1)?.phone || null,
    patchInstanceName: patchPayloads.at(-1)?.instanceName || null,
    pairRequests: requests.filter((entry) => entry === "POST /api/bot-instances/584/pair").length,
    mobileLayout,
    pageErrors,
    screenshotPath,
  };
  await browser.close();
  if (!result.pairingModal || result.inlinePairingCount !== 0 || result.patchPhone !== "5511999998888" || result.pairRequests < 1 || result.mobileLayout.documentWidth > result.mobileLayout.viewport + 1 || result.mobileLayout.modalWidth <= 0 || result.pageErrors.length) {
    throw new Error(`Validação incompleta: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
