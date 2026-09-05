import sharp from "sharp";

import {
  createGroupForUserFromRemoteId,
  getGroupForInstanceByRemoteId,
  syncGroupInfo,
} from "lib/bot-groups";
import { evaluateBotResalePaymentReadiness } from "lib/bot-resale-payments";
import { sendBotResalePlanSelector } from "lib/bot-resale-menu";
import {
  DEFAULT_COMMAND_PREFIXES,
  getGroupSettings,
} from "lib/bot-group-settings";
import {
  removeGroupParticipant,
  sendMediaMessage,
  sendTextMessage,
  sendStickerMessage,
  sendContactMessage,
  sendInteractiveButtons,
  getUserAvatar,
  type UserAvatarResult,
  type WuzapiClient,
} from "lib/wuzapi";
import { isGroupJid, normalizeJid } from "lib/whatsapp";
import { resolveWelcomeAttachmentMedia } from "lib/bot-groups/media";
import { evaluateBotAutomationGuard } from "lib/bot-automation-guard";
import { getCachedInstanceSettings } from "./cache";
import {
  isOpaqueWhatsappIdentity,
  resolveTrustedPhoneIdentity,
  whatsappPhoneIdentitiesOverlap,
} from "./moderation-identity";
import type { BotEventContext, NormalizedWebhookPayload } from "./types";
import type {
  BotGroupWelcomeAttachment,
  BotGroupWelcomeButtonTemplate,
  BotGroupWelcomeReplyButton,
} from "types/bot-groups";

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const firstString = (...candidates: unknown[]): string | null => {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
};

const decodeDataUrlBuffer = (
  value: string | null | undefined,
): Buffer | null => {
  if (!value) return null;
  const match = /^data:[^;]+;base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  try {
    return Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  } catch {
    return null;
  }
};

const loadAvatarBuffer = async (
  avatar: UserAvatarResult | null,
): Promise<Buffer | null> => {
  if (!avatar) return null;
  const dataUrlBuffer = decodeDataUrlBuffer(avatar.dataUrl);
  if (dataUrlBuffer?.length) return dataUrlBuffer;

  const url = avatar.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !contentType.toLowerCase().startsWith("image/"))
      return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
};

const buildJpegDataUrl = (buffer: Buffer): string =>
  `data:image/jpeg;base64,${buffer.toString("base64")}`;

const buildHighQualityAvatarMedia = async (
  avatar: UserAvatarResult | null,
): Promise<{ dataUrl: string; mimeType: string } | null> => {
  const buffer = await loadAvatarBuffer(avatar);
  if (!buffer?.length) return null;
  try {
    const jpeg = await sharp(buffer, { failOn: "none" })
      .rotate()
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();
    if (!jpeg.length) return null;
    return { dataUrl: buildJpegDataUrl(jpeg), mimeType: "image/jpeg" };
  } catch (error) {
    console.warn("[bot-events] Falha ao converter foto de perfil para JPEG", {
      error,
    });
    return null;
  }
};

const normalizeDigits = (jid: string | null | undefined): string | null => {
  if (!jid) return null;
  const digits = jid.replace(/[^0-9]/g, "");
  return digits || null;
};

const formatMemberLabel = (digits: string): string => {
  const cleaned = digits.replace(/\D+/g, "");
  if (!cleaned) {
    return "👤 usuário";
  }
  const suffix = cleaned.slice(-4);
  return `👤 usuário • ****${suffix.padStart(4, "*")}`;
};

const renderWelcomeCaption = (template: string, vars: Record<string, string>) =>
  template
    .replace(/\{\{\s*pushName\s*\}\}/gi, vars.pushName || "")
    .replace(/\{\{\s*numero\s*\}\}/gi, vars.numero || "")
    .replace(/\{\{\s*nomeGrupo\s*\}\}/gi, vars.nomeGrupo || "")
    .replace(/\{\{\s*data\s*\}\}/gi, vars.data || "")
    .replace(/\{\{\s*hora\s*\}\}/gi, vars.hora || "")
    .replace(
      /\{\{\s*prefixo\s*\}\}/gi,
      vars.prefixo || DEFAULT_COMMAND_PREFIXES[0] || "/",
    );

const isAllowedDdi = (digits: string, allowed: string[]): boolean => {
  const normalizedDigits = digits.replace(/\D/g, "");
  if (!normalizedDigits) {
    return false;
  }
  return allowed.some((ddi) =>
    normalizedDigits.startsWith(ddi.replace(/\D/g, "")),
  );
};

const formatAllowedList = (allowed: string[]): string => {
  if (allowed.length === 0) {
    return "55";
  }
  if (allowed.length === 1) {
    return allowed[0];
  }
  const list = [...allowed];
  const last = list.pop();
  return `${list.join(", ")} e ${last}`;
};

const inferDdiFromDigits = (digits: string): string => {
  const cleaned = digits.replace(/\D/g, "");
  if (cleaned.length > 11) {
    const guess = cleaned.slice(0, cleaned.length - 11);
    if (guess.length >= 1 && guess.length <= 4) {
      return guess;
    }
  }
  return cleaned.slice(0, Math.min(3, cleaned.length)) || cleaned;
};

const renderAntifakeMessage = (
  template: string,
  vars: {
    numero: string;
    ddi: string;
    allowedDdis: string;
    grupo: string;
    prefixo: string;
  },
) =>
  template
    .replace(/\{\{\s*numero\s*\}\}/gi, vars.numero)
    .replace(/\{\{\s*ddi\s*\}\}/gi, vars.ddi)
    .replace(/\{\{\s*allowed_ddis\s*\}\}/gi, vars.allowedDdis)
    .replace(/\{\{\s*allowedList\s*\}\}/gi, vars.allowedDdis)
    .replace(/\{\{\s*grupo\s*\}\}/gi, vars.grupo)
    .replace(/\{\{\s*prefixo\s*\}\}/gi, vars.prefixo);

export const handleGroupEvent = async (
  context: BotEventContext,
  payload: NormalizedWebhookPayload,
) => {
  const raw = toRecord(payload.data);
  const chat = toRecord(raw.chat);
  const groupEvent = toRecord(raw.group);
  const groupJid =
    firstString(
      groupEvent.id,
      groupEvent.jid,
      chat.id,
      chat.jid,
      raw.groupJID,
      raw.GroupJID,
      raw.group,
      raw.groupId,
      raw.id,
      raw.remoteJid,
      raw.chatId,
      raw.jid,
      raw.JID,
    ) || null;
  if (!groupJid) return;
  if (!isGroupJid(groupJid)) return;

  let group = await getGroupForInstanceByRemoteId(
    context.instance.id,
    groupJid,
  );
  if (!group && context.instance.licenseSalesEnabled === true) {
    try {
      group = await createGroupForUserFromRemoteId(context.instance.userId, {
        instanceId: context.instance.id,
        remoteId: groupJid,
      });
    } catch (error) {
      console.warn(
        "[group-handler] Falha ao cadastrar grupo para venda do robô",
        {
          userId: context.instance.userId,
          instanceId: context.instance.id,
          remoteId: groupJid,
          error,
        },
      );
    }
  }
  if (!group) return;

  // Atualizações de dados do grupo vindas do servidor (foto/nome/descrição)
  // Sincroniza o registro no banco imediatamente e finaliza o processamento.
  if (payload.event === "group.picture" || payload.event === "group.update") {
    try {
      await syncGroupInfo(group.userId, group.id);
    } catch (error) {
      console.error(
        "[group-handler] Falha ao sincronizar após evento de grupo",
        {
          groupId: group.id,
          event: payload.event,
          error,
        },
      );
    }
    return;
  }

  if (payload.event === "group.info") {
    try {
      await syncGroupInfo(group.userId, group.id);
    } catch (error) {
      console.error(
        "[group-handler] Falha ao sincronizar após evento group.info",
        {
          groupId: group.id,
          event: payload.event,
          error,
        },
      );
    }
  }
  if (group.status !== "active") return;

  // Detecta participantes adicionados
  const participantsRaw = ((): unknown[] => {
    const candidates = [
      groupEvent.joined,
      groupEvent.added,
      groupEvent.left,
      groupEvent.removed,
      groupEvent.leave,
      groupEvent.leaved,
      raw.participants,
      raw.Participants,
      raw.phones,
      raw.Phone,
      raw.added,
      raw.Added,
      raw.join,
      raw.Join,
      raw.left,
      raw.Left,
      raw.removed,
      raw.Removed,
      raw.leave,
      raw.Leave,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c as unknown[];
      if (c && typeof c === "object")
        return Object.values(c as Record<string, unknown>);
    }
    return [];
  })();

  if (!participantsRaw.length) return;

  if (
    payload.event === "group.joined" &&
    context.instance.licenseSalesEnabled === true
  ) {
    const instanceDigits = normalizeDigits(context.instance.phone);
    const botWasAdded = Boolean(
      instanceDigits &&
      participantsRaw.some((entry) => {
        const rec = toRecord(entry);
        const jid =
          firstString(rec.id, rec.jid, rec.phone, rec.participant) ||
          String(entry || "");
        const digits = normalizeDigits(jid);
        if (!digits) return false;
        return (
          digits === instanceDigits ||
          digits.endsWith(instanceDigits) ||
          instanceDigits.endsWith(digits)
        );
      }),
    );

    if (botWasAdded) {
      try {
        const readiness = await evaluateBotResalePaymentReadiness(
          context.instance.userId,
        );
        if (readiness.ready) {
          const client: WuzapiClient = {
            baseUrl: context.instance.serverBaseUrl,
            token: context.instance.token,
          };
          let nativeButtonsEnabled = false;
          try {
            const instanceSettings = await getCachedInstanceSettings(
              context.instance.id,
            );
            nativeButtonsEnabled =
              instanceSettings?.commandToggles.nativeButtons ?? false;
          } catch {
            // ignore
          }
          const settings = await getGroupSettings(group.id);
          const prefixo =
            settings.commandPrefixes[0] || DEFAULT_COMMAND_PREFIXES[0] || "/";
          await sendBotResalePlanSelector({
            client,
            instance: context.instance,
            group,
            commandPrefix: prefixo,
            nativeButtonsEnabled,
          });
        }
      } catch (error) {
        console.error("[group-handler] Falha ao enviar menu de venda do robô", {
          groupId: group.id,
          instanceId: context.instance.id,
          error,
        });
      }
      return;
    }
  }

  const settings = await getGroupSettings(group.id);
  const antifakeEnabled = settings.featureFlags.antifake ?? false;
  const welcomeEnabled =
    settings.commandToggles.bemvindo || settings.welcomeConfig.enabled;
  const farewellEnabled =
    settings.commandToggles.despedida || settings.farewellConfig.enabled;
  const eventName = String(payload.event || "").toLowerCase();
  const isFarewellEvent =
    /left|leave|removed|remove|participant\.remove|participant\.leave/.test(
      eventName,
    ) ||
    Boolean(
      groupEvent.left ||
      groupEvent.removed ||
      groupEvent.leave ||
      groupEvent.leaved ||
      raw.left ||
      raw.Left ||
      raw.removed ||
      raw.Removed ||
      raw.leave ||
      raw.Leave,
    );
  const isExplicitJoinEvent =
    payload.event === "group.joined" ||
    Boolean(
      groupEvent.joined ||
      groupEvent.added ||
      raw.added ||
      raw.Added ||
      raw.join ||
      raw.Join,
    );
  if (!antifakeEnabled && !welcomeEnabled && !farewellEnabled) {
    return;
  }

  try {
    const violation = await evaluateBotAutomationGuard({
      userId: group.userId,
      instance: context.instance,
      group,
    });
    if (violation) {
      return;
    }
  } catch (error) {
    console.error("[group-handler] Falha ao avaliar bloqueio de automação", {
      userId: group.userId,
      instanceId: context.instance.id,
      groupId: group.id,
      error,
    });
    return;
  }

  // Usa a URL do servidor da instância (serverBaseUrl) para montar o cliente Wuzapi
  const client: WuzapiClient = {
    baseUrl: context.instance.serverBaseUrl,
    token: context.instance.token,
  };
  const allowedDdis =
    settings.allowedDdis.length > 0 ? settings.allowedDdis : ["55"];
  const allowedListText = formatAllowedList(allowedDdis);
  const antifakeTemplate = (settings.antifakeMessage ?? "").trim();
  const now = new Date();
  const dataStr = now.toLocaleDateString("pt-BR");
  const horaStr = now.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const prefixo =
    settings.commandPrefixes[0] || DEFAULT_COMMAND_PREFIXES[0] || "/";

  const blockedDigits: string[] = [];

  let nativeButtonsEnabled = false;
  try {
    const instanceSettings = await getCachedInstanceSettings(
      context.instance.id,
    );
    nativeButtonsEnabled =
      instanceSettings?.commandToggles.nativeButtons ?? false;
  } catch (error) {
    console.error(
      "[bot-events] Falha ao carregar toggles da instância para boas-vindas",
      {
        instanceId: context.instance.id,
        error,
      },
    );
  }

  if (isFarewellEvent) {
    if (!farewellEnabled) {
      return;
    }

    for (const entry of participantsRaw) {
      const rec = toRecord(entry);
      const jid =
        firstString(rec.id, rec.jid, rec.phone, rec.participant) ||
        String(entry || "");
      const digits = normalizeDigits(jid);
      if (!digits) {
        continue;
      }

      const vars = {
        pushName: `@${digits}`,
        numero: digits,
        nomeGrupo: group.name,
        data: dataStr,
        hora: horaStr,
        prefixo,
      };
      const caption = renderWelcomeCaption(
        settings.farewellConfig.caption,
        vars,
      );

      let farewellAttachment: BotGroupWelcomeAttachment | null = null;
      if (settings.farewellConfig.useParticipantProfilePhoto) {
        const rawParticipantJid = typeof jid === "string" ? jid.trim() : "";
        const participantDigits = normalizeJid(rawParticipantJid) || digits;
        const participantJid = rawParticipantJid.includes("@")
          ? rawParticipantJid
          : participantDigits
            ? `${participantDigits}@s.whatsapp.net`
            : "";
        try {
          const avatar = participantJid
            ? await getUserAvatar(client, {
                contact: participantJid,
                preview: false,
              })
            : null;
          const avatarImage = await buildHighQualityAvatarMedia(avatar);
          if (avatarImage?.dataUrl) {
            farewellAttachment = {
              kind: "image",
              url: avatarImage.dataUrl,
              path: null,
              fileName: null,
              mimeType: avatarImage.mimeType,
              caption: null,
            };
          }
        } catch (error) {
          console.warn(
            "[bot-events] Falha ao carregar foto de perfil para saída",
            {
              groupId: group.remoteId,
              participant: digits,
              error,
            },
          );
        }
      }

      if (!farewellAttachment) {
        const mediaUrl = settings.farewellConfig.mediaUrl || undefined;
        const mediaPath = settings.farewellConfig.mediaPath || undefined;
        if (mediaUrl || mediaPath) {
          const ref = (mediaUrl || mediaPath || "").toString();
          const ext = ref.split("?")[0].split(".").pop()?.toLowerCase();
          const kind = (() => {
            if (settings.farewellConfig.asSticker) return "sticker" as const;
            if (
              ext === "mp4" ||
              ext === "mov" ||
              ext === "mkv" ||
              ext === "webm"
            )
              return "video" as const;
            if (
              ext === "mp3" ||
              ext === "ogg" ||
              ext === "m4a" ||
              ext === "opus"
            )
              return "audio" as const;
            if (
              ext === "pdf" ||
              ext === "doc" ||
              ext === "docx" ||
              ext === "xls" ||
              ext === "xlsx"
            )
              return "document" as const;
            return "image" as const;
          })();
          farewellAttachment = {
            kind,
            url: mediaUrl || null,
            path: mediaPath || null,
            fileName: null,
            mimeType: null,
            caption: null,
          };
        }
      }

      try {
        if (farewellAttachment) {
          const resolved =
            await resolveWelcomeAttachmentMedia(farewellAttachment);
          if (resolved) {
            if (farewellAttachment.kind === "sticker") {
              await sendStickerMessage(client, {
                to: group.remoteId,
                sticker: resolved.media,
                mimeType: resolved.mimeType ?? undefined,
              });
              if (caption) {
                await sendTextMessage(client, {
                  to: group.remoteId,
                  body: caption,
                });
              }
              continue;
            }
            const mediaType =
              farewellAttachment.kind === "video" ||
              farewellAttachment.kind === "audio" ||
              farewellAttachment.kind === "document"
                ? farewellAttachment.kind
                : "image";
            await sendMediaMessage(client, {
              to: group.remoteId,
              media: resolved.media,
              mediaType,
              caption: caption || null,
              filename:
                resolved.fileName || farewellAttachment.fileName || null,
              mimeType:
                resolved.mimeType ?? farewellAttachment.mimeType ?? undefined,
            });
            continue;
          }
        }
        if (caption) {
          await sendTextMessage(client, { to: group.remoteId, body: caption });
        }
      } catch (error) {
        console.warn(
          "[bot-events] Falha ao enviar mensagem de saída. Enviando fallback em texto.",
          {
            groupId: group.remoteId,
            participant: digits,
            error,
          },
        );
        if (caption) {
          await sendTextMessage(client, {
            to: group.remoteId,
            body: caption,
          }).catch(() => {});
        }
      }
    }
    return;
  }

  for (const entry of participantsRaw) {
    const rec = toRecord(entry);
    const phoneIdentity = resolveTrustedPhoneIdentity([
      firstString(rec.PhoneNumber, rec.phoneNumber, rec.PN, rec.pn, rec.phone, rec.Phone),
      firstString(rec.jid, rec.JID, rec.participant, rec.Participant, rec.id, rec.Id, rec.LID, rec.lid),
      typeof entry === "string" ? entry : null,
    ]);
    const jid = phoneIdentity?.identifier ||
      firstString(rec.id, rec.jid, rec.LID, rec.lid, rec.participant) ||
      String(entry || "");
    const digits = phoneIdentity?.digits || normalizeDigits(jid);
    if (!digits) {
      continue;
    }

    const roleValue = rec.admin ?? rec.Admin ?? rec.role ?? rec.Role;
    const normalizedRole = String(roleValue ?? "")
      .trim()
      .toLowerCase();
    const hasExplicitRole =
      rec.isAdmin === true ||
      rec.isAdmin === false ||
      rec.IsAdmin === true ||
      rec.IsAdmin === false ||
      rec.isSuperAdmin === true ||
      rec.isSuperAdmin === false ||
      rec.IsSuperAdmin === true ||
      rec.IsSuperAdmin === false ||
      Boolean(normalizedRole);
    const participantIsAdmin =
      rec.isAdmin === true ||
      rec.IsAdmin === true ||
      rec.isSuperAdmin === true ||
      rec.IsSuperAdmin === true ||
      normalizedRole === "admin" ||
      normalizedRole === "superadmin";
    const participantIsInstance = whatsappPhoneIdentitiesOverlap(
      phoneIdentity?.digits,
      context.instance.phone,
    );
    const hasOpaqueIdentityOnly = !phoneIdentity && isOpaqueWhatsappIdentity(jid);
    const canApplyAutomaticRemoval = hasExplicitRole && !participantIsAdmin;
    const canRemoveParticipant =
      canApplyAutomaticRemoval && !participantIsInstance && !hasOpaqueIdentityOnly;
    if (participantIsAdmin || participantIsInstance) {
      console.info(
        "[bot-events] remoção automática ignorada para administrador",
        {
          groupId: group.remoteId,
          participant: digits,
        },
      );
    } else if (!hasExplicitRole || hasOpaqueIdentityOnly) {
      // GroupInfo.Join carries only JIDs. The missing role must block
      // moderation, but it must not block the independent welcome flow.
      console.warn(
        "[bot-events] remoção automática bloqueada: cargo do participante indisponível",
        {
          groupId: group.remoteId,
          participant: digits,
        },
      );
    }

    if (
      canRemoveParticipant &&
      Array.isArray(settings.blacklist) &&
      settings.blacklist.includes(digits)
    ) {
      const participant = normalizeJid(jid) || `${digits}@c.us`;
      try {
        await removeGroupParticipant(client, {
          groupJid: group.remoteId,
          participant,
        });
        await sendTextMessage(client, {
          to: group.remoteId,
          body: `🚫 ${formatMemberLabel(digits)} está na lista de bloqueio e foi removido do grupo.`,
          mentions: [participant],
        }).catch(() => {});
      } catch (error) {
        console.error(
          "[bot-events] Falha ao remover participante pela blacklist",
          {
            groupId: group.remoteId,
            participant,
            error,
          },
        );
      }
      continue;
    }

    if (
      canRemoveParticipant &&
      antifakeEnabled &&
      !isAllowedDdi(digits, allowedDdis)
    ) {
      const participant = normalizeJid(jid) || `${digits}@c.us`;
      if (antifakeTemplate) {
        const notification = renderAntifakeMessage(antifakeTemplate, {
          numero: digits,
          ddi: inferDdiFromDigits(digits),
          allowedDdis: allowedListText,
          grupo: group.name,
          prefixo,
        }).trim();
        if (notification) {
          await sendTextMessage(client, {
            to: group.remoteId,
            body: notification,
            mentions: [participant],
          }).catch(() => {});
        }
      }
      try {
        await removeGroupParticipant(client, {
          groupJid: group.remoteId,
          participant,
        });
        blockedDigits.push(digits);
      } catch (error) {
        console.error(
          "[bot-events] Falha ao remover participante pelo antifake",
          {
            groupId: group.remoteId,
            participant,
            error,
          },
        );
      }
      continue;
    }

    // Generic participant snapshots are not proof of a new member. For
    // role-less payloads, welcome only when the event explicitly says Join.
    if (!welcomeEnabled || (!hasExplicitRole && !isExplicitJoinEvent)) {
      continue;
    }

    const vars = {
      pushName: `@${digits}`,
      numero: digits,
      nomeGrupo: group.name,
      data: dataStr,
      hora: horaStr,
      prefixo,
    };

    const caption = renderWelcomeCaption(settings.welcomeConfig.caption, vars);
    const attachments: BotGroupWelcomeAttachment[] = Array.isArray(
      settings.welcomeConfig.attachments,
    )
      ? (settings.welcomeConfig.attachments as BotGroupWelcomeAttachment[])
      : [];

    const configuredDefaultAttachments: BotGroupWelcomeAttachment[] = (() => {
      const mediaUrl = settings.welcomeConfig.mediaUrl || undefined;
      const mediaPath = settings.welcomeConfig.mediaPath || undefined;
      if (mediaUrl || mediaPath) {
        const ref = (mediaUrl || mediaPath || "").toString();
        const ext = ref.split("?")[0].split(".").pop()?.toLowerCase();
        const guessedKind = (() => {
          if (settings.welcomeConfig.asSticker) return "sticker" as const;
          if (ext === "mp4" || ext === "mov" || ext === "mkv" || ext === "webm")
            return "video" as const;
          if (ext === "mp3" || ext === "ogg" || ext === "m4a" || ext === "opus")
            return "audio" as const;
          if (
            ext === "pdf" ||
            ext === "doc" ||
            ext === "docx" ||
            ext === "xls" ||
            ext === "xlsx"
          )
            return "document" as const;
          return "image" as const;
        })();
        return [
          {
            kind: guessedKind,
            url: mediaUrl || null,
            path: mediaPath || null,
            fileName: null,
            mimeType: null,
            caption: null,
          } satisfies BotGroupWelcomeAttachment,
        ];
      }
      return [];
    })();

    let defaultAttachments = configuredDefaultAttachments;
    if (settings.welcomeConfig.useParticipantProfilePhoto) {
      const rawParticipantJid = typeof jid === "string" ? jid.trim() : "";
      const participantDigits = normalizeJid(rawParticipantJid) || digits;
      const participantJid = rawParticipantJid.includes("@")
        ? rawParticipantJid
        : participantDigits
          ? `${participantDigits}@s.whatsapp.net`
          : "";
      try {
        const avatar = participantJid
          ? await getUserAvatar(client, {
              contact: participantJid,
              preview: false,
            })
          : null;
        const avatarImage = await buildHighQualityAvatarMedia(avatar);
        const avatarMedia = avatarImage?.dataUrl || null;
        if (avatarMedia) {
          defaultAttachments = [
            {
              kind: "image",
              url: avatarMedia,
              path: null,
              fileName: null,
              mimeType: avatarImage.mimeType,
              caption: null,
            },
          ];
        }
      } catch (error) {
        console.warn(
          "[bot-events] Falha ao carregar foto de perfil para boas-vindas",
          {
            groupId: group.remoteId,
            participant: digits,
            error,
          },
        );
      }
    }

    const seenAttachmentRefs = new Set<string>();
    const canonicalWelcomeAttachmentRef = (
      value: string | null | undefined,
    ): string => {
      const rawValue = (value ?? "").trim();
      if (!rawValue) return "";
      try {
        const parsed = new URL(rawValue);
        return parsed.pathname.replace(/^\/+/, "");
      } catch {
        return rawValue.replace(/^\/+/, "");
      }
    };
    const sequence: BotGroupWelcomeAttachment[] = [
      ...defaultAttachments,
      ...attachments,
    ].filter((att) => {
      const pathRef =
        "path" in att ? canonicalWelcomeAttachmentRef(att.path) : "";
      const urlRef = "url" in att ? canonicalWelcomeAttachmentRef(att.url) : "";
      const ref =
        pathRef || urlRef
          ? `media:${pathRef || urlRef}`
          : "vcard" in att
            ? `vcard:${att.name}:${att.vcard}`
            : "";
      if (!ref) {
        return true;
      }
      if (seenAttachmentRefs.has(ref)) {
        return false;
      }
      seenAttachmentRefs.add(ref);
      return true;
    });
    const attachmentsQueue = [...sequence];

    const replyButtonsTemplate: BotGroupWelcomeButtonTemplate | null =
      settings.welcomeConfig.replyButtons &&
      settings.welcomeConfig.replyButtons.enabled &&
      Array.isArray(settings.welcomeConfig.replyButtons.buttons) &&
      settings.welcomeConfig.replyButtons.buttons.length > 0
        ? settings.welcomeConfig.replyButtons
        : null;
    let replyButtonsActive = Boolean(
      nativeButtonsEnabled && replyButtonsTemplate,
    );

    const selectHeaderCandidate = (): {
      attachment: BotGroupWelcomeAttachment;
      index: number;
    } | null => {
      if (!replyButtonsActive) {
        return null;
      }
      const idx = attachmentsQueue.findIndex((att) => {
        if (!att) return false;
        if (!att.path && !att.url) {
          return false;
        }
        return (
          att.kind === "image" ||
          att.kind === "video" ||
          att.kind === "document"
        );
      });
      if (idx === -1) {
        return null;
      }
      const attachment = attachmentsQueue[idx];
      if (!attachment) {
        return null;
      }
      return { attachment, index: idx };
    };

    let reservedHeaderCandidate: {
      attachment: BotGroupWelcomeAttachment;
      index: number;
    } | null = null;
    const reserveHeaderCandidate = () => {
      if (reservedHeaderCandidate) {
        return reservedHeaderCandidate;
      }
      const candidate = selectHeaderCandidate();
      if (!candidate) {
        return null;
      }
      reservedHeaderCandidate = candidate;
      attachmentsQueue.splice(candidate.index, 1);
      return reservedHeaderCandidate;
    };

    const restoreReservedHeaderCandidate = () => {
      if (!reservedHeaderCandidate) {
        return;
      }
      const index = Math.max(
        0,
        Math.min(reservedHeaderCandidate.index, attachmentsQueue.length),
      );
      attachmentsQueue.splice(index, 0, reservedHeaderCandidate.attachment);
      reservedHeaderCandidate = null;
    };

    try {
      const sendWelcomeButtons = async (): Promise<boolean> => {
        if (!replyButtonsActive || !replyButtonsTemplate) {
          return false;
        }
        const renderedBody = caption || "Bem-vindo!";
        const renderedFooter = null;

        const mapButtonPayload = (
          button: BotGroupWelcomeReplyButton,
        ): {
          id: string;
          text: string;
          type?: "quick_reply" | "cta_url" | "cta_call" | "cta_copy";
          url?: string | null;
          phoneNumber?: string | null;
          copyCode?: string | null;
          payload?: Record<string, unknown>;
        } | null => {
          const text = button.label?.trim() || "";
          if (!text) {
            return null;
          }
          const buttonType = button.type ?? "quick_reply";
          const fallbackButtonId =
            button.id?.trim() ||
            `${buttonType}_${text
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .slice(0, 40)}`;
          if (buttonType === "cta_url") {
            const url = button.url
              ? renderWelcomeCaption(button.url, vars).trim()
              : "";
            if (!url) return null;
            return { id: fallbackButtonId, text, type: "cta_url", url };
          }
          if (buttonType === "cta_call") {
            const phoneNumber = button.phoneNumber
              ? renderWelcomeCaption(button.phoneNumber, vars).trim()
              : "";
            if (!phoneNumber) return null;
            return {
              id: fallbackButtonId,
              text,
              type: "cta_call",
              phoneNumber,
            };
          }
          if (buttonType === "cta_copy") {
            const copyCode = button.copyCode
              ? renderWelcomeCaption(button.copyCode, vars).trim()
              : "";
            if (!copyCode) return null;
            return { id: fallbackButtonId, text, type: "cta_copy", copyCode };
          }
          const explicitCommand =
            typeof button.command === "string" ? button.command.trim() : "";
          const labelCommand =
            text.match(/^[!/#$%&.~]?([a-z0-9._-]+)$/i)?.[1] ?? "";
          const idCommand =
            !explicitCommand &&
            !labelCommand &&
            button.id &&
            !/^btn[_-]/i.test(button.id)
              ? button.id.trim()
              : "";
          const rawCommandToken = explicitCommand || labelCommand || idCommand;
          const commandToken = rawCommandToken
            .replace(/^[!/#$%&.~]+/, "")
            .trim();
          if (!commandToken) {
            return null;
          }
          const rawArgs = typeof button.args === "string" ? button.args : "";
          const renderedArgs = rawArgs
            ? renderWelcomeCaption(rawArgs, vars).trim()
            : "";
          const commandButtonId = renderedArgs
            ? `${commandToken}|${encodeURIComponent(renderedArgs)}`
            : commandToken;
          const payload: Record<string, unknown> = {
            id: commandButtonId,
            buttonId: commandButtonId,
            command: commandToken,
            buttonCommand: commandToken,
            canonicalCommand: commandToken,
            source: "welcome_reply_button",
            groupId: group.id,
          };
          if (renderedArgs) {
            payload.commandArgs = renderedArgs;
            payload.args = renderedArgs;
            payload.argument = renderedArgs;
            payload.value = renderedArgs;
          }
          return {
            id: commandButtonId,
            text,
            type: "quick_reply",
            payload,
          };
        };

        const mappedButtons = replyButtonsTemplate.buttons
          .map((btn) => mapButtonPayload(btn))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .slice(0, 3);
        const firstButtonFamily =
          mappedButtons.length > 0
            ? mappedButtons[0].type === "quick_reply" || !mappedButtons[0].type
              ? "reply"
              : "action"
            : null;
        const interactiveButtons = firstButtonFamily
          ? mappedButtons.filter((entry) => {
              const family =
                entry.type === "quick_reply" || !entry.type
                  ? "reply"
                  : "action";
              return family === firstButtonFamily;
            })
          : [];

        if (interactiveButtons.length === 0) {
          replyButtonsActive = false;
          return false;
        } else {
          const headerCandidate = reserveHeaderCandidate();
          const headerAttachment = headerCandidate?.attachment ?? null;
          const resolvedHeaderMedia = headerAttachment
            ? await resolveWelcomeAttachmentMedia(headerAttachment)
            : null;
          const headerMediaType =
            headerAttachment && headerAttachment.kind === "video"
              ? "video"
              : headerAttachment && headerAttachment.kind === "document"
                ? "document"
                : "image";
          try {
            await sendInteractiveButtons(client, {
              to: group.remoteId,
              title: group.name || "Bem-vindo!",
              body: renderedBody,
              footer: renderedFooter ?? undefined,
              buttons: interactiveButtons.map((entry) => ({
                id: entry.id,
                text: entry.text,
                type: entry.type,
                url: entry.url,
                phoneNumber: entry.phoneNumber,
                copyCode: entry.copyCode,
                payload: entry.payload,
              })),
              headerMedia:
                resolvedHeaderMedia && headerAttachment
                  ? {
                      type: headerMediaType,
                      media: resolvedHeaderMedia.media,
                      mimeType: resolvedHeaderMedia.mimeType ?? undefined,
                    }
                  : undefined,
            });
            reservedHeaderCandidate = null;
            return true;
          } catch (error) {
            if (resolvedHeaderMedia && headerAttachment) {
              try {
                await sendInteractiveButtons(client, {
                  to: group.remoteId,
                  title: group.name || "Bem-vindo!",
                  body: renderedBody,
                  footer: renderedFooter ?? undefined,
                  buttons: interactiveButtons.map((entry) => ({
                    id: entry.id,
                    text: entry.text,
                    type: entry.type,
                    url: entry.url,
                    phoneNumber: entry.phoneNumber,
                    copyCode: entry.copyCode,
                    payload: entry.payload,
                  })),
                });
                console.warn(
                  "[bot-events] Botões de boas-vindas enviados sem mídia de cabeçalho",
                  {
                    groupId: group.remoteId,
                    participant: digits,
                    error,
                  },
                );
                reservedHeaderCandidate = null;
                return true;
              } catch (fallbackError) {
                console.warn(
                  "[bot-events] Falha ao reenviar botões de boas-vindas sem mídia",
                  {
                    groupId: group.remoteId,
                    participant: digits,
                    error: fallbackError,
                  },
                );
              }
            }
            console.warn(
              "[bot-events] Falha ao enviar botões de boas-vindas. Aplicando fallback.",
              {
                groupId: group.remoteId,
                participant: digits,
                error,
              },
            );
            restoreReservedHeaderCandidate();
            replyButtonsActive = false;
            return false;
          }
        }
      };

      const buttonsPosition =
        replyButtonsTemplate?.position === "after_attachments"
          ? "after_attachments"
          : "before_attachments";
      if (replyButtonsActive && buttonsPosition === "after_attachments") {
        reserveHeaderCandidate();
      }

      let buttonsSent = false;
      if (replyButtonsActive && buttonsPosition !== "after_attachments") {
        buttonsSent = await sendWelcomeButtons();
      }

      if (attachmentsQueue.length === 0) {
        // Text-only welcome
        if (!buttonsSent && !replyButtonsActive && caption) {
          await sendTextMessage(client, { to: group.remoteId, body: caption });
        }
      } else {
        let welcomeCaptionFallbackSent = false;
        for (let i = 0; i < attachmentsQueue.length; i++) {
          const att = attachmentsQueue[i];
          if (att.kind === "vcard") {
            // Send contact card
            await sendContactMessage(client, {
              to: group.remoteId,
              name: att.name || "Contato",
              vcard: att.vcard,
            });
            continue;
          }

          try {
            const resolved = await resolveWelcomeAttachmentMedia(att);
            if (!resolved) {
              continue;
            }

            const { media, mimeType, fileName } = resolved;

            if (att.kind === "sticker") {
              await sendStickerMessage(client, {
                to: group.remoteId,
                sticker: media,
                mimeType: mimeType ?? undefined,
              });
              // For stickers, caption is not supported; send text separately once.
              continue;
            }

            const mediaType = ((): "image" | "video" | "audio" | "document" => {
              if (
                att.kind === "video" ||
                att.kind === "audio" ||
                att.kind === "document"
              ) {
                return att.kind;
              }
              return "image";
            })();

            const includeCaption =
              !replyButtonsActive &&
              (i === 0 ? caption : att.caption || caption || null);

            await sendMediaMessage(client, {
              to: group.remoteId,
              media,
              mediaType,
              caption: includeCaption || null,
              filename: fileName || att.fileName || null,
              mimeType: mimeType ?? att.mimeType ?? undefined,
            });
          } catch (error) {
            console.warn(
              "[bot-events] Falha ao enviar mídia de boas-vindas. Continuando fluxo.",
              {
                groupId: group.remoteId,
                participant: digits,
                kind: att.kind,
                error,
              },
            );
            const fallbackCaption =
              !buttonsSent && !replyButtonsActive ? caption : null;
            if (fallbackCaption && !welcomeCaptionFallbackSent) {
              welcomeCaptionFallbackSent = true;
              await sendTextMessage(client, {
                to: group.remoteId,
                body: fallbackCaption,
              }).catch(() => {});
            }
          }
        }
        // If first was sticker and we still have a caption to send
        if (
          !buttonsSent &&
          !replyButtonsActive &&
          attachmentsQueue[0]?.kind === "sticker" &&
          caption
        ) {
          await sendTextMessage(client, { to: group.remoteId, body: caption });
        }
      }

      if (replyButtonsActive && buttonsPosition === "after_attachments") {
        buttonsSent = await sendWelcomeButtons();
        if (!buttonsSent && caption) {
          await sendTextMessage(client, { to: group.remoteId, body: caption });
        }
      }
    } catch (error) {
      console.error("[bot-events] Falha ao enviar mensagem de boas-vindas", {
        groupId: group.remoteId,
        participant: digits,
        error,
      });
    }
  }

  if (antifakeEnabled && blockedDigits.length > 0 && !antifakeTemplate) {
    const warning = `🚷 Participantes removidos automaticamente: ${blockedDigits
      .map((d) => `@${d}`)
      .join(", ")}.\nEste grupo aceita apenas DDI(s) ${allowedListText}.`;
    await sendTextMessage(client, {
      to: group.remoteId,
      body: warning,
      mentions: blockedDigits.map((digits) => `${digits}@c.us`),
    }).catch(() => {});
  }
};
