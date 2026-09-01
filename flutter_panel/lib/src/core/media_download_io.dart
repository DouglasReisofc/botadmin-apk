import 'dart:io';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

const _native = MethodChannel('botadmin/native');

Future<String> saveMediaToDevice({
  required Uint8List bytes,
  required String fileName,
  required String mimeType,
}) async {
  if (Platform.isAndroid) {
    final response = await _native.invokeMapMethod<String, dynamic>(
      'saveMediaToDownloads',
      {'bytes': bytes, 'fileName': fileName, 'mimeType': mimeType},
    );
    final displayPath = response?['displayPath']?.toString().trim();
    return displayPath == null || displayPath.isEmpty
        ? 'Mídia salva em Downloads/BotAdmin.'
        : 'Mídia salva em $displayPath.';
  }

  final downloads = await getDownloadsDirectory();
  final directory = downloads ?? await getApplicationDocumentsDirectory();
  final safeName = fileName.replaceAll(RegExp(r'[^a-zA-Z0-9._-]+'), '-');
  final file = File('${directory.path}/$safeName');
  await file.writeAsBytes(bytes, flush: true);
  return 'Mídia salva em ${file.path}.';
}
