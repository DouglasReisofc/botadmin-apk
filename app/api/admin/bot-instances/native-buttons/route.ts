import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  setNativeButtonsForAllInstances,
  summarizeNativeButtonsToggle,
} from "lib/bot-instance-settings";

const ensureAdmin = async () => {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { error: NextResponse.json({ message: "Acesso restrito." }, { status: 403 }) };
  }
  return { user };
};

export async function GET() {
  try {
    const { error } = await ensureAdmin();
    if (error) return error;

    const summary = await summarizeNativeButtonsToggle();
    return NextResponse.json({ summary });
  } catch (err) {
    console.error("Failed to summarize native buttons (admin)", err);
    return NextResponse.json(
      { message: "Não foi possível carregar o status global dos botões." },
      { status: 500 },
    );
  }
}

const normalizeBooleanInput = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value !== 0;
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["1", "true", "on", "sim", "yes"].includes(normalized)) return true;
    if (["0", "false", "off", "nao", "não", "no"].includes(normalized)) return false;
  }
  return undefined;
};

export async function POST(request: Request) {
  try {
    const { error } = await ensureAdmin();
    if (error) return error;

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const enabledValue = normalizeBooleanInput((payload as Record<string, unknown>).enabled);
    if (enabledValue === undefined) {
      return NextResponse.json({ message: "Informe o estado desejado (enabled: true/false)." }, { status: 400 });
    }

    const result = await setNativeButtonsForAllInstances(enabledValue);
    const summary = await summarizeNativeButtonsToggle();

    return NextResponse.json({
      message: enabledValue
        ? "Botões nativos ativados para todas as instâncias."
        : "Botões nativos desativados para todas as instâncias.",
      result,
      summary,
    });
  } catch (err) {
    console.error("Failed to toggle native buttons globally (admin)", err);
    return NextResponse.json(
      { message: "Não foi possível atualizar os botões nativos globalmente." },
      { status: 500 },
    );
  }
}
