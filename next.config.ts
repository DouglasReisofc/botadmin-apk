import type { NextConfig } from "next";
import webpack from "webpack";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const normalizedBasePath = rawBasePath && rawBasePath !== "/"
  ? (rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`)
  : "";

const nextConfig: NextConfig = {
  // Allows production to compile the next release beside the currently
  // running one and swap it atomically after a successful build.
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  reactStrictMode: true,
  basePath: normalizedBasePath || undefined,
  assetPrefix: normalizedBasePath ? `${normalizedBasePath}/` : undefined,
  turbopack: {},
  experimental: {
    inlineCss: true,
  },
  async headers() {
    const immutableAssetCache = "public, max-age=31536000, immutable";
    const noStore = "no-store, no-cache, max-age=0, must-revalidate";
    return [
      {
        source: "/dashboard/user",
        headers: [{ key: "Cache-Control", value: noStore }],
      },
      {
        source: "/dashboard/react/assets/:path*",
        headers: [{ key: "Cache-Control", value: immutableAssetCache }],
      },
      {
        source: "/dashboard/user/index.html",
        headers: [{ key: "Cache-Control", value: noStore }],
      },
      {
        source: "/dashboard/user/flutter_bootstrap.js",
        headers: [{ key: "Cache-Control", value: noStore }],
      },
      {
        source: "/dashboard/user/flutter_service_worker.js",
        headers: [
          { key: "Cache-Control", value: noStore },
          { key: "Service-Worker-Allowed", value: "/dashboard/user/" },
        ],
      },
      {
        source: "/dashboard/user/main.dart.js",
        headers: [{ key: "Cache-Control", value: noStore }],
      },
      {
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: immutableAssetCache }],
      },
      {
        source: "/sounds/:path*",
        headers: [{ key: "Cache-Control", value: immutableAssetCache }],
      },
      {
        source: "/uploads/:path*",
        headers: [{ key: "Cache-Control", value: immutableAssetCache }],
      },
      {
        source: "/animations/:path*",
        headers: [{ key: "Cache-Control", value: immutableAssetCache }],
      },
    ];
  },
  async redirects() {
    return [
      // React is now served by the authenticated /dashboard/user route. Keep
      // the generated asset directory private to the bundle while redirecting
      // the old technical HTML entry so no user-facing URL contains /react.
      { source: "/dashboard/react", destination: "/dashboard/user", permanent: false },
      { source: "/dashboard/react/", destination: "/dashboard/user", permanent: false },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: normalizedBasePath,
  },
  sassOptions: {
    quietDeps: true,
    silenceDeprecations: ["import", "global-builtin", "color-functions", "if-function"],
  },
  outputFileTracingExcludes: {
    "*": ["**/node_modules/.bin/**"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // BullMQ probes this optional Valkey client through a guarded require.
      // Ignore it when the optional package is not installed so production
      // builds stay clean while the normal ioredis transport remains intact.
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^@valkey\/valkey-glide$/,
        }),
      );
      const heavyNativePackages = [
        "sharp",
        "wa-sticker-formatter",
        "fluent-ffmpeg",
        "ffmpeg-static",
      ];

      if (!config.externals) {
        config.externals = [...heavyNativePackages];
      } else if (Array.isArray(config.externals)) {
        for (const pkg of heavyNativePackages) {
          if (!config.externals.includes(pkg)) {
            config.externals.push(pkg);
          }
        }
      } else {
        config.externals = [config.externals, ...heavyNativePackages];
      }
    }
    return config;
  },
};

export default nextConfig;
