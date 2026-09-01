import { NextResponse } from "next/server";

import { getPlanTrialSettings } from "lib/plan-trial-settings";

export const dynamic = "force-dynamic";

const trialDurationLabel = (amount: number, unit: string): string => {
  const safeAmount = Math.max(1, Math.floor(Number(amount) || 1));
  const normalizedUnit = unit === "days" ? "days" : "hours";
  if (normalizedUnit === "days") {
    return `${safeAmount} dia${safeAmount === 1 ? "" : "s"}`;
  }
  return `${safeAmount} hora${safeAmount === 1 ? "" : "s"}`;
};

export async function GET() {
  try {
    const settings = await getPlanTrialSettings();
    return NextResponse.json({
      enabled: settings.enabled,
      duration: settings.duration,
      durationLabel: trialDurationLabel(settings.duration.amount, settings.duration.unit),
      modal: {
        title: settings.modal.title,
        message: settings.modal.message,
        imageUrl: settings.modal.imageUrl,
      },
    });
  } catch (error) {
    console.error("Failed to load public trial settings", error);
    return NextResponse.json(
      {
        enabled: false,
        duration: null,
        durationLabel: null,
      },
      { status: 200 },
    );
  }
}
