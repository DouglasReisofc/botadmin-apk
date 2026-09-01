import 'dart:typed_data';

/// Non-web: blob URLs are not used; callers should stream via headers instead.
String? createMediaBlobUrl(Uint8List bytes, String mimeType) => null;

void revokeMediaBlobUrl(String? url) {}
