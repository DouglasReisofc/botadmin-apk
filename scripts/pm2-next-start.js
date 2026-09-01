const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const cwd = process.cwd();
const nodeBin = process.execPath;
const nextCli = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
const buildIdPath = path.join(cwd, ".next", "BUILD_ID");
const defaultBuildHeap = process.env.PM2_BUILD_HEAP_MB || "1536";

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  if (!fs.existsSync(buildIdPath)) {
    console.log("[pm2-start] Missing Next.js build. Running lightweight webpack build...");
    await run(nodeBin, [nextCli, "build", "--webpack"], {
      cwd,
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS || `--max-old-space-size=${defaultBuildHeap}`,
        NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || "1",
      },
    });
  }

  const port = process.env.PORT || "4478";
  await run(nodeBin, [nextCli, "start", "-p", port], {
    cwd,
    env: process.env,
  });
}

main().catch((error) => {
  console.error("[pm2-start] Failed to start Next.js server.", error);
  process.exit(1);
});
