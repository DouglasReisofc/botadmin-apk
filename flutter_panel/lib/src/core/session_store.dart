import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/session_user.dart';

class BotAdminSessionStore {
  BotAdminSessionStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _cookieKey = 'botadmin.session_cookie';
  static const _userKey = 'botadmin.session_user';
  static const _selectedProfilePrefix = 'botadmin.selected_profile.';
  static const _statusDraftPrefix = 'botadmin.status_draft.';
  static const _pendingGroupInviteKey = 'botadmin.pending_group_invite';
  static String? _memoryCookie;
  static final Map<int, int> _memorySelectedProfiles = <int, int>{};
  static final Map<String, Map<String, dynamic>> _memoryStatusDrafts =
      <String, Map<String, dynamic>>{};
  static final ValueNotifier<int> sessionRevision = ValueNotifier<int>(0);
  static String? _memoryPendingGroupInvite;
  final FlutterSecureStorage _storage;

  Future<String?> readSessionCookie() async {
    try {
      final stored = await _storage.read(key: _cookieKey);
      if (stored != null && stored.isNotEmpty) {
        _memoryCookie = stored;
      }
      return stored ?? _memoryCookie;
    } catch (_) {
      return _memoryCookie;
    }
  }

  Future<void> saveSessionCookie(String cookie) async {
    final changed = _memoryCookie != cookie;
    _memoryCookie = cookie;
    try {
      await _storage.write(key: _cookieKey, value: cookie);
    } catch (_) {}
    if (changed) sessionRevision.value++;
  }

  Future<void> saveCachedUser(SessionUser user) async {
    try {
      await _storage.write(key: _userKey, value: jsonEncode(user.toJson()));
    } catch (_) {}
  }

  Future<SessionUser?> readCachedUser() async {
    try {
      final raw = await _storage.read(key: _userKey);
      if (raw == null || raw.trim().isEmpty) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      return SessionUser.fromJson(decoded.cast<String, dynamic>());
    } catch (_) {
      return null;
    }
  }

  Future<int?> readSelectedProfileId(int userId) async {
    if (userId <= 0) return null;
    try {
      final raw = await _storage.read(key: '$_selectedProfilePrefix$userId');
      final parsed = int.tryParse(raw ?? '');
      if (parsed != null && parsed > 0) {
        _memorySelectedProfiles[userId] = parsed;
        return parsed;
      }
    } catch (_) {}
    return _memorySelectedProfiles[userId];
  }

  Future<void> saveSelectedProfileId(int userId, int? profileId) async {
    if (userId <= 0) return;
    final key = '$_selectedProfilePrefix$userId';
    if (profileId == null || profileId <= 0) {
      _memorySelectedProfiles.remove(userId);
      try {
        await _storage.delete(key: key);
      } catch (_) {}
      return;
    }
    _memorySelectedProfiles[userId] = profileId;
    try {
      await _storage.write(key: key, value: profileId.toString());
    } catch (_) {}
  }

  Future<Map<String, dynamic>?> readStatusDraft(String draftKey) async {
    if (draftKey.trim().isEmpty) return null;
    try {
      final raw = await _storage.read(key: '$_statusDraftPrefix$draftKey');
      if (raw != null && raw.trim().isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          final draft = Map<String, dynamic>.from(decoded);
          _memoryStatusDrafts[draftKey] = draft;
          return draft;
        }
      }
    } catch (_) {}
    return _memoryStatusDrafts[draftKey];
  }

  Future<void> saveStatusDraft(
    String draftKey,
    Map<String, dynamic> draft,
  ) async {
    if (draftKey.trim().isEmpty) return;
    final snapshot = Map<String, dynamic>.from(draft);
    _memoryStatusDrafts[draftKey] = snapshot;
    try {
      await _storage.write(
        key: '$_statusDraftPrefix$draftKey',
        value: jsonEncode(snapshot),
      );
    } catch (_) {}
  }

  Future<void> clearStatusDraft(String? draftKey) async {
    if (draftKey == null || draftKey.trim().isEmpty) return;
    _memoryStatusDrafts.remove(draftKey);
    try {
      await _storage.delete(key: '$_statusDraftPrefix$draftKey');
    } catch (_) {}
  }

  Future<void> savePendingGroupInvite(String token) async {
    final normalized = token.trim();
    if (normalized.isEmpty) return;
    _memoryPendingGroupInvite = normalized;
    final value = jsonEncode({
      'token': normalized,
      'expiresAt': DateTime.now()
          .toUtc()
          .add(const Duration(hours: 24))
          .toIso8601String(),
    });
    try {
      await _storage.write(key: _pendingGroupInviteKey, value: value);
    } catch (_) {}
  }

  Future<String?> readPendingGroupInvite() async {
    try {
      final raw = await _storage.read(key: _pendingGroupInviteKey);
      if (raw == null || raw.trim().isEmpty) return _memoryPendingGroupInvite;
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      final token = decoded['token']?.toString().trim() ?? '';
      final expiresAt = DateTime.tryParse(
        decoded['expiresAt']?.toString() ?? '',
      );
      if (token.isEmpty ||
          expiresAt == null ||
          !expiresAt.toUtc().isAfter(DateTime.now().toUtc())) {
        await clearPendingGroupInvite();
        return null;
      }
      _memoryPendingGroupInvite = token;
      return token;
    } catch (_) {
      return _memoryPendingGroupInvite;
    }
  }

  Future<void> clearPendingGroupInvite() async {
    _memoryPendingGroupInvite = null;
    try {
      await _storage.delete(key: _pendingGroupInviteKey);
    } catch (_) {}
  }

  Future<void> clear() async {
    _memoryCookie = null;
    try {
      await _storage.delete(key: _cookieKey);
      await _storage.delete(key: _userKey);
    } catch (_) {}
    sessionRevision.value++;
  }
}
