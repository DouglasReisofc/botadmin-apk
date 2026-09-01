import { NextResponse } from 'next/server';
import { DEFAULT_ADMIN_COMMANDS } from 'lib/admin/commands';

export async function GET() {
  return NextResponse.json({ ok: true, commands: DEFAULT_ADMIN_COMMANDS });
}
