import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { ensureUserTable, getDb } from "lib/db";

const TABLE_NAME = "affiliate_ml_message_templates";
const PROVIDER_KEY = "shopee";
const MAX_ITEM_TEXT_LENGTH = 4000;
const MAX_BUTTON_LABEL_LENGTH = 40;
const MAX_FOOTER_TEXT_LENGTH = 120;
const MAX_PROVIDER_TITLE_LENGTH = 80;
const DEFAULT_BUTTON_LABEL = "🔗 Acessar oferta";
const DEFAULT_FOOTER_TEXT = "Oferta automática de afiliado";
const DEFAULT_PROVIDER_TITLE = "*_Shopee_*";
const DEFAULT_DIRECT_TEMPLATE_TEXT = [
  "🛒 *_Shopee_*",
  "📦 *{{titulo}}*",
  "",
  "💰 de ~{{preco_antigo_formatado}}~ por *{{preco_formatado}}*",
  "💳 {{preco_parcelado}}",
  "⭐ Avaliação: {{avaliacao}}",
  "📈 Vendidos: {{vendidos}}",
  "📦 Estoque: {{estoque}}",
  "🚚 {{frete}}",
  "🛡️ {{garantia}}",
  "📌 Condição: {{condicao}}",
  "🏷️ Cupom: *{{cupom}}*",
  "🧾 {{cupom_detalhes}}",
].join("\n");

export type AffiliateShopeeMessageTemplateItem = {
  key: string;
  label: string;
  hint: string;
  enabled: boolean;
  text: string;
};

export type AffiliateShopeeMessageTemplateSummary = {
  provider: "shopee";
  items: AffiliateShopeeMessageTemplateItem[];
  buttonLabel: string;
  footerText: string;
  providerTitle: string;
  updatedAt: string | null;
};

type AffiliateShopeeMessageTemplateRow = RowDataPacket & {
  id: number;
  user_id: number;
  provider: string;
  template_json: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TemplateItemDefinition = {
  key: string;
  label: string;
  hint: string;
  defaultText: string;
  enabledByDefault: boolean;
};

const TEMPLATE_TOKEN_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const TEMPLATE_ITEM_DEFINITIONS: TemplateItemDefinition[] = [
  {
    key: "header",
    label: "Cabeçalho",
    hint: "Linha principal da oferta.",
    defaultText: "🛒 *_Shopee_*",
    enabledByDefault: false,
  },
  {
    key: "intro",
    label: "Abertura",
    hint: "Texto principal da oferta enviado no grupo.",
    defaultText: DEFAULT_DIRECT_TEMPLATE_TEXT,
    enabledByDefault: true,
  },
  {
    key: "title",
    label: "Título do produto",
    hint: "Nome principal do item.",
    defaultText: "📦 *{{titulo}}*",
    enabledByDefault: false,
  },
  {
    key: "description",
    label: "Descrição curta",
    hint: "Resumo opcional do anúncio.",
    defaultText: "📝 {{descricao}}",
    enabledByDefault: false,
  },
  {
    key: "price",
    label: "Preço",
    hint: "Preço atual do anúncio.",
    defaultText: "💰 *Por: {{preco_formatado}}*",
    enabledByDefault: false,
  },
  {
    key: "installments",
    label: "Parcelamento",
    hint: "Condição de parcelamento quando existir.",
    defaultText: "💳 {{preco_parcelado}}",
    enabledByDefault: false,
  },
  {
    key: "old_price",
    label: "Preço antigo",
    hint: "Mostra preço anterior quando houver promoção.",
    defaultText: "💸 De: ~{{preco_antigo_formatado}}~",
    enabledByDefault: false,
  },
  {
    key: "sold",
    label: "Vendidos",
    hint: "Quantidade vendida do item.",
    defaultText: "📈 Vendidos: {{vendidos}}",
    enabledByDefault: false,
  },
  {
    key: "stock",
    label: "Estoque",
    hint: "Quantidade disponível.",
    defaultText: "📦 Estoque: {{estoque}}",
    enabledByDefault: false,
  },
  {
    key: "shipping",
    label: "Frete",
    hint: "Frete grátis ou texto de frete.",
    defaultText: "🚚 {{frete}}",
    enabledByDefault: false,
  },
  {
    key: "condition",
    label: "Condição",
    hint: "Novo, usado ou condição personalizada.",
    defaultText: "📌 Condição: {{condicao}}",
    enabledByDefault: false,
  },
  {
    key: "warranty",
    label: "Garantia",
    hint: "Informação de garantia do anúncio.",
    defaultText: "🛡️ Garantia: {{garantia}}",
    enabledByDefault: false,
  },
  {
    key: "seller",
    label: "Vendedor",
    hint: "Nome ou ID do vendedor.",
    defaultText: "🏪 Vendedor: {{vendedor}}",
    enabledByDefault: false,
  },
  {
    key: "cta",
    label: "Chamada final",
    hint: "Texto final. Se usar {{url}}, ele aparece no corpo.",
    defaultText: "🔗 {{url}}",
    enabledByDefault: false,
  },
];

const TEMPLATE_DEFINITION_BY_KEY = new Map(TEMPLATE_ITEM_DEFINITIONS.map((entry) => [entry.key, entry] as const));

const ensureTasks = new Map<string, Promise<void>>();
const ensureDone = new Set<string>();

const runEnsure = (key: string, ensureFn: () => Promise<void>): Promise<void> => {
  if (ensureDone.has(key)) return Promise.resolve();
  const active = ensureTasks.get(key);
  if (active) return active;
  const task = ensureFn()
    .then(() => {
      ensureDone.add(key);
      ensureTasks.delete(key);
    })
    .catch((error) => {
      ensureTasks.delete(key);
      throw error;
    });
  ensureTasks.set(key, task);
  return task;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizeText = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  return normalized.slice(0, MAX_ITEM_TEXT_LENGTH);
};

const normalizeCompactText = (value: unknown, fallback: string, maxLength: number): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.slice(0, maxLength);
};

const normalizeButtonLabel = (value: unknown): string =>
  normalizeCompactText(value, DEFAULT_BUTTON_LABEL, MAX_BUTTON_LABEL_LENGTH);

const normalizeFooterText = (value: unknown): string =>
  normalizeCompactText(value, DEFAULT_FOOTER_TEXT, MAX_FOOTER_TEXT_LENGTH);

const normalizeProviderTitle = (value: unknown): string =>
  normalizeCompactText(value, DEFAULT_PROVIDER_TITLE, MAX_PROVIDER_TITLE_LENGTH);

const buildDefaultItems = (): AffiliateShopeeMessageTemplateItem[] => {
  return TEMPLATE_ITEM_DEFINITIONS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    hint: entry.hint,
    enabled: entry.enabledByDefault,
    text: entry.defaultText,
  }));
};

const normalizeStoredItems = (input: unknown): AffiliateShopeeMessageTemplateItem[] => {
  const sourceArray = Array.isArray(input) ? input : [];
  const sourceByKey = new Map<string, Record<string, unknown>>();
  sourceArray.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const key = typeof (entry as { key?: unknown }).key === "string" ? String((entry as { key: string }).key).trim() : "";
    if (!key || sourceByKey.has(key)) return;
    sourceByKey.set(key, entry as Record<string, unknown>);
  });

  return TEMPLATE_ITEM_DEFINITIONS.map((definition) => {
    const source = sourceByKey.get(definition.key);
    const enabled =
      typeof source?.enabled === "boolean"
        ? source.enabled
        : typeof source?.active === "boolean"
          ? source.active
          : definition.enabledByDefault;

    return {
      key: definition.key,
      label: definition.label,
      hint: definition.hint,
      enabled,
      text: normalizeText(source?.text, definition.defaultText),
    };
  });
};

const ensureTemplateTable = async () =>
  runEnsure("affiliate-ml-message-template-table", async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'shopee',
        template_json LONGTEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_affiliate_ml_template_user_provider (user_id, provider),
        CONSTRAINT fk_affiliate_ml_template_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const [rows] = await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${TABLE_NAME} LIKE 'template_json'`);
    if (!Array.isArray(rows) || rows.length === 0) {
      await db.query(`ALTER TABLE ${TABLE_NAME} ADD COLUMN template_json LONGTEXT NOT NULL;`);
    }
  });

const fetchTemplateRow = async (userId: number): Promise<AffiliateShopeeMessageTemplateRow | null> => {
  await ensureTemplateTable();
  const db = getDb();
  const [rows] = await db.query<AffiliateShopeeMessageTemplateRow[]>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE user_id = ? AND provider = ?
      LIMIT 1
    `,
    [userId, PROVIDER_KEY],
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
};

const mapSummary = (row: AffiliateShopeeMessageTemplateRow | null): AffiliateShopeeMessageTemplateSummary => {
  const parsed = (() => {
    const raw = row?.template_json;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  })();
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
  const itemsSource = Array.isArray(parsed) ? parsed : record?.items ?? parsed;

  return {
    provider: "shopee",
    items: normalizeStoredItems(itemsSource),
    buttonLabel: normalizeButtonLabel(record?.buttonLabel ?? record?.button_text),
    footerText: normalizeFooterText(record?.footerText ?? record?.footer_text),
    providerTitle: normalizeProviderTitle(record?.providerTitle ?? record?.provider_title),
    updatedAt: toIso(row?.updated_at),
  };
};

export const getAffiliateShopeeMessageTemplateForUser = async (
  userId: number,
): Promise<AffiliateShopeeMessageTemplateSummary> => {
  const row = await fetchTemplateRow(userId);
  return mapSummary(row);
};

export const saveAffiliateShopeeMessageTemplateForUser = async (
  userId: number,
  payload: { items?: unknown; buttonLabel?: unknown; footerText?: unknown; providerTitle?: unknown },
): Promise<AffiliateShopeeMessageTemplateSummary> => {
  await ensureTemplateTable();
  const db = getDb();
  const normalizedItems = normalizeStoredItems(payload.items);
  const buttonLabel = normalizeButtonLabel(payload.buttonLabel);
  const footerText = normalizeFooterText(payload.footerText);
  const providerTitle = normalizeProviderTitle(payload.providerTitle);
  const serializableItems = normalizedItems.map((entry) => ({
    key: entry.key,
    enabled: entry.enabled,
    text: entry.text,
  }));
  const serializablePayload = {
    items: serializableItems,
    buttonLabel,
    footerText,
    providerTitle,
  };

  await db.query<ResultSetHeader>(
    `
      INSERT INTO ${TABLE_NAME} (user_id, provider, template_json)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        template_json = VALUES(template_json),
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, PROVIDER_KEY, JSON.stringify(serializablePayload)],
  );

  return await getAffiliateShopeeMessageTemplateForUser(userId);
};

const applyTemplateTokens = (text: string, context: Record<string, string>): string => {
  return text.replace(TEMPLATE_TOKEN_REGEX, (_match, key: string) => {
    const value = context[key];
    return typeof value === "string" ? value : "";
  });
};

const cleanupRenderedLine = (value: string): string => {
  let cleaned = value
    .replace(/~\s*~/g, "")
    .replace(/\*\s*\*/g, "")
    .replace(/_\s*_/g, "")
    .replace(/`\s*`/g, "")
    .replace(/\(\s*\)/g, "");

  cleaned = cleaned
    .replace(/\bde\s+por\b/gi, "por")
    .replace(/^💰\s*por\s+/u, "💰 ")
    .replace(/\bpor\s*$/i, "");

  return cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
};

const extractTemplateTokens = (text: string): string[] => {
  const tokens = new Set<string>();
  text.replace(TEMPLATE_TOKEN_REGEX, (_match, key: string) => {
    tokens.add(String(key));
    return "";
  });
  return Array.from(tokens);
};

const hasVisibleContent = (text: string): boolean => {
  return /[A-Za-z0-9À-ÿ]/.test(text);
};

const renderTemplateEntryLines = (
  text: string,
  context: Record<string, string>,
): string[] => {
  const sourceLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  let pendingBlank = false;

  sourceLines.forEach((rawLine) => {
    const tokens = extractTemplateTokens(rawLine);
    if (tokens.length > 0 && tokens.every((token) => !context[token])) {
      return;
    }

    const rendered = cleanupRenderedLine(
      applyTemplateTokens(rawLine, context)
        .replace(/\r\n/g, "\n")
        .trim(),
    );

    if (!rendered) {
      pendingBlank = lines.length > 0;
      return;
    }
    if (!hasVisibleContent(rendered)) {
      return;
    }

    if (pendingBlank && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    pendingBlank = false;
    lines.push(rendered);
  });

  while (lines[0] === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
};

export const renderAffiliateShopeeMessageTemplate = (
  items: AffiliateShopeeMessageTemplateItem[],
  context: Record<string, string>,
): string => {
  const normalizedItems = normalizeStoredItems(items);
  const normalizedContext: Record<string, string> = {};
  Object.entries(context).forEach(([key, value]) => {
    normalizedContext[key] = typeof value === "string" ? value.trim() : "";
  });

  const lines: string[] = [];
  normalizedItems.forEach((entry) => {
    if (!entry.enabled) return;

    const renderedLines = renderTemplateEntryLines(entry.text, normalizedContext);
    if (renderedLines.length === 0) {
      return;
    }

    const definition = TEMPLATE_DEFINITION_BY_KEY.get(entry.key);
    if (definition?.key === "intro" && lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }

    lines.push(...renderedLines);
  });

  if (lines.length === 0) {
    const fallback = normalizedContext.intro_text || normalizedContext.query || "Oferta disponível.";
    return fallback.trim() || "Oferta disponível.";
  }

  return lines.join("\n").trim();
};

export const getAffiliateShopeeTemplateTokensHelp = (): Array<{ token: string; description: string }> => {
  return [
    { token: "{{intro_text}}", description: "Introdução dinâmica (usa intro personalizado ou termo da busca)." },
    { token: "{{query}}", description: "Termo de busca configurado no conteúdo afiliado." },
    { token: "{{titulo}}", description: "Título do produto." },
    { token: "{{descricao}}", description: "Descrição curta do produto." },
    { token: "{{preco_formatado}}", description: "Preço principal formatado." },
    { token: "{{preco_parcelado}}", description: "Parcelamento formatado." },
    { token: "{{preco_antigo_formatado}}", description: "Preço antigo formatado." },
    { token: "{{vendidos}}", description: "Quantidade vendida." },
    { token: "{{estoque}}", description: "Estoque disponível." },
    { token: "{{frete}}", description: "Texto do frete ou frete grátis." },
    { token: "{{condicao}}", description: "Condição do produto." },
    { token: "{{garantia}}", description: "Garantia informada." },
    { token: "{{vendedor}}", description: "Nome/ID do vendedor." },
    { token: "{{avaliacao}}", description: "Nota/rating do produto na Shopee." },
    { token: "{{rating}}", description: "Alias para nota/rating do produto." },
    { token: "{{cupom}}", description: "Código de cupom manual cadastrado no produto." },
    { token: "{{coupon}}", description: "Alias para código de cupom." },
    { token: "{{cupom_detalhes}}", description: "Detalhes/regras do cupom manual." },
    { token: "{{coupon_details}}", description: "Alias para detalhes do cupom." },
    { token: "{{url}}", description: "URL final do produto/link afiliado." },
    { token: "{{item_id}}", description: "ID do item no Shopee." },
  ];
};

export const getDefaultAffiliateShopeeMessageTemplate = (): AffiliateShopeeMessageTemplateSummary => ({
  provider: "shopee",
  items: buildDefaultItems(),
  buttonLabel: DEFAULT_BUTTON_LABEL,
  footerText: DEFAULT_FOOTER_TEXT,
  providerTitle: DEFAULT_PROVIDER_TITLE,
  updatedAt: null,
});
