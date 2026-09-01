"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Image,
  InputGroup,
  ListGroup,
  Modal,
  Row,
  Spinner,
} from "react-bootstrap";
import type { ButtonProps } from "react-bootstrap/Button";
import { ArrowDown, ArrowUp, InfoCircleFill, Trash } from "react-bootstrap-icons";
import {
  IconAdjustments,
  IconBan,
  IconBrain,
  IconCommand,
  IconClock,
  IconLock,
  IconId,
  IconMessageChatbot,
  IconMoodSmile,
  IconPhoto,
  IconSend,
  IconTicket,
  IconX,
  IconHelpCircle,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import type { BotInstance } from "types/bot-instances";
import { buildGroupLicenseStatusSummary } from "lib/group-license-display";
import type {
  BotGroup,
  BotGroupAutoResponse,
  BotGroupAutoResponseMedia,
  BotGroupAutoResponseVcard,
  BotGroupBroadcastTemplate,
  BotGroupCommandToggles,
  BotGroupCtaButton,
  BotGroupMenuTexts,
  BotGroupParticipant,
  BotGroupSettings,
  BotGroupWelcomeButtonTemplate,
  BotGroupWelcomeReplyButton,
} from "types/bot-groups";
import type { UserPlanLimits, UserPlanStatus } from "types/plans";
import type { BotSweepstake } from "types/bot-sweepstakes";
import { DEFAULT_MENU_TEXTS, MENU_TEXT_VARIABLES } from "resources/default-menu-texts";
import { DEFAULT_COMMAND_ALIASES } from "resources/default-command-aliases";
import { HORAPG_DEFAULT_TIMEZONE, HORAPG_IMAGE_FALLBACK_URL } from "resources/horapg";
import {
  DEFAULT_UNKNOWN_COMMAND_TEMPLATE_SAMPLE,
  UNKNOWN_COMMAND_VARIABLES,
} from "resources/unknown-command-template";
import type { FieldTutorialMap } from "types/tutorials";
import {
  COMMAND_TUTORIAL_SLUG_BY_KEY,
  GROUP_ACTIVATION_TUTORIAL_SLUG_BY_KEY,
  GROUP_TUTORIAL_SLUG_BY_KEY,
} from "types/tutorials";
import TutorialTrigger from "components/tutorial/TutorialTrigger";

const resolveGroupTutorial = (
  key: GroupMiniViewKey,
  map: FieldTutorialMap,
): FieldTutorialMap[string] | undefined => {
  if (!(key in GROUP_TUTORIAL_SLUG_BY_KEY)) {
    return undefined;
  }
  const slug =
    GROUP_TUTORIAL_SLUG_BY_KEY[
      key as keyof typeof GROUP_TUTORIAL_SLUG_BY_KEY
    ];
  return slug ? map[slug] : undefined;
};

const resolveActivationTutorial = (
  key: keyof typeof GROUP_ACTIVATION_TUTORIAL_SLUG_BY_KEY,
  map: FieldTutorialMap,
): FieldTutorialMap[string] | undefined => {
  const slug = GROUP_ACTIVATION_TUTORIAL_SLUG_BY_KEY[key];
  return slug ? map[slug] : undefined;
};

type Feedback = { type: "success" | "danger" | "warning"; message: string } | null;

type SectionHeadingProps = {
  title: string;
  description: string;
  tutorial?: FieldTutorialMap[string] | undefined;
};

const SectionHeading = ({ title, description, tutorial }: SectionHeadingProps) => (
  <div className="d-flex flex-column gap-1">
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <Card.Title as="h3" className="h6 mb-0 fw-bold text-dark">
        {title}
      </Card.Title>
      {tutorial ? (
        <TutorialTrigger
          label={title}
          tutorial={tutorial}
          buttonVariant="outline-secondary"
          buttonSize="sm"
          className="p-1 d-inline-flex align-items-center justify-content-center"
          iconOnly
          ariaLabel={`Abrir tutorial sobre ${title}`}
        />
      ) : null}
    </div>
    <small className="text-secondary">{description}</small>
  </div>
);

const normalizeAliasToken = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const DISABLED_LEGACY_ALIAS_KEYS = new Set([
  "comprar",
  "saldo",
  "suporte",
  "perfil",
  "compras",
]);

const AliasEditor = ({
  settings,
  groupId,
  tutorials,
}: {
  settings: BotGroupSettings;
  groupId: number;
  tutorials: FieldTutorialMap;
}) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string>>(() => {
    const current = settings.commandAliases || {};
    const out: Record<string, string> = {};
    // Inclui todas as chaves conhecidas (defaults + atuais)
    const allKeys = Array.from(
      new Set([
        ...Object.keys(DEFAULT_COMMAND_ALIASES || {}),
        ...Object.keys(current || {}),
      ]),
    );
    for (const k of allKeys) {
      const canonicalKey = normalizeAliasToken(k);
      if (!canonicalKey || DISABLED_LEGACY_ALIAS_KEYS.has(canonicalKey)) {
        continue;
      }
      const list = (current?.[k] ?? DEFAULT_COMMAND_ALIASES?.[k] ?? []) as string[];
      out[canonicalKey] = (Array.isArray(list) ? list : []).join(", ");
    }
    return out;
  });

  const keys = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(DEFAULT_COMMAND_ALIASES || {}),
          ...Object.keys(settings.commandAliases || {}),
        ]),
      ).filter((key) => {
        const canonical = normalizeAliasToken(key);
        return Boolean(canonical) && !DISABLED_LEGACY_ALIAS_KEYS.has(canonical);
      }),
    [settings.commandAliases],
  );

  const handleChange = (k: string, v: string) => setLocal((p) => ({ ...p, [k]: v }));
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(local)) {
        const canon = normalizeAliasToken(k);
        if (!canon || DISABLED_LEGACY_ALIAS_KEYS.has(canon)) {
          continue;
        }
        const list = v
          .split(/[\s,;]+/)
          .map((entry) => normalizeAliasToken(entry))
          .filter(Boolean);
        payload[canon] = Array.from(new Set(list));
      }

      const resp = await fetch(`/api/bot-groups/${groupId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandAliases: payload }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(typeof data.message === "string" ? data.message : "Falha ao salvar aliases.");
      }
    } catch (e: any) {
      setError(e?.message || "Falha ao salvar aliases.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="d-flex flex-column gap-2">
      {error ? <Alert variant="danger" className="mb-0">{error}</Alert> : null}
      <Row className="g-2">
        {keys.map((k) => {
          const aliasList = Array.isArray(DEFAULT_COMMAND_ALIASES?.[k])
            ? DEFAULT_COMMAND_ALIASES[k]
            : [];
          const primaryAlias = aliasList[0] ?? k;
          const secondaryAlias = aliasList[1];
          const slug = COMMAND_TUTORIAL_SLUG_BY_KEY[k];
          const tutorial = slug ? tutorials[slug] : undefined;

          return (
            <Col md={6} key={k}>
              <Form.Group>
                <Form.Label className="text-secondary small d-flex align-items-center justify-content-between gap-2">
                  <span>/{primaryAlias}</span>
                  {tutorial ? (
                    <TutorialTrigger
                      label={`Comando ${primaryAlias}`}
                      tutorial={tutorial}
                      buttonVariant="outline-secondary"
                      buttonSize="sm"
                      className="p-1 d-inline-flex align-items-center justify-content-center"
                      iconOnly
                      ariaLabel={`Abrir tutorial sobre o comando ${primaryAlias}`}
                    />
                  ) : null}
                </Form.Label>
                <Form.Control
                  size="sm"
                  value={local[k] ?? ""}
                  placeholder={secondaryAlias ? `ex.: ${primaryAlias}, ${secondaryAlias}` : `ex.: ${primaryAlias}`}
                  onChange={(e) => handleChange(k, e.target.value)}
                  disabled={saving}
                />
              </Form.Group>
            </Col>
          );
        })}
      </Row>
      <div className="d-flex gap-2 align-items-center flex-wrap">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? <><Spinner animation="border" size="sm" /> Salvando…</> : "Salvar nomes"}
        </Button>
        <small className="text-secondary">Use vírgula para separar vários nomes.</small>
      </div>
    </div>
  );
};

type GroupSettingsUiState = {
  loading: boolean;
  saving: boolean;
  settings?: BotGroupSettings;
  nativeButtonsAvailable?: boolean;
  draftCommandPrefixes: string;
  draftAllowedLinks: string;
  draftAllowedDdis: string;
  draftAntifakeMessage: string;
  draftAntipalavrasBan: boolean;
  draftAntipalavrasLimit: string;
  draftBannedWords: string;
  dirtyCommandPrefixes: boolean;
  dirtyAllowedLinks: boolean;
  dirtyAllowedDdis: boolean;
  dirtyAntifakeMessage: boolean;
  dirtyAntipalavrasBan: boolean;
  dirtyAntipalavrasLimit: boolean;
  dirtyBannedWords: boolean;
  draftWelcomeCaption: string;
  draftWelcomeMediaUrl: string;
  draftWelcomeAsSticker: boolean;
  draftWelcomeAttachments?: BotGroupSettings["welcomeConfig"]["attachments"]; // optional
  dirtyWelcome: boolean;
  savingCommands: boolean;
  savingWelcome: boolean;
  draftMenuTexts: Record<MenuTextKey, string>;
  dirtyMenuTexts: Record<MenuTextKey, boolean>;
  savingMenuTexts: boolean;
  uploadingWelcomeMedia: boolean;
  draftAutoResponses: BotGroupAutoResponse[];
  dirtyAutoResponses: boolean;
  savingAutoResponses: boolean;
  error?: string | null;
  draftAiModel: string;
  dirtyAiModel: boolean;
  savingAiModel: boolean;
  draftUnknownCommandTemplate?: string;
  dirtyUnknownCommandTemplate?: boolean;
  savingUnknownCommandTemplate?: boolean;
};

export type GroupMiniViewKey =
  | "activations"
  | "welcome"
  | "autoresponse"
  | "horapg"
  | "schedule"
  | "sweepstakes"
  | "botinterage"
  | "details"
  | "media"
  | "aliases"
  | "blacklist"
  | "broadcast";

type ConfigModalKey = "prefixes" | "links" | "ddis" | "bannedWords";

type MenuTextKey = keyof BotGroupMenuTexts;

type AutoResponseMediaMode = "none" | "url" | "upload";

type AutoResponseModalDraft = {
  id: string;
  triggers: string;
  responseText: string;
  matchMode: "contains" | "equals";
  includeMedia: boolean;
  mediaMode: AutoResponseMediaMode;
  mediaType: BotGroupAutoResponseMedia["mediaType"];
  mediaUrl: string;
  mediaCaption: string;
  mediaPath: string;
  mediaFileName: string;
  mediaMimeType: string;
  mediaFile: File | null;
  includeVcard: boolean;
  vcardName: string;
  vcardPhone: string;
  vcardOrganization: string;
  vcardEmail: string;
  vcardCustom: string;
};

type WelcomeAttachment = NonNullable<BotGroupSettings["welcomeConfig"]["attachments"]>[number];

const MENU_TEXT_KEYS: MenuTextKey[] = [
  "main",
  "admin",
  "comandos",
  "outros",
  "downloads",
  "ativacoes",
  "jogos",
];

const MENU_TEXT_LABELS: Record<MenuTextKey, { title: string; description: string }> = {
  main: {
    title: "Menu principal",
    description: "Texto enviado quando o cliente chama pelo comando principal do bot.",
  },
  admin: {
    title: "Menu de administradores",
    description: "Conteúdo reservado para administradores com comandos avançados.",
  },
  comandos: {
    title: "Lista de comandos",
    description: "Resumo dos principais comandos disponíveis para todos os membros.",
  },
  outros: {
    title: "Outros menus",
    description: "Mensagem complementar com atalhos ou avisos gerais.",
  },
  downloads: {
    title: "Menu de downloads",
    description: "Lista de atalhos para baixar vídeos, áudios ou documentos.",
  },
  ativacoes: {
    title: "Menu de ativações",
    description: "Guia com ativações e automações que o bot consegue executar.",
  },
  jogos: {
    title: "Menu de jogos",
    description: "Entretenimento e jogos rápidos disponíveis para o grupo.",
  },
};

const DEFAULT_GROQ_MODEL = "qwen2.5:7b";
const DEFAULT_GROQ_MODEL_OPTIONS: Array<{ id: string; description: string }> = [
  { id: "qwen2.5:7b", description: "Qwen 2.5 7B local com tools" },
  { id: "mannix/llama3.1-8b-abliterated:tools-q3_k_s", description: "Llama 3.1 8B abliterated uncensored com tools" },
  { id: "sales-human:7b", description: "Modelo StoreZap com tools" },
  { id: "qwen3-vl:8b", description: "Qwen 3 VL local com vision/tools" },
];

const normalizeMediaSrc = (url?: string | null, path?: string | null): string | null => {
  const normalizedUrl = (url ?? "").trim();
  if (normalizedUrl) {
    return normalizedUrl;
  }
  const normalizedPath = (path ?? "").trim();
  if (!normalizedPath) {
    return null;
  }
  return normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
};

const isImageMediaExt = (src: string) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(src);
const isVideoMediaExt = (src: string) => /\.(mp4|webm|mov|mkv|m4v)(\?.*)?$/i.test(src);
const isAudioMediaExt = (src: string) => /\.(mp3|ogg|m4a|opus|wav)(\?.*)?$/i.test(src);

const MediaPreview = ({
  src,
  kind,
  caption,
}: {
  src: string;
  kind?: "image" | "video" | "audio" | "document" | "sticker";
  caption?: string | null;
}) => {
  const inferredKind =
    kind || (isVideoMediaExt(src) ? "video" : isAudioMediaExt(src) ? "audio" : isImageMediaExt(src) ? "image" : "document");
  const boxStyle = { maxWidth: 180, maxHeight: 140, objectFit: "cover" as const };
  return (
    <div className="d-flex flex-column gap-1">
      {inferredKind === "video" ? (
        <video src={src} controls style={{ width: 180 }} />
      ) : inferredKind === "audio" ? (
        <audio src={src} controls />
      ) : inferredKind === "image" || inferredKind === "sticker" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Prévia" style={boxStyle} />
      ) : (
        <a href={src} target="_blank" rel="noreferrer" className="small">
          Abrir documento
        </a>
      )}
      {caption ? <small className="text-secondary">{caption}</small> : null}
    </div>
  );
};

const AI_VOICE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Automático (Laizza padrão)" },
  { value: "laizza", label: "laizza" },
  { value: "br004", label: "br004" },
  { value: "lhays", label: "lhays" },
  { value: "ludmilla", label: "ludmilla" },
  { value: "bueno", label: "bueno" },
  { value: "ivete", label: "ivete" },
  { value: "br003", label: "br003" },
  { value: "br001", label: "br001" },
  { value: "br002", label: "br002" },
  { value: "br005", label: "br005" },
];

const EMPTY_MENU_DRAFTS: Record<MenuTextKey, string> = MENU_TEXT_KEYS.reduce(
  (acc, key) => ({ ...acc, [key]: "" }),
  {} as Record<MenuTextKey, string>,
);

const EMPTY_MENU_DIRTY: Record<MenuTextKey, boolean> = MENU_TEXT_KEYS.reduce(
  (acc, key) => ({ ...acc, [key]: false }),
  {} as Record<MenuTextKey, boolean>,
);

const AUTO_RESPONSE_LIMIT = 50;

const AUTO_RESPONSE_MEDIA_OPTIONS: Array<{
  value: BotGroupAutoResponseMedia["mediaType"];
  label: string;
}> = [
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "audio", label: "Áudio" },
  { value: "document", label: "Documento" },
  { value: "sticker", label: "Figurinha" },
];

const AUTO_RESPONSE_MEDIA_LABELS = AUTO_RESPONSE_MEDIA_OPTIONS.reduce(
  (acc, option) => ({ ...acc, [option.value]: option.label }),
  {} as Record<BotGroupAutoResponseMedia["mediaType"], string>,
);

const generateAutoResponseId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `auto-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
};

const copyAutoResponses = (entries: BotGroupAutoResponse[] = []): BotGroupAutoResponse[] =>
  entries.map((entry) => ({
    ...entry,
    triggers: [...entry.triggers],
    responseMedia: entry.responseMedia
      ? { ...entry.responseMedia }
      : null,
    responseVcard: entry.responseVcard
      ? { ...entry.responseVcard }
      : null,
  }));

const buildAutoResponsesFromSettings = (
  settings?: BotGroupSettings,
): BotGroupAutoResponse[] => copyAutoResponses(settings?.autoResponses ?? []);

async function uploadAutoResponseMediaRequest(
  groupId: number,
  file: File,
  options: { mediaType: BotGroupAutoResponseMedia["mediaType"]; previousPath?: string | null },
): Promise<{ path: string; mimeType: string | null; fileName: string | null }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mediaType", options.mediaType);
  if (options.previousPath) {
    formData.append("previousPath", options.previousPath);
  }

  const response = await fetch(`/api/bot-groups/${groupId}/auto-responses/upload`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof data.message === "string" ? data.message : "Não foi possível enviar a mídia da autoresposta.",
    );
  }

  const media = (data.media ?? data.result ?? {}) as Record<string, unknown>;
  const path = typeof media.path === "string" ? media.path.trim() : "";

  if (!path) {
    throw new Error("Retorno inválido ao salvar a mídia da autoresposta.");
  }

  const mimeType = typeof media.mimeType === "string" ? media.mimeType : null;
  const fileName = typeof media.fileName === "string" ? media.fileName : null;

  return { path, mimeType, fileName };
}

const cloneAutoResponses = (
  draft?: BotGroupAutoResponse[],
  settings?: BotGroupSettings,
): BotGroupAutoResponse[] => {
  if (draft) {
    return copyAutoResponses(draft);
  }
  return buildAutoResponsesFromSettings(settings);
};

const sanitizeAutoResponseMedia = (
  media: BotGroupAutoResponseMedia | null,
): BotGroupAutoResponseMedia | null => {
  if (!media) {
    return null;
  }

  const mediaType: BotGroupAutoResponseMedia["mediaType"] =
    media.mediaType && ["image", "video", "audio", "document", "sticker"].includes(media.mediaType)
      ? media.mediaType
      : "document";
  const path = media.path?.trim() ?? "";
  const url = media.url?.trim() ?? "";

  if (!path && !url) {
    return null;
  }

  return {
    mediaType,
    path: path || null,
    url: url || null,
    fileName: media.fileName?.trim() || null,
    mimeType: media.mimeType?.trim() || null,
    caption: media.caption?.trim() || null,
  };
};

const sanitizeAutoResponseVcard = (
  card: BotGroupAutoResponseVcard | null,
): BotGroupAutoResponseVcard | null => {
  if (!card) {
    return null;
  }
  const vcard = card.vcard.replace(/\r\n/g, "\n").trim();
  if (!vcard) {
    return null;
  }

  const name = card.name?.trim() || "";
  const phone = card.phone?.trim() || null;
  const organization = card.organization?.trim() || null;
  const email = card.email?.trim() || null;

  return {
    name: name || phone || "Contato",
    phone,
    organization,
    email,
    vcard,
  };
};

const sanitizeAutoResponses = (
  entries: BotGroupAutoResponse[],
): BotGroupAutoResponse[] => {
  const seenIds = new Set<string>();

  return entries
    .map((entry) => {
      const createdAt =
        typeof entry.createdAt === "string" && entry.createdAt.trim().length > 0
          ? entry.createdAt
          : new Date().toISOString();
      const updatedAt =
        typeof entry.updatedAt === "string" && entry.updatedAt.trim().length > 0
          ? entry.updatedAt
          : createdAt;
      const triggers = entry.triggers
        .map((trigger) => trigger.trim().toLowerCase())
        .filter((trigger, index, array) => trigger.length > 0 && array.indexOf(trigger) === index);
      const responseText = entry.responseText.trim();
      const responseMedia = sanitizeAutoResponseMedia(entry.responseMedia);
      const responseVcard = sanitizeAutoResponseVcard(entry.responseVcard);

      if (triggers.length === 0) {
        return null;
      }

      if (!responseText && !responseMedia && !responseVcard) {
        return null;
      }

      return {
        ...entry,
        id: entry.id,
        triggers,
        responseText,
        responseMedia,
        responseVcard,
        matchMode: entry.matchMode === "contains" ? "contains" : "equals",
        createdAt,
        updatedAt,
      } satisfies BotGroupAutoResponse;
    })
    .filter((entry): entry is BotGroupAutoResponse => Boolean(entry))
    .filter((entry) => {
      if (seenIds.has(entry.id)) {
        return false;
      }
      seenIds.add(entry.id);
      return true;
    })
    .slice(0, AUTO_RESPONSE_LIMIT);
};

type GroupMiniViewOption = {
  key: GroupMiniViewKey;
  label: string;
  description: string;
  icon: ReactNode;
  variant: NonNullable<ButtonProps["variant"]>;
  outlineVariant?: NonNullable<ButtonProps["variant"]>;
};

type WelcomeReplyButtonsFormProps = {
  groupId: number;
  template?: BotGroupWelcomeButtonTemplate | null;
  disabled?: boolean;
  onSave: (template: BotGroupWelcomeButtonTemplate | null) => Promise<boolean>;
  onFeedback: (feedback: Feedback) => void;
};

const WelcomeReplyButtonsForm = ({
  groupId,
  template,
  disabled,
  onSave,
  onFeedback,
}: WelcomeReplyButtonsFormProps) => {
  const [enabled, setEnabled] = useState(Boolean(template?.enabled));
  const [position, setPosition] = useState<BotGroupWelcomeButtonTemplate["position"]>(
    template?.position ?? "before_attachments",
  );
  const [body, setBody] = useState(template?.body ?? "");
  const [footer, setFooter] = useState(template?.footer ?? "");
  const [buttons, setButtons] = useState<BotGroupWelcomeReplyButton[]>(
    template?.buttons ? template.buttons.map((btn) => ({ ...btn })) : [],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(Boolean(template?.enabled));
    setPosition(template?.position ?? "before_attachments");
    setBody(template?.body ?? "");
    setFooter(template?.footer ?? "");
    setButtons(template?.buttons ? template.buttons.map((btn) => ({ ...btn })) : []);
  }, [groupId, template]);

  const addButton = () => {
    if (buttons.length >= 3) {
      return;
    }
    setButtons((prev) => [
      ...prev,
      {
        id: `btn_${Date.now()}`,
        label: "",
        type: "quick_reply",
        command: "",
        args: "",
        url: "",
        phoneNumber: "",
        copyCode: "",
      },
    ]);
  };

  const updateButton = (
    index: number,
    patch: Partial<BotGroupWelcomeReplyButton>,
  ) => {
    setButtons((prev) =>
      prev.map((btn, idx) => (idx === index ? { ...btn, ...patch } : btn)),
    );
  };

  const removeButton = (index: number) => {
    setButtons((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      if (!enabled) {
        const ok = await onSave(null);
        if (ok) {
          onFeedback({ type: "success", message: "Botões de boas-vindas desativados." });
        }
        return;
      }
      const sanitizedButtons =
        buttons
          .map((btn, index) => ({
            id: (btn.id || `btn_${index + 1}`).trim(),
            label: (btn.label || "").trim(),
            type: btn.type ?? "quick_reply",
            command: (btn.command || "").trim(),
            args: btn.args?.trim() || undefined,
            url: btn.url?.trim() || undefined,
            phoneNumber: btn.phoneNumber?.trim() || undefined,
            copyCode: btn.copyCode?.trim() || undefined,
          }))
          .filter((btn) => {
            if (!btn.id || !btn.label) {
              return false;
            }
            if (btn.type === "cta_url") {
              return Boolean(btn.url);
            }
            if (btn.type === "cta_call") {
              return Boolean(btn.phoneNumber);
            }
            if (btn.type === "cta_copy") {
              return Boolean(btn.copyCode);
            }
            return Boolean(btn.command);
          })
          .slice(0, 3) ?? [];
      if (sanitizedButtons.length === 0) {
        throw new Error("Adicione pelo menos um botão válido.");
      }
      const payload: BotGroupWelcomeButtonTemplate = {
        enabled: true,
        position,
        body: body || "",
        footer: footer?.trim() || null,
        buttons: sanitizedButtons,
        updatedAt: new Date().toISOString(),
      };
      const ok = await onSave(payload);
      if (ok) {
        onFeedback({ type: "success", message: "Botões de boas-vindas atualizados." });
      }
    } catch (error) {
      onFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao salvar os botões.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border rounded p-3 d-flex flex-column gap-3">
      <div className="d-flex flex-column gap-2">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <strong>Botões da mensagem de boas-vindas</strong>
            <div className="text-secondary small">
              Use respostas rápidas, botões de link, ligação ou copiar texto no disparo de boas-vindas.
            </div>
          </div>
          <Form.Check
            type="switch"
            id="welcome-reply-buttons-toggle"
            label={enabled ? "Ativo" : "Inativo"}
            checked={enabled}
            disabled={disabled || saving}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </div>
        {disabled ? (
          <Alert variant="warning" className="mb-0">
            Ative os botões nativos no painel Admin &gt; Instâncias para editar esta seção.
          </Alert>
        ) : null}
      </div>
      <Form.Group controlId="welcome-reply-buttons-body">
        <Form.Label>Mensagem principal</Form.Label>
        <Form.Control
          as="textarea"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Bem-vindo ao grupo {{nomeGrupo}}!"
          disabled={disabled || saving || !enabled}
        />
        <Form.Text className="text-secondary">
          Aceita variáveis como <code>{"{{numero}}"}</code>, <code>{"{{nomeGrupo}}"}</code> ou{" "}
          <code>{"{{prefixo}}"}</code>.
        </Form.Text>
      </Form.Group>
      <Form.Group controlId="welcome-reply-buttons-footer">
        <Form.Label>Rodapé (opcional)</Form.Label>
        <Form.Control
          type="text"
          value={footer}
          onChange={(event) => setFooter(event.target.value)}
          placeholder="Selecione uma opção abaixo"
          disabled={disabled || saving || !enabled}
        />
      </Form.Group>
      <Form.Group controlId="welcome-reply-buttons-position">
        <Form.Label>Posição dos botões no fluxo</Form.Label>
        <Form.Select
          value={position ?? "before_attachments"}
          onChange={(event) =>
            setPosition(event.target.value as BotGroupWelcomeButtonTemplate["position"])
          }
          disabled={disabled || saving || !enabled}
        >
          <option value="before_attachments">Enviar botões antes dos anexos restantes</option>
          <option value="after_attachments">Enviar anexos primeiro e botões no final</option>
        </Form.Select>
        <Form.Text className="text-secondary">
          Para enviar um áudio primeiro, deixe o áudio como primeiro anexo e selecione a segunda opção.
        </Form.Text>
      </Form.Group>
      <div className="d-flex flex-column gap-2">
        <div className="d-flex align-items-center justify-content-between">
          <Form.Label className="mb-0">Botões</Form.Label>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={addButton}
            disabled={disabled || saving || !enabled || buttons.length >= 3}
          >
            Adicionar botão
          </Button>
        </div>
        {buttons.length === 0 ? (
          <small className="text-secondary">Nenhum botão configurado.</small>
        ) : (
          <div className="d-flex flex-column gap-2">
            {buttons.map((btn, index) => (
              <div key={btn.id || index} className="border rounded p-2 d-flex flex-column gap-2">
                <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between">
                  <strong>Botão #{index + 1}</strong>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => removeButton(index)}
                    disabled={disabled || saving || !enabled}
                  >
                    Remover
                  </Button>
                </div>
                <Form.Control
                  type="text"
                  placeholder="Texto exibido (ex.: Baixar MP3)"
                  value={btn.label ?? ""}
                  onChange={(event) => updateButton(index, { label: event.target.value })}
                  disabled={disabled || saving || !enabled}
                />
                <Form.Select
                  value={btn.type ?? "quick_reply"}
                  onChange={(event) =>
                    updateButton(index, {
                      type: event.target.value as BotGroupWelcomeReplyButton["type"],
                    })
                  }
                  disabled={disabled || saving || !enabled}
                >
                  <option value="quick_reply">Resposta rápida / comando</option>
                  <option value="cta_url">Abrir link</option>
                  <option value="cta_call">Ligar</option>
                  <option value="cta_copy">Copiar texto</option>
                </Form.Select>
                {(btn.type ?? "quick_reply") === "quick_reply" ? (
                  <>
                    <Form.Control
                      type="text"
                      placeholder="Comando (ex.: ytmp3)"
                      value={btn.command ?? ""}
                      onChange={(event) => updateButton(index, { command: event.target.value })}
                      disabled={disabled || saving || !enabled}
                    />
                    <Form.Control
                      type="text"
                      placeholder="Argumentos padrão (ex.: {{numero}})"
                      value={btn.args ?? ""}
                      onChange={(event) => updateButton(index, { args: event.target.value })}
                      disabled={disabled || saving || !enabled}
                    />
                  </>
                ) : null}
                {btn.type === "cta_url" ? (
                  <Form.Control
                    type="url"
                    placeholder="https://botadmin.shop"
                    value={btn.url ?? ""}
                    onChange={(event) => updateButton(index, { url: event.target.value })}
                    disabled={disabled || saving || !enabled}
                  />
                ) : null}
                {btn.type === "cta_call" ? (
                  <Form.Control
                    type="text"
                    placeholder="+5599999999999"
                    value={btn.phoneNumber ?? ""}
                    onChange={(event) => updateButton(index, { phoneNumber: event.target.value })}
                    disabled={disabled || saving || !enabled}
                  />
                ) : null}
                {btn.type === "cta_copy" ? (
                  <Form.Control
                    type="text"
                    placeholder="Texto que será copiado"
                    value={btn.copyCode ?? ""}
                    onChange={(event) => updateButton(index, { copyCode: event.target.value })}
                    disabled={disabled || saving || !enabled}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="d-flex justify-content-end">
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={disabled || saving || !enabled}
        >
          {saving ? (
            <span className="d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" role="status" /> Salvando...
            </span>
          ) : (
            "Salvar botões"
          )}
        </Button>
      </div>
    </div>
  );
};

type BroadcastComposerProps = {
  group: BotGroup;
  settings: BotGroupSettings;
  nativeButtonsAvailable: boolean;
  onReloadSettings: (groupId: number) => Promise<void> | void;
  onFeedback: (feedback: Feedback) => void;
  restApiKey: string;
};

type BroadcastComposerState = {
  type: BotGroupBroadcastTemplate["type"];
  title: string;
  body: string;
  footer: string;
  mediaType: BotGroupBroadcastTemplate["mediaType"];
  mediaUrl: string;
  mediaPath: string | null;
  headerMediaUrl: string;
  headerMediaPath: string | null;
  buttons: BotGroupWelcomeReplyButton[];
  ctaButtons: BotGroupCtaButton[];
  mentionAll: boolean;
  mentionText: string;
};

const resolveDefaultBroadcastUrl = () => {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_CAP_SERVER_URL,
    process.env.NEXT_PUBLIC_DASHBOARD_URL,
  ];
  for (const raw of candidates) {
    if (typeof raw === "string" && raw.trim()) {
      const value = raw.trim();
      return /^https?:\/\//i.test(value) ? value : `https://${value}`;
    }
  }
  return "https://botadmin.shop";
};

const BROADCAST_DEFAULT_BODY = "Olá! Escolha uma opção abaixo para continuar.";
const BROADCAST_DEFAULT_FOOTER = "Selecione uma opção para receber o próximo passo.";
const BROADCAST_DEFAULT_TITLE = "Temos uma novidade para você";
const BROADCAST_DEFAULT_REPLY_BUTTONS: BotGroupWelcomeReplyButton[] = [
  { id: "cmd_menu", label: "Ver catálogo", command: "menu" },
  { id: "cmd_status", label: "Status do pedido", command: "status" },
  { id: "cmd_commands", label: "Lista de comandos", command: "comandos" },
];
const BROADCAST_DEFAULT_CTA_BUTTONS: BotGroupCtaButton[] = [
  {
    id: "cta_site",
    text: "Abrir painel",
    type: "cta_url",
    url: resolveDefaultBroadcastUrl(),
  },
];

const normalizeMentionValueForStorage = (value: string): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("@")) {
    const digits = trimmed.replace(/@.+$/, "").replace(/\D+/g, "");
    return digits.length > 4 ? digits : null;
  }
  const digits = trimmed.replace(/\D+/g, "");
  return digits.length > 4 ? digits : null;
};

const normalizeMentionJid = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("@")) {
    return trimmed.includes("@s.whatsapp.net") ? trimmed : `${trimmed.replace(/@.+$/, "")}@s.whatsapp.net`;
  }
  const digits = trimmed.replace(/\D+/g, "");
  if (!digits) {
    return null;
  }
  return `${digits}@s.whatsapp.net`;
};

const normalizeMentionListDraft = (value: string): string[] => {
  const tokens = value
    .split(/[\r\n,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const sanitized = tokens
    .map((entry) => normalizeMentionValueForStorage(entry))
    .filter((entry): entry is string => Boolean(entry));
  return Array.from(new Set(sanitized));
};

const guessMediaTypeFromUrl = (value: string): BroadcastComposerState["mediaType"] => {
  const normalized = value.toLowerCase();
  if (/\.(mp3|m4a|aac|wav|flac|ogg)(\?|$)/.test(normalized)) {
    return "audio";
  }
  if (/\.(mp4|m4v|webm|mov|mkv)(\?|$)/.test(normalized)) {
    return "video";
  }
  if (/\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?)(\?|$)/.test(normalized)) {
    return "document";
  }
  return "image";
};

type LinkResolverState = {
  processing: boolean;
  message: string | null;
  error: string | null;
  lastUrl: string | null;
  preview: {
    provider?: "tiktok" | "pinterest" | "rest";
    kind: "image" | "video" | "audio" | "document";
    url?: string | null;
    thumbnail?: string | null;
    title?: string | null;
  } | null;
};

const createLinkResolverState = (): Record<"media" | "header", LinkResolverState> => ({
  media: { processing: false, message: null, error: null, lastUrl: null, preview: null },
  header: { processing: false, message: null, error: null, lastUrl: null, preview: null },
});

type AutoResolvedMedia = {
  url: string | null;
  mediaType?: BroadcastComposerState["mediaType"];
  thumbnail?: string | null;
  title?: string | null;
  durationSeconds?: number | null;
  message?: string | null;
};

const guessMediaTypeFromDescriptor = (
  value?: string | null,
): BroadcastComposerState["mediaType"] | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (/audio|mp3|m4a|aac|song|voz|fala/.test(normalized)) {
    return "audio";
  }
  if (/video|mp4|mkv|reel|movie|clip/.test(normalized)) {
    return "video";
  }
  if (/pdf|doc|docx|zip|rar|ppt|xls|arquivo|document/.test(normalized)) {
    return "document";
  }
  if (/image|img|jpg|jpeg|png|photo|picture|sticker|gif/.test(normalized)) {
    return "image";
  }
  return undefined;
};

const TIKTOK_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:tiktok\.com|vm\.tiktok\.com)/i;
const PINTEREST_URL_REGEX = /(?:https?:\/\/)?(?:[a-z]+\.)?(?:pinterest\.com|pin\.it|pinimg\.com)/i;

const detectMediaLinkProvider = (value?: string | null): "tiktok" | "pinterest" | null => {
  if (!value) {
    return null;
  }
  if (TIKTOK_URL_REGEX.test(value)) {
    return "tiktok";
  }
  if (PINTEREST_URL_REGEX.test(value)) {
    return "pinterest";
  }
  return null;
};

const collectUrlsFromEntry = (entry: unknown, bucket: Set<string>, depth = 0) => {
  if (depth > 3 || !entry) {
    return;
  }
  const push = (value?: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      return;
    }
    bucket.add(trimmed);
  };
  if (typeof entry === "string") {
    push(entry);
    return;
  }
  if (Array.isArray(entry)) {
    entry.forEach((item) => collectUrlsFromEntry(item, bucket, depth + 1));
    return;
  }
  if (typeof entry !== "object") {
    return;
  }
  const record = entry as Record<string, unknown>;
  push(record.url);
  push(record.downloadUrl);
  push(record.download_url);
  push(record.href);
  push(record.link);
  push(record.src);
  push(record.directUrl);
  push(record.direct_url);
  push(record.video_url);
  push(record.audio_url);
  push(record.mediaUrl);
  push(record.fileUrl);
  const nestedKeys = [
    "url",
    "urls",
    "downloadUrl",
    "download_url",
    "download",
    "downloads",
    "items",
    "sources",
    "list",
    "medias",
    "files",
    "media",
    "data",
    "metadata",
    "result",
  ];
  for (const key of nestedKeys) {
    if (record[key]) {
      collectUrlsFromEntry(record[key], bucket, depth + 1);
    }
  }
};

const normalizeAutoResolvedMedia = (payload: any): AutoResolvedMedia => {
  if (!payload || typeof payload !== "object") {
    return { url: null };
  }
  const urls = new Set<string>();
  collectUrlsFromEntry(payload, urls);
  const url = urls.size > 0 ? Array.from(urls)[0] : null;

  const descriptorSources: Array<string | null | undefined> = [
    typeof payload.format === "string" ? payload.format : null,
    typeof payload.type === "string" ? payload.type : null,
    typeof payload.kind === "string" ? payload.kind : null,
    typeof payload.mediaType === "string" ? payload.mediaType : null,
    typeof payload.contentType === "string" ? payload.contentType : null,
    typeof payload.resultType === "string" ? payload.resultType : null,
    typeof payload.mimeType === "string" ? payload.mimeType : null,
  ];
  const downloads = Array.isArray(payload.downloads) ? payload.downloads : null;
  if (downloads?.length) {
    const first = downloads[0];
    if (typeof first?.type === "string") descriptorSources.push(first.type);
    if (typeof first?.format === "string") descriptorSources.push(first.format);
    if (typeof first?.mimeType === "string") descriptorSources.push(first.mimeType);
  }
  if (payload.metadata && typeof payload.metadata === "object") {
    const meta = payload.metadata as Record<string, unknown>;
    if (typeof meta.format === "string") descriptorSources.push(meta.format);
    if (typeof meta.type === "string") descriptorSources.push(meta.type);
    if (typeof meta.mediaType === "string") descriptorSources.push(meta.mediaType);
    if (typeof meta.mimeType === "string") descriptorSources.push(meta.mimeType as string);
  }
  let mediaType: BroadcastComposerState["mediaType"] | undefined;
  for (const descriptor of descriptorSources) {
    mediaType = guessMediaTypeFromDescriptor(descriptor ?? undefined);
    if (mediaType) {
      break;
    }
  }
  if (!mediaType && url) {
    mediaType = guessMediaTypeFromUrl(url);
  }

  let title =
    (typeof payload.title === "string" && payload.title) ||
    (typeof payload.caption === "string" && payload.caption) ||
    (typeof payload.description === "string" && payload.description) ||
    null;
  let thumbnail =
    (typeof payload.thumbnail === "string" && payload.thumbnail) ||
    (typeof payload.poster === "string" && payload.poster) ||
    (typeof payload.thumb === "string" && payload.thumb) ||
    null;
  let durationSecondsRaw: unknown =
    typeof payload.durationSeconds === "number"
      ? payload.durationSeconds
      : typeof payload.duration === "number"
        ? payload.duration
        : null;
  if (payload.metadata && typeof payload.metadata === "object") {
    const meta = payload.metadata as Record<string, unknown>;
    if (!title && typeof meta.title === "string") {
      title = meta.title;
    }
    if (!title && typeof meta.caption === "string") {
      title = meta.caption;
    }
    if (!title && typeof meta.description === "string") {
      title = meta.description;
    }
    if (!thumbnail && typeof meta.thumbnail === "string") {
      thumbnail = meta.thumbnail;
    }
    if (!thumbnail && typeof meta.poster === "string") {
      thumbnail = meta.poster;
    }
    if (!thumbnail && typeof meta.thumb === "string") {
      thumbnail = meta.thumb;
    }
    if (durationSecondsRaw === null || durationSecondsRaw === undefined) {
      durationSecondsRaw =
        typeof meta.durationSeconds === "number"
          ? meta.durationSeconds
          : typeof meta.duration === "number"
            ? meta.duration
            : null;
    }
  }

  const durationSeconds =
    typeof durationSecondsRaw === "number" && Number.isFinite(durationSecondsRaw)
      ? durationSecondsRaw
      : null;

  let message: string | null = null;
  if (title) {
    message = `Mídia encontrada: ${title}`;
  } else if (mediaType) {
    message =
      mediaType === "video"
        ? "Link resolvido como vídeo."
        : mediaType === "audio"
          ? "Link resolvido como áudio."
          : mediaType === "document"
            ? "Arquivo pronto para envio."
            : "Imagem pronta para envio.";
  }

  return {
    url,
    mediaType,
    thumbnail,
    title,
    durationSeconds,
    message,
  };
};

const buildBroadcastState = (
  template?: BotGroupBroadcastTemplate | null,
): BroadcastComposerState => ({
  type: template?.type ?? "text",
  title:
    typeof template?.title === "string" && template.title.trim().length > 0
      ? template.title
      : BROADCAST_DEFAULT_TITLE,
  body:
    typeof template?.body === "string" && template.body.trim().length > 0
      ? template.body
      : BROADCAST_DEFAULT_BODY,
  footer:
    typeof template?.footer === "string" && template.footer.trim().length > 0
      ? template.footer
      : BROADCAST_DEFAULT_FOOTER,
  mediaType: template?.mediaType ?? "image",
  mediaUrl: template?.mediaUrl ?? "",
  mediaPath: template?.mediaPath ?? null,
  headerMediaUrl: template?.headerMediaUrl ?? "",
  headerMediaPath: template?.headerMediaPath ?? null,
  mentionAll: Boolean(template?.mentionAll),
  mentionText: Array.isArray(template?.mentionList) ? template!.mentionList!.join("\n") : "",
  buttons:
    template?.buttons && template.buttons.length > 0
      ? template.buttons.map((btn) => ({ ...btn }))
      : BROADCAST_DEFAULT_REPLY_BUTTONS.map((btn) => ({ ...btn })),
  ctaButtons:
    template?.ctaButtons && template.ctaButtons.length > 0
      ? template.ctaButtons.map((btn) => ({ ...btn }))
      : BROADCAST_DEFAULT_CTA_BUTTONS.map((btn) => ({ ...btn })),
});

const BroadcastComposer = ({
  group,
  settings,
  nativeButtonsAvailable,
  onReloadSettings,
  onFeedback,
  restApiKey,
}: BroadcastComposerProps) => {
  const [form, setForm] = useState<BroadcastComposerState>(() =>
    buildBroadcastState(settings.lastBroadcastTemplate),
  );
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<"media" | "header" | null>(null);
  const [linkResolver, setLinkResolver] = useState(createLinkResolverState());
  const [resolvedLinks, setResolvedLinks] = useState<
    Record<"media" | "header", { url: string; mediaType?: BroadcastComposerState["mediaType"] } | null>
  >({
    media: null,
    header: null,
  });
  const resetLinkResolvers = useCallback(() => {
    setLinkResolver(createLinkResolverState());
    setResolvedLinks({ media: null, header: null });
  }, [setLinkResolver]);
  const applyGuessedMediaType = useCallback(
    (source: "media" | "header", url: string) => {
      const guessed = url ? guessMediaTypeFromUrl(url) : null;
      if (!guessed) {
        return;
      }
      setForm((prev) => {
        if (source === "media" && prev.type === "media" && prev.mediaType !== guessed) {
          return { ...prev, mediaType: guessed };
        }
        if (
          source === "header" &&
          (prev.type === "button_reply" || prev.type === "button_cta") &&
          prev.mediaType !== guessed
        ) {
          return { ...prev, mediaType: guessed };
        }
        return prev;
      });
    },
    [setForm],
  );
  const clearResolverStateForTarget = useCallback(
    (target: "media" | "header", nextValue: string) => {
      const trimmed = (nextValue || "").trim();
      setLinkResolver((prev) => {
        const current = prev[target];
        if (!current.processing && !current.message && !current.error && !current.preview) {
          return prev;
        }
        if (current.lastUrl === trimmed) {
          return prev;
        }
        return {
          ...prev,
          [target]: {
            processing: false,
            message: null,
            error: null,
            lastUrl: trimmed || null,
            preview: null,
          },
        };
      });
      setResolvedLinks((prev) => ({ ...prev, [target]: null }));
    },
    [setLinkResolver],
  );
  const allowedTypes = useMemo<BroadcastComposerState["type"][]>(
    () =>
      nativeButtonsAvailable
        ? ["text", "media", "button_reply", "button_cta"]
        : ["text", "media"],
    [nativeButtonsAvailable],
  );

  useEffect(() => {
    setForm(() => {
      const next = buildBroadcastState(settings.lastBroadcastTemplate);
      if (!nativeButtonsAvailable && (next.type === "button_reply" || next.type === "button_cta")) {
        return { ...next, type: "text" };
      }
      return next;
    });
    resetLinkResolvers();
  }, [group.id, settings.lastBroadcastTemplate, nativeButtonsAvailable, resetLinkResolvers]);

  const handleFieldChange = <K extends keyof BroadcastComposerState>(
    key: K,
    value: BroadcastComposerState[K],
  ) => {
    setForm((prev) => {
      let next: BroadcastComposerState = { ...prev, [key]: value };
      if (key === "type") {
        const nextType = value as BroadcastComposerState["type"];
        if (nextType === "button_reply") {
          next = {
            ...next,
            mediaUrl: "",
            mediaPath: null,
            buttons:
              next.buttons.length > 0
                ? next.buttons
                : BROADCAST_DEFAULT_REPLY_BUTTONS.map((btn) => ({ ...btn })),
            title: next.title || BROADCAST_DEFAULT_TITLE,
          };
        } else if (nextType === "button_cta") {
          next = {
            ...next,
            ctaButtons:
              next.ctaButtons.length > 0
                ? next.ctaButtons
                : BROADCAST_DEFAULT_CTA_BUTTONS.map((btn) => ({ ...btn })),
            title: next.title || BROADCAST_DEFAULT_TITLE,
          };
        }
      }
      return next;
    });
    if (key === "mediaUrl" && typeof value === "string") {
      clearResolverStateForTarget("media", value);
      applyGuessedMediaType("media", value);
    } else if (key === "headerMediaUrl" && typeof value === "string") {
      clearResolverStateForTarget("header", value);
      applyGuessedMediaType("header", value);
    }
  };

  const handleUpload = async (file: File, target: "media" | "header") => {
    setUploading(target);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mediaType", target === "media" ? form.mediaType ?? "image" : "image");
      if (target === "media" && form.mediaPath) {
        formData.append("previousPath", form.mediaPath);
      }
      if (target === "header" && form.headerMediaPath) {
        formData.append("previousPath", form.headerMediaPath);
      }
      const response = await fetch(`/api/bot-groups/${group.id}/broadcast/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string" ? data.message : "Falha ao enviar o arquivo.",
        );
      }
      const uploaded = data.media as { path?: string; url?: string };
      if (target === "media") {
        setForm((prev) => ({
          ...prev,
          mediaPath: uploaded?.path ?? prev.mediaPath,
          mediaUrl: uploaded?.url ?? prev.mediaUrl,
        }));
        clearResolverStateForTarget("media", uploaded?.url ?? "");
      } else {
        setForm((prev) => ({
          ...prev,
          headerMediaPath: uploaded?.path ?? prev.headerMediaPath,
          headerMediaUrl: uploaded?.url ?? prev.headerMediaUrl,
        }));
        clearResolverStateForTarget("header", uploaded?.url ?? "");
      }
    } catch (error) {
      onFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível enviar o arquivo.",
      });
    } finally {
      setUploading(null);
    }
  };

  const removeMedia = (target: "media" | "header") => {
    setForm((prev) =>
      target === "media"
        ? { ...prev, mediaUrl: "", mediaPath: null }
        : { ...prev, headerMediaUrl: "", headerMediaPath: null },
    );
    clearResolverStateForTarget(target, "");
  };

  const applyResolvedLink = (
    target: "media" | "header",
    resolved: Pick<AutoResolvedMedia, "url" | "mediaType" | "thumbnail" | "title">,
    options: { provider: LinkResolverState["preview"]["provider"]; message: string; lastUrl: string },
  ) => {
    const resolvedUrl = (resolved.url ?? "").trim();
    const resolvedType =
      resolved.mediaType ??
      guessMediaTypeFromDescriptor(resolved.title ?? null) ??
      guessMediaTypeFromUrl(
        resolvedUrl || (target === "media" ? linkResolver.media.lastUrl : linkResolver.header.lastUrl) || "",
      );

    setResolvedLinks((prev) => ({
      ...prev,
      [target]: resolvedUrl ? { url: resolvedUrl, mediaType: resolvedType ?? undefined } : null,
    }));

    if (resolvedType) {
      applyGuessedMediaType(target === "media" ? "media" : "header", resolvedUrl);
    }

    setLinkResolver((prev) => ({
      ...prev,
      [target]: {
        processing: false,
        error: null,
        message: options.message,
        lastUrl: options.lastUrl,
        preview: {
          provider: options.provider,
          kind: resolvedType ?? "image",
          url: resolvedUrl || null,
          thumbnail: resolved.thumbnail ?? resolvedUrl ?? null,
          title: resolved.title ?? null,
        },
      },
    }));
  };

  const setResolverError = (target: "media" | "header", error: string, lastUrl: string | null) => {
    setLinkResolver((prev) => ({
      ...prev,
      [target]: {
        processing: false,
        error,
        message: null,
        lastUrl,
        preview: lastUrl === prev[target].lastUrl ? prev[target].preview : null,
      },
    }));
    setResolvedLinks((prev) => ({ ...prev, [target]: null }));
  };

  const resolveWithRestAuto = async (target: "media" | "header", trimmed: string) => {
    if (!restApiKey) {
      setResolverError(
        target,
        "Gere uma chave de API REST em Configurações antes de resolver links automaticamente.",
        null,
      );
      return;
    }
    setLinkResolver((prev) => ({
      ...prev,
      [target]: {
        processing: true,
        error: null,
        message: "Resolvendo o link informado...",
        lastUrl: trimmed,
        preview: prev[target].preview,
      },
    }));
    const response = await fetch(`/api/rest/auto?url=${encodeURIComponent(trimmed)}`, {
      headers: {
        accept: "application/json",
        "x-api-key": restApiKey,
      },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.status === false) {
      throw new Error(typeof data?.mensagem === "string" ? data.mensagem : "Falha ao resolver o link.");
    }
    const payload = data?.resultado ?? data;
    const resolved = normalizeAutoResolvedMedia(payload);
    if (!resolved.url) {
      throw new Error("Nenhuma mídia direta foi encontrada para este link.");
    }
    applyResolvedLink(target, resolved, {
      provider: "rest",
      message: resolved.message ?? "Link resolvido com sucesso.",
      lastUrl: resolved.url,
    });
  };

  const resolveTikTokLink = async (target: "media" | "header", link: string) => {
    setLinkResolver((prev) => ({
      ...prev,
      [target]: {
        processing: true,
        error: null,
        message: "Processando prévia do TikTok...",
        lastUrl: prev[target].lastUrl ?? null,
        preview: prev[target].preview,
      },
    }));
    try {
      let data: any = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(`/api/tiktok/preview?url=${encodeURIComponent(link)}`, {
          cache: "no-store",
        });
        data = await response.json().catch(() => ({}));
        if (response.ok && data?.success) {
          break;
        }
        if (attempt === 2) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : "Não foi possível processar o link do TikTok.",
          );
        }
      }
      const normalized = data.normalized as
        | { type: "video"; url?: string | null; thumbnail?: string | null; title?: string | null }
        | { type: "images"; items?: string[]; title?: string | null };
      if (!normalized) {
        throw new Error("O link do TikTok não retornou mídias para visualização.");
      }
      const preview =
        normalized.type === "video"
          ? {
              url: normalized.url ?? link,
              mediaType: "video" as const,
              thumbnail: normalized.thumbnail ?? normalized.url ?? link,
              title: normalized.title ?? undefined,
            }
          : {
              url: Array.isArray(normalized.items) ? normalized.items[0] ?? link : link,
              mediaType: "image" as const,
              thumbnail: Array.isArray(normalized.items) ? normalized.items[0] ?? link : link,
              title: normalized.title ?? undefined,
            };
      applyResolvedLink(target, preview, {
        provider: "tiktok",
        message: "Link do TikTok processado para prévia.",
        lastUrl: link,
      });
    } catch (error) {
      setResolverError(
        target,
        error instanceof Error ? error.message : "Falha ao processar o link do TikTok.",
        link,
      );
    }
  };

  const resolvePinterestLink = async (target: "media" | "header", link: string) => {
    setLinkResolver((prev) => ({
      ...prev,
      [target]: {
        processing: true,
        error: null,
        message: "Processando prévia do Pinterest...",
        lastUrl: prev[target].lastUrl ?? null,
        preview: prev[target].preview,
      },
    }));
    try {
      let data: any = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(`/api/pinterest/preview?url=${encodeURIComponent(link)}`, {
          cache: "no-store",
        });
        data = await response.json().catch(() => ({}));
        if (response.ok && data?.success) {
          break;
        }
        if (attempt === 2) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : "Não foi possível processar o link do Pinterest.",
          );
        }
      }
      const normalized = data.normalized as
        | { kind: "video"; url?: string | null; thumbnail?: string | null; title?: string | null }
        | { kind: "image"; url?: string | null; thumbnail?: string | null; title?: string | null };
      if (!normalized) {
        throw new Error("O link do Pinterest não retornou mídias para visualização.");
      }
      applyResolvedLink(
        target,
        {
          url: normalized.url ?? link,
          mediaType: normalized.kind,
          thumbnail: normalized.thumbnail ?? normalized.url ?? null,
          title: normalized.title ?? undefined,
        },
        {
          provider: "pinterest",
          message: "Link do Pinterest processado para prévia.",
          lastUrl: link,
        },
      );
    } catch (error) {
      setResolverError(
        target,
        error instanceof Error ? error.message : "Falha ao processar o link do Pinterest.",
        link,
      );
    }
  };

  const handleResolveLink = async (target: "media" | "header") => {
    const currentValue = target === "media" ? form.mediaUrl : form.headerMediaUrl;
    const trimmed = (currentValue || "").trim();
    if (!trimmed) {
      setResolverError(target, "Informe um link público antes de resolver.", null);
      return;
    }

    const provider = detectMediaLinkProvider(trimmed);
    try {
      if (provider === "tiktok") {
        await resolveTikTokLink(target, trimmed);
        return;
      }
      if (provider === "pinterest") {
        await resolvePinterestLink(target, trimmed);
        return;
      }
      await resolveWithRestAuto(target, trimmed);
    } catch (error) {
      setResolverError(
        target,
        error instanceof Error ? error.message : "Não foi possível resolver o link informado.",
        trimmed,
      );
    }
  };

  const renderLinkPreview = (target: "media" | "header") => {
    const preview = linkResolver[target].preview;
    if (!preview?.url) {
      return null;
    }
    return (
      <div className="border rounded p-2 d-flex align-items-center gap-3 bg-body-tertiary">
        {preview.thumbnail ? (
          <Image
            src={preview.thumbnail}
            alt={preview.title ?? "Prévia do link"}
            rounded
            style={{ width: 88, height: 88, objectFit: "cover" }}
          />
        ) : null}
        <div className="d-flex flex-column gap-1 flex-grow-1">
          <small className="text-secondary">
            Prévia {preview.provider ? `(${preview.provider})` : ""} · {preview.kind}
          </small>
          {preview.title ? <div className="fw-semibold small text-break">{preview.title}</div> : null}
          <small className="text-muted text-break">
            {preview.provider ? `Fonte: ${preview.provider}` : "Link resolvido"}
          </small>
        </div>
        {process.env.NODE_ENV === "development" ? (
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => preview.url && window.open(preview.url, "_blank", "noopener,noreferrer")}
            disabled={!preview.url}
          >
            Abrir
          </Button>
        ) : null}
      </div>
    );
  };

  const handleSend = async () => {
    if (sending) {
      return;
    }
    const guessedMediaType =
      form.mediaType ||
      (form.type === "media"
        ? guessMediaTypeFromUrl(form.mediaUrl)
        : guessMediaTypeFromUrl(form.headerMediaUrl));
    const resolvedMediaType = guessedMediaType || form.mediaType || undefined;
    if (form.type === "media" && !form.mediaUrl && !form.mediaPath) {
      onFeedback({
        type: "warning",
        message: "Adicione uma mídia ou informe uma URL para este disparo.",
      });
      return;
    }
    if (form.type === "button_reply" && form.buttons.length === 0) {
      onFeedback({
        type: "warning",
        message: "Informe pelo menos um botão reply.",
      });
      return;
    }
    if (form.type === "button_cta" && form.ctaButtons.length === 0) {
      onFeedback({
        type: "warning",
        message: "Informe pelo menos um botão CTA.",
      });
      return;
    }

    setSending(true);
    try {
      const mentionList = normalizeMentionListDraft(form.mentionText || "");
      const payload: Record<string, unknown> = {
        type: form.type,
        body: form.body,
        footer: form.footer,
        mentionAll: Boolean(form.mentionAll),
        mentionList,
      };
      if (resolvedMediaType) {
        payload.mediaType = resolvedMediaType;
      }
      if (form.type !== "button_reply") {
        payload.mediaUrl = (resolvedLinks.media?.url ?? form.mediaUrl) || null;
        payload.mediaPath = form.mediaPath;
      }
      if (form.type === "button_reply") {
        payload.title = form.title?.trim() || null;
        payload.headerMediaUrl = (resolvedLinks.header?.url ?? form.headerMediaUrl) || null;
        payload.headerMediaPath = form.headerMediaPath;
      }
      if (form.type === "button_reply") {
        payload.buttons = form.buttons
          .map((btn, index) => ({
            id: (btn.id || `btn_${index + 1}`).trim(),
            label: (btn.label || "").trim(),
            command: (btn.command || "").trim(),
            args: btn.args?.trim() || undefined,
          }))
          .filter((btn) => btn.id && btn.label && btn.command)
          .slice(0, 3);
      }
      if (form.type === "button_cta") {
        payload.title = form.title?.trim() || null;
        payload.headerMediaUrl = (resolvedLinks.header?.url ?? form.headerMediaUrl) || null;
        payload.headerMediaPath = form.headerMediaPath;
        payload.ctaButtons = form.ctaButtons
          .map((btn, index) => ({
            id: (btn.id || `cta_${index + 1}`).trim(),
            text: (btn.text || "").trim(),
            type: btn.type,
            url: btn.url?.trim() || undefined,
            phoneNumber: btn.phoneNumber?.trim() || undefined,
            copyCode: btn.copyCode?.trim() || undefined,
          }))
          .filter((btn) => btn.id && btn.text)
          .slice(0, 3);
      }

      const response = await fetch(`/api/bot-groups/${group.id}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.message === "string" ? data.message : "Falha no disparo.");
      }
      onFeedback({
        type: "success",
        message: typeof data.message === "string" ? data.message : "Mensagem enviada.",
      });
      await onReloadSettings(group.id);
    } catch (error) {
      onFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível enviar a mensagem.",
      });
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!allowedTypes.includes(form.type)) {
      setForm((prev) => ({ ...prev, type: "text" }));
    }
  }, [allowedTypes, form.type]);

  const lastTemplate = settings.lastBroadcastTemplate;
  const lastSentAt = lastTemplate?.updatedAt
    ? new Date(lastTemplate.updatedAt).toLocaleString("pt-BR")
    : null;

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex flex-wrap align-items-center gap-2 justify-content-between">
        <div className="d-flex flex-column">
          <Form.Label className="mb-0">Tipo de disparo</Form.Label>
          {!nativeButtonsAvailable ? (
            <small className="text-warning">
              Botões nativos estão desativados globalmente. Habilite-os no painel do administrador.
            </small>
          ) : null}
        </div>
        <div className="d-flex gap-2">
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() => {
              setForm(buildBroadcastState(settings.lastBroadcastTemplate));
              resetLinkResolvers();
            }}
            disabled={sending}
          >
            Restaurar último envio
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() => {
              setForm({
                type: "text",
                title: "",
                body: "",
                footer: "",
                mediaType: "image",
                mediaUrl: "",
                mediaPath: null,
                headerMediaUrl: "",
                headerMediaPath: null,
                buttons: [],
                ctaButtons: [],
                mentionAll: false,
                mentionText: "",
              });
              resetLinkResolvers();
            }}
            disabled={sending}
          >
            Limpar
          </Button>
        </div>
      </div>
      <Form.Select
        value={form.type}
        onChange={(event) => handleFieldChange("type", event.target.value as BroadcastComposerState["type"])}
        disabled={sending}
      >
        {allowedTypes.map((typeOption) => (
          <option key={typeOption} value={typeOption}>
            {typeOption === "text"
              ? "Texto"
              : typeOption === "media"
                ? "Texto + mídia"
                : typeOption === "button_reply"
                  ? "Texto + botões reply"
                  : "Botões CTA"}
          </option>
        ))}
      </Form.Select>
      {(form.type === "button_reply" || form.type === "button_cta") && (
        <Form.Group controlId="broadcast-title">
          <Form.Label>Título do cabeçalho</Form.Label>
          <Form.Control
            type="text"
            value={form.title}
            onChange={(event) => handleFieldChange("title", event.target.value)}
            placeholder="Ex.: Escolha o formato"
            disabled={sending}
          />
          <Form.Text className="text-muted">
            Este texto aparece na parte superior do modelo de botões.
          </Form.Text>
        </Form.Group>
      )}
      <Form.Group controlId="broadcast-body">
        <Form.Label>Mensagem</Form.Label>
        <Form.Control
          as="textarea"
          rows={3}
          value={form.body}
          onChange={(event) => handleFieldChange("body", event.target.value)}
          placeholder="Ex.: Escolha o formato para receber seu download."
          disabled={sending}
        />
      </Form.Group>
      <Form.Group controlId="broadcast-footer">
        <Form.Label>Rodapé (opcional)</Form.Label>
        <Form.Control
          type="text"
          value={form.footer}
          onChange={(event) => handleFieldChange("footer", event.target.value)}
          disabled={sending}
          placeholder="Clique em um dos botões abaixo"
        />
      </Form.Group>
      <Form.Group controlId="broadcast-mentions" className="d-flex flex-column gap-2">
        <Form.Label className="fw-semibold mb-0">Menções (opcional)</Form.Label>
        <Form.Check
          type="switch"
          label="Mencionar todos os participantes do grupo"
          checked={form.mentionAll}
          onChange={(event) => handleFieldChange("mentionAll", event.target.checked)}
          disabled={sending}
        />
        <Form.Control
          as="textarea"
          rows={2}
          placeholder="Separe números com DDI ou @ por linha para mencionar pessoas específicas."
          value={form.mentionText}
          onChange={(event) => handleFieldChange("mentionText", event.target.value)}
          disabled={sending}
        />
        <Form.Text className="text-secondary">
          Ex.: <code>5511999999999</code> ou <code>@5511999999999</code>. Use uma linha ou vírgula para cada número.
        </Form.Text>
      </Form.Group>
      {form.type === "media" && (
        <div className="d-flex flex-column gap-2">
          <Form.Label>Mídia principal</Form.Label>
          <div className="d-flex flex-wrap gap-2">
            <Form.Select
              value={form.mediaType ?? "image"}
              onChange={(event) =>
                handleFieldChange(
                  "mediaType",
                  event.target.value as BroadcastComposerState["mediaType"],
                )
              }
              disabled={sending}
              style={{ maxWidth: 200 }}
            >
              <option value="image">Imagem</option>
              <option value="video">Vídeo</option>
              <option value="audio">Áudio</option>
              <option value="document">Documento</option>
            </Form.Select>
            <InputGroup>
              <Form.Control
                type="url"
                placeholder="https://..."
                value={linkResolver.media.preview ? "" : form.mediaUrl}
                onChange={(event) => handleFieldChange("mediaUrl", event.target.value)}
                onBlur={(event) => {
                  const trimmed = (event.target.value || "").trim();
                  if (detectMediaLinkProvider(trimmed)) {
                    void handleResolveLink("media");
                  }
                }}
                disabled={sending}
              />
            </InputGroup>
          </div>
          {linkResolver.media.error ? (
            <small className="text-danger">{linkResolver.media.error}</small>
          ) : null}
          {linkResolver.media.message ? (
            <small className="text-success">{linkResolver.media.message}</small>
          ) : null}
          {renderLinkPreview("media")}
          {linkResolver.media.preview ? (
            <small className="text-secondary">Link resolvido. A mídia será enviada conforme a prévia.</small>
          ) : null}
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <Form.Control
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file, "media");
              }}
              disabled={sending || uploading === "media"}
            />
            {form.mediaPath ? (
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => removeMedia("media")}
                disabled={sending}
              >
                Remover mídia
              </Button>
            ) : null}
          </div>
          {uploading === "media" ? (
            <small className="text-secondary d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" role="status" /> Enviando arquivo...
            </small>
          ) : null}
          {form.mediaPath ? (
            <small className="text-secondary">
              {normalizeMediaSrc(form.mediaUrl, form.mediaPath)}
            </small>
          ) : null}
        </div>
      )}
      {form.type === "button_reply" || form.type === "button_cta" ? (
        <div className="d-flex flex-column gap-2">
          <Form.Label>Mídia do cabeçalho (opcional)</Form.Label>
          <div className="d-flex flex-column gap-2">
            <InputGroup>
              <Form.Control
                type="url"
                placeholder="https://..."
                value={linkResolver.header.preview ? "" : form.headerMediaUrl}
                onChange={(event) => handleFieldChange("headerMediaUrl", event.target.value)}
                onBlur={(event) => {
                  const trimmed = (event.target.value || "").trim();
                  if (detectMediaLinkProvider(trimmed)) {
                    void handleResolveLink("header");
                  }
                }}
                disabled={sending}
              />
            </InputGroup>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <Form.Control
                type="file"
                accept="image/*,video/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUpload(file, "header");
                }}
                disabled={sending || uploading === "header"}
              />
              {form.headerMediaPath ? (
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => removeMedia("header")}
                  disabled={sending}
                >
                  Remover cabeçalho
                </Button>
              ) : null}
            </div>
            {linkResolver.header.error ? (
              <small className="text-danger">{linkResolver.header.error}</small>
            ) : null}
            {linkResolver.header.message ? (
              <small className="text-success">{linkResolver.header.message}</small>
            ) : null}
            {renderLinkPreview("header")}
            {uploading === "header" ? (
              <small className="text-secondary d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Enviando arquivo...
              </small>
            ) : null}
          </div>
        </div>
      ) : null}
      {form.type === "button_reply" ? (
        <div className="d-flex flex-column gap-2">
          <div className="d-flex align-items-center justify-content-between">
            <Form.Label className="mb-0">Botões reply</Form.Label>
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  buttons: [
                    ...prev.buttons,
                    { id: `btn_${Date.now()}`, label: "", command: "", args: "" },
                  ].slice(0, 3),
                }))
              }
              disabled={sending || form.buttons.length >= 3}
            >
              Adicionar botão
            </Button>
          </div>
          {form.buttons.length === 0 ? (
            <small className="text-secondary">Nenhum botão configurado.</small>
          ) : (
            <div className="d-flex flex-column gap-2">
              {form.buttons.map((btn, index) => (
                <div key={btn.id || index} className="border rounded p-2 d-flex flex-column gap-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <strong>Botão #{index + 1}</strong>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          buttons: prev.buttons.filter((_, idx) => idx !== index),
                        }))
                      }
                      disabled={sending}
                    >
                      Remover
                    </Button>
                  </div>
                  <Form.Control
                    type="text"
                    placeholder="Texto exibido"
                    value={btn.label ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        buttons: prev.buttons.map((current, idx) =>
                          idx === index ? { ...current, label: event.target.value } : current,
                        ),
                      }))
                    }
                    disabled={sending}
                  />
                  <Form.Control
                    type="text"
                    placeholder="Comando (ex.: ytmp3)"
                    value={btn.command ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        buttons: prev.buttons.map((current, idx) =>
                          idx === index ? { ...current, command: event.target.value } : current,
                        ),
                      }))
                    }
                    disabled={sending}
                  />
                  <Form.Control
                    type="text"
                    placeholder="Argumentos (ex.: {{numero}})"
                    value={btn.args ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        buttons: prev.buttons.map((current, idx) =>
                          idx === index ? { ...current, args: event.target.value } : current,
                        ),
                      }))
                    }
                    disabled={sending}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {form.type === "button_cta" ? (
        <div className="d-flex flex-column gap-2">
          <div className="d-flex align-items-center justify-content-between">
            <Form.Label className="mb-0">Botões CTA</Form.Label>
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  ctaButtons: [
                    ...prev.ctaButtons,
                    { id: `cta_${Date.now()}`, text: "", type: "cta_url", url: "" },
                  ].slice(0, 3),
                }))
              }
              disabled={sending || form.ctaButtons.length >= 3}
            >
              Adicionar CTA
            </Button>
          </div>
          {form.ctaButtons.length === 0 ? (
            <small className="text-secondary">
              Configure botões de ligação, cópia ou URL.
            </small>
          ) : (
            <div className="d-flex flex-column gap-2">
              {form.ctaButtons.map((btn, index) => (
                <div key={btn.id || index} className="border rounded p-2 d-flex flex-column gap-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <strong>CTA #{index + 1}</strong>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          ctaButtons: prev.ctaButtons.filter((_, idx) => idx !== index),
                        }))
                      }
                      disabled={sending}
                    >
                      Remover
                    </Button>
                  </div>
                  <Form.Control
                    type="text"
                    placeholder="Texto exibido"
                    value={btn.text ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        ctaButtons: prev.ctaButtons.map((current, idx) =>
                          idx === index ? { ...current, text: event.target.value } : current,
                        ),
                      }))
                    }
                    disabled={sending}
                  />
                  <Form.Select
                    value={btn.type}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        ctaButtons: prev.ctaButtons.map((current, idx) =>
                          idx === index
                            ? ({
                                ...current,
                                type: event.target.value as BotGroupCtaButton["type"],
                                url: undefined,
                                copyCode: undefined,
                                phoneNumber: undefined,
                              } as BotGroupCtaButton)
                            : current,
                        ),
                      }))
                    }
                    disabled={sending}
                  >
                    <option value="cta_url">URL</option>
                    <option value="cta_copy">Copiar texto</option>
                    <option value="cta_call">Ligar</option>
                  </Form.Select>
                  {btn.type === "cta_url" ? (
                    <Form.Control
                      type="url"
                      placeholder="https://..."
                      value={btn.url ?? ""}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          ctaButtons: prev.ctaButtons.map((current, idx) =>
                            idx === index ? { ...current, url: event.target.value } : current,
                          ),
                        }))
                      }
                      disabled={sending}
                    />
                  ) : null}
                  {btn.type === "cta_copy" ? (
                    <Form.Control
                      type="text"
                      placeholder="Texto a ser copiado"
                      value={btn.copyCode ?? ""}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          ctaButtons: prev.ctaButtons.map((current, idx) =>
                            idx === index ? { ...current, copyCode: event.target.value } : current,
                          ),
                        }))
                      }
                      disabled={sending}
                    />
                  ) : null}
                  {btn.type === "cta_call" ? (
                    <Form.Control
                      type="tel"
                      placeholder="+55..."
                      value={btn.phoneNumber ?? ""}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          ctaButtons: prev.ctaButtons.map((current, idx) =>
                            idx === index ? { ...current, phoneNumber: event.target.value } : current,
                          ),
                        }))
                      }
                      disabled={sending}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {lastSentAt ? (
        <small className="text-secondary">
          Último disparo salvo em <strong>{lastSentAt}</strong>.
        </small>
      ) : null}
      <div className="d-flex justify-content-end">
        <Button variant="primary" onClick={() => void handleSend()} disabled={sending}>
          {sending ? (
            <span className="d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" role="status" /> Enviando...
            </span>
          ) : (
            "Enviar mensagem"
          )}
        </Button>
      </div>
    </div>
  );
};

export const GROUP_MINI_VIEW_OPTIONS: GroupMiniViewOption[] = [
  {
    key: "activations",
    label: "Ativações",
    description: "Ative comandos gerais, prefixos e listas de bloqueio ou permissão.",
    icon: <IconAdjustments size={18} />,
    variant: "primary",
  },
  {
    key: "welcome",
    label: "Bem-vindo",
    description: "Gerencie a mensagem enviada automaticamente a novos participantes.",
    icon: <IconMoodSmile size={18} />,
    variant: "success",
  },
  {
    key: "broadcast",
    label: "Disparos",
    description: "Envie mensagens ou botões manualmente para o grupo.",
    icon: <IconSend size={18} />,
    variant: "primary",
    outlineVariant: "outline-primary",
  },
  {
    key: "blacklist",
    label: "Lista de bloqueio",
    description: "Gerencie números bloqueados e remova-os automaticamente ao entrarem no grupo.",
    icon: <IconBan size={18} />,
    variant: "danger",
  },
  {
    key: "autoresponse",
    label: "Autoresposta",
    description: "Visualize e habilite respostas rápidas configuradas para o grupo.",
    icon: <IconMessageChatbot size={18} />,
    variant: "info",
    outlineVariant: "outline-info",
  },
  {
    key: "horapg",
    label: "Horários pagantes",
    description: "Personalize o envio automático dos horários pagantes e a imagem exibida.",
    icon: <IconClock size={18} />,
    variant: "success",
    outlineVariant: "outline-success",
  },
  {
    key: "schedule",
    label: "Abrir e fechar grupo",
    description: "Configure horários para bloquear o grupo ou liberar as mensagens automaticamente.",
    icon: <IconLock size={18} />,
    variant: "secondary",
    outlineVariant: "outline-secondary",
  },
  {
    key: "sweepstakes",
    label: "Sorteios",
    description: "Crie, finalize e acompanhe os sorteios vinculados ao comando /sorteio.",
    icon: <IconTicket size={18} />,
    variant: "success",
    outlineVariant: "outline-success",
  },
  {
    key: "botinterage",
    label: "Bot interage (IA)",
    description: "Gerencie o assistente de IA, chaves Groq e respostas por voz.",
    icon: <IconBrain size={18} />,
    variant: "secondary",
    outlineVariant: "outline-secondary",
  },
  {
    key: "details",
    label: "Dados do grupo",
    description: "Atualize nome, descrição, link e controles administrativos do grupo.",
    icon: <IconId size={18} />,
    variant: "info",
    outlineVariant: "outline-info",
  },
  {
    key: "media",
    label: "Menus do bot",
    description: "Edite os textos e o fundo exibidos nos menus automáticos do bot.",
    icon: <IconPhoto size={18} />,
    variant: "secondary",
    outlineVariant: "outline-secondary",
  },
  {
    key: "aliases",
    label: "Nomes dos comandos",
    description: "Personalize como você chama os comandos do bot.",
    icon: <IconCommand size={18} />,
    variant: "dark",
    outlineVariant: "outline-dark",
  },
];

interface UserGroupManagerProps {
  instances: BotInstance[];
  groups: BotGroup[];
  planStatus: UserPlanStatus;
  planLimits: UserPlanLimits;
  tutorials: FieldTutorialMap;
  restApiKey: string;
}

const formatDate = (value: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const normalizeAntifakeMessage = (value: string) => value.replace(/\r\n/g, "\n");

const UserGroupManager = ({
  instances,
  groups,
  planStatus,
  planLimits,
  tutorials,
  restApiKey,
}: UserGroupManagerProps) => {
  const router = useRouter();
  const [groupsState, setGroupsState] = useState<BotGroup[]>(groups);
  useEffect(() => {
    setGroupsState(groups);
  }, [groups]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingGroupId, setPendingGroupId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    groups.length > 0 ? groups[0].id : null,
  );
  const [activeMiniView, setActiveMiniView] = useState<GroupMiniViewKey | null>(
    groups.length > 0 ? "activations" : null,
  );
  const [settingsState, setSettingsState] = useState<Record<number, GroupSettingsUiState>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  useEffect(() => {
    if (groupsState.length === 0) {
      setSelectedGroupId(null);
      setActiveMiniView(null);
      return;
    }

    setSelectedGroupId((previous) => {
      if (previous !== null && groupsState.some((group) => group.id === previous)) {
        return previous;
      }
      return groupsState[0].id;
    });
  }, [groupsState]);

  useEffect(() => {
    if (selectedGroupId === null) {
      return;
    }

    setActiveMiniView((previous) => previous ?? "activations");

    const current = settingsState[selectedGroupId];
    if (!current || !current.settings) {
      void loadGroupSettings(selectedGroupId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId]);

  const normalizeList = (value: string): string[] =>
    value
      .split(/[\r\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);

  const normalizeCommandPrefixes = (value: string): string[] => {
    const tokens = value
      .split(/[\r\n,;]+/)
      .flatMap((entry) => entry.split(/\s+/))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const sanitized = tokens
      .map((entry) => entry.replace(/\s+/g, ""))
      .filter((entry) => entry.length > 0);
    const unique = sanitized.filter((entry, index, array) => array.indexOf(entry) === index);
    return unique.slice(0, 10);
  };

  const normalizeAllowedLinks = normalizeList;
  const normalizeAllowedDdis = normalizeList;
  const normalizeBannedWords = normalizeList;
  const normalizeWelcomeCaption = (value: string) => value.replace(/\r\n/g, "\n");
  const normalizeWelcomeMediaUrl = (value: string) => value.trim();
  const sanitizeWelcomeAttachments = (
    list?: BotGroupSettings["welcomeConfig"]["attachments"],
  ): BotGroupSettings["welcomeConfig"]["attachments"] => {
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const kindRaw = typeof item.kind === "string" ? item.kind.trim().toLowerCase() : "";
        if (kindRaw === "vcard") {
          const name = typeof item.name === "string" ? item.name.trim() : "Contato";
          const vcard = typeof item.vcard === "string" ? item.vcard.replace(/\r\n/g, "\n").trim() : "";
          if (!vcard) {
            return null;
          }
          return {
            kind: "vcard",
            name: name || "Contato",
            vcard,
          } satisfies WelcomeAttachment;
        }

        const kind = ((): WelcomeAttachment["kind"] => {
          switch (kindRaw) {
            case "video":
            case "audio":
            case "document":
            case "sticker":
              return kindRaw;
            default:
              return "image";
          }
        })();

        const url = typeof item.url === "string" ? item.url.trim() : "";
        const path = typeof item.path === "string" ? item.path.trim() : "";
        if (!url && !path) {
          return null;
        }

        const fileName = typeof item.fileName === "string" ? item.fileName.trim() : null;
        const mimeType = typeof item.mimeType === "string" ? item.mimeType.trim() : null;
        const caption = typeof item.caption === "string" ? item.caption.trim() : null;

        return {
          kind,
          url: url || null,
          path: path || null,
          fileName,
          mimeType,
          caption,
        } satisfies WelcomeAttachment;
      })
      .filter((entry): entry is WelcomeAttachment => Boolean(entry));
  };
  const cloneWelcomeAttachments = (
    src?: BotGroupSettings["welcomeConfig"]["attachments"],
  ): BotGroupSettings["welcomeConfig"]["attachments"] => {
    if (!Array.isArray(src)) return [];
    return src.map((a) => (a ? JSON.parse(JSON.stringify(a)) : a) as any);
  };

    const normalizeMenuDraftEntries = (value: string): string[] =>
    value
      .split(/[\r\n]+/)
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  const buildMenuDraftsFromSettings = (
    settings?: BotGroupSettings,
  ): Record<MenuTextKey, string> =>
    MENU_TEXT_KEYS.reduce<Record<MenuTextKey, string>>((acc, key) => {
      const values = settings?.menuTexts?.[key];
      const fallback = DEFAULT_MENU_TEXTS[key];
      const finalValues = values && values.length > 0 ? values : fallback;
      acc[key] = finalValues.length ? finalValues.join("\n") : "";
      return acc;
    }, { ...EMPTY_MENU_DRAFTS });
  const cloneMenuDrafts = (
    draft?: Record<MenuTextKey, string>,
    settings?: BotGroupSettings,
  ): Record<MenuTextKey, string> => {
    if (draft) {
      return { ...draft };
    }
    return buildMenuDraftsFromSettings(settings);
  };
  const cloneMenuDirty = (
    dirty?: Record<MenuTextKey, boolean>,
  ): Record<MenuTextKey, boolean> => ({
    ...EMPTY_MENU_DIRTY,
    ...(dirty ?? {}),
  });
  const computeWelcomeDirty = (
    settings: BotGroupSettings | undefined,
    caption: string,
    mediaUrl: string,
    asSticker: boolean,
    attachments?: BotGroupSettings["welcomeConfig"]["attachments"],
  ) => {
    if (!settings) {
      return false;
    }
    const base = settings.welcomeConfig;
    const baseCaption = normalizeWelcomeCaption(base.caption ?? "");
    const baseMedia = normalizeWelcomeMediaUrl(base.mediaUrl ?? "");
    const nextCaption = normalizeWelcomeCaption(caption);
    const nextMedia = normalizeWelcomeMediaUrl(mediaUrl);
    const baseAttachments = sanitizeWelcomeAttachments(base.attachments);
    const nextAttachments = sanitizeWelcomeAttachments(attachments);
    const attachmentsChanged = JSON.stringify(nextAttachments) !== JSON.stringify(baseAttachments);
    return (
      nextCaption !== baseCaption ||
      nextMedia !== baseMedia ||
      asSticker !== (base.asSticker ?? false) ||
      attachmentsChanged
    );
  };

  const loadGroupSettings = async (groupId: number) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      return {
        ...prev,
        [groupId]: {
          loading: true,
          saving: false,
          settings: current?.settings,
          nativeButtonsAvailable: current?.nativeButtonsAvailable ?? false,
          draftCommandPrefixes:
            current?.draftCommandPrefixes ??
            (current?.settings?.commandPrefixes.length
              ? current.settings.commandPrefixes.join("\n")
              : ""),
          draftAllowedLinks:
            current?.draftAllowedLinks ??
            (current?.settings?.allowedLinks.length
              ? current.settings.allowedLinks.join("\n")
              : ""),
          draftAllowedDdis:
            current?.draftAllowedDdis ??
            (current?.settings?.allowedDdis.length
              ? current.settings.allowedDdis.join("\n")
              : ""),
          draftAntifakeMessage:
            current?.draftAntifakeMessage ??
            normalizeAntifakeMessage(current?.settings?.antifakeMessage ?? ""),
          draftAntipalavrasBan:
            current?.draftAntipalavrasBan ??
            (current?.settings?.featureFlags.antipalavrasBan ?? false),
          draftAntipalavrasLimit:
            current?.draftAntipalavrasLimit ??
            String(current?.settings?.antipalavrasMaxInfractions ?? 5),
          draftBannedWords:
            current?.draftBannedWords ??
            (current?.settings?.bannedWords.length
              ? current.settings.bannedWords.join("\n")
              : ""),
          dirtyCommandPrefixes: current?.dirtyCommandPrefixes ?? false,
          dirtyAllowedLinks: current?.dirtyAllowedLinks ?? false,
          dirtyAllowedDdis: current?.dirtyAllowedDdis ?? false,
          dirtyAntifakeMessage: current?.dirtyAntifakeMessage ?? false,
          dirtyAntipalavrasBan: current?.dirtyAntipalavrasBan ?? false,
          dirtyAntipalavrasLimit: current?.dirtyAntipalavrasLimit ?? false,
          dirtyBannedWords: current?.dirtyBannedWords ?? false,
          draftWelcomeCaption:
            current?.draftWelcomeCaption ??
            normalizeWelcomeCaption(current?.settings?.welcomeConfig.caption ?? ""),
          draftWelcomeMediaUrl:
            current?.draftWelcomeMediaUrl ??
            (current?.settings?.welcomeConfig.mediaUrl ?? ""),
        draftWelcomeAsSticker:
          current?.draftWelcomeAsSticker ??
          (current?.settings?.welcomeConfig.asSticker ?? false),
          draftWelcomeAttachments:
            current?.draftWelcomeAttachments ??
            cloneWelcomeAttachments(current?.settings?.welcomeConfig.attachments),
          dirtyWelcome: current?.dirtyWelcome ?? false,
          savingCommands: current?.savingCommands ?? false,
          savingWelcome: current?.savingWelcome ?? false,
          draftMenuTexts: cloneMenuDrafts(current?.draftMenuTexts, current?.settings),
          dirtyMenuTexts: cloneMenuDirty(current?.dirtyMenuTexts),
          savingMenuTexts: current?.savingMenuTexts ?? false,
          uploadingWelcomeMedia: current?.uploadingWelcomeMedia ?? false,
          draftUnknownCommandTemplate:
            current?.draftUnknownCommandTemplate ??
            (current?.settings?.unknownCommandTemplate ?? ""),
          dirtyUnknownCommandTemplate: current?.dirtyUnknownCommandTemplate ?? false,
          savingUnknownCommandTemplate: current?.savingUnknownCommandTemplate ?? false,
          draftAutoResponses: cloneAutoResponses(
            current?.draftAutoResponses,
            current?.settings,
          ),
          dirtyAutoResponses: current?.dirtyAutoResponses ?? false,
          savingAutoResponses: current?.savingAutoResponses ?? false,
          draftAiModel:
            current?.draftAiModel ?? current?.settings?.aiModel ?? DEFAULT_GROQ_MODEL,
          dirtyAiModel: current?.dirtyAiModel ?? false,
          savingAiModel: current?.savingAiModel ?? false,
          error: null,
        },
      };
    });

    try {
      const response = await fetch(`/api/bot-groups/${groupId}/settings`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível carregar as ativações do grupo.",
        );
      }

      const settings = data.settings as BotGroupSettings;
      setSettingsState((prev) => ({
        ...prev,
        [groupId]: {
          loading: false,
          saving: false,
          settings,
          nativeButtonsAvailable: Boolean(data.meta?.nativeButtonsEnabled),
          draftCommandPrefixes:
            settings.commandPrefixes.length ? settings.commandPrefixes.join("\n") : "",
          draftAllowedLinks: settings.allowedLinks.length ? settings.allowedLinks.join("\n") : "",
          draftAllowedDdis: settings.allowedDdis.length ? settings.allowedDdis.join("\n") : "",
          draftAntifakeMessage: normalizeAntifakeMessage(settings.antifakeMessage ?? ""),
          draftAntipalavrasBan: settings.featureFlags.antipalavrasBan ?? false,
          draftAntipalavrasLimit: String(settings.antipalavrasMaxInfractions ?? 5),
          draftBannedWords: settings.bannedWords.length ? settings.bannedWords.join("\n") : "",
          dirtyCommandPrefixes: false,
          dirtyAllowedLinks: false,
          dirtyAllowedDdis: false,
          dirtyAntifakeMessage: false,
          dirtyAntipalavrasBan: false,
          dirtyAntipalavrasLimit: false,
          dirtyBannedWords: false,
          draftWelcomeCaption: normalizeWelcomeCaption(settings.welcomeConfig.caption ?? ""),
          draftWelcomeMediaUrl: settings.welcomeConfig.mediaUrl ?? "",
          draftWelcomeAsSticker: settings.welcomeConfig.asSticker ?? false,
          draftWelcomeAttachments: cloneWelcomeAttachments(settings.welcomeConfig.attachments),
          dirtyWelcome: false,
          savingCommands: false,
          savingWelcome: false,
          draftMenuTexts: buildMenuDraftsFromSettings(settings),
          dirtyMenuTexts: { ...EMPTY_MENU_DIRTY },
          savingMenuTexts: false,
          uploadingWelcomeMedia: false,
          draftAutoResponses: buildAutoResponsesFromSettings(settings),
          dirtyAutoResponses: false,
          savingAutoResponses: false,
          draftAiModel: settings.aiModel ?? DEFAULT_GROQ_MODEL,
          dirtyAiModel: false,
          savingAiModel: false,
          draftUnknownCommandTemplate: settings.unknownCommandTemplate ?? "",
          dirtyUnknownCommandTemplate: false,
          savingUnknownCommandTemplate: false,
          error: null,
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as ativações do grupo.";
      setSettingsState((prev) => ({
        ...prev,
        [groupId]: {
          loading: false,
          saving: false,
          settings: prev[groupId]?.settings,
          nativeButtonsAvailable: prev[groupId]?.nativeButtonsAvailable ?? false,
          draftCommandPrefixes: prev[groupId]?.draftCommandPrefixes ?? "",
          draftAllowedLinks: prev[groupId]?.draftAllowedLinks ?? "",
          draftAllowedDdis: prev[groupId]?.draftAllowedDdis ?? "",
          draftAntifakeMessage:
            prev[groupId]?.draftAntifakeMessage ??
            normalizeAntifakeMessage(prev[groupId]?.settings?.antifakeMessage ?? ""),
          draftAntipalavrasBan:
            prev[groupId]?.draftAntipalavrasBan ??
            (prev[groupId]?.settings?.featureFlags.antipalavrasBan ?? false),
          draftAntipalavrasLimit:
            prev[groupId]?.draftAntipalavrasLimit ??
            String(prev[groupId]?.settings?.antipalavrasMaxInfractions ?? 5),
          draftBannedWords: prev[groupId]?.draftBannedWords ?? "",
          dirtyCommandPrefixes: prev[groupId]?.dirtyCommandPrefixes ?? false,
          dirtyAllowedLinks: prev[groupId]?.dirtyAllowedLinks ?? false,
          dirtyAllowedDdis: prev[groupId]?.dirtyAllowedDdis ?? false,
          dirtyAntifakeMessage: prev[groupId]?.dirtyAntifakeMessage ?? false,
          dirtyAntipalavrasBan: prev[groupId]?.dirtyAntipalavrasBan ?? false,
          dirtyAntipalavrasLimit: prev[groupId]?.dirtyAntipalavrasLimit ?? false,
          dirtyBannedWords: prev[groupId]?.dirtyBannedWords ?? false,
          draftWelcomeCaption:
            prev[groupId]?.draftWelcomeCaption ??
            normalizeWelcomeCaption(prev[groupId]?.settings?.welcomeConfig.caption ?? ""),
          draftWelcomeMediaUrl:
            prev[groupId]?.draftWelcomeMediaUrl ??
            (prev[groupId]?.settings?.welcomeConfig.mediaUrl ?? ""),
          draftWelcomeAsSticker:
            prev[groupId]?.draftWelcomeAsSticker ??
            (prev[groupId]?.settings?.welcomeConfig.asSticker ?? false),
          draftWelcomeAttachments:
            prev[groupId]?.draftWelcomeAttachments ??
            cloneWelcomeAttachments(prev[groupId]?.settings?.welcomeConfig.attachments),
          dirtyWelcome: prev[groupId]?.dirtyWelcome ?? false,
          savingCommands: prev[groupId]?.savingCommands ?? false,
          savingWelcome: prev[groupId]?.savingWelcome ?? false,
          draftMenuTexts: cloneMenuDrafts(
            prev[groupId]?.draftMenuTexts,
            prev[groupId]?.settings,
          ),
          dirtyMenuTexts: cloneMenuDirty(prev[groupId]?.dirtyMenuTexts),
          savingMenuTexts: prev[groupId]?.savingMenuTexts ?? false,
          uploadingWelcomeMedia: prev[groupId]?.uploadingWelcomeMedia ?? false,
          draftAutoResponses: cloneAutoResponses(
            prev[groupId]?.draftAutoResponses,
            prev[groupId]?.settings,
          ),
          dirtyAutoResponses: prev[groupId]?.dirtyAutoResponses ?? false,
          savingAutoResponses: prev[groupId]?.savingAutoResponses ?? false,
          draftAiModel:
            prev[groupId]?.draftAiModel ?? prev[groupId]?.settings?.aiModel ?? DEFAULT_GROQ_MODEL,
          dirtyAiModel: prev[groupId]?.dirtyAiModel ?? false,
          savingAiModel: prev[groupId]?.savingAiModel ?? false,
          draftUnknownCommandTemplate:
            prev[groupId]?.draftUnknownCommandTemplate ??
            (prev[groupId]?.settings?.unknownCommandTemplate ?? ""),
          dirtyUnknownCommandTemplate: prev[groupId]?.dirtyUnknownCommandTemplate ?? false,
          savingUnknownCommandTemplate: prev[groupId]?.savingUnknownCommandTemplate ?? false,
          error: message,
        },
      }));
    }
  };

  const updateGroupSettings = async (
    groupId: number,
    patch: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">>,
  ) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      return {
        ...prev,
        [groupId]: {
          loading: current?.loading ?? false,
          saving: true,
          settings: current?.settings,
          draftCommandPrefixes: current?.draftCommandPrefixes ?? "",
          draftAllowedLinks: current?.draftAllowedLinks ?? "",
          draftAllowedDdis: current?.draftAllowedDdis ?? "",
          draftAntifakeMessage: current?.draftAntifakeMessage ?? "",
          draftAntipalavrasBan:
            current?.draftAntipalavrasBan ??
            (current?.settings?.featureFlags.antipalavrasBan ?? false),
          draftAntipalavrasLimit:
            current?.draftAntipalavrasLimit ??
            String(current?.settings?.antipalavrasMaxInfractions ?? 5),
          draftBannedWords: current?.draftBannedWords ?? "",
          dirtyCommandPrefixes: current?.dirtyCommandPrefixes ?? false,
          dirtyAllowedLinks: current?.dirtyAllowedLinks ?? false,
          dirtyAllowedDdis: current?.dirtyAllowedDdis ?? false,
          dirtyAntifakeMessage: current?.dirtyAntifakeMessage ?? false,
          dirtyAntipalavrasBan: current?.dirtyAntipalavrasBan ?? false,
          dirtyAntipalavrasLimit: current?.dirtyAntipalavrasLimit ?? false,
          dirtyBannedWords: current?.dirtyBannedWords ?? false,
          draftWelcomeCaption:
            current?.draftWelcomeCaption ??
            normalizeWelcomeCaption(current?.settings?.welcomeConfig.caption ?? ""),
          draftWelcomeMediaUrl:
            current?.draftWelcomeMediaUrl ??
            (current?.settings?.welcomeConfig.mediaUrl ?? ""),
          draftWelcomeAsSticker:
            current?.draftWelcomeAsSticker ??
            (current?.settings?.welcomeConfig.asSticker ?? false),
          draftWelcomeAttachments:
            current?.draftWelcomeAttachments ??
            cloneWelcomeAttachments(current?.settings?.welcomeConfig.attachments),
          dirtyWelcome: current?.dirtyWelcome ?? false,
          savingCommands: current?.savingCommands ?? false,
          savingWelcome: current?.savingWelcome ?? false,
          draftMenuTexts: cloneMenuDrafts(current?.draftMenuTexts, current?.settings),
          dirtyMenuTexts: cloneMenuDirty(current?.dirtyMenuTexts),
          savingMenuTexts: current?.savingMenuTexts ?? false,
          uploadingWelcomeMedia: current?.uploadingWelcomeMedia ?? false,
          draftAutoResponses: cloneAutoResponses(
            current?.draftAutoResponses,
            current?.settings,
          ),
          dirtyAutoResponses: current?.dirtyAutoResponses ?? false,
          savingAutoResponses: current?.savingAutoResponses ?? false,
          draftAiModel:
            current?.draftAiModel ?? current?.settings?.aiModel ?? DEFAULT_GROQ_MODEL,
          dirtyAiModel: current?.dirtyAiModel ?? false,
          savingAiModel: current?.savingAiModel ?? false,
          error: null,
        },
      };
    });

    try {
      let response = await fetch(`/api/bot-groups/${groupId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      let data: any = await response.json().catch(() => ({}));
      // Fallback: alguns hosts ainda não expõem /settings; reencaminha para /api/bot-groups/:id
      if (response.status === 404 || response.status === 405) {
        response = await fetch(`/api/bot-groups/${groupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        data = await response.json().catch(() => ({}));
      }
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar as ativações do grupo.",
        );
      }

      const settings = data.settings as BotGroupSettings;
      setSettingsState((prev) => ({
        ...prev,
        [groupId]: {
          loading: false,
          saving: false,
          settings,
          draftCommandPrefixes:
            settings.commandPrefixes.length ? settings.commandPrefixes.join("\n") : "",
          draftAllowedLinks: settings.allowedLinks.length ? settings.allowedLinks.join("\n") : "",
          draftAllowedDdis: settings.allowedDdis.length ? settings.allowedDdis.join("\n") : "",
          draftAntifakeMessage: normalizeAntifakeMessage(settings.antifakeMessage ?? ""),
          draftAntipalavrasBan: settings.featureFlags.antipalavrasBan ?? false,
          draftAntipalavrasLimit: String(settings.antipalavrasMaxInfractions ?? 5),
          draftBannedWords: settings.bannedWords.length ? settings.bannedWords.join("\n") : "",
          dirtyCommandPrefixes: false,
          dirtyAllowedLinks: false,
          dirtyAllowedDdis: false,
          dirtyAntifakeMessage: false,
          dirtyAntipalavrasBan: false,
          dirtyAntipalavrasLimit: false,
          dirtyBannedWords: false,
          draftWelcomeCaption: normalizeWelcomeCaption(settings.welcomeConfig.caption ?? ""),
          draftWelcomeMediaUrl: settings.welcomeConfig.mediaUrl ?? "",
          draftWelcomeAsSticker: settings.welcomeConfig.asSticker ?? false,
          draftWelcomeAttachments: cloneWelcomeAttachments(settings.welcomeConfig.attachments),
          dirtyWelcome: false,
          savingCommands: false,
          savingWelcome: false,
          draftMenuTexts: buildMenuDraftsFromSettings(settings),
          dirtyMenuTexts: { ...EMPTY_MENU_DIRTY },
          savingMenuTexts: false,
          uploadingWelcomeMedia: false,
          draftAutoResponses: buildAutoResponsesFromSettings(settings),
          dirtyAutoResponses: false,
          savingAutoResponses: false,
          draftAiModel: settings.aiModel ?? DEFAULT_GROQ_MODEL,
          dirtyAiModel: false,
          savingAiModel: false,
          error: null,
        },
      }));
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar as ativações do grupo.";
      console.error("[settings] update failed", { groupId, patch, error });
      setSettingsState((prev) => {
        const current = prev[groupId];
        return {
          ...prev,
          [groupId]: {
            loading: current?.loading ?? false,
            saving: false,
            settings: current?.settings,
            draftCommandPrefixes: current?.draftCommandPrefixes ?? "",
          draftAllowedLinks: current?.draftAllowedLinks ?? "",
          draftAllowedDdis: current?.draftAllowedDdis ?? "",
          draftAntifakeMessage: current?.draftAntifakeMessage ?? "",
          draftAntipalavrasBan:
            current?.draftAntipalavrasBan ??
            (current?.settings?.featureFlags.antipalavrasBan ?? false),
          draftAntipalavrasLimit:
            current?.draftAntipalavrasLimit ??
            String(current?.settings?.antipalavrasMaxInfractions ?? 5),
          draftBannedWords: current?.draftBannedWords ?? "",
          dirtyCommandPrefixes: current?.dirtyCommandPrefixes ?? false,
          dirtyAllowedLinks: current?.dirtyAllowedLinks ?? false,
          dirtyAllowedDdis: current?.dirtyAllowedDdis ?? false,
          dirtyAntifakeMessage: current?.dirtyAntifakeMessage ?? false,
          dirtyBannedWords: current?.dirtyBannedWords ?? false,
          dirtyAntipalavrasBan: current?.dirtyAntipalavrasBan ?? false,
          dirtyAntipalavrasLimit: current?.dirtyAntipalavrasLimit ?? false,
            draftWelcomeCaption:
              current?.draftWelcomeCaption ??
              normalizeWelcomeCaption(current?.settings?.welcomeConfig.caption ?? ""),
            draftWelcomeMediaUrl:
              current?.draftWelcomeMediaUrl ??
              (current?.settings?.welcomeConfig.mediaUrl ?? ""),
            draftWelcomeAsSticker:
              current?.draftWelcomeAsSticker ??
              (current?.settings?.welcomeConfig.asSticker ?? false),
            draftWelcomeAttachments:
              current?.draftWelcomeAttachments ??
              cloneWelcomeAttachments(current?.settings?.welcomeConfig.attachments),
            dirtyWelcome: current?.dirtyWelcome ?? false,
            savingCommands: current?.savingCommands ?? false,
            savingWelcome: false,
            draftMenuTexts: cloneMenuDrafts(current?.draftMenuTexts, current?.settings),
            dirtyMenuTexts: cloneMenuDirty(current?.dirtyMenuTexts),
            savingMenuTexts: current?.savingMenuTexts ?? false,
            uploadingWelcomeMedia: current?.uploadingWelcomeMedia ?? false,
            draftAutoResponses: cloneAutoResponses(
              current?.draftAutoResponses,
              current?.settings,
            ),
            dirtyAutoResponses: current?.dirtyAutoResponses ?? false,
            savingAutoResponses: current?.savingAutoResponses ?? false,
            draftAiModel:
              current?.draftAiModel ?? current?.settings?.aiModel ?? DEFAULT_GROQ_MODEL,
            dirtyAiModel: current?.dirtyAiModel ?? false,
            savingAiModel: false,
            draftUnknownCommandTemplate:
              current?.draftUnknownCommandTemplate ??
              (current?.settings?.unknownCommandTemplate ?? ""),
            dirtyUnknownCommandTemplate: current?.dirtyUnknownCommandTemplate ?? false,
            savingUnknownCommandTemplate: false,
            error: message,
          },
        };
      });
      return false;
    }
  };

  const handleSelectGroup = (groupId: number) => {
    setSelectedGroupId(groupId);
  };

  const handleMiniViewChange = async (view: GroupMiniViewKey) => {
    setActiveMiniView(view);
    if (selectedGroupId !== null) {
      const current = settingsState[selectedGroupId];
      if (!current || !current.settings) {
        await loadGroupSettings(selectedGroupId);
      }
    }
  };

  const handleOpenCreateModal = () => {
    if (limitReached) {
      setShowLimitModal(true);
      return;
    }
    setShowCreateModal(true);
  };

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
  };

  const handleViewPlans = () => {
    router.push("/dashboard/user?section=conversations");
  };

  const handleGroupUpdated = (nextGroup: BotGroup) => {
    setGroupsState((prev) =>
      prev.map((group) => (group.id === nextGroup.id ? nextGroup : group)),
    );
  };

  const handleCommandPrefixesChange = (groupId: number, value: string) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      const normalizedCurrent = normalizeCommandPrefixes(value);
      const existing = current.settings?.commandPrefixes ?? [];
      const isDirty = JSON.stringify(normalizedCurrent) !== JSON.stringify(existing);
      return {
        ...prev,
        [groupId]: {
          ...current,
          draftCommandPrefixes: value,
          dirtyCommandPrefixes: isDirty,
        },
      };
    });
  };

  const handleCommandPrefixesSave = async (groupId: number) => {
    const draft = settingsState[groupId]?.draftCommandPrefixes ?? "";
    const sanitized = normalizeCommandPrefixes(draft);
    return await updateGroupSettings(groupId, { commandPrefixes: sanitized });
  };

  const handleUnknownCommandChange = (groupId: number, value: string) => {
    updateGroupUiState(groupId, (current) => {
      if (!current) return null;
      const base = current.settings?.unknownCommandTemplate ?? "";
      const normalized = value.replace(/\r\n/g, "\n");
      const isDirty = normalized !== (base ?? "");
      return {
        draftUnknownCommandTemplate: value,
        dirtyUnknownCommandTemplate: isDirty,
      };
    });
  };

  const handleUnknownCommandSave = async (groupId: number) => {
    const draft = settingsState[groupId]?.draftUnknownCommandTemplate ?? "";
    const normalized = draft.replace(/\r\n/g, "\n");
    updateGroupUiState(groupId, () => ({ savingUnknownCommandTemplate: true }));
    const payload = { unknownCommandTemplate: normalized.trim().length ? normalized : null };
    const success = await updateGroupSettings(groupId, payload);
    updateGroupUiState(groupId, (current) => ({
      savingUnknownCommandTemplate: false,
      dirtyUnknownCommandTemplate: success ? false : current?.dirtyUnknownCommandTemplate,
      draftUnknownCommandTemplate: success
        ? payload.unknownCommandTemplate ?? ""
        : current?.draftUnknownCommandTemplate,
    }));
    setMiniFeedback(
      success
        ? { type: "success", message: "Resposta personalizada atualizada com sucesso." }
        : { type: "danger", message: "Não foi possível salvar a resposta personalizada." },
    );
  };

  function updateGroupUiState(
    groupId: number,
    updater: (current: GroupSettingsUiState) => Partial<GroupSettingsUiState> | null | undefined,
  ) {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      const patch = updater(current);
      if (!patch) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...current,
          ...patch,
        },
      };
    });
  }

  const handleAllowedLinksChange = (groupId: number, value: string) => {
    updateGroupUiState(groupId, (current) => {
      const normalizedCurrent = normalizeAllowedLinks(value);
      const existing = current.settings?.allowedLinks ?? [];
      const isDirty = JSON.stringify(normalizedCurrent) !== JSON.stringify(existing);
      return {
        draftAllowedLinks: value,
        dirtyAllowedLinks: isDirty,
      };
    });
  };

  const handleAllowedLinksSave = async (groupId: number) => {
    const draft = settingsState[groupId]?.draftAllowedLinks ?? "";
    const sanitized = normalizeAllowedLinks(draft);
    return await updateGroupSettings(groupId, { allowedLinks: sanitized });
  };

  const handleAllowedDdisChange = (groupId: number, value: string) => {
    updateGroupUiState(groupId, (current) => {
      const normalizedCurrent = normalizeAllowedDdis(value);
      const existing = current.settings?.allowedDdis ?? [];
      const isDirty = JSON.stringify(normalizedCurrent) !== JSON.stringify(existing);
      return {
        draftAllowedDdis: value,
        dirtyAllowedDdis: isDirty,
      };
    });
  };

  const handleAntifakeMessageChange = (groupId: number, value: string) => {
    updateGroupUiState(groupId, (current) => {
      const normalized = normalizeAntifakeMessage(value);
      const existing = normalizeAntifakeMessage(current.settings?.antifakeMessage ?? "");
      return {
        draftAntifakeMessage: value,
        dirtyAntifakeMessage: normalized !== existing,
      };
    });
  };

  const handleAllowedDdisSave = async (groupId: number) => {
    const state = settingsState[groupId];
    const draft = state?.draftAllowedDdis ?? "";
    const sanitizedDdis = normalizeAllowedDdis(draft);
    const draftMessage = normalizeAntifakeMessage(state?.draftAntifakeMessage ?? "");
    const payload: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">> = {};

    if (state?.dirtyAllowedDdis ?? false) {
      payload.allowedDdis = sanitizedDdis;
    }

    if (state?.dirtyAntifakeMessage ?? false) {
      payload.antifakeMessage = draftMessage.trim();
    }

    if (Object.keys(payload).length === 0) {
      return true;
    }

    return await updateGroupSettings(groupId, payload);
  };

  const handleBannedWordsChange = (groupId: number, value: string) => {
    updateGroupUiState(groupId, (current) => {
      const normalizedCurrent = normalizeBannedWords(value);
      const existing = current.settings?.bannedWords ?? [];
      const isDirty = JSON.stringify(normalizedCurrent) !== JSON.stringify(existing);
      return {
        draftBannedWords: value,
        dirtyBannedWords: isDirty,
      };
    });
  };

  const handleBannedWordsBanChange = (groupId: number, checked: boolean) => {
    updateGroupUiState(groupId, (current) => {
      const existing = current.settings?.featureFlags.antipalavrasBan ?? false;
      return {
        draftAntipalavrasBan: checked,
        dirtyAntipalavrasBan: checked !== existing,
      };
    });
  };

  const handleBannedWordsLimitChange = (groupId: number, value: string) => {
    updateGroupUiState(groupId, (current) => {
      const sanitized = value.replace(/[^0-9]/g, "");
      const existing = String(current.settings?.antipalavrasMaxInfractions ?? 5);
      return {
        draftAntipalavrasLimit: sanitized,
        dirtyAntipalavrasLimit: sanitized !== existing,
      };
    });
  };

  const handleBannedWordsSave = async (groupId: number) => {
    const state = settingsState[groupId];
    const draft = state?.draftBannedWords ?? "";
    const sanitized = normalizeBannedWords(draft);
    const payload: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">> = {};

    if (state?.dirtyBannedWords ?? false) {
      payload.bannedWords = sanitized;
    }

    if (state?.dirtyAntipalavrasBan ?? false) {
      const banValue = state?.draftAntipalavrasBan ?? state?.settings?.featureFlags.antipalavrasBan ?? false;
      payload.featureFlags = { antipalavrasBan: banValue };
    }

    if (state?.dirtyAntipalavrasLimit ?? false) {
      const limitRaw = state?.draftAntipalavrasLimit ?? "";
      const parsed = Number.parseInt(limitRaw, 10);
      const normalized = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 20) : 5;
      payload.antipalavrasMaxInfractions = normalized;
    }

    if (Object.keys(payload).length === 0) {
      return true;
    }

    return await updateGroupSettings(groupId, payload);
  };

  const handleMenuTextChange = (groupId: number, key: MenuTextKey, value: string) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }

      const nextDraft = { ...cloneMenuDrafts(current.draftMenuTexts, current.settings), [key]: value };
      const sanitized = normalizeMenuDraftEntries(value);
      const existing = current.settings?.menuTexts?.[key] ?? [];
      const isDirty = JSON.stringify(sanitized) !== JSON.stringify(existing);
      return {
        ...prev,
        [groupId]: {
          ...current,
          draftMenuTexts: nextDraft,
          dirtyMenuTexts: { ...cloneMenuDirty(current.dirtyMenuTexts), [key]: isDirty },
        },
      };
    });
  };

  const handleMenuTextsSave = async (groupId: number) => {
    const snapshot = settingsState[groupId];
    if (!snapshot) {
      return false;
    }

    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...current,
          savingMenuTexts: true,
          error: null,
        },
      };
    });

    const payload = MENU_TEXT_KEYS.reduce<BotGroupMenuTexts>((acc, key) => {
      const draftValue = snapshot.draftMenuTexts?.[key] ?? "";
      acc[key] = normalizeMenuDraftEntries(draftValue);
      return acc;
    }, { ...DEFAULT_MENU_TEXTS });

    return await updateGroupSettings(groupId, { menuTexts: payload });
  };

  const handleMenuTextsReset = (groupId: number) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }

      const defaultDrafts = MENU_TEXT_KEYS.reduce<Record<MenuTextKey, string>>((acc, key) => {
        const defaults = DEFAULT_MENU_TEXTS[key] ?? [];
        acc[key] = defaults.length ? defaults.join("\n") : "";
        return acc;
      }, { ...EMPTY_MENU_DRAFTS });

      const nextDirty = MENU_TEXT_KEYS.reduce<Record<MenuTextKey, boolean>>((acc, key) => {
        const existing = current.settings?.menuTexts?.[key] ?? [];
        const defaults = normalizeMenuDraftEntries(defaultDrafts[key]);
        acc[key] = JSON.stringify(defaults) !== JSON.stringify(existing);
        return acc;
      }, { ...EMPTY_MENU_DIRTY });

      return {
        ...prev,
        [groupId]: {
          ...current,
          draftMenuTexts: defaultDrafts,
          dirtyMenuTexts: nextDirty,
        },
      };
    });
  };

  const handleAiModelChange = (groupId: number, value: string | null) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    const next = normalized.length > 0 ? normalized : DEFAULT_GROQ_MODEL;
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      const currentModel = current.settings?.aiModel ?? DEFAULT_GROQ_MODEL;
      return {
        ...prev,
        [groupId]: {
          ...current,
          draftAiModel: next,
          dirtyAiModel: next !== currentModel,
        },
      };
    });
  };

  const handleAiModelSave = async (groupId: number): Promise<boolean> => {
    const snapshot = settingsState[groupId];
    if (!snapshot) {
      return false;
    }

    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...current,
          savingAiModel: true,
          error: null,
        },
      };
    });

    const success = await updateGroupSettings(groupId, {
      aiModel: snapshot.draftAiModel ?? DEFAULT_GROQ_MODEL,
    });

    if (!success) {
      setSettingsState((prev) => {
        const current = prev[groupId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [groupId]: {
            ...current,
            savingAiModel: false,
          },
        };
      });
    }

    return success;
  };

  const handleAutoResponsesSave = async (
    groupId: number,
    entries: BotGroupAutoResponse[],
  ) => {
    const sanitized = sanitizeAutoResponses(entries);

    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...current,
          draftAutoResponses: copyAutoResponses(sanitized),
          dirtyAutoResponses: true,
          savingAutoResponses: true,
          error: null,
        },
      };
    });

    const success = await updateGroupSettings(groupId, { autoResponses: sanitized });

    if (!success) {
      setSettingsState((prev) => {
        const current = prev[groupId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [groupId]: {
            ...current,
            savingAutoResponses: false,
          },
        };
      });
    }

    return success;
  };

  // Upload autoresponse media directly via the helper to avoid any
  // potential reference issues from indirection in the browser bundle.
  const applyCommandToggle = async (
    groupId: number,
    key: keyof BotGroupCommandToggles,
    value: boolean,
    previousValue: boolean,
  ) => {
    try {
      let response = await fetch(`/api/bot-groups/${groupId}/commands`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: key, value }),
      });
      let data: any = await response.json().catch(() => ({}));
      // Fallback: se /commands não existir, envia via /:id usando commandToggles
      if (response.status === 404 || response.status === 405) {
        response = await fetch(`/api/bot-groups/${groupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commandToggles: { [key]: value } }),
        });
        data = await response.json().catch(() => ({}));
      }
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar as ativações do grupo.",
        );
      }

      const toggles = data.toggles as BotGroupCommandToggles | undefined;
      setSettingsState((prev) => {
        const current = prev[groupId];
        if (!current?.settings) {
          return prev;
        }
        return {
          ...prev,
          [groupId]: {
            ...current,
            savingCommands: false,
            settings: {
              ...current.settings,
              commandToggles:
                toggles ?? {
                  ...current.settings.commandToggles,
                  [key]: value,
                },
            },
            error: null,
          },
        };
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar as ativações do grupo.";
      console.error('[commands] toggle failed', { groupId, key, value, error });
      setSettingsState((prev) => {
        const current = prev[groupId];
        if (!current?.settings) {
          return prev;
        }
        return {
          ...prev,
          [groupId]: {
            ...current,
            savingCommands: false,
            settings: {
              ...current.settings,
              commandToggles: {
                ...current.settings.commandToggles,
                [key]: previousValue,
              },
            },
            error: message,
          },
        };
      });
    }
  };

  const handleCommandToggleChange = (
    groupId: number,
    key: keyof BotGroupCommandToggles,
    value: boolean,
  ) => {
    const snapshot = settingsState[groupId];
    if (!snapshot?.settings) {
      return;
    }

    const previousValue = snapshot.settings.commandToggles[key] ?? false;

    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current?.settings) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...current,
          savingCommands: true,
          settings: {
            ...current.settings,
            commandToggles: {
              ...current.settings.commandToggles,
              [key]: value,
            },
          },
          error: null,
        },
      };
    });

    void applyCommandToggle(groupId, key, value, previousValue);
  };

  const handleWelcomeCaptionChange = (groupId: number, value: string) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      const draftMedia = current.draftWelcomeMediaUrl ?? "";
      const draftSticker = current.draftWelcomeAsSticker ?? false;
      const attachmentsDraft = current.draftWelcomeAttachments;
      const dirty = computeWelcomeDirty(current.settings, value, draftMedia, draftSticker, attachmentsDraft);
      return {
        ...prev,
        [groupId]: {
          ...current,
          draftWelcomeCaption: value,
          dirtyWelcome: dirty,
        },
      };
    });
  };

  const handleWelcomeMediaUrlChange = (groupId: number, value: string) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      const draftCaption = current.draftWelcomeCaption ?? "";
      const draftSticker = current.draftWelcomeAsSticker ?? false;
      const attachmentsDraft = current.draftWelcomeAttachments;
      const dirty = computeWelcomeDirty(current.settings, draftCaption, value, draftSticker, attachmentsDraft);
      return {
        ...prev,
        [groupId]: {
          ...current,
          draftWelcomeMediaUrl: value,
          dirtyWelcome: dirty,
        },
      };
    });
  };

  const handleWelcomeAsStickerChange = (groupId: number, value: boolean) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      const draftCaption = current.draftWelcomeCaption ?? "";
      const draftMedia = current.draftWelcomeMediaUrl ?? "";
      const attachmentsDraft = current.draftWelcomeAttachments;
      const dirty = computeWelcomeDirty(current.settings, draftCaption, draftMedia, value, attachmentsDraft);
      return {
        ...prev,
        [groupId]: {
          ...current,
          draftWelcomeAsSticker: value,
          dirtyWelcome: dirty,
        },
      };
    });
  };

  const handleWelcomeSave = async (groupId: number) => {
    const current = settingsState[groupId];
    if (!current) {
      return;
    }

    setSettingsState((prev) => {
      const snapshot = prev[groupId];
      if (!snapshot) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...snapshot,
          savingWelcome: true,
          error: null,
        },
      };
    });

    const caption = normalizeWelcomeCaption(current.draftWelcomeCaption ?? "");
    const mediaUrl = normalizeWelcomeMediaUrl(current.draftWelcomeMediaUrl ?? "");
    const asSticker = current.draftWelcomeAsSticker ?? false;

    const attachments = sanitizeWelcomeAttachments(
      current.draftWelcomeAttachments ?? current.settings?.welcomeConfig.attachments,
    );

    const success = await updateGroupSettings(groupId, {
      welcomeConfig: {
        caption,
        mediaUrl: mediaUrl ? mediaUrl : null,
        asSticker,
        attachments,
      },
    });

    if (!success) {
      setSettingsState((prev) => {
        const snapshot = prev[groupId];
        if (!snapshot) {
          return prev;
        }
        return {
          ...prev,
          [groupId]: {
            ...snapshot,
            savingWelcome: false,
          },
        };
      });
    }
  };

  const handleWelcomeToggle = async (groupId: number, value: boolean) => {
    // Garante que temos settings carregados
    if (!settingsState[groupId]?.settings) {
      await loadGroupSettings(groupId);
    }

    const snap = settingsState[groupId];
    const base = snap?.settings;
    if (!base) return;

    const caption = normalizeWelcomeCaption(
      snap?.draftWelcomeCaption ?? base.welcomeConfig.caption ?? "",
    );
    const mediaUrl = normalizeWelcomeMediaUrl(
      snap?.draftWelcomeMediaUrl ?? base.welcomeConfig.mediaUrl ?? "",
    );
    const asSticker = snap?.draftWelcomeAsSticker ?? base.welcomeConfig.asSticker ?? false;
    const attachments = sanitizeWelcomeAttachments(
      snap?.draftWelcomeAttachments ?? base.welcomeConfig.attachments,
    );

    const prevEnabled = base.welcomeConfig.enabled ?? false;
    const prevToggle = base.commandToggles.bemvindo ?? false;

    // Optimistic update + spinner
    setSettingsState((prev) => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        savingWelcome: true,
        settings: {
          ...base,
          welcomeConfig: { ...base.welcomeConfig, enabled: value },
          commandToggles: { ...base.commandToggles, bemvindo: value },
        },
        error: null,
      },
    }));

    try {
      // Tenta ajustar o toggle via /commands, com fallback para /:id
      try {
        let r = await fetch(`/api/bot-groups/${groupId}/commands`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "bemvindo", value }),
        });
        if (r.status === 404 || r.status === 405) {
          r = await fetch(`/api/bot-groups/${groupId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commandToggles: { bemvindo: value } }),
          });
        }
      } catch (e) {
        console.error("[welcomeToggle] command route error", e);
      }

      const ok = await updateGroupSettings(groupId, {
        welcomeConfig: { caption, mediaUrl: mediaUrl || null, asSticker, enabled: value, attachments },
        commandToggles: { bemvindo: value },
      });

      if (!ok) {
        throw new Error("Falha ao gravar config de boas-vindas");
      }
    } catch (e) {
      // Reverte em caso de erro e mostra erro
      setSettingsState((prev) => ({
        ...prev,
        [groupId]: {
          ...prev[groupId],
          savingWelcome: false,
          settings: {
            ...base,
            welcomeConfig: { ...base.welcomeConfig, enabled: prevEnabled },
            commandToggles: { ...base.commandToggles, bemvindo: prevToggle },
          },
          error:
            e instanceof Error
              ? e.message
              : "Não foi possível atualizar as configurações do bem-vindo.",
        },
      }));
      return;
    }

    // Sucesso: encerra spinner
    setSettingsState((prev) => ({
      ...prev,
      [groupId]: { ...prev[groupId], savingWelcome: false },
    }));
  };

  const addWelcomeAttachment = (groupId: number) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) return prev;
      const list = Array.isArray(current.draftWelcomeAttachments)
        ? [...current.draftWelcomeAttachments]
        : [];
      list.push({ kind: "image", url: null, path: null, fileName: null, mimeType: null, caption: null } as any);
      const draftCaption = current.draftWelcomeCaption ?? "";
      const draftMedia = current.draftWelcomeMediaUrl ?? "";
      const draftSticker = current.draftWelcomeAsSticker ?? false;
      const dirty = computeWelcomeDirty(current.settings, draftCaption, draftMedia, draftSticker, list);
      return { ...prev, [groupId]: { ...current, draftWelcomeAttachments: list, dirtyWelcome: dirty } };
    });
  };

  const removeWelcomeAttachment = (groupId: number, index: number) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current?.draftWelcomeAttachments) return prev;
      const list = [...current.draftWelcomeAttachments];
      const removed = list.splice(index, 1)[0] as any;
      // best-effort cleanup previously uploaded file
      const mediaPath = removed?.path;
      if (typeof mediaPath === "string" && mediaPath) {
        // Fire and forget – backend route valida e remove o arquivo do disco
        fetch(`/api/bot-groups/${groupId}/welcome-attachments/upload`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: mediaPath }),
        }).catch(() => {});
      }
      const draftCaption = current.draftWelcomeCaption ?? "";
      const draftMedia = current.draftWelcomeMediaUrl ?? "";
      const draftSticker = current.draftWelcomeAsSticker ?? false;
      const dirty = computeWelcomeDirty(current.settings, draftCaption, draftMedia, draftSticker, list);
      return { ...prev, [groupId]: { ...current, draftWelcomeAttachments: list, dirtyWelcome: dirty } };
    });
  };

  const setWelcomeAttachment = (groupId: number, index: number, patch: Record<string, unknown>) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) return prev;
      const list = Array.isArray(current.draftWelcomeAttachments)
        ? [...current.draftWelcomeAttachments]
        : [];
      const item = { ...(list[index] as any) };
      Object.assign(item, patch);
      list[index] = item;
      const draftCaption = current.draftWelcomeCaption ?? "";
      const draftMedia = current.draftWelcomeMediaUrl ?? "";
      const draftSticker = current.draftWelcomeAsSticker ?? false;
      const dirty = computeWelcomeDirty(current.settings, draftCaption, draftMedia, draftSticker, list);
      return { ...prev, [groupId]: { ...current, draftWelcomeAttachments: list, dirtyWelcome: dirty } };
    });
  };

  const moveWelcomeAttachment = (groupId: number, index: number, direction: "up" | "down") => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) return prev;
      const list = Array.isArray(current.draftWelcomeAttachments)
        ? [...current.draftWelcomeAttachments]
        : [];
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || index >= list.length || nextIndex < 0 || nextIndex >= list.length) {
        return prev;
      }
      const [item] = list.splice(index, 1);
      list.splice(nextIndex, 0, item);
      const draftCaption = current.draftWelcomeCaption ?? "";
      const draftMedia = current.draftWelcomeMediaUrl ?? "";
      const draftSticker = current.draftWelcomeAsSticker ?? false;
      const dirty = computeWelcomeDirty(current.settings, draftCaption, draftMedia, draftSticker, list);
      return { ...prev, [groupId]: { ...current, draftWelcomeAttachments: list, dirtyWelcome: dirty } };
    });
  };

  const handleWelcomeClearMedia = async (groupId: number) => {
    const current = settingsState[groupId];
    if (!current) {
      return;
    }

    const storedMedia =
      current.settings?.welcomeConfig.mediaUrl ?? current.settings?.welcomeConfig.mediaPath ?? "";

    setSettingsState((prev) => {
      const snapshot = prev[groupId];
      if (!snapshot) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...snapshot,
          draftWelcomeMediaUrl: "",
          dirtyWelcome: computeWelcomeDirty(
            snapshot.settings,
            snapshot.draftWelcomeCaption ?? "",
            "",
            snapshot.draftWelcomeAsSticker ?? false,
            snapshot.draftWelcomeAttachments,
          ),
        },
      };
    });

    if (!storedMedia) {
      return;
    }

    setSettingsState((prev) => {
      const snapshot = prev[groupId];
      if (!snapshot) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...snapshot,
          savingWelcome: true,
          error: null,
        },
      };
    });

    const success = await updateGroupSettings(groupId, {
      welcomeConfig: { mediaUrl: null, mediaPath: null },
    });

    if (!success) {
      setSettingsState((prev) => {
        const snapshot = prev[groupId];
        if (!snapshot?.settings) {
          return prev;
        }
        return {
          ...prev,
          [groupId]: {
            ...snapshot,
            savingWelcome: false,
          draftWelcomeMediaUrl: snapshot.settings.welcomeConfig.mediaUrl ?? "",
          dirtyWelcome: computeWelcomeDirty(
            snapshot.settings,
            snapshot.draftWelcomeCaption ?? "",
            snapshot.settings.welcomeConfig.mediaUrl ?? "",
            snapshot.draftWelcomeAsSticker ?? false,
            snapshot.draftWelcomeAttachments,
          ),
          uploadingWelcomeMedia: false,
        },
      };
      });
    }
  };

  const handleWelcomeMediaUpload = async (groupId: number, file: File) => {
    setSettingsState((prev) => {
      const current = prev[groupId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          ...current,
          uploadingWelcomeMedia: true,
          error: null,
        },
      };
    });

    try {
      const formData = new FormData();
      formData.append("media", file);

      const response = await fetch(`/api/bot-groups/${groupId}/welcome-media`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível enviar a mídia de boas-vindas.",
        );
      }

      const settings = data.settings as BotGroupSettings;
      setSettingsState((prev) => ({
        ...prev,
        [groupId]: {
          loading: false,
          saving: false,
          settings,
          draftCommandPrefixes:
            settings.commandPrefixes.length ? settings.commandPrefixes.join("\n") : "",
          draftAllowedLinks: settings.allowedLinks.length ? settings.allowedLinks.join("\n") : "",
          draftAllowedDdis: settings.allowedDdis.length ? settings.allowedDdis.join("\n") : "",
          draftBannedWords: settings.bannedWords.length ? settings.bannedWords.join("\n") : "",
          dirtyCommandPrefixes: false,
          dirtyAllowedLinks: false,
          dirtyAllowedDdis: false,
          dirtyBannedWords: false,
          draftWelcomeCaption: normalizeWelcomeCaption(settings.welcomeConfig.caption ?? ""),
          draftWelcomeMediaUrl: settings.welcomeConfig.mediaUrl ?? "",
          draftWelcomeAsSticker: settings.welcomeConfig.asSticker ?? false,
          draftWelcomeAttachments: cloneWelcomeAttachments(settings.welcomeConfig.attachments),
          dirtyWelcome: false,
          savingCommands: false,
          savingWelcome: false,
          draftMenuTexts: buildMenuDraftsFromSettings(settings),
          dirtyMenuTexts: { ...EMPTY_MENU_DIRTY },
          savingMenuTexts: false,
          uploadingWelcomeMedia: false,
          error: null,
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a mídia de boas-vindas.";
      setSettingsState((prev) => {
        const current = prev[groupId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [groupId]: {
            ...current,
            uploadingWelcomeMedia: false,
            error: message,
          },
        };
      });
    }
  };

  const uploadWelcomeAttachment = async (
    groupId: number,
    file: File,
    options: { mediaType: BotGroupAutoResponseMedia["mediaType"]; previousPath?: string | null },
  ): Promise<{ path: string; mimeType: string | null; fileName: string | null }> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mediaType", options.mediaType);
    if (options.previousPath) {
      formData.append("previousPath", options.previousPath);
    }
    const response = await fetch(`/api/bot-groups/${groupId}/welcome-attachments/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof data.message === "string" ? data.message : "Não foi possível enviar o anexo de boas-vindas.",
      );
    }
    const media = (data.media ?? {}) as Record<string, unknown>;
    const path = typeof media.path === "string" ? media.path.trim() : "";
    if (!path) throw new Error("Retorno inválido ao salvar anexo de boas-vindas.");
    const mimeType = typeof media.mimeType === "string" ? media.mimeType : null;
    const fileName = typeof media.fileName === "string" ? media.fileName : null;
    return { path, mimeType, fileName };
  };

  const totalGroups = groupsState.length;
  const groupLimit = planLimits.groupLimit;
  const planActive = planStatus.status === "active";
  const limitReached = planActive && groupLimit !== 0 && totalGroups >= groupLimit;
  const canCreate =
    planActive &&
    instances.length > 0 &&
    (groupLimit === 0 || totalGroups < groupLimit);

  useEffect(() => {
    if (!limitReached && showLimitModal) {
      setShowLimitModal(false);
    }
  }, [limitReached, showLimitModal]);

  const limitLabel = useMemo(() => {
    if (!planActive) {
      return "Plano inativo";
    }

    if (groupLimit === 0) {
      return `${totalGroups} grupos cadastrados (ilimitado)`;
    }

    return `${totalGroups} de ${groupLimit} grupos disponíveis`;
  }, [planActive, groupLimit, totalGroups]);

  const createDisabledReason = useMemo(() => {
    if (!planActive) {
      return "Ative seu plano para vincular novos grupos.";
    }
    if (instances.length === 0) {
      return "Cadastre e conecte uma instância antes de adicionar grupos.";
    }
    if (groupLimit !== 0 && totalGroups >= groupLimit) {
      return "Você atingiu o limite de grupos disponível no momento.";
    }
    return null;
  }, [instances.length, planActive, groupLimit, totalGroups]);

  const handleCreate = async ({
    instanceId,
    invite,
  }: {
    instanceId: number | null;
    invite: string;
  }): Promise<{ success: boolean; feedback: Feedback }> => {
    setFeedback(null);

    if (!instanceId) {
      const result: Feedback = {
        type: "danger",
        message: "Selecione a instância do bot que irá participar do grupo.",
      };
      setFeedback(result);
      return { success: false, feedback: result };
    }

    const sanitizedInvite = invite.trim();
    if (!sanitizedInvite) {
      const result: Feedback = {
        type: "danger",
        message: "Informe o link de convite do grupo.",
      };
      setFeedback(result);
      return { success: false, feedback: result };
    }

    if (!canCreate) {
      const result: Feedback = {
        type: "warning",
        message:
          createDisabledReason ??
          "Você atingiu o limite de grupos disponível no momento. Ajuste seu plano ou remova um grupo existente.",
      };
      setFeedback(result);
      return { success: false, feedback: result };
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/bot-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId,
          invite: sanitizedInvite,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const result: Feedback = {
          type: "danger",
          message: data.message ?? "Não foi possível vincular o grupo.",
        };
        setFeedback(result);
        return { success: false, feedback: result };
      }

      const result: Feedback = {
        type: "success",
        message: data.message ?? "Grupo vinculado com sucesso.",
      };
      setFeedback(result);
      router.refresh();
      return { success: true, feedback: result };
    } catch (error) {
      console.error("Failed to create bot group", error);
      const result: Feedback = {
        type: "danger",
        message: "Erro inesperado ao vincular o grupo.",
      };
      setFeedback(result);
      return { success: false, feedback: result };
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (group: BotGroup) => {
    const confirmation = window.confirm(
      `Remover o grupo "${group.name}"? Essa ação não pode ser desfeita.`,
    );
    if (!confirmation) {
      return;
    }

    setPendingGroupId(group.id);
    setFeedback(null);

    try {
      const response = await fetch(`/api/bot-groups/${group.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível remover o grupo.",
        });
        setPendingGroupId(null);
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Grupo removido com sucesso.",
      });
      setGroupsState((prev) => {
        const next = prev.filter((item) => item.id !== group.id);
        setSelectedGroupId((current) => {
          if (current === group.id) {
            return next.length > 0 ? next[0].id : null;
          }
          return current;
        });
        return next;
      });
    } catch (error) {
      console.error("Failed to delete bot group", error);
      setFeedback({
        type: "danger",
        message: "Erro inesperado ao remover o grupo.",
      });
    } finally {
      setPendingGroupId(null);
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {feedback ? (
        <Alert
          variant={feedback.type}
          onClose={() => setFeedback(null)}
          dismissible
        >
          {feedback.message}
        </Alert>
      ) : null}

      <div className="d-flex justify-content-end align-items-center gap-2 w-100">
        <Button
          variant="primary"
          onClick={handleOpenCreateModal}
          disabled={isSubmitting}
          className="rounded-pill px-4 py-2 shadow-sm"
          title={createDisabledReason ?? undefined}
        >
          {isSubmitting ? (
            <span className="d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" role="status" />
              Processando...
            </span>
          ) : (
            "Novo grupo"
          )}
        </Button>
      </div>

      <GroupMiniViews
        groups={groupsState}
        selectedGroupId={selectedGroupId}
        group={
          selectedGroupId !== null
            ? groupsState.find((group) => group.id === selectedGroupId) ?? null
            : null
        }
        state={selectedGroupId !== null ? settingsState[selectedGroupId] : undefined}
        activeView={activeMiniView}
        onSelectGroup={handleSelectGroup}
        onViewChange={handleMiniViewChange}
        onGroupUpdated={handleGroupUpdated}
        limitLabel={limitLabel}
        deletingGroupId={pendingGroupId}
        tutorials={tutorials}
        restApiKey={restApiKey}
        onDeleteGroup={handleDelete}
        onToggle={(patch) =>
          selectedGroupId !== null
            ? updateGroupSettings(selectedGroupId, patch)
            : Promise.resolve(true)
        }
        onCommandPrefixesChange={handleCommandPrefixesChange}
        onCommandPrefixesSave={handleCommandPrefixesSave}
        onAllowedLinksChange={handleAllowedLinksChange}
        onAllowedLinksSave={handleAllowedLinksSave}
        onAllowedDdisChange={handleAllowedDdisChange}
        onAllowedDdisSave={handleAllowedDdisSave}
        onAntifakeMessageChange={handleAntifakeMessageChange}
        onBannedWordsChange={handleBannedWordsChange}
        onBannedWordsSave={handleBannedWordsSave}
        onBannedWordsBanChange={handleBannedWordsBanChange}
        onBannedWordsLimitChange={handleBannedWordsLimitChange}
        onMenuTextChange={handleMenuTextChange}
        onMenuTextsSave={handleMenuTextsSave}
        onMenuTextsReset={handleMenuTextsReset}
        onAutoResponsesSave={handleAutoResponsesSave}
        onAiModelChange={handleAiModelChange}
        onAiModelSave={handleAiModelSave}
        onCommandToggleChange={handleCommandToggleChange}
        onWelcomeCaptionChange={handleWelcomeCaptionChange}
        onWelcomeMediaUrlChange={handleWelcomeMediaUrlChange}
        onWelcomeAsStickerChange={handleWelcomeAsStickerChange}
        onWelcomeSave={handleWelcomeSave}
        onWelcomeToggle={handleWelcomeToggle}
        onWelcomeClearMedia={handleWelcomeClearMedia}
        onWelcomeMediaUpload={handleWelcomeMediaUpload}
        onWelcomeAttachmentAdd={addWelcomeAttachment}
        onWelcomeAttachmentRemove={removeWelcomeAttachment}
        onWelcomeAttachmentMove={moveWelcomeAttachment}
        onWelcomeAttachmentPatch={setWelcomeAttachment}
        onWelcomeAttachmentUpload={uploadWelcomeAttachment}
        onReloadSettings={loadGroupSettings}
        onUnknownCommandTemplateChange={handleUnknownCommandChange}
        onUnknownCommandTemplateSave={handleUnknownCommandSave}
      />

      <Modal show={showLimitModal} onHide={() => setShowLimitModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Limite de grupos atingido</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="mb-0">
            Você já vinculou todos os grupos disponíveis no seu plano atual.
            Para adicionar novos grupos, contrate um pacote com mais vagas.
          </p>
          <div className="bg-body-tertiary rounded p-3">
            <strong className="d-block">Grupos utilizados</strong>
            <span className="text-secondary">
              {groupLimit === 0
                ? `${totalGroups} grupos cadastrados (plano ilimitado)`
                : `${totalGroups} de ${groupLimit} grupos`}
            </span>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowLimitModal(false)}>
            Agora não
          </Button>
          <Button as={Link} href="/dashboard/user?section=conversations" variant="primary" onClick={() => setShowLimitModal(false)}>
            Ver opções de plano
          </Button>
        </Modal.Footer>
      </Modal>

      <CreateGroupModal
        show={showCreateModal}
        onHide={handleCloseCreateModal}
        instances={instances}
        onSubmit={handleCreate}
        isSubmitting={isSubmitting}
        canCreate={canCreate}
        disabledReason={createDisabledReason}
        planActive={planActive}
        onViewPlans={handleViewPlans}
      />
    </div>
  );
};

type GroupMiniViewsProps = {
  groups: BotGroup[];
  selectedGroupId: number | null;
  group: BotGroup | null;
  state?: GroupSettingsUiState;
  activeView: GroupMiniViewKey | null;
  onSelectGroup: (groupId: number) => void;
  onViewChange: (view: GroupMiniViewKey) => void | Promise<void>;
  onGroupUpdated: (group: BotGroup) => void;
  limitLabel: string;
  deletingGroupId: number | null;
  tutorials: FieldTutorialMap;
  restApiKey: string;
  onDeleteGroup: (group: BotGroup) => void | Promise<void>;
  onToggle: (
    patch: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">>,
  ) => Promise<boolean>;
  onCommandPrefixesChange: (groupId: number, value: string) => void;
  onCommandPrefixesSave: (groupId: number) => Promise<boolean>;
  onAllowedLinksChange: (groupId: number, value: string) => void;
  onAllowedLinksSave: (groupId: number) => Promise<boolean>;
  onAllowedDdisChange: (groupId: number, value: string) => void;
  onAllowedDdisSave: (groupId: number) => Promise<boolean>;
  onAntifakeMessageChange: (groupId: number, value: string) => void;
  onBannedWordsChange: (groupId: number, value: string) => void;
  onBannedWordsSave: (groupId: number) => Promise<boolean>;
  onBannedWordsBanChange: (groupId: number, value: boolean) => void;
  onBannedWordsLimitChange: (groupId: number, value: string) => void;
  onMenuTextChange: (groupId: number, key: MenuTextKey, value: string) => void;
  onMenuTextsSave: (groupId: number) => Promise<boolean>;
  onMenuTextsReset: (groupId: number) => void;
  onAutoResponsesSave: (
    groupId: number,
    entries: BotGroupAutoResponse[],
  ) => Promise<boolean>;
  onAiModelChange: (groupId: number, value: string | null) => void;
  onAiModelSave: (groupId: number) => Promise<boolean>;
  onCommandToggleChange: (
    groupId: number,
    key: keyof BotGroupCommandToggles,
    value: boolean,
  ) => void;
  onWelcomeCaptionChange: (groupId: number, value: string) => void;
  onWelcomeMediaUrlChange: (groupId: number, value: string) => void;
  onWelcomeAsStickerChange: (groupId: number, value: boolean) => void;
  onWelcomeSave: (groupId: number) => void;
  onWelcomeToggle: (groupId: number, value: boolean) => void;
  onWelcomeClearMedia: (groupId: number) => void;
  onWelcomeMediaUpload: (groupId: number, file: File) => void;
  onWelcomeAttachmentAdd: (groupId: number) => void;
  onWelcomeAttachmentRemove: (groupId: number, index: number) => void;
  onWelcomeAttachmentMove: (groupId: number, index: number, direction: "up" | "down") => void;
  onWelcomeAttachmentPatch: (groupId: number, index: number, patch: Record<string, unknown>) => void;
  onWelcomeAttachmentUpload: (
    groupId: number,
    file: File,
    options: { mediaType: BotGroupAutoResponseMedia["mediaType"]; previousPath?: string | null },
  ) => Promise<{ path: string; mimeType: string | null; fileName: string | null }>;
  onReloadSettings: (groupId: number) => Promise<void> | void;
  onUnknownCommandTemplateChange: (groupId: number, value: string) => void;
  onUnknownCommandTemplateSave: (groupId: number) => void | Promise<void>;
};

const extractParticipantDigits = (jid: string): string | null => {
  if (!jid) {
    return null;
  }
  const digits = jid.replace(/@.+$/, "").replace(/\D/g, "");
  return digits || null;
};

const formatParticipantPhoneNumber = (digits: string | null): string | null => {
  if (!digits) {
    return null;
  }

  if (digits.length === 13) {
    return digits.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 ($2) $3-$4");
  }

  if (digits.length === 12) {
    return digits.replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, "+$1 ($2) $3-$4");
  }

  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }

  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }

  return `+${digits}`;
};

const formatSweepstakeParticipant = (
  participant: BotSweepstake["participants"][number],
): string => {
  const displayName = participant.displayName?.trim();
  const digits = extractParticipantDigits(participant.jid);
  const phoneNumber = formatParticipantPhoneNumber(digits);

  if (displayName && phoneNumber) {
    return `${displayName} (${phoneNumber})`;
  }

  if (displayName && digits) {
    return `${displayName} (@${digits})`;
  }

  if (displayName) {
    return displayName;
  }

  if (phoneNumber) {
    return phoneNumber;
  }

  if (digits) {
    return `@${digits}`;
  }

  return "Participante";
};

const formatTimeRemaining = (iso: string | null): string => {
  if (!iso) {
    return "";
  }
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return "";
  }
  const diff = timestamp - Date.now();
  if (diff <= 0) {
    return "";
  }
  const totalSeconds = Math.floor(diff / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
};

type GroupSweepstakesPanelProps = {
  group: BotGroup;
  tutorial?: FieldTutorialMap[string];
  feedback: Feedback;
  onFeedback: (feedback: Feedback) => void;
};

type GroupSweepstakesState = {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  active: BotSweepstake[];
  history: BotSweepstake[];
  requiresSync: boolean;
};

const INITIAL_SWEEPSTAKES_STATE: GroupSweepstakesState = {
  loading: true,
  refreshing: false,
  error: null,
  active: [],
  history: [],
  requiresSync: false,
};

const DEFAULT_SWEEPSTAKES_HISTORY_LIMIT = 20;

const GroupSweepstakesPanel = ({ group, tutorial, feedback, onFeedback }: GroupSweepstakesPanelProps) => {
  const [state, setState] = useState<GroupSweepstakesState>({ ...INITIAL_SWEEPSTAKES_STATE });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({
    question: "",
    durationValue: "60",
    durationUnit: "m",
    maxParticipants: "100",
    winnersCount: "1",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [processing, setProcessing] = useState<{
    id: number | null;
    action: "finalize" | "cancel" | "delete" | null;
  }>({ id: null, action: null });

  const loadSweepstakes = useCallback(
    async (options?: { silent?: boolean }) => {
      setState((previous) => ({
        ...previous,
        loading: options?.silent ? previous.loading : true,
        refreshing: options?.silent ? true : false,
        error: null,
      }));

      try {
        const params = new URLSearchParams();
        if (DEFAULT_SWEEPSTAKES_HISTORY_LIMIT) {
          params.set("limit", String(DEFAULT_SWEEPSTAKES_HISTORY_LIMIT));
        }
        const query = params.toString();
        const response = await fetch(
          `/api/bot-groups/${group.id}/sweepstakes${query ? `?${query}` : ""}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof data.message === "string"
              ? data.message
              : "Não foi possível carregar os sorteios.",
          );
        }

        setState({
          loading: false,
          refreshing: false,
          error: null,
          active: Array.isArray(data.active) ? data.active : [],
          history: Array.isArray(data.history) ? data.history : [],
          requiresSync: Boolean(data.requiresSync),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Não foi possível carregar os sorteios.";
        setState({
          loading: false,
          refreshing: false,
          error: message,
          active: [],
          history: [],
          requiresSync: false,
        });
      }
    },
    [group.id],
  );

  useEffect(() => {
    onFeedback(null);
    setFormError(null);
    setState({ ...INITIAL_SWEEPSTAKES_STATE });
    void loadSweepstakes();
  }, [group.id, loadSweepstakes, onFeedback]);

  const handleRefresh = async () => {
    await loadSweepstakes({ silent: true });
  };

  const handleFormFieldChange = (field: keyof typeof form, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const handleNumericFieldChange = (
    field: "durationValue" | "maxParticipants" | "winnersCount",
    value: string,
  ) => {
    const sanitized = value.replace(/[^0-9]/g, "");
    handleFormFieldChange(field, sanitized);
  };

  const resetForm = () => {
    setForm({
      question: "",
      durationValue: "60",
      durationUnit: form.durationUnit,
      maxParticipants: "100",
      winnersCount: "1",
    });
    setFormError(null);
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = form.question.trim();
    const durationValue = Number.parseInt(form.durationValue, 10);
    const maxParticipants = Number.parseInt(form.maxParticipants, 10);
    const winnersCount = Number.parseInt(form.winnersCount, 10);

    if (!question) {
      setFormError("Informe o título do sorteio.");
      return;
    }
    if (!Number.isFinite(durationValue) || durationValue <= 0) {
      setFormError("Informe um tempo de duração válido.");
      return;
    }
    if (!Number.isFinite(maxParticipants) || maxParticipants <= 0) {
      setFormError("Informe o limite de participantes.");
      return;
    }
    if (!Number.isFinite(winnersCount) || winnersCount <= 0) {
      setFormError("Informe a quantidade de vencedores.");
      return;
    }
    if (winnersCount > maxParticipants) {
      setFormError("O número de vencedores não pode ser maior que o limite de participantes.");
      return;
    }

    setCreating(true);
    setFormError(null);
    onFeedback(null);

    try {
      const response = await fetch(`/api/bot-groups/${group.id}/sweepstakes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          durationValue,
          durationUnit: form.durationUnit,
          maxParticipants,
          winnersCount,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string" ? data.message : "Não foi possível criar o sorteio.",
        );
      }
      onFeedback({
        type: "success",
        message: typeof data.message === "string" ? data.message : "Sorteio criado com sucesso.",
      });
      setShowCreateModal(false);
      resetForm();
      await loadSweepstakes({ silent: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível criar o sorteio.");
    } finally {
      setCreating(false);
    }
  };

  const handleFinalize = async (entry: BotSweepstake) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Deseja sortear agora "${entry.question}"? Os ganhadores serão escolhidos automaticamente.`,
      );
      if (!confirmed) {
        return;
      }
    }

    setProcessing({ id: entry.id, action: "finalize" });
    onFeedback(null);
    try {
      const response = await fetch(
        `/api/bot-groups/${group.id}/sweepstakes/${entry.id}/finalize`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível finalizar o sorteio.",
        );
      }
      onFeedback({
        type: "success",
        message: typeof data.message === "string" ? data.message : "Sorteio finalizado com sucesso.",
      });
      await loadSweepstakes({ silent: true });
    } catch (error) {
      onFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao finalizar o sorteio.",
      });
    } finally {
      setProcessing({ id: null, action: null });
    }
  };

  const handleCancel = async (entry: BotSweepstake) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Tem certeza de que deseja cancelar o sorteio "${entry.question}"?`,
      );
      if (!confirmed) {
        return;
      }
    }

    let reason: string | null = null;
    if (typeof window !== "undefined") {
      const promptValue = window.prompt("Motivo do cancelamento (opcional):");
      if (promptValue && promptValue.trim()) {
        reason = promptValue.trim();
      }
    }

    setProcessing({ id: entry.id, action: "cancel" });
    onFeedback(null);
    try {
      const response = await fetch(
        `/api/bot-groups/${group.id}/sweepstakes/${entry.id}/cancel`,
        {
          method: "POST",
          headers: reason ? { "Content-Type": "application/json" } : undefined,
          body: reason ? JSON.stringify({ reason }) : undefined,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível cancelar o sorteio.",
        );
      }
      onFeedback({
        type: "success",
        message: typeof data.message === "string" ? data.message : "Sorteio cancelado com sucesso.",
      });
      await loadSweepstakes({ silent: true });
    } catch (error) {
      onFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao cancelar o sorteio.",
      });
    } finally {
      setProcessing({ id: null, action: null });
    }
  };

  const handleDelete = async (entry: BotSweepstake) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Remover o sorteio "${entry.question}" do histórico? Esta ação não pode ser desfeita.`,
      );
      if (!confirmed) {
        return;
      }
    }

    setProcessing({ id: entry.id, action: "delete" });
    onFeedback(null);
    try {
      const response = await fetch(`/api/bot-groups/${group.id}/sweepstakes/${entry.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível excluir o sorteio.",
        );
      }
      onFeedback({
        type: "success",
        message: typeof data.message === "string" ? data.message : "Sorteio removido do histórico.",
      });
      await loadSweepstakes({ silent: true });
    } catch (error) {
      onFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao excluir o sorteio.",
      });
    } finally {
      setProcessing({ id: null, action: null });
    }
  };

  const renderActiveSweepstake = (entry: BotSweepstake) => {
    const participantsCount = entry.participants.length;
    const maxParticipants = entry.maxParticipants;
    const expiresLabel = formatDate(entry.expiresAt);
    const timeRemaining = formatTimeRemaining(entry.expiresAt);

    return (
      <div key={entry.id} className="border rounded p-3 bg-body-tertiary">
        <div className="d-flex justify-content-between align-items-start gap-2">
          <div className="d-flex flex-column gap-1">
            <strong className="d-block">{entry.question}</strong>
            <small className="text-secondary">
              Criado em {formatDate(entry.createdAt)} · Encerramento previsto: {expiresLabel}
              {timeRemaining ? ` · Restante: ${timeRemaining}` : ""}
            </small>
            <small className="text-secondary">
              Participantes: {participantsCount}
              {typeof maxParticipants === "number" ? `/${maxParticipants}` : ""} · Ganhadores: {" "}
              {entry.winnersCount}
            </small>
          </div>
          <span className="badge text-bg-success align-self-start">Ativo</span>
        </div>

        <div className="d-flex flex-wrap gap-2 mt-3">
          <Button
            size="sm"
            variant="outline-primary"
            onClick={() => void handleFinalize(entry)}
            disabled={processing.id === entry.id}
          >
            {processing.id === entry.id && processing.action === "finalize" ? (
              <span className="d-inline-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Sorteando…
              </span>
            ) : (
              "Sortear agora"
            )}
          </Button>
          <Button
            size="sm"
            variant="outline-danger"
            onClick={() => void handleCancel(entry)}
            disabled={processing.id === entry.id}
          >
            {processing.id === entry.id && processing.action === "cancel" ? (
              <span className="d-inline-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Cancelando…
              </span>
            ) : (
              "Cancelar sorteio"
            )}
          </Button>
        </div>
      </div>
    );
  };

  const renderHistorySweepstake = (entry: BotSweepstake) => {
    const status = entry.status;
    const statusVariant = status === "completed" ? "text-bg-success" : "text-bg-warning";
    const statusLabel = status === "completed" ? "Encerrado" : "Cancelado";
    const concludedLabel = formatDate(entry.concludedAt ?? entry.updatedAt);
    const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
    const cancelledReason =
      typeof metadata.cancelledReason === "string" && metadata.cancelledReason.trim()
        ? metadata.cancelledReason.trim()
        : null;

    return (
      <div key={entry.id} className="border rounded p-3">
        <div className="d-flex justify-content-between align-items-start gap-2">
          <div className="d-flex flex-column gap-1">
            <strong className="d-block">{entry.question}</strong>
            <small className="text-secondary">
              Encerrado em {concludedLabel} · Participantes: {entry.participants.length}
              {typeof entry.maxParticipants === "number" ? `/${entry.maxParticipants}` : ""}
            </small>
            {entry.status === "completed" && entry.winners.length > 0 ? (
              <div className="text-secondary small">
                Ganhadores: {entry.winners.map((winner) => formatSweepstakeParticipant(winner)).join(", ")}
              </div>
            ) : entry.status === "completed" ? (
              <div className="text-secondary small">Nenhum participante elegível.</div>
            ) : null}
            {cancelledReason ? (
              <div className="text-secondary small">Motivo do cancelamento: {cancelledReason}</div>
            ) : null}
          </div>
          <div className="d-flex align-items-center gap-2">
            <span className={`badge ${statusVariant}`}>{statusLabel}</span>
            <Button
              size="sm"
              variant="outline-danger"
              className="d-inline-flex align-items-center justify-content-center"
              onClick={() => void handleDelete(entry)}
              disabled={processing.id === entry.id}
              aria-label="Excluir sorteio"
            >
              {processing.id === entry.id && processing.action === "delete" ? (
                <Spinner animation="border" size="sm" role="status">
                  <span className="visually-hidden">Excluindo…</span>
                </Spinner>
              ) : (
                <Trash size={14} />
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const canCreate = !state.requiresSync && !state.loading;
  const refreshDisabled = state.loading || state.refreshing;

  return (
    <>
      <Card className="shadow-sm border-0">
        <Card.Header className="bg-body-tertiary">
          <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
            <div className="flex-grow-1">
              <SectionHeading
                title="Sorteios automáticos"
                description="Gerencie os sorteios criados pelo comando do bot diretamente pelo painel."
                tutorial={tutorial}
              />
            </div>
            <div className="d-flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => void handleRefresh()}
                disabled={refreshDisabled}
              >
                {state.refreshing ? (
                  <span className="d-inline-flex align-items-center gap-2">
                    <Spinner animation="border" size="sm" role="status" /> Atualizando…
                  </span>
                ) : (
                  "Atualizar"
                )}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setShowCreateModal(true);
                  setFormError(null);
                }}
                disabled={!canCreate}
              >
                Novo sorteio
              </Button>
            </div>
          </div>
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-3">
          {feedback ? (
            <Alert
              variant={feedback.type}
              onClose={() => onFeedback(null)}
              dismissible
              className="mb-0"
            >
              {feedback.message}
            </Alert>
          ) : null}

          {state.error ? <Alert variant="danger" className="mb-0">{state.error}</Alert> : null}

          {state.requiresSync ? (
            <Alert variant="warning" className="mb-0">
              Conecte este grupo ao WhatsApp para criar e administrar sorteios pelo painel.
            </Alert>
          ) : null}

          {state.loading ? (
            <div className="d-flex justify-content-center py-5">
              <Spinner animation="border" role="status" />
            </div>
          ) : (
            <>
              <div className="d-flex flex-column gap-2">
                <h4 className="h6 mb-0">Sorteios ativos</h4>
                {state.active.length > 0 ? (
                  <div className="d-flex flex-column gap-3">
                    {state.active.map((entry) => renderActiveSweepstake(entry))}
                  </div>
                ) : (
                  <Alert variant="secondary" className="mb-0">
                    Nenhum sorteio ativo no momento.
                  </Alert>
                )}
              </div>

              <div className="d-flex flex-column gap-2">
                <h4 className="h6 mb-0">Histórico recente</h4>
                {state.history.length > 0 ? (
                  <div className="d-flex flex-column gap-3">
                    {state.history.map((entry) => renderHistorySweepstake(entry))}
                  </div>
                ) : (
                  <Alert variant="secondary" className="mb-0">
                    Nenhum sorteio encerrado foi encontrado.
                  </Alert>
                )}
              </div>
            </>
          )}
        </Card.Body>
      </Card>

      <Modal
        show={showCreateModal}
        onHide={() => {
          if (!creating) {
            setShowCreateModal(false);
            setFormError(null);
          }
        }}
        centered
      >
        <Modal.Header closeButton={!creating}>
          <Modal.Title>Novo sorteio</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError ? <Alert variant="danger">{formError}</Alert> : null}
          <Form id="createSweepstakeForm" onSubmit={handleCreateSubmit} className="d-flex flex-column gap-3">
            <Form.Group controlId="sweepstakeQuestion">
              <Form.Label>Título do sorteio</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={form.question}
                onChange={(event) => handleFormFieldChange("question", event.target.value)}
                placeholder="Ex.: Sorteio de Pix de R$50"
                disabled={creating}
                required
              />
            </Form.Group>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="sweepstakeDurationValue">
                  <Form.Label>Duração</Form.Label>
                  <div className="d-flex align-items-center gap-2">
                    <Form.Control
                      type="number"
                      min={1}
                      value={form.durationValue}
                      onChange={(event) => handleNumericFieldChange("durationValue", event.target.value)}
                      disabled={creating}
                      required
                    />
                    <Form.Select
                      value={form.durationUnit}
                      onChange={(event) => handleFormFieldChange("durationUnit", event.target.value)}
                      disabled={creating}
                      style={{ maxWidth: 160 }}
                    >
                      <option value="m">Minutos</option>
                      <option value="h">Horas</option>
                      <option value="d">Dias</option>
                    </Form.Select>
                  </div>
                  <Form.Text className="text-secondary">
                    O comando aceita entre 30 segundos e 7 dias de duração.
                  </Form.Text>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="sweepstakeMaxParticipants">
                  <Form.Label>Limite de participantes</Form.Label>
                  <Form.Control
                    type="number"
                    min={1}
                    value={form.maxParticipants}
                    onChange={(event) => handleNumericFieldChange("maxParticipants", event.target.value)}
                    disabled={creating}
                    required
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group controlId="sweepstakeWinners">
              <Form.Label>Quantidade de ganhadores</Form.Label>
              <Form.Control
                type="number"
                min={1}
                value={form.winnersCount}
                onChange={(event) => handleNumericFieldChange("winnersCount", event.target.value)}
                disabled={creating}
                required
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => { if (!creating) { setShowCreateModal(false); setFormError(null); } }} disabled={creating}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="createSweepstakeForm"
            variant="primary"
            disabled={creating}
          >
            {creating ? (
              <span className="d-inline-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Criando…
              </span>
            ) : (
              "Criar sorteio"
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

type CreateGroupModalProps = {
  show: boolean;
  onHide: () => void;
  instances: BotInstance[];
  onSubmit: (
    payload: { instanceId: number | null; invite: string },
  ) => Promise<{ success: boolean; feedback: Feedback }>;
  isSubmitting: boolean;
  canCreate: boolean;
  disabledReason: string | null;
  planActive: boolean;
  onViewPlans: () => void;
};


const GroupMiniViews = ({
  groups,
  selectedGroupId,
  group,
  state,
  activeView,
  onSelectGroup,
  onViewChange,
  onGroupUpdated,
  limitLabel,
  deletingGroupId,
  onDeleteGroup,
  onToggle,
  onCommandPrefixesChange,
  onCommandPrefixesSave,
  onAllowedLinksChange,
  onAllowedLinksSave,
  onAllowedDdisChange,
  onAllowedDdisSave,
  onAntifakeMessageChange,
  onBannedWordsChange,
  onBannedWordsSave,
  onBannedWordsBanChange,
  onBannedWordsLimitChange,
  onMenuTextChange,
  onMenuTextsSave,
  onMenuTextsReset,
  onAutoResponsesSave,
  onAiModelChange,
  onAiModelSave,
  onCommandToggleChange,
  onWelcomeCaptionChange,
  onWelcomeMediaUrlChange,
  onWelcomeAsStickerChange,
  onWelcomeSave,
  onWelcomeToggle,
  onWelcomeClearMedia,
  onWelcomeMediaUpload,
  onWelcomeAttachmentAdd,
  onWelcomeAttachmentRemove,
  onWelcomeAttachmentMove,
  onWelcomeAttachmentPatch,
  onWelcomeAttachmentUpload,
  onReloadSettings,
  onUnknownCommandTemplateChange,
  onUnknownCommandTemplateSave,
  tutorials,
  restApiKey,
}: GroupMiniViewsProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeConfigModal, setActiveConfigModal] = useState<ConfigModalKey | null>(null);
  const [activeMenuModal, setActiveMenuModal] = useState<MenuTextKey | null>(null);
  const [menuVariablesModalKey, setMenuVariablesModalKey] = useState<MenuTextKey | null>(null);
  const [detailsForm, setDetailsForm] = useState({
    name: "",
    description: "",
    inviteLink: "",
  });
  const [adminsOnly, setAdminsOnly] = useState(false);
  const [locked, setLocked] = useState(false);
  const [ephemeral, setEphemeral] = useState("off");
  const [miniFeedback, setMiniFeedback] = useState<Feedback>(null);
  const [showAiKeyModal, setShowAiKeyModal] = useState(false);
  const [showAiPromptModal, setShowAiPromptModal] = useState(false);
  const [showAiVoiceModal, setShowAiVoiceModal] = useState(false);
  const nativeButtonsAvailable = state?.nativeButtonsAvailable ?? false;
  const [showAutoResponseModal, setShowAutoResponseModal] = useState(false);
  const [autoResponseModalMode, setAutoResponseModalMode] =
    useState<"create" | "edit">("create");
  const [autoResponseDraft, setAutoResponseDraft] = useState<AutoResponseModalDraft>({
    id: "",
    triggers: "",
    responseText: "",
    matchMode: "equals",
    includeMedia: false,
    mediaMode: "none",
    mediaType: "image",
    mediaUrl: "",
    mediaCaption: "",
    mediaPath: "",
    mediaFileName: "",
    mediaMimeType: "",
    mediaFile: null,
    includeVcard: false,
    vcardName: "",
    vcardPhone: "",
    vcardOrganization: "",
    vcardEmail: "",
    vcardCustom: "",
  });
  const [autoResponseOriginal, setAutoResponseOriginal] =
    useState<BotGroupAutoResponse | null>(null);
  const [autoResponseFormError, setAutoResponseFormError] = useState<string | null>(null);
  const [autoResponseUploading, setAutoResponseUploading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aiKeyDraft, setAiKeyDraft] = useState("");
  const [aiPromptDraft, setAiPromptDraft] = useState("");
  const [aiToolsPromptDraft, setAiToolsPromptDraft] = useState("");
  const [aiVoiceDraft, setAiVoiceDraft] = useState("");
  const [savingAiSection, setSavingAiSection] = useState<null | "keys" | "prompt" | "voice">(
    null,
  );
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voicePreviewLoading, setVoicePreviewLoading] = useState(false);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(null);
  const [aiModels, setAiModels] = useState<Array<{ id: string; description?: string | null }>>([]);
  const [aiModelsLoading, setAiModelsLoading] = useState(false);
  const [aiModelsError, setAiModelsError] = useState<string | null>(null);
  const [aiModelsQuota, setAiModelsQuota] = useState<number | null>(null);
  const [savingBasic, setSavingBasic] = useState(false);
  const [savingAdmins, setSavingAdmins] = useState(false);
  const [savingLocked, setSavingLocked] = useState(false);
  const [savingEphemeral, setSavingEphemeral] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [savingBackground, setSavingBackground] = useState(false);
  const [removingBackground, setRemovingBackground] = useState(false);
  const [blacklistModalOpen, setBlacklistModalOpen] = useState(false);
  const [blacklistInput, setBlacklistInput] = useState("");
  const [blacklistFeedback, setBlacklistFeedback] = useState<Feedback>(null);
  const [blacklistProcessing, setBlacklistProcessing] = useState(false);
  const [participants, setParticipants] = useState<BotGroupParticipant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [participantSearch, setParticipantSearch] = useState("");
  const [horapgTimesDraft, setHorapgTimesDraft] = useState("");
  const [horapgEnabledDraft, setHorapgEnabledDraft] = useState(false);
  const [horapgImageUrlDraft, setHorapgImageUrlDraft] = useState("");
  const [horapgMentionAllDraft, setHorapgMentionAllDraft] = useState(false);
  const [horapgTimezoneDraft, setHorapgTimezoneDraft] = useState("");
  const [horapgSaving, setHorapgSaving] = useState(false);
  const [horapgUploading, setHorapgUploading] = useState(false);
  const [horapgFeedback, setHorapgFeedback] = useState<Feedback>(null);
  const [closeTimesDraft, setCloseTimesDraft] = useState("");
  const [openTimesDraft, setOpenTimesDraft] = useState("");
  const [closeEnabledDraft, setCloseEnabledDraft] = useState(false);
  const [openEnabledDraft, setOpenEnabledDraft] = useState(false);
  const [scheduleTimezoneDraft, setScheduleTimezoneDraft] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleFeedback, setScheduleFeedback] = useState<Feedback>(null);
  const [closeTimeInput, setCloseTimeInput] = useState("00:00");
  const [openTimeInput, setOpenTimeInput] = useState("00:00");
  const [helpViewKey, setHelpViewKey] = useState<GroupMiniViewKey | null>(null);

  useEffect(() => {
    if (!searchParams) {
      return;
    }
    const shouldOpen = searchParams.get("openMenu") === "1";
    const rawView = searchParams.get("view");
    const matchedOption = rawView
      ? GROUP_MINI_VIEW_OPTIONS.find((option) => option.key === rawView)
      : undefined;
    if (matchedOption) {
      void onViewChange(matchedOption.key);
    }
    if (shouldOpen) {
      setMobileMenuOpen(true);
    }
    if (shouldOpen || matchedOption) {
      router.replace("/dashboard/user?section=conversations", { scroll: false });
    }
  }, [searchParams, router, onViewChange]);

  useEffect(() => {
    const handleToggle = (event: Event) => {
      const detail = (
        event as CustomEvent<{ action?: "toggle" | "open" | "close"; view?: GroupMiniViewKey }>
      ).detail;
      if (detail?.view) {
        void onViewChange(detail.view);
      }
      if (detail?.action === "open") {
        setMobileMenuOpen(true);
        return;
      }
      if (detail?.action === "close") {
        setMobileMenuOpen(false);
        return;
      }
      setMobileMenuOpen((prev) => !prev);
    };
    window.addEventListener("group-menu-toggle", handleToggle as EventListener);
    return () => window.removeEventListener("group-menu-toggle", handleToggle as EventListener);
  }, [onViewChange]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [group?.id]);

  const settings = state?.settings;
  const groupId = group?.id ?? null;
  const hasSettings = Boolean(settings);
  const groqKeysCount = Array.isArray(settings?.groqKeys) ? settings.groqKeys.length : 0;

  const sanitizeDigits = useCallback((value: string) => value.replace(/\D/g, "").trim(), []);
  const formatDisplayDigits = useCallback(
    (value: string) => {
      const digits = sanitizeDigits(value);
      if (!digits) {
        return value;
      }
      return digits.startsWith("+") ? digits : `+${digits}`;
    },
    [sanitizeDigits],
  );
  const formatMaskedDigits = useCallback(
    (value: string) => {
      const digits = sanitizeDigits(value);
      if (digits.length <= 4) {
        return digits || value;
      }
      const suffix = digits.slice(-4);
      return `****${suffix.padStart(4, "*")}`;
    },
    [sanitizeDigits],
  );

  const loadParticipants = useCallback(async () => {
    if (!group) {
      setParticipants([]);
      setParticipantsError(null);
      return;
    }
    setParticipantsLoading(true);
    setParticipantsError(null);
    try {
      const response = await fetch(`/api/bot-groups/${group.id}/participants`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível carregar os participantes do grupo.",
        );
      }
      const list = Array.isArray(data.participants) ? (data.participants as BotGroupParticipant[]) : [];
      setParticipants(list);
    } catch (error) {
      setParticipants([]);
      setParticipantsError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os participantes do grupo.",
      );
    } finally {
      setParticipantsLoading(false);
    }
  }, [group]);

  const applyBlacklistUpdate = useCallback(
    async (params: { list: string[]; success: string; enforce?: string[] }) => {
      if (!group) {
        return false;
      }
      const sanitizedList = Array.from(
        new Set(params.list.map((entry) => sanitizeDigits(entry)).filter((entry) => entry.length >= 5)),
      );
      const enforceTargets = Array.from(
        new Set((params.enforce ?? []).map((entry) => sanitizeDigits(entry)).filter((entry) => entry.length >= 5)),
      );

      setBlacklistProcessing(true);
      setBlacklistFeedback(null);
      try {
        const response = await fetch(`/api/bot-groups/${group.id}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blacklist: sanitizedList }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof data.message === "string"
              ? data.message
              : "Não foi possível atualizar a lista de bloqueio.",
          );
        }

        if (enforceTargets.length > 0) {
          try {
            const enforcementResponse = await fetch(`/api/bot-groups/${group.id}/blacklist/enforce`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ digits: enforceTargets }),
            });
            const enforcementData = await enforcementResponse.json().catch(() => ({}));
            if (!enforcementResponse.ok) {
              throw new Error(
                typeof enforcementData.message === "string"
                  ? enforcementData.message
                  : "Não foi possível remover os participantes bloqueados agora.",
              );
            }
            const removedCount = Array.isArray(enforcementData.removed)
              ? enforcementData.removed.length
              : 0;
            const failedCount = Array.isArray(enforcementData.failed)
              ? enforcementData.failed.length
              : 0;
            let feedbackText = params.success;
            if (removedCount > 0) {
              feedbackText = `${feedbackText}\n${removedCount === 1 ? "Participante removido imediatamente." : `${removedCount} participantes removidos imediatamente.`}`;
            }
            if (failedCount > 0) {
              feedbackText = `${feedbackText}\n${failedCount === 1 ? "Não foi possível remover um participante (verifique se o bot é administrador)." : `Não foi possível remover ${failedCount} participantes (verifique se o bot é administrador).`}`;
            }
            const feedbackType = failedCount > 0 ? "warning" : "success";
            setBlacklistFeedback({ type: feedbackType, message: feedbackText });
            setMiniFeedback({ type: feedbackType, message: feedbackText });
          } catch (error) {
            setBlacklistFeedback({
              type: "danger",
              message:
                error instanceof Error
                  ? error.message
                  : "Não foi possível remover os participantes bloqueados agora.",
            });
            setMiniFeedback({
              type: "danger",
              message:
                error instanceof Error
                  ? error.message
                  : "Não foi possível remover os participantes bloqueados agora.",
            });
            return false;
          }
        } else {
          setBlacklistFeedback({ type: "success", message: params.success });
          setMiniFeedback({ type: "success", message: params.success });
        }

        await onReloadSettings(group.id);
        return true;
      } catch (error) {
        setBlacklistFeedback({
          type: "danger",
          message:
            error instanceof Error ? error.message : "Não foi possível atualizar a lista de bloqueio.",
        });
        setMiniFeedback({
          type: "danger",
          message:
            error instanceof Error ? error.message : "Não foi possível atualizar a lista de bloqueio.",
        });
        return false;
      } finally {
        setBlacklistProcessing(false);
      }
    },
    [group, onReloadSettings, sanitizeDigits],
  );

  const openBlacklistModal = useCallback(() => {
    setBlacklistInput("");
    setParticipantSearch("");
    setParticipantsError(null);
    setBlacklistFeedback(null);
    setBlacklistModalOpen(true);
    void loadParticipants();
  }, [loadParticipants]);

  const closeBlacklistModal = useCallback(() => {
    if (blacklistProcessing) {
      return;
    }
    setBlacklistModalOpen(false);
    setBlacklistFeedback(null);
    setBlacklistInput("");
    setParticipantSearch("");
  }, [blacklistProcessing]);

  const handleBlacklistRemoval = useCallback(
    async (digits: string) => {
      if (!settings || !group) {
        return;
      }
      const normalized = sanitizeDigits(digits);
      const current = Array.isArray(settings.blacklist) ? settings.blacklist : [];
      if (!current.includes(normalized)) {
        setMiniFeedback({ type: "warning", message: "Este número não está na lista de bloqueio." });
        return;
      }
      const next = current.filter((entry) => entry !== normalized);
      const success = await applyBlacklistUpdate({
        list: next,
        success: "Número removido da lista de bloqueio.",
      });
      if (success) {
        void loadParticipants();
      }
    },
    [applyBlacklistUpdate, group, loadParticipants, sanitizeDigits, settings],
  );

  const handleBlacklistAddManual = useCallback(
    async () => {
      if (!settings || !group) {
        return;
      }
      const normalized = sanitizeDigits(blacklistInput);
      if (normalized.length < 5) {
        setBlacklistFeedback({
          type: "warning",
          message: "Informe o número completo com DDI para adicionar à lista de bloqueio.",
        });
        return;
      }
      const current = Array.isArray(settings.blacklist) ? settings.blacklist : [];
      const alreadyPresent = current.includes(normalized);
      const next = alreadyPresent ? current : [...current, normalized];
      const success = await applyBlacklistUpdate({
        list: next,
        success: alreadyPresent
          ? "Número já estava na lista; tentativa de remoção reaplicada."
          : "Número adicionado à lista de bloqueio.",
        enforce: [normalized],
      });
      if (success) {
        setBlacklistInput("");
        void loadParticipants();
      }
    },
    [applyBlacklistUpdate, blacklistInput, group, loadParticipants, sanitizeDigits, settings],
  );

  const handleBlacklistAddFromParticipants = useCallback(
    async (entries: string[]) => {
      if (!settings || !group) {
        return;
      }
      const current = Array.isArray(settings.blacklist) ? settings.blacklist : [];
      const set = new Set(current);
      let changed = false;
      const enforceList: string[] = [];
      for (const entry of entries) {
        const normalized = sanitizeDigits(entry);
        if (normalized.length < 5) {
          continue;
        }
        enforceList.push(normalized);
        if (!set.has(normalized)) {
          set.add(normalized);
          changed = true;
        }
      }
      if (!changed && enforceList.length === 0) {
        setBlacklistFeedback({ type: "warning", message: "Informe ao menos um participante válido." });
        return;
      }
      const success = await applyBlacklistUpdate({
        list: Array.from(set),
        success: changed
          ? "Lista de bloqueio atualizada."
          : "Lista de bloqueio reaplicada aos participantes selecionados.",
        enforce: enforceList,
      });
      if (success) {
        void loadParticipants();
      }
    },
    [applyBlacklistUpdate, group, loadParticipants, sanitizeDigits, settings],
  );

  const renderActivationTutorialButton = (
    key: keyof typeof GROUP_ACTIVATION_TUTORIAL_SLUG_BY_KEY,
    label: string,
  ) => {
    const tutorial = resolveActivationTutorial(key, tutorials);
    if (!tutorial) {
      return null;
    }
    return (
      <TutorialTrigger
        label={label}
        tutorial={tutorial}
        buttonVariant="outline-secondary"
        buttonSize="sm"
        className="p-1 d-inline-flex align-items-center justify-content-center"
        iconOnly
        ariaLabel={`Abrir tutorial sobre ${label}`}
      />
    );
  };

  const renderActivationLabel = (
    text: string,
    key: keyof typeof GROUP_ACTIVATION_TUTORIAL_SLUG_BY_KEY | null,
    ariaLabel?: string,
  ) => {
    const labelContent = <span className="fw-semibold text-dark">{text}</span>;
    if (!key) {
      return labelContent;
    }
    const button = renderActivationTutorialButton(key, ariaLabel ?? text);
    if (!button) {
      return labelContent;
    }
    return (
      <span className="d-inline-flex align-items-center gap-2">
        {labelContent}
        {button}
      </span>
    );
  };

  useEffect(() => {
    if (activeView !== "botinterage" || !groupId) {
      return;
    }

    if (!hasSettings) {
      return;
    }

    if (groqKeysCount === 0) {
      setAiModels([]);
      setAiModelsQuota(null);
      setAiModelsError("Cadastre ao menos uma chave Groq para listar os modelos disponíveis.");
      setAiModelsLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadModels = async () => {
      setAiModelsLoading(true);
      setAiModelsError(null);
      try {
        const response = await fetch(`/api/groq/models?groupId=${groupId}`, {
          signal: controller.signal,
        });
        let data: any = {};
        try {
          data = await response.json();
        } catch {
          data = {};
        }
        if (!response.ok) {
          throw new Error(
            typeof data.message === "string"
              ? data.message
              : "Não foi possível listar os modelos Groq.",
          );
        }
        if (cancelled) {
          return;
        }
        const models = Array.isArray(data.models) ? data.models : [];
        setAiModels(models);
        setAiModelsQuota(
          typeof data.rateLimitRemaining === "number"
            ? data.rateLimitRemaining
            : null,
        );
        if (data.error?.message) {
          setAiModelsError(String(data.error.message));
        } else {
          setAiModelsError(null);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setAiModels([]);
        setAiModelsQuota(null);
        setAiModelsError(
          err instanceof Error
            ? err.message
            : "Não foi possível listar os modelos Groq.",
        );
      } finally {
        if (!cancelled) {
          setAiModelsLoading(false);
        }
      }
    };

    void loadModels();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeView, groupId, groqKeysCount, hasSettings]);

  useEffect(() => {
    return () => {
      if (voicePreviewUrl) {
        URL.revokeObjectURL(voicePreviewUrl);
      }
    };
  }, [voicePreviewUrl]);

  useEffect(() => {
    if (activeView !== "botinterage") {
      if (voicePreviewUrl) {
        URL.revokeObjectURL(voicePreviewUrl);
        setVoicePreviewUrl(null);
      }
      setVoicePreviewError(null);
      setVoicePreviewLoading(false);
    }
  }, [activeView, group?.id, voicePreviewUrl]);

  // Mantém o formulário de detalhes sempre sincronizado com o grupo selecionado
  useEffect(() => {
    if (!group) {
      setDetailsForm({ name: "", description: "", inviteLink: "" });
      setAdminsOnly(false);
      setLocked(false);
      setEphemeral("off");
      return;
    }
    setDetailsForm({
      name: group.name || "",
      description: group.description ?? "",
      inviteLink: group.inviteLink ?? "",
    });
    setAdminsOnly(Boolean(group.metadata?.adminsOnly));
    setLocked(Boolean(group.metadata?.locked));
    setEphemeral(group.metadata?.ephemeral ?? "off");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  // Atualiza dados em tempo real ao selecionar um grupo (owner, adminsOnly, locked, foto, etc.)
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (!group) return;
      try {
        const response = await fetch(`/api/bot-groups/${group.id}/sync`, {
          method: "POST",
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.group) {
          applyGroupUpdate(data.group as BotGroup);
        }
      } catch {
        // ignora erros transitórios
      }
    };
    void refresh();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  useEffect(() => {
    setParticipants([]);
    setParticipantsError(null);
    setBlacklistFeedback(null);
    setBlacklistInput("");
    setParticipantSearch("");
  }, [group]);

  useEffect(() => {
    if (activeView !== "blacklist") {
      setBlacklistModalOpen(false);
      setBlacklistFeedback(null);
      setBlacklistInput("");
      setParticipantSearch("");
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView === "blacklist" && group) {
      void loadParticipants();
    }
  }, [activeView, group, loadParticipants]);

  useEffect(() => {
    if (!settings) {
      setHorapgEnabledDraft(false);
      setHorapgTimesDraft("");
      setHorapgImageUrlDraft("");
      setHorapgMentionAllDraft(false);
      setHorapgTimezoneDraft("");
      setHorapgFeedback(null);
      setCloseEnabledDraft(false);
      setCloseTimesDraft("");
      setOpenEnabledDraft(false);
      setOpenTimesDraft("");
      setScheduleTimezoneDraft("");
      setScheduleFeedback(null);
      setCloseTimeInput("00:00");
      setOpenTimeInput("00:00");
      return;
    }

    const config = settings.horapgConfig;
    setHorapgEnabledDraft(Boolean(config?.enabled));
    setHorapgTimesDraft(
      Array.isArray(config?.times) && config.times.length > 0
        ? config.times.join(", ")
        : "",
    );
    setHorapgImageUrlDraft(config?.imageUrl ?? "");
    setHorapgMentionAllDraft(Boolean(config?.mentionAll));
    setHorapgTimezoneDraft(config?.timezone ?? "");
    setHorapgFeedback(null);

    const schedule = settings.scheduleConfig ?? {
      closeEnabled: false,
      closeTimes: [],
      openEnabled: false,
      openTimes: [],
      timezone: null,
    };
    setCloseEnabledDraft(Boolean(schedule.closeEnabled));
    setCloseTimesDraft(
      Array.isArray(schedule.closeTimes) && schedule.closeTimes.length > 0
        ? schedule.closeTimes.join(", ")
        : "",
    );
    setOpenEnabledDraft(Boolean(schedule.openEnabled));
    setOpenTimesDraft(
      Array.isArray(schedule.openTimes) && schedule.openTimes.length > 0
        ? schedule.openTimes.join(", ")
        : "",
    );
    setScheduleTimezoneDraft(schedule.timezone ?? "");
    setScheduleFeedback(null);
    setCloseTimeInput("00:00");
    setOpenTimeInput("00:00");
  }, [settings, group?.id]);

  const normalizeHorapgTimeToken = (value: string): string | null => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
    if (!match) {
      return null;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  };

  const parseHorapgTimesInput = (value: string): string[] => {
    if (!value || typeof value !== "string") {
      return [];
    }
    const tokens = value
      .split(/[\s,;]+/)
      .map((token) => normalizeHorapgTimeToken(token))
      .filter((token): token is string => Boolean(token));
    const unique: string[] = [];
    for (const token of tokens) {
      if (!unique.includes(token)) {
        unique.push(token);
        if (unique.length >= 12) {
          break;
        }
      }
    }
    return unique;
  };

  const parsedCloseTimes = parseHorapgTimesInput(closeTimesDraft);
  const parsedOpenTimes = parseHorapgTimesInput(openTimesDraft);

  const saving = state?.saving ?? false;
  const commandSaving = state?.savingCommands ?? false;
  const welcomeSaving = state?.savingWelcome ?? false;
  const menuSaving = state?.savingMenuTexts ?? false;
  const welcomeCaption = state?.draftWelcomeCaption ?? "";
  const welcomeMediaUrl = state?.draftWelcomeMediaUrl ?? "";
  const welcomeAsSticker = state?.draftWelcomeAsSticker ?? false;
  const welcomeEnabled =
    (settings?.commandToggles.bemvindo ?? false) || (settings?.welcomeConfig.enabled ?? false);
  const welcomeUpdatedAt = settings?.welcomeConfig.updatedAt ?? null;
  const autorespostaEnabled = settings?.commandToggles.autoresposta ?? false;
  const autoResponses = useMemo(
    () =>
      copyAutoResponses(
        state?.draftAutoResponses ?? state?.settings?.autoResponses ?? [],
      ),
    [state?.draftAutoResponses, state?.settings?.autoResponses],
  );
  const savingAutoResponses = state?.savingAutoResponses ?? false;
  const autoResponseBusy = savingAutoResponses || autoResponseUploading;
  const autoResponsesDirty = state?.dirtyAutoResponses ?? false;
  const backgroundUrl = group?.metadata.menuBackgroundUrl ?? null;
  const welcomeUploading = state?.uploadingWelcomeMedia ?? false;
  const menuDrafts = state?.draftMenuTexts ?? { ...EMPTY_MENU_DRAFTS };
  const menuDirty = state?.dirtyMenuTexts ?? { ...EMPTY_MENU_DIRTY };
  const hasMenuChanges = MENU_TEXT_KEYS.some((key) => menuDirty[key]);
  const antifakeEnabled =
    (settings?.featureFlags.antifake ?? false) || (settings?.featureFlags.bangringos ?? false);
  const bloqueioLinksEnabled =
    (settings?.featureFlags.bloqueiolinks ?? false) || (settings?.antilink ?? false);
  const bannedWordsEnabled = settings?.featureFlags.antipalavras ?? false;
  const multiPrefixEnabled = settings?.featureFlags.multprefixo ?? false;
  const prefixesList = settings?.commandPrefixes ?? [];
  const activeCommandPrefix = prefixesList.length > 0 ? prefixesList[0] : "/";
  const allowedLinksList = settings?.allowedLinks ?? [];
  const allowedDdisList = settings?.allowedDdis ?? [];
  const bannedWordsList = settings?.bannedWords ?? [];
  const settingsBlacklist = settings?.blacklist;
  const blacklistList = useMemo(
    () => (Array.isArray(settingsBlacklist) ? settingsBlacklist : []),
    [settingsBlacklist],
  );
  const antipalavrasBanEnabled = settings?.featureFlags.antipalavrasBan ?? false;
  const soadmEnabled = (() => {
    if (settings?.commandToggles && typeof settings.commandToggles.soadm === "boolean") {
      return settings.commandToggles.soadm;
    }
    if (settings?.featureFlags && typeof settings.featureFlags.soadm === "boolean") {
      return settings.featureFlags.soadm;
    }
    return false;
  })();
  const unknownCommandTemplateDraft =
    state?.draftUnknownCommandTemplate ?? state?.settings?.unknownCommandTemplate ?? "";
  const unknownCommandTemplateDirty = state?.dirtyUnknownCommandTemplate ?? false;
  const unknownCommandTemplateSaving = state?.savingUnknownCommandTemplate ?? false;
  const summarizeList = (values: string[], emptyMessage: string) => {
    if (!values.length) {
      return emptyMessage;
    }
    if (values.length <= 3) {
      return values.join(", ");
    }
    const [first, second, third] = values;
    return `${first}, ${second}, ${third} e mais ${values.length - 3}`;
  };

  const formatSummaryLabel = (
    values: string[],
    emptyMessage: string,
    labels: { singular: string; plural: string },
  ) => {
    if (!values.length) {
      return emptyMessage;
    }
    const label = values.length === 1 ? labels.singular : labels.plural;
    const summary = summarizeList(values, "");
    return summary ? `${values.length} ${label} (${summary})` : `${values.length} ${label}`;
  };

  const ddisSummary = formatSummaryLabel(
    allowedDdisList,
    "Nenhum DDI configurado.",
    { singular: "DDI permitido", plural: "DDIs permitidos" },
  );
  const linksSummary = formatSummaryLabel(
    allowedLinksList,
    "Nenhum link liberado.",
    { singular: "link liberado", plural: "links liberados" },
  );
  const bannedWordsSummary = formatSummaryLabel(
    bannedWordsList,
    "Nenhuma palavra cadastrada.",
    { singular: "palavra bloqueada", plural: "palavras bloqueadas" },
  );
  const prefixesSummary =
    prefixesList.length > 0
      ? formatSummaryLabel(prefixesList, "", {
          singular: "prefixo personalizado",
          plural: "prefixos personalizados",
        })
      : "Utilizando prefixos padrão (/, !, #).";
  const blacklistSet = useMemo(() => new Set(blacklistList.map((entry) => sanitizeDigits(entry))), [blacklistList, sanitizeDigits]);
  const instanceDigits = useMemo(() => sanitizeDigits(group?.instancePhone ?? ""), [group?.instancePhone, sanitizeDigits]);
  const filteredParticipants = useMemo(() => {
    const query = participantSearch.trim().toLowerCase();
    if (!query) {
      return participants;
    }
    const digitsQuery = sanitizeDigits(query);
    return participants.filter((participant) => {
      const id = participant.id ?? "";
      const normalized = id.toLowerCase();
      const digits = sanitizeDigits(id);
      return normalized.includes(query) || (digitsQuery && digits.includes(digitsQuery));
    });
  }, [participantSearch, participants, sanitizeDigits]);

  const applySettingsPatch = async (
    patch: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">>,
    options?: { openModal?: ConfigModalKey },
  ) => {
    const success = await onToggle(patch);
    if (success && options?.openModal) {
      setActiveConfigModal(options.openModal);
    }
    return success;
  };

  const openConfigModal = (key: ConfigModalKey) => {
    if (!group) {
      return;
    }
    setActiveConfigModal(key);
  };

  const closeConfigModal = () => {
    if (saving) {
      return;
    }
    setActiveConfigModal(null);
  };

  const handleConfigModalSave = async () => {
    if (!group || !activeConfigModal) {
      return;
    }
    let success = false;
    if (activeConfigModal === "prefixes") {
      success = await onCommandPrefixesSave(group.id);
    } else if (activeConfigModal === "links") {
      success = await onAllowedLinksSave(group.id);
    } else if (activeConfigModal === "ddis") {
      success = await onAllowedDdisSave(group.id);
    } else if (activeConfigModal === "bannedWords") {
      success = await onBannedWordsSave(group.id);
    }
    if (success) {
      setActiveConfigModal(null);
    }
  };

  const openMenuModal = (key: MenuTextKey) => {
    if (!group) {
      return;
    }
    setActiveMenuModal(key);
  };

  const openMenuVariablesModal = (key: MenuTextKey) => {
    setMenuVariablesModalKey(key);
  };

  const closeMenuVariablesModal = () => {
    setMenuVariablesModalKey(null);
  };

  const closeMenuModal = () => {
    if (menuSaving) {
      return;
    }
    setActiveMenuModal(null);
  };

  const handleMenuTextsSubmit = async () => {
    if (!group) {
      return;
    }

    const success = await onMenuTextsSave(group.id);
    setMiniFeedback(
      success
        ? { type: "success", message: "Textos dos menus atualizados com sucesso." }
        : {
            type: "danger",
            message: "Não foi possível atualizar os textos dos menus.",
          },
    );
    if (success) {
      setActiveMenuModal(null);
    }
  };

  const handleMenuModalSave = async () => {
    if (!group || !activeMenuModal) {
      return;
    }

    await handleMenuTextsSubmit();
  };

  const resetAutoResponseModal = () => {
    setAutoResponseFormError(null);
    setAutoResponseUploading(false);
  };

  const handleOpenAutoResponseCreate = () => {
    if (!group) {
      return;
    }
    resetAutoResponseModal();
    setAutoResponseModalMode("create");
    setAutoResponseDraft({
      id: generateAutoResponseId(),
      triggers: "",
      responseText: "",
      matchMode: "equals",
      includeMedia: false,
      mediaMode: "none",
      mediaType: "image",
      mediaUrl: "",
      mediaCaption: "",
      mediaPath: "",
      mediaFileName: "",
      mediaMimeType: "",
      mediaFile: null,
      includeVcard: false,
      vcardName: "",
      vcardPhone: "",
      vcardOrganization: "",
      vcardEmail: "",
      vcardCustom: "",
    });
    setAutoResponseOriginal(null);
    setShowAutoResponseModal(true);
  };

  const handleOpenAutoResponseEdit = (entry: BotGroupAutoResponse) => {
    resetAutoResponseModal();
    setAutoResponseModalMode("edit");
    setAutoResponseDraft({
      id: entry.id,
      triggers: entry.triggers.join("\n"),
      responseText: entry.responseText,
      matchMode: entry.matchMode,
      includeMedia: Boolean(entry.responseMedia),
      mediaMode: entry.responseMedia
        ? entry.responseMedia.url
          ? "url"
          : entry.responseMedia.path
            ? "upload"
            : "none"
        : "none",
      mediaType: entry.responseMedia?.mediaType ?? "image",
      mediaUrl: entry.responseMedia?.url ?? "",
      mediaCaption: entry.responseMedia?.caption ?? "",
      mediaPath: entry.responseMedia?.path ?? "",
      mediaFileName: entry.responseMedia?.fileName ?? "",
      mediaMimeType: entry.responseMedia?.mimeType ?? "",
      mediaFile: null,
      includeVcard: Boolean(entry.responseVcard),
      vcardName: entry.responseVcard?.name ?? "",
      vcardPhone: entry.responseVcard?.phone ?? "",
      vcardOrganization: entry.responseVcard?.organization ?? "",
      vcardEmail: entry.responseVcard?.email ?? "",
      vcardCustom: entry.responseVcard?.vcard ?? "",
    });
    setAutoResponseOriginal(entry);
    setShowAutoResponseModal(true);
  };

  const handleCloseAutoResponseModal = () => {
    if (savingAutoResponses || autoResponseUploading) {
      return;
    }
    setShowAutoResponseModal(false);
    setAutoResponseOriginal(null);
    setAutoResponseFormError(null);
    setAutoResponseUploading(false);
  };

  const updateAutoResponseDraft = (patch: Partial<AutoResponseModalDraft>) => {
    setAutoResponseDraft((prev) => ({
      ...prev,
      ...patch,
    }));
    setAutoResponseFormError(null);
  };

  const handleAutoResponseDraftChange = (
    field: keyof AutoResponseModalDraft,
    value: string,
  ) => {
    updateAutoResponseDraft({
      [field]:
        field === "matchMode"
          ? (value === "contains" ? "contains" : "equals")
          : value,
    } as Partial<AutoResponseModalDraft>);
  };

  const handleAutoResponseModalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!group) {
      return;
    }

    const triggerTokens = autoResponseDraft.triggers
      .split(/[\r\n,;]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    const triggers = triggerTokens
      .map((token) => token.toLowerCase())
      .filter((token, index, array) => array.indexOf(token) === index);

    if (triggers.length === 0) {
      setAutoResponseFormError("Cadastre ao menos um gatilho para a autoresposta.");
      return;
    }

    const responseText = autoResponseDraft.responseText.trim();
    let responseMedia: BotGroupAutoResponseMedia | null = null;
    let responseVcard: BotGroupAutoResponseVcard | null = null;

    if (autoResponseDraft.includeMedia) {
      const mediaType = autoResponseDraft.mediaType;
      const caption = autoResponseDraft.mediaCaption.trim();

      if (autoResponseDraft.mediaMode === "url") {
        const url = autoResponseDraft.mediaUrl.trim();
        if (!url) {
          setAutoResponseFormError("Informe o link da mídia que o bot deve enviar.");
          return;
        }
        responseMedia = {
          mediaType,
          url,
          path: null,
          fileName: null,
          mimeType: null,
          caption: caption || null,
        };
      } else if (autoResponseDraft.mediaMode === "upload") {
        if (autoResponseDraft.mediaFile) {
          try {
            setAutoResponseUploading(true);
            const uploaded = await uploadAutoResponseMediaRequest(group.id, autoResponseDraft.mediaFile, {
              mediaType,
              previousPath: autoResponseDraft.mediaPath || autoResponseOriginal?.responseMedia?.path || null,
            });
            responseMedia = {
              mediaType,
              url: null,
              path: uploaded.path,
              fileName: uploaded.fileName,
              mimeType: uploaded.mimeType,
              caption: caption || null,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Não foi possível enviar a mídia da autoresposta.";
            setAutoResponseFormError(message);
            setAutoResponseUploading(false);
            return;
          } finally {
            setAutoResponseUploading(false);
          }
        } else if (autoResponseDraft.mediaPath) {
          responseMedia = {
            mediaType,
            url: null,
            path: autoResponseDraft.mediaPath,
            fileName: autoResponseDraft.mediaFileName || null,
            mimeType: autoResponseDraft.mediaMimeType || null,
            caption: caption || null,
          };
        } else {
          setAutoResponseFormError("Envie um arquivo ou selecione o link da mídia para habilitar a resposta automática.");
          return;
        }
      } else {
        setAutoResponseFormError("Selecione como deseja enviar a mídia da autoresposta.");
        return;
      }
    }

    if (autoResponseDraft.includeVcard) {
      const name = autoResponseDraft.vcardName.trim();
      const organization = autoResponseDraft.vcardOrganization.trim();
      const email = autoResponseDraft.vcardEmail.trim();
      const rawPhone = autoResponseDraft.vcardPhone.trim();
      const rawVcard = autoResponseDraft.vcardCustom.replace(/\r\n/g, "\n").trim();

      const normalizedPhone = (() => {
        if (!rawPhone) {
          return "";
        }
        const digits = rawPhone.replace(/[^0-9+]/g, "");
        if (!digits) {
          return "";
        }
        if (digits.startsWith("+")) {
          return digits;
        }
        if (digits.startsWith("00")) {
          return `+${digits.slice(2)}`;
        }
        return `+${digits}`;
      })();

      let vcardContent = rawVcard;
      if (!vcardContent) {
        if (!name && !normalizedPhone) {
          setAutoResponseFormError("Informe o nome ou telefone para montar o contato do bot.");
          return;
        }
        const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${name || normalizedPhone || "Contato"}`];
        if (organization) {
          lines.push(`ORG:${organization}`);
        }
        if (email) {
          lines.push(`EMAIL:${email}`);
        }
        if (normalizedPhone) {
          lines.push(`TEL:${normalizedPhone}`);
        }
        lines.push("END:VCARD");
        vcardContent = lines.join("\n");
      }

      if (!vcardContent) {
        setAutoResponseFormError("Não foi possível gerar o VCard informado.");
        return;
      }

      responseVcard = {
        name: name || normalizedPhone || "Contato",
        phone: normalizedPhone || null,
        organization: organization || null,
        email: email || null,
        vcard: vcardContent,
      };
    }

    if (!responseText && !responseMedia && !responseVcard) {
      setAutoResponseFormError(
        "Defina uma mensagem, mídia ou contato para que a autoresposta seja enviada ao seu cliente.",
      );
      return;
    }

    const now = new Date().toISOString();
    const baseList = copyAutoResponses(autoResponses);

    if (autoResponseModalMode === "edit" && autoResponseOriginal) {
      const index = baseList.findIndex((item) => item.id === autoResponseOriginal.id);
      if (index >= 0) {
        baseList[index] = {
          ...autoResponseOriginal,
          triggers,
          responseText,
          matchMode: autoResponseDraft.matchMode,
          responseMedia,
          responseVcard,
          updatedAt: now,
        };
      } else {
        baseList.push({
          ...autoResponseOriginal,
          triggers,
          responseText,
          matchMode: autoResponseDraft.matchMode,
          responseMedia,
          responseVcard,
          updatedAt: now,
        });
      }
    } else {
      baseList.push({
        id: autoResponseDraft.id || generateAutoResponseId(),
        triggers,
        responseText,
        matchMode: autoResponseDraft.matchMode,
        responseMedia,
        responseVcard,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (baseList.length > AUTO_RESPONSE_LIMIT) {
      setAutoResponseFormError(
        `Limite de ${AUTO_RESPONSE_LIMIT} autorespostas atingido. Remova alguma entrada antes de adicionar outra.`,
      );
      return;
    }

    const success = await onAutoResponsesSave(group.id, baseList);

    if (success) {
      setMiniFeedback({
        type: "success",
        message:
          autoResponseModalMode === "edit"
            ? "Autoresposta atualizada com sucesso."
            : "Autoresposta criada com sucesso.",
      });
      setShowAutoResponseModal(false);
    } else {
      setAutoResponseFormError("Não foi possível salvar a autoresposta. Tente novamente.");
    }
  };

  const handleAutoResponseDelete = async (entry: BotGroupAutoResponse) => {
    if (!group) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Tem certeza de que deseja remover esta autoresposta?",
      );
      if (!confirmed) {
        return;
      }
    }

    const remaining = autoResponses.filter((item) => item.id !== entry.id);
    const success = await onAutoResponsesSave(group.id, remaining);
    setMiniFeedback(
      success
        ? { type: "success", message: "Autoresposta removida com sucesso." }
        : { type: "danger", message: "Não foi possível remover a autoresposta." },
    );
  };

  const handleOpenAiKeyModal = () => {
    if (!settings) {
      return;
    }
    setAiKeyDraft(settings.groqKeys.join("\n"));
    setShowAiKeyModal(true);
  };

  const handleCloseAiKeyModal = () => {
    if (savingAiSection) {
      return;
    }
    setShowAiKeyModal(false);
  };

  const handleOpenAiPromptModal = () => {
    if (!settings) {
      return;
    }
    setAiPromptDraft(settings.aiPrompt);
    setAiToolsPromptDraft(settings.aiToolsPrompt ?? "");
    setShowAiPromptModal(true);
  };

  const handleCloseAiPromptModal = () => {
    if (savingAiSection) {
      return;
    }
    setShowAiPromptModal(false);
  };

  const handleOpenAiVoiceModal = () => {
    if (!settings) {
      return;
    }
    setAiVoiceDraft(settings.aiVoice ?? "");
    setShowAiVoiceModal(true);
  };

  const handleCloseAiVoiceModal = () => {
    if (savingAiSection) {
      return;
    }
    setShowAiVoiceModal(false);
  };

  const handleAiKeySave = async () => {
    if (!group) {
      return;
    }
    setSavingAiSection("keys");
    setMiniFeedback(null);
    const entries = aiKeyDraft
      .split(/[\n,;]+/)
      .map((entry) => entry.replace(/\s+/g, "").trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
      .slice(0, 10);
    const success = await applySettingsPatch({ groqKeys: entries });
    setSavingAiSection(null);
    setMiniFeedback(
      success
        ? { type: "success", message: "Chaves Groq atualizadas com sucesso." }
        : { type: "danger", message: "Não foi possível salvar as chaves Groq." },
    );
    if (success) {
      setShowAiKeyModal(false);
    }
  };

  const handleAiPromptSave = async () => {
    if (!group) {
      return;
    }
    setSavingAiSection("prompt");
    setMiniFeedback(null);
    const success = await applySettingsPatch({
      aiPrompt: aiPromptDraft,
      aiToolsPrompt: aiToolsPromptDraft,
    });
    setSavingAiSection(null);
    setMiniFeedback(
      success
        ? { type: "success", message: "Prompt atualizado com sucesso." }
        : { type: "danger", message: "Não foi possível atualizar o prompt do bot." },
    );
    if (success) {
      setShowAiPromptModal(false);
    }
  };

  const handleAiVoiceSave = async () => {
    if (!group) {
      return;
    }
    setSavingAiSection("voice");
    setMiniFeedback(null);
    const trimmed = aiVoiceDraft.trim();
    const payload = trimmed.length > 0 ? trimmed : null;
    const success = await applySettingsPatch({ aiVoice: payload });
    setSavingAiSection(null);
    setMiniFeedback(
      success
        ? { type: "success", message: "Voz do bot atualizada com sucesso." }
        : { type: "danger", message: "Não foi possível atualizar a voz do bot." },
    );
    if (success) {
      setShowAiVoiceModal(false);
    }
  };

  const handleVoicePreview = async () => {
    if (!group || !state?.settings) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const currentVoice = (state.settings.aiVoice && state.settings.aiVoice.trim()) || "laizza";
    const sampleText = "Olá! Eu sou o assistente do seu bot.";
    const url = new URL("/api/tts", window.location.origin);
    url.searchParams.set("texto", sampleText);
    url.searchParams.set("voz", currentVoice);
    setVoicePreviewLoading(true);
    setVoicePreviewError(null);
    if (voicePreviewUrl) {
      URL.revokeObjectURL(voicePreviewUrl);
      setVoicePreviewUrl(null);
    }
    try {
      const response = await fetch(url.toString(), { headers: { accept: "audio/mpeg" } });
      if (!response.ok) {
        throw new Error("Não foi possível gerar a prévia de áudio.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setVoicePreviewUrl(objectUrl);
    } catch (error: any) {
      setVoicePreviewError(error?.message || "Não foi possível gerar a prévia de áudio.");
    } finally {
      setVoicePreviewLoading(false);
    }
  };

  const modalLabels: Record<ConfigModalKey, { title: string; description: string; help: string; rows: number }>
    = {
      prefixes: {
        title: "Prefixos de comando",
        description: "Defina um prefixo por linha. Deixe vazio para utilizar os padrões (/, !, #).",
        help: "Os prefixos ajudam o bot a identificar quando deve responder um comando.",
        rows: 4,
      },
      links: {
        title: "Links permitidos",
        description:
          "Informe um link ou domínio por linha para o antilink ignorar quando encontrar esses endereços.",
        help: "Com o antilink ativo, mensagens com links fora desta lista continuam sendo bloqueadas.",
        rows: 4,
      },
      ddis: {
        title: "DDIs permitidos",
        description:
          "Adicione um código de país por linha (ex.: 55, 351) e personalize a mensagem enviada antes da remoção.",
        help: "Participantes com outros DDIs serão bloqueados automaticamente quando o anti-fake estiver ativo.",
        rows: 4,
      },
      bannedWords: {
        title: "Palavras proibidas",
        description:
          "Cadastre uma palavra ou expressão por linha. A comparação ignora maiúsculas e minúsculas.",
        help: "Defina também o limite de infrações antes do banimento automático.",
        rows: 5,
      },
    };

  const modalDraft = (() => {
    if (!group || !activeConfigModal) {
      return null;
    }
    switch (activeConfigModal) {
      case "prefixes":
        return {
          value: state?.draftCommandPrefixes ?? "",
          onChange: (value: string) => onCommandPrefixesChange(group.id, value),
          dirty: state?.dirtyCommandPrefixes ?? false,
        };
      case "links":
        return {
          value: state?.draftAllowedLinks ?? "",
          onChange: (value: string) => onAllowedLinksChange(group.id, value),
          dirty: state?.dirtyAllowedLinks ?? false,
        };
      case "ddis":
        return {
          value: state?.draftAllowedDdis ?? "",
          onChange: (value: string) => onAllowedDdisChange(group.id, value),
          dirty: state?.dirtyAllowedDdis ?? false,
          messageValue:
            state?.draftAntifakeMessage ??
            normalizeAntifakeMessage(state?.settings?.antifakeMessage ?? ""),
          onMessageChange: (value: string) => onAntifakeMessageChange(group.id, value),
          dirtyMessage: state?.dirtyAntifakeMessage ?? false,
        };
      case "bannedWords":
        return {
          value: state?.draftBannedWords ?? "",
          onChange: (value: string) => onBannedWordsChange(group.id, value),
          dirty: state?.dirtyBannedWords ?? false,
          banValue:
            state?.draftAntipalavrasBan ??
            (state?.settings?.featureFlags.antipalavrasBan ?? false),
          onBanChange: (checked: boolean) => onBannedWordsBanChange(group.id, checked),
          dirtyBan: state?.dirtyAntipalavrasBan ?? false,
          limitValue:
            state?.draftAntipalavrasLimit ??
            String(state?.settings?.antipalavrasMaxInfractions ?? 5),
          onLimitChange: (value: string) => onBannedWordsLimitChange(group.id, value),
          dirtyLimit: state?.dirtyAntipalavrasLimit ?? false,
        };
      default:
        return null;
    }
  })();
  const modalInfo = activeConfigModal ? modalLabels[activeConfigModal] : null;
  const isDdiModal = activeConfigModal === "ddis";
  const isBannedWordsModal = activeConfigModal === "bannedWords";
  const canSaveModal = (() => {
    if (!modalDraft) {
      return false;
    }
    if (isDdiModal) {
      return Boolean(modalDraft.dirty || (modalDraft as any).dirtyMessage);
    }
    if (isBannedWordsModal) {
      return Boolean(modalDraft.dirty || (modalDraft as any).dirtyBan || (modalDraft as any).dirtyLimit);
    }
    return Boolean(modalDraft.dirty);
  })();

  const menuModalDraft = (() => {
    if (!group || !activeMenuModal) {
      return null;
    }
    const key = activeMenuModal;
    return {
      key,
      info: MENU_TEXT_LABELS[key],
      value: menuDrafts[key] ?? "",
      dirty: menuDirty[key] ?? false,
      onChange: (value: string) => onMenuTextChange(group.id, key, value),
    };
  })();
  const menuModalInfo = menuModalDraft?.info ?? null;
  const menuVariablesModalInfo = menuVariablesModalKey ? MENU_TEXT_LABELS[menuVariablesModalKey] : null;

  const updateDetailsField = (
    field: keyof typeof detailsForm,
    value: string,
  ) => {
    setDetailsForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleWelcomeFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!group) {
      return;
    }

    const file = event.target.files?.[0];
    if (file) {
      onWelcomeMediaUpload(group.id, file);
      event.target.value = "";
    }
  };

  const applyGroupUpdate = (next: BotGroup, message?: string) => {
    onGroupUpdated(next);
    setDetailsForm({
      name: next.name,
      description: next.description ?? "",
      inviteLink: next.inviteLink ?? "",
    });
    setAdminsOnly(next.metadata.adminsOnly);
    setLocked(next.metadata.locked);
    setEphemeral(next.metadata.ephemeral ?? "off");
    if (message) {
      setMiniFeedback({ type: "success", message });
    }
  };

  const patchGroup = async (body: Record<string, unknown>) => {
    if (!group) {
      throw new Error("Grupo não selecionado.");
    }

    const response = await fetch(`/api/bot-groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        typeof data.message === "string"
          ? data.message
          : "Não foi possível atualizar o grupo.",
      );
    }

    if (!data.group) {
      throw new Error("Resposta inválida do servidor.");
    }

    const successMessage =
      typeof data.message === "string" && data.message.trim().length > 0
        ? data.message
        : "Alterações salvas com sucesso.";

    applyGroupUpdate(data.group as BotGroup, successMessage);
  };

  const handleBasicSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!group) {
      return;
    }
    setSavingBasic(true);
    setMiniFeedback(null);
    try {
      const payload = {
        name: detailsForm.name.trim(),
        description:
          detailsForm.description.trim().length > 0
            ? detailsForm.description.trim()
            : null,
        inviteLink:
          detailsForm.inviteLink.trim().length > 0
            ? detailsForm.inviteLink.trim()
            : null,
      };
      await patchGroup(payload);
    } catch (error) {
      setMiniFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o grupo.",
      });
    } finally {
      setSavingBasic(false);
    }
  };

  const handleAdminsOnlyChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!group) {
      return;
    }
    const value = event.target.checked;
    setAdminsOnly(value);
    setSavingAdmins(true);
    setMiniFeedback(null);
    try {
      await patchGroup({ adminsOnly: value });
    } catch (error) {
      setMiniFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a configuração.",
      });
      setAdminsOnly(group.metadata.adminsOnly);
    } finally {
      setSavingAdmins(false);
    }
  };

  const handleLockedChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!group) {
      return;
    }
    const value = event.target.checked;
    setLocked(value);
    setSavingLocked(true);
    setMiniFeedback(null);
    try {
      await patchGroup({ locked: value });
    } catch (error) {
      setMiniFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a configuração.",
      });
      setLocked(group.metadata.locked);
    } finally {
      setSavingLocked(false);
    }
  };

  const handleEphemeralSave = async () => {
    if (!group) {
      return;
    }
    setSavingEphemeral(true);
    setMiniFeedback(null);
    try {
      await patchGroup({ ephemeral });
    } catch (error) {
      setMiniFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a duração das mensagens.",
      });
      setEphemeral(group.metadata.ephemeral ?? "off");
    } finally {
      setSavingEphemeral(false);
    }
  };

  const handlePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!group) {
      return;
    }
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSavingPhoto(true);
    setMiniFeedback(null);

    try {
      const formData = new FormData();
      formData.append("photo", file);
      const response = await fetch(`/api/bot-groups/${group.id}/photo`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar a foto do grupo.",
        );
      }
      if (!data.group) {
        throw new Error("Resposta inválida do servidor.");
      }
      const message =
        typeof data.message === "string" && data.message.trim().length > 0
          ? data.message
          : "Foto do grupo atualizada com sucesso.";
      applyGroupUpdate(data.group as BotGroup, message);
    } catch (error) {
      setMiniFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a foto do grupo.",
      });
    } finally {
      setSavingPhoto(false);
      event.target.value = "";
    }
  };

  const handlePhotoRemove = async () => {
    if (!group) {
      return;
    }
    setRemovingPhoto(true);
    setMiniFeedback(null);
    try {
      const response = await fetch(`/api/bot-groups/${group.id}/photo`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível remover a foto do grupo.",
        );
      }
      if (!data.group) {
        throw new Error("Resposta inválida do servidor.");
      }
      const message =
        typeof data.message === "string" && data.message.trim().length > 0
          ? data.message
          : "Foto do grupo removida com sucesso.";
      applyGroupUpdate(data.group as BotGroup, message);
    } catch (error) {
      setMiniFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível remover a foto do grupo.",
      });
    } finally {
      setRemovingPhoto(false);
    }
  };

  const handleBackgroundChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!group) {
      return;
    }
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSavingBackground(true);
    setMiniFeedback(null);

    try {
      const formData = new FormData();
      formData.append("background", file);
      const response = await fetch(`/api/bot-groups/${group.id}/background`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar o fundo do menu.",
        );
      }
      if (!data.group) {
        throw new Error("Resposta inválida do servidor.");
      }
      const message =
        typeof data.message === "string" && data.message.trim().length > 0
          ? data.message
          : "Fundo do menu atualizado com sucesso.";
      applyGroupUpdate(data.group as BotGroup, message);
    } catch (error) {
      setMiniFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o fundo do menu.",
      });
    } finally {
      setSavingBackground(false);
      event.target.value = "";
    }
  };

  const handleBackgroundRemove = async () => {
    if (!group) {
      return;
    }
    setRemovingBackground(true);
    setMiniFeedback(null);
    try {
      const response = await fetch(`/api/bot-groups/${group.id}/background`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível remover o fundo do menu.",
        );
      }
      if (!data.group) {
        throw new Error("Resposta inválida do servidor.");
      }
      const message =
        typeof data.message === "string" && data.message.trim().length > 0
          ? data.message
          : "Fundo do menu removido com sucesso.";
      applyGroupUpdate(data.group as BotGroup, message);
    } catch (error) {
      setMiniFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível remover o fundo do menu.",
      });
    } finally {
      setRemovingBackground(false);
    }
  };

  const handleHorapgSave = async () => {
    if (!group) {
      return;
    }
    setHorapgSaving(true);
    setHorapgFeedback(null);
    try {
      const times = parseHorapgTimesInput(horapgTimesDraft);
      if (horapgEnabledDraft && times.length === 0) {
        setHorapgFeedback({
          type: "warning",
          message: "Informe ao menos um horário válido no formato HH:MM para ativar o envio automático.",
        });
        return;
      }

      const payload: Partial<BotGroupSettings["horapgConfig"]> = {
        enabled: horapgEnabledDraft,
        times,
        imageUrl: horapgImageUrlDraft.trim().length > 0 ? horapgImageUrlDraft.trim() : null,
        mentionAll: horapgMentionAllDraft,
        timezone: horapgTimezoneDraft.trim().length > 0 ? horapgTimezoneDraft.trim() : null,
      };

      const success = await applySettingsPatch({ horapgConfig: payload });
      setHorapgFeedback(
        success
          ? {
              type: "success",
              message: "Configurações de horários pagantes atualizadas com sucesso.",
            }
          : {
              type: "danger",
              message: "Não foi possível salvar as configurações agora. Tente novamente em instantes.",
            },
      );
      if (success) {
        void onReloadSettings(group.id);
      }
    } catch (error) {
      setHorapgFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar as configurações no momento.",
      });
    } finally {
      setHorapgSaving(false);
    }
  };

  const handleHorapgImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!group) {
      return;
    }
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setHorapgUploading(true);
    setHorapgFeedback(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch(`/api/bot-groups/${group.id}/horapg/image`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível enviar a imagem no momento.",
        );
      }
      setHorapgFeedback({
        type: "success",
        message: "Imagem atualizada com sucesso.",
      });
      void onReloadSettings(group.id);
    } catch (error) {
      setHorapgFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a imagem agora.",
      });
    } finally {
      setHorapgUploading(false);
    }
  };

const handleHorapgImageRemove = async () => {
  if (!group) {
      return;
    }
    setHorapgUploading(true);
    setHorapgFeedback(null);
    try {
      const response = await fetch(`/api/bot-groups/${group.id}/horapg/image`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Não foi possível remover a imagem agora.",
        );
      }
      setHorapgFeedback({
        type: "success",
        message: "Imagem personalizada removida com sucesso.",
      });
      setHorapgImageUrlDraft("");
      void onReloadSettings(group.id);
    } catch (error) {
      setHorapgFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível remover a imagem agora.",
      });
    } finally {
      setHorapgUploading(false);
    }
};

  const limitScheduleTimes = 12;

  const sortTimes = (times: string[]): string[] =>
    [...times].sort((a, b) => a.localeCompare(b));

  const handleAddCloseTime = () => {
    const normalized = normalizeHorapgTimeToken(closeTimeInput);
    if (!normalized) {
      setScheduleFeedback({
        type: "warning",
        message: "Informe um horário válido no formato HH:MM para o fechamento automático.",
      });
      return;
    }
    const current = parseHorapgTimesInput(closeTimesDraft);
    if (current.includes(normalized)) {
      setScheduleFeedback({
        type: "warning",
        message: "Esse horário de fechamento já está configurado.",
      });
      return;
    }
    if (current.length >= limitScheduleTimes) {
      setScheduleFeedback({
        type: "warning",
        message: `É possível configurar no máximo ${limitScheduleTimes} horários de fechamento.`,
      });
      return;
    }
    const next = sortTimes([...current, normalized]);
    setCloseTimesDraft(next.join(", "));
    setCloseTimeInput("00:00");
    setScheduleFeedback(null);
  };

  const handleRemoveCloseTime = (time: string) => {
    const next = parseHorapgTimesInput(closeTimesDraft).filter((entry) => entry !== time);
    setCloseTimesDraft(next.join(", "));
    setScheduleFeedback(null);
  };

  const handleAddOpenTime = () => {
    const normalized = normalizeHorapgTimeToken(openTimeInput);
    if (!normalized) {
      setScheduleFeedback({
        type: "warning",
        message: "Informe um horário válido no formato HH:MM para a abertura automática.",
      });
      return;
    }
    const current = parseHorapgTimesInput(openTimesDraft);
    if (current.includes(normalized)) {
      setScheduleFeedback({
        type: "warning",
        message: "Esse horário de abertura já está configurado.",
      });
      return;
    }
    if (current.length >= limitScheduleTimes) {
      setScheduleFeedback({
        type: "warning",
        message: `É possível configurar no máximo ${limitScheduleTimes} horários de abertura.`,
      });
      return;
    }
    const next = sortTimes([...current, normalized]);
    setOpenTimesDraft(next.join(", "));
    setOpenTimeInput("00:00");
    setScheduleFeedback(null);
  };

  const handleRemoveOpenTime = (time: string) => {
    const next = parseHorapgTimesInput(openTimesDraft).filter((entry) => entry !== time);
    setOpenTimesDraft(next.join(", "));
    setScheduleFeedback(null);
  };

  const handleScheduleSave = async () => {
    if (!group) {
      return;
    }
    setScheduleSaving(true);
    setScheduleFeedback(null);
    const closeTimes = parseHorapgTimesInput(closeTimesDraft);
    const openTimes = parseHorapgTimesInput(openTimesDraft);

    if (closeEnabledDraft && closeTimes.length === 0) {
      setScheduleFeedback({
        type: "warning",
        message: "Informe ao menos um horário válido para o fechamento automático ou desative a opção.",
      });
      setScheduleSaving(false);
      return;
    }

    if (openEnabledDraft && openTimes.length === 0) {
      setScheduleFeedback({
        type: "warning",
        message: "Informe ao menos um horário válido para a abertura automática ou desative a opção.",
      });
      setScheduleSaving(false);
      return;
    }

    const timezonePayload = scheduleTimezoneDraft.trim().length > 0 ? scheduleTimezoneDraft.trim() : null;

    const payload = {
      scheduleConfig: {
        closeEnabled: closeEnabledDraft,
        closeTimes,
        openEnabled: openEnabledDraft,
        openTimes,
        timezone: timezonePayload,
      },
    } as const;

    const success = await applySettingsPatch(payload);
    setScheduleFeedback(
      success
        ? { type: "success", message: "Configurações de abertura/fechamento atualizadas com sucesso." }
        : { type: "danger", message: "Não foi possível salvar as configurações agora. Tente novamente." },
    );
    if (success) {
      void onReloadSettings(group.id);
    }
    setScheduleSaving(false);
  };
  const automationToggles: Array<{
    key: keyof BotGroupCommandToggles;
    label: string;
    description: string;
    tutorialKey?: keyof typeof GROUP_ACTIVATION_TUTORIAL_SLUG_BY_KEY;
  }> = [
    {
      key: "antilinkgp",
      label: "antilinkgp",
      description: "Remove automaticamente convites de outros grupos ou canais.",
      tutorialKey: "antilinkgp",
    },
    // Mapeamentos existentes no back-end
    {
      key: "banextremo",
      label: "banextremo",
      description: "Remove automaticamente usuários que violarem as regras do grupo.",
      tutorialKey: "banextremo",
    },
    {
      key: "antisticker",
      label: "antisticker",
      description: "Remove figurinhas enviadas pelos participantes automaticamente.",
    },
    {
      key: "antimage",
      label: "antimage",
      description: "Exclui imagens compartilhadas quando a proteção estiver ativa.",
    },
    {
      key: "antvideo",
      label: "antvideo",
      description: "Remove vídeos enviados pelos participantes automaticamente.",
    },
    {
      key: "antaudio",
      label: "antaudio",
      description: "Apaga áudios e notas de voz recebidos no grupo.",
    },
    {
      key: "antdoc",
      label: "antdoc",
      description: "Remove documentos enviados que possam conter arquivos indesejados.",
    },
    {
      key: "antvcard",
      label: "antvcard",
      description: "Impede o compartilhamento de contatos/vCards no grupo.",
    },
  ];
  const showRemoveMedia = Boolean(
    welcomeMediaUrl ||
      settings?.welcomeConfig.mediaUrl ||
      settings?.welcomeConfig.mediaPath,
  );
  const isLoading = Boolean(group) && (!state || state.loading);
  const error = state?.error ?? null;
  const hasSelection = Boolean(group);
  const isDeletingCurrentGroup = group ? deletingGroupId === group.id : false;

  const renderView = () => {
    if (!group || !activeView) {
      return null;
    }

    if (!settings) {
      return (
        <Alert variant="secondary" className="mb-0">
          Aguarde o carregamento das configurações do grupo para acessar esta mini visão.
        </Alert>
      );
    }

    switch (activeView) {
      case "activations":
        return (
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
                <div className="flex-grow-1">
                  <SectionHeading
                    title="Ativações gerais do grupo"
                    description="Configure quais automações o bot pode executar neste grupo e ajuste listas auxiliares."
                    tutorial={resolveGroupTutorial("activations", tutorials)}
                  />
                </div>
                {commandSaving ? (
                  <span className="d-flex align-items-center gap-2 text-secondary small">
                    <Spinner animation="border" size="sm" role="status" /> Atualizando...
                  </span>
                ) : null}
                {error ? (
                  <Alert variant="danger" className="mb-0 mt-2">
                    {error}
                  </Alert>
                ) : null}
              </div>
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-4">
              <div className="border rounded p-3 bg-body-tertiary">
                <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
                  <div>
                    <h4 className="h6 mb-1">Ajustes rápidos de proteção</h4>
                    <p className="text-secondary small mb-0">
                      Configure horários automáticos, exceções do antilink e limites de infração sem sair das ativações.
                    </p>
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => void onViewChange("schedule")}
                    >
                      Abrir/fechar auto
                    </Button>
                    <Button size="sm" variant="outline-primary" onClick={() => openConfigModal("links")}>
                      Links permitidos
                    </Button>
                    <Button size="sm" variant="outline-danger" onClick={() => openConfigModal("bannedWords")}>
                      Infrações
                    </Button>
                  </div>
                </div>
              </div>
              <Row className="g-3">
                <Col md={6}>
                  <div className="d-flex flex-column gap-2">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <Form.Check
                        type="switch"
                        id={`settings-${group.id}-antifake`}
                        label={renderActivationLabel("antifake", "antifake")}
                        checked={antifakeEnabled}
                        disabled={saving}
                        onChange={() => {
                          const next = !antifakeEnabled;
                          void applySettingsPatch(
                            { featureFlags: { antifake: next, bangringos: next } },
                            next ? { openModal: "ddis" } : undefined,
                          );
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => openConfigModal("ddis")}
                        disabled={!antifakeEnabled || saving}
                      >
                        {allowedDdisList.length > 0 ? "Editar DDIs" : "Configurar DDIs"}
                      </Button>
                    </div>
                    <Form.Text className="text-secondary">
                      Valida novos participantes antes de liberar o envio de mensagens.
                    </Form.Text>
                    <small className="text-secondary">{ddisSummary}</small>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="d-flex flex-column gap-2">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <Form.Check
                        type="switch"
                        id={`settings-${group.id}-bloqueiolinks`}
                        label={renderActivationLabel("antilink", "bloqueiolinks")}
                        checked={bloqueioLinksEnabled}
                        disabled={saving}
                        onChange={() => {
                          const next = !bloqueioLinksEnabled;
                          void applySettingsPatch(
                            { featureFlags: { bloqueiolinks: next }, antilink: next },
                            next ? { openModal: "links" } : undefined,
                          );
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => openConfigModal("links")}
                        disabled={saving}
                      >
                        {allowedLinksList.length > 0 ? "Editar links" : "Configurar links"}
                      </Button>
                    </div>
                    <Form.Text className="text-secondary">
                      Remove mensagens com links fora da lista de permissões quando o antilink estiver ativo.
                    </Form.Text>
                    <small className="text-secondary">{linksSummary}</small>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="d-flex flex-column gap-2">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <Form.Check
                        type="switch"
                        id={`settings-${group.id}-antipalavras`}
                        label={renderActivationLabel("antipalavras", "antipalavras")}
                        checked={bannedWordsEnabled}
                        disabled={saving}
                        onChange={() => {
                          const next = !bannedWordsEnabled;
                          void applySettingsPatch(
                            { featureFlags: { antipalavras: next } },
                            next ? { openModal: "bannedWords" } : undefined,
                          );
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => openConfigModal("bannedWords")}
                        disabled={!bannedWordsEnabled || saving}
                      >
                        {bannedWordsList.length > 0 ? "Editar palavras" : "Configurar palavras"}
                      </Button>
                    </div>
                    <Form.Text className="text-secondary">
                      Remove mensagens que contenham termos proibidos.
                    </Form.Text>
                    <small className="text-secondary">{bannedWordsSummary}</small>
                    <small className="text-secondary">
                      {antipalavrasBanEnabled
                        ? `Usuários que violarem serão removidos automaticamente após ${settings?.antipalavrasMaxInfractions ?? 5} infração(ões).`
                        : "Usuários que violarem não são removidos automaticamente."}
                    </small>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="d-flex flex-column gap-2">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <Form.Check
                        type="switch"
                        id={`settings-${group.id}-multprefixo`}
                        label={renderActivationLabel("multprefixo", "multprefixo")}
                        checked={multiPrefixEnabled}
                        disabled={saving}
                        onChange={() => {
                          const next = !multiPrefixEnabled;
                          void applySettingsPatch(
                            { featureFlags: { multprefixo: next } },
                            next ? { openModal: "prefixes" } : undefined,
                          );
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => openConfigModal("prefixes")}
                        disabled={!multiPrefixEnabled || saving}
                      >
                        {prefixesList.length > 0 ? "Editar prefixos" : "Adicionar prefixos"}
                      </Button>
                    </div>
                    <Form.Text className="text-secondary">
                      Permite utilizar vários prefixos personalizados nos comandos do bot.
                    </Form.Text>
                    <small className="text-secondary">{prefixesSummary}</small>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="d-flex flex-column gap-2">
                    <Form.Check
                      type="switch"
                      id={`settings-${group.id}-soadm`}
                      label={renderActivationLabel("soadm", "soadm")}
                      checked={soadmEnabled}
                      disabled={saving || commandSaving}
                      onChange={() => {
                        const next = !soadmEnabled;
                        if (group) {
                          onCommandToggleChange(group.id, "soadm", next);
                        }
                        void applySettingsPatch({ featureFlags: { soadm: next } });
                      }}
                    />
                    <Form.Text className="text-secondary">
                      Ativa o comando <code>soadm</code> (ou <code>soadmin</code>) para que apenas administradores possam usar o robô; demais participantes são ignorados.
                    </Form.Text>
                  </div>
                </Col>
              </Row>

              <div className="border-top pt-3">
                <div className="d-flex align-items-center gap-2 mb-3">
                  <h4 className="h6 mb-0">Automatizações rápidas</h4>
                  {commandSaving ? (
                    <span className="d-flex align-items-center gap-2 text-secondary small">
                      <Spinner animation="border" size="sm" role="status" /> Atualizando...
                    </span>
                  ) : null}
                </div>
                <Row className="g-3">
                  {automationToggles.map((item) => {
                    const active = settings.commandToggles[item.key] ?? false;
                    const handleAutomationToggle = () => {
                      if (!group) {
                        return;
                      }
                      const next = !active;
                      setMiniFeedback(null);
                      onCommandToggleChange(group.id, item.key, next);
                    };
                    return (
                      <Col md={6} key={item.key}>
                        <Form.Check
                          type="switch"
                          id={`settings-${group.id}-${item.key}`}
                          label={renderActivationLabel(item.label, item.tutorialKey ?? null)}
                          checked={active}
                          disabled={saving || commandSaving || !settings}
                          onChange={handleAutomationToggle}
                        />
                        <Form.Text className="text-secondary">{item.description}</Form.Text>
                      </Col>
                    );
                  })}
                </Row>
              </div>

            </Card.Body>
          </Card>
        );
      case "botinterage":
        const groqKeysCount = settings.groqKeys.length;
        const hasGroqKeys = groqKeysCount > 0;
        const botInterageEnabled = settings.commandToggles.botinterage ?? false;
        const mentionOnlyEnabled =
          settings.featureFlags?.botInterageMentionOnly === true ||
          settings.featureFlags?.iaSomenteMencao === true ||
          settings.featureFlags?.iaConversas === false;
        const voiceEnabled = settings.commandToggles.vozbotinterage ?? false;
        const aiVoiceLabel = settings.aiVoice?.trim()
          ? settings.aiVoice.trim()
          : "Automático (laizza)";
        const promptPreview = (() => {
          const raw = (settings.aiPrompt || "").toString().trim();
          if (!raw) return "Toque para editar";
          const singleLine = raw.replace(/\s+/g, " ").trim();
          return singleLine.length > 120 ? `${singleLine.slice(0, 120)}…` : singleLine;
        })();
        const isAiSaving = savingAiSection !== null;
        const aiModelDraft =
          state?.draftAiModel ?? state?.settings?.aiModel ?? DEFAULT_GROQ_MODEL;
        const dirtyAiModel = state?.dirtyAiModel ?? false;
        const savingAiModel = state?.savingAiModel ?? false;
        const aiModelValue = aiModelDraft;
        let combinedModelOptions = aiModels.length
          ? [
              ...aiModels,
              ...DEFAULT_GROQ_MODEL_OPTIONS.filter(
                (fallback) => !aiModels.some((model) => model.id === fallback.id),
              ),
            ]
          : [...DEFAULT_GROQ_MODEL_OPTIONS];
        if (!combinedModelOptions.some((model) => model.id === aiModelDraft)) {
          combinedModelOptions = [
            { id: aiModelDraft, description: null },
            ...combinedModelOptions,
          ];
        }
        const isRateLimited = aiModelsQuota !== null && aiModelsQuota <= 0;
        const canSaveModel =
          dirtyAiModel && !savingAiModel && !commandSaving && !saving;
        const modelSelectDisabled =
          aiModelsLoading || savingAiModel || commandSaving || saving;

        const handleBotToggle = () => {
          if (!group) {
            return;
          }
          const next = !botInterageEnabled;
          if (next && !hasGroqKeys) {
            setMiniFeedback({
              type: "warning",
              message: "Cadastre a sua chave Groq para ativar o Bot interage neste grupo.",
            });
            handleOpenAiKeyModal();
            return;
          }
          setMiniFeedback(null);
          onCommandToggleChange(group.id, "botinterage", next);
        };

        const handleVoiceToggle = () => {
          if (!group) {
            return;
          }
          const next = !voiceEnabled;
          if (next && !botInterageEnabled) {
            setMiniFeedback({
              type: "warning",
              message: "Ative o Bot interage antes de habilitar as respostas por voz.",
            });
            return;
          }
          setMiniFeedback(null);
          onCommandToggleChange(group.id, "vozbotinterage", next);
        };

        const handleMentionOnlyToggle = async () => {
          if (!group) {
            return;
          }
          const next = !mentionOnlyEnabled;
          setMiniFeedback(null);
          const success = await updateGroupSettings(group.id, {
            featureFlags: {
              botInterageMentionOnly: next,
              iaSomenteMencao: next,
              iaConversas: !next,
            },
          });
          setMiniFeedback({
            type: success ? "success" : "danger",
            message: success
              ? "Regra de menção do Bot interage atualizada."
              : "Não foi possível atualizar a regra de menção.",
          });
        };

        const handleAiModelSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
          if (!group) {
            return;
          }
          const value = event.target.value;
          onAiModelChange(group.id, value ? value : null);
        };

        const handleAiModelSubmit = async () => {
          if (!group) {
            return;
          }
          if (isRateLimited) {
            setMiniFeedback({
              type: "warning",
              message:
                "O limite diário da API Groq foi atingido. Aguarde a renovação ou utilize outra chave antes de alterar o modelo.",
            });
            return;
          }
          const success = await onAiModelSave(group.id);
          if (success) {
            setMiniFeedback({ type: "success", message: "Modelo do Bot interage atualizado com sucesso." });
          } else {
            setMiniFeedback({ type: "danger", message: "Não foi possível atualizar o modelo do Bot interage." });
          }
        };

        return (
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
                <div className="flex-grow-1">
                  <SectionHeading
                    title="Bot interage (IA)"
                    description="Gerencie o assistente de IA, modelo local com tools e configurações de voz."
                    tutorial={resolveGroupTutorial("botinterage", tutorials)}
                  />
                </div>
                {commandSaving ? (
                  <span className="d-flex align-items-center gap-2 text-secondary small">
                    <Spinner animation="border" size="sm" role="status" /> Atualizando...
                  </span>
                ) : null}
                {error ? (
                  <Alert variant="danger" className="mb-0 mt-2">
                    {error}
                  </Alert>
                ) : null}
              </div>
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-4">
              {miniFeedback ? (
                <Alert
                  variant={miniFeedback.type}
                  onClose={() => setMiniFeedback(null)}
                  dismissible
                  className="mb-0"
                >
                  {miniFeedback.message}
                </Alert>
              ) : null}

              <div className="d-flex flex-column gap-3">
                <div className="border rounded p-3 bg-body-tertiary">
                  <Form.Check
                    type="switch"
                    id={`settings-${group.id}-botinterage`}
                    label="Bot interage no chat"
                    checked={botInterageEnabled}
                    disabled={saving || commandSaving || !settings}
                    onChange={handleBotToggle}
                  />
                  <Form.Text className="text-secondary">
                    Permite que o bot responda automaticamente usando a IA conforme os comandos e mensagens recebidos.
                  </Form.Text>
                </div>
                <div className="border rounded p-3 bg-body-tertiary">
                  <Form.Check
                    type="switch"
                    id={`settings-${group.id}-botinterage-mention-only`}
                    label="Responder só quando mencionarem o robô"
                    checked={mentionOnlyEnabled}
                    disabled={saving || commandSaving || !settings}
                    onChange={() => void handleMentionOnlyToggle()}
                  />
                  <Form.Text className="text-secondary">
                    Quando ativo, a IA só responde se a mensagem mencionar o número real da instância ou responder uma mensagem do robô.
                  </Form.Text>
                </div>
                <div className="border rounded p-3 bg-body-tertiary">
                  <Form.Check
                    type="switch"
                    id={`settings-${group.id}-vozbotinterage`}
                    label="Responder comandos por voz"
                    checked={voiceEnabled}
                    disabled={saving || commandSaving || !settings}
                    onChange={handleVoiceToggle}
                  />
                  <Form.Text className="text-secondary">
                    Gera áudios com as respostas da IA utilizando a voz selecionada para o assistente.
                  </Form.Text>
                  <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => void handleVoicePreview()}
                      disabled={voicePreviewLoading}
                    >
                      {voicePreviewLoading ? (
                        <span className="d-flex align-items-center gap-2">
                          <Spinner animation="border" size="sm" role="status" /> Gerando...
                        </span>
                      ) : (
                        <span className="d-flex align-items-center gap-1">🔊 Prévia</span>
                      )}
                    </Button>
                    {voicePreviewError ? (
                      <span className="text-danger small">{voicePreviewError}</span>
                    ) : null}
                    {voicePreviewUrl ? (
                      <audio src={voicePreviewUrl} controls className="mt-1" style={{ maxWidth: 220 }} />
                    ) : null}
                  </div>
                </div>
                <div className="border rounded p-3 bg-body-tertiary">
                  <div className="d-flex flex-column gap-2">
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <strong className="mb-0">Modelo de linguagem</strong>
                      {aiModelsLoading ? (
                        <span className="d-flex align-items-center gap-2 text-secondary small">
                          <Spinner animation="border" size="sm" role="status" /> Carregando modelos...
                        </span>
                      ) : null}
                    </div>
                    <Form.Select
                      value={aiModelValue}
                      onChange={handleAiModelSelectChange}
                      disabled={modelSelectDisabled}
                    >
                      <option value={DEFAULT_GROQ_MODEL}>
                        Automático ({DEFAULT_GROQ_MODEL})
                      </option>
                      {combinedModelOptions.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                          {model.description ? ` — ${model.description}` : ""}
                        </option>
                      ))}
                    </Form.Select>
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => void handleAiModelSubmit()}
                        disabled={!canSaveModel}
                      >
                        {savingAiModel ? (
                          <span className="d-flex align-items-center gap-2">
                            <Spinner animation="border" size="sm" role="status" /> Salvando...
                          </span>
                        ) : (
                          "Salvar modelo"
                        )}
                      </Button>
                      <small className="text-secondary">
                        Se nenhum modelo for escolhido, utilizaremos {DEFAULT_GROQ_MODEL}.
                      </small>
                    </div>
                    {aiModelsError ? (
                      <div className="text-danger small">{aiModelsError}</div>
                    ) : null}
                    {isRateLimited ? (
                      <div className="text-warning small">
                        Limite diário da API Groq atingido. Aguarde a renovação automática antes de solicitar novas respostas.
                      </div>
                    ) : aiModelsQuota !== null ? (
                      <div className="text-secondary small">
                        Limite restante hoje: {aiModelsQuota}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="border-top pt-3">
                <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2 mb-3">
                  <div>
                    <h4 className="h6 mb-0">Configuração do Bot interage</h4>
                    <small className="text-secondary">
                      Ajuste as credenciais, prompt e voz usados nas respostas automáticas da IA.
                    </small>
                  </div>
                  {isAiSaving ? (
                    <span className="d-flex align-items-center gap-2 text-secondary small">
                      <Spinner animation="border" size="sm" role="status" /> Salvando...
                    </span>
                  ) : null}
                </div>
                <Row className="g-3">
                  <Col md={6}>
                    <div className="border rounded p-3 h-100 bg-body-tertiary">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div>
                          <strong className="d-block mb-1">Sua chave Groq</strong>
                          <div className="text-secondary small">
                            {hasGroqKeys
                              ? `${groqKeysCount} ${groqKeysCount === 1 ? "chave cadastrada" : "chaves cadastradas"}.`
                              : "Obrigatória para ativar a IA. A chave é usada somente nos seus grupos."}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={handleOpenAiKeyModal}
                          disabled={saving}
                        >
                          Configurar
                        </Button>
                      </div>
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="border rounded p-3 h-100 bg-body-tertiary">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div>
                          <strong className="d-block mb-1">Prompt personalizado</strong>
                          <div className="text-secondary small">{promptPreview}</div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={handleOpenAiPromptModal}
                          disabled={saving}
                        >
                          Editar
                        </Button>
                      </div>
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="border rounded p-3 h-100 bg-body-tertiary">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div>
                          <strong className="d-block mb-1">Voz das respostas</strong>
                          <div className="text-secondary small">{aiVoiceLabel}</div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={handleOpenAiVoiceModal}
                          disabled={saving}
                        >
                          Selecionar voz
                        </Button>
                      </div>
                    </div>
                  </Col>
                </Row>
              </div>
            </Card.Body>
          </Card>
        );
      case "welcome":
        return (
          <Card id="bemvindo" className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
                <div className="flex-grow-1">
                  <SectionHeading
                    title="Mensagem de boas-vindas"
                    description="Personalize a saudação enviada a novos membros com texto, mídia e stickers."
                    tutorial={resolveGroupTutorial("welcome", tutorials)}
                  />
                </div>
                <div className="d-flex align-items-center gap-2">
                  <Form.Check
                    type="switch"
                    id={`settings-${group.id}-welcome-enabled`}
                    label="Ativar mensagens"
                    checked={welcomeEnabled}
                    disabled={!settings || saving || welcomeSaving || commandSaving}
                    onChange={() => group && onWelcomeToggle(group.id, !welcomeEnabled)}
                  />
                  <span className={`badge ${welcomeEnabled ? "bg-success" : "bg-secondary"}`}>
                    {welcomeEnabled ? "Ativo" : "Inativo"}
                  </span>
                </div>
              </div>
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              {welcomeSaving ? (
                <div className="d-flex align-items-center gap-2 text-secondary">
                  <Spinner animation="border" size="sm" role="status" /> Salvando mensagem...
                </div>
              ) : null}
              {error ? (
                <Alert variant="danger" className="mb-0">
                  {error}
                </Alert>
              ) : null}

              <Form.Group controlId={`settings-${group.id}-welcome-caption`}>
                <Form.Label>Legenda enviada com a mídia</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={welcomeCaption}
                  onChange={(event) => group && onWelcomeCaptionChange(group.id, event.target.value)}
                  disabled={saving || welcomeSaving}
                />
                <Form.Text className="text-secondary">
                  Utilize variáveis como {"{{pushName}}"}, {"{{numero}}"}, {"{{nomeGrupo}}"} e {"{{prefixo}}"} para personalizar a
                  mensagem.
                </Form.Text>
              </Form.Group>

              <Form.Group controlId={`settings-${group.id}-welcome-media`}>
                <Form.Label>URL de mídia opcional</Form.Label>
                <Form.Control
                  type="url"
                  placeholder="https://..."
                  value={welcomeMediaUrl}
                  onChange={(event) => group && onWelcomeMediaUrlChange(group.id, event.target.value)}
                  disabled={saving || welcomeSaving || welcomeUploading}
                />
                <Form.Text className="text-secondary">
                  Informe um link direto para imagem, vídeo curto ou áudio hospedado externamente.
                </Form.Text>
              </Form.Group>

              {/* Pré-visualização da mídia principal (URL ou arquivo enviado) */}
              {(() => {
                const src =
                  normalizeMediaSrc(welcomeMediaUrl || settings.welcomeConfig.mediaUrl || undefined,
                    settings.welcomeConfig.mediaPath || undefined);
                if (!src) return null;
                const inferredKind = settings.welcomeConfig.asSticker ? "sticker" : undefined;
                return (
                  <div className="d-flex flex-column gap-2 mb-2">
                    <strong className="small">Prévia da mídia principal</strong>
                    <MediaPreview src={src} kind={inferredKind as any} caption={undefined} />
                  </div>
                );
              })()}

              <Form.Group controlId={`settings-${group.id}-welcome-upload`}>
                <Form.Label>Enviar mídia pelo painel</Form.Label>
                <Form.Control
                  type="file"
                  accept="image/*,video/*,audio/*"
                  onChange={handleWelcomeFileChange}
                  disabled={saving || welcomeSaving || welcomeUploading}
                />
                <Form.Text className="text-secondary">
                  Utilize esta opção para enviar arquivos diretamente do seu dispositivo. O link acima continua disponível caso prefira hospedar a mídia externamente.
                </Form.Text>
              </Form.Group>

              {welcomeUploading ? (
                <div className="d-flex align-items-center gap-2 text-secondary">
                  <Spinner animation="border" size="sm" role="status" /> Enviando mídia...
                </div>
              ) : null}

              <Form.Check
                type="switch"
                id={`settings-${group.id}-welcome-sticker`}
                label="Enviar a mídia como figurinha quando possível"
                checked={welcomeAsSticker}
                disabled={saving || welcomeSaving || welcomeUploading}
                onChange={(event) => group && onWelcomeAsStickerChange(group.id, event.target.checked)}
              />
              <Form.Text className="text-secondary">
                Para melhores resultados utilize imagens quadradas com até 256 KB.
              </Form.Text>

              <div className="border rounded p-3 bg-body-tertiary">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <strong className="d-block">Mídias adicionais</strong>
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => group && onWelcomeAttachmentAdd(group.id)}
                  >
                    Adicionar anexo
                  </Button>
                </div>
                {(state?.draftWelcomeAttachments || []).length === 0 ? (
                  <small className="text-secondary">Nenhum anexo adicionado.</small>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {(state?.draftWelcomeAttachments || []).map((att: any, idx: number) => (
                      <div key={idx} className="border rounded p-2">
                        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                          <span className="badge bg-secondary">#{idx + 1}</span>
                          <Form.Select
                            style={{ maxWidth: 170 }}
                            value={att?.kind || "image"}
                            onChange={(e) => group && onWelcomeAttachmentPatch(group.id, idx, { kind: e.target.value })}
                          >
                            <option value="image">Imagem</option>
                            <option value="video">Vídeo</option>
                            <option value="audio">Áudio</option>
                            <option value="document">Documento</option>
                            <option value="sticker">Figurinha</option>
                            <option value="vcard">Contato (VCard)</option>
                          </Form.Select>
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            title="Mover anexo para cima"
                            aria-label="Mover anexo para cima"
                            onClick={() => group && onWelcomeAttachmentMove(group.id, idx, "up")}
                            disabled={idx === 0 || saving || welcomeSaving}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            title="Mover anexo para baixo"
                            aria-label="Mover anexo para baixo"
                            onClick={() => group && onWelcomeAttachmentMove(group.id, idx, "down")}
                            disabled={
                              idx >= (state?.draftWelcomeAttachments || []).length - 1 ||
                              saving ||
                              welcomeSaving
                            }
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => group && onWelcomeAttachmentRemove(group.id, idx)}
                          >
                            Remover
                          </Button>
                        </div>

                        {att?.kind === "vcard" ? (
                          <div className="d-flex flex-column gap-2">
                            <Form.Control
                              type="text"
                              placeholder="Nome do contato"
                              value={att?.name || ""}
                              onChange={(e) => group && onWelcomeAttachmentPatch(group.id, idx, { name: e.target.value })}
                            />
                            <Form.Control
                              as="textarea"
                              rows={3}
                              placeholder={"BEGIN:VCARD\nVERSION:3.0\nFN:Seu Nome\nTEL:+5511999999999\nEND:VCARD"}
                              value={att?.vcard || ""}
                              onChange={(e) => group && onWelcomeAttachmentPatch(group.id, idx, { vcard: e.target.value })}
                            />
                          </div>
                        ) : (
                          <div className="d-flex flex-column gap-2">
                        {att?.path || att?.url ? (
                          <div>
                            <strong className="small">Prévia do anexo</strong>
                            {(() => {
                              const src = normalizeMediaSrc(att?.url, att?.path);
                              return src ? <MediaPreview src={src} kind={att?.kind} caption={att?.caption} /> : null;
                            })()}
                          </div>
                        ) : null}
                            <Form.Control
                              type="file"
                              onChange={async (e) => {
                                const file = e.currentTarget.files?.[0];
                                if (!file || !group) return;
                                try {
                                  const uploaded = await onWelcomeAttachmentUpload(group.id, file, {
                                    mediaType: ["video", "audio", "document", "sticker"].includes(att?.kind)
                                      ? att.kind
                                      : "image",
                                    previousPath: att?.path || null,
                                  });
                                  onWelcomeAttachmentPatch(group.id, idx, {
                                    path: uploaded.path,
                                    url: null,
                                    fileName: uploaded.fileName,
                                    mimeType: uploaded.mimeType,
                                  });
                                } catch (err: any) {
                                  setMiniFeedback({ type: "danger", message: String(err?.message || err) });
                                }
                              }}
                              disabled={saving || welcomeSaving}
                            />
                            {att?.kind !== "sticker" ? (
                              <Form.Control
                                type="text"
                                placeholder="Legenda deste anexo (opcional)"
                                value={att?.caption || ""}
                                onChange={(e) => group && onWelcomeAttachmentPatch(group.id, idx, { caption: e.target.value })}
                              />
                            ) : null}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="d-flex flex-wrap align-items-center gap-2">
                <Button
                  size="sm"
                  type="button"
                  onClick={() => group && onWelcomeSave(group.id)}
                  disabled={saving || welcomeSaving || welcomeUploading}
                >
                  Salvar mensagem de boas-vindas
                </Button>
                {showRemoveMedia ? (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline-danger"
                    onClick={() => group && onWelcomeClearMedia(group.id)}
                    disabled={saving || welcomeSaving || welcomeUploading}
                  >
                    Remover mídia atual
                  </Button>
                ) : null}
                <small className="text-secondary">
                  As alterações são aplicadas imediatamente para novos participantes.
                </small>
              </div>

              {welcomeUpdatedAt ? (
                <small className="text-secondary">
                  Última atualização registrada em {formatDate(welcomeUpdatedAt)}.
                </small>
              ) : null}

              <WelcomeReplyButtonsForm
                groupId={group.id}
                template={settings?.welcomeConfig.replyButtons}
                disabled={!nativeButtonsAvailable}
                onSave={async (templateDraft) => {
                  if (!group) {
                    return false;
                  }
                  const success = await onToggle({
                    welcomeConfig: { replyButtons: templateDraft },
                  });
                  if (success) {
                    await onReloadSettings(group.id);
                  }
                  return success;
                }}
                onFeedback={setMiniFeedback}
              />
            </Card.Body>
          </Card>
        );
      case "autoresponse": {
        const autoresponseTutorial = resolveGroupTutorial("autoresponse", tutorials);
        return (
          <Card id="autoresposta" className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
                <div className="flex-grow-1">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <Card.Title as="h3" className="h6 mb-0">
                      Autorespostas inteligentes
                      {autoResponsesDirty ? (
                        <span className="badge bg-warning text-dark ms-2">Alterado</span>
                      ) : null}
                    </Card.Title>
                    {autoresponseTutorial ? (
                      <TutorialTrigger
                        label="Autorespostas"
                        tutorial={autoresponseTutorial}
                        buttonVariant="outline-secondary"
                        buttonSize="sm"
                        className="p-1 d-inline-flex align-items-center justify-content-center"
                        iconOnly
                        ariaLabel="Abrir tutorial sobre autorespostas"
                      />
                    ) : null}
                  </div>
                  <small className="text-secondary">
                    Habilite respostas automáticas para comandos frequentes do seu grupo.
                  </small>
                </div>
                <Form.Check
                  type="switch"
                  id={`settings-${group.id}-autoresposta`}
                  label="Ativar autorespostas"
                  checked={autorespostaEnabled}
                  disabled={saving || commandSaving || !settings}
                  onChange={() =>
                    group &&
                    onCommandToggleChange(
                      group.id,
                      "autoresposta",
                      !autorespostaEnabled,
                    )
                  }
                />
              </div>
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              <p className="text-secondary mb-0">
                Cadastre respostas para palavras-chave, comandos com prefixo ou mensagens completas e mantenha o atendimento disponível 24/7.
              </p>
              <p className="text-secondary mb-0">
                Também é possível gerenciar respostas pelo grupo com os comandos <code>addautorepo</code>, <code>rmautorepo</code> e <code>listaautorepo</code>.
              </p>
              {miniFeedback ? (
                <Alert
                  variant={miniFeedback.type}
                  onClose={() => setMiniFeedback(null)}
                  dismissible
                  className="mb-0"
                >
                  {miniFeedback.message}
                </Alert>
              ) : null}
              <div className="d-flex flex-wrap align-items-center gap-2">
                <Button
                  size="sm"
                  type="button"
                  onClick={handleOpenAutoResponseCreate}
                  disabled={
                    !group ||
                    saving ||
                    autoResponseBusy ||
                    autoResponses.length >= AUTO_RESPONSE_LIMIT
                  }
                >
                  Nova autoresposta
                </Button>
                {savingAutoResponses ? (
                  <span className="d-flex align-items-center gap-2 text-secondary small">
                    <Spinner animation="border" size="sm" role="status" /> Salvando autorespostas...
                  </span>
                ) : null}
                <small className="text-secondary">
                  {`${autoResponses.length} de ${AUTO_RESPONSE_LIMIT} respostas cadastradas.`}
                </small>
              </div>
              {autoResponses.length > 0 ? (
                <div className="d-flex flex-column gap-2">
                  {autoResponses.map((response) => (
                    <div key={response.id} className="border rounded p-3 bg-body-tertiary">
                      <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                        <div>
                          <div className="d-flex flex-wrap align-items-center gap-2">
                            <strong>{response.triggers.join(", ")}</strong>
                            <span className="badge bg-secondary text-uppercase">
                              {response.matchMode === "contains" ? "Contém" : "Igual"}
                            </span>
                          </div>
                          <small className="text-secondary d-block">
                            Última atualização em {formatDate(response.updatedAt ?? null)}.
                          </small>
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => handleOpenAutoResponseEdit(response)}
                            disabled={saving || autoResponseBusy}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => void handleAutoResponseDelete(response)}
                            disabled={saving || autoResponseBusy}
                          >
                            Remover
                          </Button>
                        </div>
                      </div>
                      {response.responseText ? (
                        <p className="mb-0 text-secondary" style={{ whiteSpace: "pre-wrap" }}>
                          {response.responseText}
                        </p>
                      ) : null}
                      {response.responseMedia ? (
                        <div className="d-flex flex-column gap-1">
                          <div className="text-secondary small">
                            {`Mídia: ${AUTO_RESPONSE_MEDIA_LABELS[response.responseMedia.mediaType]}`}
                            {response.responseMedia.url
                              ? " · link"
                              : response.responseMedia.fileName
                                ? ` · ${response.responseMedia.fileName}`
                                : response.responseMedia.path
                                  ? ` · ${response.responseMedia.path}`
                                  : ""}
                          </div>
                          {response.responseMedia.caption ? (
                            <div className="text-secondary small" style={{ whiteSpace: "pre-wrap" }}>
                              {`Legenda: ${response.responseMedia.caption}`}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {response.responseVcard ? (
                        <div className="text-secondary small">
                          {`Contato: ${response.responseVcard.name}`}
                          {response.responseVcard.phone ? ` • ${response.responseVcard.phone}` : ""}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <Alert variant="secondary" className="mb-0">
                  Nenhuma autoresposta cadastrada ainda. Clique em &quot;Nova autoresposta&quot; para adicionar a primeira configuração.
                </Alert>
              )}
            </Card.Body>
          </Card>
        );
      }
      case "broadcast":
        if (!group || !settings) {
          return (
            <Card className="shadow-sm border-0">
              <Card.Body className="d-flex justify-content-center py-5">
                <Spinner animation="border" role="status" />
              </Card.Body>
            </Card>
          );
        }
        return (
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <SectionHeading
                title="Disparo manual"
                description="Envie mensagens únicas com texto, mídia ou botões para o grupo."
                tutorial={resolveGroupTutorial("welcome", tutorials)}
              />
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              <BroadcastComposer
                group={group}
                settings={settings}
                nativeButtonsAvailable={nativeButtonsAvailable}
                onReloadSettings={onReloadSettings}
                onFeedback={setMiniFeedback}
                restApiKey={restApiKey}
              />
            </Card.Body>
          </Card>
        );
      case "horapg": {
        const horapgConfig = settings.horapgConfig;
        const storedImageSrc = normalizeMediaSrc(
          horapgConfig?.imageUrl ?? null,
          horapgConfig?.imagePath ?? null,
        );
        const draftImageUrl = horapgImageUrlDraft.trim();
        const previewSrc = draftImageUrl || storedImageSrc || HORAPG_IMAGE_FALLBACK_URL;
        const parsedTimes = parseHorapgTimesInput(horapgTimesDraft);
        const hasCustomImage = Boolean(horapgConfig?.imagePath);
        const defaultTimezoneLabel = HORAPG_DEFAULT_TIMEZONE.replace(/_/g, " ");

        return (
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <SectionHeading
                title="Horários pagantes"
                description="Ative o envio automático dos horários pagantes, personalize os horários e a imagem compartilhada."
                tutorial={resolveGroupTutorial("horapg", tutorials)}
              />
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-4">
              {horapgFeedback ? (
                <Alert
                  variant={horapgFeedback.type}
                  onClose={() => setHorapgFeedback(null)}
                  dismissible
                  className="mb-0"
                >
                  {horapgFeedback.message}
                </Alert>
              ) : null}

              <Row className="g-4">
                <Col lg={7} className="d-flex flex-column gap-3">
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <Form.Check
                      id={`horapg-enabled-${group.id}`}
                      type="switch"
                      label={<span className="fw-semibold text-dark">Enviar horários automaticamente</span>}
                      checked={horapgEnabledDraft}
                      onChange={(event) => setHorapgEnabledDraft(event.target.checked)}
                      disabled={horapgSaving || horapgUploading}
                    />
                    <span className="text-secondary small">
                      {horapgEnabledDraft ? "Sistema ativo" : "Sistema desativado"}
                    </span>
                  </div>

                  <Form.Group controlId={`horapg-times-${group.id}`}>
                    <Form.Label>Horários (HH:MM)</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      placeholder="Ex.: 09:00 12:30 18:45"
                      value={horapgTimesDraft}
                      onChange={(event) => setHorapgTimesDraft(event.target.value)}
                      disabled={horapgSaving || horapgUploading}
                    />
                    <Form.Text className="text-secondary">
                      Separe os horários por espaço ou vírgula. Máximo de 12 horários.
                    </Form.Text>
                    {parsedTimes.length > 0 ? (
                      <div className="d-flex flex-wrap gap-2 mt-2">
                        {parsedTimes.map((time) => (
                          <Badge bg="secondary" key={time}>
                            {time}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </Form.Group>

                  <Form.Group controlId={`horapg-timezone-${group.id}`}>
                    <Form.Label>Fuso horário (opcional)</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="Ex.: America/Sao_Paulo"
                      value={horapgTimezoneDraft}
                      onChange={(event) => setHorapgTimezoneDraft(event.target.value)}
                      disabled={horapgSaving || horapgUploading}
                    />
                    <Form.Text className="text-secondary">
                      Deixe em branco para usar o padrão {defaultTimezoneLabel}.
                    </Form.Text>
                  </Form.Group>

                  <Form.Group controlId={`horapg-mention-${group.id}`}>
                    <Form.Check
                      type="switch"
                      label="Mencionar todos os participantes ao enviar"
                      checked={horapgMentionAllDraft}
                      onChange={(event) => setHorapgMentionAllDraft(event.target.checked)}
                      disabled={horapgSaving || horapgUploading}
                    />
                    <Form.Text className="text-secondary">
                      A menção considera os participantes disponíveis pelo painel e pode ser limitada em grupos muito grandes.
                    </Form.Text>
                  </Form.Group>

                  <Form.Group controlId={`horapg-image-url-${group.id}`}>
                    <Form.Label>Imagem por URL (opcional)</Form.Label>
                    <Form.Control
                      type="url"
                      placeholder="https://..."
                      value={horapgImageUrlDraft}
                      onChange={(event) => setHorapgImageUrlDraft(event.target.value)}
                      disabled={horapgSaving || horapgUploading}
                    />
                    <Form.Text className="text-secondary">
                      Informe um link direto para usar uma imagem externa. Se preferir, envie um arquivo abaixo.
                    </Form.Text>
                  </Form.Group>
                </Col>

                <Col lg={5} className="d-flex flex-column gap-3">
                  <div className="d-flex flex-column gap-2">
                    <span className="text-secondary small text-uppercase">Pré-visualização</span>
                    <div className="border rounded overflow-hidden">
                      <Image src={previewSrc} alt="Pré-visualização da imagem dos horários pagantes" fluid />
                    </div>
                    <Form.Text className="text-secondary">
                      Se nenhuma imagem personalizada estiver definida, será usada a imagem padrão do sistema.
                    </Form.Text>
                  </div>

                  <Form.Group>
                    <Form.Label className="fw-semibold">Enviar nova imagem</Form.Label>
                    <Form.Control
                      type="file"
                      accept="image/*"
                      onChange={handleHorapgImageUpload}
                      disabled={horapgUploading}
                    />
                    <Form.Text className="text-secondary">
                      Formatos recomendados: JPG ou PNG com até 2&nbsp;MB.
                    </Form.Text>
                  </Form.Group>

                  <div className="d-flex flex-wrap gap-2">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => void handleHorapgImageRemove()}
                      disabled={horapgUploading || (!hasCustomImage && !storedImageSrc)}
                    >
                      {horapgUploading ? (
                        <span className="d-inline-flex align-items-center gap-2">
                          <Spinner animation="border" size="sm" role="status" />
                          Removendo...
                        </span>
                      ) : (
                        "Remover imagem enviada"
                      )}
                    </Button>
                  </div>
                </Col>
              </Row>

              <div className="d-flex flex-column gap-2">
                <div className="d-flex justify-content-end">
                  <Button
                    variant="success"
                    disabled={horapgSaving || horapgUploading}
                    onClick={() => void handleHorapgSave()}
                  >
                    {horapgSaving ? (
                      <span className="d-inline-flex align-items-center gap-2">
                        <Spinner animation="border" size="sm" role="status" />
                        Salvando...
                      </span>
                    ) : (
                      "Salvar configurações"
                    )}
                  </Button>
                </div>
                <small className="text-secondary">
                  Dica: também é possível ajustar os horários via comando <code>{activeCommandPrefix}addhorapg</code> diretamente no grupo.
                </small>
              </div>

            </Card.Body>
          </Card>
        );
      }
      case "schedule": {
        const defaultTimezoneLabel = HORAPG_DEFAULT_TIMEZONE.replace(/_/g, " ");
        const closeLimitReached = parsedCloseTimes.length >= limitScheduleTimes;
        const openLimitReached = parsedOpenTimes.length >= limitScheduleTimes;

        return (
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <SectionHeading
                title="Abrir e fechar grupo"
                description="Defina horários para bloquear mensagens apenas para administradores ou liberar o grupo automaticamente."
                tutorial={resolveGroupTutorial("schedule", tutorials)}
              />
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-4">
              {scheduleFeedback ? (
                <Alert
                  variant={scheduleFeedback.type}
                  onClose={() => setScheduleFeedback(null)}
                  dismissible
                  className="mb-0"
                >
                  {scheduleFeedback.message}
                </Alert>
              ) : null}

              <Row className="g-4">
                <Col lg={6} className="d-flex flex-column gap-3">
                  <Form.Group controlId={`schedule-close-enabled-${group?.id ?? "current"}`}>
                    <Form.Check
                      type="switch"
                      label="Fechar o grupo automaticamente"
                      checked={closeEnabledDraft}
                      onChange={(event) => {
                        setCloseEnabledDraft(event.target.checked);
                        setScheduleFeedback(null);
                      }}
                      disabled={scheduleSaving}
                    />
                    <Form.Text className="text-secondary">
                      Quando ativo, o grupo ficará apenas para administradores nos horários escolhidos.
                    </Form.Text>
                  </Form.Group>

                  <Form.Group controlId={`schedule-close-times-${group?.id ?? "current"}`}>
                    <Form.Label>Adicionar horário de fechamento</Form.Label>
                    <InputGroup>
                      <Form.Control
                        type="time"
                        step={60}
                        value={closeTimeInput}
                        onChange={(event) => setCloseTimeInput(event.target.value)}
                        disabled={scheduleSaving || closeLimitReached}
                      />
                      <Button
                        variant="outline-primary"
                        onClick={handleAddCloseTime}
                        disabled={scheduleSaving || closeLimitReached}
                      >
                        Adicionar
                      </Button>
                    </InputGroup>
                    <Form.Text className="text-secondary">
                      Máximo de {limitScheduleTimes} horários. Clique em um horário listado para removê-lo.
                    </Form.Text>
                    <div className="d-flex flex-wrap gap-2 mt-2">
                      {parsedCloseTimes.length > 0 ? (
                        parsedCloseTimes.map((time) => (
                          <Button
                            key={`close-${time}`}
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => handleRemoveCloseTime(time)}
                            disabled={scheduleSaving}
                            className="d-inline-flex align-items-center gap-2"
                          >
                            {time}
                            <span aria-hidden="true">×</span>
                            <span className="visually-hidden">Remover horário {time}</span>
                          </Button>
                        ))
                      ) : (
                        <span className="text-secondary small">Nenhum horário definido ainda.</span>
                      )}
                    </div>
                  </Form.Group>
                </Col>

                <Col lg={6} className="d-flex flex-column gap-3">
                  <Form.Group controlId={`schedule-open-enabled-${group?.id ?? "current"}`}>
                    <Form.Check
                      type="switch"
                      label="Abrir o grupo automaticamente"
                      checked={openEnabledDraft}
                      onChange={(event) => {
                        setOpenEnabledDraft(event.target.checked);
                        setScheduleFeedback(null);
                      }}
                      disabled={scheduleSaving}
                    />
                    <Form.Text className="text-secondary">
                      Quando ativo, o grupo volta a aceitar mensagens de todos nos horários configurados.
                    </Form.Text>
                  </Form.Group>

                  <Form.Group controlId={`schedule-open-times-${group?.id ?? "current"}`}>
                    <Form.Label>Adicionar horário de abertura</Form.Label>
                    <InputGroup>
                      <Form.Control
                        type="time"
                        step={60}
                        value={openTimeInput}
                        onChange={(event) => setOpenTimeInput(event.target.value)}
                        disabled={scheduleSaving || openLimitReached}
                      />
                      <Button
                        variant="outline-primary"
                        onClick={handleAddOpenTime}
                        disabled={scheduleSaving || openLimitReached}
                      >
                        Adicionar
                      </Button>
                    </InputGroup>
                    <Form.Text className="text-secondary">
                      Máximo de {limitScheduleTimes} horários. Clique em um horário listado para removê-lo.
                    </Form.Text>
                    <div className="d-flex flex-wrap gap-2 mt-2">
                      {parsedOpenTimes.length > 0 ? (
                        parsedOpenTimes.map((time) => (
                          <Button
                            key={`open-${time}`}
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => handleRemoveOpenTime(time)}
                            disabled={scheduleSaving}
                            className="d-inline-flex align-items-center gap-2"
                          >
                            {time}
                            <span aria-hidden="true">×</span>
                            <span className="visually-hidden">Remover horário {time}</span>
                          </Button>
                        ))
                      ) : (
                        <span className="text-secondary small">Nenhum horário definido ainda.</span>
                      )}
                    </div>
                  </Form.Group>
                </Col>
              </Row>

              <Row className="g-4">
                <Col lg={6}>
                  <Form.Group controlId={`schedule-timezone-${group?.id ?? "current"}`}>
                    <Form.Label>Fuso horário (opcional)</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="Ex.: America/Sao_Paulo"
                      value={scheduleTimezoneDraft}
                      onChange={(event) => setScheduleTimezoneDraft(event.target.value)}
                      disabled={scheduleSaving}
                    />
                    <Form.Text className="text-secondary">
                      Deixe em branco para utilizar o padrão {defaultTimezoneLabel}.
                    </Form.Text>
                  </Form.Group>
                </Col>
                <Col lg={6} className="d-flex align-items-end">
                  <div className="w-100 text-secondary small">
                    Dica: os comandos{" "}
                    <code>{activeCommandPrefix}fecharauto</code>, <code>{activeCommandPrefix}abrirauto</code> e <code>{activeCommandPrefix}horariotz</code> também atualizam esses horários diretamente pelo grupo.
                  </div>
                </Col>
              </Row>

              <div className="d-flex justify-content-end">
                <Button variant="success" disabled={scheduleSaving} onClick={() => void handleScheduleSave()}>
                  {scheduleSaving ? (
                    <span className="d-inline-flex align-items-center gap-2">
                      <Spinner animation="border" size="sm" role="status" />
                      Salvando...
                    </span>
                  ) : (
                    "Salvar horários"
                  )}
                </Button>
              </div>
            </Card.Body>
          </Card>
        );
      }
      case "sweepstakes":
        return (
          <GroupSweepstakesPanel
            group={group}
            tutorial={resolveGroupTutorial("sweepstakes", tutorials)}
            feedback={miniFeedback}
            onFeedback={setMiniFeedback}
          />
        );
      case "details":
        return (
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <SectionHeading
                title="Informações do grupo"
                description="Atualize nome, descrição e permissões administrativas diretamente pelo painel."
                tutorial={resolveGroupTutorial("details", tutorials)}
              />
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-4">
              {miniFeedback ? (
                <Alert
                  variant={miniFeedback.type}
                  onClose={() => setMiniFeedback(null)}
                  dismissible
                >
                  {miniFeedback.message}
                </Alert>
              ) : null}

              <Form onSubmit={handleBasicSubmit} className="d-flex flex-column gap-3">
                <div>
                  <Card.Title as="h4" className="h6 mb-2">
                    Informações básicas
                  </Card.Title>
                  <Form.Group controlId={`details-name-${group.id}`} className="mb-3">
                    <Form.Label>Nome do grupo</Form.Label>
                    <Form.Control
                      type="text"
                      value={detailsForm.name}
                      onChange={(event) => updateDetailsField("name", event.target.value)}
                      disabled={savingBasic}
                      required
                    />
                  </Form.Group>
                  <Form.Group controlId={`details-description-${group.id}`} className="mb-3">
                    <Form.Label>Descrição do grupo</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={detailsForm.description}
                      onChange={(event) => updateDetailsField("description", event.target.value)}
                      disabled={savingBasic}
                      placeholder="Texto exibido na descrição do grupo"
                    />
                    <Form.Text className="text-secondary">
                      Deixe em branco para remover a descrição atual.
                    </Form.Text>
                  </Form.Group>
                  <Form.Group controlId={`details-invite-${group.id}`} className="mb-3">
                    <Form.Label>Link do grupo</Form.Label>
                    <Form.Control
                      type="url"
                      value={detailsForm.inviteLink}
                      onChange={(event) => updateDetailsField("inviteLink", event.target.value)}
                      disabled={savingBasic}
                      placeholder="https://chat.whatsapp.com/..."
                    />
                    <Form.Text className="text-secondary">
                      Informe o link de convite para sincronizar as informações do grupo.
                    </Form.Text>
                  </Form.Group>
                </div>
                <div className="d-flex justify-content-end">
                  <Button type="submit" disabled={savingBasic}>
                    {savingBasic ? "Salvando..." : "Salvar alterações"}
                  </Button>
                </div>
              </Form>

              <div className="d-flex flex-column gap-3">
                <Card.Title as="h4" className="h6 mb-0">
                  Configurações do grupo
                </Card.Title>
                <Form.Check
                  type="switch"
                  id={`details-admins-${group.id}`}
                  label="Somente administradores podem enviar mensagens"
                  checked={adminsOnly}
                  onChange={handleAdminsOnlyChange}
                  disabled={savingAdmins}
                />
                <Form.Check
                  type="switch"
                  id={`details-locked-${group.id}`}
                  label="Travar configurações do grupo"
                  checked={locked}
                  onChange={handleLockedChange}
                  disabled={savingLocked}
                />
              </div>

              <div>
                <Card.Title as="h4" className="h6 mb-2">
                  Mensagens temporárias
                </Card.Title>
                <div className="d-flex flex-wrap align-items-end gap-3">
                  <Form.Group controlId={`details-ephemeral-${group.id}`} className="flex-grow-1">
                    <Form.Label>Duração das mensagens</Form.Label>
                    <Form.Select
                      value={ephemeral}
                      onChange={(event) => setEphemeral(event.target.value)}
                      disabled={savingEphemeral}
                    >
                      <option value="off">Desativado</option>
                      <option value="24h">24 horas</option>
                      <option value="7d">7 dias</option>
                      <option value="90d">90 dias</option>
                    </Form.Select>
                  </Form.Group>
                  <Button
                    variant="outline-primary"
                    onClick={() => void handleEphemeralSave()}
                    disabled={savingEphemeral}
                  >
                    {savingEphemeral ? "Salvando..." : "Salvar duração"}
                  </Button>
                </div>
              </div>

              <div className="border-top pt-3">
                <Card.Title as="h4" className="h6 mb-3">
                  Foto do grupo
                </Card.Title>
                {group.imageUrl ? (
                  <Image
                    src={group.imageUrl}
                    alt={`Foto atual de ${group.name}`}
                    rounded
                    className="border mb-3"
                    style={{ maxWidth: 200, height: "auto" }}
                  />
                ) : (
                  <p className="text-secondary mb-3">Nenhuma foto sincronizada no momento.</p>
                )}
                <Form.Group controlId={`details-photo-${group.id}`} className="mb-3">
                  <Form.Label>Enviar nova foto</Form.Label>
                  <Form.Control
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    disabled={savingPhoto}
                  />
                  <Form.Text className="text-secondary">
                    Prefira imagens quadradas com boa iluminação para destacar o grupo.
                  </Form.Text>
                </Form.Group>
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <Button
                    variant="outline-secondary"
                    onClick={() => void handlePhotoRemove()}
                    disabled={removingPhoto || !group.imageUrl}
                  >
                    {removingPhoto ? "Removendo..." : "Remover foto"}
                  </Button>
                  <small className="text-secondary">A atualização é aplicada imediatamente no WhatsApp.</small>
                </div>
              </div>

              <div className="border-top pt-3">
                <Card.Title as="h4" className="h6 text-danger mb-2">
                  Remover este grupo
                </Card.Title>
                <p className="text-secondary mb-3">
                  Caso este grupo não deva mais ser automatizado, você pode removê-lo do painel. A ação
                  não desconecta participantes existentes, mas impede novas automações até vinculá-lo
                  novamente.
                </p>
                <Button
                  variant="outline-danger"
                  onClick={() => onDeleteGroup(group)}
                  disabled={isDeletingCurrentGroup}
                >
                  {isDeletingCurrentGroup ? "Removendo..." : "Desvincular grupo"}
                </Button>
              </div>
            </Card.Body>
          </Card>
        );
      case "media":
        return (
          <Card className="shadow-sm border-0 w-100" style={{ minWidth: 0 }}>
            <Card.Header className="bg-body-tertiary">
              <SectionHeading
                title="Menus do bot"
                description="Ajuste os textos enviados pelos comandos de menu e personalize a imagem de fundo exibida aos clientes."
                tutorial={resolveGroupTutorial("media", tutorials)}
              />
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-4 align-items-stretch">
              {miniFeedback ? (
                <Alert
                  variant={miniFeedback.type}
                  onClose={() => setMiniFeedback(null)}
                  dismissible
                >
                  {miniFeedback.message}
                </Alert>
              ) : null}

              <div className="d-flex flex-column gap-3 align-self-stretch">
                <Card.Title as="h4" className="h6 mb-0">
                  Textos dos menus automáticos
                </Card.Title>
                <p className="text-secondary mb-0">
                  Defina o conteúdo enviado quando os comandos menu, menuadmin, comandos e outros forem utilizados.
                </p>
                <div className="d-flex flex-column gap-3">
                  {MENU_TEXT_KEYS.map((key) => {
                    const info = MENU_TEXT_LABELS[key];
                    const draftValue = menuDrafts[key] ?? "";
                    const lines = draftValue.split("\n").filter((line) => line.trim().length > 0);
                    const preview =
                      lines.length === 0
                        ? "Nenhum texto configurado."
                        : lines.length <= 2
                          ? lines.join("\n")
                          : `${lines.slice(0, 2).join("\n")}\n…`;
                    const dirty = menuDirty[key] ?? false;
                    return (
                      <div key={key} className="border rounded p-3 bg-body-tertiary">
                        <div className="d-flex justify-content-between align-items-start gap-3">
                          <div>
                            <div className="d-flex align-items-center gap-2">
                              <span className="fw-semibold">{info.title}</span>
                              {dirty ? (
                                <span className="badge bg-warning text-dark">Alterado</span>
                              ) : null}
                            </div>
                            <p className="text-secondary small mb-2">{info.description}</p>
                          </div>
                          <div className="d-flex flex-column align-items-end gap-2">
                            <div className="d-flex flex-wrap justify-content-end gap-2">
                              <Button size="sm" variant="outline-primary" onClick={() => openMenuModal(key)}>
                                Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline-secondary"
                                onClick={() => openMenuVariablesModal(key)}
                              >
                                Variáveis
                              </Button>
                            </div>
                          </div>
                        </div>
                        <pre className="mb-0 text-secondary small" style={{ whiteSpace: "pre-wrap" }}>
                          {preview}
                        </pre>
                      </div>
                    );
                  })}
                </div>
                <div className="d-flex flex-wrap align-items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={() => void handleMenuTextsSubmit()}
                    disabled={menuSaving || !hasMenuChanges}
                  >
                    {menuSaving ? "Salvando..." : "Salvar textos dos menus"}
                  </Button>
                  <Button
                    variant="outline-secondary"
                    onClick={() => {
                      if (group) {
                        onMenuTextsReset(group.id);
                      }
                    }}
                    disabled={menuSaving}
                  >
                    Restaurar padrões
                  </Button>
                  {menuSaving ? (
                    <span className="d-flex align-items-center gap-2 text-secondary small">
                      <Spinner animation="border" size="sm" role="status" /> Atualizando menus...
                    </span>
                  ) : null}
                  <small className="text-secondary">
                    Utilize os botões de editar para atualizar cada menu individualmente ou restaure os textos padrão.
                  </small>
                </div>
              </div>

              <div className="border-top pt-3">
                <Card.Title as="h4" className="h6 mb-3">
                  Resposta para comandos desconhecidos
                </Card.Title>
                <div className="d-flex flex-column gap-3 border rounded p-3">
                  <div className="d-flex flex-column flex-lg-row justify-content-between gap-2">
                    <div>
                      <strong>Texto automático</strong>
                      <div className="text-secondary small">
                        Utilize o mesmo editor dos menus para ajustar o aviso enviado quando o bot não
                        reconhece um comando. As variáveis abaixo permitem montar mensagens dinâmicas.
                      </div>
                    </div>
                    <div className="d-flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => group && void onUnknownCommandTemplateSave(group.id)}
                        disabled={
                          !unknownCommandTemplateDirty ||
                          unknownCommandTemplateSaving ||
                          saving
                        }
                      >
                        {unknownCommandTemplateSaving ? (
                          <>
                            <Spinner animation="border" size="sm" /> Salvando…
                          </>
                        ) : (
                          "Salvar resposta"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => group && onUnknownCommandTemplateChange(group.id, "")}
                        disabled={unknownCommandTemplateSaving}
                      >
                        Restaurar padrão
                      </Button>
                    </div>
                  </div>
                  <Form.Control
                    as="textarea"
                    rows={6}
                    value={unknownCommandTemplateDraft}
                    placeholder={DEFAULT_UNKNOWN_COMMAND_TEMPLATE_SAMPLE}
                    onChange={(event) =>
                      group && onUnknownCommandTemplateChange(group.id, event.target.value)
                    }
                    disabled={unknownCommandTemplateSaving}
                  />
                  <div className="d-flex flex-wrap gap-2">
                    {UNKNOWN_COMMAND_VARIABLES.map((variable) => (
                      <Badge
                        key={variable.token}
                        bg="light"
                        text="dark"
                        title={variable.description}
                        className="border font-monospace"
                      >
                        {variable.token}
                      </Badge>
                    ))}
                  </div>
                  <small className="text-secondary">
                    Exemplo: use <code>{"{{cobertura_texto}}"}</code> para exibir o plano/add-on em vigor
                    e <code>{"{{menu_hint}}"}</code> para sugerir o menu automaticamente.
                  </small>
                </div>
              </div>

              <div className="border-top pt-3">
                <Card.Title as="h4" className="h6 mb-3">
                  Fundo do menu
                </Card.Title>
                {backgroundUrl ? (
                  <Image
                    src={backgroundUrl}
                    alt="Fundo do menu"
                    rounded
                    className="border mb-3"
                    style={{ maxWidth: "100%", maxHeight: 220, objectFit: "cover" }}
                  />
                ) : (
                  <p className="text-secondary">Nenhuma imagem configurada para o menu.</p>
                )}
                <Form.Group controlId={`details-background-${group.id}`} className="mb-3">
                  <Form.Label>Enviar novo fundo</Form.Label>
                  <Form.Control
                    type="file"
                    accept="image/*"
                    onChange={handleBackgroundChange}
                    disabled={savingBackground}
                  />
                  <Form.Text className="text-secondary">
                    Recomendamos imagens horizontais com boa resolução para valorizar seus menus.
                  </Form.Text>
                </Form.Group>
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <Button
                    variant="outline-secondary"
                    onClick={() => void handleBackgroundRemove()}
                    disabled={removingBackground || !backgroundUrl}
                  >
                    {removingBackground ? "Removendo..." : "Remover fundo"}
                  </Button>
                  <small className="text-secondary">O fundo é aplicado em todos os menus enviados pelo bot.</small>
                </div>
              </div>

            </Card.Body>
          </Card>
        );
      case "blacklist": {
        const blacklist = Array.isArray(settings.blacklist) ? settings.blacklist : [];
        return (
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <SectionHeading
                title="Lista de bloqueio"
                description="Gerencie números bloqueados e garanta a remoção automática ao entrarem no grupo."
                tutorial={resolveGroupTutorial("activations", tutorials)}
              />
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              {miniFeedback ? (
                <Alert variant={miniFeedback.type} className="mb-0">
                  {miniFeedback.message}
                </Alert>
              ) : null}
              <div className="d-flex flex-wrap gap-2">
                <Button onClick={openBlacklistModal} disabled={blacklistProcessing}>
                  Adicionar bloqueio
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => {
                    if (group) {
                      void onReloadSettings(group.id);
                    }
                  }}
                  disabled={blacklistProcessing}
                >
                  Atualizar status
                </Button>
              </div>
              <small className="text-secondary">
                Também é possível usar os comandos <code>/addblacklist</code> e <code>/rmblacklist</code> diretamente no WhatsApp.
              </small>
              {blacklistProcessing ? (
                <div className="d-flex align-items-center gap-2 text-secondary small">
                  <Spinner animation="border" role="status" size="sm" /> Processando...
                </div>
              ) : null}
              {blacklist.length === 0 ? (
                <Alert variant="secondary" className="mb-0">
                  Nenhum número bloqueado no momento.
                </Alert>
              ) : (
                <ListGroup variant="flush" className="border rounded">
                  {blacklist.map((digits) => (
                    <ListGroup.Item
                      key={digits}
                      className="d-flex justify-content-between align-items-center gap-3"
                    >
                      <div className="d-flex flex-column">
                        <span className="fw-semibold">{formatDisplayDigits(digits)}</span>
                        <small className="text-secondary">{formatMaskedDigits(digits)}</small>
                      </div>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        disabled={blacklistProcessing}
                        onClick={() => void handleBlacklistRemoval(digits)}
                      >
                        Remover
                      </Button>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        );
      }
      case "aliases":
        return (
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-body-tertiary">
              <SectionHeading
                title="Nomes dos comandos"
                description="Defina como os comandos serão chamados. Para vários nomes, separe por vírgula (ex.: menu, m)."
                tutorial={resolveGroupTutorial("aliases", tutorials)}
              />
            </Card.Header>
            <Card.Body>
              {group ? <AliasEditor settings={settings} groupId={group.id} tutorials={tutorials} /> : null}
            </Card.Body>
          </Card>
        );
      default:
        return null;
    }
  };

  const panelId = group ? `group-${group.id}-mini-views` : "group-mini-views";
  const titleId = `${panelId}-title`;
  const helpModalOption = helpViewKey
    ? GROUP_MINI_VIEW_OPTIONS.find((option) => option.key === helpViewKey) ?? null
    : null;
  const hasGroups = groups.length > 0;
  const selectedValue = selectedGroupId !== null ? selectedGroupId.toString() : "";
  const resolveMiniViewVariant = (
    item: GroupMiniViewOption,
    isActive: boolean,
  ): NonNullable<ButtonProps["variant"]> => {
    const activeVariant = item.variant;
    const inactiveVariant =
      item.outlineVariant ?? (`outline-${item.variant}` as NonNullable<ButtonProps["variant"]>);
    return isActive ? activeVariant : inactiveVariant;
  };

  const handleMiniViewButtonClick = (view: GroupMiniViewKey) => {
    if (!group) {
      return;
    }
    setMobileMenuOpen(false);
    void onViewChange(view);
  };

  const handleGroupChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (!value) {
      return;
    }

    const numericValue = Number(value);
    if (!Number.isNaN(numericValue)) {
      onSelectGroup(numericValue);
    }
  };

  return (
    <>
      <section className="d-flex flex-column gap-3" aria-labelledby={titleId} id={panelId}>
        <div className="desktop-group-manager">
          <div className="desktop-group-manager__selector">
            <Card
              className="shadow-sm border-0 w-100 w-lg-auto flex-lg-shrink-0"
              style={{ minWidth: "280px", maxWidth: "380px" }}
            >
              <Card.Body className="d-flex flex-column gap-3">
                <div className="d-flex flex-column gap-2 text-center text-lg-start">
                  <Card.Text className="text-secondary small mb-0">{limitLabel}</Card.Text>
                </div>

                <div className="d-flex flex-column align-items-center align-items-lg-stretch gap-2">
                  <Form.Label
                    className="text-secondary small mb-0 text-center text-lg-start"
                    htmlFor={`${panelId}-selector`}
                  >
                    Grupo selecionado
                  </Form.Label>
                  <div className="w-100">
                    <Form.Select
                      id={`${panelId}-selector`}
                      value={selectedValue}
                      onChange={handleGroupChange}
                      disabled={!hasGroups}
                    >
                      {hasGroups ? null : <option value="">Nenhum grupo disponível</option>}
                      {groups.map((item) => {
                        const license = buildGroupLicenseStatusSummary(item.metadata);
                        const licenseHint = license.expiresAt
                          ? license.isActive
                            ? "licença vigente"
                            : "licença vencida"
                          : "sem licença";
                        return (
                          <option key={item.id} value={item.id}>
                            {item.name} · {licenseHint}
                          </option>
                        );
                      })}
                    </Form.Select>
                  </div>
                  {group ? (
                    <div className="d-flex align-items-center gap-2 text-center text-lg-start w-100">
                      {group.imageUrl ? (
                        <Image
                          src={group.imageUrl}
                          alt={`Foto de ${group.name}`}
                          roundedCircle
                          width={40}
                          height={40}
                          style={{ objectFit: "cover" }}
                        />
                      ) : (
                        <div
                          className="bg-body-tertiary border"
                          style={{ width: 40, height: 40, borderRadius: "50%" }}
                          aria-hidden
                        />
                      )}
                      <div className="text-start flex-grow-1">
                        <span className="fw-semibold d-block text-truncate">{group.name}</span>
                        <span className="text-secondary small text-truncate d-block">
                          {(() => {
                            const license = buildGroupLicenseStatusSummary(group.metadata);
                            if (!license.expiresAt) {
                              return "Sem licença · ative para usar automações";
                            }
                            return `${license.statusLabel} · ${license.sourceLabel}`;
                          })()}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>

                {group ? null : (
                  <Card.Text className="text-secondary mb-0">
                    {hasGroups
                      ? "Selecione um grupo acima para habilitar as configurações e gerenciar as automações."
                      : "Cadastre um grupo para começar a configurar as automações."}
                  </Card.Text>
                )}
              </Card.Body>
            </Card>
          </div>

          <div className="flex-grow-1 d-flex flex-column gap-3">
            {hasSelection ? (
              <>
                {error ? (
                  <Alert variant="danger" className="mb-0">
                    {error}
                  </Alert>
                ) : null}

                {isLoading ? (
                  <Card className="shadow-sm border-0">
                    <Card.Body className="d-flex align-items-center gap-2">
                      <Spinner animation="border" role="status" size="sm" />
                      <span className="text-secondary">Carregando configurações do grupo...</span>
                    </Card.Body>
                  </Card>
                ) : null}

                {activeView ? renderView() : null}
              </>
            ) : (
              <Alert variant="secondary" className="mb-0">
                Utilize o seletor acima para escolher um grupo e exibir as configurações.
              </Alert>
            )}
          </div>
        </div>
      </section>

      <div className="group-mini-mobile-menu">
        {mobileMenuOpen ? (
          <>
            <button
              type="button"
              className="group-mini-mobile-menu__backdrop"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar atalhos do grupo"
            />
            <div className="group-mini-mobile-menu__panel shadow-lg border">
              <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                <div>
                  <p className="fw-semibold mb-0">Atalhos do grupo</p>
                  <small className="text-secondary">
                    {group
                      ? "Escolha o que deseja configurar."
                      : "Selecione um grupo para liberar as opções."}
                  </small>
                </div>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="rounded-circle p-2"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Fechar menu de atalhos"
                >
                  <IconX size={18} />
                </Button>
              </div>
              <div className="group-mini-mobile-menu__panel-list">
                {GROUP_MINI_VIEW_OPTIONS.map((item) => {
                  const isActive = Boolean(group && activeView === item.key);
                  const resolvedVariant = resolveMiniViewVariant(item, isActive);
                  return (
                    <div key={item.key} className="group-mini-mobile-menu__panel-item">
                      <div className="d-flex gap-2 align-items-stretch">
                        <Button
                          variant={resolvedVariant}
                          size="sm"
                          className="group-mini-mobile-menu__panel-button w-100 d-flex align-items-center gap-2"
                          onClick={() => handleMiniViewButtonClick(item.key)}
                          disabled={!group || (isLoading && !isActive)}
                        >
                          <span className="d-inline-flex align-items-center justify-content-center">
                            {item.icon}
                          </span>
                          <span className="flex-grow-1 fw-semibold">{item.label}</span>
                        </Button>
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          className="group-mini-mobile-menu__help"
                          onClick={() => setHelpViewKey(item.key)}
                          aria-label={`Saiba mais sobre ${item.label}`}
                        >
                          <IconHelpCircle size={16} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <Modal
        show={Boolean(activeConfigModal && modalInfo)}
        onHide={closeConfigModal}
        centered
        backdrop="static"
        keyboard={!saving}
      >
        <Modal.Header closeButton={!saving}>
          <Modal.Title>{modalInfo?.title ?? "Configuração"}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0">{modalInfo?.description}</p>
          <Form.Group controlId={`${panelId}-${activeConfigModal ?? "config"}-editor`}>
            {isDdiModal ? (
              <Form.Label className="fw-semibold small text-uppercase text-secondary">
                Lista de DDIs permitidos
              </Form.Label>
            ) : null}
            <Form.Control
              as="textarea"
              rows={modalInfo?.rows ?? 4}
              value={modalDraft?.value ?? ""}
              onChange={(event) => modalDraft?.onChange(event.target.value)}
              disabled={saving}
              placeholder="Digite um item por linha"
            />
            <Form.Text className="text-secondary">{modalInfo?.help}</Form.Text>
          </Form.Group>
          {isDdiModal ? (
            <Form.Group controlId={`${panelId}-config-antifake-message`}>
              <Form.Label className="fw-semibold small text-uppercase text-secondary">
                Mensagem enviada antes da remoção
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={(modalDraft as any)?.messageValue ?? ""}
                onChange={(event) => (modalDraft as any)?.onMessageChange?.(event.target.value)}
                disabled={saving}
                placeholder="Ex.: 🚫 @{{numero}}, este grupo aceita apenas DDI(s) {{allowed_ddis}}."
              />
              <Form.Text className="text-secondary">
                Use variáveis como <code>{"{{numero}}"}</code>, <code>{"{{ddi}}"}</code>,{" "}
                <code>{"{{allowed_ddis}}"}</code> e <code>{"{{grupo}}"}</code> para personalizar o texto.
              </Form.Text>
            </Form.Group>
          ) : null}
          {isBannedWordsModal ? (
            <Form.Check
              type="switch"
              id={`${panelId}-config-banned-words-ban`}
              label="Remover participante ao violar palavras"
              checked={(modalDraft as any)?.banValue ?? false}
              onChange={(event) => (modalDraft as any)?.onBanChange?.(event.currentTarget.checked)}
              disabled={saving}
            />
          ) : null}
          {isBannedWordsModal ? (
            <Form.Group controlId={`${panelId}-config-banned-words-limit`} className="mt-3">
              <Form.Label className="fw-semibold small text-uppercase text-secondary">
                Limite de infrações (1-20)
              </Form.Label>
              <Form.Control
                type="number"
                min={1}
                max={20}
                value={(modalDraft as any)?.limitValue ?? ""}
                onChange={(event) => (modalDraft as any)?.onLimitChange?.(event.target.value)}
                disabled={saving}
              />
              <Form.Text className="text-secondary">
                Após atingir o limite, o participante é removido automaticamente.
              </Form.Text>
            </Form.Group>
          ) : null}
          {isBannedWordsModal ? (
            <Form.Text className="text-secondary">
              Quando ativado, o bot remove automaticamente quem enviar termos proibidos.
            </Form.Text>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeConfigModal} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={() => void handleConfigModalSave()}
            disabled={saving || !canSaveModal}
          >
            {saving ? (
              <span className="d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Salvando...
              </span>
            ) : (
              "Salvar alterações"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={Boolean(helpModalOption)} onHide={() => setHelpViewKey(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{helpModalOption?.label ?? "Atalho"}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-0 text-secondary">{helpModalOption?.description}</p>
        </Modal.Body>
      </Modal>

      <Modal
        show={Boolean(activeMenuModal && menuModalDraft)}
        onHide={closeMenuModal}
        centered
      >
        <Modal.Header closeButton={!menuSaving}>
          <Modal.Title>{menuModalInfo?.title ?? "Editar menu"}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0">{menuModalInfo?.description}</p>
          <Form.Group
            controlId={`${panelId}-${menuModalDraft?.key ?? "menu"}-editor`}
          >
            <Form.Control
              as="textarea"
              rows={8}
              value={menuModalDraft?.value ?? ""}
              onChange={(event) => menuModalDraft?.onChange(event.target.value)}
              disabled={menuSaving}
            />
            <Form.Text className="text-secondary">
              Escreva um item por linha exatamente como deseja que apareça para os participantes.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeMenuModal} disabled={menuSaving}>
            Cancelar
          </Button>
          <Button
            onClick={() => void handleMenuModalSave()}
            disabled={menuSaving || !menuModalDraft?.dirty}
          >
            {menuSaving ? "Salvando..." : "Salvar menu"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={Boolean(menuVariablesModalKey)}
        onHide={closeMenuVariablesModal}
        centered
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>Variáveis dos menus</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <div>
            <p className="text-secondary mb-1">
              Insira as variáveis abaixo em qualquer menu para preencher informações automaticamente.
            </p>
            {menuVariablesModalInfo ? (
              <small className="text-secondary">
                Você está editando o menu <strong>{menuVariablesModalInfo.title}</strong>, mas as
                variáveis valem para todos os textos.
              </small>
            ) : null}
            <small className="text-secondary d-block">
              Aceitamos tanto o formato <code>{"{variavel}"}</code> quanto <code>{"{{variavel}}"}</code>.
            </small>
          </div>
          <div className="d-flex flex-column gap-2">
            {MENU_TEXT_VARIABLES.map((variable) => {
              const hasBraces =
                variable.token.startsWith("{") && variable.token.endsWith("}");
              const doubleFormat = hasBraces
                ? `{{${variable.token.slice(1, -1)}}}`
                : variable.token;
              return (
                <div key={variable.token} className="border rounded p-3 bg-body-tertiary">
                  <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <code className="mb-0">{variable.token}</code>
                    {hasBraces ? (
                      <small className="text-secondary">
                        ou <code>{doubleFormat}</code>
                      </small>
                    ) : null}
                  </div>
                  <p className="text-secondary small mb-1">{variable.description}</p>
                  {variable.example ? (
                    <small className="text-secondary">
                      Exemplo de saída: <span className="fw-semibold">{variable.example}</span>
                    </small>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={closeMenuVariablesModal}>
            Entendi
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={showAutoResponseModal}
        onHide={handleCloseAutoResponseModal}
        centered
        backdrop="static"
      >
        <Form onSubmit={handleAutoResponseModalSubmit} className="d-flex flex-column">
          <Modal.Header closeButton={!savingAutoResponses}>
            <Modal.Title>
              {autoResponseModalMode === "edit"
                ? "Editar autoresposta"
                : 'Nova autoresposta'}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="d-flex flex-column gap-3">
            <Form.Group controlId={`${panelId}-autoresponse-triggers`}>
              <Form.Label>Palavras ou frases de gatilho</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={autoResponseDraft.triggers}
                onChange={(event) =>
                  handleAutoResponseDraftChange("triggers", event.target.value)
                }
                disabled={autoResponseBusy}
                placeholder="Digite um gatilho por linha (ex: oi bot)"
              />
              <Form.Text className="text-secondary">
                O texto será comparado ignorando acentos e maiúsculas. Você pode informar várias opções.
              </Form.Text>
            </Form.Group>
            <Form.Group controlId={`${panelId}-autoresponse-mode`}>
              <Form.Label>Modo de correspondência</Form.Label>
              <Form.Select
                value={autoResponseDraft.matchMode}
                onChange={(event) =>
                  handleAutoResponseDraftChange("matchMode", event.target.value)
                }
                disabled={autoResponseBusy}
              >
                <option value="equals">Mensagem igual ao gatilho</option>
                <option value="contains">Mensagem contém o gatilho</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId={`${panelId}-autoresponse-text`}>
              <Form.Label>Resposta do bot</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={autoResponseDraft.responseText}
                onChange={(event) =>
                  handleAutoResponseDraftChange("responseText", event.target.value)
                }
                disabled={autoResponseBusy}
                placeholder="Digite a mensagem que o bot deve enviar"
              />
              <Form.Text className="text-secondary">
                Você pode utilizar quebras de linha para mensagens mais longas.
              </Form.Text>
            </Form.Group>
            <div className="border rounded p-3 bg-body-tertiary">
              <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
                <div>
                  <strong className="d-block">Mídia opcional</strong>
                  <small className="text-secondary">
                    Envie imagens, áudios, vídeos ou documentos junto com a resposta automática.
                  </small>
                </div>
                <Form.Check
                  type="switch"
                  id={`${panelId}-autoresponse-media-toggle`}
                  label="Incluir mídia"
                  checked={autoResponseDraft.includeMedia}
                  disabled={autoResponseBusy}
                  onChange={(event) => {
                    if (event.target.checked) {
                      updateAutoResponseDraft({
                        includeMedia: true,
                        mediaMode:
                          autoResponseDraft.mediaMode === "none"
                            ? "upload"
                            : autoResponseDraft.mediaMode,
                      });
                    } else {
                      updateAutoResponseDraft({
                        includeMedia: false,
                        mediaMode: "none",
                        mediaUrl: "",
                        mediaCaption: "",
                        mediaPath: "",
                        mediaFile: null,
                        mediaFileName: "",
                        mediaMimeType: "",
                      });
                    }
                  }}
                />
              </div>
              {autoResponseDraft.includeMedia ? (
                <div className="mt-3 d-flex flex-column gap-3">
                  <Form.Group controlId={`${panelId}-autoresponse-media-type`}>
                    <Form.Label>Tipo de mídia</Form.Label>
                    <Form.Select
                      value={autoResponseDraft.mediaType}
                      disabled={autoResponseBusy}
                      onChange={(event) =>
                        updateAutoResponseDraft({
                          mediaType: event.target.value as BotGroupAutoResponseMedia["mediaType"],
                        })
                      }
                    >
                      {AUTO_RESPONSE_MEDIA_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                  <div>
                    <Form.Label className="mb-1">Origem da mídia</Form.Label>
                    <div className="d-flex flex-column gap-1">
                      <Form.Check
                        type="radio"
                        id={`${panelId}-autoresponse-media-mode-url`}
                        name={`${panelId}-autoresponse-media-mode`}
                        label="Usar link direto"
                        checked={autoResponseDraft.mediaMode === "url"}
                        disabled={autoResponseBusy}
                        onChange={() => updateAutoResponseDraft({ mediaMode: "url" })}
                      />
                      <Form.Check
                        type="radio"
                        id={`${panelId}-autoresponse-media-mode-upload`}
                        name={`${panelId}-autoresponse-media-mode`}
                        label="Enviar arquivo pelo painel"
                        checked={autoResponseDraft.mediaMode === "upload"}
                        disabled={autoResponseBusy}
                        onChange={() => updateAutoResponseDraft({ mediaMode: "upload" })}
                      />
                    </div>
                  </div>
                  {autoResponseDraft.mediaMode === "url" ? (
                    <Form.Group controlId={`${panelId}-autoresponse-media-url`}>
                      <Form.Label>Link da mídia</Form.Label>
                      <Form.Control
                        type="url"
                        value={autoResponseDraft.mediaUrl}
                        onChange={(event) => updateAutoResponseDraft({ mediaUrl: event.target.value })}
                        disabled={autoResponseBusy}
                        placeholder="https://..."
                      />
                    </Form.Group>
                  ) : null}
                  {autoResponseDraft.mediaMode === "upload" ? (
                    <div className="d-flex flex-column gap-2">
                      {autoResponseDraft.mediaPath && !autoResponseDraft.mediaFile ? (
                        <Alert variant="secondary" className="mb-0">
                          Arquivo atual: {autoResponseDraft.mediaFileName || autoResponseDraft.mediaPath}
                        </Alert>
                      ) : null}
                      {autoResponseDraft.mediaFile ? (
                        <Alert variant="secondary" className="mb-0">
                          Arquivo selecionado: {autoResponseDraft.mediaFile.name}
                        </Alert>
                      ) : null}
                      <Form.Control
                        type="file"
                        disabled={autoResponseBusy}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          updateAutoResponseDraft({
                            mediaFile: file,
                            mediaFileName: file?.name ?? autoResponseDraft.mediaFileName,
                            mediaMimeType: file?.type ?? autoResponseDraft.mediaMimeType,
                            mediaPath: file ? "" : autoResponseDraft.mediaPath,
                          });
                        }}
                      />
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        {autoResponseDraft.mediaPath && !autoResponseDraft.mediaFile ? (
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() =>
                              updateAutoResponseDraft({
                                mediaPath: "",
                                mediaFileName: "",
                                mediaMimeType: "",
                              })
                            }
                            disabled={autoResponseBusy}
                          >
                            Remover arquivo atual
                          </Button>
                        ) : null}
                        {autoResponseDraft.mediaFile ? (
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() =>
                              updateAutoResponseDraft({
                                mediaFile: null,
                                mediaFileName: autoResponseDraft.mediaFileName,
                                mediaMimeType: autoResponseDraft.mediaMimeType,
                              })
                            }
                            disabled={autoResponseBusy}
                          >
                            Limpar seleção
                          </Button>
                        ) : null}
                        <Form.Text className="text-secondary">
                          Arquivos enviados ficam disponíveis para futuras respostas automáticas.
                        </Form.Text>
                      </div>
                    </div>
                  ) : null}
                  {autoResponseDraft.mediaType !== "sticker" ? (
                    <Form.Group controlId={`${panelId}-autoresponse-media-caption`}>
                      <Form.Label>Legenda da mídia</Form.Label>
                      <Form.Control
                        type="text"
                        value={autoResponseDraft.mediaCaption}
                        onChange={(event) => updateAutoResponseDraft({ mediaCaption: event.target.value })}
                        disabled={autoResponseBusy}
                        placeholder="Texto exibido como legenda (opcional)"
                      />
                    </Form.Group>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="border rounded p-3 bg-body-tertiary">
              <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
                <div>
                  <strong className="d-block">Contato automático</strong>
                  <small className="text-secondary">
                    Envie um cartão de contato (VCard) com dados importantes sempre que o gatilho for detectado.
                  </small>
                </div>
                <Form.Check
                  type="switch"
                  id={`${panelId}-autoresponse-vcard-toggle`}
                  label="Enviar contato"
                  checked={autoResponseDraft.includeVcard}
                  disabled={autoResponseBusy}
                  onChange={(event) => {
                    if (event.target.checked) {
                      updateAutoResponseDraft({ includeVcard: true });
                    } else {
                      updateAutoResponseDraft({
                        includeVcard: false,
                        vcardName: "",
                        vcardPhone: "",
                        vcardOrganization: "",
                        vcardEmail: "",
                        vcardCustom: "",
                      });
                    }
                  }}
                />
              </div>
              {autoResponseDraft.includeVcard ? (
                <div className="mt-3 d-flex flex-column gap-3">
                  <Form.Group controlId={`${panelId}-autoresponse-vcard-name`}>
                    <Form.Label>Nome do contato</Form.Label>
                    <Form.Control
                      type="text"
                      value={autoResponseDraft.vcardName}
                      onChange={(event) => updateAutoResponseDraft({ vcardName: event.target.value })}
                      disabled={autoResponseBusy}
                      placeholder="Nome exibido no WhatsApp"
                    />
                  </Form.Group>
                  <Form.Group controlId={`${panelId}-autoresponse-vcard-phone`}>
                    <Form.Label>Telefone com DDI</Form.Label>
                    <Form.Control
                      type="text"
                      value={autoResponseDraft.vcardPhone}
                      onChange={(event) => updateAutoResponseDraft({ vcardPhone: event.target.value })}
                      disabled={autoResponseBusy}
                      placeholder="Ex: +5511999999999"
                    />
                  </Form.Group>
                  <Form.Group controlId={`${panelId}-autoresponse-vcard-organization`}>
                    <Form.Label>Empresa ou departamento</Form.Label>
                    <Form.Control
                      type="text"
                      value={autoResponseDraft.vcardOrganization}
                      onChange={(event) => updateAutoResponseDraft({ vcardOrganization: event.target.value })}
                      disabled={autoResponseBusy}
                      placeholder="Opcional"
                    />
                  </Form.Group>
                  <Form.Group controlId={`${panelId}-autoresponse-vcard-email`}>
                    <Form.Label>E-mail</Form.Label>
                    <Form.Control
                      type="email"
                      value={autoResponseDraft.vcardEmail}
                      onChange={(event) => updateAutoResponseDraft({ vcardEmail: event.target.value })}
                      disabled={autoResponseBusy}
                      placeholder="contato@empresa.com"
                    />
                  </Form.Group>
                  <Form.Group controlId={`${panelId}-autoresponse-vcard-custom`}>
                    <Form.Label>Conteúdo VCard personalizado</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={autoResponseDraft.vcardCustom}
                      onChange={(event) => updateAutoResponseDraft({ vcardCustom: event.target.value })}
                      disabled={autoResponseBusy}
                      placeholder={"BEGIN:VCARD\nVERSION:3.0\nFN:Seu Nome\nTEL:+5511999999999\nEND:VCARD"}
                    />
                    <Form.Text className="text-secondary">
                      Deixe em branco para gerar o VCard automaticamente com os dados acima.
                    </Form.Text>
                  </Form.Group>
                </div>
              ) : null}
            </div>
            {autoResponseFormError ? (
              <Alert variant="danger" className="mb-0">
                {autoResponseFormError}
              </Alert>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={handleCloseAutoResponseModal}
              disabled={autoResponseBusy}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={autoResponseBusy}>
              {autoResponseUploading ? (
                <span className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" role="status" /> Enviando mídia...
                </span>
              ) : savingAutoResponses ? (
                <span className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" role="status" /> Salvando...
                </span>
              ) : autoResponseModalMode === "edit" ? (
                "Salvar alterações"
              ) : (
                "Criar autoresposta"
              )}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={showAiKeyModal}
        onHide={handleCloseAiKeyModal}
        centered
        backdrop="static"
      >
        <Modal.Header closeButton={!savingAiSection}>
          <Modal.Title>Chaves Groq</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0">
            Informe a sua chave Groq. Ela é usada somente para autenticar as solicitações de IA dos seus grupos.
          </p>
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline-primary align-self-start"
          >
            Gerar chave no site da Groq
          </a>
          <Form.Group controlId={`{panelId}-ai-keys`}>
            <Form.Control
              as="textarea"
              rows={4}
              value={aiKeyDraft}
              onChange={(event) => setAiKeyDraft(event.target.value)}
              disabled={Boolean(savingAiSection)}
              placeholder="gsk_..."
            />
            <Form.Text className="text-secondary">
              Cadastre uma chave ativa para que o bot consiga responder usando IA. A Groq mostra a chave apenas uma vez: guarde-a em local seguro.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseAiKeyModal} disabled={Boolean(savingAiSection)}>
            Cancelar
          </Button>
          <Button onClick={() => void handleAiKeySave()} disabled={Boolean(savingAiSection)}>
            {savingAiSection === "keys" ? (
              <span className="d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Salvando...
              </span>
            ) : (
              "Salvar chaves"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={showAiPromptModal}
        onHide={handleCloseAiPromptModal}
        centered
        backdrop="static"
      >
        <Modal.Header closeButton={!savingAiSection}>
          <Modal.Title>Prompt do Bot</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0">
            Personalize como a IA deve responder. Utilize frases curtas e claras para orientar o tom das mensagens.
          </p>
          <Form.Group controlId={`{panelId}-ai-prompt`}>
            <Form.Label>Prompt da IA</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              value={aiPromptDraft}
              onChange={(event) => setAiPromptDraft(event.target.value)}
              disabled={Boolean(savingAiSection)}
              placeholder="Fale de forma direta e natural em português do Brasil."
            />
          </Form.Group>
          <Form.Group controlId={`{panelId}-ai-tools-prompt`}>
            <Form.Label>Instruções das tools/comandos da IA</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              value={aiToolsPromptDraft}
              onChange={(event) => setAiToolsPromptDraft(event.target.value)}
              disabled={Boolean(savingAiSection)}
              placeholder="Regras para quando a IA puder usar comandos internos, como baixar música ou vídeo..."
            />
            <Form.Text className="text-secondary">
              Separado do prompt normal: use este campo só para ferramentas e comandos internos.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseAiPromptModal} disabled={Boolean(savingAiSection)}>
            Cancelar
          </Button>
          <Button onClick={() => void handleAiPromptSave()} disabled={Boolean(savingAiSection)}>
            {savingAiSection === "prompt" ? (
              <span className="d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Salvando...
              </span>
            ) : (
              "Salvar prompt"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={showAiVoiceModal}
        onHide={handleCloseAiVoiceModal}
        centered
        backdrop="static"
      >
        <Modal.Header closeButton={!savingAiSection}>
          <Modal.Title>Selecionar voz</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0">
            Escolha a voz utilizada ao gerar respostas em áudio. Selecione &quot;Automático&quot; para usar o padrão.
          </p>
          <Form.Group controlId={`{panelId}-ai-voice`}>
            <Form.Select
              value={aiVoiceDraft}
              onChange={(event) => setAiVoiceDraft(event.target.value)}
              disabled={Boolean(savingAiSection)}
            >
              {AI_VOICE_OPTIONS.map((option) => (
                <option key={option.value || "default"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseAiVoiceModal} disabled={Boolean(savingAiSection)}>
            Cancelar
          </Button>
          <Button onClick={() => void handleAiVoiceSave()} disabled={Boolean(savingAiSection)}>
            {savingAiSection === "voice" ? (
              <span className="d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Salvando...
              </span>
            ) : (
              "Salvar voz"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={blacklistModalOpen}
        onHide={closeBlacklistModal}
        centered
        backdrop="static"
        keyboard={!blacklistProcessing}
      >
        <Modal.Header closeButton={!blacklistProcessing}>
          <Modal.Title>Adicionar à lista de bloqueio</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0">
            Informe o número completo (com DDI) ou selecione participantes já presentes no grupo.
          </p>
          {blacklistFeedback ? (
            <Alert variant={blacklistFeedback.type} className="mb-0">
              {blacklistFeedback.message}
            </Alert>
          ) : null}
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              void handleBlacklistAddManual();
            }}
          >
            <Form.Label className="small fw-semibold text-secondary">Adicionar manualmente</Form.Label>
            <InputGroup>
              <Form.Control
                value={blacklistInput}
                onChange={(event) => setBlacklistInput(event.target.value)}
                placeholder="Ex.: 5592999999999"
                disabled={blacklistProcessing}
              />
              <Button type="submit" disabled={blacklistProcessing || !blacklistInput.trim()}>
                Adicionar
              </Button>
            </InputGroup>
            <Form.Text className="text-secondary">
              Utilize apenas números, incluindo código do país.
            </Form.Text>
          </Form>
          <hr className="my-2" />
          <div className="d-flex flex-column gap-2">
            <div className="d-flex flex-column flex-md-row gap-2">
              <Form.Control
                type="search"
                placeholder="Buscar participante"
                value={participantSearch}
                onChange={(event) => setParticipantSearch(event.target.value)}
                disabled={participantsLoading}
              />
              <Button
                variant="outline-secondary"
                onClick={() => void loadParticipants()}
                disabled={participantsLoading}
              >
                {participantsLoading ? "Atualizando..." : "Recarregar"}
              </Button>
            </div>
            {participantsError ? (
              <Alert variant="warning" className="mb-0">
                {participantsError}
              </Alert>
            ) : null}
            <div className="border rounded" style={{ maxHeight: 260, overflowY: "auto" }}>
              {participantsLoading ? (
                <div className="d-flex align-items-center justify-content-center gap-2 p-3 text-secondary small">
                  <Spinner animation="border" role="status" size="sm" /> Carregando participantes...
                </div>
              ) : filteredParticipants.length === 0 ? (
                <div className="p-3 text-secondary small">
                  Nenhum participante encontrado. Utilize o campo acima ou informe o número manualmente.
                </div>
              ) : (
                <ListGroup variant="flush">
                  {filteredParticipants.map((participant) => {
                    const digits = sanitizeDigits(participant.id);
                    const disabled =
                      blacklistProcessing ||
                      digits.length < 5 ||
                      blacklistSet.has(digits) ||
                      (instanceDigits && digits === instanceDigits);
                    return (
                      <ListGroup.Item
                        key={`${participant.id}-${participant.admin}`}
                        className="d-flex justify-content-between align-items-center gap-3"
                      >
                        <div className="d-flex flex-column">
                          <span className="fw-semibold">{formatDisplayDigits(participant.id)}</span>
                          <div className="d-flex align-items-center gap-2 text-secondary small">
                            <span>{formatMaskedDigits(participant.id)}</span>
                            {participant.admin !== "member" ? <Badge bg="secondary">Admin</Badge> : null}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={disabled ? "outline-secondary" : "outline-primary"}
                          disabled={disabled}
                          onClick={() => void handleBlacklistAddFromParticipants([participant.id])}
                        >
                          {disabled ? "Adicionado" : "Adicionar"}
                        </Button>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeBlacklistModal} disabled={blacklistProcessing}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>

    </>
  );
};
export default UserGroupManager;

function CreateGroupModal({
  show,
  onHide,
  instances,
  onSubmit,
  isSubmitting,
  canCreate,
  disabledReason,
  planActive,
  onViewPlans,
}: CreateGroupModalProps) {
  const [formState, setFormState] = useState({
    instanceId: "",
    invite: "",
  });
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!show) {
      return;
    }
    setFeedback(null);
    setFormState({
      instanceId: instances.length > 0 ? instances[0].id.toString() : "",
      invite: "",
    });
  }, [instances, show]);

  const hasInstances = instances.length > 0;

  const handleFieldChange = (field: keyof typeof formState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onHide();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericInstanceId = formState.instanceId
      ? Number.parseInt(formState.instanceId, 10)
      : NaN;
    const result = await onSubmit({
      instanceId: Number.isNaN(numericInstanceId) ? null : numericInstanceId,
      invite: formState.invite,
    });
    setFeedback(result.feedback);
    if (result.success) {
      setFormState({
        instanceId: instances.length > 0 ? instances[0].id.toString() : "",
        invite: "",
      });
      onHide();
    }
  };

  const handleViewPlansClick = () => {
    onHide();
    onViewPlans();
  };

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Modal.Header closeButton={!isSubmitting}>
        <Modal.Title>Adicionar novo grupo</Modal.Title>
      </Modal.Header>
      <Form onSubmit={handleSubmit} className="d-flex flex-column">
        <Modal.Body className="d-flex flex-column gap-3">
          {!canCreate && disabledReason ? (
            <Alert variant="warning" className="mb-0">
              <div className="d-flex align-items-start gap-3">
                <InfoCircleFill size={24} className="text-warning flex-shrink-0 mt-1" />
                <div className="d-flex flex-column gap-2">
                  <span>{disabledReason}</span>
                  {!planActive ? (
                    <div>
                      <Button size="sm" variant="primary" onClick={handleViewPlansClick}>
                        Ver planos
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </Alert>
          ) : null}
          {feedback ? (
            <Alert
              variant={feedback.type}
              onClose={() => setFeedback(null)}
              dismissible
            >
              {feedback.message}
            </Alert>
          ) : null}
          <Form.Group controlId="create-group-instance">
            <Form.Label>Instância do bot</Form.Label>
            <Form.Select
              value={formState.instanceId}
              onChange={(event) => handleFieldChange("instanceId", event.target.value)}
              disabled={!hasInstances || isSubmitting}
            >
              {hasInstances ? null : <option value="">Nenhuma instância disponível</option>}
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} · {instance.phone}
                </option>
              ))}
            </Form.Select>
            <Form.Text className="text-secondary">
              Escolha qual instância será vinculada automaticamente ao grupo.
            </Form.Text>
          </Form.Group>
          <Form.Group controlId="create-group-invite">
            <Form.Label>Link de convite do grupo</Form.Label>
            <Form.Control
              type="url"
              placeholder="https://chat.whatsapp.com/..."
              value={formState.invite}
              onChange={(event) => handleFieldChange("invite", event.target.value)}
              disabled={isSubmitting}
              required
            />
            <Form.Text className="text-secondary">
              Utilize o link de convite ou código para permitir que o robô entre no grupo automaticamente.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting || !canCreate}>
            {isSubmitting ? (
              <span className="d-flex align-items-center justify-content-center gap-2">
                <Spinner animation="border" size="sm" role="status" /> Vinculando...
              </span>
            ) : (
              "Adicionar grupo"
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
