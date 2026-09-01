import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

String? createMediaBlobUrl(Uint8List bytes, String mimeType) {
  if (bytes.isEmpty) return null;
  final parts = [bytes.toJS].toJS;
  final blob = web.Blob(
    parts,
    web.BlobPropertyBag(type: mimeType.isEmpty ? 'application/octet-stream' : mimeType),
  );
  return web.URL.createObjectURL(blob);
}

void revokeMediaBlobUrl(String? url) {
  final value = url?.trim() ?? '';
  if (value.startsWith('blob:')) {
    web.URL.revokeObjectURL(value);
  }
}
