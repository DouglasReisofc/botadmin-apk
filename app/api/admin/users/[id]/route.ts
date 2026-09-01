import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser, revokeSessionsForUser, revokeSessionsForUserExcept } from "lib/auth";
import { deleteAdminUser, findUserIdByWhatsappDigits, getAdminUserById, updateAdminUser } from "lib/users";
import { listGroupsForUser } from "lib/bot-groups";
import { upsertGroupSettings } from "lib/bot-group-settings";
import { invalidateGroupSettingsCache } from "lib/bot-events/cache";
import { DEFAULT_MENU_TEXTS } from "resources/default-menu-texts";
import type { BotGroupMenuTexts } from "types/bot-groups";

const cloneDefaultMenuTexts = (): BotGroupMenuTexts =>
  JSON.parse(JSON.stringify(DEFAULT_MENU_TEXTS)) as BotGroupMenuTexts;

type RouteParams<T> = T | Promise<T>;

export async function PATCH(
  request: NextRequest,
  { params }: { params: RouteParams<{ id: string }> },
) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json(
        { message: "Acesso não autorizado." },
        { status: 403 },
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const userId = Number.parseInt(resolvedParams.id, 10);

    if (Number.isNaN(userId)) {
      return NextResponse.json(
        { message: "Identificador de usuário inválido." },
        { status: 400 },
      );
    }

    const payload = await request.json().catch(() => ({}));
    const {
      name,
      email,
      role,
      password,
      balance,
      isActive,
      revokeSessions,
      whatsappDialCode,
      whatsappNumber,
      customPlanPrice,
      customAddonInstancePrice,
      customAddonGroupPrice,
      resetMenuTexts,
    } = payload as {
      name?: unknown;
      email?: unknown;
      role?: unknown;
      password?: unknown;
      balance?: unknown;
      isActive?: unknown;
      revokeSessions?: unknown;
      whatsappDialCode?: unknown;
      whatsappNumber?: unknown;
      customPlanPrice?: unknown;
      customAddonInstancePrice?: unknown;
      customAddonGroupPrice?: unknown;
      resetMenuTexts?: unknown;
    };

    const updates: {
      name?: string;
      email?: string;
      role?: "admin" | "user";
      password?: string;
      balance?: number;
      isActive?: boolean;
      whatsappNumber?: string | null;
      customPlanPrice?: number | null;
      customAddonInstancePrice?: number | null;
      customAddonGroupPrice?: number | null;
    } = {};

    if (typeof name === "string") updates.name = name;
    if (typeof email === "string") updates.email = email;
    if (role === "admin" || role === "user") updates.role = role;
    if (typeof password === "string") updates.password = password;

    if (typeof balance === "number" && Number.isFinite(balance) && balance >= 0) {
      updates.balance = balance;
    } else if (typeof balance === "string" && balance.trim().length > 0) {
      const parsed = Number.parseFloat(balance.replace(/,/g, "."));
      if (!Number.isNaN(parsed) && parsed >= 0) {
        updates.balance = parsed;
      }
    }

    if (typeof isActive === "boolean") updates.isActive = isActive;

    const normalizeCustomPrice = (
      value: unknown,
      label: string,
    ): number | null | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        const parsed = Number.parseFloat(trimmed.replace(/,/g, "."));
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`${label} inv�lido.`);
        }
        return Math.round(parsed * 100) / 100;
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`${label} inv�lido.`);
        }
        return Math.round(value * 100) / 100;
      }
      return undefined;
    };

    try {
      const planPriceValue = normalizeCustomPrice(customPlanPrice, "Valor personalizado do plano");
      if (planPriceValue !== undefined) {
        updates.customPlanPrice = planPriceValue;
      }

      const addonInstanceValue = normalizeCustomPrice(
        customAddonInstancePrice,
        "Valor personalizado do add-on de inst�ncia",
      );
      if (addonInstanceValue !== undefined) {
        updates.customAddonInstancePrice = addonInstanceValue;
      }

      const addonGroupValue = normalizeCustomPrice(
        customAddonGroupPrice,
        "Valor personalizado do add-on de grupo",
      );
      if (addonGroupValue !== undefined) {
        updates.customAddonGroupPrice = addonGroupValue;
      }
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Valores personalizados inv�lidos." },
        { status: 400 },
      );
    }

    if (
      (typeof whatsappDialCode === "string" || whatsappDialCode === null) &&
      (typeof whatsappNumber === "string" || whatsappNumber === null)
    ) {
      if (!whatsappDialCode && !whatsappNumber) {
        updates.whatsappNumber = null;
      } else if (typeof whatsappDialCode === "string" && typeof whatsappNumber === "string") {
        const dial = whatsappDialCode.trim();
        const numeric = whatsappNumber.replace(/[^0-9]/g, "");

        if (!dial || !numeric) {
          return NextResponse.json(
            { message: "Informe o DDI e o número do WhatsApp." },
            { status: 400 },
          );
        }

        const dialCode = dial.startsWith("+") ? dial : `+${dial}`;

        if (numeric.length < 8 || numeric.length > 15) {
          return NextResponse.json(
            { message: "Informe um número de WhatsApp válido (DDD + número)." },
            { status: 400 },
          );
        }

        const fullWhatsapp = `${dialCode}${numeric}`;
        if (fullWhatsapp.length > 25) {
          return NextResponse.json(
            { message: "Número de WhatsApp excede o tamanho permitido." },
            { status: 400 },
          );
        }

        const existingOwnerId = await findUserIdByWhatsappDigits(numeric);
        if (existingOwnerId && existingOwnerId !== userId) {
          return NextResponse.json(
            { message: "Este WhatsApp já está vinculado a outro usuário." },
            { status: 400 },
          );
        }

        updates.whatsappNumber = fullWhatsapp;
      }
    }

    const hasUpdates = Object.keys(updates).length > 0;

    const shouldResetMenuTexts = resetMenuTexts === true;

    if (!hasUpdates && revokeSessions !== true && !shouldResetMenuTexts) {
      return NextResponse.json(
        {
          message:
            "Informe os dados que deseja atualizar ou selecione para encerrar as sessões do usuário.",
        },
        { status: 400 },
      );
    }

    let resetMenuCount = 0;
    if (shouldResetMenuTexts) {
      const groups = await listGroupsForUser(userId);
      for (const group of groups) {
        try {
          await upsertGroupSettings(group.id, { menuTexts: cloneDefaultMenuTexts() });
          invalidateGroupSettingsCache(group.id);
          resetMenuCount += 1;
        } catch (error) {
          console.error("Failed to reset menu texts", { userId, groupId: group.id, error });
        }
      }
    }

    if (hasUpdates) {
      await updateAdminUser(userId, updates);
      if (updates.isActive === false) {
        await revokeSessionsForUser(userId);
      }
    }

    if (revokeSessions === true) {
      if (currentUser.id === userId) {
        const cookieStore = await cookies();
        const currentSessionId = cookieStore.get("sb_session")?.value ?? null;
        await revokeSessionsForUserExcept(userId, currentSessionId ?? null);
      } else {
        await revokeSessionsForUser(userId);
      }
    }

    const updatedUser = await getAdminUserById(userId);

    if (!updatedUser) {
      return NextResponse.json(
        { message: "Usuário não encontrado." },
        { status: 404 },
      );
    }

    const summaryParts: string[] = [];
    if (hasUpdates) summaryParts.push("Dados do usuário atualizados.");
    if (revokeSessions === true) summaryParts.push("Sessões encerradas.");
    if (shouldResetMenuTexts) {
      summaryParts.push(
        resetMenuCount > 0
          ? `Menus padrão restaurados em ${resetMenuCount} grupo(s).`
          : "Usuário não possui grupos para atualizar os menus.",
      );
    }

    return NextResponse.json({
      message:
        summaryParts.length > 0 ? summaryParts.join(" ") : "Dados do usuário atualizados com sucesso.",
      user: updatedUser,
      menuResetCount: resetMenuCount,
    });
  } catch (error) {
    console.error("Failed to update user", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o usuário." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: RouteParams<{ id: string }> },
) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso não autorizado." }, { status: 403 });
    }

    const resolvedParams = await Promise.resolve(params);
    const userId = Number.parseInt(resolvedParams.id, 10);

    if (Number.isNaN(userId)) {
      return NextResponse.json({ message: "Identificador de usuário inválido." }, { status: 400 });
    }

    if (userId === currentUser.id) {
      return NextResponse.json({ message: "Você não pode excluir sua própria conta." }, { status: 400 });
    }

    const existing = await getAdminUserById(userId);
    if (!existing) {
      return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    }

    const deleted = await deleteAdminUser(userId);

    if (!deleted) {
      return NextResponse.json({ message: "Não foi possível excluir o usuário." }, { status: 500 });
    }

    return NextResponse.json({ message: "Usuário excluído permanentemente." });
  } catch (error) {
    console.error("Failed to delete user", error);
    return NextResponse.json(
      { message: "Não foi possível excluir o usuário." },
      { status: 500 },
    );
  }
}
