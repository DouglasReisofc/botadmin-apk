import 'dart:async';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/app_config.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/top_toast.dart';
import '../../core/wa_theme.dart';
import '../../core/voice_recorder.dart';
import '../../models/admin_support.dart';
import '../../models/conversation_thread.dart';
import '../chat/emoji_catalog.dart';

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
  final _voiceRecorder = VoiceRecorder();
  Timer? _pollTimer;
  AdminSupportConversation? _conversation;
  Object? _error;
  bool _loading = true;
  bool _sending = false;
  bool _refreshing = false;
  bool _recording = false;
  bool _recordingBusy = false;
  DateTime? _recordingStartedAt;
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
    unawaited(_voiceRecorder.dispose());
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
          IconButton(
            tooltip: 'Emojis',
            onPressed: _sending ? null : _openEmojiPicker,
            icon: const Icon(Icons.emoji_emotions_outlined),
          ),
          IconButton(
            tooltip: 'GIFs e figurinhas',
            onPressed: _sending ? null : _openGiphyPicker,
            icon: const Icon(Icons.gif_box_outlined),
          ),
          IconButton(
            tooltip: 'Anexar mídia ou documento',
            onPressed: _sending ? null : _pickAndSendMedia,
            icon: const Icon(Icons.attach_file_rounded),
          ),
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
          IconButton(
            tooltip: _recording ? 'Parar e enviar áudio' : 'Gravar áudio',
            onPressed: _sending || _recordingBusy
                ? null
                : (_recording ? _stopAndSendVoice : _startVoiceRecording),
            style: IconButton.styleFrom(
              backgroundColor: _recording ? Colors.redAccent : wa.inputFill,
              foregroundColor: _recording ? Colors.white : wa.textPrimary,
            ),
            icon: _recordingBusy
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(
                    _recording ? Icons.stop_rounded : Icons.mic_none_rounded,
                  ),
          ),
          const SizedBox(width: 4),
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

  Future<void> _openEmojiPicker() async {
    final emoji = await showEmojiPickerSheet(context);
    if (!mounted || emoji == null || emoji.isEmpty) return;
    final value = _messageController.value;
    final start = value.selection.isValid
        ? value.selection.start
        : value.text.length;
    final end = value.selection.isValid
        ? value.selection.end
        : value.text.length;
    final text = value.text.replaceRange(start, end, emoji);
    _messageController.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: start + emoji.length),
    );
  }

  Future<void> _pickAndSendMedia() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Mídias e documentos',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'mov',
            'mp3',
            'ogg',
            'opus',
            'webm',
            'm4a',
            'pdf',
            'doc',
            'docx',
            'zip',
          ],
        ),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) return;
    final mime = file.mimeType ?? _supportGuessMime(file.name);
    await _sendSupportMedia(
      bytes: bytes,
      fileName: file.name,
      mimeType: mime,
      mediaType: _supportMediaType(mime),
      caption: _messageController.text.trim(),
    );
  }

  Future<void> _startVoiceRecording() async {
    if (_recording || _recordingBusy) return;
    setState(() => _recordingBusy = true);
    try {
      await _voiceRecorder.start();
      if (!mounted) return;
      setState(() {
        _recording = true;
        _recordingStartedAt = DateTime.now();
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _recordingBusy = false);
    }
  }

  Future<void> _stopAndSendVoice() async {
    if (!_recording || _recordingBusy) return;
    final started = _recordingStartedAt;
    setState(() {
      _recordingBusy = true;
      _recording = false;
      _recordingStartedAt = null;
    });
    try {
      final recording = await _voiceRecorder.stop();
      if (recording == null ||
          recording.bytes.isEmpty ||
          started == null ||
          DateTime.now().difference(started) <
              const Duration(milliseconds: 700)) {
        if (mounted)
          showErrorToast(context, 'Grave pelo menos 1 segundo de áudio.');
        return;
      }
      await _sendSupportMedia(
        bytes: recording.bytes,
        fileName: recording.fileName,
        mimeType: recording.mimeType,
        mediaType: 'audio',
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
      await _voiceRecorder.cancel();
    } finally {
      if (mounted) setState(() => _recordingBusy = false);
    }
  }

  Future<void> _sendSupportMedia({
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    required String mediaType,
    String caption = '',
  }) async {
    if (_sending) return;
    setState(() => _sending = true);
    try {
      await ref
          .read(apiClientProvider)
          .sendUserSupportMedia(
            whatsappId: widget.thread.chatJid,
            bytes: bytes,
            fileName: fileName,
            mimeType: mimeType,
            mediaType: mediaType,
            caption: caption,
          );
      _messageController.clear();
      await _loadConversation(silent: true, scrollToBottom: true);
      widget.onConversationChanged?.call();
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _openGiphyPicker() async {
    final api = ref.read(apiClientProvider);
    final items = await api
        .searchGiphy(limit: 18)
        .catchError((_) => const <GiphyMediaItem>[]);
    if (!mounted || items.isEmpty) {
      if (mounted)
        showErrorToast(context, 'Não foi possível carregar GIFs agora.');
      return;
    }
    final selected = await showDialog<GiphyMediaItem>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('GIFs e figurinhas'),
        content: SizedBox(
          width: 420,
          height: 360,
          child: GridView.builder(
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
            ),
            itemCount: items.length,
            itemBuilder: (_, index) => InkWell(
              onTap: () => Navigator.of(dialogContext).pop(items[index]),
              child: BotAdminCachedImage(
                imageUrl: items[index].previewUrl,
                fit: BoxFit.cover,
                errorWidget: (_, _, _) =>
                    const Icon(Icons.broken_image_outlined),
              ),
            ),
          ),
        ),
      ),
    );
    if (selected == null || !mounted) return;
    try {
      final media = await api.downloadGiphyMedia(selected);
      await _sendSupportMedia(
        bytes: media.bytes,
        fileName: selected.fileNameForMimeType(media.mimeType),
        mimeType: media.mimeType,
        mediaType: selected.isSticker ? 'sticker' : 'image',
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
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

String _supportGuessMime(String fileName) {
  final name = fileName.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.mp4') || name.endsWith('.mov')) return 'video/mp4';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.ogg') || name.endsWith('.opus')) return 'audio/ogg';
  if (name.endsWith('.webm')) return 'audio/webm';
  if (name.endsWith('.m4a')) return 'audio/mp4';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

String _supportMediaType(String mimeType) {
  final normalized = mimeType.toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  return 'document';
}

String _supportTime(String raw) {
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return '';
  return DateFormat('HH:mm', 'pt_BR').format(parsed.toLocal());
}
