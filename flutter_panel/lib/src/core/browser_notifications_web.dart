import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/foundation.dart';
import 'package:web/web.dart' as web;

class BrowserNotificationStatus {
  const BrowserNotificationStatus({
    required this.supported,
    required this.permission,
  });

  final bool supported;
  final String permission;

  bool get granted => supported && permission == 'granted';
  bool get denied => supported && permission == 'denied';
  bool get canRequest => supported && permission == 'default';
}

@JS('window')
external JSObject get _browserNotificationWindow;

/// Ponte com `web/browser_notifications.js`.
///
/// O pedido de permissão passa pelo JS nativo para preservar o gesto do
/// usuário. `requestPermission()` sempre reenvia o pedido ao browser,
/// mesmo se o usuário tiver recusado antes.
class BrowserNotifications {
  const BrowserNotifications._();

  static StreamController<BrowserNotificationStatus>? _permissionChanges;
  static bool _listeningDom = false;

  static JSObject? get _bridge {
    if (!kIsWeb) return null;
    try {
      final value = _browserNotificationWindow['BotAdminBrowserNotifications'];
      if (!value.isA<JSObject>()) return null;
      return value as JSObject;
    } catch (_) {
      return null;
    }
  }

  static BrowserNotificationStatus currentStatus() {
    if (!kIsWeb) {
      return const BrowserNotificationStatus(
        supported: false,
        permission: 'unsupported',
      );
    }

    final bridge = _bridge;
    if (bridge != null) {
      try {
        final isSupported = bridge
            .callMethod<JSBoolean>('supported'.toJS)
            .toDart;
        if (!isSupported) {
          return const BrowserNotificationStatus(
            supported: false,
            permission: 'unsupported',
          );
        }
        final permission = bridge
            .callMethod<JSString>('permission'.toJS)
            .toDart;
        return BrowserNotificationStatus(
          supported: true,
          permission: permission,
        );
      } catch (_) {
        // fallback abaixo
      }
    }

    try {
      return BrowserNotificationStatus(
        supported: true,
        permission: web.Notification.permission,
      );
    } catch (_) {
      return const BrowserNotificationStatus(
        supported: false,
        permission: 'unsupported',
      );
    }
  }

  /// Sempre solicita de novo (inclusive após recusa anterior).
  static Future<BrowserNotificationStatus> requestPermission() async {
    if (!kIsWeb) return currentStatus();

    final bridge = _bridge;
    if (bridge != null) {
      try {
        final promise = bridge.callMethod<JSPromise<JSAny?>>('request'.toJS);
        final result = await promise.toDart;
        final permission =
            result?.dartify()?.toString() ?? currentStatus().permission;
        return BrowserNotificationStatus(
          supported: permission != 'unsupported',
          permission: permission,
        );
      } catch (_) {
        // fallback
      }
    }

    try {
      final permission = await web.Notification.requestPermission().toDart;
      return BrowserNotificationStatus(
        supported: true,
        permission: permission.toDart,
      );
    } catch (_) {
      return currentStatus();
    }
  }

  static Future<void> ensurePushRegistered() async {
    if (!kIsWeb || !currentStatus().granted) return;
    final bridge = _bridge;
    if (bridge == null) return;
    try {
      final promise = bridge.callMethod<JSPromise<JSAny?>>(
        'registerPushToken'.toJS,
      );
      await promise.toDart;
    } catch (_) {}
  }

  static Stream<BrowserNotificationStatus> permissionChanges() {
    final existing = _permissionChanges;
    if (existing != null) return existing.stream;

    final controller = StreamController<BrowserNotificationStatus>.broadcast(
      onListen: _ensureDomListener,
    );
    _permissionChanges = controller;
    _ensureDomListener();
    return controller.stream;
  }

  static Future<void> show({
    required String title,
    required String body,
    String tag = 'botadmin-web-whatsapp-messages',
  }) async {
    if (!kIsWeb) return;
    if (!currentStatus().granted) return;
    final cleanTitle = title.trim();
    final cleanBody = body.trim();
    final cleanTag = tag.trim().isEmpty
        ? 'botadmin-web-whatsapp-messages'
        : tag.trim();
    if (cleanTitle.isEmpty && cleanBody.isEmpty) return;
    try {
      web.Notification(
        cleanTitle.isEmpty ? 'BotAdmin' : cleanTitle,
        web.NotificationOptions(
          body: cleanBody,
          tag: cleanTag,
          renotify: false,
          requireInteraction: false,
        ),
      );
    } catch (_) {}
  }

  static void _ensureDomListener() {
    if (!kIsWeb || _listeningDom) return;
    _listeningDom = true;
    try {
      web.window.addEventListener(
        'botadmin-notification-permission',
        _onPermissionEvent.toJS,
      );
    } catch (_) {
      _listeningDom = false;
    }
  }

  static void _onPermissionEvent(web.Event event) {
    final controller = _permissionChanges;
    if (controller == null || controller.isClosed) return;
    controller.add(currentStatus());
  }
}
