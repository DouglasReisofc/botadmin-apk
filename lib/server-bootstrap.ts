import "./bot-events/debug";
import { ensureAutoDownWebSocketServer } from "./autodown-websocket-server";
import { ensureWhatsappCallMediaWebSocketServer } from "./whatsapp-call-media-websocket-server";
import { ensureWhatsappRealtimeWebSocketServer } from "./whatsapp-realtime-websocket-server";
import { startAdminCampaignDispatcher } from "./admin-campaign-dispatcher";
import { startAdsDispatcher } from "./bot-ads-dispatcher";
import { startBotAdCampaignDispatcher } from "./bot-ad-campaign-dispatcher";
import { startAntiInactivityDispatcher } from "./bot-anti-inactivity-dispatcher";
import { startHorapgDispatcher } from "./bot-horapg-dispatcher";
import { startScheduleDispatcher } from "./bot-group-schedule-dispatcher";
import { startAffiliateMlGroupDispatcher } from "./affiliate-ml-group-dispatcher";
import { startAffiliateMlProductsAutoSyncDispatcher } from "./affiliate-ml-products-auto-sync-dispatcher";
import { startAffiliateShopeeGroupDispatcher } from "./affiliate-shopee-group-dispatcher";
import { startAffiliateShopeeProductsAutoSyncDispatcher } from "./affiliate-shopee-products-auto-sync-dispatcher";
import { startBotAdminAffiliateDispatcher } from "./bot-admin-affiliate-dispatcher";
import { startGroupParticipantImportDispatcher } from "./group-participant-import-jobs";
import { startWhatsappHistoryCleanupDispatcher } from "./whatsapp-history-cleanup-dispatcher";
import { startBroadcastScheduleDispatcher } from "./broadcast-schedule-dispatcher";
import { startOnlinePresenceSubscriptionBootstrap } from "./online-presence-subscriptions";
import { startRedisSingleton } from "./redis";

const runtime = globalThis as typeof globalThis & { __botAdminServerBootstrap?: boolean };
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.NEXT_PHASE === "phase-export";
const disableBackgroundJobs =
  process.env.BOTADMIN_DISABLE_BACKGROUND_JOBS === "1" ||
  process.env.BOTADMIN_LOCAL_PREVIEW === "1";

if (!runtime.__botAdminServerBootstrap && typeof process !== "undefined" && !isBuildPhase) {
  runtime.__botAdminServerBootstrap = true;
  void ensureAutoDownWebSocketServer();
  void ensureWhatsappCallMediaWebSocketServer();
  void ensureWhatsappRealtimeWebSocketServer();
  if (disableBackgroundJobs) {
    console.info("[server-bootstrap] background jobs disabled for local preview");
  } else {
    startRedisSingleton("ads-dispatcher", startAdsDispatcher);
    startRedisSingleton("bot-ad-campaign-dispatcher", startBotAdCampaignDispatcher);
    startRedisSingleton("admin-campaign-dispatcher", startAdminCampaignDispatcher);
    startRedisSingleton("anti-inactivity-dispatcher", startAntiInactivityDispatcher);
    startRedisSingleton("horapg-dispatcher", startHorapgDispatcher);
    startRedisSingleton("schedule-dispatcher", startScheduleDispatcher);
    startRedisSingleton("affiliate-ml-group-dispatcher", startAffiliateMlGroupDispatcher);
    startRedisSingleton("affiliate-ml-products-auto-sync-dispatcher", startAffiliateMlProductsAutoSyncDispatcher);
    startRedisSingleton("affiliate-shopee-group-dispatcher", startAffiliateShopeeGroupDispatcher);
    startRedisSingleton("affiliate-shopee-products-auto-sync-dispatcher", startAffiliateShopeeProductsAutoSyncDispatcher);
    startRedisSingleton("bot-admin-affiliate-dispatcher", startBotAdminAffiliateDispatcher);
    startRedisSingleton("group-participant-import-dispatcher", startGroupParticipantImportDispatcher);
    startRedisSingleton("whatsapp-history-cleanup-dispatcher", startWhatsappHistoryCleanupDispatcher);
    startRedisSingleton("broadcast-schedule-dispatcher", startBroadcastScheduleDispatcher);
    startOnlinePresenceSubscriptionBootstrap();
  }
}
