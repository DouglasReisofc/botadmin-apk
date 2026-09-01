import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  SubscriptionPlanError,
  deleteUserPlanAddon,
  getUserPlanAddons,
  getUserPlanLimits,
  getUserPlanStatus,
  updateUserPlanAddon,
  updateUserPlanAddonSlot,
} from "lib/plans";
import { listGroupsForUser } from "lib/bot-groups";

const parseUserId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseAddonId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseQuantity = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(1, parsed);
    }
  }

  return undefined;
};

const parseSlotNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: RouteParams<{ id: string; addonId: string }> },
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

    const addonId = parseAddonId(resolvedParams.addonId);
    if (!addonId) {
      return NextResponse.json({ message: "Add-on inválido." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      quantity,
      expiresAt,
      autoRenew,
      note,
      slotNumber,
    } = body as {
      quantity?: unknown;
      expiresAt?: unknown;
      autoRenew?: unknown;
      note?: unknown;
      slotNumber?: unknown;
    };

    const updates: {
      quantity?: number;
      expiresAt?: Date | string | null;
      autoRenew?: boolean;
      metadata?: Record<string, unknown> | null;
    } = {};

    const parsedQuantity = parseQuantity(quantity);
    if (parsedQuantity !== undefined) {
      updates.quantity = parsedQuantity;
    }

    if (expiresAt !== undefined) {
      if (expiresAt === null) {
        updates.expiresAt = null;
      } else {
        const parsedExpiration = expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
        if (Number.isNaN(parsedExpiration.getTime())) {
          return NextResponse.json({ message: "Data de expiração inválida." }, { status: 400 });
        }
        updates.expiresAt = parsedExpiration;
      }
    }

    const autoRenewFlag = parseBoolean(autoRenew);
    if (autoRenewFlag !== undefined) {
      updates.autoRenew = autoRenewFlag;
    }

    if (note !== undefined) {
      if (typeof note === "string" && note.trim()) {
        updates.metadata = { note: note.trim(), updatedBy: currentUser.id, updatedAt: new Date().toISOString() };
      } else if (note === null || (typeof note === "string" && !note.trim())) {
        updates.metadata = { note: null, updatedBy: currentUser.id, updatedAt: new Date().toISOString() };
      }
    }

    const parsedSlotNumber = parseSlotNumber(slotNumber);
    const addon = parsedSlotNumber
      ? await updateUserPlanAddonSlot(addonId, parsedSlotNumber, updates, { expectedUserId: userId })
      : await updateUserPlanAddon(addonId, updates, { expectedUserId: userId });

    const [status, addons, limits, groups] = await Promise.all([
      getUserPlanStatus(userId),
      getUserPlanAddons(userId, { includeExpired: true }),
      getUserPlanLimits(userId),
      listGroupsForUser(userId),
    ]);

    return NextResponse.json({
      message: "Add-on atualizado com sucesso.",
      addon,
      status,
      addons,
      limits,
      groups,
    });
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to update user addon", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o add-on." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: RouteParams<{ id: string; addonId: string }> },
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

    const addonId = parseAddonId(resolvedParams.addonId);
    if (!addonId) {
      return NextResponse.json({ message: "Add-on inválido." }, { status: 404 });
    }

    await deleteUserPlanAddon(addonId, { expectedUserId: userId });

    const [status, addons, limits, groups] = await Promise.all([
      getUserPlanStatus(userId),
      getUserPlanAddons(userId, { includeExpired: true }),
      getUserPlanLimits(userId),
      listGroupsForUser(userId),
    ]);

    return NextResponse.json({
      message: "Add-on removido com sucesso.",
      status,
      addons,
      limits,
      groups,
    });
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to delete user addon", error);
    return NextResponse.json(
      { message: "Não foi possível remover o add-on." },
      { status: 500 },
    );
  }
}
