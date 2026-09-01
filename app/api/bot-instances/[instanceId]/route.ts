import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { invalidateInstanceByTokenCache } from "lib/bot-events/cache";
import {
  BotInstanceError,
  getInstanceForUser,
  renameInstance,
  updateInstanceForUser,
} from "lib/bot-instances";

type InstanceRouteContext = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const parseBooleanInput = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "sim", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "nao", "não", "no", "off"].includes(normalized)) return false;
  }
  return null;
};

const resolveInstanceId = async (
  context: InstanceRouteContext,
  request: Request,
): Promise<number | null> => {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const params = await Promise.resolve(context.params);
  const direct = parse(params?.instanceId);
  if (direct !== null) {
    return direct;
  }

  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const idx = path.lastIndexOf("bot-instances");
    if (idx >= 0 && path[idx + 1]) {
      return parse(path[idx + 1]);
    }
  } catch {
    return null;
  }

  return null;
};

export async function GET(
  request: Request,
  context: InstanceRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const instance = await getInstanceForUser(user.id, instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ instance });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to load bot instance", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a instância." },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: InstanceRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { name, phone } = body as Record<string, unknown>;
    const hasLicenseSalesEnabled =
      Object.prototype.hasOwnProperty.call(body, "licenseSalesEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "license_sales_enabled");
    const licenseSalesEnabled = hasLicenseSalesEnabled
      ? parseBooleanInput(
          (body as Record<string, unknown>).licenseSalesEnabled ??
            (body as Record<string, unknown>).license_sales_enabled,
        )
      : null;
    if (hasLicenseSalesEnabled && licenseSalesEnabled === null) {
      return NextResponse.json(
        { message: "Valor inválido para renovação pelo grupo." },
        { status: 400 },
      );
    }
    if (typeof name !== "string" && typeof phone !== "string" && !hasLicenseSalesEnabled) {
      return NextResponse.json(
        { message: "Informe o novo nome, número ou configuração da instância." },
        { status: 400 },
      );
    }

    const instance =
      typeof phone === "string" || hasLicenseSalesEnabled
        ? await updateInstanceForUser(user.id, instanceId, {
            name: typeof name === "string" ? name : undefined,
            phone: typeof phone === "string" ? phone : undefined,
            licenseSalesEnabled: hasLicenseSalesEnabled ? Boolean(licenseSalesEnabled) : undefined,
          })
        : await renameInstance(user.id, instanceId, { name: name as string });
    invalidateInstanceByTokenCache(instance.token);

    return NextResponse.json({ message: "Instância atualizada.", instance });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to rename bot instance", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a instância." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  _context: InstanceRouteContext,
) {
  return NextResponse.json(
    {
      message:
        "Perfis WhatsApp não podem mais ser excluídos pelo painel. Desconecte o WhatsApp ou edite o perfil para reutilizar.",
    },
    { status: 405 },
  );
}
