import 'dart:async';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

Future<WebSocketChannel> connectWhatsappRealtimeSocket({
  required Uri uri,
  String? cookie,
}) async {
  return IOWebSocketChannel.connect(
    uri,
    headers: {
      if (cookie != null && cookie.trim().isNotEmpty) 'Cookie': cookie.trim(),
    },
  );
}
