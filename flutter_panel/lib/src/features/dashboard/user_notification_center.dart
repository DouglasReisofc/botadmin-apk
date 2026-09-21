import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lottie/lottie.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';
import '../../core/api_client.dart';
import '../../core/app_config.dart';
import '../../core/wa_theme.dart';

bool _isPaymentNotification(String? rawType) {
  final type = rawType?.trim().toLowerCase() ?? '';
  return type.contains('payment') ||
      type.contains('purchase') ||
      type.contains('request_package') ||
      type == 'bot_sale' ||
      type == 'admin_plan_addon' ||
      type == 'customer_balance_credit';
}

String? _paymentAmountLabel(Map<String, dynamic> metadata) {
  final explicit = metadata['amountLabel']?.toString().trim() ?? '';
  if (explicit.isNotEmpty) return explicit;
  final raw = metadata['amount'];
  final amount = raw is num ? raw.toDouble() : double.tryParse('$raw');
  if (amount == null) return null;
  return 'R\$ ${amount.toStringAsFixed(2).replaceFirst('.', ',')}';
}

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
        Map<String, dynamic>? autoOpenItem;
        if (!_autoOpened) {
          for (final item in data.items) {
            if (item['type'] == 'admin_panel_notification' &&
                item['isRead'] != true) {
              autoOpenItem = item;
              break;
            }
          }
        }
        setState(() {
          _items = data.items;
          _unread = data.unreadCount;
          if (autoOpenItem != null) _autoOpened = true;
        });
        if (autoOpenItem != null) {
          final item = autoOpenItem;
          WidgetsBinding.instance.addPostFrameCallback((_) async {
            if (!mounted) return;
            await _openNotificationDetail(context, item);
            final id = int.tryParse('${item['id']}');
            if (id != null) {
              await ref.read(apiClientProvider).markUserNotificationsRead([id]);
              await _load();
            }
          });
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
                          final targetUrl = metadata is Map
                              ? metadata['targetUrl']?.toString()
                              : null;
                          final notificationType = item['type']?.toString();
                          final isPayment = _isPaymentNotification(
                            notificationType,
                          );
                          return ListTile(
                            onTap: () => _openNotificationDetail(context, item),
                            contentPadding: const EdgeInsets.symmetric(
                              vertical: 8,
                            ),
                            leading: CircleAvatar(
                              backgroundColor: isPayment
                                  ? const Color(0xFFE7F8EE)
                                  : wa.accent.withOpacity(.12),
                              child: Icon(
                                isPayment
                                    ? Icons.check_circle_outline_rounded
                                    : Icons.campaign_outlined,
                                color: isPayment
                                    ? const Color(0xFF138A4B)
                                    : wa.accent,
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
                                  contentJson:
                                      metadata is Map &&
                                          metadata['contentJson'] is Map
                                      ? Map<String, dynamic>.from(
                                          metadata['contentJson'] as Map,
                                        )
                                      : null,
                                ),
                                if ((mediaUrl?.isNotEmpty ?? false) ||
                                    (targetUrl?.isNotEmpty ?? false))
                                  const Padding(
                                    padding: EdgeInsets.only(top: 6),
                                    child: Text(
                                      'Toque para abrir a notificação completa',
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: Colors.grey,
                                      ),
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

Future<void> _openNotificationDetail(
  BuildContext context,
  Map<String, dynamic> item,
) async {
  final metadata = item['metadata'];
  final meta = metadata is Map
      ? Map<String, dynamic>.from(metadata)
      : <String, dynamic>{};
  final content = meta['contentJson'] is Map
      ? Map<String, dynamic>.from(meta['contentJson'] as Map)
      : null;
  final mediaUrl = meta['mediaUrl']?.toString() ?? '';
  final mediaType = meta['mediaType']?.toString() ?? 'image';
  final action = content?['action'] is Map
      ? Map<String, dynamic>.from(content!['action'] as Map)
      : (meta['targetUrl']?.toString().isNotEmpty == true
            ? <String, dynamic>{
                'type': 'url',
                'label': 'Abrir link',
                'value': meta['targetUrl'],
              }
            : null);
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => _NotificationDetailDialog(
      title: item['title']?.toString() ?? 'BotAdmin',
      message: item['message']?.toString() ?? '',
      contentJson: content,
      mediaUrl: mediaUrl,
      mediaType: mediaType,
      notificationType: item['type']?.toString() ?? '',
      metadata: meta,
      action: action,
      onAction: action == null
          ? null
          : () => _runNotificationAction(
              dialogContext,
              action['type']?.toString() ?? 'url',
              action['value']?.toString() ?? '',
            ),
    ),
  );
}

Future<void> _runNotificationAction(
  BuildContext context,
  String type,
  String value,
) async {
  final normalized = value.trim();
  if (normalized.isEmpty) return;
  if (type == 'function') {
    Navigator.of(context).pop();
    if (normalized == 'open_support') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Abra a área de suporte pelo menu principal.'),
        ),
      );
    } else if (normalized == 'refresh_notifications') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Notificações atualizadas.')),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Função "$normalized" solicitada.')),
      );
    }
    return;
  }
  if (type == 'app_route') {
    Navigator.of(context).pop();
    try {
      await Navigator.of(context).pushNamed(normalized);
    } catch (_) {
      await launchUrl(
        Uri.parse(AppConfig.publicInviteUrl(normalized)),
        mode: LaunchMode.externalApplication,
      );
    }
    return;
  }
  final uri = Uri.tryParse(AppConfig.publicInviteUrl(normalized));
  if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
}

class _NotificationDetailDialog extends StatelessWidget {
  const _NotificationDetailDialog({
    required this.title,
    required this.message,
    required this.contentJson,
    required this.mediaUrl,
    required this.mediaType,
    required this.notificationType,
    required this.metadata,
    required this.action,
    required this.onAction,
  });

  final String title;
  final String message;
  final Map<String, dynamic>? contentJson;
  final String mediaUrl;
  final String mediaType;
  final String notificationType;
  final Map<String, dynamic> metadata;
  final Map<String, dynamic>? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final size = MediaQuery.sizeOf(context);
    final isPayment = _isPaymentNotification(notificationType);
    final amountLabel = _paymentAmountLabel(metadata);
    return Dialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 620,
          maxHeight: size.height * .84,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 12, 14),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: isPayment
                        ? const Color(0xFFE7F8EE)
                        : wa.accentSoft,
                    child: Icon(
                      isPayment
                          ? Icons.verified_rounded
                          : Icons.campaign_outlined,
                      color: isPayment ? const Color(0xFF138A4B) : wa.accent,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: wa.border),
            if (isPayment)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                child: Column(
                  children: [
                    SizedBox(
                      height: size.width < 480 ? 132 : 156,
                      child: Lottie.asset(
                        'assets/brand/payment-success-confetti.json',
                        fit: BoxFit.contain,
                        repeat: false,
                        errorBuilder: (_, __, ___) => const Icon(
                          Icons.verified_rounded,
                          size: 68,
                          color: Color(0xFF138A4B),
                        ),
                      ),
                    ),
                    Transform.translate(
                      offset: const Offset(0, -4),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(
                            Icons.check_circle_rounded,
                            size: 20,
                            color: Color(0xFF138A4B),
                          ),
                          const SizedBox(width: 7),
                          Flexible(
                            child: Text(
                              amountLabel == null
                                  ? 'Pagamento confirmado'
                                  : 'Pagamento confirmado • $amountLabel',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Color(0xFF11623A),
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            if (mediaUrl.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: _NotificationMedia(url: mediaUrl, type: mediaType),
              ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 14, 24, 18),
                child: Center(
                  child: _RichNotificationText(
                    text: message,
                    contentJson: contentJson,
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),
            if (action != null && onAction != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: onAction,
                    icon: const Icon(Icons.open_in_new),
                    label: Text(action!['label']?.toString() ?? 'Abrir'),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RichNotificationText extends StatelessWidget {
  const _RichNotificationText({
    required this.text,
    this.contentJson,
    this.textAlign = TextAlign.start,
  });
  final String text;
  final Map<String, dynamic>? contentJson;
  final TextAlign textAlign;

  @override
  Widget build(BuildContext context) {
    final marks = contentJson?['marks'];
    if (marks is List && marks.isNotEmpty) {
      final ranges = marks
          .whereType<Map>()
          .map((raw) {
            final map = Map<String, dynamic>.from(raw);
            return (
              start: int.tryParse('${map['start']}') ?? 0,
              end: int.tryParse('${map['end']}') ?? 0,
              bold: map['bold'] == true,
              italic: map['italic'] == true,
            );
          })
          .where((range) => range.end > range.start)
          .toList();
      final points = <int>{0, text.length};
      for (final range in ranges) {
        points
          ..add(range.start.clamp(0, text.length))
          ..add(range.end.clamp(0, text.length));
      }
      final sorted = points.toList()..sort();
      final rich = <InlineSpan>[];
      for (var i = 0; i < sorted.length - 1; i++) {
        final start = sorted[i];
        final end = sorted[i + 1];
        final active = ranges.where(
          (range) => range.start <= start && range.end >= end,
        );
        var bold = false;
        var italic = false;
        for (final range in active) {
          bold = bold || range.bold;
          italic = italic || range.italic;
        }
        rich.add(
          TextSpan(
            text: text.substring(start, end),
            style: TextStyle(
              fontWeight: bold ? FontWeight.w700 : null,
              fontStyle: italic ? FontStyle.italic : null,
            ),
          ),
        );
      }
      return SelectableText.rich(
        TextSpan(style: DefaultTextStyle.of(context).style, children: rich),
        textAlign: textAlign,
      );
    }
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
      textAlign: textAlign,
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
