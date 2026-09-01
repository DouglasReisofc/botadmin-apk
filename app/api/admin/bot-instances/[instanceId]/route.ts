import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { invalidateInstanceByTokenCache } from "lib/bot-events/cache";
import {
  getInstanceById,
  renameInstance,
  transferInstanceToUser,
  deleteInstanceForUser,
  updateInstanceForUser,
} from "lib/bot-instances";
import { SubscriptionPlanError } from "lib/plans";
import { getUserBasicByEmail } from "lib/users";

type AdminInstanceRouteContext = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const resolveInstanceId = async (
  context: AdminInstanceRouteContext,
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

const parseNumeric = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
};

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

export async function GET(
  request: Request,
  context: AdminInstanceRouteContext,
) {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const instance = await getInstanceById(instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ instance });
  } catch (error) {
    console.error("Failed to load bot instance (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a instância." },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: AdminInstanceRouteContext,
) {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const existing = await getInstanceById(instanceId);
    if (!existing) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { name, userId, userEmail } = body as Record<string, unknown>;
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

    let updated = existing;

    if (typeof name === "string" && name.trim() && name.trim() !== existing.name) {
      await renameInstance(existing.userId, instanceId, { name: name.trim() });
      const afterRename = await getInstanceById(instanceId);
      if (afterRename) {
        updated = afterRename;
      }
    }

    if (hasLicenseSalesEnabled && Boolean(licenseSalesEnabled) !== updated.licenseSalesEnabled) {
      updated = await updateInstanceForUser(updated.userId, instanceId, {
        licenseSalesEnabled: Boolean(licenseSalesEnabled),
      });
    }

    let targetUserId: number | null = null;

    if (typeof userEmail === "string" && userEmail.trim()) {
      const lookup = await getUserBasicByEmail(userEmail);
      if (!lookup) {
        return NextResponse.json({ message: "Usuário destino não encontrado para o e-mail informado." }, { status: 404 });
      }
      targetUserId = lookup.id;
    } else if (userId !== undefined) {
      const numericId = parseNumeric(userId);
      if (!Number.isFinite(numericId)) {
        return NextResponse.json({ message: "Usuário alvo inválido." }, { status: 400 });
      }
      targetUserId = numericId;
    }

    if (targetUserId !== null && targetUserId !== updated.userId) {
      updated = await transferInstanceToUser(instanceId, targetUserId);
    }

    invalidateInstanceByTokenCache(existing.token);
    invalidateInstanceByTokenCache(updated.token);

    return NextResponse.json({
      message: "Instância atualizada com sucesso.",
      instance: updated,
    });
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to update bot instance (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a instância." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: AdminInstanceRouteContext,
) {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const instance = await getInstanceById(instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    const result = await deleteInstanceForUser(instance.userId, instanceId);

    return NextResponse.json({
      message:
        "Perfil excluído permanentemente com conversas, histórico e mídias associadas.",
      cleanup: result,
    });
  } catch (error) {
    console.error("Failed to delete bot instance (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível remover a instância." },
      { status: 500 },
    );
  }
}
