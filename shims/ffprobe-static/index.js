const fs = require("node:fs");
const path = require("node:path");

const findOnPath = (binary) => {
  const envPath = process.env.PATH || "";
  const segments = envPath.split(path.delimiter).filter(Boolean);
  for (const dir of segments) {
    const fullPath = path.join(dir, binary);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
};

const pickBinary = (envVarName, binaryName, fallbacks) => {
  const explicit = process.env[envVarName];
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  for (const candidate of fallbacks) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return findOnPath(binaryName) || binaryName;
};

const resolved = pickBinary("FFPROBE_PATH", "ffprobe", [
  "/usr/bin/ffprobe",
  "/usr/local/bin/ffprobe",
  "/snap/bin/ffprobe",
]);

module.exports = { path: resolved };
