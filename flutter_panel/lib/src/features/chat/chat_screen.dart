import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../core/api_client.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/call_audio_bridge.dart';
import '../../core/conversation_cache.dart';
import '../../core/media_download.dart';
import '../../core/theme_controller.dart';
import '../../core/top_toast.dart';
import '../../core/voice_recorder.dart';
import '../../core/wa_theme.dart';
import '../../core/whatsapp_realtime_client.dart';
import '../../models/bot_group.dart';
import '../../models/chat_message.dart';
import '../../models/conversation_thread.dart';
import '../../models/internal_group.dart';
import '../../models/migration_models.dart';
import '../../models/sweepstake.dart';
import '../dashboard/dashboard_controller.dart';
import 'authenticated_media_image.dart';
import 'animated_sticker_image.dart';
import 'contact_export.dart';
import 'emoji_catalog.dart';
import 'media_players.dart';

final instanceNativeButtonsProvider = FutureProvider.autoDispose
    .family<bool, int>((ref, instanceId) async {
      if (instanceId <= 0) return false;
      final bundle = await ref
          .watch(apiClientProvider)
          .loadInstanceSettings(instanceId);
      return bundle.settings.enabled('nativeButtons');
    });

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({
    super.key,
    required this.thread,
    this.group,
    this.leading,
    this.onOpenGroupSettings,
    this.onShowGroupInfo,
    this.onOpenTools,
    this.onOpenCalls,
    this.onOpenSupport,
    this.onReconnectProfile,
    this.onOpenContact,
    this.onOpenParticipantConversation,
  });

  final ConversationThread? thread;
  final BotGroup? group;
  final Widget? leading;
  final VoidCallback? onOpenGroupSettings;
  final VoidCallback? onShowGroupInfo;
  final VoidCallback? onOpenTools;
  final VoidCallback? onOpenCalls;
  final VoidCallback? onOpenSupport;
  final VoidCallback? onReconnectProfile;
  final void Function(ChatContactCard contact)? onOpenContact;
  final void Function(String jid, String displayName)?
  onOpenParticipantConversation;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen>
    with WidgetsBindingObserver {
  /// Recent window first (WhatsApp-style). Older history loads on scroll-up.
  static const _initialMessageLimit = 40;
  static const _olderMessageLimit = 60;

  final _text = TextEditingController();
  final _search = TextEditingController();
  final _messagesScrollController = ScrollController();
  Timer? _realtimeTimer;
  Timer? _realtimeRefreshDebounce;
  Timer? _scrollSettledRefreshTimer;
  WhatsappRealtimeClient? _realtimeSocket;
  ConversationThread? _realtimeThread;
  int _lastRealtimeSequence = 0;
  String? _lastAutoScrollKey;
  bool _checkingRealtime = false;
  bool _realtimePrimed = false;
  final Map<String, Future<void>> _latestRefreshInFlight = {};
  final Set<String> _remoteHistoryExhaustedCursors = {};
  final Set<String> _deliveryReceiptsSent = <String>{};
  bool _mentionAll = false;
  final Map<String, _MentionCandidate> _selectedMentions = {};
  List<_MentionCandidate> _mentionCandidates = const [];
  bool _restrictMemberPrivateChat = false;
  String? _internalGroupWallpaperUrl;
  Uint8List? _internalGroupWallpaperBytes;
  bool _internalGroupWallpaperUploadInFlight = false;
  ChatMessage? _replyTo;
  bool _searching = false;
  List<OutgoingInteractiveButton> _composerButtons = const [];
  List<ChatMessage> _messages = const [];
  bool _messagesLoading = false;
  bool _olderMessagesLoading = false;
  bool _hasMoreMessages = false;
  String? _oldestMessageCursor;
  Object? _messagesError;
  int _messageLoadGeneration = 0;
  BotStoreSnapshot? _storeSnapshot;
  bool _storeLoading = false;
  final VoiceRecorder _voiceRecorder = VoiceRecorder();
  Timer? _voiceDurationTimer;
  Duration _voiceDuration = Duration.zero;
  bool _voiceRecording = false;
  bool _voiceRecordingBusy = false;
  bool _voicePressActive = false;
  bool _voicePressCancelled = false;
  bool _voiceViewOnce = false;
  bool _checkingConnection = false;
  SweepstakeGroupSnapshot? _sweepstakes;
  bool _sweepstakesLoading = false;

  int? _sweepstakeGroupId(ConversationThread thread) {
    final id = thread.isInternalGroup
        ? thread.linkedGroupId
        : widget.group?.id ?? thread.linkedGroupId;
    return id != null && id > 0 ? id : null;
  }

  Future<void> _refreshSweepstakes(ConversationThread thread) async {
    final groupId = _sweepstakeGroupId(thread);
    if (groupId == null) {
      if (mounted && _sweepstakes != null) setState(() => _sweepstakes = null);
      return;
    }
    if (mounted) setState(() => _sweepstakesLoading = true);
    try {
      final snapshot = await ref
          .read(apiClientProvider)
          .loadGroupSweepstakes(groupId, internal: thread.isInternalGroup);
      if (mounted && _isCurrentThread(thread))
        setState(() => _sweepstakes = snapshot);
    } catch (_) {
      // O chat continua utilizável quando a tabela de sorteios ainda não foi
      // sincronizada; o botão apenas volta a tentar na próxima abertura.
    } finally {
      if (mounted) setState(() => _sweepstakesLoading = false);
    }
  }

  Future<bool> _ensureLiveConnection(ConversationThread thread) async {
    // BotAdmin internal groups are hosted by this API and do not have a
    // WhatsApp instance to reconnect.  Checking the instance here made
    // sending, ban commands and interactive reply buttons appear to do
    // nothing whenever the owner's WhatsApp profile was offline.
    if (thread.isSupport || thread.isInternalGroup || thread.instanceId <= 0) {
      return true;
    }
    if (_checkingConnection) return false;
    _checkingConnection = true;
    var connected = false;
    try {
      final status = await ref
          .read(apiClientProvider)
          .refreshInstanceStatus(thread.instanceId);
      final normalized = status.trim().toLowerCase();
      connected =
          normalized.contains('conect') && !normalized.contains('desconect');
      ref.invalidate(dashboardSnapshotProvider);
    } catch (_) {
      connected = false;
    } finally {
      _checkingConnection = false;
    }
    if (connected || !mounted) return connected;

    final reconnect = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        final wa = WaTheme.of(dialogContext);
        return AlertDialog(
          backgroundColor: wa.panel,
          title: Row(
            children: [
              CircleAvatar(
                backgroundColor: wa.accentSoft,
                child: Icon(Icons.link_off_rounded, color: wa.accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Reconecte seu perfil',
                  style: TextStyle(color: wa.textPrimary),
                ),
              ),
            ],
          ),
          content: Text(
            'O histórico continua disponível, mas o WhatsApp deste perfil está desconectado. Para continuar enviando e recebendo mensagens, reconecte o perfil.',
            style: TextStyle(color: wa.textSecondary, height: 1.4),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Agora não'),
            ),
            FilledButton.icon(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Text('Conectar perfil'),
            ),
          ],
        );
      },
    );
    if (reconnect == true && mounted) widget.onReconnectProfile?.call();
    return false;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _text.addListener(_onComposerChanged);
    _search.addListener(() {
      if (mounted) setState(() {});
    });
    _messagesScrollController.addListener(_handleMessagesScroll);
    _startRealtimeWatcher(widget.thread);
    _loadInitialMessages(widget.thread);
    _loadStoreContext(widget.thread);
    _loadMentionCandidates(widget.thread);
    if (widget.thread != null) unawaited(_refreshSweepstakes(widget.thread!));
  }

  @override
  void didUpdateWidget(covariant ChatScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.thread?.instanceId != widget.thread?.instanceId ||
        oldWidget.thread?.chatJid != widget.thread?.chatJid) {
      unawaited(_cancelVoiceRecording());
      _lastAutoScrollKey = null;
      _scrollSettledRefreshTimer?.cancel();
      _scrollSettledRefreshTimer = null;
      _composerButtons = const [];
      _selectedMentions.clear();
      _mentionCandidates = const [];
      _internalGroupWallpaperUrl = null;
      _internalGroupWallpaperBytes = null;
      _internalGroupWallpaperUploadInFlight = false;
      _resetMessagePageState();
      _startRealtimeWatcher(widget.thread);
      _loadInitialMessages(widget.thread);
      _loadStoreContext(widget.thread);
      _loadMentionCandidates(widget.thread);
      if (widget.thread != null) unawaited(_refreshSweepstakes(widget.thread!));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _realtimeTimer?.cancel();
    _realtimeRefreshDebounce?.cancel();
    _scrollSettledRefreshTimer?.cancel();
    _voiceDurationTimer?.cancel();
    unawaited(() async {
      await _voiceRecorder.cancel();
      await _voiceRecorder.dispose();
    }());
    unawaited(_realtimeSocket?.dispose());
    _messagesScrollController.removeListener(_handleMessagesScroll);
    _messagesScrollController.dispose();
    _text.removeListener(_onComposerChanged);
    _text.dispose();
    _search.dispose();
    super.dispose();
  }

  void _onComposerChanged() {
    if (!mounted) return;
    if (_text.text.trim().isEmpty) {
      _selectedMentions.clear();
      if (_mentionAll || _composerButtons.isNotEmpty) {
        _mentionAll = false;
        _composerButtons = const [];
      }
    }
    setState(() {});
  }

  Future<void> _loadMentionCandidates(ConversationThread? thread) async {
    if (thread == null || !thread.isGroup) return;
    try {
      final api = ref.read(apiClientProvider);
      InternalGroupDetails? internalDetails;
      if (!thread.isInternalGroup && widget.group?.id != null) {
        final bundle = await api.loadGroupSettings(widget.group!.id);
        _restrictMemberPrivateChat =
            bundle.settings.featureFlags['restrictMemberPrivateChat'] == true;
      }
      if (thread.isInternalGroup) {
        internalDetails = await api.loadInternalGroup(
          thread.linkedGroupId ??
              int.tryParse(thread.chatJid.split(':').last) ??
              0,
        );
      }
      final raw = internalDetails != null
          ? internalDetails.members
                .map(
                  (member) => <String, dynamic>{
                    'jid': member.userId,
                    'name': member.name,
                    'role': member.role,
                  },
                )
                .toList()
          : await api.loadGroupParticipants(widget.group?.id ?? 0);
      if (thread.isInternalGroup) {
        _restrictMemberPrivateChat = thread.membersCanStartPv == false;
      }
      final next = raw
          .map(_MentionCandidate.fromJson)
          .where((entry) => entry.jid.isNotEmpty && entry.label.isNotEmpty)
          .toList(growable: false);
      if (mounted && _isCurrentThread(thread)) {
        setState(() {
          _mentionCandidates = next;
          if (thread.isInternalGroup) {
            _internalGroupWallpaperUrl = internalDetails?.group.wallpaperUrl;
            if (!_internalGroupWallpaperUploadInFlight) {
              _internalGroupWallpaperBytes = null;
            }
          }
        });
      }
    } catch (_) {
      // Sugestões são auxiliares; a conversa continua disponível se a lista falhar.
    }
  }

  List<_MentionCandidate> _visibleMentionSuggestions() {
    final value = _text.text;
    final cursor = _text.selection.isValid
        ? _text.selection.baseOffset
        : value.length;
    if (cursor < 0 || cursor > value.length) return const [];
    final before = value.substring(0, cursor);
    final match = RegExp(r'(?:^|\s)@([^\n]*)$').firstMatch(before);
    if (match == null) return const [];
    final query = (match.group(1) ?? '').trim().toLowerCase();
    return _mentionCandidates
        .where(
          (entry) => query.isEmpty || entry.label.toLowerCase().contains(query),
        )
        .take(8)
        .toList(growable: false);
  }

  void _selectMention(_MentionCandidate candidate) {
    final value = _text.text;
    final cursor = _text.selection.isValid
        ? _text.selection.baseOffset
        : value.length;
    final before = value.substring(0, cursor);
    final match = RegExp(r'(?:^|\s)@([^\n]*)$').firstMatch(before);
    if (match == null) return;
    final start = match.start + (before[match.start] == '@' ? 0 : 1);
    final replacement = '@${candidate.label} ';
    final next = value.replaceRange(start, cursor, replacement);
    _text.value = _text.value.copyWith(
      text: next,
      selection: TextSelection.collapsed(offset: start + replacement.length),
      composing: TextRange.empty,
    );
    _selectedMentions[candidate.jid] = candidate;
  }

  void _openMentionConversation(String jid, String displayName) {
    if (_restrictMemberPrivateChat && widget.thread?.instanceIsAdmin != true) {
      showSuccessToast(
        context,
        'Somente administradores podem iniciar PV com membros neste grupo.',
      );
      return;
    }
    widget.onOpenParticipantConversation?.call(jid, displayName);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      final thread = widget.thread;
      if (thread != null) {
        unawaited(_checkRealtimeEvents(thread));
        unawaited(
          _refreshLatestMessages(thread, scrollToLatest: _isNearLatest()),
        );
      }
    }
  }

  bool _isCurrentThread(ConversationThread thread) {
    final current = widget.thread;
    return current?.instanceId == thread.instanceId &&
        current?.chatJid == thread.chatJid;
  }

  void _resetMessagePageState() {
    _messageLoadGeneration += 1;
    _messages = const [];
    _messagesLoading = false;
    _olderMessagesLoading = false;
    _hasMoreMessages = false;
    _oldestMessageCursor = null;
    _remoteHistoryExhaustedCursors.clear();
    _deliveryReceiptsSent.clear();
    _messagesError = null;
  }

  Future<void> _loadInitialMessages(
    ConversationThread? thread, {
    bool silent = false,
    bool scrollToLatest = true,
  }) async {
    if (thread == null) return;
    final generation = ++_messageLoadGeneration;
    final cache = ref.read(conversationCacheProvider);

    void applyPage({
      required List<ChatMessage> messages,
      required bool hasMore,
      required String? oldestCursor,
      required bool mergeLocal,
      required bool doScroll,
    }) {
      if (!mounted || generation != _messageLoadGeneration) return;
      if (!_isCurrentThread(thread)) return;
      final next = mergeLocal
          ? _mergeServerWithLocal(messages, _messages)
          : _dedupeAndSort(messages);
      cache.putMessages(
        thread,
        CachedMessagePage(
          messages: next,
          hasMore: hasMore,
          oldestCursor: oldestCursor,
          fetchedAt: DateTime.now(),
        ),
      );
      if (!doScroll && _isChatActivelyScrolling()) {
        _refreshAfterScrollSettles(thread);
        return;
      }
      final messagesChanged = !_messagesRenderEqual(_messages, next);
      final stateChanged =
          messagesChanged ||
          _hasMoreMessages != hasMore ||
          _oldestMessageCursor != oldestCursor ||
          _messagesLoading ||
          _olderMessagesLoading ||
          _messagesError != null;
      final wasNearLatest = _isNearLatest();
      final preserveViewport =
          messagesChanged &&
          !wasNearLatest &&
          _hasNewerRows(_messages, next) &&
          _messagesScrollController.hasClients;
      final previousPixels = preserveViewport
          ? _messagesScrollController.position.pixels
          : 0.0;
      final previousMaxExtent = preserveViewport
          ? _messagesScrollController.position.maxScrollExtent
          : 0.0;
      if (stateChanged) {
        setState(() {
          _messages = next;
          _hasMoreMessages = hasMore;
          _oldestMessageCursor = oldestCursor;
          _messagesLoading = false;
          _olderMessagesLoading = false;
          _messagesError = null;
        });
        if (preserveViewport) {
          _preserveViewportAfterBottomInsert(
            previousPixels: previousPixels,
            previousMaxExtent: previousMaxExtent,
          );
        }
      }
      if (next.isNotEmpty) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && _isCurrentThread(thread)) {
            unawaited(_markCurrentThreadRead(thread));
          }
        });
      }
      if (doScroll) {
        _scheduleScrollToLatest(
          thread,
          _filteredMessages(_messagesWithAttachedReactions(next)),
          force: true,
        );
      }
    }

    // 1) Instant paint from warm cache (WhatsApp-style open).
    final cached = cache.peekMessages(thread);
    if (!silent && cached != null && cached.messages.isNotEmpty) {
      applyPage(
        messages: cached.messages,
        hasMore: cached.hasMore,
        oldestCursor: cached.oldestCursor,
        mergeLocal: false,
        doScroll: scrollToLatest,
      );
      // 2) Full refresh in background (not recursive warm cache hit).
      unawaited(() async {
        try {
          await Future<void>.delayed(const Duration(milliseconds: 650));
          if (!mounted ||
              generation != _messageLoadGeneration ||
              !_isCurrentThread(thread)) {
            return;
          }
          final page = await cache.loadRecent(
            thread,
            limit: _initialMessageLimit,
            preferCache: false,
            warm: false,
          );
          applyPage(
            messages: page.messages,
            hasMore: page.hasMore,
            oldestCursor: page.oldestCursor,
            mergeLocal: true,
            doScroll: false,
          );
        } catch (_) {
          // Keep cached messages on soft refresh failure.
        }
      }());
      return;
    }

    if (mounted) {
      setState(() {
        _messagesError = null;
        if (!silent || _messages.isEmpty) _messagesLoading = true;
      });
    }
    try {
      // Cold open: fetch recent window via warm path (fast backend), then full.
      final warmPage = await cache.loadRecent(
        thread,
        limit: _initialMessageLimit,
        preferCache: false,
        warm: true,
      );
      applyPage(
        messages: warmPage.messages,
        hasMore: warmPage.hasMore,
        oldestCursor: warmPage.oldestCursor,
        mergeLocal: silent,
        doScroll: scrollToLatest,
      );
      unawaited(() async {
        try {
          await Future<void>.delayed(const Duration(milliseconds: 650));
          if (!mounted ||
              generation != _messageLoadGeneration ||
              !_isCurrentThread(thread)) {
            return;
          }
          final full = await cache.loadRecent(
            thread,
            limit: _initialMessageLimit,
            preferCache: false,
            warm: false,
          );
          applyPage(
            messages: full.messages,
            hasMore: full.hasMore,
            oldestCursor: full.oldestCursor,
            mergeLocal: true,
            doScroll: false,
          );
        } catch (_) {}
      }());
    } catch (error) {
      if (!mounted || generation != _messageLoadGeneration) return;
      setState(() {
        _messagesLoading = false;
        _olderMessagesLoading = false;
        _messagesError = error;
      });
    }
  }

  Future<void> _refreshLatestMessages(
    ConversationThread thread, {
    bool scrollToLatest = false,
  }) async {
    if (!_isCurrentThread(thread)) return;
    final key = ConversationCache.threadKey(thread);
    final existing = _latestRefreshInFlight[key];
    if (existing != null) return existing;
    final generation = _messageLoadGeneration;

    final request = () async {
      try {
        final page = await ref
            .read(conversationCacheProvider)
            .loadRecent(
              thread,
              limit: _initialMessageLimit,
              preferCache: false,
              warm: true,
            );
        if (!mounted || generation != _messageLoadGeneration) return;
        if (!_isCurrentThread(thread)) return;
        // Never mutate the sliver while the reader is dragging or while a
        // ballistic scroll is still running. The fetched page is cheap to
        // request again once scrolling settles and this avoids mid-gesture
        // frame jumps entirely.
        if (_isChatActivelyScrolling()) {
          _refreshAfterScrollSettles(thread);
          return;
        }
        final hadOnlyLatestPage =
            _messages.length <= _initialMessageLimit + 8 ||
            _oldestMessageCursor == null;
        final mergedServer = hadOnlyLatestPage
            ? page.messages
            : [
                ..._messages.where((m) => !m.isLocalOptimistic),
                ...page.messages,
              ];
        final next = _mergeServerWithLocal(mergedServer, _messages);
        final messagesChanged = !_messagesRenderEqual(_messages, next);
        final paginationChanged =
            hadOnlyLatestPage &&
            (_hasMoreMessages != page.hasMore ||
                _oldestMessageCursor != page.oldestCursor);
        final stateChanged =
            messagesChanged ||
            paginationChanged ||
            _messagesLoading ||
            _messagesError != null;
        final wasNearLatest = _isNearLatest();
        final preserveViewport =
            messagesChanged &&
            !wasNearLatest &&
            _hasNewerRows(_messages, next) &&
            _messagesScrollController.hasClients;
        final previousPixels = preserveViewport
            ? _messagesScrollController.position.pixels
            : 0.0;
        final previousMaxExtent = preserveViewport
            ? _messagesScrollController.position.maxScrollExtent
            : 0.0;
        if (stateChanged) {
          setState(() {
            _messages = next;
            if (hadOnlyLatestPage) {
              _hasMoreMessages = page.hasMore;
              _oldestMessageCursor = page.oldestCursor;
            }
            _messagesLoading = false;
            _messagesError = null;
          });
          if (preserveViewport) {
            _preserveViewportAfterBottomInsert(
              previousPixels: previousPixels,
              previousMaxExtent: previousMaxExtent,
            );
          }
        }
        unawaited(_acknowledgeInternalDeliveries(thread, next));
        if (scrollToLatest && wasNearLatest && !_isChatActivelyScrolling()) {
          _scheduleScrollToLatest(
            thread,
            _filteredMessages(_messagesWithAttachedReactions(next)),
            force: false,
          );
        }
      } catch (error) {
        if (!mounted || generation != _messageLoadGeneration) return;
        if (_messages.isEmpty) {
          setState(() {
            _messagesLoading = false;
            _messagesError = error;
          });
        }
      }
    }();

    _latestRefreshInFlight[key] = request;
    try {
      await request;
    } finally {
      if (identical(_latestRefreshInFlight[key], request)) {
        _latestRefreshInFlight.remove(key);
      }
    }
  }

  void _handleMessagesScroll() {
    if (!_messagesScrollController.hasClients) return;
    if (_search.text.trim().isNotEmpty) return;
    final thread = widget.thread;
    if (thread == null) return;
    final position = _messagesScrollController.position;
    if (position.maxScrollExtent - position.pixels <= 220) {
      unawaited(_loadOlderMessages(thread));
    }
  }

  bool _isNearLatest() {
    if (!_messagesScrollController.hasClients) return true;
    final position = _messagesScrollController.position;
    return position.pixels <= 72;
  }

  bool _isChatActivelyScrolling() {
    if (!_messagesScrollController.hasClients) return false;
    return _messagesScrollController.position.isScrollingNotifier.value;
  }

  void _refreshAfterScrollSettles(ConversationThread thread) {
    _scrollSettledRefreshTimer?.cancel();

    void check() {
      if (!mounted || !_isCurrentThread(thread)) return;
      if (_isChatActivelyScrolling()) {
        _scrollSettledRefreshTimer = Timer(
          const Duration(milliseconds: 180),
          check,
        );
        return;
      }
      _scrollSettledRefreshTimer = null;
      unawaited(_refreshLatestMessages(thread, scrollToLatest: false));
    }

    _scrollSettledRefreshTimer = Timer(
      const Duration(milliseconds: 180),
      check,
    );
  }

  bool _messagesRenderEqual(List<ChatMessage> current, List<ChatMessage> next) {
    if (identical(current, next)) return true;
    if (current.length != next.length) return false;
    for (var index = 0; index < current.length; index++) {
      if (_messageRenderHash(current[index]) !=
          _messageRenderHash(next[index])) {
        return false;
      }
    }
    return true;
  }

  int _messageRenderHash(ChatMessage message) => Object.hashAll(<Object?>[
    _messageIdentityKey(message),
    message.timestamp.microsecondsSinceEpoch,
    message.text,
    message.senderName,
    message.senderJid,
    message.senderAvatarUrl,
    message.messageType,
    message.mediaUrl,
    message.mediaThumbnailUrl,
    message.mediaFileName,
    message.mediaMimeType,
    message.mediaCaption,
    message.mediaTitle,
    message.mediaDurationSeconds,
    message.deletedAt?.microsecondsSinceEpoch,
    message.deletedByName,
    message.revealDeletedContent,
    message.localStatus,
    message.deliveryState,
    Object.hashAll(
      message.receiptSummary.entries.map(
        (entry) => Object.hash(entry.key, entry.value),
      ),
    ),
    Object.hashAll(
      message.reactions.map(
        (reaction) => Object.hash(
          reaction.emoji,
          reaction.senderJid,
          reaction.timestamp?.microsecondsSinceEpoch,
        ),
      ),
    ),
    Object.hashAll(
      message.interactiveButtons.map(
        (button) => Object.hash(
          button.id,
          button.title,
          button.type,
          button.url,
          button.copyCode,
        ),
      ),
    ),
    Object.hashAll(
      message.pollOptions.map(
        (option) => Object.hash(
          option.id,
          option.title,
          option.voteCount,
          Object.hashAll(option.voterNames),
        ),
      ),
    ),
    Object.hashAll(
      message.media.entries.map(
        (entry) => Object.hash(entry.key, entry.value.toString()),
      ),
    ),
    message.quoted?.id,
    message.quoted?.text,
    message.quoted?.title,
  ]);

  bool _hasNewerRows(List<ChatMessage> current, List<ChatMessage> next) {
    if (current.isEmpty || next.isEmpty) return false;
    final currentLatest = _messageIdentityKey(current.last);
    final oldLatestIndex = next.indexWhere(
      (message) => _messageIdentityKey(message) == currentLatest,
    );
    return oldLatestIndex >= 0 && oldLatestIndex < next.length - 1;
  }

  void _preserveViewportAfterBottomInsert({
    required double previousPixels,
    required double previousMaxExtent,
  }) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_messagesScrollController.hasClients) return;
      final position = _messagesScrollController.position;
      if (position.isScrollingNotifier.value) return;
      // In a reversed list, new messages are inserted below the current
      // viewport. Compensating the added extent keeps the exact same message
      // under the reader's eyes.
      final addedExtent = position.maxScrollExtent - previousMaxExtent;
      if (addedExtent <= 0.5) return;
      final target = (previousPixels + addedExtent).clamp(
        position.minScrollExtent,
        position.maxScrollExtent,
      );
      if ((position.pixels - target).abs() > 0.5) {
        _messagesScrollController.jumpTo(target);
      }
    });
  }

  Future<void> _loadOlderMessages(ConversationThread thread) async {
    final cursor = _oldestMessageCursor;
    if (!_isCurrentThread(thread) ||
        _messagesLoading ||
        _olderMessagesLoading ||
        cursor == null ||
        cursor.isEmpty) {
      return;
    }

    final generation = _messageLoadGeneration;
    setState(() => _olderMessagesLoading = true);
    try {
      var page = await ref
          .read(apiClientProvider)
          .loadMessagePage(thread, limit: _olderMessageLimit, before: cursor);
      if (page.messages.isEmpty &&
          !_hasMoreMessages &&
          !_remoteHistoryExhaustedCursors.contains(cursor)) {
        await ref
            .read(apiClientProvider)
            .requestOlderChatHistory(thread, count: 50);
        for (var attempt = 0; attempt < 4 && page.messages.isEmpty; attempt++) {
          await Future<void>.delayed(
            Duration(milliseconds: 900 + (attempt * 500)),
          );
          if (!mounted ||
              generation != _messageLoadGeneration ||
              !_isCurrentThread(thread)) {
            return;
          }
          page = await ref
              .read(apiClientProvider)
              .loadMessagePage(
                thread,
                limit: _olderMessageLimit,
                before: cursor,
              );
        }
        if (page.messages.isEmpty) {
          _remoteHistoryExhaustedCursors.add(cursor);
        }
      }
      if (!mounted || generation != _messageLoadGeneration) return;
      if (!_isCurrentThread(thread)) return;
      // Building dozens of history bubbles during a drag/ballistic animation
      // is a visible hitch on mid-range Android devices. The data is already
      // fetched; attach it only when the scroll physics are idle.
      while (_isChatActivelyScrolling()) {
        await Future<void>.delayed(const Duration(milliseconds: 80));
        if (!mounted ||
            generation != _messageLoadGeneration ||
            !_isCurrentThread(thread)) {
          return;
        }
      }
      final next = _dedupeAndSort([...page.messages, ..._messages]);
      setState(() {
        _messages = next;
        _hasMoreMessages = page.hasMore;
        _oldestMessageCursor = page.oldestCursor;
        _olderMessagesLoading = false;
        _messagesError = null;
      });
    } catch (error) {
      if (!mounted || generation != _messageLoadGeneration) return;
      setState(() {
        _olderMessagesLoading = false;
        _messagesError = _messages.isEmpty ? error : _messagesError;
      });
      if (_messages.isNotEmpty) {
        showErrorToast(
          context,
          'Não foi possível carregar mensagens antigas: $error',
        );
      }
    }
  }

  List<ChatMessage> _dedupeAndSort(Iterable<ChatMessage> items) {
    final byKey = <String, ChatMessage>{};
    for (final message in items) {
      final key = _messageIdentityKey(message);
      byKey[key] = message;
    }
    final messages = byKey.values.toList();
    messages.sort((left, right) {
      final byTime = left.timestamp.compareTo(right.timestamp);
      if (byTime != 0) return byTime;
      return _messageIdentityKey(left).compareTo(_messageIdentityKey(right));
    });
    return messages;
  }

  String _messageIdentityKey(ChatMessage message) {
    return message.identityKey;
  }

  void _replaceMessage(ChatMessage nextMessage) {
    final nextKey = _messageIdentityKey(nextMessage);
    setState(() {
      _messages = _dedupeAndSort(
        _messages.map((message) {
          return _messageIdentityKey(message) == nextKey
              ? nextMessage
              : message;
        }),
      );
    });
  }

  void _startRealtimeWatcher(ConversationThread? thread) {
    _realtimeTimer?.cancel();
    _realtimeTimer = null;
    _realtimeRefreshDebounce?.cancel();
    _realtimeRefreshDebounce = null;
    unawaited(_realtimeSocket?.dispose());
    _realtimeSocket = null;
    _realtimeThread = thread;
    _lastRealtimeSequence = 0;
    _checkingRealtime = false;
    _realtimePrimed = false;
    if (thread == null) return;
    if (thread.isInternalGroup) {
      _realtimePrimed = true;
      _connectRealtimeSocket(thread);
      return;
    }
    unawaited(_checkRealtimeEvents(thread));
    _realtimeTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _checkRealtimeEvents(thread),
    );
  }

  void _connectRealtimeSocket(ConversationThread thread) {
    if (!mounted || !_isCurrentThread(thread) || !_realtimePrimed) return;
    unawaited(_realtimeSocket?.dispose());
    _realtimeSocket = WhatsappRealtimeClient(
      sessionStore: ref.read(sessionStoreProvider),
      after: _lastRealtimeSequence,
      onEvent: (event) {
        if (!mounted) return;
        if (event.instanceId != thread.instanceId ||
            event.chatJid != thread.chatJid) {
          return;
        }
        final sequenceId = event.sequenceId;
        final isNewRealtimeEvent =
            _realtimePrimed &&
            (sequenceId <= 0 || sequenceId > _lastRealtimeSequence);
        if (sequenceId > _lastRealtimeSequence) {
          _lastRealtimeSequence = sequenceId;
        }
        if (event.eventType?.startsWith('internal-group.') == true) {
          ref.invalidate(dashboardSnapshotProvider);
        }
        if (event.eventType == 'internal-group.group.updated') {
          // Redis/WebSocket dispara uma única atualização do grupo; não há
          // polling periódico para descobrir a troca do papel de parede.
          unawaited(_loadMentionCandidates(thread));
        }
        if (event.eventType == 'internal-group.messages.cleared') {
          ref.read(conversationCacheProvider).removeMessages(thread);
          setState(() {
            _messages = const [];
            _hasMoreMessages = false;
            _oldestMessageCursor = null;
          });
          return;
        }
        if (event.eventType == 'internal-group.message.receipt') {
          _applyInternalReceiptEvent(event);
        }
        if (event.eventType == 'internal-group.message.created' &&
            event.payload?['action']?.toString().startsWith(
                  'sweepstake.participant.',
                ) ==
                true) {
          unawaited(_refreshSweepstakes(thread));
        }
        if (event.eventType == 'internal-group.group.deleted') {
          ref.read(conversationCacheProvider).removeMessages(thread);
          return;
        }
        if (isNewRealtimeEvent &&
            _realtimeEventChangesMessages(event.eventType)) {
          _scheduleRealtimeRefresh(thread);
        }
      },
      onReconnectNeeded: () {
        if (!mounted) return;
        unawaited(_checkRealtimeEvents(thread));
      },
    )..start();
  }

  void _scheduleRealtimeRefresh(ConversationThread thread) {
    _realtimeRefreshDebounce?.cancel();
    _realtimeRefreshDebounce = Timer(const Duration(milliseconds: 180), () {
      if (!mounted || !_isCurrentThread(thread)) return;
      unawaited(() async {
        await _refreshLatestMessages(thread, scrollToLatest: _isNearLatest());
        if (!mounted || !_isCurrentThread(thread)) return;
        await _markCurrentThreadRead(thread);
      }());
    });
  }

  void _applyInternalReceiptEvent(WhatsappRealtimeSocketEvent event) {
    final messageId =
        event.payload?['messageId']?.toString() ??
        event.message?['id']?.toString();
    if (messageId == null || messageId.isEmpty || !mounted) return;
    final state = (event.payload?['action']?.toString() ?? 'delivered')
        .toLowerCase();
    setState(() {
      _messages = _messages
          .map((message) {
            if (!message.fromMe ||
                (message.remoteId != messageId && message.id != messageId)) {
              return message;
            }
            final summary = <String, int>{...message.receiptSummary};
            summary['recipientCount'] = math.max(
              summary['recipientCount'] ?? 0,
              1,
            );
            summary['deliveredCount'] = math.max(
              summary['deliveredCount'] ?? 0,
              1,
            );
            if (state == 'read') {
              summary['readCount'] = math.max(summary['readCount'] ?? 0, 1);
            }
            return message.copyWith(
              deliveryState: state == 'read'
                  ? MessageDeliveryState.read
                  : MessageDeliveryState.delivered,
              receiptSummary: summary,
            );
          })
          .toList(growable: false);
    });
  }

  Future<void> _checkRealtimeEvents(ConversationThread thread) async {
    if (_checkingRealtime) return;
    final currentThread = _realtimeThread;
    if (currentThread?.instanceId != thread.instanceId ||
        currentThread?.chatJid != thread.chatJid) {
      return;
    }
    _checkingRealtime = true;
    try {
      if (thread.isInternalGroup) {
        final previousLatest = _messages.isEmpty
            ? null
            : _messageIdentityKey(_messages.last);
        await _refreshLatestMessages(thread, scrollToLatest: _isNearLatest());
        final nextLatest = _messages.isEmpty
            ? null
            : _messageIdentityKey(_messages.last);
        if (mounted &&
            _isCurrentThread(thread) &&
            nextLatest != previousLatest) {
          await _markCurrentThreadRead(thread);
        }
        return;
      }
      final snapshot = await ref
          .read(apiClientProvider)
          .loadWhatsappRealtimeEvents(
            after: _lastRealtimeSequence,
            instanceId: thread.instanceId,
            chatJid: thread.chatJid,
          );
      final latest = snapshot['latestSequenceId'];
      if (latest is num && latest.toInt() > _lastRealtimeSequence) {
        _lastRealtimeSequence = latest.toInt();
        _realtimeSocket?.updateSequence(_lastRealtimeSequence);
      }
      final events = snapshot['events'];
      if (!_realtimePrimed) {
        _realtimePrimed = true;
        _connectRealtimeSocket(thread);
        return;
      }
      final hasMessageEvents =
          events is List &&
          events.any((event) {
            if (event is! Map) return false;
            return _realtimeEventChangesMessages(
              event['eventType']?.toString(),
            );
          });
      if (hasMessageEvents && mounted) {
        _scheduleRealtimeRefresh(thread);
      }
    } catch (_) {
      // Realtime is opportunistic; manual refresh remains available.
    } finally {
      _checkingRealtime = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final thread = widget.thread;
    // Rebuild chat surfaces when dark/clean flips.
    ref.watch(themeControllerProvider);
    if (thread == null) return _NoChatSelected();

    final nativeButtonsEnabled = ref
        .watch(instanceNativeButtonsProvider(thread.instanceId))
        .maybeWhen(data: (enabled) => enabled, orElse: () => false);
    final canUseInteractiveButtons = nativeButtonsEnabled && !thread.isChannel;
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.chatBg,
      child: Column(
        children: [
          _ChatHeader(
            thread: thread,
            group: widget.group,
            leading: widget.leading,
            onRefresh: () => unawaited(_refreshMessages(thread)),
            onSearch: () => setState(() => _searching = !_searching),
            onShowInfo:
                widget.onShowGroupInfo ??
                () => _showThreadInfoDialog(
                  context,
                  thread: thread,
                  group: widget.group,
                  messages: _messages,
                  onRunConversationAction: (action) =>
                      _runConversationAction(thread, action),
                  onOpenParticipantConversation:
                      widget.onOpenParticipantConversation,
                ),
            onOpenGroupSettings: widget.onOpenGroupSettings,
            onToggleBot:
                thread.isGroup &&
                    (!thread.isInternalGroup || thread.instanceIsAdmin == true)
                ? () =>
                      unawaited(_toggleGroupBotForThread(thread, widget.group))
                : null,
            onOpenTools: widget.onOpenTools,
            onOpenCalls: widget.onOpenCalls,
            onOpenSupport: widget.onOpenSupport,
            onCopyInternalGroupLink: thread.isInternalGroup
                ? () => _copyInternalGroupLink(thread)
                : null,
            onRotateInternalGroupLink: thread.isInternalGroup
                ? () => _rotateInternalGroupLink(thread)
                : null,
            onChangeInternalGroupWallpaper:
                thread.isInternalGroup && thread.instanceIsAdmin == true
                ? () => _changeInternalGroupWallpaper(thread)
                : null,
            onStartCall: (video) => _startCall(thread, video: video),
            onRunConversationAction: (action) =>
                _runConversationAction(thread, action),
            onTransferAndLeave:
                thread.isInternalGroup && thread.internalGroupRole == 'owner'
                ? () => _transferInternalGroupAndLeave(thread)
                : null,
          ),
          if (_searching)
            _ChatSearchBar(
              controller: _search,
              onClose: () {
                _search.clear();
                setState(() => _searching = false);
              },
            ),
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: _WhatsAppWallpaper(
                    imageUrl: thread.isInternalGroup
                        ? _internalGroupWallpaperUrl
                        : null,
                    imageBytes: thread.isInternalGroup
                        ? _internalGroupWallpaperBytes
                        : null,
                  ),
                ),
                Positioned.fill(
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final padding = _conversationListPadding(
                        constraints.maxWidth,
                      );
                      final messageViewportWidth =
                          constraints.maxWidth - padding.horizontal;
                      final loadingInitial =
                          _messagesLoading && _messages.isEmpty;
                      final error = _messagesError;
                      if (loadingInitial) {
                        return Center(child: CircularProgressIndicator());
                      }
                      if (error != null && _messages.isEmpty) {
                        return _MessageLoadError(
                          error: error,
                          onRetry: () => unawaited(
                            _loadInitialMessages(thread, scrollToLatest: true),
                          ),
                        );
                      }
                      final visible = _filteredMessages(
                        _messagesWithAttachedReactions(_messages),
                      );
                      if (visible.isEmpty) return const _EmptyConversation();
                      final queryActive = _search.text.trim().isNotEmpty;
                      final showOlderLoader =
                          !queryActive &&
                          (_olderMessagesLoading || _hasMoreMessages);
                      final loaderOffset = showOlderLoader ? 1 : 0;
                      return ListView.builder(
                        controller: _messagesScrollController,
                        padding: padding,
                        scrollCacheExtent: ScrollCacheExtent.pixels(
                          constraints.maxHeight * 1.25,
                        ),
                        // Players em reprodução solicitam keep-alive. Assim o
                        // áudio/vídeo não reinicia quando o balão sai da tela.
                        addAutomaticKeepAlives: true,
                        addRepaintBoundaries: true,
                        addSemanticIndexes: false,
                        keyboardDismissBehavior:
                            ScrollViewKeyboardDismissBehavior.onDrag,
                        reverse: true,
                        itemCount: visible.length + loaderOffset,
                        itemBuilder: (context, index) {
                          if (showOlderLoader && index == visible.length) {
                            return _OlderMessagesLoader(
                              loading: _olderMessagesLoading,
                              onTap: _hasMoreMessages && !_olderMessagesLoading
                                  ? () => unawaited(_loadOlderMessages(thread))
                                  : null,
                            );
                          }
                          final message = visible[visible.length - index - 1];
                          final bubble = _MessageBubble(
                            thread: thread,
                            group: widget.group,
                            message: message,
                            viewportWidth: messageViewportWidth,
                            onOpenContact: widget.onOpenContact,
                            mentionTargets: {
                              for (final candidate in _mentionCandidates)
                                candidate.label: candidate.jid,
                            },
                            onOpenMention: _openMentionConversation,
                            onOpenParticipantConversation:
                                _openMentionConversation,
                            onReply: () => setState(() => _replyTo = message),
                            onOpenReceiptDetails: (message) =>
                                _showReceiptDetails(thread, message),
                            onRetry: (message) =>
                                _retryFailedMessage(thread, message),
                            onRunMessageAction: (message, action, data) =>
                                _runMessageAction(
                                  thread,
                                  message,
                                  action,
                                  data: data,
                                ),
                            onToggleDeletedReveal: (message, reveal) =>
                                _setDeletedMessageReveal(
                                  thread,
                                  message,
                                  reveal,
                                ),
                          );
                          final keyedBubble = RepaintBoundary(
                            key: ValueKey(_messageIdentityKey(message)),
                            child: bubble,
                          );
                          if (!message.isLocalOptimistic) return keyedBubble;
                          return TweenAnimationBuilder<double>(
                            key: ValueKey('anim-${message.id}'),
                            tween: Tween(begin: 0, end: 1),
                            duration: const Duration(milliseconds: 180),
                            curve: Curves.easeOutCubic,
                            builder: (context, value, child) {
                              return Opacity(
                                opacity: value,
                                child: Transform.translate(
                                  offset: Offset(
                                    message.fromMe
                                        ? (1 - value) * 18
                                        : (value - 1) * 18,
                                    (1 - value) * 8,
                                  ),
                                  child: child,
                                ),
                              );
                            },
                            child: keyedBubble,
                          );
                        },
                      );
                    },
                  ),
                ),
                if (_sweepstakes?.active.isNotEmpty == true)
                  Positioned(
                    right: 14,
                    bottom: 16,
                    child: _ActiveSweepstakeButton(
                      count: _sweepstakes!.active.first.participants.length,
                      onTap: () => _openSweepstakeDetails(thread),
                    ),
                  ),
              ],
            ),
          ),
          if (thread.canCompose)
            _Composer(
              controller: _text,
              mentionAll: _mentionAll,
              mentionSuggestions: _visibleMentionSuggestions(),
              onMentionSelected: _selectMention,
              buttonsEnabled: canUseInteractiveButtons,
              buttons: canUseInteractiveButtons
                  ? _composerButtons
                  : const <OutgoingInteractiveButton>[],
              botEnabled: widget.group?.botEnabled == true,
              internalGroup: thread.isInternalGroup,
              showBotButton:
                  thread.isGroup &&
                  (!thread.isInternalGroup || thread.instanceIsAdmin == true),
              showStoreButton:
                  thread.isContact && _storeSnapshot?.store.enabled == true,
              showSweepstakeButton: thread.isGroup,
              onEmoji: () => _openComposerPicker(thread),
              onStore: () {
                final store = _storeSnapshot;
                if (store != null) _openStoreCustomerActions(thread, store);
              },
              onSweepstake: () => _openSweepstakeCreator(thread),
              onBot:
                  widget.onOpenGroupSettings ??
                  (thread.isGroup
                      ? () => unawaited(
                          _toggleGroupBotForThread(thread, widget.group),
                        )
                      : () => _showComposerNotice(
                          'As ativacoes do robo ficam disponiveis em grupos.',
                        )),
              voiceRecording: _voiceRecording,
              voiceRecordingBusy: _voiceRecordingBusy,
              voiceDuration: _voiceDuration,
              voiceViewOnce: _voiceViewOnce,
              onVoiceViewOnceChanged: thread.isInternalGroup
                  ? (value) => setState(() => _voiceViewOnce = value)
                  : null,
              onVoiceStart: () => _beginHeldVoiceRecording(thread),
              onVoiceStop: () => _endHeldVoiceRecording(thread),
              onCancelVoice: _cancelHeldVoiceRecording,
              onMentionAllChanged: thread.isGroup
                  ? (value) => setState(() => _mentionAll = value)
                  : null,
              onEditButtons: canUseInteractiveButtons
                  ? _editComposerButtons
                  : null,
              onClearButtons:
                  canUseInteractiveButtons && _composerButtons.isNotEmpty
                  ? () => setState(() => _composerButtons = const [])
                  : null,
              onAttach: () => _sendMedia(thread),
              onSend: () => _sendText(thread),
              replyTo: _replyTo,
              onClearReply: () => setState(() => _replyTo = null),
            ),
          if (!thread.canCompose &&
              thread.isInternalGroup &&
              thread.announceOnly == true)
            const _InternalAdminsOnlyComposer(),
        ],
      ),
    );
  }

  Future<void> _markCurrentThreadRead(ConversationThread thread) async {
    if (!_isCurrentThread(thread)) return;
    try {
      await ref.read(apiClientProvider).runConversationAction(thread, 'read');
      ref.invalidate(dashboardSnapshotProvider);
    } catch (_) {
      // Leitura deve ser silenciosa; a próxima abertura/realtime corrige.
    }
  }

  Future<void> _openSweepstakeCreator(ConversationThread thread) async {
    final groupId = _sweepstakeGroupId(thread);
    if (groupId == null) {
      _showComposerNotice(
        'Este grupo ainda não está vinculado ao BotAdmin para criar sorteios.',
      );
      return;
    }
    final draft = await showDialog<_SweepstakeDraft>(
      context: context,
      builder: (_) => const _SweepstakeDialog(),
    );
    if (draft == null || !mounted) return;
    setState(() => _sweepstakesLoading = true);
    try {
      final snapshot = await ref
          .read(apiClientProvider)
          .createGroupSweepstake(
            groupId: groupId,
            question: draft.question,
            durationValue: draft.durationValue,
            durationUnit: draft.durationUnit,
            maxParticipants: draft.maxParticipants,
            winnersCount: draft.winnersCount,
            internal: thread.isInternalGroup,
          );
      if (!mounted) return;
      setState(() => _sweepstakes = snapshot);
      showSuccessToast(context, 'Sorteio criado e enquete enviada ao grupo.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _sweepstakesLoading = false);
    }
  }

  Future<void> _openSweepstakeDetails(ConversationThread thread) async {
    final active = _sweepstakes?.active.firstOrNull;
    final groupId = _sweepstakeGroupId(thread);
    if (active == null || groupId == null) return;
    await showDialog<void>(
      context: context,
      builder: (_) => _SweepstakeDetailsDialog(
        sweepstake: active,
        canDraw:
            thread.instanceIsAdmin == true ||
            thread.internalGroupRole == 'owner',
        members: thread.isInternalGroup ? _mentionCandidates : const [],
        onAddMember: thread.isInternalGroup
            ? (participantUserId) async {
                final snapshot = await ref
                    .read(apiClientProvider)
                    .addGroupSweepstakeParticipant(
                      groupId: groupId,
                      sweepstakeId: active.id,
                      participantUserId: participantUserId,
                    );
                if (mounted) setState(() => _sweepstakes = snapshot);
                return snapshot.active.firstOrNull ?? active;
              }
            : null,
        onRefresh: () async {
          await _refreshSweepstakes(thread);
          return _sweepstakes?.active.firstOrNull ?? active;
        },
        onDraw: () async {
          final snapshot = await ref
              .read(apiClientProvider)
              .finalizeGroupSweepstake(
                groupId,
                active.id,
                internal: thread.isInternalGroup,
              );
          if (mounted) setState(() => _sweepstakes = snapshot);
        },
        onCancel: () async {
          final snapshot = await ref
              .read(apiClientProvider)
              .cancelGroupSweepstake(
                groupId,
                active.id,
                internal: thread.isInternalGroup,
              );
          if (mounted) setState(() => _sweepstakes = snapshot);
        },
      ),
    );
    if (mounted) unawaited(_refreshSweepstakes(thread));
  }

  Future<void> _showReceiptDetails(
    ConversationThread thread,
    ChatMessage message,
  ) async {
    if (message.isLocalOptimistic) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        final wa = WaTheme.of(dialogContext);
        final screen = MediaQuery.sizeOf(dialogContext);
        return Dialog(
          insetPadding: const EdgeInsets.symmetric(
            horizontal: 18,
            vertical: 24,
          ),
          backgroundColor: wa.panel,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: 480,
              maxHeight: math.max(280, screen.height * .72),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 8, 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Informações da mensagem',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: wa.textPrimary,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Fechar',
                        onPressed: () => Navigator.pop(dialogContext),
                        icon: const Icon(Icons.close_rounded),
                      ),
                    ],
                  ),
                ),
                Divider(height: 1, color: wa.border),
                Flexible(
                  child: FutureBuilder<List<MessageReceipt>>(
                    future: ref
                        .read(apiClientProvider)
                        .loadMessageReceipts(thread, message),
                    builder: (context, snapshot) {
                      final receipts =
                          snapshot.data ?? const <MessageReceipt>[];
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const Center(
                          child: Padding(
                            padding: EdgeInsets.all(32),
                            child: CircularProgressIndicator(),
                          ),
                        );
                      }
                      if (snapshot.hasError || receipts.isEmpty) {
                        return SingleChildScrollView(
                          padding: const EdgeInsets.all(20),
                          child: Text(
                            'Ainda não há confirmação de entrega ou visualização.',
                            style: TextStyle(color: wa.textSecondary),
                          ),
                        );
                      }
                      return ListView.separated(
                        shrinkWrap: true,
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 18),
                        itemCount: receipts.length,
                        separatorBuilder: (_, __) =>
                            Divider(height: 1, color: wa.border),
                        itemBuilder: (context, index) {
                          final receipt = receipts[index];
                          return ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: CircleAvatar(
                              backgroundImage: receipt.avatarUrl == null
                                  ? null
                                  : NetworkImage(receipt.avatarUrl!),
                              child: receipt.avatarUrl == null
                                  ? Text(
                                      receipt.name.isEmpty
                                          ? '?'
                                          : receipt.name[0].toUpperCase(),
                                    )
                                  : null,
                            ),
                            title: Text(
                              receipt.name,
                              style: TextStyle(
                                color: wa.textPrimary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            subtitle: Text(
                              [
                                receipt.state == MessageDeliveryState.read
                                    ? 'Visualizou'
                                    : 'Recebeu',
                                if (receipt.deliveredAt != null)
                                  'Entrega: ${DateFormat('dd/MM HH:mm').format(receipt.deliveredAt!.toLocal())}',
                                if (receipt.readAt != null)
                                  'Leitura: ${DateFormat('dd/MM HH:mm').format(receipt.readAt!.toLocal())}',
                              ].join(' · '),
                              style: TextStyle(color: wa.textSecondary),
                            ),
                            trailing: Icon(
                              receipt.state == MessageDeliveryState.read
                                  ? Icons.done_all_rounded
                                  : Icons.done_rounded,
                              color: receipt.state == MessageDeliveryState.read
                                  ? const Color(0xFF53BDEB)
                                  : wa.textMuted,
                            ),
                          );
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _retryFailedMessage(
    ConversationThread thread,
    ChatMessage message,
  ) async {
    if (message.localStatus != MessageLocalStatus.failed ||
        !message.isLocalOptimistic) {
      return;
    }
    final localId = message.id.startsWith('local-')
        ? message.id
        : message.remoteId;
    _markLocalMessageStatus(localId, MessageLocalStatus.pending);
    try {
      if (!await _ensureLiveConnection(thread)) {
        throw BotAdminApiException('Conecte o perfil para tentar novamente.');
      }
      ChatMessage? confirmed;
      final dataUrl = message.media['dataUrl']?.toString() ?? '';
      if (dataUrl.startsWith('data:')) {
        final comma = dataUrl.indexOf(',');
        if (comma <= 5) {
          throw BotAdminApiException('A cópia local da mídia expirou.');
        }
        final header = dataUrl.substring(5, comma);
        final mime = header.split(';').first.trim();
        final bytes = base64Decode(dataUrl.substring(comma + 1));
        confirmed = await ref
            .read(apiClientProvider)
            .sendMediaMessage(
              thread,
              bytes: Uint8List.fromList(bytes),
              fileName: message.mediaFileName ?? 'arquivo',
              mimeType: mime.isEmpty
                  ? (message.mediaMimeType ?? 'application/octet-stream')
                  : mime,
              caption: message.mediaCaption ?? message.text,
              viewOnce: message.media['viewOnce'] == true,
              clientMessageId: localId,
            );
      } else {
        confirmed = await ref
            .read(apiClientProvider)
            .sendTextMessage(thread, message.text, clientMessageId: localId);
      }
      if (!mounted || !_isCurrentThread(thread)) return;
      _markLocalMessageStatus(
        localId,
        MessageLocalStatus.sent,
        confirmed: confirmed,
      );
      unawaited(_refreshLatestMessages(thread, scrollToLatest: false));
    } catch (error) {
      if (!mounted || !_isCurrentThread(thread)) return;
      _markLocalMessageStatus(localId, MessageLocalStatus.failed);
      showErrorToast(context, error);
    }
  }

  Future<void> _acknowledgeInternalDeliveries(
    ConversationThread thread,
    List<ChatMessage> messages,
  ) async {
    if (!thread.isInternalGroup) return;
    final groupId =
        thread.linkedGroupId ??
        int.tryParse(thread.chatJid.split(':').last) ??
        0;
    if (groupId <= 0) return;
    final receipts = <Map<String, Object?>>[];
    for (final message in messages) {
      if (message.fromMe || message.isLocalOptimistic) continue;
      final id = int.tryParse(
        message.remoteId.isNotEmpty ? message.remoteId : message.id,
      );
      if (id == null ||
          id <= 0 ||
          _deliveryReceiptsSent.contains('$groupId:$id')) {
        continue;
      }
      _deliveryReceiptsSent.add('$groupId:$id');
      receipts.add({'messageId': id, 'state': 'delivered'});
    }
    if (receipts.isEmpty) return;
    try {
      await ref
          .read(apiClientProvider)
          .sendInternalGroupReceipts(groupId, receipts);
    } catch (_) {
      for (final receipt in receipts) {
        _deliveryReceiptsSent.remove('$groupId:${receipt['messageId']}');
      }
    }
  }

  void _scheduleScrollToLatest(
    ConversationThread thread,
    List<ChatMessage> messages, {
    bool force = false,
  }) {
    if (messages.isEmpty || _search.text.trim().isNotEmpty) return;
    if (!force && (!_isNearLatest() || _isChatActivelyScrolling())) return;
    final last = messages.last;
    final key =
        '${thread.instanceId}|${thread.chatJid}|${messages.length}|${last.id}|${last.remoteId}|${last.timestamp.millisecondsSinceEpoch}';
    if (!force && _lastAutoScrollKey == key) return;
    _lastAutoScrollKey = key;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_messagesScrollController.hasClients) return;
      if (!force && (!_isNearLatest() || _isChatActivelyScrolling())) return;
      final position = _messagesScrollController.position;
      _messagesScrollController.jumpTo(position.minScrollExtent);
    });
  }

  List<ChatMessage> _filteredMessages(List<ChatMessage> items) {
    final visible = items.where((message) => message.isUserVisible);
    final query = _search.text.trim().toLowerCase();
    if (query.isEmpty) return visible.toList(growable: false);
    return visible.where((message) {
      return message.text.toLowerCase().contains(query) ||
          message.senderName.toLowerCase().contains(query) ||
          (message.mediaFileName ?? '').toLowerCase().contains(query) ||
          (message.mediaMimeType ?? '').toLowerCase().contains(query) ||
          (message.quoted?.text ?? '').toLowerCase().contains(query) ||
          message.reactions.any(
            (reaction) =>
                reaction.emoji.contains(query) ||
                (reaction.senderName ?? '').toLowerCase().contains(query),
          );
    }).toList();
  }

  List<ChatMessage> _messagesWithAttachedReactions(List<ChatMessage> items) {
    final reactionsByTarget = <String, List<ChatReaction>>{};
    final visibleMessages = <ChatMessage>[];

    for (final message in items) {
      if (message.isReaction) {
        final reaction = message.reaction;
        final target = reaction?.targetMessageId?.trim();
        if (reaction != null && target != null && target.isNotEmpty) {
          reactionsByTarget
              .putIfAbsent(target, () => <ChatReaction>[])
              .add(reaction);
        }
        continue;
      }
      visibleMessages.add(message);
    }

    if (reactionsByTarget.isEmpty) {
      return visibleMessages;
    }

    String fingerprint(ChatReaction reaction) {
      final who = (reaction.senderJid ?? reaction.senderName ?? '')
          .trim()
          .toLowerCase();
      final emoji = reaction.emoji.trim();
      // Uma reação por pessoa+emoji (timestamp não entra para não duplicar).
      return '$who|$emoji';
    }

    List<ChatReaction> collectForMessage(ChatMessage message) {
      final keys = <String>{message.remoteId.trim(), message.id.trim()}
        ..removeWhere((value) => value.isEmpty);

      final reactions = <ChatReaction>[];
      final seen = <String>{};

      void addReaction(ChatReaction reaction) {
        final emoji = reaction.emoji.trim();
        if (emoji.isEmpty) return;
        if (seen.add(fingerprint(reaction))) {
          reactions.add(
            ChatReaction(
              emoji: emoji,
              targetMessageId: reaction.targetMessageId,
              senderName: reaction.senderName,
              senderJid: reaction.senderJid,
              timestamp: reaction.timestamp,
              fromMe: reaction.fromMe,
            ),
          );
        }
      }

      // Reações já embutidas no payload da mensagem.
      for (final reaction in message.reactions) {
        addReaction(reaction);
      }

      // Reações vindas como mensagens do tipo reaction no histórico.
      // Caminho comum: id remoto bate exatamente. Fallback difuso só quando
      // a API traz ids truncados/formatados de maneira diferente.
      var matchedDirectly = false;
      for (final key in keys) {
        final exact = reactionsByTarget[key];
        if (exact == null) continue;
        matchedDirectly = true;
        for (final reaction in exact) {
          addReaction(reaction);
        }
      }

      if (!matchedDirectly) {
        for (final entry in reactionsByTarget.entries) {
          final targetKey = entry.key.trim();
          if (targetKey.isEmpty) continue;
          final matches = keys.any(
            (key) =>
                key == targetKey ||
                key.endsWith(targetKey) ||
                targetKey.endsWith(key) ||
                key.contains(targetKey) ||
                targetKey.contains(key),
          );
          if (!matches) continue;
          for (final reaction in entry.value) {
            addReaction(reaction);
          }
        }
      }

      reactions.sort((a, b) {
        final at = a.timestamp?.millisecondsSinceEpoch ?? 0;
        final bt = b.timestamp?.millisecondsSinceEpoch ?? 0;
        return at.compareTo(bt);
      });
      return reactions;
    }

    return visibleMessages.map((message) {
      final reactions = collectForMessage(message);
      return reactions.isEmpty
          ? message
          : message.copyWith(reactions: reactions);
    }).toList();
  }

  Future<void> _openComposerPicker(ConversationThread thread) async {
    final result = await showGeneralDialog<_ComposerPickerResult>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Fechar emojis, GIFs e figurinhas',
      barrierColor: Colors.transparent,
      transitionDuration: const Duration(milliseconds: 130),
      pageBuilder: (context, animation, secondaryAnimation) {
        final screen = MediaQuery.sizeOf(context);
        final isCompact = screen.width < 760;
        final panelWidth = isCompact
            ? screen.width - 16
            : math.min(680.0, screen.width - 28);
        final panelHeight = math.min(
          isCompact ? screen.height * 0.72 : 560.0,
          screen.height - 110,
        );
        final left = isCompact
            ? 8.0
            : math
                  .min(screen.width - panelWidth - 12, 640.0)
                  .clamp(12.0, screen.width)
                  .toDouble();
        return SafeArea(
          child: Stack(
            children: [
              Positioned.fill(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => Navigator.of(context).pop(),
                ),
              ),
              Positioned(
                left: left,
                bottom: isCompact ? 74 : 82,
                width: panelWidth,
                height: panelHeight,
                child: Material(
                  color: Colors.transparent,
                  child: _UnifiedComposerPicker(
                    api: ref.read(apiClientProvider),
                    panelHeight: panelHeight,
                    onEmojiSelected: (emoji) {
                      Navigator.of(
                        context,
                      ).pop(_ComposerPickerResult.emoji(emoji));
                    },
                    onGiphySelected: (item) {
                      Navigator.of(
                        context,
                      ).pop(_ComposerPickerResult.giphy(item));
                    },
                  ),
                ),
              ),
            ],
          ),
        );
      },
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        final curved = CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutCubic,
        );
        return FadeTransition(
          opacity: curved,
          child: ScaleTransition(
            alignment: Alignment.bottomLeft,
            scale: Tween<double>(begin: 0.98, end: 1).animate(curved),
            child: child,
          ),
        );
      },
    );
    if (!mounted || result == null) return;
    if (result.emoji != null) {
      _insertComposerText(result.emoji!);
      return;
    }
    if (result.giphy != null) {
      await _sendGiphyMedia(thread, result.giphy!);
    }
  }

  void _insertComposerText(String value) {
    final selection = _text.selection;
    final current = _text.text;
    final start = selection.isValid ? selection.start : current.length;
    final end = selection.isValid ? selection.end : current.length;
    final nextText = current.replaceRange(start, end, value);
    _text.value = TextEditingValue(
      text: nextText,
      selection: TextSelection.collapsed(offset: start + value.length),
    );
  }

  void _showComposerNotice(String message) {
    showSuccessToast(context, message);
  }

  Future<void> _loadStoreContext(ConversationThread? thread) async {
    if (thread == null || !thread.isContact || thread.instanceId <= 0) {
      if (mounted && _storeSnapshot != null) {
        setState(() {
          _storeSnapshot = null;
          _storeLoading = false;
        });
      }
      return;
    }
    if (mounted) setState(() => _storeLoading = true);
    try {
      final snapshot = await ref
          .read(apiClientProvider)
          .loadBotStore(thread.instanceId);
      if (!mounted || !_isCurrentThread(thread)) return;
      setState(() {
        _storeSnapshot = snapshot;
        _storeLoading = false;
      });
    } catch (_) {
      if (!mounted || !_isCurrentThread(thread)) return;
      setState(() {
        _storeSnapshot = null;
        _storeLoading = false;
      });
    }
  }

  BotStoreCustomer? _storeCustomerForThread(
    ConversationThread thread,
    BotStoreSnapshot snapshot,
  ) {
    final threadPhone = (thread.phone ?? thread.chatJid).replaceAll(
      RegExp(r'[^0-9]'),
      '',
    );
    for (final customer in snapshot.customers) {
      final customerPhone = (customer.customerPhone ?? customer.customerJid)
          .replaceAll(RegExp(r'[^0-9]'), '');
      if (customer.customerJid == thread.chatJid ||
          (threadPhone.isNotEmpty &&
              customerPhone.isNotEmpty &&
              (threadPhone.endsWith(customerPhone) ||
                  customerPhone.endsWith(threadPhone)))) {
        return customer;
      }
    }
    return null;
  }

  Future<void> _openStoreCustomerActions(
    ConversationThread thread,
    BotStoreSnapshot snapshot,
  ) async {
    final customer = _storeCustomerForThread(thread, snapshot);
    final action = await showBotAdminBottomSheet<String>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 18),
        children: [
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.storefront_rounded)),
            title: Text(
              customer?.displayName ?? thread.title,
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            subtitle: Text(
              customer == null
                  ? 'Cliente ainda sem compras registradas'
                  : '${customer.ordersCount} compra(s) · saldo ${NumberFormat.simpleCurrency(locale: 'pt_BR').format(customer.balance)}',
            ),
          ),
          const Divider(height: 1),
          const ListTile(
            dense: true,
            title: Text(
              'Ações da Store',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.receipt_long_outlined),
            title: const Text('Compras do cliente'),
            onTap: () => Navigator.of(context).pop('orders'),
          ),
          ListTile(
            leading: const Icon(Icons.storefront_outlined),
            title: const Text('Enviar menu da loja'),
            onTap: () => Navigator.of(context).pop('menu'),
          ),
          ListTile(
            leading: const Icon(Icons.view_carousel_outlined),
            title: const Text('Enviar menu de um produto'),
            onTap: () => Navigator.of(context).pop('product'),
          ),
          ListTile(
            leading: const Icon(Icons.inventory_2_outlined),
            title: const Text('Entregar produto do estoque'),
            subtitle: const Text('Consome uma unidade disponível.'),
            onTap: () => Navigator.of(context).pop('deliver'),
          ),
          ListTile(
            leading: const Icon(Icons.replay_rounded),
            title: const Text('Repor uma venda'),
            subtitle: const Text('Reenvia a entrega sem consumir novo item.'),
            onTap: () => Navigator.of(context).pop('reissue'),
          ),
          ListTile(
            leading: const Icon(Icons.account_balance_wallet_outlined),
            title: const Text('Saldo e dados do cliente'),
            onTap: () => Navigator.of(context).pop('customer'),
          ),
        ],
      ),
    );
    if (!mounted || action == null) return;
    switch (action) {
      case 'orders':
        await _showStoreCustomerOrders(thread, snapshot);
      case 'menu':
        await _runStoreChatAction(thread, 'send_store_menu', {
          'customerJid': thread.chatJid,
        }, 'Menu da loja enviado.');
      case 'product':
        final product = await _selectStoreProduct(
          snapshot.products.where((item) => item.enabled).toList(),
          title: 'Enviar produto',
        );
        if (product != null) {
          await _runStoreChatAction(thread, 'send_store_product', {
            'customerJid': thread.chatJid,
            'productId': product.id,
          }, 'Menu do produto enviado.');
        }
      case 'deliver':
        final product = await _selectStoreProduct(
          snapshot.products
              .where((item) => item.enabled && item.inventoryAvailable > 0)
              .toList(),
          title: 'Entregar do estoque',
          showStock: true,
        );
        if (product != null) {
          await _runStoreChatAction(thread, 'deliver_store_product', {
            'customerJid': thread.chatJid,
            'customerName': customer?.customerName ?? thread.title,
            'productId': product.id,
          }, 'Produto entregue e venda registrada.');
        }
      case 'reissue':
        final orders = snapshot.orders
            .where(
              (order) =>
                  order.status == 'delivered' &&
                  (order.customerJid == thread.chatJid ||
                      (customer != null &&
                          order.customerJid == customer.customerJid)),
            )
            .toList(growable: false);
        final order = await _selectStoreOrder(orders);
        if (order != null) {
          await _runStoreChatAction(thread, 'reissue_store_order', {
            'orderId': order.id,
          }, 'Venda reenviada ao cliente.');
        }
      case 'customer':
        await _editStoreCustomerFromChat(thread, snapshot, customer);
    }
  }

  Future<BotStoreProduct?> _selectStoreProduct(
    List<BotStoreProduct> products, {
    required String title,
    bool showStock = false,
  }) {
    return showBotAdminBottomSheet<BotStoreProduct>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => products.isEmpty
          ? const SizedBox(
              height: 180,
              child: Center(child: Text('Nenhum produto disponível.')),
            )
          : ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.only(bottom: 18),
              children: [
                ListTile(
                  title: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                ...products.map(
                  (product) => ListTile(
                    leading: const CircleAvatar(
                      child: Icon(Icons.shopping_bag_outlined),
                    ),
                    title: Text(product.name),
                    subtitle: Text(
                      showStock
                          ? '${product.inventoryAvailable} disponível(is)'
                          : NumberFormat.simpleCurrency(
                              locale: 'pt_BR',
                            ).format(product.price),
                    ),
                    onTap: () => Navigator.of(context).pop(product),
                  ),
                ),
              ],
            ),
    );
  }

  Future<BotStoreOrder?> _selectStoreOrder(List<BotStoreOrder> orders) {
    return showBotAdminBottomSheet<BotStoreOrder>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => orders.isEmpty
          ? const SizedBox(
              height: 180,
              child: Center(child: Text('Nenhuma venda entregue encontrada.')),
            )
          : ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.only(bottom: 18),
              children: [
                const ListTile(
                  title: Text(
                    'Repor venda',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                  ),
                ),
                ...orders.map(
                  (order) => ListTile(
                    leading: const Icon(Icons.receipt_long_outlined),
                    title: Text('Pedido ${order.publicId}'),
                    subtitle: Text(
                      '${order.quantity} item(ns) · '
                      '${NumberFormat.simpleCurrency(locale: 'pt_BR').format(order.totalCents / 100)}',
                    ),
                    onTap: () => Navigator.of(context).pop(order),
                  ),
                ),
              ],
            ),
    );
  }

  Future<void> _showStoreCustomerOrders(
    ConversationThread thread,
    BotStoreSnapshot snapshot,
  ) async {
    final customer = _storeCustomerForThread(thread, snapshot);
    final orders = snapshot.orders
        .where(
          (order) =>
              order.customerJid == thread.chatJid ||
              (customer != null && order.customerJid == customer.customerJid),
        )
        .toList(growable: false);
    await showBotAdminBottomSheet<void>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => FractionallySizedBox(
        heightFactor: .72,
        child: orders.isEmpty
            ? const Center(child: Text('Nenhuma compra registrada.'))
            : ListView.builder(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 24),
                itemCount: orders.length,
                itemBuilder: (context, index) {
                  final order = orders[index];
                  return ListTile(
                    leading: const CircleAvatar(
                      child: Icon(Icons.receipt_long_outlined),
                    ),
                    title: Text('Pedido ${order.publicId}'),
                    subtitle: Text(
                      '${order.status} · ${order.quantity} item(ns) · '
                      '${DateFormat('dd/MM/yyyy HH:mm').format(order.createdAt.toLocal())}',
                    ),
                    trailing: Text(
                      NumberFormat.simpleCurrency(
                        locale: 'pt_BR',
                      ).format(order.totalCents / 100),
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                  );
                },
              ),
      ),
    );
  }

  Future<void> _editStoreCustomerFromChat(
    ConversationThread thread,
    BotStoreSnapshot snapshot,
    BotStoreCustomer? customer,
  ) async {
    final name = TextEditingController(
      text: customer?.customerName ?? thread.title,
    );
    final balance = TextEditingController(
      text: ((customer?.balanceCents ?? 0) / 100)
          .toStringAsFixed(2)
          .replaceAll('.', ','),
    );
    final notes = TextEditingController(text: customer?.notes);
    var blocked = customer?.blocked ?? false;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Saldo e dados do cliente'),
          content: SizedBox(
            width: 480,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: name,
                    decoration: const InputDecoration(
                      labelText: 'Nome',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: balance,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Saldo',
                      prefixText: 'R\$ ',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: notes,
                    minLines: 3,
                    maxLines: 6,
                    decoration: const InputDecoration(
                      labelText: 'Observações internas',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Bloquear compras automáticas'),
                    value: blocked,
                    onChanged: (value) => setDialogState(() => blocked = value),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
    if (saved != true || !mounted) {
      name.dispose();
      balance.dispose();
      notes.dispose();
      return;
    }
    final value = double.tryParse(balance.text.trim().replaceAll(',', '.'));
    if (value == null || value < 0) {
      showErrorToast(context, 'Informe um saldo válido.');
    } else {
      await _runStoreChatAction(thread, 'update_customer', {
        'customer': {
          'customerJid': customer?.customerJid ?? thread.chatJid,
          'customerName': name.text.trim(),
          'customerPhone': customer?.customerPhone ?? thread.phone,
          'avatarUrl': customer?.avatarUrl ?? thread.avatarUrl,
          'balanceMode': 'set',
          'balanceCents': (value * 100).round(),
          'notes': notes.text.trim(),
          'blocked': blocked,
        },
      }, 'Cliente atualizado.');
    }
    name.dispose();
    balance.dispose();
    notes.dispose();
  }

  Future<void> _runStoreChatAction(
    ConversationThread thread,
    String action,
    Map<String, Object?> payload,
    String success,
  ) async {
    if (_storeLoading) return;
    setState(() => _storeLoading = true);
    try {
      final updated = await ref
          .read(apiClientProvider)
          .runBotStoreAction(thread.instanceId, action, payload: payload);
      if (!mounted || !_isCurrentThread(thread)) return;
      setState(() {
        _storeSnapshot = updated;
        _storeLoading = false;
      });
      showSuccessToast(context, success);
    } catch (error) {
      if (!mounted || !_isCurrentThread(thread)) return;
      setState(() => _storeLoading = false);
      showErrorToast(context, error);
    }
  }

  String _nextLocalMessageId() =>
      'local-${DateTime.now().microsecondsSinceEpoch}-${math.Random().nextInt(1 << 20)}';

  DateTime _nextOptimisticTimestamp() {
    final now = DateTime.now();
    if (_messages.isEmpty) return now;

    var latest = _messages.first.timestamp;
    for (final message in _messages.skip(1)) {
      if (message.timestamp.isAfter(latest)) latest = message.timestamp;
    }

    // Some older API rows were serialized without an explicit timezone and
    // can appear ahead of the device clock. A new optimistic message must
    // still be the newest visible row; otherwise commands look delayed until
    // the server returns and replaces the local bubble.
    return latest.isAfter(now)
        ? latest.add(const Duration(milliseconds: 1))
        : now;
  }

  ChatMessage _buildOptimisticTextMessage({
    required String localId,
    required String text,
  }) {
    return ChatMessage(
      id: localId,
      remoteId: localId,
      clientMessageId: localId,
      text: text,
      timestamp: _nextOptimisticTimestamp(),
      fromMe: true,
      senderName: 'Você',
      messageType: 'text',
      localStatus: MessageLocalStatus.pending,
    );
  }

  ChatMessage _buildOptimisticMediaMessage({
    required String localId,
    required String fileName,
    required String mimeType,
    required String caption,
    String? messageType,
    String? mediaUrl,
    Uint8List? bytes,
    bool isAnimatedMedia = false,
    bool viewOnce = false,
  }) {
    final kind =
        messageType ??
        (mimeType.startsWith('image/')
            ? 'image'
            : mimeType.startsWith('video/')
            ? 'video'
            : mimeType.startsWith('audio/')
            ? 'audio'
            : 'document');
    return ChatMessage(
      id: localId,
      remoteId: localId,
      clientMessageId: localId,
      text: caption,
      timestamp: _nextOptimisticTimestamp(),
      fromMe: true,
      senderName: 'Você',
      messageType: kind,
      mediaUrl: mediaUrl,
      mediaFileName: fileName,
      mediaMimeType: mimeType,
      mediaCaption: caption.isEmpty ? null : caption,
      mediaTitle: fileName,
      media: {
        if (bytes != null && bytes.isNotEmpty)
          'dataUrl': 'data:$mimeType;base64,${base64Encode(bytes)}',
        if (viewOnce) 'viewOnce': true,
        // Local copy is intentionally available to the sender for review.
        if (viewOnce) 'viewOnceOpened': false,
      },
      isAnimatedMedia: isAnimatedMedia,
      localStatus: MessageLocalStatus.pending,
    );
  }

  void _appendOptimisticMessage(
    ConversationThread thread,
    ChatMessage message,
  ) {
    if (!mounted || !_isCurrentThread(thread)) return;
    setState(() {
      _messages = _dedupeAndSort([..._messages, message]);
      _messagesError = null;
    });
    // Persist the optimistic row as well so an app restart can restore the
    // pending/failed bubble (and the sender's local media copy) immediately.
    ref
        .read(conversationCacheProvider)
        .putMessages(
          thread,
          CachedMessagePage(
            messages: List.unmodifiable(_messages),
            hasMore: _hasMoreMessages,
            oldestCursor: _oldestMessageCursor,
            fetchedAt: DateTime.now(),
          ),
        );
    _scheduleScrollToLatest(
      thread,
      _filteredMessages(_messagesWithAttachedReactions(_messages)),
      force: true,
    );
  }

  void _markLocalMessageStatus(
    String localId,
    MessageLocalStatus status, {
    ChatMessage? confirmed,
  }) {
    if (!mounted) return;
    setState(() {
      _messages = _dedupeAndSort(
        _messages.map((message) {
          final isTarget =
              message.id == localId ||
              message.remoteId == localId ||
              _messageIdentityKey(message) == 'remote:$localId' ||
              _messageIdentityKey(message) == 'id:$localId';
          if (!isTarget) return message;
          if (confirmed != null) {
            return confirmed.copyWith(
              clientMessageId:
                  confirmed.clientMessageId ??
                  message.clientMessageId ??
                  localId,
              localStatus: status,
              media: {...confirmed.media, ...message.media},
              reactions: message.reactions.isNotEmpty
                  ? message.reactions
                  : confirmed.reactions,
            );
          }
          return message.copyWith(localStatus: status);
        }),
      );
    });
    final thread = widget.thread;
    if (thread != null && _isCurrentThread(thread)) {
      ref
          .read(conversationCacheProvider)
          .putMessages(
            thread,
            CachedMessagePage(
              messages: List.unmodifiable(_messages),
              hasMore: _hasMoreMessages,
              oldestCursor: _oldestMessageCursor,
              fetchedAt: DateTime.now(),
            ),
          );
    }
  }

  // ignore: unused_element
  void _removeLocalMessage(String localId) {
    if (!mounted) return;
    setState(() {
      _messages = _messages
          .where(
            (message) => message.id != localId && message.remoteId != localId,
          )
          .toList(growable: false);
    });
  }

  List<ChatMessage> _mergeServerWithLocal(
    List<ChatMessage> serverMessages,
    List<ChatMessage> currentMessages,
  ) {
    final pendingLocals = currentMessages
        .where(
          (message) =>
              message.isLocalOptimistic &&
              (message.localStatus == MessageLocalStatus.pending ||
                  message.localStatus == MessageLocalStatus.failed),
        )
        .toList();
    if (pendingLocals.isEmpty) return _dedupeAndSort(serverMessages);

    final remainingLocals = <ChatMessage>[];
    for (final local in pendingLocals) {
      final matched = serverMessages.any(
        (server) => _looksLikeSameOutgoing(local, server),
      );
      if (!matched) remainingLocals.add(local);
    }
    return _dedupeAndSort([...serverMessages, ...remainingLocals]);
  }

  bool _looksLikeSameOutgoing(ChatMessage local, ChatMessage server) {
    if (!local.fromMe || !server.fromMe) return false;
    final localClientId = local.clientMessageId?.trim() ?? '';
    final serverClientId = server.clientMessageId?.trim() ?? '';
    if (localClientId.isNotEmpty && localClientId == serverClientId) {
      return true;
    }
    final localText = local.displayText;
    final serverText = server.displayText;
    if (localText.isNotEmpty &&
        serverText.isNotEmpty &&
        localText == serverText) {
      final delta = local.timestamp.difference(server.timestamp).abs();
      if (delta <= const Duration(minutes: 2)) return true;
    }
    final localName = (local.mediaFileName ?? '').trim().toLowerCase();
    final serverName = (server.mediaFileName ?? '').trim().toLowerCase();
    if (localName.isNotEmpty &&
        serverName.isNotEmpty &&
        localName == serverName) {
      final delta = local.timestamp.difference(server.timestamp).abs();
      if (delta <= const Duration(minutes: 2)) return true;
    }
    return false;
  }

  Future<void> _sendText(ConversationThread thread) async {
    if (!thread.canCompose) return;
    final text = _text.text.trim();
    if (text.isEmpty) return;
    final mentionAll = _mentionAll;
    final mentions = _selectedMentions.values
        .where(
          (candidate) =>
              text.toLowerCase().contains('@${candidate.label.toLowerCase()}'),
        )
        .map((candidate) => candidate.jid)
        .toSet()
        .toList(growable: false);
    final replyTo = _replyTo;
    final buttons =
        ref
            .read(instanceNativeButtonsProvider(thread.instanceId))
            .maybeWhen(data: (enabled) => enabled, orElse: () => false)
        ? List<OutgoingInteractiveButton>.from(_composerButtons)
        : const <OutgoingInteractiveButton>[];
    final localId = _nextLocalMessageId();
    final optimistic = _buildOptimisticTextMessage(
      localId: localId,
      text: text,
    );

    _text.clear();
    if (mounted) {
      setState(() {
        _mentionAll = false;
        _composerButtons = const [];
        _replyTo = null;
      });
    }
    _appendOptimisticMessage(thread, optimistic);

    // A rede so começa depois do primeiro frame que contém o novo balão. Isso
    // garante resposta visual imediata inclusive para comandos que acionam o
    // robô, mesmo sob carga ou com busca externa lenta.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_isCurrentThread(thread)) return;
      unawaited(() async {
        try {
          if (!await _ensureLiveConnection(thread)) {
            throw BotAdminApiException(
              'Conecte o perfil para enviar a mensagem.',
            );
          }
          final confirmed = await ref
              .read(apiClientProvider)
              .sendTextMessage(
                thread,
                text,
                mentionAll: mentionAll,
                mentions: mentions,
                buttons: buttons,
                replyToMessageId: replyTo?.remoteId,
                clientMessageId: localId,
              );
          if (!mounted || !_isCurrentThread(thread)) return;
          _markLocalMessageStatus(
            localId,
            MessageLocalStatus.sent,
            confirmed: confirmed,
          );
          ref.invalidate(dashboardSnapshotProvider);
          // Soft sync in background without wiping optimistic UI.
          unawaited(_refreshLatestMessages(thread, scrollToLatest: false));
        } catch (error) {
          if (!mounted || !_isCurrentThread(thread)) return;
          _markLocalMessageStatus(localId, MessageLocalStatus.failed);
          showErrorToast(context, error.toString());
        }
      }());
    });
  }

  Future<void> _sendMedia(ConversationThread thread) async {
    if (!thread.canCompose) return;
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Midias e documentos',
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
            'pdf',
            'doc',
            'docx',
            'xls',
            'xlsx',
            'zip',
          ],
        ),
      ],
    );
    if (file == null) return;
    var bytes = await file.readAsBytes();
    if (bytes.isEmpty) return;
    final mimeType = file.mimeType ?? _guessMimeType(file.name);
    if (!mounted) return;
    final draft = await showBotAdminBottomSheet<_MediaComposeResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _MediaComposeSheet(
        fileName: file.name,
        mimeType: mimeType,
        bytes: bytes,
        initialCaption: _text.text.trim(),
        initialMentionAll: thread.isGroup && _mentionAll,
        initialButtons: _composerButtons,
        allowMentionAll: thread.isGroup,
        allowButtons:
            !thread.isChannel &&
            ref
                .read(instanceNativeButtonsProvider(thread.instanceId))
                .maybeWhen(data: (enabled) => enabled, orElse: () => false),
        allowViewOnce:
            mimeType.startsWith('image/') ||
            mimeType.startsWith('video/') ||
            mimeType.startsWith('audio/'),
      ),
    );
    if (draft == null || !mounted) return;

    final replyTo = _replyTo;
    final mentions = _selectedMentions.values
        .where(
          (candidate) => draft.caption.toLowerCase().contains(
            '@${candidate.label.toLowerCase()}',
          ),
        )
        .map((candidate) => candidate.jid)
        .toSet()
        .toList(growable: false);
    final localId = _nextLocalMessageId();
    final optimistic = _buildOptimisticMediaMessage(
      localId: localId,
      fileName: file.name,
      mimeType: mimeType,
      caption: draft.caption,
      bytes: bytes,
      viewOnce: draft.viewOnce,
    );
    _text.clear();
    if (mounted) {
      setState(() {
        _mentionAll = false;
        _selectedMentions.clear();
        _composerButtons = const [];
        _replyTo = null;
      });
    }
    _appendOptimisticMessage(thread, optimistic);

    unawaited(() async {
      try {
        if (!await _ensureLiveConnection(thread)) {
          throw BotAdminApiException('Conecte o perfil para enviar a mídia.');
        }
        final confirmed = await ref
            .read(apiClientProvider)
            .sendMediaMessage(
              thread,
              bytes: bytes,
              fileName: file.name,
              mimeType: mimeType,
              caption: draft.caption,
              mentionAll: draft.mentionAll,
              mentions: mentions,
              buttons: draft.buttons,
              viewOnce: draft.viewOnce,
              replyToMessageId: replyTo?.remoteId,
              clientMessageId: localId,
            );
        if (!mounted || !_isCurrentThread(thread)) return;
        _markLocalMessageStatus(
          localId,
          MessageLocalStatus.sent,
          confirmed: confirmed,
        );
        ref.invalidate(dashboardSnapshotProvider);
        unawaited(_refreshLatestMessages(thread, scrollToLatest: false));
      } catch (error) {
        if (!mounted || !_isCurrentThread(thread)) return;
        _markLocalMessageStatus(localId, MessageLocalStatus.failed);
        showErrorToast(context, error.toString());
      }
    }());
  }

  Future<void> _beginHeldVoiceRecording(ConversationThread thread) async {
    if (_voicePressActive || _voiceRecording || _voiceRecordingBusy) return;
    _voicePressActive = true;
    _voicePressCancelled = false;
    unawaited(HapticFeedback.mediumImpact());
    await _startVoiceRecording(thread);
    if (!_voicePressActive && _voiceRecording) {
      if (_voicePressCancelled) {
        await _cancelVoiceRecording();
      } else {
        await _stopAndSendVoiceRecording(thread);
      }
    }
  }

  Future<void> _endHeldVoiceRecording(ConversationThread thread) async {
    if (!_voicePressActive && !_voiceRecording) return;
    _voicePressActive = false;
    _voicePressCancelled = false;
    if (_voiceRecording) await _stopAndSendVoiceRecording(thread);
  }

  Future<void> _cancelHeldVoiceRecording() async {
    _voicePressActive = false;
    _voicePressCancelled = true;
    if (_voiceRecording) await _cancelVoiceRecording();
  }

  Future<void> _startVoiceRecording(ConversationThread thread) async {
    if (!thread.canCompose || _voiceRecordingBusy) return;
    setState(() => _voiceRecordingBusy = true);
    try {
      await _voiceRecorder.start();
      if (!mounted || !_isCurrentThread(thread)) {
        await _voiceRecorder.cancel();
        return;
      }
      _voiceDurationTimer?.cancel();
      _voiceDurationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted || !_voiceRecording) return;
        setState(() => _voiceDuration += const Duration(seconds: 1));
      });
      setState(() {
        _voiceDuration = Duration.zero;
        _voiceRecording = true;
      });
    } catch (error, stackTrace) {
      debugPrint('[voice-recorder] $error\n$stackTrace');
      if (mounted) {
        showErrorToast(
          context,
          'Não foi possível acessar o microfone. Verifique a permissão do navegador.',
        );
      }
      await _voiceRecorder.cancel();
    } finally {
      if (mounted) setState(() => _voiceRecordingBusy = false);
    }
  }

  Future<void> _stopAndSendVoiceRecording(ConversationThread thread) async {
    if (!_voiceRecording || _voiceRecordingBusy) return;
    setState(() => _voiceRecordingBusy = true);
    _voiceDurationTimer?.cancel();
    _voiceDurationTimer = null;
    try {
      final recording = await _voiceRecorder.stop();
      final duration = _voiceDuration;
      if (mounted) {
        setState(() {
          _voiceRecording = false;
          _voiceDuration = Duration.zero;
        });
      }
      if (recording == null ||
          recording.bytes.isEmpty ||
          duration < const Duration(seconds: 1)) {
        if (mounted) {
          showErrorToast(context, 'Grave pelo menos 1 segundo de áudio.');
        }
        return;
      }
      await _sendRecordedVoice(
        thread,
        recording.bytes,
        fileName: recording.fileName,
        mimeType: recording.mimeType,
        viewOnce: thread.isInternalGroup && _voiceViewOnce,
      );
      if (mounted) setState(() => _voiceViewOnce = false);
    } catch (error) {
      if (mounted) {
        showErrorToast(context, 'Não foi possível finalizar a gravação.');
      }
      await _voiceRecorder.cancel();
    } finally {
      if (mounted) {
        setState(() {
          _voiceRecording = false;
          _voiceRecordingBusy = false;
          _voiceDuration = Duration.zero;
          _voiceViewOnce = false;
        });
      }
    }
  }

  Future<void> _cancelVoiceRecording() async {
    _voicePressActive = false;
    _voicePressCancelled = true;
    if (!_voiceRecording && !_voiceRecordingBusy) return;
    if (mounted) setState(() => _voiceRecordingBusy = true);
    _voiceDurationTimer?.cancel();
    _voiceDurationTimer = null;
    try {
      await _voiceRecorder.cancel();
    } catch (_) {
      // O descarte é silencioso; a interface volta ao compositor normal.
    } finally {
      if (mounted) {
        setState(() {
          _voiceRecording = false;
          _voiceRecordingBusy = false;
          _voiceDuration = Duration.zero;
          _voiceViewOnce = false;
        });
      }
    }
  }

  Future<void> _sendRecordedVoice(
    ConversationThread thread,
    Uint8List bytes, {
    required String fileName,
    required String mimeType,
    bool viewOnce = false,
  }) async {
    if (!thread.canCompose || bytes.isEmpty) return;
    final localId = _nextLocalMessageId();
    final optimistic = _buildOptimisticMediaMessage(
      localId: localId,
      fileName: fileName,
      mimeType: mimeType,
      caption: '',
      messageType: 'audio',
      bytes: bytes,
      viewOnce: viewOnce,
    );
    _appendOptimisticMessage(thread, optimistic);

    unawaited(() async {
      try {
        if (!await _ensureLiveConnection(thread)) {
          throw BotAdminApiException('Conecte o perfil para enviar o áudio.');
        }
        final confirmed = await ref
            .read(apiClientProvider)
            .sendMediaMessage(
              thread,
              bytes: bytes,
              fileName: fileName,
              mimeType: mimeType,
              viewOnce: viewOnce,
              clientMessageId: localId,
            );
        if (!mounted || !_isCurrentThread(thread)) return;
        _markLocalMessageStatus(
          localId,
          MessageLocalStatus.sent,
          confirmed: confirmed,
        );
        ref.invalidate(dashboardSnapshotProvider);
        unawaited(_refreshLatestMessages(thread, scrollToLatest: false));
      } catch (error) {
        if (!mounted || !_isCurrentThread(thread)) return;
        _markLocalMessageStatus(localId, MessageLocalStatus.failed);
        showErrorToast(context, error.toString());
      }
    }());
  }

  Future<void> _sendGiphyMedia(
    ConversationThread thread,
    GiphyMediaItem item,
  ) async {
    if (!thread.canCompose) return;
    final localId = _nextLocalMessageId();
    final optimistic = _buildOptimisticMediaMessage(
      localId: localId,
      fileName: item.fileName,
      mimeType: item.preferredMimeType,
      caption: '',
      messageType: item.isSticker ? 'sticker' : 'image',
      mediaUrl: item.previewUrl,
      isAnimatedMedia: true,
    );
    _appendOptimisticMessage(thread, optimistic);

    unawaited(() async {
      try {
        if (!await _ensureLiveConnection(thread)) {
          throw BotAdminApiException('Conecte o perfil para enviar a mídia.');
        }
        final confirmed = await ref
            .read(apiClientProvider)
            .sendGiphyMedia(thread, item);
        if (!mounted || !_isCurrentThread(thread)) return;
        _markLocalMessageStatus(
          localId,
          MessageLocalStatus.sent,
          confirmed: confirmed,
        );
        ref.invalidate(dashboardSnapshotProvider);
        unawaited(_refreshLatestMessages(thread, scrollToLatest: false));
      } catch (error) {
        if (!mounted || !_isCurrentThread(thread)) return;
        _markLocalMessageStatus(localId, MessageLocalStatus.failed);
        showErrorToast(context, error.toString());
      }
    }());
  }

  Future<void> _editComposerButtons() async {
    final next = await showBotAdminBottomSheet<List<OutgoingInteractiveButton>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) =>
          _InteractiveButtonsSheet(initialButtons: _composerButtons),
    );
    if (next == null || !mounted) return;
    setState(() => _composerButtons = next);
  }

  Future<void> _refreshMessages(ConversationThread thread) async {
    await _loadInitialMessages(thread, silent: false, scrollToLatest: true);
    if (!mounted) return;
    showSuccessToast(context, 'Mensagens atualizadas.');
  }

  Future<void> _toggleGroupBotForThread(
    ConversationThread thread,
    BotGroup? group,
  ) async {
    if (!await _ensureLiveConnection(thread)) return;
    try {
      final api = ref.read(apiClientProvider);
      if (thread.isInternalGroup) {
        final details = await api.loadInternalGroup(
          thread.linkedGroupId ?? int.parse(thread.chatJid.split(':').last),
        );
        final next = !details.group.botEnabled;
        await api.updateInternalGroup(details.group.id, botEnabled: next);
        ref.invalidate(dashboardSnapshotProvider);
        if (!mounted) return;
        showSuccessToast(context, botAdminStatusMessage(next));
        return;
      }
      final next = group == null ? true : !group.botEnabled;
      final linkedGroup =
          group ?? await api.createGroupFromConversation(thread);
      await api.updateGroupStatus(linkedGroup.id, active: next);
      ref.invalidate(dashboardSnapshotProvider);
      if (!mounted) return;
      showSuccessToast(
        context,
        group == null
            ? 'Grupo vinculado e BotAdmin ativado.'
            : botAdminStatusMessage(next),
      );
    } catch (error) {
      if (!mounted) return;
      showErrorToast(context, error);
    }
  }

  int? _internalGroupId(ConversationThread thread) {
    if (thread.linkedGroupId != null && thread.linkedGroupId! > 0) {
      return thread.linkedGroupId;
    }
    final raw = thread.chatJid.split(':').last;
    return int.tryParse(raw);
  }

  Future<void> _copyInternalGroupLink(ConversationThread thread) async {
    final id = _internalGroupId(thread);
    if (id == null) return;
    try {
      final details = await ref.read(apiClientProvider).loadInternalGroup(id);
      final url = details.group.inviteUrl?.trim();
      if (url == null || url.isEmpty) {
        throw BotAdminApiException(
          'O link privado ainda está sendo preparado.',
        );
      }
      final absolute = AppConfig.publicInviteUrl(url);
      await Clipboard.setData(ClipboardData(text: absolute));
      if (mounted) showSuccessToast(context, 'Link privado copiado.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _rotateInternalGroupLink(ConversationThread thread) async {
    final id = _internalGroupId(thread);
    if (id == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Revogar link do grupo?'),
        content: const Text(
          'O link atual deixará de funcionar e um novo link privado será criado.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Revogar e gerar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final url = await ref
          .read(apiClientProvider)
          .rotateInternalGroupInvite(id);
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) {
        showSuccessToast(
          context,
          'Novo link copiado; o anterior foi revogado.',
        );
      }
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _changeInternalGroupWallpaper(ConversationThread thread) async {
    final id = _internalGroupId(thread);
    if (id == null || _internalGroupWallpaperUploadInFlight) return;

    final action = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(
              leading: Icon(Icons.wallpaper_rounded),
              title: Text(
                'Plano de fundo do grupo',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Text('A mudança aparece para todos os membros.'),
            ),
            ListTile(
              leading: const Icon(Icons.add_photo_alternate_rounded),
              title: Text(
                _internalGroupWallpaperUrl == null &&
                        _internalGroupWallpaperBytes == null
                    ? 'Escolher imagem'
                    : 'Trocar imagem',
              ),
              onTap: () => Navigator.pop(sheetContext, 'pick'),
            ),
            if (_internalGroupWallpaperUrl != null ||
                _internalGroupWallpaperBytes != null)
              ListTile(
                leading: const Icon(Icons.restore_rounded),
                title: const Text('Restaurar plano de fundo padrão'),
                onTap: () => Navigator.pop(sheetContext, 'remove'),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;

    if (action == 'remove') {
      final previousBytes = _internalGroupWallpaperBytes;
      final previousUrl = _internalGroupWallpaperUrl;
      setState(() {
        _internalGroupWallpaperUploadInFlight = true;
        _internalGroupWallpaperBytes = null;
        _internalGroupWallpaperUrl = null;
      });
      try {
        final updated = await ref
            .read(apiClientProvider)
            .removeInternalGroupWallpaper(id);
        if (!mounted || !_isCurrentThread(thread)) return;
        setState(() {
          _internalGroupWallpaperUrl = updated.wallpaperUrl;
          _internalGroupWallpaperBytes = null;
        });
        ref.invalidate(dashboardSnapshotProvider);
        showSuccessToast(context, 'Plano de fundo padrão restaurado.');
      } catch (error) {
        if (!mounted || !_isCurrentThread(thread)) return;
        setState(() {
          _internalGroupWallpaperBytes = previousBytes;
          _internalGroupWallpaperUrl = previousUrl;
        });
        showErrorToast(context, error);
      } finally {
        if (mounted && _isCurrentThread(thread)) {
          setState(() => _internalGroupWallpaperUploadInFlight = false);
        }
      }
      return;
    }

    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(label: 'Imagem', extensions: ['jpg', 'jpeg', 'png', 'webp']),
      ],
    );
    if (file == null || !mounted || !_isCurrentThread(thread)) return;
    var bytes = await file.readAsBytes();
    if (!mounted || !_isCurrentThread(thread)) return;
    if (bytes.length > 15 * 1024 * 1024) {
      showErrorToast(context, 'O plano de fundo deve ter no máximo 15 MB.');
      return;
    }
    final framedBytes = await showDialog<Uint8List>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => _WallpaperFrameEditor(imageBytes: bytes),
    );
    if (framedBytes == null || !mounted || !_isCurrentThread(thread)) return;
    bytes = framedBytes;
    final previousBytes = _internalGroupWallpaperBytes;
    final previousUrl = _internalGroupWallpaperUrl;
    setState(() {
      _internalGroupWallpaperUploadInFlight = true;
      // A prévia local assume o chat antes de iniciar a requisição.
      _internalGroupWallpaperBytes = bytes;
    });
    try {
      final updated = await ref
          .read(apiClientProvider)
          .uploadInternalGroupWallpaper(
            id,
            bytes: bytes,
            fileName: 'wallpaper-${DateTime.now().millisecondsSinceEpoch}.png',
            mimeType: 'image/png',
          );
      if (!mounted || !_isCurrentThread(thread)) return;
      setState(() => _internalGroupWallpaperUrl = updated.wallpaperUrl);
      ref.invalidate(dashboardSnapshotProvider);
      showSuccessToast(
        context,
        'Plano de fundo atualizado para todos os membros.',
      );
    } catch (error) {
      if (!mounted || !_isCurrentThread(thread)) return;
      setState(() {
        _internalGroupWallpaperBytes = previousBytes;
        _internalGroupWallpaperUrl = previousUrl;
      });
      showErrorToast(context, error);
    } finally {
      if (mounted && _isCurrentThread(thread)) {
        setState(() => _internalGroupWallpaperUploadInFlight = false);
      }
    }
  }

  Future<void> _runConversationAction(
    ConversationThread thread,
    String action,
  ) async {
    if (!await _ensureLiveConnection(thread)) return;
    try {
      final response = await ref
          .read(apiClientProvider)
          .runConversationAction(thread, action);
      final message = response['message']?.toString().trim();
      if (!mounted) return;
      // Atualiza lista (fixar/arquivar/apagar) e mensagens da conversa.
      ref.invalidate(dashboardSnapshotProvider);
      if (action == 'delete' || action == 'leave') {
        if (thread.isInternalGroup) {
          ref.read(conversationCacheProvider).removeMessages(thread);
        }
      } else if (action == 'clear' && thread.isInternalGroup) {
        ref.read(conversationCacheProvider).removeMessages(thread);
        setState(() {
          _messages = const [];
          _hasMoreMessages = false;
          _oldestMessageCursor = null;
        });
      } else {
        await _loadInitialMessages(thread, silent: true, scrollToLatest: false);
      }
      if (!mounted) return;
      showActionToast(
        context,
        apiMessage: message,
        fallback: conversationActionSuccessMessage(action),
      );
    } catch (error) {
      if (!mounted) return;
      showErrorToast(context, error);
    }
  }

  Future<bool> _confirmConversationAction(
    BuildContext context, {
    required String title,
    required String content,
    required String confirmLabel,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(content),
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
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return confirmed == true;
  }

  Future<void> _transferInternalGroupAndLeave(ConversationThread thread) async {
    final groupId = thread.linkedGroupId;
    if (groupId == null) return;
    try {
      final details = await ref
          .read(apiClientProvider)
          .loadInternalGroup(groupId);
      if (!mounted) return;
      final admins = details.members
          .where(
            (member) => !member.isBot && !member.isMe && member.role == 'admin',
          )
          .toList(growable: false);
      if (admins.isEmpty) {
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Escolha um sucessor primeiro'),
            content: const Text(
              'Antes de sair, torne pelo menos um membro administrador. Depois você poderá transferir a propriedade para ele.',
            ),
            actions: [
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Entendi'),
              ),
            ],
          ),
        );
        return;
      }
      final selectedId = await showDialog<int>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Transferir grupo e sair'),
          content: SizedBox(
            width: 430,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Selecione o administrador que será o novo proprietário. O grupo, o robô e todo o histórico continuarão funcionando.',
                ),
                const SizedBox(height: 12),
                ...admins.map(
                  (member) => ListTile(
                    leading: CircleAvatar(
                      child: Text(
                        member.name.isEmpty
                            ? '?'
                            : member.name[0].toUpperCase(),
                      ),
                    ),
                    title: Text(member.name),
                    subtitle: const Text('Administrador'),
                    onTap: () => Navigator.pop(dialogContext, member.userId),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancelar'),
            ),
          ],
        ),
      );
      if (selectedId == null || !mounted) return;
      final newOwner = admins.firstWhere(
        (member) => member.userId == selectedId,
      );
      final confirmed = await _confirmConversationAction(
        context,
        title: 'Transferir para ${newOwner.name}?',
        content:
            '${newOwner.name} se tornará proprietário e você sairá do grupo. Essa transferência não desfaz o grupo.',
        confirmLabel: 'Transferir e sair',
      );
      if (!confirmed || !mounted) return;
      final response = await ref
          .read(apiClientProvider)
          .transferInternalGroupAndLeave(groupId, selectedId);
      if (!mounted) return;
      ref.read(conversationCacheProvider).removeMessages(thread);
      ref.invalidate(dashboardSnapshotProvider);
      showActionToast(
        context,
        apiMessage: response['message']?.toString(),
        fallback: 'Grupo transferido e saída concluída.',
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _runMessageAction(
    ConversationThread thread,
    ChatMessage message,
    String action, {
    Map<String, Object?> data = const {},
  }) async {
    if (action == 'download_media') {
      await _downloadMessageMedia(message);
      return;
    }
    final isReaction = action == 'react';
    final isViewOnceOpen = action == 'open_view_once';
    final reactionEmoji = isReaction
        ? (data['emoji'] ?? '').toString().trim()
        : '';

    // O toque precisa aparecer no balão no mesmo frame. A rede apenas confirma
    // em segundo plano; consultar a instância antes daqui causava o atraso.
    if (reactionEmoji.isNotEmpty) {
      _applyOptimisticReaction(message, reactionEmoji);
    }
    String? optimisticReplyId;
    if (action == 'interactive_reply') {
      final selectedText = (data['selectedText'] ?? '').toString().trim();
      if (selectedText.isNotEmpty) {
        optimisticReplyId = _nextLocalMessageId();
        final optimistic =
            _buildOptimisticTextMessage(
              localId: optimisticReplyId,
              text: selectedText,
            ).copyWith(
              quoted: ChatQuotedMessage(
                id: message.remoteId.isNotEmpty ? message.remoteId : message.id,
                title: message.senderDisplayName,
                participant: message.senderJid,
                text: message.displayText,
                messageType: message.messageType,
              ),
            );
        _appendOptimisticMessage(thread, optimistic);
      }
    }
    if (!await _ensureLiveConnection(thread)) {
      if (reactionEmoji.isNotEmpty) {
        unawaited(_refreshLatestMessages(thread, scrollToLatest: false));
      }
      return;
    }

    try {
      final response = await ref
          .read(apiClientProvider)
          .runMessageAction(thread, message, action: action, data: data);
      final responseMessage = response['message'];
      final messageText = responseMessage is String
          ? responseMessage.trim()
          : null;
      if (!mounted) return;
      // Não apaga a reação otimista enquanto o evento do WhatsApp ainda está
      // chegando. O realtime fará a reconciliação sem a reação piscar/sumir.
      if (!isReaction && !isViewOnceOpen) {
        await _refreshLatestMessages(thread, scrollToLatest: false);
      }
      if (action == 'poll_vote') {
        unawaited(_refreshSweepstakes(thread));
      }
      if (!mounted) return;
      if (isReaction || isViewOnceOpen) return;
      showActionToast(
        context,
        apiMessage: messageText,
        fallback: messageActionSuccessMessage(action),
      );
    } catch (error) {
      if (!mounted) return;
      if (optimisticReplyId != null) {
        _markLocalMessageStatus(optimisticReplyId, MessageLocalStatus.failed);
      }
      showErrorToast(context, error);
      // Recarrega para reverter otimista se falhou.
      unawaited(_refreshLatestMessages(thread, scrollToLatest: false));
      if (isViewOnceOpen) rethrow;
    }
  }

  Future<void> _downloadMessageMedia(ChatMessage message) async {
    final rawUrl = message.mediaUrl?.trim() ?? '';
    if (rawUrl.isEmpty) {
      showErrorToast(context, 'Esta mensagem não possui uma mídia disponível.');
      return;
    }
    try {
      final media = await ref
          .read(apiClientProvider)
          .downloadMediaBytes(rawUrl);
      final mimeType = message.mediaMimeType?.trim().isNotEmpty == true
          ? message.mediaMimeType!.trim()
          : media.mimeType;
      final originalName = message.mediaFileName?.trim() ?? '';
      final extension = _downloadExtension(mimeType, rawUrl);
      final fileName = originalName.isNotEmpty
          ? originalName
          : 'botadmin-${DateTime.now().millisecondsSinceEpoch}.$extension';
      final savedAt = await saveMediaToDevice(
        bytes: media.bytes,
        fileName: fileName,
        mimeType: mimeType,
      );
      if (mounted) showSuccessToast(context, savedAt);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  void _applyOptimisticReaction(ChatMessage message, String emoji) {
    final targetIds = <String>{message.id.trim(), message.remoteId.trim()}
      ..removeWhere((value) => value.isEmpty);

    setState(() {
      _messages = _messages
          .map((item) {
            final itemIds = <String>{item.id.trim(), item.remoteId.trim()}
              ..removeWhere((value) => value.isEmpty);
            final isTarget = itemIds.any(targetIds.contains);
            if (!isTarget) return item;

            final others = item.reactions
                .where((reaction) => !reaction.fromMe)
                .toList(growable: true);
            others.add(
              ChatReaction(
                emoji: emoji,
                targetMessageId: message.remoteId.isNotEmpty
                    ? message.remoteId
                    : message.id,
                senderName: 'Você',
                fromMe: true,
                timestamp: DateTime.now(),
              ),
            );
            return item.copyWith(reactions: others);
          })
          .toList(growable: false);
    });
    final thread = widget.thread;
    if (thread != null && _isCurrentThread(thread)) {
      ref
          .read(conversationCacheProvider)
          .putMessages(
            thread,
            CachedMessagePage(
              messages: List.unmodifiable(_messages),
              hasMore: _hasMoreMessages,
              oldestCursor: _oldestMessageCursor,
              fetchedAt: DateTime.now(),
            ),
          );
    }
  }

  Future<void> _startCall(
    ConversationThread thread, {
    required bool video,
  }) async {
    if (!await _ensureLiveConnection(thread)) return;
    try {
      final callId = await ref
          .read(apiClientProvider)
          .startCallForThread(thread, video: video);
      if (!mounted) return;
      widget.onOpenCalls?.call();
      showSuccessToast(
        context,
        video ? 'Chamada de video iniciada.' : 'Chamada iniciada.',
      );
      // The media bridge is intentionally started after the signaling request
      // returns. This asks for the microphone from the same user gesture and
      // avoids making the user open the calls panel before hearing audio.
      if (!video && callId != null && callId.isNotEmpty) {
        unawaited(
          callAudioBridge
              .start(instanceId: thread.instanceId, callId: callId)
              .catchError(
                (_) => const CallAudioBridgeSnapshot(status: 'error'),
              ),
        );
      }
    } catch (error) {
      if (!mounted) return;
      showErrorToast(context, error.toString());
    }
  }

  Future<void> _setDeletedMessageReveal(
    ConversationThread thread,
    ChatMessage message,
    bool reveal,
  ) async {
    try {
      if (thread.isInternalGroup) {
        if (!message.canRevealDeletedContent) {
          throw BotAdminApiException(
            'Somente administradores podem revelar mensagens apagadas.',
          );
        }
        _replaceMessage(message.copyWith(revealDeletedContent: reveal));
        if (!mounted) return;
        showSuccessToast(
          context,
          reveal
              ? 'Mensagem excluída revelada para você.'
              : 'Mensagem excluída voltou a ficar oculta.',
        );
        return;
      }
      final updated = await ref
          .read(apiClientProvider)
          .setDeletedMessageReveal(thread, message, reveal: reveal);
      if (updated != null && mounted) {
        _replaceMessage(updated);
      } else {
        await _refreshLatestMessages(thread, scrollToLatest: false);
      }
      if (!mounted) return;
      showSuccessToast(
        context,
        reveal
            ? 'Mensagem excluída revelada.'
            : 'Mensagem excluída voltou a ficar oculta.',
      );
    } catch (error) {
      if (!mounted) return;
      showErrorToast(context, error.toString());
    }
  }
}

class _ChatHeader extends StatelessWidget {
  const _ChatHeader({
    required this.thread,
    this.group,
    this.leading,
    required this.onRefresh,
    required this.onSearch,
    required this.onShowInfo,
    this.onOpenGroupSettings,
    this.onToggleBot,
    this.onOpenTools,
    this.onOpenCalls,
    this.onOpenSupport,
    this.onCopyInternalGroupLink,
    this.onRotateInternalGroupLink,
    this.onChangeInternalGroupWallpaper,
    required this.onStartCall,
    required this.onRunConversationAction,
    this.onTransferAndLeave,
  });

  final ConversationThread thread;
  final BotGroup? group;
  final Widget? leading;
  final VoidCallback onRefresh;
  final VoidCallback onSearch;
  final VoidCallback onShowInfo;
  final VoidCallback? onOpenGroupSettings;
  final VoidCallback? onToggleBot;
  final VoidCallback? onOpenTools;
  final VoidCallback? onOpenCalls;
  final VoidCallback? onOpenSupport;
  final VoidCallback? onCopyInternalGroupLink;
  final VoidCallback? onRotateInternalGroupLink;
  final VoidCallback? onChangeInternalGroupWallpaper;
  final Future<void> Function(bool video) onStartCall;
  final Future<void> Function(String action) onRunConversationAction;
  final Future<void> Function()? onTransferAndLeave;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final wide = width >= 980;
    final compact = width < 720;
    final subtitle = thread.isInternalGroup
        ? 'toque para dados do grupo BotAdmin'
        : thread.isCommunity
        ? 'toque para dados da comunidade'
        : thread.isChannel
        ? 'toque para dados do canal'
        : thread.isGroup
        ? 'toque para dados do grupo'
        : 'toque para dados do contato';
    final wa = WaTheme.of(context);
    return Material(
      color: wa.headerBg,
      elevation: 0,
      child: Container(
        height: compact ? 56 : 60,
        padding: EdgeInsets.only(
          left: leading != null ? 0 : (compact ? 10 : 16),
          right: compact ? 4 : 10,
        ),
        decoration: BoxDecoration(
          color: wa.headerBg,
          border: Border(bottom: BorderSide(color: wa.divider, width: 1)),
        ),
        child: Row(
          children: [
            ?leading,
            Expanded(
              child: InkWell(
                onTap: onShowInfo,
                borderRadius: BorderRadius.circular(10),
                child: Padding(
                  padding: EdgeInsets.symmetric(
                    horizontal: compact ? 2 : 4,
                    vertical: 6,
                  ),
                  child: Row(
                    children: [
                      _ThreadAvatar(
                        thread: thread,
                        group: group,
                        radius: compact ? 18 : 20,
                      ),
                      SizedBox(width: compact ? 8 : 12),
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    thread.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: compact ? 16 : 16.5,
                                      fontWeight: FontWeight.w600,
                                      color: wa.textPrimary,
                                      height: 1.15,
                                    ),
                                  ),
                                ),
                                SizedBox(width: compact ? 5 : 7),
                                _ConversationTypeBadge(thread: thread),
                              ],
                            ),
                            SizedBox(height: 1),
                            Text(
                              subtitle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12.5,
                                color: wa.textMuted,
                                height: 1.15,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (wide) ...[
              _AddToListButton(onPressed: onOpenTools),
              SizedBox(width: 8),
            ],
            if (!compact)
              _CallHeaderMenu(
                enabled: !thread.isGroup && !thread.isChannel,
                onOpenCalls: onOpenCalls,
                onStartCall: onStartCall,
              )
            else if (!thread.isGroup && !thread.isChannel)
              IconButton(
                onPressed: () => unawaited(onStartCall(false)),
                icon: Icon(Icons.call_rounded, color: WaTheme.of(context).icon),
                tooltip: 'Ligar',
                visualDensity: VisualDensity.compact,
              ),
            IconButton(
              onPressed: onSearch,
              icon: Icon(Icons.search_rounded, color: WaTheme.of(context).icon),
              tooltip: 'Buscar',
              visualDensity: VisualDensity.compact,
            ),
            PopupMenuButton<_ChatAction>(
              tooltip: 'Ações',
              icon: Icon(
                Icons.more_vert_rounded,
                color: WaTheme.of(context).icon,
              ),
              color: WaTheme.of(context).menuBg,
              onSelected: (action) {
                _handleAction(context, action);
              },
              itemBuilder: (context) {
                final linkedGroup = group;
                return [
                  if (onOpenSupport != null && !thread.isInternalGroup)
                    const PopupMenuItem(
                      value: _ChatAction.support,
                      child: ListTile(
                        leading: Icon(Icons.support_agent_rounded),
                        title: Text('Falar com o suporte'),
                        subtitle: Text('Abrir conversa com o administrador'),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  if (!thread.isInternalGroup)
                    const PopupMenuItem(
                      value: _ChatAction.refresh,
                      child: ListTile(
                        leading: Icon(Icons.refresh_rounded),
                        title: Text('Atualizar mensagens'),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  if (thread.isInternalGroup &&
                      onCopyInternalGroupLink != null &&
                      onRotateInternalGroupLink != null)
                    const PopupMenuItem(
                      value: _ChatAction.internalLinks,
                      child: ListTile(
                        leading: Icon(Icons.link_rounded),
                        title: Text('Link do grupo'),
                        trailing: Icon(Icons.arrow_drop_down_rounded),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  if (thread.isInternalGroup &&
                      onChangeInternalGroupWallpaper != null)
                    const PopupMenuItem(
                      value: _ChatAction.wallpaper,
                      child: ListTile(
                        leading: Icon(Icons.wallpaper_rounded),
                        title: Text('Plano de fundo'),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  if (thread.isGroup && onToggleBot != null) ...[
                    PopupMenuItem(
                      value: _ChatAction.toggleBot,
                      child: ListTile(
                        leading: Icon(
                          Icons.smart_toy_rounded,
                          color: linkedGroup?.botEnabled == true
                              ? const Color(0xFF00A884)
                              : null,
                        ),
                        title: Text(
                          linkedGroup == null
                              ? 'Vincular e ativar robô'
                              : linkedGroup.botEnabled
                              ? 'Desativar robô neste grupo'
                              : 'Ativar robô neste grupo',
                        ),
                        trailing: linkedGroup == null
                            ? const Icon(Icons.add_link_rounded)
                            : IgnorePointer(
                                child: Switch.adaptive(
                                  value: linkedGroup.botEnabled,
                                  onChanged: (_) {},
                                  activeTrackColor: const Color(0xFF00A884),
                                  materialTapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                ),
                              ),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                    if (linkedGroup != null)
                      const PopupMenuItem(
                        value: _ChatAction.groupSettings,
                        child: ListTile(
                          leading: Icon(Icons.tune_rounded),
                          title: Text('Bot / ativações do grupo'),
                          contentPadding: EdgeInsets.zero,
                        ),
                      )
                    else
                      const PopupMenuItem(
                        value: _ChatAction.groupSettings,
                        enabled: false,
                        child: ListTile(
                          leading: Icon(Icons.tune_rounded),
                          title: Text('Ativações após vincular o grupo'),
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                  ],
                  if (!thread.isInternalGroup)
                    const PopupMenuItem(
                      value: _ChatAction.copyJid,
                      child: ListTile(
                        leading: Icon(Icons.copy_rounded),
                        title: Text('Copiar ID da conversa'),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  if (!thread.isInternalGroup || thread.instanceIsAdmin == true)
                    const PopupMenuItem(
                      value: _ChatAction.clear,
                      child: ListTile(
                        leading: Icon(Icons.cleaning_services_rounded),
                        title: Text('Limpar mensagens'),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  if (!thread.isInternalGroup)
                    PopupMenuItem(
                      value: _ChatAction.delete,
                      child: ListTile(
                        leading: const Icon(Icons.delete_outline_rounded),
                        title: const Text('Apagar conversa'),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  if (thread.isGroup)
                    const PopupMenuItem(
                      value: _ChatAction.leave,
                      child: ListTile(
                        leading: Icon(Icons.logout_rounded),
                        title: Text('Sair do grupo'),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                ];
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _handleAction(BuildContext context, _ChatAction action) async {
    switch (action) {
      case _ChatAction.support:
        onOpenSupport?.call();
        break;
      case _ChatAction.refresh:
        onRefresh();
        break;
      case _ChatAction.internalLinks:
        await _showInternalGroupLinkActions(context);
        break;
      case _ChatAction.wallpaper:
        onChangeInternalGroupWallpaper?.call();
        break;
      case _ChatAction.toggleBot:
        onToggleBot?.call();
        break;
      case _ChatAction.groupSettings:
        onOpenGroupSettings?.call();
        break;
      case _ChatAction.copyJid:
        Clipboard.setData(ClipboardData(text: thread.chatJid));
        showSuccessToast(context, 'ID da conversa copiado.');
        break;
      case _ChatAction.clear:
        if (await _confirmConversationAction(
          context,
          title: thread.isInternalGroup
              ? 'Limpar para todos?'
              : 'Limpar mensagens?',
          content: thread.isInternalGroup
              ? 'Todo o histórico deste grupo BotAdmin será apagado para todos os membros. Esta ação não pode ser desfeita.'
              : 'As mensagens desta conversa serão limpas no histórico.',
          confirmLabel: 'Limpar',
        )) {
          await onRunConversationAction('clear');
        }
        break;
      case _ChatAction.delete:
        if (await _confirmConversationAction(
          context,
          title: thread.isInternalGroup
              ? 'Apagar o grupo definitivamente?'
              : 'Apagar conversa?',
          content: thread.isInternalGroup
              ? 'O grupo, participantes, histórico, convites e configurações do robô serão excluídos para todos. Esta ação é irreversível.'
              : 'A conversa será apagada da lista deste perfil.',
          confirmLabel: thread.isInternalGroup ? 'Apagar grupo' : 'Apagar',
        )) {
          await onRunConversationAction('delete');
        }
        break;
      case _ChatAction.leave:
        if (thread.isInternalGroup && thread.internalGroupRole == 'owner') {
          await onTransferAndLeave?.call();
          break;
        }
        if (await _confirmConversationAction(
          context,
          title: 'Sair do grupo?',
          content: thread.isInternalGroup
              ? 'Você deixará de participar deste grupo BotAdmin.'
              : 'A instância vai sair deste grupo.',
          confirmLabel: 'Sair',
        )) {
          await onRunConversationAction('leave');
        }
        break;
    }
  }

  Future<void> _showInternalGroupLinkActions(BuildContext context) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(
              leading: Icon(Icons.link_rounded),
              title: Text(
                'Link do grupo',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.content_copy_rounded),
              title: const Text('Copiar link'),
              onTap: () => Navigator.pop(sheetContext, 'copy'),
            ),
            ListTile(
              leading: const Icon(Icons.link_off_rounded),
              title: const Text('Revogar e gerar um novo link'),
              subtitle: const Text('O endereço atual deixará de funcionar'),
              onTap: () => Navigator.pop(sheetContext, 'rotate'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (selected == 'copy') onCopyInternalGroupLink?.call();
    if (selected == 'rotate') onRotateInternalGroupLink?.call();
  }

  Future<bool> _confirmConversationAction(
    BuildContext context, {
    required String title,
    required String content,
    required String confirmLabel,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(content),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return confirmed == true;
  }
}

class _ConversationTypeBadge extends StatelessWidget {
  const _ConversationTypeBadge({required this.thread});

  final ConversationThread thread;

  @override
  Widget build(BuildContext context) {
    final color = thread.isInternalGroup
        ? const Color(0xFF39FF14)
        : thread.isChannel
        ? const Color(0xFF147D92)
        : thread.isCommunity
        ? const Color(0xFF7C3AED)
        : thread.isGroup
        ? const Color(0xFFB7791F)
        : const Color(0xFF16865A);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: thread.isInternalGroup
            ? const Color(0xFF092C16)
            : color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(5),
        border: Border.all(
          color: color.withValues(alpha: thread.isInternalGroup ? 0.9 : 0.32),
        ),
        boxShadow: thread.isInternalGroup
            ? [BoxShadow(color: color.withValues(alpha: 0.32), blurRadius: 8)]
            : null,
      ),
      child: Text(
        thread.conversationTypeLabel,
        maxLines: 1,
        style: TextStyle(
          color: color,
          fontSize: 10.5,
          fontWeight: thread.isInternalGroup
              ? FontWeight.w900
              : FontWeight.w700,
          height: 1,
        ),
      ),
    );
  }
}

enum _ChatAction {
  support,
  refresh,
  internalLinks,
  wallpaper,
  toggleBot,
  groupSettings,
  copyJid,
  clear,
  delete,
  leave,
}

class _ChatSearchBar extends StatelessWidget {
  const _ChatSearchBar({required this.controller, required this.onClose});

  final TextEditingController controller;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: wa.headerBg,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 0, 18, 10),
        child: SizedBox(
          height: 44,
          child: TextField(
            controller: controller,
            autofocus: true,
            style: TextStyle(fontSize: 15, color: wa.textPrimary),
            decoration: InputDecoration(
              hintText: 'Buscar nas mensagens',
              hintStyle: TextStyle(color: wa.textMuted),
              prefixIcon: Icon(Icons.search_rounded, color: wa.icon),
              suffixIcon: IconButton(
                tooltip: 'Fechar busca',
                icon: Icon(Icons.close_rounded, color: wa.icon),
                onPressed: onClose,
              ),
              fillColor: wa.inputFill,
              filled: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 10),
              border: OutlineInputBorder(
                borderSide: BorderSide.none,
                borderRadius: BorderRadius.circular(22),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ThreadAvatar extends StatelessWidget {
  const _ThreadAvatar({required this.thread, this.group, this.radius = 22});

  final ConversationThread thread;
  final BotGroup? group;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final url = _absoluteMediaUrl(thread.avatarUrl ?? group?.avatarUrl);
    if (url != null) {
      return ClipOval(
        child: BotAdminCachedImage(
          imageUrl: url,
          width: radius * 2,
          height: radius * 2,
          fit: BoxFit.cover,
          memCacheWidth: 96,
          memCacheHeight: 96,
          maxWidthDiskCache: 128,
          maxHeightDiskCache: 128,
          fadeInDuration: const Duration(milliseconds: 100),
          errorWidget: (context, _, _) => _fallback(context),
        ),
      );
    }
    return _fallback(context);
  }

  Widget _fallback(BuildContext context) {
    final wa = WaTheme.of(context);
    return CircleAvatar(
      radius: radius,
      backgroundColor: wa.avatarFallback,
      child: Icon(
        thread.isGroup ? Icons.groups_rounded : Icons.person_rounded,
        color: wa.icon,
        size: radius + 5,
      ),
    );
  }
}

Future<void> _showThreadInfoDialog(
  BuildContext context, {
  required ConversationThread thread,
  BotGroup? group,
  List<ChatMessage> messages = const [],
  Future<void> Function(String action)? onRunConversationAction,
  void Function(String jid, String displayName)? onOpenParticipantConversation,
}) {
  if (thread.isGroup) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => _GroupInfoDialog(
        thread: thread,
        group: group,
        messages: messages,
        onRunConversationAction: onRunConversationAction,
        onOpenParticipantConversation: onOpenParticipantConversation,
      ),
    );
  }

  final avatarUrl = _absoluteMediaUrl(thread.avatarUrl ?? group?.avatarUrl);
  final type = thread.isGroup
      ? 'Grupo'
      : thread.isChannel
      ? 'Canal'
      : 'Contato';
  final phone = _threadPhoneDisplay(thread);
  return showDialog<void>(
    context: context,
    builder: (dialogContext) {
      final wa = WaTheme.of(dialogContext);
      return Dialog(
        backgroundColor: wa.panelElevated,
        surfaceTintColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        child: DefaultTextStyle.merge(
          style: TextStyle(color: wa.textPrimary),
          child: IconTheme.merge(
            data: IconThemeData(color: wa.icon),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(22, 20, 22, 18),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: IconButton(
                        tooltip: 'Fechar',
                        onPressed: () => Navigator.of(dialogContext).pop(),
                        icon: Icon(Icons.close_rounded, color: wa.icon),
                      ),
                    ),
                    SizedBox(
                      width: 170,
                      height: 170,
                      child: ClipOval(
                        child: avatarUrl == null
                            ? ColoredBox(
                                color: wa.avatarFallback,
                                child: Icon(
                                  thread.isGroup
                                      ? Icons.groups_rounded
                                      : Icons.person_rounded,
                                  size: 78,
                                  color: wa.icon,
                                ),
                              )
                            : BotAdminCachedImage(
                                imageUrl: avatarUrl,
                                fit: BoxFit.cover,
                                fadeInDuration: const Duration(
                                  milliseconds: 120,
                                ),
                                errorWidget: (context, _, _) => ColoredBox(
                                  color: wa.avatarFallback,
                                  child: Icon(
                                    thread.isGroup
                                        ? Icons.groups_rounded
                                        : Icons.person_rounded,
                                    size: 78,
                                    color: wa.icon,
                                  ),
                                ),
                              ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      thread.title,
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: wa.textPrimary,
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      type,
                      style: TextStyle(color: wa.textMuted, fontSize: 14),
                    ),
                    if (phone != null) ...[
                      const SizedBox(height: 6),
                      SelectableText(
                        phone,
                        textAlign: TextAlign.center,
                        style: TextStyle(color: wa.textSecondary, fontSize: 14),
                      ),
                    ],
                    const SizedBox(height: 12),
                    SelectableText(
                      thread.chatJid,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                    ),
                    if (group != null) ...[
                      const SizedBox(height: 14),
                      _ThreadInfoChip(
                        icon: group.botEnabled
                            ? Icons.smart_toy_rounded
                            : Icons.smart_toy_outlined,
                        label: group.botEnabled
                            ? 'Robô ativo'
                            : 'Robô desligado',
                        active: group.botEnabled,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}

class _GroupInfoDialog extends ConsumerStatefulWidget {
  const _GroupInfoDialog({
    required this.thread,
    this.group,
    this.messages = const [],
    this.onRunConversationAction,
    this.onOpenParticipantConversation,
  });

  final ConversationThread thread;
  final BotGroup? group;
  final List<ChatMessage> messages;
  final Future<void> Function(String action)? onRunConversationAction;
  final void Function(String jid, String displayName)?
  onOpenParticipantConversation;

  @override
  ConsumerState<_GroupInfoDialog> createState() => _GroupInfoDialogState();
}

class _GroupInfoDialogState extends ConsumerState<_GroupInfoDialog> {
  bool _loadingParticipants = false;
  bool _saving = false;
  bool _showPermissions = false;
  late String _title;
  late String _description;
  late String? _avatarUrl;
  late String? _inviteLink;
  late int _participantCount;
  late bool _adminsOnly;
  late bool _muted;
  late bool _pinned;
  bool _locked = false;
  String _ephemeral = 'off';
  List<_GroupInfoParticipant> _participants = const [];

  bool get _canEdit => widget.thread.instanceIsAdmin ?? true;
  int? get _groupId => widget.group?.id ?? widget.thread.linkedGroupId;

  @override
  void initState() {
    super.initState();
    _title = widget.thread.title.trim().isNotEmpty
        ? widget.thread.title.trim()
        : 'Grupo';
    _description = widget.thread.groupDescription?.trim() ?? '';
    _avatarUrl = widget.thread.avatarUrl ?? widget.group?.avatarUrl;
    _inviteLink = widget.thread.inviteLink;
    _participantCount = widget.thread.participantsCount ?? 0;
    _adminsOnly = widget.thread.announceOnly ?? false;
    _muted = widget.thread.muted;
    _pinned = widget.thread.pinned;
    _loadParticipants();
  }

  Future<void> _loadParticipants() async {
    final groupId = _groupId;
    if (groupId == null || groupId <= 0) return;
    setState(() => _loadingParticipants = true);
    try {
      final raw = await ref
          .read(apiClientProvider)
          .loadGroupParticipants(groupId);
      if (!mounted) return;
      setState(() {
        _participants = raw
            .map(_GroupInfoParticipant.fromJson)
            .where((entry) => entry.jid.isNotEmpty || entry.label.isNotEmpty)
            .toList(growable: false);
        if (_participantCount <= 0) _participantCount = _participants.length;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _participants = const []);
    } finally {
      if (mounted) setState(() => _loadingParticipants = false);
    }
  }

  Future<T?> _guardedEdit<T>(
    Future<T> Function(int groupId) action, {
    String successMessage = 'Dados do grupo atualizados.',
  }) async {
    final groupId = _groupId;
    if (groupId == null || groupId <= 0) {
      showErrorToast(context, 'Grupo ainda não está vinculado no BotAdmin.');
      return null;
    }
    if (!_canEdit) {
      showErrorToast(
        context,
        'A instância precisa ser admin do grupo para alterar esses dados.',
      );
      return null;
    }
    if (_saving) return null;
    setState(() => _saving = true);
    try {
      final result = await action(groupId);
      if (!mounted) return null;
      showSuccessToast(context, successMessage);
      ref.invalidate(dashboardSnapshotProvider);
      return result;
    } catch (error) {
      if (mounted) showErrorToast(context, error);
      return null;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _editName() async {
    final next = await _showGroupTextEditor(
      context,
      title: 'Nome do grupo',
      initialValue: _title,
      maxLines: 1,
    );
    if (next == null) return;
    final saved = await _guardedEdit((groupId) {
      return ref
          .read(apiClientProvider)
          .updateGroupDetails(groupId, name: next);
    });
    if (!mounted || saved == null) return;
    setState(() => _title = saved.name.trim().isNotEmpty ? saved.name : next);
  }

  Future<void> _editDescription() async {
    final next = await _showGroupTextEditor(
      context,
      title: 'Descrição do grupo',
      initialValue: _description,
      maxLines: 6,
    );
    if (next == null) return;
    final saved = await _guardedEdit((groupId) {
      return ref
          .read(apiClientProvider)
          .updateGroupDetails(groupId, description: next);
    });
    if (!mounted || saved == null) return;
    setState(() => _description = next);
  }

  Future<void> _uploadPhoto() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(label: 'Imagem', extensions: ['jpg', 'jpeg', 'png', 'webp']),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final saved = await _guardedEdit((groupId) {
      return ref
          .read(apiClientProvider)
          .uploadGroupPhoto(
            groupId,
            bytes: bytes,
            fileName: file.name,
            mimeType: file.mimeType,
          );
    });
    if (!mounted || saved == null) return;
    setState(() => _avatarUrl = saved.avatarUrl ?? _avatarUrl);
  }

  Future<void> _removePhoto() async {
    final confirmed = await _confirmGroupInfoAction(
      context,
      title: 'Remover foto do grupo?',
      content: 'A foto atual do grupo será removida.',
      confirmLabel: 'Remover',
    );
    if (!confirmed) return;
    final saved = await _guardedEdit((groupId) {
      return ref.read(apiClientProvider).removeGroupPhoto(groupId);
    });
    if (!mounted || saved == null) return;
    setState(() => _avatarUrl = null);
  }

  Future<void> _updatePermission({
    bool? adminsOnly,
    bool? locked,
    String? ephemeral,
  }) async {
    final saved = await _guardedEdit((groupId) {
      return ref
          .read(apiClientProvider)
          .updateGroupPermissions(
            groupId,
            adminsOnly: adminsOnly,
            locked: locked,
            ephemeral: ephemeral,
          );
    });
    if (!mounted || saved == null) return;
    setState(() {
      if (adminsOnly != null) _adminsOnly = adminsOnly;
      if (locked != null) _locked = locked;
      if (ephemeral != null) _ephemeral = ephemeral;
    });
  }

  Future<void> _addMember() async {
    final value = await _showGroupTextEditor(
      context,
      title: 'Adicionar membro',
      initialValue: '',
      maxLines: 1,
      hintText: '5592999999999',
    );
    if (value == null || value.trim().isEmpty) return;
    final response = await _guardedEdit<Map<String, dynamic>>(
      (_) => ref
          .read(apiClientProvider)
          .runGroupParticipantAction(
            widget.group,
            thread: widget.thread,
            participantJid: value,
            action: 'add',
          ),
      successMessage: 'Participante adicionado.',
    );
    if (!mounted || response == null) return;
    _applyParticipantsResponse(response);
  }

  Future<void> _runParticipantAction(
    _GroupInfoParticipant participant,
    String action,
  ) async {
    if (action == 'chat') {
      final callback = widget.onOpenParticipantConversation;
      if (callback == null || participant.jid.trim().isEmpty) return;
      Navigator.of(context).pop();
      callback(participant.jid, participant.label);
      return;
    }
    final destructive = action == 'remove' || action == 'blacklist';
    if (destructive) {
      final confirmed = await _confirmGroupInfoAction(
        context,
        title: action == 'blacklist'
            ? 'Adicionar à blacklist?'
            : 'Remover participante?',
        content: action == 'blacklist'
            ? '${participant.label} será adicionado à blacklist e removido do grupo.'
            : '${participant.label} será removido do grupo.',
        confirmLabel: action == 'blacklist' ? 'Adicionar' : 'Remover',
      );
      if (!confirmed) return;
    }
    final response = await _guardedEdit<Map<String, dynamic>>(
      (_) => ref
          .read(apiClientProvider)
          .runGroupParticipantAction(
            widget.group,
            thread: widget.thread,
            participantJid: participant.jid,
            action: action,
            deleteRecentMessages: action == 'blacklist',
            removeAfterBlacklist: action == 'blacklist',
          ),
      successMessage: 'Ação aplicada.',
    );
    if (!mounted || response == null) return;
    _applyParticipantsResponse(response);
  }

  void _applyParticipantsResponse(Map<String, dynamic> response) {
    final raw = response['participants'];
    if (raw is List) {
      setState(() {
        _participants = raw
            .whereType<Map>()
            .map(
              (entry) =>
                  _GroupInfoParticipant.fromJson(entry.cast<String, dynamic>()),
            )
            .toList(growable: false);
        _participantCount = _participants.length;
      });
    } else {
      unawaited(_loadParticipants());
    }
  }

  Future<void> _openMemberSearch() {
    return showDialog<void>(
      context: context,
      builder: (context) => _GroupMembersDialog(
        participants: _participants,
        onAction: (participant, action) {
          Navigator.of(context).pop();
          unawaited(_runParticipantAction(participant, action));
        },
      ),
    );
  }

  Future<void> _openMediaDialog() {
    return showDialog<void>(
      context: context,
      builder: (context) => _GroupMediaDialog(messages: widget.messages),
    );
  }

  Future<void> _openFavoritesDialog() {
    return showDialog<void>(
      context: context,
      builder: (context) => const _GroupSimpleInfoDialog(
        title: 'Mensagens favoritas',
        message: 'Nenhuma mensagem favorita encontrada nesta conversa.',
      ),
    );
  }

  Future<void> _openNotificationDialog() {
    return showDialog<void>(
      context: context,
      builder: (context) => _GroupNotificationDialog(
        muted: _muted,
        onToggleMute: _toggleNotificationsMuted,
      ),
    );
  }

  Future<void> _toggleNotificationsMuted() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final next = await ref
          .read(apiClientProvider)
          .setConversationNotificationsMuted(widget.thread, muted: !_muted);
      if (!mounted) return;
      setState(() => _muted = next);
      ref.invalidate(dashboardSnapshotProvider);
      showSuccessToast(
        context,
        next ? 'Notificações silenciadas.' : 'Notificações ativadas.',
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _toggleFavorite() async {
    final runner = widget.onRunConversationAction;
    if (runner == null || _saving) return;
    final action = _pinned ? 'unpin' : 'pin';
    setState(() => _saving = true);
    try {
      await runner(action);
      if (!mounted) return;
      setState(() => _pinned = !_pinned);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _showInlineInfo(String title, String message) {
    return showDialog<void>(
      context: context,
      builder: (context) =>
          _GroupSimpleInfoDialog(title: title, message: message),
    );
  }

  Future<void> _runConversationQuickAction(
    String action, {
    required String confirmTitle,
    required String confirmContent,
    required String confirmLabel,
  }) async {
    final runner = widget.onRunConversationAction;
    if (runner == null || _saving) return;
    final confirmed = await _confirmGroupInfoAction(
      context,
      title: confirmTitle,
      content: confirmContent,
      confirmLabel: confirmLabel,
    );
    if (!confirmed) return;
    setState(() => _saving = true);
    try {
      await runner(action);
      if (!mounted) return;
      if (action == 'leave') Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final size = MediaQuery.sizeOf(context);
    final compact = size.width < 720;
    return Dialog(
      alignment: compact ? null : Alignment.centerRight,
      insetPadding: compact
          ? const EdgeInsets.all(0)
          : const EdgeInsets.fromLTRB(24, 18, 24, 18),
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(compact ? 0 : 0),
      ),
      child: DefaultTextStyle.merge(
        style: TextStyle(color: wa.textPrimary),
        child: IconTheme.merge(
          data: IconThemeData(color: wa.icon),
          child: SizedBox(
            width: compact ? size.width : 430,
            height: compact ? size.height : size.height - 36,
            child: _showPermissions
                ? _GroupPermissionsPane(
                    adminsOnly: _adminsOnly,
                    locked: _locked,
                    ephemeral: _ephemeral,
                    instanceIsAdmin: widget.thread.instanceIsAdmin,
                    participants: _participants,
                    saving: _saving,
                    onBack: () => setState(() => _showPermissions = false),
                    onAdminsOnlyChanged: (value) =>
                        _updatePermission(adminsOnly: value),
                    onLockedChanged: (value) =>
                        _updatePermission(locked: value),
                    onEphemeralChanged: (value) =>
                        _updatePermission(ephemeral: value),
                  )
                : _GroupInfoPane(
                    title: _title,
                    description: _description,
                    avatarUrl: _avatarUrl,
                    inviteLink: _inviteLink,
                    participantCount: _participantCount,
                    muted: _muted,
                    pinned: _pinned,
                    group: widget.group,
                    messages: widget.messages,
                    participants: _participants,
                    loadingParticipants: _loadingParticipants,
                    saving: _saving,
                    canEdit: _canEdit,
                    onClose: () => Navigator.of(context).pop(),
                    onEditName: _editName,
                    onEditDescription: _editDescription,
                    onUploadPhoto: _uploadPhoto,
                    onRemovePhoto: _removePhoto,
                    onAddMember: _addMember,
                    onSearchMembers: _openMemberSearch,
                    onOpenMedia: _openMediaDialog,
                    onOpenFavorites: _openFavoritesDialog,
                    onOpenNotifications: _openNotificationDialog,
                    onPermissions: () =>
                        setState(() => _showPermissions = true),
                    onFavorite: _toggleFavorite,
                    onShowMemberChanges: () {
                      unawaited(
                        _showInlineInfo(
                          'Mudanças de membros',
                          'As mudanças de entrada, saída e promoção serão exibidas aqui conforme a API retornar eventos de participantes para esta conversa.',
                        ),
                      );
                    },
                    onAddToList: () {
                      unawaited(
                        _showInlineInfo(
                          'Listas',
                          'A conversa poderá ser vinculada a listas quando o endpoint de listas estiver disponível no painel Flutter.',
                        ),
                      );
                    },
                    onCreateSimilarGroup: () {
                      unawaited(
                        _showInlineInfo(
                          'Criar grupo similar',
                          'A criação de grupo com os mesmos membros depende do endpoint remoto de criação de grupos. A ação já fica centralizada aqui no painel do grupo.',
                        ),
                      );
                    },
                    onReportGroup: () {
                      unawaited(
                        _showInlineInfo(
                          'Denunciar grupo',
                          'A denúncia direta pelo WhatsApp ainda não está disponível pela API. Use esta tela para limpar a conversa ou sair do grupo rapidamente.',
                        ),
                      );
                    },
                    onParticipantAction: _runParticipantAction,
                    onClearConversation: () => _runConversationQuickAction(
                      'clear',
                      confirmTitle: 'Limpar conversa?',
                      confirmContent:
                          'As mensagens desta conversa serão limpas no histórico.',
                      confirmLabel: 'Limpar',
                    ),
                    onLeaveGroup: () => _runConversationQuickAction(
                      'leave',
                      confirmTitle: 'Sair do grupo?',
                      confirmContent: 'A instância vai sair deste grupo.',
                      confirmLabel: 'Sair',
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

class _GroupInfoPane extends StatelessWidget {
  const _GroupInfoPane({
    required this.title,
    required this.description,
    required this.avatarUrl,
    required this.inviteLink,
    required this.participantCount,
    required this.muted,
    required this.pinned,
    required this.group,
    required this.messages,
    required this.participants,
    required this.loadingParticipants,
    required this.saving,
    required this.canEdit,
    required this.onClose,
    required this.onEditName,
    required this.onEditDescription,
    required this.onUploadPhoto,
    required this.onRemovePhoto,
    required this.onAddMember,
    required this.onSearchMembers,
    required this.onOpenMedia,
    required this.onOpenFavorites,
    required this.onOpenNotifications,
    required this.onPermissions,
    required this.onFavorite,
    required this.onShowMemberChanges,
    required this.onAddToList,
    required this.onCreateSimilarGroup,
    required this.onReportGroup,
    required this.onParticipantAction,
    required this.onClearConversation,
    required this.onLeaveGroup,
  });

  final String title;
  final String description;
  final String? avatarUrl;
  final String? inviteLink;
  final int participantCount;
  final bool muted;
  final bool pinned;
  final BotGroup? group;
  final List<ChatMessage> messages;
  final List<_GroupInfoParticipant> participants;
  final bool loadingParticipants;
  final bool saving;
  final bool canEdit;
  final VoidCallback onClose;
  final VoidCallback onEditName;
  final VoidCallback onEditDescription;
  final VoidCallback onUploadPhoto;
  final VoidCallback onRemovePhoto;
  final VoidCallback onAddMember;
  final VoidCallback onSearchMembers;
  final VoidCallback onOpenMedia;
  final VoidCallback onOpenFavorites;
  final VoidCallback onOpenNotifications;
  final VoidCallback onPermissions;
  final VoidCallback onFavorite;
  final VoidCallback onShowMemberChanges;
  final VoidCallback onAddToList;
  final VoidCallback onCreateSimilarGroup;
  final VoidCallback onReportGroup;
  final void Function(_GroupInfoParticipant participant, String action)
  onParticipantAction;
  final VoidCallback onClearConversation;
  final VoidCallback onLeaveGroup;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final resolvedAvatarUrl = _absoluteMediaUrl(avatarUrl ?? group?.avatarUrl);
    final count = participantCount > 0 ? participantCount : participants.length;
    final trimmedDescription = description.trim();
    final trimmedInviteLink = inviteLink?.trim().isNotEmpty == true
        ? AppConfig.publicInviteUrl(inviteLink!.trim())
        : null;
    final previewParticipants = participants.take(3).toList(growable: false);
    final mediaCount = messages
        .where((message) => message.hasRenderableMedia)
        .length;
    return Column(
      children: [
        _GroupInfoHeader(title: 'Dados do grupo', onBack: onClose),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(28, 18, 28, 28),
            children: [
              Center(
                child: Stack(
                  alignment: Alignment.bottomRight,
                  children: [
                    SizedBox(
                      width: 150,
                      height: 150,
                      child: ClipOval(
                        child: resolvedAvatarUrl == null
                            ? ColoredBox(
                                color: wa.avatarFallback,
                                child: Icon(
                                  Icons.groups_rounded,
                                  color: wa.icon,
                                  size: 76,
                                ),
                              )
                            : BotAdminCachedImage(
                                imageUrl: resolvedAvatarUrl,
                                fit: BoxFit.cover,
                                errorWidget: (context, _, _) => ColoredBox(
                                  color: wa.avatarFallback,
                                  child: Icon(
                                    Icons.groups_rounded,
                                    color: wa.icon,
                                    size: 76,
                                  ),
                                ),
                              ),
                      ),
                    ),
                    _GroupRoundIconButton(
                      icon: Icons.photo_camera_rounded,
                      tooltip: canEdit
                          ? 'Alterar foto do grupo'
                          : 'Instância não é admin',
                      onTap: saving ? null : onUploadPhoto,
                    ),
                    if (resolvedAvatarUrl != null)
                      Positioned(
                        left: 0,
                        bottom: 0,
                        child: _GroupRoundIconButton(
                          icon: Icons.delete_outline_rounded,
                          tooltip: canEdit
                              ? 'Remover foto do grupo'
                              : 'Instância não é admin',
                          onTap: saving ? null : onRemovePhoto,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: wa.textPrimary,
                        fontSize: 24,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: canEdit ? 'Editar nome' : 'Instância não é admin',
                    onPressed: saving ? null : onEditName,
                    icon: Icon(Icons.edit_rounded, color: wa.icon),
                  ),
                ],
              ),
              Center(
                child: Text(
                  count > 0 ? 'Grupo · $count membros' : 'Grupo',
                  style: TextStyle(color: wa.textMuted, fontSize: 15),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _GroupActionCircle(
                    icon: Icons.person_add_alt_1_rounded,
                    label: 'Adicionar',
                    onTap: onAddMember,
                  ),
                  const SizedBox(width: 22),
                  _GroupActionCircle(
                    icon: Icons.search_rounded,
                    label: 'Pesquisar',
                    onTap: onSearchMembers,
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: SelectableText(
                      trimmedDescription.isNotEmpty
                          ? trimmedDescription
                          : 'Sem descrição definida.',
                      style: TextStyle(
                        color: trimmedDescription.isNotEmpty
                            ? wa.textPrimary
                            : wa.textMuted,
                        fontSize: 15.5,
                        height: 1.35,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: canEdit
                        ? 'Editar descrição'
                        : 'Instância não é admin',
                    onPressed: saving ? null : onEditDescription,
                    icon: Icon(Icons.edit_rounded, color: wa.icon),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              if (trimmedInviteLink?.isNotEmpty == true)
                _GroupInfoTile(
                  icon: Icons.link_rounded,
                  title: 'Convidar via link',
                  subtitle: trimmedInviteLink,
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: trimmedInviteLink!));
                    showSuccessToast(context, 'Link do grupo copiado.');
                  },
                ),
              _GroupInfoDivider(),
              _GroupInfoTile(
                icon: Icons.perm_media_outlined,
                title: 'Mídia, links e docs',
                trailing: '$mediaCount',
                thumbnails: const [
                  Icons.gif_box_outlined,
                  Icons.image_outlined,
                ],
                onTap: onOpenMedia,
              ),
              _GroupInfoDivider(),
              _GroupInfoTile(
                icon: Icons.star_border_rounded,
                title: 'Mensagens favoritas',
                onTap: onOpenFavorites,
              ),
              _GroupInfoTile(
                icon: Icons.notifications_none_rounded,
                title: 'Configurações de notificação',
                subtitle: muted ? 'Silenciado' : 'Ativas',
                onTap: onOpenNotifications,
              ),
              _GroupInfoTile(
                icon: Icons.lock_outline_rounded,
                title: 'Criptografia',
                subtitle:
                    'As mensagens são protegidas com a criptografia de ponta a ponta.',
              ),
              _GroupInfoTile(
                icon: Icons.timer_outlined,
                title: 'Mensagens temporárias',
                subtitle: 'Configurar duração',
                onTap: onPermissions,
              ),
              _GroupInfoTile(
                icon: Icons.shield_outlined,
                title: 'Privacidade avançada da conversa',
                subtitle: 'Desativada',
                onTap: onPermissions,
              ),
              _GroupInfoTile(
                icon: Icons.settings_outlined,
                title: 'Permissões do grupo',
                onTap: onPermissions,
              ),
              _GroupInfoDivider(),
              _GroupInfoTile(
                icon: Icons.group_add_outlined,
                title: 'Create a similar group',
                subtitle:
                    'Comece com os mesmos membros. Você poderá adicionar ou remover membros.',
                onTap: onCreateSimilarGroup,
              ),
              _GroupInfoDivider(),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      count > 0 ? '$count membros' : 'Membros',
                      style: TextStyle(color: wa.textPrimary, fontSize: 15),
                    ),
                  ),
                  Icon(Icons.search_rounded, color: wa.icon),
                ],
              ),
              const SizedBox(height: 12),
              _GroupInfoTile(
                icon: Icons.person_add_alt_1_rounded,
                title: 'Adicionar membro',
                darkIcon: true,
                onTap: onAddMember,
              ),
              if (trimmedInviteLink?.isNotEmpty == true)
                _GroupInfoTile(
                  icon: Icons.link_rounded,
                  title: 'Convidar via link',
                  darkIcon: true,
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: trimmedInviteLink!));
                    showSuccessToast(context, 'Link do grupo copiado.');
                  },
                ),
              if (loadingParticipants)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Center(child: CircularProgressIndicator()),
                )
              else
                for (final participant in previewParticipants)
                  _GroupParticipantTile(
                    participant: participant,
                    onAction: onParticipantAction,
                  ),
              if (count > previewParticipants.length)
                InkWell(
                  onTap: onSearchMembers,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      'Ver tudo (mais ${count - previewParticipants.length})',
                      style: TextStyle(color: wa.textPrimary, fontSize: 16),
                    ),
                  ),
                ),
              _GroupInfoDivider(),
              _GroupInfoTile(
                icon: Icons.list_alt_rounded,
                title: 'Mostrar mudanças de membros',
                onTap: onShowMemberChanges,
              ),
              _GroupInfoTile(
                icon: Icons.favorite_border_rounded,
                title: pinned
                    ? 'Remover dos Favoritos'
                    : 'Adicionar aos Favoritos',
                onTap: onFavorite,
              ),
              _GroupInfoTile(
                icon: Icons.contacts_outlined,
                title: 'Adicionar à lista',
                onTap: onAddToList,
              ),
              _GroupDangerTile(
                icon: Icons.cleaning_services_outlined,
                title: 'Limpar conversa',
                onTap: onClearConversation,
              ),
              _GroupDangerTile(
                icon: Icons.logout_rounded,
                title: 'Sair do grupo',
                onTap: onLeaveGroup,
              ),
              _GroupDangerTile(
                icon: Icons.thumb_down_alt_outlined,
                title: 'Denunciar grupo',
                onTap: onReportGroup,
              ),
              const SizedBox(height: 16),
              if (saving)
                const Center(child: CircularProgressIndicator(strokeWidth: 2)),
            ],
          ),
        ),
      ],
    );
  }
}

class _GroupPermissionsPane extends StatelessWidget {
  const _GroupPermissionsPane({
    required this.adminsOnly,
    required this.locked,
    required this.ephemeral,
    required this.instanceIsAdmin,
    required this.participants,
    required this.saving,
    required this.onBack,
    required this.onAdminsOnlyChanged,
    required this.onLockedChanged,
    required this.onEphemeralChanged,
  });

  final bool adminsOnly;
  final bool locked;
  final String ephemeral;
  final bool? instanceIsAdmin;
  final List<_GroupInfoParticipant> participants;
  final bool saving;
  final VoidCallback onBack;
  final ValueChanged<bool> onAdminsOnlyChanged;
  final ValueChanged<bool> onLockedChanged;
  final ValueChanged<String> onEphemeralChanged;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final admins = participants.where((entry) => entry.isAdmin).toList();
    return Column(
      children: [
        _GroupInfoHeader(title: 'Permissões do grupo', onBack: onBack),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(28, 22, 28, 30),
            children: [
              Text(
                'Os membros do grupo podem:',
                style: TextStyle(color: wa.textMuted, fontSize: 16),
              ),
              const SizedBox(height: 12),
              _GroupPermissionSwitch(
                icon: Icons.edit_outlined,
                title: 'Editar configurações do grupo',
                subtitle:
                    'Essa opção inclui nome, imagem, descrição, duração das mensagens temporárias, fixar mensagens e salvar mensagens.',
                value: !(instanceIsAdmin == false),
                enabled: false,
                onChanged: (_) {},
              ),
              _GroupPermissionSwitch(
                icon: Icons.message_outlined,
                title: 'Enviar novas mensagens',
                value: !adminsOnly,
                enabled: !saving,
                onChanged: (value) => onAdminsOnlyChanged(!value),
              ),
              _GroupPermissionSwitch(
                icon: Icons.group_add_outlined,
                title: 'Adicionar membros',
                value: false,
                enabled: false,
                onChanged: (_) {},
              ),
              const SizedBox(height: 20),
              Text(
                'Os admins do grupo podem:',
                style: TextStyle(color: wa.textMuted, fontSize: 16),
              ),
              const SizedBox(height: 12),
              _GroupPermissionSwitch(
                icon: Icons.how_to_reg_outlined,
                title: 'Aprovar novos membros',
                subtitle:
                    'Enquanto essa opção estiver ativada, os admins deverão aprovar a entrada de membros no grupo.',
                value: false,
                enabled: false,
                onChanged: (_) {},
              ),
              _GroupInfoTile(
                icon: Icons.timer_outlined,
                title: 'Mensagens temporárias',
                subtitle: _groupEphemeralLabel(ephemeral),
                onTap: () => _openEphemeralPicker(context),
              ),
              const SizedBox(height: 20),
              Text(
                'Admins do grupo',
                style: TextStyle(color: wa.textMuted, fontSize: 16),
              ),
              const SizedBox(height: 10),
              _GroupInfoTile(
                icon: Icons.manage_accounts_outlined,
                title: 'Editar admins do grupo',
                subtitle: admins.isEmpty
                    ? 'Admins serão carregados quando a API retornar a lista.'
                    : admins.take(4).map((entry) => entry.label).join(', '),
              ),
              _GroupPermissionSwitch(
                icon: Icons.lock_outline_rounded,
                title: 'Editar dados bloqueado',
                subtitle:
                    'Quando ativo, mantém a edição de dados restrita conforme a configuração do grupo.',
                value: locked,
                enabled: !saving,
                onChanged: onLockedChanged,
              ),
              if (saving)
                const Padding(
                  padding: EdgeInsets.only(top: 20),
                  child: Center(
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  void _openEphemeralPicker(BuildContext context) {
    showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final option in const [
              ('off', 'Desativadas'),
              ('24h', '24 horas'),
              ('7d', '7 dias'),
              ('90d', '90 dias'),
            ])
              ListTile(
                title: Text(option.$2),
                trailing: ephemeral == option.$1
                    ? const Icon(Icons.check_rounded)
                    : null,
                onTap: () {
                  Navigator.of(context).pop();
                  onEphemeralChanged(option.$1);
                },
              ),
          ],
        ),
      ),
    );
  }
}

String _groupEphemeralLabel(String value) {
  return switch (value) {
    '24h' => '24 horas',
    '7d' => '7 dias',
    '90d' => '90 dias',
    _ => 'Desativadas',
  };
}

class _GroupInfoHeader extends StatelessWidget {
  const _GroupInfoHeader({required this.title, required this.onBack});

  final String title;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: wa.panel,
      child: Container(
        height: 64,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: wa.divider, width: 0.8)),
        ),
        child: Row(
          children: [
            IconButton(
              onPressed: onBack,
              icon: Icon(Icons.close_rounded, color: wa.icon, size: 28),
              tooltip: 'Fechar',
            ),
            const SizedBox(width: 8),
            Text(
              title,
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GroupInfoTile extends StatelessWidget {
  const _GroupInfoTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.thumbnails = const [],
    this.darkIcon = false,
    this.destructive = false,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final String? trailing;
  final List<IconData> thumbnails;
  final bool darkIcon;
  final bool destructive;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final titleColor = destructive ? const Color(0xFFB42318) : wa.textPrimary;
    final iconColor = destructive ? const Color(0xFFB42318) : wa.icon;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 11),
          child: Row(
            crossAxisAlignment: thumbnails.isEmpty
                ? CrossAxisAlignment.center
                : CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: darkIcon ? 22 : 18,
                backgroundColor: darkIcon ? Colors.black : Colors.transparent,
                child: Icon(
                  icon,
                  color: darkIcon ? Colors.white : iconColor,
                  size: darkIcon ? 22 : 24,
                ),
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            style: TextStyle(
                              color: titleColor,
                              fontSize: 16.5,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ),
                        if (trailing != null)
                          Text(
                            trailing!,
                            style: TextStyle(color: wa.textMuted, fontSize: 14),
                          ),
                      ],
                    ),
                    if (subtitle?.isNotEmpty == true) ...[
                      const SizedBox(height: 3),
                      Text(
                        subtitle!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textMuted,
                          fontSize: 14,
                          height: 1.3,
                        ),
                      ),
                    ],
                    if (thumbnails.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          for (final thumb in thumbnails)
                            Container(
                              width: 72,
                              height: 56,
                              margin: const EdgeInsets.only(right: 8),
                              decoration: BoxDecoration(
                                color: wa.searchBg,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Icon(thumb, color: wa.icon),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GroupPermissionSwitch extends StatelessWidget {
  const _GroupPermissionSwitch({
    required this.icon,
    required this.title,
    required this.value,
    required this.onChanged,
    this.subtitle,
    this.enabled = true,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: wa.icon, size: 24),
          const SizedBox(width: 22),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(color: wa.textPrimary, fontSize: 16.5),
                ),
                if (subtitle?.isNotEmpty == true) ...[
                  const SizedBox(height: 4),
                  Text(
                    subtitle!,
                    style: TextStyle(
                      color: wa.textMuted,
                      fontSize: 14,
                      height: 1.35,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Switch.adaptive(
            value: value,
            onChanged: enabled ? onChanged : null,
            activeTrackColor: Colors.black,
            activeThumbColor: Colors.white,
          ),
        ],
      ),
    );
  }
}

class _GroupParticipantTile extends StatelessWidget {
  const _GroupParticipantTile({
    required this.participant,
    required this.onAction,
  });

  final _GroupInfoParticipant participant;
  final void Function(_GroupInfoParticipant participant, String action)
  onAction;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openParticipantActions(context),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 9),
          child: Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: wa.avatarFallback,
                child: Icon(Icons.person_rounded, color: wa.icon),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      participant.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: wa.textPrimary, fontSize: 16),
                    ),
                    if (participant.subtitle.isNotEmpty)
                      Text(
                        participant.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: wa.textMuted, fontSize: 13.5),
                      ),
                  ],
                ),
              ),
              if (participant.isAdmin)
                Text(
                  'admin',
                  style: TextStyle(
                    color: wa.accent,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              Icon(Icons.chevron_right_rounded, color: wa.icon),
            ],
          ),
        ),
      ),
    );
  }

  void _openParticipantActions(BuildContext context) {
    showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.chat_rounded),
              title: const Text('Iniciar conversa'),
              subtitle: Text(participant.subtitle),
              onTap: () {
                Navigator.of(context).pop();
                onAction(participant, 'chat');
              },
            ),
            ListTile(
              leading: const Icon(Icons.warning_amber_rounded),
              title: const Text('Advertir'),
              onTap: () {
                Navigator.of(context).pop();
                onAction(participant, 'warn');
              },
            ),
            ListTile(
              leading: const Icon(Icons.block_rounded),
              title: const Text('Resetar advertências'),
              onTap: () {
                Navigator.of(context).pop();
                onAction(participant, 'resetInfractions');
              },
            ),
            ListTile(
              leading: Icon(
                participant.isAdmin
                    ? Icons.admin_panel_settings_outlined
                    : Icons.admin_panel_settings_rounded,
              ),
              title: Text(
                participant.isAdmin ? 'Remover admin' : 'Promover admin',
              ),
              onTap: () {
                Navigator.of(context).pop();
                onAction(
                  participant,
                  participant.isAdmin ? 'demote' : 'promote',
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.person_remove_alt_1_outlined),
              title: const Text('Remover do grupo'),
              textColor: const Color(0xFFB42318),
              iconColor: const Color(0xFFB42318),
              onTap: () {
                Navigator.of(context).pop();
                onAction(participant, 'remove');
              },
            ),
            ListTile(
              leading: const Icon(Icons.no_accounts_outlined),
              title: const Text('Blacklist e remover'),
              textColor: const Color(0xFFB42318),
              iconColor: const Color(0xFFB42318),
              onTap: () {
                Navigator.of(context).pop();
                onAction(participant, 'blacklist');
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _GroupMembersDialog extends StatefulWidget {
  const _GroupMembersDialog({
    required this.participants,
    required this.onAction,
  });

  final List<_GroupInfoParticipant> participants;
  final void Function(_GroupInfoParticipant participant, String action)
  onAction;

  @override
  State<_GroupMembersDialog> createState() => _GroupMembersDialogState();
}

class _GroupMembersDialogState extends State<_GroupMembersDialog> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final query = _search.text.trim().toLowerCase();
    final items = query.isEmpty
        ? widget.participants
        : widget.participants
              .where(
                (entry) =>
                    entry.label.toLowerCase().contains(query) ||
                    entry.subtitle.toLowerCase().contains(query) ||
                    entry.jid.toLowerCase().contains(query),
              )
              .toList(growable: false);
    return Dialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      child: SizedBox(
        width: 430,
        height: 620,
        child: Column(
          children: [
            _GroupInfoHeader(
              title: '${widget.participants.length} membros',
              onBack: () => Navigator.of(context).pop(),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
              child: TextField(
                controller: _search,
                autofocus: true,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'Pesquisar membro',
                  prefixIcon: const Icon(Icons.search_rounded),
                  filled: true,
                  fillColor: wa.searchBg,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(22),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            Expanded(
              child: items.isEmpty
                  ? Center(
                      child: Text(
                        'Nenhum membro encontrado.',
                        style: TextStyle(color: wa.textMuted),
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(18, 4, 18, 20),
                      itemCount: items.length,
                      itemBuilder: (context, index) => _GroupParticipantTile(
                        participant: items[index],
                        onAction: widget.onAction,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GroupMediaDialog extends StatelessWidget {
  const _GroupMediaDialog({required this.messages});

  final List<ChatMessage> messages;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final media =
        messages.where((message) => message.hasRenderableMedia).toList()
          ..sort((a, b) => b.timestamp.compareTo(a.timestamp));
    return Dialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      child: SizedBox(
        width: 520,
        height: 620,
        child: Column(
          children: [
            _GroupInfoHeader(
              title: 'Mídia, links e docs',
              onBack: () => Navigator.of(context).pop(),
            ),
            Expanded(
              child: media.isEmpty
                  ? Center(
                      child: Text(
                        'Nenhuma mídia carregada nesta conversa.',
                        style: TextStyle(color: wa.textMuted),
                      ),
                    )
                  : GridView.builder(
                      padding: const EdgeInsets.all(14),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 3,
                            mainAxisSpacing: 10,
                            crossAxisSpacing: 10,
                          ),
                      itemCount: media.length,
                      itemBuilder: (context, index) {
                        final message = media[index];
                        final imageUrl = _absoluteMediaUrl(
                          message.mediaThumbnailUrl ?? message.mediaUrl,
                        );
                        final type = message.normalizedType;
                        final isVisual =
                            type == 'image' ||
                            type == 'sticker' ||
                            type == 'video';
                        return DecoratedBox(
                          decoration: BoxDecoration(
                            color: wa.searchBg,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: isVisual && imageUrl != null
                                ? BotAdminCachedImage(
                                    imageUrl: imageUrl,
                                    fit: BoxFit.cover,
                                    errorWidget: (context, error, stackTrace) =>
                                        _GroupMediaIcon(type: type),
                                  )
                                : _GroupMediaIcon(type: type),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GroupMediaIcon extends StatelessWidget {
  const _GroupMediaIcon({required this.type});

  final String type;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final icon = switch (type) {
      'video' => Icons.play_circle_outline_rounded,
      'audio' => Icons.graphic_eq_rounded,
      'document' => Icons.description_outlined,
      'sticker' => Icons.sticky_note_2_outlined,
      _ => Icons.image_outlined,
    };
    return Center(child: Icon(icon, color: wa.icon, size: 34));
  }
}

class _GroupNotificationDialog extends StatelessWidget {
  const _GroupNotificationDialog({required this.muted, this.onToggleMute});

  final bool muted;
  final Future<void> Function()? onToggleMute;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return AlertDialog(
      title: const Text('Configurações de notificação'),
      content: Text(
        muted
            ? 'Esta conversa está silenciada.'
            : 'As notificações desta conversa estão ativas.',
        style: TextStyle(color: wa.textSecondary),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Fechar'),
        ),
        if (onToggleMute != null)
          FilledButton(
            onPressed: () {
              Navigator.of(context).pop();
              unawaited(onToggleMute!());
            },
            child: Text(muted ? 'Ativar' : 'Silenciar'),
          ),
      ],
    );
  }
}

class _GroupSimpleInfoDialog extends StatelessWidget {
  const _GroupSimpleInfoDialog({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Fechar'),
        ),
      ],
    );
  }
}

class _GroupActionCircle extends StatelessWidget {
  const _GroupActionCircle({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Column(
      children: [
        Material(
          color: wa.searchBg,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 58,
              height: 58,
              child: Icon(icon, color: wa.textPrimary),
            ),
          ),
        ),
        const SizedBox(height: 7),
        Text(label, style: TextStyle(color: wa.textPrimary, fontSize: 13)),
      ],
    );
  }
}

class _GroupRoundIconButton extends StatelessWidget {
  const _GroupRoundIconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: const Color(0xFFE7FCEB),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 42,
            height: 42,
            child: Icon(icon, color: const Color(0xFF008069)),
          ),
        ),
      ),
    );
  }
}

class _GroupDangerTile extends StatelessWidget {
  const _GroupDangerTile({required this.icon, required this.title, this.onTap});

  final IconData icon;
  final String title;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return _GroupInfoTile(
      icon: icon,
      title: title,
      destructive: true,
      onTap: onTap,
    );
  }
}

class _GroupInfoDivider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Divider(height: 28, color: WaTheme.of(context).divider);
  }
}

class _GroupInfoParticipant {
  const _GroupInfoParticipant({
    required this.jid,
    required this.label,
    required this.subtitle,
    required this.isAdmin,
  });

  final String jid;
  final String label;
  final String subtitle;
  final bool isAdmin;

  factory _GroupInfoParticipant.fromJson(Map<String, dynamic> json) {
    final jid =
        (json['jid'] ??
                json['id'] ??
                json['participantJid'] ??
                json['memberJid'] ??
                '')
            .toString()
            .trim();
    final name =
        (json['name'] ??
                json['pushName'] ??
                json['displayName'] ??
                json['notifyName'] ??
                '')
            .toString()
            .trim();
    final phone = _phoneFromJid(jid);
    final admin = json['admin'];
    final isAdmin =
        admin == true ||
        admin == 'admin' ||
        admin == 'superadmin' ||
        json['isAdmin'] == true;
    return _GroupInfoParticipant(
      jid: jid,
      label: name.isNotEmpty ? name : (phone.isNotEmpty ? '+$phone' : jid),
      subtitle: phone.isNotEmpty ? '+$phone' : jid,
      isAdmin: isAdmin,
    );
  }
}

String _phoneFromJid(String jid) {
  final local = jid.trim().split('@').first.split(':').first;
  final digits = local.replaceAll(RegExp(r'\D+'), '');
  return digits.length >= 8 ? digits : '';
}

Future<String?> _showGroupTextEditor(
  BuildContext context, {
  required String title,
  required String initialValue,
  required int maxLines,
  String? hintText,
}) {
  final controller = TextEditingController(text: initialValue);
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        maxLines: maxLines,
        textInputAction: maxLines == 1 ? TextInputAction.done : null,
        onSubmitted: maxLines == 1
            ? (_) => Navigator.of(context).pop(controller.text.trim())
            : null,
        decoration: InputDecoration(
          hintText: hintText,
          border: const OutlineInputBorder(),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          child: const Text('Salvar'),
        ),
      ],
    ),
  ).whenComplete(controller.dispose);
}

Future<bool> _confirmGroupInfoAction(
  BuildContext context, {
  required String title,
  required String content,
  required String confirmLabel,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(content),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFB42318),
          ),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return confirmed == true;
}

String? _threadPhoneDisplay(ConversationThread thread) {
  final saved = thread.phone?.trim();
  if (saved != null && saved.isNotEmpty) {
    return '+${saved.replaceAll(RegExp(r'^\++'), '')}';
  }
  if (!thread.isContact) return null;
  final local = thread.chatJid.split('@').first.split(':').first;
  final digits = local.replaceAll(RegExp(r'\D+'), '');
  if (digits.length < 10 || digits.length > 13) return null;
  return '+$digits';
}

class _ThreadInfoChip extends StatelessWidget {
  const _ThreadInfoChip({
    required this.icon,
    required this.label,
    required this.active,
  });

  final IconData icon;
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: active ? wa.accentSoft : wa.noticeBg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: active ? wa.accent : wa.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 17, color: active ? wa.accent : wa.icon),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: active ? wa.accent : wa.textSecondary,
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

class _AddToListButton extends StatelessWidget {
  const _AddToListButton({this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed:
          onPressed ??
          () => showSuccessToast(context, 'Abra Ferramentas para ver fluxos.'),
      icon: Icon(Icons.contacts_outlined, size: 20),
      label: Text('Adicionar à lista'),
      style: OutlinedButton.styleFrom(
        foregroundColor: WaTheme.of(context).textPrimary,
        side: const BorderSide(color: Color(0xFFD1D7DB)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        padding: const EdgeInsets.fromLTRB(18, 12, 14, 12),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    );
  }
}

class _CallHeaderMenu extends StatelessWidget {
  const _CallHeaderMenu({
    required this.enabled,
    required this.onStartCall,
    this.onOpenCalls,
  });

  final bool enabled;
  final Future<void> Function(bool video) onStartCall;
  final VoidCallback? onOpenCalls;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Chamadas',
      enabled: enabled || onOpenCalls != null,
      icon: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.videocam_outlined, color: WaTheme.of(context).textPrimary),
          Icon(
            Icons.arrow_drop_down_rounded,
            size: 18,
            color: WaTheme.of(context).textPrimary,
          ),
        ],
      ),
      onSelected: (value) {
        switch (value) {
          case 'voice':
            onStartCall(false);
            break;
          case 'video':
            onStartCall(true);
            break;
          case 'panel':
            onOpenCalls?.call();
            break;
        }
      },
      itemBuilder: (context) => [
        PopupMenuItem<String>(
          value: 'voice',
          enabled: enabled,
          child: ListTile(
            leading: Icon(Icons.call_rounded),
            title: Text('Iniciar chamada'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        PopupMenuItem<String>(
          value: 'video',
          enabled: enabled,
          child: ListTile(
            leading: Icon(Icons.videocam_rounded),
            title: Text('Iniciar video'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        const PopupMenuDivider(),
        PopupMenuItem<String>(
          value: 'panel',
          enabled: onOpenCalls != null,
          child: ListTile(
            leading: Icon(Icons.call_made_rounded),
            title: Text('Abrir chamadas'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
      ],
    );
  }
}

class _SwipeReplyBubble extends StatefulWidget {
  const _SwipeReplyBubble({
    required this.child,
    required this.onReply,
    this.enabled = true,
  });

  final Widget child;
  final VoidCallback onReply;
  final bool enabled;

  @override
  State<_SwipeReplyBubble> createState() => _SwipeReplyBubbleState();
}

class _SwipeReplyBubbleState extends State<_SwipeReplyBubble> {
  double _drag = 0;
  bool _replyTriggered = false;

  @override
  Widget build(BuildContext context) {
    final progress = (_drag / 86).clamp(0.0, 1.0);
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onHorizontalDragUpdate: widget.enabled
          ? (details) {
              final next = (_drag + details.delta.dx).clamp(0.0, 104.0);
              if (mounted) setState(() => _drag = next);
            }
          : null,
      onHorizontalDragEnd: widget.enabled
          ? (_) {
              if (_drag >= 58 && !_replyTriggered) {
                _replyTriggered = true;
                HapticFeedback.lightImpact();
                widget.onReply();
              }
              if (mounted) {
                setState(() {
                  _drag = 0;
                  _replyTriggered = false;
                });
              }
            }
          : null,
      onHorizontalDragCancel: widget.enabled
          ? () => setState(() => _drag = 0)
          : null,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          if (_drag > 8)
            Positioned(
              // Mantém o indicador dentro da área do item (listas Flutter
              // costumam recortar o conteúdo que fica fora do balão).
              left: 3,
              top: 0,
              width: 30,
              height: 30,
              child: Opacity(
                opacity: progress,
                child: Transform.scale(
                  scale: 0.72 + (progress * 0.28),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: WaTheme.of(context).accentSoft,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.reply_rounded,
                      color: WaTheme.of(context).accent,
                      size: 18,
                    ),
                  ),
                ),
              ),
            ),
          Transform.translate(offset: Offset(_drag, 0), child: widget.child),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.thread,
    required this.message,
    required this.viewportWidth,
    this.group,
    this.onOpenContact,
    this.mentionTargets = const {},
    this.onOpenMention,
    this.onOpenParticipantConversation,
    this.onOpenReceiptDetails,
    this.onRetry,
    required this.onReply,
    required this.onRunMessageAction,
    required this.onToggleDeletedReveal,
  });

  final ConversationThread thread;
  final ChatMessage message;
  final double viewportWidth;
  final BotGroup? group;
  final void Function(ChatContactCard contact)? onOpenContact;
  final Map<String, String> mentionTargets;
  final void Function(String jid, String displayName)? onOpenMention;
  final void Function(String jid, String displayName)?
  onOpenParticipantConversation;
  final Future<void> Function(ChatMessage message)? onOpenReceiptDetails;
  final Future<void> Function(ChatMessage message)? onRetry;
  final VoidCallback onReply;
  final Future<void> Function(
    ChatMessage message,
    String action,
    Map<String, Object?> data,
  )
  onRunMessageAction;
  final Future<void> Function(ChatMessage message, bool reveal)
  onToggleDeletedReveal;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    if (message.normalizedType == 'system') {
      return _SystemMessageNotice(message: message);
    }
    final align = message.fromMe ? Alignment.centerRight : Alignment.centerLeft;
    final color = message.fromMe ? wa.bubbleOut : wa.bubbleIn;
    final time = DateFormat('HH:mm').format(message.timestamp.toLocal());
    final hasReactions = message.reactions.isNotEmpty;
    final hideDeletedContent = message.shouldHideDeletedContent;
    final kind = _mediaKind(message);
    final mediaOwnsText =
        kind == 'interactive' ||
        kind == 'poll' ||
        kind == 'contact' ||
        kind == 'location';
    final hasMedia =
        message.hasRenderableMedia &&
        !message.isReaction &&
        !hideDeletedContent;
    final hasDisplayText =
        message.hasDisplayText && !hideDeletedContent && !mediaOwnsText;
    final hasQuoted = message.quoted != null && !hideDeletedContent;
    final hasContent = hasDisplayText || hasMedia || hasQuoted;
    final stickerOnly =
        kind == 'sticker' && !message.hasDisplayText && message.quoted == null;
    final isInboundGroup = thread.isGroup && !message.fromMe;
    final showSenderIdentity = isInboundGroup && !message.isReaction;
    final compactStickerOnly = stickerOnly && !showSenderIdentity;
    final maxBubbleWidth = _messageBubbleMaxWidth(
      viewportWidth,
      stickerOnly: compactStickerOnly,
      includesSenderAvatar: isInboundGroup,
    );
    final preferredBubbleWidth = _messageBubblePreferredWidth(
      context,
      message,
      maxBubbleWidth: maxBubbleWidth,
      compactStickerOnly: compactStickerOnly,
      showSenderIdentity: showSenderIdentity,
      hasDisplayText: hasDisplayText,
      hasMedia: hasMedia,
      hasQuoted: hasQuoted,
      hideDeletedContent: hideDeletedContent,
      mediaKind: kind,
    );
    final interactiveBubbleWidth = math.min(
      preferredBubbleWidth,
      math.min(maxBubbleWidth, viewportWidth < 620 ? 292.0 : 380.0),
    );
    final bubble = AnimatedOpacity(
      duration: const Duration(milliseconds: 160),
      opacity: message.localStatus == MessageLocalStatus.pending ? 0.9 : 1,
      child:
          kind == 'interactive' &&
              !hideDeletedContent &&
              // Legacy !play download replies can retain the interactive
              // envelope from the button click. Their actual payload is
              // media (quoted action + title), so route it through
              // _MediaPreview instead of rendering a grey header card.
              !_looksLikePlayDownload(message)
          ? SizedBox(
              width: interactiveBubbleWidth,
              child: _InteractiveBubble(
                message: message,
                width: interactiveBubbleWidth,
                backgroundColor: color,
                time: time,
                showSenderIdentity: showSenderIdentity,
                onOpenParticipant: () => _openParticipantActions(context),
                onHideDeleted: () => onToggleDeletedReveal(message, false),
                onRunMessageAction: (action, data) =>
                    onRunMessageAction(message, action, data),
              ),
            )
          : kind == 'poll' && !hideDeletedContent
          ? SizedBox(
              width: preferredBubbleWidth,
              child: _PollBubble(
                message: message,
                width: preferredBubbleWidth,
                backgroundColor: color,
                time: time,
                showSenderIdentity: showSenderIdentity,
                onOpenParticipant: () => _openParticipantActions(context),
                onRunMessageAction: (action, data) =>
                    onRunMessageAction(message, action, data),
              ),
            )
          : kind == 'contact' && !hideDeletedContent
          ? SizedBox(
              width: preferredBubbleWidth,
              child: _ContactBubble(
                message: message,
                width: preferredBubbleWidth,
                backgroundColor: color,
                time: time,
                showSenderIdentity: showSenderIdentity,
                onOpenParticipant: () => _openParticipantActions(context),
                onOpenContact: onOpenContact,
              ),
            )
          : kind == 'location' && !hideDeletedContent
          ? SizedBox(
              width: preferredBubbleWidth,
              child: _LocationBubble(
                message: message,
                width: preferredBubbleWidth,
                backgroundColor: color,
                time: time,
                showSenderIdentity: showSenderIdentity,
                onOpenParticipant: () => _openParticipantActions(context),
              ),
            )
          : Container(
              width: preferredBubbleWidth,
              constraints: BoxConstraints(maxWidth: maxBubbleWidth),
              padding: EdgeInsets.fromLTRB(
                compactStickerOnly ? 5 : 9,
                compactStickerOnly ? 5 : 6,
                compactStickerOnly ? 5 : 8,
                5,
              ),
              decoration: compactStickerOnly
                  ? null
                  : BoxDecoration(
                      color: color,
                      borderRadius: BorderRadius.only(
                        topLeft: Radius.circular(message.fromMe ? 10 : 2),
                        topRight: Radius.circular(message.fromMe ? 2 : 10),
                        bottomLeft: const Radius.circular(10),
                        bottomRight: const Radius.circular(10),
                      ),
                      border: message.localStatus == MessageLocalStatus.failed
                          ? Border.all(color: const Color(0x55EA0038))
                          : null,
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x14000000),
                          blurRadius: 1,
                          offset: Offset(0, 1),
                        ),
                      ],
                    ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (showSenderIdentity)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: _ParticipantIdentityHeader(
                        message: message,
                        onTap: () => _openParticipantActions(context),
                      ),
                    ),
                  if (message.isDeleted && message.revealDeletedContent)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: _DeletedMessageBanner(
                        deletedByName: message.deletedByName,
                        onHide: () => onToggleDeletedReveal(message, false),
                      ),
                    ),
                  if (message.quoted != null && !hideDeletedContent)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: _QuotedPreview(quoted: message.quoted!),
                    ),
                  if (hideDeletedContent)
                    _DeletedMessageNotice(
                      label: message.deletedDisplayText,
                      onReveal: message.canRevealDeletedContent
                          ? () => onToggleDeletedReveal(message, true)
                          : null,
                    ),
                  if (hasMedia)
                    Padding(
                      padding: EdgeInsets.only(bottom: hasDisplayText ? 6 : 0),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxHeight: math.min(
                            360,
                            MediaQuery.sizeOf(context).height * 0.44,
                          ),
                        ),
                        child: _MediaPreview(
                          message: message,
                          onRunMessageAction: (action, data) =>
                              onRunMessageAction(message, action, data),
                        ),
                      ),
                    ),
                  if (hasDisplayText)
                    _LinkifiedMessageText(
                      text: message.displayText,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.25,
                        color: wa.bubbleText,
                        fontFamily: 'Roboto',
                        letterSpacing: 0,
                        wordSpacing: 0,
                      ),
                      linkColor: message.fromMe
                          ? (wa.isDark
                                ? const Color(0xFF53BDEB)
                                : const Color(0xFF027EB5))
                          : (wa.isDark
                                ? const Color(0xFF53BDEB)
                                : const Color(0xFF027EB5)),
                      mentionTargets: mentionTargets,
                      onMentionTap: onOpenMention,
                    )
                  else if (!hasContent && !hideDeletedContent)
                    Text(
                      message.unavailableDisplayText.isNotEmpty
                          ? message.unavailableDisplayText
                          : 'Conteúdo não compatível',
                      style: TextStyle(color: wa.bubbleMeta),
                    ),
                  if (!compactStickerOnly ||
                      hasDisplayText ||
                      hideDeletedContent)
                    SizedBox(height: 3),
                  Align(
                    alignment: Alignment.centerRight,
                    child: _MessageMeta(
                      time: time,
                      fromMe: message.fromMe,
                      localStatus: message.localStatus,
                      message: message,
                      onTap:
                          onOpenReceiptDetails != null &&
                              (message.fromMe ||
                                  (thread.isInternalGroup &&
                                      thread.instanceIsAdmin == true))
                          ? () => unawaited(onOpenReceiptDetails!(message))
                          : null,
                      onRetry: message.localStatus == MessageLocalStatus.failed
                          ? () => unawaited(onRetry?.call(message))
                          : null,
                    ),
                  ),
                ],
              ),
            ),
    );

    final bubbleWithActions = _BubbleWithHoverActions(
      compactStickerOnly: compactStickerOnly,
      bubble: bubble,
      message: message,
      onRunMessageAction: (action, data) =>
          onRunMessageAction(message, action, data),
      onToggleDeletedReveal: (reveal) => onToggleDeletedReveal(message, reveal),
      canDelete:
          message.fromMe ||
          (thread.isInternalGroup && thread.instanceIsAdmin == true),
      canEdit: thread.isInternalGroup && message.fromMe && !message.isDeleted,
      canPin: !thread.isInternalGroup || thread.instanceIsAdmin == true,
      canRevealDeleted:
          !thread.isInternalGroup || message.canRevealDeletedContent,
      onOpenReceiptDetails:
          (message.fromMe ||
              (thread.isInternalGroup && thread.instanceIsAdmin == true))
          ? onOpenReceiptDetails
          : null,
      actionsButton: _MessageActionsButton(
        message: message,
        canDelete:
            message.fromMe ||
            (thread.isInternalGroup && thread.instanceIsAdmin == true),
        canEdit: thread.isInternalGroup && message.fromMe && !message.isDeleted,
        canPin: !thread.isInternalGroup || thread.instanceIsAdmin == true,
        canRevealDeleted:
            !thread.isInternalGroup || message.canRevealDeletedContent,
        onOpenReceiptDetails:
            (message.fromMe ||
                (thread.isInternalGroup && thread.instanceIsAdmin == true))
            ? onOpenReceiptDetails
            : null,
        onRunMessageAction: (action, data) =>
            onRunMessageAction(message, action, data),
        onToggleDeletedReveal: (reveal) =>
            onToggleDeletedReveal(message, reveal),
      ),
    );

    // WhatsApp: chip de reações sobre a borda inferior do balão.
    // Entrada (esquerda) → canto inferior direito; saída (direita) → canto inferior esquerdo.
    final stackedBubble = Stack(
      clipBehavior: Clip.none,
      children: [
        Padding(
          padding: EdgeInsets.only(bottom: hasReactions ? 8 : 0),
          child: bubbleWithActions,
        ),
        if (hasReactions)
          Positioned(
            bottom: 0,
            left: message.fromMe ? 8 : null,
            right: message.fromMe ? null : 8,
            child: _ReactionCluster(reactions: message.reactions),
          ),
      ],
    );

    final swipeable = _SwipeReplyBubble(
      onReply: onReply,
      enabled: !message.isReaction,
      child: stackedBubble,
    );

    if (isInboundGroup) {
      return Align(
        alignment: Alignment.centerLeft,
        child: Container(
          margin: EdgeInsets.only(bottom: hasReactions ? 10 : 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ParticipantAvatar(
                message: message,
                radius: 18,
                onTap: () => _openParticipantActions(context),
              ),
              const SizedBox(width: 7),
              Flexible(child: swipeable),
            ],
          ),
        ),
      );
    }

    return Align(
      alignment: align,
      child: Container(
        margin: EdgeInsets.only(bottom: hasReactions ? 10 : 4),
        child: swipeable,
      ),
    );
  }

  void _openParticipantActions(BuildContext context) {
    final jid = message.senderJid?.trim() ?? '';
    if (jid.isEmpty) {
      showSuccessToast(
        context,
        'Esta mensagem não trouxe o número do participante.',
      );
      return;
    }
    showBotAdminBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: WaTheme.of(context).panel,
      builder: (context) => _ParticipantActionsSheet(
        thread: thread,
        group: group,
        message: message,
        onOpenConversation: onOpenParticipantConversation,
      ),
    );
  }
}

bool _realtimeEventChangesMessages(String? eventType) {
  final normalized = eventType?.trim().toLowerCase() ?? '';
  return normalized == 'conversation.message.upserted' ||
      normalized == 'message.receipt' ||
      normalized == 'conversation.message.deleted' ||
      normalized == 'conversation.message.updated' ||
      normalized == 'conversation.reaction.upserted' ||
      normalized == 'internal-group.message.created' ||
      normalized == 'internal-group.message.receipt' ||
      normalized == 'internal-group.message.deleted' ||
      normalized == 'internal-group.messages.cleared' ||
      normalized == 'internal-group.group.updated' ||
      normalized == 'internal-group.group.deleted' ||
      normalized == 'internal-group.member.updated';
}

class _SystemMessageNotice extends StatelessWidget {
  const _SystemMessageNotice({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final label = message.displayText.trim();
    if (label.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 5),
      child: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 520),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: wa.accentSoft,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: wa.accent.withValues(alpha: .18)),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: wa.textSecondary,
              fontSize: 12.5,
              height: 1.28,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

class _DeletedMessageNotice extends StatelessWidget {
  const _DeletedMessageNotice({required this.label, required this.onReveal});

  final String label;
  final VoidCallback? onReveal;

  @override
  Widget build(BuildContext context) {
    final muted = WaTheme.of(context).textMuted;
    return Semantics(
      button: onReveal != null,
      label: onReveal == null ? 'Mensagem apagada' : 'Revelar mensagem apagada',
      child: Tooltip(
        message: onReveal == null
            ? 'Mensagem apagada'
            : 'Revelar mensagem apagada',
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onReveal,
            borderRadius: BorderRadius.circular(6),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.visibility_outlined, size: 19, color: muted),
                  const SizedBox(width: 7),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: muted,
                        fontSize: 14.5,
                        fontStyle: FontStyle.italic,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DeletedMessageBanner extends StatelessWidget {
  const _DeletedMessageBanner({this.deletedByName, required this.onHide});

  final String? deletedByName;
  final VoidCallback onHide;

  @override
  Widget build(BuildContext context) {
    final actor = deletedByName?.trim();
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4D6),
        borderRadius: BorderRadius.circular(7),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.visibility_outlined,
              size: 16,
              color: Color(0xFF8A5A00),
            ),
            SizedBox(width: 6),
            Flexible(
              child: Text(
                actor == null || actor.isEmpty
                    ? 'Mensagem apagada revelada'
                    : 'Mensagem apagada por $actor revelada',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF8A5A00),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            TextButton(
              onPressed: onHide,
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                foregroundColor: const Color(0xFF8A5A00),
                textStyle: const TextStyle(fontWeight: FontWeight.w800),
              ),
              child: const Text('Ocultar'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Desktop: arrow only on bubble hover. Mobile: always a discrete corner chevron.
class _BubbleWithHoverActions extends StatefulWidget {
  const _BubbleWithHoverActions({
    required this.bubble,
    required this.actionsButton,
    required this.compactStickerOnly,
    required this.message,
    required this.onRunMessageAction,
    required this.onToggleDeletedReveal,
    required this.canDelete,
    required this.canEdit,
    required this.canPin,
    required this.canRevealDeleted,
    this.onOpenReceiptDetails,
  });

  final Widget bubble;
  final Widget actionsButton;
  final bool compactStickerOnly;
  final ChatMessage message;
  final Future<void> Function(String action, Map<String, Object?> data)
  onRunMessageAction;
  final ValueChanged<bool> onToggleDeletedReveal;
  final bool canDelete;
  final bool canEdit;
  final bool canPin;
  final bool canRevealDeleted;
  final Future<void> Function(ChatMessage message)? onOpenReceiptDetails;

  @override
  State<_BubbleWithHoverActions> createState() =>
      _BubbleWithHoverActionsState();
}

class _BubbleWithHoverActionsState extends State<_BubbleWithHoverActions> {
  bool _hovering = false;
  Timer? _hoverExitTimer;

  @override
  void dispose() {
    _hoverExitTimer?.cancel();
    super.dispose();
  }

  Future<void> _openMenu(Offset globalPosition) {
    return showMessageActionsMenu(
      context: context,
      position: globalPosition,
      message: widget.message,
      onRunMessageAction: widget.onRunMessageAction,
      onToggleDeletedReveal: widget.onToggleDeletedReveal,
      canDelete: widget.canDelete,
      canEdit: widget.canEdit,
      canPin: widget.canPin,
      canRevealDeleted: widget.canRevealDeleted,
      onOpenReceiptDetails: widget.onOpenReceiptDetails == null
          ? null
          : () => widget.onOpenReceiptDetails!(widget.message),
    );
  }

  Future<void> _openReactionPicker(Offset globalPosition) async {
    final emoji = await showReactionPicker(context, position: globalPosition);
    if (!mounted || emoji == null || emoji.trim().isEmpty) return;
    await widget.onRunMessageAction('react', {'emoji': emoji.trim()});
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final isDesktop = width >= 720;
    // No ícone de reação permanente no celular: o seletor aparece ao segurar
    // a mensagem, como no WhatsApp. No desktop ele continua disponível no
    // hover para manter a operação rápida com mouse.
    final showActions = isDesktop && _hovering;
    const reactionGutter = 42.0;
    final bubblePadding = EdgeInsets.only(
      left: widget.message.fromMe ? reactionGutter : 0,
      right: widget.message.fromMe ? 0 : reactionGutter,
    );
    final bubbleActionRight = widget.message.fromMe
        ? 2.0
        : reactionGutter + 2.0;

    return MouseRegion(
      onEnter: isDesktop
          ? (_) {
              _hoverExitTimer?.cancel();
              if (!_hovering) setState(() => _hovering = true);
            }
          : null,
      onExit: isDesktop
          ? (_) {
              _hoverExitTimer?.cancel();
              _hoverExitTimer = Timer(const Duration(milliseconds: 260), () {
                if (mounted) setState(() => _hovering = false);
              });
            }
          : null,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onLongPressEnd: (details) {
          // Abre somente depois que o dedo foi solto. Criar o overlay no
          // início do gesto podia acionar sem querer a linha sob o dedo.
          unawaited(_openMenu(details.globalPosition));
        },
        onSecondaryTapDown: (details) {
          // Desktop: botão direito do mouse.
          unawaited(_openMenu(details.globalPosition));
        },
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Padding(padding: bubblePadding, child: widget.bubble),
            Positioned(
              top: widget.compactStickerOnly ? 0 : 2,
              right: widget.compactStickerOnly
                  ? bubbleActionRight - 2
                  : bubbleActionRight,
              child: AnimatedOpacity(
                opacity: showActions ? 1 : 0,
                duration: const Duration(milliseconds: 120),
                child: IgnorePointer(
                  ignoring: !showActions,
                  child: widget.actionsButton,
                ),
              ),
            ),
            Positioned(
              top: widget.compactStickerOnly ? 24 : 34,
              left: widget.message.fromMe ? 4 : null,
              right: widget.message.fromMe ? null : 4,
              child: AnimatedOpacity(
                opacity: showActions ? 1 : 0,
                duration: const Duration(milliseconds: 120),
                child: IgnorePointer(
                  ignoring: !showActions,
                  child: _InlineReactionButton(
                    onTapDown: (position) =>
                        unawaited(_openReactionPicker(position)),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InlineReactionButton extends StatefulWidget {
  const _InlineReactionButton({required this.onTapDown});

  final ValueChanged<Offset> onTapDown;

  @override
  State<_InlineReactionButton> createState() => _InlineReactionButtonState();
}

class _InlineReactionButtonState extends State<_InlineReactionButton> {
  Offset? _lastTapPosition;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: wa.isDark ? const Color(0xFF233138) : Colors.white,
      elevation: 4,
      shadowColor: Colors.black.withValues(alpha: 0.22),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTapDown: (details) => _lastTapPosition = details.globalPosition,
        onTap: () {
          final box = context.findRenderObject();
          final fallback = box is RenderBox
              ? box.localToGlobal(const Offset(15.5, 15.5))
              : Offset.zero;
          widget.onTapDown(_lastTapPosition ?? fallback);
        },
        child: SizedBox(
          width: 31,
          height: 31,
          child: Icon(
            Icons.add_reaction_outlined,
            size: 20,
            color: wa.isDark
                ? const Color(0xFFD1D7DB)
                : const Color(0xFF667781),
          ),
        ),
      ),
    );
  }
}

Future<void> showMessageActionsMenu({
  required BuildContext context,
  required Offset position,
  required ChatMessage message,
  required Future<void> Function(String action, Map<String, Object?> data)
  onRunMessageAction,
  required ValueChanged<bool> onToggleDeletedReveal,
  required bool canDelete,
  required bool canEdit,
  required bool canPin,
  required bool canRevealDeleted,
  Future<void> Function()? onOpenReceiptDetails,
}) async {
  final wa = WaTheme.of(context);
  final isDark = wa.isDark;
  final barBg = isDark ? const Color(0xFF233138) : Colors.white;
  final moreBg = isDark ? const Color(0xFF2A3942) : const Color(0xFFF0F2F5);
  final moreFg = isDark ? const Color(0xFFAEBAC1) : const Color(0xFF54656F);
  final canReact = !message.shouldHideDeletedContent;

  // Overlay estilo WhatsApp: barra de reações em cima + card de ações.
  final selected = await showGeneralDialog<String>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Fechar ações da mensagem',
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 150),
    pageBuilder: (context, animation, secondaryAnimation) {
      final screen = MediaQuery.sizeOf(context);
      final width = (screen.width - 32).clamp(286.0, 360.0).toDouble();
      return SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
            child: SizedBox(
              width: width,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxWidth: width,
                  maxHeight: math.max(260, screen.height - 72),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (canReact) ...[
                      Material(
                        color: barBg,
                        elevation: 10,
                        shadowColor: Colors.black54,
                        borderRadius: BorderRadius.circular(999),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(8, 7, 8, 7),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              for (final emoji in EmojiCatalog.quickReactions)
                                InkWell(
                                  borderRadius: BorderRadius.circular(999),
                                  onTap: () =>
                                      Navigator.of(context).pop('react:$emoji'),
                                  child: SizedBox(
                                    width: 44,
                                    height: 44,
                                    child: Center(
                                      child: Text(
                                        emoji,
                                        style: emojiTextStyle(28),
                                      ),
                                    ),
                                  ),
                                ),
                              const SizedBox(width: 2),
                              Material(
                                color: moreBg,
                                shape: const CircleBorder(),
                                child: InkWell(
                                  customBorder: const CircleBorder(),
                                  onTap: () =>
                                      Navigator.of(context).pop('react:more'),
                                  child: SizedBox(
                                    width: 40,
                                    height: 40,
                                    child: Icon(
                                      Icons.add_rounded,
                                      color: moreFg,
                                      size: 24,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                    ],
                    Material(
                      color: wa.menuBg,
                      elevation: 12,
                      shadowColor: Colors.black45,
                      borderRadius: BorderRadius.circular(14),
                      clipBehavior: Clip.antiAlias,
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(minWidth: 240),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (message.hasDisplayText &&
                                !message.shouldHideDeletedContent)
                              _waActionRow(
                                icon: Icons.content_copy_rounded,
                                label: 'Copiar',
                                color: wa.textPrimary,
                                onTap: () => Navigator.of(context).pop('copy'),
                              ),
                            if (canEdit)
                              _waActionRow(
                                icon: Icons.edit_outlined,
                                label: message.hasRenderableMedia
                                    ? 'Editar legenda'
                                    : 'Editar mensagem',
                                color: wa.textPrimary,
                                onTap: () => Navigator.of(context).pop('edit'),
                              ),
                            if (message.isDeleted && canRevealDeleted)
                              _waActionRow(
                                icon: message.revealDeletedContent
                                    ? Icons.visibility_off_outlined
                                    : Icons.visibility_outlined,
                                label: message.revealDeletedContent
                                    ? 'Ocultar apagada'
                                    : 'Revelar apagada',
                                color: wa.textPrimary,
                                onTap: () => Navigator.of(context).pop(
                                  message.revealDeletedContent
                                      ? 'hide_deleted'
                                      : 'reveal_deleted',
                                ),
                              ),
                            if (message.hasRenderableMedia &&
                                message.mediaUrl != null)
                              _waActionRow(
                                icon: Icons.download_rounded,
                                label: 'Salvar no aparelho',
                                color: wa.textPrimary,
                                onTap: () =>
                                    Navigator.of(context).pop('download_media'),
                              ),
                            if (onOpenReceiptDetails != null) ...[
                              Divider(height: 1, color: wa.border),
                              _waActionRow(
                                icon: Icons.info_outline_rounded,
                                label: 'Informações da mensagem',
                                color: wa.textPrimary,
                                onTap: () => Navigator.of(context).pop('info'),
                              ),
                            ],
                            if (canPin)
                              _waActionRow(
                                icon: Icons.push_pin_outlined,
                                label: 'Fixar',
                                color: wa.textPrimary,
                                onTap: () => Navigator.of(context).pop('pin'),
                              ),
                            if (canDelete) ...[
                              Divider(height: 1, color: wa.border),
                              _waActionRow(
                                icon: Icons.delete_outline_rounded,
                                label: 'Apagar',
                                color: const Color(0xFFEA0038),
                                onTap: () =>
                                    Navigator.of(context).pop('delete'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    },
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      final curved = CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
      );
      return FadeTransition(
        opacity: curved,
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.94, end: 1).animate(curved),
          child: child,
        ),
      );
    },
  );

  if (selected == null || !context.mounted) return;
  await _handleMessageAction(
    context: context,
    value: selected,
    message: message,
    onRunMessageAction: onRunMessageAction,
    onToggleDeletedReveal: onToggleDeletedReveal,
    reactionAnchor: position,
    onOpenReceiptDetails: onOpenReceiptDetails,
  );
}

Widget _waActionRow({
  required IconData icon,
  required String label,
  required Color color,
  required VoidCallback onTap,
}) {
  return InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
      child: Row(
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

Future<void> _handleMessageAction({
  required BuildContext context,
  required String value,
  required ChatMessage message,
  required Future<void> Function(String action, Map<String, Object?> data)
  onRunMessageAction,
  required ValueChanged<bool> onToggleDeletedReveal,
  Offset? reactionAnchor,
  Future<void> Function()? onOpenReceiptDetails,
}) async {
  if (value == 'copy') {
    await Clipboard.setData(ClipboardData(text: message.displayText));
    if (context.mounted) {
      showSuccessToast(context, 'Texto copiado.');
    }
    return;
  }
  if (value == 'edit') {
    final controller = TextEditingController(text: message.displayText);
    final edited = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          message.hasRenderableMedia ? 'Editar legenda' : 'Editar mensagem',
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: TextField(
            controller: controller,
            autofocus: true,
            minLines: 2,
            maxLines: 8,
            maxLength: 4000,
            decoration: const InputDecoration(
              hintText: 'Digite o novo conteúdo',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (edited == null ||
        (edited.isEmpty && !message.hasRenderableMedia) ||
        edited == message.displayText.trim()) {
      return;
    }
    await onRunMessageAction('edit', {'text': edited});
    return;
  }
  if (value == 'reveal_deleted') {
    onToggleDeletedReveal(true);
    return;
  }
  if (value == 'hide_deleted') {
    onToggleDeletedReveal(false);
    return;
  }
  if (value == 'info') {
    await onOpenReceiptDetails?.call();
    return;
  }
  if (value == 'react' || value == 'react:more' || value.startsWith('react:')) {
    String? emoji;
    if (value == 'react' || value == 'react:more') {
      if (value == 'react:more') {
        emoji = await showEmojiPickerSheet(
          context,
          anchor: reactionAnchor,
          reactionMode: true,
        );
      } else {
        emoji = await showReactionPicker(context);
      }
    } else {
      emoji = value.substring('react:'.length);
    }
    if (emoji == null || emoji.trim().isEmpty) return;
    await onRunMessageAction('react', {'emoji': emoji.trim()});
    return;
  }
  await onRunMessageAction(value, const {});
}

class _MessageActionsButton extends StatelessWidget {
  const _MessageActionsButton({
    required this.message,
    required this.onRunMessageAction,
    required this.onToggleDeletedReveal,
    required this.canDelete,
    required this.canEdit,
    required this.canPin,
    required this.canRevealDeleted,
    this.onOpenReceiptDetails,
  });

  final ChatMessage message;
  final Future<void> Function(String action, Map<String, Object?> data)
  onRunMessageAction;
  final ValueChanged<bool> onToggleDeletedReveal;
  final bool canDelete;
  final bool canEdit;
  final bool canPin;
  final bool canRevealDeleted;
  final Future<void> Function(ChatMessage message)? onOpenReceiptDetails;

  @override
  Widget build(BuildContext context) {
    final isDesktop = MediaQuery.sizeOf(context).width >= 720;
    final size = Size(isDesktop ? 22 : 20, isDesktop ? 18 : 16);
    return Tooltip(
      message: 'Ações da mensagem',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapUp: (details) {
          unawaited(
            showMessageActionsMenu(
              context: context,
              position: details.globalPosition,
              message: message,
              onRunMessageAction: onRunMessageAction,
              onToggleDeletedReveal: onToggleDeletedReveal,
              canDelete: canDelete,
              canEdit: canEdit,
              canPin: canPin,
              canRevealDeleted: canRevealDeleted,
              onOpenReceiptDetails: onOpenReceiptDetails == null
                  ? null
                  : () => onOpenReceiptDetails!(message),
            ),
          );
        },
        child: SizedBox.fromSize(
          size: size,
          child: Icon(
            Icons.keyboard_arrow_down_rounded,
            size: isDesktop ? 18 : 16,
            color: const Color(0xFF8696A0),
          ),
        ),
      ),
    );
  }
}

class _ParticipantAvatar extends StatelessWidget {
  const _ParticipantAvatar({
    required this.message,
    required this.radius,
    required this.onTap,
  });

  final ChatMessage message;
  final double radius;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final url = _absoluteMediaUrl(message.senderAvatarUrl);
    return Tooltip(
      message:
          '${message.senderDisplayName}${message.senderPhoneDisplay.isEmpty ? '' : ' · ${message.senderPhoneDisplay}'}',
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: ClipOval(
          child: url == null
              ? _fallback()
              : BotAdminCachedImage(
                  imageUrl: url,
                  width: radius * 2,
                  height: radius * 2,
                  fit: BoxFit.cover,
                  errorWidget: (context, _, _) => _fallback(),
                ),
        ),
      ),
    );
  }

  Widget _fallback() {
    return CircleAvatar(
      radius: radius,
      backgroundColor: _senderColor(
        message.senderJid ?? message.senderName,
      ).withValues(alpha: 0.16),
      foregroundColor: _senderColor(message.senderJid ?? message.senderName),
      child: Text(
        _senderInitials(message.senderDisplayName),
        style: TextStyle(fontSize: radius * 0.72, fontWeight: FontWeight.w800),
      ),
    );
  }
}

class _ParticipantIdentityHeader extends StatelessWidget {
  const _ParticipantIdentityHeader({
    required this.message,
    required this.onTap,
  });

  final ChatMessage message;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = _senderColor(message.senderJid ?? message.senderName);
    final name = message.senderDisplayName;
    final isInternalBot =
        message.senderJid?.startsWith('botadmin-bot:') == true;
    final phone = message.senderPhoneDisplay;
    final showPhone = phone.isNotEmpty && phone != name;
    return InkWell(
      borderRadius: BorderRadius.circular(5),
      onTap: onTap,
      child: Padding(
        padding: EdgeInsets.fromLTRB(1, 0, 4, 1),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: color,
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      height: 1.1,
                    ),
                  ),
                ),
                if (isInternalBot) ...[
                  const SizedBox(width: 5),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 5,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: WaTheme.of(context).accentSoft,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      'ROBÔ',
                      style: TextStyle(
                        color: WaTheme.of(context).accent,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ],
            ),
            if (showPhone) ...[
              SizedBox(height: 1),
              Text(
                phone,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: WaTheme.of(context).textMuted,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w500,
                  height: 1.1,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ParticipantActionsSheet extends ConsumerStatefulWidget {
  const _ParticipantActionsSheet({
    required this.thread,
    required this.group,
    required this.message,
    this.onOpenConversation,
  });

  final ConversationThread thread;
  final BotGroup? group;
  final ChatMessage message;
  final void Function(String jid, String displayName)? onOpenConversation;

  @override
  ConsumerState<_ParticipantActionsSheet> createState() =>
      _ParticipantActionsSheetState();
}

class _ParticipantActionsSheetState
    extends ConsumerState<_ParticipantActionsSheet> {
  String? _busyAction;

  @override
  Widget build(BuildContext context) {
    final jid = widget.message.senderJid?.trim() ?? '';
    final phone = widget.message.senderPhoneDisplay;
    final title = widget.message.senderDisplayName;
    final canModerate = widget.thread.isGroup && jid.isNotEmpty;

    return FractionallySizedBox(
      heightFactor: .9,
      child: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _ParticipantAvatar(
                    message: widget.message,
                    radius: 24,
                    onTap: () {},
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: WaTheme.of(context).textPrimary,
                          ),
                        ),
                        Text(
                          phone.isNotEmpty ? phone : jid,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            color: WaTheme.of(context).textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              SizedBox(height: 16),
              _ParticipantActionTile(
                icon: Icons.phone_iphone_rounded,
                title: 'Copiar número',
                enabled: phone.isNotEmpty,
                onTap: () => _copy(phone, 'Número copiado.'),
              ),
              _ParticipantActionTile(
                icon: Icons.copy_rounded,
                title: 'Copiar JID',
                enabled: jid.isNotEmpty,
                onTap: () => _copy(jid, 'JID copiado.'),
              ),
              if (widget.onOpenConversation != null && jid.isNotEmpty)
                _ParticipantActionTile(
                  icon: Icons.chat_bubble_outline_rounded,
                  title: 'Conversar no privado',
                  subtitle: 'Abrir esta pessoa em uma conversa separada.',
                  onTap: () {
                    Navigator.of(context).pop();
                    widget.onOpenConversation!(jid, title);
                  },
                ),
              Divider(height: 18),
              if (!canModerate)
                Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    'Ações de moderação aparecem quando o número do participante vem na mensagem.',
                    style: TextStyle(
                      color: WaTheme.of(context).textMuted,
                      fontSize: 13,
                    ),
                  ),
                )
              else ...[
                if (widget.group != null) ...[
                  _ParticipantActionTile(
                    icon: Icons.warning_amber_rounded,
                    title: 'Advertir participante',
                    subtitle: 'Aplica uma infração manual como o comando adv.',
                    busy: _busyAction == 'warn',
                    enabled: _busyAction == null,
                    onTap: () => _runModerationAction('warn'),
                  ),
                  _ParticipantActionTile(
                    icon: Icons.cleaning_services_rounded,
                    title: 'Remover advertências',
                    busy: _busyAction == 'resetInfractions',
                    enabled: _busyAction == null,
                    onTap: () => _runModerationAction('resetInfractions'),
                  ),
                  _ParticipantActionTile(
                    icon: Icons.block_rounded,
                    title: 'Adicionar à blacklist',
                    subtitle: 'Bloqueia o número nas configurações do grupo.',
                    destructive: true,
                    busy: _busyAction == 'blacklist',
                    enabled: _busyAction == null,
                    onTap: () => _confirmBlacklist(removeAfterBlacklist: false),
                  ),
                  _ParticipantActionTile(
                    icon: Icons.person_off_rounded,
                    title: 'Blacklist e remover',
                    subtitle: 'Bloqueia o número e remove do grupo.',
                    destructive: true,
                    busy: _busyAction == 'blacklist-remove',
                    enabled: _busyAction == null,
                    onTap: () => _confirmBlacklist(removeAfterBlacklist: true),
                  ),
                ],
                _ParticipantActionTile(
                  icon: Icons.admin_panel_settings_rounded,
                  title: 'Promover admin',
                  busy: _busyAction == 'promote',
                  enabled: _busyAction == null,
                  onTap: () => _runModerationAction('promote'),
                ),
                _ParticipantActionTile(
                  icon: Icons.remove_moderator_rounded,
                  title: 'Rebaixar admin',
                  busy: _busyAction == 'demote',
                  enabled: _busyAction == null,
                  onTap: () => _runModerationAction('demote'),
                ),
                _ParticipantActionTile(
                  icon: Icons.person_remove_rounded,
                  title: 'Remover do grupo',
                  subtitle: 'Remove o participante sem limpar histórico.',
                  destructive: true,
                  busy: _busyAction == 'remove',
                  enabled: _busyAction == null,
                  onTap: () => _confirmRemove(deleteRecentMessages: false),
                ),
                _ParticipantActionTile(
                  icon: Icons.delete_sweep_rounded,
                  title: 'Remover e apagar recentes',
                  subtitle: 'Apaga até 10 mensagens recentes antes da remoção.',
                  destructive: true,
                  busy: _busyAction == 'remove-clean',
                  enabled: _busyAction == null,
                  onTap: () => _confirmRemove(deleteRecentMessages: true),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _copy(String value, String message) async {
    if (value.trim().isEmpty) return;
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    Navigator.of(context).pop();
    showSuccessToast(context, message);
  }

  Future<void> _confirmRemove({required bool deleteRecentMessages}) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remover participante?'),
        content: Text(
          deleteRecentMessages
              ? 'O BotAdmin vai tentar apagar mensagens recentes deste participante e depois removê-lo do grupo.'
              : 'O BotAdmin vai remover este participante do grupo.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remover'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _runModerationAction(
      'remove',
      busyKey: deleteRecentMessages ? 'remove-clean' : 'remove',
      deleteRecentMessages: deleteRecentMessages,
    );
  }

  Future<void> _confirmBlacklist({required bool removeAfterBlacklist}) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Adicionar à blacklist?'),
        content: Text(
          removeAfterBlacklist
              ? 'O BotAdmin vai adicionar este número à blacklist e remover o participante do grupo.'
              : 'O BotAdmin vai adicionar este número à blacklist do grupo.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _runModerationAction(
      'blacklist',
      busyKey: removeAfterBlacklist ? 'blacklist-remove' : 'blacklist',
      removeAfterBlacklist: removeAfterBlacklist,
    );
  }

  Future<void> _runModerationAction(
    String action, {
    String? busyKey,
    bool deleteRecentMessages = false,
    bool removeAfterBlacklist = false,
  }) async {
    final group = widget.group;
    final jid = widget.message.senderJid?.trim() ?? '';
    if (jid.isEmpty || _busyAction != null) return;
    if ((action == 'resetInfractions' ||
            action == 'warn' ||
            action == 'blacklist') &&
        group == null) {
      return;
    }

    final key = busyKey ?? action;
    final navigator = Navigator.of(context);
    setState(() => _busyAction = key);
    try {
      final response = await ref
          .read(apiClientProvider)
          .runGroupParticipantAction(
            group,
            thread: widget.thread,
            participantJid: jid,
            action: action,
            deleteRecentMessages: deleteRecentMessages,
            removeAfterBlacklist: removeAfterBlacklist,
          );
      final message = response['message']?.toString().trim();
      if (!mounted) return;
      navigator.pop();
      showActionToast(
        context,
        apiMessage: message,
        fallback: 'Ação realizada com sucesso.',
      );
    } catch (error) {
      if (!mounted) return;
      showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }
}

class _ParticipantActionTile extends StatelessWidget {
  const _ParticipantActionTile({
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.enabled = true,
    this.busy = false,
    this.destructive = false,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final bool enabled;
  final bool busy;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final color = destructive ? const Color(0xFFB42318) : wa.textPrimary;
    return ListTile(
      enabled: enabled,
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        radius: 18,
        backgroundColor: destructive
            ? const Color(0xFFFFE4E2)
            : wa.avatarFallback,
        foregroundColor: destructive ? const Color(0xFFB42318) : wa.icon,
        child: busy
            ? SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Icon(icon, size: 20),
      ),
      title: Text(
        title,
        style: TextStyle(
          color: enabled ? color : wa.textMuted,
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: subtitle == null
          ? null
          : Text(
              subtitle!,
              style: TextStyle(
                color: WaTheme.of(context).textMuted,
                fontSize: 12,
              ),
            ),
      onTap: enabled && !busy ? onTap : null,
    );
  }
}

class _MessageMeta extends StatelessWidget {
  const _MessageMeta({
    required this.time,
    required this.fromMe,
    this.localStatus,
    this.message,
    this.onTap,
    this.onRetry,
  });

  final String time;
  final bool fromMe;
  final MessageLocalStatus? localStatus;
  final ChatMessage? message;
  final VoidCallback? onTap;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final statusIcon = _statusIcon();
    final content = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (message?.editedAt != null) ...[
          Text(
            'editada',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: wa.bubbleMeta,
              fontSize: 10.5,
              fontStyle: FontStyle.italic,
            ),
          ),
          const SizedBox(width: 4),
        ],
        Text(
          time,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: localStatus == MessageLocalStatus.failed
                ? const Color(0xFFEA0038)
                : wa.bubbleMeta,
            fontSize: 11,
          ),
        ),
        if (fromMe && statusIcon != null) ...[SizedBox(width: 3), statusIcon],
      ],
    );
    final callback = localStatus == MessageLocalStatus.failed ? onRetry : onTap;
    return callback == null
        ? content
        : InkWell(
            onTap: callback,
            borderRadius: BorderRadius.circular(4),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
              child: content,
            ),
          );
  }

  Widget? _statusIcon() {
    if (!fromMe) return null;
    switch (localStatus) {
      case MessageLocalStatus.pending:
        return const Icon(
          Icons.access_time_rounded,
          size: 14,
          color: Color(0xFF8696A0),
        );
      case MessageLocalStatus.failed:
        return const Icon(
          Icons.error_outline_rounded,
          size: 15,
          color: Color(0xFFEA0038),
        );
      case MessageLocalStatus.sent:
        return const Icon(
          Icons.done_rounded,
          size: 15,
          color: Color(0xFF8696A0),
        );
      case null:
        final state = message?.deliveryState;
        final read =
            state == MessageDeliveryState.read ||
            (message?.receiptSummary['readCount'] ?? 0) > 0;
        final delivered =
            read ||
            state == MessageDeliveryState.delivered ||
            (message?.receiptSummary['deliveredCount'] ?? 0) > 0;
        return Icon(
          delivered ? Icons.done_all_rounded : Icons.done_rounded,
          size: delivered ? 16 : 15,
          color: read ? const Color(0xFF53BDEB) : const Color(0xFF8696A0),
        );
    }
  }
}

class _QuotedPreview extends StatelessWidget {
  const _QuotedPreview({required this.quoted});

  final ChatQuotedMessage quoted;

  @override
  Widget build(BuildContext context) {
    final title = (quoted.title ?? quoted.participant ?? 'Mensagem').trim();
    final body = (quoted.text ?? _quotedTypeLabel(quoted.messageType)).trim();
    return Container(
      constraints: BoxConstraints(maxWidth: 320),
      decoration: BoxDecoration(
        color: const Color(0x0F000000),
        borderRadius: BorderRadius.circular(7),
      ),
      child: IntrinsicHeight(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 4,
              decoration: BoxDecoration(
                color: Color(0xFF06CF9C),
                borderRadius: BorderRadius.horizontal(left: Radius.circular(7)),
              ),
            ),
            Flexible(
              child: Padding(
                padding: EdgeInsets.fromLTRB(8, 6, 10, 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title.isEmpty
                          ? 'Mensagem'
                          : (title.startsWith('@') ? title : '@$title'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Color(0xFF008069),
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      body.isEmpty ? 'Mensagem' : body,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: WaTheme.of(context).textMuted,
                        fontSize: 12.5,
                        height: 1.22,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReactionCluster extends StatelessWidget {
  const _ReactionCluster({required this.reactions});

  final List<ChatReaction> reactions;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final counts = <String, int>{};
    final byEmoji = <String, List<ChatReaction>>{};
    for (final reaction in reactions) {
      final emoji = reaction.emoji.trim();
      if (emoji.isEmpty) continue;
      counts[emoji] = (counts[emoji] ?? 0) + 1;
      byEmoji.putIfAbsent(emoji, () => <ChatReaction>[]).add(reaction);
    }
    if (counts.isEmpty) return const SizedBox.shrink();

    final entries = counts.entries.toList(growable: false)
      ..sort((a, b) => b.value.compareTo(a.value));
    final shown = entries.take(3).toList(growable: false);
    final total = counts.values.fold<int>(0, (sum, value) => sum + value);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () =>
            unawaited(showReactionDetailsSheet(context, reactions: reactions)),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.isDark ? const Color(0xFF1F2C33) : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: wa.isDark
                  ? const Color(0xFF2A3942)
                  : const Color(0x1A000000),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: wa.isDark ? 0.4 : 0.14),
                blurRadius: 5,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(6, 3, 7, 3),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < shown.length; i++) ...[
                  if (i > 0) const SizedBox(width: 1),
                  Text(shown[i].key, style: emojiTextStyle(14)),
                ],
                if (total > 1) ...[
                  const SizedBox(width: 4),
                  Text(
                    '$total',
                    style: TextStyle(
                      fontSize: 12,
                      color: wa.textMuted,
                      fontWeight: FontWeight.w700,
                      height: 1,
                    ),
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

/// Sheet “quem reagiu” no estilo WhatsApp (agrupado por emoji).
Future<void> showReactionDetailsSheet(
  BuildContext context, {
  required List<ChatReaction> reactions,
}) {
  final wa = WaTheme.of(context);
  final byEmoji = <String, List<ChatReaction>>{};
  for (final reaction in reactions) {
    final emoji = reaction.emoji.trim();
    if (emoji.isEmpty) continue;
    byEmoji.putIfAbsent(emoji, () => <ChatReaction>[]).add(reaction);
  }
  final emojis = byEmoji.keys.toList(growable: false)
    ..sort((a, b) => byEmoji[b]!.length.compareTo(byEmoji[a]!.length));

  return showBotAdminBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: wa.panel,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (context) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                child: Text(
                  'Reações',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                    color: wa.textPrimary,
                  ),
                ),
              ),
              // Resumo por emoji no topo.
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Row(
                  children: [
                    for (final emoji in emojis)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: wa.searchBg,
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: wa.border),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(10, 6, 12, 6),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(emoji, style: emojiTextStyle(18)),
                                const SizedBox(width: 6),
                                Text(
                                  '${byEmoji[emoji]!.length}',
                                  style: TextStyle(
                                    color: wa.textPrimary,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * 0.55,
                ),
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final emoji in emojis) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                        child: Row(
                          children: [
                            Text(emoji, style: emojiTextStyle(20)),
                            const SizedBox(width: 8),
                            Text(
                              '${byEmoji[emoji]!.length}',
                              style: TextStyle(
                                color: wa.textMuted,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                      for (final reaction in byEmoji[emoji]!)
                        ListTile(
                          dense: true,
                          leading: CircleAvatar(
                            radius: 18,
                            backgroundColor: wa.avatarFallback,
                            child: Text(
                              _reactionInitial(reaction),
                              style: TextStyle(
                                color: wa.textPrimary,
                                fontWeight: FontWeight.w800,
                                fontSize: 13,
                              ),
                            ),
                          ),
                          title: Text(
                            _reactionDisplayName(reaction),
                            style: TextStyle(
                              color: wa.textPrimary,
                              fontWeight: FontWeight.w600,
                              fontSize: 15,
                            ),
                          ),
                          trailing: Text(emoji, style: emojiTextStyle(20)),
                        ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

String _reactionDisplayName(ChatReaction reaction) {
  if (reaction.fromMe) return 'Você';
  final name = reaction.senderName?.trim() ?? '';
  if (name.isNotEmpty && name.toLowerCase() != 'você') return name;
  final jid = reaction.senderJid?.trim() ?? '';
  if (jid.isNotEmpty) {
    final phone = jid.split('@').first.replaceAll(RegExp(r'\D'), '');
    if (phone.isNotEmpty) return phone;
  }
  return 'Participante';
}

String _reactionInitial(ChatReaction reaction) {
  final name = _reactionDisplayName(reaction).trim();
  if (name.isEmpty) return '?';
  return name.characters.first.toUpperCase();
}

/// Texto com URLs clicáveis (http/https/www), estilo WhatsApp.
class _LinkifiedMessageText extends StatefulWidget {
  const _LinkifiedMessageText({
    required this.text,
    required this.style,
    required this.linkColor,
    this.mentionTargets = const {},
    this.onMentionTap,
  });

  final String text;
  final TextStyle style;
  final Color linkColor;
  final Map<String, String> mentionTargets;
  final void Function(String jid, String displayName)? onMentionTap;

  @override
  State<_LinkifiedMessageText> createState() => _LinkifiedMessageTextState();
}

class _LinkifiedMessageTextState extends State<_LinkifiedMessageText> {
  static final RegExp _urlRegex = RegExp(
    // Preserva caminho, querystring e fragmento completos (incluindo /, ?,
    // &, = e %), removendo somente pontuação que encerra a frase.
    r'((?:https?:\/\/|www\.)[^\s<>"{}|\\^`\[\]]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:[/?#][^\s<>"{}|\\^`\[\]]*)?)',
    caseSensitive: false,
  );

  final List<TapGestureRecognizer> _recognizers = <TapGestureRecognizer>[];

  @override
  void dispose() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    super.dispose();
  }

  void _clearRecognizers() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    _recognizers.clear();
  }

  List<InlineSpan> _buildSpans(BuildContext context) {
    _clearRecognizers();
    final text = _normalizeMessageDisplayText(widget.text);
    if (text.isEmpty) {
      return [TextSpan(text: text, style: widget.style)];
    }

    final spans = <InlineSpan>[];
    final matches =
        <({int start, int end, String value, bool url, String? jid})>[];
    for (final match in _urlRegex.allMatches(text)) {
      final raw = match.group(0) ?? '';
      final display = _trimTrailingPunctuation(raw);
      if (display.isNotEmpty) {
        matches.add((
          start: match.start,
          end: match.start + display.length,
          value: display,
          url: true,
          jid: null,
        ));
      }
    }
    for (final entry in widget.mentionTargets.entries) {
      final label = entry.key.trim();
      if (label.isEmpty) continue;
      final mentionRegex = RegExp(
        '@${RegExp.escape(label)}(?=\\b|\\s|[.,!?;:]|\$)',
        caseSensitive: false,
      );
      for (final match in mentionRegex.allMatches(text)) {
        matches.add((
          start: match.start,
          end: match.end,
          value: match.group(0)!,
          url: false,
          jid: entry.value,
        ));
      }
    }
    matches.sort(
      (a, b) => a.start != b.start
          ? a.start.compareTo(b.start)
          : b.end.compareTo(a.end),
    );
    var start = 0;
    for (final match in matches) {
      if (match.start < start) continue;
      if (match.start > start) {
        spans.add(
          TextSpan(
            text: text.substring(start, match.start),
            style: widget.style,
          ),
        );
      }
      final display = match.value;
      final url = _normalizeUrl(display);
      final recognizer = TapGestureRecognizer()
        ..onTap = match.url
            ? () => unawaited(_showLinkOpenOptions(context, url))
            : (match.jid == null || widget.onMentionTap == null)
            ? null
            : () => widget.onMentionTap!(match.jid!, display.substring(1));
      _recognizers.add(recognizer);
      spans.add(
        TextSpan(
          text: display,
          style: widget.style.copyWith(
            color: match.url ? widget.linkColor : const Color(0xFF008069),
            decoration: match.url
                ? TextDecoration.underline
                : TextDecoration.none,
          ),
          recognizer: recognizer,
          mouseCursor: SystemMouseCursors.click,
        ),
      );
      start = match.end;
    }
    if (start < text.length) {
      spans.add(TextSpan(text: text.substring(start), style: widget.style));
    }
    if (spans.isEmpty) {
      spans.add(TextSpan(text: text, style: widget.style));
    }
    return spans;
  }

  static String _trimTrailingPunctuation(String value) {
    var result = value;
    result = result.replaceFirst(RegExp(r'''[.,;:!\]}\\"']+$'''), '');
    while (result.endsWith(')') &&
        _countChar(result, ')') > _countChar(result, '(')) {
      result = result.substring(0, result.length - 1);
    }
    return result;
  }

  static int _countChar(String value, String char) =>
      char.allMatches(value).length;

  static String _normalizeUrl(String value) {
    final trimmed = value.trim();
    if (trimmed.toLowerCase().startsWith('http://') ||
        trimmed.toLowerCase().startsWith('https://')) {
      return trimmed;
    }
    return 'https://$trimmed';
  }

  Future<void> _showLinkOpenOptions(BuildContext context, String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null || !{'http', 'https'}.contains(uri.scheme.toLowerCase())) {
      if (context.mounted)
        showErrorToast(context, 'Este link não é seguro ou está incompleto.');
      return;
    }
    var opened = await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
    if (!opened)
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) {
      showErrorToast(
        context,
        'Não foi possível abrir este link neste dispositivo.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final normalized = _normalizeMessageDisplayText(widget.text);
    final hasMention = widget.mentionTargets.keys.any(
      (label) => RegExp(
        '@${RegExp.escape(label)}(?=\\b|\\s|[.,!?;:]|\$)',
        caseSensitive: false,
      ).hasMatch(normalized),
    );
    if (!_urlRegex.hasMatch(normalized) && !hasMention) {
      return Text(
        normalized,
        style: widget.style,
        textAlign: TextAlign.left,
        textDirection: ui.TextDirection.ltr,
        softWrap: true,
        overflow: TextOverflow.visible,
        // Keep the paragraph at its natural width.  Using the parent width
        // here made some Android Skia versions distribute spaces across every
        // line (a justified-looking WhatsApp balloon).
        textWidthBasis: TextWidthBasis.longestLine,
      );
    }
    return RichText(
      text: TextSpan(style: widget.style, children: _buildSpans(context)),
      textAlign: TextAlign.left,
      textDirection: ui.TextDirection.ltr,
      softWrap: true,
      overflow: TextOverflow.visible,
      textWidthBasis: TextWidthBasis.longestLine,
    );
  }
}

String _normalizeMessageDisplayText(String value) {
  if (value.isEmpty) return value;
  return value
      .replaceAll('\u00A0', ' ')
      .replaceAll('\u2007', ' ')
      .replaceAll('\u202F', ' ')
      .replaceAll(RegExp(r'[\u200B-\u200D\uFEFF]'), '')
      // Webhooks occasionally serialize captions with tabs/thin spaces. Keep
      // line breaks, but never let those separators create stretched words.
      .replaceAll(RegExp(r'[^\S\r\n]+'), ' ');
}

class _MediaPreview extends StatefulWidget {
  const _MediaPreview({
    required this.message,
    required this.onRunMessageAction,
  });

  final ChatMessage message;
  final Future<void> Function(String action, Map<String, Object?> data)
  onRunMessageAction;

  @override
  State<_MediaPreview> createState() => _MediaPreviewState();
}

class _MediaPreviewState extends State<_MediaPreview> {
  bool _opening = false;
  bool _openedNow = false;

  bool _flag(String key) {
    final value = widget.message.media[key];
    if (value is bool) return value;
    if (value is num) return value != 0;
    return const {
      'true',
      '1',
      'yes',
      'on',
    }.contains(value?.toString().trim().toLowerCase());
  }

  @override
  Widget build(BuildContext context) {
    final viewOnce = _flag('viewOnce');
    final alreadyOpened = _flag('viewOnceOpened');
    final localDataUrl = widget.message.media['dataUrl']?.toString();
    if (viewOnce &&
        widget.message.fromMe &&
        ((localDataUrl != null && localDataUrl.startsWith('data:')) ||
            widget.message.mediaUrl?.trim().isNotEmpty == true)) {
      return _RegularMediaPreview(
        message: widget.message,
        onRunMessageAction: widget.onRunMessageAction,
      );
    }
    if (viewOnce && !_openedNow) {
      final unavailable = alreadyOpened || widget.message.fromMe;
      return Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: unavailable || _opening ? null : _openViewOnce,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            constraints: const BoxConstraints(minHeight: 58),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0x0F008069),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0x33008069)),
            ),
            child: Row(
              children: [
                if (_opening)
                  const SizedBox(
                    width: 28,
                    height: 28,
                    child: CircularProgressIndicator(strokeWidth: 2.4),
                  )
                else
                  const Icon(Icons.looks_one_outlined, size: 29),
                const SizedBox(width: 11),
                Expanded(
                  child: Text(
                    unavailable
                        ? (widget.message.fromMe
                              ? 'Mídia de visualização única enviada'
                              : 'Mídia de visualização única aberta')
                        : 'Toque para abrir uma vez',
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return _RegularMediaPreview(
      message: widget.message,
      onRunMessageAction: widget.onRunMessageAction,
    );
  }

  Future<void> _openViewOnce() async {
    if (_opening || _openedNow) return;
    setState(() => _opening = true);
    try {
      await widget.onRunMessageAction('open_view_once', const {});
      if (mounted) setState(() => _openedNow = true);
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }
}

class _RegularMediaPreview extends StatelessWidget {
  const _RegularMediaPreview({
    required this.message,
    required this.onRunMessageAction,
  });

  final ChatMessage message;
  final Future<void> Function(String action, Map<String, Object?> data)
  onRunMessageAction;

  @override
  Widget build(BuildContext context) {
    final kind = _mediaKind(message);
    final url = _absoluteMediaUrl(message.mediaUrl);
    final thumbnailUrl = _absoluteMediaUrl(message.mediaThumbnailUrl);
    final localDataUrl = message.media['dataUrl']?.toString();
    final isImage = kind == 'image';
    final imageHeight = _stableChatImageHeight(message);

    if (kind == 'interactive') {
      return _MediaFallback(message: message, url: url);
    }

    if (kind == 'sticker' && url != null) {
      return _OpenableMedia(
        url: url,
        borderRadius: BorderRadius.circular(12),
        child: AuthenticatedMediaImage(
          url: url,
          width: 164,
          height: 164,
          fit: BoxFit.contain,
          placeholder: const _MediaLoadingBox(width: 164, height: 164),
          errorWidget: _MediaFallback(message: message),
        ),
      );
    }

    if (isImage && url != null) {
      // Internal bot commands may keep the original provider thumbnail as a
      // public source while the authenticated media proxy is still resolving.
      // Prefer that lightweight preview in the bubble so an old !play result
      // never sits as a large grey block; the full media URL remains the one
      // opened by the viewer.
      final previewUrl = thumbnailUrl ?? url;
      final fallbackUrl = previewUrl == url ? null : url;
      return _OpenableMedia(
        url: url,
        fallbackUrl: previewUrl,
        borderRadius: BorderRadius.circular(8),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: 300,
            height: imageHeight,
            child: AuthenticatedMediaImage(
              url: previewUrl,
              width: 300,
              height: imageHeight,
              fit: BoxFit.contain,
              placeholder: _MediaLoadingBox(width: 300, height: imageHeight),
              errorWidget: fallbackUrl == null
                  ? _MediaFallback(message: message)
                  : AuthenticatedMediaImage(
                      url: fallbackUrl,
                      width: 300,
                      height: imageHeight,
                      fit: BoxFit.contain,
                      placeholder: _MediaLoadingBox(
                        width: 300,
                        height: imageHeight,
                      ),
                      errorWidget: _MediaFallback(message: message),
                    ),
            ),
          ),
        ),
      );
    }

    if (isImage && localDataUrl != null && localDataUrl.startsWith('data:')) {
      final comma = localDataUrl.indexOf(',');
      if (comma > 0) {
        try {
          final bytes = base64Decode(localDataUrl.substring(comma + 1));
          return ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 300,
              height: imageHeight,
              child: Image.memory(
                bytes,
                width: 300,
                height: imageHeight,
                fit: BoxFit.contain,
                gaplessPlayback: true,
              ),
            ),
          );
        } catch (_) {}
      }
    }

    if (kind == 'video') return _VideoPreview(message: message, url: url);
    if (kind == 'audio') return _AudioPreview(message: message, url: url);
    return _MediaFallback(message: message, url: url);
  }
}

double _stableChatImageHeight(ChatMessage message) {
  final sourceFingerprint = <String?>[
    message.mediaUrl,
    message.mediaThumbnailUrl,
    message.mediaFileName,
    message.mediaTitle,
  ].whereType<String>().join(' ').toLowerCase();

  // YouTube command previews are always landscape. Some messages created by
  // older servers cached inverted dimensions and were consequently rendered
  // as a nearly full-screen portrait placeholder.
  if (sourceFingerprint.contains('ytimg.com') ||
      sourceFingerprint.contains('youtube.com') ||
      sourceFingerprint.contains('youtu.be') ||
      sourceFingerprint.contains('preview.jpg')) {
    return 300 * 9 / 16;
  }

  final records = <Map<String, dynamic>>[
    message.media,
    for (final candidate in <Object?>[
      message.media['image'],
      message.media['imageMessage'],
      message.media['media'],
      message.media['dimensions'],
    ])
      if (candidate is Map)
        candidate.map((key, value) => MapEntry(key.toString(), value)),
  ];

  double? readDimension(Map<String, dynamic> record, List<String> keys) {
    for (final key in keys) {
      final value = record[key];
      final parsed = value is num
          ? value.toDouble()
          : double.tryParse(value?.toString() ?? '');
      if (parsed != null && parsed > 0) return parsed;
    }
    return null;
  }

  for (final record in records) {
    final width = readDimension(record, const [
      'width',
      'Width',
      'imageWidth',
      'mediaWidth',
    ]);
    final height = readDimension(record, const [
      'height',
      'Height',
      'imageHeight',
      'mediaHeight',
    ]);
    if (width == null || height == null) continue;
    return (300 / (width / height)).clamp(150.0, 360.0).toDouble();
  }

  // The fallback is deliberately stable: decoding the bytes must never
  // change the bubble height while the reader scrolls. BoxFit.contain still
  // guarantees the complete image remains visible.
  return 225;
}

class _MediaLoadingBox extends StatelessWidget {
  const _MediaLoadingBox({required this.width, required this.height});

  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: height,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFE9EDEF),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      ),
    );
  }
}

class _LocationBubble extends StatelessWidget {
  const _LocationBubble({
    required this.message,
    required this.width,
    required this.backgroundColor,
    required this.time,
    required this.showSenderIdentity,
    required this.onOpenParticipant,
  });

  final ChatMessage message;
  final double width;
  final Color backgroundColor;
  final String time;
  final bool showSenderIdentity;
  final VoidCallback onOpenParticipant;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final media = message.media;
    final latitude = _firstFiniteDouble([
      media['latitude'],
      media['degreesLatitude'],
      media['DegreesLatitude'],
    ]);
    final longitude = _firstFiniteDouble([
      media['longitude'],
      media['degreesLongitude'],
      media['DegreesLongitude'],
    ]);
    final isLive =
        media['isLive'] == true ||
        media['liveLocation'] == true ||
        media['locationType']?.toString().toLowerCase() == 'live';
    final title =
        _firstNonEmptyString([
          media['title'],
          media['name'],
          message.mediaTitle,
        ]) ??
        (isLive ? 'Localização ao vivo' : 'Localização');
    final address = _firstNonEmptyString([
      media['address'],
      media['comment'],
      message.mediaCaption,
    ]);
    final mapUrl =
        _firstNonEmptyString([media['mapUrl'], media['url']]) ??
        (latitude != null && longitude != null
            ? 'https://www.google.com/maps/search/?api=1&query=$latitude,$longitude'
            : null);

    return Container(
      width: width,
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(message.fromMe ? 11 : 3),
          topRight: Radius.circular(message.fromMe ? 3 : 11),
          bottomLeft: const Radius.circular(11),
          bottomRight: const Radius.circular(11),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x16000000),
            blurRadius: 1.6,
            offset: Offset(0, 1),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showSenderIdentity)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
              child: _ParticipantIdentityHeader(
                message: message,
                onTap: onOpenParticipant,
              ),
            ),
          if (message.quoted != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(9, 5, 9, 4),
              child: _QuotedPreview(quoted: message.quoted!),
            ),
          _LocationMapPreview(
            thumbnailUrl: message.mediaThumbnailUrl,
            isLive: isLive,
            onTap: mapUrl == null ? null : () => _openExternalUrl(mapUrl),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(11, 9, 11, 5),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    if (isLive) ...[
                      Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: Color(0xFFEA0038),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 7),
                    ],
                    Expanded(
                      child: Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.bubbleText,
                          fontSize: 15.5,
                          height: 1.2,
                          fontWeight: FontWeight.w600,
                          fontFamily: 'Roboto',
                          letterSpacing: 0,
                        ),
                      ),
                    ),
                  ],
                ),
                if (address != null && address != title) ...[
                  const SizedBox(height: 3),
                  Text(
                    address,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.bubbleMeta,
                      fontSize: 13.5,
                      height: 1.22,
                      fontFamily: 'Roboto',
                      letterSpacing: 0,
                    ),
                  ),
                ],
                if (isLive) ...[
                  const SizedBox(height: 3),
                  Text(
                    'Toque para acompanhar no mapa',
                    style: TextStyle(
                      color: wa.bubbleMeta,
                      fontSize: 12.5,
                      height: 1.2,
                      fontFamily: 'Roboto',
                      letterSpacing: 0,
                    ),
                  ),
                ],
                const SizedBox(height: 3),
                Align(
                  alignment: Alignment.centerRight,
                  child: _MessageMeta(
                    time: time,
                    fromMe: message.fromMe,
                    localStatus: message.localStatus,
                  ),
                ),
              ],
            ),
          ),
          if (mapUrl != null)
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => _openExternalUrl(mapUrl),
                child: Container(
                  height: 42,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    border: Border(
                      top: BorderSide(
                        color: wa.isDark
                            ? const Color(0xFF2F3F46)
                            : const Color(0xFFE4E8EB),
                      ),
                    ),
                  ),
                  child: Text(
                    'Abrir no mapa',
                    style: TextStyle(
                      color: wa.isDark
                          ? const Color(0xFF00A884)
                          : const Color(0xFF008069),
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      fontFamily: 'Roboto',
                      letterSpacing: 0,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _LocationMapPreview extends StatelessWidget {
  const _LocationMapPreview({
    required this.thumbnailUrl,
    required this.isLive,
    required this.onTap,
  });

  final String? thumbnailUrl;
  final bool isLive;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final bytes = _decodeDataImage(thumbnailUrl);
    final map = SizedBox(
      height: 154,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (bytes != null)
            Image.memory(bytes, fit: BoxFit.cover, gaplessPlayback: true)
          else if ((thumbnailUrl ?? '').startsWith('http'))
            BotAdminCachedImage(
              imageUrl: thumbnailUrl!,
              fit: BoxFit.cover,
              placeholder: (_, _) =>
                  const _MediaLoadingBox(width: double.infinity, height: 154),
              errorWidget: (_, _, _) => _LocationMapFallback(isDark: wa.isDark),
            )
          else
            _LocationMapFallback(isDark: wa.isDark),
          Center(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: isLive
                    ? const Color(0xFFEA0038)
                    : const Color(0xFF008069),
                shape: BoxShape.circle,
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x55000000),
                    blurRadius: 7,
                    offset: Offset(0, 2),
                  ),
                ],
              ),
              child: const Padding(
                padding: EdgeInsets.all(9),
                child: Icon(
                  Icons.location_on_rounded,
                  size: 24,
                  color: Colors.white,
                ),
              ),
            ),
          ),
          if (isLive)
            Positioned(
              left: 9,
              bottom: 9,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: const Color(0xEFFFFFFF),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.my_location_rounded,
                      size: 14,
                      color: Color(0xFFEA0038),
                    ),
                    SizedBox(width: 5),
                    Text(
                      'AO VIVO',
                      style: TextStyle(
                        color: Color(0xFFEA0038),
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
    return Material(
      color: Colors.transparent,
      child: InkWell(onTap: onTap, child: map),
    );
  }
}

class _LocationMapFallback extends StatelessWidget {
  const _LocationMapFallback({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: isDark ? const Color(0xFF243238) : const Color(0xFFDCE8E2),
      child: CustomPaint(painter: _LocationMapPainter(isDark: isDark)),
    );
  }
}

class _LocationMapPainter extends CustomPainter {
  const _LocationMapPainter({required this.isDark});

  final bool isDark;

  @override
  void paint(Canvas canvas, Size size) {
    final road = Paint()
      ..color = isDark ? const Color(0xFF3A4A50) : const Color(0xFFF7FAF8)
      ..strokeWidth = 6
      ..style = PaintingStyle.stroke;
    final minor = Paint()
      ..color = isDark ? const Color(0xFF314147) : const Color(0xFFC9DDD3)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    for (var i = -2; i < 7; i++) {
      final y = i * 34.0;
      canvas.drawLine(Offset(0, y), Offset(size.width, y + 70), minor);
    }
    canvas.drawPath(
      Path()
        ..moveTo(-20, size.height * 0.72)
        ..cubicTo(
          size.width * 0.22,
          size.height * 0.2,
          size.width * 0.64,
          size.height * 1.08,
          size.width + 20,
          size.height * 0.3,
        ),
      road,
    );
  }

  @override
  bool shouldRepaint(covariant _LocationMapPainter oldDelegate) =>
      oldDelegate.isDark != isDark;
}

class _PollBubble extends StatelessWidget {
  const _PollBubble({
    required this.message,
    required this.width,
    required this.backgroundColor,
    required this.time,
    required this.showSenderIdentity,
    required this.onOpenParticipant,
    required this.onRunMessageAction,
  });

  final ChatMessage message;
  final double width;
  final Color backgroundColor;
  final String time;
  final bool showSenderIdentity;
  final VoidCallback onOpenParticipant;
  final Future<void> Function(String action, Map<String, Object?> data)
  onRunMessageAction;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final title = message.displayText.isNotEmpty
        ? message.displayText
        : message.mediaTitle ?? 'Enquete';
    final options = message.pollOptions;
    final totalVotes = options.fold<int>(
      0,
      (total, option) => total + option.voteCount,
    );
    final highestVoteCount = options.fold<int>(
      0,
      (highest, option) => math.max(highest, option.voteCount),
    );

    return Container(
      width: width,
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(message.fromMe ? 10 : 2),
          topRight: Radius.circular(message.fromMe ? 2 : 10),
          bottomLeft: const Radius.circular(10),
          bottomRight: const Radius.circular(10),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 1,
            offset: Offset(0, 1),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 9, 12, 7),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (showSenderIdentity)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: _ParticipantIdentityHeader(
                      message: message,
                      onTap: onOpenParticipant,
                    ),
                  ),
                if (message.quoted != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 7),
                    child: _QuotedPreview(quoted: message.quoted!),
                  ),
                Text(
                  title,
                  style: TextStyle(
                    color: wa.bubbleText,
                    fontWeight: FontWeight.w500,
                    fontSize: 16,
                    height: 1.22,
                    letterSpacing: 0,
                  ),
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    const _MultipleChoicePollIcon(),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Selecione uma ou mais opções',
                        style: TextStyle(
                          color: wa.bubbleMeta,
                          fontSize: 14.5,
                          height: 1.2,
                          letterSpacing: 0,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 9),
                if (options.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      'Opções da enquete indisponíveis.',
                      style: TextStyle(color: wa.bubbleMeta, fontSize: 13.5),
                    ),
                  )
                else
                  for (var index = 0; index < options.length; index++)
                    _PollOptionRow(
                      option: options[index],
                      highestVoteCount: highestVoteCount,
                      showBottomSpacing: index < options.length - 1,
                      onTap: () => onRunMessageAction('poll_vote', {
                        'optionId': options[index].id,
                        'optionTitle': options[index].title,
                      }),
                    ),
                const SizedBox(height: 2),
                Align(
                  alignment: Alignment.centerRight,
                  child: _MessageMeta(
                    time: time,
                    fromMe: message.fromMe,
                    localStatus: message.localStatus,
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: wa.divider.withValues(alpha: 0.58)),
          InkWell(
            onTap: totalVotes > 0 ? () => _openVotesSheet(context) : null,
            child: SizedBox(
              height: 46,
              child: Center(
                child: Text(
                  'Mostrar votos',
                  style: TextStyle(
                    color: totalVotes > 0
                        ? const Color(0xFF008069)
                        : wa.bubbleMeta.withValues(alpha: 0.32),
                    fontSize: 15.5,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openVotesSheet(BuildContext context) {
    showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        final wa = WaTheme.of(sheetContext);
        return Container(
          constraints: const BoxConstraints(maxWidth: 520),
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 8, 6),
                child: Row(
                  children: [
                    IconButton(
                      tooltip: 'Fechar',
                      onPressed: () => Navigator.of(sheetContext).pop(),
                      icon: const Icon(Icons.close_rounded),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        'Votos da enquete',
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Divider(height: 1, color: wa.divider),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    for (final option in message.pollOptions) ...[
                      ListTile(
                        title: Text(
                          option.title,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        trailing: Text('${option.voteCount}'),
                      ),
                      for (final voter in option.voterNames)
                        ListTile(
                          dense: true,
                          contentPadding: const EdgeInsets.only(
                            left: 38,
                            right: 18,
                          ),
                          leading: const CircleAvatar(
                            radius: 15,
                            child: Icon(Icons.person_rounded, size: 17),
                          ),
                          title: Text(voter),
                        ),
                      Divider(height: 1, color: wa.divider),
                    ],
                  ],
                ),
              ),
              SizedBox(
                height: math.max(
                  18,
                  MediaQuery.viewPaddingOf(sheetContext).bottom + 12,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _MultipleChoicePollIcon extends StatelessWidget {
  const _MultipleChoicePollIcon();

  @override
  Widget build(BuildContext context) {
    final color = WaTheme.of(context).bubbleMeta;
    return SizedBox(
      width: 22,
      height: 18,
      child: Stack(
        alignment: Alignment.centerLeft,
        children: [
          Positioned(
            left: 0,
            child: Icon(Icons.check_circle_rounded, size: 16, color: color),
          ),
          Positioned(
            left: 8,
            child: Icon(Icons.check_circle_rounded, size: 16, color: color),
          ),
        ],
      ),
    );
  }
}

class _PollOptionRow extends StatelessWidget {
  const _PollOptionRow({
    required this.option,
    required this.highestVoteCount,
    required this.showBottomSpacing,
    required this.onTap,
  });

  final ChatPollOption option;
  final int highestVoteCount;
  final bool showBottomSpacing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final progress = highestVoteCount <= 0
        ? 0.0
        : (option.voteCount / highestVoteCount).clamp(0.0, 1.0);
    final indicatorColor = wa.isDark
        ? const Color(0xFF00A884)
        : const Color(0xFF4F756A);

    return Padding(
      padding: EdgeInsets.only(bottom: showBottomSpacing ? 10 : 3),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(7),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: indicatorColor, width: 2),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      option.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: wa.bubbleText,
                        fontSize: 16,
                        height: 1.18,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${option.voteCount}',
                    style: TextStyle(
                      color: wa.bubbleText,
                      fontSize: 14,
                      letterSpacing: 0,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 5),
              Padding(
                padding: const EdgeInsets.only(left: 32),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: SizedBox(
                    height: 6,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        ColoredBox(
                          color: indicatorColor.withValues(alpha: 0.15),
                        ),
                        if (progress > 0)
                          FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: progress,
                            child: ColoredBox(color: indicatorColor),
                          ),
                      ],
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

class _ContactBubble extends StatelessWidget {
  const _ContactBubble({
    required this.message,
    required this.width,
    required this.backgroundColor,
    required this.time,
    required this.showSenderIdentity,
    required this.onOpenParticipant,
    this.onOpenContact,
  });

  final ChatMessage message;
  final double width;
  final Color backgroundColor;
  final String time;
  final bool showSenderIdentity;
  final VoidCallback onOpenParticipant;
  final void Function(ChatContactCard contact)? onOpenContact;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final contacts = message.contacts;
    if (contacts.isEmpty) return _MediaFallback(message: message);
    final first = contacts.first;
    final remaining = contacts.length - 1;
    final summary = remaining <= 0
        ? first.displayName
        : '${first.displayName} e $remaining '
              '${remaining == 1 ? 'outro contato' : 'outros contatos'}';

    return Container(
      width: width,
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(message.fromMe ? 10 : 2),
          topRight: Radius.circular(message.fromMe ? 2 : 10),
          bottomLeft: const Radius.circular(10),
          bottomRight: const Radius.circular(10),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 1,
            offset: Offset(0, 1),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: () => _openContactSheet(context),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(11, 10, 10, 7),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (showSenderIdentity)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 5),
                      child: _ParticipantIdentityHeader(
                        message: message,
                        onTap: onOpenParticipant,
                      ),
                    ),
                  if (message.quoted != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 7),
                      child: _QuotedPreview(quoted: message.quoted!),
                    ),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CircleAvatar(
                        radius: 21,
                        backgroundColor: const Color(0xFFD9FDD3),
                        foregroundColor: const Color(0xFF008069),
                        child: Text(
                          _senderInitials(first.displayName),
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          summary,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFF008069),
                            fontSize: 16,
                            height: 1.22,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Align(
                    alignment: Alignment.centerRight,
                    child: _MessageMeta(
                      time: time,
                      fromMe: message.fromMe,
                      localStatus: message.localStatus,
                    ),
                  ),
                ],
              ),
            ),
          ),
          Divider(height: 1, color: wa.divider.withValues(alpha: 0.58)),
          InkWell(
            onTap: contacts.length == 1
                ? () => _openConversation(context, contacts.first)
                : () => _openContactSheet(context),
            child: SizedBox(
              height: 46,
              child: Center(
                child: Text(
                  contacts.length == 1 ? 'Mensagem' : 'Ver todos',
                  style: const TextStyle(
                    color: Color(0xFF008069),
                    fontSize: 15.5,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openConversation(BuildContext context, ChatContactCard contact) {
    final callback = onOpenContact;
    if (callback != null) {
      callback(contact);
      return;
    }
    if (contact.phoneDigits.isNotEmpty) {
      unawaited(_openExternalUrl('https://wa.me/${contact.phoneDigits}'));
    }
  }

  void _openContactSheet(BuildContext context) {
    showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        final wa = WaTheme.of(sheetContext);
        return Container(
          constraints: const BoxConstraints(maxWidth: 520),
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 8, 6),
                child: Row(
                  children: [
                    IconButton(
                      tooltip: 'Fechar',
                      onPressed: () => Navigator.of(sheetContext).pop(),
                      icon: const Icon(Icons.close_rounded),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        message.contacts.length == 1
                            ? 'Contato'
                            : '${message.contacts.length} contatos',
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Divider(height: 1, color: wa.divider),
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  itemCount: message.contacts.length,
                  separatorBuilder: (_, _) =>
                      Divider(height: 1, indent: 70, color: wa.divider),
                  itemBuilder: (context, index) {
                    final contact = message.contacts[index];
                    return _ContactActionRow(
                      contact: contact,
                      onMessage: contact.phoneDigits.isEmpty
                          ? null
                          : () {
                              Navigator.of(sheetContext).pop();
                              final callback = onOpenContact;
                              if (callback != null) {
                                callback(contact);
                              } else {
                                unawaited(
                                  _openExternalUrl(
                                    'https://wa.me/${contact.phoneDigits}',
                                  ),
                                );
                              }
                            },
                      onSave: () async {
                        try {
                          final saved = await saveContact(
                            displayName: contact.displayName,
                            phoneNumber: contact.phoneNumber,
                            vcard: contact.vcard,
                          );
                          if (!sheetContext.mounted) return;
                          if (saved) {
                            showSuccessToast(
                              sheetContext,
                              'Contato pronto para salvar.',
                            );
                          } else {
                            await Clipboard.setData(
                              ClipboardData(text: contact.phoneNumber),
                            );
                            if (sheetContext.mounted) {
                              showSuccessToast(sheetContext, 'Número copiado.');
                            }
                          }
                        } catch (_) {
                          if (!sheetContext.mounted) return;
                          await Clipboard.setData(
                            ClipboardData(text: contact.phoneNumber),
                          );
                          if (sheetContext.mounted) {
                            showSuccessToast(sheetContext, 'Número copiado.');
                          }
                        }
                      },
                    );
                  },
                ),
              ),
              SizedBox(
                height: math.max(
                  18,
                  MediaQuery.viewPaddingOf(sheetContext).bottom + 12,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ContactActionRow extends StatelessWidget {
  const _ContactActionRow({
    required this.contact,
    required this.onMessage,
    required this.onSave,
  });

  final ChatContactCard contact;
  final VoidCallback? onMessage;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      child: Row(
        children: [
          CircleAvatar(
            radius: 23,
            backgroundColor: const Color(0xFFD9FDD3),
            foregroundColor: const Color(0xFF008069),
            child: Text(
              _senderInitials(contact.displayName),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  contact.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (contact.phoneNumber.isNotEmpty)
                  Text(
                    contact.phoneNumber,
                    style: TextStyle(color: wa.textMuted, fontSize: 13),
                  ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Mensagem',
            onPressed: onMessage,
            color: const Color(0xFF008069),
            icon: const Icon(Icons.chat_rounded),
          ),
          IconButton(
            tooltip: 'Salvar contato',
            onPressed: onSave,
            color: const Color(0xFF008069),
            icon: const Icon(Icons.person_add_alt_1_rounded),
          ),
        ],
      ),
    );
  }
}

class _FlowFormData {
  const _FlowFormData({
    required this.flowId,
    required this.flowToken,
    required this.screen,
    required this.cta,
    required this.version,
    required this.fields,
    this.nativeName = 'galaxy_message',
  });

  final String flowId;
  final String flowToken;
  final String screen;
  final String cta;
  final int version;
  final String nativeName;
  final List<_FlowFormField> fields;
}

class _FlowFormField {
  const _FlowFormField({
    required this.key,
    required this.label,
    required this.type,
    this.required = true,
  });

  final String key;
  final String label;
  final String type;
  final bool required;
}

_FlowFormData? _flowFormFromMessage(ChatMessage message) {
  for (final source in _interactiveButtonRecords(message.media)) {
    final record = _normalizedInteractiveRecord(source);
    final params = _asRecord(record['params'] ?? record['Params']) ?? record;
    final flow = _asRecord(record['flow'] ?? params['flow']);
    final flowId =
        _firstNonEmptyString([
          flow?['flowId'],
          flow?['id'],
          record['flowId'],
          record['flow_id'],
          params['flowId'],
          params['flow_id'],
        ]) ??
        '';
    final rawType =
        _firstNonEmptyString([
          record['type'],
          record['name'],
          params['form_type'],
        ]) ??
        '';
    if (flowId.isEmpty &&
        !rawType.toLowerCase().contains('galaxy') &&
        params['form_type'] != 'template') {
      continue;
    }
    final actionPayload =
        _asRecord(
          flow?['actionPayload'] ??
              params['flow_action_payload'] ??
              params['flowActionPayload'],
        ) ??
        const <String, dynamic>{};
    final data =
        _asRecord(flow?['data'] ?? actionPayload['data']) ??
        const <String, dynamic>{};
    final fields = <_FlowFormField>[];
    const knownFields = <String, (String, String)>{
      'full_name_visible': ('full_name', 'Nome completo'),
      'phone_number_visible': ('phone_number', 'WhatsApp'),
      'email_visible': ('email', 'E-mail'),
      'cpf_or_cnpj_visible': ('cpf_or_cnpj', 'CPF ou CNPJ'),
      'delivery_address_visible': ('delivery_address', 'Endereço de entrega'),
      'citizenship_card_visible': ('citizenship_card', 'Documento'),
    };
    for (final entry in knownFields.entries) {
      if (data[entry.key] != true) continue;
      final type = switch (entry.value.$1) {
        'email' => 'email',
        'phone_number' => 'phone',
        _ => 'text',
      };
      fields.add(
        _FlowFormField(key: entry.value.$1, label: entry.value.$2, type: type),
      );
    }
    final customFields = data['custom_fields'];
    if (customFields is List) {
      for (var index = 0; index < customFields.length; index++) {
        final custom = _asRecord(customFields[index]);
        if (custom == null) continue;
        final label =
            _firstNonEmptyString([
              custom['label'],
              custom['title'],
              custom['name'],
            ]) ??
            'Campo ${index + 1}';
        final key =
            _firstNonEmptyString([
              custom['key'],
              custom['id'],
              custom['name'],
            ]) ??
            'custom_${index + 1}';
        final type = (custom['type']?.toString() ?? 'TEXT_INPUT').toLowerCase();
        fields.add(
          _FlowFormField(
            key: key,
            label: label,
            type: type.contains('email')
                ? 'email'
                : type.contains('phone')
                ? 'phone'
                : type.contains('number')
                ? 'number'
                : 'text',
            required: custom['required'] != false,
          ),
        );
      }
    }
    if (fields.isEmpty) {
      fields.add(
        const _FlowFormField(key: 'response', label: 'Resposta', type: 'text'),
      );
    }
    final version =
        int.tryParse(
          _firstNonEmptyString([
                flow?['messageVersion'],
                params['flow_message_version'],
                params['flowMessageVersion'],
                message.media['messageVersion'],
              ]) ??
              '',
        ) ??
        1;
    return _FlowFormData(
      flowId: flowId.isEmpty ? message.remoteId : flowId,
      flowToken:
          _firstNonEmptyString([
            flow?['token'],
            record['flowToken'],
            params['flow_token'],
            params['flowToken'],
          ]) ??
          '',
      screen:
          _firstNonEmptyString([flow?['screen'], actionPayload['screen']]) ??
          'contact_details',
      cta: _cleanInteractiveText(
        _firstNonEmptyString([
              flow?['cta'],
              record['flowCta'],
              record['flow_cta'],
              params['flow_cta'],
              params['flowCta'],
            ]) ??
            'Preencher formulário',
      ),
      version: version,
      nativeName:
          _firstNonEmptyString([record['name'], record['nativeName']]) ??
          'galaxy_message',
      fields: fields,
    );
  }
  return null;
}

Future<Map<String, String>?> _showFlowFormDialog(
  BuildContext context,
  _FlowFormData form,
) {
  return showDialog<Map<String, String>>(
    context: context,
    barrierDismissible: true,
    builder: (_) => _FlowFormDialog(form: form),
  );
}

class _FlowFormDialog extends StatefulWidget {
  const _FlowFormDialog({required this.form});

  final _FlowFormData form;

  @override
  State<_FlowFormDialog> createState() => _FlowFormDialogState();
}

class _FlowFormDialogState extends State<_FlowFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _controllers = {
    for (final field in widget.form.fields) field.key: TextEditingController(),
  };

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 620;
    return Dialog(
      insetPadding: EdgeInsets.symmetric(
        horizontal: compact ? 16 : 28,
        vertical: 24,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 680),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 10, 12),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: wa.isDark
                          ? const Color(0xFF103C33)
                          : const Color(0xFFD9FDD3),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.dynamic_form_rounded,
                      color: Color(0xFF008069),
                      size: 21,
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      'Formulário',
                      style: TextStyle(
                        fontSize: 18,
                        height: 1.15,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'Roboto',
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Fechar',
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
                child: Form(
                  key: _formKey,
                  child: Column(
                    children: [
                      for (final field in widget.form.fields) ...[
                        TextFormField(
                          controller: _controllers[field.key],
                          keyboardType: switch (field.type) {
                            'email' => TextInputType.emailAddress,
                            'phone' => TextInputType.phone,
                            'number' => TextInputType.number,
                            _ => TextInputType.text,
                          },
                          textInputAction: TextInputAction.next,
                          autofillHints: switch (field.type) {
                            'email' => const [AutofillHints.email],
                            'phone' => const [AutofillHints.telephoneNumber],
                            _ when field.key == 'full_name' => const [
                              AutofillHints.name,
                            ],
                            _ => null,
                          },
                          decoration: InputDecoration(
                            labelText: field.label,
                            filled: true,
                            fillColor: wa.isDark
                                ? const Color(0xFF202C33)
                                : const Color(0xFFF0F2F5),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(9),
                              borderSide: BorderSide.none,
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(9),
                              borderSide: const BorderSide(
                                color: Color(0xFF00A884),
                                width: 1.5,
                              ),
                            ),
                          ),
                          validator: (value) {
                            if (field.required &&
                                (value == null || value.trim().isEmpty)) {
                              return 'Preencha este campo';
                            }
                            if (field.type == 'email' &&
                                value != null &&
                                value.trim().isNotEmpty &&
                                !RegExp(
                                  r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
                                ).hasMatch(value.trim())) {
                              return 'E-mail inválido';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 12),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(14),
              child: SizedBox(
                width: double.infinity,
                height: 46,
                child: FilledButton.icon(
                  onPressed: () {
                    if (!_formKey.currentState!.validate()) return;
                    Navigator.of(context).pop({
                      for (final entry in _controllers.entries)
                        entry.key: entry.value.text.trim(),
                    });
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF00A884),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(9),
                    ),
                  ),
                  icon: const Icon(Icons.send_rounded, size: 18),
                  label: const Text(
                    'Enviar',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontFamily: 'Roboto',
                      letterSpacing: 0,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InteractiveBubble extends StatelessWidget {
  const _InteractiveBubble({
    required this.message,
    required this.width,
    required this.backgroundColor,
    required this.time,
    required this.showSenderIdentity,
    required this.onOpenParticipant,
    required this.onHideDeleted,
    required this.onRunMessageAction,
  });

  final ChatMessage message;
  final double width;
  final Color backgroundColor;
  final String time;
  final bool showSenderIdentity;
  final VoidCallback onOpenParticipant;
  final VoidCallback onHideDeleted;
  final Future<void> Function(String action, Map<String, Object?> data)
  onRunMessageAction;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final title = _interactiveTitleText(message);
    final body = _interactiveBodyText(message);
    final buttons = _interactiveButtons(message);
    final sections = _interactiveSections(message);
    final headerMedia = _interactiveHeaderData(message);
    final footer = _interactiveFooterText(message);
    final cards = _interactiveCards(message);
    final singleCard = cards.length == 1 ? cards.first : null;
    final displayTitle = title.isNotEmpty ? title : singleCard?.title ?? '';
    final displayBody = body.isNotEmpty ? body : singleCard?.body ?? '';
    final displayHeader = headerMedia ?? singleCard?.header;
    final displayFooter = footer.isNotEmpty ? footer : singleCard?.footer ?? '';
    final displayButtons = buttons.isNotEmpty
        ? buttons
        : singleCard?.buttons ?? const <ChatInteractiveButton>[];
    final displaySections = sections.isNotEmpty
        ? sections
        : singleCard?.sections ?? const <ChatInteractiveSection>[];
    final playQuery = _interactivePlayQuery(
      message,
      displayButtons: displayButtons,
    );
    final isPlayCard = playQuery != null;
    final hasResolvedPlayHeader = displayHeader == null && isPlayCard;
    final effectiveFooter = displayFooter.isNotEmpty
        ? displayFooter
        : isPlayCard
        ? 'Escolha abaixo uma opção 👇'
        : '';
    final borderColor = wa.isDark
        ? const Color(0xFF2F3F46)
        : const Color(0xFFE4E8EB);
    final actionRows = <_InteractiveActionRowData>[
      for (final button in displayButtons)
        _InteractiveActionRowData(
          label: button.title.trim().isEmpty ? 'Selecionar' : button.title,
          icon: _interactiveButtonIcon(button),
          onTap: () => _handleButton(context, button),
        ),
      if (displaySections.any((section) => section.rows.isNotEmpty))
        _InteractiveActionRowData(
          label: _interactiveListButtonText(
            message,
            displaySections,
            buttonRecords: _interactiveButtonRecords(message.media),
          ),
          icon: Icons.format_list_bulleted_rounded,
          onTap: () => _openListSheet(context, displaySections),
        ),
    ];

    return ConstrainedBox(
      constraints: BoxConstraints.tightFor(width: width),
      child: Container(
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(message.fromMe ? 11 : 3),
            topRight: Radius.circular(message.fromMe ? 3 : 11),
            bottomLeft: const Radius.circular(11),
            bottomRight: const Radius.circular(11),
          ),
          border: message.localStatus == MessageLocalStatus.failed
              ? Border.all(color: const Color(0x55EA0038))
              : null,
          boxShadow: const [
            BoxShadow(
              color: Color(0x16000000),
              blurRadius: 1.6,
              offset: Offset(0, 1),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(
                10,
                7,
                10,
                actionRows.isEmpty ? 5 : 8,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (showSenderIdentity)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 5),
                      child: _ParticipantIdentityHeader(
                        message: message,
                        onTap: onOpenParticipant,
                      ),
                    ),
                  if (message.isDeleted && message.revealDeletedContent)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 7),
                      child: _DeletedMessageBanner(
                        deletedByName: message.deletedByName,
                        onHide: onHideDeleted,
                      ),
                    ),
                  if (message.quoted != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 7),
                      child: _QuotedPreview(quoted: message.quoted!),
                    ),
                  if (displayHeader != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: _InteractiveHeaderMedia(data: displayHeader),
                    )
                  else if (hasResolvedPlayHeader)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: _ResolvedPlayHeader(query: playQuery),
                    ),
                  if (displayTitle.isNotEmpty &&
                      !displayBody.startsWith(displayTitle))
                    Padding(
                      padding: EdgeInsets.only(
                        bottom: displayBody.isEmpty ? 0 : 6,
                      ),
                      child: Text(
                        displayTitle,
                        style: TextStyle(
                          color: wa.bubbleText,
                          fontSize: 15.5,
                          height: 1.2,
                          fontFamily: 'Roboto',
                          letterSpacing: 0,
                          wordSpacing: 0,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  if (isPlayCard)
                    _ResolvedPlayBody(
                      query: playQuery,
                      fallbackText: displayBody,
                      textColor: wa.bubbleText,
                      linkColor: wa.isDark
                          ? const Color(0xFF53BDEB)
                          : const Color(0xFF027EB5),
                    )
                  else if (displayBody.isNotEmpty)
                    _LinkifiedMessageText(
                      text: displayBody,
                      style: TextStyle(
                        color: wa.bubbleText,
                        fontSize: 15.5,
                        height: 1.24,
                        fontFamily: 'Roboto',
                        letterSpacing: 0,
                        wordSpacing: 0,
                        fontWeight: FontWeight.w400,
                      ),
                      linkColor: wa.isDark
                          ? const Color(0xFF53BDEB)
                          : const Color(0xFF027EB5),
                    )
                  else if (displayTitle.isEmpty &&
                      effectiveFooter.isEmpty &&
                      displayHeader == null &&
                      !hasResolvedPlayHeader)
                    Text(
                      'Mensagem interativa',
                      style: TextStyle(
                        color: wa.bubbleText,
                        fontSize: 15,
                        height: 1.24,
                        fontFamily: 'Roboto',
                        letterSpacing: 0,
                        wordSpacing: 0,
                      ),
                    ),
                  if (cards.length > 1) ...[
                    SizedBox(
                      height: displayBody.isEmpty && displayTitle.isEmpty
                          ? 0
                          : 10,
                    ),
                    _InteractiveCardStrip(
                      cards: cards,
                      width: width - 20,
                      onButtonTap: (button) => _handleButton(context, button),
                      onSectionTap: (cardSections) =>
                          _openListSheet(context, cardSections),
                    ),
                  ],
                  if (effectiveFooter.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      effectiveFooter,
                      style: TextStyle(
                        color: wa.bubbleMeta,
                        fontSize: 12.5,
                        height: 1.18,
                        fontFamily: 'Roboto',
                        letterSpacing: 0,
                        wordSpacing: 0,
                      ),
                    ),
                  ],
                  const SizedBox(height: 4),
                  Align(
                    alignment: Alignment.centerRight,
                    child: _MessageMeta(
                      time: time,
                      fromMe: message.fromMe,
                      localStatus: message.localStatus,
                    ),
                  ),
                ],
              ),
            ),
            if (actionRows.isNotEmpty)
              _InteractiveActionStack(
                rows: actionRows,
                borderColor: borderColor,
              ),
          ],
        ),
      ),
    );
  }

  void _openListSheet(
    BuildContext context,
    List<ChatInteractiveSection> sections,
  ) {
    showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => _InteractiveListSheet(
        sections: sections,
        onSelect: (button) {
          Navigator.of(sheetContext).pop();
          _handleButton(context, button);
        },
      ),
    );
  }

  Future<void> _handleButton(
    BuildContext context,
    ChatInteractiveButton button,
  ) async {
    if ((button.type ?? '').toLowerCase().contains('flow')) {
      final form = _flowFormFromMessage(message);
      if (form == null) {
        showSuccessToast(
          context,
          'Este formulário não trouxe os campos necessários.',
        );
        return;
      }
      final values = await _showFlowFormDialog(context, form);
      if (values == null || !context.mounted) return;
      final responseData = <String, Object?>{
        'screen': form.screen,
        'data': values,
        'flow_token': form.flowToken,
        'flow_id': form.flowId,
      };
      await onRunMessageAction('interactive_reply', {
        'responseType': 'flow',
        'selectedId': form.flowId,
        'selectedText': 'Formulário enviado',
        'nativeName': form.nativeName,
        'version': form.version,
        'params': {
          'flow_id': form.flowId,
          'flow_token': form.flowToken,
          'screen': form.screen,
          'flow_action': 'data_exchange',
          'data': values,
          'response_json': jsonEncode(responseData),
        },
      });
      return;
    }
    final copyCode = button.copyCode?.trim();
    if (copyCode != null && copyCode.isNotEmpty) {
      await Clipboard.setData(ClipboardData(text: copyCode));
      if (context.mounted) {
        showSuccessToast(context, 'Código copiado.');
      }
      return;
    }
    final url = button.url?.trim();
    if (!_isExplicitReplyButton(button) && url != null && url.isNotEmpty) {
      await _openExternalUrl(url);
      return;
    }
    final phoneNumber = button.phoneNumber?.trim();
    if (phoneNumber != null && phoneNumber.isNotEmpty) {
      await _openExternalUrl('tel:${_normalizePhoneForTel(phoneNumber)}');
      return;
    }
    await onRunMessageAction('interactive_reply', {
      'responseType': button.responseType,
      'selectedId': button.id,
      'selectedText': button.title,
      if ((button.description ?? '').trim().isNotEmpty)
        'description': button.description,
    });
  }
}

class _InteractiveHeaderMedia extends StatelessWidget {
  const _InteractiveHeaderMedia({required this.data});

  final _InteractiveHeaderData data;

  @override
  Widget build(BuildContext context) {
    final borderRadius = BorderRadius.circular(7);
    final content = _InteractiveHeaderMediaContent(data: data);
    final child = ClipRRect(
      borderRadius: borderRadius,
      // Cabeçalhos interativos chegam sem dimensões confiáveis. Deixá-los
      // medir pela imagem remota fazia alguns previews ocuparem quase toda a
      // tela depois de rotação/rebuild. O quadro estável 16:9 mantém a mídia
      // completa (BoxFit.contain) e o balão responsivo em qualquer aparelho.
      child: data.type == 'document'
          ? content
          : AspectRatio(
              aspectRatio: 16 / 9,
              child: ColoredBox(
                color: const Color(0xFFE9EDEF),
                child: data.type == 'video'
                    ? Stack(
                        fit: StackFit.expand,
                        children: [
                          content,
                          const Center(
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                color: Color(0x99000000),
                                shape: BoxShape.circle,
                              ),
                              child: Padding(
                                padding: EdgeInsets.all(9),
                                child: Icon(
                                  Icons.play_arrow_rounded,
                                  color: Colors.white,
                                  size: 30,
                                ),
                              ),
                            ),
                          ),
                        ],
                      )
                    : content,
              ),
            ),
    );
    final openUrl = data.url ?? data.dataUrl;
    if (openUrl == null || openUrl.isEmpty || data.type == 'document') {
      return child;
    }
    return _OpenableMedia(
      url: openUrl,
      fallbackUrl: data.fallbackUrl,
      borderRadius: borderRadius,
      child: child,
    );
  }
}

class _ResolvedPlayHeader extends ConsumerStatefulWidget {
  const _ResolvedPlayHeader({required this.query});

  final String query;

  @override
  ConsumerState<_ResolvedPlayHeader> createState() =>
      _ResolvedPlayHeaderState();
}

class _ResolvedPlayHeaderState extends ConsumerState<_ResolvedPlayHeader> {
  late Future<YoutubePreview?> _preview;

  @override
  void initState() {
    super.initState();
    _preview = ref.read(apiClientProvider).resolveYoutubePreview(widget.query);
  }

  @override
  void didUpdateWidget(covariant _ResolvedPlayHeader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.query == widget.query) return;
    _preview = ref.read(apiClientProvider).resolveYoutubePreview(widget.query);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<YoutubePreview?>(
      future: _preview,
      builder: (context, snapshot) {
        final url = snapshot.data?.thumbnailUrl.trim();
        if (url != null && url.isNotEmpty) {
          return _InteractiveHeaderMedia(
            data: _InteractiveHeaderData(type: 'image', url: url),
          );
        }
        if (snapshot.connectionState != ConnectionState.done) {
          return const _MediaLoadingBox(width: double.infinity, height: 150);
        }
        // Never collapse a !play card back to a text-only result. This local
        // asset keeps the header stable if YouTube is temporarily down.
        return ClipRRect(
          borderRadius: BorderRadius.circular(7),
          child: Container(
            constraints: const BoxConstraints(minHeight: 150),
            color: const Color(0xFFE9EDEF),
            alignment: Alignment.center,
            child: Image.asset(
              'assets/brand/botadmin-logo.png',
              height: 118,
              fit: BoxFit.contain,
            ),
          ),
        );
      },
    );
  }
}

class _ResolvedPlayBody extends ConsumerStatefulWidget {
  const _ResolvedPlayBody({
    required this.query,
    required this.fallbackText,
    required this.textColor,
    required this.linkColor,
  });

  final String query;
  final String fallbackText;
  final Color textColor;
  final Color linkColor;

  @override
  ConsumerState<_ResolvedPlayBody> createState() => _ResolvedPlayBodyState();
}

class _ResolvedPlayBodyState extends ConsumerState<_ResolvedPlayBody> {
  late Future<YoutubePreview?> _preview;

  @override
  void initState() {
    super.initState();
    _preview = ref.read(apiClientProvider).resolveYoutubePreview(widget.query);
  }

  @override
  void didUpdateWidget(covariant _ResolvedPlayBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.query == widget.query) return;
    _preview = ref.read(apiClientProvider).resolveYoutubePreview(widget.query);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<YoutubePreview?>(
      future: _preview,
      builder: (context, snapshot) {
        final fallback = widget.fallbackText.trim();
        final alreadyDetailed =
            fallback.contains('👤') ||
            fallback.contains('⏱') ||
            fallback.toLowerCase().contains('canal:') ||
            fallback.toLowerCase().contains('duração:');
        final preview = snapshot.data;
        final title = preview?.title?.trim();
        final author = preview?.author?.trim();
        final duration = preview?.duration?.trim();
        final resolved = !alreadyDetailed && title != null && title.isNotEmpty
            ? [
                '🎵 $title',
                if (author != null && author.isNotEmpty) '👤 $author',
                if (duration != null && duration.isNotEmpty) '⏱ $duration',
                '🌐 YouTube',
              ].join('\n')
            : fallback;
        return _LinkifiedMessageText(
          text: resolved.isEmpty ? '🎵 ${widget.query}' : resolved,
          style: TextStyle(
            color: widget.textColor,
            fontSize: 15.5,
            height: 1.24,
            fontFamily: 'Roboto',
            letterSpacing: 0,
            wordSpacing: 0,
            fontWeight: FontWeight.w400,
          ),
          linkColor: widget.linkColor,
        );
      },
    );
  }
}

class _InteractiveHeaderMediaContent extends StatelessWidget {
  const _InteractiveHeaderMediaContent({required this.data});

  final _InteractiveHeaderData data;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    if (data.type == 'document') {
      return _InteractiveHeaderFallback(
        icon: Icons.description_rounded,
        label: data.fileName ?? 'Documento',
      );
    }

    final bytes = _decodeDataImage(data.dataUrl);
    if (bytes != null) {
      return Image.memory(
        bytes,
        width: double.infinity,
        fit: BoxFit.contain,
        gaplessPlayback: true,
      );
    }

    final url = data.url;
    if (data.type == 'video' && url != null && url.isNotEmpty) {
      return InlineVideoPlayer(
        url: url,
        width: double.infinity,
        height: double.infinity,
        borderRadius: BorderRadius.zero,
        title: data.fileName ?? 'Vídeo',
        mimeType: data.mimeType ?? 'video/mp4',
      );
    }
    if (url != null && url.isNotEmpty && data.type != 'video-file') {
      return _InteractiveCachedHeaderImage(
        url: url,
        fallbackUrl: data.fallbackUrl,
        type: data.type,
      );
    }

    final fallbackUrl = data.fallbackUrl;
    if (fallbackUrl != null &&
        fallbackUrl.isNotEmpty &&
        data.type != 'video-file') {
      return _InteractiveCachedHeaderImage(url: fallbackUrl, type: data.type);
    }

    return _InteractiveHeaderFallback(
      icon: data.type == 'video'
          ? Icons.play_circle_outline_rounded
          : Icons.image_outlined,
      label: data.type == 'video' ? 'Vídeo' : 'Imagem',
      color: wa.textMuted,
    );
  }
}

class _InteractiveCachedHeaderImage extends StatelessWidget {
  const _InteractiveCachedHeaderImage({
    required this.url,
    required this.type,
    this.fallbackUrl,
  });

  final String url;
  final String type;
  final String? fallbackUrl;

  @override
  Widget build(BuildContext context) {
    return AuthenticatedMediaImage(
      url: url,
      width: double.infinity,
      fit: BoxFit.contain,
      placeholder: const _MediaLoadingBox(width: double.infinity, height: 150),
      errorWidget: _InteractiveHeaderFallbackWithUrl(
        fallbackUrl: fallbackUrl,
        originalUrl: url,
        type: type,
      ),
    );
  }
}

class _InteractiveHeaderFallbackWithUrl extends StatelessWidget {
  const _InteractiveHeaderFallbackWithUrl({
    required this.fallbackUrl,
    required this.originalUrl,
    required this.type,
  });

  final String? fallbackUrl;
  final String originalUrl;
  final String type;

  @override
  Widget build(BuildContext context) {
    final fallback = fallbackUrl?.trim();
    if (fallback != null && fallback.isNotEmpty && fallback != originalUrl) {
      return AuthenticatedMediaImage(
        url: fallback,
        width: double.infinity,
        fit: BoxFit.contain,
        placeholder: const _MediaLoadingBox(
          width: double.infinity,
          height: 150,
        ),
        errorWidget: _InteractiveHeaderFallback(
          icon: type == 'video'
              ? Icons.play_circle_outline_rounded
              : Icons.image_not_supported_outlined,
          label: type == 'video' ? 'Vídeo' : 'Imagem',
        ),
      );
    }
    return _InteractiveHeaderFallback(
      icon: type == 'video'
          ? Icons.play_circle_outline_rounded
          : Icons.image_not_supported_outlined,
      label: type == 'video' ? 'Vídeo' : 'Imagem',
    );
  }
}

class _InteractiveHeaderFallback extends StatelessWidget {
  const _InteractiveHeaderFallback({
    required this.icon,
    required this.label,
    this.color,
  });

  final IconData icon;
  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final foreground = color ?? wa.textMuted;
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 150),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: wa.isDark ? const Color(0xFF182229) : const Color(0xFFE9EDEF),
          borderRadius: BorderRadius.circular(7),
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: foreground, size: 32),
              const SizedBox(height: 6),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: foreground,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0,
                  wordSpacing: 0,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InteractiveCardStrip extends StatelessWidget {
  const _InteractiveCardStrip({
    required this.cards,
    required this.width,
    required this.onButtonTap,
    required this.onSectionTap,
  });

  final List<_InteractiveCardData> cards;
  final double width;
  final ValueChanged<ChatInteractiveButton> onButtonTap;
  final ValueChanged<List<ChatInteractiveSection>> onSectionTap;

  @override
  Widget build(BuildContext context) {
    if (cards.isEmpty) return const SizedBox.shrink();
    final cardWidth = math.min(286.0, math.max(220.0, width));
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var index = 0; index < cards.length; index++) ...[
            if (index > 0) const SizedBox(width: 8),
            _InteractiveCardPreview(
              card: cards[index],
              width: cardWidth,
              onButtonTap: onButtonTap,
              onSectionTap: onSectionTap,
            ),
          ],
        ],
      ),
    );
  }
}

class _InteractiveCardPreview extends StatelessWidget {
  const _InteractiveCardPreview({
    required this.card,
    required this.width,
    required this.onButtonTap,
    required this.onSectionTap,
  });

  final _InteractiveCardData card;
  final double width;
  final ValueChanged<ChatInteractiveButton> onButtonTap;
  final ValueChanged<List<ChatInteractiveSection>> onSectionTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final title = card.title;
    final body = card.body;
    final footer = card.footer;
    return Container(
      width: width,
      decoration: BoxDecoration(
        color: wa.isDark ? const Color(0xFF111B21) : Colors.white,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(
          color: wa.isDark ? const Color(0xFF2F3F46) : const Color(0xFFE0E4E7),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (card.header != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 4, 4, 0),
              child: _InteractiveHeaderMedia(data: card.header!),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (title.isNotEmpty)
                  Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: 14.5,
                      height: 1.18,
                      letterSpacing: 0,
                      wordSpacing: 0,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                if (body.isNotEmpty) ...[
                  if (title.isNotEmpty) const SizedBox(height: 4),
                  Text(
                    body,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: 13.5,
                      height: 1.2,
                      letterSpacing: 0,
                      wordSpacing: 0,
                    ),
                  ),
                ],
                if (footer.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    footer,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.textMuted,
                      fontSize: 12.5,
                      height: 1.18,
                      letterSpacing: 0,
                      wordSpacing: 0,
                    ),
                  ),
                ],
              ],
            ),
          ),
          for (final button in card.buttons)
            _InteractiveCompactAction(
              label: button.title,
              icon: _interactiveButtonIcon(button),
              onTap: () => onButtonTap(button),
            ),
          if (card.sections.any((section) => section.rows.isNotEmpty))
            _InteractiveCompactAction(
              label: card.listButtonText,
              icon: Icons.format_list_bulleted_rounded,
              onTap: () => onSectionTap(card.sections),
            ),
        ],
      ),
    );
  }
}

class _InteractiveCompactAction extends StatelessWidget {
  const _InteractiveCompactAction({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: wa.isDark
                  ? const Color(0xFF2F3F46)
                  : const Color(0xFFE4E8EB),
            ),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: const Color(0xFF008069), size: 16),
            const SizedBox(width: 7),
            Flexible(
              child: Text(
                label.trim().isEmpty ? 'Selecionar' : label.trim(),
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: 'Roboto',
                  color: Color(0xFF008069),
                  fontSize: 14,
                  height: 1.1,
                  letterSpacing: 0,
                  wordSpacing: 0,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InteractiveActionRowData {
  const _InteractiveActionRowData({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
}

class _InteractiveActionStack extends StatelessWidget {
  const _InteractiveActionStack({
    required this.rows,
    required this.borderColor,
  });

  final List<_InteractiveActionRowData> rows;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var index = 0; index < rows.length; index++)
          _InteractiveActionTile(
            row: rows[index],
            borderColor: borderColor,
            // WhatsApp separates the message body from the first action too.
            showDivider: true,
          ),
      ],
    );
  }
}

class _InteractiveActionTile extends StatelessWidget {
  const _InteractiveActionTile({
    required this.row,
    required this.borderColor,
    required this.showDivider,
  });

  final _InteractiveActionRowData row;
  final Color borderColor;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final label = row.label.trim().isEmpty ? 'Selecionar' : row.label.trim();
    return InkWell(
      onTap: row.onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          border: showDivider
              ? Border(top: BorderSide(color: borderColor))
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.max,
          children: [
            Icon(row.icon, color: const Color(0xFF008069), size: 17),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: 'Roboto',
                  color: Color(0xFF008069),
                  fontSize: 15,
                  height: 1.1,
                  letterSpacing: 0,
                  wordSpacing: 0,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InteractiveListSheet extends StatelessWidget {
  const _InteractiveListSheet({required this.sections, required this.onSelect});

  final List<ChatInteractiveSection> sections;
  final ValueChanged<ChatInteractiveButton> onSelect;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final screen = MediaQuery.sizeOf(context);
    final maxWidth = screen.width < 560 ? screen.width : 520.0;
    final title = _interactiveSheetTitle(sections);
    return Align(
      alignment: Alignment.bottomCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: maxWidth,
          maxHeight: screen.height * 0.88,
        ),
        child: Material(
          color: wa.isDark ? const Color(0xFF111B21) : Colors.white,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
          clipBehavior: Clip.antiAlias,
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
                  child: Row(
                    children: [
                      IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close_rounded),
                        tooltip: 'Fechar',
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: wa.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0,
                            wordSpacing: 0,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    padding: const EdgeInsets.fromLTRB(18, 6, 18, 24),
                    children: [
                      for (final section in sections)
                        if (section.rows.isNotEmpty) ...[
                          if (section.title.trim().isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.fromLTRB(0, 8, 0, 7),
                              child: Text(
                                _cleanInteractiveText(section.title),
                                style: TextStyle(
                                  color: wa.textMuted,
                                  fontSize: 13.5,
                                  height: 1.1,
                                  letterSpacing: 0,
                                  wordSpacing: 0,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          for (final row in section.rows)
                            _InteractiveListRow(row: row, onSelect: onSelect),
                        ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InteractiveListRow extends StatelessWidget {
  const _InteractiveListRow({required this.row, required this.onSelect});

  final ChatInteractiveButton row;
  final ValueChanged<ChatInteractiveButton> onSelect;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final description = _cleanInteractiveText(row.description ?? '');
    return InkWell(
      onTap: () => onSelect(row),
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 13, 6, 13),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: wa.isDark
                  ? const Color(0xFF2A3942)
                  : const Color(0xFFE5E8EA),
            ),
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _cleanInteractiveText(row.title),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: 16,
                      height: 1.18,
                      letterSpacing: 0,
                      wordSpacing: 0,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: wa.textMuted,
                        fontSize: 14,
                        height: 1.2,
                        letterSpacing: 0,
                        wordSpacing: 0,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 14),
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: wa.textMuted.withValues(alpha: 0.72),
                  width: 2,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InteractiveHeaderData {
  const _InteractiveHeaderData({
    required this.type,
    this.url,
    this.fallbackUrl,
    this.dataUrl,
    this.mimeType,
    this.fileName,
  });

  final String type;
  final String? url;
  final String? fallbackUrl;
  final String? dataUrl;
  final String? mimeType;
  final String? fileName;

  _InteractiveHeaderData withFallback(String? value) {
    final fallback = value?.trim();
    if (fallback == null ||
        fallback.isEmpty ||
        fallback == url ||
        fallback == fallbackUrl) {
      return this;
    }
    return _InteractiveHeaderData(
      type: type,
      url: url,
      fallbackUrl: fallback,
      dataUrl: dataUrl,
      mimeType: mimeType,
      fileName: fileName,
    );
  }
}

class _InteractiveCardData {
  const _InteractiveCardData({
    required this.title,
    required this.body,
    required this.footer,
    required this.buttons,
    required this.sections,
    required this.listButtonText,
    this.header,
  });

  final String title;
  final String body;
  final String footer;
  final _InteractiveHeaderData? header;
  final List<ChatInteractiveButton> buttons;
  final List<ChatInteractiveSection> sections;
  final String listButtonText;
}

String _interactiveTitleText(ChatMessage message) {
  final media = message.media;
  final header = _asRecord(media['header'] ?? media['Header']);
  return _cleanInteractiveText(
    _firstNonEmptyString([
          message.mediaTitle,
          media['title'],
          media['Title'],
          header?['text'],
          header?['Text'],
          header?['title'],
          header?['Title'],
        ]) ??
        '',
  );
}

String _interactiveBodyText(ChatMessage message) {
  final media = message.media;
  return _cleanInteractiveText(
    _firstNonEmptyString([
          media['body'],
          media['Body'],
          media['description'],
          media['Description'],
          media['caption'],
          media['Caption'],
          media['text'],
          media['Text'],
          message.displayText,
        ]) ??
        '',
  );
}

String _interactiveFooterText(ChatMessage message) {
  final media = message.media;
  return _cleanInteractiveText(
    _firstNonEmptyString([
          message.interactiveFooter,
          media['footer'],
          media['Footer'],
          media['footerText'],
          media['FooterText'],
        ]) ??
        '',
  );
}

_InteractiveHeaderData? _interactiveHeaderData(ChatMessage message) {
  final media = message.media;
  final youtubeFallback = _youtubeThumbnailFromText(
    '${_interactiveTitleText(message)}\n${_interactiveBodyText(message)}',
  );
  final records = <Map<String, dynamic>?>[
    _asRecord(media['headerMedia'] ?? media['HeaderMedia']),
    _asRecord(media['media'] ?? media['Media']),
    _asRecord(media['header'] ?? media['Header']),
    media,
  ];
  final mediaProxyUrl = _firstNonEmptyString([
    media['mediaProxyUrl'],
    media['MediaProxyUrl'],
  ]);
  final mediaFallbackUrl = _firstNonEmptyString([
    media['fallbackUrl'],
    media['FallbackUrl'],
    media['mediaSourceUrl'],
    media['MediaSourceUrl'],
  ]);
  for (final record in records) {
    final parsed = _interactiveHeaderDataFromRecord(record);
    if (parsed != null) {
      return parsed.withFallback(
        mediaFallbackUrl ?? mediaProxyUrl ?? youtubeFallback,
      );
    }
  }

  // Interactive messages can retain a stale mediaUrl from older records.
  // Only use the message-level fallback when the message itself is media;
  // a header media record is handled above and remains valid for buttons.
  final fallbackAllowed = const {
    'image',
    'video',
    'document',
    'sticker',
  }.contains(message.normalizedType);
  final fallback = fallbackAllowed
      ? (message.mediaThumbnailUrl ?? message.mediaUrl)
      : null;
  if (fallback == null || fallback.trim().isEmpty) {
    if (youtubeFallback == null) return null;
    return _InteractiveHeaderData(type: 'image', url: youtubeFallback);
  }
  final mime = (message.mediaMimeType ?? '').toLowerCase();
  final type = mime.contains('video')
      ? 'video'
      : mime.contains('document') ||
            mime.contains('pdf') ||
            mime.contains('application/')
      ? 'document'
      : 'image';
  if (type == 'document') {
    return _InteractiveHeaderData(
      type: type,
      url: _absoluteMediaUrl(fallback),
      fallbackUrl: youtubeFallback,
      mimeType: message.mediaMimeType,
      fileName: message.mediaFileName,
    );
  }
  return _InteractiveHeaderData(
    type: type,
    url: _absoluteMediaUrl(fallback),
    fallbackUrl: youtubeFallback,
    mimeType: message.mediaMimeType,
    fileName: message.mediaFileName,
  );
}

_InteractiveHeaderData? _interactiveHeaderDataFromRecord(
  Map<String, dynamic>? record,
) {
  if (record == null || record.isEmpty) return null;
  final rawType =
      _firstNonEmptyString([
        record['mediaType'],
        record['MediaType'],
        record['type'],
        record['Type'],
        record['kind'],
        record['Kind'],
      ]) ??
      '';
  final mime =
      _firstNonEmptyString([
        record['mimeType'],
        record['MimeType'],
        record['mimetype'],
        record['Mimetype'],
      ]) ??
      '';
  final fileName = _firstNonEmptyString([
    record['fileName'],
    record['FileName'],
    record['filename'],
    record['Filename'],
    record['name'],
    record['Name'],
  ]);
  final dataUrl = _firstNonEmptyString([record['dataUrl'], record['DataUrl']]);
  final rawMedia = _firstNonEmptyString([
    record['sourceUrl'],
    record['SourceUrl'],
    record['url'],
    record['URL'],
    record['mediaUrl'],
    record['MediaUrl'],
    record['link'],
    record['Link'],
    record['thumbnailUrl'],
    record['ThumbnailUrl'],
    record['thumbnail'],
    record['Thumbnail'],
    record['jpegThumbnail'],
    record['JpegThumbnail'],
    record['thumbnailDirectPath'],
    record['ThumbnailDirectPath'],
    record['directPath'],
    record['DirectPath'],
    record['media'],
    record['Media'],
  ]);
  final rawDataUrl = dataUrl ?? _dataUrlFromMaybeBase64(rawMedia, mime);
  final rawTypeLower = rawType.toLowerCase();
  final hasNonMediaType =
      rawTypeLower.isNotEmpty &&
      !rawTypeLower.contains('image') &&
      !rawTypeLower.contains('picture') &&
      !rawTypeLower.contains('video') &&
      !rawTypeLower.contains('document') &&
      !rawTypeLower.contains('file');
  if (hasNonMediaType) return null;
  final mediaUrl = rawMedia == null || rawDataUrl != null
      ? null
      : _absoluteMediaUrl(rawMedia);
  if ((dataUrl == null || dataUrl.isEmpty) &&
      (rawDataUrl == null || rawDataUrl.isEmpty) &&
      (mediaUrl == null || mediaUrl.isEmpty)) {
    return null;
  }

  final source = '$rawType $mime ${rawMedia ?? ''}'.toLowerCase();
  final type = source.contains('video')
      ? 'video'
      : source.contains('document') ||
            source.contains('pdf') ||
            source.contains('application/')
      ? 'document'
      : 'image';
  return _InteractiveHeaderData(
    type: type,
    url: mediaUrl,
    dataUrl: rawDataUrl,
    mimeType: mime.isEmpty ? null : mime,
    fileName: fileName,
  );
}

List<_InteractiveCardData> _interactiveCards(ChatMessage message) {
  final cardRecords = _interactiveCardRecords(message.media);
  return cardRecords
      .map((record) {
        final buttonRecords = _interactiveButtonRecords(record);
        final buttons = _parseInteractiveButtonsFromRecords(
          buttonRecords,
          skipListContainers: true,
        );
        final sections = _dedupeInteractiveSections([
          ..._parseInteractiveSectionsFromRecords([record]),
          ..._parseInteractiveSectionsFromRecords(buttonRecords),
        ]);
        return _InteractiveCardData(
          title: _cleanInteractiveText(
            _firstNonEmptyString([record['title'], record['Title']]) ?? '',
          ),
          body: _cleanInteractiveText(
            _firstNonEmptyString([
                  record['body'],
                  record['Body'],
                  record['description'],
                  record['Description'],
                  record['caption'],
                  record['Caption'],
                  record['text'],
                  record['Text'],
                ]) ??
                '',
          ),
          footer: _cleanInteractiveText(
            _firstNonEmptyString([
                  record['footer'],
                  record['Footer'],
                  record['footerText'],
                  record['FooterText'],
                ]) ??
                '',
          ),
          header: _interactiveHeaderDataFromRecord(
            _asRecord(record['headerMedia'] ?? record['HeaderMedia']) ??
                _asRecord(record['media'] ?? record['Media']),
          ),
          buttons: buttons,
          sections: sections,
          listButtonText: _interactiveListButtonTextFromRecord(
            record,
            sections,
            buttonRecords: buttonRecords,
          ),
        );
      })
      .where(
        (card) =>
            card.title.isNotEmpty ||
            card.body.isNotEmpty ||
            card.header != null ||
            card.buttons.isNotEmpty ||
            card.sections.any((section) => section.rows.isNotEmpty),
      )
      .toList(growable: false);
}

List<ChatInteractiveButton> _interactiveButtons(ChatMessage message) {
  final rawButtons = _parseInteractiveButtonsFromRecords(
    _interactiveButtonRecords(message.media),
    skipListContainers: true,
  );
  if (rawButtons.isNotEmpty) return rawButtons;
  return message.interactiveButtons
      .where((button) => button.title.trim().isNotEmpty)
      .toList(growable: false);
}

List<ChatInteractiveSection> _interactiveSections(ChatMessage message) {
  return _dedupeInteractiveSections([
    ...message.interactiveSections,
    ..._parseInteractiveSectionsFromRecords([message.media]),
    ..._parseInteractiveSectionsFromRecords(
      _interactiveButtonRecords(message.media),
    ),
  ]);
}

List<Map<String, dynamic>> _interactiveButtonRecords(
  Map<String, dynamic> record,
) {
  final nativeFlow = _asRecord(record['nativeFlow'] ?? record['NativeFlow']);
  final nativeFlowMessage = _asRecord(
    record['nativeFlowMessage'] ?? record['NativeFlowMessage'],
  );
  final interactive = _asRecord(
    record['interactive'] ??
        record['Interactive'] ??
        record['interactiveMessage'],
  );
  final interactiveNativeFlow = _asRecord(
    interactive?['nativeFlowMessage'] ?? interactive?['NativeFlowMessage'],
  );
  return [
    ..._recordList(record['buttons'] ?? record['Buttons']),
    ..._recordList(record['hydratedButtons'] ?? record['HydratedButtons']),
    ..._recordList(record['templateButtons'] ?? record['TemplateButtons']),
    ..._recordList(nativeFlow?['buttons'] ?? nativeFlow?['Buttons']),
    ..._recordList(
      nativeFlowMessage?['buttons'] ?? nativeFlowMessage?['Buttons'],
    ),
    ..._recordList(
      interactiveNativeFlow?['buttons'] ?? interactiveNativeFlow?['Buttons'],
    ),
  ];
}

List<Map<String, dynamic>> _interactiveCardRecords(Map<String, dynamic> media) {
  final carousel = _asRecord(media['carousel'] ?? media['Carousel']);
  final carouselMessage = _asRecord(
    media['carouselMessage'] ?? media['CarouselMessage'],
  );
  final interactive = _asRecord(
    media['interactive'] ?? media['Interactive'] ?? media['interactiveMessage'],
  );
  final interactiveCarousel = _asRecord(
    interactive?['carouselMessage'] ?? interactive?['CarouselMessage'],
  );
  return [
    ..._recordList(media['cards'] ?? media['Cards']),
    ..._recordList(carousel?['cards'] ?? carousel?['Cards']),
    ..._recordList(carouselMessage?['cards'] ?? carouselMessage?['Cards']),
    ..._recordList(
      interactiveCarousel?['cards'] ?? interactiveCarousel?['Cards'],
    ),
  ];
}

String _interactiveListButtonText(
  ChatMessage? message,
  List<ChatInteractiveSection> sections, {
  List<Map<String, dynamic>> buttonRecords = const [],
}) {
  final media = message?.media ?? const <String, dynamic>{};
  final candidates = <Object?>[
    ..._interactiveListButtonCandidatesFromRecord(media),
    for (final record in buttonRecords)
      if (_recordHasInteractiveSections(record))
        ..._interactiveListButtonCandidatesFromRecord(record),
    if (sections.length == 1) sections.first.title,
  ];
  for (final candidate in candidates) {
    final text = _cleanInteractiveText(candidate?.toString() ?? '');
    if (text.isNotEmpty) return text;
  }
  return 'Ver opções';
}

String _interactiveListButtonTextFromRecord(
  Map<String, dynamic> record,
  List<ChatInteractiveSection> sections, {
  List<Map<String, dynamic>> buttonRecords = const [],
}) {
  final candidates = <Object?>[
    for (final buttonRecord in buttonRecords)
      if (_recordHasInteractiveSections(buttonRecord))
        ..._interactiveListButtonCandidatesFromRecord(buttonRecord),
    ..._interactiveListButtonCandidatesFromRecord(record),
    if (sections.length == 1) sections.first.title,
  ];
  for (final candidate in candidates) {
    final text = _cleanInteractiveText(candidate?.toString() ?? '');
    if (text.isNotEmpty) return text;
  }
  return 'Ver opções';
}

List<Object?> _interactiveListButtonCandidatesFromRecord(
  Map<String, dynamic> record,
) {
  if (record.isEmpty) return const [];
  final normalized = _normalizedInteractiveRecord(record);
  final params = _asRecord(normalized['params'] ?? normalized['Params']);
  final list = _asRecord(normalized['list'] ?? normalized['List']);
  final nativeFlow = _asRecord(
    normalized['nativeFlow'] ?? normalized['NativeFlow'],
  );
  final nativeFlowMessage = _asRecord(
    normalized['nativeFlowMessage'] ?? normalized['NativeFlowMessage'],
  );
  return [
    normalized['buttonText'],
    normalized['button_text'],
    normalized['ButtonText'],
    normalized['displayText'],
    normalized['display_text'],
    normalized['DisplayText'],
    normalized['text'],
    normalized['Text'],
    normalized['title'],
    normalized['Title'],
    normalized['cta'],
    normalized['callToAction'],
    params?['buttonText'],
    params?['button_text'],
    params?['displayText'],
    params?['display_text'],
    params?['title'],
    params?['cta'],
    params?['callToAction'],
    list?['buttonText'],
    list?['button_text'],
    list?['displayText'],
    list?['display_text'],
    list?['title'],
    nativeFlow?['buttonText'],
    nativeFlow?['button_text'],
    nativeFlow?['displayText'],
    nativeFlow?['display_text'],
    nativeFlowMessage?['buttonText'],
    nativeFlowMessage?['button_text'],
    nativeFlowMessage?['displayText'],
    nativeFlowMessage?['display_text'],
  ];
}

String _interactiveSheetTitle(List<ChatInteractiveSection> sections) {
  final visible = sections
      .map((section) => _cleanInteractiveText(section.title))
      .where((title) => title.isNotEmpty)
      .toList(growable: false);
  if (visible.length == 1) return visible.first;
  return 'Ver opções';
}

IconData _interactiveButtonIcon(ChatInteractiveButton button) {
  if ((button.copyCode ?? '').trim().isNotEmpty ||
      (button.type ?? '').toLowerCase().contains('copy')) {
    return Icons.content_copy_rounded;
  }
  if (!_isExplicitReplyButton(button) && (button.url ?? '').trim().isNotEmpty) {
    return Icons.open_in_new_rounded;
  }
  if ((button.phoneNumber ?? '').trim().isNotEmpty) {
    return Icons.phone_rounded;
  }
  final type = (button.type ?? '').toLowerCase();
  if (type.contains('call')) return Icons.phone_rounded;
  if (type.contains('flow')) return Icons.dynamic_form_rounded;
  return Icons.reply_rounded;
}

bool _isExplicitReplyButton(ChatInteractiveButton button) {
  final type = (button.type ?? '')
      .trim()
      .toLowerCase()
      .replaceAll('-', '_')
      .replaceAll(' ', '_');
  return type == 'reply' ||
      type == 'quick_reply' ||
      type == 'quickreply' ||
      type == 'reply_button' ||
      type == 'button_reply';
}

String _cleanInteractiveText(String value) {
  if (value.trim().isEmpty) return '';
  switch (value.trim().toUpperCase()) {
    case '__LOCALIZE:FLOWS_COMPLETE_FORM_BUTTON_TITLE':
    case 'FLOWS_COMPLETE_FORM_BUTTON_TITLE':
      return 'Preencher formulário';
    case '__LOCALIZE:FLOWS_SUBMIT_BUTTON_TITLE':
    case 'FLOWS_SUBMIT_BUTTON_TITLE':
      return 'Enviar';
  }
  var text = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  text = text.replaceAllMapped(
    RegExp(r'\*([^*\n]{1,260})\*'),
    (match) => (match.group(1) ?? '').trim(),
  );
  text = text.replaceAllMapped(
    RegExp(r'~([^~\n]{1,260})~'),
    (match) => (match.group(1) ?? '').trim(),
  );
  final lines = text
      .split('\n')
      .map(
        (line) => line
            // Captions from different webhook providers may contain NBSP,
            // thin spaces or tabs.  Normalize every horizontal separator so
            // Flutter never renders a balloon with artificial word gaps.
            .replaceAll(RegExp(r'[^\S\r\n]+'), ' ')
            .trim(),
      )
      .toList();
  final normalized = <String>[];
  var blank = false;
  for (final line in lines) {
    if (line.isEmpty) {
      if (!blank && normalized.isNotEmpty) normalized.add('');
      blank = true;
      continue;
    }
    normalized.add(line);
    blank = false;
  }
  return normalized.join('\n').trim();
}

String? _youtubeThumbnailFromText(String value) {
  final patterns = [
    RegExp(
      r'(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{8,})',
      caseSensitive: false,
    ),
    RegExp(r'[?&]v=([A-Za-z0-9_-]{8,})', caseSensitive: false),
  ];
  for (final pattern in patterns) {
    final match = pattern.firstMatch(value);
    final id = match?.group(1);
    if (id == null || id.isEmpty) continue;
    final normalized = id.length > 11 ? id.substring(0, 11) : id;
    return 'https://img.youtube.com/vi/$normalized/hqdefault.jpg';
  }
  return null;
}

String? _interactivePlayQuery(
  ChatMessage message, {
  required List<ChatInteractiveButton> displayButtons,
}) {
  final labels = displayButtons
      .map((button) => button.title.trim().toLowerCase())
      .where((label) => label.isNotEmpty)
      .toList(growable: false);
  final body = _interactiveBodyText(message).toLowerCase();
  final isPlayCard =
      (labels.any((label) => label.contains('mp3')) &&
          labels.any((label) => label.contains('mp4'))) ||
      body.contains('escolha o formato para baixar');
  if (!isPlayCard) return null;

  final quoted = message.quoted?.text?.trim() ?? '';
  final quotedMatch = RegExp(
    r'^\s*[!/.#](?:play|musica|music|mp3|ytmp3|video|mp4|ytmp4)\s+(.+)$',
    caseSensitive: false,
    dotAll: true,
  ).firstMatch(quoted);
  final quotedQuery = quotedMatch?.group(1)?.trim();
  if (quotedQuery != null && quotedQuery.isNotEmpty) return quotedQuery;

  final title = _interactiveTitleText(
    message,
  ).replaceFirst(RegExp(r'^\s*🎵\s*'), '').trim();
  if (title.isNotEmpty) return title;

  final bodyTitle = _interactiveBodyText(message)
      .split('\n')
      .firstWhere(
        (line) =>
            line.trim().isNotEmpty &&
            !line.toLowerCase().contains('escolha o formato'),
        orElse: () => '',
      )
      .replaceFirst(RegExp(r'^\s*🎵\s*'), '')
      .trim();
  return bodyTitle.isEmpty ? null : bodyTitle;
}

String? _dataUrlFromMaybeBase64(String? value, String mimeType) {
  final raw = value?.trim();
  if (raw == null || raw.isEmpty) return null;
  if (raw.startsWith('data:image/')) return raw;
  if (raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('/') ||
      raw.startsWith('blob:')) {
    return null;
  }
  if (raw.length < 80 || raw.length > 200000) return null;
  if (!RegExp(r'^[A-Za-z0-9+/=\s_-]+$').hasMatch(raw)) return null;
  final clean = raw.replaceAll(RegExp(r'\s+'), '');
  try {
    final bytes = base64Decode(base64.normalize(clean));
    if (bytes.length < 24) return null;
    final mime = mimeType.toLowerCase().contains('png')
        ? 'image/png'
        : mimeType.toLowerCase().contains('webp')
        ? 'image/webp'
        : 'image/jpeg';
    return 'data:$mime;base64,${base64Encode(bytes)}';
  } catch (_) {
    return null;
  }
}

List<ChatInteractiveButton> _parseInteractiveButtonsFromRecords(
  List<Map<String, dynamic>> records, {
  String responseType = 'button',
  bool skipListContainers = false,
}) {
  final result = <ChatInteractiveButton>[];
  final seen = <String>{};
  for (final record in records) {
    if (skipListContainers && _recordHasInteractiveSections(record)) continue;
    final normalized = _normalizedInteractiveRecord(record);
    final params = _asRecord(normalized['params'] ?? normalized['Params']);
    final title = _cleanInteractiveText(
      _firstNonEmptyString([
            normalized['title'],
            normalized['Title'],
            normalized['text'],
            normalized['Text'],
            normalized['displayText'],
            normalized['display_text'],
            normalized['DisplayText'],
            normalized['buttonText'],
            normalized['button_text'],
            normalized['ButtonText'],
            normalized['flowCta'],
            normalized['flow_cta'],
            params?['title'],
            params?['displayText'],
            params?['display_text'],
            params?['buttonText'],
            params?['button_text'],
            params?['flow_cta'],
            normalized['name'],
            normalized['Name'],
          ]) ??
          '',
    );
    final copyCode = _firstNonEmptyString([
      normalized['copyCode'],
      normalized['CopyCode'],
      normalized['copy_code'],
      normalized['clipboardText'],
      normalized['clipboard_text'],
      params?['copyCode'],
      params?['copy_code'],
      params?['clipboardText'],
      params?['clipboard_text'],
    ]);
    if (title.isEmpty && (copyCode == null || copyCode.isEmpty)) continue;
    final id =
        _firstNonEmptyString([
          normalized['id'],
          normalized['Id'],
          normalized['buttonId'],
          normalized['ButtonId'],
          normalized['selectedId'],
          normalized['payload'],
          normalized['rowId'],
          normalized['RowId'],
          params?['id'],
          params?['buttonId'],
          params?['rowId'],
          title,
          copyCode,
        ]) ??
        title;
    final key = '$responseType:$id';
    if (!seen.add(key)) continue;
    final rawButtonType = _firstNonEmptyString([
      normalized['type'],
      normalized['Type'],
      normalized['name'],
      normalized['Name'],
      normalized['buttonType'],
      normalized['button_type'],
      params?['type'],
    ]);
    final normalizedButtonType = (rawButtonType ?? '')
        .trim()
        .toLowerCase()
        .replaceAll('-', '_')
        .replaceAll(' ', '_');
    final isCtaButton = const {
      'cta_url',
      'url',
      'link',
      'cta_copy',
      'copy',
      'copy_code',
      'phone',
      'call',
    }.contains(normalizedButtonType);
    final flowId = _firstNonEmptyString([
      normalized['flowId'],
      normalized['flow_id'],
      params?['flowId'],
      params?['flow_id'],
      _asRecord(normalized['flow'])?['flowId'],
      _asRecord(normalized['flow'])?['id'],
    ]);
    final isFlowButton =
        flowId != null ||
        normalizedButtonType == 'galaxy_message' ||
        params?['form_type'] == 'template';
    final isReplyButton = !isCtaButton && !isFlowButton;
    final buttonType = isFlowButton
        ? 'flow'
        : isReplyButton
        ? 'reply'
        : rawButtonType;
    final directUrl = _firstNonEmptyString([
      normalized['url'],
      normalized['URL'],
      normalized['href'],
      params?['url'],
      params?['URL'],
      params?['href'],
    ]);
    final looseUrl = _firstNonEmptyString([
      normalized['link'],
      normalized['merchantUrl'],
      normalized['merchant_url'],
      normalized['MerchantUrl'],
      params?['link'],
      params?['merchantUrl'],
      params?['merchant_url'],
      _firstListString(normalized['links']),
      _firstListString(params?['links']),
    ]);
    final buttonUrl = isReplyButton
        ? null
        : directUrl ??
              (looseUrl != null &&
                      RegExp(
                        r'^https?://',
                        caseSensitive: false,
                      ).hasMatch(looseUrl)
                  ? looseUrl
                  : null);
    result.add(
      ChatInteractiveButton(
        id: id,
        title: title.isEmpty ? 'Copiar código' : title,
        description: _firstNonEmptyString([
          normalized['description'],
          normalized['Description'],
          normalized['subtitle'],
          normalized['Subtitle'],
          params?['description'],
          params?['subtitle'],
        ]),
        type: buttonType,
        url: buttonUrl,
        phoneNumber: _firstNonEmptyString([
          normalized['phoneNumber'],
          normalized['phone_number'],
          normalized['PhoneNumber'],
          normalized['phone'],
          normalized['Phone'],
          params?['phoneNumber'],
          params?['phone_number'],
          params?['phone'],
        ]),
        copyCode: copyCode,
        responseType: responseType,
      ),
    );
  }
  return result;
}

List<ChatInteractiveSection> _parseInteractiveSectionsFromRecords(
  List<Map<String, dynamic>> records,
) {
  final sections = <ChatInteractiveSection>[];
  for (final record in records) {
    final normalized = _normalizedInteractiveRecord(record);
    final params = _asRecord(normalized['params'] ?? normalized['Params']);
    final list = _asRecord(normalized['list'] ?? normalized['List']);
    final nativeFlow = _asRecord(
      normalized['nativeFlow'] ?? normalized['NativeFlow'],
    );
    final nativeFlowMessage = _asRecord(
      normalized['nativeFlowMessage'] ?? normalized['NativeFlowMessage'],
    );
    final sectionRecords = [
      ..._recordList(normalized['sections'] ?? normalized['Sections']),
      ..._recordList(params?['sections'] ?? params?['Sections']),
      ..._recordList(list?['sections'] ?? list?['Sections']),
      ..._recordList(nativeFlow?['sections'] ?? nativeFlow?['Sections']),
      ..._recordList(
        nativeFlowMessage?['sections'] ?? nativeFlowMessage?['Sections'],
      ),
    ];
    for (final section in sectionRecords) {
      final rows = _parseInteractiveButtonsFromRecords(
        _recordList(section['rows'] ?? section['Rows']),
        responseType: 'list',
      );
      if (rows.isEmpty) continue;
      sections.add(
        ChatInteractiveSection(
          title: _cleanInteractiveText(
            _firstNonEmptyString([
                  section['title'],
                  section['Title'],
                  section['name'],
                  section['Name'],
                  section['label'],
                  section['Label'],
                ]) ??
                '',
          ),
          rows: rows,
        ),
      );
    }

    final directRows = _parseInteractiveButtonsFromRecords(
      _recordList(normalized['rows'] ?? normalized['Rows']),
      responseType: 'list',
    );
    if (directRows.isNotEmpty) {
      sections.add(
        ChatInteractiveSection(
          title: _cleanInteractiveText(
            _firstNonEmptyString([
                  normalized['title'],
                  normalized['Title'],
                  normalized['name'],
                  normalized['Name'],
                  params?['title'],
                ]) ??
                '',
          ),
          rows: directRows,
        ),
      );
    }
  }
  return _dedupeInteractiveSections(sections);
}

bool _recordHasInteractiveSections(Map<String, dynamic> record) {
  return _parseInteractiveSectionsFromRecords([
    record,
  ]).any((section) => section.rows.isNotEmpty);
}

Map<String, dynamic> _normalizedInteractiveRecord(Map<String, dynamic> record) {
  final parsedParams = _parseJsonRecord(
    record['buttonParamsJson'] ??
        record['buttonParamsJSON'] ??
        record['paramsJson'] ??
        record['paramsJSON'] ??
        record['params_json'],
  );
  final params = _asRecord(record['params'] ?? record['Params']);
  final normalized = <String, dynamic>{...?parsedParams, ...record};
  if (params != null || parsedParams != null) {
    normalized['params'] = <String, dynamic>{...?parsedParams, ...?params};
  }
  return normalized;
}

Map<String, dynamic>? _parseJsonRecord(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  final raw = value?.toString().trim();
  if (raw == null || raw.isEmpty || !raw.startsWith('{')) return null;
  try {
    final decoded = jsonDecode(raw);
    if (decoded is Map) return Map<String, dynamic>.from(decoded);
  } catch (_) {
    return null;
  }
  return null;
}

List<ChatInteractiveSection> _dedupeInteractiveSections(
  List<ChatInteractiveSection> sections,
) {
  final seenRows = <String>{};
  final result = <ChatInteractiveSection>[];
  for (final section in sections) {
    final rows = <ChatInteractiveButton>[];
    for (final row in section.rows) {
      final key =
          '${row.responseType}:${row.id.trim().toLowerCase()}:${row.title.trim().toLowerCase()}';
      if (!seenRows.add(key)) continue;
      rows.add(row);
    }
    if (rows.isEmpty) continue;
    result.add(ChatInteractiveSection(title: section.title, rows: rows));
  }
  return result;
}

Map<String, dynamic>? _asRecord(Object? value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  return null;
}

List<Map<String, dynamic>> _recordList(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((entry) => Map<String, dynamic>.from(entry))
      .toList(growable: false);
}

String? _firstNonEmptyString(Iterable<Object?> values) {
  for (final value in values) {
    final text = value?.toString().trim() ?? '';
    if (text.isNotEmpty) return text;
  }
  return null;
}

double? _firstFiniteDouble(Iterable<Object?> values) {
  for (final value in values) {
    final parsed = value is num
        ? value.toDouble()
        : double.tryParse(value?.toString().trim() ?? '');
    if (parsed != null && parsed.isFinite) return parsed;
  }
  return null;
}

String? _firstListString(Object? value) {
  if (value is Iterable) {
    for (final entry in value) {
      final text = entry?.toString().trim() ?? '';
      if (text.isNotEmpty) return text;
    }
  }
  return null;
}

Uint8List? _decodeDataImage(String? dataUrl) {
  if (dataUrl == null || dataUrl.trim().isEmpty) return null;
  final raw = dataUrl.trim();
  final comma = raw.indexOf(',');
  final payload = comma >= 0 ? raw.substring(comma + 1) : raw;
  if (payload.length < 24) return null;
  try {
    return base64Decode(payload);
  } catch (_) {
    return null;
  }
}

class _MediaFallback extends StatelessWidget {
  const _MediaFallback({required this.message, this.url});

  final ChatMessage message;
  final String? url;

  @override
  Widget build(BuildContext context) {
    final type = _mediaKind(message);
    final icon = switch (type) {
      'image' => Icons.image_rounded,
      'video' => Icons.play_circle_rounded,
      'audio' => Icons.graphic_eq_rounded,
      'sticker' => Icons.auto_awesome_motion_rounded,
      'document' => Icons.description_rounded,
      'undecryptable' => Icons.lock_clock_rounded,
      'interactive' => Icons.smart_button_rounded,
      'contact' => Icons.contact_phone_rounded,
      'location' => Icons.location_on_rounded,
      'poll' => Icons.poll_rounded,
      _ => Icons.description_rounded,
    };
    final title =
        message.mediaTitle ?? message.mediaFileName ?? _mediaKindLabel(type);
    final subtitle = [
      message.mediaMimeType,
      if (message.mediaSizeBytes != null)
        _formatMediaSize(message.mediaSizeBytes!),
    ].whereType<String>().where((value) => value.isNotEmpty).join(' · ');
    return _OpenableMedia(
      url: url,
      openInViewer: false,
      child: Container(
        constraints: BoxConstraints(maxWidth: 320),
        padding: EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: const Color(0x14000000),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 20,
              backgroundColor: const Color(0x1F008069),
              foregroundColor: const Color(0xFF008069),
              child: Icon(icon, size: 22),
            ),
            SizedBox(width: 10),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: WaTheme.of(context).textPrimary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (subtitle.isNotEmpty)
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: WaTheme.of(context).textMuted,
                        fontSize: 12,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VideoPreview extends StatelessWidget {
  const _VideoPreview({required this.message, required this.url});

  final ChatMessage message;
  final String? url;

  @override
  Widget build(BuildContext context) {
    if (url != null && url!.trim().isNotEmpty) {
      return InlineVideoPlayer(
        url: url!,
        width: 300,
        height: 178,
        title: message.mediaFileName ?? message.mediaTitle ?? 'Vídeo',
        mimeType: message.mediaMimeType ?? 'video/mp4',
        autoplayLoopMuted: message.isAnimatedMedia,
      );
    }
    return _OpenableMedia(
      url: url,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        width: 300,
        height: 170,
        decoration: BoxDecoration(
          color: const Color(0xFF202C33),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Stack(
          children: [
            Center(
              child: CircleAvatar(
                radius: 27,
                backgroundColor: Color(0xCCFFFFFF),
                foregroundColor: Color(0xFF111B21),
                child: Icon(Icons.play_arrow_rounded, size: 36),
              ),
            ),
            Positioned(
              left: 10,
              right: 10,
              bottom: 10,
              child: Text(
                message.mediaFileName ?? 'Vídeo',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                  shadows: [Shadow(color: Colors.black54, blurRadius: 4)],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AudioPreview extends StatelessWidget {
  const _AudioPreview({required this.message, required this.url});

  final ChatMessage message;
  final String? url;

  @override
  Widget build(BuildContext context) {
    if (url != null && url!.trim().isNotEmpty) {
      return SizedBox(
        width: 300,
        // The slider plus its elapsed/total row needs a real bounded height.
        // Constraining this to 66 px caused Android to paint only the grey
        // container while the audio controls were clipped during layout.
        height: 82,
        child: InlineAudioPlayer(
          key: ValueKey('chat-audio-${message.identityKey}-$url'),
          url: url!,
          title: message.mediaFileName ?? message.mediaTitle,
          compact: true,
          mimeType: message.mediaMimeType ?? 'audio/ogg',
          durationSeconds: message.mediaDurationSeconds,
        ),
      );
    }
    return _OpenableMedia(
      url: url,
      child: Container(
        constraints: BoxConstraints(maxWidth: 320),
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Color(0x14000000),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.play_arrow_rounded,
              size: 30,
              color: WaTheme.of(context).textPrimary,
            ),
            SizedBox(width: 8),
            _WaveformPreview(),
            SizedBox(width: 8),
            Flexible(
              child: Text(
                message.mediaFileName ?? 'Áudio',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: WaTheme.of(context).textMuted,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WaveformPreview extends StatelessWidget {
  const _WaveformPreview();

  @override
  Widget build(BuildContext context) {
    const bars = [
      10.0,
      14.0,
      18.0,
      12.0,
      21.0,
      16.0,
      10.0,
      18.0,
      13.0,
      20.0,
      15.0,
      11.0,
    ];
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final height in bars)
          Container(
            width: 3,
            height: height,
            margin: const EdgeInsets.symmetric(horizontal: 1.5),
            decoration: BoxDecoration(
              color: const Color(0xFF9AA6AD),
              borderRadius: BorderRadius.circular(4),
            ),
          ),
      ],
    );
  }
}

class _OpenableMedia extends StatelessWidget {
  const _OpenableMedia({
    required this.child,
    this.url,
    this.fallbackUrl,
    this.borderRadius,
    this.openInViewer = true,
  });

  final Widget child;
  final String? url;
  final String? fallbackUrl;
  final BorderRadius? borderRadius;
  final bool openInViewer;

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.trim().isEmpty) return child;
    return InkWell(
      borderRadius: borderRadius ?? BorderRadius.circular(8),
      onTap: () => openInViewer
          ? _openMediaViewer(context, url!, fallbackUrl: fallbackUrl)
          : _openExternalUrl(url!),
      child: child,
    );
  }
}

Future<void> _openMediaViewer(
  BuildContext context,
  String url, {
  String? fallbackUrl,
}) {
  final fallback = fallbackUrl?.trim();
  return showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.86),
    builder: (context) => Dialog.fullscreen(
      backgroundColor: Colors.transparent,
      child: Stack(
        children: [
          Positioned.fill(
            child: InteractiveViewer(
              minScale: 0.75,
              maxScale: 4,
              child: Center(
                child: AuthenticatedMediaImage(
                  url: url,
                  fit: BoxFit.contain,
                  placeholder: const Center(
                    child: CircularProgressIndicator(color: Colors.white),
                  ),
                  errorWidget:
                      fallback != null && fallback.isNotEmpty && fallback != url
                      ? AuthenticatedMediaImage(
                          url: fallback,
                          fit: BoxFit.contain,
                          placeholder: const Center(
                            child: CircularProgressIndicator(
                              color: Colors.white,
                            ),
                          ),
                          errorWidget: const Icon(
                            Icons.broken_image_rounded,
                            color: Colors.white,
                            size: 52,
                          ),
                        )
                      : const Icon(
                          Icons.broken_image_rounded,
                          color: Colors.white,
                          size: 52,
                        ),
                ),
              ),
            ),
          ),
          Positioned(
            top: 18,
            right: 18,
            child: IconButton.filled(
              onPressed: () => Navigator.of(context).maybePop(),
              icon: const Icon(Icons.close_rounded),
              tooltip: 'Fechar',
            ),
          ),
          Positioned(
            top: 18,
            right: 72,
            child: IconButton.filled(
              onPressed: () => _openExternalUrl(url),
              icon: const Icon(Icons.open_in_new_rounded),
              tooltip: 'Abrir fora',
            ),
          ),
          Positioned(
            top: 18,
            right: 126,
            child: IconButton.filled(
              onPressed: () => unawaited(_downloadUrlFromViewer(context, url)),
              icon: const Icon(Icons.download_rounded),
              tooltip: 'Salvar no aparelho',
            ),
          ),
        ],
      ),
    ),
  );
}

Future<void> _downloadUrlFromViewer(BuildContext context, String url) async {
  try {
    final api = ProviderScope.containerOf(context).read(apiClientProvider);
    final media = await api.downloadMediaBytes(url);
    final extension = _downloadExtension(media.mimeType, url);
    final savedAt = await saveMediaToDevice(
      bytes: media.bytes,
      fileName: 'botadmin-${DateTime.now().millisecondsSinceEpoch}.$extension',
      mimeType: media.mimeType,
    );
    if (context.mounted) showSuccessToast(context, savedAt);
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

enum _ComposerPickerTab { emoji, gif, sticker }

class _ComposerPickerResult {
  const _ComposerPickerResult._({this.emoji, this.giphy});

  const _ComposerPickerResult.emoji(String value) : this._(emoji: value);

  const _ComposerPickerResult.giphy(GiphyMediaItem value)
    : this._(giphy: value);

  final String? emoji;
  final GiphyMediaItem? giphy;
}

class _UnifiedComposerPicker extends StatefulWidget {
  const _UnifiedComposerPicker({
    required this.api,
    required this.panelHeight,
    required this.onEmojiSelected,
    required this.onGiphySelected,
  });

  final BotAdminApiClient api;
  final double panelHeight;
  final ValueChanged<String> onEmojiSelected;
  final ValueChanged<GiphyMediaItem> onGiphySelected;

  @override
  State<_UnifiedComposerPicker> createState() => _UnifiedComposerPickerState();
}

class _UnifiedComposerPickerState extends State<_UnifiedComposerPicker> {
  final _search = TextEditingController();
  final _giphyScroll = ScrollController();
  Timer? _debounce;
  _ComposerPickerTab _tab = _ComposerPickerTab.emoji;
  int _emojiIndex = 0;
  List<GiphyMediaItem> _giphyItems = const [];
  bool _giphyLoading = false;
  bool _giphyLoadingMore = false;
  int _giphyOffset = 0;
  String? _giphyError;
  String _loadedGiphyType = '';
  String _loadedGiphyQuery = '';

  String get _giphyType =>
      _tab == _ComposerPickerTab.sticker ? 'stickers' : 'gifs';

  bool get _showEmojiCategories => _tab == _ComposerPickerTab.emoji;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearchChanged);
    _giphyScroll.addListener(_onGiphyScroll);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.removeListener(_onSearchChanged);
    _search.dispose();
    _giphyScroll.removeListener(_onGiphyScroll);
    _giphyScroll.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    if (_tab == _ComposerPickerTab.emoji) {
      setState(() {});
      return;
    }
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 360), () {
      if (mounted) unawaited(_loadGiphy(reset: true));
    });
  }

  void _onGiphyScroll() {
    if (!_giphyScroll.hasClients) return;
    final remaining =
        _giphyScroll.position.maxScrollExtent - _giphyScroll.position.pixels;
    if (remaining < 480 && !_giphyLoading && !_giphyLoadingMore) {
      unawaited(_loadGiphy(reset: false));
    }
  }

  void _setTab(_ComposerPickerTab tab) {
    if (_tab == tab) return;
    setState(() {
      _tab = tab;
      _giphyError = null;
    });
    if (tab != _ComposerPickerTab.emoji) {
      unawaited(_loadGiphy(reset: true));
    }
  }

  Future<void> _loadGiphy({required bool reset}) async {
    final type = _giphyType;
    final query = _search.text.trim();
    if (!reset && (_loadedGiphyType != type || _loadedGiphyQuery != query)) {
      return;
    }
    if (_giphyLoading || _giphyLoadingMore) return;
    setState(() {
      if (reset) {
        _giphyLoading = true;
        _giphyOffset = 0;
        _giphyItems = const [];
        _loadedGiphyType = type;
        _loadedGiphyQuery = query;
      } else {
        _giphyLoadingMore = true;
      }
      _giphyError = null;
    });
    try {
      final next = await widget.api.searchGiphy(
        query: query,
        type: type,
        offset: reset ? 0 : _giphyOffset,
      );
      if (!mounted || _giphyType != type || _search.text.trim() != query) {
        return;
      }
      setState(() {
        _giphyItems = reset ? next : [..._giphyItems, ...next];
        _giphyOffset = _giphyItems.length;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _giphyError = error.toString());
    } finally {
      if (mounted) {
        setState(() {
          _giphyLoading = false;
          _giphyLoadingMore = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.panel,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 28,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Column(
          children: [
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 120),
              child: _showEmojiCategories
                  ? _buildEmojiCategories(context)
                  : _buildGiphyHeader(context),
            ),
            _buildSearchField(context),
            Expanded(child: _buildCurrentBody(context)),
            _buildBottomTabs(context),
          ],
        ),
      ),
    );
  }

  Widget _buildEmojiCategories(BuildContext context) {
    final wa = WaTheme.of(context);
    return SizedBox(
      key: const ValueKey('emoji-categories'),
      height: 58,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        itemBuilder: (context, index) {
          final category = EmojiCatalog.categories[index];
          final selected = _emojiIndex == index;
          return InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () => setState(() => _emojiIndex = index),
            child: SizedBox(
              width: 48,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    _composerEmojiCategoryIcon(category.id),
                    color: selected ? wa.textPrimary : wa.textMuted,
                    size: 25,
                  ),
                  const SizedBox(height: 5),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 120),
                    height: 3,
                    width: selected ? 32 : 0,
                    decoration: BoxDecoration(
                      color: selected ? wa.textPrimary : Colors.transparent,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemCount: EmojiCatalog.categories.length,
      ),
    );
  }

  Widget _buildGiphyHeader(BuildContext context) {
    final wa = WaTheme.of(context);
    final isSticker = _tab == _ComposerPickerTab.sticker;
    return SizedBox(
      key: ValueKey('giphy-header-$isSticker'),
      height: 58,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 10, 14, 8),
        child: Row(
          children: [
            Icon(
              isSticker ? Icons.sticky_note_2_outlined : Icons.gif_box_outlined,
              color: wa.textMuted,
              size: 27,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                isSticker ? 'Figurinhas' : 'GIFs',
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Tooltip(
              message: 'Powered by GIPHY',
              child: Semantics(
                label: 'Powered by GIPHY',
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: wa.accent.withValues(alpha: 0.10),
                    border: Border.all(
                      color: wa.accent.withValues(alpha: 0.22),
                    ),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    child: RichText(
                      text: TextSpan(
                        style: TextStyle(
                          color: wa.textMuted,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0,
                        ),
                        children: [
                          const TextSpan(text: 'Powered by '),
                          TextSpan(
                            text: 'GIPHY',
                            style: TextStyle(
                              color: wa.accent,
                              fontSize: 11,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchField(BuildContext context) {
    final wa = WaTheme.of(context);
    final hint = switch (_tab) {
      _ComposerPickerTab.emoji => 'Pesquisar emoji',
      _ComposerPickerTab.gif => 'Pesquisar GIF',
      _ComposerPickerTab.sticker => 'Pesquisar figurinha',
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
      child: SizedBox(
        height: 52,
        child: TextField(
          controller: _search,
          textInputAction: TextInputAction.search,
          style: TextStyle(color: wa.textPrimary, fontSize: 16),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: wa.textMuted, fontSize: 16),
            prefixIcon: Icon(Icons.search_rounded, color: wa.textMuted),
            filled: true,
            fillColor: wa.panel,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 18,
              vertical: 14,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(999),
              borderSide: BorderSide(color: wa.textPrimary, width: 1.8),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(999),
              borderSide: BorderSide(color: wa.textPrimary, width: 1.8),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(999),
              borderSide: BorderSide(color: wa.textPrimary, width: 2),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCurrentBody(BuildContext context) {
    if (_tab == _ComposerPickerTab.emoji) return _buildEmojiBody(context);
    return _buildGiphyBody(context);
  }

  Widget _buildEmojiBody(BuildContext context) {
    final wa = WaTheme.of(context);
    final query = _search.text.trim();
    final category = EmojiCatalog.categories[_emojiIndex];
    final emojis = query.isEmpty
        ? category.emojis
        : EmojiCatalog.all
              .where((emoji) => emoji.contains(query))
              .toList(growable: false);
    return Scrollbar(
      thumbVisibility: true,
      child: CustomScrollView(
        key: ValueKey('emoji-${category.id}-$query'),
        slivers: [
          if (query.isEmpty) ...[
            SliverToBoxAdapter(
              child: _ComposerPickerSectionTitle(
                label: 'Recentes',
                color: wa.textMuted,
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(18, 4, 18, 18),
              sliver: _buildEmojiSliver([
                ...EmojiCatalog.quickReactions,
                ...EmojiCatalog.extraQuickReactions.take(2),
              ], context),
            ),
            SliverToBoxAdapter(
              child: _ComposerPickerSectionTitle(
                label: _emojiSectionLabel(category),
                color: wa.textMuted,
              ),
            ),
          ] else
            SliverToBoxAdapter(
              child: _ComposerPickerSectionTitle(
                label: 'Resultado da busca',
                color: wa.textMuted,
              ),
            ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 18),
            sliver: _buildEmojiSliver(emojis, context),
          ),
        ],
      ),
    );
  }

  SliverGrid _buildEmojiSliver(List<String> emojis, BuildContext context) {
    final columns = MediaQuery.sizeOf(context).width < 520 ? 7 : 10;
    return SliverGrid.builder(
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: columns,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
      ),
      itemCount: emojis.length,
      itemBuilder: (context, index) {
        final emoji = emojis[index];
        return InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: () => widget.onEmojiSelected(emoji),
          child: Center(child: Text(emoji, style: emojiTextStyle(31))),
        );
      },
    );
  }

  Widget _buildGiphyBody(BuildContext context) {
    final wa = WaTheme.of(context);
    if (_loadedGiphyType != _giphyType ||
        _loadedGiphyQuery != _search.text.trim()) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _tab != _ComposerPickerTab.emoji) {
          unawaited(_loadGiphy(reset: true));
        }
      });
    }
    if (_giphyLoading) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2));
    }
    if (_giphyError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.warning_amber_rounded, color: wa.textMuted, size: 34),
              const SizedBox(height: 10),
              Text(
                _giphyError!,
                textAlign: TextAlign.center,
                style: TextStyle(color: wa.textMuted),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => _loadGiphy(reset: true),
                child: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }
    if (_giphyItems.isEmpty) {
      return Center(
        child: Text(
          'Nenhum resultado encontrado.',
          style: TextStyle(color: wa.textMuted),
        ),
      );
    }

    final isSticker = _tab == _ComposerPickerTab.sticker;
    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 900
        ? 5
        : width >= 620
        ? 4
        : 3;
    return GridView.builder(
      controller: _giphyScroll,
      padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: columns,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: isSticker ? 1 : 1.22,
      ),
      itemCount: _giphyItems.length + (_giphyLoadingMore ? columns : 0),
      itemBuilder: (context, index) {
        if (index >= _giphyItems.length) {
          return DecoratedBox(
            decoration: BoxDecoration(
              color: wa.searchBg,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Center(
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }
        final item = _giphyItems[index];
        return Material(
          color: isSticker ? Colors.transparent : wa.searchBg,
          borderRadius: BorderRadius.circular(10),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => widget.onGiphySelected(item),
            child: Stack(
              fit: StackFit.expand,
              children: [
                IgnorePointer(
                  child: LayoutBuilder(
                    builder: (context, constraints) => AnimatedStickerImage(
                      url: _giphyPreviewProxyUrl(item.previewUrl),
                      width: constraints.maxWidth,
                      height: constraints.maxHeight,
                    ),
                  ),
                ),
                if (!isSticker)
                  Positioned(
                    left: 6,
                    bottom: 6,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.66),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 3,
                        ),
                        child: Text(
                          'GIF',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                  ),
                Positioned.fill(
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(onTap: () => widget.onGiphySelected(item)),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildBottomTabs(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 14),
      child: Center(
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.panel,
            border: Border.all(color: wa.border),
            borderRadius: BorderRadius.circular(999),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _ComposerPickerTabButton(
                  selected: _tab == _ComposerPickerTab.emoji,
                  icon: Icons.emoji_emotions_outlined,
                  label: 'Emoji',
                  showLabel: false,
                  onTap: () => _setTab(_ComposerPickerTab.emoji),
                ),
                _ComposerPickerTabDivider(color: wa.border),
                _ComposerPickerTabButton(
                  selected: _tab == _ComposerPickerTab.gif,
                  label: 'GIF',
                  onTap: () => _setTab(_ComposerPickerTab.gif),
                ),
                _ComposerPickerTabDivider(color: wa.border),
                _ComposerPickerTabButton(
                  selected: _tab == _ComposerPickerTab.sticker,
                  icon: Icons.sticky_note_2_outlined,
                  label: 'Figurinhas',
                  showLabel: false,
                  onTap: () => _setTab(_ComposerPickerTab.sticker),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _giphyPreviewProxyUrl(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return trimmed;
  final path =
      '${AppConfig.apiBaseUrl}/api/giphy/media?${Uri(queryParameters: {'url': trimmed}).query}';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return Uri.base.resolve(path).toString();
}

class _ComposerPickerSectionTitle extends StatelessWidget {
  const _ComposerPickerSectionTitle({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 2),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _ComposerPickerTabDivider extends StatelessWidget {
  const _ComposerPickerTabDivider({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(height: 36, child: VerticalDivider(width: 1, color: color));
  }
}

class _ComposerPickerTabButton extends StatelessWidget {
  const _ComposerPickerTabButton({
    required this.selected,
    required this.label,
    required this.onTap,
    this.icon,
    this.showLabel = true,
  });

  final bool selected;
  final IconData? icon;
  final String label;
  final bool showLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: selected ? wa.searchBg : wa.panel,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          width: showLabel ? 84 : 84,
          height: 36,
          child: Center(
            child: icon == null
                ? Text(
                    label,
                    style: TextStyle(
                      color: selected ? wa.textPrimary : wa.textMuted,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  )
                : Icon(
                    icon,
                    color: selected ? wa.textPrimary : wa.textMuted,
                    size: 22,
                    semanticLabel: label,
                  ),
          ),
        ),
      ),
    );
  }
}

IconData _composerEmojiCategoryIcon(String id) {
  switch (id) {
    case 'smileys':
      return Icons.access_time_rounded;
    case 'gestures':
      return Icons.emoji_emotions_outlined;
    case 'people':
      return Icons.diversity_3_outlined;
    case 'animals':
      return Icons.pets_outlined;
    case 'food':
      return Icons.local_cafe_outlined;
    case 'travel':
      return Icons.directions_car_outlined;
    case 'objects':
      return Icons.lightbulb_outline_rounded;
    case 'symbols':
      return Icons.currency_exchange_rounded;
    case 'flags':
      return Icons.flag_outlined;
    default:
      return Icons.emoji_symbols_outlined;
  }
}

String _emojiSectionLabel(EmojiCategory category) {
  if (category.id == 'smileys') return 'Smileys e pessoas';
  return category.label;
}

String _voiceDurationLabel(Duration duration) {
  final minutes = duration.inMinutes.toString().padLeft(2, '0');
  final seconds = (duration.inSeconds % 60).toString().padLeft(2, '0');
  return '$minutes:$seconds';
}

PopupMenuItem<String> _internalAttachmentItem(
  String value,
  IconData icon,
  String label,
  Color color,
) => PopupMenuItem(
  value: value,
  height: 48,
  child: Row(
    children: [
      Icon(icon, color: color, size: 22),
      const SizedBox(width: 14),
      Text(label),
    ],
  ),
);

class _InternalAdminsOnlyComposer extends StatelessWidget {
  const _InternalAdminsOnlyComposer();

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return SafeArea(
      top: false,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
        color: wa.composerBg,
        child: Center(
          child: RichText(
            text: TextSpan(
              style: TextStyle(color: wa.textMuted, fontSize: 14),
              children: [
                const TextSpan(text: 'Somente '),
                TextSpan(
                  text: 'admins',
                  style: TextStyle(
                    color: wa.accent,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const TextSpan(text: ' podem enviar mensagens'),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MentionCandidate {
  const _MentionCandidate({
    required this.jid,
    required this.label,
    this.subtitle = '',
  });

  final String jid;
  final String label;
  final String subtitle;

  factory _MentionCandidate.fromJson(Map<String, dynamic> json) {
    final jid =
        (json['jid'] ?? json['id'] ?? json['userId'] ?? json['user_id'] ?? '')
            .toString()
            .trim();
    final label =
        (json['name'] ??
                json['pushName'] ??
                json['displayName'] ??
                json['notifyName'] ??
                json['label'] ??
                '')
            .toString()
            .trim();
    final subtitle = (json['phone'] ?? json['number'] ?? json['role'] ?? '')
        .toString()
        .trim();
    return _MentionCandidate(
      jid: jid,
      label: label.isEmpty ? jid : label,
      subtitle: subtitle,
    );
  }
}

class _MentionSuggestions extends StatelessWidget {
  const _MentionSuggestions({
    required this.suggestions,
    required this.onSelected,
  });

  final List<_MentionCandidate> suggestions;
  final ValueChanged<_MentionCandidate> onSelected;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(6, 0, 6, 6),
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: BoxDecoration(
        color: wa.panel,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: wa.divider),
        boxShadow: const [
          BoxShadow(
            color: Color(0x22000000),
            blurRadius: 12,
            offset: Offset(0, -3),
          ),
        ],
      ),
      child: ListView.builder(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: suggestions.length,
        itemBuilder: (context, index) {
          final candidate = suggestions[index];
          return InkWell(
            onTap: () => onSelected(candidate),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 16,
                    backgroundColor: wa.accentSoft,
                    foregroundColor: wa.accent,
                    child: Text(candidate.label.characters.first.toUpperCase()),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          candidate.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: wa.textPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (candidate.subtitle.isNotEmpty)
                          Text(
                            candidate.subtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: wa.textMuted,
                              fontSize: 11.5,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.mentionAll,
    this.mentionSuggestions = const [],
    this.onMentionSelected,
    required this.buttonsEnabled,
    required this.buttons,
    required this.botEnabled,
    required this.showBotButton,
    required this.showStoreButton,
    required this.internalGroup,
    required this.voiceRecording,
    required this.voiceRecordingBusy,
    required this.voiceDuration,
    required this.voiceViewOnce,
    required this.onSend,
    required this.onAttach,
    required this.onEmoji,
    required this.onStore,
    required this.showSweepstakeButton,
    required this.onSweepstake,
    required this.onBot,
    required this.onVoiceStart,
    required this.onVoiceStop,
    required this.onCancelVoice,
    required this.onVoiceViewOnceChanged,
    required this.onMentionAllChanged,
    required this.onEditButtons,
    required this.onClearButtons,
    this.replyTo,
    this.onClearReply,
  });

  final TextEditingController controller;
  final bool mentionAll;
  final List<_MentionCandidate> mentionSuggestions;
  final ValueChanged<_MentionCandidate>? onMentionSelected;
  final bool buttonsEnabled;
  final List<OutgoingInteractiveButton> buttons;
  final bool botEnabled;
  final bool showBotButton;
  final bool showStoreButton;
  final bool internalGroup;
  final bool voiceRecording;
  final bool voiceRecordingBusy;
  final Duration voiceDuration;
  final bool voiceViewOnce;
  final Future<void> Function() onSend;
  final Future<void> Function() onAttach;
  final VoidCallback onEmoji;
  final VoidCallback onStore;
  final bool showSweepstakeButton;
  final VoidCallback onSweepstake;
  final VoidCallback onBot;
  final Future<void> Function() onVoiceStart;
  final Future<void> Function() onVoiceStop;
  final Future<void> Function() onCancelVoice;
  final ValueChanged<bool>? onVoiceViewOnceChanged;
  final ValueChanged<bool>? onMentionAllChanged;
  final Future<void> Function()? onEditButtons;
  final VoidCallback? onClearButtons;
  final ChatMessage? replyTo;
  final VoidCallback? onClearReply;
  static final _plusKey = GlobalKey();

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 720;
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.composerBg,
      child: SafeArea(
        top: false,
        minimum: EdgeInsets.fromLTRB(
          compact ? 6 : 10,
          6,
          compact ? 6 : 10,
          compact ? 6 : 10,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (replyTo != null)
              Container(
                margin: const EdgeInsets.fromLTRB(6, 0, 6, 6),
                padding: const EdgeInsets.fromLTRB(10, 7, 4, 7),
                decoration: BoxDecoration(
                  color: wa.inputFill,
                  borderRadius: BorderRadius.circular(12),
                  border: Border(left: BorderSide(color: wa.accent, width: 3)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '@${replyTo!.senderDisplayName}: ${replyTo!.displayText.isEmpty ? 'Mídia' : replyTo!.displayText}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    IconButton(
                      onPressed: onClearReply,
                      icon: const Icon(Icons.close_rounded, size: 18),
                    ),
                  ],
                ),
              ),
            AnimatedBuilder(
              animation: controller,
              builder: (context, _) {
                if (mentionSuggestions.isNotEmpty &&
                    onMentionSelected != null) {
                  return _MentionSuggestions(
                    suggestions: mentionSuggestions,
                    onSelected: onMentionSelected!,
                  );
                }
                if (voiceRecording) return const SizedBox.shrink();
                final hasText = controller.text.trim().isNotEmpty;
                if (!hasText) return const SizedBox.shrink();
                final actions = <Widget>[
                  if (onMentionAllChanged != null)
                    _MentionAllToggle(
                      enabled: true,
                      value: mentionAll,
                      onChanged: onMentionAllChanged!,
                    ),
                  if (buttonsEnabled && buttons.isEmpty)
                    _ComposerAddButtonChip(enabled: true, onTap: onEditButtons),
                  if (buttonsEnabled && buttons.isNotEmpty)
                    _AttachedButtonsSummary(
                      buttons: buttons,
                      onEdit: onEditButtons,
                      onClear: onClearButtons,
                    ),
                ];
                if (actions.isEmpty) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.fromLTRB(6, 0, 6, 7),
                  child: Wrap(spacing: 8, runSpacing: 7, children: actions),
                );
              },
            ),
            AnimatedBuilder(
              animation: controller,
              builder: (context, _) {
                final hasText = controller.text.trim().isNotEmpty;
                return Container(
                  constraints: const BoxConstraints(minHeight: 48),
                  decoration: BoxDecoration(
                    color: wa.inputFill,
                    borderRadius: BorderRadius.circular(28),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x16000000),
                        blurRadius: 8,
                        offset: Offset(0, 2),
                      ),
                    ],
                  ),
                  padding: const EdgeInsets.fromLTRB(5, 3, 5, 3),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (voiceRecording) ...[
                        _ComposerIconButton(
                          key: _plusKey,
                          onPressed: voiceRecordingBusy
                              ? null
                              : () => unawaited(onCancelVoice()),
                          icon: Icons.delete_outline_rounded,
                          tooltip: 'Cancelar gravação',
                          color: const Color(0xFFE74C3C),
                        ),
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 11,
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.fiber_manual_record_rounded,
                                  color: Color(0xFFE74C3C),
                                  size: 14,
                                ),
                                const SizedBox(width: 7),
                                Text(
                                  _voiceDurationLabel(voiceDuration),
                                  style: TextStyle(
                                    color: wa.textPrimary,
                                    fontWeight: FontWeight.w800,
                                    fontFeatures: const [
                                      ui.FontFeature.tabularFigures(),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    'Solte para enviar · arraste para cancelar',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      color: wa.textMuted,
                                      fontSize: 12.5,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ] else ...[
                        _ComposerIconButton(
                          key: _plusKey,
                          onPressed: () => _openPlusMenu(context),
                          icon: Icons.add_rounded,
                          tooltip: 'Adicionar',
                          iconSize: 29,
                        ),
                        _ComposerIconButton(
                          onPressed: onEmoji,
                          icon: Icons.emoji_emotions_outlined,
                          tooltip: 'Emojis, GIFs e figurinhas',
                          iconSize: 25,
                        ),
                        Expanded(
                          child: TextField(
                            controller: controller,
                            minLines: 1,
                            maxLines: 6,
                            keyboardType: TextInputType.multiline,
                            textInputAction: TextInputAction.newline,
                            cursorColor: const Color(0xFF00A884),
                            style: TextStyle(
                              fontSize: 16,
                              height: 1.28,
                              color: wa.textPrimary,
                            ),
                            decoration: InputDecoration(
                              hintText: 'Digite uma mensagem',
                              hintStyle: TextStyle(
                                color: wa.textMuted,
                                fontWeight: FontWeight.w400,
                              ),
                              isDense: true,
                              filled: false,
                              border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              hoverColor: Colors.transparent,
                              fillColor: Colors.transparent,
                              contentPadding: const EdgeInsets.symmetric(
                                vertical: 9,
                                horizontal: 2,
                              ),
                            ),
                          ),
                        ),
                      ],
                      if (hasText && !voiceRecording)
                        _ComposerSendButton(
                          enabled: !voiceRecordingBusy,
                          onSend: onSend,
                        )
                      else ...[
                        // O controle de visualizacao unica so aparece quando ha
                        // um audio efetivamente sendo gravado. Mantê-lo no
                        // compositor vazio fazia o botao "1" parecer uma acao
                        // permanente, diferente do fluxo de midia do WhatsApp.
                        if (voiceRecording && onVoiceViewOnceChanged != null)
                          _ComposerIconButton(
                            onPressed: () =>
                                onVoiceViewOnceChanged!(!voiceViewOnce),
                            icon: voiceViewOnce
                                ? Icons.looks_one_rounded
                                : Icons.looks_one_outlined,
                            tooltip: voiceViewOnce
                                ? 'Áudio de visualização única ativado'
                                : 'Enviar áudio para ouvir uma vez',
                            color: voiceViewOnce
                                ? const Color(0xFF00A884)
                                : null,
                          ),
                        _HoldToRecordButton(
                          busy: voiceRecordingBusy,
                          recording: voiceRecording,
                          onStart: onVoiceStart,
                          onStop: onVoiceStop,
                          onCancel: onCancelVoice,
                        ),
                      ],
                    ],
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openPlusMenu(BuildContext context) async {
    if (internalGroup) {
      final box = _plusKey.currentContext?.findRenderObject() as RenderBox?;
      final overlay =
          Overlay.of(context).context.findRenderObject() as RenderBox?;
      if (box == null || overlay == null) return;
      final origin = box.localToGlobal(Offset.zero, ancestor: overlay);
      final action = await showMenu<String>(
        context: context,
        position: RelativeRect.fromLTRB(
          origin.dx,
          math.max(12, origin.dy - 150),
          overlay.size.width - origin.dx - box.size.width,
          overlay.size.height - origin.dy,
        ),
        elevation: 8,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        items: [
          _internalAttachmentItem(
            'document',
            Icons.description_rounded,
            'Documento',
            const Color(0xFF7E57C2),
          ),
          _internalAttachmentItem(
            'media',
            Icons.photo_library_rounded,
            'Fotos e vídeos',
            const Color(0xFF168AFF),
          ),
          if (showSweepstakeButton)
            _internalAttachmentItem(
              'sweepstake',
              Icons.emoji_events_rounded,
              'Sorteio',
              const Color(0xFFFFB300),
            ),
        ],
      );
      if (action == null) return;
      if (action == 'document' || action == 'media') {
        await onAttach();
      }
      if (action == 'sweepstake') onSweepstake();
      return;
    }
    final action = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      backgroundColor: WaTheme.of(context).panel,
      builder: (sheetContext) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Color(0xFF7E57C2),
                foregroundColor: Colors.white,
                child: Icon(Icons.photo_library_outlined),
              ),
              title: const Text('Mídia ou documento'),
              subtitle: const Text('Fotos, vídeos, áudios e arquivos'),
              onTap: () => Navigator.of(sheetContext).pop('attach'),
            ),
            if (showStoreButton)
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF00A884),
                  foregroundColor: Colors.white,
                  child: Icon(Icons.storefront_rounded),
                ),
                title: const Text('Ações da Store'),
                onTap: () => Navigator.of(sheetContext).pop('store'),
              ),
            if (showBotButton)
              ListTile(
                leading: CircleAvatar(
                  backgroundColor: botEnabled
                      ? const Color(0xFF00A884)
                      : const Color(0xFF667781),
                  foregroundColor: Colors.white,
                  child: const Icon(Icons.smart_toy_rounded),
                ),
                title: Text(
                  botEnabled ? 'Robô do grupo · ativo' : 'Robô do grupo',
                ),
                onTap: () => Navigator.of(sheetContext).pop('bot'),
              ),
            if (showSweepstakeButton)
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFFFB300),
                  foregroundColor: Colors.white,
                  child: Icon(Icons.emoji_events_rounded),
                ),
                title: const Text('Sorteio'),
                subtitle: const Text('Crie uma enquete e escolha ganhadores'),
                onTap: () => Navigator.of(sheetContext).pop('sweepstake'),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (action == 'attach') await onAttach();
    if (action == 'store') onStore();
    if (action == 'sweepstake') onSweepstake();
    if (action == 'bot') onBot();
  }
}

class _ComposerSendButton extends StatelessWidget {
  const _ComposerSendButton({required this.enabled, required this.onSend});

  final bool enabled;
  final Future<void> Function() onSend;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      constraints: const BoxConstraints.tightFor(width: 44, height: 44),
      padding: EdgeInsets.zero,
      tooltip: 'Enviar',
      onPressed: enabled ? () => unawaited(onSend()) : null,
      icon: const Icon(Icons.send_rounded, color: Color(0xFF00A884), size: 24),
    );
  }
}

class _ActiveSweepstakeButton extends StatelessWidget {
  const _ActiveSweepstakeButton({required this.count, required this.onTap});
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFFFB300),
      elevation: 4,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(13),
          child: Badge(
            label: Text('$count'),
            child: const Icon(
              Icons.emoji_events_rounded,
              color: Colors.white,
              size: 25,
            ),
          ),
        ),
      ),
    );
  }
}

class _SweepstakeDraft {
  const _SweepstakeDraft({
    required this.question,
    required this.durationValue,
    required this.durationUnit,
    required this.maxParticipants,
    required this.winnersCount,
  });
  final String question;
  final int durationValue;
  final String durationUnit;
  final int maxParticipants;
  final int winnersCount;
}

class _SweepstakeDialog extends StatefulWidget {
  const _SweepstakeDialog();
  @override
  State<_SweepstakeDialog> createState() => _SweepstakeDialogState();
}

class _SweepstakeDialogState extends State<_SweepstakeDialog> {
  final _question = TextEditingController();
  final _duration = TextEditingController(text: '60');
  final _limit = TextEditingController(text: '100');
  final _winners = TextEditingController(text: '1');
  String _unit = 'm';

  @override
  void dispose() {
    _question.dispose();
    _duration.dispose();
    _limit.dispose();
    _winners.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 24),
      title: const Row(
        children: [
          Icon(Icons.emoji_events_rounded, color: Color(0xFFFFB300)),
          SizedBox(width: 10),
          Text('Novo sorteio'),
        ],
      ),
      content: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: size.width - 48,
          maxHeight: size.height - 190,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _question,
                autofocus: true,
                maxLength: 160,
                decoration: const InputDecoration(
                  labelText: 'O que será sorteado?',
                  hintText: 'Ex.: Kit de produtos BotAdmin',
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _duration,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Duração'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  DropdownButton<String>(
                    value: _unit,
                    items: const [
                      DropdownMenuItem(value: 'm', child: Text('minutos')),
                      DropdownMenuItem(value: 'h', child: Text('horas')),
                      DropdownMenuItem(value: 'd', child: Text('dias')),
                    ],
                    onChanged: (value) => setState(() => _unit = value ?? 'm'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _limit,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Limite de participantes',
                  helperText: 'Cada pessoa participa clicando em “Participar”.',
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _winners,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Quantidade de ganhadores',
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: () {
            final question = _question.text.trim();
            final duration = int.tryParse(_duration.text.trim()) ?? 0;
            final limit = int.tryParse(_limit.text.trim()) ?? 0;
            final winners = int.tryParse(_winners.text.trim()) ?? 0;
            if (question.isEmpty ||
                duration <= 0 ||
                limit <= 0 ||
                winners <= 0 ||
                winners > limit)
              return;
            Navigator.pop(
              context,
              _SweepstakeDraft(
                question: question,
                durationValue: duration,
                durationUnit: _unit,
                maxParticipants: limit,
                winnersCount: winners,
              ),
            );
          },
          icon: const Icon(Icons.send_rounded),
          label: const Text('Enviar enquete'),
        ),
      ],
    );
  }
}

class _SweepstakeDetailsDialog extends StatefulWidget {
  const _SweepstakeDetailsDialog({
    required this.sweepstake,
    required this.canDraw,
    required this.onRefresh,
    required this.onDraw,
    required this.onCancel,
    this.members = const [],
    this.onAddMember,
  });
  final SweepstakeSummary sweepstake;
  final bool canDraw;
  final Future<SweepstakeSummary> Function() onRefresh;
  final Future<void> Function() onDraw;
  final Future<void> Function() onCancel;
  final List<_MentionCandidate> members;
  final Future<SweepstakeSummary> Function(int userId)? onAddMember;
  @override
  State<_SweepstakeDetailsDialog> createState() =>
      _SweepstakeDetailsDialogState();
}

class _SweepstakeDetailsDialogState extends State<_SweepstakeDetailsDialog> {
  late SweepstakeSummary _sweepstake = widget.sweepstake;
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 24),
      title: Row(
        children: [
          const Icon(Icons.emoji_events_rounded, color: Color(0xFFFFB300)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _sweepstake.question,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          IconButton(
            tooltip: 'Atualizar participantes',
            onPressed: _busy
                ? null
                : () async {
                    final refreshed = await widget.onRefresh();
                    if (mounted) setState(() => _sweepstake = refreshed);
                  },
            icon: const Icon(Icons.refresh_rounded),
          ),
          if (widget.canDraw &&
              widget.onAddMember != null)
            IconButton(
              tooltip: 'Adicionar membro',
              onPressed: _busy ? null : _addMember,
              icon: const Icon(Icons.person_add_alt_1_rounded),
            ),
        ],
      ),
      content: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: size.width - 48,
          maxHeight: size.height - 240,
        ),
        child: _sweepstake.participants.isEmpty
            ? const Center(child: Text('Ainda não há participantes.'))
            : ListView.builder(
                shrinkWrap: true,
                itemCount: _sweepstake.participants.length,
                itemBuilder: (_, index) {
                  final person = _sweepstake.participants[index];
                  return ListTile(
                    dense: true,
                    leading: CircleAvatar(
                      child: Text(
                        (person.displayName ?? person.jid).characters.first
                            .toUpperCase(),
                      ),
                    ),
                    title: Text(
                      person.displayName?.trim().isNotEmpty == true
                          ? person.displayName!
                          : person.jid,
                    ),
                    subtitle: person.joinedAt == null
                        ? null
                        : Text(
                            DateFormat(
                              'dd/MM HH:mm',
                            ).format(person.joinedAt!.toLocal()),
                          ),
                  );
                },
              ),
      ),
      actions: [
        if (widget.canDraw && _sweepstake.isActive)
          TextButton(
            onPressed: _busy ? null : () => _run(widget.onCancel),
            child: const Text('Cancelar'),
          ),
        if (widget.canDraw && _sweepstake.isActive)
          FilledButton.icon(
            onPressed: _busy || _sweepstake.participants.isEmpty
                ? null
                : () => _run(widget.onDraw),
            icon: const Icon(Icons.emoji_events_outlined),
            label: Text('Sortear ${_sweepstake.winnersCount}'),
          ),
        if (!widget.canDraw || !_sweepstake.isActive)
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Fechar'),
          ),
      ],
    );
  }

  Future<void> _addMember() async {
    if (widget.members.isEmpty) {
      if (mounted) showErrorToast(context, 'Não foi possível carregar os membros do grupo.');
      return;
    }
    final member = await showDialog<_MentionCandidate>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Adicionar participante'),
        content: SizedBox(
          width: 360,
          height: 360,
          child: ListView.builder(
            itemCount: widget.members.length,
            itemBuilder: (_, index) {
              final person = widget.members[index];
              final alreadyAdded = _sweepstake.participants.any(
                (entry) => entry.jid == person.jid,
              );
              return ListTile(
                enabled: !alreadyAdded,
                leading: CircleAvatar(
                  child: Text(person.label.characters.first.toUpperCase()),
                ),
                title: Text(person.label),
                subtitle: person.subtitle.isEmpty
                    ? null
                    : Text(person.subtitle),
                trailing: alreadyAdded
                    ? const Icon(Icons.check_circle, color: Color(0xFF008069))
                    : null,
                onTap: alreadyAdded
                    ? null
                    : () => Navigator.of(dialogContext).pop(person),
              );
            },
          ),
        ),
      ),
    );
    if (member == null || widget.onAddMember == null || _busy) return;
    final userId = int.tryParse(member.jid);
    if (userId == null || userId <= 0) {
      if (mounted) showErrorToast(context, 'Membro inválido.');
      return;
    }
    setState(() => _busy = true);
    try {
      final updated = await widget.onAddMember!(userId);
      if (mounted) {
        setState(() => _sweepstake = updated);
        showSuccessToast(context, 'Participante adicionado.');
      }
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _HoldToRecordButton extends StatefulWidget {
  const _HoldToRecordButton({
    required this.busy,
    required this.recording,
    required this.onStart,
    required this.onStop,
    required this.onCancel,
  });

  final bool busy;
  final bool recording;
  final Future<void> Function() onStart;
  final Future<void> Function() onStop;
  final Future<void> Function() onCancel;

  @override
  State<_HoldToRecordButton> createState() => _HoldToRecordButtonState();
}

class _HoldToRecordButtonState extends State<_HoldToRecordButton> {
  Offset? _pressOrigin;
  bool _pressed = false;
  bool _cancelled = false;

  void _start(PointerDownEvent event) {
    if (widget.busy || _pressed) return;
    _pressOrigin = event.position;
    _cancelled = false;
    setState(() => _pressed = true);
    unawaited(widget.onStart());
  }

  void _move(PointerMoveEvent event) {
    final origin = _pressOrigin;
    if (!_pressed || _cancelled || origin == null) return;
    if (event.position.dx <= origin.dx - 76) {
      _cancelled = true;
      unawaited(HapticFeedback.lightImpact());
      unawaited(widget.onCancel());
      if (mounted) setState(() {});
    }
  }

  void _finish(PointerEvent event) {
    if (!_pressed) return;
    final shouldSend = !_cancelled;
    _pressOrigin = null;
    _cancelled = false;
    setState(() => _pressed = false);
    if (shouldSend) unawaited(widget.onStop());
  }

  void _cancel(PointerCancelEvent event) {
    if (!_pressed) return;
    _pressOrigin = null;
    _cancelled = true;
    setState(() => _pressed = false);
    unawaited(widget.onCancel());
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final active = _pressed || widget.recording;
    return Semantics(
      button: true,
      label: 'Segure para gravar áudio',
      child: Tooltip(
        message: 'Segure para gravar · arraste para cancelar',
        child: Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: _start,
          onPointerMove: _move,
          onPointerUp: _finish,
          onPointerCancel: _cancel,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: active ? const Color(0x1F00A884) : Colors.transparent,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.mic_none_rounded,
              color: _cancelled ? const Color(0xFFE74C3C) : wa.textPrimary,
              size: active ? 27 : 25,
            ),
          ),
        ),
      ),
    );
  }
}

class _AttachedButtonsSummary extends StatelessWidget {
  const _AttachedButtonsSummary({
    required this.buttons,
    required this.onEdit,
    required this.onClear,
  });

  final List<OutgoingInteractiveButton> buttons;
  final Future<void> Function()? onEdit;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final label = buttons.length == 1
        ? '1 botao anexado'
        : '${buttons.length} botoes anexados';
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFE7FCE3),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFBCEEC5)),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(10, 5, 4, 5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.smart_button_rounded,
              size: 17,
              color: Color(0xFF008069),
            ),
            SizedBox(width: 7),
            Text(
              label,
              style: TextStyle(
                color: Color(0xFF075E54),
                fontWeight: FontWeight.w800,
                fontSize: 12.5,
              ),
            ),
            IconButton(
              onPressed: onEdit,
              constraints: const BoxConstraints.tightFor(width: 30, height: 28),
              padding: EdgeInsets.zero,
              visualDensity: VisualDensity.compact,
              tooltip: 'Editar botoes',
              icon: Icon(
                Icons.edit_rounded,
                size: 16,
                color: Color(0xFF008069),
              ),
            ),
            IconButton(
              onPressed: onClear,
              constraints: BoxConstraints.tightFor(width: 30, height: 28),
              padding: EdgeInsets.zero,
              visualDensity: VisualDensity.compact,
              tooltip: 'Remover botoes',
              icon: Icon(
                Icons.close_rounded,
                size: 17,
                color: WaTheme.of(context).icon,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposerAddButtonChip extends StatelessWidget {
  const _ComposerAddButtonChip({required this.enabled, required this.onTap});

  final bool enabled;
  final Future<void> Function()? onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: enabled && onTap != null ? () => unawaited(onTap!()) : null,
      style: OutlinedButton.styleFrom(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF008069),
        side: const BorderSide(color: Color(0xFFD1D7DB)),
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.fromLTRB(12, 6, 14, 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        textStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
      ),
      icon: const Icon(Icons.smart_button_outlined, size: 17),
      label: const Text('Adicionar botao'),
    );
  }
}

class _ComposerIconButton extends StatelessWidget {
  const _ComposerIconButton({
    super.key,
    required this.onPressed,
    required this.icon,
    required this.tooltip,
    this.color,
    this.iconSize = 24,
  });

  final VoidCallback? onPressed;
  final IconData icon;
  final String tooltip;
  final Color? color;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final iconColor = color ?? WaTheme.of(context).icon;
    return IconButton(
      constraints: const BoxConstraints.tightFor(width: 40, height: 40),
      padding: EdgeInsets.zero,
      visualDensity: VisualDensity.compact,
      style: IconButton.styleFrom(
        foregroundColor: iconColor,
        hoverColor: Colors.transparent,
        highlightColor: Colors.transparent,
        splashFactory: NoSplash.splashFactory,
      ),
      onPressed: onPressed,
      tooltip: tooltip,
      icon: Icon(icon, color: iconColor, size: iconSize),
    );
  }
}

class _MentionAllToggle extends StatelessWidget {
  const _MentionAllToggle({
    required this.enabled,
    required this.value,
    required this.onChanged,
  });

  final bool enabled;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: value ? const Color(0xFFD9FDD3) : Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: value ? const Color(0xFF00A884) : const Color(0xFFD1D7DB),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 5,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Mencionar todos',
              style: TextStyle(
                color: value
                    ? const Color(0xFF008069)
                    : const Color(0xFF54656F),
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            Transform.scale(
              scale: 0.72,
              child: Switch(
                value: value,
                onChanged: enabled ? onChanged : null,
                activeThumbColor: const Color(0xFF00A884),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MediaComposeResult {
  const _MediaComposeResult({
    required this.caption,
    required this.mentionAll,
    required this.buttons,
    required this.viewOnce,
  });

  final String caption;
  final bool mentionAll;
  final List<OutgoingInteractiveButton> buttons;
  final bool viewOnce;
}

class _MediaComposeSheet extends StatefulWidget {
  const _MediaComposeSheet({
    required this.fileName,
    required this.mimeType,
    required this.bytes,
    required this.initialCaption,
    required this.initialMentionAll,
    required this.initialButtons,
    required this.allowMentionAll,
    required this.allowButtons,
    required this.allowViewOnce,
  });

  final String fileName;
  final String mimeType;
  final Uint8List bytes;
  final String initialCaption;
  final bool initialMentionAll;
  final List<OutgoingInteractiveButton> initialButtons;
  final bool allowMentionAll;
  final bool allowButtons;
  final bool allowViewOnce;

  @override
  State<_MediaComposeSheet> createState() => _MediaComposeSheetState();
}

class _MediaComposeSheetState extends State<_MediaComposeSheet> {
  late final TextEditingController _caption;
  late bool _mentionAll;
  late List<OutgoingInteractiveButton> _buttons;
  bool _viewOnce = false;

  @override
  void initState() {
    super.initState();
    _caption = TextEditingController(text: widget.initialCaption);
    _mentionAll = widget.initialMentionAll;
    _buttons = widget.allowButtons
        ? List<OutgoingInteractiveButton>.of(widget.initialButtons)
        : const [];
  }

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    return FractionallySizedBox(
      heightFactor: 0.92,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Color(0xFFF0F2F5),
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        child: Padding(
          padding: EdgeInsets.fromLTRB(18, 12, 18, 12 + bottomInset),
          child: Column(
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close_rounded),
                    tooltip: 'Fechar',
                  ),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      widget.fileName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: WaTheme.of(context).textPrimary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  Text(
                    _formatMediaSize(widget.bytes.length),
                    style: TextStyle(
                      color: WaTheme.of(context).textMuted,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              SizedBox(height: 10),
              Expanded(
                child: Center(
                  child: _MediaComposePreview(
                    fileName: widget.fileName,
                    mimeType: widget.mimeType,
                    bytes: widget.bytes,
                  ),
                ),
              ),
              SizedBox(height: 12),
              if (widget.allowMentionAll)
                Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: _MentionAllToggle(
                    enabled: true,
                    value: _mentionAll,
                    onChanged: (value) => setState(() => _mentionAll = value),
                  ),
                ),
              if (widget.allowButtons)
                Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: _MediaButtonsActionRow(
                    buttons: _buttons,
                    onEdit: _editButtons,
                    onClear: _buttons.isEmpty
                        ? null
                        : () => setState(() => _buttons = const []),
                  ),
                ),
              if (widget.allowViewOnce)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Material(
                    color: _viewOnce ? const Color(0xFFE7FCE3) : Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    child: SwitchListTile.adaptive(
                      dense: true,
                      value: _viewOnce,
                      onChanged: (value) => setState(() => _viewOnce = value),
                      secondary: const Icon(Icons.looks_one_outlined),
                      title: const Text(
                        'Visualização única',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: const Text(
                        'A mídia poderá ser aberta somente uma vez.',
                      ),
                      activeThumbColor: const Color(0xFF00A884),
                    ),
                  ),
                ),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(26),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x14000000),
                      blurRadius: 8,
                      offset: Offset(0, 1),
                    ),
                  ],
                ),
                child: Padding(
                  padding: EdgeInsets.fromLTRB(18, 3, 6, 3),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _caption,
                          minLines: 1,
                          maxLines: 5,
                          autofocus: true,
                          style: TextStyle(fontSize: 15.5, height: 1.25),
                          decoration: InputDecoration(
                            hintText: 'Adicionar legenda',
                            hintStyle: TextStyle(
                              color: WaTheme.of(context).textMuted,
                            ),
                            border: InputBorder.none,
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(vertical: 13),
                          ),
                        ),
                      ),
                      IconButton.filled(
                        onPressed: _submit,
                        style: IconButton.styleFrom(
                          backgroundColor: const Color(0xFF00A884),
                          foregroundColor: Colors.white,
                        ),
                        icon: const Icon(Icons.send_rounded),
                        tooltip: 'Enviar',
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _submit() {
    Navigator.of(context).pop(
      _MediaComposeResult(
        caption: _caption.text.trim(),
        mentionAll: widget.allowMentionAll && _mentionAll,
        buttons: widget.allowButtons ? _buttons : const [],
        viewOnce: widget.allowViewOnce && _viewOnce,
      ),
    );
  }

  Future<void> _editButtons() async {
    final next = await showBotAdminBottomSheet<List<OutgoingInteractiveButton>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => _InteractiveButtonsSheet(initialButtons: _buttons),
    );
    if (next == null || !mounted) return;
    setState(() => _buttons = next);
  }
}

class _MediaButtonsActionRow extends StatelessWidget {
  const _MediaButtonsActionRow({
    required this.buttons,
    required this.onEdit,
    required this.onClear,
  });

  final List<OutgoingInteractiveButton> buttons;
  final Future<void> Function() onEdit;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final hasButtons = buttons.isNotEmpty;
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: onEdit,
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFF008069),
              side: const BorderSide(color: Color(0xFFBCEEC5)),
              backgroundColor: hasButtons
                  ? const Color(0xFFE7FCE3)
                  : Colors.white,
              alignment: Alignment.centerLeft,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
              ),
            ),
            icon: Icon(
              hasButtons
                  ? Icons.smart_button_rounded
                  : Icons.smart_button_outlined,
              size: 18,
            ),
            label: Text(
              hasButtons
                  ? buttons.length == 1
                        ? '1 botao anexado'
                        : '${buttons.length} botoes anexados'
                  : 'Adicionar botao',
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
        if (hasButtons) ...[
          SizedBox(width: 8),
          IconButton(
            onPressed: onClear,
            tooltip: 'Remover botoes',
            icon: const Icon(Icons.close_rounded),
          ),
        ],
      ],
    );
  }
}

class _InteractiveButtonsSheet extends StatefulWidget {
  const _InteractiveButtonsSheet({required this.initialButtons});

  final List<OutgoingInteractiveButton> initialButtons;

  @override
  State<_InteractiveButtonsSheet> createState() =>
      _InteractiveButtonsSheetState();
}

class _InteractiveButtonsSheetState extends State<_InteractiveButtonsSheet> {
  late List<_ButtonDraft> _drafts;
  String? _error;

  @override
  void initState() {
    super.initState();
    _drafts = widget.initialButtons.isEmpty
        ? [_ButtonDraft.empty(0)]
        : widget.initialButtons.take(3).map(_ButtonDraft.fromButton).toList();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    final maxHeight = MediaQuery.sizeOf(context).height * 0.88;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Align(
        alignment: Alignment.topCenter,
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 620, maxHeight: maxHeight),
          child: Material(
            color: WaTheme.of(context).menuBg,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.fromLTRB(20, 6, 20, 18),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Botoes da mensagem',
                            style: TextStyle(
                              color: WaTheme.of(context).textPrimary,
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.of(context).pop(),
                          icon: const Icon(Icons.close_rounded),
                          tooltip: 'Fechar',
                        ),
                      ],
                    ),
                    SingleChildScrollView(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (var index = 0; index < _drafts.length; index++)
                            _ButtonDraftCard(
                              key: ValueKey(_drafts[index].id),
                              index: index,
                              draft: _drafts[index],
                              onChanged: (draft) => _update(index, draft),
                              onRemove: () => _remove(index),
                            ),
                          if (_drafts.isEmpty)
                            Padding(
                              padding: EdgeInsets.symmetric(vertical: 18),
                              child: Text(
                                'Nenhum botao anexado.',
                                style: TextStyle(
                                  color: WaTheme.of(context).textMuted,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    if (_error != null) ...[
                      SizedBox(height: 8),
                      Text(
                        _error!,
                        style: const TextStyle(
                          color: Color(0xFFB42318),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                    SizedBox(height: 12),
                    Row(
                      children: [
                        OutlinedButton.icon(
                          onPressed: _drafts.length >= 3 ? null : _add,
                          icon: const Icon(Icons.add_rounded),
                          label: const Text('Adicionar botao'),
                        ),
                        const Spacer(),
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          child: const Text('Cancelar'),
                        ),
                        SizedBox(width: 8),
                        FilledButton(
                          onPressed: _submit,
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFF00A884),
                          ),
                          child: const Text('Aplicar'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _add() {
    if (_drafts.length >= 3) return;
    setState(() {
      _error = null;
      _drafts = [..._drafts, _ButtonDraft.empty(_drafts.length)];
    });
  }

  void _remove(int index) {
    setState(() {
      _error = null;
      _drafts = [
        for (var i = 0; i < _drafts.length; i++)
          if (i != index) _drafts[i],
      ];
    });
  }

  void _update(int index, _ButtonDraft draft) {
    setState(() {
      _error = null;
      _drafts = [
        for (var i = 0; i < _drafts.length; i++)
          if (i == index) draft else _drafts[i],
      ];
    });
  }

  void _submit() {
    final result = <OutgoingInteractiveButton>[];
    for (var index = 0; index < _drafts.length; index++) {
      final draft = _drafts[index];
      final label = draft.label.trim();
      final value = draft.value.trim();
      if (label.isEmpty && value.isEmpty) continue;
      if (label.isEmpty) {
        setState(() => _error = 'Informe o texto do botao ${index + 1}.');
        return;
      }
      if (label.length > 25) {
        setState(
          () =>
              _error = 'O texto do botao ${index + 1} deve ter ate 25 letras.',
        );
        return;
      }
      if (draft.type == 'cta_url') {
        final uri = Uri.tryParse(value);
        if (uri == null ||
            uri.host.isEmpty ||
            (uri.scheme != 'http' && uri.scheme != 'https')) {
          setState(
            () =>
                _error = 'Informe uma URL http ou https no botao ${index + 1}.',
          );
          return;
        }
      } else if (value.isEmpty) {
        setState(
          () =>
              _error = 'Informe o conteudo para copiar no botao ${index + 1}.',
        );
        return;
      }
      result.add(
        OutgoingInteractiveButton(
          id: draft.id,
          text: label,
          type: draft.type,
          url: draft.type == 'cta_url' ? value : null,
          copyCode: draft.type == 'cta_copy' ? value : null,
        ),
      );
    }
    Navigator.of(context).pop(result);
  }
}

class _ButtonDraftCard extends StatelessWidget {
  const _ButtonDraftCard({
    super.key,
    required this.index,
    required this.draft,
    required this.onChanged,
    required this.onRemove,
  });

  final int index;
  final _ButtonDraft draft;
  final ValueChanged<_ButtonDraft> onChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final isLink = draft.type == 'cta_url';
    return Padding(
      padding: EdgeInsets.only(bottom: 10),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFF7F8FA),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE1E6EA)),
        ),
        child: Padding(
          padding: EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Botao ${index + 1}',
                      style: TextStyle(
                        color: WaTheme.of(context).textPrimary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: onRemove,
                    tooltip: 'Remover',
                    visualDensity: VisualDensity.compact,
                    icon: Icon(Icons.delete_outline_rounded),
                  ),
                ],
              ),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    selected: isLink,
                    label: Text('Link'),
                    avatar: Icon(Icons.open_in_new_rounded, size: 17),
                    onSelected: (_) =>
                        onChanged(draft.copyWith(type: 'cta_url')),
                  ),
                  ChoiceChip(
                    selected: !isLink,
                    label: Text('Copiar'),
                    avatar: Icon(Icons.copy_rounded, size: 17),
                    onSelected: (_) =>
                        onChanged(draft.copyWith(type: 'cta_copy')),
                  ),
                ],
              ),
              SizedBox(height: 10),
              TextFormField(
                key: ValueKey('${draft.id}-label'),
                initialValue: draft.label,
                maxLength: 25,
                decoration: InputDecoration(
                  labelText: 'Texto do botao',
                  counterText: '',
                  filled: true,
                  fillColor: WaTheme.of(context).inputFill,
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (value) => onChanged(draft.copyWith(label: value)),
              ),
              SizedBox(height: 10),
              TextFormField(
                key: ValueKey('${draft.id}-${draft.type}-value'),
                initialValue: draft.value,
                minLines: 1,
                maxLines: isLink ? 1 : 3,
                decoration: InputDecoration(
                  labelText: isLink ? 'URL do botao' : 'Conteudo para copiar',
                  hintText: isLink ? 'https://...' : 'PIX, cupom ou codigo',
                  filled: true,
                  fillColor: WaTheme.of(context).inputFill,
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (value) => onChanged(draft.copyWith(value: value)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ButtonDraft {
  const _ButtonDraft({
    required this.id,
    required this.label,
    required this.type,
    required this.value,
  });

  final String id;
  final String label;
  final String type;
  final String value;

  factory _ButtonDraft.empty(int index) {
    return _ButtonDraft(
      id: 'btn_${DateTime.now().microsecondsSinceEpoch}_$index',
      label: '',
      type: 'cta_url',
      value: '',
    );
  }

  factory _ButtonDraft.fromButton(OutgoingInteractiveButton button) {
    final type = button.type == 'cta_copy' ? 'cta_copy' : 'cta_url';
    return _ButtonDraft(
      id: button.id,
      label: button.text,
      type: type,
      value: type == 'cta_copy' ? button.copyCode ?? '' : button.url ?? '',
    );
  }

  _ButtonDraft copyWith({String? label, String? type, String? value}) {
    return _ButtonDraft(
      id: id,
      label: label ?? this.label,
      type: type ?? this.type,
      value: value ?? this.value,
    );
  }
}

class _MediaComposePreview extends StatelessWidget {
  const _MediaComposePreview({
    required this.fileName,
    required this.mimeType,
    required this.bytes,
  });

  final String fileName;
  final String mimeType;
  final Uint8List bytes;

  @override
  Widget build(BuildContext context) {
    final type = mimeType.toLowerCase();
    if (type.startsWith('image/')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.memory(
          bytes,
          fit: BoxFit.contain,
          gaplessPlayback: true,
          errorBuilder: (context, _, _) => _fallbackPreview(
            context,
            icon: Icons.broken_image_rounded,
            title: 'Imagem indisponível',
          ),
        ),
      );
    }

    final icon = type.startsWith('video/')
        ? Icons.play_circle_rounded
        : type.startsWith('audio/')
        ? Icons.graphic_eq_rounded
        : Icons.description_rounded;
    final title = type.startsWith('video/')
        ? 'Vídeo pronto para enviar'
        : type.startsWith('audio/')
        ? 'Áudio pronto para enviar'
        : 'Documento pronto para enviar';
    return _fallbackPreview(context, icon: icon, title: title);
  }

  Widget _fallbackPreview(
    BuildContext context, {
    required IconData icon,
    required String title,
  }) {
    final wa = WaTheme.of(context);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 420),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: wa.panel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: wa.border),
        ),
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 58, color: WaTheme.of(context).icon),
              SizedBox(height: 14),
              Text(
                title,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: WaTheme.of(context).textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
              SizedBox(height: 6),
              Text(
                fileName,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(color: WaTheme.of(context).textMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NoChatSelected extends StatelessWidget {
  const _NoChatSelected();

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.contentBg,
      child: Stack(
        children: [
          Center(
            child: Transform.translate(
              offset: const Offset(0, -18),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const _BusinessIllustration(),
                  SizedBox(height: 42),
                  Text(
                    'WhatsApp Business Web',
                    style: TextStyle(
                      fontSize: 32,
                      height: 1,
                      fontWeight: FontWeight.w300,
                      color: wa.textPrimary,
                    ),
                  ),
                  SizedBox(height: 20),
                  Text(
                    'Amplie, organize e gerencie sua conta comercial.',
                    style: TextStyle(fontSize: 15, color: wa.textMuted),
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 56,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.lock_outline_rounded, size: 18, color: wa.textMuted),
                SizedBox(width: 8),
                Flexible(
                  child: Text(
                    'Suas mensagens pessoais são protegidas com a criptografia de ponta a ponta.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 14, color: wa.textMuted),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyConversation extends StatelessWidget {
  const _EmptyConversation();

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: wa.emptyPill,
          borderRadius: const BorderRadius.all(Radius.circular(10)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Text(
            'Sem mensagens carregadas nesta conversa.',
            style: TextStyle(color: wa.textMuted),
          ),
        ),
      ),
    );
  }
}

class _MessageLoadError extends StatelessWidget {
  const _MessageLoadError({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Color(0xE6FFFFFF),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.cloud_off_rounded,
                color: WaTheme.of(context).textMuted,
                size: 30,
              ),
              SizedBox(height: 8),
              Text(
                error.toString(),
                textAlign: TextAlign.center,
                style: TextStyle(color: WaTheme.of(context).textMuted),
              ),
              SizedBox(height: 10),
              TextButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OlderMessagesLoader extends StatelessWidget {
  const _OlderMessagesLoader({required this.loading, required this.onTap});

  final bool loading;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Material(
          color: wa.panelElevated.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (loading)
                    SizedBox(
                      width: 15,
                      height: 15,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else
                    Icon(
                      Icons.keyboard_arrow_up_rounded,
                      color: wa.textMuted,
                      size: 18,
                    ),
                  SizedBox(width: 7),
                  Text(
                    loading
                        ? 'Carregando mensagens antigas'
                        : 'Carregar mensagens antigas',
                    style: TextStyle(
                      color: wa.textMuted,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _WallpaperFrameEditor extends StatefulWidget {
  const _WallpaperFrameEditor({required this.imageBytes});

  final Uint8List imageBytes;

  @override
  State<_WallpaperFrameEditor> createState() => _WallpaperFrameEditorState();
}

class _WallpaperFrameEditorState extends State<_WallpaperFrameEditor> {
  final _previewKey = GlobalKey();
  final _transform = TransformationController();
  bool _saving = false;

  @override
  void dispose() {
    _transform.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      await WidgetsBinding.instance.endOfFrame;
      final boundary =
          _previewKey.currentContext?.findRenderObject()
              as RenderRepaintBoundary?;
      if (boundary == null) throw StateError('Prévia indisponível.');
      final image = await boundary.toImage(pixelRatio: 2.25);
      final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      final bytes = byteData?.buffer.asUint8List();
      if (!mounted || bytes == null || bytes.isEmpty) return;
      Navigator.pop(context, bytes);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final screen = MediaQuery.sizeOf(context);
    final previewHeight = math.min(520.0, screen.height * .64);
    final previewWidth = math.min(330.0, previewHeight * 9 / 16);
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 18),
      backgroundColor: wa.panel,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 430),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Ajustar plano de fundo',
                      style: TextStyle(
                        color: wa.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Fechar',
                    onPressed: _saving ? null : () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              Text(
                'Arraste para escolher a área e use dois dedos para ampliar.',
                style: TextStyle(color: wa.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 12),
              Center(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: RepaintBoundary(
                    key: _previewKey,
                    child: SizedBox(
                      width: previewWidth,
                      height: previewHeight,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          ColoredBox(
                            color: const Color(0xFF0B141A),
                            child: InteractiveViewer(
                              transformationController: _transform,
                              minScale: 1,
                              maxScale: 6,
                              boundaryMargin: const EdgeInsets.all(500),
                              clipBehavior: Clip.hardEdge,
                              child: Image.memory(
                                widget.imageBytes,
                                width: previewWidth,
                                height: previewHeight,
                                fit: BoxFit.cover,
                                filterQuality: FilterQuality.high,
                              ),
                            ),
                          ),
                          IgnorePointer(
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: .7),
                                  width: 1.5,
                                ),
                                borderRadius: BorderRadius.circular(14),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  TextButton.icon(
                    onPressed: _saving
                        ? null
                        : () => _transform.value = Matrix4.identity(),
                    icon: const Icon(Icons.restart_alt_rounded),
                    label: const Text('Redefinir'),
                  ),
                  const Spacer(),
                  FilledButton.icon(
                    onPressed: _saving ? null : _apply,
                    icon: _saving
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.check_rounded),
                    label: const Text('Usar no grupo'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WhatsAppWallpaper extends StatelessWidget {
  const _WhatsAppWallpaper({this.imageUrl, this.imageBytes});

  final String? imageUrl;
  final Uint8List? imageBytes;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final source = imageUrl?.trim() ?? '';
    return Stack(
      fit: StackFit.expand,
      children: [
        ColoredBox(
          color: wa.chatWallpaper,
          child: CustomPaint(
            painter: _WhatsAppDoodlePainter(doodle: wa.chatDoodle),
          ),
        ),
        if (imageBytes != null)
          Image.memory(
            imageBytes!,
            key: ValueKey<int>(identityHashCode(imageBytes)),
            fit: BoxFit.cover,
            filterQuality: FilterQuality.medium,
            gaplessPlayback: true,
          )
        else if (source.isNotEmpty)
          BotAdminCachedImage(
            key: ValueKey<String>('internal-group-wallpaper:$source'),
            imageUrl: source,
            fit: BoxFit.cover,
            useOldImageOnUrlChange: false,
            maxWidthDiskCache: 2560,
            maxHeightDiskCache: 2560,
            errorWidget: (_, __, ___) => const SizedBox.shrink(),
          ),
        if (imageBytes != null || source.isNotEmpty)
          ColoredBox(color: Colors.black.withValues(alpha: .05)),
      ],
    );
  }
}

class _WhatsAppDoodlePainter extends CustomPainter {
  const _WhatsAppDoodlePainter({required this.doodle});

  final Color doodle;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = doodle
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    final accent = Paint()
      ..color = doodle.withValues(alpha: doodle.a * 0.7)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;

    for (double y = -40; y < size.height + 80; y += 96) {
      for (double x = -30; x < size.width + 120; x += 116) {
        final variant = ((x / 116).round() + (y / 96).round()) % 5;
        switch (variant) {
          case 0:
            canvas.drawCircle(Offset(x + 28, y + 30), 18, paint);
            canvas.drawLine(
              Offset(x + 12, y + 48),
              Offset(x + 44, y + 16),
              paint,
            );
            break;
          case 1:
            canvas.drawRRect(
              RRect.fromRectAndRadius(
                Rect.fromLTWH(x + 18, y + 20, 42, 28),
                const Radius.circular(8),
              ),
              paint,
            );
            canvas.drawCircle(Offset(x + 31, y + 34), 4, accent);
            canvas.drawCircle(Offset(x + 47, y + 34), 4, accent);
            break;
          case 2:
            canvas.drawPath(
              Path()
                ..moveTo(x + 12, y + 52)
                ..quadraticBezierTo(x + 36, y + 8, x + 62, y + 52)
                ..quadraticBezierTo(x + 36, y + 36, x + 12, y + 52),
              paint,
            );
            break;
          case 3:
            canvas.drawCircle(Offset(x + 42, y + 34), 24, accent);
            canvas.drawCircle(Offset(x + 42, y + 34), 8, paint);
            canvas.drawLine(
              Offset(x + 18, y + 34),
              Offset(x + 66, y + 34),
              accent,
            );
            break;
          default:
            canvas.drawPath(
              Path()
                ..moveTo(x + 18, y + 22)
                ..lineTo(x + 42, y + 46)
                ..lineTo(x + 66, y + 18)
                ..lineTo(x + 54, y + 58)
                ..lineTo(x + 24, y + 58)
                ..close(),
              accent,
            );
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _WhatsAppDoodlePainter oldDelegate) =>
      oldDelegate.doodle != doodle;
}

class _BusinessIllustration extends StatelessWidget {
  const _BusinessIllustration();

  @override
  Widget build(BuildContext context) {
    return Image.network(
      '/images/brand/messages-empty-logo-v2.png?v=ca02fi-20260712',
      width: 300,
      fit: BoxFit.contain,
      errorBuilder: (context, error, stackTrace) => Icon(
        Icons.storefront_rounded,
        color: WaTheme.of(context).textMuted,
        size: 96,
      ),
    );
  }
}

EdgeInsets _conversationListPadding(double width) {
  if (width < 480) {
    return const EdgeInsets.fromLTRB(8, 10, 8, 12);
  }
  if (width < 720) {
    return const EdgeInsets.fromLTRB(12, 12, 12, 14);
  }
  final horizontal = width >= 900 ? 24.0 : 18.0;
  return EdgeInsets.fromLTRB(horizontal, 14, horizontal, 16);
}

double _messageBubbleMaxWidth(
  double viewportWidth, {
  required bool stickerOnly,
  required bool includesSenderAvatar,
}) {
  final available = viewportWidth - (includesSenderAvatar ? 48 : 0);
  final ratioCap = viewportWidth >= 900
      ? viewportWidth * 0.54
      : viewportWidth >= 620
      ? viewportWidth * 0.68
      : viewportWidth * 0.82;
  final upper = stickerOnly
      ? math.min(220.0, ratioCap)
      : math.min(660.0, ratioCap);
  return available.clamp(stickerOnly ? 170.0 : 120.0, upper).toDouble();
}

double _messageBubblePreferredWidth(
  BuildContext context,
  ChatMessage message, {
  required double maxBubbleWidth,
  required bool compactStickerOnly,
  required bool showSenderIdentity,
  required bool hasDisplayText,
  required bool hasMedia,
  required bool hasQuoted,
  required bool hideDeletedContent,
  required String mediaKind,
}) {
  final horizontalPadding = compactStickerOnly ? 10.0 : 17.0;
  final contentMaxWidth = math.max(80.0, maxBubbleWidth - horizontalPadding);
  if (compactStickerOnly) {
    return math.min(maxBubbleWidth, 174.0);
  }

  var contentWidth = 0.0;
  if (showSenderIdentity) {
    final nameWidth = _measureSingleLineTextWidth(
      context,
      message.senderDisplayName,
      const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
    );
    final phoneWidth = _measureSingleLineTextWidth(
      context,
      message.senderPhoneDisplay,
      const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w500),
    );
    final headerWidth = message.senderPhoneDisplay.trim().isEmpty
        ? nameWidth
        : nameWidth + phoneWidth + 10;
    contentWidth = math.max(contentWidth, math.min(headerWidth + 6, 300));
  }

  if (hasQuoted) {
    contentWidth = math.max(
      contentWidth,
      _quotedPreviewPreferredWidth(context, message.quoted!, contentMaxWidth),
    );
  }

  if (hasMedia) {
    contentWidth = math.max(
      contentWidth,
      _mediaPreviewPreferredWidth(mediaKind, contentMaxWidth),
    );
  }

  if (hasDisplayText) {
    contentWidth = math.max(
      contentWidth,
      _preferredTextBlockWidth(
        context,
        message.displayText,
        const TextStyle(fontSize: 14.5, height: 1.32),
        contentMaxWidth,
      ),
    );
  }

  if (mediaKind == 'interactive') {
    // Reserve room for action rows. Measuring only displayText collapses an
    // interactive bubble to the generic fallback width.
    final interactiveText = [
      _interactiveTitleText(message),
      _interactiveBodyText(message),
      _interactiveFooterText(message),
    ].where((value) => value.trim().isNotEmpty).join('\n');
    if (interactiveText.isNotEmpty) {
      contentWidth = math.max(
        contentWidth,
        _preferredTextBlockWidth(
          context,
          interactiveText,
          const TextStyle(fontSize: 15.5, height: 1.24),
          contentMaxWidth,
        ),
      );
    }
    contentWidth = math.max(
      contentWidth,
      math.min(contentMaxWidth, math.min(380.0, maxBubbleWidth - 24)),
    );
  } else if (hideDeletedContent) {
    contentWidth = math.max(contentWidth, math.min(260, contentMaxWidth));
  } else if (contentWidth <= 0) {
    contentWidth = math.min(170, contentMaxWidth);
  }

  final metaWidth = message.fromMe ? 54.0 : 34.0;
  contentWidth = math.max(contentWidth, metaWidth);
  final minWidth = hasMedia
      ? 190.0
      : showSenderIdentity
      ? 128.0
      : 70.0;
  return (contentWidth + horizontalPadding)
      .clamp(minWidth, maxBubbleWidth)
      .toDouble();
}

double _mediaPreviewPreferredWidth(String mediaKind, double contentMaxWidth) {
  final width = switch (mediaKind) {
    'image' || 'video' => 300.0,
    'audio' => 360.0,
    'sticker' => 164.0,
    'poll' => contentMaxWidth < 360 ? 275.0 : 390.0,
    'interactive' => 410.0,
    'contact' => contentMaxWidth < 360 ? 250.0 : 360.0,
    'document' || 'location' || 'undecryptable' => 300.0,
    _ => 260.0,
  };
  return math.min(width, contentMaxWidth);
}

double _quotedPreviewPreferredWidth(
  BuildContext context,
  ChatQuotedMessage quoted,
  double contentMaxWidth,
) {
  final title = (quoted.title ?? quoted.participant ?? 'Mensagem').trim();
  final body = (quoted.text ?? _quotedTypeLabel(quoted.messageType)).trim();
  final textWidth = math.max(
    _measureSingleLineTextWidth(
      context,
      title.isEmpty ? 'Mensagem' : title,
      const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
    ),
    _preferredTextBlockWidth(
      context,
      body.isEmpty ? 'Mensagem' : body,
      const TextStyle(fontSize: 12.5, height: 1.22),
      math.min(292, contentMaxWidth - 22),
    ),
  );
  return math.min(textWidth + 22, math.min(320, contentMaxWidth));
}

double _preferredTextBlockWidth(
  BuildContext context,
  String text,
  TextStyle style,
  double maxWidth,
) {
  final lines = text.split(RegExp(r'\r?\n'));
  var width = 0.0;
  for (final rawLine in lines) {
    final line = rawLine.trim().isEmpty ? ' ' : rawLine;
    final measured = _measureSingleLineTextWidth(context, line, style);
    width = math.max(width, math.min(measured, maxWidth));
    if (width >= maxWidth) break;
  }
  return width.ceilToDouble();
}

double _measureSingleLineTextWidth(
  BuildContext context,
  String text,
  TextStyle style,
) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) return 0;
  final painter = TextPainter(
    text: TextSpan(text: trimmed, style: style),
    textDirection: Directionality.of(context),
    maxLines: 1,
    textScaler: MediaQuery.textScalerOf(context),
  )..layout(maxWidth: double.infinity);
  return painter.width;
}

Color _senderColor(String seed) {
  const palette = [
    Color(0xFFE91E63),
    Color(0xFF9C27B0),
    Color(0xFF3F51B5),
    Color(0xFF00897B),
    Color(0xFF7CB342),
    Color(0xFFF57C00),
    Color(0xFFD81B60),
    Color(0xFF00A884),
    Color(0xFF1E88E5),
  ];
  final text = seed.trim();
  if (text.isEmpty) return const Color(0xFF008069);
  var hash = 0;
  for (final codeUnit in text.codeUnits) {
    hash = (hash * 31 + codeUnit) & 0x7fffffff;
  }
  return palette[hash % palette.length];
}

String _senderInitials(String value) {
  final parts = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) {
    final clean = parts.first.replaceAll(RegExp(r'[^0-9A-Za-zÀ-ÿ]'), '');
    return clean.isEmpty ? '?' : clean.characters.first.toUpperCase();
  }
  final first = parts.first.characters.first;
  final last = parts.last.characters.first;
  return '$first$last'.toUpperCase();
}

String? _absoluteMediaUrl(String? value) {
  if (value == null || value.trim().isEmpty) return null;
  final raw = value.trim();
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (raw.startsWith('https://pps.whatsapp.net/')) {
    return '${AppConfig.apiBaseUrl}/api/whatsapp-avatar-proxy?url=${Uri.encodeComponent(raw)}';
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  final normalized = raw.startsWith('/') ? raw : '/$raw';
  return '${AppConfig.apiBaseUrl}$normalized';
}

String _mediaKind(ChatMessage message) {
  return message.resolvedMediaKind;
}

bool _looksLikePlayDownload(ChatMessage message) {
  final content = [
    message.text,
    message.mediaCaption,
    message.mediaTitle,
    message.media['body']?.toString(),
    message.media['caption']?.toString(),
  ].whereType<String>().join(' ');
  return message.hasRenderableMedia && content.contains(' — ');
}

String _quotedTypeLabel(String? type) {
  final normalized = (type ?? '').toLowerCase();
  if (normalized.contains('sticker')) return 'Figurinha';
  if (normalized.contains('image')) return 'Imagem';
  if (normalized.contains('video')) return 'Vídeo';
  if (normalized.contains('audio') || normalized.contains('ptt')) {
    return 'Áudio';
  }
  if (normalized.contains('document')) return 'Documento';
  if (normalized.contains('poll')) return 'Enquete';
  if (normalized.contains('location')) return 'Localização';
  if (normalized.contains('contact')) return 'Contato';
  return 'Mensagem';
}

String _mediaKindLabel(String type) {
  return switch (type) {
    'sticker' => 'Figurinha',
    'image' => 'Imagem',
    'video' => 'Vídeo',
    'audio' => 'Áudio',
    'document' => 'Documento',
    'interactive' => 'Mensagem interativa',
    'contact' => 'Contato',
    'location' => 'Localização',
    'poll' => 'Enquete',
    'undecryptable' => 'Mensagem indisponível',
    _ => 'Mídia',
  };
}

String _downloadExtension(String mimeType, String rawUrl) {
  final mime = mimeType.toLowerCase();
  final path = Uri.tryParse(rawUrl)?.path.toLowerCase() ?? rawUrl.toLowerCase();
  final match = RegExp(r'\.([a-z0-9]{2,5})$').firstMatch(path);
  if (match != null) return match.group(1)!;
  if (mime.contains('jpeg')) return 'jpg';
  if (mime.contains('png')) return 'png';
  if (mime.contains('webp')) return 'webp';
  if (mime.contains('gif')) return 'gif';
  if (mime.contains('webm')) return 'webm';
  if (mime.contains('mp4')) return mime.startsWith('audio/') ? 'm4a' : 'mp4';
  if (mime.contains('mpeg')) return mime.startsWith('audio/') ? 'mp3' : 'mpeg';
  if (mime.contains('ogg') || mime.contains('opus')) return 'ogg';
  if (mime.contains('pdf')) return 'pdf';
  return 'bin';
}

String _formatMediaSize(int bytes) {
  if (bytes >= 1024 * 1024) {
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
  if (bytes >= 1024) {
    return '${(bytes / 1024).toStringAsFixed(0)} KB';
  }
  return '$bytes B';
}

Future<void> _openExternalUrl(String value) async {
  final uri = Uri.tryParse(value);
  if (uri == null) return;
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

String _normalizePhoneForTel(String value) {
  final trimmed = value.trim();
  final prefix = trimmed.startsWith('+') ? '+' : '';
  final digits = trimmed.replaceAll(RegExp(r'\D+'), '');
  return '$prefix$digits';
}

String _guessMimeType(String fileName) {
  final ext = fileName.split('.').last.toLowerCase();
  return switch (ext) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    'mp4' => 'video/mp4',
    'mov' => 'video/quicktime',
    'mp3' => 'audio/mpeg',
    'ogg' => 'audio/ogg',
    'opus' => 'audio/ogg',
    'pdf' => 'application/pdf',
    _ => 'application/octet-stream',
  };
}
