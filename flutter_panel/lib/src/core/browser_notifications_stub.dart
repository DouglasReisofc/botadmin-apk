import 'dart:async';

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

class BrowserNotifications {
  const BrowserNotifications._();

  static const BrowserNotificationStatus _unsupported =
      BrowserNotificationStatus(supported: false, permission: 'unsupported');

  static BrowserNotificationStatus currentStatus() => _unsupported;

  static Future<BrowserNotificationStatus> requestPermission() async {
    return _unsupported;
  }

  static Future<void> ensurePushRegistered() async {}

  static Stream<BrowserNotificationStatus> permissionChanges() {
    return const Stream<BrowserNotificationStatus>.empty();
  }

  static Future<void> show({
    required String title,
    required String body,
    String tag = 'botadmin-web-whatsapp-messages',
  }) async {}
}
