import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:typed_data';

import '../../core/api_client.dart';
import '../../core/conversation_cache.dart';
import '../../core/native_push_registration.dart';
import '../../models/session_user.dart';
import '../dashboard/dashboard_controller.dart';

final authControllerProvider =
    AsyncNotifierProvider<AuthController, AuthSession?>(AuthController.new);

class AuthController extends AsyncNotifier<AuthSession?> {
  @override
  Future<AuthSession?> build() async {
    final api = ref.watch(apiClientProvider);
    final cachedUser = await api.readCachedSessionUser();
    if (cachedUser != null) {
      // The cached identity keeps a refresh responsive while the API session
      // is checked in the background. A transient network failure must not
      // turn a valid panel into a blank login state.
      unawaited(_revalidateCachedSession(api, cachedUser.id));
      return AuthSession(user: cachedUser);
    }

    return api.restoreSession();
  }

  Future<void> _revalidateCachedSession(
    BotAdminApiClient api,
    int cachedUserId,
  ) async {
    try {
      final fresh = await api.restoreSession(fallbackToCached: false);
      if (!ref.mounted ||
          state.value?.user.id != cachedUserId ||
          fresh == null) {
        return;
      }
      state = AsyncData(fresh);
    } on BotAdminApiException catch (error) {
      if (!ref.mounted || state.value?.user.id != cachedUserId) return;
      if (error.statusCode == 401) {
        state = const AsyncData(null);
      }
    } catch (_) {
      // Keep the cached panel visible when the validation request is transient.
    }
  }

  Future<void> login(
    String identifier,
    String password, {
    bool remember = true,
  }) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref
          .read(apiClientProvider)
          .login(
            identifier: identifier,
            password: password,
            remember: remember,
          ),
    );
    _invalidateUserScopedData();
  }

  void setSession(AuthSession session) {
    _invalidateUserScopedData();
    state = AsyncData(session);
  }

  Future<void> logout() async {
    await ref.read(apiClientProvider).logout();
    await NativePushRegistration.stopNativeRealtimeNotifications();
    _invalidateUserScopedData();
    state = const AsyncData(null);
  }

  void _invalidateUserScopedData() {
    ref.invalidate(conversationCacheProvider);
    ref.invalidate(dashboardSnapshotProvider);
    ref.invalidate(instanceContactsProvider);
  }

  Future<void> updateProfile({
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
    final current = state.value;
    final updated = await ref
        .read(apiClientProvider)
        .updateUserProfile(
          name: name,
          email: email,
          password: password,
          whatsappDialCode: whatsappDialCode,
          whatsappNumber: whatsappNumber,
          avatarBytes: avatarBytes,
          avatarFileName: avatarFileName,
          avatarMimeType: avatarMimeType,
          removeAvatar: removeAvatar,
        );
    // O endpoint de perfil retorna os dados básicos do usuário; preserve o
    // papel de parceiro que vem da sessão para não trocar o shell após salvar
    // uma edição de perfil.
    final currentPartnerRole = current?.user.partnerRole;
    final user = (updated.partnerRole == null && currentPartnerRole != null)
        ? SessionUser(
            id: updated.id,
            name: updated.name,
            role: updated.role,
            email: updated.email,
            whatsappNumber: updated.whatsappNumber,
            avatarUrl: updated.avatarUrl,
            partnerRole: currentPartnerRole,
            impersonatorUserId: updated.impersonatorUserId,
            canReturnToAdmin: updated.canReturnToAdmin,
          )
        : updated;
    state = AsyncData(AuthSession(user: user));
    if (current == null) {
      ref.invalidateSelf();
    }
  }
}
