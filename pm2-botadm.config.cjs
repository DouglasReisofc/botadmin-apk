const fs = require('fs');
const path = require('path');

function parseDotEnv(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const out = {};
    for (let line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const idx = t.indexOf('=');
      if (idx <= 0) continue;
      const key = t.slice(0, idx).trim();
      let val = t.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      val = val.replace(/\\n/g, '\n').replace(/\r/g, '');
      out[key] = val;
    }
    return out;
  } catch (e) {
    return {};
  }
}

const cwd = '/root/botadmin-local';
const env = parseDotEnv(path.join(cwd, '.env'));
const nodeInterpreter = process.env.PM2_NODE_INTERPRETER || process.execPath;

module.exports = {
  apps: [
    {
      name: 'botadmin-local',
      cwd,
      // Ensure production build exists before starting Next.js.
      script: path.join(cwd, 'scripts', 'pm2-next-start.js'),
      interpreter: nodeInterpreter,
      env: {
        ...env,
        NODE_ENV: env.NODE_ENV || 'production',
        PORT: env.PORT || '4322',
        INTERNAL_APP_URL: env.INTERNAL_APP_URL || env.APP_URL || 'https://botadmin.shop',
        NEXT_TELEMETRY_DISABLED: env.NEXT_TELEMETRY_DISABLED || '1',
      },
      time: true,
      max_memory_restart: '1200M',
      restart_delay: 8000,
      exp_backoff_restart_delay: 200,
      max_restarts: 30,
      out_file: path.join(cwd, 'logs', 'pm2-out.log'),
      error_file: path.join(cwd, 'logs', 'pm2-error.log'),
    },
  ],
};
