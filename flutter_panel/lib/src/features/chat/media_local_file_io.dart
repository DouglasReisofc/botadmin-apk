import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

Future<String?> createLocalMediaFile(
  Uint8List bytes,
  String mimeType,
  String rawUrl,
) async {
  if (bytes.isEmpty) return null;
  final dir = await Directory.systemTemp.createTemp('botadmin_media_');
  final file = File(
    '${dir.path}/media_${DateTime.now().microsecondsSinceEpoch}_${math.Random().nextInt(999999)}${_extensionFor(mimeType, rawUrl)}',
  );
  await file.writeAsBytes(bytes, flush: false);
  return file.path;
}

Future<void> deleteLocalMediaFile(String? path) async {
  final value = path?.trim() ?? '';
  if (value.isEmpty || value.startsWith('blob:') || value.startsWith('http')) {
    return;
  }
  try {
    final file = File(value);
    if (await file.exists()) await file.delete();
    final parent = file.parent;
    if (parent.path.contains('botadmin_media_') && await parent.exists()) {
      final isEmpty = await parent.list().isEmpty;
      if (isEmpty) await parent.delete();
    }
  } catch (_) {}
}

String _extensionFor(String mimeType, String rawUrl) {
  final mime = mimeType.toLowerCase();
  final lower = rawUrl.toLowerCase();
  // Keep audio containers on an extension that ExoPlayer can identify.  In
  // particular, `audio/mp4` is normally an m4a recording; writing it as
  // `.mp4` makes some Android devices try the video renderer and expose an
  // apparently empty/inaudible player.
  if (mime.contains('m4a') || lower.contains('.m4a')) return '.m4a';
  if (mime.contains('mp4') || lower.contains('.mp4')) return '.mp4';
  if (mime.contains('webm') || lower.contains('.webm')) return '.webm';
  if (mime.contains('mpeg') || lower.contains('.mp3')) return '.mp3';
  if (mime.contains('aac') || lower.contains('.aac')) return '.aac';
  if (mime.contains('wav') || lower.contains('.wav')) return '.wav';
  if (mime.contains('amr') || lower.contains('.amr')) return '.amr';
  if (mime.contains('ogg') || mime.contains('opus') || lower.contains('.ogg')) {
    return '.ogg';
  }
  if (mime.contains('webp') || lower.contains('.webp')) return '.webp';
  if (mime.contains('png') || lower.contains('.png')) return '.png';
  if (mime.contains('jpeg') || mime.contains('jpg') || lower.contains('.jpg')) {
    return '.jpg';
  }
  return '.bin';
}
