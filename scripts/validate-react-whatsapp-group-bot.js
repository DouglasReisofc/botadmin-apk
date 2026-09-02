const { chromium } = require("playwright");

const origin = process.env.BOTADMIN_REACT_URL || "http://127.0.0.1:5173";
const screenshotPath =
  process.env.BOTADMIN_REACT_SCREENSHOT ||
  "/tmp/botadmin-react-whatsapp-group-bot.png";

const baseSettings = {
  commandToggles: {},
  scheduleConfig: {
    closeEnabled: false,
    openEnabled: false,
    closeTimes: ["00:00"],
    openTimes: ["07:00"],
    timezone: "America/Sao_Paulo",
  },
  horapgConfig: {
    enabled: false,
    times: ["08:00"],
    timezone: "America/Sao_Paulo",
  },
  customResponses: [],
  scheduledMessages: [],
};

const run = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const requests = [];
  let linked = false;
  let settings = structuredClone(baseSettings);

  await page.addInitScript(() => {
    localStorage.clear();
    class TestWebSocket {
      static OPEN = 1;
      static instances = [];
      constructor(url) {
        this.url = url;
        this.readyState = TestWebSocket.OPEN;
        TestWebSocket.instances.push(this);
        window.setTimeout(() => this.onopen?.({ type: "open" }), 0);
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }
    window.WebSocket = TestWebSocket;
    window.__emitBotAdminRealtime = (value) => {
      for (const socket of TestWebSocket.instances)
        socket.onmessage?.({ data: JSON.stringify(value) });
    };
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    requests.push(`${method} ${url.pathname}${url.search}`);
    if (process.env.DEBUG_BOTADMIN_E2E) console.error(`[api] ${method} ${url.pathname}`);
    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(payload),
      });

    if (url.pathname === "/api/auth/session")
      return json({ user: { id: 77, name: "Validação BotAdmin", email: "qa@botadmin.shop" } });
    if (url.pathname === "/api/bot-instances")
      return json({
        instances: [
          {
            id: 584,
            name: "Perfil de validação",
            phone: "5593999999999",
            sessionStatus: "connected",
          },
        ],
      });
    if (url.pathname === "/api/internal-groups") return json({ groups: [] });
    if (url.pathname === "/api/bot-groups" && method === "POST") {
      linked = true;
      return json(
        {
          message: "Grupo vinculado com sucesso.",
          group: {
            id: 912,
            instanceId: 584,
            remoteId: "120363999999999999@g.us",
            name: "Grupo WhatsApp real",
            status: "disabled",
            participantCount: 148,
          },
        },
        201,
      );
    }
    if (url.pathname === "/api/bot-groups" && method === "GET")
      return json({
        groups: linked
          ? [
              {
                id: 912,
                instanceId: 584,
                remoteId: "120363999999999999@g.us",
                name: "Grupo WhatsApp real",
                status: "disabled",
                participantCount: 148,
              },
            ]
          : [],
      });
    if (
      url.pathname === "/api/bot-instances/584/whatsapp-conversations" &&
      method === "GET"
    )
      return json({
        threads: [
          {
            instanceId: 584,
            chatJid: "120363999999999999@g.us",
            title: "Grupo WhatsApp real",
            chatType: "chat",
            phone: "148 participantes",
            unreadCount: 3,
            lastMessagePreview: "Mensagem recebida agora",
            lastMessageAt: "2026-09-02T10:10:00.000Z",
            instanceIsAdmin: true,
          },
        ],
      });
    if (url.pathname.endsWith("/messages") && method === "GET")
      return json({
        messages: [
          {
            id: "m-1",
            messageId: "m-1",
            direction: "incoming",
            senderName: "Participante",
            text: "Mensagem do grupo WhatsApp real",
            createdAt: "2026-09-02T10:10:00.000Z",
          },
        ],
        hasMore: false,
      });
    if (url.pathname === "/api/bot-groups/912/settings" && method === "GET")
      return json({ settings });
    if (url.pathname === "/api/bot-groups/912/settings" && method === "PATCH") {
      const payload = request.postDataJSON();
      settings = {
        ...settings,
        ...payload,
        commandToggles: {
          ...settings.commandToggles,
          ...(payload.commandToggles || {}),
        },
      };
      return json({ settings });
    }
    if (url.pathname === "/api/bot-groups/912" && method === "PATCH") {
      const payload = request.postDataJSON();
      return json({
        group: {
          id: 912,
          instanceId: 584,
          remoteId: "120363999999999999@g.us",
          name: "Grupo WhatsApp real",
          status: payload.active ? "active" : "disabled",
          participantCount: 148,
        },
      });
    }
    return json({});
  });

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (process.env.DEBUG_BOTADMIN_E2E) console.error(`[console] ${message.type()}: ${message.text()}`);
  });
  if (process.env.DEBUG_BOTADMIN_E2E) console.error("[step] goto");
  await page.goto(`${origin}/dashboard/user?section=conversations`, {
    waitUntil: "domcontentloaded",
  });

  const groupRow = page.getByText("Grupo WhatsApp real", { exact: true }).first();
  if (process.env.DEBUG_BOTADMIN_E2E) console.error("[step] wait group row");
  await groupRow.waitFor({ state: "visible" });
  if (process.env.DEBUG_BOTADMIN_E2E) console.error("[step] click group row");
  await groupRow.click();

  const robotShortcut = page.locator(".chat-header .group-bot-shortcut");
  if (process.env.DEBUG_BOTADMIN_E2E) console.error("[step] wait robot shortcut");
  await robotShortcut.waitFor({ state: "visible" });
  if (process.env.DEBUG_BOTADMIN_E2E) console.error("[step] click robot shortcut");
  await robotShortcut.click();

  await page.getByRole("heading", { name: "Bot do grupo" }).waitFor();
  await page.getByText("Robô no grupo", { exact: true }).waitFor();
  await page.getByText("Boas-vindas", { exact: true }).waitFor();
  await page.getByText("Anti-link", { exact: true }).waitFor();

  const welcomeTile = page.locator(".activation-tile").filter({ hasText: "Boas-vindas" });
  await welcomeTile.locator('input[type="checkbox"]').check();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".activation-tile"))
      .find((node) => node.textContent?.includes("Boas-vindas"))
      ?.textContent?.includes("Ligado"),
  );

  await page.locator(".group-automation-modal > header button[aria-label='Fechar']").click({ force: true });
  await page.evaluate(() => {
    window.__emitBotAdminRealtime({
      type: "conversation.message.upserted",
      eventType: "conversation.message.upserted",
      sequenceId: 21,
      instanceId: 584,
      chatJid: "120363999999999999@g.us",
      thread: {
        instanceId: 584,
        chatJid: "120363999999999999@g.us",
        chatType: "group",
        title: "Grupo WhatsApp real",
        linkedGroupId: 912,
        internalBotEnabled: true,
        participantsCount: 148,
      },
      message: {
        id: "m-realtime",
        messageId: "m-realtime",
        direction: "incoming",
        senderName: "Participante em tempo real",
        text: "Mensagem realtime sem esperar recarregar",
        createdAt: "2026-09-02T10:11:00.000Z",
      },
    });
  });
  await page.getByText("Mensagem realtime sem esperar recarregar", { exact: true }).waitFor();
  await page.locator(".chat-header .group-bot-shortcut.is-active").waitFor();
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const realtimeRobotActive = await robotShortcut.evaluate((node) =>
    node.classList.contains("is-active"),
  );
  const realtimeMessageVisible = await page
    .getByText("Mensagem realtime sem esperar recarregar", { exact: true })
    .isVisible();
  const realtimeSequence = await page.evaluate(() =>
    localStorage.getItem("botadmin.react.77.realtime-sequence"),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/dashboard/user?section=conversations`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByText("Grupo WhatsApp real", { exact: true }).first().waitFor();
  await page.getByText("Grupo WhatsApp real", { exact: true }).first().click();
  const mobileRobotShortcut = page.locator(".chat-header .group-bot-shortcut");
  await mobileRobotShortcut.waitFor({ state: "visible" });
  await mobileRobotShortcut.click();
  await page.getByRole("heading", { name: "Bot do grupo" }).waitFor();
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    modalWidth: document.querySelector(".group-automation-modal")?.getBoundingClientRect().width || 0,
  }));
  await page.screenshot({ path: `${screenshotPath}.mobile.png`, fullPage: true });

  const result = {
    linkedRequest: requests.some((value) => value === "POST /api/bot-groups"),
    settingsLoaded: requests.some(
      (value) => value === "GET /api/bot-groups/912/settings",
    ),
    welcomeSaved: requests.some(
      (value) => value === "PATCH /api/bot-groups/912/settings",
    ),
    robotActiveAfterRealtime: realtimeRobotActive,
    realtimeMessageVisible,
    sequenceCursor: realtimeSequence,
    pageErrors,
    mobileLayout,
    screenshotPath,
  };

  await browser.close();
  if (
    !result.linkedRequest ||
    !result.settingsLoaded ||
    !result.welcomeSaved ||
    !result.robotActiveAfterRealtime ||
    !result.realtimeMessageVisible ||
    result.sequenceCursor !== "21" ||
    result.mobileLayout.documentWidth > result.mobileLayout.viewport + 1 ||
    result.mobileLayout.bodyWidth > result.mobileLayout.viewport + 1 ||
    result.mobileLayout.modalWidth <= 0 ||
    result.pageErrors.length
  ) {
    throw new Error(`Validação incompleta: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
