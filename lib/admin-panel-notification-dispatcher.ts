import { dispatchAdminPanelNotification, listDueAdminPanelNotifications } from "lib/admin-panel-notifications";

const runtime = globalThis as typeof globalThis & { __adminPanelNotificationDispatcherStarted?: boolean };
let running = false;

export const startAdminPanelNotificationDispatcher = () => {
  if (runtime.__adminPanelNotificationDispatcherStarted) return;
  runtime.__adminPanelNotificationDispatcherStarted = true;
  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      const ids = await listDueAdminPanelNotifications(5);
      await Promise.all(ids.map((id) => dispatchAdminPanelNotification(id).catch((error) => {
        console.error("[AdminPanelNotificationDispatcher] falha", { id, error });
      })));
    } finally {
      running = false;
    }
  };
  void cycle();
  setInterval(() => void cycle(), 15_000);
};
