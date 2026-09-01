import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';
import 'app_config.dart';
import 'browser_notifications.dart';
import 'native_message_notifications.dart';

class NativePushRegistration {
  const NativePushRegistration._();

  static const _storage = FlutterSecureStorage();
  static const _nativeChannel = MethodChannel('botadmin/native');
  static const _fcmGenerationKey = 'botadmin_fcm_native_generation';
  static const _fcmGeneration = 'android-native-fcm-v5';

  static bool _initializing = false;
  static bool _foregroundListenerStarted = false;
  static bool _tokenRefreshListenerStarted = false;
  static String? _registeredToken;

  static Future<void> ensureRegistered(BotAdminApiClient api) async {
    if (kIsWeb) {
      await BrowserNotifications.ensurePushRegistered();
      return;
    }
    if (_initializing) return;
    _initializing = true;
    try {
      await _ensureFirebaseInitialized(api);

      await NativeMessageNotifications.initialize();
      await _consumeNativeInbox(api);
      _startForegroundListener();

      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );

      if (defaultTargetPlatform == TargetPlatform.android) {
        final generation = await _storage.read(key: _fcmGenerationKey);
        if (generation != _fcmGeneration) {
          await messaging.deleteToken().catchError((_) {});
          await _storage.write(key: _fcmGenerationKey, value: _fcmGeneration);
          _registeredToken = null;
        }
      }

      _startTokenRefreshListener(api);

      final token = await messaging.getToken();
      if (token == null || token.trim().isEmpty || token == _registeredToken) {
        await _configureNativeRealtimeNotifications(api);
        return;
      }
      await _registerToken(api, token);
      _registeredToken = token;
      await _configureNativeRealtimeNotifications(api);
      debugPrint(
        'BotAdmin FCM token registered: ${token.substring(0, token.length < 24 ? token.length : 24)}',
      );
    } catch (error, stackTrace) {
      debugPrint('BotAdmin push registration failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      // Push registration is opportunistic; realtime websocket remains active.
    } finally {
      _initializing = false;
    }
  }

  static String _string(Object? value) =>
      value == null ? '' : value.toString().trim();

  static String? _nullableString(Object? value) {
    final text = _string(value);
    return text.isEmpty ? null : text;
  }

  static Future<void> _ensureFirebaseInitialized(BotAdminApiClient api) async {
    if (Firebase.apps.isNotEmpty) return;
    try {
      if (defaultTargetPlatform == TargetPlatform.android) {
        await Firebase.initializeApp();
        return;
      }

      final firebase = await api.getJson('/api/config/firebase/public');
      final config = firebase['config'];
      if (config is! Map<String, dynamic>) return;

      final apiKey = _string(config['apiKey']);
      final appId = _string(config['appId']);
      final messagingSenderId = _string(config['messagingSenderId']);
      final projectId = _string(config['projectId']);
      if (apiKey.isEmpty ||
          appId.isEmpty ||
          messagingSenderId.isEmpty ||
          projectId.isEmpty) {
        return;
      }

      await Firebase.initializeApp(
        options: FirebaseOptions(
          apiKey: apiKey,
          appId: appId,
          messagingSenderId: messagingSenderId,
          projectId: projectId,
          authDomain: _nullableString(config['authDomain']),
          storageBucket: _nullableString(config['storageBucket']),
          measurementId: _nullableString(config['measurementId']),
        ),
      );
    } on FirebaseException catch (error) {
      if (error.code != 'duplicate-app') rethrow;
    }
  }

  static void _startForegroundListener() {
    if (_foregroundListenerStarted) return;
    _foregroundListenerStarted = true;
    FirebaseMessaging.onMessage.listen((message) {
      // Com o app aberto, a lista de conversas ja atualiza em tempo real.
      // Evita overlay/toast duplicado e deixa notificacoes nativas para
      // segundo plano, como no WhatsApp.
    });
  }

  static void _startTokenRefreshListener(BotAdminApiClient api) {
    if (_tokenRefreshListenerStarted) return;
    _tokenRefreshListenerStarted = true;
    FirebaseMessaging.instance.onTokenRefresh.listen((token) async {
      if (token.trim().isEmpty || token == _registeredToken) return;
      try {
        await _registerToken(api, token);
        _registeredToken = token;
      } catch (_) {
        // O proximo carregamento do painel tenta registrar de novo.
      }
    });
  }

  static Future<void> _registerToken(
    BotAdminApiClient api,
    String token,
  ) async {
    final deviceId = await _deviceId();
    await api.postJson(
      '/api/notifications/push/token',
      data: {
        'token': token,
        'platform': defaultTargetPlatform == TargetPlatform.iOS
            ? 'ios'
            : 'android',
        'deviceId': deviceId,
      },
    );
  }

  static Future<String> _deviceId() async {
    if (kIsWeb) return 'web';
    if (defaultTargetPlatform == TargetPlatform.android) {
      final value = await _nativeChannel
          .invokeMethod<String>('deviceId')
          .catchError((_) => null);
      final normalized = value?.trim();
      if (normalized != null && normalized.isNotEmpty) return normalized;
    }
    return 'flutter-${defaultTargetPlatform.name}';
  }

  static Future<void> stopNativeRealtimeNotifications() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    await _nativeChannel
        .invokeMethod<bool>('stopRealtimeNotifications')
        .catchError((_) => false);
  }

  static Future<void> _configureNativeRealtimeNotifications(
    BotAdminApiClient api,
  ) async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    final cookie = await api.readSessionCookieHeader();
    if (cookie == null || cookie.trim().isEmpty) return;
    await _nativeChannel
        .invokeMethod<bool>('configureRealtimeNotifications', {
          'baseUrl': AppConfig.apiBaseUrl,
          'cookie': cookie.trim(),
        })
        .catchError((_) => false);
  }

  static Future<void> _consumeNativeInbox(BotAdminApiClient api) async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      final raw = await _nativeChannel.invokeMethod<String>(
        'consumeNativeInbox',
      );
      if (raw == null || raw.trim().isEmpty) return;
      final decoded = jsonDecode(raw);
      if (decoded is! List) return;
      final events = decoded
          .whereType<Map>()
          .map<Map<String, dynamic>>(
            (item) => item.map((key, value) => MapEntry(key.toString(), value)),
          )
          .toList(growable: false);
      if (events.isNotEmpty) api.applyNativeRealtimeEvents(events);
    } catch (_) {
      // Native inbox is best-effort and must never delay app startup.
    }
  }
}
