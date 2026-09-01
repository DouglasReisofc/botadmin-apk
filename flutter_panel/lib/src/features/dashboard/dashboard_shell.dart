import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../core/api_client.dart';
import '../../core/app_ready.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/browser_notifications.dart';
import '../../core/conversation_cache.dart';
import '../../core/native_push_registration.dart';
import '../../core/notification_allow_button.dart';
import '../../core/theme_controller.dart';
import '../../core/theme_storage.dart';
import '../../core/top_toast.dart';
import '../../core/wa_theme.dart';
import '../../core/whatsapp_realtime_client.dart';
import '../../models/bot_group.dart';
import '../../models/bot_instance.dart';
import '../../models/chat_message.dart';
import '../../models/conversation_thread.dart';
import '../../models/migration_models.dart';
import '../../models/whatsapp_contact.dart';
import '../auth/auth_controller.dart';
import '../chat/chat_screen.dart';
import '../chat/media_players.dart';
import '../groups/group_settings_screen.dart';
import '../support/user_support_chat_screen.dart';
import 'dashboard_controller.dart';
import 'broadcast_panel.dart';
import 'flows_panel.dart';
import 'internal_groups_panel.dart';
import 'migration_panels.dart';
import 'profiles_panel.dart';

enum DashboardSection {
  conversations,
  internalGroups,
  broadcasts,
  profiles,
  status,
  media,
  channels,
  communities,
  calls,
  groups,
  tools,
  raffles,
  store,
  campaigns,
  affiliates,
  payments,
  apiRest,
  webhooks,
  settings,
}

enum ConversationUtilityPanel {
  none,
  newChat,
  favoriteMessages,
  selectConversations,
  lists,
  disconnect,
}

enum ConversationListFilter {
  all,
  unread,
  privateChats,
  groups,
  internalGroups,
  channels,
  communities,
}

final dashboardSectionProvider =
    NotifierProvider<DashboardSectionController, DashboardSection>(
      DashboardSectionController.new,
    );

final partnerWorkspaceSectionProvider =
    NotifierProvider<
      PartnerWorkspaceSectionController,
      PartnerWorkspaceSection
    >(PartnerWorkspaceSectionController.new);

class PartnerWorkspaceSectionController
    extends Notifier<PartnerWorkspaceSection> {
  @override
  PartnerWorkspaceSection build() => PartnerWorkspaceSection.overview;

  void select(PartnerWorkspaceSection section) => state = section;
}

final conversationUtilityPanelProvider =
    NotifierProvider<
      ConversationUtilityPanelController,
      ConversationUtilityPanel
    >(ConversationUtilityPanelController.new);

final selectedThreadProvider =
    NotifierProvider<SelectedThreadController, ConversationThread?>(
      SelectedThreadController.new,
    );

final selectedGroupProvider =
    NotifierProvider<SelectedGroupController, BotGroup?>(
      SelectedGroupController.new,
    );

final selectedInstanceIdProvider =
    NotifierProvider<SelectedInstanceIdController, int?>(
      SelectedInstanceIdController.new,
    );

final conversationSearchProvider =
    NotifierProvider<SearchQueryController, String>(SearchQueryController.new);

final newConversationSearchProvider =
    NotifierProvider<SearchQueryController, String>(SearchQueryController.new);

final conversationListFilterProvider =
    NotifierProvider<ConversationListFilterController, ConversationListFilter>(
      ConversationListFilterController.new,
    );

final readConversationKeysProvider =
    NotifierProvider<ReadConversationKeysController, Set<String>>(
      ReadConversationKeysController.new,
    );

final groupSearchProvider = NotifierProvider<SearchQueryController, String>(
  SearchQueryController.new,
);

final instanceProfileAvatarBytesProvider = FutureProvider.autoDispose
    .family<MediaBytes?, int>((ref, instanceId) async {
      try {
        return await ref
            .watch(apiClientProvider)
            .downloadMediaBytes(_instanceProfileAvatarUrl(instanceId));
      } catch (_) {
        return null;
      }
    });

int? _profileOnboardingPromptShownForUser;
final Set<int> _profileOnboardingPromptScheduledForUser = <int>{};
final Set<String> _profileExpiryPromptKeys = <String>{};
final Set<String> _profileExpiryPromptScheduledKeys = <String>{};
final Set<int> _avatarSyncInFlight = <int>{};
final Map<int, DateTime> _avatarSyncLastAttempt = <int, DateTime>{};

Future<void> _syncGroupAvatarAfterError(WidgetRef ref, BotGroup group) async {
  final currentUrl = group.avatarUrl?.trim();
  if (group.id <= 0 || currentUrl == null || currentUrl.isEmpty) return;
  if (_avatarSyncInFlight.contains(group.id)) return;
  final lastAttempt = _avatarSyncLastAttempt[group.id];
  if (lastAttempt != null &&
      DateTime.now().difference(lastAttempt) < const Duration(minutes: 2)) {
    return;
  }
  _avatarSyncLastAttempt[group.id] = DateTime.now();
  _avatarSyncInFlight.add(group.id);
  try {
    await ref
        .read(apiClientProvider)
        .syncGroupInfo(group.id, force: true, reason: 'image');
  } catch (_) {
    // Keep the fallback avatar when WhatsApp keeps rejecting the picture URL.
  } finally {
    _avatarSyncInFlight.remove(group.id);
  }
}

class DashboardSectionController extends Notifier<DashboardSection> {
  final List<DashboardSection> _history = <DashboardSection>[];

  @override
  DashboardSection build() {
    final requested = Uri.base.queryParameters['section']?.trim();
    final partnerRole = ref
        .watch(authControllerProvider)
        .value
        ?.user
        .partnerRole;
    if ((partnerRole ?? '').isNotEmpty) {
      return DashboardSection.affiliates;
    }
    if (requested != null) {
      for (final section in DashboardSection.values) {
        if (section.name == requested) return section;
      }
    }
    return DashboardSection.conversations;
  }

  void select(DashboardSection section, {bool recordHistory = true}) {
    final partnerRole = ref
        .read(authControllerProvider)
        .value
        ?.user
        .partnerRole;
    if ((partnerRole ?? '').isNotEmpty &&
        section != DashboardSection.affiliates) {
      section = DashboardSection.affiliates;
    }
    ref
        .read(conversationUtilityPanelProvider.notifier)
        .show(ConversationUtilityPanel.none);
    if (state == section) return;
    if (recordHistory) {
      _history.add(state);
    }
    state = section;
  }

  bool selectPrevious() {
    ref
        .read(conversationUtilityPanelProvider.notifier)
        .show(ConversationUtilityPanel.none);
    while (_history.isNotEmpty) {
      final previous = _history.removeLast();
      if (previous == state) continue;
      state = previous;
      return true;
    }
    return false;
  }
}

class ConversationUtilityPanelController
    extends Notifier<ConversationUtilityPanel> {
  @override
  ConversationUtilityPanel build() => ConversationUtilityPanel.none;

  void show(ConversationUtilityPanel panel) {
    state = panel;
  }
}

class SelectedThreadController extends Notifier<ConversationThread?> {
  @override
  ConversationThread? build() => null;

  void select(ConversationThread? thread) {
    state = thread;
  }
}

class SelectedGroupController extends Notifier<BotGroup?> {
  @override
  BotGroup? build() => null;

  void select(BotGroup? group) {
    state = group;
  }
}

class SelectedInstanceIdController extends Notifier<int?> {
  int? _restoredUserId;
  int _revision = 0;

  @override
  int? build() => null;

  Future<void> restoreForUser(int userId, Iterable<int> validIds) async {
    if (userId <= 0 || _restoredUserId == userId) return;
    _restoredUserId = userId;
    final revision = _revision;
    final stored = await ref
        .read(sessionStoreProvider)
        .readSelectedProfileId(userId);
    if (_restoredUserId != userId || revision != _revision) return;
    if (stored != null && validIds.contains(stored)) {
      state = stored;
    }
  }

  void select(int? instanceId) {
    if (state == instanceId) return;
    _revision++;
    ref.read(selectedThreadProvider.notifier).select(null);
    ref.read(selectedGroupProvider.notifier).select(null);
    ref
        .read(conversationUtilityPanelProvider.notifier)
        .show(ConversationUtilityPanel.none);
    state = instanceId;
    final userId = ref.read(authControllerProvider).value?.user.id;
    if (userId != null) {
      unawaited(
        ref
            .read(sessionStoreProvider)
            .saveSelectedProfileId(userId, instanceId),
      );
    }
  }
}

class SearchQueryController extends Notifier<String> {
  @override
  String build() => '';

  void setQuery(String value) {
    state = value;
  }

  void clear() {
    state = '';
  }
}

class ConversationListFilterController
    extends Notifier<ConversationListFilter> {
  @override
  ConversationListFilter build() => ConversationListFilter.all;

  void select(ConversationListFilter filter) {
    state = filter;
  }
}

class ReadConversationKeysController extends Notifier<Set<String>> {
  @override
  Set<String> build() => <String>{};

  void markRead(ConversationThread thread) {
    markReadKey(_conversationThreadKey(thread));
  }

  void markReadKey(String? key) {
    if (key == null || key.isEmpty) return;
    if (state.contains(key)) return;
    state = <String>{...state, key};
  }

  void clear(ConversationThread thread) {
    clearKey(_conversationThreadKey(thread));
  }

  void clearKey(String? key) {
    if (key == null || !state.contains(key)) return;
    final next = <String>{...state}..remove(key);
    state = next;
  }
}

class DashboardShell extends ConsumerWidget {
  const DashboardShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshotState = ref.watch(dashboardSnapshotProvider);
    final cachedSnapshot = ref.read(apiClientProvider).lastDashboardSnapshot;
    final snapshot = snapshotState.hasError && cachedSnapshot != null
        ? AsyncValue<DashboardSnapshot>.data(cachedSnapshot)
        : snapshotState;
    final session = ref.watch(authControllerProvider).value;
    // Rebuild shell when theme flips so all WaTheme surfaces update.
    ref.watch(themeControllerProvider);
    final wa = WaTheme.of(context);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _handleDashboardBack(context, ref);
      },
      child: Scaffold(
        backgroundColor: snapshot.isLoading ? wa.panel : wa.shellBg,
        body: SafeArea(
          child: ColoredBox(
            color: snapshot.isLoading ? wa.panel : wa.shellBg,
            child: snapshot.when(
              data: (data) {
                // UI útil pronta — libera o preloader HTML.
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  signalAppReady();
                  unawaited(
                    NativePushRegistration.ensureRegistered(
                      ref.read(apiClientProvider),
                    ),
                  );
                });
                // Perfil é opcional até o usuário decidir conectar o WhatsApp.
                // Não interrompa a navegação com onboarding automático; a ação
                // manual continua disponível na aba Perfis.
                final sessionUserId = session?.user.id;
                if (sessionUserId != null) {
                  unawaited(
                    ref
                        .read(selectedInstanceIdProvider.notifier)
                        .restoreForUser(
                          sessionUserId,
                          data.instances.map((instance) => instance.id),
                        ),
                  );
                }
                // Section changes rebuild shell; selection does NOT — keeps the
                // conversation list scroll subtree stable (WhatsApp-like).
                final section = ref.watch(dashboardSectionProvider);
                final selectedInstanceId = ref.watch(
                  selectedInstanceIdProvider,
                );
                final activeInstance = _resolveActiveInstance(
                  data.instances,
                  selectedInstanceId,
                );
                _scheduleProfileExpiryPrompt(
                  context,
                  ref,
                  activeInstance,
                  session?.user.id,
                );
                final scopedData = _scopeSnapshotForInstance(
                  data,
                  activeInstance?.id,
                );
                return LiveCallsOverlayHost(
                  instances: data.instances,
                  child: _ConversationListRealtimeHost(
                    instanceId: activeInstance?.id,
                    child: _DashboardWarmHost(
                      data: scopedData,
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          final compact = constraints.maxWidth < 860;
                          if (compact) {
                            return _MobileShell(
                              data: scopedData,
                              section: section,
                            );
                          }
                          // Chamadas (e painéis full-bleed) usam a área toda
                          // sem a coluna lateral de “Perfis/Status/Canais…”.
                          final fullBleedContent =
                              section == DashboardSection.calls ||
                              section == DashboardSection.status ||
                              section == DashboardSection.media ||
                              section == DashboardSection.broadcasts ||
                              section == DashboardSection.tools || // fluxos
                              section == DashboardSection.raffles ||
                              section == DashboardSection.store ||
                              section == DashboardSection.campaigns ||
                              section == DashboardSection.affiliates ||
                              section == DashboardSection.payments ||
                              section == DashboardSection.apiRest;
                          return Row(
                            children: [
                              _MainRail(
                                userName: session?.user.name ?? 'BotAdmin',
                                partnerRole: session?.user.partnerRole,
                                section: section,
                                unreadCount:
                                    _safeConversationThreads(
                                      scopedData.threads,
                                    ).fold<int>(
                                      0,
                                      (total, thread) =>
                                          total + thread.unreadCount,
                                    ),
                                instances: data.instances,
                                activeInstance: activeInstance,
                              ),
                              Expanded(
                                child: fullBleedContent
                                    ? _DesktopContentHost(data: scopedData)
                                    : _DesktopResizablePanes(data: scopedData),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                  ),
                );
              },
              error: (error, _) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  signalAppReady();
                });
                return _SilentDashboardReconnect(isDark: wa.isDark);
              },
              // Disk restore is intentionally tiny; keep the WhatsApp-like
              // shell visible while it completes instead of showing a
              // blocking "Carregando painel" card.
              loading: () => kIsWeb
                  ? _DashboardLoadingState(isDark: wa.isDark)
                  : _DashboardWarmLoadingState(isDark: wa.isDark),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shell visualmente alinhado ao painel do usuário, porém com navegação e
/// páginas próprias do programa de parceiros. Não carrega o snapshot de
/// instâncias/WhatsApp e, portanto, nunca dispara o prompt de “criar perfil”.
class PartnerDashboardShell extends ConsumerWidget {
  const PartnerDashboardShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      signalAppReady();
    });
    final section = ref.watch(partnerWorkspaceSectionProvider);
    final oauthReturn = Uri.base.queryParameters['partner_section'];
    if (oauthReturn == 'payments' &&
        section != PartnerWorkspaceSection.payments) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (ref.read(partnerWorkspaceSectionProvider) !=
            PartnerWorkspaceSection.payments) {
          ref
              .read(partnerWorkspaceSectionProvider.notifier)
              .select(PartnerWorkspaceSection.payments);
        }
      });
    }
    final reseller = ref.watch(resellerDashboardProvider);
    final role = ref.watch(authControllerProvider).value?.user.partnerRole;
    final permissions =
        reseller.value?.permissions ?? const <String, dynamic>{};
    final isAllowed = (PartnerWorkspaceSection value) {
      return switch (value) {
        PartnerWorkspaceSection.overview => true,
        PartnerWorkspaceSection.customers => _partnerPermission(
          permissions,
          'manage_customers',
        ),
        PartnerWorkspaceSection.team => _partnerPermission(
          permissions,
          'manage_partners',
        ),
        PartnerWorkspaceSection.credits => _partnerPermission(
          permissions,
          'view_financial',
        ),
        PartnerWorkspaceSection.payments => _partnerPermission(
          permissions,
          'view_financial',
        ),
      };
    };
    if (!isAllowed(section)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (ref.read(partnerWorkspaceSectionProvider) !=
            PartnerWorkspaceSection.overview) {
          ref
              .read(partnerWorkspaceSectionProvider.notifier)
              .select(PartnerWorkspaceSection.overview);
        }
      });
    }
    final active = isAllowed(section)
        ? section
        : PartnerWorkspaceSection.overview;
    return Scaffold(
      backgroundColor: wa.shellBg,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 860;
            if (compact) {
              return Column(
                children: [
                  _PartnerHeader(role: role),
                  Expanded(
                    child: PartnerManagementPanel(
                      partnerSection: active,
                      onCustomers: () => ref
                          .read(partnerWorkspaceSectionProvider.notifier)
                          .select(PartnerWorkspaceSection.customers),
                      onCredits: () => ref
                          .read(partnerWorkspaceSectionProvider.notifier)
                          .select(PartnerWorkspaceSection.credits),
                      onTeam: () => ref
                          .read(partnerWorkspaceSectionProvider.notifier)
                          .select(PartnerWorkspaceSection.team),
                    ),
                  ),
                  _PartnerBottomBar(
                    active: active,
                    permissions: permissions,
                    onSelect: (value) => ref
                        .read(partnerWorkspaceSectionProvider.notifier)
                        .select(value),
                  ),
                ],
              );
            }
            return Row(
              children: [
                _PartnerRail(
                  active: active,
                  permissions: permissions,
                  onSelect: (value) => ref
                      .read(partnerWorkspaceSectionProvider.notifier)
                      .select(value),
                ),
                Expanded(
                  child: Column(
                    children: [
                      _PartnerHeader(role: role),
                      Expanded(
                        child: PartnerManagementPanel(
                          partnerSection: active,
                          onCustomers: () => ref
                              .read(partnerWorkspaceSectionProvider.notifier)
                              .select(PartnerWorkspaceSection.customers),
                          onCredits: () => ref
                              .read(partnerWorkspaceSectionProvider.notifier)
                              .select(PartnerWorkspaceSection.credits),
                          onTeam: () => ref
                              .read(partnerWorkspaceSectionProvider.notifier)
                              .select(PartnerWorkspaceSection.team),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

bool _partnerPermission(Map<String, dynamic> permissions, String key) {
  final value = permissions[key];
  if (value is bool) return value;
  if (value is num) return value != 0;
  return value?.toString().trim().toLowerCase() == 'true' || value == 1;
}

class _PartnerHeader extends ConsumerWidget {
  const _PartnerHeader({required this.role});
  final String? role;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final user = ref.watch(authControllerProvider).value?.user;
    return Material(
      color: wa.panel,
      child: Container(
        padding: const EdgeInsets.fromLTRB(22, 10, 14, 9),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: wa.divider)),
        ),
        child: Row(
          children: [
            const Expanded(child: _BotAdminBrandHeader()),
            if (user != null)
              Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: wa.accentSoft,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  _partnerWorkspaceRoleLabel(role ?? 'reseller'),
                  style: TextStyle(
                    color: wa.accent,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            PopupMenuButton<String>(
              tooltip: 'Mais opções',
              color: wa.menuBg,
              icon: Icon(Icons.more_vert_rounded, color: wa.icon),
              padding: EdgeInsets.zero,
              offset: const Offset(0, 42),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              constraints: const BoxConstraints(minWidth: 272, maxWidth: 300),
              onSelected: (value) {
                if (value == 'theme') {
                  ref.read(themeControllerProvider.notifier).toggle();
                } else if (value == 'logout') {
                  ref.read(authControllerProvider.notifier).logout();
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: 'theme',
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      wa.isDark
                          ? Icons.light_mode_outlined
                          : Icons.dark_mode_outlined,
                    ),
                    title: Text(wa.isDark ? 'Tema claro' : 'Tema escuro'),
                  ),
                ),
                const PopupMenuItem(
                  value: 'logout',
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.logout_rounded),
                    title: Text('Sair'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

String _partnerWorkspaceRoleLabel(String role) => switch (role) {
  'owner' => 'Proprietário',
  'master' || 'manager' => 'Master',
  'support' => 'Suporte',
  _ => 'Revendedor',
};

class _PartnerRail extends StatelessWidget {
  const _PartnerRail({
    required this.active,
    required this.permissions,
    required this.onSelect,
  });
  final PartnerWorkspaceSection active;
  final Map<String, dynamic> permissions;
  final ValueChanged<PartnerWorkspaceSection> onSelect;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      width: 64,
      color: wa.rail,
      child: Column(
        children: [
          const SizedBox(height: 12),
          _PartnerRailButton(
            active: active == PartnerWorkspaceSection.overview,
            icon: Icons.dashboard_outlined,
            tooltip: 'Visão geral',
            onTap: () => onSelect(PartnerWorkspaceSection.overview),
          ),
          if (_partnerPermission(permissions, 'manage_customers'))
            _PartnerRailButton(
              active: active == PartnerWorkspaceSection.customers,
              icon: Icons.people_alt_outlined,
              tooltip: 'Clientes',
              onTap: () => onSelect(PartnerWorkspaceSection.customers),
            ),
          if (_partnerPermission(permissions, 'manage_partners'))
            _PartnerRailButton(
              active: active == PartnerWorkspaceSection.team,
              icon: Icons.groups_2_outlined,
              tooltip: 'Equipe',
              onTap: () => onSelect(PartnerWorkspaceSection.team),
            ),
          if (_partnerPermission(permissions, 'view_financial'))
            _PartnerRailButton(
              active: active == PartnerWorkspaceSection.credits,
              icon: Icons.account_balance_wallet_outlined,
              tooltip: 'Créditos',
              onTap: () => onSelect(PartnerWorkspaceSection.credits),
            ),
          if (_partnerPermission(permissions, 'view_financial'))
            _PartnerRailButton(
              active: active == PartnerWorkspaceSection.payments,
              icon: Icons.payments_outlined,
              tooltip: 'Pagamentos e split',
              onTap: () => onSelect(PartnerWorkspaceSection.payments),
            ),
        ],
      ),
    );
  }
}

class _PartnerRailButton extends StatelessWidget {
  const _PartnerRailButton({
    required this.active,
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });
  final bool active;
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return IconButton(
      tooltip: tooltip,
      onPressed: onTap,
      style: IconButton.styleFrom(
        backgroundColor: active ? wa.accentSoft : Colors.transparent,
        foregroundColor: active ? wa.accent : wa.icon,
        padding: const EdgeInsets.all(12),
      ),
      icon: Icon(icon),
    );
  }
}

class _PartnerBottomBar extends StatelessWidget {
  const _PartnerBottomBar({
    required this.active,
    required this.permissions,
    required this.onSelect,
  });
  final PartnerWorkspaceSection active;
  final Map<String, dynamic> permissions;
  final ValueChanged<PartnerWorkspaceSection> onSelect;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final items = <(PartnerWorkspaceSection, IconData, String)>[
      (PartnerWorkspaceSection.overview, Icons.dashboard_outlined, 'Resumo'),
      if (_partnerPermission(permissions, 'manage_customers'))
        (
          PartnerWorkspaceSection.customers,
          Icons.people_alt_outlined,
          'Clientes',
        ),
      if (_partnerPermission(permissions, 'manage_partners'))
        (PartnerWorkspaceSection.team, Icons.groups_2_outlined, 'Equipe'),
      if (_partnerPermission(permissions, 'view_financial'))
        (
          PartnerWorkspaceSection.credits,
          Icons.account_balance_wallet_outlined,
          'Créditos',
        ),
      if (_partnerPermission(permissions, 'view_financial'))
        (
          PartnerWorkspaceSection.payments,
          Icons.payments_outlined,
          'Pagamentos',
        ),
    ];
    return Material(
      color: wa.panel,
      child: SafeArea(
        top: false,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: items
              .map(
                (item) => Expanded(
                  child: _MobileNavItem(
                    selected: active == item.$1,
                    icon: item.$2,
                    label: item.$3,
                    onTap: () => onSelect(item.$1),
                  ),
                ),
              )
              .toList(),
        ),
      ),
    );
  }
}

class _SilentDashboardReconnect extends ConsumerStatefulWidget {
  const _SilentDashboardReconnect({required this.isDark});

  final bool isDark;

  @override
  ConsumerState<_SilentDashboardReconnect> createState() =>
      _SilentDashboardReconnectState();
}

class _SilentDashboardReconnectState
    extends ConsumerState<_SilentDashboardReconnect> {
  Timer? _retryTimer;

  @override
  void initState() {
    super.initState();
    _retryTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (mounted) ref.invalidate(dashboardSnapshotProvider);
    });
  }

  @override
  void dispose() {
    _retryTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final background = widget.isDark
        ? const Color(0xFF0B141A)
        : const Color(0xFFF0F2F5);
    return ColoredBox(
      color: background,
      child: const Align(
        alignment: Alignment.topCenter,
        child: LinearProgressIndicator(minHeight: 2),
      ),
    );
  }
}

class _DashboardWarmLoadingState extends StatelessWidget {
  const _DashboardWarmLoadingState({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final background = isDark
        ? const Color(0xFF0B141A)
        : const Color(0xFFF0F2F5);
    return ColoredBox(
      color: background,
      child: const Align(
        alignment: Alignment.topCenter,
        child: LinearProgressIndicator(minHeight: 2),
      ),
    );
  }
}

class _DashboardLoadingState extends StatelessWidget {
  const _DashboardLoadingState({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final bg = isDark ? const Color(0xFF0B141A) : const Color(0xFFF0F2F5);
    final card = isDark ? const Color(0xFF111B21) : Colors.white;
    final text = isDark ? const Color(0xFFE9EDEF) : const Color(0xFF111B21);
    final muted = isDark ? const Color(0xFF8696A0) : const Color(0xFF667781);

    return ColoredBox(
      color: bg,
      child: Center(
        child: Container(
          width: 270,
          padding: const EdgeInsets.fromLTRB(22, 24, 22, 22),
          decoration: BoxDecoration(
            color: card,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.18 : 0.10),
                blurRadius: 24,
                offset: const Offset(0, 12),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset(
                'assets/brand/botadmin-logo.png',
                width: 72,
                height: 72,
                fit: BoxFit.contain,
              ),
              const SizedBox(height: 18),
              Text(
                'Carregando painel',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: text,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Sincronizando conversas e configurações.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: muted,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 18),
              LinearProgressIndicator(
                minHeight: 5,
                borderRadius: BorderRadius.circular(999),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

void _handleDashboardBack(BuildContext context, WidgetRef ref) {
  if (Navigator.of(context).canPop()) {
    Navigator.of(context).maybePop();
    return;
  }

  final utilityPanel = ref.read(conversationUtilityPanelProvider);
  if (utilityPanel != ConversationUtilityPanel.none) {
    ref
        .read(conversationUtilityPanelProvider.notifier)
        .show(ConversationUtilityPanel.none);
    return;
  }

  final section = ref.read(dashboardSectionProvider);
  if (section == DashboardSection.conversations &&
      ref.read(selectedThreadProvider) != null) {
    ref.read(selectedThreadProvider.notifier).select(null);
    return;
  }

  if (section == DashboardSection.groups &&
      ref.read(selectedGroupProvider) != null) {
    ref.read(selectedGroupProvider.notifier).select(null);
    return;
  }

  if (section == DashboardSection.conversations &&
      ref.read(conversationSearchProvider).trim().isNotEmpty) {
    ref.read(conversationSearchProvider.notifier).clear();
    return;
  }

  if (section == DashboardSection.conversations &&
      ref.read(conversationListFilterProvider) != ConversationListFilter.all) {
    ref
        .read(conversationListFilterProvider.notifier)
        .select(ConversationListFilter.all);
    return;
  }

  final sectionController = ref.read(dashboardSectionProvider.notifier);
  if (sectionController.selectPrevious()) return;

  if (section != DashboardSection.conversations) {
    sectionController.select(
      DashboardSection.conversations,
      recordHistory: false,
    );
  }
}

void _scheduleProfileOnboardingPrompt(
  BuildContext context,
  WidgetRef ref,
  List<BotInstance> instances,
  int? userId,
) {
  // A private BotAdmin group invite opens directly into its conversation. A
  // guest joining through that flow must not be redirected to the WhatsApp
  // profile onboarding modal; the group has its own lightweight auth gate.
  final invitedInternalGroupId = int.tryParse(
    Uri.base.queryParameters['internalGroupId']?.trim() ?? '',
  );
  final arrivedFromInvite = Uri.base.queryParameters['invite']?.trim() == '1';
  if (arrivedFromInvite ||
      (invitedInternalGroupId != null && invitedInternalGroupId > 0))
    return;
  final hasConnectedProfile = instances.any((instance) => instance.isConnected);
  if (hasConnectedProfile) return;
  if (instances.any((instance) => !_profileValidity(instance).active)) return;

  final userKey = userId ?? 0;
  final shownFor = _profileOnboardingPromptShownForUser;
  if (shownFor == userKey) return;
  if (!_profileOnboardingPromptScheduledForUser.add(userKey)) return;

  WidgetsBinding.instance.addPostFrameCallback((_) async {
    if (!context.mounted) {
      _profileOnboardingPromptScheduledForUser.remove(userKey);
      return;
    }
    _profileOnboardingPromptShownForUser = userKey;
    ref
        .read(dashboardSectionProvider.notifier)
        .select(DashboardSection.profiles);
    ref.read(selectedThreadProvider.notifier).select(null);
    ref.read(selectedGroupProvider.notifier).select(null);

    await _showProfileOnboardingDialog(
      context,
      hasProfile: instances.isNotEmpty,
    );
    _profileOnboardingPromptScheduledForUser.remove(userKey);
  });
}

enum _ProfileValidityTone { active, warning, danger }

class _ProfileValidity {
  const _ProfileValidity({
    required this.active,
    required this.label,
    required this.tone,
    required this.shouldWarn,
  });

  final bool active;
  final String label;
  final _ProfileValidityTone tone;
  final bool shouldWarn;
}

_ProfileValidity _profileValidity(BotInstance instance) {
  if (instance.purpose == 'admin_system') {
    return const _ProfileValidity(
      active: true,
      label: 'Perfil administrativo',
      tone: _ProfileValidityTone.active,
      shouldWarn: false,
    );
  }
  final expiresAt = instance.expiresAt?.toLocal();
  if (expiresAt == null) {
    return const _ProfileValidity(
      active: false,
      label: 'Pagamento pendente',
      tone: _ProfileValidityTone.danger,
      shouldWarn: true,
    );
  }
  final now = DateTime.now();
  if (!expiresAt.isAfter(now)) {
    return _ProfileValidity(
      active: false,
      label: 'Venceu em ${DateFormat('dd/MM/yyyy').format(expiresAt)}',
      tone: _ProfileValidityTone.danger,
      shouldWarn: true,
    );
  }
  final days = DateUtils.dateOnly(
    expiresAt,
  ).difference(DateUtils.dateOnly(now)).inDays;
  if (days <= 0) {
    return const _ProfileValidity(
      active: true,
      label: 'Vence hoje',
      tone: _ProfileValidityTone.danger,
      shouldWarn: true,
    );
  }
  if (days == 1) {
    return const _ProfileValidity(
      active: true,
      label: 'Vence amanhã',
      tone: _ProfileValidityTone.warning,
      shouldWarn: true,
    );
  }
  return _ProfileValidity(
    active: true,
    label: 'Válido até ${DateFormat('dd/MM/yyyy').format(expiresAt)}',
    tone: _ProfileValidityTone.active,
    shouldWarn: false,
  );
}

Color _profileValidityColor(WaTheme wa, _ProfileValidity validity) {
  return switch (validity.tone) {
    _ProfileValidityTone.active => wa.accent,
    _ProfileValidityTone.warning => const Color(0xFFD97706),
    _ProfileValidityTone.danger => const Color(0xFFDC2626),
  };
}

void _scheduleProfileExpiryPrompt(
  BuildContext context,
  WidgetRef ref,
  BotInstance? instance,
  int? userId,
) {
  if (instance == null) return;
  final validity = _profileValidity(instance);
  if (!validity.shouldWarn) return;
  final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
  final key = '${userId ?? 0}:${instance.id}:$today:${validity.label}';
  if (_profileExpiryPromptKeys.contains(key) ||
      !_profileExpiryPromptScheduledKeys.add(key)) {
    return;
  }
  WidgetsBinding.instance.addPostFrameCallback((_) async {
    if (!context.mounted) {
      _profileExpiryPromptScheduledKeys.remove(key);
      return;
    }
    _profileExpiryPromptKeys.add(key);
    await _showProfileValidityDialog(context, ref, instance);
    _profileExpiryPromptScheduledKeys.remove(key);
  });
}

Future<void> _showProfileValidityDialog(
  BuildContext context,
  WidgetRef ref,
  BotInstance instance,
) async {
  final wa = WaTheme.of(context);
  final validity = _profileValidity(instance);
  final color = _profileValidityColor(wa, validity);
  final renew = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      backgroundColor: wa.panel,
      title: Row(
        children: [
          CircleAvatar(
            backgroundColor: color.withValues(alpha: .14),
            child: Icon(
              validity.active
                  ? Icons.event_outlined
                  : Icons.event_busy_outlined,
              color: color,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              instance.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: color.withValues(alpha: .09),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: color.withValues(alpha: .35)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(Icons.workspace_premium_outlined, color: color),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        validity.label,
                        style: TextStyle(
                          color: color,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              instance.expiresAt == null
                  ? 'Este perfil ainda não possui uma validade ativa registrada.'
                  : 'Validade registrada: ${DateFormat('dd/MM/yyyy \'às\' HH:mm').format(instance.expiresAt!.toLocal())}.',
              style: TextStyle(color: wa.textSecondary, height: 1.4),
            ),
            const SizedBox(height: 8),
            Text(
              validity.active
                  ? 'Renove antes do vencimento para manter as conversas, automações e transmissões funcionando sem interrupção.'
                  : 'Enquanto estiver vencido, este perfil pode ficar indisponível. A renovação preserva o número, as conversas e as configurações existentes.',
              style: TextStyle(color: wa.textSecondary, height: 1.4),
            ),
            const SizedBox(height: 8),
            Text(
              'Após a confirmação do pagamento, a nova validade e a ativação são aplicadas automaticamente.',
              style: TextStyle(
                color: wa.textMuted,
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Agora não'),
        ),
        FilledButton.icon(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Renovar perfil'),
        ),
      ],
    ),
  );
  if (renew == true && context.mounted) {
    await openRenewProfileSheet(context, ref, instance);
  }
}

Future<bool> _ensureProfileAvailable(
  BuildContext context,
  WidgetRef ref,
  BotInstance? instance,
) async {
  if (instance != null && _profileValidity(instance).active) return true;
  if (instance != null) {
    await _showProfileValidityDialog(context, ref, instance);
  } else {
    showErrorToast(context, 'Crie um perfil para continuar.');
  }
  return false;
}

Future<void> _showProfileOnboardingDialog(
  BuildContext context, {
  required bool hasProfile,
}) {
  final wa = WaTheme.of(context);
  final title = hasProfile
      ? 'Conecte seu WhatsApp'
      : 'Crie seu primeiro perfil';
  final message = hasProfile
      ? 'Você já tem um perfil, mas nenhum WhatsApp está conectado. Para liberar automações, grupos, respostas e proteção, conecte o número desse perfil.'
      : 'Para começar, crie um perfil e conecte seu WhatsApp. É esse perfil que libera as automações, grupos, mensagens e proteções do BotAdmin.';
  return showDialog<void>(
    context: context,
    barrierDismissible: true,
    builder: (context) => AlertDialog(
      backgroundColor: wa.panel,
      title: Row(
        children: [
          CircleAvatar(
            backgroundColor: wa.accentSoft,
            child: Icon(Icons.qr_code_2_outlined, color: wa.accent),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(title, style: TextStyle(color: wa.textPrimary)),
          ),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Text(
          message,
          style: TextStyle(color: wa.textSecondary, height: 1.35),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Depois'),
        ),
        FilledButton.icon(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.arrow_forward_rounded),
          label: Text(hasProfile ? 'Conectar agora' : 'Criar perfil'),
        ),
      ],
    ),
  );
}

BotInstance? _resolveActiveInstance(
  List<BotInstance> instances,
  int? selectedId,
) {
  if (instances.isEmpty) return null;
  if (selectedId != null) {
    for (final instance in instances) {
      if (instance.id == selectedId) return instance;
    }
  }
  for (final instance in instances) {
    if (instance.isConnected) return instance;
  }
  return instances.first;
}

DashboardSnapshot _scopeSnapshotForInstance(
  DashboardSnapshot data,
  int? instanceId,
) {
  if (instanceId == null || instanceId <= 0) return data;
  return DashboardSnapshot(
    instances: data.instances,
    groups: data.groups,
    threads: data.threads
        .where(
          (thread) =>
              thread.isSupport ||
              thread.isInternalGroup ||
              thread.instanceId == instanceId,
        )
        .toList(growable: false),
  );
}

class _ConversationListRealtimeHost extends ConsumerStatefulWidget {
  const _ConversationListRealtimeHost({
    required this.instanceId,
    required this.child,
  });

  final int? instanceId;
  final Widget child;

  @override
  ConsumerState<_ConversationListRealtimeHost> createState() =>
      _ConversationListRealtimeHostState();
}

class _ConversationListRealtimeHostState
    extends ConsumerState<_ConversationListRealtimeHost>
    with WidgetsBindingObserver {
  Timer? _timer;
  WhatsappRealtimeClient? _socket;
  bool _checking = false;
  bool _primed = false;
  int _lastSequence = 0;
  DateTime? _lastRefresh;
  DateTime? _lastSnapshotRefresh;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _restart();
  }

  @override
  void didUpdateWidget(covariant _ConversationListRealtimeHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.instanceId != widget.instanceId) {
      _restart();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    unawaited(_socket?.dispose());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_check());
    }
  }

  void _restart() {
    _timer?.cancel();
    unawaited(_socket?.dispose());
    _checking = false;
    _primed = false;
    _lastSequence = 0;
    unawaited(
      NativePushRegistration.ensureRegistered(ref.read(apiClientProvider)),
    );
    unawaited(_check());
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _check());
  }

  void _connectSocket() {
    if (!mounted || !_primed) return;
    unawaited(_socket?.dispose());
    _socket = WhatsappRealtimeClient(
      sessionStore: ref.read(sessionStoreProvider),
      after: _lastSequence,
      onEvent: (event) {
        if (!mounted) return;
        final sequenceId = event.sequenceId;
        final isNewRealtimeEvent =
            _primed && (sequenceId <= 0 || sequenceId > _lastSequence);
        if (sequenceId > _lastSequence) _lastSequence = sequenceId;
        if (event.eventType == 'conversation.message.upserted') {
          final eventKey = _conversationEventKey(
            event.instanceId,
            event.chatJid,
          );
          final selected = ref.read(selectedThreadProvider);
          final selectedKey = selected == null
              ? null
              : _conversationThreadKey(selected);
          if (eventKey != null && eventKey != selectedKey) {
            ref.read(readConversationKeysProvider.notifier).clearKey(eventKey);
            if (isNewRealtimeEvent) {
              _showRealtimeMessageNotification(event);
            }
          } else if (eventKey != null) {
            ref
                .read(readConversationKeysProvider.notifier)
                .markReadKey(eventKey);
          }
        } else if (event.eventType == 'chat.action') {
          final payload = event.payload;
          if (payload != null && payload['read'] == true) {
            ref
                .read(readConversationKeysProvider.notifier)
                .markReadKey(
                  _conversationEventKey(event.instanceId, event.chatJid),
                );
          }
        }
        _refreshFromRealtimeEvent();
      },
      onReconnectNeeded: () {
        if (!mounted) return;
        unawaited(_check());
      },
    )..start();
  }

  void _refreshFromRealtimeEvent() {
    final now = DateTime.now();
    final previous = _lastRefresh;
    if (previous != null &&
        now.difference(previous) < const Duration(milliseconds: 180)) {
      return;
    }
    _lastRefresh = now;
    ref.invalidate(dashboardSnapshotProvider);
  }

  void _showRealtimeMessageNotification(WhatsappRealtimeSocketEvent event) {
    if (!kIsWeb) return;
    final thread =
        event.thread ??
        (event.payload?['thread'] as Map?)?.cast<String, dynamic>();
    final message =
        event.message ??
        (event.payload?['message'] as Map?)?.cast<String, dynamic>();
    final title =
        _firstNonEmptyString([
          thread?['title']?.toString(),
          message?['senderName']?.toString(),
          event.chatJid,
        ]) ??
        'Nova mensagem';
    final body =
        _firstNonEmptyString([
          message?['text']?.toString(),
          thread?['lastMessagePreview']?.toString(),
          'Mensagem recebida',
        ]) ??
        'Mensagem recebida';
    unawaited(
      BrowserNotifications.show(
        title: title,
        body: body,
        tag: 'botadmin-web-whatsapp-messages',
      ),
    );
  }

  Future<void> _check() async {
    if (_checking) return;
    _checking = true;
    try {
      final snapshot = await ref
          .read(apiClientProvider)
          .loadWhatsappRealtimeEvents(
            after: _lastSequence,
            instanceId: widget.instanceId,
            limit: 100,
          );
      final latest = snapshot['latestSequenceId'];
      final nextSequence = latest is num ? latest.toInt() : _lastSequence;
      final events = snapshot['events'];
      final hasEvents = events is List && events.isNotEmpty;

      if (!_primed) {
        _primed = true;
        if (nextSequence > _lastSequence) _lastSequence = nextSequence;
        _connectSocket();
      }

      if (nextSequence > _lastSequence) _lastSequence = nextSequence;
      _socket?.updateSequence(_lastSequence);
      final now = DateTime.now();
      final selectedThread = ref.read(selectedThreadProvider);
      final activeSection = ref.read(dashboardSectionProvider);
      final refreshInterval =
          activeSection == DashboardSection.conversations &&
              selectedThread == null
          ? const Duration(seconds: 12)
          : const Duration(seconds: 35);
      final shouldRefreshSnapshot =
          _lastSnapshotRefresh == null ||
          now.difference(_lastSnapshotRefresh!) >= refreshInterval;
      if (shouldRefreshSnapshot) {
        _lastSnapshotRefresh = now;
        // Re-read the durable conversation directory even when the websocket
        // has no event. This recovers automatically after a backend timeout.
        ref.invalidate(dashboardSnapshotProvider);
      }
      if (!hasEvents) return;

      _refreshFromRealtimeEvent();
    } catch (_) {
      // Lista em tempo real é oportunista; o snapshot normal continua valendo.
    } finally {
      _checking = false;
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Warms only the visible conversation list. The selected chat owns message
/// loading priority and cancels this speculative work.
class _DashboardWarmHost extends ConsumerStatefulWidget {
  const _DashboardWarmHost({required this.data, required this.child});

  final DashboardSnapshot data;
  final Widget child;

  @override
  ConsumerState<_DashboardWarmHost> createState() => _DashboardWarmHostState();
}

class _DashboardWarmHostState extends ConsumerState<_DashboardWarmHost> {
  int? _lastWarmIdentity;
  ProviderSubscription<ConversationThread?>? _threadSubscription;
  ProviderSubscription<DashboardSection>? _sectionSubscription;

  @override
  void initState() {
    super.initState();
    _threadSubscription = ref.listenManual(selectedThreadProvider, (_, thread) {
      final cache = ref.read(conversationCacheProvider);
      if (thread == null) {
        _scheduleWarm(force: true);
      } else {
        unawaited(cache.prioritizeThread(thread));
      }
    });
    _sectionSubscription = ref.listenManual(dashboardSectionProvider, (
      _,
      section,
    ) {
      if (section == DashboardSection.conversations &&
          ref.read(selectedThreadProvider) == null) {
        _scheduleWarm(force: true);
      } else {
        ref.read(conversationCacheProvider).cancelBackgroundWarmup();
      }
    });
    _scheduleWarm();
  }

  @override
  void dispose() {
    _threadSubscription?.close();
    _sectionSubscription?.close();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _DashboardWarmHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.data.threads, widget.data.threads) ||
        oldWidget.data.threads.length != widget.data.threads.length) {
      _scheduleWarm();
    }
  }

  void _scheduleWarm({bool force = false}) {
    if (ref.read(dashboardSectionProvider) != DashboardSection.conversations ||
        ref.read(selectedThreadProvider) != null) {
      ref.read(conversationCacheProvider).cancelBackgroundWarmup();
      return;
    }
    final identity = identityHashCode(widget.data.threads);
    if (!force && _lastWarmIdentity == identity) return;
    _lastWarmIdentity = identity;
    final threads = _safeConversationThreads(widget.data.threads);
    // Start after the first frame: visible avatars are cheap and should appear
    // before the user notices fallback placeholders.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Future<void>.delayed(const Duration(milliseconds: 8), () {
        if (!mounted) return;
        unawaited(
          ref
              .read(conversationCacheProvider)
              // Warm only the first screen plus a small safety margin. Loading
              // the whole directory here makes mobile Chrome decode dozens of
              // images before the list is interactive.
              .warmConversationList(threads, visibleAvatars: 8),
        );
      });
    });
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Sidebar host keeps its own watches so chat selection does not rebuild list.
class _DesktopSidebarHost extends ConsumerWidget {
  const _DesktopSidebarHost({required this.data});

  final DashboardSnapshot data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final section = ref.watch(dashboardSectionProvider);
    // Groups selection only — never selectedThread, so chat open stays smooth.
    final selectedGroup = ref.watch(selectedGroupProvider);
    return _SidebarForSection(
      data: data,
      section: section,
      selectedGroup: selectedGroup,
    );
  }
}

class _DesktopResizablePanes extends StatefulWidget {
  const _DesktopResizablePanes({required this.data});

  final DashboardSnapshot data;

  @override
  State<_DesktopResizablePanes> createState() => _DesktopResizablePanesState();
}

class _DesktopResizablePanesState extends State<_DesktopResizablePanes> {
  static const _storageKey = 'botadmin-desktop-sidebar-width';
  static const _dividerHitWidth = 10.0;
  static const _minSidebarWidth = 320.0;
  static const _minContentWidth = 420.0;
  static const _maxSidebarWidth = 760.0;

  double? _sidebarWidth;
  bool _dragging = false;

  @override
  void initState() {
    super.initState();
    _sidebarWidth = double.tryParse(readThemeStorage(_storageKey) ?? '');
  }

  double _defaultSidebarWidth(double totalWidth) {
    if (totalWidth >= 1280) return 576;
    if (totalWidth >= 1040) return 500;
    return 420;
  }

  double _clampSidebarWidth(double value, double totalWidth) {
    final maxByContent = totalWidth - _minContentWidth - _dividerHitWidth;
    final effectiveMax = math.min(_maxSidebarWidth, maxByContent);
    final effectiveMin = math.min(_minSidebarWidth, effectiveMax);
    if (!effectiveMax.isFinite || effectiveMax <= 0) {
      return math.max(0, totalWidth - _dividerHitWidth);
    }
    return value.clamp(effectiveMin, effectiveMax).toDouble();
  }

  void _saveSidebarWidth(double value) {
    writeThemeStorage(_storageKey, value.round().toString());
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final totalWidth = constraints.maxWidth;
        final preferred = _sidebarWidth ?? _defaultSidebarWidth(totalWidth);
        final sidebarWidth = _clampSidebarWidth(preferred, totalWidth);
        if (_sidebarWidth != sidebarWidth) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) setState(() => _sidebarWidth = sidebarWidth);
          });
        }

        return Row(
          children: [
            SizedBox(
              width: sidebarWidth,
              child: RepaintBoundary(
                child: DecoratedBox(
                  decoration: BoxDecoration(color: wa.panel),
                  child: _DesktopSidebarHost(data: widget.data),
                ),
              ),
            ),
            _DesktopPaneDivider(
              active: _dragging,
              onDragStart: () => setState(() => _dragging = true),
              onDragEnd: () {
                setState(() => _dragging = false);
                // Persist only once, after the gesture. Writing localStorage
                // on every pointer event makes Flutter Web schedule extra
                // work and causes the divider/panes to visibly flicker.
                _saveSidebarWidth(_sidebarWidth ?? sidebarWidth);
              },
              onDelta: (delta) {
                final next = _clampSidebarWidth(
                  sidebarWidth + delta,
                  totalWidth,
                );
                setState(() => _sidebarWidth = next);
              },
            ),
            Expanded(
              child: RepaintBoundary(
                child: _DesktopContentHost(data: widget.data),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _DesktopPaneDivider extends StatelessWidget {
  const _DesktopPaneDivider({
    required this.active,
    required this.onDelta,
    required this.onDragStart,
    required this.onDragEnd,
  });

  final bool active;
  final ValueChanged<double> onDelta;
  final VoidCallback onDragStart;
  final VoidCallback onDragEnd;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return MouseRegion(
      cursor: SystemMouseCursors.resizeColumn,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        // Use the unconstrained pan recognizer here. The horizontal
        // recognizer cancels/restarts when a desktop pointer has a tiny
        // vertical component, which made the divider flash while dragging.
        dragStartBehavior: DragStartBehavior.down,
        onPanStart: (_) => onDragStart(),
        onPanEnd: (_) => onDragEnd(),
        onPanCancel: onDragEnd,
        onPanUpdate: (details) => onDelta(details.delta.dx),
        child: SizedBox(
          width: _DesktopResizablePanesState._dividerHitWidth,
          child: Center(
            child: Container(
              // Keep the painted line stable throughout the gesture. An
              // AnimatedContainer plus a blurred shadow forced CanvasKit to
              // recreate the layer on every pane layout, producing a flash.
              width: 2,
              decoration: BoxDecoration(
                color: active ? wa.accent : wa.border,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Content pane watches selection independently from the conversation list.
class _DesktopContentHost extends ConsumerWidget {
  const _DesktopContentHost({required this.data});

  final DashboardSnapshot data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final section = ref.watch(dashboardSectionProvider);
    final selectedThread = ref.watch(selectedThreadProvider);
    final selectedGroup = ref.watch(selectedGroupProvider);
    return _ContentForSection(
      data: data,
      section: section,
      selectedThread: selectedThread,
      selectedGroup: selectedGroup,
      selectedThreadGroup: _groupForThread(data.groups, selectedThread),
    );
  }
}

class _SidebarForSection extends ConsumerWidget {
  const _SidebarForSection({
    required this.data,
    required this.section,
    required this.selectedGroup,
  });

  final DashboardSnapshot data;
  final DashboardSection section;
  final BotGroup? selectedGroup;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final utilityPanel = ref.watch(conversationUtilityPanelProvider);
    return switch (section) {
      DashboardSection.conversations =>
        utilityPanel == ConversationUtilityPanel.none
            ? _ConversationList(data: data)
            : _ConversationUtilityPanel(data: data, panel: utilityPanel),
      DashboardSection.profiles => _ProfilesSidebar(instances: data.instances),
      DashboardSection.status => const SizedBox.shrink(),
      DashboardSection.channels => const _ChannelsList(),
      DashboardSection.communities => _CommunitiesList(data: data),
      DashboardSection.groups => _GroupList(
        data: data,
        selected: selectedGroup,
      ),
      DashboardSection.settings => _SettingsSidebar(instances: data.instances),
      // Chamadas/fluxos/mídia ocupam a área principal inteira.
      DashboardSection.internalGroups => _ConversationList(
        data: data,
        fixedFilter: ConversationListFilter.internalGroups,
      ),
      DashboardSection.calls ||
      DashboardSection.broadcasts ||
      DashboardSection.media ||
      DashboardSection.tools ||
      DashboardSection.raffles ||
      DashboardSection.store ||
      DashboardSection.campaigns ||
      DashboardSection.affiliates ||
      DashboardSection.payments ||
      DashboardSection.apiRest ||
      DashboardSection.webhooks => const SizedBox.shrink(),
    };
  }
}

class _ContentForSection extends ConsumerWidget {
  const _ContentForSection({
    required this.data,
    required this.section,
    required this.selectedThread,
    required this.selectedGroup,
    required this.selectedThreadGroup,
  });

  final DashboardSnapshot data;
  final DashboardSection section;
  final ConversationThread? selectedThread;
  final BotGroup? selectedGroup;
  final BotGroup? selectedThreadGroup;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return switch (section) {
      DashboardSection.conversations when selectedThread?.isSupport == true =>
        UserSupportChatScreen(
          thread: selectedThread!,
          onConversationChanged: () =>
              ref.invalidate(dashboardSnapshotProvider),
        ),
      DashboardSection.conversations => ChatScreen(
        thread: selectedThread,
        group: selectedThreadGroup,
        onShowGroupInfo: selectedThread?.isInternalGroup == true
            ? () => showInternalGroupManagement(
                context,
                ref,
                selectedThread!,
                onDeleted: () =>
                    ref.read(selectedThreadProvider.notifier).select(null),
              )
            : null,
        onReconnectProfile: selectedThread?.isInternalGroup != false
            ? null
            : () => _openProfileReconnect(ref, selectedThread!.instanceId),
        onOpenContact: selectedThread == null
            ? null
            : (contact) => _openContactConversation(
                ref,
                data,
                selectedThread!.instanceId,
                _whatsappContactFromCard(contact),
              ),
        onOpenParticipantConversation: selectedThread?.isInternalGroup != false
            ? null
            : (jid, displayName) => _openParticipantConversation(
                ref,
                data,
                selectedThread!.instanceId,
                jid,
                displayName,
              ),
        onOpenTools: () => ref
            .read(dashboardSectionProvider.notifier)
            .select(DashboardSection.tools),
        onOpenCalls: () => ref
            .read(dashboardSectionProvider.notifier)
            .select(DashboardSection.calls),
        onOpenSupport: () => _openSupportConversation(ref, data),
        onOpenGroupSettings:
            selectedThread?.isInternalGroup == true &&
                selectedThread?.instanceIsAdmin != true
            ? null
            : selectedThread?.isInternalGroup == true
            ? selectedThreadGroup == null
                  ? null
                  : () => _openGroupBotSettingsPanel(
                      context,
                      selectedThreadGroup!,
                    )
            : selectedThreadGroup == null
            ? null
            : () => _openGroupBotSettingsPanel(context, selectedThreadGroup!),
      ),
      DashboardSection.internalGroups => ChatScreen(
        thread: selectedThread?.isInternalGroup == true ? selectedThread : null,
        group: selectedThread?.isInternalGroup == true
            ? selectedThreadGroup
            : null,
        onShowGroupInfo: selectedThread?.isInternalGroup == true
            ? () => showInternalGroupManagement(
                context,
                ref,
                selectedThread!,
                onDeleted: () =>
                    ref.read(selectedThreadProvider.notifier).select(null),
              )
            : null,
        onOpenTools: () => ref
            .read(dashboardSectionProvider.notifier)
            .select(DashboardSection.tools),
        onOpenSupport: () => _openSupportConversation(ref, data),
        onOpenGroupSettings:
            selectedThread?.isInternalGroup == true &&
                selectedThread?.instanceIsAdmin != true
            ? null
            : selectedThread?.isInternalGroup == true
            ? selectedThreadGroup == null
                  ? null
                  : () => _openGroupBotSettingsPanel(
                      context,
                      selectedThreadGroup!,
                    )
            : null,
      ),
      DashboardSection.profiles => ProfileConnectionPanel(
        onActivate: (instance) {
          ref.read(selectedInstanceIdProvider.notifier).select(instance.id);
        },
      ),
      DashboardSection.status => StatusPanel(
        activeInstanceId: ref.watch(selectedInstanceIdProvider),
      ),
      DashboardSection.media => const MediaPanel(),
      DashboardSection.channels => const _WhatsAppLandingPane(
        icon: Icons.campaign_outlined,
        title: 'Acompanhe canais',
        subtitle: 'Veja novidades e campanhas em uma área separada.',
      ),
      DashboardSection.communities => const _WhatsAppLandingPane(
        icon: Icons.groups_2_outlined,
        title: 'Mantenha suas comunidades organizadas',
        subtitle: 'Separe comunidades dos grupos administrados pelo bot.',
      ),
      DashboardSection.calls => CallsPanel(instances: data.instances),
      DashboardSection.broadcasts => BroadcastPanel(
        instanceId: _resolveActiveInstance(
          data.instances,
          ref.watch(selectedInstanceIdProvider),
        )?.id,
        onCreateProfile: () => _startProfileCreation(ref),
      ),
      DashboardSection.groups => GroupSettingsScreen(group: selectedGroup),
      DashboardSection.tools => const FlowsPanel(),
      DashboardSection.raffles => const RafflesPanel(),
      DashboardSection.store => StorePanel(
        instances: data.instances,
        threads: data.threads,
        onOpenConversation: (thread) {
          ref
              .read(dashboardSectionProvider.notifier)
              .select(DashboardSection.conversations);
          unawaited(
            _openConversationThreadWithProfileGuard(
              context,
              ref,
              thread,
              data.instances,
            ),
          );
        },
      ),
      DashboardSection.campaigns => BroadcastPanel(
        instanceId: _resolveActiveInstance(
          data.instances,
          ref.watch(selectedInstanceIdProvider),
        )?.id,
        onCreateProfile: () => _startProfileCreation(ref),
      ),
      DashboardSection.affiliates => const AffiliatesPanel(),
      DashboardSection.payments => const PaymentsPanel(),
      DashboardSection.apiRest => const ApiRestPanel(),
      DashboardSection.webhooks => const ApiRestPanel(),
      DashboardSection.settings => SettingsPanel(instances: data.instances),
    };
  }
}

Future<void> _openGroupBotSettingsPanel(BuildContext context, BotGroup group) {
  final size = MediaQuery.sizeOf(context);
  return showBotAdminBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    enableDrag: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.28),
    builder: (context) {
      final compact = size.width < 860;
      final width = compact
          ? size.width
          : (size.width - 96).clamp(900.0, 1440.0).toDouble();
      return Align(
        alignment: Alignment.bottomCenter,
        child: SizedBox(
          width: width,
          height: size.height * (compact ? 0.94 : 0.88),
          child: Material(
            color: WaTheme.of(context).panel,
            elevation: 20,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                const SizedBox(height: 8),
                Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: WaTheme.of(context).border,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                Expanded(
                  child: GroupSettingsScreen(
                    group: group,
                    leading: IconButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      icon: const Icon(Icons.close_rounded),
                      tooltip: 'Fechar',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

enum _ThreadContextAction {
  pin,
  unpin,
  archive,
  unarchive,
  clear,
  delete,
  leave,
  toggleBot,
  openBot,
}

Future<void> _showConversationContextMenu({
  required BuildContext context,
  required WidgetRef ref,
  required Offset globalPosition,
  required ConversationThread thread,
  required BotGroup? group,
}) async {
  final wa = WaTheme.of(context);
  final canManageBot =
      !thread.isInternalGroup || thread.instanceIsAdmin == true;
  final selected = await showMenu<_ThreadContextAction>(
    context: context,
    position: RelativeRect.fromLTRB(
      globalPosition.dx,
      globalPosition.dy,
      globalPosition.dx + 1,
      globalPosition.dy + 1,
    ),
    color: wa.menuBg,
    elevation: 12,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
      side: BorderSide(color: wa.border),
    ),
    items: [
      PopupMenuItem(
        value: thread.pinned
            ? _ThreadContextAction.unpin
            : _ThreadContextAction.pin,
        child: _ThreadMenuRow(
          icon: thread.pinned
              ? Icons.push_pin_outlined
              : Icons.push_pin_rounded,
          label: thread.pinned ? 'Desfixar chat' : 'Fixar chat',
        ),
      ),
      PopupMenuItem(
        value: thread.archived
            ? _ThreadContextAction.unarchive
            : _ThreadContextAction.archive,
        child: _ThreadMenuRow(
          icon: thread.archived
              ? Icons.unarchive_rounded
              : Icons.archive_rounded,
          label: thread.archived ? 'Desarquivar chat' : 'Arquivar chat',
        ),
      ),
      if (!thread.isInternalGroup || thread.instanceIsAdmin == true)
        const PopupMenuItem(
          value: _ThreadContextAction.clear,
          child: _ThreadMenuRow(
            icon: Icons.cleaning_services_rounded,
            label: 'Limpar mensagens',
          ),
        ),
      if (!thread.isInternalGroup)
        PopupMenuItem(
          value: _ThreadContextAction.delete,
          child: _ThreadMenuRow(
            icon: Icons.delete_outline_rounded,
            label: 'Apagar conversa',
            destructive: true,
          ),
        ),
      if (thread.isGroup)
        const PopupMenuItem(
          value: _ThreadContextAction.leave,
          child: _ThreadMenuRow(
            icon: Icons.logout_rounded,
            label: 'Sair do grupo',
            destructive: true,
          ),
        ),
      if (thread.isGroup && canManageBot) ...[
        const PopupMenuDivider(height: 8),
        PopupMenuItem(
          value: _ThreadContextAction.toggleBot,
          child: _ThreadMenuRow(
            icon: Icons.smart_toy_rounded,
            label: thread.isInternalGroup
                ? 'Ativar/desativar robô'
                : group == null
                ? 'Vincular e ativar robô'
                : group.botEnabled
                ? 'Desativar robô'
                : 'Ativar robô',
            trailing: group == null
                ? const Icon(Icons.add_link_rounded)
                : IgnorePointer(
                    child: Switch.adaptive(
                      value: group.botEnabled,
                      onChanged: (_) {},
                      activeTrackColor: wa.accent,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
          ),
        ),
        if (group != null || thread.isInternalGroup)
          const PopupMenuItem(
            value: _ThreadContextAction.openBot,
            child: _ThreadMenuRow(
              icon: Icons.tune_rounded,
              label: 'Bot do grupo…',
            ),
          ),
      ],
    ],
  );
  if (!context.mounted || selected == null) return;

  switch (selected) {
    case _ThreadContextAction.pin:
      await _runThreadListAction(context, ref, thread, 'pin');
      break;
    case _ThreadContextAction.unpin:
      await _runThreadListAction(context, ref, thread, 'unpin');
      break;
    case _ThreadContextAction.archive:
      await _runThreadListAction(context, ref, thread, 'archive');
      break;
    case _ThreadContextAction.unarchive:
      await _runThreadListAction(context, ref, thread, 'unarchive');
      break;
    case _ThreadContextAction.clear:
      if (!context.mounted) return;
      if (await _confirmThreadAction(
        context,
        title: thread.isInternalGroup
            ? 'Limpar para todos?'
            : 'Limpar mensagens?',
        content: thread.isInternalGroup
            ? 'Todo o histórico deste grupo BotAdmin será apagado para todos. Esta ação não pode ser desfeita.'
            : 'As mensagens desta conversa serão limpas no histórico.',
        confirmLabel: 'Limpar',
      )) {
        if (!context.mounted) return;
        await _runThreadListAction(context, ref, thread, 'clear');
      }
      break;
    case _ThreadContextAction.delete:
      if (!context.mounted) return;
      if (await _confirmThreadAction(
        context,
        title: thread.isInternalGroup
            ? 'Apagar grupo definitivamente?'
            : 'Apagar conversa?',
        content: thread.isInternalGroup
            ? 'O grupo, histórico, participantes, convites e configurações serão excluídos para todos.'
            : 'A conversa será apagada da lista deste perfil.',
        confirmLabel: thread.isInternalGroup ? 'Apagar grupo' : 'Apagar',
      )) {
        if (!context.mounted) return;
        await _runThreadListAction(context, ref, thread, 'delete');
      }
      break;
    case _ThreadContextAction.leave:
      if (!context.mounted) return;
      if (thread.isInternalGroup && thread.internalGroupRole == 'owner') {
        await _transferInternalGroupAndLeaveFromList(context, ref, thread);
        break;
      }
      if (await _confirmThreadAction(
        context,
        title: 'Sair do grupo?',
        content: 'A instância vai sair deste grupo.',
        confirmLabel: 'Sair',
      )) {
        if (!context.mounted) return;
        await _runThreadListAction(context, ref, thread, 'leave');
      }
      break;
    case _ThreadContextAction.toggleBot:
      if (!context.mounted) return;
      await _toggleGroupBotFromList(context, ref, thread, group);
      break;
    case _ThreadContextAction.openBot:
      if (group != null) {
        if (!context.mounted) return;
        await _openGroupBotSettingsPanel(context, group);
      }
      break;
  }
}

Future<void> _transferInternalGroupAndLeaveFromList(
  BuildContext context,
  WidgetRef ref,
  ConversationThread thread,
) async {
  final groupId = thread.linkedGroupId;
  if (groupId == null) return;
  try {
    final details = await ref
        .read(apiClientProvider)
        .loadInternalGroup(groupId);
    if (!context.mounted) return;
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
            'Torne pelo menos um membro administrador antes de transferir a propriedade e sair.',
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
            children: admins
                .map(
                  (member) => ListTile(
                    leading: CircleAvatar(
                      child: Text(
                        member.name.isEmpty
                            ? '?'
                            : member.name[0].toUpperCase(),
                      ),
                    ),
                    title: Text(member.name),
                    subtitle: const Text('Novo proprietário'),
                    onTap: () => Navigator.pop(dialogContext, member.userId),
                  ),
                )
                .toList(growable: false),
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
    if (selectedId == null || !context.mounted) return;
    final selected = admins.firstWhere((member) => member.userId == selectedId);
    final confirmed = await _confirmThreadAction(
      context,
      title: 'Transferir para ${selected.name}?',
      content:
          '${selected.name} receberá a propriedade e o grupo continuará funcionando. Você sairá em seguida.',
      confirmLabel: 'Transferir e sair',
    );
    if (!confirmed || !context.mounted) return;
    final response = await ref
        .read(apiClientProvider)
        .transferInternalGroupAndLeave(groupId, selectedId);
    if (!context.mounted) return;
    ref.read(selectedThreadProvider.notifier).select(null);
    ref.invalidate(dashboardSnapshotProvider);
    showActionToast(
      context,
      apiMessage: response['message']?.toString(),
      fallback: 'Grupo transferido e saída concluída.',
    );
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

Future<bool> _confirmThreadAction(
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

Future<void> _runThreadListAction(
  BuildContext context,
  WidgetRef ref,
  ConversationThread thread,
  String action,
) async {
  try {
    final response = await ref
        .read(apiClientProvider)
        .runConversationAction(thread, action);
    if (!context.mounted) return;
    if (action == 'delete' || action == 'leave' || action == 'archive') {
      final selected = ref.read(selectedThreadProvider);
      if (selected != null &&
          selected.instanceId == thread.instanceId &&
          selected.chatJid == thread.chatJid) {
        ref.read(selectedThreadProvider.notifier).select(null);
      }
    }
    ref.invalidate(dashboardSnapshotProvider);
    final message = response['message']?.toString().trim();
    showActionToast(
      context,
      apiMessage: message,
      fallback: conversationActionSuccessMessage(action),
    );
  } catch (error) {
    if (!context.mounted) return;
    showErrorToast(context, error);
  }
}

void _openConversationThreadFromList(WidgetRef ref, ConversationThread thread) {
  final visibleThread = thread.unreadCount > 0
      ? thread.copyWith(unreadCount: 0)
      : thread;
  ref.read(readConversationKeysProvider.notifier).markRead(thread);
  if (!thread.isSupport) {
    unawaited(
      ref.read(conversationCacheProvider).prioritizeThread(visibleThread),
    );
  }
  ref.read(selectedThreadProvider.notifier).select(visibleThread);
}

void _openSupportConversation(WidgetRef ref, DashboardSnapshot data) {
  ConversationThread? support;
  for (final thread in data.threads) {
    if (thread.isSupport) {
      support = thread;
      break;
    }
  }
  support ??= ConversationThread(
    instanceId: 0,
    chatJid: '__admin__',
    title: 'Suporte BotAdmin',
    lastMessage: 'Fale diretamente com nossa equipe de suporte.',
    lastActivity: DateTime.now(),
    unreadCount: 0,
    chatType: 'support',
    canSendMessages: true,
    pinned: false,
  );
  ref
      .read(dashboardSectionProvider.notifier)
      .select(DashboardSection.conversations);
  _openConversationThreadFromList(ref, support);
}

void _openProfileReconnect(WidgetRef ref, int instanceId) {
  ref.read(selectedInstanceIdProvider.notifier).select(instanceId);
  ref.read(selectedThreadProvider.notifier).select(null);
  ref.read(dashboardSectionProvider.notifier).select(DashboardSection.profiles);
}

Future<void> _openConversationThreadWithProfileGuard(
  BuildContext context,
  WidgetRef ref,
  ConversationThread thread,
  List<BotInstance> instances,
) async {
  if (thread.isSupport || thread.isInternalGroup) {
    _openConversationThreadFromList(ref, thread);
    return;
  }
  BotInstance? instance;
  for (final candidate in instances) {
    if (candidate.id == thread.instanceId) {
      instance = candidate;
      break;
    }
  }
  if (!await _ensureProfileAvailable(context, ref, instance) ||
      !context.mounted) {
    return;
  }
  _openConversationThreadFromList(ref, thread);
}

Future<void> _toggleGroupBotFromList(
  BuildContext context,
  WidgetRef ref,
  ConversationThread thread,
  BotGroup? group,
) async {
  if (thread.isInternalGroup) {
    try {
      final api = ref.read(apiClientProvider);
      final groupId =
          thread.linkedGroupId ?? int.tryParse(thread.chatJid.split(':').last);
      if (groupId == null) throw Exception('Grupo BotAdmin inválido.');
      final details = await api.loadInternalGroup(groupId);
      final next = !details.group.botEnabled;
      await api.updateInternalGroup(groupId, botEnabled: next);
      ref.invalidate(dashboardSnapshotProvider);
      if (context.mounted) {
        showSuccessToast(context, botAdminStatusMessage(next));
      }
    } catch (error) {
      if (context.mounted) showErrorToast(context, error);
    }
    return;
  }
  final instances =
      ref.read(dashboardSnapshotProvider).asData?.value.instances ??
      const <BotInstance>[];
  BotInstance? instance;
  for (final candidate in instances) {
    if (candidate.id == thread.instanceId) {
      instance = candidate;
      break;
    }
  }
  if (!await _ensureProfileAvailable(context, ref, instance) ||
      !context.mounted) {
    return;
  }
  final next = group == null ? true : !group.botEnabled;
  try {
    final api = ref.read(apiClientProvider);
    final linkedGroup = group ?? await api.createGroupFromConversation(thread);
    await api.updateGroupStatus(linkedGroup.id, active: next);
    ref.invalidate(dashboardSnapshotProvider);
    if (!context.mounted) return;
    showSuccessToast(
      context,
      group == null
          ? 'Grupo vinculado e BotAdmin ativado.'
          : botAdminStatusMessage(next),
    );
  } catch (error) {
    if (!context.mounted) return;
    showErrorToast(context, error);
  }
}

class _ThreadMenuRow extends StatelessWidget {
  const _ThreadMenuRow({
    required this.icon,
    required this.label,
    this.trailing,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final Widget? trailing;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final color = destructive ? const Color(0xFFB42318) : wa.textPrimary;
    return Row(
      children: [
        Icon(icon, size: 20, color: color),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w700,
              fontSize: 14.5,
            ),
          ),
        ),
        ?trailing,
      ],
    );
  }
}

class _MainRail extends ConsumerWidget {
  const _MainRail({
    required this.userName,
    this.partnerRole,
    required this.section,
    required this.unreadCount,
    required this.instances,
    required this.activeInstance,
  });

  final String userName;
  final String? partnerRole;
  final DashboardSection section;
  final int unreadCount;
  final List<BotInstance> instances;
  final BotInstance? activeInstance;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final isPartner = (partnerRole ?? '').isNotEmpty;
    final storeButtonKey = GlobalKey();
    return Container(
      width: 64,
      decoration: BoxDecoration(
        color: wa.rail,
        border: Border(right: BorderSide(color: wa.border)),
      ),
      child: Column(
        children: [
          SizedBox(height: 8),
          if (!isPartner) ...[
            _RailButton(
              selected: section == DashboardSection.conversations,
              icon: Icons.mark_unread_chat_alt_rounded,
              badge: unreadCount > 0 ? _shortCount(unreadCount) : null,
              tooltip: 'Conversas',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.conversations),
            ),
            _RailButton(
              selected: section == DashboardSection.internalGroups,
              icon: Icons.forum_rounded,
              tooltip: 'Grupos BotAdmin',
              onPressed: () {
                ref
                    .read(conversationListFilterProvider.notifier)
                    .select(ConversationListFilter.internalGroups);
                ref
                    .read(dashboardSectionProvider.notifier)
                    .select(DashboardSection.internalGroups);
              },
            ),
            _RailButton(
              selected: section == DashboardSection.broadcasts,
              icon: Icons.cell_tower_rounded,
              tooltip: 'Transmissões',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.broadcasts),
            ),
            _RailButton(
              selected: section == DashboardSection.profiles,
              icon: Icons.qr_code_scanner_rounded,
              dot: true,
              tooltip: 'Perfis e conexao',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.profiles),
            ),
            _RailButton(
              selected: section == DashboardSection.status,
              icon: Icons.trip_origin_rounded,
              dot: true,
              tooltip: 'Status',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.status),
            ),
            _RailButton(
              selected: section == DashboardSection.media,
              icon: Icons.perm_media_outlined,
              dot: true,
              tooltip: 'Mídias persistentes',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.media),
            ),
            SizedBox(height: 14),
            const _RailDivider(),
            SizedBox(height: 14),
            _RailButton(
              selected: section == DashboardSection.calls,
              icon: Icons.call_outlined,
              dot: true,
              tooltip: 'Chamadas',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.calls),
            ),
            _RailButton(
              selected: section == DashboardSection.tools,
              icon: Icons.account_tree_outlined,
              dot: true,
              tooltip: 'Fluxos',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.tools),
            ),
            _RailButton(
              selected: section == DashboardSection.raffles,
              icon: Icons.confirmation_number_outlined,
              tooltip: 'Rifas',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.raffles),
            ),
            _RailButton(
              key: storeButtonKey,
              selected: section == DashboardSection.store,
              icon: Icons.storefront_outlined,
              tooltip: 'Store',
              onPressed: () => _openStorePanePicker(
                context,
                ref,
                mobile: false,
                anchorContext: storeButtonKey.currentContext,
              ),
            ),
          ],
          _RailButton(
            selected: section == DashboardSection.affiliates,
            icon: isPartner ? Icons.handshake_outlined : Icons.sell_outlined,
            tooltip: isPartner ? 'Parceiros' : 'Afiliados',
            onPressed: () => ref
                .read(dashboardSectionProvider.notifier)
                .select(DashboardSection.affiliates),
          ),
          if (!isPartner) ...[
            _RailButton(
              selected: section == DashboardSection.payments,
              icon: Icons.payments_outlined,
              tooltip: 'Pagamentos',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.payments),
            ),
            _RailButton(
              selected: section == DashboardSection.apiRest,
              icon: Icons.api_outlined,
              tooltip: 'API REST',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.apiRest),
            ),
          ],
          const Spacer(),
          if (!isPartner)
            _RailButton(
              selected: section == DashboardSection.settings,
              icon: Icons.settings_outlined,
              tooltip: 'Configuracoes',
              onPressed: () => ref
                  .read(dashboardSectionProvider.notifier)
                  .select(DashboardSection.settings),
            ),
          if (isPartner)
            _RailButton(
              selected: false,
              icon: Icons.logout_rounded,
              tooltip: 'Sair',
              onPressed: () =>
                  ref.read(authControllerProvider.notifier).logout(),
            )
          else
            _ProfileSwitcherButton(
              userName: userName,
              instances: instances,
              activeInstance: activeInstance,
            ),
          SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _RailButton extends StatelessWidget {
  const _RailButton({
    super.key,
    required this.selected,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.badge,
    this.dot = false,
  });

  final bool selected;
  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  final String? badge;
  final bool dot;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: SizedBox(
        width: 54,
        height: 40,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              child: IconButton(
                style: IconButton.styleFrom(
                  backgroundColor: selected
                      ? (wa.isDark
                            ? const Color(0xFF2A3942)
                            : const Color(0xFFE7E8E9))
                      : Colors.transparent,
                  foregroundColor: selected ? wa.textPrimary : wa.icon,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(21),
                  ),
                ),
                onPressed: onPressed,
                icon: Icon(icon, size: 24),
                tooltip: tooltip,
              ),
            ),
            if (dot)
              const Positioned(
                top: 2,
                right: 8,
                child: CircleAvatar(
                  radius: 4.5,
                  backgroundColor: Color(0xFF1DAA61),
                ),
              ),
            if (badge != null)
              Positioned(
                top: -5,
                right: 3,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 5,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1DAA61),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    badge!,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
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

class _RailDivider extends StatelessWidget {
  const _RailDivider();

  @override
  Widget build(BuildContext context) {
    return Container(width: 42, height: 1, color: WaTheme.of(context).border);
  }
}

class _ProfileSwitcherButton extends ConsumerWidget {
  const _ProfileSwitcherButton({
    required this.userName,
    required this.instances,
    required this.activeInstance,
  });

  final String userName;
  final List<BotInstance> instances;
  final BotInstance? activeInstance;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = activeInstance;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: SizedBox(
        width: 54,
        height: 40,
        child: Tooltip(
          message: active == null ? userName : 'Perfil: ${active.name}',
          child: IconButton(
            style: IconButton.styleFrom(
              padding: EdgeInsets.zero,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(21),
              ),
            ),
            onPressed: () => _openProfileMenu(context, ref),
            icon: _RailProfileAvatar(
              label: active?.name ?? userName,
              instanceId: active?.id,
              active: active?.isConnected ?? false,
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _openProfileMenu(BuildContext context, WidgetRef ref) async {
    final button = context.findRenderObject() as RenderBox?;
    final overlay =
        Navigator.of(context).overlay?.context.findRenderObject() as RenderBox?;
    if (button == null || overlay == null) return;
    final topLeft = button.localToGlobal(Offset.zero, ancestor: overlay);
    final bottomRight = button.localToGlobal(
      button.size.bottomRight(Offset.zero),
      ancestor: overlay,
    );
    final position = RelativeRect.fromRect(
      Rect.fromPoints(topLeft, bottomRight),
      Offset.zero & overlay.size,
    );
    final selected = await showMenu<String>(
      context: context,
      position: position,
      elevation: 12,
      constraints: const BoxConstraints(minWidth: 286, maxWidth: 326),
      items: [
        PopupMenuItem<String>(
          enabled: false,
          height: 42,
          child: Text(
            'Trocar perfil',
            style: TextStyle(
              color: WaTheme.of(context).textMuted,
              fontWeight: FontWeight.w800,
              fontSize: 12.5,
            ),
          ),
        ),
        if (instances.isEmpty)
          const PopupMenuItem<String>(
            enabled: false,
            child: Text('Nenhum perfil criado.'),
          )
        else
          for (final instance in instances)
            PopupMenuItem<String>(
              value: 'switch:${instance.id}',
              height: 64,
              child: _ProfileMenuRow(
                instance: instance,
                selected: activeInstance?.id == instance.id,
              ),
            ),
        const PopupMenuDivider(height: 8),
        const PopupMenuItem<String>(
          value: 'new',
          height: 48,
          child: _ProfileMenuAction(
            icon: Icons.add_circle_outline_rounded,
            label: 'Novo perfil',
          ),
        ),
        const PopupMenuItem<String>(
          value: 'download-app',
          height: 48,
          child: _ProfileMenuAction(
            icon: Icons.android_rounded,
            label: 'Baixar aplicativo',
          ),
        ),
        const PopupMenuItem<String>(
          value: 'logout',
          height: 48,
          child: _ProfileMenuAction(
            icon: Icons.logout_rounded,
            label: 'Sair da conta',
          ),
        ),
      ],
    );
    if (!context.mounted || selected == null) return;
    if (selected.startsWith('switch:')) {
      final id = int.tryParse(selected.substring('switch:'.length));
      if (id != null) {
        ref.read(selectedInstanceIdProvider.notifier).select(id);
        ref
            .read(dashboardSectionProvider.notifier)
            .select(DashboardSection.conversations);
      }
      return;
    }
    if (selected == 'new') {
      await openCreateProfileSheet(context, ref);
      return;
    }
    if (selected == 'download-app') {
      await _openMobileAppDownload(context, ref);
      return;
    }
    if (selected == 'logout') {
      await ref.read(authControllerProvider.notifier).logout();
    }
  }
}

class _RailProfileAvatar extends ConsumerWidget {
  const _RailProfileAvatar({
    required this.label,
    required this.instanceId,
    required this.active,
  });

  final String label;
  final int? instanceId;
  final bool active;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final media = instanceId == null
        ? null
        : ref
              .watch(instanceProfileAvatarBytesProvider(instanceId!))
              .maybeWhen(data: (value) => value, orElse: () => null);
    final initial = _profileInitial(label);
    final fallback = CircleAvatar(
      radius: 16,
      backgroundColor: active ? wa.accentSoft : wa.avatarFallback,
      child: Text(
        initial,
        style: TextStyle(
          color: active ? wa.accent : wa.textSecondary,
          fontSize: 13,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
    if (media == null || media.bytes.isEmpty) return fallback;
    return SizedBox(
      width: 32,
      height: 32,
      child: ClipOval(
        child: Image.memory(
          media.bytes,
          width: 32,
          height: 32,
          fit: BoxFit.cover,
          cacheWidth: 96,
          cacheHeight: 96,
          gaplessPlayback: true,
          errorBuilder: (_, _, _) => fallback,
        ),
      ),
    );
  }
}

class _ProfileMenuRow extends ConsumerWidget {
  const _ProfileMenuRow({required this.instance, required this.selected});

  final BotInstance instance;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final validity = _profileValidity(instance);
    final validityColor = _profileValidityColor(wa, validity);
    return Row(
      children: [
        _RailProfileAvatar(
          label: instance.name,
          instanceId: instance.id,
          active: instance.isConnected,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                instance.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                instance.phoneNumber?.trim().isNotEmpty == true
                    ? '+${instance.phoneNumber} · ${validity.label}'
                    : validity.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: validityColor,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        Text(
          selected ? 'Atual' : 'Trocar',
          style: TextStyle(
            color: selected ? wa.accent : wa.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _ProfileMenuAction extends StatelessWidget {
  const _ProfileMenuAction({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Row(
      children: [
        Icon(icon, color: wa.icon, size: 21),
        const SizedBox(width: 12),
        Text(
          label,
          style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}

class _ConversationProfileMenuHeader extends StatelessWidget {
  const _ConversationProfileMenuHeader({required this.instance});

  final BotInstance instance;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final validity = _profileValidity(instance);
    final color = _profileValidityColor(wa, validity);
    return Row(
      children: [
        _RailProfileAvatar(
          label: instance.name,
          instanceId: instance.id,
          active: instance.isConnected,
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                instance.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                validity.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: color,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
        Icon(Icons.swap_horiz_rounded, color: wa.icon, size: 20),
      ],
    );
  }
}

Future<void> _openNewConversationPanel(
  BuildContext context,
  WidgetRef ref,
  BotInstance? activeInstance,
) async {
  if (!await _ensureProfileAvailable(context, ref, activeInstance) ||
      !context.mounted) {
    return;
  }
  ref.read(newConversationSearchProvider.notifier).clear();
  ref
      .read(conversationUtilityPanelProvider.notifier)
      .show(ConversationUtilityPanel.newChat);
}

Future<void> _openInternalGroupCreate(
  BuildContext context,
  WidgetRef ref,
) async {
  final group = await showCreateInternalGroupDialog(context, ref);
  if (group == null) return;
  ref
      .read(dashboardSectionProvider.notifier)
      .select(DashboardSection.internalGroups);
  _openConversationThreadFromList(ref, group.toConversationThread());
}

Future<void> _openInternalGroupJoin(BuildContext context, WidgetRef ref) async {
  final group = await showJoinInternalGroupDialog(context, ref);
  if (group == null) return;
  ref
      .read(dashboardSectionProvider.notifier)
      .select(DashboardSection.internalGroups);
  _openConversationThreadFromList(ref, group.toConversationThread());
}

void _startProfileCreation(WidgetRef ref) {
  ref.read(profileCreationRequestProvider.notifier).request();
  ref.read(dashboardSectionProvider.notifier).select(DashboardSection.profiles);
}

Future<void> _confirmPanelLogout(BuildContext context, WidgetRef ref) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      backgroundColor: WaTheme.of(dialogContext).panel,
      title: const Text('Sair da conta?'),
      content: Text(
        'Sua sessão será encerrada neste dispositivo.',
        style: TextStyle(color: WaTheme.of(dialogContext).textSecondary),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Sair'),
        ),
      ],
    ),
  );
  if (ok == true) {
    await ref.read(authControllerProvider.notifier).logout();
  }
}

Future<void> _openQuickProfileSwitcher(
  BuildContext context,
  WidgetRef ref,
  List<BotInstance> instances,
  BotInstance? activeInstance,
) async {
  final selected = await showBotAdminBottomSheet<String>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    backgroundColor: WaTheme.of(context).panel,
    showDragHandle: true,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewPaddingOf(sheetContext).bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(sheetContext).height * .72,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 4, 18, 10),
              child: Text(
                'Perfis',
                style: TextStyle(
                  color: WaTheme.of(sheetContext).textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                children: [
                  for (final instance in instances)
                    Material(
                      color: activeInstance?.id == instance.id
                          ? WaTheme.of(sheetContext).accentSoft
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                      child: Row(
                        children: [
                          Expanded(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(8),
                              onTap: () => Navigator.of(
                                sheetContext,
                              ).pop('switch:${instance.id}'),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 8,
                                ),
                                child: _ProfileMenuRow(
                                  instance: instance,
                                  selected: activeInstance?.id == instance.id,
                                ),
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Renovar ${instance.name}',
                            onPressed: () => Navigator.of(
                              sheetContext,
                            ).pop('renew:${instance.id}'),
                            icon: const Icon(Icons.workspace_premium_outlined),
                          ),
                          const SizedBox(width: 4),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: OutlinedButton.icon(
                onPressed: () => Navigator.of(sheetContext).pop('new'),
                icon: const Icon(Icons.add_circle_outline_rounded),
                label: const Text('Novo perfil'),
              ),
            ),
          ],
        ),
      ),
    ),
  );
  if (!context.mounted || selected == null) return;
  if (selected == 'new') {
    await openCreateProfileSheet(context, ref);
    return;
  }
  if (selected.startsWith('renew:')) {
    final id = int.tryParse(selected.substring('renew:'.length));
    final instance = id == null
        ? null
        : instances.where((item) => item.id == id).firstOrNull;
    if (instance != null) await openRenewProfileSheet(context, ref, instance);
    return;
  }
  if (selected.startsWith('switch:')) {
    final id = int.tryParse(selected.substring('switch:'.length));
    if (id != null) {
      ref.read(selectedInstanceIdProvider.notifier).select(id);
      ref
          .read(dashboardSectionProvider.notifier)
          .select(DashboardSection.conversations);
    }
  }
}

String _profileInitial(String label) {
  final trimmed = label.trim();
  if (trimmed.isEmpty) return '?';
  return trimmed.characters.first.toUpperCase();
}

Future<void> _openMobileAppDownload(BuildContext context, WidgetRef ref) async {
  try {
    final update = await ref.read(apiClientProvider).loadMobileUpdate();
    final downloadUrl = update.downloadUrl?.trim();
    if (downloadUrl == null || downloadUrl.isEmpty) {
      if (context.mounted) {
        showErrorToast(context, 'Nenhum APK publicado no momento.');
      }
      return;
    }
    final parsed = _resolveMobileDownloadUri(downloadUrl);
    if (parsed == null || !parsed.hasScheme) {
      if (context.mounted) {
        showErrorToast(context, 'Link do aplicativo invalido.');
      }
      return;
    }
    final opened = await launchUrl(
      parsed,
      mode: LaunchMode.externalApplication,
    );
    if (!context.mounted) return;
    if (opened) {
      showSuccessToast(context, 'Download do aplicativo aberto.');
    } else {
      showErrorToast(context, 'Nao consegui abrir o download.');
    }
  } catch (error) {
    if (!context.mounted) return;
    showErrorToast(context, 'Falha ao buscar aplicativo: $error');
  }
}

Uri? _resolveMobileDownloadUri(String downloadUrl) {
  final parsed = Uri.tryParse(downloadUrl);
  if (parsed == null) return null;
  if (parsed.hasScheme) return parsed;

  final base = Uri.tryParse(AppConfig.apiBaseUrl);
  if (base == null || !base.hasScheme) return null;
  return base.resolveUri(parsed);
}

// ignore: unused_element
class _StatusList extends ConsumerWidget {
  const _StatusList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(botStatusSnapshotProvider(null));
    final session = ref.watch(authControllerProvider).value;
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _WhatsAppListHeader(
            title: 'Status',
            primaryIcon: Icons.add_circle_outline_rounded,
            primaryTooltip: 'Novo status',
            onPrimary: () => ref.invalidate(botStatusSnapshotProvider(null)),
            onRefresh: () => ref.invalidate(botStatusSnapshotProvider(null)),
          ),
          _MyStatusTile(
            avatarUrl: session?.user.avatarUrl,
            title: 'Meu status',
            subtitle: snapshot.maybeWhen(
              data: (data) => data.posts.isEmpty
                  ? 'Clique para atualizar seu status'
                  : '${data.posts.length} postagem(ns) enviada(s)',
              orElse: () => 'Clique para atualizar seu status',
            ),
          ),
          SizedBox(height: 66),
          const _SidebarSectionLabel('RECENTE'),
          Expanded(
            child: snapshot.when(
              data: (data) {
                final groups = _groupReceivedStatuses(data.receivedStatuses);
                if (groups.isEmpty) {
                  return const _SidebarEmptyMessage(
                    'Nenhuma atualização de status recebida.',
                  );
                }
                return ListView.builder(
                  padding: EdgeInsets.zero,
                  itemCount: groups.length,
                  itemBuilder: (context, index) {
                    final group = groups[index];
                    return _StatusContactTile(
                      group: group,
                      onTap: () => _openStatusViewer(context, group),
                    );
                  },
                );
              },
              error: (error, _) => _SidebarErrorMessage(
                message: error.toString(),
                onRetry: () => ref.invalidate(botStatusSnapshotProvider(null)),
              ),
              loading: () => Center(child: CircularProgressIndicator()),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChannelsList extends ConsumerWidget {
  const _ChannelsList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(botStatusSnapshotProvider(null));
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _WhatsAppListHeader(
            title: 'Canais',
            primaryIcon: Icons.add_circle_outline_rounded,
            primaryTooltip: 'Novo canal',
            onPrimary: () => ref.invalidate(botStatusSnapshotProvider(null)),
            onRefresh: () => ref.invalidate(botStatusSnapshotProvider(null)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(26, 8, 26, 12),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: wa.searchBg,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 22,
                      backgroundColor: wa.accentSoft,
                      child: Icon(Icons.campaign_outlined, color: wa.accent),
                    ),
                    SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        'Canais ficam separados de status e grupos.',
                        style: TextStyle(color: wa.textSecondary, fontSize: 15),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const _SidebarSectionLabel('CANAIS DO BOT'),
          Expanded(
            child: snapshot.when(
              data: (data) {
                final campaigns = [...data.campaigns]
                  ..sort((a, b) => a.name.compareTo(b.name));
                if (campaigns.isEmpty) {
                  return const _SidebarEmptyMessage(
                    'Nenhum canal ou campanha de status configurado.',
                  );
                }
                return ListView.builder(
                  padding: EdgeInsets.zero,
                  itemCount: campaigns.length,
                  itemBuilder: (context, index) {
                    return _ChannelTile(campaign: campaigns[index]);
                  },
                );
              },
              error: (error, _) => _SidebarErrorMessage(
                message: error.toString(),
                onRetry: () => ref.invalidate(botStatusSnapshotProvider(null)),
              ),
              loading: () => Center(child: CircularProgressIndicator()),
            ),
          ),
        ],
      ),
    );
  }
}

class _CommunitiesList extends StatelessWidget {
  const _CommunitiesList({required this.data});

  final DashboardSnapshot data;

  @override
  Widget build(BuildContext context) {
    final groups = [...data.groups]..sort((a, b) => a.name.compareTo(b.name));
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _WhatsAppListHeader(
            title: 'Comunidades',
            primaryIcon: Icons.add_circle_outline_rounded,
            primaryTooltip: 'Nova comunidade',
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(26, 8, 26, 28),
            child: Row(
              children: [
                Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    color: wa.avatarFallback,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(Icons.groups_2_rounded, color: wa.icon, size: 30),
                ),
                SizedBox(width: 16),
                Expanded(
                  child: Text(
                    'Nova comunidade',
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontWeight: FontWeight.w700,
                      fontSize: 17,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: wa.divider),
          SizedBox(height: 22),
          const _SidebarSectionLabel('COMUNIDADES'),
          Expanded(
            child: groups.isEmpty
                ? const _SidebarEmptyMessage('Nenhuma comunidade encontrada.')
                : ListView.builder(
                    padding: EdgeInsets.zero,
                    itemCount: groups.length,
                    itemBuilder: (context, index) {
                      return _CommunityTile(group: groups[index]);
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _WhatsAppLandingPane extends StatelessWidget {
  const _WhatsAppLandingPane({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.contentBg,
      child: Align(
        alignment: const Alignment(0, -0.18),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 720),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 58, color: wa.textMuted),
              SizedBox(height: 30),
              Text(
                title,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 32,
                  fontWeight: FontWeight.w400,
                  letterSpacing: 0,
                ),
              ),
              SizedBox(height: 16),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: wa.textSecondary,
                  fontSize: 16,
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WhatsAppListHeader extends ConsumerWidget {
  const _WhatsAppListHeader({
    required this.title,
    required this.primaryIcon,
    required this.primaryTooltip,
    this.onPrimary,
    this.onRefresh,
  });

  final String title;
  final IconData primaryIcon;
  final String primaryTooltip;
  final VoidCallback? onPrimary;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(26, 24, 24, 24),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w500,
                color: wa.textPrimary,
              ),
            ),
          ),
          IconButton(
            onPressed: onPrimary,
            icon: Icon(primaryIcon, color: wa.icon),
            tooltip: primaryTooltip,
          ),
          PopupMenuButton<_ListAction>(
            tooltip: 'Mais',
            icon: Icon(Icons.more_vert_rounded, color: wa.icon),
            color: wa.menuBg,
            onSelected: (action) async {
              switch (action) {
                case _ListAction.refresh:
                  onRefresh?.call();
                  break;
                case _ListAction.downloadApp:
                  await _openMobileAppDownload(context, ref);
                  break;
                default:
                  break;
              }
            },
            itemBuilder: (context) => const [
              PopupMenuItem(
                value: _ListAction.refresh,
                child: ListTile(
                  leading: Icon(Icons.refresh_rounded),
                  title: Text('Atualizar'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuItem(
                value: _ListAction.downloadApp,
                child: ListTile(
                  leading: Icon(Icons.android_rounded),
                  title: Text('Baixar aplicativo'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Logo + "Bot Admin" + troca de tema (dark/clean).
class _BotAdminBrandHeader extends ConsumerWidget {
  const _BotAdminBrandHeader();

  static const Color _adminGreen = Color(0xFF12E86A);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeControllerProvider);
    final isDark = themeMode == AppThemeMode.dark;
    final titleColor = isDark
        ? const Color(0xFFE9EDEF)
        : const Color(0xFF111B21);

    return Row(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.asset(
            'assets/brand/botadmin-logo.png',
            width: 34,
            height: 34,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) {
              // Fallback: tenta webp; nunca monograma "BA".
              return Image.asset(
                'assets/brand/botadmin-logo.webp',
                width: 34,
                height: 34,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) {
                  return Container(
                    width: 34,
                    height: 34,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(10),
                      gradient: const LinearGradient(
                        colors: [Color(0xFF12E86A), Color(0xFF00A884)],
                      ),
                    ),
                    child: const Icon(
                      Icons.smart_toy_rounded,
                      color: Colors.white,
                      size: 20,
                    ),
                  );
                },
              );
            },
          ),
        ),
        SizedBox(width: 10),
        Flexible(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: 'Bot ',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: titleColor,
                    height: 1.1,
                  ),
                ),
                TextSpan(
                  text: 'Admin',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: _adminGreen,
                    height: 1.1,
                    letterSpacing: 0.2,
                    shadows: isDark
                        ? [
                            Shadow(
                              color: _adminGreen.withValues(alpha: 0.35),
                              blurRadius: 8,
                            ),
                          ]
                        : null,
                  ),
                ),
              ],
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _SidebarSectionLabel extends StatelessWidget {
  const _SidebarSectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(32, 0, 26, 22),
      child: Text(
        label,
        style: TextStyle(
          color: wa.textSecondary,
          fontSize: 16,
          fontWeight: FontWeight.w500,
          letterSpacing: 0,
        ),
      ),
    );
  }
}

class _MyStatusTile extends StatelessWidget {
  const _MyStatusTile({
    required this.title,
    required this.subtitle,
    this.avatarUrl,
  });

  final String title;
  final String subtitle;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(26, 10, 26, 0),
      child: Row(
        children: [
          SizedBox(
            width: 58,
            height: 58,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(
                  child: _AvatarImage(
                    isGroup: false,
                    active: false,
                    avatarUrl: avatarUrl,
                  ),
                ),
                Positioned(
                  right: -2,
                  bottom: -2,
                  child: Container(
                    width: 24,
                    height: 24,
                    decoration: BoxDecoration(
                      color: wa.accent,
                      shape: BoxShape.circle,
                      border: Border.all(color: wa.panel, width: 2),
                    ),
                    child: const Icon(
                      Icons.add_rounded,
                      size: 17,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 19,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                SizedBox(height: 4),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: wa.textMuted, fontSize: 16),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusContactTile extends StatelessWidget {
  const _StatusContactTile({required this.group, required this.onTap});

  final _StatusAuthorGroup group;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: wa.panel,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.fromLTRB(26, 0, 26, 22),
          child: Row(
            children: [
              _StatusRingAvatar(
                label: group.name,
                avatarUrl: group.avatarUrl,
                segments: group.items.length,
              ),
              SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      group.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: WaTheme.of(context).textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    SizedBox(height: 5),
                    Text(
                      _formatStatusTime(group.latest.createdAt),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: WaTheme.of(context).textMuted,
                        fontSize: 16,
                      ),
                    ),
                  ],
                ),
              ),
              if (group.items.length > 1)
                Text(
                  group.items.length.toString(),
                  style: const TextStyle(
                    color: Color(0xFF00A884),
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusRingAvatar extends StatelessWidget {
  const _StatusRingAvatar({
    required this.label,
    this.avatarUrl,
    this.segments = 1,
    this.size = 58,
  });

  final String label;
  final String? avatarUrl;
  final int segments;
  final double size;

  @override
  Widget build(BuildContext context) {
    final initial = label.trim().isEmpty
        ? '?'
        : label.trim().characters.first.toUpperCase();
    final url = _absoluteUrl(avatarUrl);
    final segmentCount = segments.clamp(1, 12);
    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(3),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: Color(0xFF00A884),
          width: segmentCount > 1 ? 3 : 2.6,
        ),
      ),
      child: url == null
          ? CircleAvatar(
              backgroundColor: WaTheme.of(context).avatarFallback,
              child: Text(
                initial,
                style: TextStyle(
                  color: Color(0xFF3B4A54),
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
            )
          : ClipOval(
              child: BotAdminCachedImage(
                imageUrl: url,
                width: size - 8,
                height: size - 8,
                fit: BoxFit.cover,
                errorWidget: (context, _, _) => CircleAvatar(
                  backgroundColor: WaTheme.of(context).avatarFallback,
                  child: Text(
                    initial,
                    style: const TextStyle(
                      color: Color(0xFF3B4A54),
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}

class _StatusAuthorGroup {
  const _StatusAuthorGroup({required this.key, required this.items});

  final String key;
  final List<ReceivedStatus> items;

  ReceivedStatus get latest => items.first;

  String get name => latest.senderName.trim().isEmpty
      ? latest.authorKey
      : latest.senderName.trim();

  String? get avatarUrl => latest.avatarUrl;
}

List<_StatusAuthorGroup> _groupReceivedStatuses(List<ReceivedStatus> statuses) {
  final grouped = <String, List<ReceivedStatus>>{};
  for (final status in statuses) {
    final key = status.authorKey.trim().isNotEmpty
        ? status.authorKey.trim().toLowerCase()
        : status.senderName.trim().toLowerCase();
    if (key.isEmpty) continue;
    grouped.putIfAbsent(key, () => []).add(status);
  }
  final result = grouped.entries.map((entry) {
    final items = [...entry.value]
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return _StatusAuthorGroup(key: entry.key, items: items);
  }).toList();
  result.sort((a, b) => b.latest.createdAt.compareTo(a.latest.createdAt));
  return result;
}

Future<void> _openStatusViewer(BuildContext context, _StatusAuthorGroup group) {
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Fechar status',
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 140),
    pageBuilder: (context, animation, secondaryAnimation) {
      return _StatusViewerDialog(group: group);
    },
  );
}

class _StatusViewerDialog extends StatefulWidget {
  const _StatusViewerDialog({required this.group});

  final _StatusAuthorGroup group;

  @override
  State<_StatusViewerDialog> createState() => _StatusViewerDialogState();
}

class _StatusViewerDialogState extends State<_StatusViewerDialog> {
  int _index = 0;

  ReceivedStatus get _status => widget.group.items[_index];

  void _previous() {
    if (_index <= 0) return;
    setState(() => _index--);
  }

  void _next() {
    if (_index >= widget.group.items.length - 1) {
      Navigator.of(context).maybePop();
      return;
    }
    setState(() => _index++);
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final storyHeight = (constraints.maxHeight - 84).clamp(560.0, 860.0);
          final storyWidth = (storyHeight * 0.56).clamp(360.0, 520.0);
          return Stack(
            children: [
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.black.withValues(alpha: 0.52),
                        const Color(0xFF6F7478).withValues(alpha: 0.72),
                        Colors.black.withValues(alpha: 0.52),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 26,
                left: 28,
                child: IconButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  icon: const Icon(Icons.arrow_back_rounded),
                  color: Colors.white,
                  iconSize: 32,
                  tooltip: 'Voltar',
                ),
              ),
              Positioned(
                top: 26,
                right: 28,
                child: IconButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  icon: const Icon(Icons.close_rounded),
                  color: Colors.white,
                  iconSize: 34,
                  tooltip: 'Fechar',
                ),
              ),
              Center(
                child: SizedBox(
                  width: storyWidth,
                  height: storyHeight,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        _StatusStoryMedia(status: _status),
                        Positioned.fill(
                          child: Row(
                            children: [
                              Expanded(
                                child: GestureDetector(
                                  behavior: HitTestBehavior.translucent,
                                  onTap: _previous,
                                ),
                              ),
                              Expanded(
                                child: GestureDetector(
                                  behavior: HitTestBehavior.translucent,
                                  onTap: _next,
                                ),
                              ),
                            ],
                          ),
                        ),
                        _StatusStoryTopOverlay(
                          group: widget.group,
                          status: _status,
                          index: _index,
                        ),
                        if ((_status.bodyText ?? '').trim().isNotEmpty)
                          Positioned(
                            left: 0,
                            right: 0,
                            bottom: 0,
                            child: _StatusStoryCaption(text: _status.bodyText!),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
              if (_index > 0)
                Positioned(
                  left: 28,
                  top: constraints.maxHeight / 2 - 28,
                  child: _StatusRoundButton(
                    icon: Icons.chevron_left_rounded,
                    onPressed: _previous,
                  ),
                ),
              Positioned(
                right: 28,
                top: constraints.maxHeight / 2 - 28,
                child: _StatusRoundButton(
                  icon: Icons.chevron_right_rounded,
                  onPressed: _next,
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 26,
                child: _StatusReplyBar(width: storyWidth + 300),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _StatusStoryMedia extends StatelessWidget {
  const _StatusStoryMedia({required this.status});

  final ReceivedStatus status;

  @override
  Widget build(BuildContext context) {
    final mediaUrl = _absoluteUrl(status.mediaUrl);
    if (mediaUrl != null && status.isImage) {
      return BotAdminCachedImage(
        imageUrl: mediaUrl,
        fit: BoxFit.cover,
        placeholder: (context, _) => ColoredBox(
          color: WaTheme.of(context).textPrimary,
          child: Center(child: CircularProgressIndicator(color: Colors.white)),
        ),
        errorWidget: (context, _, _) => _StatusTextStory(status: status),
      );
    }
    if (mediaUrl != null && status.isVideo) {
      return ColoredBox(
        color: WaTheme.of(context).textPrimary,
        child: LayoutBuilder(
          builder: (context, constraints) {
            return Center(
              child: InlineVideoPlayer(
                url: mediaUrl,
                width: constraints.maxWidth,
                height: constraints.maxHeight,
                borderRadius: BorderRadius.zero,
                title: status.bodyText ?? 'Vídeo de status',
              ),
            );
          },
        ),
      );
    }
    if (mediaUrl != null && !status.isImage && !status.isVideo) {
      return ColoredBox(
        color: WaTheme.of(context).textPrimary,
        child: Center(
          child: InlineAudioPlayer(
            url: mediaUrl,
            title: status.bodyText ?? 'Status',
            compact: true,
          ),
        ),
      );
    }
    return _StatusTextStory(status: status);
  }
}

class _StatusTextStory extends StatelessWidget {
  const _StatusTextStory({required this.status});

  final ReceivedStatus status;

  @override
  Widget build(BuildContext context) {
    final text = (status.bodyText ?? '').trim();
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1F3A5F), Color(0xFF13202F)],
        ),
      ),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(36),
          child: Text(
            text.isEmpty ? 'Status sem prévia de mídia' : text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 30,
              height: 1.22,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusStoryTopOverlay extends StatelessWidget {
  const _StatusStoryTopOverlay({
    required this.group,
    required this.status,
    required this.index,
  });

  final _StatusAuthorGroup group;
  final ReceivedStatus status;
  final int index;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 0,
      right: 0,
      top: 0,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xAA000000), Color(0x00000000)],
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 14, 10, 42),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: List.generate(group.items.length, (entryIndex) {
                  return Expanded(
                    child: Container(
                      height: 4,
                      margin: EdgeInsets.only(
                        right: entryIndex == group.items.length - 1 ? 0 : 5,
                      ),
                      decoration: BoxDecoration(
                        color: entryIndex <= index
                            ? Colors.white
                            : Colors.white.withValues(alpha: 0.36),
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  );
                }),
              ),
              SizedBox(height: 18),
              Row(
                children: [
                  _StatusRingAvatar(
                    label: group.name,
                    avatarUrl: group.avatarUrl,
                    segments: group.items.length,
                    size: 46,
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          group.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          '${_formatStatusTime(status.createdAt)} · 0:00',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.pause_rounded,
                    color: Colors.white,
                    size: 30,
                  ),
                  SizedBox(width: 12),
                  const Icon(
                    Icons.volume_off_rounded,
                    color: Colors.white,
                    size: 26,
                  ),
                  SizedBox(width: 10),
                  const Icon(
                    Icons.more_vert_rounded,
                    color: Colors.white,
                    size: 28,
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

class _StatusStoryCaption extends StatelessWidget {
  const _StatusStoryCaption({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x00000000), Color(0xAA000000)],
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(26, 54, 26, 26),
        child: Text(
          text,
          maxLines: 4,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 18,
            height: 1.28,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _StatusRoundButton extends StatelessWidget {
  const _StatusRoundButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton.filled(
      style: IconButton.styleFrom(
        backgroundColor: Colors.black.withValues(alpha: 0.48),
        foregroundColor: Colors.white,
      ),
      onPressed: onPressed,
      icon: Icon(icon, size: 34),
      tooltip: 'Próximo status',
    );
  }
}

class _StatusReplyBar extends StatelessWidget {
  const _StatusReplyBar({required this.width});

  final double width;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: width.clamp(520, 900).toDouble()),
        child: Row(
          children: [
            IconButton(
              onPressed: () {},
              icon: const Icon(Icons.emoji_emotions_outlined),
              color: Colors.white,
              iconSize: 28,
              tooltip: 'Emoji',
            ),
            SizedBox(width: 8),
            Expanded(
              child: Container(
                height: 52,
                alignment: Alignment.centerLeft,
                padding: const EdgeInsets.symmetric(horizontal: 22),
                decoration: BoxDecoration(
                  color: const Color(0xFF202C33).withValues(alpha: 0.92),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'Digite uma resposta...',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
            SizedBox(width: 12),
            IconButton(
              onPressed: () {},
              icon: const Icon(Icons.send_rounded),
              color: Colors.white,
              iconSize: 30,
              tooltip: 'Enviar',
            ),
          ],
        ),
      ),
    );
  }
}

class _ChannelTile extends StatelessWidget {
  const _ChannelTile({required this.campaign});

  final StatusCampaign campaign;

  @override
  Widget build(BuildContext context) {
    final active = campaign.status.toLowerCase() == 'active';
    return Padding(
      padding: EdgeInsets.fromLTRB(26, 0, 26, 12),
      child: Row(
        children: [
          CircleAvatar(
            radius: 29,
            backgroundColor: active
                ? const Color(0xFFD9FDD3)
                : const Color(0xFFE9EDEF),
            child: Icon(
              Icons.campaign_outlined,
              color: active ? const Color(0xFF008069) : const Color(0xFF54656F),
            ),
          ),
          SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  campaign.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: WaTheme.of(context).textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                SizedBox(height: 5),
                Text(
                  '${campaign.contentCount} conteúdo(s) · ${campaign.scheduleKind}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: WaTheme.of(context).textMuted,
                    fontSize: 15,
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

class _CommunityTile extends StatelessWidget {
  const _CommunityTile({required this.group});

  final BotGroup group;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(26, 0, 26, 18),
      child: Row(
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: WaTheme.of(context).divider,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(
              Icons.groups_2_rounded,
              color: WaTheme.of(context).icon,
            ),
          ),
          SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  group.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: WaTheme.of(context).textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                SizedBox(height: 5),
                Text(
                  group.botEnabled ? 'Comunidade ativa' : 'Comunidade pausada',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: WaTheme.of(context).textMuted,
                    fontSize: 15,
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

class _SidebarEmptyMessage extends StatelessWidget {
  const _SidebarEmptyMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: 32, vertical: 18),
      child: Text(
        message,
        style: TextStyle(color: WaTheme.of(context).textMuted, fontSize: 15),
      ),
    );
  }
}

class _SidebarErrorMessage extends StatelessWidget {
  const _SidebarErrorMessage({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center),
          SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Atualizar'),
          ),
        ],
      ),
    );
  }
}

class _WhatsAppFilterBar extends StatelessWidget {
  const _WhatsAppFilterBar({
    required this.filter,
    required this.unreadCount,
    required this.privateCount,
    required this.groupCount,
    required this.internalGroupCount,
    required this.channelCount,
    required this.communityCount,
    required this.onChanged,
  });

  final ConversationListFilter filter;
  final int unreadCount;
  final int privateCount;
  final int groupCount;
  final int internalGroupCount;
  final int channelCount;
  final int communityCount;
  final ValueChanged<ConversationListFilter> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 36,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          _FilterPill(
            label: 'Tudo',
            selected: filter == ConversationListFilter.all,
            onTap: () => onChanged(ConversationListFilter.all),
          ),
          SizedBox(width: 6),
          _FilterPill(
            label: 'Não lidas $unreadCount',
            selected: filter == ConversationListFilter.unread,
            onTap: () => onChanged(ConversationListFilter.unread),
          ),
          SizedBox(width: 6),
          _FilterPill(
            label: 'PV $privateCount',
            selected: filter == ConversationListFilter.privateChats,
            onTap: () => onChanged(ConversationListFilter.privateChats),
          ),
          SizedBox(width: 6),
          _FilterPill(
            label: 'Grupos $groupCount',
            selected: filter == ConversationListFilter.groups,
            onTap: () => onChanged(ConversationListFilter.groups),
          ),
          SizedBox(width: 6),
          _FilterPill(
            label: 'BotAdmin $internalGroupCount',
            selected: filter == ConversationListFilter.internalGroups,
            onTap: () => onChanged(ConversationListFilter.internalGroups),
          ),
          SizedBox(width: 6),
          _FilterPill(
            label: 'Canais $channelCount',
            selected: filter == ConversationListFilter.channels,
            onTap: () => onChanged(ConversationListFilter.channels),
          ),
          SizedBox(width: 6),
          _FilterPill(
            label: 'Comunidades $communityCount',
            selected: filter == ConversationListFilter.communities,
            onTap: () => onChanged(ConversationListFilter.communities),
          ),
          SizedBox(width: 6),
          const _RoundFilterButton(),
        ],
      ),
    );
  }
}

class _FilterPill extends StatelessWidget {
  const _FilterPill({required this.label, this.selected = false, this.onTap});

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Container(
          height: 34,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? wa.filterChipActive : wa.filterChip,
            borderRadius: BorderRadius.circular(17),
            border: Border.all(
              color: selected ? wa.accent.withValues(alpha: 0.35) : wa.border,
            ),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: selected ? wa.filterChipTextActive : wa.filterChipText,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

class _RoundFilterButton extends StatelessWidget {
  const _RoundFilterButton();

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      width: 36,
      height: 34,
      decoration: BoxDecoration(
        color: wa.panel,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: wa.border),
      ),
      child: Icon(Icons.keyboard_arrow_down_rounded, color: wa.icon),
    );
  }
}

class _AvatarImage extends ConsumerStatefulWidget {
  const _AvatarImage({
    required this.isGroup,
    required this.active,
    this.isSupport = false,
    this.avatarUrl,
    this.onError,
    this.deferNetworkLoad = false,
  });

  final bool isGroup;
  final bool isSupport;
  final bool active;
  final String? avatarUrl;
  final VoidCallback? onError;
  final bool deferNetworkLoad;

  @override
  ConsumerState<_AvatarImage> createState() => _AvatarImageState();
}

class _AvatarImageState extends ConsumerState<_AvatarImage> {
  bool _errorNotified = false;
  String? _resolvedUrl;

  @override
  void initState() {
    super.initState();
    _resolvedUrl = _absoluteUrl(widget.avatarUrl);
  }

  @override
  void didUpdateWidget(covariant _AvatarImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.avatarUrl != widget.avatarUrl) {
      _errorNotified = false;
      _resolvedUrl = _absoluteUrl(widget.avatarUrl);
    }
  }

  @override
  Widget build(BuildContext context) {
    final url = _resolvedUrl;

    if (url != null) {
      if (widget.deferNetworkLoad) {
        return _fallback();
      }
      return ClipOval(
        child: BotAdminCachedImage(
          imageUrl: url,
          width: 49,
          height: 49,
          memCacheWidth: 64,
          memCacheHeight: 64,
          maxWidthDiskCache: 96,
          maxHeightDiskCache: 96,
          fit: BoxFit.cover,
          fadeInDuration: Duration.zero,
          fadeOutDuration: Duration.zero,
          placeholderFadeInDuration: Duration.zero,
          useOldImageOnUrlChange: false,
          filterQuality: FilterQuality.low,
          placeholder: (context, _) => _fallback(),
          errorWidget: (context, _, _) {
            if (!_errorNotified) {
              _errorNotified = true;
              final callback = widget.onError;
              if (callback != null) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  callback();
                });
              }
            }
            return _fallback();
          },
        ),
      );
    }
    return _fallback();
  }

  Widget _fallback() {
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: widget.active ? wa.accentSoft : wa.avatarFallback,
      child: SizedBox(
        width: 49,
        height: 49,
        child: Icon(
          widget.isSupport
              ? Icons.support_agent_rounded
              : widget.isGroup
              ? Icons.groups_rounded
              : Icons.person_rounded,
          color: widget.active ? wa.accent : wa.icon,
          size: 24,
        ),
      ),
    );
  }
}

String? _firstNonEmptyString(Iterable<String?> values) {
  for (final value in values) {
    final trimmed = value?.trim();
    if (trimmed != null && trimmed.isNotEmpty) return trimmed;
  }
  return null;
}

String? _absoluteUrl(String? value) {
  if (value == null || value.trim().isEmpty) return null;
  final raw = value.trim();
  if (raw.startsWith('https://pps.whatsapp.net/')) {
    return '${AppConfig.apiBaseUrl}/api/whatsapp-avatar-proxy?url=${Uri.encodeComponent(raw)}';
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  final normalized = raw.startsWith('/') ? raw : '/$raw';
  return '${AppConfig.apiBaseUrl}$normalized';
}

String _conversationAvatarUrl(int instanceId, String chatJid) {
  final encodedJid = Uri.encodeComponent(chatJid.trim());
  return '/api/bot-instances/$instanceId/whatsapp-conversations/$encodedJid/avatar';
}

String _instanceProfileAvatarUrl(int instanceId) {
  return '/api/bot-instances/$instanceId/profile/avatar';
}

/// Precomputed row model so scroll rebuilds avoid string/date work.
class _PreparedConversation {
  const _PreparedConversation({
    required this.thread,
    required this.group,
    required this.title,
    required this.preview,
    required this.timeLabel,
    required this.unread,
    required this.avatarUrl,
    required this.isGroup,
    required this.isSupport,
    required this.instanceId,
    required this.chatJid,
    required this.rowKey,
  });

  final ConversationThread thread;
  final BotGroup? group;
  final String title;
  final String preview;
  final String timeLabel;
  final int unread;
  final String? avatarUrl;
  final bool isGroup;
  final bool isSupport;
  final int instanceId;
  final String chatJid;
  final String rowKey;
}

class _ConversationList extends ConsumerStatefulWidget {
  const _ConversationList({
    required this.data,
    this.showTopHeader = true,
    this.fixedFilter,
  });

  final DashboardSnapshot data;
  final bool showTopHeader;
  final ConversationListFilter? fixedFilter;

  @override
  ConsumerState<_ConversationList> createState() => _ConversationListState();
}

class _ConversationListState extends ConsumerState<_ConversationList> {
  static final Map<String, double> _savedScrollOffsets = <String, double>{};

  late ScrollController _scrollController;
  late String _scrollStorageKey;

  String _resolveScrollStorageKey() {
    final selectedId = ref.read(selectedInstanceIdProvider);
    final active = _resolveActiveInstance(widget.data.instances, selectedId);
    final userId = ref.read(authControllerProvider).value?.user.id ?? 0;
    return '$userId:${active?.id ?? selectedId ?? 0}';
  }

  void _saveScrollOffset() {
    if (!_scrollController.hasClients) return;
    _savedScrollOffsets[_scrollStorageKey] = _scrollController.offset;
  }

  ScrollController _createScrollController(String key) {
    return ScrollController(initialScrollOffset: _savedScrollOffsets[key] ?? 0)
      ..addListener(_saveScrollOffset);
  }

  @override
  void initState() {
    super.initState();
    _scrollStorageKey = _resolveScrollStorageKey();
    _scrollController = _createScrollController(_scrollStorageKey);
  }

  @override
  void didUpdateWidget(covariant _ConversationList oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextKey = _resolveScrollStorageKey();
    if (nextKey == _scrollStorageKey) return;
    _saveScrollOffset();
    _scrollController.removeListener(_saveScrollOffset);
    _scrollController.dispose();
    _scrollStorageKey = nextKey;
    _scrollController = _createScrollController(nextKey);
  }

  @override
  void dispose() {
    _saveScrollOffset();
    _scrollController.removeListener(_saveScrollOffset);
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = ref.watch(conversationSearchProvider).trim().toLowerCase();
    final ConversationListFilter filter =
        widget.fixedFilter ?? ref.watch(conversationListFilterProvider);
    final readConversationKeys = ref.watch(readConversationKeysProvider);
    final data = widget.data;
    final safeThreads = _safeConversationThreads(data.threads)
        .map((thread) {
          return readConversationKeys.contains(_conversationThreadKey(thread))
              ? thread.copyWith(unreadCount: 0)
              : thread;
        })
        .toList(growable: false);
    final visibleThreads = _filterConversationThreads(safeThreads, filter);
    final threads = query.isEmpty
        ? visibleThreads
        : visibleThreads
              .where((thread) {
                return thread.title.toLowerCase().contains(query) ||
                    thread.chatJid.toLowerCase().contains(query) ||
                    thread.lastMessage.toLowerCase().contains(query);
              })
              .toList(growable: false);

    // O(1) group lookup instead of scanning groups for every row.
    final groupsByJid = <String, BotGroup>{
      for (final group in data.groups)
        if (group.remoteJid.trim().isNotEmpty)
          _normalizeConversationJidKey(group.remoteJid): group,
    };

    var unreadCount = 0;
    var privateCount = 0;
    var groupCount = 0;
    var internalGroupCount = 0;
    var channelCount = 0;
    var communityCount = 0;
    for (final thread in safeThreads) {
      unreadCount += thread.unreadCount;
      if (thread.isInternalGroup) {
        internalGroupCount += 1;
      } else if (thread.isCommunity) {
        communityCount += 1;
      } else if (thread.isChannel) {
        channelCount += 1;
      } else if (thread.isGroup) {
        groupCount += 1;
      } else if (_isPrivateConversationThread(thread)) {
        privateCount += 1;
      }
    }

    _PreparedConversation prepareThread(ConversationThread thread) {
      final group = thread.isGroup
          ? groupsByJid[_normalizeConversationJidKey(thread.chatJid)]
          : null;
      final groupTitle = group?.name.trim();
      final displayTitle =
          thread.isGroup && groupTitle != null && groupTitle.isNotEmpty
          ? groupTitle
          : thread.title;
      return _PreparedConversation(
        thread: thread,
        group: group,
        title: displayTitle,
        preview: thread.previewText,
        timeLabel: _formatThreadTime(thread.lastActivity),
        unread: thread.unreadCount,
        avatarUrl: thread.isSupport
            ? thread.avatarUrl
            : _firstNonEmptyString([thread.avatarUrl, group?.avatarUrl]) ??
                  _conversationAvatarUrl(thread.instanceId, thread.chatJid),
        isGroup: thread.isGroup,
        isSupport: thread.isSupport,
        instanceId: thread.instanceId,
        chatJid: thread.chatJid,
        rowKey: '${thread.instanceId}|${thread.chatJid}',
      );
    }

    final wa = WaTheme.of(context);
    final isDark = wa.isDark;
    final compact = MediaQuery.sizeOf(context).width < 860;
    final activeInstance = _resolveActiveInstance(
      data.instances,
      ref.watch(selectedInstanceIdProvider),
    );
    if (compact && activeInstance != null) {
      ref.watch(instanceProfileAvatarBytesProvider(activeInstance.id));
    }
    return ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: wa.panel,
            padding: const EdgeInsets.fromLTRB(22, 16, 14, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (widget.showTopHeader)
                  Row(
                    children: [
                      const Expanded(child: _BotAdminBrandHeader()),
                      if (!compact)
                        IconButton(
                          constraints: const BoxConstraints.tightFor(
                            width: 40,
                            height: 40,
                          ),
                          onPressed: () => unawaited(
                            filter == ConversationListFilter.internalGroups
                                ? _openInternalGroupCreate(context, ref)
                                : _openNewConversationPanel(
                                    context,
                                    ref,
                                    activeInstance,
                                  ),
                          ),
                          icon: Icon(
                            Icons.add_box_outlined,
                            size: 23,
                            color: wa.icon,
                          ),
                          tooltip: 'Nova conversa',
                        ),
                      if (!compact)
                        IconButton(
                          constraints: const BoxConstraints.tightFor(
                            width: 40,
                            height: 40,
                          ),
                          onPressed: () => _confirmPanelLogout(context, ref),
                          icon: Icon(
                            Icons.logout_rounded,
                            size: 22,
                            color: wa.icon,
                          ),
                          tooltip: 'Sair',
                        ),
                      PopupMenuButton<_ListAction>(
                        tooltip: 'Mais',
                        icon: Icon(
                          Icons.more_vert_rounded,
                          size: 25,
                          color: wa.icon,
                        ),
                        padding: EdgeInsets.zero,
                        offset: const Offset(0, 42),
                        color: wa.menuBg,
                        surfaceTintColor: Colors.transparent,
                        elevation: 8,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                        constraints: BoxConstraints(
                          minWidth: compact ? 272 : 220,
                          maxWidth: compact ? 300 : 224,
                        ),
                        onSelected: (action) => _handleConversationMenuAction(
                          context,
                          ref,
                          action,
                          safeThreads,
                          data.instances,
                          activeInstance,
                        ),
                        itemBuilder: (context) => [
                          if (filter == ConversationListFilter.internalGroups)
                            const PopupMenuItem(
                              height: 36,
                              value: _ListAction.newInternalGroup,
                              child: _WhatsAppMenuItem(
                                icon: Icons.group_add_rounded,
                                label: 'Criar grupo BotAdmin',
                              ),
                            ),
                          if (filter == ConversationListFilter.internalGroups)
                            const PopupMenuItem(
                              height: 36,
                              value: _ListAction.joinInternalGroup,
                              child: _WhatsAppMenuItem(
                                icon: Icons.add_link_rounded,
                                label: 'Entrar com convite',
                              ),
                            ),
                          if (filter == ConversationListFilter.internalGroups)
                            const PopupMenuDivider(height: 8),
                          if (compact && activeInstance != null)
                            PopupMenuItem(
                              height: 62,
                              value: _ListAction.profileSwitcher,
                              child: _ConversationProfileMenuHeader(
                                instance: activeInstance,
                              ),
                            ),
                          if (compact && activeInstance != null)
                            const PopupMenuItem(
                              height: 36,
                              value: _ListAction.renewProfile,
                              child: _WhatsAppMenuItem(
                                icon: Icons.workspace_premium_outlined,
                                label: 'Renovar perfil',
                              ),
                            ),
                          if (compact)
                            const PopupMenuItem(
                              height: 36,
                              value: _ListAction.newProfile,
                              child: _WhatsAppMenuItem(
                                icon: Icons.add_circle_outline_rounded,
                                label: 'Novo perfil',
                              ),
                            ),
                          if (compact)
                            const PopupMenuItem(
                              height: 36,
                              value: _ListAction.newConversation,
                              child: _WhatsAppMenuItem(
                                icon: Icons.add_comment_outlined,
                                label: 'Nova conversa',
                              ),
                            ),
                          if (compact) const PopupMenuDivider(height: 8),
                          const PopupMenuItem(
                            height: 36,
                            value: _ListAction.support,
                            child: _WhatsAppMenuItem(
                              icon: Icons.support_agent_rounded,
                              label: 'Falar com o suporte',
                            ),
                          ),
                          PopupMenuItem(
                            height: 36,
                            value: _ListAction.toggleTheme,
                            child: _WhatsAppMenuItem(
                              icon: isDark
                                  ? Icons.light_mode_rounded
                                  : Icons.dark_mode_rounded,
                              label: isDark ? 'Tema clean' : 'Tema dark',
                            ),
                          ),
                          const PopupMenuItem(
                            height: 36,
                            value: _ListAction.settings,
                            child: _WhatsAppMenuItem(
                              icon: Icons.settings_outlined,
                              label: 'Configurações',
                            ),
                          ),
                          const PopupMenuItem(
                            height: 36,
                            value: _ListAction.downloadApp,
                            child: _WhatsAppMenuItem(
                              icon: Icons.android_rounded,
                              label: 'Baixar aplicativo',
                            ),
                          ),
                          const PopupMenuDivider(height: 8),
                          const PopupMenuItem(
                            height: 36,
                            value: _ListAction.favoriteMessages,
                            child: _WhatsAppMenuItem(
                              icon: Icons.star_border_rounded,
                              label: 'Mensagens favoritas',
                            ),
                          ),
                          if (activeInstance != null)
                            const PopupMenuItem(
                              height: 36,
                              value: _ListAction.resyncHistory,
                              child: _WhatsAppMenuItem(
                                icon: Icons.sync_rounded,
                                label: 'Resincronizar histórico',
                              ),
                            ),
                          PopupMenuItem(
                            height: 36,
                            value: _ListAction.selectConversations,
                            child: _WhatsAppMenuItem(
                              icon: Icons.check_box_outlined,
                              label: 'Selecionar conversas',
                            ),
                          ),
                          PopupMenuItem(
                            height: 36,
                            value: _ListAction.lists,
                            child: _WhatsAppMenuItem(
                              icon: Icons.contacts_outlined,
                              label: 'Listas',
                            ),
                          ),
                          PopupMenuItem(
                            height: 36,
                            value: _ListAction.markAllRead,
                            child: _WhatsAppMenuItem(
                              icon: Icons.mark_chat_read_outlined,
                              label: 'Marcar todas como lidas',
                            ),
                          ),
                          const PopupMenuDivider(height: 8),
                          const PopupMenuItem(
                            height: 36,
                            value: _ListAction.disconnect,
                            child: _WhatsAppMenuItem(
                              icon: Icons.logout_rounded,
                              label: 'Sair',
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                if (widget.showTopHeader) const SizedBox(height: 10),
                _SearchBox(
                  hint: 'Pesquisar ou começar uma nova conversa',
                  searchProvider: conversationSearchProvider,
                ),
                SizedBox(height: 10),
                _WhatsAppFilterBar(
                  filter: filter,
                  unreadCount: unreadCount,
                  privateCount: privateCount,
                  groupCount: groupCount,
                  internalGroupCount: internalGroupCount,
                  channelCount: channelCount,
                  communityCount: communityCount,
                  onChanged: (nextFilter) {
                    ref
                        .read(conversationListFilterProvider.notifier)
                        .select(nextFilter);
                    if (widget.fixedFilter != null &&
                        nextFilter != ConversationListFilter.internalGroups) {
                      ref
                          .read(dashboardSectionProvider.notifier)
                          .select(DashboardSection.conversations);
                    }
                  },
                ),
              ],
            ),
          ),
          if (query.isEmpty) const _ConversationNoticeCards(),
          Expanded(
            child: threads.isEmpty
                ? _EmptyList(
                    searching:
                        query.isNotEmpty ||
                        filter != ConversationListFilter.all,
                  )
                : ScrollConfiguration(
                    behavior: ScrollConfiguration.of(
                      context,
                    ).copyWith(scrollbars: false, overscroll: false),
                    child: ListView.builder(
                      key: PageStorageKey<String>(
                        'conversation-list-$_scrollStorageKey',
                      ),
                      controller: _scrollController,
                      itemCount: threads.length,
                      itemExtent: _kConversationTileExtent,
                      // A mobile viewport normally shows about seven rows.
                      // Keep only a small margin mounted so the first frame
                      // remains responsive while scrolling stays fluid.
                      scrollCacheExtent: const ScrollCacheExtent.pixels(
                        _kConversationTileExtent * 1.5,
                      ),
                      addAutomaticKeepAlives: false,
                      addRepaintBoundaries: true,
                      addSemanticIndexes: false,
                      physics: const ClampingScrollPhysics(
                        parent: AlwaysScrollableScrollPhysics(),
                      ),
                      itemBuilder: (context, index) {
                        final item = prepareThread(threads[index]);
                        return _ConversationTile(
                          key: ValueKey(item.rowKey),
                          item: item,
                          showDivider: index < threads.length - 1,
                          deferAvatar: false,
                          onAvatarError: item.group == null
                              ? null
                              : () => _syncGroupAvatarAfterError(
                                  ref,
                                  item.group!,
                                ),
                          onTap: () => unawaited(
                            _openConversationThreadWithProfileGuard(
                              context,
                              ref,
                              item.thread,
                              data.instances,
                            ),
                          ),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _handleConversationMenuAction(
    BuildContext context,
    WidgetRef ref,
    _ListAction action,
    List<ConversationThread> threads,
    List<BotInstance> instances,
    BotInstance? activeInstance,
  ) async {
    void notice(String message) {
      showSuccessToast(context, message);
    }

    void showPanel(ConversationUtilityPanel panel) {
      ref
          .read(dashboardSectionProvider.notifier)
          .select(DashboardSection.conversations);
      ref.read(conversationUtilityPanelProvider.notifier).show(panel);
    }

    switch (action) {
      case _ListAction.profileSwitcher:
        await _openQuickProfileSwitcher(
          context,
          ref,
          instances,
          activeInstance,
        );
        break;
      case _ListAction.renewProfile:
        if (activeInstance != null) {
          await openRenewProfileSheet(context, ref, activeInstance);
        }
        break;
      case _ListAction.newProfile:
        await openCreateProfileSheet(context, ref);
        break;
      case _ListAction.newConversation:
        await _openNewConversationPanel(context, ref, activeInstance);
        break;
      case _ListAction.newInternalGroup:
        await _openInternalGroupCreate(context, ref);
        break;
      case _ListAction.joinInternalGroup:
        await _openInternalGroupJoin(context, ref);
        break;
      case _ListAction.support:
        _openSupportConversation(ref, widget.data);
        break;
      case _ListAction.toggleTheme:
        ref.read(themeControllerProvider.notifier).toggle();
        final dark = ref.read(themeControllerProvider) == AppThemeMode.dark;
        notice(dark ? 'Tema dark ativado.' : 'Tema clean ativado.');
        break;
      case _ListAction.settings:
        ref
            .read(dashboardSectionProvider.notifier)
            .select(DashboardSection.settings);
        break;
      case _ListAction.refresh:
        ref.invalidate(dashboardSnapshotProvider);
        notice('Conversas atualizadas.');
        break;
      case _ListAction.downloadApp:
        await _openMobileAppDownload(context, ref);
        break;
      case _ListAction.lists:
        await showDialog<void>(
          context: context,
          builder: (_) => const _ListsConsentDialog(),
        );
        break;
      case _ListAction.favoriteMessages:
        showPanel(ConversationUtilityPanel.favoriteMessages);
        break;
      case _ListAction.resyncHistory:
        if (activeInstance != null) {
          await showDialog<void>(
            context: context,
            barrierDismissible: false,
            builder: (_) => _HistoryResyncDialog(instance: activeInstance),
          );
        }
        break;
      case _ListAction.selectConversations:
        showPanel(ConversationUtilityPanel.selectConversations);
        break;
      case _ListAction.markAllRead:
        await _markAllThreadsRead(context, ref, threads);
        break;
      case _ListAction.disconnect:
        await _confirmPanelLogout(context, ref);
        break;
    }
  }

  Future<void> _markAllThreadsRead(
    BuildContext context,
    WidgetRef ref,
    List<ConversationThread> threads,
  ) async {
    final unreadThreads = threads
        .where((thread) => thread.unreadCount > 0)
        .toList(growable: false);
    if (unreadThreads.isEmpty) {
      showSuccessToast(context, 'Nenhuma conversa não lida.');
      return;
    }

    try {
      final api = ref.read(apiClientProvider);
      for (final thread in unreadThreads) {
        await api.runConversationAction(thread, 'read');
      }
      ref.invalidate(dashboardSnapshotProvider);
      if (!context.mounted) return;
      showSuccessToast(
        context,
        '${unreadThreads.length} conversa(s) marcada(s) como lida(s).',
      );
    } catch (error) {
      if (!context.mounted) return;
      showErrorToast(context, error.toString());
    }
  }
}

class _WhatsAppMenuItem extends StatelessWidget {
  const _WhatsAppMenuItem({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return SizedBox(
      height: 36,
      child: Row(
        children: [
          Icon(icon, size: 19, color: wa.textPrimary),
          SizedBox(width: 14),
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 14,
                fontWeight: FontWeight.w400,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ConversationNoticeCards extends StatefulWidget {
  const _ConversationNoticeCards();

  @override
  State<_ConversationNoticeCards> createState() =>
      _ConversationNoticeCardsState();
}

class _ConversationNoticeCardsState extends State<_ConversationNoticeCards> {
  BrowserNotificationStatus _status = BrowserNotifications.currentStatus();
  bool _dismissed = false;
  StreamSubscription<BrowserNotificationStatus>? _permissionSub;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _permissionSub = BrowserNotifications.permissionChanges().listen((next) {
      if (!mounted) return;
      _applyStatus(next);
    });
    // Se o usuário liberar no cadeado do browser, some o banner.
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (!mounted || _dismissed) return;
      final next = BrowserNotifications.currentStatus();
      if (next.permission != _status.permission) {
        _applyStatus(next);
      }
    });
  }

  @override
  void dispose() {
    _permissionSub?.cancel();
    _pollTimer?.cancel();
    super.dispose();
  }

  void _applyStatus(BrowserNotificationStatus next) {
    setState(() => _status = next);
    if (next.granted && mounted) {
      unawaited(BrowserNotifications.ensurePushRegistered());
      showSuccessToast(context, 'Notificações ativadas.');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_dismissed || !_status.supported || _status.granted) {
      return SizedBox.shrink();
    }

    final denied = _status.denied;
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 14, 10),
      child: Material(
        color: wa.noticeBg,
        borderRadius: BorderRadius.circular(10),
        clipBehavior: Clip.antiAlias,
        child: SizedBox(
          height: 52,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
            child: Row(
              children: [
                Icon(
                  denied
                      ? Icons.notifications_off_outlined
                      : Icons.notifications_active_outlined,
                  size: 25,
                  color: wa.textPrimary,
                ),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    denied
                        ? 'Notificações bloqueadas no navegador.'
                        : 'Ative notificações reais de novas mensagens.',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: 13.5,
                      height: 1.2,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                NotificationAllowButton(onResolved: _applyStatus),
                SizedBox(width: 2),
                IconButton(
                  constraints: const BoxConstraints.tightFor(
                    width: 32,
                    height: 32,
                  ),
                  padding: EdgeInsets.zero,
                  onPressed: () => setState(() => _dismissed = true),
                  icon: Icon(Icons.close_rounded, size: 22, color: wa.icon),
                  tooltip: 'Fechar',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _WhatsAppDialogFrame extends StatelessWidget {
  const _WhatsAppDialogFrame({required this.child, this.width = 520});

  final Widget child;
  final double width;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      elevation: 18,
      backgroundColor: Colors.transparent,
      insetPadding: EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: width),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: WaTheme.of(context).panel,
            borderRadius: BorderRadius.circular(3),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.18),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: child,
        ),
      ),
    );
  }
}

class _ListsConsentDialog extends StatelessWidget {
  const _ListsConsentDialog();

  @override
  Widget build(BuildContext context) {
    return _WhatsAppDialogFrame(
      width: 560,
      child: Padding(
        padding: EdgeInsets.fromLTRB(30, 26, 30, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Compartilhe atividades relacionadas a clientes para melhorar seus anúncios',
              style: TextStyle(
                color: WaTheme.of(context).textPrimary,
                fontSize: 20,
                height: 1.2,
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: 16),
            const Text(
              'Para alcançar os públicos certos no Facebook e no Instagram e ajudar a Meta a aprimorar os anúncios, você pode compartilhar informações de atividades relacionadas a clientes com a Meta, como dados sobre a criação, a atualização ou o pagamento de pedidos. Saiba mais\n\nO conteúdo das mensagens e das ligações não é compartilhado.\n\nVocê pode mudar essa opção quando quiser nas Data Sharing Settings.\nÉ possível mudar essa configuração para clientes específicos na tela de dados do contato.',
              style: TextStyle(
                color: Color(0xFF3B4A54),
                fontSize: 14,
                height: 1.38,
              ),
            ),
            SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Agora não'),
                ),
                SizedBox(width: 8),
                FilledButton(onPressed: () {}, child: const Text('Continuar')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ConversationUtilityPanel extends ConsumerWidget {
  const _ConversationUtilityPanel({required this.data, required this.panel});

  final DashboardSnapshot data;
  final ConversationUtilityPanel panel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threads = _safeConversationThreads(data.threads);
    return _UtilityPanelShell(
      title: _titleFor(panel),
      action: _headerActionFor(context, ref),
      closeIcon: panel == ConversationUtilityPanel.newChat
          ? Icons.arrow_back_rounded
          : Icons.close_rounded,
      showClose: true,
      child: switch (panel) {
        ConversationUtilityPanel.newChat => _NewConversationPanel(data: data),
        ConversationUtilityPanel.favoriteMessages =>
          const _FavoriteMessagesPanel(),
        ConversationUtilityPanel.selectConversations =>
          _SelectConversationsPanel(threads: threads, groups: data.groups),
        ConversationUtilityPanel.lists => const _ListsConsentPanel(),
        ConversationUtilityPanel.disconnect => const _DisconnectPanel(),
        ConversationUtilityPanel.none => _ConversationList(data: data),
      },
    );
  }

  String _titleFor(ConversationUtilityPanel panel) {
    return switch (panel) {
      ConversationUtilityPanel.newChat => 'Nova conversa',
      ConversationUtilityPanel.favoriteMessages => 'Mensagens favoritas',
      ConversationUtilityPanel.selectConversations => 'Selecionar conversas',
      ConversationUtilityPanel.lists => 'Listas',
      ConversationUtilityPanel.disconnect => 'Desconectar',
      ConversationUtilityPanel.none => 'WhatsApp',
    };
  }

  Widget? _headerActionFor(BuildContext context, WidgetRef ref) {
    return panel == ConversationUtilityPanel.newChat
        ? IconButton(
            constraints: const BoxConstraints.tightFor(width: 42, height: 42),
            onPressed: () {},
            icon: const Icon(Icons.qr_code_scanner_rounded, size: 22),
            tooltip: 'Ler codigo QR',
          )
        : null;
  }
}

class _UtilityPanelShell extends ConsumerWidget {
  const _UtilityPanelShell({
    required this.title,
    required this.child,
    this.action,
    this.closeIcon = Icons.close_rounded,
    this.showClose = true,
  });

  final String title;
  final Widget child;
  final Widget? action;
  final IconData closeIcon;
  final bool showClose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            height: 64,
            padding: EdgeInsets.fromLTRB(showClose ? 8 : 22, 8, 14, 8),
            decoration: BoxDecoration(
              color: wa.panel,
              border: Border(bottom: BorderSide(color: wa.divider)),
            ),
            child: Row(
              children: [
                if (showClose) ...[
                  IconButton(
                    constraints: const BoxConstraints.tightFor(
                      width: 42,
                      height: 42,
                    ),
                    onPressed: () => ref
                        .read(conversationUtilityPanelProvider.notifier)
                        .show(ConversationUtilityPanel.none),
                    icon: Icon(closeIcon, size: 26, color: wa.icon),
                    tooltip: closeIcon == Icons.arrow_back_rounded
                        ? 'Voltar'
                        : 'Fechar',
                  ),
                  SizedBox(width: 8),
                ],
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: showClose ? 18 : 22,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                ?action,
              ],
            ),
          ),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class _NewConversationPanel extends ConsumerWidget {
  const _NewConversationPanel({required this.data});

  final DashboardSnapshot data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedThread = ref.watch(selectedThreadProvider);
    final instance = _instanceForNewConversation(data, selectedThread);
    final query = ref.watch(newConversationSearchProvider).trim().toLowerCase();

    if (instance == null) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
        children: const [
          _UtilityInfoCard(
            icon: Icons.link_off_rounded,
            title: 'Nenhuma instância conectada',
            body:
                'Conecte uma instância para carregar os contatos do telefone e iniciar novas conversas.',
          ),
        ],
      );
    }

    // Conversations already contain the contacts the user has interacted
    // with. Render that small directory immediately while the full phone
    // agenda is fetched in the background.
    final initialContacts = _contactsFromConversationThreads(
      data.threads,
      instance.id,
    );
    final contacts = ref.watch(instanceContactsProvider(instance.id));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 16, 18, 10),
          child: _NewConversationSearchBox(
            hint: 'Pesquisar nome ou número',
            searchProvider: newConversationSearchProvider,
          ),
        ),
        Expanded(
          child: contacts.when(
            data: (items) => _buildContactList(
              context,
              ref,
              data,
              instance,
              _filterContacts(items, query),
            ),
            error: (error, _) => _SidebarErrorMessage(
              message: error.toString(),
              onRetry: () =>
                  ref.invalidate(instanceContactsProvider(instance.id)),
            ),
            loading: () => initialContacts.isEmpty
                ? Center(child: CircularProgressIndicator())
                : _buildContactList(
                    context,
                    ref,
                    data,
                    instance,
                    _filterContacts(initialContacts, query),
                  ),
          ),
        ),
      ],
    );
  }

  Widget _buildContactList(
    BuildContext context,
    WidgetRef ref,
    DashboardSnapshot data,
    BotInstance instance,
    List<WhatsAppContact> items,
  ) {
    final grouped = _groupContacts(items);
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(0, 2, 0, 24),
      itemCount:
          grouped.fold<int>(
            0,
            (total, section) => total + section.contacts.length + 1,
          ) +
          1,
      itemBuilder: (context, index) {
        if (index == 0) return _SelfContactTile(instance: instance);

        var cursor = 1;
        for (final section in grouped) {
          if (index == cursor) return _ContactSectionHeader(section.label);
          cursor += 1;
          final localIndex = index - cursor;
          if (localIndex >= 0 && localIndex < section.contacts.length) {
            final contact = section.contacts[localIndex];
            return _ContactTile(
              contact: contact,
              onTap: () =>
                  _openContactConversation(ref, data, instance.id, contact),
            );
          }
          cursor += section.contacts.length;
        }
        return const SizedBox.shrink();
      },
    );
  }
}

class _NewConversationSearchBox extends ConsumerStatefulWidget {
  const _NewConversationSearchBox({
    required this.hint,
    required this.searchProvider,
  });

  final String hint;
  final NotifierProvider<SearchQueryController, String> searchProvider;

  @override
  ConsumerState<_NewConversationSearchBox> createState() =>
      _NewConversationSearchBoxState();
}

class _NewConversationSearchBoxState
    extends ConsumerState<_NewConversationSearchBox> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final value = ref.watch(widget.searchProvider);
    if (_controller.text != value) {
      _controller.value = TextEditingValue(
        text: value,
        selection: TextSelection.collapsed(offset: value.length),
      );
    }

    return SizedBox(
      height: 45,
      child: TextField(
        controller: _controller,
        style: TextStyle(fontSize: 15, color: WaTheme.of(context).textPrimary),
        onChanged: (text) =>
            ref.read(widget.searchProvider.notifier).setQuery(text),
        decoration: InputDecoration(
          hintText: widget.hint,
          hintStyle: TextStyle(
            color: WaTheme.of(context).textMuted,
            fontSize: 15,
          ),
          prefixIcon: Icon(
            Icons.search_rounded,
            size: 23,
            color: WaTheme.of(context).icon,
          ),
          suffixIcon: value.isEmpty
              ? null
              : IconButton(
                  tooltip: 'Limpar busca',
                  icon: Icon(Icons.close_rounded),
                  onPressed: () =>
                      ref.read(widget.searchProvider.notifier).clear(),
                ),
          filled: true,
          fillColor: WaTheme.of(context).inputFill,
          contentPadding: EdgeInsets.symmetric(vertical: 10),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(22),
            borderSide: BorderSide(
              color: WaTheme.of(context).textPrimary,
              width: 1.5,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(22),
            borderSide: BorderSide(
              color: WaTheme.of(context).textPrimary,
              width: 1.8,
            ),
          ),
        ),
      ),
    );
  }
}

class _SelfContactTile extends StatelessWidget {
  const _SelfContactTile({required this.instance});

  final BotInstance instance;

  @override
  Widget build(BuildContext context) {
    final title = instance.name.toString().trim().isEmpty
        ? 'Minha conta'
        : '${instance.name} (você)';
    return _ContactLikeTile(
      avatarUrl: null,
      title: title,
      subtitle: 'Mensagens para mim',
      icon: Icons.person_rounded,
      onTap: () {},
    );
  }
}

class _ContactSectionHeader extends StatelessWidget {
  const _ContactSectionHeader(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(32, 22, 24, 18),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF008069),
          fontSize: 16,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class _ContactTile extends StatelessWidget {
  const _ContactTile({required this.contact, required this.onTap});

  final WhatsAppContact contact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return _ContactLikeTile(
      avatarUrl: contact.avatarUrl,
      title: contact.displayName,
      subtitle: contact.formattedPhone,
      icon: Icons.person_rounded,
      onTap: onTap,
    );
  }
}

class _ContactLikeTile extends StatelessWidget {
  const _ContactLikeTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
    this.avatarUrl,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final String? avatarUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: wa.panel,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.fromLTRB(22, 8, 24, 8),
          child: Row(
            children: [
              SizedBox(
                width: 49,
                height: 49,
                child: avatarUrl == null || avatarUrl!.trim().isEmpty
                    ? CircleAvatar(
                        backgroundColor: WaTheme.of(context).avatarFallback,
                        child: Icon(icon, color: WaTheme.of(context).icon),
                      )
                    : _AvatarImage(
                        isGroup: false,
                        active: false,
                        avatarUrl: avatarUrl,
                      ),
              ),
              SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: WaTheme.of(context).textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: WaTheme.of(context).textMuted,
                        fontSize: 14,
                        height: 1.25,
                      ),
                    ),
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

class _ContactSection {
  const _ContactSection({required this.label, required this.contacts});

  final String label;
  final List<WhatsAppContact> contacts;
}

List<WhatsAppContact> _filterContacts(
  List<WhatsAppContact> contacts,
  String query,
) {
  final seen = <String>{};
  final result = <WhatsAppContact>[];
  for (final contact in contacts) {
    final jid = contact.jid.trim().toLowerCase();
    if (jid.isEmpty || !seen.add(jid)) continue;
    if (query.isNotEmpty) {
      final haystack =
          '${contact.displayName} ${contact.formattedPhone} ${contact.phone} ${contact.jid}'
              .toLowerCase();
      if (!haystack.contains(query)) continue;
    }
    result.add(contact);
  }
  return result;
}

List<WhatsAppContact> _contactsFromConversationThreads(
  List<ConversationThread> threads,
  int instanceId,
) {
  final seen = <String>{};
  final contacts = <WhatsAppContact>[];
  for (final thread in threads) {
    if (thread.instanceId != instanceId || !thread.isContact) continue;
    final jid = thread.chatJid.trim();
    if (jid.isEmpty || !seen.add(jid.toLowerCase())) continue;
    contacts.add(
      WhatsAppContact(
        jid: jid,
        phone: thread.phone?.trim().isNotEmpty == true
            ? thread.phone!.trim()
            : jid.split('@').first.replaceAll(RegExp(r'\D+'), ''),
        name: thread.title,
        avatarUrl: thread.avatarUrl,
      ),
    );
  }
  return contacts;
}

List<_ContactSection> _groupContacts(List<WhatsAppContact> contacts) {
  final grouped = <String, List<WhatsAppContact>>{};
  for (final contact in contacts) {
    final label = _contactSectionLabel(contact.displayName);
    grouped.putIfAbsent(label, () => <WhatsAppContact>[]).add(contact);
  }

  final labels = grouped.keys.toList()
    ..sort((left, right) {
      if (left == '#') return -1;
      if (right == '#') return 1;
      return left.compareTo(right);
    });

  return [
    for (final label in labels)
      _ContactSection(label: label, contacts: grouped[label]!),
  ];
}

String _contactSectionLabel(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return '#';
  final first = trimmed.characters.first.toUpperCase();
  final code = first.codeUnitAt(0);
  if (code >= 65 && code <= 90) return first;
  return '#';
}

BotInstance? _instanceForNewConversation(
  DashboardSnapshot data,
  ConversationThread? selected,
) {
  final selectedInstanceId = selected?.instanceId;
  if (selectedInstanceId != null) {
    for (final instance in data.instances) {
      if (instance.id == selectedInstanceId && instance.isConnected) {
        return instance;
      }
    }
  }
  for (final instance in data.instances) {
    if (instance.isConnected) return instance;
  }
  return null;
}

void _openContactConversation(
  WidgetRef ref,
  DashboardSnapshot data,
  int instanceId,
  WhatsAppContact contact,
) {
  final existing = _existingThreadForContact(data.threads, instanceId, contact);
  final thread =
      existing ??
      ConversationThread(
        instanceId: instanceId,
        chatJid: contact.jid,
        title: contact.displayName,
        lastMessage: '',
        lastActivity: DateTime.fromMillisecondsSinceEpoch(0),
        unreadCount: 0,
        avatarUrl: contact.avatarUrl,
        chatType: 'contact',
      );

  ref.read(selectedThreadProvider.notifier).select(thread);
  ref.read(newConversationSearchProvider.notifier).clear();
  ref
      .read(conversationUtilityPanelProvider.notifier)
      .show(ConversationUtilityPanel.none);
}

void _openParticipantConversation(
  WidgetRef ref,
  DashboardSnapshot data,
  int instanceId,
  String jid,
  String displayName,
) {
  final trimmedJid = jid.trim();
  final digits = trimmedJid.split('@').first.replaceAll(RegExp(r'\D+'), '');
  if (trimmedJid.isEmpty || digits.isEmpty) return;
  _openContactConversation(
    ref,
    data,
    instanceId,
    WhatsAppContact(
      jid: trimmedJid.contains('@') ? trimmedJid : '$digits@s.whatsapp.net',
      phone: digits,
      name: displayName.trim().isEmpty ? '+$digits' : displayName.trim(),
    ),
  );
}

WhatsAppContact _whatsappContactFromCard(ChatContactCard contact) {
  final digits = contact.phoneDigits;
  return WhatsAppContact(
    jid: digits.isEmpty ? '' : '$digits@s.whatsapp.net',
    phone: digits,
    name: contact.displayName,
  );
}

ConversationThread? _existingThreadForContact(
  List<ConversationThread> threads,
  int instanceId,
  WhatsAppContact contact,
) {
  final key = _conversationContactKey(contact.jid);
  if (key == null) return null;
  for (final thread in threads) {
    if (thread.instanceId != instanceId) continue;
    if (_conversationContactKey(thread.chatJid) == key) return thread;
  }
  return null;
}

String? _conversationContactKey(String value) {
  final digits = value.split('@').first.replaceAll(RegExp(r'\D+'), '');
  return digits.isEmpty ? null : digits;
}

class _FavoriteMessagesPanel extends StatelessWidget {
  const _FavoriteMessagesPanel();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
      children: const [
        _UtilitySearchField(hint: 'Pesquisar'),
        SizedBox(height: 80),
        _UtilityEmptyStateContent(
          icon: Icons.star_border_rounded,
          title: 'Nenhuma mensagem favorita',
          subtitle:
              'Use o WhatsApp no seu celular para ver conversas e mensagens mais antigas.',
        ),
      ],
    );
  }
}

class _SelectConversationsPanel extends StatefulWidget {
  const _SelectConversationsPanel({
    required this.threads,
    required this.groups,
  });

  final List<ConversationThread> threads;
  final List<BotGroup> groups;

  @override
  State<_SelectConversationsPanel> createState() =>
      _SelectConversationsPanelState();
}

class _SelectConversationsPanelState extends State<_SelectConversationsPanel> {
  final Set<String> _selected = <String>{};

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(26, 16, 24, 12),
          child: Text(
            'Selecionada:${_selected.length}',
            style: TextStyle(
              color: WaTheme.of(context).textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Divider(height: 1, color: WaTheme.of(context).divider),
        Expanded(
          child: ListView.separated(
            itemCount: widget.threads.length,
            separatorBuilder: (context, index) => Divider(
              height: 1,
              indent: 92,
              color: WaTheme.of(context).divider,
            ),
            itemBuilder: (context, index) {
              final thread = widget.threads[index];
              final key = '${thread.instanceId}:${thread.chatJid}';
              final group = _groupForThread(widget.groups, thread);
              final selected = _selected.contains(key);
              return _SelectableConversationTile(
                thread: thread,
                group: group,
                selected: selected,
                onChanged: () {
                  setState(() {
                    if (selected) {
                      _selected.remove(key);
                    } else {
                      _selected.add(key);
                    }
                  });
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

class _ListsConsentPanel extends StatelessWidget {
  const _ListsConsentPanel();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
      children: [
        const _UtilityInfoCard(
          icon: Icons.contacts_outlined,
          title:
              'Compartilhe atividades relacionadas a clientes para melhorar seus anúncios',
          body:
              'Para alcançar os públicos certos no Facebook e no Instagram e ajudar a Meta a aprimorar os anúncios, você pode compartilhar informações de atividades relacionadas a clientes com a Meta, como dados sobre a criação, a atualização ou o pagamento de pedidos.\n\nO conteúdo das mensagens e das ligações não é compartilhado.\n\nVocê pode mudar essa opção quando quiser nas configurações de compartilhamento de dados.',
        ),
        SizedBox(height: 18),
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(onPressed: () {}, child: const Text('Agora não')),
            SizedBox(width: 10),
            FilledButton(onPressed: () {}, child: const Text('Continuar')),
          ],
        ),
      ],
    );
  }
}

class _DisconnectPanel extends ConsumerWidget {
  const _DisconnectPanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 36, 24, 24),
      children: [
        const _UtilityInfoCard(
          icon: Icons.logout_rounded,
          title: 'Deseja desconectar?',
          body: 'Você será desconectado do painel BotAdmin neste navegador.',
        ),
        SizedBox(height: 18),
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 10,
          runSpacing: 10,
          children: [
            TextButton(
              onPressed: () => ref
                  .read(conversationUtilityPanelProvider.notifier)
                  .show(ConversationUtilityPanel.none),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () =>
                  ref.read(authControllerProvider.notifier).logout(),
              child: const Text('Desconectar'),
            ),
          ],
        ),
      ],
    );
  }
}

class _UtilityInfoCard extends StatelessWidget {
  const _UtilityInfoCard({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: WaTheme.of(context).panel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: WaTheme.of(context).divider),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Padding(
        padding: EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: WaTheme.of(context).avatarFallback,
              child: Icon(icon, color: WaTheme.of(context).textPrimary),
            ),
            SizedBox(height: 18),
            Text(
              title,
              style: TextStyle(
                color: WaTheme.of(context).textPrimary,
                fontSize: 21,
                fontWeight: FontWeight.w600,
                height: 1.18,
              ),
            ),
            SizedBox(height: 14),
            Text(
              body,
              style: const TextStyle(
                color: Color(0xFF3B4A54),
                fontSize: 15,
                height: 1.38,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _UtilitySearchField extends StatelessWidget {
  const _UtilitySearchField({required this.hint});

  final String hint;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 46,
      child: TextField(
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(
            color: WaTheme.of(context).textMuted,
            fontSize: 15,
          ),
          prefixIcon: Icon(
            Icons.search_rounded,
            color: WaTheme.of(context).icon,
          ),
          filled: true,
          fillColor: const Color(0xFFF0F2F5),
          contentPadding: const EdgeInsets.symmetric(vertical: 12),
          border: OutlineInputBorder(
            borderSide: BorderSide.none,
            borderRadius: BorderRadius.circular(23),
          ),
        ),
      ),
    );
  }
}

class _UtilityEmptyStateContent extends StatelessWidget {
  const _UtilityEmptyStateContent({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 58, color: Color(0xFF8696A0)),
        SizedBox(height: 18),
        Text(
          title,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: WaTheme.of(context).textPrimary,
            fontSize: 19,
            fontWeight: FontWeight.w600,
          ),
        ),
        SizedBox(height: 8),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: WaTheme.of(context).textMuted,
            fontSize: 15,
            height: 1.35,
          ),
        ),
      ],
    );
  }
}

class _SelectableConversationTile extends StatelessWidget {
  const _SelectableConversationTile({
    required this.thread,
    required this.group,
    required this.selected,
    required this.onChanged,
  });

  final ConversationThread thread;
  final BotGroup? group;
  final bool selected;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? WaTheme.of(context).selectedRow
          : WaTheme.of(context).panel,
      child: InkWell(
        onTap: onChanged,
        child: SizedBox(
          height: 84,
          child: Padding(
            padding: EdgeInsets.fromLTRB(20, 10, 24, 10),
            child: Row(
              children: [
                Checkbox(value: selected, onChanged: (_) => onChanged()),
                SizedBox(width: 8),
                _AvatarImage(
                  isGroup: thread.isGroup,
                  active: selected,
                  avatarUrl: _firstNonEmptyString([
                    thread.avatarUrl,
                    group?.avatarUrl,
                  ]),
                ),
                SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        thread.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: WaTheme.of(context).textPrimary,
                          fontSize: 17,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        thread.previewText,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: WaTheme.of(context).textMuted,
                          fontSize: 14,
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
    );
  }
}

class _GroupList extends ConsumerWidget {
  const _GroupList({required this.data, required this.selected});

  final DashboardSnapshot data;
  final BotGroup? selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final query = ref.watch(groupSearchProvider).trim().toLowerCase();
    final groups = query.isEmpty
        ? data.groups
        : data.groups.where((group) {
            return group.name.toLowerCase().contains(query) ||
                group.remoteJid.toLowerCase().contains(query);
          }).toList();

    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: wa.panel,
            padding: const EdgeInsets.fromLTRB(26, 24, 24, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Grupos',
                        style: TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w700,
                          color: wa.textPrimary,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () =>
                          ref.invalidate(dashboardSnapshotProvider),
                      icon: const Icon(Icons.refresh_rounded),
                      tooltip: 'Atualizar',
                    ),
                    PopupMenuButton<_ListAction>(
                      tooltip: 'Mais',
                      icon: const Icon(Icons.more_vert_rounded),
                      onSelected: (action) {
                        switch (action) {
                          case _ListAction.refresh:
                            ref.invalidate(dashboardSnapshotProvider);
                            showSuccessToast(context, 'Grupos atualizados.');
                            break;
                          default:
                            break;
                        }
                      },
                      itemBuilder: (context) => const [
                        PopupMenuItem(
                          value: _ListAction.refresh,
                          child: ListTile(
                            leading: Icon(Icons.refresh_rounded),
                            title: Text('Atualizar grupos'),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                SizedBox(height: 18),
                _SearchBox(
                  hint: 'Pesquisar grupos',
                  searchProvider: groupSearchProvider,
                ),
                SizedBox(height: 10),
                Text(
                  '${data.groups.length} grupo(s) · ${data.groups.where((group) => group.botEnabled).length} ativo(s)',
                  style: TextStyle(
                    color: WaTheme.of(context).textMuted,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: groups.isEmpty
                ? _EmptyGroups(searching: query.isNotEmpty)
                : ListView.separated(
                    itemCount: groups.length,
                    separatorBuilder: (context, index) => Divider(
                      height: 1,
                      indent: 82,
                      color: WaTheme.of(context).divider,
                    ),
                    itemBuilder: (context, index) {
                      final group = groups[index];
                      final active = selected?.id == group.id;
                      return _GroupTile(
                        group: group,
                        active: active,
                        onAvatarError: () =>
                            _syncGroupAvatarAfterError(ref, group),
                        onTap: () => ref
                            .read(selectedGroupProvider.notifier)
                            .select(group),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _ProfilesSidebar extends ConsumerWidget {
  const _ProfilesSidebar({required this.instances});

  final List<BotInstance> instances;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final selectedId = ref.watch(selectedInstanceIdProvider);
    final activeId =
        _resolveActiveInstance(instances, selectedId)?.id ?? selectedId;
    return ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: wa.panel,
            padding: const EdgeInsets.fromLTRB(26, 24, 24, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Perfis',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    color: wa.textPrimary,
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  'Instâncias e conexão',
                  style: TextStyle(color: wa.textMuted, fontSize: 14),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 2, 20, 16),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => openCreateProfileSheet(context, ref),
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: const Text('Novo perfil'),
                  ),
                ),
                const SizedBox(width: 10),
                IconButton(
                  tooltip: 'Atualizar perfis',
                  onPressed: () {
                    ref.invalidate(dashboardSnapshotProvider);
                    ref.invalidate(botInstancesProvider);
                    ref.invalidate(botServersProvider);
                  },
                  icon: Icon(Icons.refresh_rounded, color: wa.icon),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: wa.divider),
          Expanded(
            child: instances.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: Text(
                        'Nenhum perfil criado ainda.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: wa.textMuted, height: 1.35),
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: EdgeInsets.zero,
                    itemCount: instances.length,
                    separatorBuilder: (context, index) =>
                        Divider(height: 1, indent: 82, color: wa.divider),
                    itemBuilder: (context, index) {
                      final instance = instances[index];
                      return _ProfileSidebarTile(
                        instance: instance,
                        active: activeId == instance.id,
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _ProfileSidebarTile extends ConsumerWidget {
  const _ProfileSidebarTile({required this.instance, required this.active});

  final BotInstance instance;
  final bool active;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final statusColor = instance.isConnected
        ? const Color(0xFF00A884)
        : instance.isAwaitingPair
        ? const Color(0xFFF59E0B)
        : wa.textMuted;
    return Material(
      color: active ? wa.selectedRow : wa.panel,
      child: InkWell(
        onTap: () {
          ref.read(selectedInstanceIdProvider.notifier).select(instance.id);
          ref
              .read(dashboardSectionProvider.notifier)
              .select(DashboardSection.profiles);
        },
        child: SizedBox(
          height: 82,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(26, 10, 24, 10),
            child: Row(
              children: [
                _RailProfileAvatar(
                  label: instance.name,
                  instanceId: instance.id,
                  active: instance.isConnected,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        instance.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: wa.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        instance.phoneNumber?.trim().isNotEmpty == true
                            ? '+${instance.phoneNumber}'
                            : instance.statusLabel,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 14, color: wa.textMuted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    active ? 'Atual' : instance.statusLabel,
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                    ),
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

class _SettingsSidebar extends ConsumerWidget {
  const _SettingsSidebar({required this.instances});

  final List<BotInstance> instances;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final session = ref.watch(authControllerProvider).value;
    final pane = ref.watch(settingsPaneProvider);
    final activeInstance = _resolveActiveInstance(
      instances,
      ref.watch(selectedInstanceIdProvider),
    );
    return ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: wa.panel,
            padding: const EdgeInsets.fromLTRB(26, 24, 24, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Configurações',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    color: wa.textPrimary,
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  'Conta e instância',
                  style: TextStyle(color: wa.textMuted, fontSize: 14),
                ),
              ],
            ),
          ),
          _SettingsSidebarTile(
            icon: Icons.person_outline_rounded,
            title: 'Conta',
            subtitle: session?.user.email ?? 'Dados do usuário',
            active: pane == SettingsPane.account,
            onTap: () => ref
                .read(settingsPaneProvider.notifier)
                .select(SettingsPane.account),
          ),
          Divider(height: 1, indent: 82, color: wa.divider),
          _SettingsSidebarTile(
            icon: Icons.smartphone_rounded,
            title: 'Instância',
            subtitle: activeInstance?.name ?? 'Nenhum perfil selecionado',
            active: pane == SettingsPane.instance,
            onTap: () => ref
                .read(settingsPaneProvider.notifier)
                .select(SettingsPane.instance),
          ),
        ],
      ),
    );
  }
}

class _SettingsSidebarTile extends StatelessWidget {
  const _SettingsSidebarTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: active ? wa.selectedRow : wa.panel,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 82,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(26, 10, 24, 10),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 26,
                  backgroundColor: active
                      ? const Color(0xFFD9FDD3)
                      : const Color(0xFFE9EDEF),
                  child: Icon(
                    icon,
                    color: active
                        ? const Color(0xFF008069)
                        : const Color(0xFF54656F),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: wa.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 14, color: wa.textMuted),
                      ),
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

class _SearchBox extends ConsumerStatefulWidget {
  const _SearchBox({required this.hint, required this.searchProvider});

  final String hint;
  final NotifierProvider<SearchQueryController, String> searchProvider;

  @override
  ConsumerState<_SearchBox> createState() => _SearchBoxState();
}

class _SearchBoxState extends ConsumerState<_SearchBox> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final value = ref.watch(widget.searchProvider);
    if (_controller.text != value) {
      _controller.value = TextEditingValue(
        text: value,
        selection: TextSelection.collapsed(offset: value.length),
      );
    }

    final wa = WaTheme.of(context);
    return SizedBox(
      height: 40,
      child: TextField(
        controller: _controller,
        style: TextStyle(fontSize: 14, color: wa.textPrimary),
        onChanged: (text) =>
            ref.read(widget.searchProvider.notifier).setQuery(text),
        decoration: InputDecoration(
          hintText: widget.hint,
          hintStyle: TextStyle(color: wa.textMuted, fontSize: 14),
          prefixIcon: Icon(Icons.search_rounded, size: 22, color: wa.icon),
          suffixIcon: value.isEmpty
              ? null
              : IconButton(
                  tooltip: 'Limpar busca',
                  icon: Icon(Icons.close_rounded, color: wa.icon),
                  onPressed: () =>
                      ref.read(widget.searchProvider.notifier).clear(),
                ),
          fillColor: wa.searchBg,
          filled: true,
          contentPadding: const EdgeInsets.symmetric(vertical: 9),
          border: OutlineInputBorder(
            borderSide: BorderSide.none,
            borderRadius: BorderRadius.circular(20),
          ),
        ),
      ),
    );
  }
}

/// Fixed row height keeps list layout O(1) while scrolling.
const double _kConversationTileExtent = 76;

class _ConversationTile extends ConsumerWidget {
  const _ConversationTile({
    super.key,
    required this.item,
    required this.onTap,
    this.onAvatarError,
    this.showDivider = true,
    this.deferAvatar = false,
  });

  final _PreparedConversation item;
  final VoidCallback onTap;
  final VoidCallback? onAvatarError;
  final bool showDivider;
  final bool deferAvatar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Only this row rebuilds when its selected state flips (not the whole list).
    final active = ref.watch(
      selectedThreadProvider.select(
        (selected) =>
            selected != null &&
            selected.chatJid == item.chatJid &&
            selected.instanceId == item.instanceId,
      ),
    );
    final unread = item.unread;
    final wa = WaTheme.of(context);
    final pinned = item.thread.pinned;
    final botOn = item.group?.botEnabled == true;
    // Flat row: no Material/InkWell paint during fling.
    return ColoredBox(
      color: active ? wa.selectedRow : wa.panel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        onLongPressStart: (details) {
          if (item.thread.isSupport) {
            onTap();
            return;
          }
          // Mobile: pressionar a conversa abre opções.
          unawaited(
            _showConversationContextMenu(
              context: context,
              ref: ref,
              globalPosition: details.globalPosition,
              thread: item.thread,
              group: item.group,
            ),
          );
        },
        onSecondaryTapDown: (details) {
          if (item.thread.isSupport) {
            onTap();
            return;
          }
          // Desktop: botão direito do mouse.
          unawaited(
            _showConversationContextMenu(
              context: context,
              ref: ref,
              globalPosition: details.globalPosition,
              thread: item.thread,
              group: item.group,
            ),
          );
        },
        child: SizedBox(
          height: _kConversationTileExtent,
          child: DecoratedBox(
            decoration: showDivider
                ? BoxDecoration(
                    border: Border(
                      bottom: BorderSide(color: wa.divider, width: 0.7),
                    ),
                  )
                : const BoxDecoration(),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(23, 7, 24, 7),
              child: Row(
                children: [
                  Tooltip(
                    message: 'Ver foto',
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => _showConversationInfoDialog(
                        context,
                        thread: item.thread,
                        group: item.group,
                        focusPhoto: true,
                      ),
                      child: _AvatarImage(
                        isGroup: item.isGroup,
                        isSupport: item.isSupport,
                        active: active,
                        avatarUrl: item.avatarUrl,
                        onError: onAvatarError,
                        deferNetworkLoad: deferAvatar,
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                item.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w500,
                                  color: wa.textPrimary,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            _ConversationListTypeBadge(thread: item.thread),
                            const SizedBox(width: 6),
                            if (pinned) ...[
                              Icon(
                                Icons.push_pin_rounded,
                                size: 14,
                                color: wa.textMuted,
                              ),
                              const SizedBox(width: 4),
                            ],
                            Text(
                              item.timeLabel,
                              style: TextStyle(
                                fontSize: 12,
                                color: unread > 0 ? wa.accent : wa.textMuted,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 5),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                item.preview,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: wa.textMuted,
                                ),
                              ),
                            ),
                            if (item.isGroup && item.group != null) ...[
                              Icon(
                                Icons.smart_toy_rounded,
                                size: 15,
                                color: botOn ? wa.accent : wa.textMuted,
                              ),
                              const SizedBox(width: 6),
                            ],
                            if (item.thread.hasUnreadMention && unread > 0) ...[
                              Text(
                                '@',
                                style: TextStyle(
                                  color: wa.accent,
                                  fontSize: 18,
                                  height: 1,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              const SizedBox(width: 6),
                            ],
                            if (unread > 0)
                              Container(
                                constraints: const BoxConstraints(minWidth: 20),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: wa.unreadBadge,
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  _shortCount(unread),
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ],
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

class _ConversationListTypeBadge extends StatelessWidget {
  const _ConversationListTypeBadge({required this.thread});

  final ConversationThread thread;

  @override
  Widget build(BuildContext context) {
    final color = thread.isInternalGroup
        ? const Color(0xFF39FF14)
        : thread.isSupport
        ? const Color(0xFF00A884)
        : thread.isChannel
        ? const Color(0xFF147D92)
        : thread.isCommunity
        ? const Color(0xFF7C3AED)
        : thread.isGroup
        ? const Color(0xFFB7791F)
        : const Color(0xFF16865A);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: thread.isInternalGroup
            ? const Color(0xFF082F12)
            : color.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: color.withValues(alpha: thread.isInternalGroup ? .9 : .28),
        ),
        boxShadow: thread.isInternalGroup
            ? [BoxShadow(color: color.withValues(alpha: .34), blurRadius: 7)]
            : null,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        child: Text(
          thread.conversationTypeLabel,
          maxLines: 1,
          style: TextStyle(
            color: color,
            fontSize: 9.5,
            fontWeight: FontWeight.w900,
            height: 1,
          ),
        ),
      ),
    );
  }
}

Future<void> _showConversationInfoDialog(
  BuildContext context, {
  required ConversationThread thread,
  BotGroup? group,
  bool focusPhoto = false,
}) {
  final wa = WaTheme.of(context);
  final avatarUrl = _absoluteUrl(
    _firstNonEmptyString([thread.avatarUrl, group?.avatarUrl]),
  );
  final title = thread.title.trim().isNotEmpty
      ? thread.title.trim()
      : 'Conversa';
  final type = thread.conversationTypeLabel;
  final subtitle = thread.chatJid.trim();
  return showDialog<void>(
    context: context,
    builder: (dialogContext) => Dialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 430),
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
                width: focusPhoto ? 220 : 150,
                height: focusPhoto ? 220 : 150,
                child: ClipOval(
                  child: avatarUrl == null
                      ? ColoredBox(
                          color: wa.avatarFallback,
                          child: Icon(
                            thread.isGroup
                                ? Icons.groups_rounded
                                : Icons.person_rounded,
                            size: focusPhoto ? 104 : 72,
                            color: wa.icon,
                          ),
                        )
                      : BotAdminCachedImage(
                          imageUrl: avatarUrl,
                          fit: BoxFit.cover,
                          fadeInDuration: const Duration(milliseconds: 120),
                          errorWidget: (context, _, _) => ColoredBox(
                            color: wa.avatarFallback,
                            child: Icon(
                              thread.isGroup
                                  ? Icons.groups_rounded
                                  : Icons.person_rounded,
                              size: focusPhoto ? 104 : 72,
                              color: wa.icon,
                            ),
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                title,
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
              Text(type, style: TextStyle(color: wa.textMuted, fontSize: 14)),
              if (subtitle.isNotEmpty) ...[
                const SizedBox(height: 6),
                SelectableText(
                  subtitle,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: wa.textSecondary, fontSize: 13),
                ),
              ],
              if (group != null) ...[
                const SizedBox(height: 14),
                _ConversationInfoChip(
                  icon: group.botEnabled
                      ? Icons.smart_toy_rounded
                      : Icons.smart_toy_outlined,
                  label: group.botEnabled ? 'Robô ativo' : 'Robô desligado',
                  active: group.botEnabled,
                ),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}

class _ConversationInfoChip extends StatelessWidget {
  const _ConversationInfoChip({
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
          const SizedBox(width: 7),
          Text(
            label,
            style: TextStyle(
              color: active ? wa.accent : wa.textSecondary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _GroupTile extends StatelessWidget {
  const _GroupTile({
    required this.group,
    required this.active,
    required this.onTap,
    this.onAvatarError,
  });

  final BotGroup group;
  final bool active;
  final VoidCallback onTap;
  final VoidCallback? onAvatarError;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: active ? wa.selectedRow : wa.panel,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 92,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(26, 10, 24, 10),
            child: Row(
              children: [
                _AvatarImage(
                  isGroup: true,
                  active: group.botEnabled,
                  avatarUrl: group.avatarUrl,
                  onError: onAvatarError,
                ),
                SizedBox(width: 16),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        group.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: wa.textPrimary,
                        ),
                      ),
                      SizedBox(height: 5),
                      Text(
                        group.botEnabled
                            ? 'Robo ativo neste grupo'
                            : 'Robo desligado neste grupo',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          color: group.botEnabled ? wa.accent : wa.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded, color: wa.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MobileDashboardHeader extends ConsumerWidget {
  const _MobileDashboardHeader({required this.data});

  final DashboardSnapshot data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final isDark = wa.isDark;
    final isPartner =
        (ref.watch(authControllerProvider).value?.user.partnerRole ?? '')
            .isNotEmpty;
    final threads = _safeConversationThreads(data.threads);
    final activeInstance = _resolveActiveInstance(
      data.instances,
      ref.watch(selectedInstanceIdProvider),
    );
    if (activeInstance != null) {
      ref.watch(instanceProfileAvatarBytesProvider(activeInstance.id));
    }
    return Material(
      color: wa.panel,
      child: Container(
        padding: const EdgeInsets.fromLTRB(22, 10, 14, 9),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: wa.divider)),
        ),
        child: Row(
          children: [
            const Expanded(child: _BotAdminBrandHeader()),
            PopupMenuButton<_ListAction>(
              tooltip: 'Mais',
              icon: Icon(Icons.more_vert_rounded, size: 25, color: wa.icon),
              padding: EdgeInsets.zero,
              offset: const Offset(0, 42),
              color: wa.menuBg,
              surfaceTintColor: Colors.transparent,
              elevation: 8,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              constraints: const BoxConstraints(minWidth: 272, maxWidth: 300),
              onSelected: (action) => _handleMobileHeaderAction(
                context,
                ref,
                action,
                data,
                threads,
                activeInstance,
              ),
              itemBuilder: (context) => [
                if (!isPartner && activeInstance != null)
                  PopupMenuItem(
                    height: 62,
                    value: _ListAction.profileSwitcher,
                    child: _ConversationProfileMenuHeader(
                      instance: activeInstance,
                    ),
                  ),
                if (!isPartner && activeInstance != null)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.renewProfile,
                    child: _WhatsAppMenuItem(
                      icon: Icons.workspace_premium_outlined,
                      label: 'Renovar perfil',
                    ),
                  ),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.newProfile,
                    child: _WhatsAppMenuItem(
                      icon: Icons.add_circle_outline_rounded,
                      label: 'Novo perfil',
                    ),
                  ),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.newConversation,
                    child: _WhatsAppMenuItem(
                      icon: Icons.add_comment_outlined,
                      label: 'Nova conversa',
                    ),
                  ),
                const PopupMenuDivider(height: 8),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.support,
                    child: _WhatsAppMenuItem(
                      icon: Icons.support_agent_rounded,
                      label: 'Falar com o suporte',
                    ),
                  ),
                PopupMenuItem(
                  height: 36,
                  value: _ListAction.toggleTheme,
                  child: _WhatsAppMenuItem(
                    icon: isDark
                        ? Icons.light_mode_rounded
                        : Icons.dark_mode_rounded,
                    label: isDark ? 'Tema clean' : 'Tema dark',
                  ),
                ),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.settings,
                    child: _WhatsAppMenuItem(
                      icon: Icons.settings_outlined,
                      label: 'Configurações',
                    ),
                  ),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.downloadApp,
                    child: _WhatsAppMenuItem(
                      icon: Icons.android_rounded,
                      label: 'Baixar aplicativo',
                    ),
                  ),
                const PopupMenuDivider(height: 8),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.favoriteMessages,
                    child: _WhatsAppMenuItem(
                      icon: Icons.star_border_rounded,
                      label: 'Mensagens favoritas',
                    ),
                  ),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.selectConversations,
                    child: _WhatsAppMenuItem(
                      icon: Icons.check_box_outlined,
                      label: 'Selecionar conversas',
                    ),
                  ),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.lists,
                    child: _WhatsAppMenuItem(
                      icon: Icons.contacts_outlined,
                      label: 'Listas',
                    ),
                  ),
                if (!isPartner)
                  const PopupMenuItem(
                    height: 36,
                    value: _ListAction.markAllRead,
                    child: _WhatsAppMenuItem(
                      icon: Icons.mark_chat_read_outlined,
                      label: 'Marcar todas como lidas',
                    ),
                  ),
                const PopupMenuDivider(height: 8),
                const PopupMenuItem(
                  height: 36,
                  value: _ListAction.disconnect,
                  child: _WhatsAppMenuItem(
                    icon: Icons.logout_rounded,
                    label: 'Sair',
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _handleMobileHeaderAction(
  BuildContext context,
  WidgetRef ref,
  _ListAction action,
  DashboardSnapshot data,
  List<ConversationThread> threads,
  BotInstance? activeInstance,
) async {
  void showPanel(ConversationUtilityPanel panel) {
    ref
        .read(dashboardSectionProvider.notifier)
        .select(DashboardSection.conversations);
    ref.read(conversationUtilityPanelProvider.notifier).show(panel);
  }

  switch (action) {
    case _ListAction.profileSwitcher:
      await _openQuickProfileSwitcher(
        context,
        ref,
        data.instances,
        activeInstance,
      );
      break;
    case _ListAction.renewProfile:
      if (activeInstance != null) {
        await openRenewProfileSheet(context, ref, activeInstance);
      }
      break;
    case _ListAction.newProfile:
      await openCreateProfileSheet(context, ref);
      break;
    case _ListAction.newConversation:
      await _openNewConversationPanel(context, ref, activeInstance);
      break;
    case _ListAction.newInternalGroup:
      await _openInternalGroupCreate(context, ref);
      break;
    case _ListAction.joinInternalGroup:
      await _openInternalGroupJoin(context, ref);
      break;
    case _ListAction.support:
      _openSupportConversation(ref, data);
      break;
    case _ListAction.toggleTheme:
      ref.read(themeControllerProvider.notifier).toggle();
      final dark = ref.read(themeControllerProvider) == AppThemeMode.dark;
      if (context.mounted) {
        showSuccessToast(
          context,
          dark ? 'Tema dark ativado.' : 'Tema clean ativado.',
        );
      }
      break;
    case _ListAction.settings:
      ref
          .read(dashboardSectionProvider.notifier)
          .select(DashboardSection.settings);
      break;
    case _ListAction.refresh:
      ref.invalidate(dashboardSnapshotProvider);
      if (context.mounted) showSuccessToast(context, 'Painel atualizado.');
      break;
    case _ListAction.downloadApp:
      await _openMobileAppDownload(context, ref);
      break;
    case _ListAction.lists:
      await showDialog<void>(
        context: context,
        builder: (_) => const _ListsConsentDialog(),
      );
      break;
    case _ListAction.favoriteMessages:
      showPanel(ConversationUtilityPanel.favoriteMessages);
      break;
    case _ListAction.resyncHistory:
      if (activeInstance != null) {
        await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (_) => _HistoryResyncDialog(instance: activeInstance),
        );
      }
      break;
    case _ListAction.selectConversations:
      showPanel(ConversationUtilityPanel.selectConversations);
      break;
    case _ListAction.markAllRead:
      await _markThreadsReadFromHeader(context, ref, threads);
      break;
    case _ListAction.disconnect:
      await _confirmPanelLogout(context, ref);
      break;
  }
}

Future<void> _markThreadsReadFromHeader(
  BuildContext context,
  WidgetRef ref,
  List<ConversationThread> threads,
) async {
  final unreadThreads = threads
      .where((thread) => thread.unreadCount > 0)
      .toList(growable: false);
  if (unreadThreads.isEmpty) {
    showSuccessToast(context, 'Nenhuma conversa não lida.');
    return;
  }
  try {
    final api = ref.read(apiClientProvider);
    for (final thread in unreadThreads) {
      await api.runConversationAction(thread, 'read');
    }
    ref.invalidate(dashboardSnapshotProvider);
    if (context.mounted) {
      showSuccessToast(
        context,
        '${unreadThreads.length} conversa(s) marcada(s) como lida(s).',
      );
    }
  } catch (error) {
    if (context.mounted) showErrorToast(context, error.toString());
  }
}

class _MobileShell extends ConsumerWidget {
  const _MobileShell({required this.data, required this.section});

  final DashboardSnapshot data;
  final DashboardSection section;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final utilityPanel = ref.watch(conversationUtilityPanelProvider);
    final selectedThread = ref.watch(selectedThreadProvider);
    final selectedGroup = ref.watch(selectedGroupProvider);

    if (section == DashboardSection.conversations &&
        utilityPanel != ConversationUtilityPanel.none) {
      return Column(
        children: [
          Expanded(
            child: _ConversationUtilityPanel(data: data, panel: utilityPanel),
          ),
          _MobileSectionBar(section: section),
        ],
      );
    }

    // Open chat is a separate route-like surface; list is not mounted (no jank).
    if ((section == DashboardSection.conversations && selectedThread != null) ||
        (section == DashboardSection.internalGroups &&
            selectedThread?.isInternalGroup == true)) {
      final activeThread = selectedThread!;
      if (activeThread.isSupport) {
        return UserSupportChatScreen(
          thread: activeThread,
          onConversationChanged: () =>
              ref.invalidate(dashboardSnapshotProvider),
          leading: IconButton(
            onPressed: () =>
                ref.read(selectedThreadProvider.notifier).select(null),
            icon: const Icon(Icons.arrow_back_rounded),
          ),
        );
      }
      return ChatScreen(
        thread: activeThread,
        group: _groupForThread(data.groups, activeThread),
        onShowGroupInfo: activeThread.isInternalGroup
            ? () => showInternalGroupManagement(
                context,
                ref,
                activeThread,
                onDeleted: () =>
                    ref.read(selectedThreadProvider.notifier).select(null),
              )
            : null,
        onReconnectProfile: activeThread.isInternalGroup
            ? null
            : () => _openProfileReconnect(ref, activeThread.instanceId),
        onOpenContact: activeThread.isInternalGroup
            ? null
            : (contact) => _openContactConversation(
                ref,
                data,
                activeThread.instanceId,
                _whatsappContactFromCard(contact),
              ),
        onOpenParticipantConversation: activeThread.isInternalGroup
            ? null
            : (jid, displayName) => _openParticipantConversation(
                ref,
                data,
                activeThread.instanceId,
                jid,
                displayName,
              ),
        onOpenTools: () => ref
            .read(dashboardSectionProvider.notifier)
            .select(DashboardSection.tools),
        onOpenCalls: () => ref
            .read(dashboardSectionProvider.notifier)
            .select(DashboardSection.calls),
        onOpenSupport: () => _openSupportConversation(ref, data),
        onOpenGroupSettings:
            activeThread.isInternalGroup && activeThread.instanceIsAdmin != true
            ? null
            : () {
                final group = _groupForThread(data.groups, activeThread);
                if (group == null) return;
                _openGroupBotSettingsPanel(context, group);
              },
        leading: IconButton(
          onPressed: () =>
              ref.read(selectedThreadProvider.notifier).select(null),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
      );
    }

    if (section == DashboardSection.groups && selectedGroup != null) {
      return GroupSettingsScreen(
        group: selectedGroup,
        leading: IconButton(
          onPressed: () =>
              ref.read(selectedGroupProvider.notifier).select(null),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
      );
    }

    // List-only body: does not depend on selectedThread once chat is closed.
    return Stack(
      fit: StackFit.expand,
      children: [
        Column(
          children: [
            _MobileDashboardHeader(data: data),
            Expanded(
              child: switch (section) {
                DashboardSection.conversations => _ConversationList(
                  data: data,
                  showTopHeader: false,
                ),
                DashboardSection.internalGroups => _ConversationList(
                  data: data,
                  showTopHeader: false,
                  fixedFilter: ConversationListFilter.internalGroups,
                ),
                DashboardSection.broadcasts => BroadcastPanel(
                  instanceId: _resolveActiveInstance(
                    data.instances,
                    ref.watch(selectedInstanceIdProvider),
                  )?.id,
                  onCreateProfile: () => _startProfileCreation(ref),
                ),
                DashboardSection.profiles => ProfileConnectionPanel(
                  onActivate: (instance) {
                    ref
                        .read(selectedInstanceIdProvider.notifier)
                        .select(instance.id);
                  },
                ),
                DashboardSection.status => StatusPanel(
                  activeInstanceId: ref.watch(selectedInstanceIdProvider),
                ),
                DashboardSection.media => const MediaPanel(),
                DashboardSection.channels => const _ChannelsList(),
                DashboardSection.communities => _CommunitiesList(data: data),
                DashboardSection.calls => CallsPanel(instances: data.instances),
                DashboardSection.groups => _GroupList(
                  data: data,
                  selected: selectedGroup,
                ),
                DashboardSection.tools => const FlowsPanel(),
                DashboardSection.raffles => const RafflesPanel(),
                DashboardSection.store => StorePanel(
                  instances: data.instances,
                  threads: data.threads,
                  onOpenConversation: (thread) {
                    ref
                        .read(dashboardSectionProvider.notifier)
                        .select(DashboardSection.conversations);
                    unawaited(
                      _openConversationThreadWithProfileGuard(
                        context,
                        ref,
                        thread,
                        data.instances,
                      ),
                    );
                  },
                ),
                DashboardSection.campaigns => BroadcastPanel(
                  instanceId: _resolveActiveInstance(
                    data.instances,
                    ref.watch(selectedInstanceIdProvider),
                  )?.id,
                  onCreateProfile: () => _startProfileCreation(ref),
                ),
                DashboardSection.affiliates => const AffiliatesPanel(),
                DashboardSection.payments => const PaymentsPanel(),
                DashboardSection.apiRest => const ApiRestPanel(),
                DashboardSection.webhooks => const ApiRestPanel(),
                DashboardSection.settings => _MobileSettingsHub(
                  instances: data.instances,
                ),
              },
            ),
            _MobileSectionBar(section: section),
          ],
        ),
        if (section == DashboardSection.conversations ||
            section == DashboardSection.internalGroups)
          Positioned(
            right: 18,
            bottom: 76,
            child: FloatingActionButton(
              heroTag: section == DashboardSection.internalGroups
                  ? 'new-internal-group-mobile'
                  : 'new-conversation-mobile',
              elevation: 3,
              backgroundColor: WaTheme.of(context).accent,
              foregroundColor: Colors.white,
              tooltip: section == DashboardSection.internalGroups
                  ? 'Criar grupo BotAdmin'
                  : 'Nova conversa',
              onPressed: () => unawaited(
                section == DashboardSection.internalGroups
                    ? _openInternalGroupCreate(context, ref)
                    : _openNewConversationPanel(
                        context,
                        ref,
                        _resolveActiveInstance(
                          data.instances,
                          ref.read(selectedInstanceIdProvider),
                        ),
                      ),
              ),
              child: const Icon(Icons.add_rounded, size: 28),
            ),
          ),
      ],
    );
  }
}

/// Hub de configurações no mobile: atalhos (grupos/ferramentas/…) + painel.
class _MobileSettingsHub extends ConsumerWidget {
  const _MobileSettingsHub({required this.instances});

  final List<BotInstance> instances;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SettingsPanel(instances: instances);
  }
}

class _HistoryResyncDialog extends ConsumerStatefulWidget {
  const _HistoryResyncDialog({required this.instance});

  final BotInstance instance;

  @override
  ConsumerState<_HistoryResyncDialog> createState() =>
      _HistoryResyncDialogState();
}

class _HistoryResyncDialogState extends ConsumerState<_HistoryResyncDialog> {
  String _status = 'requested';
  String? _error;
  int _progress = 0;
  int _messages = 0;
  int _forwarded = 0;
  int _conversations = 0;
  bool _starting = true;
  bool _stopped = false;

  bool get _finished => _status == 'completed' || _status == 'failed';

  @override
  void initState() {
    super.initState();
    unawaited(_startAndMonitor());
  }

  @override
  void dispose() {
    _stopped = true;
    super.dispose();
  }

  Map<String, dynamic> _resyncFrom(Map<String, dynamic> json) {
    final value = json['resync'];
    return value is Map ? Map<String, dynamic>.from(value) : json;
  }

  int _intValue(Object? value) => switch (value) {
    int number => number,
    num number => number.toInt(),
    String text => int.tryParse(text) ?? 0,
    _ => 0,
  };

  void _apply(Map<String, dynamic> json) {
    final data = _resyncFrom(json);
    if (!mounted) return;
    setState(() {
      _status = data['status']?.toString().trim().toLowerCase() ?? _status;
      _progress = _intValue(data['progress']).clamp(0, 100).toInt();
      _messages = _intValue(data['messages']);
      _forwarded = _intValue(data['forwarded']);
      _conversations = _intValue(data['conversations']);
      final rawError = data['error']?.toString().trim();
      _error = rawError?.isNotEmpty == true ? rawError : null;
      _starting = false;
    });
  }

  Future<void> _startAndMonitor() async {
    final api = ref.read(apiClientProvider);
    try {
      _apply(await api.startFullHistoryResync(widget.instance.id));
    } on BotAdminApiException catch (error) {
      // HTTP 409 means an earlier click already started the same safe job.
      if (error.statusCode != 409) {
        if (!mounted) return;
        setState(() {
          _status = 'failed';
          _error = error.message;
          _starting = false;
        });
        return;
      }
    }

    while (!_stopped && mounted) {
      try {
        _apply(await api.loadFullHistoryResyncStatus(widget.instance.id));
        if (_finished) {
          if (_status == 'completed') {
            ref.invalidate(dashboardSnapshotProvider);
          }
          return;
        }
      } catch (_) {
        // A sincronização continua na API mesmo com uma consulta temporariamente
        // sem rede. A próxima leitura retoma o progresso sem repetir o pedido.
      }
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  String get _title => switch (_status) {
    'completed' => 'Histórico resincronizado',
    'failed' => 'Resincronização interrompida',
    'receiving' => 'Recebendo histórico local',
    _ => 'Solicitando histórico local',
  };

  String get _description => switch (_status) {
    'completed' =>
      'As mensagens recuperadas foram mescladas sem duplicação. O perfil permaneceu conectado.',
    'failed' =>
      _error ?? 'O telefone não aceitou a solicitação de histórico completo.',
    _ =>
      'O WhatsApp do telefone está reemitindo todo o histórico disponível. Não desconecte o telefone; você pode fechar esta janela e continuar usando o painel.',
  };

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final determinate = _progress > 0 ? _progress / 100 : null;
    return AlertDialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      title: Row(
        children: [
          Icon(
            _status == 'completed'
                ? Icons.check_circle_rounded
                : _status == 'failed'
                ? Icons.error_outline_rounded
                : Icons.sync_rounded,
            color: _status == 'failed' ? Colors.orange : wa.accent,
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(_title)),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _description,
              style: TextStyle(color: wa.textSecondary, height: 1.4),
            ),
            if (!_finished) ...[
              const SizedBox(height: 20),
              LinearProgressIndicator(value: _starting ? null : determinate),
              const SizedBox(height: 12),
              Text(
                _progress > 0
                    ? '$_progress% • $_forwarded de $_messages mensagens processadas'
                    : _forwarded > 0
                    ? '$_forwarded mensagens processadas em $_conversations conversas'
                    : 'Aguardando o telefone preparar os primeiros blocos…',
                style: TextStyle(color: wa.textSecondary, fontSize: 13),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(_finished ? 'Concluir' : 'Continuar em segundo plano'),
        ),
      ],
    );
  }
}

enum _ListAction {
  profileSwitcher,
  renewProfile,
  newProfile,
  newConversation,
  newInternalGroup,
  joinInternalGroup,
  support,
  toggleTheme,
  settings,
  refresh,
  downloadApp,
  favoriteMessages,
  resyncHistory,
  selectConversations,
  lists,
  markAllRead,
  disconnect,
}

String _shortCount(int value) {
  if (value > 99) return '99+';
  return value.toString();
}

final DateFormat _threadTimeHm = DateFormat('HH:mm');
final DateFormat _threadTimeDmy = DateFormat('dd/MM/yy');

String _formatThreadTime(DateTime value) {
  if (value.millisecondsSinceEpoch <= 0) return '';
  final local = value.toLocal();
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(local.year, local.month, local.day);
  final delta = today.difference(day).inDays;
  if (delta == 0) return _threadTimeHm.format(local);
  if (delta == 1) return 'Ontem';
  if (delta > 1 && delta < 7) {
    const weekdays = [
      'segunda-feira',
      'terça-feira',
      'quarta-feira',
      'quinta-feira',
      'sexta-feira',
      'sábado',
      'domingo',
    ];
    return weekdays[local.weekday - 1];
  }
  return _threadTimeDmy.format(local);
}

String _formatStatusTime(DateTime value) {
  if (value.millisecondsSinceEpoch <= 0) return 'Sem data';
  final local = value.toLocal();
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(local.year, local.month, local.day);
  final delta = today.difference(day).inDays;
  final time = DateFormat('HH:mm').format(local);
  if (delta == 0) return 'Hoje às $time';
  if (delta == 1) return 'Ontem às $time';
  return DateFormat('dd/MM/yyyy HH:mm').format(local);
}

BotGroup? _groupForThread(List<BotGroup> groups, ConversationThread? thread) {
  if (thread == null || !thread.isGroup) return null;
  if (thread.isInternalGroup) {
    final botGroupId = thread.internalBotGroupId;
    final internalGroupId = thread.linkedGroupId;
    if (botGroupId == null || botGroupId <= 0 || internalGroupId == null) {
      return null;
    }
    return BotGroup(
      id: botGroupId,
      name: thread.title,
      remoteJid: 'botadmin-internal:$internalGroupId',
      botEnabled: thread.internalBotEnabled == true,
      description: thread.groupDescription,
      avatarUrl: thread.avatarUrl,
    );
  }
  final jid = _normalizeConversationJidKey(thread.chatJid);
  for (final group in groups) {
    if (_normalizeConversationJidKey(group.remoteJid) == jid) return group;
  }
  return null;
}

String _normalizeConversationJidKey(String value) {
  final lowered = value.trim().toLowerCase();
  if (lowered.isEmpty) return lowered;
  if (lowered.endsWith('@g.us') ||
      lowered.endsWith('@newsletter') ||
      lowered.endsWith('@broadcast')) {
    return lowered;
  }
  final local = lowered.split('@').first;
  final digits = local.replaceAll(RegExp(r'\D+'), '');
  if (RegExp(r'^120363\d{6,}$').hasMatch(digits)) return '$digits@g.us';
  if (lowered.contains('@')) return lowered;
  return digits.isEmpty ? lowered : '$digits@s.whatsapp.net';
}

List<ConversationThread> _safeConversationThreads(
  Iterable<ConversationThread> threads,
) {
  final safe = threads
      .where((thread) => thread.isSafeConversationListItem)
      .toList(growable: false);
  safe.sort(_compareConversationThreads);
  return safe;
}

String _conversationThreadKey(ConversationThread thread) =>
    '${thread.instanceId}|${thread.chatJid}';

String? _conversationEventKey(int? instanceId, String? chatJid) {
  final jid = chatJid?.trim();
  if (instanceId == null || instanceId <= 0 || jid == null || jid.isEmpty) {
    return null;
  }
  return '$instanceId|$jid';
}

int _compareConversationThreads(
  ConversationThread left,
  ConversationThread right,
) {
  if (left.pinned != right.pinned) return left.pinned ? -1 : 1;
  final activity = right.lastActivity.compareTo(left.lastActivity);
  if (activity != 0) return activity;
  final unread = right.unreadCount.compareTo(left.unreadCount);
  if (unread != 0) return unread;
  return left.title.toLowerCase().compareTo(right.title.toLowerCase());
}

List<ConversationThread> _filterConversationThreads(
  List<ConversationThread> threads,
  ConversationListFilter filter,
) {
  return switch (filter) {
    ConversationListFilter.all => threads,
    ConversationListFilter.unread =>
      threads.where((thread) => thread.unreadCount > 0).toList(growable: false),
    ConversationListFilter.privateChats =>
      threads.where(_isPrivateConversationThread).toList(growable: false),
    ConversationListFilter.groups =>
      threads
          .where(
            (thread) =>
                thread.isGroup &&
                !thread.isCommunity &&
                !thread.isInternalGroup,
          )
          .toList(growable: false),
    ConversationListFilter.internalGroups =>
      threads.where((thread) => thread.isInternalGroup).toList(growable: false),
    ConversationListFilter.channels =>
      threads.where((thread) => thread.isChannel).toList(growable: false),
    ConversationListFilter.communities =>
      threads.where((thread) => thread.isCommunity).toList(growable: false),
  };
}

bool _isPrivateConversationThread(ConversationThread thread) {
  if (thread.isSupport) return true;
  if (thread.isInternalGroup) return false;
  final chatType = thread.chatType?.trim().toLowerCase();
  return !thread.isGroup &&
      !thread.isChannel &&
      !thread.isBroadcast &&
      (thread.isContact || chatType == null || chatType == 'private');
}

const List<DashboardSection> _kMobileBottomTabs = [
  DashboardSection.conversations,
  DashboardSection.internalGroups,
  DashboardSection.broadcasts,
  DashboardSection.profiles,
  DashboardSection.status,
  DashboardSection.media,
  DashboardSection.calls,
  DashboardSection.tools,
  DashboardSection.raffles,
  DashboardSection.store,
  DashboardSection.affiliates,
  DashboardSection.payments,
  DashboardSection.apiRest,
  DashboardSection.settings,
];

class _MobileSectionBar extends ConsumerStatefulWidget {
  const _MobileSectionBar({required this.section});

  final DashboardSection section;

  @override
  ConsumerState<_MobileSectionBar> createState() => _MobileSectionBarState();
}

class _MobileSectionBarState extends ConsumerState<_MobileSectionBar> {
  final ScrollController _controller = ScrollController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final partnerRole = ref
        .watch(authControllerProvider)
        .value
        ?.user
        .partnerRole;
    final tabs = (partnerRole ?? '').isNotEmpty
        ? const <DashboardSection>[DashboardSection.affiliates]
        : _kMobileBottomTabs;
    final activeTab = _mobileBottomTabFor(widget.section);

    return Material(
      color: wa.panel,
      child: SafeArea(
        top: false,
        child: Container(
          height: 62,
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: wa.divider)),
          ),
          child: Row(
            children: [
              if ((partnerRole ?? '').isEmpty)
                _MobileNavArrow(
                  icon: Icons.keyboard_arrow_left_rounded,
                  onTap: () => _scrollBy(-260),
                ),
              Expanded(
                child: ScrollConfiguration(
                  behavior: const MaterialScrollBehavior().copyWith(
                    dragDevices: {
                      PointerDeviceKind.touch,
                      PointerDeviceKind.mouse,
                      PointerDeviceKind.trackpad,
                    },
                  ),
                  child: ListView.separated(
                    controller: _controller,
                    scrollDirection: Axis.horizontal,
                    physics: const BouncingScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    itemCount: tabs.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 2),
                    itemBuilder: (context, index) {
                      final entry = tabs[index];
                      final item = (partnerRole ?? '').isNotEmpty
                          ? const _MobileNavData(
                              Icons.handshake_outlined,
                              'Parceiros',
                            )
                          : _mobileNavData(entry);
                      return SizedBox(
                        width: 82,
                        child: _MobileNavItem(
                          selected: activeTab == entry,
                          icon: item.icon,
                          label: item.label,
                          onTap: () {
                            if (entry == DashboardSection.store) {
                              unawaited(
                                _openStorePanePicker(
                                  context,
                                  ref,
                                  mobile: true,
                                ),
                              );
                              return;
                            }
                            ref
                                .read(dashboardSectionProvider.notifier)
                                .select(entry);
                          },
                        ),
                      );
                    },
                  ),
                ),
              ),
              if ((partnerRole ?? '').isEmpty)
                _MobileNavArrow(
                  icon: Icons.keyboard_arrow_right_rounded,
                  onTap: () => _scrollBy(260),
                ),
            ],
          ),
        ),
      ),
    );
  }

  void _scrollBy(double delta) {
    if (!_controller.hasClients) return;
    final target = (_controller.offset + delta).clamp(
      _controller.position.minScrollExtent,
      _controller.position.maxScrollExtent,
    );
    unawaited(
      _controller.animateTo(
        target,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
      ),
    );
  }
}

Future<void> _openStorePanePicker(
  BuildContext context,
  WidgetRef ref, {
  required bool mobile,
  BuildContext? anchorContext,
}) async {
  const entries = [
    (StorePane.categories, Icons.category_outlined, 'Categorias'),
    (StorePane.products, Icons.shopping_bag_outlined, 'Produtos'),
    (StorePane.inventory, Icons.inventory_2_outlined, 'Estoque'),
    (StorePane.iptv, Icons.live_tv_outlined, 'IPTV'),
    (StorePane.smm, Icons.rocket_launch_outlined, 'Painel SMM'),
    (StorePane.customers, Icons.people_outline_rounded, 'Clientes'),
  ];
  StorePane? selected;
  if (mobile) {
    selected = await showBotAdminBottomSheet<StorePane>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(
              title: Text(
                'Gerenciar Store',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
            for (final entry in entries)
              ListTile(
                leading: Icon(entry.$2),
                title: Text(entry.$3),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => Navigator.of(context).pop(entry.$1),
              ),
          ],
        ),
      ),
    );
  } else {
    final overlay =
        Navigator.of(context).overlay?.context.findRenderObject() as RenderBox?;
    final anchor = anchorContext?.findRenderObject() as RenderBox?;
    final position = overlay == null || anchor == null
        ? const RelativeRect.fromLTRB(68, 320, 0, 0)
        : RelativeRect.fromRect(
            Rect.fromLTWH(
              anchor.localToGlobal(Offset.zero, ancestor: overlay).dx +
                  anchor.size.width +
                  4,
              anchor.localToGlobal(Offset.zero, ancestor: overlay).dy,
              1,
              anchor.size.height,
            ),
            Offset.zero & overlay.size,
          );
    selected = await showMenu<StorePane>(
      context: context,
      position: position,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      items: [
        for (final entry in entries)
          PopupMenuItem(
            value: entry.$1,
            child: Row(
              children: [
                Icon(entry.$2, size: 20),
                const SizedBox(width: 10),
                Text(entry.$3),
              ],
            ),
          ),
      ],
    );
  }
  if (selected == null) return;
  ref.read(storePaneProvider.notifier).select(selected);
  ref.read(dashboardSectionProvider.notifier).select(DashboardSection.store);
}

DashboardSection _mobileBottomTabFor(DashboardSection section) {
  if (_kMobileBottomTabs.contains(section)) return section;
  return DashboardSection.tools;
}

class _MobileNavArrow extends StatelessWidget {
  const _MobileNavArrow({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return SizedBox(
      width: 34,
      child: IconButton(
        padding: EdgeInsets.zero,
        icon: Icon(icon, color: wa.icon),
        onPressed: onTap,
        tooltip: 'Mais opções',
      ),
    );
  }
}

class _MobileNavData {
  const _MobileNavData(this.icon, this.label);

  final IconData icon;
  final String label;
}

_MobileNavData _mobileNavData(DashboardSection section) {
  return switch (section) {
    DashboardSection.conversations => const _MobileNavData(
      Icons.chat_rounded,
      'Conversas',
    ),
    DashboardSection.internalGroups => const _MobileNavData(
      Icons.forum_rounded,
      'Grupos BotAdmin',
    ),
    DashboardSection.broadcasts => const _MobileNavData(
      Icons.cell_tower_rounded,
      'Transmissão',
    ),
    DashboardSection.profiles => const _MobileNavData(
      Icons.qr_code_scanner_rounded,
      'Perfis',
    ),
    DashboardSection.status => const _MobileNavData(
      Icons.trip_origin_rounded,
      'Status',
    ),
    DashboardSection.media => const _MobileNavData(
      Icons.perm_media_outlined,
      'Mídias',
    ),
    DashboardSection.channels => const _MobileNavData(
      Icons.campaign_outlined,
      'Canais',
    ),
    DashboardSection.communities => const _MobileNavData(
      Icons.groups_2_outlined,
      'Comunidades',
    ),
    DashboardSection.calls => const _MobileNavData(
      Icons.call_rounded,
      'Chamadas',
    ),
    DashboardSection.groups => const _MobileNavData(
      Icons.groups_rounded,
      'Grupos',
    ),
    DashboardSection.tools => const _MobileNavData(
      Icons.account_tree_outlined,
      'Fluxos',
    ),
    DashboardSection.raffles => const _MobileNavData(
      Icons.confirmation_number_outlined,
      'Rifas',
    ),
    DashboardSection.store => const _MobileNavData(
      Icons.storefront_outlined,
      'Store',
    ),
    DashboardSection.campaigns => const _MobileNavData(
      Icons.outbox_outlined,
      'Autodivulgador',
    ),
    DashboardSection.affiliates => const _MobileNavData(
      Icons.sell_outlined,
      'Afiliados',
    ),
    DashboardSection.payments => const _MobileNavData(
      Icons.payments_outlined,
      'Pagamentos',
    ),
    DashboardSection.apiRest => const _MobileNavData(Icons.api_outlined, 'API'),
    DashboardSection.webhooks => const _MobileNavData(
      Icons.api_outlined,
      'API',
    ),
    DashboardSection.settings => const _MobileNavData(
      Icons.settings_outlined,
      'Configurações',
    ),
  };
}

class _MobileNavItem extends StatelessWidget {
  const _MobileNavItem({
    required this.selected,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final color = selected ? wa.accent : wa.icon;
    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: color, size: 26),
          const SizedBox(height: 3),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyList extends StatelessWidget {
  const _EmptyList({required this.searching});

  final bool searching;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          searching
              ? 'Nenhuma conversa encontrada para essa busca.'
              : 'Nenhuma conversa carregada ainda. Conecte uma instância ou atualize o diretório.',
          textAlign: TextAlign.center,
          style: TextStyle(color: wa.textSecondary, fontSize: 14.5),
        ),
      ),
    );
  }
}

class _EmptyGroups extends StatelessWidget {
  const _EmptyGroups({required this.searching});

  final bool searching;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          searching
              ? 'Nenhum grupo encontrado para essa busca.'
              : 'Nenhum grupo vinculado a este perfil ainda.',
          textAlign: TextAlign.center,
          style: TextStyle(color: wa.textSecondary, fontSize: 14.5),
        ),
      ),
    );
  }
}
