import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { invalidateGroupByRemoteIdCache, invalidateGroupSettingsCache } from "lib/bot-events/cache";
import {
  getAdminGroupOwnerRow,
  getAdminGroupWithUser,
  mapBotGroupToAdminSummary,
} from "lib/admin-groups";
import {
  BotGroupError,
  deleteGroupForUser,
  transferGroupToUser,
  updateGroupActivationForUser,
  updateGroupAdminsOnlyForUser,
  updateGroupDetailsForUser,
  updateGroupInviteForUser,
  updateGroupLockedForUser,
} from "lib/bot-groups";
import { upsertGroupSettings } from "lib/bot-group-settings";
import type { BotGroupSettings } from "types/bot-groups";

const DEFAULT_GROQ_MODEL = "qwen2.5:7b";

const parseListInput = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  }
  return [];
};

const parseBoolean = (value: unknown): boolean | null => {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso não autorizado." }, { status: 403 });
    }

    const resolvedParams = await params;
    const groupId = Number.parseInt(resolvedParams.groupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const detail = await getAdminGroupWithUser(groupId);
    if (!detail) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    return NextResponse.json({
      message: "Grupo carregado com sucesso.",
      group: detail.group,
      user: detail.user,
      summary: mapBotGroupToAdminSummary(detail.group, detail.user),
    });
  } catch (error) {
    console.error("Failed to fetch admin group", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os dados do grupo." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso não autorizado." }, { status: 403 });
    }

    const resolvedParams = await params;
    const groupId = Number.parseInt(resolvedParams.groupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const ownerRow = await getAdminGroupOwnerRow(groupId);
    if (!ownerRow) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    let changed = false;
    let ownerUserId = ownerRow.user_id;

    const transferUserRaw =
      payload.transferToUserId ??
      (payload as Record<string, unknown>)["transfer_to_user_id"] ??
      (payload as Record<string, unknown>)["transfer_user_id"];

    const transferInstanceRaw =
      payload.targetInstanceId ??
      (payload as Record<string, unknown>)["target_instance_id"] ??
      (payload as Record<string, unknown>)["transferInstanceId"];

    if (transferUserRaw !== undefined && transferUserRaw !== null) {
      const parsedUserId = Number.parseInt(String(transferUserRaw), 10);
      if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) {
        return NextResponse.json(
          { message: "Usuário de destino inválido." },
          { status: 400 },
        );
      }

      let parsedInstanceId: number | undefined;
      if (
        transferInstanceRaw !== undefined &&
        transferInstanceRaw !== null &&
        String(transferInstanceRaw).trim().length > 0
      ) {
        const candidate = Number.parseInt(String(transferInstanceRaw), 10);
        if (!Number.isFinite(candidate) || candidate <= 0) {
          return NextResponse.json(
            { message: "Instância de destino inválida." },
            { status: 400 },
          );
        }
        parsedInstanceId = candidate;
      }

      const updatedGroup = await transferGroupToUser({
        groupId,
        targetUserId: parsedUserId,
        targetInstanceId: parsedInstanceId,
      });
      ownerUserId = updatedGroup.userId;
      changed = true;
    }

    const inviteLink = payload.inviteLink ?? payload.invite_link;
    if (typeof inviteLink === "string" && inviteLink.trim().length > 0) {
      await updateGroupInviteForUser(ownerUserId, groupId, inviteLink);
      changed = true;
    }

    const detailsUpdates: { name?: string; description?: string | null } = {};
    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      detailsUpdates.name =
        typeof payload.name === "string" ? payload.name : String(payload.name ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(payload, "description")) {
      const raw = payload.description;
      detailsUpdates.description = raw === null || raw === undefined ? null : String(raw);
    }
    if (Object.keys(detailsUpdates).length > 0) {
      await updateGroupDetailsForUser(ownerUserId, groupId, detailsUpdates);
      changed = true;
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "status") ||
      Object.prototype.hasOwnProperty.call(payload, "active")
    ) {
      const rawStatus = payload.status;
      let nextActive: boolean;
      if (typeof rawStatus === "string" && rawStatus.trim().length > 0) {
        const normalized = rawStatus.trim().toLowerCase();
        nextActive = normalized === "active" || normalized === "ativo";
      } else if (Object.prototype.hasOwnProperty.call(payload, "active")) {
        const rawActive = payload.active;
        nextActive = rawActive === true || rawActive === "true" || rawActive === 1 || rawActive === "1";
      } else {
        nextActive = true;
      }

      await updateGroupActivationForUser(ownerUserId, groupId, nextActive);
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "adminsOnly")) {
      const normalized = parseBoolean(payload.adminsOnly);
      if (normalized === null) {
        return NextResponse.json(
          { message: "Valor inválido para o modo apenas administradores." },
          { status: 400 },
        );
      }
      await updateGroupAdminsOnlyForUser(ownerUserId, groupId, normalized);
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "locked")) {
      const normalized = parseBoolean(payload.locked);
      if (normalized === null) {
        return NextResponse.json(
          { message: "Valor inválido para bloqueio de edição." },
          { status: 400 },
        );
      }
      await updateGroupLockedForUser(ownerUserId, groupId, normalized);
      changed = true;
    }

    const settingsUpdates: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">> = {};

    if (
      Object.prototype.hasOwnProperty.call(payload, "planRenewalAdminsOnly") ||
      Object.prototype.hasOwnProperty.call(payload, "plan_renewal_admins_only")
    ) {
      const normalized = parseBoolean(
        (payload as any).planRenewalAdminsOnly ?? (payload as any).plan_renewal_admins_only,
      );
      if (normalized === null) {
        return NextResponse.json(
          { message: "Valor inválido para permissão de renovação." },
          { status: 400 },
        );
      }
      settingsUpdates.planRenewalAdminsOnly = normalized;
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "planRenewalSilent") ||
      Object.prototype.hasOwnProperty.call(payload, "plan_renewal_silent")
    ) {
      const normalized = parseBoolean(
        (payload as any).planRenewalSilent ?? (payload as any).plan_renewal_silent,
      );
      if (normalized === null) {
        return NextResponse.json(
          { message: "Valor inválido para modo invisível de renovação." },
          { status: 400 },
        );
      }
      settingsUpdates.planRenewalSilent = normalized;
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "welcomeConfig") ||
      Object.prototype.hasOwnProperty.call(payload, "welcome_config")
    ) {
      settingsUpdates.welcomeConfig = (payload as any).welcomeConfig ?? (payload as any).welcome_config;
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "commandToggles") ||
      Object.prototype.hasOwnProperty.call(payload, "command_toggles")
    ) {
      settingsUpdates.commandToggles = (payload as any).commandToggles ?? (payload as any).command_toggles;
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "featureFlags") ||
      Object.prototype.hasOwnProperty.call(payload, "feature_flags")
    ) {
      const value = (payload as any).featureFlags ?? (payload as any).feature_flags;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        settingsUpdates.featureFlags = value;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "aiProvider") ||
      Object.prototype.hasOwnProperty.call(payload, "ai_provider")
    ) {
      const provider = String((payload as any).aiProvider ?? (payload as any).ai_provider ?? "").trim();
      if (!["groq", "openai", "chatgpt_system"].includes(provider)) {
        return NextResponse.json({ message: "Provedor de IA inválido." }, { status: 400 });
      }
      settingsUpdates.aiProvider = provider as BotGroupSettings["aiProvider"];
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "openAiApiKey") ||
      Object.prototype.hasOwnProperty.call(payload, "openai_api_key")
    ) {
      const value = (payload as any).openAiApiKey ?? (payload as any).openai_api_key;
      settingsUpdates.openAiApiKey = value === null || value === ""
        ? null
        : String(value).replace(/\s+/g, "").slice(0, 4000);
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "groqKeys") ||
      Object.prototype.hasOwnProperty.call(payload, "groq_keys")
    ) {
      const parsedKeys = parseListInput((payload as any).groqKeys ?? (payload as any).groq_keys)
        .map((entry) => entry.replace(/\s+/g, ""))
        .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
      settingsUpdates.groqKeys = parsedKeys;
    }

    if (typeof (payload as any).aiPrompt === "string") {
      settingsUpdates.aiPrompt = (payload as any).aiPrompt;
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "aiToolsPrompt") ||
      Object.prototype.hasOwnProperty.call(payload, "ai_tools_prompt")
    ) {
      const rawToolsPrompt = (payload as any).aiToolsPrompt ?? (payload as any).ai_tools_prompt;
      if (typeof rawToolsPrompt === "string") {
        settingsUpdates.aiToolsPrompt = rawToolsPrompt;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "aiVoice") ||
      Object.prototype.hasOwnProperty.call(payload, "ai_voice")
    ) {
      const rawVoice = (payload as any).aiVoice ?? (payload as any).ai_voice;
      if (rawVoice === null) {
        settingsUpdates.aiVoice = null;
      } else if (typeof rawVoice === "string") {
        settingsUpdates.aiVoice = rawVoice;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "aiModel") ||
      Object.prototype.hasOwnProperty.call(payload, "ai_model")
    ) {
      const rawModel = (payload as any).aiModel ?? (payload as any).ai_model;
      if (rawModel === null) {
        settingsUpdates.aiModel = DEFAULT_GROQ_MODEL;
      } else if (typeof rawModel === "string") {
        const trimmed = rawModel.trim();
        settingsUpdates.aiModel = trimmed.length > 0 ? trimmed : DEFAULT_GROQ_MODEL;
      }
    }

    if (Array.isArray((payload as any).aiMemory) && (payload as any).aiMemory.length === 0) {
      settingsUpdates.aiMemory = [];
    } else if ((payload as any).aiMemory === null) {
      settingsUpdates.aiMemory = [];
    }

    if (Object.keys(settingsUpdates).length > 0) {
      const settings = await upsertGroupSettings(groupId, settingsUpdates);
      invalidateGroupSettingsCache(groupId);
      return NextResponse.json({
        message: "Configurações atualizadas com sucesso.",
        settings,
      });
    }

    if (!changed) {
      return NextResponse.json({ message: "Nenhuma alteração informada." }, { status: 400 });
    }

    const detail = await getAdminGroupWithUser(groupId);
    if (!detail) {
      return NextResponse.json(
        { message: "Grupo não encontrado após a atualização." },
        { status: 404 },
      );
    }
    invalidateGroupByRemoteIdCache(detail.group.instanceId, detail.group.remoteId);

    return NextResponse.json({
      message: "Grupo atualizado com sucesso.",
      group: detail.group,
      user: detail.user,
      summary: mapBotGroupToAdminSummary(detail.group, detail.user),
    });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to update admin group", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o grupo." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso não autorizado." }, { status: 403 });
    }

    const resolvedParams = await params;
    const groupId = Number.parseInt(resolvedParams.groupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const ownerRow = await getAdminGroupOwnerRow(groupId);
    if (!ownerRow) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    await deleteGroupForUser(ownerRow.user_id, groupId);

    return NextResponse.json({ message: "Grupo removido com sucesso." });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to delete admin group", error);
    return NextResponse.json(
      { message: "Não foi possível remover o grupo." },
      { status: 500 },
    );
  }
}
