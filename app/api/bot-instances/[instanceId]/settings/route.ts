import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import {
  getInstanceSettings,
  normalizeInstanceAutoResponsesInput,
  normalizeInstanceOnlinePresenceMonitorJids,
  normalizeInstancePvCommandAllowlist,
  normalizeInstanceStickerAuthor,
  normalizeInstanceStickerPack,
  upsertInstanceSettings,
} from "lib/bot-instance-settings";
import { invalidateInstanceSettingsCache } from "lib/bot-events/cache";
import { getAdminMediaStorageSummary, getUserMediaStorageSummary } from "lib/user-media-storage";
import { subscribeUserPresence } from "lib/wuzapi";
import type { BotInstanceCommandToggles } from "types/bot-instance-settings";

const normalizeToggleInput = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return value !== 0;
    }
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (["1", "true", "yes", "on", "sim"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", "nao", "não"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
};

const getStorageSummaryForUser = (user: { id: number; role: string }) =>
  user.role === "admin" ? getAdminMediaStorageSummary(user.id) : getUserMediaStorageSummary(user.id);

const parseCommandTogglesInput = (payload: Record<string, unknown>): Partial<BotInstanceCommandToggles> => {
  const patch: Partial<BotInstanceCommandToggles> = {};

  const candidate = payload.commandToggles ?? payload.command_toggles;
  if (candidate && typeof candidate === "object") {
    const autoresposta = normalizeToggleInput(
      (candidate as Record<string, unknown>).autoresposta ??
        (candidate as Record<string, unknown>).autoResponse ??
        (candidate as Record<string, unknown>).enabled,
    );
    if (autoresposta !== undefined) {
      patch.autoresposta = autoresposta;
    }

    const prefixoPv = normalizeToggleInput(
      (candidate as Record<string, unknown>).prefixoPv ??
        (candidate as Record<string, unknown>).prefixosPv ??
        (candidate as Record<string, unknown>).prefixCommandsPv ??
        (candidate as Record<string, unknown>).comandosPv ??
        (candidate as Record<string, unknown>).commandsPv ??
        (candidate as Record<string, unknown>).allowPrefixCommandsInPv ??
        (candidate as Record<string, unknown>).allowPrefixes ??
        (candidate as Record<string, unknown>).allowPrefixesPv,
    );
    if (prefixoPv !== undefined) {
      patch.prefixoPv = prefixoPv;
    }

    const pvAllowlist = normalizeInstancePvCommandAllowlist(
      (candidate as Record<string, unknown>).pvCommandAllowlist ??
        (candidate as Record<string, unknown>).allowedPvCommands ??
        (candidate as Record<string, unknown>).pvCommands ??
        (candidate as Record<string, unknown>).prefixoPvAllowlist ??
        (candidate as Record<string, unknown>).allowedPrefixedCommands ??
        (candidate as Record<string, unknown>).pvCommandWhitelist ??
        (candidate as Record<string, unknown>).allowedCommandsPv,
    );
    if (pvAllowlist !== undefined) {
      patch.pvCommandAllowlist = pvAllowlist;
    }

    const nativeButtons = normalizeToggleInput(
      (candidate as Record<string, unknown>).nativeButtons ??
        (candidate as Record<string, unknown>).nativebuttons ??
        (candidate as Record<string, unknown>).interactiveButtons ??
        (candidate as Record<string, unknown>).botButtons,
    );
    if (nativeButtons !== undefined) {
      patch.nativeButtons = nativeButtons;
    }

    const recoverDeletedMessages = normalizeToggleInput(
      (candidate as Record<string, unknown>).recoverDeletedMessages ??
        (candidate as Record<string, unknown>).recoverDeleted ??
        (candidate as Record<string, unknown>).restoreDeletedMessages ??
        (candidate as Record<string, unknown>).recuperarApagadas ??
        (candidate as Record<string, unknown>).recuperarMensagensApagadas,
    );
    if (recoverDeletedMessages !== undefined) {
      patch.recoverDeletedMessages = recoverDeletedMessages;
    }

    const keepDeletedChatsInHistory = normalizeToggleInput(
      (candidate as Record<string, unknown>).keepDeletedChatsInHistory ??
        (candidate as Record<string, unknown>).keepDeletedChats ??
        (candidate as Record<string, unknown>).dontDeleteHistoryOnChatDelete ??
        (candidate as Record<string, unknown>).manterChatsApagados ??
        (candidate as Record<string, unknown>).naoApagarHistoricoChats,
    );
    if (keepDeletedChatsInHistory !== undefined) {
      patch.keepDeletedChatsInHistory = keepDeletedChatsInHistory;
    }

    const persistentMediaStorage = normalizeToggleInput(
      (candidate as Record<string, unknown>).persistentMediaStorage ??
        (candidate as Record<string, unknown>).r2PersistentMedia ??
        (candidate as Record<string, unknown>).premiumMediaStorage ??
        (candidate as Record<string, unknown>).armazenamentoPersistente ??
        (candidate as Record<string, unknown>).midiaPersistente,
    );
    if (persistentMediaStorage !== undefined) {
      patch.persistentMediaStorage = persistentMediaStorage;
    }

    const notifyOnlinePresence = normalizeToggleInput(
      (candidate as Record<string, unknown>).notifyOnlinePresence ??
        (candidate as Record<string, unknown>).onlinePresenceNotifications ??
        (candidate as Record<string, unknown>).presenceOnlineNotifications ??
        (candidate as Record<string, unknown>).avisarOnline ??
        (candidate as Record<string, unknown>).notificarOnline,
    );
    if (notifyOnlinePresence !== undefined) {
      patch.notifyOnlinePresence = notifyOnlinePresence;
    }

    const onlinePresenceMonitorJids = normalizeInstanceOnlinePresenceMonitorJids(
      (candidate as Record<string, unknown>).onlinePresenceMonitorJids ??
        (candidate as Record<string, unknown>).onlinePresenceContacts ??
        (candidate as Record<string, unknown>).presenceMonitorJids ??
        (candidate as Record<string, unknown>).presenceMonitorContacts ??
        (candidate as Record<string, unknown>).contatosMonitoradosOnline,
    );
    if (onlinePresenceMonitorJids !== undefined) {
      patch.onlinePresenceMonitorJids = onlinePresenceMonitorJids;
    }

    const stickerPack = normalizeInstanceStickerPack(
      (candidate as Record<string, unknown>).stickerPack ??
        (candidate as Record<string, unknown>).sticker_pack ??
        (candidate as Record<string, unknown>).stickerPackName,
    );
    if (stickerPack !== undefined) {
      patch.stickerPack = stickerPack;
    }

    const stickerAuthor = normalizeInstanceStickerAuthor(
      (candidate as Record<string, unknown>).stickerAuthor ??
        (candidate as Record<string, unknown>).sticker_author ??
        (candidate as Record<string, unknown>).stickerPackAuthor,
    );
    if (stickerAuthor !== undefined) {
      patch.stickerAuthor = stickerAuthor;
    }
  }

  const directAutoresposta = normalizeToggleInput(
    payload.autoresposta ?? payload.autoResponse ?? payload.enabled,
  );
  if (directAutoresposta !== undefined) {
    patch.autoresposta = directAutoresposta;
  }

  const directPrefixoPv = normalizeToggleInput(
    payload.prefixoPv ??
      payload.prefixosPv ??
      payload.prefixCommandsPv ??
      payload.comandosPv ??
      payload.commandsPv ??
      payload.allowPrefixCommandsInPv ??
      payload.allowPrefixes ??
      payload.allowPrefixesPv,
  );
  if (directPrefixoPv !== undefined) {
    patch.prefixoPv = directPrefixoPv;
  }

  const directPvAllowlist = normalizeInstancePvCommandAllowlist(
    payload.pvCommandAllowlist ??
      payload.allowedPvCommands ??
      payload.pvCommands ??
      payload.prefixoPvAllowlist ??
      payload.allowedPrefixedCommands ??
      payload.pvCommandWhitelist ??
      payload.allowedCommandsPv,
  );
  if (directPvAllowlist !== undefined) {
    patch.pvCommandAllowlist = directPvAllowlist;
  }

  const directNativeButtons = normalizeToggleInput(
    payload.nativeButtons ??
      payload.nativebuttons ??
      payload.interactiveButtons ??
      payload.botButtons,
  );
  if (directNativeButtons !== undefined) {
    patch.nativeButtons = directNativeButtons;
  }

  const directRecoverDeletedMessages = normalizeToggleInput(
    payload.recoverDeletedMessages ??
      payload.recoverDeleted ??
      payload.restoreDeletedMessages ??
      payload.recuperarApagadas ??
      payload.recuperarMensagensApagadas,
  );
  if (directRecoverDeletedMessages !== undefined) {
    patch.recoverDeletedMessages = directRecoverDeletedMessages;
  }

  const directKeepDeletedChatsInHistory = normalizeToggleInput(
    payload.keepDeletedChatsInHistory ??
      payload.keepDeletedChats ??
      payload.dontDeleteHistoryOnChatDelete ??
      payload.manterChatsApagados ??
      payload.naoApagarHistoricoChats,
  );
  if (directKeepDeletedChatsInHistory !== undefined) {
    patch.keepDeletedChatsInHistory = directKeepDeletedChatsInHistory;
  }

  const directPersistentMediaStorage = normalizeToggleInput(
    payload.persistentMediaStorage ??
      payload.r2PersistentMedia ??
      payload.premiumMediaStorage ??
      payload.armazenamentoPersistente ??
      payload.midiaPersistente,
  );
  if (directPersistentMediaStorage !== undefined) {
    patch.persistentMediaStorage = directPersistentMediaStorage;
  }

  const directNotifyOnlinePresence = normalizeToggleInput(
    payload.notifyOnlinePresence ??
      payload.onlinePresenceNotifications ??
      payload.presenceOnlineNotifications ??
      payload.avisarOnline ??
      payload.notificarOnline,
  );
  if (directNotifyOnlinePresence !== undefined) {
    patch.notifyOnlinePresence = directNotifyOnlinePresence;
  }

  const directOnlinePresenceMonitorJids = normalizeInstanceOnlinePresenceMonitorJids(
    payload.onlinePresenceMonitorJids ??
      payload.onlinePresenceContacts ??
      payload.presenceMonitorJids ??
      payload.presenceMonitorContacts ??
      payload.contatosMonitoradosOnline,
  );
  if (directOnlinePresenceMonitorJids !== undefined) {
    patch.onlinePresenceMonitorJids = directOnlinePresenceMonitorJids;
  }

  const directStickerPack = normalizeInstanceStickerPack(
    payload.stickerPack ?? payload.sticker_pack ?? payload.stickerPackName,
  );
  if (directStickerPack !== undefined) {
    patch.stickerPack = directStickerPack;
  }

  const directStickerAuthor = normalizeInstanceStickerAuthor(
    payload.stickerAuthor ?? payload.sticker_author ?? payload.stickerPackAuthor,
  );
  if (directStickerAuthor !== undefined) {
    patch.stickerAuthor = directStickerAuthor;
  }

  return patch;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { instanceId: instanceIdParam } = await params;
    const instanceId = Number.parseInt(instanceIdParam, 10);
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    const settings = await getInstanceSettings(instance.id);
    const storage = await getStorageSummaryForUser(user);
    return NextResponse.json({ settings, storage });
  } catch (error) {
    console.error("Failed to load instance settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações da instância." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { instanceId: instanceIdParam } = await params;
    const instanceId = Number.parseInt(instanceIdParam, 10);
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ message: "Corpo da requisição inválido." }, { status: 400 });
    }

    const commandTogglePatch = parseCommandTogglesInput(payload);

    if (commandTogglePatch.persistentMediaStorage === true) {
      const currentStorage = await getStorageSummaryForUser(user);
      if (!currentStorage.hasActivePlan || currentStorage.quotaBytes <= 0) {
        return NextResponse.json(
          {
            message: "Contrate um pacote mensal de armazenamento para ativar mídias persistentes no R2.",
            requiresStoragePurchase: true,
            storage: currentStorage,
          },
          { status: 402 },
        );
      }
    }

    let autoResponsesPatch: ReturnType<typeof normalizeInstanceAutoResponsesInput> | undefined;
    if (Object.prototype.hasOwnProperty.call(payload, "autoResponses")) {
      autoResponsesPatch = normalizeInstanceAutoResponsesInput(payload.autoResponses);
    } else if (Object.prototype.hasOwnProperty.call(payload, "auto_responses")) {
      autoResponsesPatch = normalizeInstanceAutoResponsesInput(payload.auto_responses);
    }

    const hasToggleUpdate = Object.keys(commandTogglePatch).length > 0;
    const hasAutoResponsesUpdate = autoResponsesPatch !== undefined;

    if (!hasToggleUpdate && !hasAutoResponsesUpdate) {
      return NextResponse.json({ message: "Nenhuma alteração informada." }, { status: 400 });
    }

    const updated = await upsertInstanceSettings(instance.id, {
      commandToggles: hasToggleUpdate ? commandTogglePatch : undefined,
      autoResponses: hasAutoResponsesUpdate ? autoResponsesPatch ?? [] : undefined,
    });

    invalidateInstanceSettingsCache(instance.id);

    let presenceSubscription: unknown = null;
    const monitorJids = updated.commandToggles.onlinePresenceMonitorJids;
    if (
      updated.commandToggles.notifyOnlinePresence === true &&
      Array.isArray(monitorJids) &&
      monitorJids.length > 0
    ) {
      try {
        presenceSubscription = await subscribeUserPresence(
          { baseUrl: instance.serverBaseUrl, token: instance.token },
          { contacts: monitorJids },
        );
      } catch (error) {
        console.warn("[bot-instance-settings] Failed to subscribe online presence targets", {
          userId: user.id,
          instanceId: instance.id,
          monitorCount: monitorJids.length,
          error,
        });
        presenceSubscription = { error: "presence_subscription_failed" };
      }
    }

    const storage = await getStorageSummaryForUser(user);
    return NextResponse.json({
      message: "Configurações atualizadas com sucesso.",
      settings: updated,
      presenceSubscription,
      storage,
    });
  } catch (error) {
    console.error("Failed to update instance settings", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as configurações da instância." },
      { status: 500 },
    );
  }
}
