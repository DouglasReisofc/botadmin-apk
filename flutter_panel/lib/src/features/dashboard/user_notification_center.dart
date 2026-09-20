import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lottie/lottie.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';
import '../../core/api_client.dart';
import '../../core/wa_theme.dart';

class UserNotificationBell extends ConsumerStatefulWidget {
  const UserNotificationBell({super.key});
  @override
  ConsumerState<UserNotificationBell> createState() =>
      _UserNotificationBellState();
}

class _UserNotificationBellState extends ConsumerState<UserNotificationBell> {
  List<Map<String, dynamic>> _items = const [];
  int _unread = 0;
  bool _autoOpened = false;
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await ref.read(apiClientProvider).loadUserNotifications();
      if (mounted) {
        final shouldAutoOpen =
            !_autoOpened &&
            data.items.any(
              (item) =>
                  item['type'] == 'admin_panel_notification' &&
                  item['isRead'] != true,
            );
        setState(() {
          _items = data.items;
          _unread = data.unreadCount;
          if (shouldAutoOpen) _autoOpened = true;
        });
        if (shouldAutoOpen) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _open());
        }
      }
    } catch (_) {}
  }

  Future<void> _open() async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (_) => _NotificationDialog(
        items: _items,
        onRefresh: _load,
        onDeleteAll: () async {
          await ref.read(apiClientProvider).deleteUserNotifications();
          if (mounted)
            setState(() {
              _items = const [];
              _unread = 0;
            });
        },
        onDeleteOne: (id) async {
          await ref.read(apiClientProvider).deleteUserNotification(id);
          await _load();
        },
      ),
    );
    if (_unread > 0) {
      await ref.read(apiClientProvider).markUserNotificationsRead('all');
      if (mounted) setState(() => _unread = 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return IconButton(
      tooltip: 'Notificações',
      onPressed: _open,
      icon: Badge(
        isLabelVisible: _unread > 0,
        label: Text(_unread > 99 ? '99+' : '$_unread'),
        child: Icon(Icons.notifications_none_rounded, color: wa.icon),
      ),
    );
  }
}

class _NotificationDialog extends StatelessWidget {
  const _NotificationDialog({
    required this.items,
    required this.onRefresh,
    required this.onDeleteAll,
    required this.onDeleteOne,
  });
  final List<Map<String, dynamic>> items;
  final VoidCallback onRefresh;
  final Future<void> Function() onDeleteAll;
  final Future<void> Function(int id) onDeleteOne;
  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final wa = WaTheme.of(context);
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 720,
          maxHeight: size.height * .82,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.notifications_active_outlined, color: wa.accent),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'Notificações',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  if (items.isNotEmpty)
                    IconButton(
                      tooltip: 'Apagar todas',
                      onPressed: () async {
                        await onDeleteAll();
                        if (context.mounted) Navigator.pop(context);
                      },
                      icon: const Icon(Icons.delete_sweep_outlined),
                    ),
                  IconButton(
                    onPressed: () {
                      onRefresh();
                      Navigator.pop(context);
                    },
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Expanded(
                child: items.isEmpty
                    ? const Center(child: Text('Você está em dia.'))
                    : ListView.separated(
                        itemCount: items.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, index) {
                          final item = items[index];
                          final metadata = item['metadata'];
                          final mediaUrl = metadata is Map
                              ? metadata['mediaUrl']?.toString()
                              : null;
                          final mediaType = metadata is Map
                              ? metadata['mediaType']?.toString()
                              : null;
                          final targetUrl = metadata is Map
                              ? metadata['targetUrl']?.toString()
                              : null;
                          return ListTile(
                            onTap: targetUrl != null && targetUrl.isNotEmpty
                                ? () {
                                    final uri = Uri.tryParse(targetUrl);
                                    if (uri != null) launchUrl(uri);
                                  }
                                : null,
                            contentPadding: const EdgeInsets.symmetric(
                              vertical: 8,
                            ),
                            leading: CircleAvatar(
                              backgroundColor: wa.accent.withOpacity(.12),
                              child: Icon(
                                Icons.campaign_outlined,
                                color: wa.accent,
                              ),
                            ),
                            trailing: IconButton(
                              tooltip: 'Apagar',
                              onPressed: () async {
                                final id = int.tryParse('${item['id']}');
                                if (id == null) return;
                                await onDeleteOne(id);
                                if (context.mounted) Navigator.pop(context);
                              },
                              icon: const Icon(Icons.delete_outline_rounded),
                            ),
                            title: Text(
                              item['title']?.toString() ?? 'BotAdmin',
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const SizedBox(height: 4),
                                _RichNotificationText(
                                  text: item['message']?.toString() ?? '',
                                ),
                                if (mediaUrl != null &&
                                    mediaUrl.isNotEmpty) ...[
                                  const SizedBox(height: 8),
                                  _NotificationMedia(
                                    url: mediaUrl,
                                    type: mediaType ?? 'image',
                                  ),
                                ],
                                if (targetUrl != null && targetUrl.isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 8),
                                    child: TextButton.icon(
                                      onPressed: () {
                                        final uri = Uri.tryParse(targetUrl);
                                        if (uri != null) launchUrl(uri);
                                      },
                                      icon: const Icon(
                                        Icons.open_in_new,
                                        size: 17,
                                      ),
                                      label: const Text('Abrir link'),
                                    ),
                                  ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RichNotificationText extends StatelessWidget {
  const _RichNotificationText({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final spans = <InlineSpan>[];
    final pattern = RegExp(r'(\*\*[^*]+\*\*|\*[^*]+\*)');
    var cursor = 0;
    for (final match in pattern.allMatches(text)) {
      if (match.start > cursor)
        spans.add(TextSpan(text: text.substring(cursor, match.start)));
      final token = match.group(0)!;
      if (token.startsWith('**')) {
        spans.add(
          TextSpan(
            text: token.substring(2, token.length - 2),
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        );
      } else {
        spans.add(
          TextSpan(
            text: token.substring(1, token.length - 1),
            style: const TextStyle(fontStyle: FontStyle.italic),
          ),
        );
      }
      cursor = match.end;
    }
    if (cursor < text.length) spans.add(TextSpan(text: text.substring(cursor)));
    return SelectableText.rich(
      TextSpan(style: DefaultTextStyle.of(context).style, children: spans),
    );
  }
}

class _NotificationMedia extends StatefulWidget {
  const _NotificationMedia({required this.url, required this.type});
  final String url;
  final String type;
  @override
  State<_NotificationMedia> createState() => _NotificationMediaState();
}

class _NotificationMediaState extends State<_NotificationMedia> {
  VideoPlayerController? _video;
  @override
  void initState() {
    super.initState();
    if (widget.type.toLowerCase() == 'video') {
      final uri = Uri.tryParse(widget.url);
      if (uri != null) {
        _video = VideoPlayerController.networkUrl(uri)
          ..initialize().then((_) {
            if (mounted) setState(() {});
          });
      }
    }
  }

  @override
  void dispose() {
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final type = widget.type.toLowerCase();
    if (type == 'lottie') {
      return SizedBox(
        height: 180,
        child: Lottie.network(
          widget.url,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) =>
              const Text('Não foi possível abrir a animação.'),
        ),
      );
    }
    if (type == 'video') {
      final video = _video;
      if (video == null || !video.value.isInitialized)
        return const SizedBox(
          height: 120,
          child: Center(child: CircularProgressIndicator()),
        );
      return Column(
        children: [
          AspectRatio(
            aspectRatio: video.value.aspectRatio,
            child: VideoPlayer(video),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: IconButton(
              onPressed: () {
                video.value.isPlaying ? video.pause() : video.play();
                setState(() {});
              },
              icon: Icon(
                video.value.isPlaying ? Icons.pause_circle : Icons.play_circle,
                size: 32,
              ),
            ),
          ),
        ],
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Image.network(
        widget.url,
        height: 180,
        width: double.infinity,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) =>
            const Text('Não foi possível abrir a imagem.'),
      ),
    );
  }
}
