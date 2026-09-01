import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:video_player/video_player.dart';

import '../chat/media_local_file.dart';
import '../chat/media_blob.dart';
import '../chat/video_controller_factory.dart';

class StatusVisualMediaLayer {
  const StatusVisualMediaLayer({
    required this.bytes,
    required this.fileName,
    required this.mimeType,
    required this.isVideo,
    required this.alignment,
    required this.scale,
    required this.rotation,
    this.sourceUrl,
    this.sourcePath,
  });

  final Uint8List bytes;
  final String fileName;
  final String mimeType;
  final bool isVideo;
  final Alignment alignment;
  final double scale;
  final double rotation;
  final String? sourceUrl;
  final String? sourcePath;
}

class _StatusImageLayer {
  _StatusImageLayer({
    required this.bytes,
    required this.fileName,
    required this.mimeType,
    required this.alignment,
    required this.scale,
    required this.rotation,
    this.sourceUrl,
    this.sourcePath,
  }) : id = DateTime.now().microsecondsSinceEpoch.toString();

  final String id;
  final Uint8List bytes;
  final String fileName;
  final String mimeType;
  final String? sourceUrl;
  final String? sourcePath;
  Alignment alignment;
  double scale;
  double rotation;
  double scaleStart = 1;
  double rotationStart = 0;
}

class StatusVisualEditorResult {
  const StatusVisualEditorResult({
    required this.bytes,
    required this.text,
    required this.backgroundColor,
    required this.textColor,
    required this.textAlignment,
    required this.mediaAlignment,
    required this.mediaScale,
    required this.mediaRotation,
    required this.caption,
    required this.document,
    required this.mediaLayers,
    this.videoBytes,
    this.videoFileName,
    this.videoMimeType,
  });

  /// Imagem final para status de imagem ou overlay transparente para vídeo.
  final Uint8List bytes;
  final String text;
  final Color backgroundColor;
  final Color textColor;
  final Alignment textAlignment;
  final Alignment mediaAlignment;
  final double mediaScale;
  final double mediaRotation;
  final String caption;
  final Map<String, dynamic> document;
  final List<StatusVisualMediaLayer> mediaLayers;
  final Uint8List? videoBytes;
  final String? videoFileName;
  final String? videoMimeType;

  bool get isVideo => videoBytes != null && videoBytes!.isNotEmpty;
}

class StatusVisualEditorDialog extends StatefulWidget {
  const StatusVisualEditorDialog({
    super.key,
    this.initialText = '',
    this.initialCaption = '',
    this.initialDocument,
    this.initialMediaLayers = const <StatusVisualMediaLayer>[],
    this.initialBackgroundBytes,
    this.initialVideoBytes,
    this.initialVideoFileName,
    this.initialVideoMimeType,
  });

  final String initialText;
  final String initialCaption;
  final Map<String, dynamic>? initialDocument;
  final List<StatusVisualMediaLayer> initialMediaLayers;

  /// Mantido com o nome antigo por compatibilidade. A imagem agora é uma
  /// camada independente e não substitui o fundo.
  final Uint8List? initialBackgroundBytes;
  final Uint8List? initialVideoBytes;
  final String? initialVideoFileName;
  final String? initialVideoMimeType;

  @override
  State<StatusVisualEditorDialog> createState() =>
      _StatusVisualEditorDialogState();
}

enum _EditorLayer { media, text }

class _StatusVisualEditorDialogState extends State<StatusVisualEditorDialog> {
  final _previewKey = GlobalKey();
  final _overlayKey = GlobalKey();
  late final TextEditingController _text;
  late final TextEditingController _caption;
  late final TextEditingController _backgroundHex;
  late final TextEditingController _textHex;
  final _textFocus = FocusNode();
  final _captionFocus = FocusNode();

  final List<_StatusImageLayer> _imageLayers = <_StatusImageLayer>[];
  String? _selectedMediaId;
  Uint8List? _videoBytes;
  String? _videoFileName;
  String? _videoMimeType;
  String? _localVideoPath;
  String? _blobVideoUrl;
  VideoPlayerController? _videoController;
  Future<void>? _videoInitialization;
  String? _videoSourceUrl;
  String? _videoSourcePath;
  Color _backgroundColor = const Color(0xFF075E54);
  Color _textColor = Colors.white;
  Alignment _textAlignment = Alignment.center;
  Alignment _mediaAlignment = Alignment.center;
  TextAlign _textAlign = TextAlign.center;
  _EditorLayer _selectedLayer = _EditorLayer.text;
  double _fontSize = 32;
  double _textRotation = 0;
  final Map<int, Offset> _textPointers = <int, Offset>{};
  Offset _textGestureStartCenter = Offset.zero;
  double _textGestureStartDistance = 1;
  double _textGestureStartAngle = 0;
  double _textGestureStartFontSize = 32;
  double _textGestureStartRotation = 0;
  Alignment _textGestureStartAlignment = Alignment.center;
  double _mediaScale = 1;
  double _scaleStartMedia = 1;
  double _mediaRotation = 0;
  double _rotationStartMedia = 0;
  double _lastCanvasWidth = 360;
  double _lastCanvasHeight = 640;
  bool _bold = true;
  bool _italic = false;
  bool _underline = false;
  bool _toolsVisible = false;
  bool _editingBackgroundColor = true;
  bool _saving = false;
  String? _activePanel;
  String? _error;

  bool get _hasMedia => _imageLayers.isNotEmpty || _videoBytes != null;
  bool get _isVideo => _videoBytes != null;

  @override
  void initState() {
    super.initState();
    final document = widget.initialDocument ?? const <String, dynamic>{};
    _text = TextEditingController(
      text: document['text']?.toString() ?? widget.initialText,
    );
    _caption = TextEditingController(text: widget.initialCaption);
    _backgroundColor = _colorFromDocument(
      document['backgroundColor'],
      _backgroundColor,
    );
    _textColor = _colorFromDocument(document['textColor'], _textColor);
    _textAlignment = _alignmentFromDocument(
      document['textAlignment'],
      _textAlignment,
    );
    _mediaAlignment = _alignmentFromDocument(
      document['mediaAlignment'],
      _mediaAlignment,
    );
    _fontSize = _doubleFromDocument(document['fontSize'], 32).clamp(12, 110);
    _mediaScale = _doubleFromDocument(document['mediaScale'], 1).clamp(.25, 4);
    _textRotation = _doubleFromDocument(document['textRotation'], 0);
    _mediaRotation = _doubleFromDocument(document['mediaRotation'], 0);
    _bold = document['bold'] is bool ? document['bold'] as bool : true;
    _italic = document['italic'] == true;
    _underline = document['underline'] == true;
    _textAlign = switch (document['textAlign']?.toString()) {
      'left' => TextAlign.left,
      'right' => TextAlign.right,
      _ => TextAlign.center,
    };
    StatusVisualMediaLayer? initialVideo;
    for (final layer in widget.initialMediaLayers) {
      if (layer.isVideo && initialVideo == null) {
        initialVideo = layer;
      } else if (!layer.isVideo) {
        _imageLayers.add(
          _StatusImageLayer(
            bytes: layer.bytes,
            fileName: layer.fileName,
            mimeType: layer.mimeType,
            alignment: layer.alignment,
            scale: layer.scale,
            rotation: layer.rotation,
            sourceUrl: layer.sourceUrl,
            sourcePath: layer.sourcePath,
          ),
        );
      }
    }
    if (_imageLayers.isEmpty &&
        initialVideo == null &&
        widget.initialBackgroundBytes != null) {
      _imageLayers.add(
        _StatusImageLayer(
          bytes: widget.initialBackgroundBytes!,
          fileName: 'status.jpg',
          mimeType: 'image/jpeg',
          alignment: _mediaAlignment,
          scale: _mediaScale,
          rotation: _mediaRotation,
        ),
      );
    }
    if (_imageLayers.isNotEmpty ||
        initialVideo != null ||
        widget.initialVideoBytes != null) {
      _selectedLayer = _EditorLayer.media;
      _selectedMediaId = _imageLayers.isNotEmpty
          ? _imageLayers.last.id
          : 'video';
    }
    _backgroundHex = TextEditingController(
      text: _hexFromColor(_backgroundColor),
    );
    _textHex = TextEditingController(text: _hexFromColor(_textColor));
    if (initialVideo != null || widget.initialVideoBytes != null) {
      final layer = initialVideo;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          unawaited(
            _prepareVideo(
              layer?.bytes ?? widget.initialVideoBytes!,
              layer?.fileName ?? widget.initialVideoFileName ?? 'status.mp4',
              layer?.mimeType ?? widget.initialVideoMimeType ?? 'video/mp4',
              initialAlignment: layer?.alignment,
              initialScale: layer?.scale,
              initialRotation: layer?.rotation,
              sourceUrl: layer?.sourceUrl,
              sourceStoredPath: layer?.sourcePath,
            ),
          );
        }
      });
    }
  }

  @override
  void dispose() {
    _text.dispose();
    _caption.dispose();
    _backgroundHex.dispose();
    _textHex.dispose();
    _textFocus.dispose();
    _captionFocus.dispose();
    _videoController?.dispose();
    unawaited(deleteLocalMediaFile(_localVideoPath));
    revokeMediaBlobUrl(_blobVideoUrl);
    super.dispose();
  }

  String _hexFromColor(Color color) =>
      '#${color.toARGB32().toRadixString(16).padLeft(8, '0').substring(2).toUpperCase()}';

  double _doubleFromDocument(Object? value, double fallback) =>
      value is num ? value.toDouble() : double.tryParse('$value') ?? fallback;

  Color _colorFromDocument(Object? value, Color fallback) {
    if (value is int) return Color(value);
    final parsed = _colorFromHex(value?.toString() ?? '');
    return parsed ?? fallback;
  }

  Alignment _alignmentFromDocument(Object? value, Alignment fallback) {
    if (value is! Map) return fallback;
    final map = Map<String, dynamic>.from(value);
    return Alignment(
      _doubleFromDocument(map['x'], fallback.x).clamp(-1.35, 1.35),
      _doubleFromDocument(map['y'], fallback.y).clamp(-1.35, 1.35),
    );
  }

  Map<String, dynamic> _editorDocument() => {
    'version': 1,
    'text': _text.text,
    'backgroundColor': _hexFromColor(_backgroundColor),
    'textColor': _hexFromColor(_textColor),
    'textAlignment': {'x': _textAlignment.x, 'y': _textAlignment.y},
    'mediaAlignment': {'x': _mediaAlignment.x, 'y': _mediaAlignment.y},
    'textAlign': switch (_textAlign) {
      TextAlign.left => 'left',
      TextAlign.right => 'right',
      _ => 'center',
    },
    'fontSize': _fontSize,
    'mediaScale': _mediaScale,
    'textRotation': _textRotation,
    'mediaRotation': _mediaRotation,
    'bold': _bold,
    'italic': _italic,
    'underline': _underline,
    'sourceMedia': _hasMedia,
    'mediaLayers': [
      for (final layer in _imageLayers)
        {
          'type': 'image',
          'fileName': layer.fileName,
          'mimeType': layer.mimeType,
          if (layer.sourceUrl != null) 'sourceUrl': layer.sourceUrl,
          if (layer.sourcePath != null) 'sourcePath': layer.sourcePath,
          'alignment': {'x': layer.alignment.x, 'y': layer.alignment.y},
          'scale': layer.scale,
          'rotation': layer.rotation,
        },
      if (_videoBytes != null)
        {
          'type': 'video',
          'fileName': _videoFileName,
          'mimeType': _videoMimeType,
          if (_videoSourceUrl != null) 'sourceUrl': _videoSourceUrl,
          if (_videoSourcePath != null) 'sourcePath': _videoSourcePath,
          'alignment': {'x': _mediaAlignment.x, 'y': _mediaAlignment.y},
          'scale': _mediaScale,
          'rotation': _mediaRotation,
        },
    ],
  };

  Color? _colorFromHex(String value) {
    final clean = value.trim().replaceFirst('#', '');
    if (!RegExp(r'^[0-9a-fA-F]{6}$').hasMatch(clean)) return null;
    return Color(int.parse('FF$clean', radix: 16));
  }

  void _setCustomColor(Color color) {
    setState(() {
      if (_editingBackgroundColor) {
        _backgroundColor = color;
        _backgroundHex.text = _hexFromColor(color);
      } else {
        _textColor = color;
        _textHex.text = _hexFromColor(color);
      }
    });
  }

  Future<void> _pickMedia() async {
    final files = await openFiles(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem ou vídeo',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'mov',
            'webm',
            'mkv',
            'm4v',
          ],
        ),
      ],
    );
    if (files.isEmpty) return;
    final available = (12 - _imageLayers.length - (_videoBytes == null ? 0 : 1))
        .clamp(0, 12);
    for (final file in files.take(available)) {
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      final mime = file.mimeType?.toLowerCase() ?? '';
      final extension = file.name.toLowerCase().split('.').last;
      final isVideo =
          mime.startsWith('video/') ||
          const {'mp4', 'mov', 'webm', 'mkv', 'm4v'}.contains(extension);

      if (isVideo) {
        if (_videoBytes != null) {
          setState(() {
            _error =
                'Use um vídeo por composição. Você pode adicionar várias fotos junto dele.';
          });
          continue;
        }
        final resolvedMime = mime.startsWith('video/') ? mime : 'video/mp4';
        await _prepareVideo(
          bytes,
          file.name,
          resolvedMime,
          sourcePath: file.path,
        );
      } else {
        final offset = ((_imageLayers.length % 5) - 2) * .08;
        final layer = _StatusImageLayer(
          bytes: bytes,
          fileName: file.name,
          mimeType: mime.startsWith('image/') ? mime : 'image/jpeg',
          alignment: Alignment(offset, offset),
          scale: 1,
          rotation: 0,
        );
        setState(() {
          _imageLayers.add(layer);
          _selectedMediaId = layer.id;
        });
      }
    }
    if (!mounted) return;
    setState(() {
      _selectedLayer = _EditorLayer.media;
      _activePanel = null;
      _error = files.length > available
          ? 'O editor aceita até 12 camadas de mídia por composição.'
          : _error;
      _toolsVisible = true;
    });
  }

  Future<void> _prepareVideo(
    Uint8List bytes,
    String fileName,
    String mimeType, {
    String? sourcePath,
    Alignment? initialAlignment,
    double? initialScale,
    double? initialRotation,
    String? sourceUrl,
    String? sourceStoredPath,
  }) async {
    await _videoController?.dispose();
    _videoController = null;
    _videoInitialization = null;
    await deleteLocalMediaFile(_localVideoPath);
    _localVideoPath = null;
    revokeMediaBlobUrl(_blobVideoUrl);
    _blobVideoUrl = null;
    String source = sourcePath ?? '';
    var localFile = false;
    if (!kIsWeb) {
      source = await createLocalMediaFile(bytes, mimeType, fileName) ?? source;
      _localVideoPath = source;
      localFile = true;
    } else if (source.isEmpty) {
      source = createMediaBlobUrl(bytes, mimeType) ?? '';
      _blobVideoUrl = source;
    }
    if (source.isEmpty) {
      throw StateError('Não foi possível preparar a prévia do vídeo.');
    }
    final controller = createVideoController(
      url: source,
      isLocalFile: localFile,
    );
    _videoController = controller;
    _videoInitialization = controller.initialize().then((_) async {
      await controller.setLooping(true);
      await controller.setVolume(0);
      await controller.play();
      if (mounted) setState(() {});
    });
    if (!mounted) return;
    setState(() {
      _videoBytes = bytes;
      _videoFileName = fileName;
      _videoMimeType = mimeType;
      _videoSourceUrl = sourceUrl;
      _videoSourcePath = sourceStoredPath;
      _mediaAlignment = initialAlignment ?? Alignment.center;
      _mediaScale = initialScale ?? 1;
      _mediaRotation = initialRotation ?? 0;
      _selectedLayer = _EditorLayer.media;
      _selectedMediaId = 'video';
    });
  }

  void _removeSelectedMedia() {
    final selectedId = _selectedMediaId;
    if (selectedId != null && selectedId != 'video') {
      setState(() {
        _imageLayers.removeWhere((layer) => layer.id == selectedId);
        _selectedMediaId = _imageLayers.isNotEmpty
            ? _imageLayers.last.id
            : _videoBytes != null
            ? 'video'
            : null;
        if (_selectedMediaId == null) _selectedLayer = _EditorLayer.text;
      });
      return;
    }
    if (_videoBytes == null) return;
    unawaited(_videoController?.dispose());
    _videoController = null;
    _videoInitialization = null;
    unawaited(deleteLocalMediaFile(_localVideoPath));
    revokeMediaBlobUrl(_blobVideoUrl);
    setState(() {
      _videoBytes = null;
      _videoFileName = null;
      _videoMimeType = null;
      _localVideoPath = null;
      _blobVideoUrl = null;
      _videoSourceUrl = null;
      _videoSourcePath = null;
      _selectedMediaId = _imageLayers.isNotEmpty ? _imageLayers.last.id : null;
      _selectedLayer = _selectedMediaId == null
          ? _EditorLayer.text
          : _EditorLayer.media;
      _mediaAlignment = Alignment.center;
      _mediaScale = 1;
      _mediaRotation = 0;
    });
  }

  void _openTextTools() {
    setState(() {
      _toolsVisible = true;
      _selectedLayer = _EditorLayer.text;
      _activePanel = 'text';
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _textFocus.requestFocus();
    });
  }

  void _openCaptionTools() {
    setState(() {
      _toolsVisible = true;
      _activePanel = 'caption';
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _captionFocus.requestFocus();
    });
  }

  void _openColorTools({required bool background}) {
    FocusScope.of(context).unfocus();
    setState(() {
      _toolsVisible = true;
      _editingBackgroundColor = background;
      _activePanel = 'color';
    });
  }

  Future<Uint8List> _capture(GlobalKey key) async {
    final boundary =
        key.currentContext?.findRenderObject() as RenderRepaintBoundary?;
    if (boundary == null) throw StateError('Prévia ainda não está pronta.');
    final pixelRatio = (1080 / _lastCanvasWidth).clamp(1.0, 4.0);
    final image = await boundary.toImage(pixelRatio: pixelRatio);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (data == null) throw StateError('Não foi possível gerar a mídia.');
    return data.buffer.asUint8List();
  }

  Future<void> _finish() async {
    if (_text.text.trim().isEmpty && !_hasMedia) {
      setState(
        () => _error = 'Adicione um texto, uma imagem ou um vídeo ao status.',
      );
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _toolsVisible = false;
      _activePanel = null;
      _error = null;
    });
    try {
      await WidgetsBinding.instance.endOfFrame;
      final bytes = await _capture(_isVideo ? _overlayKey : _previewKey);
      if (!mounted) return;
      Navigator.of(context).pop(
        StatusVisualEditorResult(
          bytes: bytes,
          text: _text.text.trim(),
          backgroundColor: _backgroundColor,
          textColor: _textColor,
          textAlignment: _textAlignment,
          mediaAlignment: _mediaAlignment,
          mediaScale: _mediaScale,
          mediaRotation: _mediaRotation,
          caption: _caption.text.trim(),
          document: _editorDocument(),
          mediaLayers: [
            for (final layer in _imageLayers)
              StatusVisualMediaLayer(
                bytes: layer.bytes,
                fileName: layer.fileName,
                mimeType: layer.mimeType,
                isVideo: false,
                alignment: layer.alignment,
                scale: layer.scale,
                rotation: layer.rotation,
                sourceUrl: layer.sourceUrl,
                sourcePath: layer.sourcePath,
              ),
            if (_videoBytes != null)
              StatusVisualMediaLayer(
                bytes: _videoBytes!,
                fileName: _videoFileName ?? 'status.mp4',
                mimeType: _videoMimeType ?? 'video/mp4',
                isVideo: true,
                alignment: _mediaAlignment,
                scale: _mediaScale,
                rotation: _mediaRotation,
                sourceUrl: _videoSourceUrl,
                sourcePath: _videoSourcePath,
              ),
          ],
          videoBytes: _videoBytes,
          videoFileName: _videoFileName,
          videoMimeType: _videoMimeType,
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.toString().replaceFirst('Bad state: ', '');
      });
    }
  }

  Widget _mediaFrame({
    required String id,
    required Widget content,
    required bool selected,
    required double canvasWidth,
    required double canvasHeight,
  }) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 100),
          width: canvasWidth * .62,
          height: canvasHeight * .42,
          decoration: BoxDecoration(
            border: selected
                ? Border.all(color: const Color(0xFF25D366), width: 2.5)
                : null,
            borderRadius: BorderRadius.circular(8),
          ),
          padding: selected ? const EdgeInsets.all(3) : EdgeInsets.zero,
          child: content,
        ),
        if (selected)
          Positioned(
            top: 6,
            right: 6,
            child: IconButton.filled(
              key: const Key('status-editor-remove-selected-media'),
              tooltip: 'Remover esta mídia',
              style: IconButton.styleFrom(
                backgroundColor: const Color(0xFFD92D20),
                foregroundColor: Colors.white,
                minimumSize: const Size.square(38),
                padding: EdgeInsets.zero,
              ),
              onPressed: () {
                _selectedMediaId = id;
                _removeSelectedMedia();
              },
              icon: const Icon(Icons.close_rounded, size: 22),
            ),
          ),
      ],
    );
  }

  Widget _buildImageMedia(
    _StatusImageLayer layer,
    double canvasWidth,
    double canvasHeight,
  ) {
    final selected =
        !_saving &&
        _selectedLayer == _EditorLayer.media &&
        _selectedMediaId == layer.id;
    return Align(
      alignment: layer.alignment,
      child: Transform.rotate(
        key: Key('status-editor-media-rotation-${layer.id}'),
        angle: layer.rotation,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => setState(() {
            _selectedLayer = _EditorLayer.media;
            _selectedMediaId = layer.id;
            _toolsVisible = true;
            _activePanel = null;
          }),
          onScaleStart: (_) {
            layer.scaleStart = layer.scale;
            layer.rotationStart = layer.rotation;
          },
          onScaleUpdate: (details) {
            setState(() {
              _selectedLayer = _EditorLayer.media;
              _selectedMediaId = layer.id;
              layer.alignment = Alignment(
                (layer.alignment.x +
                        details.focalPointDelta.dx / (canvasWidth / 2))
                    .clamp(-1.45, 1.45),
                (layer.alignment.y +
                        details.focalPointDelta.dy / (canvasHeight / 2))
                    .clamp(-1.45, 1.45),
              );
              if (details.pointerCount > 1) {
                layer.scale = (layer.scaleStart * details.scale).clamp(.2, 4);
                layer.rotation = layer.rotationStart + details.rotation;
              }
            });
          },
          child: Transform.scale(
            scale: layer.scale,
            child: _mediaFrame(
              id: layer.id,
              selected: selected,
              canvasWidth: canvasWidth,
              canvasHeight: canvasHeight,
              content: Image.memory(
                layer.bytes,
                fit: BoxFit.contain,
                gaplessPlayback: true,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildVideoMedia(double canvasWidth, double canvasHeight) {
    final selected =
        !_saving &&
        _selectedLayer == _EditorLayer.media &&
        _selectedMediaId == 'video';
    final content = FutureBuilder<void>(
      future: _videoInitialization,
      builder: (context, snapshot) {
        final controller = _videoController;
        if (controller != null && controller.value.isInitialized) {
          return FittedBox(
            fit: BoxFit.contain,
            child: SizedBox(
              width: controller.value.size.width,
              height: controller.value.size.height,
              child: VideoPlayer(controller),
            ),
          );
        }
        if (snapshot.hasError) {
          return const Center(
            child: Icon(
              Icons.videocam_off_rounded,
              color: Colors.white,
              size: 54,
            ),
          );
        }
        return const Center(
          child: CircularProgressIndicator(color: Colors.white),
        );
      },
    );
    return Align(
      alignment: _mediaAlignment,
      child: Transform.rotate(
        key: const Key('status-editor-media-rotation-video'),
        angle: _mediaRotation,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => setState(() {
            _selectedLayer = _EditorLayer.media;
            _selectedMediaId = 'video';
            _toolsVisible = true;
            _activePanel = null;
          }),
          onScaleStart: (_) {
            _scaleStartMedia = _mediaScale;
            _rotationStartMedia = _mediaRotation;
          },
          onScaleUpdate: (details) {
            setState(() {
              _selectedLayer = _EditorLayer.media;
              _selectedMediaId = 'video';
              _mediaAlignment = Alignment(
                (_mediaAlignment.x +
                        details.focalPointDelta.dx / (canvasWidth / 2))
                    .clamp(-1.45, 1.45),
                (_mediaAlignment.y +
                        details.focalPointDelta.dy / (canvasHeight / 2))
                    .clamp(-1.45, 1.45),
              );
              if (details.pointerCount > 1) {
                _mediaScale = (_scaleStartMedia * details.scale).clamp(.2, 4);
                _mediaRotation = _rotationStartMedia + details.rotation;
              }
            });
          },
          child: Transform.scale(
            scale: _mediaScale,
            child: _mediaFrame(
              id: 'video',
              selected: selected,
              canvasWidth: canvasWidth,
              canvasHeight: canvasHeight,
              content: content,
            ),
          ),
        ),
      ),
    );
  }

  void _beginTextMultiTouch() {
    if (_textPointers.length < 2) return;
    final points = _textPointers.values.take(2).toList(growable: false);
    final delta = points[1] - points[0];
    _textGestureStartCenter = Offset(
      (points[0].dx + points[1].dx) / 2,
      (points[0].dy + points[1].dy) / 2,
    );
    _textGestureStartDistance = math.max(1, delta.distance);
    _textGestureStartAngle = math.atan2(delta.dy, delta.dx);
    _textGestureStartFontSize = _fontSize;
    _textGestureStartRotation = _textRotation;
    _textGestureStartAlignment = _textAlignment;
  }

  void _handleTextPointerDown(PointerDownEvent event) {
    _textPointers[event.pointer] = event.position;
    if (_textPointers.length == 2) _beginTextMultiTouch();
    if (mounted) {
      setState(() {
        _selectedLayer = _EditorLayer.text;
        _selectedMediaId = null;
      });
    }
  }

  void _handleTextPointerMove(PointerMoveEvent event) {
    if (!_textPointers.containsKey(event.pointer)) return;
    final previous = _textPointers[event.pointer]!;
    _textPointers[event.pointer] = event.position;
    if (_textPointers.length >= 2) {
      final points = _textPointers.values.take(2).toList(growable: false);
      final delta = points[1] - points[0];
      final center = Offset(
        (points[0].dx + points[1].dx) / 2,
        (points[0].dy + points[1].dy) / 2,
      );
      var angleDelta = math.atan2(delta.dy, delta.dx) - _textGestureStartAngle;
      while (angleDelta > math.pi) {
        angleDelta -= math.pi * 2;
      }
      while (angleDelta < -math.pi) {
        angleDelta += math.pi * 2;
      }
      setState(() {
        _fontSize =
            (_textGestureStartFontSize *
                    (delta.distance / _textGestureStartDistance))
                .clamp(12, 110);
        _textRotation = _textGestureStartRotation + angleDelta;
        _textAlignment = Alignment(
          (_textGestureStartAlignment.x +
                  (center.dx - _textGestureStartCenter.dx) /
                      (_lastCanvasWidth / 2))
              .clamp(-1.15, 1.15),
          (_textGestureStartAlignment.y +
                  (center.dy - _textGestureStartCenter.dy) /
                      (_lastCanvasHeight / 2))
              .clamp(-1.15, 1.15),
        );
      });
      return;
    }
    final movement = event.position - previous;
    setState(() {
      _textAlignment = Alignment(
        (_textAlignment.x + movement.dx / (_lastCanvasWidth / 2)).clamp(
          -1.15,
          1.15,
        ),
        (_textAlignment.y + movement.dy / (_lastCanvasHeight / 2)).clamp(
          -1.15,
          1.15,
        ),
      );
    });
  }

  void _handleTextPointerEnd(PointerEvent event) {
    _textPointers.remove(event.pointer);
    if (_textPointers.length >= 2) {
      _beginTextMultiTouch();
    } else {}
  }

  Widget _buildTextLayer(double canvasWidth, double canvasHeight) {
    final selected = !_saving && _selectedLayer == _EditorLayer.text;
    return Align(
      alignment: _textAlignment,
      child: Transform.rotate(
        key: const Key('status-editor-text-rotation'),
        angle: _textRotation,
        child: Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: _handleTextPointerDown,
          onPointerMove: _handleTextPointerMove,
          onPointerUp: _handleTextPointerEnd,
          onPointerCancel: _handleTextPointerEnd,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _openTextTools,
            child: Container(
              constraints: BoxConstraints(
                minWidth: canvasWidth * (selected ? .82 : .24),
                minHeight: selected ? (canvasHeight * .15).clamp(112, 170) : 54,
                maxWidth: canvasWidth * .92,
              ),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: selected
                  ? BoxDecoration(
                      border: Border.all(color: const Color(0xFF25D366)),
                      borderRadius: BorderRadius.circular(6),
                    )
                  : null,
              child: ValueListenableBuilder<TextEditingValue>(
                valueListenable: _text,
                builder: (context, value, _) => Text(
                  value.text.trim().isEmpty
                      ? (_saving ? '' : 'Toque para escrever')
                      : value.text,
                  textAlign: _textAlign,
                  style: TextStyle(
                    color: value.text.trim().isEmpty
                        ? Colors.white70
                        : _textColor,
                    fontSize: _fontSize,
                    height: 1.15,
                    fontWeight: _bold ? FontWeight.w800 : FontWeight.w500,
                    fontStyle: _italic ? FontStyle.italic : FontStyle.normal,
                    decoration: _underline
                        ? TextDecoration.underline
                        : TextDecoration.none,
                    decorationColor: _textColor,
                    shadows: const [
                      Shadow(
                        color: Color(0xAA000000),
                        blurRadius: 6,
                        offset: Offset(0, 1),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCanvas(double availableWidth, double availableHeight) {
    final safeWidth = availableWidth.clamp(1.0, double.infinity);
    final safeHeight = availableHeight.clamp(1.0, double.infinity);
    var canvasWidth = safeWidth;
    var canvasHeight = canvasWidth * 16 / 9;
    if (canvasHeight > safeHeight) {
      canvasHeight = safeHeight;
      canvasWidth = canvasHeight * 9 / 16;
    }
    _lastCanvasWidth = canvasWidth;
    _lastCanvasHeight = canvasHeight;

    return Center(
      child: SizedBox(
        width: canvasWidth,
        height: canvasHeight,
        child: Stack(
          fit: StackFit.expand,
          children: [
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => setState(() {
                _toolsVisible = !_toolsVisible;
                if (!_toolsVisible) _activePanel = null;
              }),
              child: RepaintBoundary(
                key: _previewKey,
                child: ColoredBox(
                  color: _backgroundColor,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (_videoBytes != null)
                        _buildVideoMedia(canvasWidth, canvasHeight),
                      RepaintBoundary(
                        key: _overlayKey,
                        child: SizedBox.expand(
                          child: Stack(
                            children: [
                              for (final layer in _imageLayers)
                                _buildImageMedia(
                                  layer,
                                  canvasWidth,
                                  canvasHeight,
                                ),
                              // Enquanto uma mídia está selecionada, ela e o
                              // botão de remoção precisam receber os toques.
                              // O texto continua visível e volta a ser
                              // interativo ao tocar na ferramenta "Texto".
                              IgnorePointer(
                                ignoring: _selectedLayer == _EditorLayer.media,
                                child: _buildTextLayer(
                                  canvasWidth,
                                  canvasHeight,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            ValueListenableBuilder<TextEditingValue>(
              valueListenable: _caption,
              builder: (context, value, _) {
                if (value.text.trim().isEmpty && _saving) {
                  return const SizedBox.shrink();
                }
                return Positioned(
                  left: 14,
                  right: 14,
                  bottom: 18,
                  child: GestureDetector(
                    onTap: _openCaptionTools,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: .62),
                        borderRadius: BorderRadius.circular(18),
                        border: _activePanel == 'caption'
                            ? Border.all(color: const Color(0xFF25D366))
                            : null,
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 11,
                        ),
                        child: Text(
                          value.text.trim().isEmpty
                              ? 'Adicionar legenda'
                              : value.text,
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: value.text.trim().isEmpty
                                ? Colors.white60
                                : Colors.white,
                            fontSize: 15,
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _toolButton({
    required String tooltip,
    required IconData icon,
    required VoidCallback? onPressed,
    bool active = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: IconButton.filledTonal(
        tooltip: tooltip,
        onPressed: onPressed,
        style: IconButton.styleFrom(
          backgroundColor: active ? const Color(0xFF25D366) : Colors.white12,
          foregroundColor: active ? Colors.black : Colors.white,
        ),
        icon: Icon(icon),
      ),
    );
  }

  Widget _buildTopToolbar() {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                IconButton.filled(
                  tooltip: _toolsVisible
                      ? 'Ocultar ferramentas'
                      : 'Editar status',
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.black.withValues(alpha: .62),
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () => setState(() {
                    _toolsVisible = !_toolsVisible;
                    if (!_toolsVisible) _activePanel = null;
                  }),
                  icon: Icon(
                    _toolsVisible
                        ? Icons.expand_less_rounded
                        : Icons.edit_rounded,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _selectedLayer == _EditorLayer.media
                        ? 'Editando mídia · ${_imageLayers.length + (_videoBytes == null ? 0 : 1)} camada(s)'
                        : 'Editando texto',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ),
                IconButton.filled(
                  tooltip: 'Concluir',
                  style: IconButton.styleFrom(
                    backgroundColor: const Color(0xFF25D366),
                    foregroundColor: Colors.black,
                  ),
                  onPressed: _saving ? null : _finish,
                  icon: _saving
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check_rounded),
                ),
                const SizedBox(width: 6),
                IconButton.filled(
                  tooltip: 'Fechar',
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.black.withValues(alpha: .62),
                    foregroundColor: Colors.white,
                  ),
                  onPressed: _saving ? null : () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            if (_toolsVisible) ...[
              const SizedBox(height: 7),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: .74),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: SizedBox(
                  height: 54,
                  child: SingleChildScrollView(
                    key: const Key('status-editor-top-tools'),
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 5,
                    ),
                    child: Row(
                      children: [
                        _toolButton(
                          tooltip: 'Texto',
                          icon: Icons.text_fields_rounded,
                          onPressed: _openTextTools,
                          active: _selectedLayer == _EditorLayer.text,
                        ),
                        _toolButton(
                          tooltip: 'Legenda inferior',
                          icon: Icons.subtitles_rounded,
                          onPressed: _openCaptionTools,
                          active: _activePanel == 'caption',
                        ),
                        _toolButton(
                          tooltip: 'Adicionar várias imagens ou um vídeo',
                          icon: Icons.add_photo_alternate_outlined,
                          onPressed: _pickMedia,
                        ),
                        if (_hasMedia)
                          _toolButton(
                            tooltip: 'Selecionar camada da mídia',
                            icon: Icons.layers_rounded,
                            onPressed: () => setState(() {
                              _selectedLayer = _EditorLayer.media;
                              _selectedMediaId ??= _imageLayers.isNotEmpty
                                  ? _imageLayers.last.id
                                  : _videoBytes != null
                                  ? 'video'
                                  : null;
                              _activePanel = null;
                            }),
                            active: _selectedLayer == _EditorLayer.media,
                          ),
                        if (_hasMedia)
                          _toolButton(
                            tooltip: 'Remover mídia',
                            icon: Icons.delete_outline_rounded,
                            onPressed: _removeSelectedMedia,
                          ),
                        _toolButton(
                          tooltip: 'Cor do fundo',
                          icon: Icons.format_color_fill_rounded,
                          onPressed: () => _openColorTools(background: true),
                        ),
                        _toolButton(
                          tooltip: 'Cor do texto',
                          icon: Icons.format_color_text_rounded,
                          onPressed: () => _openColorTools(background: false),
                        ),
                        _toolButton(
                          tooltip: 'Negrito',
                          icon: Icons.format_bold_rounded,
                          onPressed: () => setState(() => _bold = !_bold),
                          active: _bold,
                        ),
                        _toolButton(
                          tooltip: 'Itálico',
                          icon: Icons.format_italic_rounded,
                          onPressed: () => setState(() => _italic = !_italic),
                          active: _italic,
                        ),
                        _toolButton(
                          tooltip: 'Sublinhado',
                          icon: Icons.format_underlined_rounded,
                          onPressed: () =>
                              setState(() => _underline = !_underline),
                          active: _underline,
                        ),
                        _toolButton(
                          tooltip: 'Alinhar texto',
                          icon: _textAlign == TextAlign.left
                              ? Icons.format_align_left_rounded
                              : _textAlign == TextAlign.right
                              ? Icons.format_align_right_rounded
                              : Icons.format_align_center_rounded,
                          onPressed: () => setState(() {
                            _textAlign = switch (_textAlign) {
                              TextAlign.left => TextAlign.center,
                              TextAlign.center => TextAlign.right,
                              _ => TextAlign.left,
                            };
                          }),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildTextPanel() {
    return SafeArea(
      child: Align(
        alignment: Alignment.topCenter,
        child: Container(
          margin: const EdgeInsets.fromLTRB(12, 126, 12, 0),
          constraints: const BoxConstraints(maxWidth: 720),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: .82),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _text,
                focusNode: _textFocus,
                autofocus: true,
                minLines: 1,
                maxLines: 4,
                inputFormatters: [LengthLimitingTextInputFormatter(700)],
                style: const TextStyle(color: Colors.white, fontSize: 18),
                decoration: InputDecoration(
                  hintText: 'Digite o texto do status',
                  hintStyle: const TextStyle(color: Colors.white60),
                  filled: true,
                  fillColor: Colors.white12,
                  suffixIcon: IconButton(
                    tooltip: 'Fechar edição de texto',
                    onPressed: () {
                      FocusScope.of(context).unfocus();
                      setState(() => _activePanel = null);
                    },
                    icon: const Icon(Icons.done_rounded, color: Colors.white),
                  ),
                ),
              ),
              Row(
                children: [
                  const Icon(Icons.text_decrease_rounded, color: Colors.white),
                  Expanded(
                    child: Slider(
                      value: _fontSize,
                      min: 12,
                      max: 110,
                      divisions: 49,
                      label: '${_fontSize.round()} px',
                      onChanged: (value) => setState(() => _fontSize = value),
                    ),
                  ),
                  const Icon(Icons.text_increase_rounded, color: Colors.white),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCaptionPanel() {
    return SafeArea(
      child: Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          margin: EdgeInsets.fromLTRB(
            12,
            0,
            12,
            MediaQuery.viewInsetsOf(context).bottom + 12,
          ),
          constraints: const BoxConstraints(maxWidth: 720),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: .88),
            borderRadius: BorderRadius.circular(18),
          ),
          child: TextField(
            controller: _caption,
            focusNode: _captionFocus,
            autofocus: true,
            minLines: 1,
            maxLines: 4,
            inputFormatters: [LengthLimitingTextInputFormatter(700)],
            style: const TextStyle(color: Colors.white, fontSize: 16),
            decoration: InputDecoration(
              hintText: 'Legenda exibida na parte inferior do status',
              hintStyle: const TextStyle(color: Colors.white60),
              filled: true,
              fillColor: Colors.white12,
              prefixIcon: const Icon(
                Icons.subtitles_rounded,
                color: Colors.white70,
              ),
              suffixIcon: IconButton(
                tooltip: 'Concluir legenda',
                onPressed: () {
                  FocusScope.of(context).unfocus();
                  setState(() => _activePanel = null);
                },
                icon: const Icon(Icons.done_rounded, color: Colors.white),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildColorPanel() {
    final color = _editingBackgroundColor ? _backgroundColor : _textColor;
    final hsv = HSVColor.fromColor(color);
    final hexController = _editingBackgroundColor ? _backgroundHex : _textHex;
    return SafeArea(
      child: Align(
        alignment: Alignment.topCenter,
        child: Container(
          margin: const EdgeInsets.fromLTRB(12, 126, 12, 0),
          constraints: const BoxConstraints(maxWidth: 620),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: .86),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(value: true, label: Text('Fundo')),
                        ButtonSegment(value: false, label: Text('Texto')),
                      ],
                      selected: {_editingBackgroundColor},
                      onSelectionChanged: (value) =>
                          setState(() => _editingBackgroundColor = value.first),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              _ColorSlider(
                label: 'Tom',
                value: hsv.hue,
                max: 360,
                gradient: const LinearGradient(
                  colors: [
                    Colors.red,
                    Colors.yellow,
                    Colors.green,
                    Colors.cyan,
                    Colors.blue,
                    Colors.purple,
                    Colors.red,
                  ],
                ),
                onChanged: (value) =>
                    _setCustomColor(hsv.withHue(value).toColor()),
              ),
              _ColorSlider(
                label: 'Intensidade',
                value: hsv.saturation,
                max: 1,
                gradient: LinearGradient(
                  colors: [Colors.white, hsv.withSaturation(1).toColor()],
                ),
                onChanged: (value) =>
                    _setCustomColor(hsv.withSaturation(value).toColor()),
              ),
              _ColorSlider(
                label: 'Brilho',
                value: hsv.value,
                max: 1,
                gradient: LinearGradient(
                  colors: [Colors.black, hsv.withValue(1).toColor()],
                ),
                onChanged: (value) =>
                    _setCustomColor(hsv.withValue(value).toColor()),
              ),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: hexController,
                      inputFormatters: [LengthLimitingTextInputFormatter(7)],
                      textCapitalization: TextCapitalization.characters,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'Cor hexadecimal',
                        hintText: '#25D366',
                        prefixIcon: Icon(Icons.tag_rounded),
                      ),
                      onChanged: (value) {
                        final parsed = _colorFromHex(value);
                        if (parsed != null) _setCustomColor(parsed);
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filledTonal(
                    tooltip: 'Aplicar e fechar',
                    onPressed: () => setState(() => _activePanel = null),
                    icon: const Icon(Icons.done_rounded),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog.fullscreen(
      child: Scaffold(
        backgroundColor: Colors.black,
        resizeToAvoidBottomInset: false,
        body: LayoutBuilder(
          builder: (context, constraints) => Stack(
            fit: StackFit.expand,
            children: [
              _buildCanvas(constraints.maxWidth, constraints.maxHeight),
              if (_toolsVisible)
                IgnorePointer(
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 24),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: .62),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        _selectedLayer == _EditorLayer.media
                            ? 'Arraste · pince para zoom · gire com dois dedos em 360°'
                            : 'Arraste · pince para tamanho · gire com dois dedos em 360°',
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                  ),
                ),
              _buildTopToolbar(),
              if (_activePanel == 'text') _buildTextPanel(),
              if (_activePanel == 'caption') _buildCaptionPanel(),
              if (_activePanel == 'color') _buildColorPanel(),
              if (_error != null)
                SafeArea(
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Container(
                      margin: const EdgeInsets.all(18),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFB3261E),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ColorSlider extends StatelessWidget {
  const _ColorSlider({
    required this.label,
    required this.value,
    required this.max,
    required this.gradient,
    required this.onChanged,
  });

  final String label;
  final double value;
  final double max;
  final Gradient gradient;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 84,
          child: Text(label, style: const TextStyle(color: Colors.white)),
        ),
        Expanded(
          child: Container(
            height: 18,
            decoration: BoxDecoration(
              gradient: gradient,
              borderRadius: BorderRadius.circular(999),
            ),
            child: SliderTheme(
              data: SliderTheme.of(context).copyWith(
                activeTrackColor: Colors.transparent,
                inactiveTrackColor: Colors.transparent,
                trackHeight: 18,
                thumbColor: Colors.white,
                overlayColor: Colors.white12,
              ),
              child: Slider(
                value: value.clamp(0.0, max),
                min: 0,
                max: max,
                onChanged: onChanged,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
