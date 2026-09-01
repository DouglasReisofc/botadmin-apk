import { RowDataPacket } from "mysql2";

import { getMetaApiVersion } from "./meta";
import {
  AdminMetaTemplateRow,
  AdminWebhookRow,
  ensureAdminMetaTemplatesTable,
  getDb,
} from "./db";
import {
  MetaApiError,
  resolveMetaProfileCredentials,
} from "./meta-profile";
import {
  META_TEMPLATE_CATEGORIES,
  META_TEMPLATE_LIMITS,
} from "types/admin-meta-templates";
import type {
  AdminMetaTemplate,
  AdminMetaTemplateCreatePayload,
  AdminMetaTemplateUpdatePayload,
  MetaTemplateCategory,
  MetaTemplateComponent,
  MetaTemplateButton,
  MetaTemplateButtonInput,
} from "types/admin-meta-templates";

export class AdminMetaTemplateError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminMetaTemplateError";
    this.status = status;
  }
}

type MetaTemplateCredentials = {
  accessToken: string;
  businessAccountId: string;
};

type MetaTemplateApiPayload = {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string | null;
  components?: MetaTemplateComponent[] | null;
  quality_score?: { score?: string | null } | string | null;
  rejected_reason?: string | null;
  created_time?: string | null;
  modified_time?: string | null;
};

type SanitizedTemplatePayload = {
  name?: string;
  language: string;
  category: MetaTemplateCategory;
  headerType: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  header: string | null;
  headerMediaHandle: string | null;
  body: string;
  footer: string | null;
  buttons: SanitizedButton[];
  preserveHeader: boolean;
  preserveButtons: boolean;
};

type SanitizedButton =
  | {
      kind: "quick_reply";
      text: string;
    }
  | {
      kind: "url";
      text: string;
      url: string;
      example?: string | null;
    }
  | {
      kind: "phone";
      text: string;
      phoneNumber: string;
    };

const META_TEMPLATE_FIELDS = [
  "id",
  "name",
  "language",
  "status",
  "category",
  "components",
  "quality_score",
  "rejected_reason",
] as const;

const TEMPLATE_NAME_REGEX = /^[a-z0-9_]{3,512}$/;
const LANGUAGE_CODE_REGEX = /^[a-z]{2,}_[A-Z]{2,}$/;

const parseMetaJson = (raw: string): unknown => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    console.error("[Meta Templates] Failed to parse Meta response", error, raw);
    return null;
  }
};

const readMetaResponse = async (response: Response, context: string) => {
  const bodyText = await response.text().catch(() => "");
  const body = parseMetaJson(bodyText);

  if (!response.ok) {
    throw new MetaApiError({
      status: response.status,
      statusText: response.statusText,
      bodyText,
      body,
      context,
    });
  }

  return { body, bodyText };
};

const toDateOrNull = (value: unknown): Date | null => {
  if (typeof value === "string" || value instanceof Date) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
};

const parseComponents = (raw: string | null): MetaTemplateComponent[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (component): component is MetaTemplateComponent =>
          component != null && typeof component === "object",
      );
    }
  } catch (error) {
    console.error("[Meta Templates] Failed to parse stored components", error);
  }

  return [];
};

const mapRowToTemplate = (row: AdminMetaTemplateRow): AdminMetaTemplate => ({
  id: row.id,
  templateId: row.template_id,
  name: row.name,
  language: row.language,
  category: row.category,
  status: row.status,
  qualityScore: row.quality_score,
  rejectedReason: row.rejected_reason,
  components: parseComponents(row.components),
  componentsRaw: row.components,
  metaCreatedAt: row.meta_created_at
    ? (row.meta_created_at instanceof Date
        ? row.meta_created_at.toISOString()
        : new Date(row.meta_created_at).toISOString())
    : null,
  metaUpdatedAt: row.meta_updated_at
    ? (row.meta_updated_at instanceof Date
        ? row.meta_updated_at.toISOString()
        : new Date(row.meta_updated_at).toISOString())
    : null,
  lastSyncedAt: row.last_synced_at
    ? (row.last_synced_at instanceof Date
        ? row.last_synced_at.toISOString()
        : new Date(row.last_synced_at).toISOString())
    : null,
  businessAccountId: row.business_account_id,
  createdAt: row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : new Date(row.updated_at).toISOString(),
});

const extractQualityScore = (value: unknown): string | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "object" &&
    "score" in (value as Record<string, unknown>) &&
    typeof (value as { score?: unknown }).score === "string"
  ) {
    return (value as { score: string }).score;
  }

  return null;
};

const serializeComponents = (components: MetaTemplateComponent[] | null | undefined) => {
  if (!components || components.length === 0) {
    return null;
  }

  try {
    return JSON.stringify(components);
  } catch (error) {
    console.error("[Meta Templates] Failed to serialize components", error, components);
    return null;
  }
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const sanitizeTemplateName = (value: unknown): string => {
  if (!isNonEmptyString(value)) {
    throw new AdminMetaTemplateError(
      "Informe um nome para o modelo utilizando letras minúsculas, números ou underscore.",
    );
  }

  const normalized = value.trim();

  if (!TEMPLATE_NAME_REGEX.test(normalized)) {
    throw new AdminMetaTemplateError(
      "O nome do modelo deve conter apenas letras minúsculas, números ou underscore (mínimo 3 caracteres).",
    );
  }

  return normalized;
};

const sanitizeLanguage = (value: unknown): string => {
  if (!isNonEmptyString(value)) {
    throw new AdminMetaTemplateError(
      "Informe o código do idioma do modelo, por exemplo pt_BR, en_US ou es_ES.",
    );
  }

  const trimmed = value.trim();

  if (!LANGUAGE_CODE_REGEX.test(trimmed)) {
    throw new AdminMetaTemplateError(
      "O código do idioma deve seguir o formato ll_CC (ex: pt_BR, en_US).",
    );
  }

  return trimmed;
};

const sanitizeCategory = (value: unknown): MetaTemplateCategory => {
  if (!isNonEmptyString(value)) {
    throw new AdminMetaTemplateError(
      "Selecione uma categoria válida para o modelo (Marketing, Utility ou Authentication).",
    );
  }

  const upper = value.trim().toUpperCase();
  const category = META_TEMPLATE_CATEGORIES.find((candidate) => candidate === upper);

  if (!category) {
    throw new AdminMetaTemplateError(
      "Categoria inválida. Utilize MARKETING, UTILITY ou AUTHENTICATION.",
    );
  }

  return category;
};

const sanitizeOptionalLimitedText = (
  value: unknown,
  limit: number,
  fieldName: string,
): string | null => {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length > limit) {
    throw new AdminMetaTemplateError(
      `${fieldName} pode ter no máximo ${limit} caracteres.`,
    );
  }

  return normalized;
};

const sanitizeRequiredLimitedText = (
  value: unknown,
  limit: number,
  fieldName: string,
): string => {
  if (!isNonEmptyString(value)) {
    throw new AdminMetaTemplateError(`Informe o conteúdo do ${fieldName}.`);
  }

  const normalized = value.trim();

  if (normalized.length > limit) {
    throw new AdminMetaTemplateError(
      `${fieldName} pode ter no máximo ${limit} caracteres.`,
    );
  }

  return normalized;
};

const extractTemplateVariableIndexes = (text: string | null | undefined): number[] => {
  if (!text) {
    return [];
  }

  const matches = text.matchAll(/{{\s*(\d+)\s*}}/g);
  const indexes = new Set<number>();
  for (const match of matches) {
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index) && index > 0) {
      indexes.add(index);
    }
  }

  return Array.from(indexes).sort((a, b) => a - b);
};

const sanitizeHeaderFormat = (value: unknown): "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" => {
  if (typeof value !== "string") {
    return "TEXT";
  }
  const normalized = value.trim().toUpperCase();
  if (["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(normalized)) {
    return normalized as "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  }
  return "TEXT";
};

const sanitizeMediaHandle = (value: unknown, format: "IMAGE" | "VIDEO" | "DOCUMENT"): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminMetaTemplateError(
      `Informe o handle do arquivo para o cabeçalho (${format.toLowerCase()}).`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > 255) {
    throw new AdminMetaTemplateError("O handle do cabeçalho pode ter no máximo 255 caracteres.");
  }
  return trimmed;
};

const sanitizeButtonText = (value: unknown, index: number): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminMetaTemplateError(`Informe o texto do botão ${index + 1}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > META_TEMPLATE_LIMITS.buttonText) {
    throw new AdminMetaTemplateError(
      `O texto do botão ${index + 1} pode ter no máximo ${META_TEMPLATE_LIMITS.buttonText} caracteres.`,
    );
  }
  return trimmed;
};

const sanitizeUrl = (entry: MetaTemplateButtonInput, index: number): { url: string; example: string | null } => {
  const rawUrl = typeof entry === "object" && entry !== null && typeof entry.url === "string"
    ? entry.url.trim()
    : "";
  if (!rawUrl) {
    throw new AdminMetaTemplateError(`Informe a URL do botão ${index + 1}.`);
  }

  try {
    const parsed = new URL(rawUrl);
    if (!parsed.protocol.startsWith("http")) {
      throw new Error("Invalid protocol");
    }
  } catch {
    throw new AdminMetaTemplateError(`Informe uma URL válida para o botão ${index + 1}.`);
  }

  const example =
    typeof entry === "object" && entry !== null && typeof entry.example === "string"
      ? entry.example.trim()
      : "";

  return { url: rawUrl, example: example || null };
};

const sanitizePhoneNumber = (value: unknown, index: number): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminMetaTemplateError(`Informe o telefone do botão ${index + 1}.`);
  }
  const trimmed = value.trim();
  if (!/^\+?[0-9]{6,15}$/.test(trimmed)) {
    throw new AdminMetaTemplateError(
      `Informe um telefone válido para o botão ${index + 1} (use apenas números e opcionalmente o sinal de +).`,
    );
  }
  return trimmed;
};

const sanitizeButtonsInput = (value: unknown): SanitizedButton[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  if (value.length > META_TEMPLATE_LIMITS.buttonCount) {
    throw new AdminMetaTemplateError(
      `Adicione no máximo ${META_TEMPLATE_LIMITS.buttonCount} botões por modelo.`,
    );
  }

  const sanitized: SanitizedButton[] = [];
  let quickReplyCount = 0;
  let ctaCount = 0;

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AdminMetaTemplateError(`Configuração inválida para o botão ${index + 1}.`);
    }

    const record = entry as MetaTemplateButtonInput;
    const kind = (record.kind ?? "").toString().trim();

    if (kind === "quick_reply") {
      const text = sanitizeButtonText((record as { text?: unknown }).text, index);
      sanitized.push({ kind: "quick_reply", text });
      quickReplyCount += 1;
    } else if (kind === "url") {
      const text = sanitizeButtonText((record as { text?: unknown }).text, index);
      const { url, example } = sanitizeUrl(record, index);
      sanitized.push({ kind: "url", text, url, example });
      ctaCount += 1;
    } else if (kind === "phone") {
      const text = sanitizeButtonText((record as { text?: unknown }).text, index);
      const phoneNumber = sanitizePhoneNumber((record as { phoneNumber?: unknown }).phoneNumber, index);
      sanitized.push({ kind: "phone", text, phoneNumber });
      ctaCount += 1;
    } else {
      throw new AdminMetaTemplateError(
        `Tipo de botão não suportado no índice ${index + 1}. Utilize resposta rápida, link ou telefone.`,
      );
    }
  });

  if (quickReplyCount > 0 && ctaCount > 0) {
    throw new AdminMetaTemplateError(
      "Não é possível combinar botões de resposta rápida com botões de chamada para ação no mesmo modelo.",
    );
  }

  if (ctaCount > 2) {
    throw new AdminMetaTemplateError("Adicione no máximo 2 botões de chamada para ação por modelo.");
  }

  if (quickReplyCount > META_TEMPLATE_LIMITS.buttonCount) {
    throw new AdminMetaTemplateError(
      `Adicione no máximo ${META_TEMPLATE_LIMITS.buttonCount} botões de resposta rápida.`,
    );
  }

  return sanitized;
};

const resolveTemplateEditState = (
  status: string | null | undefined,
): { editable: boolean; reason: string | null } => {
  const normalized = typeof status === "string" ? status.trim().toUpperCase() : "";

  if (!normalized) {
    return { editable: true, reason: null };
  }

  if (normalized === "PENDING" || normalized === "IN_APPEAL") {
    return {
      editable: false,
      reason: "Este modelo está em análise pela Meta. Aguarde a revisão ser concluída para editar novamente.",
    };
  }

  return {
    editable: true,
    reason: null,
  };
};

const sanitizeEditorPayload = (
  payload: AdminMetaTemplateCreatePayload | AdminMetaTemplateUpdatePayload,
  options: { requireName: boolean },
): SanitizedTemplatePayload => {
  const language = sanitizeLanguage(payload.language);
  const category = sanitizeCategory(payload.category);
  const preserveHeader =
    typeof (payload as AdminMetaTemplateUpdatePayload).preserveHeader === "boolean"
      ? Boolean((payload as AdminMetaTemplateUpdatePayload).preserveHeader)
      : false;
  const preserveButtons =
    typeof (payload as AdminMetaTemplateUpdatePayload).preserveButtons === "boolean"
      ? Boolean((payload as AdminMetaTemplateUpdatePayload).preserveButtons)
      : false;

  let headerType: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" = "NONE";
  let headerValue: string | null = null;
  let headerMediaHandle: string | null = null;

  if (!preserveHeader) {
    const requestedFormat = sanitizeHeaderFormat((payload as { headerType?: unknown }).headerType);
    if (requestedFormat === "NONE") {
      headerType = "NONE";
    } else if (requestedFormat === "TEXT") {
      const headerText = sanitizeRequiredLimitedText(
        (payload as { header?: unknown }).header,
        META_TEMPLATE_LIMITS.header,
        "cabeçalho",
      );
      headerType = "TEXT";
      headerValue = headerText;
    } else {
      const handle = sanitizeMediaHandle(
        (payload as { headerMediaHandle?: unknown }).headerMediaHandle,
        requestedFormat,
      );
      headerType = requestedFormat;
      headerMediaHandle = handle;
    }
  }

  const body = sanitizeRequiredLimitedText(
    payload.body,
    META_TEMPLATE_LIMITS.body,
    "corpo",
  );

  const footer = sanitizeOptionalLimitedText(
    payload.footer,
    META_TEMPLATE_LIMITS.footer,
    "rodapé",
  );

  const buttons = preserveButtons ? [] : sanitizeButtonsInput((payload as { buttons?: unknown }).buttons);

  const base: SanitizedTemplatePayload = {
    language,
    category,
    headerType,
    header: headerValue,
    headerMediaHandle,
    body,
    footer,
    buttons,
    preserveHeader,
    preserveButtons,
  };

  if (options.requireName) {
    base.name = sanitizeTemplateName(payload.name);
  } else if (payload.name != null) {
    base.name = sanitizeTemplateName(payload.name);
  }

  return base;
};

const buildHeaderComponentFromPayload = (
  payload: SanitizedTemplatePayload,
  existingExample?: MetaTemplateComponent["example"],
): MetaTemplateComponent | null => {
  if (payload.preserveHeader) {
    return null;
  }

  if (payload.headerType === "NONE") {
    return null;
  }

  if (payload.headerType === "TEXT" && payload.header) {
    const component: MetaTemplateComponent = {
      type: "HEADER",
      format: "TEXT",
      text: payload.header,
    };
    const example = buildExamplePayload(payload.header, "HEADER", existingExample);
    if (example) {
      component.example = example;
    }
    return component;
  }

  if (
    (payload.headerType === "IMAGE" || payload.headerType === "VIDEO" || payload.headerType === "DOCUMENT") &&
    payload.headerMediaHandle
  ) {
    return {
      type: "HEADER",
      format: payload.headerType,
      example: {
        header_handle: [payload.headerMediaHandle],
      },
    };
  }

  return null;
};

const mapSanitizedButtonsToMeta = (buttons: SanitizedButton[]): MetaTemplateButton[] =>
  buttons.map((button) => {
    if (button.kind === "quick_reply") {
      return {
        type: "QUICK_REPLY",
        text: button.text,
      } as MetaTemplateButton;
    }

    if (button.kind === "url") {
      const payload: MetaTemplateButton = {
        type: "URL",
        text: button.text,
        url: button.url,
      };
      if (button.example) {
        payload.example = [button.example];
      }
      return payload;
    }

    const payload: MetaTemplateButton = {
      type: "PHONE_NUMBER",
      text: button.text,
      phone_number: button.phoneNumber,
    };
    return payload;
  });

const buildComponentsFromPayload = (payload: SanitizedTemplatePayload): MetaTemplateComponent[] => {
  const components: MetaTemplateComponent[] = [];

  const headerComponent = buildHeaderComponentFromPayload(payload);
  if (headerComponent) {
    components.push(headerComponent);
  }

  components.push({
    type: "BODY",
    text: payload.body,
  });

  if (payload.footer) {
    components.push({
      type: "FOOTER",
      text: payload.footer,
    });
  }

  if (!payload.preserveButtons && payload.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: mapSanitizedButtonsToMeta(payload.buttons),
    });
  }

  return components;
};

const isNonEmptyStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const collected = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return collected.length > 0 ? collected : null;
};

const buildExamplePayload = (
  text: string | null,
  type: "HEADER" | "BODY",
  existingExample: MetaTemplateComponent["example"],
): Record<string, string[]> | null => {
  if (!text) {
    return null;
  }

  const indexes = extractTemplateVariableIndexes(text);
  if (indexes.length === 0) {
    return null;
  }

  const key = type === "HEADER" ? "header_text" : "body_text";
  let existing: string[] | null = null;

  if (
    existingExample &&
    typeof existingExample === "object" &&
    key in (existingExample as Record<string, unknown>)
  ) {
    existing = isNonEmptyStringArray(
      (existingExample as Record<string, unknown>)[key],
    );
  }

  const values = indexes.map((_, position) => {
    if (existing && position < existing.length) {
      return existing[position];
    }
    return `Exemplo ${position + 1}`;
  });

  return { [key]: values };
};

const buildUpdatedComponents = (
  existingComponents: MetaTemplateComponent[],
  payload: SanitizedTemplatePayload,
): MetaTemplateComponent[] => {
  const updated: MetaTemplateComponent[] = [];

  let hasHeader = false;
  let hasBody = false;
  let hasFooter = false;
  let hasButtons = false;

  for (const component of existingComponents) {
    const type = (component.type ?? "").toUpperCase();

    if (type === "HEADER") {
      hasHeader = true;

      if (payload.preserveHeader) {
        updated.push(component);
      } else {
        const nextComponent = buildHeaderComponentFromPayload(payload, component.example);
        if (nextComponent) {
          updated.push(nextComponent);
        }
      }

      continue;
    }

    if (type === "BODY") {
      hasBody = true;
      const nextComponent: MetaTemplateComponent = {
        ...component,
        type: "BODY",
        text: payload.body,
      };
      const example = buildExamplePayload(
        payload.body,
        "BODY",
        component.example,
      );
      if (example) {
        nextComponent.example = example;
      } else {
        delete nextComponent.example;
      }
      updated.push(nextComponent);
      continue;
    }

    if (type === "FOOTER") {
      hasFooter = true;

      if (payload.footer) {
        const nextComponent: MetaTemplateComponent = {
          ...component,
          type: "FOOTER",
          text: payload.footer,
        };
        delete nextComponent.example;
        updated.push(nextComponent);
      }

      continue;
    }

    if (type === "BUTTONS") {
      hasButtons = true;

      if (payload.preserveButtons) {
        updated.push(component);
      } else if (payload.buttons.length > 0) {
        const nextComponent: MetaTemplateComponent = {
          ...component,
          type: "BUTTONS",
          buttons: mapSanitizedButtonsToMeta(payload.buttons),
        };
        delete nextComponent.example;
        updated.push(nextComponent);
      }

      continue;
    }

    updated.push(component);
  }

  if (!hasHeader && !payload.preserveHeader) {
    const appended = buildHeaderComponentFromPayload(payload);
    if (appended) {
      updated.unshift(appended);
    }
  }

  if (!hasBody) {
    const appended: MetaTemplateComponent = {
      type: "BODY",
      text: payload.body,
    };
    const example = buildExamplePayload(payload.body, "BODY", null);
    if (example) {
      appended.example = example;
    }
    updated.push(appended);
  }

  if (!hasFooter && payload.footer) {
    updated.push({
      type: "FOOTER",
      text: payload.footer,
    });
  }

  if (!hasButtons && !payload.preserveButtons && payload.buttons.length > 0) {
    const appended: MetaTemplateComponent = {
      type: "BUTTONS",
      buttons: mapSanitizedButtonsToMeta(payload.buttons),
    };
    updated.push(appended);
  }

  return updated;
};

const saveMetaTemplate = async (
  template: MetaTemplateApiPayload,
  {
    markSyncedAt,
    businessAccountId,
  }: { markSyncedAt?: Date; businessAccountId: string | null },
) => {
  await ensureAdminMetaTemplatesTable();
  const db = getDb();

  const now = markSyncedAt ?? new Date();
  const metaCreatedAt = toDateOrNull(template.created_time);
  const metaUpdatedAt = toDateOrNull(template.modified_time);
  const components = serializeComponents(template.components ?? []);
  const qualityScore = extractQualityScore(template.quality_score ?? null);

  await db.query(
    `
      INSERT INTO admin_meta_templates (
        template_id,
        name,
        language,
        category,
        status,
        quality_score,
        rejected_reason,
        components,
      meta_created_at,
      meta_updated_at,
      last_synced_at,
      business_account_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        language = VALUES(language),
        category = VALUES(category),
        status = VALUES(status),
        quality_score = VALUES(quality_score),
        rejected_reason = VALUES(rejected_reason),
        components = VALUES(components),
        meta_created_at = VALUES(meta_created_at),
        meta_updated_at = VALUES(meta_updated_at),
        last_synced_at = VALUES(last_synced_at),
        business_account_id = VALUES(business_account_id),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      template.id,
      template.name,
      template.language,
      template.category ?? null,
      template.status,
      qualityScore,
      template.rejected_reason ?? null,
      components,
      metaCreatedAt,
      metaUpdatedAt,
      now,
      businessAccountId,
    ],
  );
};

const fetchBusinessAccountId = async (
  accessToken: string,
  phoneNumberId: string,
) => {
  const version = getMetaApiVersion();
  const url = new URL(`https://graph.facebook.com/${version}/${phoneNumberId}`);
  url.searchParams.set("fields", "whatsapp_business_account");

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const { body } = await readMetaResponse(
      response,
      "[Meta Templates] Falha ao descobrir o Business Account ID através do phone_number_id",
    );

    if (!body || typeof body !== "object") {
      return null;
    }

    const raw = (body as { whatsapp_business_account?: unknown }).whatsapp_business_account;
    if (!raw) {
      return null;
    }

    if (typeof raw === "string") {
      return raw;
    }

    if (
      typeof raw === "object" &&
      raw !== null &&
      "id" in raw &&
      typeof (raw as { id?: unknown }).id === "string"
    ) {
      return (raw as { id: string }).id;
    }

    return null;
  } catch (error) {
    console.error(
      "[Meta Templates] Erro ao consultar o Business Account ID via phone_number_id",
      error,
    );
    return null;
  }
};

export const resolveMetaTemplateCredentials = async (
  webhook: AdminWebhookRow | null,
): Promise<MetaTemplateCredentials | null> => {
  const webhookAccessToken = webhook?.access_token?.trim() ?? "";
  const webhookBusinessAccountId = webhook?.business_account_id?.trim() ?? "";

  const envAccessToken = process.env.META_TOKEN?.trim() ?? "";
  const envBusinessAccountId =
    process.env.META_BUSINESS_ACCOUNT_ID?.trim() ??
    process.env.BUSINESS_ACCOUNT_ID?.trim() ??
    "";

  const accessToken = webhookAccessToken || envAccessToken;
  let businessAccountId = webhookBusinessAccountId || envBusinessAccountId;

  if (!accessToken) {
    return null;
  }

  if (!businessAccountId) {
    const profileCredentials = resolveMetaProfileCredentials(webhook);
    const phoneNumberId = profileCredentials?.phoneNumberId;

    if (phoneNumberId) {
      const resolved = await fetchBusinessAccountId(accessToken, phoneNumberId);
      if (resolved) {
        businessAccountId = resolved;
      }
    }
  }

  if (!businessAccountId) {
    return null;
  }

  if (!webhookAccessToken || !webhookBusinessAccountId) {
    console.warn(
      "[Meta Templates] Credenciais faltando no webhook administrativo. Utilizando variáveis de ambiente ou consulta automática como fallback.",
    );
  }

  return { accessToken, businessAccountId };
};

const fetchMetaTemplatesPage = async (
  url: URL,
  credentials: MetaTemplateCredentials,
  context: string,
): Promise<{ data: MetaTemplateApiPayload[]; next: string | null }> => {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
    },
  });

  const { body } = await readMetaResponse(response, context);

  const payload = (body ?? {}) as {
    data?: MetaTemplateApiPayload[];
    paging?: { next?: string };
  };

  const data = Array.isArray(payload.data) ? payload.data : [];
  const next = payload.paging?.next ? String(payload.paging.next) : null;

  return { data, next };
};

export const fetchMetaTemplatesFromMeta = async (
  credentials: MetaTemplateCredentials,
  options: { status?: string } = {},
): Promise<MetaTemplateApiPayload[]> => {
  const version = getMetaApiVersion();
  const baseUrl = new URL(
    `https://graph.facebook.com/${version}/${credentials.businessAccountId}/message_templates`,
  );
  baseUrl.searchParams.set("fields", META_TEMPLATE_FIELDS.join(","));
  baseUrl.searchParams.set("limit", "100");

  if (options.status) {
    baseUrl.searchParams.set("status", options.status);
  }

  const templates: MetaTemplateApiPayload[] = [];

  let pageUrl: URL | null = baseUrl;
  let safetyCounter = 0;

  while (pageUrl && safetyCounter < 100) {
    safetyCounter += 1;
    const { data, next } = await fetchMetaTemplatesPage(
      pageUrl,
      credentials,
      "[Meta Templates] Falha ao carregar modelos",
    );
    templates.push(...data);
    pageUrl = next ? new URL(next) : null;
  }

  return templates;
};

export const fetchMetaTemplateById = async (
  templateId: string,
  credentials: MetaTemplateCredentials,
): Promise<MetaTemplateApiPayload | null> => {
  const version = getMetaApiVersion();
  const url = new URL(`https://graph.facebook.com/${version}/${templateId}`);
  url.searchParams.set("fields", META_TEMPLATE_FIELDS.join(","));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
    },
  });

  const { body } = await readMetaResponse(
    response,
    `[Meta Templates] Falha ao carregar o modelo ${templateId}`,
  );

  if (!body || typeof body !== "object") {
    return null;
  }

  const template = body as MetaTemplateApiPayload;

  if (!template.id) {
    return null;
  }

  return template;
};

export const getAdminMetaTemplates = async (): Promise<AdminMetaTemplate[]> => {
  await ensureAdminMetaTemplatesTable();
  const db = getDb();

  const [rows] = await db.query<(AdminMetaTemplateRow & RowDataPacket)[]>(
    `SELECT * FROM admin_meta_templates ORDER BY name ASC`,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows.map((row) => mapRowToTemplate(row));
};

export const getAdminMetaTemplateByTemplateId = async (
  templateId: string,
): Promise<AdminMetaTemplate | null> => {
  await ensureAdminMetaTemplatesTable();
  const db = getDb();

  const [rows] = await db.query<(AdminMetaTemplateRow & RowDataPacket)[]>(
    `SELECT * FROM admin_meta_templates WHERE template_id = ? LIMIT 1`,
    [templateId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapRowToTemplate(rows[0]);
};

export const syncAdminMetaTemplates = async (
  webhook: AdminWebhookRow | null,
  options: { status?: string } = {},
  credentialsOverride?: MetaTemplateCredentials,
): Promise<AdminMetaTemplate[]> => {
  const credentials =
    credentialsOverride ?? (await resolveMetaTemplateCredentials(webhook));

  if (!credentials) {
    throw new AdminMetaTemplateError(
      "Configure o webhook administrativo com o access token e Business Account ID da Meta para importar os modelos aprovados.",
    );
  }

  const templates = await fetchMetaTemplatesFromMeta(credentials, options);
  const now = new Date();

  await ensureAdminMetaTemplatesTable();
  const db = getDb();

  await db.query(
    `
      DELETE FROM admin_meta_templates
      WHERE business_account_id IS NULL OR business_account_id != ?
    `,
    [credentials.businessAccountId],
  );

  if (templates.length === 0) {
    await db.query(
      `DELETE FROM admin_meta_templates WHERE business_account_id = ?`,
      [credentials.businessAccountId],
    );
    return getAdminMetaTemplates();
  }

  for (const template of templates) {
    await saveMetaTemplate(template, {
      markSyncedAt: now,
      businessAccountId: credentials.businessAccountId,
    });
  }

  const templateIds = templates.map((template) => template.id);

  await db.query(
    `
      DELETE FROM admin_meta_templates
      WHERE business_account_id = ? AND template_id NOT IN (?)
    `,
    [credentials.businessAccountId, templateIds],
  );

  return getAdminMetaTemplates();
};

const extractTemplateIdFromResponse = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if ("id" in payload && typeof (payload as { id: unknown }).id === "string") {
    return (payload as { id: string }).id;
  }

  if (
    "message_template_id" in payload &&
    typeof (payload as { message_template_id: unknown }).message_template_id === "string"
  ) {
    return (payload as { message_template_id: string }).message_template_id;
  }

  return null;
};

export const createAdminMetaTemplate = async (
  webhook: AdminWebhookRow | null,
  payload: AdminMetaTemplateCreatePayload,
  credentialsOverride?: MetaTemplateCredentials,
): Promise<AdminMetaTemplate> => {
  const credentials =
    credentialsOverride ?? (await resolveMetaTemplateCredentials(webhook));

  if (!credentials) {
    throw new AdminMetaTemplateError(
      "Configure o webhook administrativo com o access token e Business Account ID da Meta para criar novos modelos.",
    );
  }

  const sanitized = sanitizeEditorPayload(payload, { requireName: true });
  const components = buildComponentsFromPayload(sanitized);

  const version = getMetaApiVersion();
  const url = `https://graph.facebook.com/${version}/${credentials.businessAccountId}/message_templates`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: sanitized.name,
      language: sanitized.language,
      category: sanitized.category,
      components,
    }),
  });

  const { body } = await readMetaResponse(
    response,
    "[Meta Templates] Falha ao criar o modelo",
  );

  const templateId = extractTemplateIdFromResponse(body);

  if (!templateId) {
    throw new AdminMetaTemplateError(
      "Modelo criado, mas não foi possível identificar o ID retornado pela Meta.",
      502,
    );
  }

  const template = await fetchMetaTemplateById(templateId, credentials);

  if (!template) {
    throw new AdminMetaTemplateError(
      "Modelo criado com sucesso, mas não foi possível carregar os detalhes retornados pela Meta.",
      502,
    );
  }

  await saveMetaTemplate(template, {
    markSyncedAt: undefined,
    businessAccountId: credentials.businessAccountId,
  });

  const stored = await getAdminMetaTemplateByTemplateId(templateId);

  if (!stored) {
    throw new AdminMetaTemplateError(
      "Não foi possível carregar o modelo recém-criado no painel.",
      500,
    );
  }

  return stored;
};

export const updateAdminMetaTemplate = async (
  webhook: AdminWebhookRow | null,
  templateId: string,
  payload: AdminMetaTemplateUpdatePayload,
  credentialsOverride?: MetaTemplateCredentials,
): Promise<AdminMetaTemplate> => {
  const credentials =
    credentialsOverride ?? (await resolveMetaTemplateCredentials(webhook));

  if (!credentials) {
    throw new AdminMetaTemplateError(
      "Configure o webhook administrativo com o access token e Business Account ID da Meta para editar os modelos.",
    );
  }

  const sanitized = sanitizeEditorPayload(payload, { requireName: false });
  const existingTemplate = await fetchMetaTemplateById(templateId, credentials);

  if (!existingTemplate) {
    throw new AdminMetaTemplateError(
      "Modelo não encontrado na Meta. Sincronize novamente antes de editar.",
      404,
    );
  }

  const editState = resolveTemplateEditState(existingTemplate.status);
  if (!editState.editable) {
    throw new AdminMetaTemplateError(
      editState.reason ??
        "Este modelo não pode ser editado no momento devido ao status atual definido pela Meta.",
      400,
    );
  }

  const existingComponents = Array.isArray(existingTemplate.components)
    ? existingTemplate.components
    : [];

  const components = buildUpdatedComponents(existingComponents, sanitized);

  const version = getMetaApiVersion();
  const url = `https://graph.facebook.com/${version}/${templateId}`;

  const requestPayload: Record<string, unknown> = {
    language: sanitized.language,
    category: sanitized.category,
    components,
  };

  if (sanitized.name) {
    requestPayload.name = sanitized.name;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  });

  await readMetaResponse(
    response,
    `[Meta Templates] Falha ao atualizar o modelo ${templateId}`,
  );

  const template = await fetchMetaTemplateById(templateId, credentials);

  if (!template) {
    throw new AdminMetaTemplateError(
      "Modelo atualizado, mas não foi possível carregar os dados retornados pela Meta.",
      502,
    );
  }

  await saveMetaTemplate(template, {
    markSyncedAt: undefined,
    businessAccountId: credentials.businessAccountId,
  });

  const stored = await getAdminMetaTemplateByTemplateId(templateId);

  if (!stored) {
    throw new AdminMetaTemplateError(
      "Não foi possível carregar o modelo atualizado no painel.",
      500,
    );
  }

  return stored;
};
