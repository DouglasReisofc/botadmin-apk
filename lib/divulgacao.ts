import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import type { BotAdCampaignContent } from "types/bot-ad-campaigns";
import type {
  DivulgacaoInspectionResult,
  DivulgacaoSendResult,
  DivulgacaoTemplate,
  DivulgacaoTemplateInput,
} from "types/divulgacao";
import {
  DivulgacaoRunRow,
  DivulgacaoTemplateRow,
  ensureDivulgacaoRunTable,
  ensureDivulgacaoTemplateTable,
  getDb,
} from "./db";
import { getInstanceForUser } from "./bot-instances";
import { resolveStoredMediaBuffer } from "./media-storage";
import { normalizeJid } from "./whatsapp";
import {
  getGroupInfo,
  getGroupInviteInfo,
  joinGroupWithInviteLink,
  sendInteractiveButtons,
  sendMediaMessage,
  sendTextMessage,
  type InteractiveButton,
  type WuzapiClient,
} from "./wuzapi";

class DivulgacaoError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DivulgacaoError";
    this.status = status;
  }
}

const mapTemplateRow = (row: DivulgacaoTemplateRow): DivulgacaoTemplate => {
  let contents: BotAdCampaignContent[] = [];
  if (row.contents_json) {
    try {
      const parsed = JSON.parse(row.contents_json);
      if (Array.isArray(parsed)) {
        contents = parsed as BotAdCampaignContent[];
      }
    } catch {
      contents = [];
    }
  }
  return {
    id: String(row.id),
    name: row.name,
    description: row.description ?? null,
    contents,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
};

const normalizeInviteLink = (raw: string): { inviteCode: string; inviteLink: string } => {
  if (typeof raw !== "string") {
    throw new DivulgacaoError("Informe o link de convite do grupo.");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new DivulgacaoError("Informe o link de convite do grupo.");
  }
  const match = trimmed.match(/chat\.whatsapp\.com\/([A-Za-z0-9-_]+)/i);
  const code = match?.[1] ?? trimmed.split("/").pop();
  if (!code || code.length < 6) {
    throw new DivulgacaoError("Link de convite inválido.");
  }
  return { inviteCode: code.replace(/\?.*$/, ""), inviteLink: trimmed };
};

const assertContents = (input?: BotAdCampaignContent[]): BotAdCampaignContent[] => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new DivulgacaoError("Adicione pelo menos um conteúdo para enviar.");
  }
  const sanitized: BotAdCampaignContent[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    if (!entry.id) {
      entry.id = randomUUID();
    }
    if (entry.type === "text") {
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      if (!text) {
        continue;
      }
      sanitized.push({ ...entry, text });
    } else if (
      entry.type === "image" ||
      entry.type === "video" ||
      entry.type === "audio" ||
      entry.type === "document" ||
      entry.type === "sticker"
    ) {
      sanitized.push({ ...entry });
    } else if (entry.type === "buttons") {
      const replies = Array.isArray(entry.replyButtons) ? entry.replyButtons : [];
      const ctas = Array.isArray(entry.ctaButtons) ? entry.ctaButtons : [];
      if (replies.length === 0 && ctas.length === 0) {
        continue;
      }
      sanitized.push({ ...entry, replyButtons: replies, ctaButtons: ctas });
    } else if (entry.type === "status") {
      // Status como conteúdo standalone (para reutilização futura)
      sanitized.push({ ...entry });
    } else if (entry.type === "affiliate_ml") {
      throw new DivulgacaoError(
        "Conteúdo afiliado do Mercado Livre não é suportado neste fluxo. Use campanhas de anúncios.",
      );
    }
  }
  if (!sanitized.length) {
    throw new DivulgacaoError("Os conteúdos informados não são válidos.");
  }
  return sanitized;
};

const fetchTemplatesForUser = async (userId: number): Promise<DivulgacaoTemplateRow[]> => {
  await ensureDivulgacaoTemplateTable();
  const db = getDb();
  const [rows] = await db.query<(DivulgacaoTemplateRow & RowDataPacket)[]>(
    `SELECT * FROM bot_group_divulgacao_templates WHERE user_id = ? ORDER BY updated_at DESC, id DESC`,
    [userId],
  );
  return Array.isArray(rows) ? rows : [];
};

const fetchTemplateById = async (
  userId: number,
  templateId: number,
): Promise<DivulgacaoTemplateRow | null> => {
  const db = getDb();
  await ensureDivulgacaoTemplateTable();
  const [rows] = await db.query<(DivulgacaoTemplateRow & RowDataPacket)[]>(
    `SELECT * FROM bot_group_divulgacao_templates WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, templateId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return rows[0];
};

const resolveClientForInstance = async (
  userId: number,
  instanceId: number,
): Promise<{ client: WuzapiClient; baseUrl: string }> => {
  const instance = await getInstanceForUser(userId, instanceId);
  if (!instance) {
    throw new DivulgacaoError("Instância não encontrada.", 404);
  }
  if (!instance.serverBaseUrl || !instance.token) {
    throw new DivulgacaoError("Instância sem servidor configurado.", 400);
  }
  return {
    baseUrl: instance.serverBaseUrl,
    client: {
      baseUrl: instance.serverBaseUrl,
      token: instance.token,
    },
  };
};

const normalizeInviteInfo = (
  invite: { inviteCode: string; inviteLink: string },
  payload: unknown,
): DivulgacaoInspectionResult => {
  const now = new Date().toISOString();
  const baseRecord =
    payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)
      ? (payload as Record<string, unknown>).data
      : payload;
  const record = (baseRecord || {}) as Record<string, any>;

  const normalizeString = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return null;
  };

  const groupJid =
    normalizeString(record?.JID) ||
    normalizeString(record?.jid) ||
    normalizeString(record?.Id) ||
    normalizeString(record?.id) ||
    (record && typeof record === "object" && normalizeString((record as Record<string, unknown>).remoteId)) ||
    null;

  const groupName =
    normalizeString(record?.Name) ||
    normalizeString(record?.name) ||
    normalizeString(record?.Subject) ||
    normalizeString(record?.subject) ||
    null;

  const adminsOnly =
    Boolean(record?.IsAnnounce) ||
    Boolean(record?.AnnounceOnly) ||
    Boolean(record?.announce) ||
    Boolean(record?.adminsOnly);
  const locked = Boolean(record?.IsLocked) || Boolean(record?.locked);
  const joinApproval =
    Boolean(record?.IsJoinApprovalRequired) ||
    Boolean(record?.isJoinApprovalRequired) ||
    Boolean(record?.MembershipApprovalMode) ||
    Boolean(record?.membershipApprovalMode);
  const ephemeral =
    Boolean(record?.IsEphemeral) ||
    Boolean(record?.ephemeral) ||
    Boolean(record?.DisappearingTimer) ||
    Boolean(record?.disappearingTimer);

  let memberCount: number | null = null;
  if (Array.isArray(record?.Participants)) {
    memberCount = record?.Participants.length;
  } else if (typeof record?.memberCount === "number") {
    memberCount = record?.memberCount;
  }

  const owner =
    normalizeString(record?.OwnerJID) ||
    normalizeString(record?.OwnerNumber) ||
    normalizeString(record?.owner) ||
    null;

  return {
    inviteCode: invite.inviteCode,
    inviteLink: invite.inviteLink,
    groupJid,
    groupName,
    adminsOnly,
    locked,
    joinApprovalRequired: joinApproval,
    ephemeralEnabled: ephemeral,
    memberCount,
    owner,
    inspectedAt: now,
    raw: record ?? null,
  };
};

const recordRun = async (input: {
  runUid: string;
  userId: number;
  instanceId: number;
  templateId?: number | null;
  inviteCode: string;
  inviteLink: string;
  targetJid: string | null;
  targetName: string | null;
  status: DivulgacaoRunRow["status"];
  inspection?: DivulgacaoInspectionResult | null;
  payload?: BotAdCampaignContent[] | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
}) => {
  await ensureDivulgacaoRunTable();
  const db = getDb();
  await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_group_divulgacao_runs (
        run_uid,
        user_id,
        instance_id,
        template_id,
        invite_code,
        invite_link,
        target_jid,
        target_name,
        status,
        inspect_json,
        payload_json,
        response_json,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.runUid,
      input.userId,
      input.instanceId,
      input.templateId ?? null,
      input.inviteCode,
      input.inviteLink,
      input.targetJid,
      input.targetName,
      input.status,
      input.inspection ? JSON.stringify(input.inspection) : null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.response ? JSON.stringify(input.response) : null,
      input.error ?? null,
    ],
  );
};

const collectMentions = (content: BotAdCampaignContent, participants?: string[]): string[] => {
  const mentions = new Set<string>();
  if (
    "mentionAll" in content &&
    content.mentionAll &&
    Array.isArray(participants) &&
    participants.length > 0
  ) {
    participants.forEach((jid) => {
      if (typeof jid === "string" && jid.trim()) {
        mentions.add(jid.trim());
      }
    });
  }
  if ("mentions" in content && Array.isArray(content.mentions)) {
    content.mentions.forEach((jid) => {
      if (typeof jid === "string" && jid.trim()) {
        mentions.add(jid.trim());
      }
    });
  }
  return Array.from(mentions.values());
};

const normalizeMentionParticipant = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeJid(value);
  return normalized ? normalized : null;
};

const extractParticipantId = (entry: unknown): string | null => {
  if (typeof entry === "string" && entry.trim()) {
    return normalizeMentionParticipant(entry.trim());
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const candidates = [
    record.id,
    record.Id,
    record.ID,
    record.jid,
    record.JID,
    record._serialized,
    record.participant,
    record.Participant,
    record.user,
    record.User,
    record.phone,
    record.Phone,
    record.number,
    record.Number,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const normalized = normalizeMentionParticipant(candidate.trim());
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
};

const extractParticipantIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const mentions = new Set<string>();
  raw.forEach((entry) => {
    const id = extractParticipantId(entry);
    if (id) {
      mentions.add(id);
    }
  });
  return Array.from(mentions.values());
};

const fetchGroupParticipantsForMentions = async (
  client: WuzapiClient,
  groupJid: string,
): Promise<string[]> => {
  try {
    const info = await getGroupInfo<Record<string, unknown>>(client, groupJid);
    const record = info && typeof info === "object" && "data" in info ? (info as Record<string, unknown>).data : info;
    const payload = (record ?? {}) as Record<string, unknown>;
    const candidates = payload.participants ?? payload.Participants ?? [];
    return extractParticipantIds(candidates);
  } catch (error) {
    console.warn("[divulgacao] Falha ao obter participantes para menção", {
      groupJid,
      error,
    });
    return [];
  }
};

const resolveMediaPayload = async (
  media?: { path?: string | null; url?: string | null },
): Promise<Buffer | string | null> => {
  if (!media) {
    return null;
  }
  if (media.path) {
    const buffer = await resolveStoredMediaBuffer(media.path);
    if (buffer) {
      return buffer;
    }
  }
  if (media.url && media.url.trim()) {
    return media.url.trim();
  }
  return null;
};

const dispatchContent = async (
  client: WuzapiClient,
  groupJid: string,
  content: BotAdCampaignContent,
  mentionParticipants?: string[],
): Promise<void> => {
  const mentions = collectMentions(content, mentionParticipants);
  if (content.type === "text") {
    await sendTextMessage(client, { to: groupJid, body: content.text, mentions });
    return;
  }
  if (
    content.type === "image" ||
    content.type === "video" ||
    content.type === "audio" ||
    content.type === "document" ||
    content.type === "sticker"
  ) {
    const mediaSource = await resolveMediaPayload(content.media ?? null);
    if (!mediaSource) {
      throw new DivulgacaoError("Mídia não encontrada para o conteúdo selecionado.");
    }
    await sendMediaMessage(client, {
      to: groupJid,
      media: mediaSource,
      mediaType: content.type === "sticker" ? "image" : content.type,
      caption: content.caption ?? null,
      filename: content.fileName ?? undefined,
      mimeType: content.mimeType ?? content.media?.mimeType ?? undefined,
      mentions,
    });
    return;
  }
  if (content.type === "buttons") {
    const baseButtons: InteractiveButton[] = [];
    if (Array.isArray(content.replyButtons)) {
      content.replyButtons.slice(0, 3).forEach((button) => {
        baseButtons.push({
          id: button.id,
          text: button.label ?? button.text ?? button.id,
          type: "quick_reply",
        });
      });
    }
    if (baseButtons.length === 0 && Array.isArray(content.ctaButtons)) {
      content.ctaButtons.slice(0, 3).forEach((button) => {
        baseButtons.push({
          id: button.id,
          text: button.text,
          type: button.type,
          url: button.url ?? undefined,
          phoneNumber: button.phoneNumber ?? undefined,
          copyCode: button.copyCode ?? undefined,
        });
      });
    }
    if (baseButtons.length === 0) {
      throw new DivulgacaoError("Nenhum botão válido informado.");
    }
    let headerMedia: Parameters<typeof sendInteractiveButtons>[1]["headerMedia"] = null;
    if (content.headerMedia) {
      const source = await resolveMediaPayload(content.headerMedia);
      if (source) {
        headerMedia = {
          type: content.headerMedia.mediaType ?? "image",
          media: source,
          mimeType: content.headerMedia.mimeType ?? undefined,
          fileName: content.headerMedia.fileName ?? undefined,
          sourceUrl:
            content.headerMedia.url ?? content.headerMedia.path ?? undefined,
        };
      }
    }
    await sendInteractiveButtons(client, {
      to: groupJid,
      title: content.title ?? "Selecione uma opção",
      body: content.body ?? content.title ?? "",
      footer: content.footer ?? undefined,
      buttons: baseButtons,
      headerMedia,
      buttonType: content.style === "cta" ? "legacy" : "native",
    });
    return;
  }
  if (content.type === "status") {
    throw new DivulgacaoError("Conteúdos do tipo status não são suportados neste fluxo.");
  }
  if (content.type === "affiliate_ml") {
    throw new DivulgacaoError("Conteúdo afiliado do Mercado Livre não é suportado neste fluxo.");
  }
};

export const listDivulgacaoTemplates = async (userId: number): Promise<DivulgacaoTemplate[]> => {
  const rows = await fetchTemplatesForUser(userId);
  return rows.map(mapTemplateRow);
};

export const createDivulgacaoTemplate = async (
  userId: number,
  payload: DivulgacaoTemplateInput,
): Promise<DivulgacaoTemplate> => {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    throw new DivulgacaoError("Informe o nome da mensagem.");
  }
  const contents = assertContents(payload.contents);
  await ensureDivulgacaoTemplateTable();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_group_divulgacao_templates (user_id, name, description, contents_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
    `,
    [userId, name, payload.description ?? null, JSON.stringify(contents)],
  );
  const insertedId = Number(result.insertId);
  const inserted = await fetchTemplateById(userId, insertedId);
  if (!inserted) {
    throw new DivulgacaoError("Falha ao criar a mensagem.");
  }
  return mapTemplateRow(inserted);
};

export const updateDivulgacaoTemplate = async (
  userId: number,
  templateId: number,
  payload: DivulgacaoTemplateInput,
): Promise<DivulgacaoTemplate> => {
  const existing = await fetchTemplateById(userId, templateId);
  if (!existing) {
    throw new DivulgacaoError("Mensagem não encontrada.", 404);
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : existing.name;
  if (!name) {
    throw new DivulgacaoError("Informe o nome da mensagem.");
  }
  const contents = assertContents(payload.contents);
  const db = getDb();
  await db.query(
    `
      UPDATE bot_group_divulgacao_templates
      SET name = ?, description = ?, contents_json = ?, updated_at = NOW()
      WHERE id = ? AND user_id = ?
    `,
    [name, payload.description ?? null, JSON.stringify(contents), templateId, userId],
  );
  const updated = await fetchTemplateById(userId, templateId);
  if (!updated) {
    throw new DivulgacaoError("Falha ao atualizar a mensagem.", 500);
  }
  return mapTemplateRow(updated);
};

export const deleteDivulgacaoTemplate = async (userId: number, templateId: number): Promise<void> => {
  const existing = await fetchTemplateById(userId, templateId);
  if (!existing) {
    throw new DivulgacaoError("Mensagem não encontrada.", 404);
  }
  const db = getDb();
  await db.query(`DELETE FROM bot_group_divulgacao_templates WHERE id = ? AND user_id = ? LIMIT 1`, [
    templateId,
    userId,
  ]);
};

export const inspectDivulgacaoInvite = async (
  userId: number,
  instanceId: number,
  inviteRaw: string,
): Promise<DivulgacaoInspectionResult> => {
  const invite = normalizeInviteLink(inviteRaw);
  const { client } = await resolveClientForInstance(userId, instanceId);
  try {
    const payload = await getGroupInviteInfo(client, invite.inviteCode);
    return normalizeInviteInfo(invite, payload);
  } catch (error) {
    const status = (error as { status?: number }).status;
    const message =
      error instanceof Error && error.message && error.message !== "Internal Server Error"
        ? error.message
        : "Falha ao consultar a instância para validar o grupo.";
    throw new DivulgacaoError(message, typeof status === "number" ? status : 502);
  }
};

export const sendDivulgacao = async (options: {
  userId: number;
  instanceId: number;
  invite: string;
  templateId?: number | null;
  contents?: BotAdCampaignContent[];
  mentionAll?: boolean | null;
}): Promise<DivulgacaoSendResult> => {
  const invite = normalizeInviteLink(options.invite);
  const { client } = await resolveClientForInstance(options.userId, options.instanceId);

  let contents = options.contents;
  if ((!contents || contents.length === 0) && options.templateId) {
    const template = await fetchTemplateById(options.userId, options.templateId);
    if (!template) {
      throw new DivulgacaoError("Modelo de mensagem não encontrado.", 404);
    }
    contents = assertContents(
      template.contents_json ? (JSON.parse(template.contents_json) as BotAdCampaignContent[]) : [],
    );
  }
  const normalizedContents = assertContents(contents);
  const contentsWithMention = options.mentionAll
    ? normalizedContents.map((entry) =>
        "mentionAll" in entry && entry.mentionAll !== true ? { ...entry, mentionAll: true } : entry,
      )
    : normalizedContents;

  const inspection = await inspectDivulgacaoInvite(options.userId, options.instanceId, invite.inviteLink);
  if (inspection.adminsOnly) {
    throw new DivulgacaoError("O grupo aceita mensagens apenas de administradores.", 409);
  }
  if (inspection.joinApprovalRequired) {
    throw new DivulgacaoError("O grupo exige aprovação antes de aceitar mensagens.", 409);
  }

  try {
    await joinGroupWithInviteLink(client, invite.inviteCode);
  } catch (error) {
    const status = (error as { status?: number }).status ?? (error as { response?: { status?: number } }).response?.status;
    if (status && status >= 400 && status !== 409) {
      throw new DivulgacaoError(
        (error as Error).message || "Falha ao entrar no grupo antes do envio.",
        status,
      );
    }
  }

  const groupJid = inspection.groupJid;
  if (!groupJid) {
    throw new DivulgacaoError("Não foi possível identificar o grupo alvo pelo convite.");
  }

  const runUid = randomUUID();
  let sentCount = 0;
  let mentionParticipants: string[] = [];
  if (contentsWithMention.some((content) => "mentionAll" in content && content.mentionAll)) {
    mentionParticipants = await fetchGroupParticipantsForMentions(client, groupJid);
  }

  try {
    for (const content of contentsWithMention) {
      await dispatchContent(client, groupJid, content, mentionParticipants);
      sentCount += 1;
    }
    await recordRun({
      runUid,
      userId: options.userId,
      instanceId: options.instanceId,
      templateId: options.templateId ?? null,
      inviteCode: invite.inviteCode,
      inviteLink: invite.inviteLink,
      targetJid: groupJid,
      targetName: inspection.groupName,
      status: "sent",
      inspection,
      payload: contentsWithMention,
      response: { messageCount: sentCount },
    });
    return {
      runId: runUid,
      status: "sent",
      inviteCode: invite.inviteCode,
      inviteLink: invite.inviteLink,
      groupJid,
      groupName: inspection.groupName,
      messageCount: sentCount,
      inspection,
    };
  } catch (error) {
    await recordRun({
      runUid,
      userId: options.userId,
      instanceId: options.instanceId,
      templateId: options.templateId ?? null,
      inviteCode: invite.inviteCode,
      inviteLink: invite.inviteLink,
      targetJid: groupJid,
      targetName: inspection.groupName,
      status: "failed",
      inspection,
      payload: normalizedContents,
      error: (error as Error).message ?? "Falha ao enviar a mensagem.",
    });
    throw error;
  }
};
