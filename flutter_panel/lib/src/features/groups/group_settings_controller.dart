import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../models/bot_group_settings.dart';

final groupSettingsProvider = FutureProvider.autoDispose
    .family<BotGroupSettingsBundle, int>((ref, groupId) {
      return ref.watch(apiClientProvider).loadGroupSettings(groupId);
    });
