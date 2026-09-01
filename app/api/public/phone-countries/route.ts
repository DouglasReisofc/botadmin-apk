import { NextResponse } from "next/server";

import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES } from "lib/phone-countries";

export async function GET() {
  return NextResponse.json({
    defaultIso2: DEFAULT_PHONE_COUNTRY.iso2,
    countries: PHONE_COUNTRIES,
  });
}
