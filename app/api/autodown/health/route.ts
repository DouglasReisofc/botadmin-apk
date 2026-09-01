import { NextResponse } from "next/server";

import { getAutoDownStateSnapshot } from "lib/autodown";
import { withUserApiAuth } from "lib/api-rest-auth";

export const runtime = "nodejs";

export const GET = withUserApiAuth(async () => {
  return NextResponse.json({
    status: true,
    código: 200,
    resultado: getAutoDownStateSnapshot(),
  });
});
