import {
  AdminBotSessionRow,
  ensureAdminBotSessionTable,
  getDb,
} from "./db";

export type AdminBotFlowState =
  | { name: "category_rename_input"; categoryId: number }
  | { name: "category_price_input"; categoryId: number }
  | { name: "category_sku_input"; categoryId: number }
  | { name: "customer_lookup_input"; mode: "edit" }
  | { name: "customer_edit_menu"; customerId: number }
  | { name: "customer_edit_name_input"; customerId: number }
  | { name: "customer_edit_balance_input"; customerId: number }
  | { name: "group_create_input"; instanceId: number }
  | { name: "group_switch_input"; groupId: number }
  | { name: "instance_create_phone_input"; serverId: number }
  | { name: "plan_addon_quantity_input"; addonType: "instance" | "group"; planId: number }
  | { name: "signup_email_input" }
  | { name: "signup_password_input"; mode: "register" | "link"; email: string; userId?: number }
  | { name: "plan_payment_method_pick"; planId: number }
  | { name: "missing_email_input" };

export type AdminBotSession = {
  whatsappId: string;
  whatsappE164: string;
  userId: number;
  flowState: AdminBotFlowState | null;
  createdAt: string;
  lastInteractionAt: string;
};

const mapSessionRow = (row: AdminBotSessionRow): AdminBotSession => ({
  whatsappId: row.whatsapp_id,
  whatsappE164: row.whatsapp_e164,
  userId: row.user_id,
  flowState: (() => {
    const stateName = row.flow_state?.trim();
    if (!stateName) {
      return null;
    }

    try {
      const parsed = row.flow_context ? JSON.parse(row.flow_context) : null;
      if (!parsed || typeof parsed !== "object" || parsed.name !== stateName) {
        return null;
      }

      switch (stateName) {
        case "category_rename_input":
        case "category_price_input":
        case "category_sku_input": {
          const categoryId = Number.parseInt(String(parsed.categoryId ?? parsed.data?.categoryId ?? parsed.category_id ?? parsed.data?.category_id ?? ""), 10);
          if (Number.isFinite(categoryId)) {
            return { name: stateName, categoryId } as AdminBotFlowState;
          }
          return null;
        }
        case "group_create_input": {
          const instanceId = Number.parseInt(String(parsed.instanceId ?? parsed.data?.instanceId ?? parsed.instance_id ?? parsed.data?.instance_id ?? ""), 10);
          if (Number.isFinite(instanceId)) {
            return { name: "group_create_input", instanceId } as AdminBotFlowState;
          }
          return null;
        }
        case "group_switch_input": {
          const groupId = Number.parseInt(String(parsed.groupId ?? parsed.data?.groupId ?? parsed.group_id ?? parsed.data?.group_id ?? ""), 10);
          if (Number.isFinite(groupId)) {
            return { name: "group_switch_input", groupId } as AdminBotFlowState;
          }
          return null;
        }
        case "customer_lookup_input": {
          return { name: "customer_lookup_input", mode: "edit" };
        }
        case "customer_edit_menu":
        case "customer_edit_name_input":
        case "customer_edit_balance_input": {
          const customerId = Number.parseInt(String(parsed.customerId ?? parsed.data?.customerId ?? parsed.customer_id ?? parsed.data?.customer_id ?? ""), 10);
          if (Number.isFinite(customerId)) {
            return { name: stateName, customerId } as AdminBotFlowState;
          }
          return null;
        }
        case "instance_create_phone_input": {
          const serverId = Number.parseInt(String(parsed.serverId ?? parsed.data?.serverId ?? parsed.server_id ?? parsed.data?.server_id ?? ""), 10);
          if (Number.isFinite(serverId)) {
            return { name: "instance_create_phone_input", serverId } as AdminBotFlowState;
          }
          return null;
        }
        case "plan_addon_quantity_input": {
          const addonTypeRaw = String(parsed.addonType ?? parsed.type ?? parsed.data?.addonType ?? "").toLowerCase();
          const planId = Number.parseInt(String(parsed.planId ?? parsed.data?.planId ?? ""), 10);
          if ((addonTypeRaw === "instance" || addonTypeRaw === "group") && Number.isFinite(planId)) {
            return { name: "plan_addon_quantity_input", addonType: addonTypeRaw as "instance" | "group", planId };
          }
          return null;
        }
        case "signup_email_input":
          return { name: "signup_email_input" };
        case "signup_password_input": {
          const m = String(parsed.mode ?? parsed.data?.mode ?? "register");
          const email = String(parsed.email ?? parsed.data?.email ?? "").trim();
          const uidRaw = parsed.userId ?? parsed.data?.userId ?? null;
          const userId = Number.parseInt(String(uidRaw ?? ""), 10);
          if (email) {
            return {
              name: "signup_password_input",
              mode: m === "link" ? "link" : "register",
              email,
              userId: Number.isFinite(userId) ? userId : undefined,
            };
          }
          return null;
        }
        case "plan_payment_method_pick": {
          const planId = Number.parseInt(String(parsed.planId ?? parsed.data?.planId ?? ""), 10);
          if (Number.isFinite(planId)) {
            return { name: "plan_payment_method_pick", planId };
          }
          return null;
        }
        case "missing_email_input":
          return { name: "missing_email_input" };
        default:
          return null;
      }
    } catch (error) {
      console.error("Failed to parse admin bot flow context", error);
      return null;
    }
  })(),
  createdAt: row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString(),
  lastInteractionAt: row.last_interaction_at instanceof Date
    ? row.last_interaction_at.toISOString()
    : new Date(row.last_interaction_at).toISOString(),
});

const sanitizeWhatsappId = (value: string) => value.replace(/[^0-9]/g, "");

export const getAdminBotSession = async (
  whatsappId: string,
): Promise<AdminBotSession | null> => {
  const normalized = sanitizeWhatsappId(whatsappId);
  if (!normalized) {
    return null;
  }

  await ensureAdminBotSessionTable();
  const db = getDb();

  const [rows] = await db.query<AdminBotSessionRow[]>(
    `SELECT * FROM admin_bot_sessions WHERE whatsapp_id = ? LIMIT 1`,
    [normalized],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapSessionRow(rows[0]);
};

export const upsertAdminBotSession = async (
  whatsappId: string,
  userId: number,
): Promise<AdminBotSession> => {
  const normalized = sanitizeWhatsappId(whatsappId);
  if (!normalized) {
    throw new Error("Identificador de WhatsApp inválido.");
  }

  await ensureAdminBotSessionTable();
  const db = getDb();

  await db.query(
    `
      INSERT INTO admin_bot_sessions (whatsapp_id, whatsapp_e164, user_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        whatsapp_e164 = VALUES(whatsapp_e164),
        last_interaction_at = CURRENT_TIMESTAMP
    `,
    [normalized, normalized, userId],
  );

  const [rows] = await db.query<AdminBotSessionRow[]>(
    `SELECT * FROM admin_bot_sessions WHERE whatsapp_id = ? LIMIT 1`,
    [normalized],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Não foi possível criar a sessão do bot administrativo.");
  }

  return mapSessionRow(rows[0]);
};

export const touchAdminBotSession = async (whatsappId: string) => {
  const normalized = sanitizeWhatsappId(whatsappId);
  if (!normalized) {
    return;
  }

  await ensureAdminBotSessionTable();
  const db = getDb();

  await db.query(
    `
      UPDATE admin_bot_sessions
      SET last_interaction_at = CURRENT_TIMESTAMP
      WHERE whatsapp_id = ?
    `,
    [normalized],
  );
};

export const removeAdminBotSession = async (whatsappId: string) => {
  const normalized = sanitizeWhatsappId(whatsappId);
  if (!normalized) {
    return;
  }

  await ensureAdminBotSessionTable();
  const db = getDb();

  await db.query(
    `DELETE FROM admin_bot_sessions WHERE whatsapp_id = ?`,
    [normalized],
  );
};

export const updateAdminBotSessionFlow = async (
  whatsappId: string,
  flow: AdminBotFlowState | null,
) => {
  const normalized = sanitizeWhatsappId(whatsappId);
  if (!normalized) {
    return;
  }

  await ensureAdminBotSessionTable();
  const db = getDb();

  const flowState = flow ? flow.name : null;
  const flowContext = flow ? JSON.stringify(flow) : null;

  await db.query(
    `
      UPDATE admin_bot_sessions
      SET
        flow_state = ?,
        flow_context = ?,
        last_interaction_at = CURRENT_TIMESTAMP
      WHERE whatsapp_id = ?
    `,
    [flowState, flowContext, normalized],
  );
};
