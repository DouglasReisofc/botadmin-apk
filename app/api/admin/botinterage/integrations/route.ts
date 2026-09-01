import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";

import { getCurrentUser } from "lib/auth";
import { ensureBotGroupSettingsTable, getDb } from "lib/db";

type IntegrationRow = RowDataPacket & {
  group_id: number;
  group_name: string;
  remote_id: string;
  user_id: number;
  user_name: string;
  user_email: string | null;
  command_flags: unknown;
  feature_flags: unknown;
  ai_provider: string | null;
  groq_keys: string | null;
  openai_api_key: string | null;
  ai_prompt: string | null;
  ai_model: string | null;
  updated_at: Date | string | null;
};

const parseFlags = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const maskSecret = (value: string | null): string | null => {
  const secret = value?.trim();
  if (!secret) return null;
  if (secret.length <= 10) return `${secret.slice(0, 2)}••••`;
  return `${secret.slice(0, 6)}••••${secret.slice(-4)}`;
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    await ensureBotGroupSettingsTable();
    const db = getDb();
    const [rows] = await db.query<IntegrationRow[]>(`
      SELECT
        bgs.group_id,
        bg.name AS group_name,
        bg.remote_id,
        bg.user_id,
        u.name AS user_name,
        u.email AS user_email,
        bgs.command_flags,
        bgs.feature_flags,
        bgs.ai_provider,
        bgs.groq_keys,
        bgs.openai_api_key,
        bgs.ai_prompt,
        bgs.ai_model,
        bgs.updated_at
      FROM bot_group_settings bgs
      INNER JOIN bot_groups bg ON bg.id = bgs.group_id
      INNER JOIN users u ON u.id = bg.user_id
      ORDER BY bgs.updated_at DESC
    `);

    const integrations = rows.flatMap((row) => {
      const flags = parseFlags(row.command_flags);
      const featureFlags = parseFlags(row.feature_flags);
      if (flags.botinterage !== true) return [];
      const provider =
        row.ai_provider === "openai" || row.ai_provider === "chatgpt_system"
          ? row.ai_provider
          : "groq";
      const groqKeys = (row.groq_keys ?? "")
        .split(/[\n,;]+/)
        .map((key) => key.trim())
        .filter(Boolean);
      const maskedKeys =
        provider === "groq"
          ? groqKeys.map((key) => maskSecret(key)).filter(Boolean)
          : provider === "openai"
            ? [maskSecret(row.openai_api_key)].filter(Boolean)
            : [];
      return [{
        id: `${row.user_id}:${row.group_id}`,
        userId: Number(row.user_id),
        userName: row.user_name,
        userEmail: row.user_email,
        groupId: Number(row.group_id),
        groupName: row.group_name,
        remoteId: row.remote_id,
        provider,
        enabled: flags.botinterage === true,
        listenToAudio: flags.ouviraudiobotinterage === true,
        mentionOnly: Object.prototype.hasOwnProperty.call(featureFlags, "botInterageMentionOnly")
          ? featureFlags.botInterageMentionOnly === true
          : featureFlags.iaSomenteMencao === true || featureFlags.iaConversas === false,
        commandToggles: flags,
        featureFlags,
        hasKey: provider === "chatgpt_system" || maskedKeys.length > 0,
        maskedKeys,
        model: row.ai_model?.trim() || (provider === "openai" ? "gpt-4.1-mini" : "auto"),
        prompt: row.ai_prompt?.trim() || null,
        updatedAt:
          row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : row.updated_at
              ? new Date(row.updated_at).toISOString()
              : null,
      }];
    });

    return NextResponse.json({
      integrations,
      totals: {
        active: integrations.length,
        groq: integrations.filter((item) => item.provider === "groq").length,
        openai: integrations.filter((item) => item.provider === "openai").length,
        chatgptSystem: integrations.filter((item) => item.provider === "chatgpt_system").length,
      },
    });
  } catch (error) {
    console.error("Failed to list BotInterage integrations", error);
    return NextResponse.json(
      { message: "Não foi possível listar as ativações do BotInterage." },
      { status: 500 },
    );
  }
}
