import { NextRequest } from "next/server";
import { renderMetaOnboardingFrame } from "../onboarding-frame";

export function GET(request: NextRequest) {
  return renderMetaOnboardingFrame(request);
}
