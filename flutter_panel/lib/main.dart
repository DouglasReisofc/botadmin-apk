import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

import 'src/app.dart';
import 'src/core/native_message_notifications.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FirebaseMessaging.onBackgroundMessage(botAdminFirebaseBackgroundHandler);
  PaintingBinding.instance.imageCache.maximumSize = 1200;
  PaintingBinding.instance.imageCache.maximumSizeBytes = 220 << 20;
  Intl.defaultLocale = 'pt_BR';
  await initializeDateFormatting('pt_BR');
  await NativeMessageNotifications.initialize();
  runApp(const ProviderScope(child: BotAdminFlutterApp()));
}
