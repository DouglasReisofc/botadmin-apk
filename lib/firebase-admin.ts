import { App, cert, getApps, initializeApp, ServiceAccount } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminFirebaseSettings } from "./admin-firebase";

let firebaseApp: App | null = null;

const resolveCredentials = (): ServiceAccount => {
  const envProjectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const envClientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const envPrivateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (envProjectId && envClientEmail && envPrivateKeyRaw) {
    return {
      projectId: envProjectId,
      clientEmail: envClientEmail,
      privateKey: envPrivateKeyRaw.replace(/\\n/g, "\n"),
    };
  }

  // Fallback: DB settings (admin panel)
  // Note: this function is sync by contract; we use deopt by throwing if not ready
  // and instruct callers to set envs in early boot or ensure DB settings are present.
  // Since we are in Next.js runtime, DB is available in server routes when first used.
  // We use deasync pattern by accessing cached promise via globalThis if populated.
  // Simpler: read synchronously via Atomics not available; instead, throw an explicit error to guide ops.
  // In practice, Firebase Admin is only initialized inside API routes after DB is reachable,
  // so requiring envs here keeps behavior predictable if DB config isn't set yet.
  throw new Error(
    "Firebase Admin credentials not found in env. Configure via painel (Admin > Firebase) or set FIREBASE_* envs.",
  );
};

export const getFirebaseAdminApp = (): App => {
  if (firebaseApp) {
    return firebaseApp;
  }

  const existing = getApps();
  if (existing.length > 0) {
    firebaseApp = existing[0]!;
    return firebaseApp;
  }

  firebaseApp = initializeApp({
    credential: cert(resolveCredentials()),
  });

  return firebaseApp;
};

export const getFirebaseMessaging = () => getMessaging(getFirebaseAdminApp());

export const getFirebaseMessagingAsync = async () => {
  try {
    return getMessaging(getFirebaseAdminApp());
  } catch (e) {
    // Try DB-backed initialization
    const settings = await getAdminFirebaseSettings().catch(() => null);
    if (settings && settings.projectId && settings.clientEmail && settings.privateKey) {
      if (!firebaseApp) {
        firebaseApp = initializeApp({
          credential: cert({
            projectId: settings.projectId,
            clientEmail: settings.clientEmail,
            privateKey: settings.privateKey.replace(/\\n/g, "\n"),
          }),
        });
      }
      return getMessaging(firebaseApp);
    }
    throw e;
  }
};
