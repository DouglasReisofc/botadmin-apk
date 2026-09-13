import "server-only";

import { NextResponse } from "next/server";

import { assertPanelModuleAccess } from "lib/panel-module-access";
import type { PanelModuleScope } from "lib/panel-modules";

type ModuleUser = {
  id: number;
  role?: string | null;
};

export const guardPanelModuleRequest = async (
  user: ModuleUser,
  moduleId: string,
  scope: PanelModuleScope = "user",
): Promise<NextResponse | null> => {
  try {
    await assertPanelModuleAccess({
      userId: user.id,
      scope,
      moduleId,
      isAdmin: user.role === "admin",
    });
    return null;
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    return NextResponse.json(
      {
        message:
          error instanceof Error && error.message
            ? error.message
            : "Módulo indisponível.",
        code: "PANEL_MODULE_UNAVAILABLE",
        module: moduleId,
      },
      { status: status >= 400 && status <= 499 ? status : 403 },
    );
  }
};

export const guardAnyPanelModuleRequest = async (
  user: ModuleUser,
  moduleIds: string[],
  scope: PanelModuleScope = "user",
): Promise<NextResponse | null> => {
  let lastBlocked: NextResponse | null = null;
  for (const moduleId of moduleIds) {
    const blocked = await guardPanelModuleRequest(user, moduleId, scope);
    if (!blocked) return null;
    lastBlocked = blocked;
  }
  return lastBlocked;
};
