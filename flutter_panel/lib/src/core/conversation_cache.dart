import 'dart:async';
import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/chat_message.dart';
import '../models/conversation_thread.dart';
import 'api_client.dart';
import 'app_config.dart';
import 'botadmin_cached_image.dart';
import 'dashboard_disk_cache.dart';
import 'session_store.dart';

/// In-memory session cache for recent messages + avatar warm-up.
/// Heavy network work runs in the background so opening chats feels instant,
/// similar to WhatsApp Web (recent first, rest already warm).
class ConversationCache {
  ConversationCache(this._api);

  // Increment when media classification changes so stale rows (for example
  // !play MP3s cached as image cards) are ignored on the next launch.
  static const _messageCacheSchema = 'v2';

  final BotAdminApiClient _api;

  final Map<String, CachedMessagePage> _messagePages = {};
  final Map<String, Future<CachedMessagePage>> _messageInFlight = {};
  final Set<String> _avatarWarmed = {};
  int _warmGeneration = 0;
  int _sessionRevision = BotAdminSessionStore.sessionRevision.value;

  static String threadKey(ConversationThread thread) =>
      '${thread.instanceId}|${thread.chatJid}';

  CachedMessagePage? peekMessages(ConversationThread thread) {
    _ensureCurrentSession();
    return _messagePages[threadKey(thread)];
  }

  void putMessages(ConversationThread thread, CachedMessagePage page) {
    _ensureCurrentSession();
    _messagePages[threadKey(thread)] = page;
    unawaited(_persistPage(thread, page));
  }

  void removeMessages(ConversationThread thread) {
    _ensureCurrentSession();
    final key = threadKey(thread);
    _messagePages.remove(key);
    _messageInFlight.remove(key);
    unawaited(_clearPersistedPage(thread));
  }

  void mergeIncomingMessage(ConversationThread thread, ChatMessage message) {
    _ensureCurrentSession();
    final key = threadKey(thread);
    final current = _messagePages[key];
    if (current == null) return;
    final next = [...current.messages, message];
    // Keep only a bounded recent window in memory.
    final trimmed = next.length > 220 ? next.sublist(next.length - 220) : next;
    _messagePages[key] = CachedMessagePage(
      messages: List.unmodifiable(trimmed),
      hasMore: current.hasMore,
      oldestCursor: current.oldestCursor,
      fetchedAt: DateTime.now(),
    );
    unawaited(_persistPage(thread, _messagePages[key]!));
  }

  /// Warm only avatars close to the visible viewport. Message payloads are
  /// deliberately loaded after selection, so list scrolling keeps priority.
  Future<void> warmConversationList(
    List<ConversationThread> threads, {
    int visibleAvatars = 14,
  }) async {
    _ensureCurrentSession();
    final generation = ++_warmGeneration;
    final ordered = [...threads]
      ..sort((a, b) {
        if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
        return b.lastActivity.compareTo(a.lastActivity);
      });
    final top = ordered.take(visibleAvatars).toList(growable: false);
    await _warmAvatars(top, generation);
  }

  /// Cancels speculative list work and starts the selected conversation now.
  Future<CachedMessagePage> prioritizeThread(
    ConversationThread thread, {
    int limit = 40,
  }) {
    ++_warmGeneration;
    return loadRecent(thread, limit: limit, preferCache: true, warm: true);
  }

  void cancelBackgroundWarmup() {
    ++_warmGeneration;
  }

  Future<CachedMessagePage> loadRecent(
    ConversationThread thread, {
    int limit = 40,
    bool preferCache = true,
    bool warm = false,
  }) async {
    _ensureCurrentSession();
    final key = threadKey(thread);
    if (preferCache) {
      final cached = _messagePages[key];
      if (cached != null &&
          DateTime.now().difference(cached.fetchedAt) <
              const Duration(minutes: 8)) {
        // Refresh in background if slightly stale.
        if (DateTime.now().difference(cached.fetchedAt) >
            const Duration(seconds: 25)) {
          unawaited(_fetchAndStore(thread, limit: limit, warm: true));
        }
        return cached;
      }
      final persisted = await _readPersistedPage(thread);
      if (persisted != null) {
        _messagePages[key] = persisted;
        if (DateTime.now().difference(persisted.fetchedAt) >
            const Duration(seconds: 25)) {
          unawaited(_fetchAndStore(thread, limit: limit, warm: true));
        }
        return persisted;
      }
    }
    return _fetchAndStore(thread, limit: limit, warm: warm);
  }

  Future<CachedMessagePage> _fetchAndStore(
    ConversationThread thread, {
    required int limit,
    required bool warm,
  }) {
    _ensureCurrentSession();
    final key = threadKey(thread);
    final existing = _messageInFlight[key];
    if (existing != null) return existing;

    final request = () async {
      final requestRevision = _sessionRevision;
      final page = await _api.loadMessagePage(thread, limit: limit, warm: warm);
      final cached = CachedMessagePage(
        messages: List.unmodifiable(page.messages),
        hasMore: page.hasMore,
        oldestCursor: page.oldestCursor,
        fetchedAt: DateTime.now(),
      );
      if (requestRevision == BotAdminSessionStore.sessionRevision.value) {
        _messagePages[key] = cached;
        unawaited(_persistPage(thread, cached));
      }
      return cached;
    }();

    _messageInFlight[key] = request;
    return request.whenComplete(() {
      if (identical(_messageInFlight[key], request)) {
        _messageInFlight.remove(key);
      }
    });
  }

  Future<CachedMessagePage?> _readPersistedPage(
    ConversationThread thread,
  ) async {
    try {
      final user = await BotAdminSessionStore().readCachedUser();
      final userKey = user?.id ?? 0;
      final raw = await readBotAdminDiskCache(
        'messages_${_messageCacheSchema}_${userKey}_${threadKey(thread)}',
      );
      if (raw == null) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      final list = decoded['messages'];
      if (list is! List) return null;
      final messages = list
          .whereType<Map>()
          .map(
            (item) => ChatMessage.fromJson(
              item.cast<String, dynamic>(),
              thread: thread,
            ),
          )
          .toList(growable: false);
      if (messages.isEmpty) return null;
      final fetchedAt =
          DateTime.tryParse(decoded['fetchedAt']?.toString() ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0);
      return CachedMessagePage(
        messages: List.unmodifiable(messages),
        hasMore: decoded['hasMore'] == true,
        oldestCursor: decoded['oldestCursor']?.toString(),
        fetchedAt: fetchedAt,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _persistPage(
    ConversationThread thread,
    CachedMessagePage page,
  ) async {
    try {
      final user = await BotAdminSessionStore().readCachedUser();
      final userKey = user?.id ?? 0;
      await writeBotAdminDiskCache(
        'messages_${_messageCacheSchema}_${userKey}_${threadKey(thread)}',
        jsonEncode({
          'fetchedAt': page.fetchedAt.toUtc().toIso8601String(),
          'hasMore': page.hasMore,
          'oldestCursor': page.oldestCursor,
          'messages': page.messages.map(_messageCacheJson).toList(),
        }),
      );
    } catch (_) {}
  }

  Future<void> _clearPersistedPage(ConversationThread thread) async {
    final user = await BotAdminSessionStore().readCachedUser();
    final userKey = user?.id ?? 0;
    await clearBotAdminDiskCache(
      'messages_${_messageCacheSchema}_${userKey}_${threadKey(thread)}',
    );
  }

  Future<void> _warmAvatars(
    List<ConversationThread> threads,
    int generation,
  ) async {
    final urls = <String>[];
    for (final thread in threads) {
      final url = _absoluteAvatarUrl(thread.avatarUrl);
      if (url == null) continue;
      final warmKey = '${BotAdminSessionStore.sessionRevision.value}|$url';
      if (!_avatarWarmed.add(warmKey)) continue;
      urls.add(url);
    }
    for (final url in urls) {
      if (generation != _warmGeneration) return;
      await _precacheAvatar(url);
      if (generation != _warmGeneration) return;
      await Future<void>.delayed(const Duration(milliseconds: 4));
    }
  }

  Future<void> _precacheAvatar(String url) async {
    try {
      final cookie = await _api.readSessionCookieHeader();
      final protected = isBotAdminProtectedImageUrl(url);
      final headers = !kIsWeb && protected && cookie?.isNotEmpty == true
          ? <String, String>{'Cookie': cookie!}
          : null;
      final provider = CachedNetworkImageProvider(
        url,
        cacheKey: botAdminImageCacheKey(url, cookie: cookie),
        headers: headers,
        maxWidth: 96,
        maxHeight: 96,
      );
      final config = ImageConfiguration(
        size: const Size(49, 49),
        devicePixelRatio: 2,
      );
      final stream = provider.resolve(config);
      final completer = Completer<void>();
      late final ImageStreamListener listener;
      listener = ImageStreamListener(
        (image, synchronousCall) {
          if (!completer.isCompleted) completer.complete();
          stream.removeListener(listener);
        },
        onError: (error, stackTrace) {
          if (!completer.isCompleted) completer.complete();
          stream.removeListener(listener);
        },
      );
      stream.addListener(listener);
      await completer.future.timeout(
        const Duration(seconds: 6),
        onTimeout: () {},
      );
    } catch (_) {
      // ignore
    }
  }

  void _ensureCurrentSession() {
    final revision = BotAdminSessionStore.sessionRevision.value;
    if (_sessionRevision == revision) return;
    _sessionRevision = revision;
    _warmGeneration++;
    _messagePages.clear();
    _messageInFlight.clear();
    _avatarWarmed.clear();
  }

  String? _absoluteAvatarUrl(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    final raw = value.trim();
    if (raw.startsWith('https://pps.whatsapp.net/')) {
      final base = AppConfig.apiBaseUrl.trim();
      return '$base/api/whatsapp-avatar-proxy?url=${Uri.encodeComponent(raw)}';
    }
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    final base = AppConfig.apiBaseUrl.trim();
    final normalized = raw.startsWith('/') ? raw : '/$raw';
    if (base.isEmpty) {
      // Same-origin relative path for web.
      return Uri.base.resolve(normalized).toString();
    }
    return '$base$normalized';
  }
}

class CachedMessagePage {
  const CachedMessagePage({
    required this.messages,
    required this.hasMore,
    required this.oldestCursor,
    required this.fetchedAt,
  });

  final List<ChatMessage> messages;
  final bool hasMore;
  final String? oldestCursor;
  final DateTime fetchedAt;
}

Map<String, dynamic> _messageCacheJson(ChatMessage value) => {
  'id': value.id,
  'messageId': value.remoteId,
  if (value.clientMessageId != null) 'clientMessageId': value.clientMessageId,
  'text': value.text,
  'timestamp': value.timestamp.toUtc().toIso8601String(),
  'fromMe': value.fromMe,
  'senderName': value.senderName,
  if (value.senderJid != null) 'senderJid': value.senderJid,
  if (value.senderAvatarUrl != null) 'senderAvatarUrl': value.senderAvatarUrl,
  if (value.mediaUrl != null) 'mediaUrl': value.mediaUrl,
  if (value.messageType != null) 'messageType': value.messageType,
  if (value.mediaFileName != null) 'fileName': value.mediaFileName,
  if (value.mediaMimeType != null) 'mimeType': value.mediaMimeType,
  if (value.mediaCaption != null) 'caption': value.mediaCaption,
  if (value.mediaTitle != null) 'mediaTitle': value.mediaTitle,
  if (value.mediaSizeBytes != null) 'size': value.mediaSizeBytes,
  if (value.mediaThumbnailUrl != null) 'thumbnailUrl': value.mediaThumbnailUrl,
  if (value.mediaDurationSeconds != null)
    'duration': value.mediaDurationSeconds,
  if (value.media.isNotEmpty) 'media': value.media,
  if (value.isAnimatedMedia) 'isAnimated': true,
  if (value.deletedAt != null) 'deletedAt': value.deletedAt!.toIso8601String(),
  if (value.deletedByJid != null) 'deletedByJid': value.deletedByJid,
  if (value.deletedByName != null) 'deletedByName': value.deletedByName,
  if (value.deletedPlaceholder != null)
    'deletedPlaceholder': value.deletedPlaceholder,
  if (value.localStatus != null) 'localStatus': value.localStatus!.name,
  if (value.deliveryState != null) 'deliveryState': value.deliveryState!.name,
  if (value.receiptSummary.isNotEmpty) 'receiptSummary': value.receiptSummary,
  if (value.receipts.isNotEmpty)
    'receipts': value.receipts
        .map(
          (receipt) => {
            'userId': receipt.userId,
            'name': receipt.name,
            if (receipt.avatarUrl != null) 'avatarUrl': receipt.avatarUrl,
            'state': receipt.state.name,
            if (receipt.deliveredAt != null)
              'deliveredAt': receipt.deliveredAt!.toUtc().toIso8601String(),
            if (receipt.readAt != null)
              'readAt': receipt.readAt!.toUtc().toIso8601String(),
          },
        )
        .toList(growable: false),
};

final conversationCacheProvider = Provider<ConversationCache>((ref) {
  return ConversationCache(ref.watch(apiClientProvider));
});
