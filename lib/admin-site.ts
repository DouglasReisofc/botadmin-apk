import { RowDataPacket } from "mysql2";
import path from "path";
import { promises as fs } from "fs";

import type {
  AdminHomepageFeature,
  AdminOfficialGroupCandidate,
  AdminOfficialGroupLink,
  AdminSiteSettings,
  AdminSiteSettingsPayload,
} from "types/admin-site";

import {
  AdminSiteSettingsRow,
  ensureAdminSiteSettingsTable,
  ensureBotGroupTable,
  getDb,
} from "./db";
import { getInstanceById } from "./bot-instances";
import {
  deleteUploadedFile,
  deleteUploadedFolder,
  resolveUploadedFileUrl,
  saveUploadedFile,
  UPLOADS_STORAGE_ROOT,
} from "./uploads";
import { getAppBaseUrl } from "lib/meta";
import { getGroupInviteLink } from "lib/wuzapi";

export class AdminSiteSettingsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminSiteSettingsError";
    this.status = status;
  }
}

const DEFAULT_HERO_BADGE = "Bot admin para grupos";
const DEFAULT_HERO_TITLE = "Administre grupos do WhatsApp no piloto automático";
const DEFAULT_HERO_SUBTITLE =
  "Modere conversas, dê boas‑vindas, aplique regras e acione comandos de forma automática com o Bot Admin oficial conectado à API da Meta.";
const DEFAULT_HERO_BUTTON_LABEL = "Criar conta";
const DEFAULT_HERO_BUTTON_URL = "/sign-up";
const DEFAULT_HERO_SECONDARY_BUTTON_LABEL = "Já sou cliente";
const DEFAULT_HERO_SECONDARY_BUTTON_URL = "/sign-in";

const DEFAULT_FEATURES_TITLE = "Tudo que você precisa para moderar grupos";
const DEFAULT_FEATURES_SUBTITLE =
  "Defina regras e comandos; o bot monitora mensagens e toma as ações configuradas em tempo real.";

const DEFAULT_FEATURES: AdminHomepageFeature[] = [
  {
    title: "Moderação automática",
    description:
      "Boas‑vindas, remoção de spam, palavras proibidas, avisos e banimento automático conforme as regras do grupo.",
  },
  {
    title: "Regras e comandos",
    description:
      "Crie comandos como /regras, /menu e /ajuda; ative modo silêncio, somente admin e mensagens programadas.",
  },
  {
    title: "Relatórios e integrações",
    description:
      "Receba alertas no painel, conecte webhooks e registre ações para auditoria das suas comunidades.",
  },
];

const DEFAULT_WORKFLOW_TITLE = "Como o Bot Admin cuida do seu grupo";
const DEFAULT_WORKFLOW_DESCRIPTION =
  "Você define as regras e comandos. O bot monitora mensagens e aplica as políticas automaticamente, 24/7.";
const DEFAULT_WORKFLOW_BULLETS = [
  "Boas‑vindas automáticas com links e regras",
  "Bloqueio de spam e palavras proibidas",
  "Comandos rápidos: /regras, /menu, /silêncio",
];

const DEFAULT_CTA_TITLE = "Pronto para organizar seus grupos?";
const DEFAULT_CTA_DESCRIPTION =
  "Ative o Bot Admin e mantenha suas comunidades seguras, organizadas e produtivas.";
const DEFAULT_CTA_BUTTON_LABEL = "Começar agora";
const DEFAULT_CTA_BUTTON_URL = "/sign-up";
const DEFAULT_TERMS_CONTENT = [
  "# Termos de Uso do Bot Admin",
  "",
  "## 1. Visão geral do serviço",
  "O Bot Admin é uma solução de automação para grupos de WhatsApp voltada à moderação, envio de mensagens e integração com recursos avançados. O acesso é concedido aos usuários que aceitam estes termos e mantêm um plano ativo na plataforma.",
  "",
  "## 2. Compras, planos e política de reembolso",
  "- Todas as contratações são disponibilizadas imediatamente após a confirmação do pagamento e, por isso, **não realizamos reembolsos após a compra**.",
  "- Ajustes ou migrações de plano podem ser solicitados diretamente na área de planos do painel do usuário.",
  "- Antes de contratar, avalie os recursos oferecidos e, se necessário, utilize as opções de plano de menor valor para validar o serviço.",
  "",
  "## 3. Uso responsável e riscos",
  "- O Bot Admin **não é uma ferramenta oficial da Meta**. Utilizamos integrações com a API oficial e com provedores parceiros para entregar as automações.",
  "- O número conectado ao Bot Admin é de responsabilidade do usuário. **Abusos**, como disparos em massa, spam ou violação das políticas do WhatsApp, podem gerar **banimento definitivo do número** pela Meta. Essas ocorrências não são cobertas pela nossa equipe de suporte.",
  "- Siga sempre as diretrizes do WhatsApp e utilize o bot somente para comunicações autorizadas pelos participantes dos seus grupos.",
  "",
  "## 4. Suporte e contato",
  "Oferecemos suporte através dos canais oficiais informados no painel. Problemas decorrentes de uso indevido ou violação das políticas do WhatsApp não são elegíveis para ressarcimento ou restauração do número banido.",
  "",
"Ao continuar utilizando o Bot Admin, você confirma que leu, entendeu e concorda com estes termos.",
].join("\n");
const MAX_SEO_KEYWORDS = 20;
const MAX_SEO_HIGHLIGHT_KEYWORDS = 12;
const MAX_KEYWORD_LENGTH = 60;
const DEFAULT_SUPPORT_URL = (() => {
  try {
    return getAppBaseUrl();
  } catch {
    return "https://storebot.app";
  }
})();

const DEFAULT_SETTINGS: AdminSiteSettings = {
  siteName: "StoreBot",
  tagline: null,
  logoUrl: null,
  faviconUrl: null,
  faviconAssets: null,
  mobileAppIconUrl: null,
  supportEmail: null,
  supportPhone: null,
  supportUrl: DEFAULT_SUPPORT_URL,
  supportChannel: "chat",
  supportWhatsappNumber: null,
  userPanelBanners: [],
  testGroups: [],
  officialGroups: [],
  officialGroupInstanceId: null,
  officialGroupJid: null,
  officialGroupInviteLink: null,
  officialGroupInviteUpdatedAt: null,
  emailVerificationEnabled: false,
  emailVerificationApiKeys: [],
  heroBadge: DEFAULT_HERO_BADGE,
  heroTitle: DEFAULT_HERO_TITLE,
  heroSubtitle: DEFAULT_HERO_SUBTITLE,
  heroButtonLabel: DEFAULT_HERO_BUTTON_LABEL,
  heroButtonUrl: DEFAULT_HERO_BUTTON_URL,
  heroSecondaryButtonLabel: DEFAULT_HERO_SECONDARY_BUTTON_LABEL,
  heroSecondaryButtonUrl: DEFAULT_HERO_SECONDARY_BUTTON_URL,
  heroImageUrl: null,
  featuresTitle: DEFAULT_FEATURES_TITLE,
  featuresSubtitle: DEFAULT_FEATURES_SUBTITLE,
  features: DEFAULT_FEATURES.map((feature) => ({ ...feature })),
  workflowTitle: DEFAULT_WORKFLOW_TITLE,
  workflowDescription: DEFAULT_WORKFLOW_DESCRIPTION,
  workflowBullets: [...DEFAULT_WORKFLOW_BULLETS],
  workflowImageUrl: null,
  ctaTitle: DEFAULT_CTA_TITLE,
  ctaDescription: DEFAULT_CTA_DESCRIPTION,
  ctaButtonLabel: DEFAULT_CTA_BUTTON_LABEL,
  ctaButtonUrl: DEFAULT_CTA_BUTTON_URL,
  seoTitle: null,
  seoDescription: null,
  seoImageUrl: null,
  footerText: null,
  seoKeywords: [],
  seoHighlightKeywords: [],
  termsContent: DEFAULT_TERMS_CONTENT,
  updatedAt: null,
};

const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const MAX_SEO_IMAGE_SIZE = 3 * 1024 * 1024;
const LOGO_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const FAVICON_ALLOWED_MIME = new Set([
  "image/png",
  "image/svg+xml",
  "image/x-icon",
  "image/webp",
]);
const SEO_IMAGE_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const HOMEPAGE_IMAGE_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_HOMEPAGE_IMAGE_SIZE = 5 * 1024 * 1024;
const SITE_LOGO_IMAGE_OPTIONS = {
  image: { maxWidth: 96, maxHeight: 96, fit: "inside" as const, format: "webp" as const, quality: 82 },
};
const SITE_HOMEPAGE_IMAGE_OPTIONS = {
  image: { maxWidth: 720, maxHeight: 405, fit: "inside" as const, format: "webp" as const, quality: 72 },
};
const SITE_SEO_IMAGE_OPTIONS = {
  image: { maxWidth: 1200, maxHeight: 630, fit: "inside" as const, format: "webp" as const, quality: 82 },
};

type StoredFaviconAssets = {
  rootPath: string | null;
  svg?: string | null;
  ico?: string | null;
  png16?: string | null;
  png32?: string | null;
  png48?: string | null;
  png96?: string | null;
  appleTouchIcon?: string | null;
  androidChrome192?: string | null;
  androidChrome512?: string | null;
  manifest?: string | null;
};

const parseFaviconAssets = (raw: string | null): AdminSiteSettings["faviconAssets"] => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredFaviconAssets;
    const toUrl = (value: string | null | undefined) =>
      value ? resolveUploadedFileUrl(value) : null;

    return {
      rootPath: parsed.rootPath ?? null,
      svgUrl: toUrl(parsed.svg),
      icoUrl: toUrl(parsed.ico),
      png16Url: toUrl(parsed.png16),
      png32Url: toUrl(parsed.png32),
      png48Url: toUrl(parsed.png48),
      png96Url: toUrl(parsed.png96),
      appleTouchIconUrl: toUrl(parsed.appleTouchIcon),
      androidChrome192Url: toUrl(parsed.androidChrome192),
      androidChrome512Url: toUrl(parsed.androidChrome512),
      manifestUrl: toUrl(parsed.manifest),
    };
  } catch (error) {
    console.error("Failed to parse favicon assets metadata", error);
    return null;
  }
};

const normalizeUploadsRelativePath = (relativePath: string): string => {
  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized.startsWith("uploads/")) {
    throw new AdminSiteSettingsError("Caminho de favicon inválido.");
  }
  return normalized;
};

const toUploadsAbsolutePath = (relativePath: string): string => {
  const normalized = normalizeUploadsRelativePath(relativePath);
  const withoutPrefix = normalized.slice("uploads/".length);
  const absolute = path.resolve(UPLOADS_STORAGE_ROOT, withoutPrefix);
  if (!absolute.startsWith(UPLOADS_STORAGE_ROOT)) {
    throw new AdminSiteSettingsError("Destino de upload inválido.");
  }
  return absolute;
};

const parseEmailVerificationKeys = (raw: string | null): string[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((key) => key.length > 0);
    }

    if (typeof parsed === "string") {
      return parsed
        .split(/\r?\n/)
        .map((key) => key.trim())
        .filter((key) => key.length > 0);
    }
  } catch (error) {
    console.error("Failed to parse email verification API keys", error);
  }

  return raw
    .split(/\r?\n/)
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
};

const generateFaviconAssetsFromSource = async (
  relativeSourcePath: string,
): Promise<{ assetsPath: string; assetsJson: string }> => {
  try {
    const normalizedSource = normalizeUploadsRelativePath(relativeSourcePath);
    const absoluteSource = toUploadsAbsolutePath(relativeSourcePath);

    const baseDir = path.posix.dirname(normalizedSource);
    const uniqueId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const assetsRelativeRoot = path.posix.join(baseDir, `favicons-${uniqueId}`);
    const assetsAbsoluteRoot = toUploadsAbsolutePath(assetsRelativeRoot);

    await fs.rm(assetsAbsoluteRoot, { recursive: true, force: true });
    await fs.mkdir(assetsAbsoluteRoot, { recursive: true });

    const { favicons: runFavicons } = await import("favicons");
    const response = await runFavicons(absoluteSource, {
      path: "/",
      appName: "StoreBot",
      appShortName: "StoreBot",
      appDescription:
        "Projeto completo com landing page, autenticação e dashboards para administradores e usuários.",
      background: "#ffffff",
      theme_color: "#10664f",
      icons: {
        android: true,
        appleIcon: true,
        appleStartup: false,
        favicons: true,
        windows: false,
        yandex: false,
        firefox: false,
        coast: false,
      },
    });

    const descriptor: StoredFaviconAssets = {
      rootPath: assetsRelativeRoot,
    };

    for (const image of response.images) {
      const destination = path.join(assetsAbsoluteRoot, image.name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, image.contents);

      const relativeAsset = path.posix.join(assetsRelativeRoot, image.name);
      switch (image.name) {
        case "favicon.ico":
          descriptor.ico = relativeAsset;
          break;
        case "favicon-16x16.png":
          descriptor.png16 = relativeAsset;
          break;
        case "favicon-32x32.png":
          descriptor.png32 = relativeAsset;
          break;
        case "favicon-48x48.png":
          descriptor.png48 = relativeAsset;
          break;
        case "android-chrome-96x96.png":
          descriptor.png96 = relativeAsset;
          break;
        case "apple-touch-icon.png":
          descriptor.appleTouchIcon = relativeAsset;
          break;
        case "android-chrome-192x192.png":
          descriptor.androidChrome192 = relativeAsset;
          break;
        case "android-chrome-512x512.png":
          descriptor.androidChrome512 = relativeAsset;
          break;
        default:
          break;
      }
    }

    for (const file of response.files) {
      if (file.name.endsWith(".webmanifest")) {
        const manifestName = "site.webmanifest";
        const destination = path.join(assetsAbsoluteRoot, manifestName);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        descriptor.manifest = path.posix.join(assetsRelativeRoot, manifestName);

        try {
          const manifest = JSON.parse(file.contents.toString("utf-8"));
          manifest.start_url = "/";
          manifest.scope = "/";
          manifest.theme_color = manifest.theme_color || "#10664f";
          manifest.background_color = manifest.background_color || "#ffffff";
          manifest.name = manifest.name || "StoreBot";
          manifest.short_name = manifest.short_name || "StoreBot";
          if (Array.isArray(manifest.icons)) {
            manifest.icons = manifest.icons.map((icon: Record<string, unknown>) => {
              const src =
                typeof icon?.src === "string"
                  ? icon.src
                  : "";
              const iconName = path.posix.basename(src);
              const relativeIcon = path.posix.join(assetsRelativeRoot, iconName);
              return {
                ...icon,
                src: resolveUploadedFileUrl(relativeIcon),
              };
            });
          }
          await fs.writeFile(destination, JSON.stringify(manifest, null, 2), "utf-8");
        } catch (error) {
          console.error("Failed to build manifest from favicon upload", error);
          await fs.writeFile(destination, file.contents);
        }
      } else {
        const destination = path.join(assetsAbsoluteRoot, file.name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, file.contents);
      }
    }

    // Recria o favicon.ico somente com 16/32/48 px para evitar avisos de tamanhos extras
    try {
      const png16 = path.join(assetsAbsoluteRoot, "favicon-16x16.png");
      const png32 = path.join(assetsAbsoluteRoot, "favicon-32x32.png");
      const png48 = path.join(assetsAbsoluteRoot, "favicon-48x48.png");
      const exist16 = await fs
        .stat(png16)
        .then(() => true)
        .catch(() => false);
      const exist32 = await fs
        .stat(png32)
        .then(() => true)
        .catch(() => false);
      const exist48 = await fs
        .stat(png48)
        .then(() => true)
        .catch(() => false);

      if (exist16 && exist32 && exist48) {
        const pngToIco = (await import("png-to-ico")).default as (
          inputs: Array<Buffer | string>,
        ) => Promise<Buffer>;
        const icoBuffer = await pngToIco([
          await fs.readFile(png16),
          await fs.readFile(png32),
          await fs.readFile(png48),
        ]);
        const icoDest = path.join(assetsAbsoluteRoot, "favicon.ico");
        await fs.writeFile(icoDest, icoBuffer);
        descriptor.ico = path.posix.join(assetsRelativeRoot, "favicon.ico");
      }
    } catch (error) {
      console.warn("[favicon] Falhou ao recriar ICO 16/32/48", error);
    }

    if (path.extname(normalizedSource).toLowerCase() === ".svg") {
      const svgDestination = path.join(assetsAbsoluteRoot, "favicon.svg");
      await fs.copyFile(absoluteSource, svgDestination);
      descriptor.svg = path.posix.join(assetsRelativeRoot, "favicon.svg");
    }

    return {
      assetsPath: assetsRelativeRoot,
      assetsJson: JSON.stringify(descriptor),
    };
  } catch (error) {
    console.error("Failed to generate favicon assets", error);
    throw new AdminSiteSettingsError(
      "Não foi possível processar o favicon enviado. Tente enviar uma imagem PNG, ICO ou SVG válido.",
    );
  }
};

const sanitizeText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.slice(0, maxLength);
};

const sanitizeOptionalText = (value: unknown, maxLength: number): string | null => {
  const sanitized = sanitizeText(value, maxLength);
  return sanitized ? sanitized : null;
};

const sanitizeRequiredText = (
  value: unknown,
  maxLength: number,
  label: string,
): string => {
  const sanitized = sanitizeText(value, maxLength);
  if (!sanitized) {
    throw new AdminSiteSettingsError(`Informe ${label}.`);
  }

  return sanitized;
};

const sanitizeEmail = (value: unknown): string | null => {
  const sanitized = sanitizeOptionalText(value, 160);
  if (!sanitized) {
    return null;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(sanitized)) {
    throw new AdminSiteSettingsError("Informe um e-mail válido.");
  }

  return sanitized;
};

const sanitizePhone = (value: unknown): string | null => {
  const sanitized = sanitizeOptionalText(value, 40);
  if (!sanitized) {
    return null;
  }

  const digits = sanitized.replace(/\D/g, "");
  if (digits.length < 8) {
    throw new AdminSiteSettingsError("Informe um telefone válido com DDD.");
  }

  return sanitized;
};

const sanitizeUrl = (value: unknown): string | null => {
  const sanitized = sanitizeOptionalText(value, 300);
  if (!sanitized) {
    return null;
  }

  try {
    const url = sanitized.startsWith("/") ? new URL(`https://local${sanitized}`) : new URL(sanitized);
    if (!/^https?:$/i.test(url.protocol)) {
      throw new Error("Invalid protocol");
    }
  } catch {
    throw new AdminSiteSettingsError("Informe uma URL válida iniciando com http ou https.");
  }

  return sanitized;
};

const sanitizeSupportChannel = (value: unknown): "chat" | "whatsapp" => {
  if (typeof value === "string" && value.trim().toLowerCase() === "whatsapp") {
    return "whatsapp";
  }
  return "chat";
};

const sanitizeWhatsappNumber = (value: unknown): string | null => {
  const sanitized = sanitizeOptionalText(value, 40);
  if (!sanitized) {
    return null;
  }
  const digits = sanitized.replace(/\D/g, "");
  if (digits.length < 8) {
    throw new AdminSiteSettingsError("Informe o número do WhatsApp com DDI.");
  }
  return digits;
};

const sanitizeApiKeyList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const keys = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((key) => key.length > 0)
    .map((key) => key.slice(0, 160));

  return Array.from(new Set(keys));
};

const validateImageFile = (
  file: File,
  maxSize: number,
  allowedMime: Set<string>,
  maxLabel: string,
  formatsHint: string,
) => {
  if (!(file instanceof File)) {
    throw new AdminSiteSettingsError("Arquivo de imagem inválido.");
  }

  if (file.size > maxSize) {
    throw new AdminSiteSettingsError(`Envie imagens de até ${maxLabel}.`);
  }

  if (!allowedMime.has(file.type)) {
    throw new AdminSiteSettingsError(`Envie imagens nos formatos ${formatsHint}.`);
  }
};

const cloneDefaultFeatures = (): AdminHomepageFeature[] =>
  DEFAULT_FEATURES.map((feature) => ({ ...feature }));

const parseFeaturesJson = (raw: string | null): AdminHomepageFeature[] => {
  if (!raw) {
    return cloneDefaultFeatures();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return cloneDefaultFeatures();
    }

    const sanitized = parsed
      .slice(0, 6)
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const record = item as Record<string, unknown>;
        const title = sanitizeText(record.title, 120);
        const description = sanitizeText(record.description, 320);

        if (!title) {
          return null;
        }

        return {
          title,
          description,
        } satisfies AdminHomepageFeature;
      })
      .filter((feature): feature is AdminHomepageFeature => Boolean(feature));

    return sanitized;
  } catch {
    return cloneDefaultFeatures();
  }
};

const parseWorkflowBulletsJson = (raw: string | null): string[] => {
  if (!raw) {
    return [...DEFAULT_WORKFLOW_BULLETS];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_WORKFLOW_BULLETS];
    }

    return parsed
      .slice(0, 6)
      .map((item) => sanitizeText(item, 160))
      .filter((bullet): bullet is string => Boolean(bullet));
  } catch {
    return [...DEFAULT_WORKFLOW_BULLETS];
  }
};

const sanitizeFeaturesPayload = (value: unknown): AdminHomepageFeature[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 6)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const title = sanitizeText(record.title, 120);
      const description = sanitizeText(record.description, 320);

      if (!title) {
        return null;
      }

      return { title, description } satisfies AdminHomepageFeature;
    })
    .filter((feature): feature is AdminHomepageFeature => Boolean(feature));
};

const sanitizeWorkflowBulletsPayload = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 6)
    .map((item) => sanitizeText(item, 160))
    .filter((bullet): bullet is string => Boolean(bullet));
};

const MAX_TERMS_CONTENT_LENGTH = 12000;

const normalizeMultilineText = (value: string) =>
  value.replace(/\r\n/g, "\n").replace(/\u00A0/g, " ").replace(/\t/g, "  ");

const sanitizeTermsContent = (value: unknown): string => {
  if (typeof value !== "string") {
    return DEFAULT_TERMS_CONTENT;
  }

  const normalized = normalizeMultilineText(value).trim();
  if (!normalized) {
    return DEFAULT_TERMS_CONTENT;
  }

  return normalized.length > MAX_TERMS_CONTENT_LENGTH
    ? normalized.slice(0, MAX_TERMS_CONTENT_LENGTH)
    : normalized;
};

const resolveTermsContent = (value: string | null | undefined) =>
  sanitizeTermsContent(typeof value === "string" ? value : DEFAULT_TERMS_CONTENT);

const sanitizeKeywordList = (
  value: unknown,
  { maxItems, maxLength }: { maxItems: number; maxLength: number },
): string[] => {
  const entries: string[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        entries.push(item);
      }
    }
  } else if (typeof value === "string") {
    entries.push(...value.split(/[\n,]/));
  }

  const seen = new Set<string>();
  const output: string[] = [];

  for (const entry of entries) {
    const normalized = normalizeMultilineText(entry)
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      continue;
    }

    const signature = normalized.toLowerCase();
    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    output.push(normalized.slice(0, maxLength));

    if (output.length >= maxItems) {
      break;
    }
  }

  return output;
};

const parseKeywordsJson = (raw: string | null, fallback: string[] = []): string[] => {
  if (!raw) {
    return [...fallback];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...fallback];
    }

    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => Boolean(entry))
      .map((entry) => entry.slice(0, MAX_KEYWORD_LENGTH))
      .slice(0, MAX_SEO_KEYWORDS);
  } catch {
    return [...fallback];
  }
};

const resolveStoredUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("uploads/") ? resolveUploadedFileUrl(trimmed) : trimmed;
};

const parsePanelBannersJson = (raw: string | null): AdminSiteSettings["userPanelBanners"] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item, index) => {
        const title = typeof item?.title === "string" ? item.title.trim() : "";
        const subtitle =
          typeof item?.subtitle === "string" && item.subtitle.trim()
            ? item.subtitle.trim()
            : null;
        const linkUrl =
          typeof item?.linkUrl === "string" && item.linkUrl.trim()
            ? item.linkUrl.trim()
            : null;
        const mediaUrl =
          typeof item?.mediaUrl === "string" && item.mediaUrl.trim()
            ? resolveStoredUrl(item.mediaUrl.trim()) ?? ""
            : "";
        const mediaPath =
          typeof item?.mediaUrl === "string" && item.mediaUrl.trim() ? item.mediaUrl.trim() : null;
        const order = Number.isFinite(item?.order) ? Number(item.order) : index;
        const isActive = item?.isActive !== false;
        const id =
          typeof item?.id === "number" && Number.isFinite(item.id)
            ? Number(item.id)
            : Number(`${Date.now()}${index}`.slice(-6));
        if (!mediaUrl && !title) {
          return null;
        }
        return { id, title, subtitle, linkUrl, mediaUrl, mediaPath, order, isActive };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  } catch {
    return [];
  }
};

const parseTestGroupsJson = (raw: string | null): AdminSiteSettings["testGroups"] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        const title = typeof item?.title === "string" ? item.title.trim() : "";
        const url = typeof item?.url === "string" ? item.url.trim() : "";
        if (!title || !url) {
          return null;
        }
        return { title, url };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  } catch {
    return [];
  }
};

const parseOfficialGroupsJson = (
  raw: string | null,
  fallback?: {
    instanceId: number | null;
    remoteId: string | null;
    inviteLink: string | null;
    inviteUpdatedAt: Date | null;
  },
): AdminOfficialGroupLink[] => {
  const normalizeItems = (value: unknown): AdminOfficialGroupLink[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .slice(0, 20)
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const instanceId = normalizeOfficialGroupInstanceId(record.instanceId);
        const remoteId = normalizeOfficialGroupJid(
          typeof record.remoteId === "string" ? record.remoteId : "",
        );
        const title = sanitizeText(record.title, 160);
        const inviteLink =
          typeof record.inviteLink === "string" && record.inviteLink.trim().includes("chat.whatsapp.com/")
            ? record.inviteLink.trim()
            : null;
        if (!instanceId || !remoteId || !title) {
          return null;
        }
        const groupId = Number(record.groupId);
        const order = Number(record.order);
        return {
          id:
            typeof record.id === "string" && record.id.trim()
              ? record.id.trim().slice(0, 80)
              : `${instanceId}:${remoteId}`,
          groupId: Number.isFinite(groupId) && groupId > 0 ? Math.floor(groupId) : null,
          instanceId,
          remoteId,
          title,
          description: sanitizeOptionalText(record.description, 320),
          imageUrl: sanitizeUrl(record.imageUrl),
          inviteLink,
          inviteUpdatedAt:
            typeof record.inviteUpdatedAt === "string" && record.inviteUpdatedAt.trim()
              ? record.inviteUpdatedAt.trim()
              : null,
          isActive: record.isActive !== false,
          order: Number.isFinite(order) ? Math.floor(order) : index,
        } satisfies AdminOfficialGroupLink;
      })
      .filter((item): item is AdminOfficialGroupLink => Boolean(item))
      .sort((a, b) => a.order - b.order);
  };

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const groups = normalizeItems(parsed);
      if (groups.length > 0) {
        return groups;
      }
    } catch {
      /* fallback below */
    }
  }

  if (fallback?.instanceId && fallback.remoteId && fallback.inviteLink) {
    return [
      {
        id: `${fallback.instanceId}:${fallback.remoteId}`,
        groupId: null,
        instanceId: fallback.instanceId,
        remoteId: fallback.remoteId,
        title: "Grupo oficial do BotAdmin",
        description: "Grupo oficial para testar comandos, acompanhar novidades e falar com a comunidade BotAdmin.",
        imageUrl: null,
        inviteLink: fallback.inviteLink,
        inviteUpdatedAt: fallback.inviteUpdatedAt ? fallback.inviteUpdatedAt.toISOString() : null,
        isActive: true,
        order: 0,
      },
    ];
  }

  return [];
};

const looksMojibake = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.includes("�")) {
    return true;
  }

  if (trimmed.includes("Ã") || trimmed.includes("Â")) {
    return true;
  }

  if (/[A-Za-zÀ-ÿ][?][A-Za-zÀ-ÿ]/u.test(trimmed)) {
    return true;
  }

  const questionMatches = trimmed.match(/\?/g);
  const questionCount = questionMatches ? questionMatches.length : 0;
  if (questionCount >= 3 && questionCount / Math.max(trimmed.length, 1) > 0.05) {
    return true;
  }

  return false;
};

const nonEmpty = (value: string | null | undefined, fallback: string): string => {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || looksMojibake(candidate)) {
    return fallback;
  }
  return candidate;
};

const nonEmptyOrNull = (
  value: string | null | undefined,
  fallback: string | null,
): string | null => {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || looksMojibake(candidate)) {
    return fallback;
  }
  return candidate;
};

const normalizeOfficialGroupInstanceId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
};

const normalizeOfficialGroupJid = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^[0-9A-Za-z-]{6,}@g\.us$/i.test(trimmed)) {
    throw new AdminSiteSettingsError("Informe um ID de grupo válido, por exemplo 120363000000000000@g.us.");
  }
  return trimmed;
};

const normalizeOfficialGroupsPayload = (value: unknown): AdminOfficialGroupLink[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const groups: AdminOfficialGroupLink[] = [];

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const instanceId = normalizeOfficialGroupInstanceId(record.instanceId);
    const remoteId = normalizeOfficialGroupJid(record.remoteId);
    const title = sanitizeText(record.title, 160);
    if (!instanceId || !remoteId || !title) {
      continue;
    }
    const key = `${instanceId}:${remoteId.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const groupId = Number(record.groupId);
    const order = Number(record.order);
    const inviteLink =
      typeof record.inviteLink === "string" && record.inviteLink.trim().includes("chat.whatsapp.com/")
        ? record.inviteLink.trim()
        : null;

    groups.push({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim().slice(0, 80)
          : key,
      groupId: Number.isFinite(groupId) && groupId > 0 ? Math.floor(groupId) : null,
      instanceId,
      remoteId,
      title,
      description: sanitizeOptionalText(record.description, 320),
      imageUrl: sanitizeUrl(record.imageUrl),
      inviteLink,
      inviteUpdatedAt:
        typeof record.inviteUpdatedAt === "string" && record.inviteUpdatedAt.trim()
          ? record.inviteUpdatedAt.trim()
          : null,
      isActive: record.isActive !== false,
      order: Number.isFinite(order) ? Math.floor(order) : index,
    });

    if (groups.length >= 20) {
      break;
    }
  }

  return groups.sort((a, b) => a.order - b.order).map((group, index) => ({ ...group, order: index }));
};

const mapRowToSettings = (row: AdminSiteSettingsRow | null): AdminSiteSettings => {
  if (!row) {
    return {
      ...DEFAULT_SETTINGS,
      features: cloneDefaultFeatures(),
      workflowBullets: [...DEFAULT_WORKFLOW_BULLETS],
      seoKeywords: [],
      seoHighlightKeywords: [],
    };
  }

  const features = parseFeaturesJson(row.features_json);
  const workflowBullets = parseWorkflowBulletsJson(row.workflow_bullets_json);
  const faviconAssets = parseFaviconAssets(row.favicon_assets_json ?? null);
  const userPanelBanners = parsePanelBannersJson(row.user_panel_banners_json ?? null);
  const testGroups = parseTestGroupsJson(row.test_groups_json ?? null);
  const officialGroups = parseOfficialGroupsJson(row.official_groups_json ?? null, {
    instanceId: normalizeOfficialGroupInstanceId(row.official_group_instance_id),
    remoteId: nonEmptyOrNull(row.official_group_jid, null),
    inviteLink: nonEmptyOrNull(row.official_group_invite_link, null),
    inviteUpdatedAt: row.official_group_invite_updated_at,
  });
  const primaryOfficialGroup = officialGroups.find((group) => group.isActive && group.inviteLink) ?? officialGroups[0] ?? null;

  return {
    siteName: nonEmpty(row.site_name, DEFAULT_SETTINGS.siteName),
    tagline: nonEmptyOrNull(row.tagline, null),
    logoUrl: row.logo_path ? resolveUploadedFileUrl(row.logo_path) : null,
    faviconUrl: row.favicon_path ? resolveUploadedFileUrl(row.favicon_path) : null,
    faviconAssets,
    mobileAppIconUrl: row.mobile_icon_path ? resolveUploadedFileUrl(row.mobile_icon_path) : null,
    supportEmail: nonEmptyOrNull(row.support_email, null),
    supportPhone: nonEmptyOrNull(row.support_phone, null),
    supportUrl: nonEmpty(row.support_url, DEFAULT_SUPPORT_URL),
    supportChannel: row.support_channel === "whatsapp" ? "whatsapp" : "chat",
    supportWhatsappNumber: nonEmptyOrNull(row.support_whatsapp_number, null),
    userPanelBanners,
    testGroups,
    officialGroups,
    officialGroupInstanceId:
      primaryOfficialGroup?.instanceId ?? normalizeOfficialGroupInstanceId(row.official_group_instance_id),
    officialGroupJid: primaryOfficialGroup?.remoteId ?? nonEmptyOrNull(row.official_group_jid, null),
    officialGroupInviteLink:
      primaryOfficialGroup?.inviteLink ?? nonEmptyOrNull(row.official_group_invite_link, null),
    officialGroupInviteUpdatedAt:
      primaryOfficialGroup?.inviteUpdatedAt ??
      (row.official_group_invite_updated_at ? row.official_group_invite_updated_at.toISOString() : null),
    emailVerificationEnabled: Boolean(row.email_verification_enabled),
    emailVerificationApiKeys: parseEmailVerificationKeys(row.email_verification_api_keys ?? null),
    heroBadge: nonEmpty(row.hero_badge, DEFAULT_HERO_BADGE),
    heroTitle: nonEmpty(row.hero_title, DEFAULT_HERO_TITLE),
    heroSubtitle: nonEmpty(row.hero_subtitle, DEFAULT_HERO_SUBTITLE),
    heroButtonLabel: nonEmpty(row.hero_button_label, DEFAULT_HERO_BUTTON_LABEL),
    heroButtonUrl: nonEmpty(row.hero_button_url, DEFAULT_HERO_BUTTON_URL),
    heroSecondaryButtonLabel: nonEmpty(
      row.hero_secondary_button_label,
      DEFAULT_HERO_SECONDARY_BUTTON_LABEL,
    ),
    heroSecondaryButtonUrl: nonEmpty(
      row.hero_secondary_button_url,
      DEFAULT_HERO_SECONDARY_BUTTON_URL,
    ),
    heroImageUrl: row.hero_image_path ? resolveUploadedFileUrl(row.hero_image_path) : null,
    featuresTitle: nonEmpty(row.features_title, DEFAULT_FEATURES_TITLE),
    featuresSubtitle: nonEmpty(row.features_subtitle, DEFAULT_FEATURES_SUBTITLE),
    features: features.length > 0 ? features : [],
    workflowTitle: nonEmpty(row.workflow_title, DEFAULT_WORKFLOW_TITLE),
    workflowDescription: nonEmpty(row.workflow_description, DEFAULT_WORKFLOW_DESCRIPTION),
    workflowBullets: workflowBullets.length > 0 ? workflowBullets : [],
    workflowImageUrl: row.workflow_image_path ? resolveUploadedFileUrl(row.workflow_image_path) : null,
    ctaTitle: nonEmpty(row.cta_title, DEFAULT_CTA_TITLE),
    ctaDescription: nonEmpty(row.cta_description, DEFAULT_CTA_DESCRIPTION),
    ctaButtonLabel: nonEmpty(row.cta_button_label, DEFAULT_CTA_BUTTON_LABEL),
    ctaButtonUrl: nonEmpty(row.cta_button_url, DEFAULT_CTA_BUTTON_URL),
    seoTitle: nonEmptyOrNull(row.seo_title, null),
    seoDescription: nonEmptyOrNull(row.seo_description, null),
    seoImageUrl: row.seo_image_path ? resolveUploadedFileUrl(row.seo_image_path) : null,
    footerText: nonEmptyOrNull(row.footer_text, null),
    seoKeywords: parseKeywordsJson(row.seo_keywords_json, []),
    seoHighlightKeywords: parseKeywordsJson(row.seo_highlight_keywords_json, []),
    termsContent: resolveTermsContent(
      looksMojibake(row.terms_content ?? "") ? DEFAULT_TERMS_CONTENT : row.terms_content,
    ),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
};

export const getAdminSiteSettings = async (): Promise<AdminSiteSettings> => {
  await ensureAdminSiteSettingsTable();

  const db = getDb();
  const [rows] = await db.query<(AdminSiteSettingsRow & RowDataPacket)[]>(
    "SELECT * FROM admin_site_settings WHERE id = 1 LIMIT 1",
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapRowToSettings(row);
};

export const removeEmailVerificationKeys = async (keysToRemove: string[]): Promise<void> => {
  if (!Array.isArray(keysToRemove) || keysToRemove.length === 0) {
    return;
  }

  const normalized = Array.from(
    new Set(
      keysToRemove
        .map((key) => (typeof key === "string" ? key.trim() : ""))
        .filter((key) => key.length > 0)
        .map((key) => key.toLowerCase()),
    ),
  );

  if (!normalized.length) {
    return;
  }

  await ensureAdminSiteSettingsTable();
  const db = getDb();
  const [rows] = await db.query<(AdminSiteSettingsRow & RowDataPacket)[]>(
    "SELECT email_verification_api_keys FROM admin_site_settings WHERE id = 1 LIMIT 1",
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) {
    return;
  }

  const currentKeys = parseEmailVerificationKeys(row.email_verification_api_keys ?? null);
  if (currentKeys.length === 0) {
    return;
  }

  const remaining = currentKeys.filter(
    (key) => !normalized.includes(key.trim().toLowerCase()),
  );

  if (remaining.length === currentKeys.length) {
    return;
  }

  const nextValue = remaining.length > 0 ? JSON.stringify(remaining) : null;
  await db.query("UPDATE admin_site_settings SET email_verification_api_keys = ? WHERE id = 1", [
    nextValue,
  ]);
};

const normalizePayload = (payload: AdminSiteSettingsPayload): AdminSiteSettingsPayload => {
  const siteName = sanitizeRequiredText(payload.siteName, 120, "o nome do site");
  const tagline = sanitizeOptionalText(payload.tagline, 160);
  const supportEmail = sanitizeEmail(payload.supportEmail);
  const supportPhone = sanitizePhone(payload.supportPhone);
  const supportUrl = sanitizeUrl(payload.supportUrl);
  const supportChatMode = sanitizeSupportChannel(payload.supportChatMode);
  const supportWhatsappNumber = sanitizeWhatsappNumber(payload.supportWhatsappNumber);
  const normalizePanelBanners = Array.isArray(payload.userPanelBanners)
    ? payload.userPanelBanners
    : [];
  const userPanelBanners = normalizePanelBanners
    .map((banner, index) => {
      const title = sanitizeOptionalText(banner?.title, 160) ?? "";
      const subtitle = sanitizeOptionalText(banner?.subtitle, 200);
      const linkUrl = sanitizeUrl(banner?.linkUrl);
      const mediaUrl = sanitizeUrl(banner?.mediaUrl);
      const order = Number.isFinite(banner?.order) ? Number(banner.order) : index;
      const isActive = banner?.isActive !== false;
      const id =
        typeof banner?.id === "number" && Number.isFinite(banner.id)
          ? Number(banner.id)
          : Number(`${Date.now()}${index}`.slice(-6));
      if (!mediaUrl && !title) {
        return null;
      }
      return { id, title, subtitle, linkUrl, mediaUrl: mediaUrl ?? "", order, isActive };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const normalizeTestGroups = Array.isArray(payload.testGroups) ? payload.testGroups : [];
  const testGroups = normalizeTestGroups
    .map((group) => {
      const title = sanitizeOptionalText(group?.title, 120) ?? "";
      const url = sanitizeUrl(group?.url);
      if (!title || !url) {
        return null;
      }
      return { title, url };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const officialGroups = normalizeOfficialGroupsPayload(payload.officialGroups);
  const officialGroupInstanceId = normalizeOfficialGroupInstanceId(payload.officialGroupInstanceId);
  const officialGroupJid = normalizeOfficialGroupJid(payload.officialGroupJid);
  const heroBadge = sanitizeOptionalText(payload.heroBadge, 120);
  const heroTitle = sanitizeOptionalText(payload.heroTitle, 160);
  const heroSubtitle = sanitizeOptionalText(payload.heroSubtitle, 240);
  const heroButtonLabel = sanitizeOptionalText(payload.heroButtonLabel, 60);
  const heroButtonUrl = sanitizeUrl(payload.heroButtonUrl);
  const heroSecondaryButtonLabel = sanitizeOptionalText(payload.heroSecondaryButtonLabel, 60);
  const heroSecondaryButtonUrl = sanitizeUrl(payload.heroSecondaryButtonUrl);
  const featuresTitle = sanitizeOptionalText(payload.featuresTitle, 160);
  const featuresSubtitle = sanitizeOptionalText(payload.featuresSubtitle, 320);
  const features = sanitizeFeaturesPayload(payload.features);
  const workflowTitle = sanitizeOptionalText(payload.workflowTitle, 160);
  const workflowDescription = sanitizeOptionalText(payload.workflowDescription, 320);
  const workflowBullets = sanitizeWorkflowBulletsPayload(payload.workflowBullets);
  const ctaTitle = sanitizeOptionalText(payload.ctaTitle, 160);
  const ctaDescription = sanitizeOptionalText(payload.ctaDescription, 320);
  const ctaButtonLabel = sanitizeOptionalText(payload.ctaButtonLabel, 60);
  const ctaButtonUrl = sanitizeUrl(payload.ctaButtonUrl);
  const seoTitle = sanitizeOptionalText(payload.seoTitle, 160);
  const seoDescription = sanitizeOptionalText(payload.seoDescription, 320);
  const footerText = sanitizeOptionalText(payload.footerText, 600);
  const seoKeywords = sanitizeKeywordList(payload.seoKeywords, {
    maxItems: MAX_SEO_KEYWORDS,
    maxLength: MAX_KEYWORD_LENGTH,
  });
  const seoHighlightKeywords = sanitizeKeywordList(payload.seoHighlightKeywords, {
    maxItems: MAX_SEO_HIGHLIGHT_KEYWORDS,
    maxLength: MAX_KEYWORD_LENGTH,
  });
  const termsContent = sanitizeTermsContent(payload.termsContent);
  const emailVerificationEnabled = Boolean(payload.emailVerificationEnabled);
  const emailVerificationApiKeys = sanitizeApiKeyList(payload.emailVerificationApiKeys);

  if (emailVerificationEnabled && emailVerificationApiKeys.length === 0) {
    throw new AdminSiteSettingsError(
      "Ative a verificação de e-mails somente após informar ao menos uma API Key do Email-Validator.",
    );
  }

  if (heroButtonUrl && !heroButtonLabel) {
    throw new AdminSiteSettingsError("Informe o texto do botão principal.");
  }

  if (heroButtonLabel && !heroButtonUrl) {
    throw new AdminSiteSettingsError("Informe a URL que será aberta pelo botão principal.");
  }

  if (heroSecondaryButtonUrl && !heroSecondaryButtonLabel) {
    throw new AdminSiteSettingsError("Informe o texto do botão secundário.");
  }

  if (heroSecondaryButtonLabel && !heroSecondaryButtonUrl) {
    throw new AdminSiteSettingsError("Informe a URL do botão secundário.");
  }

  if (ctaButtonUrl && !ctaButtonLabel) {
    throw new AdminSiteSettingsError("Informe o texto do botão de chamada final.");
  }

  if (ctaButtonLabel && !ctaButtonUrl) {
    throw new AdminSiteSettingsError("Informe a URL do botão de chamada final.");
  }

  if (supportChatMode === "whatsapp" && !supportWhatsappNumber) {
    throw new AdminSiteSettingsError("Informe o número do WhatsApp que será utilizado no suporte.");
  }

  if ((officialGroupInstanceId && !officialGroupJid) || (!officialGroupInstanceId && officialGroupJid)) {
    throw new AdminSiteSettingsError("Informe a instância e o ID do grupo oficial juntos.");
  }

  return {
    siteName,
    tagline,
    supportEmail,
    supportPhone,
    supportUrl,
    supportChatMode,
    supportWhatsappNumber,
    userPanelBanners,
    testGroups,
    officialGroups,
    officialGroupInstanceId,
    officialGroupJid,
    emailVerificationEnabled,
    emailVerificationApiKeys,
    heroBadge,
    heroTitle,
    heroSubtitle,
    heroButtonLabel,
    heroButtonUrl,
    heroSecondaryButtonLabel,
    heroSecondaryButtonUrl,
    featuresTitle,
    featuresSubtitle,
    features,
    workflowTitle,
    workflowDescription,
    workflowBullets,
    ctaTitle,
    ctaDescription,
    ctaButtonLabel,
    ctaButtonUrl,
    seoTitle,
    seoDescription,
    footerText,
    seoKeywords,
    seoHighlightKeywords,
    termsContent,
  };
};

const extractFormPayload = (formData: FormData) => {
  const getOptional = (key: string): string | null => {
    const value = formData.get(key);
    if (value instanceof File) {
      return null;
    }
    return typeof value === "string" ? value : null;
  };

  const getRequired = (key: string): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };

  const parseFeaturesField = (): AdminHomepageFeature[] => {
    const raw = getOptional("features");
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .slice(0, 6)
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const record = item as Record<string, unknown>;
          return {
            title: typeof record.title === "string" ? record.title : "",
            description: typeof record.description === "string" ? record.description : "",
          };
        })
        .filter((feature): feature is AdminHomepageFeature => Boolean(feature));
    } catch {
      return [];
    }
  };

  const parseWorkflowBulletsField = (): string[] => {
    const raw = getOptional("workflowBullets");
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .slice(0, 6)
        .map((item) => (typeof item === "string" ? item : ""))
        .filter((bullet): bullet is string => Boolean(bullet));
    } catch {
      return [];
    }
  };

  const parseEmailVerificationEnabled = (): boolean => {
    const raw = getOptional("emailVerificationEnabled");
    if (!raw) {
      return false;
    }

    const normalized = raw.toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes";
  };

  const parseEmailVerificationKeysField = (): string[] => {
    const raw = getOptional("emailVerificationApiKeys");
    if (!raw) {
      return [];
    }

    return raw
      .split(/\r?\n/)
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
      .slice(0, 50);
  };

  const parseKeywordField = (key: string): string[] => {
    const raw = getOptional(key);
    if (!raw) {
      return [];
    }

    return raw
      .split(/[\n,]/)
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0);
  };

  const logoEntry = formData.get("logo");
  const faviconEntry = formData.get("favicon");
  const seoImageEntry = formData.get("seoImage");
  const appIconEntry = formData.get("appIcon");
  const heroImageEntry = formData.get("heroImage");
  const workflowImageEntry = formData.get("workflowImage");
  const parseJsonArray = (key: string): unknown[] => {
    const raw = getOptional(key);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  return {
    payload: {
      siteName: getRequired("siteName"),
      tagline: getOptional("tagline"),
      supportEmail: getOptional("supportEmail"),
      supportPhone: getOptional("supportPhone"),
      supportUrl: getOptional("supportUrl"),
      supportChatMode: getOptional("supportChatMode"),
      supportWhatsappNumber: getOptional("supportWhatsappNumber"),
      userPanelBanners: parseJsonArray("userPanelBanners") as AdminSiteSettingsPayload["userPanelBanners"],
      testGroups: parseJsonArray("testGroups") as AdminSiteSettingsPayload["testGroups"],
      officialGroups: parseJsonArray("officialGroups") as AdminSiteSettingsPayload["officialGroups"],
      officialGroupInstanceId: normalizeOfficialGroupInstanceId(getOptional("officialGroupInstanceId")),
      officialGroupJid: getOptional("officialGroupJid"),
      emailVerificationEnabled: parseEmailVerificationEnabled(),
      emailVerificationApiKeys: parseEmailVerificationKeysField(),
      heroBadge: getOptional("heroBadge"),
      heroTitle: getOptional("heroTitle"),
      heroSubtitle: getOptional("heroSubtitle"),
      heroButtonLabel: getOptional("heroButtonLabel"),
      heroButtonUrl: getOptional("heroButtonUrl"),
      heroSecondaryButtonLabel: getOptional("heroSecondaryButtonLabel"),
      heroSecondaryButtonUrl: getOptional("heroSecondaryButtonUrl"),
      featuresTitle: getOptional("featuresTitle"),
      featuresSubtitle: getOptional("featuresSubtitle"),
      features: parseFeaturesField(),
      workflowTitle: getOptional("workflowTitle"),
      workflowDescription: getOptional("workflowDescription"),
      workflowBullets: parseWorkflowBulletsField(),
      ctaTitle: getOptional("ctaTitle"),
      ctaDescription: getOptional("ctaDescription"),
      ctaButtonLabel: getOptional("ctaButtonLabel"),
      ctaButtonUrl: getOptional("ctaButtonUrl"),
      seoTitle: getOptional("seoTitle"),
      seoDescription: getOptional("seoDescription"),
      footerText: getOptional("footerText"),
      seoKeywords: parseKeywordField("seoKeywords"),
      seoHighlightKeywords: parseKeywordField("seoHighlightKeywords"),
      termsContent: getOptional("termsContent"),
    },
    removeLogo: String(formData.get("removeLogo")).toLowerCase() === "true",
    removeFavicon: String(formData.get("removeFavicon")).toLowerCase() === "true",
    removeSeoImage: String(formData.get("removeSeoImage")).toLowerCase() === "true",
    removeAppIcon: String(formData.get("removeAppIcon")).toLowerCase() === "true",
    removeHeroImage: String(formData.get("removeHeroImage")).toLowerCase() === "true",
    removeWorkflowImage: String(formData.get("removeWorkflowImage")).toLowerCase() === "true",
    logoFile: logoEntry instanceof File ? logoEntry : null,
    faviconFile: faviconEntry instanceof File ? faviconEntry : null,
    seoImageFile: seoImageEntry instanceof File ? seoImageEntry : null,
    appIconFile: appIconEntry instanceof File ? appIconEntry : null,
    heroImageFile: heroImageEntry instanceof File ? heroImageEntry : null,
    workflowImageFile: workflowImageEntry instanceof File ? workflowImageEntry : null,
  };
};

export const saveAdminSiteSettingsFromForm = async (
  formData: FormData,
): Promise<AdminSiteSettings> => {
  await ensureAdminSiteSettingsTable();

  const db = getDb();
  const [rows] = await db.query<(AdminSiteSettingsRow & RowDataPacket)[]>(
    "SELECT * FROM admin_site_settings WHERE id = 1 LIMIT 1",
  );
  const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  const {
    payload,
    removeLogo,
    removeFavicon,
    removeSeoImage,
    removeAppIcon,
    removeHeroImage,
    removeWorkflowImage,
    logoFile,
    faviconFile,
    seoImageFile,
    appIconFile,
    heroImageFile,
    workflowImageFile,
  } = extractFormPayload(formData);
  const normalized = normalizePayload(payload);

  let nextLogoPath = existing?.logo_path ?? null;
  let nextFaviconPath = existing?.favicon_path ?? null;
  let nextFaviconAssetsPath = existing?.favicon_assets_path ?? null;
  let nextFaviconAssetsJson = existing?.favicon_assets_json ?? null;
  let nextSeoImagePath = existing?.seo_image_path ?? null;
  let nextAppIconPath = existing?.mobile_icon_path ?? null;
  let nextHeroImagePath = existing?.hero_image_path ?? null;
  let nextWorkflowImagePath = existing?.workflow_image_path ?? null;
  let logoToDelete: string | null = null;
  let faviconToDelete: string | null = null;
  let faviconAssetsToDelete: string | null = null;
  let seoImageToDelete: string | null = null;
  let appIconToDelete: string | null = null;
  let heroImageToDelete: string | null = null;
  let workflowImageToDelete: string | null = null;

  const emailVerificationKeysJson =
    normalized.emailVerificationApiKeys.length > 0
      ? JSON.stringify(normalized.emailVerificationApiKeys)
      : null;

  if (removeLogo && nextLogoPath) {
    logoToDelete = nextLogoPath;
    nextLogoPath = null;
  }

  if (removeFavicon) {
    if (nextFaviconPath) {
      faviconToDelete = nextFaviconPath;
      nextFaviconPath = null;
    }
    if (nextFaviconAssetsPath) {
      faviconAssetsToDelete = nextFaviconAssetsPath;
      nextFaviconAssetsPath = null;
      nextFaviconAssetsJson = null;
    }
  }

  if (removeSeoImage && nextSeoImagePath) {
    seoImageToDelete = nextSeoImagePath;
    nextSeoImagePath = null;
  }

  if (removeHeroImage && nextHeroImagePath) {
    heroImageToDelete = nextHeroImagePath;
    nextHeroImagePath = null;
  }

  if (removeWorkflowImage && nextWorkflowImagePath) {
    workflowImageToDelete = nextWorkflowImagePath;
    nextWorkflowImagePath = null;
  }

  if (logoFile && logoFile.size > 0) {
    validateImageFile(logoFile, MAX_LOGO_SIZE, LOGO_ALLOWED_MIME, "5 MB", "PNG, JPG, WEBP ou SVG");
    const stored = await saveUploadedFile(logoFile, "admin/site", SITE_LOGO_IMAGE_OPTIONS);
    if (!removeLogo && existing?.logo_path) {
      logoToDelete = existing.logo_path;
    }
    nextLogoPath = stored;
  }

  // Favicon
  if (faviconFile && faviconFile.size > 0) {
    validateImageFile(
      faviconFile,
      MAX_LOGO_SIZE,
      FAVICON_ALLOWED_MIME,
      "5 MB",
      "ICO, PNG, WEBP ou SVG",
    );
    const stored = await saveUploadedFile(faviconFile, "admin/site", { convertToWebp: false });
    if (!removeFavicon && existing?.favicon_path) {
      faviconToDelete = existing.favicon_path;
    }
    nextFaviconPath = stored;

    const generatedAssets = await generateFaviconAssetsFromSource(stored);
    if (existing?.favicon_assets_path && existing.favicon_assets_path !== generatedAssets.assetsPath) {
      faviconAssetsToDelete = existing.favicon_assets_path;
    }
    nextFaviconAssetsPath = generatedAssets.assetsPath;
    nextFaviconAssetsJson = generatedAssets.assetsJson;
  }

  if (!nextFaviconAssetsPath && nextFaviconPath) {
    const generatedAssets = await generateFaviconAssetsFromSource(nextFaviconPath);
    nextFaviconAssetsPath = generatedAssets.assetsPath;
    nextFaviconAssetsJson = generatedAssets.assetsJson;
  }

  if (seoImageFile && seoImageFile.size > 0) {
    validateImageFile(seoImageFile, MAX_SEO_IMAGE_SIZE, SEO_IMAGE_ALLOWED_MIME, "3 MB", "PNG, JPG ou WEBP");
    const stored = await saveUploadedFile(seoImageFile, "admin/seo", SITE_SEO_IMAGE_OPTIONS);
    if (!removeSeoImage && existing?.seo_image_path) {
      seoImageToDelete = existing.seo_image_path;
    }
    nextSeoImagePath = stored;
  }

  // App Icon (Android/iOS)
  if (removeAppIcon && nextAppIconPath) {
    appIconToDelete = nextAppIconPath;
    nextAppIconPath = null;
  }

  if (appIconFile && appIconFile.size > 0) {
    // Aceita formatos comuns e converte para PNG com nome estável (app-icon.png)
    validateImageFile(appIconFile, MAX_LOGO_SIZE, LOGO_ALLOWED_MIME, "5 MB", "PNG, JPG, WEBP ou SVG");
    const stored = await saveUploadedFile(appIconFile, "admin/mobile", {
      convertToWebp: false,
      fixedFileName: "app-icon.png",
      forceExtension: ".png",
    });
    if (!removeAppIcon && existing?.mobile_icon_path && existing.mobile_icon_path !== stored) {
      appIconToDelete = existing.mobile_icon_path;
    }
    nextAppIconPath = stored;
  }

  if (heroImageFile && heroImageFile.size > 0) {
    validateImageFile(
      heroImageFile,
      MAX_HOMEPAGE_IMAGE_SIZE,
      HOMEPAGE_IMAGE_ALLOWED_MIME,
      "5 MB",
      "PNG, JPG ou WEBP",
    );
    const stored = await saveUploadedFile(heroImageFile, "admin/homepage", SITE_HOMEPAGE_IMAGE_OPTIONS);
    if (!removeHeroImage && existing?.hero_image_path) {
      heroImageToDelete = existing.hero_image_path;
    }
    nextHeroImagePath = stored;
  }

  if (workflowImageFile && workflowImageFile.size > 0) {
    validateImageFile(
      workflowImageFile,
      MAX_HOMEPAGE_IMAGE_SIZE,
      HOMEPAGE_IMAGE_ALLOWED_MIME,
      "5 MB",
      "PNG, JPG ou WEBP",
    );
    const stored = await saveUploadedFile(workflowImageFile, "admin/homepage", SITE_HOMEPAGE_IMAGE_OPTIONS);
    if (!removeWorkflowImage && existing?.workflow_image_path) {
      workflowImageToDelete = existing.workflow_image_path;
    }
    nextWorkflowImagePath = stored;
  }

  const featuresJson = JSON.stringify(normalized.features);
  const workflowBulletsJson = JSON.stringify(normalized.workflowBullets);
  const seoKeywordsJson =
    normalized.seoKeywords.length > 0 ? JSON.stringify(normalized.seoKeywords) : null;
  const seoHighlightKeywordsJson =
    normalized.seoHighlightKeywords.length > 0
      ? JSON.stringify(normalized.seoHighlightKeywords)
      : null;
  const userPanelBannersJson =
    normalized.userPanelBanners.length > 0 ? JSON.stringify(normalized.userPanelBanners) : null;
  const testGroupsJson =
    normalized.testGroups.length > 0 ? JSON.stringify(normalized.testGroups) : null;
  const officialGroupsJson =
    normalized.officialGroups.length > 0 ? JSON.stringify(normalized.officialGroups) : null;
  const primaryOfficialGroup =
    normalized.officialGroups.find((group) => group.isActive) ?? normalized.officialGroups[0] ?? null;
  const existingOfficialInstanceId = normalizeOfficialGroupInstanceId(
    existing?.official_group_instance_id,
  );
  const existingOfficialJid = nonEmptyOrNull(existing?.official_group_jid, null);
  const officialGroupChanged =
    normalized.officialGroupInstanceId !== existingOfficialInstanceId ||
    normalized.officialGroupJid !== existingOfficialJid;
  const nextOfficialInviteLink = officialGroupChanged
    ? null
    : existing?.official_group_invite_link ?? null;
  const nextOfficialInviteUpdatedAt = officialGroupChanged
    ? null
    : existing?.official_group_invite_updated_at ?? null;

  await db.query(
    `
      UPDATE admin_site_settings
      SET
        site_name = ?,
        tagline = ?,
        logo_path = ?,
        favicon_path = ?,
        favicon_assets_path = ?,
        favicon_assets_json = ?,
        mobile_icon_path = ?,
        seo_image_path = ?,
        support_email = ?,
        support_phone = ?,
        support_url = ?,
        support_channel = ?,
        support_whatsapp_number = ?,
        email_verification_enabled = ?,
        email_verification_api_keys = ?,
        hero_badge = ?,
        hero_title = ?,
        hero_subtitle = ?,
        hero_button_label = ?,
        hero_button_url = ?,
        hero_secondary_button_label = ?,
        hero_secondary_button_url = ?,
        hero_image_path = ?,
        features_title = ?,
        features_subtitle = ?,
        features_json = ?,
        workflow_title = ?,
        workflow_description = ?,
        workflow_bullets_json = ?,
        workflow_image_path = ?,
        cta_title = ?,
        cta_description = ?,
        cta_button_label = ?,
        cta_button_url = ?,
        seo_title = ?,
        seo_description = ?,
        seo_keywords_json = ?,
        seo_highlight_keywords_json = ?,
        user_panel_banners_json = ?,
        test_groups_json = ?,
        official_groups_json = ?,
        official_group_instance_id = ?,
        official_group_jid = ?,
        official_group_invite_link = ?,
        official_group_invite_updated_at = ?,
        footer_text = ?,
        terms_content = ?
      WHERE id = 1
    `,
    [
      normalized.siteName,
      normalized.tagline,
      nextLogoPath,
      nextFaviconPath,
      nextFaviconAssetsPath,
      nextFaviconAssetsJson,
      nextAppIconPath,
      nextSeoImagePath,
      normalized.supportEmail,
      normalized.supportPhone,
      normalized.supportUrl,
      normalized.supportChatMode,
      normalized.supportWhatsappNumber,
      normalized.emailVerificationEnabled ? 1 : 0,
      emailVerificationKeysJson,
      normalized.heroBadge,
      normalized.heroTitle,
      normalized.heroSubtitle,
      normalized.heroButtonLabel,
      normalized.heroButtonUrl,
      normalized.heroSecondaryButtonLabel,
      normalized.heroSecondaryButtonUrl,
      nextHeroImagePath,
      normalized.featuresTitle,
      normalized.featuresSubtitle,
      featuresJson,
      normalized.workflowTitle,
      normalized.workflowDescription,
      workflowBulletsJson,
      nextWorkflowImagePath,
      normalized.ctaTitle,
      normalized.ctaDescription,
      normalized.ctaButtonLabel,
      normalized.ctaButtonUrl,
      normalized.seoTitle,
      normalized.seoDescription,
      seoKeywordsJson,
      seoHighlightKeywordsJson,
      userPanelBannersJson,
      testGroupsJson,
      officialGroupsJson,
      primaryOfficialGroup?.instanceId ?? normalized.officialGroupInstanceId,
      primaryOfficialGroup?.remoteId ?? normalized.officialGroupJid,
      primaryOfficialGroup?.inviteLink ?? nextOfficialInviteLink,
      primaryOfficialGroup?.inviteUpdatedAt
        ? new Date(primaryOfficialGroup.inviteUpdatedAt)
        : nextOfficialInviteUpdatedAt,
      normalized.footerText,
      normalized.termsContent,
    ],
  );

  if (logoToDelete) {
    await deleteUploadedFile(logoToDelete);
  }

  if (seoImageToDelete) {
    await deleteUploadedFile(seoImageToDelete);
  }

  if (heroImageToDelete) {
    await deleteUploadedFile(heroImageToDelete);
  }

  if (workflowImageToDelete) {
    await deleteUploadedFile(workflowImageToDelete);
  }

  if (appIconToDelete) {
    await deleteUploadedFile(appIconToDelete);
  }

  if (faviconToDelete) {
    await deleteUploadedFile(faviconToDelete);
  }

  if (faviconAssetsToDelete) {
    await deleteUploadedFolder(faviconAssetsToDelete);
  }

  return getAdminSiteSettings();
};

export const refreshOfficialGroupInviteLink = async (input: {
  instanceId: unknown;
  groupJid: unknown;
  groupId?: unknown;
  reset?: unknown;
}): Promise<AdminSiteSettings> => {
  await ensureAdminSiteSettingsTable();

  const instanceId = normalizeOfficialGroupInstanceId(input.instanceId);
  const groupJid = normalizeOfficialGroupJid(input.groupJid);
  const groupId = Number(input.groupId);
  const reset = input.reset === true;

  if (!instanceId || !groupJid) {
    throw new AdminSiteSettingsError("Selecione a instância e informe o ID do grupo oficial.");
  }

  const instance = await getInstanceById(instanceId);
  if (!instance) {
    throw new AdminSiteSettingsError("Instância não encontrada.", 404);
  }
  if (!instance.serverBaseUrl || !instance.token) {
    throw new AdminSiteSettingsError("Servidor ou token da instância não configurado.", 500);
  }

  let inviteLink: string;
  try {
    inviteLink = await getGroupInviteLink(
      { baseUrl: instance.serverBaseUrl, token: instance.token },
      { groupJid, reset },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new AdminSiteSettingsError(
      `Não foi possível obter o link do grupo. Confirme que a instância está conectada e é administradora do grupo.${message ? ` Detalhe: ${message}` : ""}`,
      502,
    );
  }

  const db = getDb();
  const settings = await getAdminSiteSettings();
  const nextOfficialGroups = settings.officialGroups.map((group) =>
    group.instanceId === instanceId && group.remoteId.toLowerCase() === groupJid.toLowerCase()
      ? {
          ...group,
          inviteLink,
          inviteUpdatedAt: new Date().toISOString(),
        }
      : group,
  );
  const officialGroupsJson =
    nextOfficialGroups.length > 0 ? JSON.stringify(nextOfficialGroups) : null;

  await db.query(
    `
      UPDATE admin_site_settings
      SET
        official_groups_json = ?,
        official_group_instance_id = ?,
        official_group_jid = ?,
        official_group_invite_link = ?,
        official_group_invite_updated_at = NOW()
      WHERE id = 1
    `,
    [officialGroupsJson, instanceId, groupJid, inviteLink],
  );

  if (Number.isFinite(groupId) && groupId > 0) {
    await ensureBotGroupTable();
    await db.query(
      `
        UPDATE bot_groups
        SET invite_link = ?, invite_code = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [inviteLink, inviteLink.split("/").pop() ?? null, Math.floor(groupId)],
    );
  }

  return getAdminSiteSettings();
};

export const listOfficialGroupCandidatesForAdmin = async (): Promise<AdminOfficialGroupCandidate[]> => {
  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        bg.id AS group_id,
        bg.instance_id,
        bg.remote_id,
        bg.name,
        bg.description,
        bg.image_url,
        bg.invite_link,
        bg.status,
        bg.updated_at,
        bi.name AS instance_name,
        bi.phone AS instance_phone,
        u.name AS user_name
      FROM bot_groups bg
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      LEFT JOIN users u ON u.id = bg.user_id
      WHERE bg.instance_id IS NOT NULL
      ORDER BY bi.name ASC, bg.name ASC
    `,
  );

  return rows.map((row) => ({
    groupId: Number(row.group_id),
    instanceId: Number(row.instance_id),
    instanceName: typeof row.instance_name === "string" && row.instance_name.trim() ? row.instance_name : "Instância",
    instancePhone: typeof row.instance_phone === "string" ? row.instance_phone : "",
    userName: typeof row.user_name === "string" && row.user_name.trim() ? row.user_name : "Usuário",
    remoteId: String(row.remote_id ?? ""),
    title: String(row.name ?? row.remote_id ?? "Grupo"),
    description: typeof row.description === "string" && row.description.trim() ? row.description : null,
    imageUrl: typeof row.image_url === "string" && row.image_url.trim() ? row.image_url : null,
    inviteLink: typeof row.invite_link === "string" && row.invite_link.trim() ? row.invite_link : null,
    status: String(row.status ?? "active"),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at as string).toISOString(),
  }));
};

export const getAdminMobileIconRelativePath = async (): Promise<string | null> => {
  await ensureAdminSiteSettingsTable();

  const db = getDb();
  const [rows] = await db.query<(AdminSiteSettingsRow & RowDataPacket)[]>(
    "SELECT mobile_icon_path FROM admin_site_settings WHERE id = 1 LIMIT 1",
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return row?.mobile_icon_path ?? null;
};
