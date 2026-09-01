import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/app_config.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/top_toast.dart';
import '../../core/wa_theme.dart';
import '../../models/admin_support.dart';
import '../../models/conversation_thread.dart';

class UserSupportChatScreen extends ConsumerStatefulWidget {
  const UserSupportChatScreen({
    super.key,
    required this.thread,
    this.leading,
    this.onConversationChanged,
  });

  final ConversationThread thread;
  final Widget? leading;
  final VoidCallback? onConversationChanged;

  @override
  ConsumerState<UserSupportChatScreen> createState() =>
      _UserSupportChatScreenState();
}

class _UserSupportChatScreenState extends ConsumerState<UserSupportChatScreen>
    with WidgetsBindingObserver {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  Timer? _pollTimer;
  AdminSupportConversation? _conversation;
  Object? _error;
  bool _loading = true;
  bool _sending = false;
  bool _refreshing = false;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_loadConversation(scrollToBottom: true));
    _pollTimer = Timer.periodic(const Duration(seconds: 8), (_) {
      unawaited(_loadConversation(silent: true));
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_loadConversation(silent: true));
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 720;
    final supportName = widget.thread.title.trim().isNotEmpty
        ? widget.thread.title.trim()
        : 'Suporte BotAdmin';
    final supportRole = widget.thread.supportRole?.trim().isNotEmpty == true
        ? widget.thread.supportRole!.trim()
        : 'Suporte';
    final supportAvatarUrl = _supportAbsoluteUrl(widget.thread.avatarUrl);
    return ColoredBox(
      color: wa.chatBg,
      child: Column(
        children: [
          Container(
            height: compact ? 58 : 62,
            padding: EdgeInsets.only(
              left: widget.leading == null ? 12 : 0,
              right: 8,
            ),
            decoration: BoxDecoration(
              color: wa.headerBg,
              border: Border(bottom: BorderSide(color: wa.divider)),
            ),
            child: Row(
              children: [
                ?widget.leading,
                SizedBox.square(
                  dimension: compact ? 38 : 42,
                  child: ClipOval(
                    child: supportAvatarUrl == null
                        ? ColoredBox(
                            color: wa.accentSoft,
                            child: Icon(
                              Icons.support_agent_rounded,
                              color: wa.accent,
                            ),
                          )
                        : BotAdminCachedImage(
                            imageUrl: supportAvatarUrl,
                            fit: BoxFit.cover,
                            errorWidget: (_, _, _) => ColoredBox(
                              color: wa.accentSoft,
                              child: Icon(
                                Icons.support_agent_rounded,
                                color: wa.accent,
                              ),
                            ),
                          ),
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              supportName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: wa.textPrimary,
                                fontSize: 16.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          const SizedBox(width: 7),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: wa.accentSoft,
                              borderRadius: BorderRadius.circular(5),
                            ),
                            child: Text(
                              supportRole,
                              style: TextStyle(
                                color: wa.accent,
                                fontSize: 10.5,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Conversa direta com $supportName',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Atualizar suporte',
                  onPressed: _refreshing
                      ? null
                      : () => _loadConversation(scrollToBottom: true),
                  icon: _refreshing
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
          ),
          Expanded(
            child: ColoredBox(
              color: wa.chatWallpaper,
              child: _buildConversation(context),
            ),
          ),
          _buildComposer(context),
        ],
      ),
    );
  }

  Widget _buildConversation(BuildContext context) {
    final wa = WaTheme.of(context);
    final messages = _conversation?.messages ?? const <AdminSupportMessage>[];
    if (_loading && messages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && messages.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.support_agent_rounded, color: wa.textMuted, size: 42),
              const SizedBox(height: 12),
              Text(
                'Não foi possível abrir o suporte.',
                style: TextStyle(
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: () => _loadConversation(scrollToBottom: true),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }
    if (messages.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 420),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: wa.emptyPill,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.support_agent_rounded, color: wa.accent, size: 38),
                const SizedBox(height: 10),
                Text(
                  'Converse com o suporte',
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Envie sua dúvida aqui. As respostas do administrador aparecerão nesta mesma conversa.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: wa.textSecondary, height: 1.35),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return ListView.builder(
      controller: _scrollController,
      padding: EdgeInsets.fromLTRB(
        MediaQuery.sizeOf(context).width < 720 ? 12 : 48,
        18,
        MediaQuery.sizeOf(context).width < 720 ? 12 : 48,
        22,
      ),
      itemCount: messages.length,
      itemBuilder: (context, index) =>
          _UserSupportMessageBubble(message: messages[index]),
    );
  }

  Widget _buildComposer(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      color: wa.composerBg,
      padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: _messageController,
              minLines: 1,
              maxLines: 5,
              textCapitalization: TextCapitalization.sentences,
              onSubmitted: (_) => unawaited(_sendText()),
              decoration: InputDecoration(
                hintText: 'Digite sua dúvida para o suporte',
                fillColor: wa.inputFill,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            tooltip: 'Enviar',
            onPressed: _sending ? null : () => unawaited(_sendText()),
            style: IconButton.styleFrom(
              backgroundColor: wa.accent,
              foregroundColor: Colors.white,
            ),
            icon: _sending
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.send_rounded),
          ),
        ],
      ),
    );
  }

  Future<void> _loadConversation({
    bool silent = false,
    bool scrollToBottom = false,
  }) async {
    final generation = ++_generation;
    if (mounted && !silent) {
      setState(() {
        _refreshing = _conversation != null;
        _loading = _conversation == null;
        _error = null;
      });
    }
    try {
      final payload = await ref
          .read(apiClientProvider)
          .loadUserSupportConversation(whatsappId: widget.thread.chatJid);
      if (!mounted || generation != _generation) return;
      final previousCount = _conversation?.messages.length ?? 0;
      setState(() {
        _conversation = payload;
        _loading = false;
        _refreshing = false;
        _error = null;
      });
      if (scrollToBottom || payload.messages.length > previousCount) {
        _scheduleScrollToBottom();
      }
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _loading = false;
        _refreshing = false;
        _error = error;
      });
    }
  }

  Future<void> _sendText() async {
    final text = _messageController.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ref
          .read(apiClientProvider)
          .sendUserSupportText(whatsappId: widget.thread.chatJid, text: text);
      _messageController.clear();
      await _loadConversation(silent: true, scrollToBottom: true);
      widget.onConversationChanged?.call();
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _scheduleScrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }
}

class _UserSupportMessageBubble extends StatelessWidget {
  const _UserSupportMessageBubble({required this.message});

  final AdminSupportMessage message;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final own = message.senderRole == 'user';
    final text = message.text?.trim() ?? '';
    return Align(
      alignment: own ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 520),
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.fromLTRB(11, 8, 11, 6),
        decoration: BoxDecoration(
          color: own ? wa.bubbleOut : wa.bubbleIn,
          borderRadius: BorderRadius.circular(9),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 2,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (message.media != null)
              _UserSupportMediaPreview(media: message.media!),
            if (text.isNotEmpty) ...[
              if (message.media != null) const SizedBox(height: 6),
              Text(text, style: TextStyle(color: wa.bubbleText, fontSize: 15)),
            ],
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                _supportTime(message.timestamp),
                style: TextStyle(color: wa.bubbleMeta, fontSize: 11),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _UserSupportMediaPreview extends StatelessWidget {
  const _UserSupportMediaPreview({required this.media});

  final AdminSupportMedia media;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final url = _supportMediaUrl(media);
    if (url != null &&
        (media.mediaType == 'image' || media.mediaType == 'sticker')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: BotAdminCachedImage(
          imageUrl: url,
          width: 300,
          height: media.mediaType == 'sticker' ? 160 : 210,
          fit: BoxFit.cover,
          errorWidget: (_, _, _) => _fileCard(wa),
        ),
      );
    }
    return _fileCard(wa);
  }

  Widget _fileCard(WaTheme wa) {
    return Container(
      width: 290,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: wa.searchBg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(_supportMediaIcon(media.mediaType), color: wa.accent),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              media.filename ?? media.caption ?? 'Mídia do suporte',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: wa.textPrimary),
            ),
          ),
        ],
      ),
    );
  }
}

String? _supportMediaUrl(AdminSupportMedia media) {
  var raw = media.mediaUrl?.trim() ?? '';
  if (raw.isEmpty && media.mediaId?.trim().isNotEmpty == true) {
    raw = '/api/support/media/${Uri.encodeComponent(media.mediaId!.trim())}';
  }
  if (raw.isEmpty) return null;
  final parsed = Uri.tryParse(raw);
  if (parsed != null && parsed.hasScheme) return raw;
  final base = Uri.tryParse(AppConfig.apiBaseUrl);
  if (base == null || !base.hasScheme) return null;
  return base.resolve(raw.startsWith('/') ? raw : '/$raw').toString();
}

String? _supportAbsoluteUrl(String? value) {
  final raw = value?.trim() ?? '';
  if (raw.isEmpty) return null;
  final parsed = Uri.tryParse(raw);
  if (parsed != null && parsed.hasScheme) return raw;
  final base = Uri.tryParse(AppConfig.apiBaseUrl);
  if (base == null || !base.hasScheme) return null;
  return base.resolve(raw.startsWith('/') ? raw : '/$raw').toString();
}

IconData _supportMediaIcon(String type) => switch (type) {
  'video' => Icons.play_circle_outline_rounded,
  'audio' => Icons.graphic_eq_rounded,
  'document' => Icons.description_outlined,
  _ => Icons.image_outlined,
};

String _supportTime(String raw) {
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return '';
  return DateFormat('HH:mm', 'pt_BR').format(parsed.toLocal());
}
