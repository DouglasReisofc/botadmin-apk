import 'call_audio_bridge_types.dart';

CallAudioBridge createCallAudioBridge() => const _UnsupportedCallAudioBridge();

class _UnsupportedCallAudioBridge implements CallAudioBridge {
  const _UnsupportedCallAudioBridge();

  @override
  Future<CallAudioBridgeSnapshot> start({
    required int instanceId,
    required String callId,
  }) async {
    throw UnsupportedError(
      'Audio de chamada em tempo real esta disponivel apenas no navegador.',
    );
  }

  @override
  CallAudioBridgeSnapshot current() {
    return const CallAudioBridgeSnapshot(
      status: 'unsupported',
      error: 'Audio de chamada indisponivel nesta plataforma.',
    );
  }

  @override
  Future<void> setSpeakerphone(bool enabled) async {}

  @override
  Future<void> setMicrophoneMuted(bool muted) async {}

  @override
  void stop() {}
}
