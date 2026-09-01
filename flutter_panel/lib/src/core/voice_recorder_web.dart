import 'dart:async';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

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
  web.MediaRecorder? _recorder;
  web.MediaStream? _stream;
  List<web.Blob> _chunks = [];
  Completer<VoiceRecording?>? _stopCompleter;
  String? _mimeType;
  String? _fileName;

  Future<void> start() async {
    await cancel();
    final constraints = web.MediaStreamConstraints(
      audio: {
        'autoGainControl': true,
        'echoCancellation': true,
        'noiseSuppression': true,
        'channelCount': 1,
      }.jsify()!,
    );
    final stream = await web.window.navigator.mediaDevices
        .getUserMedia(constraints)
        .toDart;
    try {
      final mimeType = _supportedMimeType();
      final fileName =
          'audio-${DateTime.now().millisecondsSinceEpoch}.${_extensionFor(mimeType)}';
      final recorder = web.MediaRecorder(
        stream,
        web.MediaRecorderOptions(
          mimeType: mimeType,
          audioBitsPerSecond: 64000,
          bitsPerSecond: 64000,
        ),
      );
      _chunks = [];
      _stream = stream;
      _recorder = recorder;
      _mimeType = mimeType;
      _fileName = fileName;
      recorder.ondataavailable = ((web.BlobEvent event) {
        if (event.data.size > 0) _chunks.add(event.data);
      }).toJS;
      recorder.onstop = ((web.Event _) {
        unawaited(_completeStop());
      }).toJS;
      recorder.onerror = ((web.Event _) {
        _completeStop(error: StateError('Falha durante a captura de áudio.'));
      }).toJS;
      recorder.start(200);
      if (recorder.state != 'recording') {
        throw StateError('O navegador não iniciou a captura de áudio.');
      }
    } catch (_) {
      _stopTracks(stream);
      rethrow;
    }
  }

  Future<VoiceRecording?> stop() async {
    final recorder = _recorder;
    if (recorder == null || recorder.state == 'inactive') {
      await _completeStop();
      return null;
    }
    final completer = _stopCompleter ??= Completer<VoiceRecording?>();
    recorder.stop();
    return completer.future;
  }

  Future<void> cancel() async {
    final recorder = _recorder;
    _stopCompleter = null;
    _chunks = [];
    if (recorder != null && recorder.state != 'inactive') recorder.stop();
    _stopTracks(_stream);
    _clear();
  }

  Future<void> dispose() => cancel();

  Future<void> _completeStop({Object? error}) async {
    final completer = _stopCompleter;
    final chunks = List<web.Blob>.from(_chunks);
    final mimeType = _mimeType;
    final fileName = _fileName;
    _stopTracks(_stream);
    _clear(keepCompleter: true);
    try {
      if (error != null) throw error;
      if (chunks.isEmpty || mimeType == null || fileName == null) {
        if (completer != null && !completer.isCompleted) {
          completer.complete(null);
        }
        return;
      }
      final blob = web.Blob(chunks.toJS, web.BlobPropertyBag(type: mimeType));
      final bytes = await _readBlob(blob);
      if (completer != null && !completer.isCompleted) {
        completer.complete(
          VoiceRecording(
            bytes: bytes,
            fileName: fileName,
            mimeType: mimeType.split(';').first.trim(),
          ),
        );
      }
    } catch (caught, stackTrace) {
      if (completer != null && !completer.isCompleted) {
        completer.completeError(caught, stackTrace);
      }
    } finally {
      _stopCompleter = null;
    }
  }

  Future<Uint8List> _readBlob(web.Blob blob) async {
    final reader = web.FileReader();
    final completer = Completer<Uint8List>();
    reader.onloadend = ((web.ProgressEvent _) {
      final result = reader.result as JSArrayBuffer?;
      if (result == null) {
        completer.completeError(StateError('Áudio gravado sem dados.'));
      } else {
        completer.complete(result.toDart.asUint8List());
      }
    }).toJS;
    reader.onerror = ((web.ProgressEvent _) {
      completer.completeError(StateError('Falha ao ler o áudio gravado.'));
    }).toJS;
    reader.readAsArrayBuffer(blob);
    return completer.future;
  }

  String _supportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (final candidate in candidates) {
      if (web.MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    throw StateError('Nenhum formato de áudio compatível neste navegador.');
  }

  String _extensionFor(String mimeType) {
    if (mimeType.startsWith('audio/mp4')) return 'm4a';
    if (mimeType.startsWith('audio/ogg')) return 'ogg';
    return 'webm';
  }

  void _stopTracks(web.MediaStream? stream) {
    if (stream == null) return;
    for (final track in stream.getTracks().toDart) {
      track.stop();
    }
  }

  void _clear({bool keepCompleter = false}) {
    _recorder = null;
    _stream = null;
    _chunks = [];
    _mimeType = null;
    _fileName = null;
    if (!keepCompleter) _stopCompleter = null;
  }
}
