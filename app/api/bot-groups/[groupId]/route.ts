import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { invalidateGroupByRemoteIdCache, invalidateGroupSettingsCache } from "lib/bot-events/cache";
import {
  BotGroupError,
  deleteGroupForUser,
  getGroupAccessForUser,
  getGroupByIdForUser,
  updateGroupActivationForUser,
  updateGroupAdminsOnlyForUser,
  updateGroupDetailsForUser,
  updateGroupEphemeralForUser,
  updateGroupInviteForUser,
  updateGroupLockedForUser,
} from "lib/bot-groups";
import { upsertGroupSettings } from "lib/bot-group-settings";
import { publishBotGroupRealtimeUpdate } from "lib/bot-group-realtime";
import { getInstanceForUser } from "lib/bot-instances";
import { evaluatePlanGuard } from "lib/plan-guard";
import { SubscriptionPlanError } from "lib/plans";
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
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "nao", "não", "off"].includes(normalized)) return false;
  }
  return null;
};

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await context.params;
    const groupId = Number.parseInt(rawGroupId, 10);
    await deleteGroupForUser(user.id, groupId);

    return NextResponse.json({ message: "Grupo removido com sucesso." });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }

    console.error("Failed to delete bot group", error);
    return NextResponse.json(
      { message: "Não foi possível remover o grupo." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await context.params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }
    const ownerUserId = access.ownerUserId;
    const instance = await getInstanceForUser(ownerUserId, access.group.instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    }
    const profileViolation = await evaluatePlanGuard({
      userId: ownerUserId,
      instance,
      group: access.group,
    });
    if (profileViolation?.type === "instance") {
      return NextResponse.json(
        {
          code: "PROFILE_EXPIRED",
          message: "Renove este perfil para alterar as funções do grupo.",
          expiresAt: instance.expiresAt,
        },
        { status: 402 },
      );
    }

    let updatedGroup = null;
    let changed = false;

    const inviteLink = payload.inviteLink ?? payload.invite_link;
    if (typeof inviteLink === "string" && inviteLink.trim().length > 0) {
      updatedGroup = await updateGroupInviteForUser(ownerUserId, groupId, inviteLink);
      changed = true;
    }

    const detailsUpdates: { name?: string; description?: string | null } = {};
    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      detailsUpdates.name = typeof payload.name === "string" ? payload.name : String(payload.name ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(payload, "description")) {
      const raw = payload.description;
      detailsUpdates.description = raw === null || raw === undefined ? null : String(raw);
    }
    if (Object.keys(detailsUpdates).length > 0) {
      updatedGroup = await updateGroupDetailsForUser(ownerUserId, groupId, detailsUpdates);
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "adminsOnly")) {
      const value = payload.adminsOnly;
      const normalized = value === true || value === "true" || value === 1;
      updatedGroup = await updateGroupAdminsOnlyForUser(ownerUserId, groupId, normalized);
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "locked")) {
      const value = payload.locked;
      const normalized = value === true || value === "true" || value === 1;
      updatedGroup = await updateGroupLockedForUser(ownerUserId, groupId, normalized);
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "ephemeral")) {
      const value = payload.ephemeral;
      if (typeof value !== "string") {
        return NextResponse.json({ message: "Duração inválida." }, { status: 400 });
      }
      updatedGroup = await updateGroupEphemeralForUser(ownerUserId, groupId, value);
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

      const rawSlot = (payload as Record<string, unknown>).slot ?? (payload as Record<string, unknown>).slotNumber;
      const preferredSlot =
        nextActive && rawSlot !== undefined && rawSlot !== null && String(rawSlot).trim() !== ""
          ? Number.parseInt(String(rawSlot), 10)
          : undefined;
      updatedGroup = await updateGroupActivationForUser(ownerUserId, groupId, nextActive, preferredSlot);
      changed = true;
    }

    const settingsUpdates: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">> = {};

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
      const commandToggles = (payload as any).commandToggles ?? (payload as any).command_toggles;
      settingsUpdates.commandToggles = commandToggles;
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

    if (typeof (payload as any).aiPrompt === "string") {
      settingsUpdates.aiPrompt = (payload as any).aiPrompt;
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "aiToolsPrompt") ||
      Object.prototype.hasOwnProperty.call(payload, "ai_tools_prompt")
    ) {
      const rawToolsPrompt = (payload as any).aiToolsPrompt ?? (payload as any).ai_tools_prompt;
      if (typeof rawToolsPrompt === "string" && user.role === "admin") {
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
      const updated = await getGroupByIdForUser(ownerUserId, groupId);
      if (updated) {
        void publishBotGroupRealtimeUpdate(
          [user.id, ownerUserId],
          updated,
          "bot.group.settings.updated",
        );
      }
      return NextResponse.json({
        message: "Configurações atualizadas com sucesso.",
        settings,
      });
    }

    if (!changed) {
      return NextResponse.json({ message: "Nenhuma alteração informada." }, { status: 400 });
    }

    const group = updatedGroup ?? (await getGroupByIdForUser(ownerUserId, groupId));
    if (group) {
      invalidateGroupByRemoteIdCache(group.instanceId, group.remoteId);
      void publishBotGroupRealtimeUpdate(
        [user.id, ownerUserId],
        group,
        "bot.group.updated",
      );
    }
    return NextResponse.json({
      message: "Configurações atualizadas com sucesso.",
      group: group && access.isShared ? { ...group, accessRole: "shared_admin" } : group,
    });
  } catch (error) {
    if (error instanceof BotGroupError || error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }
    console.error("Failed to update bot group", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o grupo." },
      { status: 500 },
    );
  }
}
