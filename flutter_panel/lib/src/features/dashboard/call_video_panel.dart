import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/media_library.dart';
import '../../core/wa_theme.dart';
import '../../models/bot_instance.dart';

/// Transmite um vídeo (com o áudio original) dentro de uma videochamada atendida.
/// O arquivo é enviado e validado na EasyZap; aqui só aparecem controles que o
/// servidor realmente executa: transmitir, pausar/retomar, parar e alternar
/// entre o áudio do vídeo e o microfone.
Future<void> showCallVideoPanel(
  BuildContext context, {
  required BotInstance instance,
  required String callId,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) => _CallVideoPanel(instance: instance, callId: callId),
  );
}

class _CallVideoPanel extends ConsumerStatefulWidget {
  const _CallVideoPanel({required this.instance, required this.callId});

  final BotInstance instance;
  final String callId;

  @override
  ConsumerState<_CallVideoPanel> createState() => _CallVideoPanelState();
}

class _CallVideoPanelState extends ConsumerState<_CallVideoPanel> {
  List<Map<String, dynamic>> _library = const [];
  Map<String, dynamic>? _selected;
  Map<String, dynamic>? _player;
  final _urlController = TextEditingController();
  Timer? _poll;
  bool _loadingLibrary = true;
  bool _preparing = false;
  bool _acting = false;
  bool _statusInFlight = false;
  int _statusRevision = 0;
  bool _loop = false;
  bool _direct = false;
  String _audio = 'media';
  String _quality = 'medium';
  int _fps = 20;
  bool _initializedPlayerOptions = false;
  String? _error;
  String? _progress;

  BotAdminApiClient get _api => ref.read(apiClientProvider);

  @override
  void initState() {
    super.initState();
    _loadLibrary();
    _refreshStatus();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _refreshStatus());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _loadLibrary() async {
    try {
      final items = await _api.callVideoLibrary(widget.instance);
      if (!mounted) return;
      setState(() {
        _library = items;
        _loadingLibrary = false;
        _selectCurrentPlayer();
      });
    } catch (e) {
      if (mounted)
        setState(() {
          _loadingLibrary = false;
          _error = _clean(e);
        });
    }
  }

  Future<void> _refreshStatus() async {
    if (_statusInFlight || _acting) return;
    _statusInFlight = true;
    final revision = _statusRevision;
    try {
      final player = await _api.callVideoAction(
        widget.instance,
        action: 'video_status',
        callId: widget.callId,
      );
      if (!mounted || revision != _statusRevision) return;
      setState(() {
        _player = player;
        _selectCurrentPlayer();
      });
    } catch (e) {
      if (!mounted || revision != _statusRevision) return;
      if (e is BotAdminApiException && e.statusCode == 410) {
        _poll?.cancel();
        setState(() {
          _player = null;
          _error = 'A ligação foi encerrada.';
        });
      }
    } finally {
      _statusInFlight = false;
    }
  }

  void _selectCurrentPlayer() {
    if (_initializedPlayerOptions || _selected != null || _player == null)
      return;
    final id = _player!['mediaId'];
    final matches = _library.where((item) => item['mediaId'] == id);
    if (matches.isEmpty) return;
    _selected = matches.first;
    _initializedPlayerOptions = true;
    _loop = _player!['loop'] == true;
    final quality = _player!['quality'];
    if (quality == 'low' || quality == 'medium' || quality == 'high')
      _quality = quality as String;
    _audio = _player!['audioMode'] == 'mic' ? 'mic' : 'media';
    final fps = (_player!['targetFps'] as num?)?.toInt();
    if ([15, 20, 24, 30].contains(fps)) _fps = fps!;
  }

  String _clean(Object error) =>
      error.toString().replaceFirst('Exception: ', '');

  Future<void> _pickFile() async {
    final file = await chooseMediaFile(
      context,
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Vídeo',
          extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', '3gp'],
          mimeTypes: ['video/*'],
        ),
      ],
    );
    if (file == null || !mounted) return;
    setState(() {
      _preparing = true;
      _error = null;
      _progress = 'Enviando e preparando o vídeo…';
    });
    try {
      final bytes = await file.readAsBytes();
      final media = await _api.callVideoUpload(
        widget.instance,
        bytes: bytes,
        fileName: file.name,
        mimeType: file.mimeType,
      );
      if (!mounted) return;
      setState(() => _selected = media);
      unawaited(_loadLibrary());
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    } finally {
      if (mounted) {
        setState(() {
          _preparing = false;
          _progress = null;
        });
      }
    }
  }

  Future<void> _prepareUrl() async {
    final link = _urlController.text.trim();
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(link)) {
      setState(
        () => _error =
            'Cole um link http ou https que aponte para o arquivo de vídeo.',
      );
      return;
    }
    setState(() {
      _preparing = true;
      _error = null;
      _progress = 'Baixando e preparando o vídeo…';
    });
    try {
      final result = await _api.callVideoPrepareLink(
        widget.instance,
        link,
        stream: _direct,
      );
      final media = Map<String, dynamic>.from(result['media'] as Map);
      if (!mounted) return;
      setState(() {
        _selected = media;
        _urlController.clear();
      });
      unawaited(_loadLibrary());
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    } finally {
      if (mounted) {
        setState(() {
          _preparing = false;
          _progress = null;
        });
      }
    }
  }

  Future<void> _run(String action, {String? mediaId, String? audio}) async {
    if (_acting) return;
    _statusRevision++;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      final player = await _api.callVideoAction(
        widget.instance,
        action: action,
        callId: widget.callId,
        mediaId: mediaId,
        loop: _loop,
        audio: audio ?? _audio,
        quality: _quality,
        fps: _fps,
        replace: true,
      );
      if (mounted) setState(() => _player = player);
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  String _fmt(num seconds) {
    final s = seconds.round();
    return '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
  }

  bool get _hasPlayer {
    final state = '${_player?['state'] ?? ''}';
    return _player != null && state != 'stopped';
  }

  String _stateLabel(String state) => switch (state) {
    'starting' => 'Iniciando…',
    'playing' => 'Transmitindo',
    'paused' => 'Pausado',
    'ended' => 'Terminou',
    'error' => 'Erro',
    'waiting_answer' => 'Aguardando atender',
    _ => state,
  };

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final scheme = Theme.of(context).colorScheme;
    final media = _selected;
    final player = _hasPlayer ? _player : null;
    final state = '${player?['state'] ?? ''}';
    final live = state == 'playing' || state == 'starting' || state == 'paused';
    return AlertDialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      title: const Text('Vídeo na chamada'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (live || state == 'ended' || state == 'error') ...[
                _StatusCard(
                  title: '${player?['name'] ?? 'Vídeo'}',
                  label: _stateLabel(state),
                  position: (player?['positionSec'] as num?)?.toDouble() ?? 0,
                  duration: (player?['durationSec'] as num?)?.toDouble() ?? 0,
                  details: [
                    if ((player?['encodedFps'] as num?) != null &&
                        state == 'playing')
                      '${(player!['encodedFps'] as num).toStringAsFixed(0)} fps',
                    if ((player?['sentKbps'] as num?) != null &&
                        state == 'playing')
                      '${(player!['sentKbps'] as num).toStringAsFixed(0)} kbps',
                    if (player?['audioMode'] == 'mic')
                      'microfone'
                    else if (player?['hasAudio'] == true)
                      'áudio do vídeo',
                  ],
                  error: '${player?['error'] ?? ''}',
                  fmt: _fmt,
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (state == 'paused')
                      FilledButton.icon(
                        onPressed: _acting ? null : () => _run('resume_video'),
                        icon: const Icon(Icons.play_arrow_rounded),
                        label: const Text('Retomar'),
                      )
                    else if (live)
                      FilledButton.tonalIcon(
                        onPressed: _acting ? null : () => _run('pause_video'),
                        icon: const Icon(Icons.pause_rounded),
                        label: const Text('Pausar'),
                      ),
                    if (live)
                      OutlinedButton.icon(
                        onPressed: _acting ? null : () => _run('stop_video'),
                        icon: const Icon(Icons.stop_rounded),
                        label: const Text('Parar'),
                      ),
                    if (live && player?['hasAudio'] == true)
                      OutlinedButton.icon(
                        onPressed: _acting
                            ? null
                            : () => _run(
                                'video_audio',
                                audio: player?['audioMode'] == 'mic'
                                    ? 'media'
                                    : 'mic',
                              ),
                        icon: Icon(
                          player?['audioMode'] == 'mic'
                              ? Icons.movie_rounded
                              : Icons.mic_rounded,
                        ),
                        label: Text(
                          player?['audioMode'] == 'mic'
                              ? 'Usar áudio do vídeo'
                              : 'Falar no microfone',
                        ),
                      ),
                  ],
                ),
                if (live)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'O microfone e o áudio do vídeo alternam, não tocam juntos.',
                      style: TextStyle(color: wa.textSecondary, fontSize: 12),
                    ),
                  ),
                const Divider(height: 28),
              ],
              Text(
                live ? 'Trocar vídeo' : 'Escolher vídeo',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _preparing ? null : _pickFile,
                      icon: const Icon(Icons.video_library_rounded),
                      label: const Text('Galeria / arquivo'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _urlController,
                keyboardType: TextInputType.url,
                enabled: !_preparing,
                decoration: InputDecoration(
                  labelText: 'ou link do vídeo',
                  hintText: 'mp4, m3u8, instagram, tiktok, kwai…',
                  prefixIcon: const Icon(Icons.link_rounded),
                  suffixIcon: IconButton(
                    tooltip: 'Preparar link',
                    onPressed: _preparing ? null : _prepareUrl,
                    icon: const Icon(Icons.download_rounded),
                  ),
                ),
                onSubmitted: (_) => _prepareUrl(),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Transmitir direto do link'),
                subtitle: const Text('Filmes grandes e listas HLS (m3u8)'),
                value: _direct,
                onChanged: _preparing
                    ? null
                    : (v) => setState(() => _direct = v),
              ),
              if (_preparing)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Row(
                    children: [
                      const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: 10),
                      Expanded(child: Text(_progress ?? 'Preparando…')),
                    ],
                  ),
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(_error!, style: TextStyle(color: scheme.error)),
                ),
              if (_loadingLibrary)
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: LinearProgressIndicator(),
                )
              else if (_library.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  'Preparados',
                  style: TextStyle(color: wa.textSecondary, fontSize: 12),
                ),
                const SizedBox(height: 4),
                for (final item in _library.take(6))
                  _MediaTile(
                    item: item,
                    selected: media?['mediaId'] == item['mediaId'],
                    fmt: _fmt,
                    onTap: _preparing
                        ? null
                        : () => setState(() => _selected = item),
                    onDelete: () async {
                      try {
                        await _api.callVideoDelete(
                          widget.instance,
                          '${item['mediaId']}',
                        );
                        if (_selected?['mediaId'] == item['mediaId'])
                          _selected = null;
                        await _loadLibrary();
                      } catch (e) {
                        if (mounted) setState(() => _error = _clean(e));
                      }
                    },
                  ),
              ],
              if (media != null) ...[
                const SizedBox(height: 14),
                if ((media['warnings'] is List) &&
                    (media['warnings'] as List).isNotEmpty)
                  for (final warning in (media['warnings'] as List))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.info_outline_rounded, size: 16),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              '$warning',
                              style: const TextStyle(fontSize: 12.5),
                            ),
                          ),
                        ],
                      ),
                    ),
                if (media['hasAudio'] == true)
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'media',
                        icon: Icon(Icons.movie_rounded),
                        label: Text('Áudio do vídeo'),
                      ),
                      ButtonSegment(
                        value: 'mic',
                        icon: Icon(Icons.mic_rounded),
                        label: Text('Microfone'),
                      ),
                    ],
                    selected: {_audio},
                    onSelectionChanged: (v) => setState(() => _audio = v.first),
                  ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Repetir'),
                  value: _loop,
                  onChanged: (v) => setState(() => _loop = v),
                ),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'low', label: Text('Leve')),
                    ButtonSegment(value: 'medium', label: Text('Média')),
                    ButtonSegment(value: 'high', label: Text('Alta')),
                  ],
                  selected: {_quality},
                  onSelectionChanged: (v) => setState(() => _quality = v.first),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<int>(
                  initialValue: _fps,
                  decoration: const InputDecoration(
                    labelText: 'Quadros por segundo',
                  ),
                  items: const [15, 20, 24, 30]
                      .map(
                        (fps) => DropdownMenuItem(
                          value: fps,
                          child: Text('$fps FPS'),
                        ),
                      )
                      .toList(),
                  onChanged: (fps) {
                    if (fps != null) setState(() => _fps = fps);
                  },
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Fechar'),
        ),
        FilledButton.icon(
          onPressed: (media == null || _preparing || _acting)
              ? null
              : () => _run(
                  'play_video',
                  mediaId: '${media['mediaId']}',
                  audio: media['hasAudio'] == true ? _audio : 'mic',
                ),
          icon: const Icon(Icons.cast_rounded),
          label: Text(live ? 'Trocar e transmitir' : 'Transmitir'),
        ),
      ],
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.title,
    required this.label,
    required this.position,
    required this.duration,
    required this.details,
    required this.error,
    required this.fmt,
  });

  final String title;
  final String label;
  final double position;
  final double duration;
  final List<String> details;
  final String error;
  final String Function(num) fmt;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: wa.hover,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              Text(
                label,
                style: TextStyle(
                  color: scheme.primary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(
            value: duration > 0 ? (position / duration).clamp(0, 1) : null,
          ),
          const SizedBox(height: 6),
          Text(
            '${fmt(position)}${duration > 0 ? ' / ${fmt(duration)}' : '  ·  ao vivo'}'
            '${details.isEmpty ? '' : '  ·  ${details.join('  ·  ')}'}',
            style: TextStyle(color: wa.textSecondary, fontSize: 12),
          ),
          if (error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                error,
                style: TextStyle(color: scheme.error, fontSize: 12.5),
              ),
            ),
        ],
      ),
    );
  }
}

class _MediaTile extends StatelessWidget {
  const _MediaTile({
    required this.item,
    required this.selected,
    required this.fmt,
    required this.onTap,
    required this.onDelete,
  });

  final Map<String, dynamic> item;
  final bool selected;
  final String Function(num) fmt;
  final VoidCallback? onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dur = (item['durationSec'] as num?) ?? 0;
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      selected: selected,
      onTap: onTap,
      leading: Icon(
        selected ? Icons.check_circle_rounded : Icons.movie_outlined,
        color: selected ? scheme.primary : null,
      ),
      title: Text(
        '${item['name']}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        '${item['width']}×${item['height']} · ${fmt(dur)}'
        '${item['hasAudio'] == true ? '' : ' · sem áudio'}',
      ),
      trailing: IconButton(
        tooltip: 'Apagar',
        icon: const Icon(Icons.delete_outline_rounded, size: 20),
        onPressed: onDelete,
      ),
    );
  }
}
