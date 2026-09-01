import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

class VoiceRecording {
  const VoiceRecording({
    required this.bytes,
    required this.fileName,
    required this.mimeType,
  });

  final Uint8List bytes;
  final String fileName;
  final String mimeType;
}

class VoiceRecorder {
  final AudioRecorder _recorder = AudioRecorder();
  String? _path;
  String? _fileName;
  String? _mimeType;

  Future<void> start() async {
    if (!await _recorder.hasPermission()) {
      throw StateError('Permissão do microfone negada.');
    }

    var encoder = AudioEncoder.aacLc;
    var extension = 'm4a';
    var mimeType = 'audio/mp4';
    if (!await _recorder.isEncoderSupported(encoder)) {
      encoder = AudioEncoder.opus;
      extension = 'opus';
      mimeType = 'audio/opus';
    }
    if (!await _recorder.isEncoderSupported(encoder)) {
      throw StateError('Nenhum codificador de áudio compatível.');
    }

    final fileName =
        'audio-${DateTime.now().millisecondsSinceEpoch}.$extension';
    final path = '${(await getTemporaryDirectory()).path}/$fileName';
    await _recorder.start(
      RecordConfig(
        encoder: encoder,
        bitRate: 64000,
        sampleRate: 48000,
        numChannels: 1,
        autoGain: true,
        echoCancel: true,
        noiseSuppress: true,
      ),
      path: path,
    );
    if (!await _recorder.isRecording()) {
      throw StateError('O dispositivo não iniciou a captura de áudio.');
    }
    _path = path;
    _fileName = fileName;
    _mimeType = mimeType;
  }

  Future<VoiceRecording?> stop() async {
    final path = await _recorder.stop() ?? _path;
    final fileName = _fileName;
    final mimeType = _mimeType;
    _clearMetadata();
    if (path == null || fileName == null || mimeType == null) return null;
    final bytes = await XFile(
      path,
      name: fileName,
      mimeType: mimeType,
    ).readAsBytes();
    await File(path).delete().catchError((_) => File(path));
    if (bytes.isEmpty) return null;
    return VoiceRecording(bytes: bytes, fileName: fileName, mimeType: mimeType);
  }

  Future<void> cancel() async {
    final path = _path;
    await _recorder.cancel();
    _clearMetadata();
    if (path != null) {
      await File(path).delete().catchError((_) => File(path));
    }
  }

  Future<void> dispose() => _recorder.dispose();

  void _clearMetadata() {
    _path = null;
    _fileName = null;
    _mimeType = null;
  }
}
