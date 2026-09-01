import { NextResponse } from "next/server";
import { getAdminSiteSettings } from "lib/admin-site";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getAdminSiteSettings();
  return NextResponse.json({ settings });
}

