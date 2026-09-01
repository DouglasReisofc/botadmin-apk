import { getDb, ensureUserPlanSubscriptionTable, ensureBotGroupTable } from "lib/db";
import { refreshBasePlanGroupLicensesForUser } from "lib/bot-groups";
import { getUserPlanStatus, isUserProfilePlanActive } from "lib/plans";

const main = async () => {
  await ensureUserPlanSubscriptionTable();
  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<Array<{ user_id: number }>>(
    `SELECT user_id FROM user_plan_subscriptions WHERE status = 'active'`,
  );

  let refreshedUsers = 0;
  let refreshedGroups = 0;

  for (const row of rows) {
    const userId = Number(row.user_id);
    if (!Number.isFinite(userId) || userId <= 0) continue;
    const status = await getUserPlanStatus(userId);
    if (!isUserProfilePlanActive(status)) continue;
    const changed = await refreshBasePlanGroupLicensesForUser(userId);
    refreshedUsers += 1;
    refreshedGroups += changed;
  }

  console.log(
    JSON.stringify({
      ok: true,
      refreshedUsers,
      refreshedGroups,
    }),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});