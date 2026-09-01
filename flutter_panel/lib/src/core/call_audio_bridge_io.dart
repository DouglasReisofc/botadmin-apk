import 'package:flutter/services.dart';

import 'app_config.dart';
import 'call_audio_bridge_types.dart';
import 'session_store.dart';

CallAudioBridge createCallAudioBridge() => const _NativeCallAudioBridge();

class _NativeCallAudioBridge implements CallAudioBridge {
  const _NativeCallAudioBridge();

  static const _channel = MethodChannel('botadmin/call-audio');
  static final BotAdminSessionStore _sessions = BotAdminSessionStore();
  static CallAudioBridgeSnapshot _last = const CallAudioBridgeSnapshot(
    status: 'idle',
  );

  @override
  Future<CallAudioBridgeSnapshot> start({
    required int instanceId,
    required String callId,
  }) async {
    final cookie = (await _sessions.readSessionCookie() ?? '').trim();
    if (cookie.isEmpty) {
      throw StateError('Sessao do painel indisponivel para a chamada.');
    }
    final raw = await _channel.invokeMethod<Object?>('start', {
      'baseUrl': AppConfig.apiBaseUrl,
      'cookie': cookie,
      'instanceId': instanceId,
      'callId': callId,
    });
    _last = _snapshot(raw);
    return _last;
  }

  @override
  CallAudioBridgeSnapshot current() => _last;

  @override
  Future<void> setSpeakerphone(bool enabled) async {
    final raw = await _channel.invokeMethod<Object?>('speakerphone', {
      'enabled': enabled,
    });
    _last = _snapshot(raw, fallbackSpeakerphone: enabled);
  }

  @override
  Future<void> setMicrophoneMuted(bool muted) async {
    final raw = await _channel.invokeMethod<Object?>('microphoneMuted', {
      'muted': muted,
    });
    _last = _snapshot(raw, fallbackMicrophoneMuted: muted);
  }

  @override
  void stop() {
    _channel
        .invokeMethod<Object?>('stop')
        .then((raw) {
          _last = _snapshot(raw);
        })
        .catchError((_) {
          _last = const CallAudioBridgeSnapshot(status: 'idle');
        });
  }
}

CallAudioBridgeSnapshot _snapshot(
  Object? raw, {
  bool? fallbackSpeakerphone,
  bool? fallbackMicrophoneMuted,
}) {
  if (raw is Map) {
    final value = Map<Object?, Object?>.from(raw);
    return CallAudioBridgeSnapshot(
      status: value['status']?.toString() ?? 'idle',
      callId: _string(value['callId']),
      error: _string(value['error']),
      sentFrames: _int(value['sentFrames']),
      receivedFrames: _int(value['receivedFrames']),
      micPeak: _double(value['micPeak']),
      speakerphone:
        value['speakerphone'] == true || (fallbackSpeakerphone ?? false),
      microphoneMuted: value['microphoneMuted'] == true ||
          (fallbackMicrophoneMuted ?? false),
    );
  }
  return CallAudioBridgeSnapshot(
    status: 'idle',
    speakerphone: fallbackSpeakerphone ?? false,
    microphoneMuted: fallbackMicrophoneMuted ?? false,
  );
}

String? _string(Object? value) {
  final result = value?.toString().trim() ?? '';
  return result.isEmpty ? null : result;
}

int _int(Object? value) =>
    value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;

double _double(Object? value) => value is num
    ? value.toDouble()
    : double.tryParse(value?.toString() ?? '') ?? 0;
