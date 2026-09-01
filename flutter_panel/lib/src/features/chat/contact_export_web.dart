import 'dart:js_interop';
import 'dart:convert';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

Future<bool> saveContact({
  required String displayName,
  required String phoneNumber,
  required String vcard,
}) async {
  final bytes = Uint8List.fromList(utf8.encode(vcard)).toJS;
  final blob = web.Blob(
    [bytes].toJS,
    web.BlobPropertyBag(type: 'text/vcard;charset=utf-8'),
  );
  final url = web.URL.createObjectURL(blob);
  final fileName = displayName
      .replaceAll(RegExp(r'[^0-9A-Za-zÀ-ÿ_-]+'), '-')
      .replaceAll(RegExp(r'-+'), '-')
      .replaceAll(RegExp(r'^-|-$'), '');
  final anchor = web.HTMLAnchorElement()
    ..href = url
    ..download = '${fileName.isEmpty ? 'contato' : fileName}.vcf'
    ..style.display = 'none';
  web.document.body?.append(anchor);
  anchor.click();
  anchor.remove();
  web.URL.revokeObjectURL(url);
  return true;
}
