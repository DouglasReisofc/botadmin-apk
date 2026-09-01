const fs = require("fs");
const path = require("path");

const dashboardDir = path.join(__dirname, "..", "public", "dashboard", "user");
const mainFile = path.join(dashboardDir, "main.dart.js");
const bootstrapFile = path.join(dashboardDir, "flutter_bootstrap.js");
const indexFile = path.join(dashboardDir, "index.html");
const serviceWorkerFile = path.join(dashboardDir, "flutter_service_worker.js");
const retainedBuilds = 10;

const writeAtomic = (filePath, contents) => {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, contents);
  fs.renameSync(temporaryPath, filePath);
};

const copyAtomic = (sourcePath, destinationPath) => {
  const temporaryPath = `${destinationPath}.tmp-${process.pid}`;
  fs.copyFileSync(sourcePath, temporaryPath);
  fs.renameSync(temporaryPath, destinationPath);
};

const serviceWorkerKiller = `'use strict';

const clearBotAdminCaches = async () => {
  if (!self.caches || !self.caches.keys) {
    return;
  }

  const names = await self.caches.keys();
  await Promise.all(names.map((name) => self.caches.delete(name)));
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await clearBotAdminCaches();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await clearBotAdminCaches();

    try {
      await self.registration.unregister();
    } catch (error) {
      console.warn('Failed to unregister BotAdmin service worker:', error);
    }
  })());
});

self.addEventListener('fetch', () => {
  // No-op: this worker exists only to remove older Flutter service workers.
});
`;

if (!fs.existsSync(mainFile)) {
  throw new Error(`Arquivo principal do Flutter nao encontrado: ${mainFile}`);
}

if (!fs.existsSync(bootstrapFile)) {
  throw new Error(`Bootstrap do Flutter nao encontrado: ${bootstrapFile}`);
}

const stat = fs.statSync(mainFile);
const version = `v${Math.trunc(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}`;
const versionedName = `main.dart.${version}.js`;
const versionedFile = path.join(dashboardDir, versionedName);
const versionedBootstrapName = `flutter_bootstrap.${version}.js`;
const versionedBootstrapFile = path.join(dashboardDir, versionedBootstrapName);

// Publica primeiro os novos artefatos. Assim, o HTML nunca aponta para um
// arquivo que ainda nao existe, mesmo enquanto o servidor antigo esta ativo.
copyAtomic(mainFile, versionedFile);

let bootstrap = fs.readFileSync(bootstrapFile, "utf8");
bootstrap = bootstrap.replace(
  /"mainJsPath":"main\.dart(?:\.[^"]+)?\.js"/,
  `"mainJsPath":"${versionedName}"`,
);
writeAtomic(versionedBootstrapFile, bootstrap);
writeAtomic(bootstrapFile, bootstrap);

if (fs.existsSync(indexFile)) {
  let index = fs.readFileSync(indexFile, "utf8");
  index = index.replace(/__BOTADMIN_FLUTTER_BOOT_VERSION__/g, version);
  index = index.replace(
    /link\.href = 'main\.dart\.js\?v=' \+ Date\.now\(\);/,
    `link.href = '${versionedName}';`,
  );
  index = index.replace(
    /script\.src\s*=\s*'flutter_bootstrap\.js\?v='\s*\+\s*Date\.now\(\);/,
    `script.src = '${versionedBootstrapName}';`,
  );
  writeAtomic(indexFile, index);
}

writeAtomic(serviceWorkerFile, serviceWorkerKiller);

// Uma aba que iniciou durante a publicacao pode ainda estar buscando a versao
// anterior. Mantemos varias geracoes e so removemos as mais antigas depois que
// a nova geracao esta inteiramente publicada.
const versionedBuilds = fs
  .readdirSync(dashboardDir)
  .filter((entry) => /^main\.dart\.v[a-z0-9-]+\.js$/i.test(entry))
  .map((entry) => ({
    entry,
    mtimeMs: fs.statSync(path.join(dashboardDir, entry)).mtimeMs,
  }))
  .sort((left, right) => right.mtimeMs - left.mtimeMs);

for (const oldBuild of versionedBuilds.slice(retainedBuilds)) {
  const oldVersion = oldBuild.entry.slice("main.dart.".length, -".js".length);
  fs.rmSync(path.join(dashboardDir, oldBuild.entry), { force: true });
  fs.rmSync(path.join(dashboardDir, `flutter_bootstrap.${oldVersion}.js`), {
    force: true,
  });
}

console.log(
  `Flutter assets versionados: ${versionedBootstrapName} -> ${versionedName}`,
);
