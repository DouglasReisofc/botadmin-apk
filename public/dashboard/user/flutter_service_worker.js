'use strict';

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
