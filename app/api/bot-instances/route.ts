import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  createInstanceForUser,
  getAdminSystemInstanceForUser,
  getInstanceForUser,
  isInstanceProfileLicenseActive,
  listInstancesForUser,
} from "lib/bot-instances";
import { SubscriptionPlanError } from "lib/plans";

const listVisibleInstancesForUser = async (
  user: { id: number; role: string },
  options?: Parameters<typeof listInstancesForUser>[1],
) => {
  const [profileInstances, adminSystemInstance] = await Promise.all([
    listInstancesForUser(user.id, options),
    user.role === "admin" ? getAdminSystemInstanceForUser(user.id) : Promise.resolve(null),
  ]);
  if (!adminSystemInstance) {
    return profileInstances;
  }
  return [
    adminSystemInstance,
    ...profileInstances.filter((instance) => instance.id !== adminSystemInstance.id),
  ];
};

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const refreshStatusValue = new URL(request.url).searchParams.get("refreshStatus");
    const refreshStatus = refreshStatusValue !== "0" && refreshStatusValue !== "false";
    const instances = await listVisibleInstancesForUser(user, {
      refreshStatus,
      refreshConcurrency: 6,
    });
    return NextResponse.json({ instances });
  } catch (error) {
    console.error("Failed to list bot instances", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as instâncias." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { serverId, phone, name } = body as Record<string, unknown>;
    const instance = await createInstanceForUser(
      user.id,
      {
      serverId: Number(serverId),
      phone: typeof phone === "string" || typeof phone === "number" ? (phone as string | number).toString() : "",
      name: typeof name === "string" ? name : undefined,
      },
      { allowLimitOverflow: true, bypassPlan: user.role === "admin" },
    );

    const refreshedInstance = await getInstanceForUser(user.id, instance.id);
    const instanceForResponse = refreshedInstance ?? instance;
    const hasProfileLicense = isInstanceProfileLicenseActive(instanceForResponse.expiresAt);
    const requiresInstanceAddonPayment =
      user.role !== "admin" && !hasProfileLicense;

    return NextResponse.json(
      {
        message: "Perfil criado com sucesso.",
        instance: instanceForResponse,
        requiresInstanceAddonPayment,
        requiresProfilePayment: requiresInstanceAddonPayment,
        profileSlotApplied: !requiresInstanceAddonPayment && hasProfileLicense,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BotInstanceError || error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }
    console.error("Failed to create bot instance", error);
    return NextResponse.json(
      { message: "Não foi possível criar o perfil." },
      { status: 500 },
    );
  }
}
