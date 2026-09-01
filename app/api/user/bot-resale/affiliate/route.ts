import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getBotAdminAffiliateConfig,
  listBotAdminAffiliateHistory,
  updateBotAdminAffiliateConfig,
  updateBotAdminAffiliateEnabled,
} from "lib/bot-admin-affiliates";
import { evaluateBotResalePaymentReadiness, resolveBotResalePaymentMode } from "lib/bot-resale-payments";
import { getBotResaleWalletSummary } from "lib/bot-resale-wallet";
import { listInstancesForUser } from "lib/bot-instances";
import { listGroupsForUser } from "lib/bot-groups";

const parseEnabled = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "sim", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "nao", "não", "no", "off"].includes(normalized)) return false;
  }
  return null;
};

const parseAutoShare = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const patch: {
    enabled?: boolean;
    groupIds?: number[];
    mode?: "interval" | "scheduled";
    intervalHours?: number;
    times?: string[];
    groupSchedules?: Array<{ groupId: number; times: string[]; offsetMinutes?: number }>;
    messageText?: string;
    ctaText?: string;
    mediaItems?: Array<Record<string, unknown>>;
  } = {};

  if (Object.prototype.hasOwnProperty.call(record, "enabled")) {
    const enabled = parseEnabled(record.enabled);
    if (enabled === null) {
      throw new Error("Informe se a divulgação automática deve ficar ativa.");
    }
    patch.enabled = enabled;
  }
  if (Object.prototype.hasOwnProperty.call(record, "groupIds")) {
    if (!Array.isArray(record.groupIds)) {
      throw new Error("Selecione os grupos da divulgação automática.");
    }
    patch.groupIds = record.groupIds
      .map((entry) => Math.floor(Number(entry)))
      .filter((entry) => Number.isFinite(entry) && entry > 0);
  }
  if (Object.prototype.hasOwnProperty.call(record, "intervalHours")) {
    const intervalHours = Number(record.intervalHours);
    if (!Number.isFinite(intervalHours) || intervalHours < 1) {
      throw new Error("Informe um intervalo válido em horas.");
    }
    patch.intervalHours = Math.floor(intervalHours);
  }
  if (Object.prototype.hasOwnProperty.call(record, "mode")) {
    if (typeof record.mode !== "string") {
      throw new Error("Informe o modo da divulgação automática.");
    }
    const mode = record.mode.trim().toLowerCase();
    if (!["interval", "scheduled"].includes(mode)) {
      throw new Error("Escolha intervalo ou horários específicos para a divulgação.");
    }
    patch.mode = mode as "interval" | "scheduled";
  }
  if (Object.prototype.hasOwnProperty.call(record, "times")) {
    if (!Array.isArray(record.times)) {
      throw new Error("Informe uma lista válida de horários.");
    }
    patch.times = record.times
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, 8);
  }
  if (Object.prototype.hasOwnProperty.call(record, "groupSchedules")) {
    if (!Array.isArray(record.groupSchedules)) {
      throw new Error("Informe uma lista válida de horários por grupo.");
    }
    patch.groupSchedules = record.groupSchedules
      .filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
      .map((entry) => ({
        groupId: Math.floor(Number(entry.groupId)),
        times: Array.isArray(entry.times)
          ? entry.times.filter((time): time is string => typeof time === "string").slice(0, 8)
          : [],
        offsetMinutes: Math.floor(Number(entry.offsetMinutes ?? 0) || 0),
      }))
      .filter((entry) => Number.isFinite(entry.groupId) && entry.groupId > 0 && entry.times.length > 0)
      .slice(0, 80);
  }
  if (Object.prototype.hasOwnProperty.call(record, "messageText")) {
    if (typeof record.messageText !== "string") {
      throw new Error("Informe uma mensagem válida.");
    }
    patch.messageText = record.messageText;
  }
  if (Object.prototype.hasOwnProperty.call(record, "ctaText")) {
    if (typeof record.ctaText !== "string") {
      throw new Error("Informe um texto válido para o botão.");
    }
    patch.ctaText = record.ctaText;
  }
  if (Object.prototype.hasOwnProperty.call(record, "mediaItems")) {
    if (!Array.isArray(record.mediaItems)) {
      throw new Error("Informe uma lista válida de mídias.");
    }
    patch.mediaItems = record.mediaItems
      .filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
      .slice(0, 20);
  }

  return patch;
};

const mapGroupsForAffiliate = (groups: Awaited<ReturnType<typeof listGroupsForUser>>) =>
  groups.map((group) => ({
    id: group.id,
    name: group.name,
    instanceName: group.instanceName,
    instancePhone: group.instancePhone,
    status: group.status,
    adminsOnly: Boolean(group.metadata?.adminsOnly),
    locked: Boolean(group.metadata?.locked),
  }));

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const [affiliate, wallet, readiness, paymentMode, history, instances, groups] = await Promise.all([
      getBotAdminAffiliateConfig(user.id),
      getBotResaleWalletSummary(user.id),
      evaluateBotResalePaymentReadiness(user.id),
      resolveBotResalePaymentMode(user.id),
      listBotAdminAffiliateHistory(user.id, 20),
      listInstancesForUser(user.id),
      listGroupsForUser(user.id, { includeParticipants: false }),
    ]);

    return NextResponse.json({
      affiliate,
      wallet,
      readiness,
      paymentMode,
      history,
      instances: instances.map((instance) => ({
        id: instance.id,
        name: instance.name,
        phone: instance.phone,
        serverName: instance.serverName,
        licenseSalesEnabled: instance.licenseSalesEnabled,
      })),
      groups: mapGroupsForAffiliate(groups),
    });
  } catch (error) {
    console.error("[bot-resale/affiliate] GET failed", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o Bot Admin afiliados." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const record = body as Record<string, unknown> | null;
    const hasEnabled = Boolean(record && Object.prototype.hasOwnProperty.call(record, "enabled"));
    const hasAutoShare = Boolean(record && Object.prototype.hasOwnProperty.call(record, "autoShare"));
    const enabled = hasEnabled ? parseEnabled(record?.enabled) : null;
    if (hasEnabled && enabled === null) {
      return NextResponse.json({ message: "Informe se o afiliados deve ficar ativo." }, { status: 400 });
    }
    if (!hasEnabled && !hasAutoShare) {
      return NextResponse.json({ message: "Informe o que deve ser atualizado." }, { status: 400 });
    }

    const autoShare = hasAutoShare ? parseAutoShare(record?.autoShare) : null;
    const affiliate = hasAutoShare
      ? await updateBotAdminAffiliateConfig(user.id, {
          ...(hasEnabled ? { enabled: Boolean(enabled) } : {}),
          autoShare: autoShare ?? undefined,
        })
      : await updateBotAdminAffiliateEnabled(user.id, Boolean(enabled));
    const [wallet, readiness, paymentMode, history, instances, groups] = await Promise.all([
      getBotResaleWalletSummary(user.id),
      evaluateBotResalePaymentReadiness(user.id),
      resolveBotResalePaymentMode(user.id),
      listBotAdminAffiliateHistory(user.id, 20),
      listInstancesForUser(user.id),
      listGroupsForUser(user.id, { includeParticipants: false }),
    ]);

    return NextResponse.json({
      message: hasAutoShare
        ? "Divulgação automática do Bot Admin afiliados salva."
        : enabled
          ? "Bot Admin afiliados ativado."
          : "Bot Admin afiliados desativado.",
      affiliate,
      wallet,
      readiness,
      paymentMode,
      history,
      instances: instances.map((instance) => ({
        id: instance.id,
        name: instance.name,
        phone: instance.phone,
        serverName: instance.serverName,
        licenseSalesEnabled: instance.licenseSalesEnabled,
      })),
      groups: mapGroupsForAffiliate(groups),
    });
  } catch (error) {
    console.error("[bot-resale/affiliate] PATCH failed", error);
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o afiliados.";
    const status = /^(Informe|Selecione)/i.test(message) ? 400 : 500;
    return NextResponse.json(
      { message },
      { status },
    );
  }
}

export const dynamic = "force-dynamic";
