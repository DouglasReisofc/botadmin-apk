import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/haptics.dart';
import '../../core/wa_theme.dart';
import '../../models/bot_instance.dart';

/// Escolha feita na folha de ligação.
class ChatCallChoice {
  const ChatCallChoice({
    required this.video,
    this.mediaId,
    this.audio = 'media',
    this.loop = false,
    this.mediaName,
  });

  final bool video;
  final String? mediaId;
  final String audio;
  final bool loop;
  final String? mediaName;
}

/// Folha inferior do ícone de ligação (telefone com +), como no WhatsApp:
/// ligação de voz, ligação de vídeo e, em vídeo, transmitir um link
/// (MP4, HLS/m3u8, Instagram, TikTok, Kwai, Facebook, Pinterest, YouTube).
Future<ChatCallChoice?> showChatCallSheet(
  BuildContext context, {
  required BotInstance instance,
  required String contactName,
}) {
  return showModalBottomSheet<ChatCallChoice>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: WaTheme.of(context).panel,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) =>
        _ChatCallSheet(instance: instance, contactName: contactName),
  );
}

class _ChatCallSheet extends ConsumerStatefulWidget {
  const _ChatCallSheet({required this.instance, required this.contactName});

  final BotInstance instance;
  final String contactName;

  @override
  ConsumerState<_ChatCallSheet> createState() => _ChatCallSheetState();
}

class _ChatCallSheetState extends ConsumerState<_ChatCallSheet> {
  final _link = TextEditingController();
  bool _linkOpen = false;
  bool _loop = false;
  bool _useMediaAudio = true;
  bool _direct = false;
  bool _advancedOpen = false;
  bool _playlistDetected = false;
  bool _playlistInspecting = false;
  String _playlistKind = 'movie';
  String _playlistFilter = '';
  List<Map<String, dynamic>> _playlistItems = const [];
  Map<String, dynamic>? _selectedPlaylistItem;
  bool _busy = false;
  String? _error;
  String? _progress;

  @override
  void dispose() {
    _link.dispose();
    super.dispose();
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim();
    if (text != null && text.isNotEmpty && mounted) {
      setState(() {
        _link.text = text;
        _error = null;
      });
    }
  }

  String _platformLabel(String? platform) => switch (platform) {
    'instagram' => 'Instagram',
    'tiktok' => 'TikTok',
    'kwai' => 'Kwai',
    'facebook' => 'Facebook',
    'pinterest' => 'Pinterest',
    'youtube' => 'YouTube',
    'twitter' => 'X/Twitter',
    'threads' => 'Threads',
    'hls' => 'transmissão HLS',
    _ => 'link',
  };

  bool _looksLikePlaylist(String value) =>
      RegExp(r'\.m3u(?:$|[?#])', caseSensitive: false).hasMatch(value) &&
      !RegExp(r'\.m3u8(?:$|[?#])', caseSensitive: false).hasMatch(value);

  bool _looksLikeHls(String value) =>
      RegExp(r'\.m3u8(?:$|[?#])', caseSensitive: false).hasMatch(value);

  String _playlistKindLabel(String kind) => switch (kind) {
    'live' => 'TV ao vivo',
    'series' => 'Séries',
    _ => 'Filmes / vídeos',
  };

  List<Map<String, dynamic>> get _visiblePlaylistItems {
    final query = _playlistFilter.trim().toLowerCase();
    return _playlistItems
        .where((item) {
          if ('${item['kind']}' != _playlistKind) return false;
          if (query.isEmpty) return true;
          return '${item['title']} ${item['group'] ?? ''}'
              .toLowerCase()
              .contains(query);
        })
        .take(80)
        .toList(growable: false);
  }

  Future<void> _inspectPlaylist() async {
    final link = _link.text.trim();
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(link)) {
      setState(() => _error = 'Cole o endereço http ou https da lista M3U.');
      return;
    }
    hapticTap();
    setState(() {
      _playlistInspecting = true;
      _busy = true;
      _error = null;
      _progress = 'Lendo e organizando a lista…';
    });
    try {
      final result = await ref
          .read(apiClientProvider)
          .callVideoInspectPlaylist(widget.instance, link);
      final rawItems = result['items'];
      final items = rawItems is List
          ? rawItems
                .map((item) => Map<String, dynamic>.from(item as Map))
                .toList()
          : <Map<String, dynamic>>[];
      if (items.isEmpty)
        throw StateError('A lista não trouxe vídeos reconhecíveis.');
      final preferred = ['movie', 'series', 'live'].firstWhere(
        (kind) => items.any((item) => '${item['kind']}' == kind),
        orElse: () => 'movie',
      );
      if (!mounted) return;
      setState(() {
        _playlistDetected = true;
        _playlistItems = items;
        _playlistKind = preferred;
        _playlistFilter = '';
        _selectedPlaylistItem = null;
        _progress = null;
      });
    } catch (e) {
      if (mounted)
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() {
          _playlistInspecting = false;
          _busy = false;
          _progress = null;
        });
      }
    }
  }

  Future<void> _prepareAndCall({
    String? sourceLink,
    bool? streamOverride,
  }) async {
    final link = (sourceLink ?? _link.text).trim();
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(link)) {
      setState(() => _error = 'Cole um link que comece com http ou https.');
      return;
    }
    hapticTap();
    setState(() {
      _busy = true;
      _error = null;
      _progress = 'Buscando o vídeo do link…';
    });
    try {
      final result = await ref
          .read(apiClientProvider)
          .callVideoPrepareLink(
            widget.instance,
            link,
            stream:
                streamOverride ??
                (_direct || _playlistKind == 'live' || _looksLikeHls(link)),
          );
      final media = Map<String, dynamic>.from(result['media'] as Map);
      final source = Map<String, dynamic>.from(result['source'] as Map);
      final id = '${media['mediaId'] ?? ''}';
      if (id.isEmpty)
        throw StateError('O servidor não devolveu o vídeo preparado.');
      if (!mounted) return;
      final hasAudio = media['hasAudio'] == true;
      Navigator.pop(
        context,
        ChatCallChoice(
          video: true,
          mediaId: id,
          audio: (_useMediaAudio && hasAudio) ? 'media' : 'mic',
          loop: _loop && media['live'] != true,
          mediaName: (source['title'] as String?)?.trim().isNotEmpty == true
              ? source['title'] as String
              : '${media['name'] ?? _platformLabel('${source['platform']}')}',
        ),
      );
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceFirst('Exception: ', '');
          _busy = false;
          _progress = null;
        });
      }
    }
  }

  Future<void> _handleSource() async {
    final link = _link.text.trim();
    if (_looksLikePlaylist(link)) {
      await _inspectPlaylist();
      return;
    }
    await _prepareAndCall(streamOverride: _looksLikeHls(link));
  }

  Future<void> _prepareSelectedPlaylistItem() async {
    final item = _selectedPlaylistItem;
    if (item == null) {
      setState(() => _error = 'Escolha um item da lista primeiro.');
      return;
    }
    await _prepareAndCall(
      sourceLink: '${item['url']}',
      streamOverride:
          '${item['kind']}' == 'live' || _looksLikeHls('${item['url']}'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final scheme = Theme.of(context).colorScheme;
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return AnimatedPadding(
      duration: const Duration(milliseconds: 150),
      padding: EdgeInsets.only(bottom: bottom),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 38,
                    height: 4,
                    decoration: BoxDecoration(
                      color: wa.divider,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Ligar para ${widget.contactName}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 10),
                _OptionTile(
                  icon: Icons.call_rounded,
                  title: 'Ligação de voz',
                  subtitle: 'Falar pelo painel, como uma ligação normal',
                  enabled: !_busy,
                  onTap: () {
                    hapticTap();
                    Navigator.pop(context, const ChatCallChoice(video: false));
                  },
                ),
                _OptionTile(
                  icon: Icons.videocam_rounded,
                  title: 'Ligação de vídeo',
                  subtitle:
                      'Abrir a chamada de vídeo e escolher o vídeo depois',
                  enabled: !_busy,
                  onTap: () {
                    hapticTap();
                    Navigator.pop(context, const ChatCallChoice(video: true));
                  },
                ),
                _OptionTile(
                  icon: Icons.cast_rounded,
                  title: 'Transmitir vídeo por link',
                  subtitle: 'Filme, reels, TikTok, Kwai, canal ao vivo (m3u8)…',
                  enabled: !_busy,
                  trailing: Icon(
                    _linkOpen
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
                    color: wa.icon,
                  ),
                  onTap: () => setState(() => _linkOpen = !_linkOpen),
                ),
                if (_linkOpen) ...[
                  const SizedBox(height: 6),
                  TextField(
                    controller: _link,
                    enabled: !_busy && !_playlistInspecting,
                    keyboardType: TextInputType.url,
                    autofocus: true,
                    textInputAction: TextInputAction.go,
                    onChanged: (_) {
                      if (_playlistDetected) {
                        setState(() {
                          _playlistDetected = false;
                          _playlistItems = const [];
                          _selectedPlaylistItem = null;
                        });
                      }
                    },
                    onSubmitted: (_) => _handleSource(),
                    decoration: InputDecoration(
                      labelText: 'URL do vídeo ou lista M3U',
                      hintText: 'https://…',
                      prefixIcon: const Icon(Icons.link_rounded),
                      suffixIcon: IconButton(
                        tooltip: 'Colar',
                        onPressed: _busy || _playlistInspecting ? null : _paste,
                        icon: const Icon(Icons.content_paste_rounded),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _playlistDetected
                        ? 'Lista identificada. Escolha a categoria e o item.'
                        : 'Links diretos são detectados automaticamente. Listas .m3u abrem um seletor organizado.',
                    style: TextStyle(color: wa.textSecondary, fontSize: 12),
                  ),
                  if (_playlistDetected) ...[
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: _playlistKind,
                      decoration: const InputDecoration(
                        labelText: 'Tipo da lista',
                        prefixIcon: Icon(Icons.category_outlined),
                      ),
                      items: const ['live', 'movie', 'series']
                          .map(
                            (kind) => DropdownMenuItem(
                              value: kind,
                              child: Text(
                                kind == 'live'
                                    ? 'TV ao vivo'
                                    : kind == 'series'
                                    ? 'Séries'
                                    : 'Filmes / vídeos',
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: _busy
                          ? null
                          : (kind) {
                              if (kind == null) return;
                              setState(() {
                                _playlistKind = kind;
                                _selectedPlaylistItem = null;
                              });
                            },
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      enabled: !_busy,
                      onChanged: (value) =>
                          setState(() => _playlistFilter = value),
                      decoration: const InputDecoration(
                        labelText: 'Filtrar itens',
                        prefixIcon: Icon(Icons.search_rounded),
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (_visiblePlaylistItems.isEmpty)
                      const Text('Nenhum item encontrado nessa categoria.')
                    else
                      Container(
                        constraints: const BoxConstraints(maxHeight: 230),
                        decoration: BoxDecoration(
                          border: Border.all(color: wa.divider),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: ListView.builder(
                          shrinkWrap: true,
                          itemCount: _visiblePlaylistItems.length,
                          itemBuilder: (context, index) {
                            final item = _visiblePlaylistItems[index];
                            final selected = identical(
                              item,
                              _selectedPlaylistItem,
                            );
                            return ListTile(
                              dense: true,
                              selected: selected,
                              leading: Icon(
                                _playlistKind == 'live'
                                    ? Icons.live_tv_rounded
                                    : _playlistKind == 'series'
                                    ? Icons.video_library_rounded
                                    : Icons.movie_rounded,
                              ),
                              title: Text(
                                '${item['title'] ?? 'Vídeo'}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: item['group'] == null
                                  ? null
                                  : Text('${item['group']}'),
                              onTap: _busy
                                  ? null
                                  : () => setState(
                                      () => _selectedPlaylistItem = item,
                                    ),
                            );
                          },
                        ),
                      ),
                  ],
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    initiallyExpanded: _advancedOpen,
                    onExpansionChanged: (open) =>
                        setState(() => _advancedOpen = open),
                    title: const Text('Opções de reprodução'),
                    children: [
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: const Text('Usar o áudio do vídeo'),
                        subtitle: const Text(
                          'Desligado: falar pelo microfone do painel',
                        ),
                        value: _useMediaAudio,
                        onChanged: _busy
                            ? null
                            : (v) => setState(() => _useMediaAudio = v),
                      ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: const Text('Repetir'),
                        subtitle: const Text(
                          'Desativado automaticamente para TV ao vivo',
                        ),
                        value: _loop,
                        onChanged: _busy || _playlistKind == 'live'
                            ? null
                            : (v) => setState(() => _loop = v),
                      ),
                    ],
                  ),
                  if (_progress != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        children: [
                          const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          const SizedBox(width: 10),
                          Expanded(child: Text(_progress!)),
                        ],
                      ),
                    ),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        _error!,
                        style: TextStyle(color: scheme.error),
                      ),
                    ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _busy
                          ? null
                          : _playlistDetected
                          ? _prepareSelectedPlaylistItem
                          : _handleSource,
                      icon: const Icon(Icons.videocam_rounded),
                      label: Text(
                        _playlistDetected
                            ? 'Ligar com item selecionado'
                            : 'Detectar e ligar em vídeo',
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'O vídeo começa quando a pessoa atender.',
                    style: TextStyle(color: wa.textMuted, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.enabled = true,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool enabled;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return InkWell(
      onTap: enabled ? onTap : null,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: wa.accentSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: wa.accent, size: 23),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: 15.5,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    subtitle,
                    style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                  ),
                ],
              ),
            ),
            ?trailing,
          ],
        ),
      ),
    );
  }
}
