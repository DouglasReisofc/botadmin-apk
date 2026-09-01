import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

const String botAdminRealtimeChannelId = 'botadmin_realtime_messages_v5';
const String _botAdminRealtimeChannelName = 'Mensagens do WhatsApp';
const String _botAdminRealtimeChannelDescription =
    'Notificacoes de conversas monitoradas pelo BotAdmin.';
const String _botAdminMessageGroupKey = 'br.com.botadmin.flutter_panel.WHATSAPP_MESSAGES';
const int _botAdminMessageSummaryId = 900001;

final FlutterLocalNotificationsPlugin _localNotifications =
    FlutterLocalNotificationsPlugin();

bool _localNotificationsReady = false;

@pragma('vm:entry-point')
Future<void> botAdminFirebaseBackgroundHandler(RemoteMessage message) async {
  // O Android usa o BotAdminFirebaseMessagingService nativo como fonte unica
  // para evitar duas notificacoes (FCM + isolate Flutter) para a mesma mensagem.
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) return;
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp();
  }
  await NativeMessageNotifications.showFromRemoteMessage(
    message,
    fromBackground: true,
  );
}

class NativeMessageNotifications {
  const NativeMessageNotifications._();

  static Future<void> initialize() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    if (_localNotificationsReady) return;

    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidInit);
    await _localNotifications.initialize(settings: initSettings);

    const channel = AndroidNotificationChannel(
      botAdminRealtimeChannelId,
      _botAdminRealtimeChannelName,
      description: _botAdminRealtimeChannelDescription,
      importance: Importance.high,
      playSound: true,
      enableVibration: true,
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    _localNotificationsReady = true;
  }

  static Future<void> showFromRemoteMessage(
    RemoteMessage message, {
    bool fromBackground = false,
  }) async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;

    final data = message.data;
    if ((data['type'] ?? '').toString() != 'whatsapp_message') return;

    await initialize();

    final title = _firstNonEmpty([
      data['storebot_title'],
      data['chatTitle'],
      data['chat_title'],
      data['senderName'],
      data['sender_name'],
      data['senderPhone'],
      data['sender_phone'],
    ]);
    final senderName = _firstNonEmpty([
      data['senderName'],
      data['sender_name'],
      data['storebot_sender_name'],
    ]);
    final senderPhone = _formatPhone(
      _firstNonEmpty([
        data['senderPhone'],
        data['sender_phone'],
        data['storebot_sender_phone'],
        data['senderJid'],
        data['sender_jid'],
      ]),
    );
    final preview = _firstNonEmpty([
      data['storebot_body'],
      data['messagePreview'],
      data['message_preview'],
      data['body'],
    ]);

    final body = _buildBody(
      senderName: senderName,
      senderPhone: senderPhone,
      preview: preview,
    );
    final safeTitle = title.isEmpty ? 'Nova mensagem' : title;
    final safeBody = body.isEmpty ? 'Mensagem recebida' : body;
    final chatKey = _firstNonEmpty([
      data['instanceId'],
      data['instance_id'],
      data['chatJid'],
      data['chat_jid'],
      data['conversationId'],
      data['conversation_id'],
    ]);
    final notificationId = _stableNotificationId(chatKey.isEmpty
        ? '${safeTitle}_$safeBody'
        : chatKey);

    final details = AndroidNotificationDetails(
      botAdminRealtimeChannelId,
      _botAdminRealtimeChannelName,
      channelDescription: _botAdminRealtimeChannelDescription,
      importance: Importance.high,
      priority: Priority.high,
      category: AndroidNotificationCategory.message,
      groupKey: _botAdminMessageGroupKey,
      setAsGroupSummary: false,
      ticker: '$safeTitle: $safeBody',
      styleInformation: BigTextStyleInformation(
        safeBody,
        contentTitle: safeTitle,
        summaryText: senderPhone.isEmpty ? null : senderPhone,
      ),
    );

    await _localNotifications.show(
      id: notificationId,
      title: safeTitle,
      body: safeBody,
      notificationDetails: NotificationDetails(android: details),
      payload: data['targetUrl']?.toString() ?? data['target_url']?.toString(),
    );

    const summaryDetails = AndroidNotificationDetails(
      botAdminRealtimeChannelId,
      _botAdminRealtimeChannelName,
      channelDescription: _botAdminRealtimeChannelDescription,
      importance: Importance.high,
      priority: Priority.high,
      category: AndroidNotificationCategory.message,
      groupKey: _botAdminMessageGroupKey,
      setAsGroupSummary: true,
      groupAlertBehavior: GroupAlertBehavior.children,
    );
    await _localNotifications.show(
      id: _botAdminMessageSummaryId,
      title: 'BotAdmin',
      body: 'Novas mensagens do WhatsApp',
      notificationDetails: const NotificationDetails(android: summaryDetails),
    );
  }

  static String _buildBody({
    required String senderName,
    required String senderPhone,
    required String preview,
  }) {
    final identity = [
      senderName,
      senderPhone,
    ].where((part) => part.trim().isNotEmpty).join(' • ');
    if (identity.isEmpty) return preview;
    if (preview.isEmpty) return identity;
    return '$identity: $preview';
  }

  static String _firstNonEmpty(List<Object?> values) {
    for (final value in values) {
      final text = value?.toString().trim() ?? '';
      if (text.isNotEmpty && text.toLowerCase() != 'null') return text;
    }
    return '';
  }

  static String _formatPhone(String raw) {
    final digits = raw.split('@').first.replaceAll(RegExp(r'\D+'), '');
    if (digits.isEmpty) return '';
    return '+$digits';
  }

  static int _stableNotificationId(String value) {
    var hash = 0x811c9dc5;
    for (final unit in value.codeUnits) {
      hash ^= unit;
      hash = (hash * 0x01000193) & 0x7fffffff;
    }
    return 1000 + (hash % 899000);
  }
}
