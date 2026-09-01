import { getDb } from "lib/db";
import { subscribeUserPresence } from "lib/wuzapi";

type PresenceSubscriptionRow = {
  instance_id: number;
  user_id: number;
  server_base_url: string;
  token: string;
  command_toggles: string | Record<string, unknown> | null;
};

const RESUBSCRIBE_INTERVAL_MS = 10 * 60 * 1000;

let started = false;

const parseMonitorContacts = (raw: PresenceSubscriptionRow["command_toggles"]): string[] => {
  const parsed =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : raw && typeof raw === "object"
        ? raw
        : {};

  if (parsed.notifyOnlinePresence !== true) return [];
  const contacts = parsed.onlinePresenceMonitorJids;
  if (!Array.isArray(contacts)) return [];

  return Array.from(
    new Set(
      contacts
        .map((contact) => (typeof contact === "string" ? contact.trim() : ""))
        .filter(Boolean),
    ),
  );
};

const listPresenceSubscriptions = async (): Promise<
  Array<PresenceSubscriptionRow & { contacts: string[] }>
> => {
  const db = getDb();
  const [rows] = await db.query<PresenceSubscriptionRow[]>(
    `
      SELECT bi.id AS instance_id
        , bi.user_id
        , bs.base_url AS server_base_url
        , bi.token
        , bis.command_toggles
      FROM bot_instance_settings bis
      JOIN bot_instances bi ON bi.id = bis.instance_id
      JOIN bot_servers bs ON bs.id = bi.server_id
      WHERE bi.session_status = 'conectado'
        AND CAST(bis.command_toggles AS TEXT) LIKE ?
    `,
    ["%onlinePresenceMonitorJids%"],
  );

  return rows
    .map((row) => ({ ...row, contacts: parseMonitorContacts(row.command_toggles) }))
    .filter((row) => row.contacts.length > 0);
};

const resubscribeOnlinePresenceMonitors = async () => {
  try {
    const rows = await listPresenceSubscriptions();
    for (const row of rows) {
      try {
        await subscribeUserPresence(
          { baseUrl: row.server_base_url, token: row.token },
          { contacts: row.contacts },
        );
        console.info("[online-presence] subscribed monitor contacts", {
          userId: row.user_id,
          instanceId: row.instance_id,
          count: row.contacts.length,
        });
      } catch (error) {
        console.warn("[online-presence] failed to subscribe monitor contacts", {
          userId: row.user_id,
          instanceId: row.instance_id,
          count: row.contacts.length,
          error,
        });
      }
    }
  } catch (error) {
    console.warn("[online-presence] failed to list monitor contacts", { error });
  }
};

export const startOnlinePresenceSubscriptionBootstrap = () => {
  if (started) return;
  started = true;

  const run = () => {
    void resubscribeOnlinePresenceMonitors();
  };

  setTimeout(run, 10_000).unref?.();
  const timer = setInterval(run, RESUBSCRIBE_INTERVAL_MS);
  timer.unref?.();
};
