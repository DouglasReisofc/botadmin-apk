import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_panel/src/models/admin_support.dart';

void main() {
  AdminSupportMessage message(String direction, String senderRole) =>
      AdminSupportMessage(
        id: 1,
        direction: direction,
        messageType: 'text',
        timestamp: '2026-09-20T00:00:00Z',
        senderRole: senderRole,
      );

  test('internal support uses the author, not user-facing direction', () {
    expect(
      message('outbound', 'user').isOutboundForAdmin(isAdminThread: true),
      isFalse,
    );
    expect(
      message('inbound', 'admin').isOutboundForAdmin(isAdminThread: true),
      isTrue,
    );
  });

  test('WhatsApp support keeps agent messages on the right', () {
    expect(
      message('outbound', 'admin').isOutboundForAdmin(isAdminThread: false),
      isTrue,
    );
    expect(
      message('inbound', 'contact').isOutboundForAdmin(isAdminThread: false),
      isFalse,
    );
  });
}
