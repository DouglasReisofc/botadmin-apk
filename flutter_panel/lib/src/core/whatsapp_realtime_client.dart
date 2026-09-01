// ignore_for_file: prefer_initializing_formals

import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'app_config.dart';
import 'session_store.dart';
import 'whatsapp_realtime_socket.dart';

class WhatsappRealtimeClient {
  WhatsappRealtimeClient({
    required BotAdminSessionStore sessionStore,
    required void Function(WhatsappRealtimeSocketEvent event) onEvent,
    required void Function() onReconnectNeeded,
    int after = 0,
  }) : _sessionStore = sessionStore,
       _onEvent = onEvent,
       _onReconnectNeeded = onReconnectNeeded,
       _lastSequenceId = after;

  final BotAdminSessionStore _sessionStore;
  final void Function(WhatsappRealtimeSocketEvent event) _onEvent;
  final void Function() _onReconnectNeeded;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _reconnectTimer;
  Timer? _pingTimer;
  Timer? _stableConnectionTimer;
  bool _closed = false;
  int _lastSequenceId;
  var _retry = 0;

  void start() {
    _closed = false;
    _connect();
  }

  void updateSequence(int sequenceId) {
    if (sequenceId > _lastSequenceId) _lastSequenceId = sequenceId;
  }

  Future<void> dispose() async {
    _closed = true;
    _reconnectTimer?.cancel();
    _pingTimer?.cancel();
    _stableConnectionTimer?.cancel();
    await _subscription?.cancel();
    try {
      await _channel?.sink.close();
    } catch (_) {}
  }

  Future<void> _connect() async {
    if (_closed) return;
    _reconnectTimer?.cancel();
    _pingTimer?.cancel();
    await _subscription?.cancel();
    try {
      await _channel?.sink.close();
    } catch (_) {}

    try {
      final cookie = await _sessionStore.readSessionCookie();
      final socket = await connectWhatsappRealtimeSocket(
        uri: _socketUri(_lastSequenceId),
        cookie: cookie,
      );
      if (_closed) {
        await socket.sink.close();
        return;
      }
      _channel = socket;
      _stableConnectionTimer?.cancel();
      _stableConnectionTimer = Timer(const Duration(seconds: 12), () {
        // Only reset backoff after a connection stayed healthy. This avoids
        // hammering the server when a socket connects and immediately drops.
        _retry = 0;
      });
      _subscription = socket.stream.listen(
        _handleMessage,
        onError: (_) => _scheduleReconnect(),
        onDone: _scheduleReconnect,
        cancelOnError: true,
      );
      _pingTimer = Timer.periodic(const Duration(seconds: 20), (_) {
        try {
          socket.sink.add(jsonEncode({'type': 'ping'}));
        } catch (_) {
          _scheduleReconnect();
        }
      });
      _onReconnectNeeded();
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _handleMessage(dynamic raw) {
    if (_closed) return;
    try {
      final data = jsonDecode(raw.toString());
      if (data is! Map<String, dynamic>) return;
      final type = data['type']?.toString();
      if (type == 'ping' || type == 'pong' || type == 'hello') {
        final sequence = data['latestSequenceId'] ?? data['sequenceId'];
        if (sequence is num) updateSequence(sequence.toInt());
        return;
      }
      if (type == 'error') {
        _scheduleReconnect();
        return;
      }
      final sequence = data['sequenceId'] ?? data['id'];
      if (sequence is num) {
        final next = sequence.toInt();
        updateSequence(next);
        _onEvent(
          WhatsappRealtimeSocketEvent(
            sequenceId: next,
            instanceId: _parseInt(data['instanceId']),
            chatJid: data['chatJid']?.toString(),
            eventType: data['eventType']?.toString() ?? type,
            payload: _asMap(data['payload']),
            message: _asMap(data['message']),
            thread: _asMap(data['thread']),
          ),
        );
      } else {
        _onReconnectNeeded();
      }
    } catch (_) {
      // Malformed websocket payloads are ignored; polling fallback stays active.
    }
  }

  void _scheduleReconnect() {
    if (_closed) return;
    _pingTimer?.cancel();
    _stableConnectionTimer?.cancel();
    _reconnectTimer?.cancel();
    final backoffStep = _retry > 6 ? 6 : _retry;
    final exponential = 600 * (1 << backoffStep);
    final delay = Duration(milliseconds: exponential.clamp(600, 30000));
    _retry++;
    _reconnectTimer = Timer(delay, _connect);
  }

  static Uri _socketUri(int after) {
    final base = Uri.parse(AppConfig.apiBaseUrl);
    final scheme = base.scheme == 'http' ? 'ws' : 'wss';
    return base.replace(
      scheme: scheme,
      path: '/ws/whatsapp',
      queryParameters: {if (after > 0) 'after': '$after'},
    );
  }
}

class WhatsappRealtimeSocketEvent {
  const WhatsappRealtimeSocketEvent({
    required this.sequenceId,
    this.instanceId,
    this.chatJid,
    this.eventType,
    this.payload,
    this.message,
    this.thread,
  });

  final int sequenceId;
  final int? instanceId;
  final String? chatJid;
  final String? eventType;
  final Map<String, dynamic>? payload;
  final Map<String, dynamic>? message;
  final Map<String, dynamic>? thread;
}

int? _parseInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

Map<String, dynamic>? _asMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return null;
}
