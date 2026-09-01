import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'call_audio_bridge_types.dart';

@JS('window')
external JSObject get _window;

CallAudioBridge createCallAudioBridge() => const _WebCallAudioBridge();

class _WebCallAudioBridge implements CallAudioBridge {
  const _WebCallAudioBridge();

  JSObject? get _bridge {
    final bridge = _window['BotAdminCallAudioBridge'];
    if (!bridge.isA<JSObject>()) return null;
    return bridge as JSObject;
  }

  @override
  Future<CallAudioBridgeSnapshot> start({
    required int instanceId,
    required String callId,
  }) async {
    final bridge = _bridge;
    if (bridge == null) {
      throw StateError('Ponte de audio de chamada nao carregada.');
    }

    final options = JSObject()
      ..['instanceId'] = instanceId.toJS
      ..['callId'] = callId.toJS;
    final promise = bridge.callMethod<JSPromise<JSAny?>>('start'.toJS, options);
    final result = await promise.toDart;
    return _snapshotFromJs(result);
  }

  @override
  CallAudioBridgeSnapshot current() {
    final bridge = _bridge;
    if (bridge == null) {
      return const CallAudioBridgeSnapshot(
        status: 'unloaded',
        error: 'Ponte de audio de chamada nao carregada.',
      );
    }
    final result = bridge.callMethod<JSAny?>('current'.toJS);
    return _snapshotFromJs(result);
  }

  @override
  Future<void> setSpeakerphone(bool enabled) async {
    // O navegador controla a rota de audio pelo sistema operacional.
  }

  @override
  Future<void> setMicrophoneMuted(bool muted) async {
    // O navegador usa o estado do microfone controlado pelo WebAudio.
  }

  @override
  void stop() {
    final bridge = _bridge;
    if (bridge == null) return;
    bridge.callMethod<JSAny?>('stop'.toJS);
  }
}

CallAudioBridgeSnapshot _snapshotFromJs(JSAny? value) {
  final converted = value?.dartify();
  if (converted is Map) {
    return CallAudioBridgeSnapshot(
      status: _stringValue(converted['status']) ?? 'idle',
      callId: _stringValue(converted['callId']),
      error: _stringValue(converted['error']),
      sentFrames: _intValue(converted['sentFrames']),
      receivedFrames: _intValue(converted['receivedFrames']),
      micPeak: _doubleValue(converted['micPeak']),
      speakerphone: converted['speakerphone'] == true,
      microphoneMuted: converted['microphoneMuted'] == true,
    );
  }
  return const CallAudioBridgeSnapshot(status: 'idle');
}

String? _stringValue(Object? value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}

int _intValue(Object? value) {
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

double _doubleValue(Object? value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}
