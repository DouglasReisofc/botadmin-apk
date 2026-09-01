/* global Notification */
(function () {
  'use strict';

  function supported() {
    return typeof window !== 'undefined' && typeof window.Notification !== 'undefined';
  }

  function permission() {
    if (!supported()) return 'unsupported';
    try {
      return String(Notification.permission || 'default');
    } catch (_) {
      return 'unsupported';
    }
  }

  function notifyChanged() {
    try {
      window.dispatchEvent(
        new CustomEvent('botadmin-notification-permission', {
          detail: { permission: permission() },
        }),
      );
    } catch (_) {}
  }

  var firebaseScriptsPromise = null;
  var pushRegisterPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        resolve();
        return;
      }
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Falha ao carregar ' + src));
      };
      document.head.appendChild(script);
    });
  }

  function loadFirebaseScripts() {
    if (firebaseScriptsPromise) return firebaseScriptsPromise;
    firebaseScriptsPromise = Promise.all([
      loadScript('https://www.gstatic.com/firebasejs/10.13.1/firebase-app-compat.js'),
      loadScript('https://www.gstatic.com/firebasejs/10.13.1/firebase-messaging-compat.js'),
    ]);
    return firebaseScriptsPromise;
  }

  function deviceId() {
    try {
      var key = 'botadmin_push_device_id';
      var current = window.localStorage.getItem(key);
      if (current) return current;
      var next =
        (window.crypto && window.crypto.randomUUID && window.crypto.randomUUID()) ||
        'web-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      window.localStorage.setItem(key, next);
      return next;
    } catch (_) {
      return 'web-' + Date.now();
    }
  }

  function firebaseConfigured(config, vapidKey) {
    return Boolean(
      vapidKey &&
        config &&
        config.apiKey &&
        config.appId &&
        config.messagingSenderId &&
        config.projectId,
    );
  }

  function registerPushToken() {
    if (!supported() || permission() !== 'granted') {
      return Promise.resolve({ ok: false, reason: permission() });
    }
    if (!('serviceWorker' in navigator)) {
      return Promise.resolve({ ok: false, reason: 'service_worker_unsupported' });
    }
    if (pushRegisterPromise) return pushRegisterPromise;

    pushRegisterPromise = fetch('/api/config/firebase/public', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Firebase público indisponível');
        return response.json();
      })
      .then(function (payload) {
        var config = payload && payload.config;
        var vapidKey = payload && payload.vapidKey;
        if (!firebaseConfigured(config, vapidKey)) {
          return { ok: false, reason: 'firebase_not_configured' };
        }
        return loadFirebaseScripts().then(function () {
          if (!window.firebase) {
            throw new Error('Firebase SDK não carregado');
          }
          if (!window.firebase.apps || !window.firebase.apps.length) {
            window.firebase.initializeApp(config);
          }
          return navigator.serviceWorker
            .register('/firebase-messaging-sw.js')
            .then(function (registration) {
              var messaging = window.firebase.messaging();
              return messaging.getToken({
                vapidKey: vapidKey,
                serviceWorkerRegistration: registration,
              });
            })
            .then(function (token) {
              if (!token) return { ok: false, reason: 'empty_token' };
              return fetch('/api/notifications/push/token', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  token: token,
                  platform: 'web',
                  deviceId: deviceId(),
                }),
              }).then(function (response) {
                if (!response.ok) throw new Error('Falha ao registrar token push');
                return { ok: true, token: token };
              });
            });
        });
      })
      .catch(function (error) {
        console.warn('[BotAdmin] push web não registrado', error);
        pushRegisterPromise = null;
        return { ok: false, reason: error && error.message ? error.message : 'error' };
      });

    return pushRegisterPromise;
  }

  /**
   * Sempre chama Notification.requestPermission(), mesmo se o usuário
   * já tiver recusado antes. Quando liberar, registra o token FCM.
   */
  function request() {
    if (!supported()) {
      return Promise.resolve('unsupported');
    }
    try {
      var result = Notification.requestPermission();
      if (result && typeof result.then === 'function') {
        return result
          .then(function (value) {
            notifyChanged();
            var next = String(value || permission());
            if (next === 'granted') {
              return registerPushToken().then(function () {
                return next;
              });
            }
            return next;
          })
          .catch(function () {
            notifyChanged();
            return permission();
          });
      }
      notifyChanged();
      if (permission() === 'granted') {
        return registerPushToken().then(function () {
          return permission();
        });
      }
      return Promise.resolve(permission());
    } catch (_) {
      notifyChanged();
      return Promise.resolve(permission());
    }
  }

  window.BotAdminBrowserNotifications = {
    supported: supported,
    permission: permission,
    request: request,
    registerPushToken: registerPushToken,
  };
})();
