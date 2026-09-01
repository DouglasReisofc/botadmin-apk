import Head from "next/head";
import type { GetServerSideProps } from "next";

type IconLink = {
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
};

type Props = {
  appName: string;
  themeColor: string;
  icons: IconLink[];
  manifestHref: string;
  maskIconHref: string;
  resources: { label: string; href: string }[];
};

const THEME_COLOR = "#10664f";

const DEFAULT_ICONS: IconLink[] = [
  { rel: "icon", href: "/favicon.ico", sizes: "any" },
  { rel: "shortcut icon", href: "/favicon.ico" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
  { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
  { rel: "icon", href: "/favicon-48x48.png", type: "image/png", sizes: "48x48" },
  { rel: "icon", href: "/android-chrome-96x96.png", type: "image/png", sizes: "96x96" },
  { rel: "icon", href: "/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
  { rel: "icon", href: "/android-chrome-512x512.png", type: "image/png", sizes: "512x512" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
];

const DEFAULT_RESOURCES = [
  { label: "/favicon.ico", href: "/favicon.ico" },
  { label: "/favicon.svg", href: "/favicon.svg" },
  { label: "/favicon-16x16.png", href: "/favicon-16x16.png" },
  { label: "/favicon-32x32.png", href: "/favicon-32x32.png" },
  { label: "/favicon-48x48.png", href: "/favicon-48x48.png" },
  { label: "/android-chrome-96x96.png", href: "/android-chrome-96x96.png" },
  { label: "/android-chrome-192x192.png", href: "/android-chrome-192x192.png" },
  { label: "/android-chrome-512x512.png", href: "/android-chrome-512x512.png" },
  { label: "/apple-touch-icon.png", href: "/apple-touch-icon.png" },
  { label: "/site.webmanifest", href: "/site.webmanifest" },
  { label: "/safari-pinned-tab.svg", href: "/safari-pinned-tab.svg" },
];

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  return {
    props: {
      appName: "Bot Admin",
      themeColor: THEME_COLOR,
      icons: DEFAULT_ICONS,
      manifestHref: "/site.webmanifest",
      maskIconHref: "/safari-pinned-tab.svg",
      resources: DEFAULT_RESOURCES,
    },
  };
};

export default function FaviconCheck({
  appName,
  themeColor,
  icons,
  manifestHref,
  maskIconHref,
  resources,
}: Props) {
  return (
    <>
      <Head>
        <title>Favicon Check</title>
        <meta name="application-name" content={appName} />
        <meta name="apple-mobile-web-app-title" content={appName} />
        <meta name="theme-color" content={themeColor} />
        <meta name="msapplication-TileColor" content={themeColor} />
        {icons.map((icon) => (
          <link key={`${icon.rel}-${icon.href}-${icon.sizes ?? "na"}`} {...icon} />
        ))}
        <link rel="manifest" href={manifestHref} />
        <link rel="mask-icon" href={maskIconHref} color={themeColor} />
      </Head>
      <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1>Favicon Check</h1>
        <p>Esta página inclui links explícitos de favicon e manifest.</p>
        <ul>
          {resources.map((resource) => (
            <li key={resource.href}>
              <a href={resource.href}>{resource.label}</a>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
