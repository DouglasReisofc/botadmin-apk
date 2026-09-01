import { formatCurrency } from "lib/format";
import { getAllSubscriptionPlansForUser } from "lib/plans";
import { getBotMenuConfigForUser } from "lib/bot-config";
import { getPlanGuardSettings } from "lib/plan-guard-settings";
import {
  sendInteractiveButtons,
  sendListMessage,
  sendTextMessage,
  DEFAULT_LIST_MESSAGE_TRANSPORT,
  type ListMessageSection,
  type WuzapiClient,
} from "lib/wuzapi";
import type { BotGroup } from "types/bot-groups";
import type { BotInstance } from "types/bot-instances";
import type { SubscriptionPlan } from "types/plans";

const PLAN_GUARD_RENEW_COMMAND = "renovarplano";
const GROUP_LICENSE_DURATION_ORDER = [1, 30, 365] as const;
const DEFAULT_BOTADMIN_MENU_IMAGE_PATH = "uploads/admin/bot/menu-principal-botadmin.png";

const getGroupLicensePlanLabel = (durationDays: number): string => {
  if (durationDays <= 1) return "Diário";
  if (durationDays >= 365) return "Anual";
  return "Mensal";
};

const sortGroupLicensePlans = <T extends { durationDays: number; price: number; name: string }>(
  plans: T[],
): T[] =>
  plans.slice().sort((left, right) => {
    const leftIndex = GROUP_LICENSE_DURATION_ORDER.indexOf(
      left.durationDays as (typeof GROUP_LICENSE_DURATION_ORDER)[number],
    );
    const rightIndex = GROUP_LICENSE_DURATION_ORDER.indexOf(
      right.durationDays as (typeof GROUP_LICENSE_DURATION_ORDER)[number],
    );
    const safeLeft = leftIndex >= 0 ? leftIndex : GROUP_LICENSE_DURATION_ORDER.length;
    const safeRight = rightIndex >= 0 ? rightIndex : GROUP_LICENSE_DURATION_ORDER.length;
    if (safeLeft !== safeRight) return safeLeft - safeRight;
    if (left.price !== right.price) return left.price - right.price;
    return left.name.localeCompare(right.name, "pt-BR");
  });

const fitListText = (value: string, maxLength: number): string => {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const normalizeMenuImagePath = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
};

const resolveBotAdminMenuImagePath = (
  group: Pick<BotGroup, "metadata"> | null | undefined,
  menuConfigImagePath?: string | null,
): string =>
  normalizeMenuImagePath(group?.metadata?.menuBackgroundPath)
  ?? normalizeMenuImagePath(group?.metadata?.menuBackgroundUrl)
  ?? normalizeMenuImagePath(menuConfigImagePath)
  ?? DEFAULT_BOTADMIN_MENU_IMAGE_PATH;

export const resolveBotResaleSelectablePlans = async (
  userId: number,
): Promise<SubscriptionPlan[]> => {
  const allPlans = await getAllSubscriptionPlansForUser(userId).catch(() => []);
  const groupLicensePlans = sortGroupLicensePlans(
    allPlans.filter(
      (plan) =>
        plan.isActive &&
        GROUP_LICENSE_DURATION_ORDER.includes(
          plan.durationDays as (typeof GROUP_LICENSE_DURATION_ORDER)[number],
        ),
    ),
  );
  return groupLicensePlans.length > 0
    ? groupLicensePlans
    : sortGroupLicensePlans(allPlans.filter((plan) => plan.isActive));
};

export const sendBotResalePlanSelector = async ({
  client,
  instance,
  group,
  commandPrefix = "/",
  nativeButtonsEnabled = false,
}: {
  client: WuzapiClient;
  instance: BotInstance;
  group: BotGroup;
  commandPrefix?: string;
  nativeButtonsEnabled?: boolean;
}): Promise<void> => {
  const activeCommandPrefix = commandPrefix.trim() || "/";
  const [selectablePlans, menuConfig, planGuardSettings] = await Promise.all([
    resolveBotResaleSelectablePlans(instance.userId),
    getBotMenuConfigForUser(instance.userId).catch(() => null),
    getPlanGuardSettings().catch(() => null),
  ]);

	  if (selectablePlans.length === 0) {
	    await sendTextMessage(client, {
	      to: group.remoteId,
	      body: "🤖 Este perfil está com renovação ativa, mas ainda não há planos disponíveis. Configure os planos no painel.",
	    });
	    return;
	  }

  const planSelectorImagePath =
    planGuardSettings?.templates.group?.imagePath
    ?? planGuardSettings?.templates.group?.imageUrl
    ?? resolveBotAdminMenuImagePath(group, menuConfig?.imagePath ?? null);

  const planRows: ListMessageSection["rows"] = selectablePlans.slice(0, 3).map((plan) => {
    const planLabel = getGroupLicensePlanLabel(plan.durationDays);
    const command = `${activeCommandPrefix}${PLAN_GUARD_RENEW_COMMAND} plano ${plan.id}`;
    return {
	      title: fitListText(`${planLabel} - ${formatCurrency(plan.price)}`, 60),
	      description: fitListText(
	        `${plan.durationDays} ${plan.durationDays === 1 ? "dia" : "dias"} para o perfil inteiro. Toque para gerar o Pix.`,
	        110,
	      ),
      rowId: command,
      id: command,
      header: fitListText(planLabel, 24),
    };
  });

  const planSections: ListMessageSection[] = [{ title: "Validade", rows: planRows }];
	  const selectorTitle = "𝑹𝑬𝑵𝑶𝑽𝑨ÇÃ𝑶 𝑫𝑶 𝑷𝑬𝑹𝑭𝑰𝑳";
	  const selectorHeading = "𝑹𝑬𝑵𝑶𝑽𝑬 𝑶 𝑷𝑬𝑹𝑭𝑰𝑳";
  const lines = [
    `🤖 ${selectorHeading}`,
    "╭━━ 乂 𝑷𝑰𝑿 乂 ━━╮",
    `┃ 📌 𝑮𝒓𝒖𝒑𝒐: ${group.name || group.remoteId}`,
    `┃ 🤖 𝑷𝒆𝒓𝒇𝒊𝒍: ${instance.name || instance.phone || "Bot"}`,
    "┃ ✅ 𝑳𝒊𝒃𝒆𝒓𝒂çã𝒐 𝒂𝒖𝒕𝒐𝒎á𝒕𝒊𝒄𝒂",
    "╰━━━━━━━━━━━━╯",
    "乂 𝑬𝑺𝑪𝑶𝑳𝑯𝑨 𝑨 𝑽𝑨𝑳𝑰𝑫𝑨𝑫𝑬 乂",
    ...selectablePlans.slice(0, 3).map(
      (plan) => `• ${getGroupLicensePlanLabel(plan.durationDays)} — ${formatCurrency(plan.price)}`,
    ),
  ];

  try {
    await sendListMessage(client, {
      to: group.remoteId,
      title: selectorTitle,
      description: lines.join("\n"),
      buttonText: "Escolher plano",
      footerText: "💎 𝑻𝒐𝒒𝒖𝒆 𝒆 𝒈𝒆𝒓𝒆 𝒐 𝑷𝒊𝒙.",
      sections: planSections,
      cards: [
        {
          title: selectorTitle,
          description: lines.join("\n"),
          footerText: "💎 𝑻𝒐𝒒𝒖𝒆 𝒆 𝒈𝒆𝒓𝒆 𝒐 𝑷𝒊𝒙.",
          buttonText: "Escolher plano",
          lists: [{ buttonText: "Escolher plano", sections: planSections }],
        },
      ],
      transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
    });
    return;
  } catch (error) {
    console.error("[bot-resale] Falha ao enviar seletor de planos", {
      groupId: group.id,
      instanceId: instance.id,
      imagePath: planSelectorImagePath,
      error,
    });
  }

  try {
    await sendInteractiveButtons(client, {
      to: group.remoteId,
      title: selectorTitle,
      body: lines.join("\n"),
      footer: "💎 𝑻𝒐𝒒𝒖𝒆 𝒆 𝒎𝒆𝒏𝒄𝒊𝒐𝒏𝒆 𝒐 𝒃𝒐𝒕 𝒑𝒂𝒓𝒂 𝒄𝒐𝒎𝒑𝒓𝒂𝒓.",
	      buttons: [
	        {
	          id: `${activeCommandPrefix}${PLAN_GUARD_RENEW_COMMAND}`,
	          text: "💎 Renovar perfil",
	          payload: { command: PLAN_GUARD_RENEW_COMMAND },
	        },
      ],
      buttonType: nativeButtonsEnabled ? "native" : "legacy",
    });
    return;
  } catch (error) {
    console.error("[bot-resale] Falha ao enviar botão de compra", {
      groupId: group.id,
      error,
    });
  }

  await sendTextMessage(client, {
    to: group.remoteId,
    body: `${lines.join("\n")}\n\nResponda com ${activeCommandPrefix}${PLAN_GUARD_RENEW_COMMAND} plano ${selectablePlans[0]!.id}`,
  });
};
