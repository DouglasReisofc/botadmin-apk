import 'dart:async';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/app_config.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/top_toast.dart';
import '../../core/wa_theme.dart';
import '../../core/voice_recorder.dart';
import '../../models/admin_support.dart';
import '../../models/chat_message.dart';
import '../../models/conversation_thread.dart';
import '../chat/chat_screen.dart';

class UserSupportChatScreen extends ConsumerStatefulWidget {
  const UserSupportChatScreen({
    super.key,
    required this.thread,
    this.leading,
    this.onConversationChanged,
    this.adminEntry,
    this.header,
  });

  final AdminSupportThreadEntry? adminEntry;
  final Widget? header;
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
  Duration _recordingDuration = Duration.zero;
  Timer? _recordingTimer;
  bool _voiceHeld = false;
  bool _voiceCancelled = false;

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
    _recordingTimer?.cancel();
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
          widget.header ??
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
                            style: TextStyle(
                              color: wa.textMuted,
                              fontSize: 12.5,
                            ),
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
    return LayoutBuilder(
      builder: (context, constraints) => ListView.builder(
        controller: _scrollController,
        padding: EdgeInsets.fromLTRB(
          MediaQuery.sizeOf(context).width < 720 ? 12 : 48,
          18,
          MediaQuery.sizeOf(context).width < 720 ? 12 : 48,
          22,
        ),
        itemCount: messages.length,
        itemBuilder: (context, index) {
          final supportMessage = messages[index];
          final chatMessage = supportMessage.toChatMessage(
            forAdmin: widget.adminEntry != null,
            isAdminThread: _conversation?.thread.isAdminThread ?? true,
            incomingName: widget.thread.title,
            supportUserId: widget.adminEntry?.user.id,
          );
          return ConversationMessageBubble(
            thread: widget.thread,
            message: chatMessage,
            viewportWidth: constraints.maxWidth,
            enableActions: widget.adminEntry != null,
            onReply: () {},
            onRunMessageAction: (message, action, data) =>
                _runMessageAction(supportMessage, message, action, data),
            onToggleDeletedReveal: (_, _) async {},
          );
        },
      ),
    );
  }

  Future<void> _runMessageAction(
    AdminSupportMessage supportMessage,
    ChatMessage message,
    String action,
    Map<String, Object?> data,
  ) async {
    final entry = widget.adminEntry;
    if (entry == null) return;
    if (action == 'delete') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Apagar mensagem?'),
          content: const Text('A mensagem será ocultada para os dois lados.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFB42318),
              ),
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Apagar'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    try {
      await ref
          .read(apiClientProvider)
          .runAdminSupportMessageAction(
            userId: entry.user.id,
            whatsappId: widget.thread.chatJid,
            messageId: supportMessage.id,
            action: action,
            text: action == 'edit' ? data['text']?.toString() : null,
            emoji: action == 'react' ? data['emoji']?.toString() : null,
          );
      await _loadConversation(silent: true, scrollToBottom: false);
      widget.onConversationChanged?.call();
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Widget _buildComposer(BuildContext context) => ConversationComposer(
    controller: _messageController,
    onSend: _sendText,
    onEmoji: _openComposerPicker,
    onAttach: _pickAndSendMedia,
    mentionAll: false,
    mentionSuggestions: const [],
    buttonsEnabled: false,
    buttons: const [],
    botEnabled: false,
    showBotButton: false,
    showStoreButton: false,
    internalGroup: false,
    voiceRecording: _recording,
    voiceRecordingBusy: _recordingBusy || _sending,
    voiceDuration: _recordingDuration,
    voiceViewOnce: false,
    onStore: () {},
    showSweepstakeButton: false,
    onSweepstake: () {},
    onBot: () {},
    onVoiceStart: _startVoiceRecording,
    onVoiceStop: _stopAndSendVoice,
    onCancelVoice: _cancelVoiceRecording,
    onVoiceViewOnceChanged: null,
    onMentionAllChanged: null,
    onEditButtons: null,
    onClearButtons: null,
  );

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
      final api = ref.read(apiClientProvider);
      final admin = widget.adminEntry;
      final payload = admin == null
          ? await api.loadUserSupportConversation(
              whatsappId: widget.thread.chatJid,
            )
          : await api.loadAdminSupportConversation(
              userId: admin.user.id,
              whatsappId: widget.thread.chatJid,
            );
      if (!mounted || generation != _generation) return;
      final previousCount = _conversation?.messages.length ?? 0;
      final wasNearBottom =
          !_scrollController.hasClients ||
          _scrollController.position.extentAfter < 120;
      setState(() {
        _conversation = payload;
        _loading = false;
        _refreshing = false;
        _error = null;
      });
      if (scrollToBottom ||
          (payload.messages.length > previousCount && wasNearBottom)) {
        _scheduleScrollToBottom();
      }
      if (payload.messages.length != previousCount) {
        widget.onConversationChanged?.call();
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
      final api = ref.read(apiClientProvider);
      final admin = widget.adminEntry;
      if (admin == null) {
        await api.sendUserSupportText(
          whatsappId: widget.thread.chatJid,
          text: text,
        );
      } else {
        await api.sendAdminSupportText(
          userId: admin.user.id,
          whatsappId: widget.thread.chatJid,
          text: text,
        );
      }
      _messageController.clear();
      await _loadConversation(silent: true, scrollToBottom: true);
      widget.onConversationChanged?.call();
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _openComposerPicker() async {
    final result = await showConversationComposerPicker(
      context,
      ref.read(apiClientProvider),
    );
    if (!mounted || result == null) return;
    if (result.emoji != null) {
      final value = _messageController.value;
      final start = value.selection.isValid
          ? value.selection.start
          : value.text.length;
      final end = value.selection.isValid
          ? value.selection.end
          : value.text.length;
      final text = value.text.replaceRange(start, end, result.emoji!);
      _messageController.value = TextEditingValue(
        text: text,
        selection: TextSelection.collapsed(
          offset: start + result.emoji!.length,
        ),
      );
      return;
    }
    final item = result.giphy;
    if (item == null) return;
    try {
      final media = await ref.read(apiClientProvider).downloadGiphyMedia(item);
      await _sendSupportMedia(
        bytes: media.bytes,
        fileName: item.fileNameForMimeType(media.mimeType),
        mimeType: media.mimeType,
        mediaType: item.isSticker ? 'sticker' : 'image',
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
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
    _voiceHeld = true;
    _voiceCancelled = false;
    setState(() => _recordingBusy = true);
    try {
      await _voiceRecorder.start();
      if (!mounted || _voiceCancelled || !_voiceHeld) {
        await _voiceRecorder.cancel();
        return;
      }
      setState(() {
        _recording = true;
        _recordingStartedAt = DateTime.now();
        _recordingDuration = Duration.zero;
      });
      _recordingTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
        if (mounted && _recordingStartedAt != null)
          setState(
            () => _recordingDuration = DateTime.now().difference(
              _recordingStartedAt!,
            ),
          );
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _recordingBusy = false);
    }
  }

  Future<void> _stopAndSendVoice() async {
    _voiceHeld = false;
    if (!_recording || _recordingBusy) return;
    _recordingTimer?.cancel();
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

  Future<void> _cancelVoiceRecording() async {
    _voiceHeld = false;
    _voiceCancelled = true;
    if (_recordingBusy && !_recording) return;
    _recordingTimer?.cancel();
    await _voiceRecorder.cancel();
    if (mounted)
      setState(() {
        _recording = false;
        _recordingBusy = false;
        _recordingStartedAt = null;
        _recordingDuration = Duration.zero;
      });
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
      final api = ref.read(apiClientProvider);
      final admin = widget.adminEntry;
      if (admin == null) {
        await api.sendUserSupportMedia(
          whatsappId: widget.thread.chatJid,
          bytes: bytes,
          fileName: fileName,
          mimeType: mimeType,
          mediaType: mediaType,
          caption: caption,
        );
      } else {
        await api.sendAdminSupportMedia(
          userId: admin.user.id,
          whatsappId: widget.thread.chatJid,
          bytes: bytes,
          fileName: fileName,
          mimeType: mimeType,
          mediaType: mediaType,
          caption: caption,
        );
      }
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

String? _supportAbsoluteUrl(String? value) {
  final raw = value?.trim() ?? '';
  if (raw.isEmpty) return null;
  final parsed = Uri.tryParse(raw);
  if (parsed != null && parsed.hasScheme) return raw;
  final base = Uri.tryParse(AppConfig.apiBaseUrl);
  if (base == null || !base.hasScheme) return null;
  return base.resolve(raw.startsWith('/') ? raw : '/$raw').toString();
}
