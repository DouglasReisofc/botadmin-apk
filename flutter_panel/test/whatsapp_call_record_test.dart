import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_panel/src/models/migration_models.dart';

WhatsappCallRecord callWithStatus(String status) => WhatsappCallRecord(
  id: 'call-1',
  chatJid: '5511999999999@s.whatsapp.net',
  direction: 'incoming',
  status: status,
  isVideo: false,
  raw: {'status': status},
);

void main() {
  test('classifica estados remotos de encerramento como terminais', () {
    for (final status in [
      'disconnected',
      'completed',
      'failed',
      'declined',
      'busy',
    ]) {
      final call = callWithStatus(status);
      expect(call.isTerminal, isTrue, reason: status);
      expect(call.isLive, isFalse, reason: status);
    }
  });

  test('mantém chamada conectada como ativa', () {
    final call = callWithStatus('connected');
    expect(call.isTerminal, isFalse);
    expect(call.isLive, isTrue);
    expect(call.isConnected, isTrue);
  });
}
