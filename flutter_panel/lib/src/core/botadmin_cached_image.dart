import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'app_config.dart';
import 'session_store.dart';

typedef BotAdminImagePlaceholder =
    Widget Function(BuildContext context, String url);
typedef BotAdminImageErrorWidget =
    Widget Function(BuildContext context, String url, Object error);

/// Session-aware image cache used by the web panel and native applications.
///
/// Protected BotAdmin URLs receive the current session cookie on native
/// platforms and a cache key scoped to the active session. A failed protected
/// image is evicted and retried once against the refresh/force endpoint, so a
/// stale 401 or invalid avatar never poisons the disk cache.
class BotAdminCachedImage extends ConsumerStatefulWidget {
  const BotAdminCachedImage({
    super.key,
    required this.imageUrl,
    this.cacheKey,
    this.httpHeaders,
    this.placeholder,
    this.errorWidget,
    this.errorListener,
    this.width,
    this.height,
    this.fit,
    this.alignment = Alignment.center,
    this.repeat = ImageRepeat.noRepeat,
    this.matchTextDirection = false,
    this.useOldImageOnUrlChange = false,
    this.color,
    this.colorBlendMode,
    this.filterQuality = FilterQuality.low,
    this.fadeInDuration = const Duration(milliseconds: 100),
    this.fadeOutDuration = const Duration(milliseconds: 100),
    this.placeholderFadeInDuration,
    this.memCacheWidth,
    this.memCacheHeight,
    this.maxWidthDiskCache,
    this.maxHeightDiskCache,
  });

  final String imageUrl;
  final String? cacheKey;
  final Map<String, String>? httpHeaders;
  final BotAdminImagePlaceholder? placeholder;
  final BotAdminImageErrorWidget? errorWidget;
  final ValueChanged<Object>? errorListener;
  final double? width;
  final double? height;
  final BoxFit? fit;
  final Alignment alignment;
  final ImageRepeat repeat;
  final bool matchTextDirection;
  final bool useOldImageOnUrlChange;
  final Color? color;
  final BlendMode? colorBlendMode;
  final FilterQuality filterQuality;
  final Duration fadeInDuration;
  final Duration? fadeOutDuration;
  final Duration? placeholderFadeInDuration;
  final int? memCacheWidth;
  final int? memCacheHeight;
  final int? maxWidthDiskCache;
  final int? maxHeightDiskCache;

  @override
  ConsumerState<BotAdminCachedImage> createState() =>
      _BotAdminCachedImageState();
}

class _BotAdminCachedImageState extends ConsumerState<BotAdminCachedImage> {
  Map<String, String>? _headers;
  String _effectiveUrl = '';
  String _effectiveCacheKey = '';
  bool _ready = false;
  bool _retryScheduled = false;
  int _retryAttempt = 0;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    BotAdminSessionStore.sessionRevision.addListener(_onSessionChanged);
    _reload();
  }

  @override
  void didUpdateWidget(covariant BotAdminCachedImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imageUrl != widget.imageUrl ||
        oldWidget.cacheKey != widget.cacheKey ||
        !mapEquals(oldWidget.httpHeaders, widget.httpHeaders)) {
      _retryAttempt = 0;
      _retryScheduled = false;
      _reload();
    }
  }

  @override
  void dispose() {
    BotAdminSessionStore.sessionRevision.removeListener(_onSessionChanged);
    super.dispose();
  }

  void _onSessionChanged() {
    _retryAttempt = 0;
    _retryScheduled = false;
    _reload();
  }

  Future<void> _reload() async {
    final generation = ++_loadGeneration;
    // APIs return protected media as root-relative paths. Browsers resolve
    // those paths automatically, but Android image providers require an
    // absolute URI; leaving `/api/...` untouched made wallpapers and some
    // avatars silently fall back to their placeholder in the APK.
    final sourceUrl = _absoluteBotAdminImageUrl(widget.imageUrl.trim());
    final effectiveUrl = _retryUrl(sourceUrl, _retryAttempt);
    final protected = isBotAdminProtectedImageUrl(effectiveUrl);
    if (mounted) {
      setState(() {
        _ready = !protected || kIsWeb;
        _effectiveUrl = effectiveUrl;
      });
    }

    String? cookie;
    if (protected && !kIsWeb) {
      cookie = await ref.read(sessionStoreProvider).readSessionCookie();
    }
    if (!mounted || generation != _loadGeneration) return;

    final headers = <String, String>{...?widget.httpHeaders};
    if (protected && !kIsWeb && cookie != null && cookie.trim().isNotEmpty) {
      headers['Cookie'] = cookie.trim();
    }
    final scopedCacheKey = botAdminImageCacheKey(
      sourceUrl,
      cookie: cookie,
      baseCacheKey: widget.cacheKey,
    );

    setState(() {
      _headers = headers.isEmpty ? null : headers;
      _effectiveCacheKey = scopedCacheKey;
      _ready = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final url = _effectiveUrl.isEmpty ? widget.imageUrl : _effectiveUrl;
    if (!_ready) {
      return widget.placeholder?.call(context, url) ??
          SizedBox(width: widget.width, height: widget.height);
    }

    final protected = isBotAdminProtectedImageUrl(url);
    return CachedNetworkImage(
      key: ValueKey<String>('$_effectiveCacheKey|$url'),
      imageUrl: url,
      cacheKey: _effectiveCacheKey,
      httpHeaders: _headers,
      width: widget.width,
      height: widget.height,
      fit: widget.fit,
      alignment: widget.alignment,
      repeat: widget.repeat,
      matchTextDirection: widget.matchTextDirection,
      useOldImageOnUrlChange: widget.useOldImageOnUrlChange && !protected,
      color: widget.color,
      colorBlendMode: widget.colorBlendMode,
      filterQuality: widget.filterQuality,
      fadeInDuration: widget.fadeInDuration,
      fadeOutDuration: widget.fadeOutDuration,
      placeholderFadeInDuration: widget.placeholderFadeInDuration,
      memCacheWidth: widget.memCacheWidth,
      memCacheHeight: widget.memCacheHeight,
      maxWidthDiskCache: widget.maxWidthDiskCache,
      maxHeightDiskCache: widget.maxHeightDiskCache,
      placeholder: widget.placeholder,
      errorListener: widget.errorListener,
      errorWidget: (context, failedUrl, error) {
        if (protected && _retryAttempt == 0 && !_retryScheduled) {
          _retryScheduled = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            unawaited(_evictAndRetry());
          });
        }
        return widget.errorWidget?.call(context, failedUrl, error) ??
            SizedBox(width: widget.width, height: widget.height);
      },
    );
  }

  Future<void> _evictAndRetry() async {
    final url = _effectiveUrl;
    final cacheKey = _effectiveCacheKey;
    try {
      await CachedNetworkImage.evictFromCache(url, cacheKey: cacheKey);
      await CachedNetworkImageProvider(
        url,
        cacheKey: cacheKey,
        headers: _headers,
      ).evict();
    } catch (_) {
      // A retry still helps when only one of the cache layers was available.
    }
    if (!mounted || _retryAttempt != 0) return;
    _retryAttempt = 1;
    _retryScheduled = false;
    await _reload();
  }
}

String _absoluteBotAdminImageUrl(String value) {
  final raw = value.trim();
  if (!raw.startsWith('/')) return raw;
  final base = Uri.tryParse(AppConfig.apiBaseUrl);
  if (base == null || base.host.isEmpty) return raw;
  return base.resolve(raw).toString();
}

bool isBotAdminProtectedImageUrl(String value) {
  final raw = value.trim();
  if (raw.isEmpty || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return false;
  }
  if (raw.startsWith('/')) return true;
  final parsed = Uri.tryParse(raw);
  final api = Uri.tryParse(AppConfig.apiBaseUrl);
  if (parsed == null || api == null || parsed.host.isEmpty) return false;
  return parsed.host.toLowerCase() == api.host.toLowerCase() &&
      (parsed.scheme == api.scheme || parsed.scheme.isEmpty);
}

String _retryUrl(String raw, int attempt) {
  if (attempt <= 0 || !isBotAdminProtectedImageUrl(raw)) return raw;
  final uri = Uri.tryParse(raw);
  if (uri == null) return raw;
  final query = <String, String>{...uri.queryParameters};
  if (uri.path.endsWith('/avatar')) query['force'] = '1';
  query['_botadmin_media_retry'] = attempt.toString();
  return uri.replace(queryParameters: query).toString();
}

String botAdminImageCacheKey(
  String url, {
  String? cookie,
  String? baseCacheKey,
}) {
  final base = baseCacheKey?.trim().isNotEmpty == true
      ? baseCacheKey!.trim()
      : url.trim();
  if (!isBotAdminProtectedImageUrl(url)) return base;
  final revision = BotAdminSessionStore.sessionRevision.value;
  return '$base|session:$revision:${_botAdminCookieFingerprint(cookie ?? '')}';
}

String _botAdminCookieFingerprint(String value) {
  var hash = 0x811c9dc5;
  for (final unit in value.codeUnits) {
    hash ^= unit;
    hash = (hash * 0x01000193) & 0xffffffff;
  }
  return hash.toRadixString(16).padLeft(8, '0');
}
