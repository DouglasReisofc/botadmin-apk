import { RowDataPacket } from "mysql2";

import { getDb } from "./db";
import { getFirebasePublicConfig, getFirebaseWebPushConfig } from "./firebase/config";

export type AdminFirebaseSettings = {
  projectId: string | null;
  clientEmail: string | null;
  privateKey: string | null;
  webApiKey: string | null;
  webAuthDomain: string | null;
  webProjectId: string | null;
  webStorageBucket: string | null;
  webMessagingSenderId: string | null;
  webAppId: string | null;
  webMeasurementId: string | null;
  vapidKey: string | null;
};

const mapRow = (row: any): AdminFirebaseSettings => ({
  projectId: row.project_id ?? null,
  clientEmail: row.client_email ?? null,
  privateKey: row.private_key ?? null,
  webApiKey: row.web_api_key ?? null,
  webAuthDomain: row.web_auth_domain ?? null,
  webProjectId: row.web_project_id ?? null,
  webStorageBucket: row.web_storage_bucket ?? null,
  webMessagingSenderId: row.web_messaging_sender_id ?? null,
  webAppId: row.web_app_id ?? null,
  webMeasurementId: row.web_measurement_id ?? null,
  vapidKey: row.vapid_key ?? null,
});

export const getAdminFirebaseSettings = async (): Promise<AdminFirebaseSettings | null> => {
  const db = getDb();
  const [rows] = await db.query<(RowDataPacket & any)[]>(
    `SELECT * FROM admin_firebase_settings LIMIT 1`,
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    // Fallback to environment variables so the Admin UI and internal
    // consumers have sane defaults even before saving in the DB.
    const envProjectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
    const envClientEmail = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
    const envPrivateKey = (process.env.FIREBASE_PRIVATE_KEY || "").trim();

    const web = getFirebasePublicConfig();
    const webPush = getFirebaseWebPushConfig();

    const hasAny = envProjectId || envClientEmail || envPrivateKey || web.apiKey || web.appId;
    if (!hasAny) return null;

    const normalize = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
    return {
      projectId: normalize(envProjectId),
      clientEmail: normalize(envClientEmail),
      privateKey: normalize(envPrivateKey),
      webApiKey: normalize(web.apiKey),
      webAuthDomain: normalize(web.authDomain),
      webProjectId: normalize(web.projectId),
      webStorageBucket: normalize(web.storageBucket),
      webMessagingSenderId: normalize(web.messagingSenderId),
      webAppId: normalize(web.appId),
      webMeasurementId: normalize(web.measurementId),
      vapidKey: normalize(webPush.vapidKey ?? ""),
    };
  }
  return mapRow(rows[0]);
};

export const upsertAdminFirebaseSettings = async (
  payload: Partial<AdminFirebaseSettings>,
): Promise<void> => {
  const db = getDb();
  // Ensure there is always a single row
  await db.query(
    `INSERT INTO admin_firebase_settings (
      id, project_id, client_email, private_key,
      web_api_key, web_auth_domain, web_project_id, web_storage_bucket,
      web_messaging_sender_id, web_app_id, web_measurement_id, vapid_key
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      project_id = VALUES(project_id),
      client_email = VALUES(client_email),
      private_key = VALUES(private_key),
      web_api_key = VALUES(web_api_key),
      web_auth_domain = VALUES(web_auth_domain),
      web_project_id = VALUES(web_project_id),
      web_storage_bucket = VALUES(web_storage_bucket),
      web_messaging_sender_id = VALUES(web_messaging_sender_id),
      web_app_id = VALUES(web_app_id),
      web_measurement_id = VALUES(web_measurement_id),
      vapid_key = VALUES(vapid_key),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      payload.projectId ?? null,
      payload.clientEmail ?? null,
      payload.privateKey ?? null,
      payload.webApiKey ?? null,
      payload.webAuthDomain ?? null,
      payload.webProjectId ?? null,
      payload.webStorageBucket ?? null,
      payload.webMessagingSenderId ?? null,
      payload.webAppId ?? null,
      payload.webMeasurementId ?? null,
      payload.vapidKey ?? null,
    ],
  );
};

