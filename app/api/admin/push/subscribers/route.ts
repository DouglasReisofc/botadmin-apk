import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { ensurePushSubscriptionTable, ensureUserTable, getDb } from "lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
  }

  await ensureUserTable();
  await ensurePushSubscriptionTable();
  const db = getDb();

  const [rows] = await db.query<any[]>(
    `
      SELECT u.id, u.name, u.email,
             COUNT(ps.id) AS token_count,
             SUM(CASE WHEN ps.platform = 'android' THEN 1 ELSE 0 END) AS android_tokens,
             SUM(CASE WHEN ps.platform = 'ios' THEN 1 ELSE 0 END) AS ios_tokens,
             SUM(CASE WHEN ps.platform = 'web' THEN 1 ELSE 0 END) AS web_tokens
      FROM users u
      INNER JOIN push_subscriptions ps ON ps.user_id = u.id
      WHERE COALESCE(u.is_active, 0) <> 0
      GROUP BY u.id, u.name, u.email
      ORDER BY u.name ASC
    `,
  );

  // Also return first few tokens per user to allow direct targeting if desired
  const [tokens] = await db.query<any[]>(
    `
      SELECT user_id, token, platform, device_id, last_seen_at
      FROM push_subscriptions
      ORDER BY user_id ASC, updated_at DESC
    `,
  );

  const tokenMap = new Map<number, any[]>();
  for (const t of tokens) {
    if (!tokenMap.has(t.user_id)) tokenMap.set(t.user_id, []);
    const list = tokenMap.get(t.user_id)!;
    if (list.length < 5) list.push(t); // limit details to 5 per user
  }

  const subscribers = rows.map((r) => ({
    id: Number(r.id),
    name: r.name as string,
    email: r.email as string,
    tokenCount: Number(r.token_count || 0),
    platforms: {
      android: Number(r.android_tokens || 0),
      ios: Number(r.ios_tokens || 0),
      web: Number(r.web_tokens || 0),
    },
    tokens: tokenMap.get(Number(r.id)) ?? [],
  }));

  return NextResponse.json({ subscribers });
}
