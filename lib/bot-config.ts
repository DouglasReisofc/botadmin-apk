import { ResultSetHeader } from "mysql2";

import type { BotMenuConfig } from "types/bot";

import {
  defaultAddBalanceReplyText,
  defaultCategoryDetailBodyText,
  defaultCategoryDetailButtonText,
  defaultCategoryDetailFileCaption,
  defaultCategoryDetailFooterText,
  defaultCategoryListBodyText,
  defaultCategoryListButtonText,
  defaultCategoryListEmptyText,
  defaultCategoryListFooterMoreText,
  defaultCategoryListFooterText,
  defaultCategoryListHeaderText,
  defaultCategoryListNextDescription,
  defaultCategoryListNextTitle,
  defaultCategoryListSectionTitle,
  defaultMenuButtonLabels,
  defaultMenuFooterText,
  defaultMenuText,
  defaultMenuVariables,
  defaultProfileMenuBodyText,
  defaultProfileMenuButtonLabels,
  defaultProfileMenuFooterText,
  defaultProfilePurchasesBodyText,
  defaultProfilePurchasesButtonText,
  defaultProfilePurchasesEmptyText,
  defaultProfilePurchasesFooterText,
  defaultProfilePurchasesHeaderText,
  defaultProfileSupportReasonBodyText,
  defaultProfileSupportReasonButtonLabels,
  defaultProfileSupportReasonFooterText,
  defaultSupportReplyText,
} from "./bot-menu";
import { BotMenuConfigRow, ensureBotMenuConfigTable, getDb } from "./db";

const mapRow = (row: BotMenuConfigRow): BotMenuConfig => {
  let variables: string[] = [];

  if (row.variables) {
    try {
      const parsed = JSON.parse(row.variables) as unknown;
      if (Array.isArray(parsed)) {
        variables = parsed
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value.length > 0);
      }
    } catch (error) {
      console.warn("Failed to parse bot menu variables", error);
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    menuText: row.menu_text,
    menuFooterText: row.menu_footer_text ?? null,
    menuButtonBuyText: row.menu_button_buy ?? "",
    menuButtonAddBalanceText: row.menu_button_add_balance ?? "",
    menuButtonSupportText: row.menu_button_support ?? "",
    menuButtonProfileText:
      row.menu_button_profile
      ?? row.menu_button_support
      ?? defaultMenuButtonLabels.profile,
    categoryListHeaderText: row.category_list_header ?? "",
    categoryListBodyText: row.category_list_body ?? "",
    categoryListFooterText: row.category_list_footer ?? "",
    categoryListFooterMoreText: row.category_list_footer_more ?? "",
    categoryListButtonText: row.category_list_button ?? "",
    categoryListSectionTitle: row.category_list_section ?? "",
    categoryListNextTitle: row.category_list_next_title ?? "",
    categoryListNextDescription: row.category_list_next_description ?? "",
    categoryListEmptyText: row.category_list_empty ?? "",
    categoryDetailBodyText: row.category_detail_body ?? "",
    categoryDetailFooterText: row.category_detail_footer ?? "",
    categoryDetailButtonText: row.category_detail_button ?? "",
    categoryDetailFileCaption: row.category_detail_caption ?? null,
    addBalanceReplyText: row.menu_add_balance_reply ?? "",
    supportReplyText: row.menu_support_reply ?? "",
    profileMenuBodyText: row.profile_menu_body ?? defaultProfileMenuBodyText,
    profileMenuFooterText: row.profile_menu_footer ?? null,
    profileButtonPurchasesText:
      row.profile_button_purchases ?? defaultProfileMenuButtonLabels.purchases,
    profileButtonSupportText:
      row.profile_button_support ?? row.menu_button_support ?? defaultProfileMenuButtonLabels.support,
    profileButtonBackText: row.profile_button_back ?? defaultProfileMenuButtonLabels.back,
    profilePurchasesHeaderText:
      row.profile_purchases_header ?? defaultProfilePurchasesHeaderText,
    profilePurchasesBodyText:
      row.profile_purchases_body ?? defaultProfilePurchasesBodyText,
    profilePurchasesFooterText:
      row.profile_purchases_footer ?? defaultProfilePurchasesFooterText,
    profilePurchasesEmptyText:
      row.profile_purchases_empty ?? defaultProfilePurchasesEmptyText,
    profilePurchasesButtonText:
      row.profile_purchases_button ?? defaultProfilePurchasesButtonText,
    profileSupportReasonBodyText:
      row.profile_support_reason_body ?? defaultProfileSupportReasonBodyText,
    profileSupportReasonFooterText: row.profile_support_reason_footer ?? null,
    profileSupportReasonPurchaseText:
      row.profile_support_reason_purchase ?? defaultProfileSupportReasonButtonLabels.purchase,
    profileSupportReasonPaymentText:
      row.profile_support_reason_payment ?? defaultProfileSupportReasonButtonLabels.payment,
    profileSupportReasonOtherText:
      row.profile_support_reason_other ?? defaultProfileSupportReasonButtonLabels.other,
    variables,
    imagePath: row.image_path,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  } satisfies BotMenuConfig;
};

export const getBotMenuConfigForUser = async (
  userId: number,
): Promise<BotMenuConfig | null> => {
  await ensureBotMenuConfigTable();
  const db = getDb();
  const [rows] = await db.query<BotMenuConfigRow[]>(
    `SELECT * FROM bot_menu_configs WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return upsertBotMenuConfig({
      userId,
      menuText: defaultMenuText,
      menuFooterText: defaultMenuFooterText,
      menuButtonBuyText: defaultMenuButtonLabels.buy,
      menuButtonAddBalanceText: defaultMenuButtonLabels.addBalance,
      menuButtonSupportText: defaultMenuButtonLabels.support,
      menuButtonProfileText: defaultMenuButtonLabels.profile,
      categoryListHeaderText: defaultCategoryListHeaderText,
      categoryListBodyText: defaultCategoryListBodyText,
      categoryListFooterText: defaultCategoryListFooterText,
      categoryListFooterMoreText: defaultCategoryListFooterMoreText,
      categoryListButtonText: defaultCategoryListButtonText,
      categoryListSectionTitle: defaultCategoryListSectionTitle,
      categoryListNextTitle: defaultCategoryListNextTitle,
      categoryListNextDescription: defaultCategoryListNextDescription,
      categoryListEmptyText: defaultCategoryListEmptyText,
      categoryDetailBodyText: defaultCategoryDetailBodyText,
      categoryDetailFooterText: defaultCategoryDetailFooterText,
      categoryDetailButtonText: defaultCategoryDetailButtonText,
      categoryDetailFileCaption: defaultCategoryDetailFileCaption,
      addBalanceReplyText: defaultAddBalanceReplyText,
      supportReplyText: defaultSupportReplyText,
      profileMenuBodyText: defaultProfileMenuBodyText,
      profileMenuFooterText: defaultProfileMenuFooterText,
      profileButtonPurchasesText: defaultProfileMenuButtonLabels.purchases,
      profileButtonSupportText: defaultProfileMenuButtonLabels.support,
      profileButtonBackText: defaultProfileMenuButtonLabels.back,
      profilePurchasesHeaderText: defaultProfilePurchasesHeaderText,
      profilePurchasesBodyText: defaultProfilePurchasesBodyText,
      profilePurchasesFooterText: defaultProfilePurchasesFooterText,
      profilePurchasesEmptyText: defaultProfilePurchasesEmptyText,
      profilePurchasesButtonText: defaultProfilePurchasesButtonText,
      profileSupportReasonBodyText: defaultProfileSupportReasonBodyText,
      profileSupportReasonFooterText: defaultProfileSupportReasonFooterText,
      profileSupportReasonPurchaseText: defaultProfileSupportReasonButtonLabels.purchase,
      profileSupportReasonPaymentText: defaultProfileSupportReasonButtonLabels.payment,
      profileSupportReasonOtherText: defaultProfileSupportReasonButtonLabels.other,
      variables: Array.from(defaultMenuVariables),
      imagePath: null,
    });
  }

  return mapRow(rows[0]);
};

export const upsertBotMenuConfig = async (payload: {
  userId: number;
  menuText: string;
  menuFooterText: string | null;
  menuButtonBuyText: string;
  menuButtonAddBalanceText: string;
  menuButtonSupportText: string;
  menuButtonProfileText: string;
  categoryListHeaderText: string;
  categoryListBodyText: string;
  categoryListFooterText: string;
  categoryListFooterMoreText: string;
  categoryListButtonText: string;
  categoryListSectionTitle: string;
  categoryListNextTitle: string;
  categoryListNextDescription: string;
  categoryListEmptyText: string;
  categoryDetailBodyText: string;
  categoryDetailFooterText: string;
  categoryDetailButtonText: string;
  categoryDetailFileCaption: string | null;
  addBalanceReplyText: string;
  supportReplyText: string;
  profileMenuBodyText: string;
  profileMenuFooterText: string | null;
  profileButtonPurchasesText: string;
  profileButtonSupportText: string;
  profileButtonBackText: string;
  profilePurchasesHeaderText: string;
  profilePurchasesBodyText: string;
  profilePurchasesFooterText: string;
  profilePurchasesEmptyText: string;
  profilePurchasesButtonText: string;
  profileSupportReasonBodyText: string;
  profileSupportReasonFooterText: string | null;
  profileSupportReasonPurchaseText: string;
  profileSupportReasonPaymentText: string;
  profileSupportReasonOtherText: string;
  variables: string[];
  imagePath: string | null;
}): Promise<BotMenuConfig> => {
  await ensureBotMenuConfigTable();
  const db = getDb();

  const normalizedVariables = payload.variables
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const serializedVariables = JSON.stringify(normalizedVariables);

  const sanitized = {
    menuFooterText:
      payload.menuFooterText === null
        ? null
        : payload.menuFooterText.trim(),
    menuButtonBuyText: payload.menuButtonBuyText.trim(),
    menuButtonAddBalanceText: payload.menuButtonAddBalanceText.trim(),
    menuButtonSupportText: payload.menuButtonSupportText.trim(),
    menuButtonProfileText: payload.menuButtonProfileText.trim(),
    categoryListHeaderText: payload.categoryListHeaderText.trim(),
    categoryListBodyText: payload.categoryListBodyText.trim(),
    categoryListFooterText: payload.categoryListFooterText.trim(),
    categoryListFooterMoreText: payload.categoryListFooterMoreText.trim(),
    categoryListButtonText: payload.categoryListButtonText.trim(),
    categoryListSectionTitle: payload.categoryListSectionTitle.trim(),
    categoryListNextTitle: payload.categoryListNextTitle.trim(),
    categoryListNextDescription: payload.categoryListNextDescription.trim(),
    categoryListEmptyText: payload.categoryListEmptyText.trim(),
    categoryDetailBodyText: payload.categoryDetailBodyText.trim(),
    categoryDetailFooterText: payload.categoryDetailFooterText.trim(),
    categoryDetailButtonText: payload.categoryDetailButtonText.trim(),
    categoryDetailFileCaption:
      payload.categoryDetailFileCaption && payload.categoryDetailFileCaption.trim().length > 0
        ? payload.categoryDetailFileCaption.trim()
        : null,
    addBalanceReplyText: payload.addBalanceReplyText.trim(),
    supportReplyText: payload.supportReplyText.trim(),
    profileMenuBodyText: payload.profileMenuBodyText.trim(),
    profileMenuFooterText:
      payload.profileMenuFooterText === null
        ? null
        : payload.profileMenuFooterText.trim(),
    profileButtonPurchasesText: payload.profileButtonPurchasesText.trim(),
    profileButtonSupportText: payload.profileButtonSupportText.trim(),
    profileButtonBackText: payload.profileButtonBackText.trim(),
    profilePurchasesHeaderText: payload.profilePurchasesHeaderText.trim(),
    profilePurchasesBodyText: payload.profilePurchasesBodyText.trim(),
    profilePurchasesFooterText: payload.profilePurchasesFooterText.trim(),
    profilePurchasesEmptyText: payload.profilePurchasesEmptyText.trim(),
    profilePurchasesButtonText: payload.profilePurchasesButtonText.trim(),
    profileSupportReasonBodyText: payload.profileSupportReasonBodyText.trim(),
    profileSupportReasonFooterText:
      payload.profileSupportReasonFooterText === null
        ? null
        : payload.profileSupportReasonFooterText.trim(),
    profileSupportReasonPurchaseText: payload.profileSupportReasonPurchaseText.trim(),
    profileSupportReasonPaymentText: payload.profileSupportReasonPaymentText.trim(),
    profileSupportReasonOtherText: payload.profileSupportReasonOtherText.trim(),
  };

  await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_menu_configs (
        user_id,
        menu_text,
        variables,
        image_path,
        menu_footer_text,
        menu_button_buy,
        menu_button_add_balance,
        menu_button_support,
        menu_button_profile,
        category_list_header,
        category_list_body,
        category_list_footer,
        category_list_footer_more,
        category_list_button,
        category_list_section,
        category_list_next_title,
        category_list_next_description,
        category_list_empty,
        category_detail_body,
        category_detail_footer,
        category_detail_button,
        category_detail_caption,
        menu_add_balance_reply,
        menu_support_reply,
        profile_menu_body,
        profile_menu_footer,
        profile_button_purchases,
        profile_button_support,
        profile_button_back,
        profile_purchases_header,
        profile_purchases_body,
        profile_purchases_footer,
        profile_purchases_empty,
        profile_purchases_button,
        profile_support_reason_body,
        profile_support_reason_footer,
        profile_support_reason_purchase,
        profile_support_reason_payment,
        profile_support_reason_other
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON DUPLICATE KEY UPDATE
        menu_text = VALUES(menu_text),
        variables = VALUES(variables),
        image_path = VALUES(image_path),
        menu_footer_text = VALUES(menu_footer_text),
        menu_button_buy = VALUES(menu_button_buy),
        menu_button_add_balance = VALUES(menu_button_add_balance),
        menu_button_support = VALUES(menu_button_support),
        menu_button_profile = VALUES(menu_button_profile),
        category_list_header = VALUES(category_list_header),
        category_list_body = VALUES(category_list_body),
        category_list_footer = VALUES(category_list_footer),
        category_list_footer_more = VALUES(category_list_footer_more),
        category_list_button = VALUES(category_list_button),
        category_list_section = VALUES(category_list_section),
        category_list_next_title = VALUES(category_list_next_title),
        category_list_next_description = VALUES(category_list_next_description),
        category_list_empty = VALUES(category_list_empty),
        category_detail_body = VALUES(category_detail_body),
        category_detail_footer = VALUES(category_detail_footer),
        category_detail_button = VALUES(category_detail_button),
        category_detail_caption = VALUES(category_detail_caption),
        menu_add_balance_reply = VALUES(menu_add_balance_reply),
        menu_support_reply = VALUES(menu_support_reply),
        profile_menu_body = VALUES(profile_menu_body),
        profile_menu_footer = VALUES(profile_menu_footer),
        profile_button_purchases = VALUES(profile_button_purchases),
        profile_button_support = VALUES(profile_button_support),
        profile_button_back = VALUES(profile_button_back),
        profile_purchases_header = VALUES(profile_purchases_header),
        profile_purchases_body = VALUES(profile_purchases_body),
        profile_purchases_footer = VALUES(profile_purchases_footer),
        profile_purchases_empty = VALUES(profile_purchases_empty),
        profile_purchases_button = VALUES(profile_purchases_button),
        profile_support_reason_body = VALUES(profile_support_reason_body),
        profile_support_reason_footer = VALUES(profile_support_reason_footer),
        profile_support_reason_purchase = VALUES(profile_support_reason_purchase),
        profile_support_reason_payment = VALUES(profile_support_reason_payment),
        profile_support_reason_other = VALUES(profile_support_reason_other)
    `,
    [
      payload.userId,
      payload.menuText.trim(),
      serializedVariables,
      payload.imagePath,
      sanitized.menuFooterText,
      sanitized.menuButtonBuyText,
      sanitized.menuButtonAddBalanceText,
      sanitized.menuButtonSupportText,
      sanitized.menuButtonProfileText,
      sanitized.categoryListHeaderText,
      sanitized.categoryListBodyText,
      sanitized.categoryListFooterText,
      sanitized.categoryListFooterMoreText,
      sanitized.categoryListButtonText,
      sanitized.categoryListSectionTitle,
      sanitized.categoryListNextTitle,
      sanitized.categoryListNextDescription,
      sanitized.categoryListEmptyText,
      sanitized.categoryDetailBodyText,
      sanitized.categoryDetailFooterText,
      sanitized.categoryDetailButtonText,
      sanitized.categoryDetailFileCaption,
      sanitized.addBalanceReplyText,
      sanitized.supportReplyText,
      sanitized.profileMenuBodyText,
      sanitized.profileMenuFooterText,
      sanitized.profileButtonPurchasesText,
      sanitized.profileButtonSupportText,
      sanitized.profileButtonBackText,
      sanitized.profilePurchasesHeaderText,
      sanitized.profilePurchasesBodyText,
      sanitized.profilePurchasesFooterText,
      sanitized.profilePurchasesEmptyText,
      sanitized.profilePurchasesButtonText,
      sanitized.profileSupportReasonBodyText,
      sanitized.profileSupportReasonFooterText,
      sanitized.profileSupportReasonPurchaseText,
      sanitized.profileSupportReasonPaymentText,
      sanitized.profileSupportReasonOtherText,
    ],
  );

  const updated = await getBotMenuConfigForUser(payload.userId);

  if (!updated) {
    throw new Error("Failed to persist bot menu configuration");
  }

  return updated;
};
