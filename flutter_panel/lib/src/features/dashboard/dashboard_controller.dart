import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../models/whatsapp_contact.dart';

final dashboardSnapshotProvider = FutureProvider.autoDispose<DashboardSnapshot>(
  (ref) async {
    // Keep list data warm while navigating sections so returning to chats
    // does not refetch and hitch the scroll/UI.
    ref.keepAlive();
    final api = ref.watch(apiClientProvider);
    Object? lastError;

    // A temporary API timeout must not turn the whole conversation panel into
    // an empty/error state. Give the backend a short recovery window before
    // exposing the error to the UI; loadDashboardSnapshot also serves its
    // in-memory snapshot when one is already available.
    for (var attempt = 0; attempt < 4; attempt++) {
      try {
        return await api.loadDashboardSnapshot();
      } catch (error) {
        lastError = error;
        final isAuthError =
            error is BotAdminApiException &&
            (error.statusCode == 401 ||
                error.statusCode == 403 ||
                error.statusCode == 404);
        if (isAuthError || attempt == 3) rethrow;
        await Future<void>.delayed(Duration(milliseconds: 500 * (attempt + 1)));
      }
    }

    throw lastError ?? StateError('Não foi possível carregar o painel.');
  },
);

final instanceContactsProvider = FutureProvider.autoDispose
    .family<List<WhatsAppContact>, int>((ref, id) {
      ref.keepAlive();
      return ref.watch(apiClientProvider).loadInstanceContacts(id);
    });
