class CallAudioBridgeSnapshot {
  const CallAudioBridgeSnapshot({
    required this.status,
    this.callId,
    this.error,
    this.sentFrames = 0,
    this.receivedFrames = 0,
    this.micPeak = 0,
    this.speakerphone = false,
    this.microphoneMuted = false,
  });

  final String status;
  final String? callId;
  final String? error;
  final int sentFrames;
  final int receivedFrames;
  final double micPeak;
  final bool speakerphone;
  final bool microphoneMuted;

  bool get isActive =>
      status == 'connecting' || status == 'connected' || status == 'ready';
}

abstract class CallAudioBridge {
  Future<CallAudioBridgeSnapshot> start({
    required int instanceId,
    required String callId,
  });

  CallAudioBridgeSnapshot current();

  Future<void> setSpeakerphone(bool enabled);

  Future<void> setMicrophoneMuted(bool muted);

  void stop();
}
