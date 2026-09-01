import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  SubscriptionPlanError,
  createUserPlanAddon,
  getUserPlanAddons,
  getUserPlanLimits,
  getUserPlanStatus,
} from "lib/plans";
import { listGroupsForUser } from "lib/bot-groups";

const parseUserId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseQuantity = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(1, parsed);
    }
  }
  return null;
};

const parseBoolean = (value: unknown): boolean | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return undefined;
};

type RouteParams<T> = T | Promise<T>;

export async function POST(
  request: NextRequest,
  { params }: { params: RouteParams<{ id: string }> },
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const resolvedParams = await Promise.resolve(params);
    const userId = parseUserId(resolvedParams.id);
    if (!userId) {
      return NextResponse.json({ message: "Usuário inválido." }, { status: 404 });
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      type,
      quantity,
      expiresAt,
      autoRenew,
      note,
    } = payload as {
      type: unknown;
      quantity: unknown;
      expiresAt?: unknown;
      autoRenew?: unknown;
      note?: unknown;
    };

    if (type !== "instance") {
      return NextResponse.json({ message: "Apenas add-ons de instância estão disponíveis." }, { status: 400 });
    }

    const parsedQuantity = parseQuantity(quantity);
    if (!parsedQuantity) {
      return NextResponse.json({ message: "Quantidade inválida." }, { status: 400 });
    }

    const autoRenewFlag = parseBoolean(autoRenew) ?? false;

    const status = await getUserPlanStatus(userId);

    let expirationDate: Date | null = null;
    if (expiresAt) {
      const parsedExpiration = expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
      if (Number.isNaN(parsedExpiration.getTime())) {
        return NextResponse.json({ message: "Data de expiração inválida." }, { status: 400 });
      }
      expirationDate = parsedExpiration;
    } else if (status.currentPeriodEnd) {
      const inferred = new Date(status.currentPeriodEnd);
      if (!Number.isNaN(inferred.getTime())) {
        expirationDate = inferred;
      }
    }

    const metadata: Record<string, unknown> = {
      source: "manual_admin",
      grantedBy: currentUser.id,
      grantedAt: new Date().toISOString(),
    };
    if (typeof note === "string" && note.trim()) {
      metadata.note = note.trim();
    }

    let addon = null;
    for (let index = 0; index < parsedQuantity; index += 1) {
      const createdAddon = await createUserPlanAddon(userId, {
        type,
        quantity: 1,
        subscriptionId: status.subscriptionId ?? undefined,
        expiresAt: expirationDate ?? undefined,
        autoRenew: autoRenewFlag,
        metadata: {
          ...metadata,
          quantity: 1,
          requestedQuantity: parsedQuantity,
          unitIndex: index + 1,
        },
      });
      if (!addon) {
        addon = createdAddon;
      }
    }

    const [addons, limits, groups] = await Promise.all([
      getUserPlanAddons(userId, { includeExpired: true }),
      getUserPlanLimits(userId),
      listGroupsForUser(userId),
    ]);

    return NextResponse.json(
      {
        message: "Add-on registrado com sucesso.",
        addon,
        addons,
        limits,
        groups,
        status,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to create manual user addon", error);
    return NextResponse.json(
      { message: "Não foi possível registrar o add-on." },
      { status: 500 },
    );
  }
}
