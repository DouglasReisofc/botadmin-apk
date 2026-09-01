import 'dart:async';

import 'package:web_socket_channel/web_socket_channel.dart';

Future<WebSocketChannel> connectWhatsappRealtimeSocket({
  required Uri uri,
  String? cookie,
}) async {
  return WebSocketChannel.connect(uri);
}
