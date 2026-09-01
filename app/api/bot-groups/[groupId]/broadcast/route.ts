import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import { getInstanceSettings } from "lib/bot-instance-settings";
import {
  parseBroadcastTemplate,
  upsertGroupSettings,
} from "lib/bot-group-settings";
import {
  sendInteractiveButtons,
  sendMediaMessage,
  sendTextMessage,
  type WuzapiClient,
} from "lib/wuzapi";
import { resolveMediaReference } from "lib/bot-groups/media";
import type {
  BotGroupBroadcastTemplate,
  BotGroupCtaButton,
  BotGroupParticipant,
  BotGroupWelcomeReplyButton,
} from "types/bot-groups";

const normalizeMentionJid = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("@")) {
    const local = trimmed.split("@")[0] ?? "";
    const digits = local.replace(/\D+/g, "");
    return digits ? `${digits}@s.whatsapp.net` : null;
  }
  const digits = trimmed.replace(/\D+/g, "");
  if (!digits) {
    return null;
  }
  return `${digits}@s.whatsapp.net`;
};

const buildMentionList = (
  template: BotGroupBroadcastTemplate,
  participants?: BotGroupParticipant[],
): string[] => {
  const set = new Set<string>();
  if (Array.isArray(template.mentionList)) {
    for (const entry of template.mentionList) {
      const jid = normalizeMentionJid(entry);
      if (jid) {
        set.add(jid);
      }
    }
  }
  if (template.mentionAll && Array.isArray(participants)) {
    for (const participant of participants) {
      const jid = normalizeMentionJid(participant.id);
      if (jid) {
        set.add(jid);
      }
    }
  }
  return Array.from(set);
};

const buildWuzapiClient = (
  next: Awaited<ReturnType<typeof getInstanceForUser>>,
): WuzapiClient => ({
  baseUrl: next?.serverBaseUrl.replace(/\/+$/, "") ?? "",
  token: next?.token ?? "",
});

const inferHeaderMediaType = (
  template: BotGroupBroadcastTemplate,
  headerRef: Awaited<ReturnType<typeof resolveMediaReference>> | null,
): "image" | "video" | "document" => {
  if (headerRef?.mimeType?.startsWith("video/")) {
    return "video";
  }
  if (headerRef?.mimeType?.startsWith("application/")) {
    return "document";
  }
  if (template.mediaType === "video") {
    return "video";
  }
  if (template.mediaType === "document") {
    return "document";
  }
  return "image";
};

const mapReplyButton = (
  button: BotGroupWelcomeReplyButton,
): { id: string; text: string; payload: Record<string, unknown> } | null => {
  const id = button.id?.trim();
  const label = button.label?.trim();
  if (!id || !label) {
    return null;
  }
  const command = (button.command ?? button.id ?? "").trim();
  if (!command) {
    return null;
  }
  const args = button.args?.trim() ?? "";
  const payload: Record<string, unknown> = {
    id,
    buttonId: id,
    command,
    buttonCommand: command,
    canonicalCommand: command,
    source: "broadcast_button",
  };
  if (args) {
    payload.commandArgs = args;
    payload.args = args;
    payload.value = args;
  }
  return {
    id,
    text: label,
    payload,
  };
};

const mapCtaButton = (button: BotGroupCtaButton) => {
  const id = button.id?.trim() || button.text?.trim();
  const text = button.text?.trim();
  if (!id || !text) {
    return null;
  }
  const record: {
    id: string;
    text: string;
    type: "cta_url" | "cta_copy" | "cta_call";
    url?: string;
    copyCode?: string;
    phoneNumber?: string;
  } = {
    id,
    text,
    type: button.type,
  };
  if (button.type === "cta_url" && button.url) {
    record.url = button.url;
  }
  if (button.type === "cta_copy" && button.copyCode) {
    record.copyCode = button.copyCode;
  }
  if (button.type === "cta_call" && button.phoneNumber) {
    record.phoneNumber = button.phoneNumber;
  }
  return record;
};

const sanitizeBody = (value: string | null | undefined): string =>
  (value ?? "").replace(/\r\n/g, "\n").trim();

const ensureNativeButtonsAllowed = (
  template: BotGroupBroadcastTemplate,
  nativeButtonsEnabled: boolean,
) => {
  if (!nativeButtonsEnabled && (template.type === "button_reply" || template.type === "button_cta")) {
    throw new Error("Botões nativos estão desativados globalmente.");
  }
};

export async function POST(
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

    const group = await getGroupByIdForUser(user.id, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    if (!group.instanceId) {
      return NextResponse.json(
        { message: "Vincule uma instância antes de enviar mensagens ao grupo." },
        { status: 400 },
      );
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const template = parseBroadcastTemplate(payload);
    if (!template) {
      return NextResponse.json(
        { message: "Informe os campos obrigatórios para o disparo." },
        { status: 400 },
      );
    }

    const instance = await getInstanceForUser(user.id, group.instanceId);
    if (!instance) {
      return NextResponse.json(
        { message: "Instância vinculada não encontrada ou sem acesso." },
        { status: 404 },
      );
    }

    const instanceSettings = await getInstanceSettings(instance.id);
    const nativeButtonsEnabled = instanceSettings?.commandToggles.nativeButtons ?? false;
    try {
      ensureNativeButtonsAllowed(template, nativeButtonsEnabled);
    } catch (error) {
      return NextResponse.json({ message: (error as Error).message }, { status: 400 });
    }

    const client = buildWuzapiClient(instance);
    const to = group.remoteId;
    const normalizedBody = sanitizeBody(template.body);
    const mentionList = buildMentionList(template, group.participants);
    const mentions = mentionList.length > 0 ? mentionList : undefined;

    let messageId: string | null = null;

    const resolveTemplateTitle = (fallback: string): string => {
      const normalized = template.title?.replace(/\r?\n/g, " ").trim() ?? "";
      const candidate = normalized || fallback;
      return candidate.length > 60 ? candidate.slice(0, 60) : candidate;
    };

    if (template.type === "text") {
      if (!normalizedBody) {
        return NextResponse.json(
          { message: "Informe o corpo da mensagem de texto." },
          { status: 400 },
        );
      }
      await sendTextMessage(client, { to, body: normalizedBody, mentions });
    } else if (template.type === "media") {
      const mediaRef = await resolveMediaReference({
        url: template.mediaUrl,
        path: template.mediaPath,
      });
      if (!mediaRef) {
        return NextResponse.json(
          { message: "Envie ou informe uma mídia para este disparo." },
          { status: 400 },
        );
      }
      const mediaType = template.mediaType ?? "image";
      messageId = await sendMediaMessage(client, {
        to,
        media: mediaRef.media,
        mediaType,
        caption: normalizedBody || null,
        filename: mediaRef.fileName ?? null,
        mimeType: mediaRef.mimeType ?? undefined,
        mentions,
      });
    } else if (template.type === "button_reply") {
      const buttons =
        template.buttons
          ?.map((button) => mapReplyButton(button))
          .filter(
            (entry): entry is { id: string; text: string; payload: Record<string, unknown> } =>
              Boolean(entry),
          ) ?? [];
      if (buttons.length === 0) {
        return NextResponse.json(
          { message: "Adicione pelo menos um botão reply válido." },
          { status: 400 },
        );
      }
      const headerRef =
        (template.headerMediaUrl || template.headerMediaPath
          ? await resolveMediaReference({
              url: template.headerMediaUrl,
              path: template.headerMediaPath,
            })
          : await resolveMediaReference({
              url: template.mediaUrl,
              path: template.mediaPath,
            })) ?? null;
      const headerType = inferHeaderMediaType(template, headerRef);

      const defaultBodyLine =
        normalizedBody
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? "";
      const fallbackTitle = defaultBodyLine || group.name || "Mensagem";
      const fallbackTitleText = resolveTemplateTitle(fallbackTitle);
      messageId = await sendInteractiveButtons(client, {
        to,
        title: fallbackTitleText,
        body: normalizedBody || "Selecione uma opção abaixo:",
        footer: template.footer ?? undefined,
        buttons,
        buttonType: "legacy",
        mentions,
        headerMedia: headerRef
          ? {
              type: headerType,
              media: headerRef.media,
              mimeType: headerRef.mimeType ?? undefined,
              fileName: headerRef.fileName ?? undefined,
            }
          : undefined,
      });
    } else if (template.type === "button_cta") {
      const buttons = template.ctaButtons?.map((entry) => mapCtaButton(entry)).filter(Boolean) ?? [];
      if (buttons.length === 0) {
        return NextResponse.json(
          { message: "Adicione pelos menos um botão CTA." },
          { status: 400 },
        );
      }
      const headerRef =
        (template.headerMediaUrl || template.headerMediaPath
          ? await resolveMediaReference({
              url: template.headerMediaUrl,
              path: template.headerMediaPath,
            })
          : await resolveMediaReference({
              url: template.mediaUrl,
              path: template.mediaPath,
            })) ?? null;
      const headerType = inferHeaderMediaType(template, headerRef);
      const defaultBodyLine =
        normalizedBody
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? "";
      const fallbackTitle = defaultBodyLine || group.name || "Escolha uma opção";
      const ctaTitle = resolveTemplateTitle(fallbackTitle);
      messageId = await sendInteractiveButtons(client, {
        to,
        title: ctaTitle,
        body: normalizedBody || "Escolha uma opção:",
        footer: template.footer ?? undefined,
        buttons: buttons.map((button) => ({
          id: button.id,
          text: button.text,
          type: button.type,
          url: button.url,
          copyCode: button.copyCode,
          phoneNumber: button.phoneNumber,
        })),
        buttonType: "native",
        mentions,
        headerMedia: headerRef
          ? {
              type: headerType,
              media: headerRef.media,
              mimeType: headerRef.mimeType ?? undefined,
              fileName: headerRef.fileName ?? undefined,
            }
          : undefined,
      });
    }

    await upsertGroupSettings(group.id, {
      lastBroadcastTemplate: template,
    });

    return NextResponse.json({
      message: "Mensagem enviada com sucesso.",
      messageId,
    });
  } catch (error) {
    console.error("Failed to process broadcast request", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a mensagem agora." },
      { status: 500 },
    );
  }
}
