// Synchronous head with explicit favicon/manifest links
// Ensures validators that don't run JS (e.g. RFG checker)
// can see icons immediately without relying on async metadata streaming.

const getBasePath = () => {
  const raw = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
  if (!raw || raw === "/") return "";
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const faviconVersion = "botadmin-logo-20260723d";
const versioned = (path: string) => `${path}?v=${faviconVersion}`;

export default function Head() {
  const base = getBasePath();
  return (
    <>
      <meta name="application-name" content="BotAdmin" />
      <meta name="msapplication-TileColor" content="#10664f" />
      {/* Classic/modern favicons */}
      <link rel="icon" href={versioned(`${base}/favicon.ico`)} sizes="any" />
      <link rel="shortcut icon" href={versioned(`${base}/favicon.ico`)} />
      <link rel="icon" type="image/png" sizes="32x32" href={versioned(`${base}/favicon-32x32.png`)} />
      <link rel="icon" type="image/png" sizes="16x16" href={versioned(`${base}/favicon-16x16.png`)} />
      <link rel="icon" type="image/png" sizes="96x96" href={versioned(`${base}/android-chrome-96x96.png`)} />
      <link rel="icon" type="image/png" sizes="192x192" href={versioned(`${base}/android-chrome-192x192.png`)} />
      <link rel="icon" type="image/png" sizes="512x512" href={versioned(`${base}/android-chrome-512x512.png`)} />
      {/* Touch icon */}
      <link rel="apple-touch-icon" sizes="180x180" href={versioned(`${base}/apple-touch-icon.png`)} />
      {/* Web app manifest */}
      <link rel="manifest" href={`${base}/site.webmanifest`} />
      {/* Optional title for web app (used by some validators) */}
      <meta name="apple-mobile-web-app-title" content="BotAdmin" />
    </>
  );
}
