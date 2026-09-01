import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';

Future<String> saveMediaToDevice({
  required Uint8List bytes,
  required String fileName,
  required String mimeType,
}) async {
  await XFile.fromData(
    bytes,
    name: fileName,
    mimeType: mimeType,
  ).saveTo(fileName);
  return 'Download iniciado pelo navegador.';
}
