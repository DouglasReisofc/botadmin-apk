import 'package:flutter/foundation.dart';

class AppConfig {
  static const _configuredApiBaseUrl = String.fromEnvironment(
    'BOTADMIN_API_BASE_URL',
    defaultValue: '',
  );

  static final apiBaseUrl = _configuredApiBaseUrl.trim().isNotEmpty
      ? _configuredApiBaseUrl.trim()
      : kIsWeb
      ? Uri.base.origin
      : 'https://botadmin.shop';

  static const mobileUpdateGithubLatestUrl = String.fromEnvironment(
    'BOTADMIN_APK_GITHUB_LATEST_URL',
    defaultValue:
        'https://api.github.com/repos/DouglasReisofc/botadmin-apk/releases/latest',
  );

  static const sessionCookieName = 'sb_session';

  /// Produces a shareable invite URL even when an old cache/API payload still
  /// contains a development origin, with or without an http scheme.
  static String publicInviteUrl(String raw) {
    final value = raw.trim();
    if (value.isEmpty) return value;
    final parsed = Uri.tryParse(value);
    final host = parsed?.host.toLowerCase();
    final isLocal = host == 'localhost' ||
        host == '127.0.0.1' ||
        host == '0.0.0.0' ||
        host == '::1';
    if (parsed != null &&
        (parsed.scheme == 'http' || parsed.scheme == 'https') &&
        parsed.host.isNotEmpty &&
        !isLocal) {
      return parsed.toString();
    }
    var base = Uri.tryParse(kIsWeb ? Uri.base.origin : apiBaseUrl);
    final baseHost = base?.host.toLowerCase();
    if (base == null ||
        baseHost == 'localhost' ||
        baseHost == '127.0.0.1' ||
        baseHost == '0.0.0.0' ||
        baseHost == '::1') {
      base = Uri.parse('https://botadmin.shop');
    }
    final relative = value.replaceFirst(
      RegExp(
        r'^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?',
        caseSensitive: false,
      ),
      '',
    );
    final path = relative.startsWith('/') ? relative : '/$relative';
    return base.resolve(path).toString();
  }
}
