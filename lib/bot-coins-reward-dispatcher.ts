import { getDb } from "lib/db";
import { getGroupSettings } from "lib/bot-group-settings";
import { adjustMemberCoins } from "lib/bot-coins";
import {
  getGroupRankingPeriodLeaders,
  type GroupRankingPeriod,
} from "lib/group-ranking";
import {
  convertTimezoneLocalToUtc,
  describeDateInTimezone,
  formatMonthKey,
  formatWeekKey,
  resolveTimezonePreference,
} from "lib/timezones";
import { sendTextMessage, type WuzapiClient } from "lib/wuzapi";
import { ensureBotGroupCoinRewardsTable } from "lib/db";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";

const DISPATCH_INTERVAL_MS = 60 * 60 * 1000; // 1h

const runtime = globalThis as typeof globalThis & {
  __botCoinsRewardDispatcherStarted?: boolean;
};

let dispatcherStarted = runtime.__botCoinsRewardDispatcherStarted ?? false;
let cycleRunning = false;

type RewardRow = {
  group_id: number;
  user_id: number;
  instance_id: number;
  remote_id: string | null;
  base_url: string | null;
  token: string | null;
  session_status: string | null;
  owner_timezone: string | null;
  owner_whatsapp: string | null;
};

const formatMentionHandle = (jid: string): string => `@${jid.replace(/\D+/g, "")}`;

const getPreviousPeriodKey = (period: GroupRankingPeriod, now: Date, timezone: string): string => {
  if (period === "weekly") {
    const prev = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return formatWeekKey(prev, timezone);
  }
  const parts = describeDateInTimezone(now, timezone);
  let year = parts.year;
  let month = parts.month - 1;
  if (month < 1) {
    year -= 1;
    month = 12;
  }
  const sample = convertTimezoneLocalToUtc(timezone, {
    year,
    month,
    day: 15,
    hour: 12,
    minute: 0,
    second: 0,
  });
  return formatMonthKey(sample, timezone);
};

const hasRewardForPeriod = async (groupId: number, period: GroupRankingPeriod, periodKey: string) => {
  await ensureBotGroupCoinRewardsTable();
  const db = getDb();
  const [rows] = await db.query<{ id: number }[]>(
    `
      SELECT id
      FROM bot_group_coin_rewards
      WHERE group_id = ? AND period_type = ? AND period_key = ?
      LIMIT 1
    `,
    [groupId, period, periodKey],
  );
  return Array.isArray(rows) && rows.length > 0;
};

const markRewarded = async (
  groupId: number,
  period: GroupRankingPeriod,
  periodKey: string,
  winners: number,
  totalAwarded: number,
) => {
  await ensureBotGroupCoinRewardsTable();
  const db = getDb();
  await db.query(
    `
      INSERT IGNORE INTO bot_group_coin_rewards (group_id, period_type, period_key, winners, total_awarded)
      VALUES (?, ?, ?, ?, ?)
    `,
    [groupId, period, periodKey, winners, totalAwarded],
  );
};

const buildRewardMessage = (
  period: GroupRankingPeriod,
  periodKey: string,
  currencyName: string,
  amount: number,
  leaders: { memberJid: string; score: number }[],
) => {
  const title = period === "weekly" ? "🏆 *Ranking semanal de mensagens*" : "🏆 *Ranking mensal de mensagens*";
  const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  const lines = leaders.map((entry, index) => {
    const medal = medals[index] ?? `${index + 1}º`;
    const handle = formatMentionHandle(entry.memberJid);
    const msgLabel = entry.score === 1 ? "mensagem" : "mensagens";
    return `${medal} ${handle} — ${entry.score} ${msgLabel} • +${amount} ${currencyName}`;
  });
  const totalAwarded = leaders.length * amount;
  return [
    title,
    `📅 Período: ${periodKey}`,
    "",
    ...lines,
    "",
    `✅ Total distribuído: ${totalAwarded} ${currencyName}`,
  ].join("\n");
};

const rewardPeriod = async (row: RewardRow, period: GroupRankingPeriod) => {
  const guard = await resolveBotAutomationGuard({
    userId: row.user_id,
    instanceId: row.instance_id,
    groupId: row.group_id,
  });
  if (guard.blocked) return;

  const settings = await getGroupSettings(row.group_id);
  const botCoins = settings.botCoins;
  if (!botCoins?.enabled) return;
  if (botCoins.monetizationOnly) return;

  const rewardConfig = period === "weekly" ? botCoins.rewards.weekly : botCoins.rewards.monthly;
  if (!rewardConfig?.enabled) return;

  const amount = Math.max(0, Number(rewardConfig.amount ?? 0));
  const top = Math.max(1, Number(rewardConfig.top ?? 10));
  const minMessages = Math.max(0, Number(rewardConfig.minMessages ?? 0));
  if (amount <= 0) return;

  const timezone = resolveTimezonePreference({
    preferred: [settings.scheduleConfig?.timezone, settings.horapgConfig?.timezone],
    ownerTimezone: row.owner_timezone,
    ownerWhatsapp: row.owner_whatsapp,
  });

  const now = new Date();
  const periodKey = getPreviousPeriodKey(period, now, timezone);

  if (await hasRewardForPeriod(row.group_id, period, periodKey)) return;

  const leaders = (await getGroupRankingPeriodLeaders(row.group_id, period, periodKey, top))
    .filter((entry) => entry.score >= minMessages);

  if (leaders.length === 0) {
    await markRewarded(row.group_id, period, periodKey, 0, 0);
    return;
  }

  for (const leader of leaders) {
    await adjustMemberCoins({
      groupId: row.group_id,
      memberJid: leader.memberJid,
      delta: amount,
      reason: period === "weekly" ? "weekly_reward" : "monthly_reward",
    });
  }

  await markRewarded(row.group_id, period, periodKey, leaders.length, leaders.length * amount);

  if (rewardConfig.announce && row.remote_id && row.base_url && row.token && row.session_status === "conectado") {
    const client: WuzapiClient = { baseUrl: row.base_url, token: row.token };
    const mentions = leaders.map((entry) => entry.memberJid).filter(Boolean);
    const message = buildRewardMessage(period, periodKey, botCoins.currencyName || "BotCoins", amount, leaders);
    await sendTextMessage(client, {
      to: row.remote_id,
      body: message,
      mentions,
    }).catch((error) => {
      console.error("[bot-coins-rewards] falha ao enviar aviso", { groupId: row.group_id, error });
    });
  }
};

const runRewardCycle = async () => {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const db = getDb();
    const [rows] = await db.query<RewardRow[]>(
      `
        SELECT
          g.id AS group_id,
          g.user_id,
          g.instance_id,
          g.remote_id,
          i.base_url,
          i.token,
          i.session_status,
          u.timezone AS owner_timezone,
          u.whatsapp_number AS owner_whatsapp
        FROM bot_groups g
        JOIN bot_instances i ON i.id = g.instance_id
        JOIN users u ON u.id = g.user_id
        WHERE g.status = 'active'
      `,
    );

    for (const row of rows) {
      if (!row.group_id) continue;
      try {
        await rewardPeriod(row, "weekly");
        await rewardPeriod(row, "monthly");
      } catch (error) {
        console.error("[bot-coins-rewards] falha ao processar grupo", { groupId: row.group_id, error });
      }
    }
  } catch (error) {
    console.error("[bot-coins-rewards] ciclo falhou", { error });
  } finally {
    cycleRunning = false;
  }
};

export const startBotCoinsRewardDispatcher = () => {
  if (dispatcherStarted) return;
  dispatcherStarted = true;
  runtime.__botCoinsRewardDispatcherStarted = true;
  runRewardCycle().catch((error) => {
    console.error("[bot-coins-rewards] falha no ciclo inicial", { error });
  });
  setInterval(() => {
    void runRewardCycle();
  }, DISPATCH_INTERVAL_MS);
};
