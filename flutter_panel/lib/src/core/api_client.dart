import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/bot_group.dart';
import '../models/bot_group_settings.dart';
import '../models/bot_instance.dart';
import '../models/chat_message.dart';
import '../models/conversation_thread.dart';
import '../models/internal_group.dart';
import '../models/admin_support.dart';
import '../models/migration_models.dart';
import '../models/sweepstake.dart';
import '../models/session_user.dart';
import '../models/whatsapp_contact.dart';
import 'app_config.dart';
import 'dashboard_disk_cache.dart';
import 'session_store.dart';

String? _youtubeVideoIdFromText(String value) {
  final patterns = <RegExp>[
    RegExp(
      r'(?:youtube\.com/(?:watch\?v=|shorts/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})',
      caseSensitive: false,
    ),
    RegExp(r'[?&]v=([A-Za-z0-9_-]{11})', caseSensitive: false),
  ];
  for (final pattern in patterns) {
    final id = pattern.firstMatch(value)?.group(1);
    if (id != null && id.isNotEmpty) return id;
  }
  return null;
}

String? _youtubeVideoIdFromSearchHtml(String html) {
  final patterns = <RegExp>[
    RegExp(r'"videoId":"([A-Za-z0-9_-]{11})"'),
    RegExp(r'videoId\\x22:\\x22([A-Za-z0-9_-]{11})'),
    RegExp(r'i\.ytimg\.com\\?/vi\\?/([A-Za-z0-9_-]{11})/'),
  ];
  for (final pattern in patterns) {
    final id = pattern.firstMatch(html)?.group(1);
    if (id != null && id.isNotEmpty) return id;
  }
  return null;
}

String? _youtubeDurationFromSearchHtml(String html, String videoId) {
  final index = html.indexOf(videoId);
  if (index < 0) return null;
  final start = (index - 6000).clamp(0, html.length);
  final end = (index + 16000).clamp(0, html.length);
  final window = html.substring(start, end);
  final patterns = <RegExp>[
    RegExp(r'lengthText\\x22[\s\S]{0,700}?simpleText\\x22:\\x22([0-9:]+)'),
    RegExp(r'"lengthText"[\s\S]{0,700}?"simpleText":"([0-9:]+)"'),
  ];
  for (final pattern in patterns) {
    final duration = pattern.firstMatch(window)?.group(1)?.trim();
    if (duration != null && duration.isNotEmpty) return duration;
  }
  return null;
}

class YoutubePreview {
  const YoutubePreview({
    required this.videoId,
    required this.thumbnailUrl,
    this.title,
    this.author,
    this.duration,
  });

  final String videoId;
  final String thumbnailUrl;
  final String? title;
  final String? author;
  final String? duration;
}

final sessionStoreProvider = Provider<BotAdminSessionStore>(
  (ref) => BotAdminSessionStore(),
);

final apiClientProvider = Provider<BotAdminApiClient>((ref) {
  return BotAdminApiClient(ref.watch(sessionStoreProvider));
});

class BotAdminApiException implements Exception {
  BotAdminApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class OutgoingInteractiveButton {
  const OutgoingInteractiveButton({
    required this.id,
    required this.text,
    required this.type,
    this.url,
    this.copyCode,
  });

  final String id;
  final String text;
  final String type;
  final String? url;
  final String? copyCode;

  Map<String, Object?> toJson() {
    return {
      'id': id,
      'text': text,
      'type': type,
      if (url != null && url!.trim().isNotEmpty) 'url': url!.trim(),
      if (copyCode != null && copyCode!.trim().isNotEmpty)
        'copyCode': copyCode!.trim(),
    };
  }
}

class GiphyMediaItem {
  const GiphyMediaItem({
    required this.id,
    required this.title,
    required this.type,
    required this.previewUrl,
    this.originalUrl,
    this.mp4Url,
    this.webpUrl,
    this.width,
    this.height,
  });

  final String id;
  final String title;
  final String type;
  final String previewUrl;
  final String? originalUrl;
  final String? mp4Url;
  final String? webpUrl;
  final int? width;
  final int? height;

  bool get isSticker => type.toLowerCase().contains('sticker');

  String get mediaUrl {
    final candidates = isSticker
        ? [webpUrl, originalUrl, mp4Url, previewUrl]
        : [originalUrl, previewUrl, webpUrl, mp4Url];
    return candidates
        .whereType<String>()
        .map((value) => value.trim())
        .firstWhere((value) => value.isNotEmpty, orElse: () => previewUrl);
  }

  String get fileName {
    final safeId = id.replaceAll(RegExp(r'[^a-zA-Z0-9_-]+'), '-');
    return isSticker ? 'giphy-$safeId.webp' : 'giphy-$safeId.gif';
  }

  String fileNameForMimeType(String mimeType) {
    final safeId = id.replaceAll(RegExp(r'[^a-zA-Z0-9_-]+'), '-');
    final normalized = mimeType.trim().toLowerCase();
    final extension =
        normalized.contains('mp4') || normalized.startsWith('video/')
        ? 'mp4'
        : normalized.contains('gif')
        ? 'gif'
        : normalized.contains('png')
        ? 'png'
        : normalized.contains('jpeg') || normalized.contains('jpg')
        ? 'jpg'
        : normalized.contains('webp')
        ? 'webp'
        : isSticker
        ? 'webp'
        : 'mp4';
    return 'giphy-$safeId.$extension';
  }

  String get preferredMimeType => isSticker ? 'image/webp' : 'image/gif';

  factory GiphyMediaItem.fromJson(Map<String, dynamic> json) {
    return GiphyMediaItem(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      type: (json['type'] ?? 'gifs').toString(),
      previewUrl: (json['previewUrl'] ?? '').toString(),
      originalUrl: json['originalUrl']?.toString(),
      mp4Url: json['mp4Url']?.toString(),
      webpUrl: json['webpUrl']?.toString(),
      width: _parseInt(json['width']),
      height: _parseInt(json['height']),
    );
  }

  static int? _parseInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }
}

class ChatMessagePage {
  const ChatMessagePage({
    required this.messages,
    required this.hasMore,
    required this.oldestCursor,
  });

  final List<ChatMessage> messages;
  final bool hasMore;
  final String? oldestCursor;
}

class BotAdminApiClient {
  BotAdminApiClient(this._sessionStore)
    : _dio = Dio(
        BaseOptions(
          baseUrl: AppConfig.apiBaseUrl,
          connectTimeout: const Duration(seconds: 20),
          receiveTimeout: const Duration(seconds: 90),
          headers: {
            'Accept': 'application/json',
            'X-BotAdmin-Mobile': 'flutter',
          },
          validateStatus: (_) => true,
        ),
      ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          options.extra['withCredentials'] = true;
          final cookie = await _sessionStore.readSessionCookie();
          if (cookie != null && cookie.isNotEmpty) {
            options.headers['Cookie'] = cookie;
          }
          handler.next(options);
        },
        onResponse: (response, handler) async {
          final setCookies = response.headers.map['set-cookie'];
          final sessionCookie = _extractCookie(
            setCookies,
            AppConfig.sessionCookieName,
          );
          final adminCookie = _extractCookie(setCookies, 'sb_admin_session');
          if (sessionCookie != null || adminCookie != null) {
            // A sessão de impersonação usa dois cookies. Preserve a referência
            // de origem mesmo quando uma resposta posterior renova apenas
            // sb_session; sem isso o botão "Voltar" desaparece/falha no APK.
            final previous = await _sessionStore.readSessionCookie() ?? '';
            final previousAdmin = _extractCookie(
              previous.split(';'),
              'sb_admin_session',
            );
            final effectiveSession =
                sessionCookie ??
                _extractCookie(
                  previous.split(';'),
                  AppConfig.sessionCookieName,
                );
            if (effectiveSession != null) {
              await _sessionStore.saveSessionCookie(
                [
                  effectiveSession,
                  if (adminCookie != null) adminCookie,
                  if (adminCookie == null && previousAdmin != null)
                    previousAdmin,
                ].join('; '),
              );
            }
          }
          handler.next(response);
        },
      ),
    );
  }

  String _absoluteInviteUrl(String raw) {
    return AppConfig.publicInviteUrl(raw);
  }

  final BotAdminSessionStore _sessionStore;
  final Dio _dio;
  DashboardSnapshot? _lastDashboardSnapshot;
  ResellerDashboardSnapshot? _lastResellerDashboardSnapshot;
  Future<DashboardSnapshot?>? _diskDashboardCacheInFlight;
  Future<void>? _dashboardRefreshInFlight;
  String? _dashboardCacheKey;
  String? _partnerCacheKey;
  final List<Map<String, dynamic>> _nativeRealtimeEvents = [];
  final Map<int, List<ConversationThread>> _conversationThreadCache = {};
  final Map<int, List<Map<String, dynamic>>> _groupParticipantsCache = {};
  final Map<String, Future<YoutubePreview?>> _youtubePreviewCache = {};

  /// Last usable state kept available while the API reconnects in background.
  DashboardSnapshot? get lastDashboardSnapshot => _lastDashboardSnapshot;

  void _clearSessionCaches() {
    _lastDashboardSnapshot = null;
    final previousKey = _dashboardCacheKey;
    if (previousKey != null) {
      unawaited(clearDashboardDiskCache(previousKey));
    }
    _dashboardCacheKey = null;
    final previousPartnerKey = _partnerCacheKey;
    if (previousPartnerKey != null) {
      unawaited(clearPartnerDiskCache(previousPartnerKey));
    }
    _partnerCacheKey = null;
    _lastResellerDashboardSnapshot = null;
    _diskDashboardCacheInFlight = null;
    _dashboardRefreshInFlight = null;
    _nativeRealtimeEvents.clear();
    _conversationThreadCache.clear();
    _groupParticipantsCache.clear();
  }

  Future<SessionUser?> readCachedSessionUser() =>
      _sessionStore.readCachedUser();

  Future<AuthSession?> restoreSession({bool fallbackToCached = true}) async {
    final cookieBefore = await _sessionStore.readSessionCookie();
    try {
      final json = await getJson(
        '/api/auth/session',
      ).timeout(const Duration(seconds: 15));
      final userJson = json['user'];
      if (userJson is! Map<String, dynamic>) {
        if (cookieBefore != null && cookieBefore.isNotEmpty) {
          await _sessionStore.clear();
          _clearSessionCaches();
        }
        return null;
      }
      final user = SessionUser.fromJson(userJson);
      await _sessionStore.saveCachedUser(user);
      return AuthSession(user: user);
    } on BotAdminApiException catch (error) {
      if (fallbackToCached &&
          cookieBefore != null &&
          cookieBefore.isNotEmpty &&
          error.statusCode != 401) {
        final cachedUser = await _sessionStore.readCachedUser();
        if (cachedUser != null) return AuthSession(user: cachedUser);
      }
      if (error.statusCode == 401) {
        await _sessionStore.clear();
        _clearSessionCaches();
        return null;
      }
      rethrow;
    } on TimeoutException {
      final cachedUser = await _sessionStore.readCachedUser();
      if (fallbackToCached &&
          cookieBefore != null &&
          cookieBefore.isNotEmpty &&
          cachedUser != null) {
        return AuthSession(user: cachedUser);
      }
      rethrow;
    }
  }

  Future<AuthSession> login({
    required String identifier,
    required String password,
    bool remember = true,
  }) async {
    _clearSessionCaches();
    await _sessionStore.clear();
    final json = await postJson(
      '/api/auth/login',
      data: {
        'identifier': identifier,
        'password': password,
        'remember': remember,
      },
    );
    final userJson = json['user'];
    if (userJson is! Map<String, dynamic>) {
      throw BotAdminApiException(
        'Login aceito, mas o usuario nao veio na resposta.',
      );
    }
    await _persistJsonSessionCookie(json);
    final user = SessionUser.fromJson(userJson);
    await _sessionStore.saveCachedUser(user);
    return AuthSession(user: user);
  }

  Future<AuthSession> consumeMobileAppAuthToken(String token) async {
    _clearSessionCaches();
    await _sessionStore.clear();
    final json = await postJson(
      '/api/mobile/app-auth/consume',
      data: {'token': token},
    );
    final userJson = json['user'];
    if (userJson is! Map<String, dynamic>) {
      throw BotAdminApiException(
        'App autenticado, mas o usuario nao veio na resposta.',
      );
    }
    await _persistJsonSessionCookie(json);
    final user = SessionUser.fromJson(userJson);
    await _sessionStore.saveCachedUser(user);
    return AuthSession(user: user);
  }

  Future<AuthSession> impersonateUser(int userId) async {
    if (userId <= 0) {
      throw BotAdminApiException('Usuário inválido.');
    }
    _clearSessionCaches();
    final json = await postJson('/api/admin/users/$userId/impersonate');
    final sessionCookie = json['sessionCookie']?.toString().trim() ?? '';
    final adminSessionCookie =
        json['adminSessionCookie']?.toString().trim() ?? '';
    if (sessionCookie.isNotEmpty) {
      await _sessionStore.saveSessionCookie(
        [
          sessionCookie,
          if (adminSessionCookie.isNotEmpty) adminSessionCookie,
        ].join('; '),
      );
    }
    final session = await restoreSession(fallbackToCached: false);
    if (session == null || session.user.id != userId) {
      throw BotAdminApiException(
        'A sessão foi criada, mas o painel do usuário não pôde ser aberto.',
      );
    }
    return session;
  }

  Future<AuthSession> revertImpersonation() async {
    _clearSessionCaches();
    await postJson('/api/admin/users/impersonate/revert');
    final session = await restoreSession(fallbackToCached: false);
    if (session == null ||
        (!session.user.isAdmin && (session.user.partnerRole ?? '').isEmpty)) {
      throw BotAdminApiException('A sessão de origem não pôde ser restaurada.');
    }
    return session;
  }

  Future<Map<String, dynamic>> registerAccount({
    required String name,
    required String email,
    required String whatsappNumber,
    required String password,
  }) {
    return postJson(
      '/api/auth/register',
      data: {
        'name': name,
        'email': email,
        'whatsappNumber': whatsappNumber,
        'password': password,
      },
    );
  }

  Future<Map<String, dynamic>> requestPasswordRecovery({
    required String identifier,
  }) {
    return postJson('/api/auth/forgot', data: {'identifier': identifier});
  }

  Future<Map<String, dynamic>> resetPasswordWithCode({
    required String identifier,
    required String code,
    required String password,
  }) {
    return postJson(
      '/api/auth/reset',
      data: {'identifier': identifier, 'code': code, 'password': password},
    );
  }

  Future<SessionUser> updateUserProfile({
    String? name,
    String? email,
    String? password,
    String? whatsappDialCode,
    String? whatsappNumber,
    Uint8List? avatarBytes,
    String? avatarFileName,
    String? avatarMimeType,
    bool removeAvatar = false,
  }) async {
    final data = FormData();
    void addField(String key, String? value) {
      if (value == null) return;
      data.fields.add(MapEntry(key, value));
    }

    addField('name', name);
    addField('email', email);
    addField('password', password);
    addField('whatsappDialCode', whatsappDialCode);
    addField('whatsappNumber', whatsappNumber);
    if (removeAvatar) {
      data.fields.add(const MapEntry('removeAvatar', 'true'));
    }
    if (avatarBytes != null && avatarBytes.isNotEmpty) {
      data.files.add(
        MapEntry(
          'avatar',
          MultipartFile.fromBytes(
            avatarBytes,
            filename: avatarFileName?.trim().isNotEmpty == true
                ? avatarFileName!.trim()
                : 'avatar.jpg',
            contentType: DioMediaType.parse(
              avatarMimeType?.trim().isNotEmpty == true
                  ? avatarMimeType!.trim()
                  : 'image/jpeg',
            ),
          ),
        ),
      );
    }

    final response = await _dio.patch<Object?>('/api/user/profile', data: data);
    final json = _decode(response);
    if (response.statusCode != null &&
        (response.statusCode! < 200 || response.statusCode! >= 300)) {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível atualizar o perfil.',
        statusCode: response.statusCode,
      );
    }
    final userJson = json['user'];
    if (userJson is Map<String, dynamic>) {
      final user = SessionUser.fromJson(userJson);
      await _sessionStore.saveCachedUser(user);
      return user;
    }
    if (userJson is Map) {
      final user = SessionUser.fromJson(userJson.cast<String, dynamic>());
      await _sessionStore.saveCachedUser(user);
      return user;
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'Perfil atualizado sem dados de retorno.',
    );
  }

  Future<void> logout() async {
    try {
      await postJson('/api/auth/logout');
    } finally {
      await _sessionStore.clear();
      _clearSessionCaches();
    }
  }

  Future<DashboardSnapshot> loadDashboardSnapshot({
    bool syncDirectory = false,
    Duration syncTimeout = const Duration(seconds: 12),
  }) async {
    // The first frame after opening the app must come from local state.  A
    // refresh is started only once in the background, so navigating between
    // sections never causes a full dashboard request on every build.
    final memory = _lastDashboardSnapshot;
    if (memory != null) {
      _refreshDashboardInBackground(
        syncDirectory: syncDirectory,
        syncTimeout: syncTimeout,
      );
      return memory;
    }

    final disk = await _readDashboardDiskSnapshot();
    if (disk != null) {
      _lastDashboardSnapshot = disk;
      _applyNativeRealtimeEvents();
      _refreshDashboardInBackground(
        syncDirectory: syncDirectory,
        syncTimeout: syncTimeout,
      );
      return disk;
    }

    try {
      final snapshot = await _loadDashboardSnapshotNetwork(
        syncDirectory: syncDirectory,
        syncTimeout: syncTimeout,
      );
      _lastDashboardSnapshot = snapshot;
      _applyNativeRealtimeEvents();
      await _writeDashboardDiskSnapshot(snapshot);
      return snapshot;
    } catch (_) {
      final cached = _lastDashboardSnapshot;
      if (cached != null) return cached;
      rethrow;
    }
  }

  void _refreshDashboardInBackground({
    required bool syncDirectory,
    required Duration syncTimeout,
  }) {
    if (_dashboardRefreshInFlight != null) return;
    final request = () async {
      try {
        final snapshot = await _loadDashboardSnapshotNetwork(
          syncDirectory: syncDirectory,
          syncTimeout: syncTimeout,
        );
        _lastDashboardSnapshot = _mergeDashboardSnapshots(
          _lastDashboardSnapshot,
          snapshot,
        );
        _applyNativeRealtimeEvents();
        await _writeDashboardDiskSnapshot(_lastDashboardSnapshot!);
      } catch (_) {
        // Keep showing the last known state while connectivity recovers.
      }
    }();
    _dashboardRefreshInFlight = request;
    unawaited(
      request.whenComplete(() {
        if (identical(_dashboardRefreshInFlight, request)) {
          _dashboardRefreshInFlight = null;
        }
      }),
    );
  }

  DashboardSnapshot _mergeDashboardSnapshots(
    DashboardSnapshot? previous,
    DashboardSnapshot next,
  ) {
    if (previous == null) return next;
    final byKey = <String, ConversationThread>{
      for (final thread in next.threads)
        '${thread.instanceId}|${thread.chatJid.toLowerCase()}': thread,
    };
    for (final oldThread in previous.threads) {
      final key = '${oldThread.instanceId}|${oldThread.chatJid.toLowerCase()}';
      final fresh = byKey[key];
      if (fresh == null || oldThread.lastActivity.isAfter(fresh.lastActivity)) {
        byKey[key] = oldThread;
      }
    }
    final threads = byKey.values.toList()
      ..sort((a, b) {
        if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
        return b.lastActivity.compareTo(a.lastActivity);
      });
    return DashboardSnapshot(
      instances: next.instances.isEmpty ? previous.instances : next.instances,
      groups: next.groups.isEmpty ? previous.groups : next.groups,
      threads: threads,
    );
  }

  /// Applies events received by Android while the process was closed.  Only
  /// the conversation preview is touched here; opening the chat still fetches
  /// the authoritative message page and merges it with the local cache.
  void applyNativeRealtimeEvents(Iterable<Map<String, dynamic>> events) {
    for (final event in events) {
      _nativeRealtimeEvents.add(Map<String, dynamic>.from(event));
    }
    if (_nativeRealtimeEvents.length > 200) {
      _nativeRealtimeEvents.removeRange(0, _nativeRealtimeEvents.length - 200);
    }
    _applyNativeRealtimeEvents();
  }

  void _applyNativeRealtimeEvents() {
    final snapshot = _lastDashboardSnapshot;
    if (snapshot == null || _nativeRealtimeEvents.isEmpty) return;
    var threads = [...snapshot.threads];
    for (final event in _nativeRealtimeEvents) {
      final jid = event['chatJid']?.toString().trim() ?? '';
      if (jid.isEmpty) continue;
      final instanceId =
          int.tryParse(event['instanceId']?.toString() ?? '') ?? 0;
      final preview = event['messagePreview']?.toString().trim() ?? '';
      final title = event['chatTitle']?.toString().trim() ?? '';
      final sender = event['senderName']?.toString().trim() ?? '';
      final timestamp =
          DateTime.tryParse(event['timestamp']?.toString() ?? '') ??
          DateTime.now();
      final index = threads.indexWhere(
        (thread) =>
            thread.instanceId == instanceId &&
            thread.chatJid.toLowerCase() == jid.toLowerCase(),
      );
      if (index >= 0) {
        final current = threads[index];
        threads[index] = current.copyWith(
          lastMessage: preview.isEmpty ? current.lastMessage : preview,
          lastActivity: timestamp.isAfter(current.lastActivity)
              ? timestamp
              : current.lastActivity,
          lastMessageDirection: 'inbound',
          lastMessageSenderName: sender.isEmpty ? null : sender,
          unreadCount: current.unreadCount + 1,
        );
      } else {
        threads.add(
          ConversationThread(
            instanceId: instanceId,
            chatJid: jid,
            title: title.isEmpty ? 'Nova conversa' : title,
            lastMessage: preview,
            lastActivity: timestamp,
            unreadCount: 1,
            lastMessageDirection: 'inbound',
            lastMessageSenderName: sender.isEmpty ? null : sender,
            chatType: jid.endsWith('@g.us') ? 'group' : 'contact',
          ),
        );
      }
    }
    threads.sort((a, b) {
      if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
      return b.lastActivity.compareTo(a.lastActivity);
    });
    _lastDashboardSnapshot = DashboardSnapshot(
      instances: snapshot.instances,
      groups: snapshot.groups,
      threads: threads,
    );
    _nativeRealtimeEvents.clear();
    unawaited(_writeDashboardDiskSnapshot(_lastDashboardSnapshot!));
  }

  Future<String> _dashboardCacheIdentity() async {
    final user = await _sessionStore.readCachedUser();
    final id = user?.id ?? 0;
    final key = 'user_${id > 0 ? id : 'anonymous'}';
    _dashboardCacheKey = key;
    return key;
  }

  Future<DashboardSnapshot?> _readDashboardDiskSnapshot() {
    final pending = _diskDashboardCacheInFlight;
    if (pending != null) return pending;
    final request = () async {
      try {
        final key = await _dashboardCacheIdentity();
        final raw = await readDashboardDiskCache(key);
        if (raw == null) return null;
        final decoded = jsonDecode(raw);
        if (decoded is! Map) return null;
        final savedAt = DateTime.tryParse(decoded['savedAt']?.toString() ?? '');
        if (savedAt != null &&
            DateTime.now().difference(savedAt).abs() >
                const Duration(days: 14)) {
          return null;
        }
        final payload = _map(decoded['snapshot']);
        final instances = _list(
          payload['instances'],
        ).map(BotInstance.fromJson).toList(growable: false);
        final groups = _list(
          payload['groups'],
        ).map(BotGroup.fromJson).toList(growable: false);
        final threads = _list(payload['threads'])
            .map(
              (item) => ConversationThread.fromJson(
                item,
                fallbackInstanceId:
                    int.tryParse(item['instanceId']?.toString() ?? '') ?? 0,
              ),
            )
            .toList(growable: false);
        if (instances.isEmpty && groups.isEmpty && threads.isEmpty) return null;
        return DashboardSnapshot(
          instances: instances,
          groups: groups,
          threads: threads,
        );
      } catch (_) {
        return null;
      }
    }();
    _diskDashboardCacheInFlight = request;
    return request.whenComplete(() {
      if (identical(_diskDashboardCacheInFlight, request)) {
        _diskDashboardCacheInFlight = null;
      }
    });
  }

  Future<void> _writeDashboardDiskSnapshot(DashboardSnapshot snapshot) async {
    try {
      final key = _dashboardCacheKey ?? await _dashboardCacheIdentity();
      final encoded = jsonEncode({
        'savedAt': DateTime.now().toUtc().toIso8601String(),
        'snapshot': {
          'instances': snapshot.instances.map(_botInstanceCacheJson).toList(),
          'groups': snapshot.groups.map(_botGroupCacheJson).toList(),
          'threads': snapshot.threads
              .map(_conversationThreadCacheJson)
              .toList(),
        },
      });
      await writeDashboardDiskCache(key, encoded);
    } catch (_) {}
  }

  Future<DashboardSnapshot> _loadDashboardSnapshotNetwork({
    bool syncDirectory = false,
    Duration syncTimeout = const Duration(seconds: 12),
  }) async {
    final supportFuture = _safeLoadUserSupportSummary();
    final internalGroupsFuture = _safeLoadInternalGroups();
    final results = await Future.wait([
      getJson('/api/bot-instances').timeout(const Duration(seconds: 14)),
      getJson('/api/bot-groups').timeout(const Duration(seconds: 14)),
    ]);
    final instancesJson = results[0];
    final groupsJson = results[1];
    final instances = _list(
      instancesJson['instances'],
    ).map(BotInstance.fromJson).toList();
    final groups = _list(groupsJson['groups']).map(BotGroup.fromJson).toList();
    final groupsByJid = {
      for (final group in groups)
        if (group.remoteJid.trim().isNotEmpty)
          _normalizeConversationJidKey(group.remoteJid): group,
    };
    final threadBatches = await Future.wait(
      instances.map(
        (instance) => _safeLoadConversationThreads(
          instance.id,
          syncDirectory: syncDirectory,
          syncTimeout: syncTimeout,
        ),
      ),
    );
    final threads = <ConversationThread>[];
    for (var index = 0; index < threadBatches.length; index += 1) {
      final batch = threadBatches[index];
      threads.addAll(
        batch.map((thread) {
          final savedGroup =
              groupsByJid[_normalizeConversationJidKey(thread.chatJid)];
          if (thread.isGroup && savedGroup != null) {
            final groupAvatar = savedGroup.avatarUrl?.trim();
            final shouldUseGroupAvatar =
                (thread.avatarUrl == null ||
                    thread.avatarUrl!.trim().isEmpty) &&
                groupAvatar != null &&
                groupAvatar.isNotEmpty;
            final shouldUseGroupTitle =
                savedGroup.name.trim().isNotEmpty &&
                (thread.title == 'Grupo' ||
                    thread.title.trim().startsWith('120363') ||
                    thread.title.trim().contains('@g.us'));
            if (shouldUseGroupAvatar || shouldUseGroupTitle) {
              return thread.copyWith(
                title: shouldUseGroupTitle ? savedGroup.name.trim() : null,
                avatarUrl: shouldUseGroupAvatar ? groupAvatar : null,
              );
            }
          }
          return thread;
        }),
      );
    }
    final support = await supportFuture;
    if (support != null) {
      threads.add(
        ConversationThread(
          instanceId: 0,
          chatJid: '__admin__',
          title: support.supportName?.trim().isNotEmpty == true
              ? support.supportName!.trim()
              : 'Suporte BotAdmin',
          lastMessage: support.lastMessagePreview?.trim().isNotEmpty == true
              ? support.lastMessagePreview!.trim()
              : 'Fale diretamente com nossa equipe de suporte.',
          lastActivity:
              DateTime.tryParse(support.lastMessageAt ?? '') ??
              DateTime.fromMillisecondsSinceEpoch(0),
          unreadCount: support.unreadCount,
          avatarUrl: support.supportAvatarUrl,
          chatType: 'support',
          supportRole: support.supportRole,
          canSendMessages: true,
          pinned: false,
        ),
      );
    }
    final internalGroups = await internalGroupsFuture;
    threads.addAll(internalGroups.map((group) => group.toConversationThread()));

    return DashboardSnapshot(
      instances: instances,
      groups: groups,
      threads: threads
        ..sort((a, b) {
          if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
          return b.lastActivity.compareTo(a.lastActivity);
        }),
    );
  }

  Future<List<InternalGroup>> _safeLoadInternalGroups() async {
    try {
      return await loadInternalGroups().timeout(const Duration(seconds: 12));
    } catch (_) {
      return const <InternalGroup>[];
    }
  }

  Future<AdminSupportThreadSummary?> _safeLoadUserSupportSummary() async {
    try {
      final threads = await loadUserSupportThreads().timeout(
        const Duration(seconds: 12),
      );
      for (final thread in threads) {
        if (thread.isAdminThread || thread.whatsappId == '__admin__') {
          return thread;
        }
      }
      return threads.isEmpty ? null : threads.first;
    } catch (_) {
      // WhatsApp conversations must still load if support is temporarily down.
      return null;
    }
  }

  Future<List<ConversationThread>> _safeLoadConversationThreads(
    int instanceId, {
    required bool syncDirectory,
    required Duration syncTimeout,
  }) async {
    try {
      final response = await _loadConversationThreadsForInstance(
        instanceId,
        syncDirectory: syncDirectory,
        syncTimeout: syncTimeout,
      ).timeout(syncDirectory ? syncTimeout : const Duration(seconds: 45));
      final threads = <ConversationThread>[];
      for (final json in _list(response['threads'])) {
        try {
          threads.add(
            ConversationThread.fromJson(json, fallbackInstanceId: instanceId),
          );
        } catch (_) {
          // A single malformed/stale row must not hide the whole WhatsApp list.
        }
      }
      final stableThreads = List<ConversationThread>.unmodifiable(threads);
      _conversationThreadCache[instanceId] = stableThreads;
      return stableThreads;
    } catch (_) {
      return _conversationThreadCache[instanceId] ??
          const <ConversationThread>[];
    }
  }

  Future<Map<String, dynamic>> _loadConversationThreadsForInstance(
    int instanceId, {
    required bool syncDirectory,
    required Duration syncTimeout,
  }) {
    final cachedPath = _conversationThreadsPath(
      instanceId,
      syncDirectory: false,
    );

    if (!syncDirectory) {
      return getJson(cachedPath);
    }

    return getJson(
      _conversationThreadsPath(instanceId, syncDirectory: true),
    ).timeout(syncTimeout, onTimeout: () => getJson(cachedPath));
  }

  String _conversationThreadsPath(
    int instanceId, {
    required bool syncDirectory,
  }) {
    final query = Uri(
      queryParameters: {
        'sync': syncDirectory ? '1' : '0',
        'includeContacts': '1',
      },
    ).query;
    return '/api/bot-instances/$instanceId/whatsapp-conversations?$query';
  }

  String _normalizeConversationJidKey(String value) {
    final trimmed = value.trim().toLowerCase();
    if (trimmed.isEmpty) return trimmed;
    if (trimmed.endsWith('@g.us') || trimmed.endsWith('@newsletter')) {
      return trimmed;
    }
    final local = trimmed.contains('@') ? trimmed.split('@').first : trimmed;
    final digits = local.replaceAll(RegExp(r'\D+'), '');
    if (RegExp(r'^120363\d{6,}$').hasMatch(digits)) {
      return '$digits@g.us';
    }
    if (trimmed.endsWith('@c.us') && digits.isNotEmpty) {
      return '$digits@s.whatsapp.net';
    }
    return trimmed;
  }

  Future<List<WhatsAppContact>> loadInstanceContacts(int instanceId) async {
    final json = await getJson('/api/bot-instances/$instanceId/contacts');
    final contacts = _list(json['contacts'])
        .map(WhatsAppContact.fromJson)
        .where((contact) {
          return contact.jid.trim().isNotEmpty &&
              !contact.jid.trim().endsWith('@g.us');
        })
        .toList();

    contacts.sort(
      (left, right) => left.displayName.toLowerCase().compareTo(
        right.displayName.toLowerCase(),
      ),
    );
    return contacts;
  }

  Future<List<Map<String, dynamic>>> loadInstanceGroups(int instanceId) async {
    final json = await getJson('/api/bot-instances/$instanceId/groups');
    final groups = _list(json['groups']);
    groups.sort(
      (left, right) => (left['name']?.toString() ?? '').toLowerCase().compareTo(
        (right['name']?.toString() ?? '').toLowerCase(),
      ),
    );
    return groups;
  }

  Future<List<Map<String, dynamic>>> loadBroadcastLists(int instanceId) async {
    final json = await getJson(
      '/api/bot-instances/$instanceId/broadcast-lists',
    );
    return _list(json['lists']);
  }

  Future<Map<String, dynamic>> loadBroadcastList(
    int instanceId,
    String listId,
  ) => getJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}',
  );

  Future<Map<String, dynamic>> createBroadcastList(
    int instanceId, {
    required String name,
    String description = '',
    List<Map<String, dynamic>> contacts = const [],
  }) => postJson(
    '/api/bot-instances/$instanceId/broadcast-lists',
    data: {'name': name, 'description': description, 'contacts': contacts},
  );

  Future<Map<String, dynamic>> importBroadcastContacts(
    int instanceId,
    String listId, {
    List<Map<String, dynamic>> contacts = const [],
    List<Map<String, dynamic>> groups = const [],
    String? googleSheetUrl,
    Map<String, dynamic>? googleSheetMapping,
  }) => postJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/contacts',
    data: {
      'contacts': contacts,
      if (groups.isNotEmpty) 'groups': groups,
      if (googleSheetUrl != null && googleSheetUrl.trim().isNotEmpty)
        'googleSheetUrl': googleSheetUrl.trim(),
      if (googleSheetMapping != null) 'googleSheetMapping': googleSheetMapping,
    },
  );
  Future<Map<String, dynamic>> updateBroadcastGroupMentions(
    int instanceId,
    String listId, {
    required bool mentionAll,
    required bool excludeAdmins,
  }) => patchJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/contacts',
    data: {'mentionAll': mentionAll, 'excludeAdmins': excludeAdmins},
  );

  Future<Map<String, dynamic>> previewGoogleSheet(
    String url, {
    Map<String, dynamic>? mapping,
  }) => postJson(
    '/api/integrations/google-sheets/preview',
    data: {'googleSheetUrl': url, if (mapping != null) 'mapping': mapping},
  );
  Future<Map<String, dynamic>> listGoogleSpreadsheets() =>
      getJson('/api/integrations/google-sheets/files');

  Future<Map<String, dynamic>> syncBroadcastGoogleSheet(
    int instanceId,
    String listId, {
    bool apply = false,
  }) => postJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/sync',
    data: {'apply': apply},
  );

  Future<Map<String, dynamic>> startBroadcastRun(
    int instanceId,
    String listId, {
    required String body,
    required bool typingEnabled,
    required int minDelayMs,
    required int maxDelayMs,
    Map<String, dynamic>? media,
    Map<String, dynamic>? quietHours,
    Map<String, dynamic>? pacing,
    List<OutgoingInteractiveButton> buttons = const [],
    List<Map<String, dynamic>> variables = const [],
    List<Map<String, dynamic>> messageVariants = const [],
  }) => postJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/send',
    data: {
      'body': body,
      'typingEnabled': typingEnabled,
      'minDelayMs': minDelayMs,
      'maxDelayMs': maxDelayMs,
      if (media != null) 'media': media,
      if (quietHours != null) 'quietHours': quietHours,
      if (pacing != null) 'pacing': pacing,
      if (buttons.isNotEmpty)
        'buttons': buttons.map((item) => item.toJson()).toList(),
      if (variables.isNotEmpty) 'variables': variables,
      if (messageVariants.length >= 2) 'messageVariants': messageVariants,
    },
  );

  Future<Map<String, dynamic>> saveBroadcastTemplate(
    int instanceId,
    String listId,
    Map<String, dynamic> data,
  ) => postJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/templates',
    data: data,
  );
  Future<Map<String, dynamic>> previewBroadcastVariables(
    int instanceId,
    String listId, {
    required String body,
    required List<Map<String, dynamic>> variables,
  }) => postJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/variables/preview',
    data: {'body': body, 'variables': variables},
  );
  Future<Map<String, dynamic>> deleteBroadcastTemplate(
    int instanceId,
    String listId,
    String templateId,
  ) => deleteJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/templates',
    data: {'templateId': templateId},
  );
  Future<Map<String, dynamic>> scheduleBroadcastRun(
    int instanceId,
    String listId,
    Map<String, dynamic> data,
  ) => postJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/schedules',
    data: data,
  );
  Future<Map<String, dynamic>> updateBroadcastSchedule(
    int instanceId,
    String listId,
    String scheduleId, {
    bool? enabled,
    int? recurrenceMinutes,
    String? scheduledAt,
    String? timezone,
    Map<String, dynamic>? quietHours,
  }) => patchJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/schedules',
    data: {
      'scheduleId': scheduleId,
      if (enabled != null) 'enabled': enabled,
      if (recurrenceMinutes != null) 'recurrenceMinutes': recurrenceMinutes,
      if (scheduledAt != null) 'scheduledAt': scheduledAt,
      if (timezone != null) 'timezone': timezone,
      if (quietHours != null) 'quietHours': quietHours,
    },
  );
  Future<Map<String, dynamic>> deleteBroadcastSchedule(
    int instanceId,
    String listId,
    String scheduleId,
  ) => deleteJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/schedules',
    data: {'scheduleId': scheduleId},
  );

  Future<Map<String, dynamic>> uploadBroadcastMedia(
    int instanceId,
    String listId, {
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    required String mediaType,
  }) async {
    final response = await _dio.post<Object?>(
      '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/upload',
      data: FormData.fromMap({
        'mediaType': mediaType,
        'file': MultipartFile.fromBytes(
          bytes,
          filename: fileName,
          contentType: DioMediaType.parse(
            mimeType.isEmpty ? 'application/octet-stream' : mimeType,
          ),
        ),
      }),
    );
    final json = _decode(response);
    if (response.statusCode == null ||
        response.statusCode! < 200 ||
        response.statusCode! >= 300)
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível enviar a mídia.',
        statusCode: response.statusCode,
      );
    return _map(json['media']);
  }

  Future<Map<String, dynamic>> removeBroadcastContacts(
    int instanceId,
    String listId, {
    List<String>? contactIds,
  }) => deleteJson(
    '/api/bot-instances/$instanceId/broadcast-lists/${Uri.encodeComponent(listId)}/contacts',
    data: {if (contactIds != null) 'contactIds': contactIds},
  );

  Future<String> createGoogleSheetsAuthorizationUrl() async {
    final json = await postJson(
      '/api/integrations/google-sheets/authorize',
      data: const {},
    );
    final url = json['authorizationUrl']?.toString().trim() ?? '';
    if (url.isEmpty)
      throw BotAdminApiException(
        'Não foi possível iniciar a conexão com Google Sheets.',
      );
    return url;
  }

  Future<Map<String, dynamic>?> getGoogleSheetsConnection() async {
    final json = await getJson('/api/integrations/google-sheets/status');
    final connected = json['connected'];
    return connected is Map ? Map<String, dynamic>.from(connected) : null;
  }

  Future<void> disconnectGoogleSheets() async {
    await deleteJson('/api/integrations/google-sheets/status');
  }

  Future<List<AdminSupportThreadEntry>> loadAdminSupportThreads() async {
    final json = await getJson('/api/admin/support/threads');
    final threads = _list(
      json['threads'],
    ).map(AdminSupportThreadEntry.fromJson).toList();
    threads.sort((left, right) {
      final l = DateTime.tryParse(left.thread.lastMessageAt ?? '');
      final r = DateTime.tryParse(right.thread.lastMessageAt ?? '');
      if (l == null && r == null) return 0;
      if (l == null) return 1;
      if (r == null) return -1;
      return r.compareTo(l);
    });
    return threads;
  }

  Future<List<AdminSupportThreadSummary>> loadUserSupportThreads() async {
    final json = await getJson('/api/support/threads');
    return _list(
      json['threads'],
    ).map(AdminSupportThreadSummary.fromJson).toList(growable: false);
  }

  Future<AdminSupportConversation> loadUserSupportConversation({
    String whatsappId = '__admin__',
  }) async {
    final json = await getJson(
      '/api/support/threads/${Uri.encodeComponent(whatsappId)}',
    );
    return AdminSupportConversation.fromJson(json);
  }

  Future<AdminSupportMessage> sendUserSupportText({
    String whatsappId = '__admin__',
    required String text,
  }) async {
    final json = await postFormData(
      '/api/support/messages',
      FormData.fromMap({'to': whatsappId, 'mode': 'text', 'text': text}),
    );
    return AdminSupportMessage.fromJson(_map(json['message']));
  }

  Future<AdminSupportConversation> loadAdminSupportConversation({
    required int userId,
    required String whatsappId,
  }) async {
    final json = await getJson(
      '/api/admin/support/threads/$userId/${Uri.encodeComponent(whatsappId)}',
    );
    return AdminSupportConversation.fromJson(json);
  }

  Future<AdminSupportMessage> sendAdminSupportText({
    required int userId,
    required String whatsappId,
    required String text,
  }) async {
    final formData = FormData.fromMap({
      'userId': userId.toString(),
      'to': whatsappId,
      'mode': 'text',
      'text': text,
    });
    final response = await _dio.post<Object?>(
      '/api/admin/support/messages',
      data: formData,
    );
    final json = _decode(response);
    return AdminSupportMessage.fromJson(_map(json['message']));
  }

  Future<AdminSupportThreadSummary> updateAdminSupportHandlingMode({
    required int userId,
    required String whatsappId,
    required String handlingMode,
  }) async {
    final json = await patchJson(
      '/api/admin/support/threads/$userId/${Uri.encodeComponent(whatsappId)}',
      data: {'handlingMode': handlingMode},
    );
    return AdminSupportThreadSummary.fromJson(_map(json['thread']));
  }

  Future<AdminSupportThreadSummary> runAdminSupportThreadAction({
    required int userId,
    required String whatsappId,
    required String action,
  }) async {
    final json = await postJson(
      '/api/admin/support/threads/$userId/${Uri.encodeComponent(whatsappId)}',
      data: {'action': action},
    );
    return AdminSupportThreadSummary.fromJson(_map(json['thread']));
  }

  int _internalGroupId(ConversationThread thread) {
    final id =
        thread.linkedGroupId ??
        int.tryParse(thread.chatJid.split(':').last.trim()) ??
        0;
    if (id <= 0) {
      throw BotAdminApiException('Grupo BotAdmin inválido.');
    }
    return id;
  }

  Future<ChatMessagePage> loadMessagePage(
    ConversationThread thread, {
    int limit = 80,
    String? before,
    bool warm = false,
  }) async {
    if (thread.isInternalGroup) {
      final groupId = _internalGroupId(thread);
      final page = await loadInternalGroupMessages(
        groupId,
        before: int.tryParse(before ?? ''),
        limit: limit,
      );
      final messages =
          (page['messages'] as List)
              .cast<InternalGroupMessage>()
              .map((message) => message.toChatMessage(thread))
              .toList(growable: false)
            ..sort((a, b) => a.timestamp.compareTo(b.timestamp));
      return ChatMessagePage(
        messages: messages,
        hasMore: page['hasMore'] == true,
        oldestCursor: page['oldestId']?.toString(),
      );
    }
    final query = Uri(
      queryParameters: {
        'limit': '$limit',
        if (before != null && before.trim().isNotEmpty) 'before': before.trim(),
        // warm=1: fast path for prefetch (skip avatar hydrate + mark-read).
        if (warm) 'warm': '1',
      },
    ).query;
    final json = await getJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/messages?$query',
    );
    final messages =
        _list(
            json['messages'],
          ).map((item) => ChatMessage.fromJson(item, thread: thread)).toList()
          ..sort((a, b) => a.timestamp.compareTo(b.timestamp));
    final cursor = json['oldestCursor']?.toString().trim();
    return ChatMessagePage(
      messages: messages,
      hasMore: json['hasMore'] == true,
      oldestCursor: cursor == null || cursor.isEmpty ? null : cursor,
    );
  }

  Future<List<ChatMessage>> loadMessages(
    ConversationThread thread, {
    int limit = 80,
  }) async {
    final page = await loadMessagePage(thread, limit: limit);
    return page.messages;
  }

  Future<void> requestOlderChatHistory(
    ConversationThread thread, {
    int count = 50,
  }) async {
    if (thread.isInternalGroup) return;
    await postJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/history-sync',
      data: {'count': count.clamp(1, 100)},
    );
  }

  Future<Map<String, dynamic>> startFullHistoryResync(int instanceId) =>
      postJson(
        '/api/bot-instances/$instanceId/whatsapp-conversations/history-resync',
      );

  Future<Map<String, dynamic>> loadFullHistoryResyncStatus(int instanceId) =>
      getJson(
        '/api/bot-instances/$instanceId/whatsapp-conversations/history-resync',
      );

  Future<ChatMessage?> sendTextMessage(
    ConversationThread thread,
    String text, {
    bool mentionAll = false,
    List<String> mentions = const [],
    List<OutgoingInteractiveButton> buttons = const [],
    String? replyToMessageId,
    String? clientMessageId,
  }) async {
    if (thread.isInternalGroup) {
      final sent = await sendInternalGroupText(
        _internalGroupId(thread),
        text,
        mentionAll: mentionAll,
        mentions: mentions,
        replyToMessageId: int.tryParse(replyToMessageId ?? ''),
        clientMessageId: clientMessageId,
      );
      return sent.toChatMessage(thread);
    }
    final buttonPayload = buttons.map((button) => button.toJson()).toList();
    final json = await postJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/messages',
      data: {
        'text': text,
        if (mentionAll) 'mentionAll': true,
        if (mentions.isNotEmpty) 'mentions': mentions,
        if (buttonPayload.isNotEmpty) 'buttons': buttonPayload,
        if (replyToMessageId != null && replyToMessageId.trim().isNotEmpty)
          'replyToMessageId': replyToMessageId.trim(),
        if (clientMessageId != null && clientMessageId.trim().isNotEmpty)
          'clientMessageId': clientMessageId.trim(),
      },
    );
    return _parseSentMessage(json, thread);
  }

  Future<ChatMessage?> sendMediaMessage(
    ConversationThread thread, {
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    String caption = '',
    bool mentionAll = false,
    List<String> mentions = const [],
    bool asSticker = false,
    String? mediaSource,
    String? mediaUrl,
    String? mediaThumbnail,
    bool isAnimated = false,
    bool viewOnce = false,
    List<OutgoingInteractiveButton> buttons = const [],
    String? replyToMessageId,
    String? clientMessageId,
  }) async {
    if (thread.isInternalGroup) {
      final sent = await sendInternalGroupMedia(
        _internalGroupId(thread),
        bytes: bytes,
        fileName: fileName,
        mimeType: mimeType,
        text: caption,
        asSticker: asSticker,
        viewOnce: viewOnce,
        mentionAll: mentionAll,
        mentions: mentions,
        replyToMessageId: int.tryParse(replyToMessageId ?? ''),
        clientMessageId: clientMessageId,
      );
      return sent.toChatMessage(thread);
    }
    final buttonPayload = buttons.map((button) => button.toJson()).toList();
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName,
        contentType: DioMediaType.parse(
          mimeType.isEmpty ? 'application/octet-stream' : mimeType,
        ),
      ),
      if (caption.trim().isNotEmpty) 'text': caption.trim(),
      if (mentionAll) 'mentionAll': 'true',
      if (mentions.isNotEmpty) 'mentions': mentions,
      if (asSticker) 'asSticker': 'true',
      if (asSticker) 'mediaKind': 'sticker',
      if (mediaSource?.trim().isNotEmpty == true)
        'mediaSource': mediaSource!.trim(),
      if (mediaUrl?.trim().isNotEmpty == true) 'mediaUrl': mediaUrl!.trim(),
      if (mediaThumbnail?.trim().isNotEmpty == true)
        'mediaThumbnail': mediaThumbnail!.trim(),
      if (isAnimated) 'isAnimated': 'true',
      if (viewOnce) 'viewOnce': 'true',
      if (buttonPayload.isNotEmpty) 'buttons': jsonEncode(buttonPayload),
      if (replyToMessageId != null && replyToMessageId.trim().isNotEmpty)
        'replyToMessageId': replyToMessageId.trim(),
      if (clientMessageId != null && clientMessageId.trim().isNotEmpty)
        'clientMessageId': clientMessageId.trim(),
    });
    final response = await _dio.post<Object?>(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/messages',
      data: formData,
    );
    final json = _decode(response);
    return _parseSentMessage(json, thread);
  }

  Future<List<GiphyMediaItem>> searchGiphy({
    String query = '',
    String type = 'gifs',
    int limit = 24,
    int offset = 0,
  }) async {
    final params = <String, String>{
      'type': type,
      'limit': '$limit',
      'offset': '$offset',
      if (query.trim().isNotEmpty) 'q': query.trim(),
    };
    final path = '/api/giphy?${Uri(queryParameters: params).query}';
    final json = await getJson(path);
    return _list(json['items'])
        .map(GiphyMediaItem.fromJson)
        .where((item) => item.previewUrl.trim().isNotEmpty)
        .toList(growable: false);
  }

  Future<MediaBytes> downloadGiphyMedia(GiphyMediaItem item) async {
    final mediaUrl = item.mediaUrl;
    if (mediaUrl.trim().isEmpty) {
      throw BotAdminApiException('Mídia GIPHY sem URL.');
    }
    final path =
        '/api/giphy/media?${Uri(queryParameters: {'url': mediaUrl}).query}';
    final response = await _dio.get<List<int>>(
      path,
      options: Options(
        responseType: ResponseType.bytes,
        headers: const {'Accept': '*/*'},
        followRedirects: true,
        validateStatus: (_) => true,
      ),
    );
    final status = response.statusCode ?? 500;
    if (status < 200 || status >= 300) {
      String message = 'Falha ao baixar mídia do GIPHY.';
      final body = response.data;
      if (body is List<int> && body.isNotEmpty) {
        try {
          final decoded = jsonDecode(utf8.decode(body));
          if (decoded is Map && decoded['message'] != null) {
            message = decoded['message'].toString();
          }
        } catch (_) {}
      }
      throw BotAdminApiException(message, statusCode: status);
    }
    final bytes = Uint8List.fromList(response.data ?? const <int>[]);
    if (bytes.isEmpty) {
      throw BotAdminApiException('Mídia GIPHY vazia.', statusCode: status);
    }
    final headerContentType =
        response.headers.value('content-type')?.split(';').first.trim() ?? '';
    final contentType =
        _guessMimeFromBytes(bytes) ??
        (headerContentType.isNotEmpty &&
                headerContentType.toLowerCase() != 'application/octet-stream'
            ? headerContentType
            : null) ??
        item.preferredMimeType;
    return MediaBytes(bytes: bytes, mimeType: contentType);
  }

  Future<ChatMessage?> sendGiphyMedia(
    ConversationThread thread,
    GiphyMediaItem item,
  ) async {
    final media = await downloadGiphyMedia(item);
    return sendMediaMessage(
      thread,
      bytes: media.bytes,
      fileName: item.fileNameForMimeType(media.mimeType),
      mimeType: media.mimeType,
      asSticker: item.isSticker,
      mediaSource: 'giphy',
      mediaUrl: item.mediaUrl,
      mediaThumbnail: item.previewUrl,
      isAnimated: true,
    );
  }

  ChatMessage? _parseSentMessage(
    Map<String, dynamic> json,
    ConversationThread thread,
  ) {
    final messageJson = json['message'];
    if (messageJson is Map<String, dynamic>) {
      return ChatMessage.fromJson(messageJson, thread: thread);
    }
    if (messageJson is Map) {
      return ChatMessage.fromJson(
        messageJson.cast<String, dynamic>(),
        thread: thread,
      );
    }
    return null;
  }

  Future<Map<String, dynamic>> runConversationAction(
    ConversationThread thread,
    String action,
  ) async {
    if (thread.isInternalGroup) {
      final groupId = _internalGroupId(thread);
      if (action == 'read') {
        final page = await loadInternalGroupMessages(groupId, limit: 1);
        final messages = (page['messages'] as List)
            .cast<InternalGroupMessage>();
        if (messages.isNotEmpty) {
          await markInternalGroupRead(groupId, messages.last.id);
        }
        return {'ok': true};
      }
      return patchJson(
        '/api/internal-groups/$groupId',
        data: {'action': action},
      );
    }
    return postJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}',
      data: {'action': action},
    );
  }

  Future<bool> setConversationNotificationsMuted(
    ConversationThread thread, {
    required bool muted,
  }) async {
    final json = await putJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/notifications',
      data: {'muted': muted},
    );
    final value = json['muted'];
    if (value is bool) return value;
    if (value is num) return value != 0;
    final normalized = value?.toString().trim().toLowerCase();
    return normalized == 'true' ||
        normalized == '1' ||
        normalized == 'yes' ||
        normalized == 'on' ||
        normalized == 'muted' ||
        normalized == 'silenciado';
  }

  Future<Map<String, dynamic>> runMessageAction(
    ConversationThread thread,
    ChatMessage message, {
    required String action,
    Map<String, Object?> data = const {},
  }) async {
    final messageKey = message.remoteId.trim().isNotEmpty
        ? message.remoteId.trim()
        : message.id.trim();
    if (thread.isInternalGroup) {
      final groupId = _internalGroupId(thread);
      if (action == 'delete' || action == 'delete_for_everyone') {
        await deleteInternalGroupMessage(
          groupId,
          int.tryParse(messageKey) ?? 0,
        );
        return {'ok': true, 'message': 'Mensagem apagada.'};
      }
      return postJson(
        '/api/internal-groups/$groupId/messages/${Uri.encodeComponent(messageKey)}/actions',
        data: {'action': action, ...data},
      );
    }
    return postJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/messages/${Uri.encodeComponent(messageKey)}/actions',
      data: {'action': action, ...data},
    );
  }

  Future<ChatMessage?> setDeletedMessageReveal(
    ConversationThread thread,
    ChatMessage message, {
    required bool reveal,
  }) async {
    if (thread.isInternalGroup) return null;
    final messageKey = message.remoteId.trim().isNotEmpty
        ? message.remoteId.trim()
        : message.id.trim();
    final json = await postJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/messages/${Uri.encodeComponent(messageKey)}/actions',
      data: {'action': reveal ? 'reveal_deleted' : 'hide_deleted'},
    );
    final messageJson = json['message'];
    if (messageJson is Map<String, dynamic>) {
      return ChatMessage.fromJson(messageJson, thread: thread);
    }
    if (messageJson is Map) {
      return ChatMessage.fromJson(
        messageJson.cast<String, dynamic>(),
        thread: thread,
      );
    }
    return null;
  }

  Future<BotGroupSettingsBundle> loadGroupSettings(int groupId) async {
    final json = await getJson('/api/bot-groups/$groupId/settings');
    return BotGroupSettingsBundle.fromJson(json);
  }

  Future<BotGroup?> syncGroupInfo(
    int groupId, {
    bool force = false,
    String reason = 'manual',
  }) async {
    final query = <String>[
      if (force) 'force=1',
      if (reason.trim().isNotEmpty)
        'reason=${Uri.encodeQueryComponent(reason)}',
    ].join('&');
    final json = await postJson('/api/bot-groups/$groupId/sync?$query');
    final groupJson = json['group'];
    if (groupJson is Map<String, dynamic>) return BotGroup.fromJson(groupJson);
    if (groupJson is Map) {
      return BotGroup.fromJson(groupJson.cast<String, dynamic>());
    }
    return null;
  }

  Future<BotGroupSettingsBundle> updateGroupSettings(
    int groupId,
    Map<String, Object?> payload,
  ) async {
    final json = await patchJson(
      '/api/bot-groups/$groupId/settings',
      data: payload,
    );
    return BotGroupSettingsBundle.fromJson({
      'settings': json['settings'],
      'meta': json['meta'],
    });
  }

  /// Upload de mídia de boas-vindas (`POST /welcome-media`).
  Future<BotGroupSettings> uploadWelcomeMedia(
    int groupId, {
    required Uint8List bytes,
    required String fileName,
    String? mimeType,
  }) {
    return _uploadGroupMessageMedia(
      '/api/bot-groups/$groupId/welcome-media',
      bytes: bytes,
      fileName: fileName,
      mimeType: mimeType,
    );
  }

  /// Upload de mídia de saída (`POST /farewell-media`).
  Future<BotGroupSettings> uploadFarewellMedia(
    int groupId, {
    required Uint8List bytes,
    required String fileName,
    String? mimeType,
  }) {
    return _uploadGroupMessageMedia(
      '/api/bot-groups/$groupId/farewell-media',
      bytes: bytes,
      fileName: fileName,
      mimeType: mimeType,
    );
  }

  Future<BotGroupSettings> uploadMenuCardMedia(
    int groupId,
    String cardId, {
    required Uint8List bytes,
    required String fileName,
    String? mimeType,
  }) {
    return _uploadGroupMessageMedia(
      '/api/bot-groups/$groupId/menu-media/${Uri.encodeComponent(cardId)}',
      bytes: bytes,
      fileName: fileName,
      mimeType: mimeType,
    );
  }

  Future<BotGroupSettings> deleteMenuCardMedia(
    int groupId,
    String cardId,
  ) async {
    final json = await deleteJson(
      '/api/bot-groups/$groupId/menu-media/${Uri.encodeComponent(cardId)}',
    );
    final settingsJson = json['settings'];
    if (settingsJson is Map<String, dynamic>) {
      return BotGroupSettings.fromJson(settingsJson);
    }
    if (settingsJson is Map) {
      return BotGroupSettings.fromJson(settingsJson.cast<String, dynamic>());
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'Não foi possível remover a imagem.',
    );
  }

  Future<GroupScheduledAdConfig> createGroupAd(
    int groupId,
    Map<String, Object?> payload,
  ) async {
    final json = await postJson('/api/bot-groups/$groupId/ads', data: payload);
    final ad = json['ad'];
    if (ad is Map<String, dynamic>) {
      return GroupScheduledAdConfig.fromJson(ad);
    }
    if (ad is Map) {
      return GroupScheduledAdConfig.fromJson(ad.cast<String, dynamic>());
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'O anúncio não foi retornado pela API.',
    );
  }

  Future<GroupScheduledAdConfig> updateGroupAd(
    int groupId,
    String adId,
    Map<String, Object?> payload,
  ) async {
    final json = await patchJson(
      '/api/bot-groups/$groupId/ads/${Uri.encodeComponent(adId)}',
      data: payload,
    );
    final ad = json['ad'];
    if (ad is Map<String, dynamic>) {
      return GroupScheduledAdConfig.fromJson(ad);
    }
    if (ad is Map) {
      return GroupScheduledAdConfig.fromJson(ad.cast<String, dynamic>());
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'O anúncio não foi retornado pela API.',
    );
  }

  Future<void> deleteGroupAd(int groupId, String adId) async {
    await deleteJson(
      '/api/bot-groups/$groupId/ads/${Uri.encodeComponent(adId)}',
    );
  }

  Future<GroupScheduledAdMedia> uploadGroupAdMedia(
    int groupId, {
    required Uint8List bytes,
    required String fileName,
    required String mediaType,
    String? mimeType,
    String? previousPath,
  }) async {
    final safeName = fileName.trim().isEmpty ? 'media.bin' : fileName.trim();
    final contentType = (mimeType ?? '').trim().isEmpty
        ? 'application/octet-stream'
        : mimeType!.trim();
    final response = await _dio.post<Object?>(
      '/api/bot-groups/$groupId/ads/upload',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(
          bytes,
          filename: safeName,
          contentType: DioMediaType.parse(contentType),
        ),
        'mediaType': mediaType,
        if ((previousPath ?? '').trim().isNotEmpty)
          'previousPath': previousPath!.trim(),
      }),
    );
    final json = _decode(response);
    if (response.statusCode != null &&
        (response.statusCode! < 200 || response.statusCode! >= 300)) {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível enviar a mídia.',
        statusCode: response.statusCode,
      );
    }
    final media = json['media'];
    if (media is Map<String, dynamic>) {
      return GroupScheduledAdMedia.fromJson(media);
    }
    if (media is Map) {
      return GroupScheduledAdMedia.fromJson(media.cast<String, dynamic>());
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'Upload concluído sem mídia.',
    );
  }

  Future<BotGroupSettings> _uploadGroupMessageMedia(
    String path, {
    required Uint8List bytes,
    required String fileName,
    String? mimeType,
  }) async {
    final safeName = fileName.trim().isEmpty ? 'media.bin' : fileName.trim();
    final contentType = (mimeType ?? '').trim().isEmpty
        ? 'application/octet-stream'
        : mimeType!.trim();
    final formData = FormData.fromMap({
      'media': MultipartFile.fromBytes(
        bytes,
        filename: safeName,
        contentType: DioMediaType.parse(contentType),
      ),
    });
    final response = await _dio.post<Object?>(path, data: formData);
    final json = _decode(response);
    if (response.statusCode != null &&
        (response.statusCode! < 200 || response.statusCode! >= 300)) {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível enviar a mídia.',
        statusCode: response.statusCode,
      );
    }
    final settingsJson = json['settings'];
    if (settingsJson is Map<String, dynamic>) {
      return BotGroupSettings.fromJson(settingsJson);
    }
    if (settingsJson is Map) {
      return BotGroupSettings.fromJson(settingsJson.cast<String, dynamic>());
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'Upload concluído sem dados de retorno.',
    );
  }

  Future<BotGroup?> updateGroupStatus(
    int groupId, {
    required bool active,
  }) async {
    final json = await patchJson(
      '/api/bot-groups/$groupId',
      data: {'active': active},
    );
    final groupJson = json['group'];
    if (groupJson is Map<String, dynamic>) return BotGroup.fromJson(groupJson);
    if (groupJson is Map) {
      return BotGroup.fromJson(groupJson.cast<String, dynamic>());
    }
    return null;
  }

  Future<BotGroup> createGroupFromConversation(
    ConversationThread thread,
  ) async {
    final json = await postJson(
      '/api/bot-groups',
      data: {'instanceId': thread.instanceId, 'remoteId': thread.chatJid},
    );
    final groupJson = json['group'];
    if (groupJson is Map<String, dynamic>) return BotGroup.fromJson(groupJson);
    if (groupJson is Map) {
      return BotGroup.fromJson(groupJson.cast<String, dynamic>());
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'Não foi possível vincular este grupo.',
    );
  }

  Future<BotGroup?> updateGroupDetails(
    int groupId, {
    String? name,
    String? description,
  }) async {
    final payload = <String, Object?>{};
    if (name != null) payload['name'] = name;
    if (description != null) payload['description'] = description;
    if (payload.isEmpty) return null;
    final json = await patchJson('/api/bot-groups/$groupId', data: payload);
    final groupJson = json['group'];
    if (groupJson is Map<String, dynamic>) return BotGroup.fromJson(groupJson);
    if (groupJson is Map) {
      return BotGroup.fromJson(groupJson.cast<String, dynamic>());
    }
    return null;
  }

  Future<BotGroup?> updateGroupPermissions(
    int groupId, {
    bool? adminsOnly,
    bool? locked,
    String? ephemeral,
  }) async {
    final payload = <String, Object?>{};
    if (adminsOnly != null) payload['adminsOnly'] = adminsOnly;
    if (locked != null) payload['locked'] = locked;
    if (ephemeral != null) payload['ephemeral'] = ephemeral;
    if (payload.isEmpty) return null;
    final json = await patchJson('/api/bot-groups/$groupId', data: payload);
    final groupJson = json['group'];
    if (groupJson is Map<String, dynamic>) return BotGroup.fromJson(groupJson);
    if (groupJson is Map) {
      return BotGroup.fromJson(groupJson.cast<String, dynamic>());
    }
    return null;
  }

  Future<BotGroup?> uploadGroupPhoto(
    int groupId, {
    required Uint8List bytes,
    required String fileName,
    String? mimeType,
  }) async {
    final safeName = fileName.trim().isEmpty ? 'grupo.jpg' : fileName.trim();
    final contentType = (mimeType ?? '').trim().isEmpty
        ? 'image/jpeg'
        : mimeType!.trim();
    final formData = FormData.fromMap({
      'photo': MultipartFile.fromBytes(
        bytes,
        filename: safeName,
        contentType: DioMediaType.parse(contentType),
      ),
    });
    final response = await _dio.post<Object?>(
      '/api/bot-groups/$groupId/photo',
      data: formData,
    );
    final json = _decode(response);
    if (response.statusCode != null &&
        (response.statusCode! < 200 || response.statusCode! >= 300)) {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível atualizar a foto.',
        statusCode: response.statusCode,
      );
    }
    final groupJson = json['group'];
    if (groupJson is Map<String, dynamic>) return BotGroup.fromJson(groupJson);
    if (groupJson is Map) {
      return BotGroup.fromJson(groupJson.cast<String, dynamic>());
    }
    return null;
  }

  Future<BotGroup?> removeGroupPhoto(int groupId) async {
    final json = await deleteJson('/api/bot-groups/$groupId/photo');
    final groupJson = json['group'];
    if (groupJson is Map<String, dynamic>) return BotGroup.fromJson(groupJson);
    if (groupJson is Map) {
      return BotGroup.fromJson(groupJson.cast<String, dynamic>());
    }
    return null;
  }

  Future<List<Map<String, dynamic>>> loadGroupParticipants(
    int groupId, {
    bool refresh = false,
  }) async {
    final cached = _groupParticipantsCache[groupId];
    if (!refresh && cached != null && cached.isNotEmpty) {
      return List<Map<String, dynamic>>.unmodifiable(cached);
    }
    final json = await getJson('/api/bot-groups/$groupId/participants');
    final participants = _list(json['participants'])
        .whereType<Map>()
        .map((entry) => entry.cast<String, dynamic>())
        .toList(growable: false);
    if (participants.isNotEmpty) {
      _groupParticipantsCache[groupId] = participants;
    }
    return participants;
  }

  Future<Map<String, dynamic>> runGroupParticipantAction(
    BotGroup? group, {
    required ConversationThread thread,
    required String participantJid,
    required String action,
    bool addToBlacklist = false,
    bool deleteRecentMessages = false,
    bool removeAfterBlacklist = false,
  }) async {
    // Mensagens de grupos BotAdmin usam JIDs sintéticos
    // (`botadmin-user:<id>`). Esses membros não existem na instância do
    // WhatsApp, portanto a moderação precisa passar pela API do grupo
    // interno; antes caía no endpoint da instância e aparentava não fazer
    // nada (ou retornava “participante não encontrado”).
    if (thread.isInternalGroup) {
      final groupId = _internalGroupId(thread);
      final syntheticId = RegExp(
        r'^botadmin-user:(\d+)$',
        caseSensitive: false,
      ).firstMatch(participantJid.trim())?.group(1);
      final memberId = int.tryParse(syntheticId ?? participantJid.trim());
      if (memberId == null || memberId <= 0) {
        throw BotAdminApiException('Membro interno inválido.');
      }
      if (!const {
        'promote',
        'demote',
        'remove',
        'ban',
        'leave',
      }.contains(action)) {
        throw BotAdminApiException(
          'Esta ação não está disponível neste grupo.',
        );
      }
      return patchJson(
        '/api/internal-groups/$groupId/members/$memberId',
        data: {'action': action},
      );
    }
    if (group == null) {
      return postJson(
        '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/participants/actions',
        data: {
          'action': action,
          'participantJid': participantJid,
          if (deleteRecentMessages) 'deleteRecentMessages': true,
        },
      );
    }
    return postJson(
      '/api/bot-groups/${group.id}/participants/actions',
      data: {
        'action': action,
        'participantJid': participantJid,
        if (addToBlacklist) 'addToBlacklist': true,
        if (deleteRecentMessages) 'deleteRecentMessages': true,
        if (removeAfterBlacklist) 'removeAfterBlacklist': true,
      },
    );
  }

  Future<BotStatusSnapshot> loadBotStatus({int? instanceId}) async {
    final suffix = instanceId == null ? '' : '?instanceId=$instanceId';
    return BotStatusSnapshot.fromJson(await getJson('/api/bot-status$suffix'));
  }

  Future<List<BotFlowSummary>> loadBotFlows() async {
    final json = await getJson('/api/bot-flows');
    return _list(json['flows']).map(BotFlowSummary.fromJson).toList();
  }

  Future<List<BotFlowSummary>> createBotFlow({
    required String name,
    required String command,
    String scope = 'both',
    String text = 'Olá! Como posso ajudar?',
  }) async {
    final json = await postJson(
      '/api/bot-flows',
      data: {
        'name': name,
        'command': command,
        'scope': scope,
        'triggerType': 'command',
        'matchMode': 'exact',
        'enabled': true,
        'nodes': [
          {
            'id': 'trigger',
            'kind': 'trigger',
            'title': 'Gatilho',
            'x': 80,
            'y': 120,
            'triggerType': 'command',
            'triggerValue': command,
          },
          {
            'id': 'message-1',
            'kind': 'text',
            'title': 'Mensagem #1',
            'x': 380,
            'y': 120,
            'text': text,
          },
        ],
        'edges': [
          {
            'id': 'edge-trigger-message-1',
            'from': 'trigger',
            'to': 'message-1',
          },
        ],
      },
    );
    return _list(json['flows']).map(BotFlowSummary.fromJson).toList();
  }

  Future<List<BotFlowSummary>> updateBotFlow(BotFlowSummary flow) async {
    final json = await patchJson(
      '/api/bot-flows/${flow.id}',
      data: flow.toUpdatePayload(),
    );
    return _list(json['flows']).map(BotFlowSummary.fromJson).toList();
  }

  Future<List<BotFlowSummary>> deleteBotFlow(int flowId) async {
    final response = await _dio.delete<Object?>('/api/bot-flows/$flowId');
    final json = _decode(response);
    return _list(json['flows']).map(BotFlowSummary.fromJson).toList();
  }

  Future<Map<String, dynamic>> uploadBotFlowMedia({
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) async {
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName.trim().isEmpty ? 'header.jpg' : fileName.trim(),
        contentType: DioMediaType.parse(
          mimeType.trim().isEmpty ? 'application/octet-stream' : mimeType,
        ),
      ),
    });
    final response = await _dio.post<Object?>(
      '/api/bot-flows/upload',
      data: formData,
    );
    final json = _decode(response);
    if (response.statusCode != null &&
        (response.statusCode! < 200 || response.statusCode! >= 300)) {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível enviar a imagem.',
        statusCode: response.statusCode,
      );
    }
    final media = json['media'];
    if (media is Map<String, dynamic>) return media;
    if (media is Map) return Map<String, dynamic>.from(media);
    throw BotAdminApiException(
      'Upload aceito, mas a mídia não veio na resposta.',
    );
  }

  Future<List<UserRaffleSummary>> loadRaffles() async {
    final json = await getJson('/api/user/raffles');
    return _list(json['raffles']).map(UserRaffleSummary.fromJson).toList();
  }

  Future<RafflePaymentSettings> loadRafflePaymentSettings() async {
    final json = await getJson('/api/user/raffles/payment-settings');
    return RafflePaymentSettings.fromJson(_map(json['settings']));
  }

  Future<RafflePaymentSettings> saveRafflePaymentSettings({
    required String provider,
    required String credential,
    required int pixExpirationMinutes,
  }) async {
    final json = await putJson(
      '/api/user/raffles/payment-settings',
      data: {
        'provider': provider,
        'credential': credential,
        'pixExpirationMinutes': pixExpirationMinutes,
      },
    );
    return RafflePaymentSettings.fromJson(_map(json['settings']));
  }

  Future<UserRaffleSummary> createRaffle(Map<String, Object?> payload) async {
    final json = await postJson('/api/user/raffles', data: payload);
    return UserRaffleSummary.fromJson(_map(json['raffle']));
  }

  Future<UserRaffleSummary> updateRaffle(
    int raffleId,
    Map<String, Object?> payload,
  ) async {
    final json = await putJson('/api/user/raffles/$raffleId', data: payload);
    return UserRaffleSummary.fromJson(_map(json['raffle']));
  }

  Future<UserRaffleSummary> updateRaffleStatus(
    int raffleId,
    String status,
  ) async {
    final json = await patchJson(
      '/api/user/raffles/$raffleId',
      data: {'status': status},
    );
    return UserRaffleSummary.fromJson(_map(json['raffle']));
  }

  Future<UserRaffleSummary> releaseRaffleReservations(int raffleId) async {
    final json = await postJson('/api/user/raffles/$raffleId/release');
    return UserRaffleSummary.fromJson(_map(json['raffle']));
  }

  Future<UserRaffleSummary> drawRaffle(
    int raffleId, {
    bool announce = false,
  }) async {
    final json = await postJson(
      '/api/user/raffles/$raffleId/draw',
      data: {'announce': announce},
    );
    return UserRaffleSummary.fromJson(_map(json['raffle']));
  }

  Future<void> deleteRaffle(int raffleId) async {
    await deleteJson('/api/user/raffles/$raffleId');
  }

  String _sweepstakeBasePath(int groupId, {required bool internal}) => internal
      ? '/api/internal-groups/$groupId/sweepstakes'
      : '/api/bot-groups/$groupId/sweepstakes';

  Future<SweepstakeGroupSnapshot> loadGroupSweepstakes(
    int groupId, {
    bool internal = false,
  }) async {
    final json = await getJson(
      _sweepstakeBasePath(groupId, internal: internal),
    );
    return SweepstakeGroupSnapshot.fromJson(json);
  }

  Future<SweepstakeGroupSnapshot> createGroupSweepstake({
    required int groupId,
    required String question,
    required int durationValue,
    required String durationUnit,
    required int maxParticipants,
    required int winnersCount,
    bool internal = false,
  }) async {
    final json = await postJson(
      _sweepstakeBasePath(groupId, internal: internal),
      data: {
        'question': question,
        'durationValue': durationValue,
        'durationUnit': durationUnit,
        'maxParticipants': maxParticipants,
        'winnersCount': winnersCount,
      },
    );
    return SweepstakeGroupSnapshot.fromJson(json);
  }

  Future<SweepstakeGroupSnapshot> finalizeGroupSweepstake(
    int groupId,
    int sweepstakeId, {
    bool internal = false,
  }) async {
    final json = await postJson(
      '${_sweepstakeBasePath(groupId, internal: internal)}/$sweepstakeId/finalize',
      data: {'announce': true},
    );
    return SweepstakeGroupSnapshot.fromJson(json);
  }

  Future<SweepstakeGroupSnapshot> cancelGroupSweepstake(
    int groupId,
    int sweepstakeId, {
    bool internal = false,
  }) async {
    final json = await postJson(
      '${_sweepstakeBasePath(groupId, internal: internal)}/$sweepstakeId/cancel',
      data: {'announce': true},
    );
    return SweepstakeGroupSnapshot.fromJson(json);
  }

  Future<SweepstakeGroupSnapshot> addGroupSweepstakeParticipant({
    required int groupId,
    required int sweepstakeId,
    required int participantUserId,
  }) async {
    final json = await postJson(
      '${_sweepstakeBasePath(groupId, internal: true)}/$sweepstakeId/participants',
      data: {'userId': participantUserId},
    );
    return SweepstakeGroupSnapshot.fromJson(json);
  }

  Future<Map<String, dynamic>> uploadRaffleMedia({
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    required String mediaType,
    String? previousPath,
  }) async {
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName.trim().isEmpty ? 'rifa.jpg' : fileName,
        contentType: DioMediaType.parse(
          mimeType.trim().isEmpty ? 'application/octet-stream' : mimeType,
        ),
      ),
      'mediaType': mediaType,
      if (previousPath != null && previousPath.trim().isNotEmpty)
        'previousPath': previousPath.trim(),
    });
    final json = await postFormData('/api/user/raffles/upload', formData);
    return _map(json['media']);
  }

  Future<BotStoreSnapshot> loadBotStore(int instanceId) async {
    final json = await getJson('/api/user/store?instanceId=$instanceId');
    return BotStoreSnapshot.fromJson(json);
  }

  Future<BotStoreSnapshot> saveBotStore(
    int instanceId,
    Map<String, Object?> payload,
  ) async {
    final json = await putJson(
      '/api/user/store',
      data: {'instanceId': instanceId, ...payload},
    );
    return BotStoreSnapshot.fromJson(json);
  }

  Future<BotStoreSnapshot> runBotStoreAction(
    int instanceId,
    String action, {
    Map<String, Object?> payload = const {},
  }) async {
    final json = await postJson(
      '/api/user/store',
      data: {'instanceId': instanceId, 'action': action, ...payload},
    );
    return BotStoreSnapshot.fromJson(json);
  }

  Future<List<BotStoreSmmService>> searchBotStoreSmmCatalog(
    int instanceId, {
    String query = '',
    int limit = 100,
  }) async {
    final json = await postJson(
      '/api/user/store',
      data: {
        'instanceId': instanceId,
        'action': 'search_smm_catalog',
        'catalog': {'query': query, 'limit': limit},
      },
    );
    return _list(
      json['services'],
    ).map(BotStoreSmmService.fromJson).toList(growable: false);
  }

  Future<String> revealBotStoreWwPanelPassword(
    int instanceId,
    int clientId,
  ) async {
    final json = await postJson(
      '/api/user/store',
      data: {
        'instanceId': instanceId,
        'action': 'reveal_wwpanel_password',
        'clientId': clientId,
      },
    );
    final password = json['password']?.toString() ?? '';
    if (password.isEmpty) {
      throw StateError('Senha IPTV não encontrada.');
    }
    return password;
  }

  Future<Map<String, dynamic>> uploadBotStoreFile({
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    required String kind,
    String? previousPath,
  }) async {
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName.trim().isEmpty ? 'arquivo' : fileName.trim(),
        contentType: DioMediaType.parse(
          mimeType.trim().isEmpty ? 'application/octet-stream' : mimeType,
        ),
      ),
      'kind': kind,
      if (previousPath != null && previousPath.trim().isNotEmpty)
        'previousPath': previousPath.trim(),
    });
    final json = await postFormData('/api/user/store/upload', formData);
    return _map(json['file']);
  }

  Future<BotAdCampaignsSnapshot> loadBotAdCampaigns() async {
    final json = await getJson('/api/bot-ad-campaigns');
    final campaigns = _list(
      json['campaigns'],
    ).map(BotAdCampaignSummary.fromJson).toList();
    campaigns.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return BotAdCampaignsSnapshot(campaigns: campaigns);
  }

  Future<BotAdCampaignSummary> createBotAdCampaign({
    required String name,
    required String message,
    String? description,
    String scheduleKind = 'manual',
  }) async {
    final json = await postJson(
      '/api/bot-ad-campaigns',
      data: {
        'name': name,
        'description': description,
        'status': scheduleKind == 'manual' ? 'draft' : 'scheduled',
        'schedule': {'kind': scheduleKind},
        'contents': [
          {
            'id': DateTime.now().microsecondsSinceEpoch.toString(),
            'type': 'text',
            'text': message,
          },
        ],
      },
    );
    return BotAdCampaignSummary.fromJson(_map(json['campaign']));
  }

  Future<BotAdCampaignSummary> saveAutoPromoter({
    String? campaignId,
    required String name,
    String? description,
    required Map<String, Object?> content,
    required List<Map<String, Object?>> targets,
    required int intervalMinutes,
    required String targetMode,
    required int targetDelayMinMinutes,
    required int targetDelayMaxMinutes,
    required bool prioritizeNeverSent,
    required bool enabled,
  }) async {
    final payload = <String, Object?>{
      'name': name,
      'description': description,
      'status': enabled ? 'scheduled' : 'paused',
      'timezone': 'America/Sao_Paulo',
      'schedule': {
        'kind': 'recurring',
        'everyMinutes': intervalMinutes.clamp(15, 10080),
        'timezone': 'America/Sao_Paulo',
      },
      'contents': [content],
      'targets': targets,
      'options': {
        'groupDispatch': {
          'targetMode': targetMode == 'all_open' ? 'all_open' : 'selected',
          'targetDelayMinMinutes': targetDelayMinMinutes.clamp(1, 1440),
          'targetDelayMaxMinutes': targetDelayMaxMinutes.clamp(
            targetDelayMinMinutes.clamp(1, 1440),
            1440,
          ),
          'prioritizeNeverSent': prioritizeNeverSent,
        },
      },
    };
    final json = campaignId == null || campaignId.trim().isEmpty
        ? await postJson('/api/bot-ad-campaigns', data: payload)
        : await patchJson(
            '/api/bot-ad-campaigns/${Uri.encodeComponent(campaignId)}',
            data: payload,
          );
    return BotAdCampaignSummary.fromJson(_map(json['campaign']));
  }

  Future<PublicGroupDiscoverySnapshot> discoverPublicGroups({
    String query = '',
    String category = '',
    int page = 1,
  }) async {
    final params = <String, String>{
      if (query.trim().isNotEmpty) 'q': query.trim(),
      if (category.trim().isNotEmpty) 'category': category.trim(),
      'page': page.clamp(1, 1000).toString(),
      'maxPages': '3',
    };
    final uri = Uri(
      path: '/api/bot-ad-campaigns/group-discovery',
      queryParameters: params,
    );
    return PublicGroupDiscoverySnapshot.fromJson(await getJson(uri.toString()));
  }

  Future<Map<String, dynamic>> joinPublicGroup({
    required int instanceId,
    required String inviteLink,
  }) async {
    final json = await postJson(
      '/api/bot-groups',
      data: {'instanceId': instanceId, 'invite': inviteLink.trim()},
    );
    return _map(json['group']);
  }

  Future<PublicGroupInviteInspection> inspectPublicGroupInvite({
    required int instanceId,
    required String inviteLink,
  }) async {
    final json = await postJson(
      '/api/divulgacao/inspect',
      data: {'instanceId': instanceId, 'invite': inviteLink.trim()},
    );
    return PublicGroupInviteInspection.fromJson(_map(json['inspection']));
  }

  Future<Map<String, dynamic>> uploadBotAdCampaignMedia({
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    required String mediaType,
    String? previousPath,
  }) async {
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName.trim().isEmpty ? 'divulgacao.jpg' : fileName,
        contentType: DioMediaType.parse(
          mimeType.trim().isEmpty ? 'application/octet-stream' : mimeType,
        ),
      ),
      'mediaType': mediaType,
      if (previousPath != null && previousPath.trim().isNotEmpty)
        'previousPath': previousPath.trim(),
    });
    final json = await postFormData('/api/bot-ad-campaigns/upload', formData);
    return _map(json['media']);
  }

  Future<Map<String, dynamic>> composeStatusVideo({
    required Uint8List videoBytes,
    required String videoFileName,
    required String videoMimeType,
    required Uint8List overlayBytes,
    required String backgroundColor,
    required double mediaScale,
    required double mediaX,
    required double mediaY,
    required double mediaRotation,
    String? previousPath,
  }) async {
    final formData = FormData.fromMap({
      'video': MultipartFile.fromBytes(
        videoBytes,
        filename: videoFileName.trim().isEmpty ? 'status.mp4' : videoFileName,
        contentType: DioMediaType.parse(
          videoMimeType.trim().isEmpty ? 'video/mp4' : videoMimeType,
        ),
      ),
      'overlay': MultipartFile.fromBytes(
        overlayBytes,
        filename: 'status-overlay.png',
        contentType: DioMediaType.parse('image/png'),
      ),
      'backgroundColor': backgroundColor,
      'mediaScale': mediaScale.toStringAsFixed(5),
      'mediaX': mediaX.toStringAsFixed(5),
      'mediaY': mediaY.toStringAsFixed(5),
      'mediaRotation': mediaRotation.toStringAsFixed(7),
      if (previousPath != null && previousPath.trim().isNotEmpty)
        'previousPath': previousPath.trim(),
    });
    final json = await postFormData('/api/bot-status/compose-video', formData);
    return _map(json['media']);
  }

  Future<void> deleteBotAdCampaignMedia(String mediaPath) async {
    if (mediaPath.trim().isEmpty) return;
    await deleteJson(
      '/api/bot-ad-campaigns/upload',
      data: {'path': mediaPath.trim()},
    );
  }

  Future<void> deletePostedStatus(String postId) async {
    final normalized = postId.trim();
    if (normalized.isEmpty) return;
    await deleteJson(
      '/api/bot-status/posts/${Uri.encodeComponent(normalized)}',
    );
  }

  Future<Map<String, dynamic>> resolveStatusMediaLink(
    String rawUrl, {
    String previousPath = '',
  }) async {
    final uri = Uri(
      path: '/api/bot-status/resolve-link',
      queryParameters: {
        'url': rawUrl.trim(),
        if (previousPath.trim().isNotEmpty) 'previousPath': previousPath.trim(),
      },
    );
    final json = await getJson(uri.toString());
    if (json['success'] != true || json['result'] is! Map) {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível resolver o link.',
      );
    }
    return _map(json['result']);
  }

  Future<Map<String, dynamic>> enrichStatusFromImdb(String query) async {
    final json = await postJson(
      '/api/bot-status/enrich',
      data: {'mode': 'imdb', 'query': query.trim()},
    );
    if (json['result'] is! Map) {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível buscar os detalhes.',
      );
    }
    return _map(json['result']);
  }

  Future<String> startStatusMediaAnalysis({
    required String mediaUrl,
    required String provider,
    String campaignId = '',
    String contentId = '',
    String mediaPath = '',
    String mimeType = '',
    String fileName = '',
    String query = '',
  }) async {
    final json = await postJson(
      '/api/bot-status/enrich',
      data: {
        'mode': 'ai',
        'provider': provider.trim().toLowerCase(),
        'mediaUrl': mediaUrl.trim(),
        if (campaignId.trim().isNotEmpty) 'campaignId': campaignId.trim(),
        if (contentId.trim().isNotEmpty) 'contentId': contentId.trim(),
        if (mediaPath.trim().isNotEmpty) 'mediaPath': mediaPath.trim(),
        if (mimeType.trim().isNotEmpty) 'mimeType': mimeType.trim(),
        if (fileName.trim().isNotEmpty) 'fileName': fileName.trim(),
        if (query.trim().isNotEmpty) 'query': query.trim(),
      },
    );
    final jobId = json['jobId']?.toString().trim() ?? '';
    if (jobId.isEmpty) {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Não foi possível iniciar a análise.',
      );
    }
    return jobId;
  }

  Future<Map<String, dynamic>> loadStatusChatGptAnalysis(String jobId) async {
    final uri = Uri(
      path: '/api/bot-status/enrich',
      queryParameters: {'jobId': jobId.trim()},
    );
    return getJson(uri.toString());
  }

  Future<void> queueStatusCampaignAnalyses({
    required String campaignId,
    required List<Map<String, dynamic>> items,
  }) async {
    if (items.isEmpty) return;
    await postJson(
      '/api/bot-status/enrich/batch',
      data: {'campaignId': campaignId.trim(), 'items': items},
    );
  }

  Future<Map<String, dynamic>> loadInstagramProfileReels({
    required String profile,
    String cursor = '',
    int limit = 24,
    int pages = 2,
  }) async {
    final uri = Uri(
      path: '/api/bot-status/instagram-profile-reels',
      queryParameters: {
        'profile': profile.trim(),
        'limit': limit.clamp(1, 1200).toString(),
        'pages': pages.clamp(1, 100).toString(),
        if (cursor.trim().isNotEmpty) 'cursor': cursor.trim(),
      },
    );
    return getJson(uri.toString());
  }

  Future<BotAdCampaignSummary> createStatusCampaign({
    required String name,
    required int instanceId,
    required Map<String, dynamic> schedule,
    required List<Map<String, dynamic>> contents,
    Map<String, dynamic>? options,
    String status = 'scheduled',
    DateTime? endAt,
  }) async {
    final json = await postJson(
      '/api/bot-ad-campaigns',
      data: {
        'name': name,
        'description': 'Status criado pelo painel Flutter',
        'status': status,
        'schedule': schedule,
        'endAt': endAt?.toUtc().toIso8601String(),
        'contents': contents,
        if (options != null && options.isNotEmpty) 'options': options,
        'targets': [
          {
            'id': DateTime.now().microsecondsSinceEpoch.toString(),
            'type': 'status',
            'instanceId': instanceId,
          },
        ],
      },
    );
    return BotAdCampaignSummary.fromJson(_map(json['campaign']));
  }

  Future<BotAdCampaignSummary> updateStatusCampaign({
    required String campaignId,
    required String name,
    required int instanceId,
    required Map<String, dynamic> schedule,
    required List<Map<String, dynamic>> contents,
    Map<String, dynamic>? options,
    String status = 'scheduled',
    DateTime? endAt,
  }) async {
    final json = await patchJson(
      '/api/bot-ad-campaigns/$campaignId',
      data: {
        'name': name,
        'description': 'Status criado pelo painel Flutter',
        'status': status,
        'schedule': schedule,
        'endAt': endAt?.toUtc().toIso8601String(),
        'contents': contents,
        'options': options ?? const <String, dynamic>{},
        'targets': [
          {
            'id': DateTime.now().microsecondsSinceEpoch.toString(),
            'type': 'status',
            'instanceId': instanceId,
          },
        ],
      },
    );
    return BotAdCampaignSummary.fromJson(_map(json['campaign']));
  }

  Future<BotAdCampaignSummary> updateStatusCampaignCommand({
    required String campaignId,
    required bool enabled,
    required String command,
    String captionProvider = 'gemini',
  }) async {
    final json = await patchJson(
      '/api/bot-status/command/${Uri.encodeComponent(campaignId)}',
      data: {
        'enabled': enabled,
        'command': command.trim(),
        'captionProvider': captionProvider,
      },
    );
    return BotAdCampaignSummary.fromJson(_map(json['campaign']));
  }

  Future<void> updateBotAdCampaignStatus(
    String campaignId,
    String status,
  ) async {
    await patchJson(
      '/api/bot-ad-campaigns/$campaignId',
      data: {'status': status},
    );
  }

  Future<void> runBotAdCampaignNow(String campaignId) async {
    await postJson('/api/bot-ad-campaigns/$campaignId/run-now');
  }

  Future<void> deleteBotAdCampaign(String campaignId) async {
    await deleteJson('/api/bot-ad-campaigns/$campaignId');
  }

  Future<List<AffiliateProviderSummary>> loadAffiliateProviders() async {
    final json = await getJson('/api/affiliates/providers');
    return _list(
      json['providers'],
    ).map(AffiliateProviderSummary.fromJson).toList();
  }

  Future<void> saveAffiliateProviderCredentials(
    String provider, {
    required String accountName,
    String? appId,
    String? clientSecret,
    String? appToken,
  }) async {
    final normalized = _normalizeAffiliateProvider(provider);
    await postJson(
      '/api/affiliates/providers/$normalized',
      data: {
        'action': 'save_credentials',
        'accountName': accountName,
        if (appId != null && appId.trim().isNotEmpty) 'appId': appId.trim(),
        if (clientSecret != null && clientSecret.trim().isNotEmpty)
          'clientSecret': clientSecret.trim(),
        if (appToken != null && appToken.trim().isNotEmpty)
          'appToken': appToken.trim(),
        'select': true,
      },
    );
  }

  Future<void> refreshAffiliateProvider(String provider) async {
    final normalized = _normalizeAffiliateProvider(provider);
    await postJson(
      '/api/affiliates/providers/$normalized',
      data: {'action': 'refresh'},
    );
  }

  Future<void> disconnectAffiliateProvider(String provider) async {
    final normalized = _normalizeAffiliateProvider(provider);
    await deleteJson('/api/affiliates/providers/$normalized');
  }

  Future<List<AffiliateProductLink>> loadAffiliateLinks(
    String provider, {
    int limit = 80,
  }) async {
    final normalized = _normalizeAffiliateProvider(provider);
    final json = await getJson(
      '/api/affiliates/$normalized/links?limit=$limit',
    );
    return _list(
      json['links'],
    ).map((entry) => AffiliateProductLink.fromJson(normalized, entry)).toList();
  }

  Future<AffiliateLinksSnapshot> loadAffiliateLinksSnapshot({
    int limit = 80,
  }) async {
    final result = await Future.wait([
      loadAffiliateLinks('shopee', limit: limit),
      loadAffiliateLinks('mercadolivre', limit: limit),
    ]);
    return AffiliateLinksSnapshot(
      shopeeLinks: result[0],
      mercadoLivreLinks: result[1],
    );
  }

  Future<AffiliateProductLink> createAffiliateLink({
    required String provider,
    required String affiliateUrl,
    String? note,
  }) async {
    final normalized = _normalizeAffiliateProvider(provider);
    final data = <String, Object?>{'affiliateUrl': affiliateUrl};
    if (note != null) data['note'] = note;
    final json = await postJson(
      '/api/affiliates/$normalized/links',
      data: data,
    );
    return AffiliateProductLink.fromJson(normalized, _map(json['link']));
  }

  Future<AffiliateProductLink> updateAffiliateLink(
    AffiliateProductLink link,
    Map<String, Object?> payload,
  ) async {
    final normalized = _normalizeAffiliateProvider(link.provider);
    final itemId = Uri.encodeComponent(link.itemId);
    final json = await patchJson(
      '/api/affiliates/$normalized/links/$itemId',
      data: payload,
    );
    return AffiliateProductLink.fromJson(normalized, _map(json['link']));
  }

  Future<void> deleteAffiliateLink(AffiliateProductLink link) async {
    final normalized = _normalizeAffiliateProvider(link.provider);
    final itemId = Uri.encodeComponent(link.itemId);
    await deleteJson('/api/affiliates/$normalized/links/$itemId');
  }

  /// Loads the reseller wallet, managed customers and plans available for
  /// activation. The endpoint is intentionally user-scoped so a reseller can
  /// never access another partner's customers.
  Future<ResellerDashboardSnapshot> loadResellerDashboard() async {
    final json = await getJson('/api/user/reseller');
    final snapshot = ResellerDashboardSnapshot.fromJson(json);
    _lastResellerDashboardSnapshot = snapshot;
    unawaited(_writeResellerDashboardDiskSnapshot(json));
    return snapshot;
  }

  /// Opens the partner workspace from the latest local snapshot and refreshes
  /// it in the background. This keeps navigation instant even with a slow
  /// network or a large customer/team list.
  Stream<ResellerDashboardSnapshot> watchResellerDashboard() async* {
    var cached = _lastResellerDashboardSnapshot;
    cached ??= await _readResellerDashboardDiskSnapshot();
    if (cached != null) yield cached;
    try {
      final fresh = await loadResellerDashboard();
      yield fresh;
    } catch (_) {
      if (cached == null) rethrow;
    }
  }

  Future<String> _partnerCacheIdentity() async {
    final user = await _sessionStore.readCachedUser();
    final id = user?.id ?? 0;
    final key = 'user_${id > 0 ? id : 'anonymous'}';
    _partnerCacheKey = key;
    return key;
  }

  Future<ResellerDashboardSnapshot?>
  _readResellerDashboardDiskSnapshot() async {
    try {
      final key = await _partnerCacheIdentity();
      final raw = await readPartnerDiskCache(key);
      if (raw == null) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      final savedAt = DateTime.tryParse(decoded['savedAt']?.toString() ?? '');
      if (savedAt == null ||
          DateTime.now().difference(savedAt).abs() > const Duration(days: 7)) {
        return null;
      }
      final payload = _map(decoded['snapshot']);
      if (payload.isEmpty) return null;
      final snapshot = ResellerDashboardSnapshot.fromJson(payload);
      _lastResellerDashboardSnapshot = snapshot;
      return snapshot;
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeResellerDashboardDiskSnapshot(
    Map<String, dynamic> payload,
  ) async {
    try {
      final key = _partnerCacheKey ?? await _partnerCacheIdentity();
      await writePartnerDiskCache(
        key,
        jsonEncode({
          'savedAt': DateTime.now().toUtc().toIso8601String(),
          'snapshot': payload,
        }),
      );
    } catch (_) {}
  }

  Future<Map<String, dynamic>> loadResellerPaymentSettings() async {
    final json = await getJson('/api/user/reseller/payments');
    return _map(json['payment'] ?? const <String, dynamic>{});
  }

  Future<String> connectResellerMercadoPago() async {
    final json = await postJson(
      '/api/user/reseller/payments',
      data: {'action': 'connect'},
    );
    return (json['authorizationUrl'] ?? '').toString();
  }

  Future<Map<String, dynamic>> disconnectResellerMercadoPago() async {
    final json = await postJson(
      '/api/user/reseller/payments',
      data: {'action': 'disconnect'},
    );
    return _map(json['payment'] ?? const <String, dynamic>{});
  }

  Future<Map<String, dynamic>> createResellerCreditCheckout({
    required int credits,
  }) async {
    final json = await postJson(
      '/api/user/reseller/payments',
      data: {'action': 'buy_credits', 'credits': credits},
    );
    return _map(json);
  }

  Future<ResellerCustomerSummary> createResellerCustomer({
    required String name,
    required String email,
    required String password,
    String? whatsappNumber,
    int? planId,
  }) async {
    final json = await postJson(
      '/api/user/reseller',
      data: {
        'action': 'create_customer',
        'name': name.trim(),
        'email': email.trim(),
        'password': password,
        if (whatsappNumber != null && whatsappNumber.trim().isNotEmpty)
          'whatsappNumber': whatsappNumber.trim(),
        if (planId != null) 'planId': planId,
      },
    );
    return ResellerCustomerSummary.fromJson(
      _map(json['customer'] ?? json['link'] ?? const <String, dynamic>{}),
    );
  }

  Future<void> activateResellerCustomer({
    required int customerUserId,
    required int planId,
    String? idempotencyKey,
  }) async {
    await postJson(
      '/api/user/reseller',
      data: {
        'action': 'activate',
        'customerUserId': customerUserId,
        'planId': planId,
        if (idempotencyKey != null) 'idempotencyKey': idempotencyKey,
      },
    );
  }

  Future<AuthSession> impersonateResellerCustomer(int userId) async {
    if (userId <= 0) throw BotAdminApiException('Cliente inválido.');
    _clearSessionCaches();
    final json = await postJson(
      '/api/user/reseller/customers/$userId/impersonate',
    );
    final sessionCookie = json['sessionCookie']?.toString().trim() ?? '';
    final adminSessionCookie =
        json['adminSessionCookie']?.toString().trim() ?? '';
    if (sessionCookie.isNotEmpty) {
      await _sessionStore.saveSessionCookie(
        [
          sessionCookie,
          if (adminSessionCookie.isNotEmpty) adminSessionCookie,
        ].join('; '),
      );
    }
    final session = await restoreSession(fallbackToCached: false);
    if (session == null || session.user.id != userId) {
      throw BotAdminApiException(
        'A sessão foi criada, mas o painel do cliente não pôde ser aberto.',
      );
    }
    return session;
  }

  Future<ResellerCustomerSummary> updateResellerCustomer({
    required int customerUserId,
    required String name,
    required String email,
    String? whatsappNumber,
  }) async {
    final json = await postJson(
      '/api/user/reseller',
      data: {
        'action': 'update_customer',
        'customerUserId': customerUserId,
        'name': name.trim(),
        'email': email.trim(),
        if (whatsappNumber != null) 'whatsappNumber': whatsappNumber.trim(),
      },
    );
    return ResellerCustomerSummary.fromJson(
      _map(json['customer'] ?? const <String, dynamic>{}),
    );
  }

  Future<List<PartnerMemberSummary>> loadPartnerMembers() async {
    final json = await getJson('/api/admin/partners');
    return _list(
      json['members'],
    ).map(PartnerMemberSummary.fromJson).toList(growable: false);
  }

  Future<PartnerMemberSummary> savePartnerMember({
    required int userId,
    required String role,
    Map<String, Object?>? permissions,
    String status = 'active',
    double? commissionRate,
  }) async {
    final json = await postJson(
      '/api/admin/partners',
      data: {
        'action': 'member',
        'userId': userId,
        'role': role,
        'status': status,
        if (commissionRate != null) 'commissionRate': commissionRate,
        if (permissions != null) 'permissions': permissions,
      },
    );
    return PartnerMemberSummary.fromJson(_map(json['member']));
  }

  Future<PartnerMemberSummary> createPartnerMember({
    required String name,
    required String email,
    required String password,
    String? whatsappNumber,
    required String role,
    Map<String, Object?>? permissions,
    String status = 'active',
    double? commissionRate,
    int? initialCredits,
  }) async {
    final json = await postJson(
      '/api/admin/partners',
      data: {
        'action': 'create_member',
        'name': name.trim(),
        'email': email.trim(),
        'password': password,
        if (whatsappNumber != null && whatsappNumber.trim().isNotEmpty)
          'whatsappNumber': whatsappNumber.trim(),
        'role': role,
        'status': status,
        if (commissionRate != null) 'commissionRate': commissionRate,
        if (initialCredits != null) 'initialCredits': initialCredits,
        if (permissions != null) 'permissions': permissions,
      },
    );
    return PartnerMemberSummary.fromJson(_map(json['member']));
  }

  Future<Map<String, dynamic>> savePartnerFinancialSettings({
    int? userId,
    required double creditUnitPrice,
    required bool manualPaymentsEnabled,
    required bool allowChildManualPayments,
    String? manualPixKey,
    String? manualInstructions,
    String proxySalesMode = 'manual',
    double proxyMonthlyPrice = 0,
    bool allowCustomerProxy = true,
    String? proxySalesInstructions,
    List<Map<String, Object?>>? planCosts,
  }) async {
    return putJson(
      '/api/user/reseller/finance',
      data: {
        if (userId != null) 'userId': userId,
        'creditUnitPrice': creditUnitPrice,
        'manualPaymentsEnabled': manualPaymentsEnabled,
        'allowChildManualPayments': allowChildManualPayments,
        'manualPixKey': manualPixKey,
        'manualInstructions': manualInstructions,
        'proxySalesMode': proxySalesMode,
        'proxyMonthlyPrice': proxyMonthlyPrice,
        'allowCustomerProxy': allowCustomerProxy,
        'proxySalesInstructions': proxySalesInstructions,
        if (planCosts != null) 'planCosts': planCosts,
      },
    );
  }

  Future<Map<String, dynamic>> getPartnerFinancialSettings([
    int? userId,
  ]) async {
    final suffix = userId == null ? '' : '?userId=$userId';
    return getJson('/api/user/reseller/finance$suffix');
  }

  Future<List<Map<String, dynamic>>> loadPartnerCustomerProxies() async {
    final json = await getJson('/api/user/reseller/proxies');
    final rows = json['instances'];
    if (rows is! List) return const [];
    return rows
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  Future<Map<String, dynamic>> savePartnerCustomerProxy({
    required int instanceId,
    required Map<String, Object?> proxy,
  }) {
    return putJson(
      '/api/user/reseller/proxies',
      data: {'instanceId': instanceId, ...proxy},
    );
  }

  Future<List<Map<String, dynamic>>> loadManualPartnerPayments() async {
    final json = await getJson('/api/user/reseller/manual-payments');
    final rows = json['requests'];
    if (rows is! List) return const [];
    return rows
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  Future<Map<String, dynamic>> submitManualPartnerPayment({
    required int credits,
    required Uint8List proofBytes,
    required String proofFileName,
    String? proofMimeType,
    String? note,
  }) async {
    final form = FormData.fromMap({
      'credits': credits.toString(),
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      'proof': MultipartFile.fromBytes(
        proofBytes,
        filename: proofFileName,
        contentType: proofMimeType == null
            ? null
            : DioMediaType.parse(proofMimeType),
      ),
    });
    return postFormData('/api/user/reseller/manual-payments', form);
  }

  Future<Map<String, dynamic>> reviewManualPartnerPayment({
    required String publicId,
    required bool approve,
    String? note,
  }) async {
    return postJson(
      '/api/user/reseller/manual-payments',
      data: {
        'action': approve ? 'approve' : 'reject',
        'publicId': publicId,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    );
  }

  Future<PartnerMemberSummary> updateSubpartner({
    required int userId,
    required String name,
    required String email,
    String? whatsappNumber,
    String? password,
    required String status,
    required double commissionRate,
    required Map<String, Object?> permissions,
  }) async {
    final json = await postJson(
      '/api/user/reseller',
      data: {
        'action': 'update_subpartner',
        'userId': userId,
        'role': 'reseller',
        'name': name.trim(),
        'email': email.trim(),
        'whatsappNumber': whatsappNumber?.trim() ?? '',
        if (password != null && password.trim().isNotEmpty)
          'password': password.trim(),
        'status': status,
        'commissionRate': commissionRate,
        'permissions': permissions,
      },
    );
    return PartnerMemberSummary.fromJson(_map(json['member']));
  }

  Future<void> removeSubpartner(int userId) async {
    await postJson(
      '/api/user/reseller',
      data: {'action': 'remove_subpartner', 'userId': userId},
    );
  }

  Future<AuthSession> impersonateSubpartner(int userId) async {
    if (userId <= 0) throw BotAdminApiException('Revendedor inválido.');
    _clearSessionCaches();
    final json = await postJson('/api/user/reseller/team/$userId/impersonate');
    final sessionCookie = json['sessionCookie']?.toString().trim() ?? '';
    final originSessionCookie =
        json['adminSessionCookie']?.toString().trim() ?? '';
    if (sessionCookie.isNotEmpty) {
      await _sessionStore.saveSessionCookie(
        [
          sessionCookie,
          if (originSessionCookie.isNotEmpty) originSessionCookie,
        ].join('; '),
      );
    }
    final session = await restoreSession(fallbackToCached: false);
    if (session == null || session.user.id != userId) {
      throw BotAdminApiException(
        'A sessão foi criada, mas o painel do revendedor não pôde ser aberto.',
      );
    }
    return session;
  }

  Future<ResellerWalletSummary> grantPartnerCredits({
    required int resellerUserId,
    required int credits,
    String? idempotencyKey,
    String? referenceId,
  }) async {
    final json = await postJson(
      '/api/admin/partners',
      data: {
        'action': 'grant_credits',
        'resellerUserId': resellerUserId,
        'credits': credits,
        if (idempotencyKey != null) 'idempotencyKey': idempotencyKey,
        if (referenceId != null) 'referenceId': referenceId,
      },
    );
    return ResellerWalletSummary.fromJson(_map(json['wallet']));
  }

  Future<CommerceHistorySnapshot> loadCommerceHistory({int limit = 120}) async {
    final results = await Future.wait([
      getJson('/api/user/purchases?limit=$limit'),
      getJson('/api/user/charges?limit=$limit'),
    ]);
    final purchases = _list(
      results[0]['purchases'],
    ).map(PurchaseHistorySummary.fromJson).toList();
    final charges = _list(
      results[1]['charges'],
    ).map(PaymentChargeSummary.fromJson).toList();
    purchases.sort((a, b) => b.purchasedAt.compareTo(a.purchasedAt));
    charges.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return CommerceHistorySnapshot(purchases: purchases, charges: charges);
  }

  Future<ApiRestKeySnapshot> loadApiRestKey() async {
    final json = await getJson('/api/user/apirest');
    return ApiRestKeySnapshot.fromJson(json);
  }

  Future<ApiRestKeySnapshot> rotateApiRestKey() async {
    final json = await postJson(
      '/api/user/apirest',
      data: {'action': 'rotate'},
    );
    return ApiRestKeySnapshot.fromJson(json);
  }

  Future<ApiRestKeySnapshot> setCustomApiRestKey(String apiKey) async {
    final json = await postJson(
      '/api/user/apirest',
      data: {'action': 'set_custom', 'apiKey': apiKey},
    );
    return ApiRestKeySnapshot.fromJson(json);
  }

  Future<MetaWebhookSettings?> loadMetaWebhookSettings() async {
    final json = await getJson('/api/webhooks/meta/settings');
    final webhook = json['webhook'];
    if (webhook == null) return null;
    return MetaWebhookSettings.fromJson(_map(webhook));
  }

  Future<MetaWebhookSettings> saveMetaWebhookSettings({
    required String verifyToken,
    String? appId,
    String? businessAccountId,
    String? phoneNumberId,
    String? accessToken,
  }) async {
    final data = <String, Object?>{
      'verifyToken': verifyToken,
      'appId': appId,
      'businessAccountId': businessAccountId,
      'phoneNumberId': phoneNumberId,
    };
    if (accessToken != null && accessToken.trim().isNotEmpty) {
      data['accessToken'] = accessToken.trim();
    }
    final json = await putJson('/api/webhooks/meta/settings', data: data);
    return MetaWebhookSettings.fromJson(_map(json['webhook']));
  }

  Future<String> testMetaWebhookSettings({
    String? verifyToken,
    String? appId,
    String? businessAccountId,
    String? phoneNumberId,
    String? accessToken,
  }) async {
    final json = await postJson(
      '/api/webhooks/meta/test',
      data: {
        if (verifyToken != null && verifyToken.trim().isNotEmpty)
          'verifyToken': verifyToken.trim(),
        if (appId != null && appId.trim().isNotEmpty) 'appId': appId.trim(),
        if (businessAccountId != null && businessAccountId.trim().isNotEmpty)
          'businessAccountId': businessAccountId.trim(),
        if (phoneNumberId != null && phoneNumberId.trim().isNotEmpty)
          'phoneNumberId': phoneNumberId.trim(),
        if (accessToken != null && accessToken.trim().isNotEmpty)
          'accessToken': accessToken.trim(),
      },
    );
    return json['message']?.toString() ?? 'Webhook testado.';
  }

  Future<List<InstanceCallsSnapshot>> loadCallsForInstances(
    List<BotInstance> instances,
  ) async {
    final connected = instances
        .where((instance) => instance.isConnected)
        .toList(growable: false);
    return Future.wait(
      connected.map((instance) async {
        final json = await getJson(
          '/api/bot-instances/${instance.id}/whatsapp-calls',
        );
        return InstanceCallsSnapshot(
          instance: instance,
          calls: _list(
            json['activeCalls'] ?? json['calls'],
          ).map(WhatsappCallRecord.fromJson).toList(),
        );
      }),
    );
  }

  Future<String?> executeCallAction(
    BotInstance instance, {
    required String action,
    String? callId,
    String? chatJid,
    String? callCreator,
    bool video = false,
  }) async {
    final json = await postJson(
      '/api/bot-instances/${instance.id}/whatsapp-calls',
      data: {
        'action': action,
        if (callId != null && callId.trim().isNotEmpty) 'callId': callId,
        if (chatJid != null && chatJid.trim().isNotEmpty) 'chatJid': chatJid,
        if (callCreator != null && callCreator.trim().isNotEmpty)
          'callCreator': callCreator,
        if (action == 'start') 'video': video,
      },
    );
    return _callIdFromJson(json);
  }

  Future<String?> startCallForThread(
    ConversationThread thread, {
    bool video = false,
  }) async {
    final json = await postJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-calls',
      data: {'action': 'start', 'chatJid': thread.chatJid, 'video': video},
    );
    return _callIdFromJson(json);
  }

  Future<Map<String, dynamic>> loadWhatsappRealtimeEvents({
    int after = 0,
    int? instanceId,
    String? chatJid,
    int limit = 100,
  }) async {
    final params = <String, String>{
      'after': after.toString(),
      'limit': limit.toString(),
      if (instanceId != null && instanceId > 0) 'instanceId': '$instanceId',
      if (chatJid != null && chatJid.trim().isNotEmpty) 'chatJid': chatJid,
    };
    final query = Uri(queryParameters: params).query;
    return getJson('/api/whatsapp-realtime/events?$query');
  }

  Future<InstanceSettingsBundle> loadInstanceSettings(int instanceId) async {
    final json = await getJson('/api/bot-instances/$instanceId/settings');
    return InstanceSettingsBundle.fromJson(json);
  }

  Future<InstanceSettingsBundle> updateInstanceSettings(
    int instanceId,
    Map<String, Object?> payload,
  ) async {
    final json = await patchJson(
      '/api/bot-instances/$instanceId/settings',
      data: payload,
    );
    return InstanceSettingsBundle.fromJson(json);
  }

  Future<MediaStorageSnapshot> loadMediaStorage() async {
    final json = await getJson('/api/user/media-storage/plans');
    return MediaStorageSnapshot.fromJson(json);
  }

  Future<PlanCheckout?> createMediaStorageCheckout({
    required int planId,
    required String provider,
  }) async {
    final json = await postJson(
      '/api/user/media-storage/checkout',
      data: {'planId': planId, 'provider': provider},
    );
    final raw = json['checkout'];
    if (raw is Map) {
      return PlanCheckout.fromJson(Map<String, dynamic>.from(raw));
    }
    if (json['activated'] == true || json['adminExempt'] == true) {
      return null;
    }
    throw BotAdminApiException(
      json['message']?.toString() ??
          'Pagamento de storage criado sem dados de retorno.',
    );
  }

  Future<PlanSnapshot> loadPlanSnapshot() async {
    final json = await getJson('/api/user/plan/mobile');
    return PlanSnapshot.fromJson(json);
  }

  Future<PlanCheckout> createPlanCheckout({
    required int planId,
    required String provider,
    String mode = 'profile_unlimited',
    int? instanceId,
    bool proxyEnabled = false,
  }) async {
    final json = await postJson(
      '/api/user/plan/checkout',
      data: {
        'planId': planId,
        'provider': provider,
        'context': {
          'mode': mode,
          if (instanceId != null && instanceId > 0) 'instanceId': instanceId,
          if (proxyEnabled) 'proxyEnabled': true,
        },
      },
    );
    final raw = json['checkout'];
    if (raw is Map) {
      return PlanCheckout.fromJson(Map<String, dynamic>.from(raw));
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'Pagamento criado sem dados de retorno.',
    );
  }

  Future<String> activatePlanWithBalance({required int planId}) async {
    final json = await postJson(
      '/api/user/plan/pay-with-balance',
      data: {'planId': planId},
    );
    return json['message']?.toString() ??
        'Plano ativado com o saldo disponível.';
  }

  Future<List<BotInstance>> listInstances({bool refreshStatus = true}) async {
    final json = await getJson(
      refreshStatus
          ? '/api/bot-instances'
          : '/api/bot-instances?refreshStatus=0',
    );
    return _list(json['instances']).map(BotInstance.fromJson).toList();
  }

  Future<List<BotServer>> listBotServers() async {
    final json = await getJson('/api/bot-servers');
    return _list(json['servers']).map(BotServer.fromJson).toList();
  }

  Future<BotInstance> createInstance({
    required int serverId,
    required String phone,
    String? name,
  }) async {
    final result = await createInstanceWithResult(
      serverId: serverId,
      phone: phone,
      name: name,
    );
    return result.instance;
  }

  Future<CreateInstanceResult> createInstanceWithResult({
    required int serverId,
    required String phone,
    String? name,
  }) async {
    final json = await postJson(
      '/api/bot-instances',
      data: {
        'serverId': serverId,
        'phone': phone,
        if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
      },
    );
    try {
      return CreateInstanceResult.fromJson(json);
    } on FormatException {
      throw BotAdminApiException(
        json['message']?.toString() ?? 'Perfil criado sem dados de retorno.',
      );
    }
  }

  Future<BotInstanceProfile> loadInstanceProfile(int instanceId) async {
    final json = await getJson('/api/bot-instances/$instanceId/profile');
    final raw = json['profile'];
    if (raw is Map) {
      return BotInstanceProfile.fromJson(Map<String, dynamic>.from(raw));
    }
    throw BotAdminApiException(
      json['message']?.toString() ?? 'Perfil da instância indisponível.',
    );
  }

  Future<String> runInstanceAction(int instanceId, String action) async {
    final json = await postJson(
      '/api/bot-instances/$instanceId/actions',
      data: {'action': action},
    );
    return json['message']?.toString() ?? 'Ação executada.';
  }

  Future<String> refreshInstanceStatus(int instanceId) async {
    final json = await getJson('/api/bot-instances/$instanceId/status');
    return (json['status'] ?? '').toString();
  }

  Future<PairingPayload> pairInstance(
    int instanceId, {
    String mode = 'auto',
  }) async {
    final json = await postJson(
      '/api/bot-instances/$instanceId/pair',
      data: {'mode': mode},
    );
    return PairingPayload.fromJson(json);
  }

  Future<InstanceProxyBundle> loadInstanceProxy(int instanceId) async {
    final json = await getJson('/api/bot-instances/$instanceId/proxy');
    return InstanceProxyBundle.fromJson(json);
  }

  Future<Map<String, dynamic>> testInstanceProxy(
    int instanceId,
    Map<String, Object?> payload,
  ) => postJson('/api/bot-instances/$instanceId/proxy', data: payload);

  Future<InstanceProxyBundle> saveInstanceProxy(
    int instanceId,
    Map<String, Object?> payload,
  ) async {
    final json = await putJson(
      '/api/bot-instances/$instanceId/proxy',
      data: payload,
    );
    return InstanceProxyBundle.fromJson(json);
  }

  Future<MobileUpdateSnapshot> loadMobileUpdate({
    int? currentVersionCode,
  }) async {
    final query = currentVersionCode == null || currentVersionCode <= 0
        ? ''
        : '?platform=android&currentVersionCode=$currentVersionCode';
    final json = await getJson('/api/mobile/update$query');
    return MobileUpdateSnapshot.fromJson(json);
  }

  /// Downloads media with session auth so web players can use a blob URL.
  Future<MediaBytes> downloadMediaBytes(
    String mediaUrl, {
    bool forceRefresh = false,
  }) async {
    final path = _normalizeMediaRequestPath(
      mediaUrl,
      forceRefresh: forceRefresh,
    );
    final response = await _dio.get<List<int>>(
      path,
      options: Options(
        responseType: ResponseType.bytes,
        headers: const {'Accept': '*/*'},
        followRedirects: true,
        validateStatus: (_) => true,
      ),
    );
    final status = response.statusCode ?? 500;
    if (status < 200 || status >= 300) {
      String message = 'Falha ao baixar mídia.';
      final body = response.data;
      if (body is List<int> && body.isNotEmpty) {
        try {
          final decoded = jsonDecode(utf8.decode(body));
          if (decoded is Map && decoded['message'] != null) {
            message = decoded['message'].toString();
          }
        } catch (_) {}
      }
      if (status == 401) {
        await _sessionStore.clear();
        _clearSessionCaches();
      }
      throw BotAdminApiException(message, statusCode: status);
    }
    final bytes = Uint8List.fromList(response.data ?? const <int>[]);
    if (bytes.isEmpty) {
      throw BotAdminApiException('Mídia vazia.', statusCode: status);
    }
    final headerContentType =
        response.headers.value('content-type')?.split(';').first.trim() ?? '';
    final contentType =
        _guessMimeFromBytes(bytes) ??
        (headerContentType.isNotEmpty &&
                headerContentType.toLowerCase() != 'application/octet-stream'
            ? headerContentType
            : null) ??
        _guessMimeFromUrl(path) ??
        'application/octet-stream';
    return MediaBytes(bytes: bytes, mimeType: contentType);
  }

  Future<String?> readSessionCookieHeader() =>
      _sessionStore.readSessionCookie();

  String _normalizeMediaRequestPath(
    String mediaUrl, {
    bool forceRefresh = false,
  }) {
    final trimmed = mediaUrl.trim();
    if (trimmed.isEmpty) return trimmed;
    final base = AppConfig.apiBaseUrl.trim();
    String appendRefresh(String value) {
      if (!forceRefresh || !value.contains('/whatsapp-conversations/')) {
        return value;
      }
      final separator = value.contains('?') ? '&' : '?';
      return '$value${separator}refresh=1';
    }

    if (base.isNotEmpty && trimmed.startsWith(base)) {
      final stripped = trimmed.substring(base.length);
      return appendRefresh(stripped.isEmpty ? '/' : stripped);
    }
    final uri = Uri.tryParse(trimmed);
    if (uri != null && uri.hasScheme && uri.host.isNotEmpty) {
      // Absolute third-party URL — download via full URL.
      return appendRefresh(trimmed);
    }
    return appendRefresh(trimmed.startsWith('/') ? trimmed : '/$trimmed');
  }

  String? _guessMimeFromBytes(Uint8List bytes) {
    if (bytes.length >= 12 &&
        bytes[0] == 0x52 &&
        bytes[1] == 0x49 &&
        bytes[2] == 0x46 &&
        bytes[3] == 0x46 &&
        bytes[8] == 0x57 &&
        bytes[9] == 0x45 &&
        bytes[10] == 0x42 &&
        bytes[11] == 0x50) {
      return 'image/webp';
    }
    if (bytes.length >= 12) {
      final box = latin1.decode(bytes.sublist(4, 12), allowInvalid: true);
      if (box.startsWith('ftypM4A') ||
          box.startsWith('ftypM4B') ||
          box.startsWith('ftypM4P')) {
        return 'audio/mp4';
      }
      if (box.startsWith('ftyp')) return 'video/mp4';
    }
    if (bytes.length >= 6 &&
        bytes[0] == 0x23 &&
        bytes[1] == 0x21 &&
        bytes[2] == 0x41 &&
        bytes[3] == 0x4D &&
        bytes[4] == 0x52) {
      return 'audio/amr';
    }
    if (bytes.length >= 12 &&
        bytes[0] == 0x52 &&
        bytes[1] == 0x49 &&
        bytes[2] == 0x46 &&
        bytes[3] == 0x46 &&
        bytes[8] == 0x57 &&
        bytes[9] == 0x41 &&
        bytes[10] == 0x56 &&
        bytes[11] == 0x45) {
      return 'audio/wav';
    }
    if (bytes.length >= 4) {
      final head = bytes.sublist(0, 4);
      if (head[0] == 0x47 &&
          head[1] == 0x49 &&
          head[2] == 0x46 &&
          head[3] == 0x38) {
        return 'image/gif';
      }
      if (head[0] == 0x89 &&
          head[1] == 0x50 &&
          head[2] == 0x4E &&
          head[3] == 0x47) {
        return 'image/png';
      }
      if (head[0] == 0xFF && head[1] == 0xD8) {
        return 'image/jpeg';
      }
      if (head[0] == 0x4F &&
          head[1] == 0x67 &&
          head[2] == 0x67 &&
          head[3] == 0x53) {
        return 'audio/ogg';
      }
      if (head[0] == 0x1A &&
          head[1] == 0x45 &&
          head[2] == 0xDF &&
          head[3] == 0xA3) {
        return 'video/webm';
      }
      if (head[0] == 0xFF && (head[1] & 0xE0) == 0xE0) {
        return 'audio/mpeg';
      }
      if (head[0] == 0x49 && head[1] == 0x44 && head[2] == 0x33) {
        return 'audio/mpeg';
      }
    }
    return null;
  }

  String? _guessMimeFromUrl(String url) {
    final lower = url.toLowerCase();
    if (lower.contains('.mp4') || lower.contains('video')) return 'video/mp4';
    if (lower.contains('.webm')) return 'video/webm';
    if (lower.contains('.ogg') ||
        lower.contains('opus') ||
        lower.contains('audio')) {
      return 'audio/ogg';
    }
    if (lower.contains('.mp3')) return 'audio/mpeg';
    if (lower.contains('.m4a')) return 'audio/mp4';
    return null;
  }

  Future<List<InternalGroup>> loadInternalGroups() async {
    final json = await getJson('/api/internal-groups');
    return _list(
      json['groups'],
    ).map(InternalGroup.fromJson).toList(growable: false);
  }

  Future<InternalGroupDetails> loadInternalGroup(int groupId) async {
    final json = await getJson('/api/internal-groups/$groupId');
    return InternalGroupDetails.fromJson(json);
  }

  Future<({InternalGroup group, String? inviteUrl})> createInternalGroup({
    required String name,
    String? description,
  }) async {
    final json = await postJson(
      '/api/internal-groups',
      data: {'name': name, 'description': description},
    );
    return (
      group: InternalGroup.fromJson(_map(json['group'])),
      inviteUrl: json['inviteUrl'] == null
          ? null
          : _absoluteInviteUrl(json['inviteUrl'].toString()),
    );
  }

  Future<InternalGroup> joinInternalGroup(String tokenOrUrl) async {
    var token = tokenOrUrl.trim();
    final uri = Uri.tryParse(token);
    if (uri != null && uri.pathSegments.isNotEmpty) {
      final groupIndex = uri.pathSegments.lastIndexOf('g');
      if (groupIndex >= 0 && groupIndex + 1 < uri.pathSegments.length) {
        token = uri.pathSegments[groupIndex + 1];
      }
    }
    final json = await postJson(
      '/api/internal-groups/join',
      data: {'token': token},
    );
    return InternalGroup.fromJson(_map(json['group']));
  }

  Future<Map<String, dynamic>> loadInternalGroupInvitePreview(
    String token,
  ) async {
    final normalized = token.trim();
    if (normalized.isEmpty) {
      throw BotAdminApiException('Convite inválido.');
    }
    final json = await getJson(
      '/api/internal-groups/invite/preview?token=${Uri.encodeQueryComponent(normalized)}',
    );
    return _map(json['preview']);
  }

  Future<String> rotateInternalGroupInvite(int groupId) async {
    final json = await postJson('/api/internal-groups/$groupId/invite');
    final url = json['inviteUrl']?.toString().trim() ?? '';
    if (url.isEmpty) {
      throw BotAdminApiException('O servidor não retornou o link do convite.');
    }
    return _absoluteInviteUrl(url);
  }

  Future<Map<String, dynamic>> loadInternalGroupMessages(
    int groupId, {
    int? after,
    int? before,
    int limit = 60,
  }) async {
    final query = <String, String>{'limit': '$limit'};
    if (after != null && after > 0) query['after'] = '$after';
    if (before != null && before > 0) query['before'] = '$before';
    final json = await getJson(
      '/api/internal-groups/$groupId/messages?${Uri(queryParameters: query).query}',
    );
    return {
      ...json,
      'messages': _list(
        json['messages'],
      ).map(InternalGroupMessage.fromJson).toList(),
    };
  }

  Future<InternalGroupMessage> sendInternalGroupText(
    int groupId,
    String text, {
    int? replyToMessageId,
    String? messageType,
    bool mentionAll = false,
    List<String> mentions = const [],
    String? clientMessageId,
  }) async {
    final json = await postJson(
      '/api/internal-groups/$groupId/messages',
      data: {
        'text': text,
        if (messageType != null) 'messageType': messageType,
        if (replyToMessageId != null) 'replyToMessageId': replyToMessageId,
        if (mentionAll) 'mentionAll': true,
        if (mentions.isNotEmpty) 'mentions': mentions,
        if (clientMessageId != null && clientMessageId.trim().isNotEmpty)
          'clientMessageId': clientMessageId.trim(),
      },
    );
    return InternalGroupMessage.fromJson(_map(json['message']));
  }

  Future<InternalGroupMessage> sendInternalGroupMedia(
    int groupId, {
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    String? text,
    int? replyToMessageId,
    bool asSticker = false,
    bool viewOnce = false,
    bool mentionAll = false,
    List<String> mentions = const [],
    String? clientMessageId,
  }) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName,
        contentType: DioMediaType.parse(
          mimeType.isEmpty ? 'application/octet-stream' : mimeType,
        ),
      ),
      if (text != null && text.trim().isNotEmpty) 'text': text.trim(),
      if (replyToMessageId != null) 'replyToMessageId': '$replyToMessageId',
      if (asSticker) 'asSticker': 'true',
      if (viewOnce) 'viewOnce': 'true',
      if (mentionAll) 'mentionAll': 'true',
      if (mentions.isNotEmpty) 'mentions': jsonEncode(mentions),
      if (clientMessageId != null && clientMessageId.trim().isNotEmpty)
        'clientMessageId': clientMessageId.trim(),
    });
    final json = await postFormData(
      '/api/internal-groups/$groupId/messages',
      form,
    );
    return InternalGroupMessage.fromJson(_map(json['message']));
  }

  Future<void> markInternalGroupRead(int groupId, int messageId) async {
    await postJson(
      '/api/internal-groups/$groupId/read',
      data: {'messageId': messageId},
    );
  }

  Future<void> sendInternalGroupReceipts(
    int groupId,
    List<Map<String, Object?>> receipts,
  ) async {
    if (receipts.isEmpty) return;
    await postJson(
      '/api/internal-groups/$groupId/receipts',
      data: {'receipts': receipts},
    );
  }

  Future<List<MessageReceipt>> loadMessageReceipts(
    ConversationThread thread,
    ChatMessage message,
  ) async {
    final key = message.remoteId.trim().isNotEmpty
        ? message.remoteId.trim()
        : message.id.trim();
    if (key.isEmpty) return const <MessageReceipt>[];
    if (thread.isInternalGroup) {
      final groupId = _internalGroupId(thread);
      final json = await getJson(
        '/api/internal-groups/$groupId/receipts?messageId=${Uri.encodeComponent(key)}',
      );
      return _list(json['receipts'])
          .map((item) {
            final map = item;
            final state = map['state']?.toString() == 'read'
                ? MessageDeliveryState.read
                : MessageDeliveryState.delivered;
            return MessageReceipt(
              userId: '${map['userId'] ?? ''}',
              name: '${map['name'] ?? 'Participante'}',
              avatarUrl: map['avatarUrl']?.toString(),
              state: state,
              deliveredAt: DateTime.tryParse('${map['deliveredAt'] ?? ''}'),
              readAt: DateTime.tryParse('${map['readAt'] ?? ''}'),
            );
          })
          .toList(growable: false);
    }
    final json = await postJson(
      '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${Uri.encodeComponent(thread.chatJid)}/messages/${Uri.encodeComponent(key)}/actions',
      data: {'action': 'info'},
    );
    return _list(json['receipts'])
        .map((item) {
          final map = item;
          final state = map['state']?.toString() == 'read'
              ? MessageDeliveryState.read
              : MessageDeliveryState.delivered;
          return MessageReceipt(
            userId: '${map['recipientJid'] ?? ''}',
            name: '${map['recipientName'] ?? 'Participante'}',
            state: state,
            deliveredAt: DateTime.tryParse('${map['deliveredAt'] ?? ''}'),
            readAt: DateTime.tryParse('${map['readAt'] ?? ''}'),
          );
        })
        .toList(growable: false);
  }

  Future<void> deleteInternalGroupMessage(int groupId, int messageId) async {
    await deleteJson('/api/internal-groups/$groupId/messages/$messageId');
  }

  Future<void> pinInternalGroupMessage(
    int groupId,
    int messageId,
    bool pinned,
  ) async {
    await patchJson(
      '/api/internal-groups/$groupId/messages/$messageId',
      data: {'pinned': pinned},
    );
  }

  Future<void> runInternalGroupMessageAction(
    int groupId,
    int messageId,
    String action, {
    Map<String, dynamic>? data,
  }) async {
    await postJson(
      '/api/internal-groups/$groupId/messages/$messageId/actions',
      data: {'action': action, ...?data},
    );
  }

  Future<void> updateInternalGroupMember(
    int groupId,
    int memberId,
    String action,
  ) async {
    await patchJson(
      '/api/internal-groups/$groupId/members/$memberId',
      data: {'action': action},
    );
  }

  Future<Map<String, dynamic>> transferInternalGroupAndLeave(
    int groupId,
    int newOwnerUserId,
  ) => patchJson(
    '/api/internal-groups/$groupId',
    data: {'action': 'transfer-and-leave', 'newOwnerUserId': newOwnerUserId},
  );

  Future<Map<String, dynamic>> runInternalGroupAction(
    int groupId,
    String action, {
    Map<String, dynamic>? data,
  }) => patchJson(
    '/api/internal-groups/$groupId',
    data: {'action': action, ...?data},
  );

  Future<InternalGroup> updateInternalGroup(
    int groupId, {
    String? name,
    String? description,
    bool? isActive,
    bool? botEnabled,
    String? botName,
    bool? welcomeEnabled,
    String? welcomeMessage,
    bool? membersCanSend,
    bool? membersCanAdd,
    bool? approvalRequired,
    bool? adminsCanEdit,
    bool? membersCanStartPv,
    String? inviteSlug,
  }) async {
    final json = await patchJson(
      '/api/internal-groups/$groupId',
      data: {
        if (name != null) 'name': name,
        if (description != null) 'description': description,
        if (botEnabled != null) 'botEnabled': botEnabled,
        if (botName != null) 'botName': botName,
        if (welcomeEnabled != null) 'welcomeEnabled': welcomeEnabled,
        if (welcomeMessage != null) 'welcomeMessage': welcomeMessage,
        if (membersCanSend != null) 'membersCanSend': membersCanSend,
        if (membersCanAdd != null) 'membersCanAdd': membersCanAdd,
        if (approvalRequired != null) 'approvalRequired': approvalRequired,
        if (adminsCanEdit != null) 'adminsCanEdit': adminsCanEdit,
        if (membersCanStartPv != null) 'membersCanStartPv': membersCanStartPv,
        if (inviteSlug != null) 'inviteSlug': inviteSlug,
        if (isActive != null) 'isActive': isActive,
      },
    );
    return InternalGroup.fromJson(_map(json['group']));
  }

  Future<InternalGroup> uploadInternalGroupAvatar(
    int groupId, {
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName,
        contentType: DioMediaType.parse(mimeType),
      ),
    });
    final json = await postFormData(
      '/api/internal-groups/$groupId/avatar',
      form,
    );
    return InternalGroup.fromJson(_map(json['group']));
  }

  Future<InternalGroup> uploadInternalGroupWallpaper(
    int groupId, {
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName,
        contentType: DioMediaType.parse(mimeType),
      ),
    });
    final json = await postFormData(
      '/api/internal-groups/$groupId/wallpaper',
      form,
    );
    return InternalGroup.fromJson(_map(json['group']));
  }

  Future<InternalGroup> removeInternalGroupWallpaper(int groupId) async {
    final json = await deleteJson('/api/internal-groups/$groupId/wallpaper');
    return InternalGroup.fromJson(_map(json['group']));
  }

  Future<InternalGroup> uploadInternalGroupBotAvatar(
    int groupId, {
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: fileName,
        contentType: DioMediaType.parse(mimeType),
      ),
    });
    final json = await postFormData(
      '/api/internal-groups/$groupId/bot-avatar',
      form,
    );
    return InternalGroup.fromJson(_map(json['group']));
  }

  Future<InternalGroup> removeInternalGroupBotAvatar(int groupId) async {
    final json = await deleteJson('/api/internal-groups/$groupId/bot-avatar');
    return InternalGroup.fromJson(_map(json['group']));
  }

  Future<Map<String, dynamic>> getJson(String path) async {
    var attempt = 0;
    while (true) {
      try {
        final response = await _requestJson(() => _dio.get<Object?>(path));
        return _decode(response);
      } on BotAdminApiException catch (error) {
        if (!_isTransientApiFailure(error) || attempt >= 2) rethrow;
        await Future<void>.delayed(Duration(milliseconds: 350 * (attempt + 1)));
        attempt += 1;
      } on TimeoutException {
        if (attempt >= 2) rethrow;
        await Future<void>.delayed(Duration(milliseconds: 350 * (attempt + 1)));
        attempt += 1;
      }
    }
  }

  Future<YoutubePreview?> resolveYoutubePreview(String rawQuery) {
    final query = rawQuery.trim();
    if (query.isEmpty) return Future<YoutubePreview?>.value();
    final cacheKey = query.toLowerCase();
    return _youtubePreviewCache.putIfAbsent(
      cacheKey,
      () => _loadYoutubePreview(query),
    );
  }

  Future<YoutubePreview?> _loadYoutubePreview(String query) async {
    var videoId = _youtubeVideoIdFromText(query);
    String? duration;

    try {
      final external = Dio(
        BaseOptions(
          connectTimeout: const Duration(seconds: 4),
          receiveTimeout: const Duration(seconds: 5),
          responseType: ResponseType.plain,
          headers: const {
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'User-Agent':
                'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 '
                'Chrome/126.0 Mobile Safari/537.36',
          },
          validateStatus: (status) => status != null && status < 500,
        ),
      );
      if (videoId == null) {
        final response = await external.get<String>(
          'https://www.youtube.com/results',
          queryParameters: {'search_query': query},
        );
        videoId = _youtubeVideoIdFromSearchHtml(response.data ?? '');
        if (videoId != null) {
          duration = _youtubeDurationFromSearchHtml(
            response.data ?? '',
            videoId,
          );
        }
      }
      if (videoId == null) return null;

      String? title;
      String? author;
      try {
        final response = await external.get<Object?>(
          'https://www.youtube.com/oembed',
          queryParameters: {
            'url': 'https://www.youtube.com/watch?v=$videoId',
            'format': 'json',
          },
          options: Options(responseType: ResponseType.json),
        );
        final metadata = response.data;
        if (metadata is Map) {
          title = metadata['title']?.toString().trim();
          author = metadata['author_name']?.toString().trim();
        }
      } catch (_) {
        // The image remains available if oEmbed metadata is temporarily down.
      }
      return YoutubePreview(
        videoId: videoId,
        thumbnailUrl: 'https://img.youtube.com/vi/$videoId/hqdefault.jpg',
        title: title?.isEmpty == true ? null : title,
        author: author?.isEmpty == true ? null : author,
        duration: duration,
      );
    } catch (_) {
      return null;
    }
  }

  Future<String?> resolveYoutubeThumbnail(String rawQuery) async =>
      (await resolveYoutubePreview(rawQuery))?.thumbnailUrl;

  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, Object?>? data,
  }) async {
    final response = await _requestJson(
      () => _dio.post<Object?>(path, data: data ?? const {}),
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, Object?>? data,
  }) async {
    final response = await _requestJson(
      () => _dio.patch<Object?>(path, data: data ?? const {}),
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    Map<String, Object?>? data,
  }) async {
    final response = await _requestJson(
      () => _dio.put<Object?>(path, data: data ?? const {}),
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> postFormData(String path, FormData data) async {
    final response = await _requestJson(
      () => _dio.post<Object?>(path, data: data),
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> putFormData(String path, FormData data) async {
    final response = await _requestJson(
      () => _dio.put<Object?>(path, data: data),
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> deleteJson(
    String path, {
    Map<String, Object?>? data,
  }) async {
    final response = await _requestJson(
      () => _dio.delete<Object?>(path, data: data),
    );
    return _decode(response);
  }

  Future<Response<Object?>> _requestJson(
    Future<Response<Object?>> Function() request,
  ) async {
    try {
      return await request();
    } on DioException catch (error) {
      throw BotAdminApiException(_friendlyNetworkMessage(error));
    }
  }

  String _friendlyNetworkMessage(DioException error) {
    final raw = [
      error.message,
      error.error?.toString(),
      error.response?.statusMessage,
    ].whereType<String>().join(' ').toLowerCase();
    if (raw.contains('failed host lookup') ||
        raw.contains('socketexception') ||
        raw.contains('no address associated') ||
        raw.contains('connection error')) {
      return 'Não consegui conectar ao BotAdmin agora. Verifique a internet e tente novamente.';
    }
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'A conexão demorou demais. Tente novamente em instantes.';
    }
    return 'Não foi possível conectar ao BotAdmin agora.';
  }

  Map<String, dynamic> _decode(Response<Object?> response) {
    final body = response.data;
    final json = _responseMap(body);
    if ((response.statusCode ?? 500) < 200 ||
        (response.statusCode ?? 500) >= 300) {
      final message = json['message']?.toString();
      throw BotAdminApiException(
        message?.isNotEmpty == true ? message! : 'Falha na API BotAdmin.',
        statusCode: response.statusCode,
      );
    }
    return json;
  }

  bool _isTransientApiFailure(BotAdminApiException error) {
    final status = error.statusCode;
    return status == null || status >= 500 || status == 408 || status == 429;
  }

  Map<String, dynamic> _responseMap(Object? body) {
    if (body is Map<String, dynamic>) return body;
    if (body is Map) return Map<String, dynamic>.from(body);
    if (body is String && body.trim().isNotEmpty) {
      try {
        final decoded = jsonDecode(body);
        if (decoded is Map) return Map<String, dynamic>.from(decoded);
      } catch (_) {
        return <String, dynamic>{};
      }
    }
    return <String, dynamic>{};
  }

  Future<void> _persistJsonSessionCookie(Map<String, dynamic> json) async {
    final cookie = json['sessionCookie']?.toString().trim();
    if (cookie == null || cookie.isEmpty) return;
    if (!cookie.startsWith('${AppConfig.sessionCookieName}=')) return;
    await _sessionStore.saveSessionCookie(cookie);
  }

  static String? _extractSessionCookie(List<String>? values) {
    return _extractCookie(values, AppConfig.sessionCookieName);
  }

  static String? _extractCookie(List<String>? values, String name) {
    if (values == null) return null;
    final prefix = '$name=';
    for (final raw in values) {
      for (final part in raw.split(';')) {
        final normalized = part.trim();
        if (normalized.startsWith(prefix)) return normalized;
      }
    }
    return null;
  }
}

List<Map<String, dynamic>> _list(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((item) => item.cast<String, dynamic>())
      .toList();
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return const {};
}

String? _callIdFromJson(Map<String, dynamic> json) {
  final direct = [json['callId'], json['CallID'], json['id'], json['ID']];
  for (final value in direct) {
    final text = value?.toString().trim() ?? '';
    if (text.isNotEmpty) return text;
  }
  for (final key in const ['call', 'data', 'result']) {
    final nested = _map(json[key]);
    final value = _callIdFromJson(nested);
    if (value != null) return value;
  }
  return null;
}

String _normalizeAffiliateProvider(String provider) {
  return provider == 'mercadolivre' ? 'mercadolivre' : 'shopee';
}

class DashboardSnapshot {
  const DashboardSnapshot({
    required this.instances,
    required this.groups,
    required this.threads,
  });

  final List<BotInstance> instances;
  final List<BotGroup> groups;
  final List<ConversationThread> threads;
}

Map<String, dynamic> _botInstanceCacheJson(BotInstance value) => {
  'id': value.id,
  'name': value.name,
  'sessionStatus': value.sessionStatus,
  if (value.phoneNumber != null) 'phoneNumber': value.phoneNumber,
  if (value.serverId != null) 'serverId': value.serverId,
  if (value.serverName != null) 'serverName': value.serverName,
  if (value.purpose != null) 'purpose': value.purpose,
  if (value.expiresAt != null) 'expiresAt': value.expiresAt!.toIso8601String(),
  if (value.planId != null) 'planId': value.planId,
  if (value.profileId != null) 'profileId': value.profileId,
  if (value.avatarUrl != null) 'avatarUrl': value.avatarUrl,
};

Map<String, dynamic> _botGroupCacheJson(BotGroup value) => {
  'id': value.id,
  'name': value.name,
  'remoteJid': value.remoteJid,
  'botEnabled': value.botEnabled,
  if (value.instanceId != null) 'instanceId': value.instanceId,
  if (value.inviteLink != null) 'inviteLink': value.inviteLink,
  if (value.description != null) 'description': value.description,
  if (value.avatarUrl != null) 'avatarUrl': value.avatarUrl,
};

Map<String, dynamic> _conversationThreadCacheJson(ConversationThread value) => {
  'instanceId': value.instanceId,
  'chatJid': value.chatJid,
  'title': value.title,
  'lastMessage': value.lastMessage,
  'lastActivityAt': value.lastActivity.toIso8601String(),
  'unreadCount': value.unreadCount,
  if (value.lastMessageDirection != null)
    'lastMessageDirection': value.lastMessageDirection,
  if (value.lastMessageSenderName != null)
    'lastMessageSenderName': value.lastMessageSenderName,
  if (value.phone != null) 'phone': value.phone,
  if (value.avatarUrl != null) 'avatarUrl': value.avatarUrl,
  if (value.chatType != null) 'chatType': value.chatType,
  if (value.groupDescription != null)
    'groupDescription': value.groupDescription,
  if (value.participantsCount != null)
    'participantsCount': value.participantsCount,
  if (value.linkedGroupId != null) 'linkedGroupId': value.linkedGroupId,
  if (value.internalBotGroupId != null)
    'internalBotGroupId': value.internalBotGroupId,
  if (value.internalBotEnabled != null)
    'internalBotEnabled': value.internalBotEnabled,
  if (value.internalGroupRole != null)
    'internalGroupRole': value.internalGroupRole,
  if (value.inviteLink != null) 'inviteLink': value.inviteLink,
  if (value.announceOnly != null) 'announceOnly': value.announceOnly,
  if (value.instanceIsAdmin != null) 'instanceIsAdmin': value.instanceIsAdmin,
  if (value.mentionable != null) 'mentionable': value.mentionable,
  if (value.canSendMessages != null) 'canSendMessages': value.canSendMessages,
  if (value.readOnlyReason != null) 'readOnlyReason': value.readOnlyReason,
  if (value.channelRole != null) 'channelRole': value.channelRole,
  if (value.supportRole != null) 'supportRole': value.supportRole,
  'archived': value.archived,
  'pinned': value.pinned,
  'muted': value.muted,
};

class MediaBytes {
  const MediaBytes({required this.bytes, required this.mimeType});

  final Uint8List bytes;
  final String mimeType;
}
