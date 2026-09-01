import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:file_selector/file_selector.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../core/auth_redirect.dart';
import '../../core/api_client.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/top_toast.dart';
import '../../core/wa_theme.dart';
import '../../core/call_audio_bridge.dart';
import '../../core/media_download.dart';
import '../../models/bot_instance.dart';
import '../../models/bot_group.dart';
import '../../models/conversation_thread.dart';
import '../../models/migration_models.dart';
import '../../models/session_user.dart';
import '../auth/auth_controller.dart';
import '../chat/chat_screen.dart';
import '../chat/media_players.dart';
import 'dashboard_controller.dart';
import 'live_calls_controller.dart';
import 'profiles_panel.dart';
import 'status_visual_editor.dart';

final botStatusSnapshotProvider = FutureProvider.autoDispose
    .family<BotStatusSnapshot, int?>(
      (ref, instanceId) =>
          ref.watch(apiClientProvider).loadBotStatus(instanceId: instanceId),
    );

final botFlowsProvider = FutureProvider.autoDispose<List<BotFlowSummary>>(
  (ref) => ref.watch(apiClientProvider).loadBotFlows(),
);

final userRafflesProvider = FutureProvider.autoDispose<List<UserRaffleSummary>>(
  (ref) => ref.watch(apiClientProvider).loadRaffles(),
);

final botStoreProvider = FutureProvider.autoDispose
    .family<BotStoreSnapshot, int>(
      (ref, instanceId) =>
          ref.watch(apiClientProvider).loadBotStore(instanceId),
    );

enum StorePane { categories, products, inventory, iptv, smm, customers }

class _MigrationCircleAvatar extends StatelessWidget {
  const _MigrationCircleAvatar({
    required this.url,
    required this.icon,
    this.radius = 20,
    this.backgroundColor,
    this.iconColor,
  });

  final String? url;
  final IconData icon;
  final double radius;
  final Color? backgroundColor;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final trimmed = url?.trim() ?? '';
    Widget fallback() => ColoredBox(
      color: backgroundColor ?? WaTheme.of(context).avatarFallback,
      child: Center(
        child: Icon(icon, color: iconColor ?? WaTheme.of(context).icon),
      ),
    );

    return SizedBox.square(
      dimension: radius * 2,
      child: ClipOval(
        child: trimmed.isEmpty
            ? fallback()
            : BotAdminCachedImage(
                imageUrl: trimmed,
                width: radius * 2,
                height: radius * 2,
                fit: BoxFit.cover,
                memCacheWidth: (radius * 3).round(),
                memCacheHeight: (radius * 3).round(),
                placeholder: (_, _) => fallback(),
                errorWidget: (_, _, _) => fallback(),
              ),
      ),
    );
  }
}

final storePaneProvider = NotifierProvider<StorePaneController, StorePane>(
  StorePaneController.new,
);

class StorePaneController extends Notifier<StorePane> {
  @override
  StorePane build() => StorePane.products;

  void select(StorePane pane) => state = pane;
}

final rafflePaymentSettingsProvider =
    FutureProvider.autoDispose<RafflePaymentSettings>(
      (ref) => ref.watch(apiClientProvider).loadRafflePaymentSettings(),
    );

final botAdCampaignsProvider =
    FutureProvider.autoDispose<BotAdCampaignsSnapshot>(
      (ref) => ref.watch(apiClientProvider).loadBotAdCampaigns(),
    );

final affiliateProvidersProvider =
    FutureProvider.autoDispose<List<AffiliateProviderSummary>>(
      (ref) => ref.watch(apiClientProvider).loadAffiliateProviders(),
    );

final affiliateLinksProvider =
    FutureProvider.autoDispose<AffiliateLinksSnapshot>(
      (ref) => ref.watch(apiClientProvider).loadAffiliateLinksSnapshot(),
    );

final resellerDashboardProvider =
    StreamProvider.autoDispose<ResellerDashboardSnapshot>((ref) {
      ref.keepAlive();
      return ref.watch(apiClientProvider).watchResellerDashboard();
    });

final partnerPaymentSettingsProvider =
    FutureProvider.autoDispose<Map<String, dynamic>>(
      (ref) => ref.watch(apiClientProvider).loadResellerPaymentSettings(),
    );

enum PartnerWorkspaceSection { overview, customers, team, credits, payments }

class PartnerManagementPanel extends StatelessWidget {
  const PartnerManagementPanel({
    required this.partnerSection,
    this.onCustomers,
    this.onCredits,
    this.onTeam,
    super.key,
  });
  final PartnerWorkspaceSection partnerSection;
  final VoidCallback? onCustomers;
  final VoidCallback? onCredits;
  final VoidCallback? onTeam;

  @override
  Widget build(BuildContext context) => AffiliatesPanel(
    partnerSection: partnerSection,
    onCustomers: onCustomers,
    onCredits: onCredits,
    onTeam: onTeam,
  );
}

final mediaStorageProvider = FutureProvider.autoDispose<MediaStorageSnapshot>(
  (ref) => ref.watch(apiClientProvider).loadMediaStorage(),
);

final commerceHistoryProvider =
    FutureProvider.autoDispose<CommerceHistorySnapshot>(
      (ref) => ref.watch(apiClientProvider).loadCommerceHistory(),
    );

final apiRestKeyProvider = FutureProvider.autoDispose<ApiRestKeySnapshot>(
  (ref) => ref.watch(apiClientProvider).loadApiRestKey(),
);

final metaWebhookSettingsProvider =
    FutureProvider.autoDispose<MetaWebhookSettings?>(
      (ref) => ref.watch(apiClientProvider).loadMetaWebhookSettings(),
    );

enum SettingsPane { account, instance }

final settingsPaneProvider =
    NotifierProvider<SettingsPaneController, SettingsPane>(
      SettingsPaneController.new,
    );

class SettingsPaneController extends Notifier<SettingsPane> {
  @override
  SettingsPane build() => SettingsPane.account;

  void select(SettingsPane pane) => state = pane;
}

final planSnapshotProvider = FutureProvider.autoDispose<PlanSnapshot>(
  (ref) => ref.watch(apiClientProvider).loadPlanSnapshot(),
);

final mobileUpdateProvider = FutureProvider.autoDispose<MobileUpdateSnapshot>(
  (ref) => ref.watch(apiClientProvider).loadMobileUpdate(),
);

final instanceSettingsProvider = FutureProvider.autoDispose
    .family<InstanceSettingsBundle, int>(
      (ref, instanceId) =>
          ref.watch(apiClientProvider).loadInstanceSettings(instanceId),
    );

class StatusPanel extends ConsumerStatefulWidget {
  const StatusPanel({super.key, this.activeInstanceId});

  final int? activeInstanceId;

  @override
  ConsumerState<StatusPanel> createState() => _StatusPanelState();
}

class _StatusPanelState extends ConsumerState<StatusPanel> {
  String? _selectedKey;
  String? _busyKey;
  int? _followupSyncInstanceId;
  Timer? _followupSyncTimer;

  @override
  void dispose() {
    _followupSyncTimer?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant StatusPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeInstanceId != widget.activeInstanceId) {
      _selectedKey = null;
      _followupSyncTimer?.cancel();
      _followupSyncInstanceId = null;
    }
  }

  void _scheduleSingleStatusSyncRefresh() {
    final instanceId = widget.activeInstanceId;
    if (instanceId == null || _followupSyncInstanceId == instanceId) return;
    _followupSyncInstanceId = instanceId;
    _followupSyncTimer = Timer(const Duration(seconds: 3), () {
      if (!mounted || widget.activeInstanceId != instanceId) return;
      ref.invalidate(botStatusSnapshotProvider(instanceId));
    });
  }

  bool _campaignBelongsToActiveInstance(BotAdCampaignSummary campaign) {
    final activeInstanceId = widget.activeInstanceId;
    if (activeInstanceId == null) return true;
    return campaign.targets.any((target) {
      if ((target['type'] ?? '').toString() != 'status') return false;
      return int.tryParse((target['instanceId'] ?? '').toString()) ==
          activeInstanceId;
    });
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = ref.watch(
      botStatusSnapshotProvider(widget.activeInstanceId),
    );
    final adCampaigns = ref.watch(botAdCampaignsProvider);
    return _ModuleSurface(
      title: 'Status',
      subtitle: 'Postagens, campanhas e status recebidos das instâncias.',
      icon: Icons.trip_origin_rounded,
      onRefresh: _refresh,
      child: snapshot.when(
        data: (data) {
          _scheduleSingleStatusSyncRefresh();
          final scheduledStatusCampaigns = adCampaigns.maybeWhen(
            data: (value) => value.campaigns
                .where(
                  (campaign) =>
                      campaign.isStatusCampaign &&
                      _campaignBelongsToActiveInstance(campaign),
                )
                .toList(growable: false),
            orElse: () => const <BotAdCampaignSummary>[],
          );
          final selected = _selectedStatusCampaign(scheduledStatusCampaigns);
          final list = _StatusManagementList(
            campaigns: scheduledStatusCampaigns,
            legacyCampaigns: data.campaigns,
            posts: data.posts,
            receivedStatuses: data.receivedStatuses,
            selectedKey: _selectedKey,
            busyKey: _busyKey,
            campaignsLoading: adCampaigns.isLoading,
            onCreateStatus: _openCreateStatusDialog,
            onOpenReceivedStatus: _openReceivedStatusViewer,
            onOpenPostedStatus: _openPostedStatusViewer,
            onPostedStatusAction: _handlePostedStatusAction,
            onSelectCampaign: (campaign, compact) {
              if (compact) {
                _openStatusCampaignActions(campaign);
                return;
              }
              setState(() => _selectedKey = 'campaign-${campaign.id}');
            },
            onCampaignAction: _handleStatusCampaignAction,
          );
          final detail = _StatusDetailPane(
            selected: selected,
            busy: selected != null && _busyKey == 'campaign-${selected.id}',
            posts: data.posts,
            receivedStatuses: data.receivedStatuses,
            onAction: selected == null
                ? null
                : (action) => _handleStatusCampaignAction(selected, action),
          );
          return _ManagementSplitSurface(list: list, detail: detail);
        },
        error: (error, _) =>
            _ErrorBlock(message: error.toString(), onRetry: _refresh),
        loading: () => const _LoadingBlock(),
      ),
    );
  }

  BotAdCampaignSummary? _selectedStatusCampaign(
    List<BotAdCampaignSummary> campaigns,
  ) {
    if (campaigns.isEmpty) return null;
    final selected = _selectedKey;
    if (selected == null) return campaigns.first;
    for (final campaign in campaigns) {
      if ('campaign-${campaign.id}' == selected) return campaign;
    }
    return campaigns.first;
  }

  void _refresh() {
    _followupSyncTimer?.cancel();
    _followupSyncInstanceId = null;
    ref.invalidate(botStatusSnapshotProvider(widget.activeInstanceId));
    ref.invalidate(botAdCampaignsProvider);
  }

  Future<void> _openStatusCampaignActions(BotAdCampaignSummary campaign) {
    return showBotAdminBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.settings_rounded),
              title: const Text('Comando da lista'),
              subtitle: const Text('Adicionar links pelo WhatsApp'),
              onTap: () {
                Navigator.of(context).pop();
                _handleStatusCampaignAction(campaign, 'command');
              },
            ),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Editar'),
              onTap: () {
                Navigator.of(context).pop();
                _handleStatusCampaignAction(campaign, 'edit');
              },
            ),
            ListTile(
              leading: const Icon(Icons.send_rounded),
              title: const Text('Enviar agora'),
              onTap: () {
                Navigator.of(context).pop();
                _handleStatusCampaignAction(campaign, 'run');
              },
            ),
            ListTile(
              leading: Icon(
                campaign.active
                    ? Icons.pause_circle_outline
                    : Icons.play_circle_outline,
              ),
              title: Text(campaign.active ? 'Pausar' : 'Ativar'),
              onTap: () {
                Navigator.of(context).pop();
                _handleStatusCampaignAction(campaign, 'toggle');
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: const Text('Excluir'),
              onTap: () {
                Navigator.of(context).pop();
                _handleStatusCampaignAction(campaign, 'delete');
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openCreateStatusDialog() async {
    final dashboard = ref.read(dashboardSnapshotProvider).value;
    final initialInstances = dashboard?.instances ?? const <BotInstance>[];
    final draft = await showDialog<_StatusDraft>(
      context: context,
      builder: (context) => _StatusDraftDialog(
        initialInstances: initialInstances,
        preferredInstanceId: widget.activeInstanceId,
      ),
    );
    if (draft == null) return;
    await _runStatusCreateAction(draft);
  }

  Future<void> _openRepostPostedStatus(
    StatusPost post, {
    required bool deleteAfter,
  }) async {
    final dashboard = ref.read(dashboardSnapshotProvider).value;
    final draft = await showDialog<_StatusDraft>(
      context: context,
      builder: (context) => _StatusDraftDialog(
        initialInstances: dashboard?.instances ?? const <BotInstance>[],
        initialPost: post,
        openVisualEditorOnStart:
            post.id.startsWith('received-') &&
            !(post.contentType ?? '').toLowerCase().contains('video'),
        preferredInstanceId: post.instanceId > 0
            ? post.instanceId
            : widget.activeInstanceId,
      ),
    );
    if (draft == null) return;
    final created = await _runStatusCreateAction(draft);
    if (created && deleteAfter) {
      await _deletePostedStatus(post, askConfirmation: false);
    }
  }

  Future<void> _handlePostedStatusAction(StatusPost post, String action) async {
    switch (action) {
      case 'delete':
        await _deletePostedStatus(post, askConfirmation: true);
        return;
      case 'repost':
        await _openRepostPostedStatus(post, deleteAfter: false);
        return;
      case 'delete_repost':
        await _openRepostPostedStatus(post, deleteAfter: true);
        return;
    }
  }

  Future<void> _deletePostedStatus(
    StatusPost post, {
    required bool askConfirmation,
  }) async {
    if (askConfirmation) {
      final confirmed = await _confirmAction(
        context,
        title: 'Apagar status',
        message: 'Este status também será removido do WhatsApp.',
        confirmLabel: 'Apagar',
        destructive: true,
      );
      if (!confirmed) return;
    }
    try {
      await ref.read(apiClientProvider).deletePostedStatus(post.id);
      _refresh();
      if (mounted) showSuccessToast(context, 'Status apagado.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _openEditStatusDialog(BotAdCampaignSummary campaign) async {
    final dashboard = ref.read(dashboardSnapshotProvider).value;
    final initialInstances = dashboard?.instances ?? const <BotInstance>[];
    final draft = await showDialog<_StatusDraft>(
      context: context,
      builder: (context) => _StatusDraftDialog(
        initialInstances: initialInstances,
        initialCampaign: campaign,
        preferredInstanceId: widget.activeInstanceId,
      ),
    );
    if (draft == null) return;
    await _runStatusUpdateAction(campaign, draft);
  }

  Future<bool> _runStatusCreateAction(_StatusDraft draft) async {
    if (_busyKey != null) return false;
    setState(() => _busyKey = 'status-new');
    try {
      final campaign = await ref
          .read(apiClientProvider)
          .createStatusCampaign(
            name: draft.name,
            instanceId: draft.instanceId,
            schedule: draft.schedule,
            contents: draft.contents,
            options: draft.options,
            status: draft.status,
            endAt: draft.endAt,
          );
      _queueStatusBackgroundAnalyses(campaign.id, draft.backgroundAnalyses);
      if (draft.runNow) {
        await ref.read(apiClientProvider).runBotAdCampaignNow(campaign.id);
      }
      await ref.read(sessionStoreProvider).clearStatusDraft(draft.autosaveKey);
      _refresh();
      if (mounted) {
        showSuccessToast(
          context,
          draft.backgroundAnalyses.isEmpty
              ? 'Status criado.'
              : 'Status criado. O Gemini está preparando as legendas em segundo plano.',
        );
      }
      return true;
    } catch (error) {
      if (mounted) showErrorToast(context, error);
      return false;
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  void _queueStatusBackgroundAnalyses(
    String campaignId,
    List<_StatusBackgroundAnalysis> analyses,
  ) {
    if (analyses.isEmpty) return;
    final api = ref.read(apiClientProvider);
    unawaited(() async {
      try {
        await api.queueStatusCampaignAnalyses(
          campaignId: campaignId,
          items: analyses
              .map(
                (analysis) => {
                  'contentId': analysis.contentId,
                  'provider': analysis.provider,
                  if (analysis.query.isNotEmpty) 'query': analysis.query,
                },
              )
              .toList(growable: false),
        );
      } catch (error) {
        debugPrint(
          '[status] não foi possível enfileirar análises da campanha $campaignId: $error',
        );
      }
    }());
  }

  Set<String> _statusMediaPaths(Iterable<Map<String, dynamic>> contents) {
    final paths = <String>{};
    for (final content in contents) {
      if (content['media'] is Map) {
        final path = (content['media'] as Map)['path']?.toString().trim() ?? '';
        if (path.isNotEmpty) paths.add(path);
      }
      if (content['config'] is! Map) continue;
      final config = content['config'] as Map;
      if (config['visualEditor'] is! Map) continue;
      final editor = config['visualEditor'] as Map;
      if (editor['mediaLayers'] is! List) continue;
      for (final layer in (editor['mediaLayers'] as List).whereType<Map>()) {
        final sourcePath = layer['sourcePath']?.toString().trim() ?? '';
        if (sourcePath.isNotEmpty) paths.add(sourcePath);
      }
    }
    return paths;
  }

  Future<void> _runStatusUpdateAction(
    BotAdCampaignSummary original,
    _StatusDraft draft,
  ) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = 'campaign-${original.id}');
    try {
      final updated = await ref
          .read(apiClientProvider)
          .updateStatusCampaign(
            campaignId: original.id,
            name: draft.name,
            instanceId: draft.instanceId,
            schedule: draft.schedule,
            contents: draft.contents,
            options: draft.options,
            status: draft.status,
            endAt: draft.endAt,
          );
      _queueStatusBackgroundAnalyses(updated.id, draft.backgroundAnalyses);
      if (draft.runNow) {
        await ref.read(apiClientProvider).runBotAdCampaignNow(updated.id);
      }
      final removedPaths = _statusMediaPaths(
        original.contents,
      ).difference(_statusMediaPaths(draft.contents));
      for (final path in removedPaths) {
        await ref
            .read(apiClientProvider)
            .deleteBotAdCampaignMedia(path)
            .catchError((_) {});
      }
      await ref.read(sessionStoreProvider).clearStatusDraft(draft.autosaveKey);
      _refresh();
      if (mounted) {
        showSuccessToast(
          context,
          draft.backgroundAnalyses.isEmpty
              ? 'Status atualizado.'
              : 'Status atualizado. O Gemini continuará analisando em segundo plano.',
        );
      }
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  Future<void> _openReceivedStatusViewer(_ReceivedStatusGroup group) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Fechar status',
      barrierColor: Colors.transparent,
      transitionDuration: const Duration(milliseconds: 140),
      pageBuilder: (context, animation, secondaryAnimation) {
        return _ReceivedStatusViewerDialog(
          group: group,
          onSave: (status) => unawaited(_saveReceivedStatus(status)),
          onRepost: (status) {
            Navigator.of(context).pop();
            unawaited(_openRepostReceivedStatus(status));
          },
        );
      },
    );
  }

  Future<void> _openPostedStatusViewer(StatusPost post) {
    final status = ReceivedStatus(
      id: post.id,
      authorKey: 'me-${post.instanceId}',
      senderName: 'Meu status',
      instanceName: post.instanceName,
      createdAt: post.createdAt,
      mediaUrl: post.mediaUrl,
      mimeType: (post.contentType ?? '').toLowerCase().contains('video')
          ? 'video/mp4'
          : (post.contentType ?? '').toLowerCase().contains('image')
          ? 'image/jpeg'
          : null,
      statusType: post.contentType,
      text: post.contentText,
      caption: post.mediaUrl == null ? null : post.contentText,
      allowReshare: true,
    );
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Fechar meu status',
      barrierColor: Colors.transparent,
      transitionDuration: const Duration(milliseconds: 140),
      pageBuilder: (dialogContext, animation, secondaryAnimation) {
        return _ReceivedStatusViewerDialog(
          group: _ReceivedStatusGroup(
            key: 'posted-${post.id}',
            items: [status],
          ),
          onSave: (value) => unawaited(_saveReceivedStatus(value)),
          onRepost: (_) {
            Navigator.of(dialogContext).pop();
            unawaited(_openRepostPostedStatus(post, deleteAfter: false));
          },
        );
      },
    );
  }

  Future<void> _saveReceivedStatus(ReceivedStatus status) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = 'status-save');
    try {
      late final Uint8List bytes;
      late final String mimeType;
      late final String extension;
      if (status.mediaUrl != null) {
        final source = await ref
            .read(apiClientProvider)
            .downloadMediaBytes(status.mediaUrl!);
        bytes = source.bytes;
        mimeType = status.mimeType ?? source.mimeType;
        extension = status.isVideo
            ? 'mp4'
            : status.isImage
            ? 'jpg'
            : mimeType.contains('ogg')
            ? 'ogg'
            : 'bin';
      } else {
        bytes = Uint8List.fromList(utf8.encode(status.bodyText ?? ''));
        mimeType = 'text/plain';
        extension = 'txt';
      }
      final fileName =
          'status-${status.senderName.replaceAll(RegExp(r'[^a-zA-Z0-9]+'), '-').toLowerCase()}-${DateTime.now().millisecondsSinceEpoch}.$extension';
      final savedAt = await saveMediaToDevice(
        bytes: bytes,
        fileName: fileName,
        mimeType: mimeType,
      );
      if (mounted) showSuccessToast(context, savedAt);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted && _busyKey == 'status-save') {
        setState(() => _busyKey = null);
      }
    }
  }

  Future<void> _openRepostReceivedStatus(ReceivedStatus status) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = 'status-repost');
    try {
      String? preparedMedia;
      var temporaryMedia = false;
      if (status.mediaUrl != null) {
        if (!status.isImage && !status.isVideo) {
          throw StateError('Este formato ainda não pode ser repostado.');
        }
        final source = await ref
            .read(apiClientProvider)
            .downloadMediaBytes(status.mediaUrl!);
        final mediaType = status.isVideo ? 'video' : 'image';
        final uploaded = await ref
            .read(apiClientProvider)
            .uploadBotAdCampaignMedia(
              bytes: source.bytes,
              fileName: status.isVideo
                  ? 'status-repost.mp4'
                  : 'status-repost.jpg',
              mimeType: status.mimeType ?? source.mimeType,
              mediaType: mediaType,
            );
        preparedMedia =
            uploaded['path']?.toString() ?? uploaded['url']?.toString();
        temporaryMedia = true;
      }
      if (!mounted) return;
      final seed = StatusPost(
        id: 'received-${status.id}',
        campaignName: 'Repost · ${status.senderName}',
        instanceName: status.instanceName,
        createdAt: DateTime.now(),
        instanceId: widget.activeInstanceId ?? 0,
        contentText: status.bodyText,
        contentType: status.isVideo
            ? 'video'
            : status.isImage
            ? 'image'
            : 'text',
        mediaUrl: preparedMedia,
        temporaryMedia: temporaryMedia,
      );
      setState(() => _busyKey = null);
      await _openRepostPostedStatus(seed, deleteAfter: false);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted && _busyKey == 'status-repost') {
        setState(() => _busyKey = null);
      }
    }
  }

  Future<void> _handleStatusCampaignAction(
    BotAdCampaignSummary campaign,
    String action,
  ) async {
    switch (action) {
      case 'command':
        await _openStatusCommandDialog(campaign);
        return;
      case 'edit':
        await _openEditStatusDialog(campaign);
        return;
      case 'run':
        await _runStatusCampaignAction(
          campaign,
          'Campanha de status enviada para processamento.',
          () => ref.read(apiClientProvider).runBotAdCampaignNow(campaign.id),
        );
        return;
      case 'toggle':
        await _runStatusCampaignAction(
          campaign,
          campaign.active ? 'Campanha de status pausada.' : 'Campanha ativada.',
          () => ref
              .read(apiClientProvider)
              .updateBotAdCampaignStatus(
                campaign.id,
                campaign.active ? 'paused' : 'scheduled',
              ),
        );
        return;
      case 'delete':
        final confirmed = await _confirmAction(
          context,
          title: 'Excluir status agendado',
          message: 'Excluir "${campaign.name}" definitivamente?',
          confirmLabel: 'Excluir',
          destructive: true,
        );
        if (!confirmed) return;
        await _runStatusCampaignAction(
          campaign,
          'Status agendado excluído.',
          () => ref.read(apiClientProvider).deleteBotAdCampaign(campaign.id),
        );
        return;
    }
  }

  Future<void> _openStatusCommandDialog(BotAdCampaignSummary campaign) async {
    final rawConfig = campaign.options['statusCommand'];
    final config = rawConfig is Map
        ? Map<String, dynamic>.from(rawConfig)
        : <String, dynamic>{};
    final controller = TextEditingController(
      text: (config['command'] ?? 'addstatus${campaign.numericId ?? ''}')
          .toString(),
    );
    var enabled = config['enabled'] != false;
    var provider = (config['captionProvider'] ?? 'gemini').toString();
    var saving = false;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setModalState) {
          final command = controller.text.trim().replaceFirst(
            RegExp(r'^[!/#\$%&.~]+'),
            '',
          );
          return AlertDialog(
            title: const Row(
              children: [
                Icon(Icons.settings_rounded),
                SizedBox(width: 10),
                Expanded(child: Text('Comando da lista')),
              ],
            ),
            content: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Envie este comando no WhatsApp seguido de um ou vários links. O BotAdmin resolve TikTok, Reels, Kwai e outras mídias, pede a legenda ao Gemini e adiciona tudo nesta lista já pronto para o agendamento.',
                      style: TextStyle(color: WaTheme.of(context).textMuted),
                    ),
                    const SizedBox(height: 16),
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      value: enabled,
                      title: const Text('Comando ativo'),
                      subtitle: const Text(
                        'Ao excluir esta lista, o comando deixa de existir automaticamente.',
                      ),
                      onChanged: saving
                          ? null
                          : (value) => setModalState(() => enabled = value),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: controller,
                      enabled: !saving,
                      autocorrect: false,
                      textCapitalization: TextCapitalization.none,
                      onChanged: (_) => setModalState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'Comando personalizado',
                        hintText: 'addstatus1',
                        prefixIcon: Icon(Icons.tag_rounded),
                        helperText:
                            '3 a 32 caracteres. Letras, números, _ ou -. O sistema não permite comandos repetidos.',
                      ),
                    ),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue:
                          {'gemini', 'auto', 'chatgpt'}.contains(provider)
                          ? provider
                          : 'gemini',
                      decoration: const InputDecoration(
                        labelText: 'IA para gerar a legenda',
                        prefixIcon: Icon(Icons.auto_awesome_rounded),
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'gemini',
                          child: Text('Gemini'),
                        ),
                        DropdownMenuItem(
                          value: 'auto',
                          child: Text('Automático (Gemini com fallback)'),
                        ),
                        DropdownMenuItem(
                          value: 'chatgpt',
                          child: Text('ChatGPT'),
                        ),
                      ],
                      onChanged: saving
                          ? null
                          : (value) => setModalState(
                              () => provider = value ?? 'gemini',
                            ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: WaTheme.of(context).searchBg,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        'Exemplos:\n$command https://tiktok.com/...\n\n$command link1, link2, link3\n\nTambém aceita links separados por barra ou por uma linha nova.',
                      ),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving
                    ? null
                    : () => Navigator.of(context).pop(false),
                child: const Text('Cancelar'),
              ),
              FilledButton.icon(
                onPressed: saving
                    ? null
                    : () async {
                        setModalState(() => saving = true);
                        try {
                          await ref
                              .read(apiClientProvider)
                              .updateStatusCampaignCommand(
                                campaignId: campaign.id,
                                enabled: enabled,
                                command: command,
                                captionProvider: provider,
                              );
                          if (dialogContext.mounted) {
                            Navigator.of(dialogContext).pop(true);
                          }
                        } catch (error) {
                          if (dialogContext.mounted) {
                            showErrorToast(dialogContext, error);
                            setModalState(() => saving = false);
                          }
                        }
                      },
                icon: saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.save_rounded),
                label: const Text('Salvar comando'),
              ),
            ],
          );
        },
      ),
    );
    controller.dispose();
    if (saved == true) {
      _refresh();
      if (mounted) showSuccessToast(context, 'Comando da lista atualizado.');
    }
  }

  Future<void> _runStatusCampaignAction(
    BotAdCampaignSummary campaign,
    String success,
    Future<void> Function() action,
  ) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = 'campaign-${campaign.id}');
    try {
      await action();
      _refresh();
      if (mounted) showSuccessToast(context, success);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }
}

class _StatusManagementList extends StatelessWidget {
  const _StatusManagementList({
    required this.campaigns,
    required this.legacyCampaigns,
    required this.posts,
    required this.receivedStatuses,
    required this.selectedKey,
    required this.busyKey,
    required this.campaignsLoading,
    required this.onCreateStatus,
    required this.onOpenReceivedStatus,
    required this.onOpenPostedStatus,
    required this.onPostedStatusAction,
    required this.onSelectCampaign,
    required this.onCampaignAction,
  });

  final List<BotAdCampaignSummary> campaigns;
  final List<StatusCampaign> legacyCampaigns;
  final List<StatusPost> posts;
  final List<ReceivedStatus> receivedStatuses;
  final String? selectedKey;
  final String? busyKey;
  final bool campaignsLoading;
  final VoidCallback onCreateStatus;
  final ValueChanged<_ReceivedStatusGroup> onOpenReceivedStatus;
  final ValueChanged<StatusPost> onOpenPostedStatus;
  final void Function(StatusPost post, String action) onPostedStatusAction;
  final void Function(BotAdCampaignSummary campaign, bool compact)
  onSelectCampaign;
  final void Function(BotAdCampaignSummary campaign, String action)
  onCampaignAction;

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 900;
    final receivedGroups = _groupReceivedStatusItems(receivedStatuses);
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 22, 24, 32),
      children: [
        _StatusHorizontalCarousel(
          itemCount: 1 + receivedGroups.length,
          itemBuilder: (context, index) {
            if (index == 0) {
              return _MyStatusLikeTile(
                title: 'Meu status',
                subtitle: 'Clique para atualizar seu status',
                onTap: onCreateStatus,
              );
            }
            final group = receivedGroups[index - 1];
            return _ReceivedStatusBubbleTile(
              group: group,
              onTap: () => onOpenReceivedStatus(group),
            );
          },
        ),
        const SizedBox(height: 34),
        _StatusSectionLabel('PROGRAMADOS'),
        const SizedBox(height: 12),
        if (campaignsLoading)
          const _LoadingBlock(compact: true)
        else if (campaigns.isEmpty && legacyCampaigns.isEmpty)
          const _StatusEmptyLine('Nenhum status programado ainda.')
        else ...[
          ...campaigns.map(
            (campaign) => _ScheduledStatusBubbleTile(
              campaign: campaign,
              selected: selectedKey == 'campaign-${campaign.id}',
              busy: busyKey == 'campaign-${campaign.id}',
              onTap: () => onSelectCampaign(campaign, compact),
              onAction: (action) => onCampaignAction(campaign, action),
            ),
          ),
          ...legacyCampaigns.map(
            (campaign) => _LegacyScheduledStatusTile(campaign: campaign),
          ),
        ],
        const SizedBox(height: 28),
        _StatusSectionLabel('POSTADOS'),
        const SizedBox(height: 12),
        if (posts.isEmpty)
          const _StatusEmptyLine('Nenhum status postado ainda.')
        else
          _StatusHorizontalCarousel(
            itemCount: posts.length,
            itemBuilder: (context, index) => _PostedStatusBubbleTile(
              post: posts[index],
              onTap: () => onOpenPostedStatus(posts[index]),
              onAction: (action) => onPostedStatusAction(posts[index], action),
            ),
          ),
      ],
    );
  }
}

class _MyStatusLikeTile extends StatelessWidget {
  const _MyStatusLikeTile({
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              _StatusCircle(label: title, active: false),
              Positioned(
                right: -3,
                bottom: -3,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: wa.accent,
                    shape: BoxShape.circle,
                    border: Border.all(color: wa.panel, width: 2),
                  ),
                  child: const SizedBox(
                    width: 20,
                    height: 20,
                    child: Icon(Icons.add_rounded, size: 15),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(width: 16),
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
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: wa.textMuted, fontSize: 14),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusSectionLabel extends StatelessWidget {
  const _StatusSectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Text(
      text,
      style: TextStyle(
        color: wa.textMuted,
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: .2,
      ),
    );
  }
}

class _StatusEmptyLine extends StatelessWidget {
  const _StatusEmptyLine(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Text(text, style: TextStyle(color: WaTheme.of(context).textMuted)),
    );
  }
}

class _StatusHorizontalCarousel extends StatelessWidget {
  const _StatusHorizontalCarousel({
    required this.itemCount,
    required this.itemBuilder,
  });

  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 86,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: itemCount,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) => SizedBox(
          width: MediaQuery.sizeOf(context).width < 600 ? 270 : 320,
          child: itemBuilder(context, index),
        ),
      ),
    );
  }
}

class _ScheduledStatusBubbleTile extends StatelessWidget {
  const _ScheduledStatusBubbleTile({
    required this.campaign,
    required this.selected,
    required this.busy,
    required this.onTap,
    required this.onAction,
  });

  final BotAdCampaignSummary campaign;
  final bool selected;
  final bool busy;
  final VoidCallback onTap;
  final ValueChanged<String> onAction;

  @override
  Widget build(BuildContext context) {
    final statusRandomizer = campaign.options['statusRandomizer'];
    final statusCommand = campaign.options['statusCommand'];
    final configuredCommand =
        statusCommand is Map && statusCommand['enabled'] != false
        ? statusCommand['command']?.toString().trim()
        : null;
    final dailyLimit = statusRandomizer is Map
        ? (statusRandomizer['dailyLimit'] ?? statusRandomizer['perDayCount'])
        : null;
    final dailyLimitLabel = dailyLimit == null
        ? ''
        : ' · limite $dailyLimit/dia';
    return _StatusRowShell(
      selected: selected,
      onTap: onTap,
      leading: _StatusCircle(
        label: campaign.name,
        active: campaign.active,
        icon: Icons.schedule_send_rounded,
      ),
      title: campaign.name,
      subtitle:
          '${_campaignStatusLabel(campaign.status)} · ${_scheduleKindLabel(campaign.scheduleKind)} · ${campaign.contentCount} status$dailyLimitLabel${configuredCommand == null || configuredCommand.isEmpty ? '' : ' · $configuredCommand'}',
      trailing: busy
          ? const SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : PopupMenuButton<String>(
              tooltip: 'Ações',
              onSelected: onAction,
              itemBuilder: (context) => [
                const PopupMenuItem(
                  value: 'command',
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.settings_rounded),
                    title: Text('Comando da lista'),
                  ),
                ),
                const PopupMenuItem(value: 'run', child: Text('Enviar agora')),
                PopupMenuItem(
                  value: 'toggle',
                  child: Text(campaign.active ? 'Pausar' : 'Ativar'),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem(value: 'delete', child: Text('Excluir')),
              ],
            ),
    );
  }
}

class _LegacyScheduledStatusTile extends StatelessWidget {
  const _LegacyScheduledStatusTile({required this.campaign});

  final StatusCampaign campaign;

  @override
  Widget build(BuildContext context) {
    return _StatusRowShell(
      leading: _StatusCircle(
        label: campaign.name,
        active: campaign.status.toLowerCase() == 'active',
        icon: Icons.schedule_rounded,
      ),
      title: campaign.name,
      subtitle:
          '${campaign.status} · ${campaign.scheduleKind} · ${campaign.contentCount} status',
    );
  }
}

class _PostedStatusBubbleTile extends StatelessWidget {
  const _PostedStatusBubbleTile({
    required this.post,
    this.onTap,
    this.onAction,
  });

  final StatusPost post;
  final VoidCallback? onTap;
  final ValueChanged<String>? onAction;

  @override
  Widget build(BuildContext context) {
    return _StatusRowShell(
      onTap: onTap,
      leading: _StatusCircle(
        label: post.campaignName,
        active: !post.hasError,
        icon: _statusIcon(post.contentType),
        avatarUrl: _absoluteStatusUrl(post.mediaUrl),
        showPlay: (post.contentType ?? '').toLowerCase().contains('video'),
      ),
      title: post.campaignName,
      subtitle:
          '${post.instanceName} · ${_formatDateTime(post.createdAt)} · '
          '${post.errorMessage ?? post.contentText ?? _statusTypeLabel(post.contentType)}',
      onLongPress: onAction == null ? null : () => onAction!('repost'),
      trailing: onAction == null
          ? null
          : PopupMenuButton<String>(
              tooltip: 'Ações do status',
              onSelected: onAction,
              itemBuilder: (context) => const [
                PopupMenuItem(value: 'repost', child: Text('Repostar')),
                PopupMenuItem(
                  value: 'delete_repost',
                  child: Text('Apagar e repostar'),
                ),
                PopupMenuDivider(),
                PopupMenuItem(value: 'delete', child: Text('Apagar')),
              ],
            ),
    );
  }
}

class _ReceivedStatusBubbleTile extends StatelessWidget {
  const _ReceivedStatusBubbleTile({required this.group, required this.onTap});

  final _ReceivedStatusGroup group;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return _StatusRowShell(
      onTap: onTap,
      leading: _StatusCircle(
        label: group.name,
        active: true,
        avatarUrl: _absoluteStatusUrl(
          group.latest.isImage ? group.latest.mediaUrl : group.avatarUrl,
        ),
        showPlay: group.latest.isVideo,
        segments: group.items.length,
      ),
      title: group.name,
      subtitle:
          '${_formatStatusTime(group.latest.createdAt)} · '
          '${group.latest.preview ?? _statusTypeLabel(group.latest.statusType)}',
      trailing: group.items.length > 1
          ? Text(
              group.items.length.toString(),
              style: TextStyle(
                color: WaTheme.of(context).accent,
                fontWeight: FontWeight.w900,
              ),
            )
          : null,
    );
  }
}

class _StatusRowShell extends StatelessWidget {
  const _StatusRowShell({
    required this.leading,
    required this.title,
    required this.subtitle,
    this.selected = false,
    this.onTap,
    this.onLongPress,
    this.trailing,
  });

  final Widget leading;
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: selected ? wa.searchBg : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
          child: Row(
            children: [
              leading,
              const SizedBox(width: 16),
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
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: wa.textMuted, fontSize: 14),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 8), trailing!],
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusCircle extends StatelessWidget {
  const _StatusCircle({
    required this.label,
    required this.active,
    this.avatarUrl,
    this.icon,
    this.segments = 1,
    this.showPlay = false,
  });

  final String label;
  final bool active;
  final String? avatarUrl;
  final IconData? icon;
  final int segments;
  final bool showPlay;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final initial = label.trim().isEmpty
        ? '?'
        : label.trim().characters.first.toUpperCase();
    final imageUrl = avatarUrl?.trim();
    return Container(
      width: 58,
      height: 58,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: active ? wa.accent : wa.border,
          width: active && segments > 1 ? 3 : 2,
        ),
      ),
      child: ClipOval(
        child: Stack(
          fit: StackFit.expand,
          children: [
            imageUrl == null || imageUrl.isEmpty
                ? ColoredBox(
                    color: wa.searchBg,
                    child: Center(
                      child: icon == null
                          ? Text(
                              initial,
                              style: TextStyle(
                                color: wa.textPrimary,
                                fontWeight: FontWeight.w800,
                              ),
                            )
                          : Icon(icon, color: active ? wa.accent : wa.icon),
                    ),
                  )
                : BotAdminCachedImage(
                    imageUrl: imageUrl,
                    fit: BoxFit.cover,
                    placeholder: (_, _) => ColoredBox(
                      color: wa.searchBg,
                      child: const Center(
                        child: SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    ),
                    errorWidget: (_, _, _) => ColoredBox(
                      color: wa.searchBg,
                      child: Center(
                        child: Text(
                          initial,
                          style: TextStyle(
                            color: wa.textPrimary,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                  ),
            if (showPlay)
              ColoredBox(
                color: Colors.black.withValues(alpha: .24),
                child: const Center(
                  child: Icon(
                    Icons.play_arrow_rounded,
                    color: Colors.white,
                    size: 28,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ReceivedStatusGroup {
  const _ReceivedStatusGroup({required this.key, required this.items});

  final String key;
  final List<ReceivedStatus> items;

  ReceivedStatus get latest => items.first;
  String get name => latest.senderName;
  String? get avatarUrl => latest.avatarUrl;
}

List<_ReceivedStatusGroup> _groupReceivedStatusItems(
  List<ReceivedStatus> statuses,
) {
  final grouped = <String, List<ReceivedStatus>>{};
  for (final status in statuses) {
    final key = status.authorKey.isEmpty ? status.senderName : status.authorKey;
    grouped.putIfAbsent(key, () => <ReceivedStatus>[]).add(status);
  }
  final groups = grouped.entries.map((entry) {
    final items = entry.value.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return _ReceivedStatusGroup(key: entry.key, items: items);
  }).toList();
  groups.sort((a, b) => b.latest.createdAt.compareTo(a.latest.createdAt));
  return groups;
}

class _StatusDraft {
  const _StatusDraft({
    required this.name,
    required this.instanceId,
    required this.schedule,
    required this.contents,
    required this.options,
    required this.status,
    required this.runNow,
    this.backgroundAnalyses = const <_StatusBackgroundAnalysis>[],
    this.endAt,
    this.autosaveKey,
  });

  final String name;
  final int instanceId;
  final Map<String, dynamic> schedule;
  final List<Map<String, dynamic>> contents;
  final Map<String, dynamic>? options;
  final String status;
  final bool runNow;
  final List<_StatusBackgroundAnalysis> backgroundAnalyses;
  final DateTime? endAt;
  final String? autosaveKey;
}

class _StatusBackgroundAnalysis {
  const _StatusBackgroundAnalysis({
    required this.contentId,
    required this.provider,
    required this.query,
  });

  final String contentId;
  final String provider;
  final String query;
}

class _StatusComposerItem {
  _StatusComposerItem(this.type, {String? id})
    : id = id ?? DateTime.now().microsecondsSinceEpoch.toString(),
      text = TextEditingController(),
      caption = TextEditingController(),
      mediaUrl = TextEditingController(),
      time = TextEditingController();

  final String id;
  String type;
  final TextEditingController text;
  final TextEditingController caption;
  final TextEditingController mediaUrl;
  final TextEditingController time;
  String mediaPath = '';
  String mimeType = '';
  String fileName = '';
  String suggestedTitle = '';
  String sourceUrl = '';
  String previewUrl = '';
  Map<String, dynamic>? instagramProfile;
  String analysisProvider = 'gemini';
  Map<String, dynamic>? visualEditor;
  bool prioritizeDaily = false;
  bool temporaryMedia = false;
  bool analyzeAfterSave = false;
  bool busy = false;
  String? feedback;
  String? error;
  Timer? resolveDebounce;

  void dispose() {
    resolveDebounce?.cancel();
    text.dispose();
    caption.dispose();
    mediaUrl.dispose();
    time.dispose();
  }
}

class _InstagramReelsImportResult {
  const _InstagramReelsImportResult({
    required this.reels,
    required this.analyzeWithGemini,
    required this.profile,
    required this.automaticProfile,
  });

  final List<Map<String, dynamic>> reels;
  final bool analyzeWithGemini;
  final String profile;
  final bool automaticProfile;
}

class _InstagramReelsImportDialog extends ConsumerStatefulWidget {
  const _InstagramReelsImportDialog();

  @override
  ConsumerState<_InstagramReelsImportDialog> createState() =>
      _InstagramReelsImportDialogState();
}

class _InstagramReelsImportDialogState
    extends ConsumerState<_InstagramReelsImportDialog> {
  final _profile = TextEditingController();
  final _reels = <Map<String, dynamic>>[];
  final _selected = <String>{};
  bool _loading = false;
  bool _analyzeWithGemini = true;
  bool _automaticProfile = false;
  String _loadedProfile = '';
  bool _hasMore = false;
  String _cursor = '';
  String? _error;

  String _value(Object? value) => value?.toString().trim() ?? '';

  String _candidateId(Map<String, dynamic> reel) =>
      _value(reel['id']).isNotEmpty
      ? _value(reel['id'])
      : _value(reel['sourceUrl']);

  String? _normalizeProfileInput(String raw) {
    var value = raw.trim();
    if (value.isEmpty) return null;
    if (RegExp(r'^https?://', caseSensitive: false).hasMatch(value)) {
      final uri = Uri.tryParse(value);
      if (uri == null ||
          !(uri.host.toLowerCase() == 'instagram.com' ||
              uri.host.toLowerCase().endsWith('.instagram.com'))) {
        return null;
      }
      final segments = uri.pathSegments
          .map((segment) => segment.trim())
          .where((segment) => segment.isNotEmpty)
          .toList(growable: false);
      value = segments.isEmpty ? '' : segments.first;
    }
    value = value.replaceFirst(RegExp(r'^@+'), '').trim();
    return RegExp(r'^[A-Za-z0-9._]{1,30}$').hasMatch(value) ? value : null;
  }

  Future<void> _load({required bool reset}) async {
    if (_loading) return;
    final profile = _normalizeProfileInput(_profile.text);
    if (profile == null) {
      setState(
        () => _error =
            'Informe um usuário válido, como cenasbrfilmes, @cenasbrfilmes ou a URL do perfil.',
      );
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      if (reset) {
        _cursor = '';
        _hasMore = false;
      }
    });
    try {
      final result = await ref
          .read(apiClientProvider)
          .loadInstagramProfileReels(
            profile: profile,
            cursor: reset ? '' : _cursor,
            limit: 24,
            pages: 2,
          );
      final incoming = (result['candidates'] is List)
          ? (result['candidates'] as List)
                .whereType<Map>()
                .map(Map<String, dynamic>.from)
                .toList(growable: false)
          : const <Map<String, dynamic>>[];
      if (!mounted) return;
      setState(() {
        if (reset) {
          _reels.clear();
          _selected.clear();
        }
        final known = _reels.map(_candidateId).toSet();
        for (final reel in incoming) {
          if (known.add(_candidateId(reel))) _reels.add(reel);
        }
        _cursor = _value(result['nextCursor']);
        _loadedProfile = _value(result['profile']).isNotEmpty
            ? _value(result['profile'])
            : profile;
        _hasMore = result['hasMore'] == true && _cursor.isNotEmpty;
        if (_reels.isEmpty) {
          _error = 'Nenhum Reel público foi encontrado neste perfil.';
        }
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString().replaceFirst('Exception: ', '');
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _toggle(Map<String, dynamic> reel) {
    final id = _candidateId(reel);
    if (id.isEmpty) return;
    setState(() {
      if (!_selected.remove(id)) {
        _selected.add(id);
        _error = null;
      }
    });
  }

  void _selectAll() {
    setState(() {
      _selected
        ..clear()
        ..addAll(_reels.map(_candidateId).where((id) => id.isNotEmpty));
      _error = null;
    });
  }

  void _finish() {
    final selected = _reels
        .where((reel) => _selected.contains(_candidateId(reel)))
        .toList(growable: false);
    if (selected.isEmpty && !_automaticProfile) {
      setState(() => _error = 'Selecione pelo menos um Reel.');
      return;
    }
    Navigator.of(context).pop(
      _InstagramReelsImportResult(
        reels: selected,
        analyzeWithGemini: _analyzeWithGemini,
        profile: _loadedProfile,
        automaticProfile: _automaticProfile,
      ),
    );
  }

  @override
  void dispose() {
    _profile.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final compact = media.size.width < 680;
    final shortLandscape = media.size.width >= 680 && media.size.height < 650;
    final wa = WaTheme.of(context);
    return Dialog(
      insetPadding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 24,
        vertical: compact ? 10 : 24,
      ),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: 920,
            maxHeight: media.size.height - media.padding.vertical - 8,
          ),
          child: Padding(
            padding: EdgeInsets.all(compact ? 12 : 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Icon(Icons.video_collection_outlined),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Importar Reels de perfil',
                            style: TextStyle(
                              fontSize: 19,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          if (!shortLandscape)
                            const Text(
                              'Capture conteúdos públicos e escolha quais entrarão na programação.',
                            ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Fechar',
                      onPressed: _loading
                          ? null
                          : () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
                SizedBox(height: shortLandscape ? 6 : 14),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _profile,
                        autofocus: true,
                        enabled: !_loading,
                        textInputAction: TextInputAction.search,
                        onSubmitted: (_) => _load(reset: true),
                        decoration: InputDecoration(
                          labelText: 'Nome de usuário do Instagram',
                          hintText: 'cenasbrfilmes ou @cenasbrfilmes',
                          helperText: shortLandscape
                              ? null
                              : 'Também aceita a URL completa do perfil.',
                          prefixIcon: const Icon(Icons.alternate_email_rounded),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      onPressed: _loading ? null : () => _load(reset: true),
                      icon: const Icon(Icons.manage_search_rounded),
                      label: Text(compact ? 'Buscar' : 'Buscar Reels'),
                    ),
                  ],
                ),
                if (_loading) ...[
                  const SizedBox(height: 10),
                  const LinearProgressIndicator(),
                ],
                if (_reels.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${_reels.length} encontrados · ${_selected.length} selecionados',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                      TextButton(
                        onPressed: _loading ? null : _selectAll,
                        child: const Text('Selecionar todos'),
                      ),
                      TextButton(
                        onPressed: _selected.isEmpty
                            ? null
                            : () => setState(_selected.clear),
                        child: const Text('Limpar'),
                      ),
                    ],
                  ),
                ],
                Expanded(
                  child: _reels.isEmpty
                      ? Center(
                          child: Text(
                            _loading
                                ? 'Consultando o perfil...'
                                : 'Busque um perfil para visualizar os Reels.',
                            textAlign: TextAlign.center,
                          ),
                        )
                      : GridView.builder(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: compact ? 2 : 4,
                                crossAxisSpacing: 9,
                                mainAxisSpacing: 9,
                                childAspectRatio: .66,
                              ),
                          itemCount: _reels.length,
                          itemBuilder: (context, index) {
                            final reel = _reels[index];
                            final id = _candidateId(reel);
                            final selected = _selected.contains(id);
                            final thumbnail = _value(reel['thumbnail']);
                            final caption = _value(reel['caption']);
                            return Material(
                              color: selected ? wa.accentSoft : wa.searchBg,
                              borderRadius: BorderRadius.circular(12),
                              clipBehavior: Clip.antiAlias,
                              child: InkWell(
                                onTap: () => _toggle(reel),
                                child: Stack(
                                  fit: StackFit.expand,
                                  children: [
                                    Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.stretch,
                                      children: [
                                        Expanded(
                                          child: thumbnail.isEmpty
                                              ? const ColoredBox(
                                                  color: Color(0x22000000),
                                                  child: Icon(
                                                    Icons.movie_outlined,
                                                    size: 38,
                                                  ),
                                                )
                                              : BotAdminCachedImage(
                                                  imageUrl: thumbnail,
                                                  fit: BoxFit.cover,
                                                  memCacheWidth: 360,
                                                  placeholder: (_, _) =>
                                                      const Center(
                                                        child:
                                                            CircularProgressIndicator(),
                                                      ),
                                                  errorWidget: (_, _, _) =>
                                                      const Icon(
                                                        Icons
                                                            .broken_image_outlined,
                                                      ),
                                                ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.all(8),
                                          child: Text(
                                            caption.isEmpty
                                                ? 'Reel do Instagram'
                                                : caption,
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    Positioned(
                                      right: 7,
                                      top: 7,
                                      child: CircleAvatar(
                                        radius: 14,
                                        backgroundColor: selected
                                            ? wa.accent
                                            : Colors.black54,
                                        child: Icon(
                                          selected
                                              ? Icons.check_rounded
                                              : Icons.add_rounded,
                                          size: 18,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                ),
                if (_hasMore)
                  Center(
                    child: TextButton.icon(
                      onPressed: _loading ? null : () => _load(reset: false),
                      icon: const Icon(Icons.expand_more_rounded),
                      label: const Text('Carregar mais Reels'),
                    ),
                  ),
                if (shortLandscape)
                  Row(
                    children: [
                      Expanded(
                        child: SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                          visualDensity: const VisualDensity(vertical: -4),
                          value: _automaticProfile,
                          onChanged: _loadedProfile.isEmpty
                              ? null
                              : (value) =>
                                    setState(() => _automaticProfile = value),
                          title: const Text('Usar perfil automaticamente'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                          visualDensity: const VisualDensity(vertical: -4),
                          value: _analyzeWithGemini,
                          onChanged: (value) =>
                              setState(() => _analyzeWithGemini = value),
                          title: const Text('Legendas com Gemini'),
                        ),
                      ),
                    ],
                  )
                else ...[
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    visualDensity: const VisualDensity(vertical: -3),
                    value: _automaticProfile,
                    onChanged: _loadedProfile.isEmpty
                        ? null
                        : (value) => setState(() => _automaticProfile = value),
                    title: const Text(
                      'Usar automaticamente os Reels deste perfil',
                    ),
                    subtitle: const Text(
                      'Não importa nem armazena os vídeos agora. A cada publicação, o BotAdmin escolhe primeiro um Reel ainda não enviado e resolve a mídia somente na hora.',
                    ),
                  ),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    visualDensity: const VisualDensity(vertical: -3),
                    value: _analyzeWithGemini,
                    onChanged: (value) =>
                        setState(() => _analyzeWithGemini = value),
                    title: const Text('Gerar legendas com Gemini após salvar'),
                    subtitle: const Text(
                      'A programação será salva na hora e a análise continuará em segundo plano.',
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    _error!,
                    style: const TextStyle(color: Color(0xFFE53935)),
                  ),
                ],
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: _loading
                          ? null
                          : () => Navigator.of(context).pop(),
                      child: const Text('Cancelar'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      onPressed: _selected.isEmpty && !_automaticProfile
                          ? null
                          : _finish,
                      icon: const Icon(Icons.playlist_add_check_rounded),
                      label: Text(
                        _automaticProfile
                            ? 'Usar perfil automaticamente'
                            : 'Adicionar ${_selected.length}',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusDraftDialog extends ConsumerStatefulWidget {
  const _StatusDraftDialog({
    required this.initialInstances,
    this.initialCampaign,
    this.initialPost,
    this.openVisualEditorOnStart = false,
    this.preferredInstanceId,
  });

  final List<BotInstance> initialInstances;
  final BotAdCampaignSummary? initialCampaign;
  final StatusPost? initialPost;
  final bool openVisualEditorOnStart;
  final int? preferredInstanceId;

  @override
  ConsumerState<_StatusDraftDialog> createState() => _StatusDraftDialogState();
}

class _StatusDraftDialogState extends ConsumerState<_StatusDraftDialog> {
  final _name = TextEditingController(text: 'Status');
  final _fixedTimes = TextEditingController(text: '08:00, 12:00, 18:00');
  final _everyMinutes = TextEditingController(text: '1440');
  final _randomCount = TextEditingController(text: '1');
  final _dailyLimit = TextEditingController(text: '3');
  final _jitterMinutes = TextEditingController(text: '30');
  late final List<_StatusComposerItem> _items;
  String _mode = 'now';
  String _scheduleType = 'window';
  int? _instanceId;
  bool _randomizeContents = false;
  bool _randomizeSchedule = false;
  bool _runNowAfterSave = true;
  DateTime? _publicationEndAt;
  bool _submitting = false;
  bool _handedOff = false;
  bool _draftPersisted = false;
  bool _draftRestored = false;
  bool _restoringDraft = false;
  Timer? _autosaveTimer;
  String? _error;

  @override
  void initState() {
    super.initState();
    _items = <_StatusComposerItem>[];
    _restoringDraft = true;
    _hydrateInitialCampaign();
    if (_instanceId == null) _selectDefaultInstance(widget.initialInstances);
    _restoringDraft = false;
    for (final controller in [
      _name,
      _fixedTimes,
      _everyMinutes,
      _randomCount,
      _dailyLimit,
      _jitterMinutes,
    ]) {
      controller.addListener(_scheduleAutosave);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && widget.initialPost == null) {
        unawaited(_restoreAutosavedDraft());
      }
      if (mounted && widget.openVisualEditorOnStart && _items.isNotEmpty) {
        unawaited(_openItemVisualEditor(_items.first));
      }
    });
  }

  _StatusComposerItem _newComposerItem(String type, {String? id}) {
    final item = _StatusComposerItem(type, id: id);
    for (final controller in [
      item.text,
      item.caption,
      item.mediaUrl,
      item.time,
    ]) {
      controller.addListener(_scheduleAutosave);
    }
    return item;
  }

  void _hydrateInitialCampaign() {
    final campaign = widget.initialCampaign;
    if (campaign == null) {
      final post = widget.initialPost;
      if (post != null) {
        _name.text = 'Repost · ${post.campaignName}';
        _mode = 'now';
        _instanceId = post.instanceId > 0
            ? post.instanceId
            : widget.preferredInstanceId;
        final type = (post.contentType ?? '').toLowerCase();
        if (type.contains('text') || post.mediaUrl == null) {
          final item = _newComposerItem('text');
          item.text.text = post.contentText ?? '';
          _items.add(item);
        } else {
          final normalizedType = type.contains('video') ? 'video' : 'image';
          final item = _newComposerItem(normalizedType);
          item.caption.text = post.contentText ?? '';
          item.mediaUrl.text = _absoluteStatusUrl(post.mediaUrl) ?? '';
          item.mediaPath = post.mediaUrl ?? '';
          item.mimeType = normalizedType == 'video'
              ? 'video/mp4'
              : 'image/jpeg';
          item.fileName = normalizedType == 'video'
              ? 'status-repost.mp4'
              : 'status-repost.jpg';
          item.temporaryMedia = post.temporaryMedia;
          _items.add(item);
        }
        return;
      }
      _items.add(_newComposerItem('text'));
      return;
    }
    _name.text = campaign.name;
    final schedule = campaign.schedule;
    final kind = (schedule['kind'] ?? campaign.scheduleKind).toString();
    _mode = campaign.status.toLowerCase() == 'draft'
        ? 'draft'
        : kind == 'manual'
        ? 'draft'
        : 'scheduled';
    _scheduleType = kind == 'recurring' ? 'recurring' : 'window';
    _runNowAfterSave = false;
    _publicationEndAt = campaign.endAt;
    _everyMinutes.text = (schedule['everyMinutes'] ?? 1440).toString();
    final atTimes = schedule['atTimes'] is List
        ? (schedule['atTimes'] as List)
              .map((value) => value.toString())
              .where((value) => value.isNotEmpty)
              .toList(growable: false)
        : const <String>[];
    if (atTimes.isNotEmpty) _fixedTimes.text = atTimes.join(', ');

    final statusRandomizer = campaign.options['statusRandomizer'] is Map
        ? Map<String, dynamic>.from(campaign.options['statusRandomizer'] as Map)
        : const <String, dynamic>{};
    _randomizeContents = statusRandomizer['enabled'] == true;
    _randomCount.text = (statusRandomizer['perRunCount'] ?? 1).toString();
    _dailyLimit.text =
        (statusRandomizer['dailyLimit'] ??
                statusRandomizer['perDayCount'] ??
                (atTimes.isEmpty ? 3 : atTimes.length))
            .toString();
    final scheduleRandomizer = campaign.options['scheduleRandomizer'] is Map
        ? Map<String, dynamic>.from(
            campaign.options['scheduleRandomizer'] as Map,
          )
        : const <String, dynamic>{};
    _randomizeSchedule = scheduleRandomizer['enabled'] == true;
    _jitterMinutes.text = (scheduleRandomizer['jitterMinutes'] ?? 30)
        .toString();

    for (final target in campaign.targets) {
      if ((target['type'] ?? '').toString() != 'status') continue;
      _instanceId = int.tryParse((target['instanceId'] ?? '').toString());
      if (_instanceId != null) break;
    }

    for (final content in campaign.contents) {
      if ((content['type'] ?? '').toString() != 'status') continue;
      final statusType = (content['statusType'] ?? 'text').toString();
      final normalizedType =
          const {'text', 'image', 'video'}.contains(statusType)
          ? statusType
          : 'text';
      final item = _newComposerItem(
        normalizedType,
        id: content['id']?.toString(),
      );
      item.text.text = content['text']?.toString() ?? '';
      item.caption.text = content['caption']?.toString() ?? '';
      item.prioritizeDaily = content['alwaysSendWhenRandomized'] == true;
      if (content['media'] is Map) {
        final media = Map<String, dynamic>.from(content['media'] as Map);
        item.mediaUrl.text = _absoluteStatusUrl(media['url']?.toString()) ?? '';
        item.mediaPath = media['path']?.toString() ?? '';
        item.mimeType = media['mimeType']?.toString() ?? '';
        item.fileName = media['fileName']?.toString() ?? '';
      }
      if (content['config'] is Map) {
        final config = Map<String, dynamic>.from(content['config'] as Map);
        if (config['visualEditor'] is Map) {
          item.visualEditor = Map<String, dynamic>.from(
            config['visualEditor'] as Map,
          );
        }
        if (atTimes.isNotEmpty) {
          final slot = int.tryParse((config['scheduleSlot'] ?? '').toString());
          if (slot != null && slot >= 0 && slot < atTimes.length) {
            item.time.text = atTimes[slot];
          }
        }
        if (config['sourceUrl'] != null) {
          item.sourceUrl = config['sourceUrl']?.toString() ?? '';
        }
        if (config['previewUrl'] != null) {
          item.previewUrl = config['previewUrl']?.toString() ?? '';
        }
        if (config['instagramProfile'] is Map) {
          item.instagramProfile = Map<String, dynamic>.from(
            config['instagramProfile'] as Map,
          );
        }
      }
      _items.add(item);
    }
    if (_items.isEmpty) _items.add(_newComposerItem('text'));
  }

  String? get _autosaveKey {
    final userId = ref.read(authControllerProvider).value?.user.id;
    final instanceId = _instanceId;
    if (userId == null || userId <= 0 || instanceId == null) return null;
    final campaignKey =
        widget.initialCampaign?.id ?? widget.initialPost?.id ?? 'new';
    return '$userId.$instanceId.$campaignKey';
  }

  Map<String, dynamic> _serializeAutosavedDraft() => {
    'version': 1,
    'updatedAt': DateTime.now().toIso8601String(),
    'name': _name.text,
    'mode': _mode,
    'scheduleType': _scheduleType,
    'instanceId': _instanceId,
    'fixedTimes': _fixedTimes.text,
    'everyMinutes': _everyMinutes.text,
    'randomCount': _randomCount.text,
    'dailyLimit': _dailyLimit.text,
    'jitterMinutes': _jitterMinutes.text,
    'randomizeContents': _randomizeContents,
    'randomizeSchedule': _randomizeSchedule,
    'runNowAfterSave': _runNowAfterSave,
    'publicationEndAt': _publicationEndAt?.toIso8601String(),
    'items': _items
        .map(
          (item) => {
            'id': item.id,
            'type': item.type,
            'text': item.text.text,
            'caption': item.caption.text,
            'mediaUrl': item.mediaUrl.text,
            'time': item.time.text,
            'mediaPath': item.mediaPath,
            'mimeType': item.mimeType,
            'fileName': item.fileName,
            'suggestedTitle': item.suggestedTitle,
            'sourceUrl': item.sourceUrl,
            'previewUrl': item.previewUrl,
            if (item.instagramProfile != null)
              'instagramProfile': item.instagramProfile,
            'analysisProvider': item.analysisProvider,
            'analyzeAfterSave': item.analyzeAfterSave,
            if (item.visualEditor != null) 'visualEditor': item.visualEditor,
            'prioritizeDaily': item.prioritizeDaily,
            'temporaryMedia': item.temporaryMedia,
          },
        )
        .toList(growable: false),
  };

  void _scheduleAutosave() {
    if (_restoringDraft || !mounted) return;
    _autosaveTimer?.cancel();
    _autosaveTimer = Timer(const Duration(milliseconds: 650), () {
      if (mounted) unawaited(_autosaveDraft());
    });
  }

  Future<void> _autosaveDraft() async {
    final key = _autosaveKey;
    if (key == null || _restoringDraft) return;
    await ref
        .read(sessionStoreProvider)
        .saveStatusDraft(key, _serializeAutosavedDraft());
    _draftPersisted = true;
  }

  Future<void> _restoreAutosavedDraft() async {
    final key = _autosaveKey;
    if (key == null) return;
    final saved = await ref.read(sessionStoreProvider).readStatusDraft(key);
    if (!mounted || saved == null || saved['version'] != 1) return;
    final rawItems = saved['items'];
    if (rawItems is! List || rawItems.isEmpty) return;
    _restoringDraft = true;
    try {
      final restoredItems = <_StatusComposerItem>[];
      for (final rawItem in rawItems.whereType<Map>()) {
        final data = Map<String, dynamic>.from(rawItem);
        final item = _newComposerItem(
          data['type']?.toString() ?? 'text',
          id: data['id']?.toString(),
        );
        item.text.text = data['text']?.toString() ?? '';
        item.caption.text = data['caption']?.toString() ?? '';
        item.mediaUrl.text =
            _absoluteStatusUrl(data['mediaUrl']?.toString()) ?? '';
        item.time.text = data['time']?.toString() ?? '';
        item.mediaPath = data['mediaPath']?.toString() ?? '';
        item.mimeType = data['mimeType']?.toString() ?? '';
        item.fileName = data['fileName']?.toString() ?? '';
        item.suggestedTitle = data['suggestedTitle']?.toString() ?? '';
        item.sourceUrl = data['sourceUrl']?.toString() ?? '';
        item.previewUrl = data['previewUrl']?.toString() ?? '';
        if (data['instagramProfile'] is Map) {
          item.instagramProfile = Map<String, dynamic>.from(
            data['instagramProfile'] as Map,
          );
        }
        item.analysisProvider =
            data['analysisProvider']?.toString() ?? 'gemini';
        item.analyzeAfterSave = data['analyzeAfterSave'] == true;
        if (data['visualEditor'] is Map) {
          item.visualEditor = Map<String, dynamic>.from(
            data['visualEditor'] as Map,
          );
        }
        item.prioritizeDaily = data['prioritizeDaily'] == true;
        item.temporaryMedia = data['temporaryMedia'] == true;
        restoredItems.add(item);
      }
      if (restoredItems.isEmpty) return;
      for (final item in _items) {
        item.dispose();
      }
      setState(() {
        _items
          ..clear()
          ..addAll(restoredItems);
        _name.text = saved['name']?.toString() ?? _name.text;
        _mode = saved['mode']?.toString() ?? _mode;
        _scheduleType = saved['scheduleType']?.toString() ?? _scheduleType;
        _fixedTimes.text = saved['fixedTimes']?.toString() ?? _fixedTimes.text;
        _everyMinutes.text =
            saved['everyMinutes']?.toString() ?? _everyMinutes.text;
        _randomCount.text =
            saved['randomCount']?.toString() ?? _randomCount.text;
        _dailyLimit.text = saved['dailyLimit']?.toString() ?? _dailyLimit.text;
        _jitterMinutes.text =
            saved['jitterMinutes']?.toString() ?? _jitterMinutes.text;
        _randomizeContents = saved['randomizeContents'] == true;
        _randomizeSchedule = saved['randomizeSchedule'] == true;
        _runNowAfterSave = saved['runNowAfterSave'] == true;
        _publicationEndAt = DateTime.tryParse(
          saved['publicationEndAt']?.toString() ?? '',
        );
        _draftRestored = true;
        _draftPersisted = true;
      });
    } finally {
      _restoringDraft = false;
    }
  }

  List<BotInstance> _availableInstances(List<BotInstance> items) {
    final connected = items.where((item) => item.isConnected).toList();
    return connected.isEmpty ? items : connected;
  }

  void _selectDefaultInstance(List<BotInstance> items) {
    final available = _availableInstances(items);
    if (available.isEmpty) return;
    final preferred = widget.preferredInstanceId;
    _instanceId =
        preferred != null && available.any((item) => item.id == preferred)
        ? preferred
        : available.first.id;
  }

  @override
  void dispose() {
    _autosaveTimer?.cancel();
    _name.dispose();
    _fixedTimes.dispose();
    _everyMinutes.dispose();
    _randomCount.dispose();
    _dailyLimit.dispose();
    _jitterMinutes.dispose();
    for (final item in _items) {
      if (!_handedOff &&
          !_draftPersisted &&
          item.temporaryMedia &&
          item.mediaPath.isNotEmpty) {
        unawaited(
          ref.read(apiClientProvider).deleteBotAdCampaignMedia(item.mediaPath),
        );
      }
      if (!_handedOff && !_draftPersisted) {
        for (final path in _visualEditorSourcePaths(item.visualEditor)) {
          unawaited(ref.read(apiClientProvider).deleteBotAdCampaignMedia(path));
        }
      }
      item.dispose();
    }
    super.dispose();
  }

  Set<String> _visualEditorSourcePaths(Map<String, dynamic>? document) {
    if (document?['mediaLayers'] is! List) return <String>{};
    return (document!['mediaLayers'] as List)
        .whereType<Map>()
        .map((layer) => layer['sourcePath']?.toString().trim() ?? '')
        .where((path) => path.isNotEmpty)
        .toSet();
  }

  void _removeItem(_StatusComposerItem item) {
    if (_items.length == 1) return;
    setState(() => _items.remove(item));
    _scheduleAutosave();
    if (item.temporaryMedia && item.mediaPath.isNotEmpty) {
      unawaited(
        ref.read(apiClientProvider).deleteBotAdCampaignMedia(item.mediaPath),
      );
    }
    for (final path in _visualEditorSourcePaths(item.visualEditor)) {
      unawaited(ref.read(apiClientProvider).deleteBotAdCampaignMedia(path));
    }
    item.dispose();
  }

  Future<void> _openAddTextDialog() async {
    final result = await showDialog<StatusVisualEditorResult>(
      context: context,
      builder: (dialogContext) => const StatusVisualEditorDialog(),
    );
    if (!mounted || result == null) return;
    final item = _hasEmptyInitialTextItem
        ? _items.first
        : _newComposerItem('image');
    setState(() {
      item.type = result.isVideo ? 'video' : 'image';
      item.text.clear();
      item.caption.text = result.caption;
      item.visualEditor = result.document;
      if (!_items.contains(item)) _items.add(item);
    });
    await _saveVisualEditorResult(item, result);
  }

  Future<void> _openAddLinkDialog() async {
    final controller = TextEditingController();
    String? modalError;
    final action = await showDialog<String>(
      context: context,
      barrierDismissible: true,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Adicionar link de mídia'),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Cole o link. O BotAdmin guardará somente a referência e resolverá a mídia na hora de publicar.',
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(dialogContext).pop('instagram'),
                  icon: const Icon(Icons.video_collection_outlined),
                  label: const Text('Importar Reels de um perfil'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: controller,
                  autofocus: true,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                    labelText: 'Link da mídia ou rede social',
                    prefixIcon: Icon(Icons.link_rounded),
                  ),
                ),
                if (modalError != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    modalError!,
                    style: const TextStyle(color: Color(0xFFE53935)),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancelar'),
            ),
            FilledButton.icon(
              onPressed: () async {
                final link = controller.text.trim();
                final uri = Uri.tryParse(link);
                if (uri == null ||
                    !const {
                      'http',
                      'https',
                    }.contains(uri.scheme.toLowerCase()) ||
                    uri.host.isEmpty) {
                  setDialogState(
                    () => modalError = 'Informe um link http ou https válido.',
                  );
                  return;
                }
                final isImage = RegExp(
                  r'\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])',
                  caseSensitive: false,
                ).hasMatch(link);
                final item = _hasEmptyInitialTextItem
                    ? _items.first
                    : _newComposerItem(isImage ? 'image' : 'video');
                setState(() {
                  item.type = isImage ? 'image' : 'video';
                  item.mediaPath = '';
                  item.sourceUrl = link;
                  item.mediaUrl.text = link;
                  item.mimeType = item.type == 'video'
                      ? 'video/mp4'
                      : 'image/jpeg';
                  item.fileName = item.type == 'video'
                      ? 'midia-remota.mp4'
                      : 'midia-remota.jpg';
                  item.temporaryMedia = false;
                  item.feedback =
                      'Link salvo. A mídia será resolvida somente no envio.';
                  if (!_items.contains(item)) _items.add(item);
                });
                await _autosaveDraft();
                if (dialogContext.mounted) {
                  Navigator.of(dialogContext).pop();
                }
              },
              icon: const Icon(Icons.bookmark_add_outlined),
              label: const Text('Salvar link'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (action == 'instagram' && mounted) {
      await _openInstagramProfileReelsDialog();
    }
  }

  Future<void> _openInstagramProfileReelsDialog() async {
    final result = await showDialog<_InstagramReelsImportResult>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const _InstagramReelsImportDialog(),
    );
    if (!mounted || result == null) return;

    final imported = <_StatusComposerItem>[];
    if (result.automaticProfile && result.profile.isNotEmpty) {
      final item = _hasEmptyInitialTextItem
          ? _items.first
          : _newComposerItem('video');
      item.type = 'video';
      item.sourceUrl = 'https://www.instagram.com/${result.profile}/';
      item.mediaUrl.text = item.sourceUrl;
      item.previewUrl = result.reels.isNotEmpty
          ? result.reels.first['thumbnail']?.toString() ?? ''
          : '';
      item.mimeType = 'video/mp4';
      item.fileName = 'instagram-${result.profile}.mp4';
      item.analysisProvider = 'gemini';
      item.instagramProfile = {
        'username': result.profile,
        'automatic': true,
        'analyzeWithGemini': result.analyzeWithGemini,
      };
      item.feedback =
          'Fonte automática ativa. Os vídeos serão resolvidos somente no envio.';
      imported.add(item);
    }
    for (var index = 0; index < result.reels.length; index++) {
      final reel = result.reels[index];
      final sourceUrl =
          reel['resolveUrl']?.toString().trim() ??
          reel['sourceUrl']?.toString().trim() ??
          '';
      if (sourceUrl.isEmpty) continue;
      final item = index == 0 && _hasEmptyInitialTextItem
          ? _items.first
          : _newComposerItem('video');
      item.type = 'video';
      item.sourceUrl = sourceUrl;
      item.mediaUrl.text = sourceUrl;
      item.previewUrl = reel['thumbnail']?.toString().trim() ?? '';
      item.caption.text = reel['caption']?.toString().trim() ?? '';
      item.suggestedTitle = 'Reel do Instagram';
      item.analysisProvider = 'gemini';
      item.analyzeAfterSave = false;
      item.mimeType = 'video/mp4';
      item.fileName = 'instagram-reel.mp4';
      item.feedback =
          'Reel referenciado. A mídia será resolvida somente no momento do envio.';
      imported.add(item);
    }
    if (imported.isEmpty) return;
    setState(() {
      for (final item in imported) {
        if (!_items.contains(item)) _items.add(item);
      }
      _error = null;
      if (result.automaticProfile) {
        _randomizeContents = true;
        _randomCount.text = '1';
      }
    });
    _scheduleAutosave();
  }

  Widget _buildTopContentActions(bool compact) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: WaTheme.of(context).searchBg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            if (!compact) ...[
              const Text(
                'Novo conteúdo',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(width: 12),
            ],
            Expanded(
              child: Wrap(
                alignment: compact ? WrapAlignment.center : WrapAlignment.end,
                spacing: 7,
                runSpacing: 7,
                children: [
                  OutlinedButton.icon(
                    onPressed: _openAddTextDialog,
                    icon: const Icon(Icons.notes_rounded, size: 18),
                    label: const Text('Texto'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _openAddLinkDialog,
                    icon: const Icon(Icons.link_rounded, size: 18),
                    label: const Text('Link'),
                  ),
                  FilledButton.tonalIcon(
                    onPressed: _pickManyMedia,
                    icon: const Icon(
                      Icons.add_photo_alternate_outlined,
                      size: 18,
                    ),
                    label: const Text('Mídia'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _scheduleLinkResolution(_StatusComposerItem item, String value) {
    item.resolveDebounce?.cancel();
    final link = value.trim();
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(link)) return;
    final provider = _socialProviderLabel(link);
    if (mounted) {
      setState(() {
        final isImage = RegExp(
          r'\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])',
          caseSensitive: false,
        ).hasMatch(link);
        item.type = isImage ? 'image' : 'video';
        item.sourceUrl = link;
        item.mediaPath = '';
        item.temporaryMedia = false;
        item.feedback = provider == null
            ? 'Link salvo como referência. A mídia será buscada somente no envio.'
            : 'Link do $provider salvo. A mídia será resolvida somente no envio.';
        item.error = null;
      });
      _scheduleAutosave();
    }
  }

  String _guessMediaTypeFromValues(String name, [String mimeType = '']) {
    final mime = mimeType.toLowerCase();
    final lowerName = name.toLowerCase().split('?').first;
    if (mime.startsWith('video/') ||
        lowerName.endsWith('.mp4') ||
        lowerName.endsWith('.webm') ||
        lowerName.endsWith('.mov') ||
        lowerName.endsWith('.mkv') ||
        lowerName.endsWith('.m4v')) {
      return 'video';
    }
    return 'image';
  }

  String? _socialProviderLabel(String value) {
    final uri = Uri.tryParse(value.trim());
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) return null;
    final host = uri.host.toLowerCase().replaceFirst(RegExp(r'^www\.'), '');
    bool matches(String domain) => host == domain || host.endsWith('.$domain');
    if (matches('instagram.com') || matches('instagr.am')) return 'Instagram';
    if (matches('tiktok.com')) return 'TikTok';
    if (matches('youtube.com') || matches('youtu.be')) return 'YouTube';
    if (matches('facebook.com') || matches('fb.watch') || matches('fb.com')) {
      return 'Facebook';
    }
    if (host.contains('kwai') || matches('kuaishou.com')) return 'Kwai';
    if (matches('pinterest.com') ||
        matches('pin.it') ||
        matches('pinimg.com')) {
      return 'Pinterest';
    }
    if (matches('threads.net') || matches('threads.com')) return 'Threads';
    if (host.contains('shopee') || matches('shp.ee')) return 'Shopee';
    if (host.contains('douyin') || matches('iesdouyin.com')) return 'Douyin';
    return null;
  }

  bool _looksLikeDirectMedia(String value) {
    final path = Uri.tryParse(value.trim())?.path.toLowerCase() ?? '';
    return RegExp(
      r'\.(?:jpe?g|png|webp|gif|avif|mp4|mov|m4v|webm|mkv|3gp)$',
    ).hasMatch(path);
  }

  Future<void> _openItemOrganization(
    _StatusComposerItem item,
    int index,
  ) async {
    var prioritize = item.prioritizeDaily;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('Organizar status ${index + 1}'),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: prioritize,
              onChanged: (value) => setDialogState(() => prioritize = value),
              title: const Text('Postagem preferencial diária'),
              subtitle: const Text(
                'Use para anúncios e chamadas de venda. Se ainda não tiver saído hoje, o sistema reserva uma vaga do limite diário para uma postagem preferencial.',
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
              child: const Text('Aplicar'),
            ),
          ],
        ),
      ),
    );
    if (saved == true && mounted) {
      setState(() => item.prioritizeDaily = prioritize);
      _scheduleAutosave();
    }
  }

  String _guessMediaType(XFile file) =>
      _guessMediaTypeFromValues(file.name, file.mimeType ?? '');

  bool get _hasEmptyInitialTextItem =>
      _items.length == 1 &&
      _items.first.type == 'text' &&
      _items.first.text.text.trim().isEmpty;

  Future<void> _pickManyMedia() async {
    final files = await openFiles(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagens e vídeos',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'mov',
            'webm',
            'mkv',
            'm4v',
          ],
        ),
      ],
    );
    if (files.isEmpty || !mounted) return;
    if (_hasEmptyInitialTextItem) {
      final placeholder = _items.removeAt(0);
      placeholder.dispose();
    }
    for (final file in files) {
      final item = _newComposerItem(_guessMediaType(file));
      setState(() => _items.add(item));
      await _uploadFile(item, file);
    }
  }

  Future<void> _openItemVisualEditor(_StatusComposerItem item) async {
    Uint8List? backgroundBytes;
    Uint8List? videoBytes;
    final initialMediaLayers = <StatusVisualMediaLayer>[];
    final mediaUrl = item.mediaUrl.text.trim();
    final editorDocument = item.visualEditor;
    final hasEditableSource = editorDocument?['sourceMedia'] != false;
    final savedLayers = editorDocument?['mediaLayers'] is List
        ? (editorDocument!['mediaLayers'] as List).whereType<Map>().toList()
        : const <Map>[];
    if (savedLayers.isNotEmpty ||
        ((item.type == 'image' || item.type == 'video') &&
            mediaUrl.isNotEmpty &&
            hasEditableSource)) {
      setState(() {
        item.busy = true;
        item.error = null;
        item.feedback = 'Preparando o editor visual...';
      });
      try {
        if (savedLayers.isNotEmpty) {
          for (final rawLayer in savedLayers) {
            final layer = Map<String, dynamic>.from(rawLayer);
            final sourceUrl =
                _absoluteStatusUrl(
                  layer['sourceUrl']?.toString() ??
                      layer['sourcePath']?.toString(),
                ) ??
                '';
            if (sourceUrl.isEmpty) continue;
            final downloaded = await ref
                .read(apiClientProvider)
                .downloadMediaBytes(sourceUrl);
            final alignment = layer['alignment'] is Map
                ? Map<String, dynamic>.from(layer['alignment'] as Map)
                : const <String, dynamic>{};
            double number(Object? value, double fallback) => value is num
                ? value.toDouble()
                : double.tryParse(value?.toString() ?? '') ?? fallback;
            initialMediaLayers.add(
              StatusVisualMediaLayer(
                bytes: downloaded.bytes,
                fileName:
                    layer['fileName']?.toString() ??
                    (layer['type'] == 'video' ? 'status.mp4' : 'status.jpg'),
                mimeType: layer['mimeType']?.toString() ?? downloaded.mimeType,
                isVideo: layer['type']?.toString() == 'video',
                alignment: Alignment(
                  number(alignment['x'], 0),
                  number(alignment['y'], 0),
                ),
                scale: number(layer['scale'], 1),
                rotation: number(layer['rotation'], 0),
                sourceUrl: sourceUrl,
                sourcePath: layer['sourcePath']?.toString(),
              ),
            );
          }
        } else {
          final downloaded = await ref
              .read(apiClientProvider)
              .downloadMediaBytes(mediaUrl);
          if (item.type == 'video') {
            videoBytes = downloaded.bytes;
          } else {
            backgroundBytes = downloaded.bytes;
          }
        }
      } catch (error) {
        if (mounted) setState(() => item.error = error.toString());
        return;
      } finally {
        if (mounted) setState(() => item.busy = false);
      }
    }
    if (!mounted) return;
    final initialText =
        editorDocument?['text']?.toString() ??
        (item.type == 'text' ? item.text.text : '');
    final result = await showDialog<StatusVisualEditorResult>(
      context: context,
      builder: (dialogContext) => StatusVisualEditorDialog(
        initialText: initialText,
        initialCaption: item.caption.text,
        initialDocument: editorDocument,
        initialMediaLayers: initialMediaLayers,
        initialBackgroundBytes: backgroundBytes,
        initialVideoBytes: videoBytes,
        initialVideoFileName: item.fileName,
        initialVideoMimeType: item.mimeType,
      ),
    );
    if (!mounted || result == null) return;
    setState(() {
      item.type = result.isVideo ? 'video' : 'image';
      item.text.clear();
      item.caption.text = result.caption;
    });
    await _saveVisualEditorResult(item, result);
  }

  Future<void> _saveVisualEditorResult(
    _StatusComposerItem item,
    StatusVisualEditorResult result,
  ) async {
    final previousSourcePaths = _visualEditorSourcePaths(item.visualEditor);
    final document = Map<String, dynamic>.from(result.document);
    final mediaLayerDocuments = <Map<String, dynamic>>[];
    setState(() {
      item.busy = true;
      item.error = null;
      item.feedback = 'Salvando as camadas editáveis...';
    });
    try {
      for (final layer in result.mediaLayers) {
        var sourcePath = layer.sourcePath?.trim() ?? '';
        var sourceUrl = layer.sourceUrl?.trim() ?? '';
        if (sourcePath.isEmpty || sourceUrl.isEmpty) {
          final uploaded = await ref
              .read(apiClientProvider)
              .uploadBotAdCampaignMedia(
                bytes: layer.bytes,
                fileName: layer.fileName,
                mimeType: layer.mimeType,
                mediaType: layer.isVideo ? 'video' : 'image',
              );
          sourcePath = uploaded['path']?.toString() ?? '';
          sourceUrl =
              _absoluteStatusUrl(uploaded['url']?.toString()) ?? sourceUrl;
        }
        mediaLayerDocuments.add({
          'type': layer.isVideo ? 'video' : 'image',
          'fileName': layer.fileName,
          'mimeType': layer.mimeType,
          if (sourcePath.isNotEmpty) 'sourcePath': sourcePath,
          if (sourceUrl.isNotEmpty) 'sourceUrl': sourceUrl,
          'alignment': {'x': layer.alignment.x, 'y': layer.alignment.y},
          'scale': layer.scale,
          'rotation': layer.rotation,
        });
      }
      document['mediaLayers'] = mediaLayerDocuments;
      item.visualEditor = document;
    } catch (error) {
      if (mounted) {
        setState(() {
          item.busy = false;
          item.error = 'Não foi possível salvar as camadas: $error';
        });
      }
      return;
    }
    if (!result.isVideo) {
      await _uploadFile(
        item,
        XFile.fromData(
          result.bytes,
          name: 'status-editor-${DateTime.now().millisecondsSinceEpoch}.png',
          mimeType: 'image/png',
        ),
      );
      final currentPaths = _visualEditorSourcePaths(item.visualEditor);
      for (final path in previousSourcePaths.difference(currentPaths)) {
        unawaited(ref.read(apiClientProvider).deleteBotAdCampaignMedia(path));
      }
      return;
    }

    setState(() {
      item.busy = true;
      item.error = null;
      item.feedback = 'Montando o vídeo com as posições do editor...';
    });
    try {
      final color = result.backgroundColor
          .toARGB32()
          .toRadixString(16)
          .padLeft(8, '0')
          .substring(2)
          .toUpperCase();
      final media = await ref
          .read(apiClientProvider)
          .composeStatusVideo(
            videoBytes: result.videoBytes!,
            videoFileName: result.videoFileName ?? 'status.mp4',
            videoMimeType: result.videoMimeType ?? 'video/mp4',
            overlayBytes: result.bytes,
            backgroundColor: '#$color',
            mediaScale: result.mediaScale,
            mediaX: result.mediaAlignment.x,
            mediaY: result.mediaAlignment.y,
            mediaRotation: result.mediaRotation,
            previousPath: item.temporaryMedia && item.mediaPath.isNotEmpty
                ? item.mediaPath
                : null,
          );
      if (!mounted) return;
      setState(() {
        item.type = 'video';
        item.mediaPath = media['path']?.toString() ?? '';
        item.mediaUrl.text = _absoluteStatusUrl(media['url']?.toString()) ?? '';
        item.mimeType = media['mimeType']?.toString() ?? 'video/mp4';
        item.fileName = media['fileName']?.toString() ?? 'status.mp4';
        item.temporaryMedia = true;
        item.feedback = 'Vídeo editado e enviado com sucesso.';
      });
      await _autosaveDraft();
      final currentPaths = _visualEditorSourcePaths(item.visualEditor);
      for (final path in previousSourcePaths.difference(currentPaths)) {
        unawaited(ref.read(apiClientProvider).deleteBotAdCampaignMedia(path));
      }
    } catch (error) {
      if (mounted) setState(() => item.error = error.toString());
    } finally {
      if (mounted) setState(() => item.busy = false);
    }
  }

  Future<void> _pickItemMedia(_StatusComposerItem item) async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem ou vídeo',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'mov',
            'webm',
            'mkv',
            'm4v',
          ],
        ),
      ],
    );
    if (file == null) return;
    item.type = _guessMediaType(file);
    await _uploadFile(item, file);
  }

  Future<void> _uploadFile(_StatusComposerItem item, XFile file) async {
    setState(() {
      item.busy = true;
      item.error = null;
      item.feedback = 'Enviando ${file.name}...';
    });
    try {
      final media = await ref
          .read(apiClientProvider)
          .uploadBotAdCampaignMedia(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType:
                file.mimeType ??
                (item.type == 'video' ? 'video/mp4' : 'image/jpeg'),
            mediaType: item.type,
            previousPath: item.temporaryMedia && item.mediaPath.isNotEmpty
                ? item.mediaPath
                : null,
          );
      if (!mounted) return;
      setState(() {
        item.mediaPath = media['path']?.toString() ?? '';
        item.mediaUrl.text =
            _absoluteStatusUrl(media['url']?.toString()) ?? item.mediaUrl.text;
        item.mimeType = media['mimeType']?.toString() ?? file.mimeType ?? '';
        item.fileName = media['fileName']?.toString() ?? file.name;
        item.temporaryMedia = true;
        item.type = _guessMediaTypeFromValues(
          item.fileName.isEmpty ? item.mediaUrl.text : item.fileName,
          item.mimeType,
        );
        item.feedback = 'Mídia enviada com sucesso.';
      });
      await _autosaveDraft();
    } catch (error) {
      if (mounted) setState(() => item.error = error.toString());
    } finally {
      if (mounted) setState(() => item.busy = false);
    }
  }

  Future<void> _resolveLink(_StatusComposerItem item) async {
    final link = item.mediaUrl.text.trim();
    final uri = Uri.tryParse(link);
    if (uri == null ||
        !const {'http', 'https'}.contains(uri.scheme.toLowerCase()) ||
        uri.host.isEmpty) {
      setState(() => item.error = 'Cole um link http ou https válido.');
      return;
    }
    setState(() {
      item.error = null;
      final provider = _socialProviderLabel(link);
      final isImage = RegExp(
        r'\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])',
        caseSensitive: false,
      ).hasMatch(link);
      item.type = isImage ? 'image' : 'video';
      item.sourceUrl = link;
      item.mediaPath = '';
      item.temporaryMedia = false;
      item.mimeType = item.type == 'video' ? 'video/mp4' : 'image/jpeg';
      item.fileName = item.type == 'video'
          ? 'midia-remota.mp4'
          : 'midia-remota.jpg';
      item.feedback = provider == null
          ? 'Link salvo como referência. A mídia será buscada somente no envio.'
          : 'Link do $provider salvo. A mídia será resolvida somente no envio.';
    });
    await _autosaveDraft();
  }

  Future<void> _enrichFromImdb(_StatusComposerItem item) async {
    final query = item.suggestedTitle.trim().isNotEmpty
        ? item.suggestedTitle.trim()
        : item.caption.text.trim();
    if (query.isEmpty) {
      setState(
        () => item.error =
            'Digite o nome do filme ou série na legenda para pesquisar.',
      );
      return;
    }
    setState(() {
      item.busy = true;
      item.error = null;
      item.feedback = 'Buscando detalhes do filme...';
    });
    try {
      final result = await ref
          .read(apiClientProvider)
          .enrichStatusFromImdb(query);
      if (!mounted) return;
      setState(() {
        item.caption.text = result['caption']?.toString() ?? item.caption.text;
        item.suggestedTitle = result['title']?.toString() ?? query;
        item.feedback = 'Detalhes encontrados e legenda preenchida.';
      });
      await _autosaveDraft();
    } catch (error) {
      if (mounted) setState(() => item.error = error.toString());
    } finally {
      if (mounted) setState(() => item.busy = false);
    }
  }

  String _analysisProviderLabel(String provider) {
    switch (provider) {
      case 'chatgpt':
        return 'ChatGPT';
      case 'auto':
        return 'Automático';
      default:
        return 'Gemini';
    }
  }

  Future<void> _analyzeWithAi(_StatusComposerItem item) async {
    final mediaUrl = item.mediaUrl.text.trim();
    if (mediaUrl.isEmpty) {
      setState(
        () => item.error =
            'Adicione ou resolva a mídia antes de pedir a análise.',
      );
      return;
    }
    final providerLabel = _analysisProviderLabel(item.analysisProvider);
    setState(() {
      item.busy = true;
      item.error = null;
      item.feedback = item.type == 'video'
          ? item.analysisProvider == 'chatgpt'
                ? 'Preparando cenas e áudio para o ChatGPT...'
                : 'Preparando o vídeo completo para o $providerLabel...'
          : 'Enviando a imagem para o $providerLabel...';
    });
    try {
      final api = ref.read(apiClientProvider);
      final jobId = await api.startStatusMediaAnalysis(
        mediaUrl: mediaUrl,
        provider: item.analysisProvider,
        campaignId: widget.initialCampaign?.id ?? '',
        contentId: item.id,
        mediaPath: item.mediaPath,
        mimeType: item.mimeType,
        fileName: item.fileName,
        query: item.caption.text.trim(),
      );
      if (mounted) {
        setState(() => item.feedback = '$providerLabel analisando a mídia...');
      }
      Map<String, dynamic>? completed;
      for (var attempt = 0; attempt < 300; attempt++) {
        await Future<void>.delayed(const Duration(seconds: 2));
        if (!mounted) return;
        final snapshot = await api.loadStatusChatGptAnalysis(jobId);
        final status = snapshot['status']?.toString() ?? '';
        if (status == 'succeeded') {
          completed = snapshot;
          break;
        }
        if (status == 'failed' || status == 'timeout') {
          throw StateError(
            snapshot['error']?.toString() ??
                'A IA não conseguiu concluir a análise.',
          );
        }
        if (attempt > 0 && attempt % 5 == 0) {
          setState(() {
            item.feedback =
                '$providerLabel analisando a mídia... ${attempt * 2} s';
          });
        }
      }
      if (completed == null) {
        throw StateError(
          'A análise excedeu dez minutos e foi encerrada. Tente novamente ou escolha outro provedor.',
        );
      }
      final result = completed['result'] is Map
          ? Map<String, dynamic>.from(completed['result'] as Map)
          : <String, dynamic>{};
      final caption = result['caption']?.toString().trim() ?? '';
      final title = result['title']?.toString().trim() ?? '';
      setState(() {
        if (caption.isNotEmpty) item.caption.text = caption;
        if (title.isNotEmpty) item.suggestedTitle = title;
        item.feedback = title.isEmpty
            ? 'Análise concluída e legenda preenchida.'
            : 'Identificado: $title';
      });
      await _autosaveDraft();
    } catch (error) {
      if (mounted) setState(() => item.error = error.toString());
    } finally {
      if (mounted) setState(() => item.busy = false);
    }
  }

  Future<void> _copyItemMediaUrl(_StatusComposerItem item) async {
    final rawUrl = item.mediaUrl.text.trim();
    final mediaUrl = _absoluteStatusUrl(rawUrl);
    if (mediaUrl == null) {
      setState(() => item.error = 'Adicione ou resolva uma mídia primeiro.');
      return;
    }
    await Clipboard.setData(ClipboardData(text: mediaUrl));
    if (!mounted) return;
    setState(() {
      item.error = null;
      item.feedback = 'Link da mídia copiado.';
    });
    showSuccessToast(context, 'Link da mídia copiado.');
  }

  Future<void> _copyItemCaption(_StatusComposerItem item) async {
    final caption = item.caption.text.trim();
    if (caption.isEmpty) {
      setState(() => item.error = 'A legenda ainda está vazia.');
      return;
    }
    await Clipboard.setData(ClipboardData(text: caption));
    if (!mounted) return;
    setState(() {
      item.error = null;
      item.feedback = 'Legenda copiada.';
    });
    showSuccessToast(context, 'Legenda copiada.');
  }

  Future<void> _openVideoPreview(_StatusComposerItem item) async {
    final rawUrl = item.mediaUrl.text.trim();
    final mediaUrl = _absoluteStatusUrl(rawUrl);
    if (mediaUrl == null) {
      setState(() => item.error = 'Adicione ou resolva o vídeo primeiro.');
      return;
    }
    FocusScope.of(context).unfocus();
    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        final size = MediaQuery.sizeOf(dialogContext);
        final compact = size.width < 680;
        return AlertDialog(
          title: Row(
            children: [
              const Expanded(child: Text('Visualizar vídeo')),
              IconButton(
                tooltip: 'Fechar',
                onPressed: () => Navigator.of(dialogContext).pop(),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          insetPadding: EdgeInsets.symmetric(
            horizontal: compact ? 10 : 28,
            vertical: compact ? 12 : 24,
          ),
          content: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: 760,
              maxHeight: size.height * .68,
            ),
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: LayoutBuilder(
                builder: (context, constraints) => InlineVideoPlayer(
                  url: mediaUrl,
                  width: constraints.maxWidth,
                  height: constraints.maxHeight,
                  borderRadius: BorderRadius.circular(12),
                  title: item.fileName.isEmpty
                      ? 'Prévia do status'
                      : item.fileName,
                  mimeType: item.mimeType.isEmpty ? null : item.mimeType,
                ),
              ),
            ),
          ),
          actions: [
            TextButton.icon(
              onPressed: () => _copyItemMediaUrl(item),
              icon: const Icon(Icons.copy_rounded),
              label: const Text('Copiar link'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Fechar'),
            ),
          ],
        );
      },
    );
  }

  List<String> _parseTimes(String raw) {
    final result = <String>{};
    for (final token in raw.split(RegExp(r'[,;\s]+'))) {
      final match = RegExp(
        r'^([01]\d|2[0-3]):([0-5]\d)$',
      ).firstMatch(token.trim());
      if (match != null) result.add('${match.group(1)}:${match.group(2)}');
    }
    final sorted = result.toList()..sort();
    return sorted;
  }

  String get _scheduleSettingsTitle {
    switch (_mode) {
      case 'scheduled':
        return 'Programado';
      case 'draft':
        return 'Rascunho';
      default:
        return 'Enviar agora';
    }
  }

  String get _scheduleSettingsSummary {
    if (_mode == 'draft') return 'Salvar sem publicar';
    if (_mode == 'now') return 'Publicar assim que o status for salvo';
    final dailyLimit = _dailyLimit.text.trim();
    if (_scheduleType == 'recurring') {
      final quantity = _randomizeContents
          ? ' · ${_randomCount.text.trim()} por disparo'
          : '';
      return 'A cada ${_everyMinutes.text.trim()} min$quantity · limite $dailyLimit/dia';
    }
    if (_randomizeContents) {
      final times = _parseTimes(_fixedTimes.text);
      final timeLabel = times.isEmpty ? 'Definir horários' : times.join(', ');
      return '$timeLabel · ${_randomCount.text.trim()} por horário · limite $dailyLimit/dia';
    }
    final configured = _items
        .where((item) => _parseTimes(item.time.text).length == 1)
        .length;
    return '$configured/${_items.length} horários definidos · limite $dailyLimit/dia';
  }

  Widget _buildScheduleSettingsAction() {
    final wa = WaTheme.of(context);
    return Material(
      color: wa.accentSoft,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: _openScheduleSettingsDialog,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              const Icon(Icons.schedule_send_rounded),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _scheduleSettingsTitle,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _scheduleSettingsSummary,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.tune_rounded),
            ],
          ),
        ),
      ),
    );
  }

  Future<bool> _openScheduleSettingsDialog() async {
    var mode = _mode;
    var scheduleType = _scheduleType;
    var randomizeContents = _randomizeContents;
    var randomizeSchedule = _randomizeSchedule;
    String? modalError;
    final fixedTimes = TextEditingController(text: _fixedTimes.text);
    final everyMinutes = TextEditingController(text: _everyMinutes.text);
    final randomCount = TextEditingController(text: _randomCount.text);
    final dailyLimit = TextEditingController(text: _dailyLimit.text);
    final jitterMinutes = TextEditingController(text: _jitterMinutes.text);
    final itemTimes = _items
        .map((item) => TextEditingController(text: item.time.text))
        .toList(growable: false);

    final applied = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          final media = MediaQuery.of(dialogContext);
          final compact = media.size.width < 680;
          final wa = WaTheme.of(dialogContext);

          void applySettings() {
            if (mode == 'scheduled') {
              final parsedDailyLimit = int.tryParse(dailyLimit.text.trim());
              if (parsedDailyLimit == null ||
                  parsedDailyLimit < 1 ||
                  parsedDailyLimit > 10000) {
                setDialogState(
                  () => modalError = 'Defina um limite diário positivo.',
                );
                return;
              }
              if (scheduleType == 'recurring') {
                final parsedInterval = int.tryParse(everyMinutes.text.trim());
                if (parsedInterval == null ||
                    parsedInterval < 5 ||
                    parsedInterval > 525600) {
                  setDialogState(
                    () => modalError =
                        'Defina um intervalo entre 5 e 525600 minutos.',
                  );
                  return;
                }
              } else if (randomizeContents) {
                if (_parseTimes(fixedTimes.text).isEmpty) {
                  setDialogState(
                    () => modalError = 'Informe ao menos um horário HH:MM.',
                  );
                  return;
                }
              } else {
                for (var index = 0; index < itemTimes.length; index++) {
                  if (_parseTimes(itemTimes[index].text).length != 1) {
                    setDialogState(
                      () => modalError =
                          'Defina um horário HH:MM válido para o status ${index + 1}.',
                    );
                    return;
                  }
                }
              }
              if (randomizeContents) {
                final parsedCount = int.tryParse(randomCount.text.trim());
                if (parsedCount == null ||
                    parsedCount < 1 ||
                    parsedCount > 10000) {
                  setDialogState(
                    () => modalError =
                        'A quantidade por horário/disparo deve ser positiva.',
                  );
                  return;
                }
              }
              if (randomizeSchedule) {
                final parsedJitter = int.tryParse(jitterMinutes.text.trim());
                if (parsedJitter == null ||
                    parsedJitter < 1 ||
                    parsedJitter > 720) {
                  setDialogState(
                    () => modalError =
                        'A variação deve ficar entre 1 e 720 minutos.',
                  );
                  return;
                }
              }
            }
            Navigator.of(dialogContext).pop(true);
          }

          return AlertDialog(
            title: Row(
              children: [
                const Expanded(child: Text('Configurar envio')),
                IconButton(
                  tooltip: 'Fechar',
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            insetPadding: EdgeInsets.symmetric(
              horizontal: compact ? 10 : 28,
              vertical: compact ? 12 : 24,
            ),
            content: ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: 680,
                maxHeight: (media.size.height - media.viewInsets.bottom) * .72,
              ),
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: mode,
                      decoration: const InputDecoration(
                        labelText: 'Quando enviar',
                        prefixIcon: Icon(Icons.schedule_send_rounded),
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'now',
                          child: Text('Enviar agora'),
                        ),
                        DropdownMenuItem(
                          value: 'scheduled',
                          child: Text('Programar'),
                        ),
                        DropdownMenuItem(
                          value: 'draft',
                          child: Text('Salvar como rascunho'),
                        ),
                      ],
                      onChanged: (value) => setDialogState(() {
                        mode = value ?? mode;
                        modalError = null;
                      }),
                    ),
                    if (mode == 'scheduled') ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: scheduleType,
                        decoration: const InputDecoration(
                          labelText: 'Tipo de programação',
                        ),
                        items: const [
                          DropdownMenuItem(
                            value: 'window',
                            child: Text('Horários específicos do dia'),
                          ),
                          DropdownMenuItem(
                            value: 'recurring',
                            child: Text('Intervalo contínuo'),
                          ),
                        ],
                        onChanged: (value) => setDialogState(() {
                          scheduleType = value ?? 'window';
                          modalError = null;
                        }),
                      ),
                      const SizedBox(height: 10),
                      if (scheduleType == 'recurring')
                        TextField(
                          controller: everyMinutes,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Intervalo em minutos',
                          ),
                        ),
                      SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          scheduleType == 'recurring'
                              ? 'Alternar conteúdos a cada disparo'
                              : 'Aleatorizar os status nos horários',
                        ),
                        subtitle: Text(
                          scheduleType == 'recurring'
                              ? 'Escolhe os menos usados sem ultrapassar o limite diário.'
                              : 'Desativado: defina abaixo o horário de cada status.',
                        ),
                        value: randomizeContents,
                        onChanged: (value) => setDialogState(() {
                          randomizeContents = value;
                          modalError = null;
                        }),
                      ),
                      if (scheduleType == 'window' && randomizeContents) ...[
                        TextField(
                          controller: fixedTimes,
                          decoration: const InputDecoration(
                            labelText: 'Horários do dia',
                            hintText: '08:00, 12:30, 18:45',
                            prefixIcon: Icon(Icons.access_time_rounded),
                          ),
                        ),
                        const SizedBox(height: 10),
                      ],
                      if (scheduleType == 'window' && !randomizeContents) ...[
                        const Text(
                          'Horário de cada status',
                          style: TextStyle(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        ...itemTimes.asMap().entries.map(
                          (entry) => Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: TextField(
                              controller: entry.value,
                              decoration: InputDecoration(
                                labelText: 'Status ${entry.key + 1}',
                                hintText: 'HH:MM',
                                prefixIcon: const Icon(Icons.schedule_rounded),
                              ),
                            ),
                          ),
                        ),
                      ],
                      if (randomizeContents) ...[
                        TextField(
                          controller: randomCount,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Quantidade por horário/disparo',
                            helperText:
                                'O limite diário continua sendo respeitado.',
                            prefixIcon: Icon(Icons.layers_rounded),
                          ),
                        ),
                        const SizedBox(height: 10),
                      ],
                      TextField(
                        controller: dailyLimit,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Limite diário de envios',
                          helperText:
                              'Máximo total enviado por dia neste perfil.',
                          prefixIcon: Icon(Icons.speed_rounded),
                        ),
                      ),
                      SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Variar os horários automaticamente'),
                        subtitle: const Text(
                          'Aplica uma pequena variação para não publicar sempre no mesmo minuto.',
                        ),
                        value: randomizeSchedule,
                        onChanged: (value) => setDialogState(() {
                          randomizeSchedule = value;
                          modalError = null;
                        }),
                      ),
                      if (randomizeSchedule)
                        TextField(
                          controller: jitterMinutes,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Variação máxima em minutos',
                          ),
                        ),
                      const SizedBox(height: 10),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: wa.accentSoft,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: wa.border),
                        ),
                        child: const Padding(
                          padding: EdgeInsets.all(12),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.star_rounded, size: 20),
                              SizedBox(width: 9),
                              Expanded(
                                child: Text(
                                  'Marque anúncios como preferenciais na organização do status. O sistema reserva ao menos uma vaga do limite diário para eles.',
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                    if (modalError != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        modalError!,
                        style: const TextStyle(color: Color(0xFFE53935)),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Cancelar'),
              ),
              FilledButton.icon(
                onPressed: applySettings,
                icon: const Icon(Icons.check_rounded),
                label: const Text('Aplicar configurações'),
              ),
            ],
          );
        },
      ),
    );

    if (applied == true && mounted) {
      setState(() {
        _mode = mode;
        _runNowAfterSave = mode == 'now';
        _publicationEndAt = null;
        _scheduleType = scheduleType;
        _randomizeContents = randomizeContents;
        _randomizeSchedule = randomizeSchedule;
        _fixedTimes.text = fixedTimes.text;
        _everyMinutes.text = everyMinutes.text;
        _randomCount.text = randomCount.text;
        _dailyLimit.text = dailyLimit.text;
        _jitterMinutes.text = jitterMinutes.text;
        for (var index = 0; index < _items.length; index++) {
          _items[index].time.text = itemTimes[index].text;
        }
      });
      _scheduleAutosave();
    }

    fixedTimes.dispose();
    everyMinutes.dispose();
    randomCount.dispose();
    dailyLimit.dispose();
    jitterMinutes.dispose();
    for (final controller in itemTimes) {
      controller.dispose();
    }
    return applied == true;
  }

  Widget _buildItemCard(_StatusComposerItem item, int index) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 560;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: EdgeInsets.all(compact ? 9 : 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Status ${index + 1}',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: wa.searchBg,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        item.type == 'video'
                            ? Icons.videocam_outlined
                            : item.type == 'image'
                            ? Icons.image_outlined
                            : item.type == 'link'
                            ? Icons.link_rounded
                            : Icons.notes_rounded,
                        size: 15,
                        color: wa.icon,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        item.type == 'video'
                            ? 'Vídeo detectado'
                            : item.type == 'image'
                            ? 'Imagem detectada'
                            : item.type == 'link'
                            ? '${_socialProviderLabel(item.mediaUrl.text) ?? 'Link'} detectado'
                            : 'Texto',
                        style: const TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Organizar este status',
                  visualDensity: VisualDensity.compact,
                  onPressed: item.busy
                      ? null
                      : () => _openItemOrganization(item, index),
                  icon: Icon(
                    item.prioritizeDaily
                        ? Icons.star_rounded
                        : Icons.tune_rounded,
                  ),
                ),
                IconButton(
                  tooltip: 'Remover',
                  visualDensity: VisualDensity.compact,
                  onPressed: _items.length == 1 || item.busy
                      ? null
                      : () => _removeItem(item),
                  icon: const Icon(Icons.delete_outline_rounded),
                ),
              ],
            ),
            const SizedBox(height: 6),
            if (item.type == 'text')
              TextField(
                controller: item.text,
                minLines: 2,
                maxLines: 5,
                decoration: const InputDecoration(
                  labelText: 'Texto deste status',
                  alignLabelWithHint: true,
                ),
              )
            else ...[
              TextField(
                controller: item.mediaUrl,
                onChanged: (value) {
                  final provider = _socialProviderLabel(value);
                  if (provider != null) {
                    if (item.type != 'link') {
                      setState(() => item.type = 'link');
                    }
                  } else if (_looksLikeDirectMedia(value)) {
                    final inferred = _guessMediaTypeFromValues(
                      value,
                      item.mimeType,
                    );
                    if (inferred != item.type) {
                      setState(() => item.type = inferred);
                    }
                  }
                  _scheduleLinkResolution(item, value);
                },
                onSubmitted: (_) {
                  item.resolveDebounce?.cancel();
                  if (!item.busy) unawaited(_resolveLink(item));
                },
                decoration: InputDecoration(
                  labelText: 'Link da mídia ou rede social',
                  hintText:
                      'YouTube, TikTok, Instagram, Facebook, Kwai, Pinterest...',
                  suffixIcon: IconButton(
                    tooltip: 'Resolver link',
                    onPressed: item.busy ? null : () => _resolveLink(item),
                    icon: const Icon(Icons.link_rounded),
                  ),
                ),
              ),
              const SizedBox(height: 6),
              OutlinedButton.icon(
                onPressed: item.busy ? null : () => _pickItemMedia(item),
                icon: const Icon(Icons.upload_file_rounded),
                label: const Text('Escolher ou substituir mídia'),
              ),
              const SizedBox(height: 6),
              TextField(
                controller: item.caption,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Legenda exclusiva (opcional)',
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  if (item.sourceUrl.isNotEmpty)
                    FilterChip(
                      selected: item.analyzeAfterSave,
                      avatar: const Icon(Icons.auto_awesome_rounded, size: 17),
                      label: const Text('Gemini após salvar'),
                      onSelected: item.busy
                          ? null
                          : (value) {
                              setState(() => item.analyzeAfterSave = value);
                              _scheduleAutosave();
                            },
                    ),
                  SizedBox(
                    width: 210,
                    child: DropdownButtonFormField<String>(
                      initialValue: item.analysisProvider,
                      decoration: const InputDecoration(
                        labelText: 'IA para análise',
                        isDense: true,
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'gemini',
                          child: Text('Gemini'),
                        ),
                        DropdownMenuItem(
                          value: 'chatgpt',
                          child: Text('ChatGPT'),
                        ),
                        DropdownMenuItem(
                          value: 'auto',
                          child: Text('Automático'),
                        ),
                      ],
                      onChanged: item.busy
                          ? null
                          : (value) {
                              setState(
                                () => item.analysisProvider = value ?? 'gemini',
                              );
                              _scheduleAutosave();
                            },
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: item.busy ? null : () => _enrichFromImdb(item),
                    icon: const Icon(Icons.movie_filter_outlined, size: 18),
                    label: const Text('Buscar no IMDb'),
                  ),
                  FilledButton.tonalIcon(
                    onPressed: item.busy ? null : () => _analyzeWithAi(item),
                    icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                    label: Text(
                      'Analisar com ${_analysisProviderLabel(item.analysisProvider)}',
                    ),
                  ),
                ],
              ),
              if (item.mediaUrl.text.trim().isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  item.mediaUrl.text,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    if (item.type == 'video')
                      FilledButton.tonalIcon(
                        onPressed: () => _openVideoPreview(item),
                        icon: const Icon(
                          Icons.play_circle_outline_rounded,
                          size: 18,
                        ),
                        label: const Text('Visualizar vídeo'),
                      ),
                    OutlinedButton.icon(
                      onPressed: () => _copyItemMediaUrl(item),
                      icon: const Icon(Icons.copy_rounded, size: 18),
                      label: const Text('Copiar link'),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => _copyItemCaption(item),
                      icon: const Icon(Icons.content_copy_rounded, size: 18),
                      label: const Text('Copiar legenda'),
                    ),
                  ],
                ),
              ],
            ],
            if (item.type == 'text' ||
                item.type == 'image' ||
                item.type == 'video') ...[
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                onPressed: item.busy ? null : () => _openItemVisualEditor(item),
                icon: const Icon(Icons.draw_rounded),
                label: const Text('Abrir editor visual'),
              ),
            ],
            if (item.busy)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: LinearProgressIndicator(),
              ),
            if (item.feedback != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(item.feedback!, style: TextStyle(color: wa.accent)),
              ),
            if (item.error != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  item.error!,
                  style: const TextStyle(color: Color(0xFFE53935)),
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final instances = ref.watch(_statusInstancesProvider);
    final loadedInstances = instances.value;
    final items = loadedInstances ?? widget.initialInstances;
    final available = _availableInstances(items);
    if (available.isNotEmpty &&
        !available.any((item) => item.id == _instanceId)) {
      final preferred = widget.preferredInstanceId;
      _instanceId =
          preferred != null && available.any((item) => item.id == preferred)
          ? preferred
          : available.first.id;
    }
    final media = MediaQuery.of(context);
    final compact = media.size.width < 680;
    final availableHeight = media.size.height - media.viewInsets.bottom;
    return AlertDialog(
      title: Row(
        children: [
          Expanded(
            child: Text(
              widget.initialCampaign == null ? 'Novo status' : 'Editar status',
            ),
          ),
          IconButton(
            tooltip: 'Fechar',
            visualDensity: VisualDensity.compact,
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.close_rounded),
          ),
        ],
      ),
      insetPadding: EdgeInsets.symmetric(
        horizontal: compact ? 10 : 28,
        vertical: compact ? 12 : 24,
      ),
      titlePadding: EdgeInsets.fromLTRB(
        compact ? 16 : 24,
        compact ? 16 : 22,
        compact ? 16 : 24,
        10,
      ),
      contentPadding: EdgeInsets.fromLTRB(
        compact ? 12 : 24,
        0,
        compact ? 12 : 24,
        12,
      ),
      actionsPadding: EdgeInsets.fromLTRB(
        compact ? 12 : 20,
        4,
        compact ? 12 : 20,
        compact ? 12 : 16,
      ),
      content: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 840,
          maxHeight: availableHeight * (compact ? .82 : .76),
        ),
        child: available.isNotEmpty
            ? Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildTopContentActions(compact),
                  const SizedBox(height: 8),
                  _buildScheduleSettingsAction(),
                  if (_draftRestored) ...[
                    const SizedBox(height: 8),
                    const Text(
                      'Rascunho automático restaurado.',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Flexible(
                    child: Scrollbar(
                      child: SingleChildScrollView(
                        keyboardDismissBehavior:
                            ScrollViewKeyboardDismissBehavior.onDrag,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            TextField(
                              controller: _name,
                              decoration: const InputDecoration(
                                labelText: 'Nome interno',
                                prefixIcon: Icon(Icons.label_outline_rounded),
                              ),
                            ),
                            const SizedBox(height: 14),
                            Row(
                              children: [
                                const Expanded(
                                  child: Text(
                                    'Conteúdos da programação',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                Text('${_items.length}/50'),
                              ],
                            ),
                            const SizedBox(height: 8),
                            ..._items.asMap().entries.map(
                              (entry) => _buildItemCard(entry.value, entry.key),
                            ),
                            if (_error != null) ...[
                              const SizedBox(height: 10),
                              Text(
                                _error!,
                                style: const TextStyle(
                                  color: Color(0xFFE53935),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              )
            : instances.when(
                data: (_) => const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Nenhuma instância disponível.'),
                  ),
                ),
                error: (error, _) => _ErrorBlock(
                  message: error.toString(),
                  onRetry: () => ref.invalidate(_statusInstancesProvider),
                ),
                loading: () => const _LoadingBlock(compact: true),
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submitting || available.isEmpty ? null : _submit,
          icon: _submitting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.send_rounded),
          label: Text(
            _mode == 'now'
                ? 'Enviar status'
                : _mode == 'scheduled'
                ? 'Salvar programação'
                : 'Salvar rascunho',
          ),
        ),
      ],
    );
  }

  Future<bool> _confirmPublicationDuration() async {
    var selection = switch (_mode) {
      'draft' => 'draft',
      'scheduled' when _publicationEndAt != null => 'extended',
      'scheduled' => 'scheduled',
      _ => '24h',
    };
    final remainingDays = _publicationEndAt == null
        ? 3
        : _publicationEndAt!
                  .difference(DateTime.now())
                  .inHours
                  .abs()
                  .clamp(48, 720) ~/
              24;
    final daysController = TextEditingController(text: '$remainingDays');
    String? modalError;
    final selected = await showDialog<String>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Row(
            children: [
              Icon(Icons.timelapse_rounded),
              SizedBox(width: 10),
              Expanded(child: Text('Duração e publicação')),
            ],
          ),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Escolha como este status será publicado. Cada publicação no WhatsApp permanece visível por 24 horas.',
                  ),
                  const SizedBox(height: 10),
                  RadioListTile<String>(
                    value: '24h',
                    groupValue: selection,
                    onChanged: (value) =>
                        setDialogState(() => selection = value ?? '24h'),
                    title: const Text('24 horas'),
                    subtitle: const Text('Publicar agora uma única vez.'),
                    secondary: const Icon(Icons.bolt_rounded),
                  ),
                  RadioListTile<String>(
                    value: 'extended',
                    groupValue: selection,
                    onChanged: (value) =>
                        setDialogState(() => selection = value ?? 'extended'),
                    title: const Text('Manter por mais dias'),
                    subtitle: const Text(
                      'Publicar agora e republicar diariamente até a data final.',
                    ),
                    secondary: const Icon(Icons.autorenew_rounded),
                  ),
                  if (selection == 'extended')
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: TextField(
                        controller: daysController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Quantidade de dias',
                          helperText: 'Entre 2 e 30 dias',
                          prefixIcon: Icon(Icons.calendar_month_rounded),
                        ),
                      ),
                    ),
                  RadioListTile<String>(
                    value: 'scheduled',
                    groupValue: selection,
                    onChanged: (value) =>
                        setDialogState(() => selection = value ?? 'scheduled'),
                    title: const Text('Programar'),
                    subtitle: const Text(
                      'Escolher horários, frequência, limite diário e pausas.',
                    ),
                    secondary: const Icon(Icons.schedule_send_rounded),
                  ),
                  RadioListTile<String>(
                    value: 'draft',
                    groupValue: selection,
                    onChanged: (value) =>
                        setDialogState(() => selection = value ?? 'draft'),
                    title: const Text('Outra opção: rascunho'),
                    subtitle: const Text('Salvar sem publicar agora.'),
                    secondary: const Icon(Icons.edit_note_rounded),
                  ),
                  if (modalError != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        modalError!,
                        style: const TextStyle(color: Color(0xFFE53935)),
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancelar'),
            ),
            FilledButton.icon(
              onPressed: () {
                if (selection == 'extended') {
                  final days = int.tryParse(daysController.text.trim());
                  if (days == null || days < 2 || days > 30) {
                    setDialogState(
                      () =>
                          modalError = 'Informe uma duração entre 2 e 30 dias.',
                    );
                    return;
                  }
                }
                Navigator.of(dialogContext).pop(selection);
              },
              icon: const Icon(Icons.arrow_forward_rounded),
              label: const Text('Continuar'),
            ),
          ],
        ),
      ),
    );
    final days = int.tryParse(daysController.text.trim()) ?? 3;
    daysController.dispose();
    if (!mounted || selected == null) return false;

    if (selected == 'scheduled') {
      final previousMode = _mode;
      final previousEndAt = _publicationEndAt;
      final previousRunNow = _runNowAfterSave;
      setState(() {
        _mode = 'scheduled';
        _publicationEndAt = null;
        _runNowAfterSave = false;
      });
      final configured = await _openScheduleSettingsDialog();
      if (!configured && mounted) {
        setState(() {
          _mode = previousMode;
          _publicationEndAt = previousEndAt;
          _runNowAfterSave = previousRunNow;
        });
      }
      return configured;
    }

    setState(() {
      if (selected == 'extended') {
        _mode = 'scheduled';
        _scheduleType = 'recurring';
        _everyMinutes.text = '1440';
        _randomizeContents = false;
        final itemCount = _items.length.clamp(1, 10000);
        final currentLimit = int.tryParse(_dailyLimit.text) ?? 1;
        if (currentLimit < itemCount) _dailyLimit.text = '$itemCount';
        _publicationEndAt = DateTime.now().add(Duration(days: days));
        _runNowAfterSave = true;
      } else if (selected == 'draft') {
        _mode = 'draft';
        _publicationEndAt = null;
        _runNowAfterSave = false;
      } else {
        _mode = 'now';
        _publicationEndAt = null;
        _runNowAfterSave = true;
      }
    });
    _scheduleAutosave();
    return true;
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final instanceId = _instanceId;
    if (instanceId == null) {
      setState(() => _error = 'Selecione uma instância.');
      return;
    }
    if (_items.any((item) => item.busy)) {
      setState(() => _error = 'Aguarde os uploads e resolvedores terminarem.');
      return;
    }
    if (!await _confirmPublicationDuration()) return;
    if (!mounted) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final individualTimes = <String>[];
      if (_mode == 'scheduled' &&
          _scheduleType == 'window' &&
          !_randomizeContents) {
        for (final item in _items) {
          final parsed = _parseTimes(item.time.text);
          if (parsed.length != 1) {
            throw StateError('Defina um horário HH:MM válido em cada status.');
          }
          individualTimes.add(parsed.first);
        }
      }
      final sortedTimes = _mode == 'scheduled' && _scheduleType == 'window'
          ? (_randomizeContents
                ? _parseTimes(_fixedTimes.text)
                : (individualTimes.toSet().toList()..sort()))
          : <String>[];
      if (_mode == 'scheduled' &&
          _scheduleType == 'window' &&
          sortedTimes.isEmpty) {
        throw StateError('Informe ao menos um horário válido.');
      }
      final parsedDailyLimit = int.tryParse(_dailyLimit.text.trim());
      if (_mode == 'scheduled' &&
          (parsedDailyLimit == null ||
              parsedDailyLimit < 1 ||
              parsedDailyLimit > 10000)) {
        throw StateError('Defina um limite diário positivo.');
      }

      final contents = <Map<String, dynamic>>[];
      final backgroundAnalyses = <_StatusBackgroundAnalysis>[];
      for (var index = 0; index < _items.length; index++) {
        final item = _items[index];
        final config = <String, dynamic>{};
        if (individualTimes.isNotEmpty) {
          config['scheduleSlot'] = sortedTimes.indexOf(individualTimes[index]);
        }
        if (item.visualEditor != null) {
          config['visualEditor'] = item.visualEditor;
        }
        if (item.sourceUrl.trim().isNotEmpty) {
          config['sourceUrl'] = item.sourceUrl.trim();
        }
        if (item.previewUrl.trim().isNotEmpty) {
          config['previewUrl'] = item.previewUrl.trim();
        }
        if (item.instagramProfile != null) {
          config['instagramProfile'] = item.instagramProfile;
        }
        if (item.type == 'text') {
          if (item.text.text.trim().isEmpty) {
            throw StateError('Preencha o texto do status ${index + 1}.');
          }
          contents.add({
            'id': item.id,
            'type': 'status',
            'statusType': 'text',
            'text': item.text.text.trim(),
            'alwaysSendWhenRandomized': item.prioritizeDaily,
            if (config.isNotEmpty) 'config': config,
          });
        } else {
          if (item.mediaPath.isEmpty && item.sourceUrl.trim().isEmpty) {
            throw StateError(
              'Adicione uma mídia ou um link válido no status ${index + 1}.',
            );
          }
          contents.add({
            'id': item.id,
            'type': 'status',
            'statusType': item.type,
            'caption': item.caption.text.trim().isEmpty
                ? null
                : item.caption.text.trim(),
            'alwaysSendWhenRandomized': item.prioritizeDaily,
            'media': {
              if (item.sourceUrl.trim().isNotEmpty)
                'url': item.sourceUrl.trim()
              else if (item.mediaUrl.text.trim().isNotEmpty)
                'url': item.mediaUrl.text.trim(),
              if (item.mediaPath.isNotEmpty) 'path': item.mediaPath,
              if (item.mimeType.isNotEmpty) 'mimeType': item.mimeType,
              if (item.fileName.isNotEmpty) 'fileName': item.fileName,
            },
            if (config.isNotEmpty) 'config': config,
          });
          if (item.analyzeAfterSave) {
            backgroundAnalyses.add(
              _StatusBackgroundAnalysis(
                contentId: item.id,
                provider: item.analysisProvider,
                query: item.caption.text.trim(),
              ),
            );
          }
        }
      }

      final schedule = _mode != 'scheduled'
          ? <String, dynamic>{'kind': 'manual'}
          : _scheduleType == 'recurring'
          ? <String, dynamic>{
              'kind': 'recurring',
              'everyMinutes': (int.tryParse(_everyMinutes.text) ?? 1440).clamp(
                5,
                525600,
              ),
              'timezone': 'America/Sao_Paulo',
              if (_publicationEndAt != null)
                'endAt': _publicationEndAt!.toUtc().toIso8601String(),
            }
          : <String, dynamic>{
              'kind': 'window',
              'atTimes': sortedTimes,
              'timezone': 'America/Sao_Paulo',
              if (_publicationEndAt != null)
                'endAt': _publicationEndAt!.toUtc().toIso8601String(),
            };
      final options = <String, dynamic>{};
      final existingStatusCommand =
          widget.initialCampaign?.options['statusCommand'];
      if (existingStatusCommand is Map) {
        options['statusCommand'] = Map<String, dynamic>.from(
          existingStatusCommand,
        );
      }
      if (_mode == 'scheduled') {
        final count = (int.tryParse(_randomCount.text) ?? 1).clamp(1, 10000);
        options['statusRandomizer'] = {
          'enabled': _randomizeContents,
          'dailyLimit': parsedDailyLimit!,
          'ensurePreferredDaily': true,
          if (_randomizeContents) 'perRunCount': count,
        };
      }
      if (_mode == 'scheduled' && _randomizeSchedule) {
        options['scheduleRandomizer'] = {
          'enabled': true,
          'jitterMinutes': (int.tryParse(_jitterMinutes.text) ?? 30).clamp(
            1,
            720,
          ),
          'reshuffleDaily': false,
        };
      }

      if (!mounted) return;
      await _autosaveDraft();
      if (!mounted) return;
      final autosaveKey = _autosaveKey;
      _handedOff = true;
      Navigator.of(context).pop(
        _StatusDraft(
          name: name.isEmpty ? 'Status' : name,
          instanceId: instanceId,
          schedule: schedule,
          contents: contents,
          options: options.isEmpty ? null : options,
          status: _mode == 'draft'
              ? 'draft'
              : widget.initialCampaign?.status.toLowerCase() == 'paused'
              ? 'paused'
              : 'scheduled',
          runNow: _runNowAfterSave,
          backgroundAnalyses: backgroundAnalyses,
          endAt: _publicationEndAt,
          autosaveKey: autosaveKey,
        ),
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = error.toString().replaceFirst('Bad state: ', '');
        });
      }
    }
  }
}

final _statusInstancesProvider = FutureProvider.autoDispose<List<BotInstance>>(
  (ref) => ref.watch(apiClientProvider).listInstances(refreshStatus: false),
);

class _ReceivedStatusViewerDialog extends StatefulWidget {
  const _ReceivedStatusViewerDialog({
    required this.group,
    required this.onSave,
    required this.onRepost,
  });

  final _ReceivedStatusGroup group;
  final ValueChanged<ReceivedStatus> onSave;
  final ValueChanged<ReceivedStatus> onRepost;

  @override
  State<_ReceivedStatusViewerDialog> createState() =>
      _ReceivedStatusViewerDialogState();
}

class _ReceivedStatusViewerDialogState
    extends State<_ReceivedStatusViewerDialog> {
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
          final availableWidth = (constraints.maxWidth - 16).clamp(
            240.0,
            560.0,
          );
          final availableHeight = (constraints.maxHeight - 24).clamp(
            320.0,
            920.0,
          );
          var storyWidth = availableWidth;
          var storyHeight = storyWidth * 16 / 9;
          if (storyHeight > availableHeight) {
            storyHeight = availableHeight;
            storyWidth = storyHeight * 9 / 16;
          }
          return Stack(
            children: [
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.black.withValues(alpha: 0.56),
                        const Color(0xFF6F7478).withValues(alpha: 0.72),
                        Colors.black.withValues(alpha: 0.56),
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
              Center(
                child: SizedBox(
                  width: storyWidth,
                  height: storyHeight,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        _ReceivedStatusStoryMedia(status: _status),
                        Positioned(
                          left: 0,
                          top: 104,
                          bottom: 72,
                          width: 72,
                          child: GestureDetector(
                            behavior: HitTestBehavior.translucent,
                            onTap: _previous,
                          ),
                        ),
                        Positioned(
                          right: 0,
                          top: 104,
                          bottom: 72,
                          width: 72,
                          child: GestureDetector(
                            behavior: HitTestBehavior.translucent,
                            onTap: _next,
                          ),
                        ),
                        _ReceivedStatusTopOverlay(
                          group: widget.group,
                          status: _status,
                          index: _index,
                          onSave: () => widget.onSave(_status),
                          onRepost: () => widget.onRepost(_status),
                          onClose: () => Navigator.of(context).maybePop(),
                        ),
                        if (_status.mediaUrl != null &&
                            (_status.bodyText ?? '').trim().isNotEmpty)
                          Positioned(
                            left: 0,
                            right: 0,
                            bottom: 0,
                            child: _ReceivedStatusCaption(
                              text: _status.bodyText!,
                            ),
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
                  child: _StatusViewerRoundButton(
                    icon: Icons.chevron_left_rounded,
                    onPressed: _previous,
                  ),
                ),
              Positioned(
                right: 28,
                top: constraints.maxHeight / 2 - 28,
                child: _StatusViewerRoundButton(
                  icon: Icons.chevron_right_rounded,
                  onPressed: _next,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ReceivedStatusStoryMedia extends StatelessWidget {
  const _ReceivedStatusStoryMedia({required this.status});

  final ReceivedStatus status;

  @override
  Widget build(BuildContext context) {
    final mediaUrl = _absoluteStatusUrl(status.mediaUrl);
    if (mediaUrl != null && status.isImage) {
      return ColoredBox(
        color: Colors.black,
        child: BotAdminCachedImage(
          imageUrl: mediaUrl,
          fit: BoxFit.contain,
          placeholder: (context, _) => const Center(
            child: CircularProgressIndicator(color: Colors.white),
          ),
          errorWidget: (context, _, _) =>
              _ReceivedStatusTextStory(status: status),
        ),
      );
    }
    if (mediaUrl != null && status.isVideo) {
      return ColoredBox(
        color: Colors.black,
        child: LayoutBuilder(
          builder: (context, constraints) => Center(
            child: InlineVideoPlayer(
              key: ValueKey('${status.id}-$mediaUrl'),
              url: mediaUrl,
              width: constraints.maxWidth,
              height: constraints.maxHeight,
              borderRadius: BorderRadius.zero,
              title: status.bodyText ?? 'Vídeo de status',
              mimeType: status.mimeType,
              autoplay: true,
            ),
          ),
        ),
      );
    }
    if (mediaUrl != null) {
      return ColoredBox(
        color: Colors.black,
        child: Center(
          child: InlineAudioPlayer(
            key: ValueKey('${status.id}-$mediaUrl'),
            url: mediaUrl,
            title: status.bodyText ?? 'Status',
            mimeType: status.mimeType,
            compact: true,
            autoplay: true,
          ),
        ),
      );
    }
    return _ReceivedStatusTextStory(status: status);
  }
}

class _ReceivedStatusTextStory extends StatelessWidget {
  const _ReceivedStatusTextStory({required this.status});

  final ReceivedStatus status;

  @override
  Widget build(BuildContext context) {
    final text = (status.bodyText ?? '').trim();
    final background =
        _parseStatusColor(status.backgroundColor) ?? const Color(0xFF1F3A5F);
    final foreground = _parseStatusColor(status.textColor) ?? Colors.white;
    return DecoratedBox(
      decoration: BoxDecoration(color: background),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(34),
          child: text.isEmpty
              ? const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(color: Colors.white),
                    SizedBox(height: 18),
                    Text(
                      'Sincronizando status…',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                )
              : Text(
                  text,
                  textAlign: TextAlign.center,
                  style: _receivedStatusTextStyle(
                    status.fontStyle,
                    foreground,
                  ).copyWith(fontSize: 28, height: 1.22),
                ),
        ),
      ),
    );
  }
}

class _ReceivedStatusTopOverlay extends StatelessWidget {
  const _ReceivedStatusTopOverlay({
    required this.group,
    required this.status,
    required this.index,
    required this.onSave,
    required this.onRepost,
    required this.onClose,
  });

  final _ReceivedStatusGroup group;
  final ReceivedStatus status;
  final int index;
  final VoidCallback onSave;
  final VoidCallback onRepost;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 0,
      right: 0,
      top: 0,
      child: DecoratedBox(
        decoration: const BoxDecoration(
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
              const SizedBox(height: 18),
              Row(
                children: [
                  _StatusCircle(
                    label: group.name,
                    active: true,
                    avatarUrl: group.avatarUrl,
                    segments: group.items.length,
                  ),
                  const SizedBox(width: 12),
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
                        const SizedBox(height: 2),
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
                  IconButton(
                    onPressed: onSave,
                    icon: const Icon(Icons.download_rounded),
                    color: Colors.white,
                    tooltip: 'Salvar no aparelho',
                  ),
                  IconButton(
                    onPressed: onRepost,
                    icon: const Icon(Icons.repeat_rounded),
                    color: Colors.white,
                    tooltip: 'Editar e repostar no meu status',
                  ),
                  IconButton(
                    onPressed: onClose,
                    icon: const Icon(Icons.close_rounded),
                    color: Colors.white,
                    tooltip: 'Fechar visualizador',
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

class _ReceivedStatusCaption extends StatelessWidget {
  const _ReceivedStatusCaption({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
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

class _StatusViewerRoundButton extends StatelessWidget {
  const _StatusViewerRoundButton({required this.icon, required this.onPressed});

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
    );
  }
}

String? _absoluteStatusUrl(String? value) {
  if (value == null || value.trim().isEmpty) return null;
  final raw = value.trim();
  if (raw.startsWith('https://pps.whatsapp.net/')) {
    return '${AppConfig.apiBaseUrl}/api/whatsapp-avatar-proxy?url=${Uri.encodeComponent(raw)}';
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  final normalized = raw.startsWith('/') ? raw : '/$raw';
  return '${AppConfig.apiBaseUrl}$normalized';
}

class _StatusDetailPane extends StatelessWidget {
  const _StatusDetailPane({
    required this.selected,
    required this.busy,
    required this.posts,
    required this.receivedStatuses,
    required this.onAction,
  });

  final BotAdCampaignSummary? selected;
  final bool busy;
  final List<StatusPost> posts;
  final List<ReceivedStatus> receivedStatuses;
  final ValueChanged<String>? onAction;

  @override
  Widget build(BuildContext context) {
    final campaign = selected;
    if (campaign == null) {
      return _SplitEmptyDetail(
        icon: Icons.trip_origin_rounded,
        title: 'Selecione um status',
        subtitle: 'Abra um item da lista para revisar ações e histórico.',
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
      children: [
        Text(
          campaign.name,
          style: TextStyle(
            color: WaTheme.of(context).textPrimary,
            fontSize: 24,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          '${_campaignStatusLabel(campaign.status)} · ${_scheduleKindLabel(campaign.scheduleKind)}',
          style: TextStyle(color: WaTheme.of(context).textMuted),
        ),
        const SizedBox(height: 18),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.tonalIcon(
              onPressed: busy || onAction == null
                  ? null
                  : () => onAction!('command'),
              icon: const Icon(Icons.settings_rounded),
              label: const Text('Comando da lista'),
            ),
            FilledButton.tonalIcon(
              onPressed: busy || onAction == null
                  ? null
                  : () => onAction!('edit'),
              icon: const Icon(Icons.edit_outlined),
              label: const Text('Editar'),
            ),
            FilledButton.icon(
              onPressed: busy || onAction == null
                  ? null
                  : () => onAction!('run'),
              icon: const Icon(Icons.send_rounded),
              label: const Text('Enviar agora'),
            ),
            OutlinedButton.icon(
              onPressed: busy || onAction == null
                  ? null
                  : () => onAction!('toggle'),
              icon: Icon(
                campaign.active
                    ? Icons.pause_circle_outline
                    : Icons.play_circle_outline,
              ),
              label: Text(campaign.active ? 'Pausar' : 'Ativar'),
            ),
            OutlinedButton.icon(
              onPressed: busy || onAction == null
                  ? null
                  : () => onAction!('delete'),
              icon: const Icon(Icons.delete_outline),
              label: const Text('Excluir'),
            ),
          ],
        ),
        const SizedBox(height: 28),
        _StatusSectionLabel('AGENDAMENTO'),
        const SizedBox(height: 12),
        _StatusRowShell(
          leading: _StatusCircle(
            label: campaign.name,
            active: campaign.active,
            icon: Icons.schedule_rounded,
          ),
          title: '${campaign.contentCount} conteúdo(s)',
          subtitle:
              '${campaign.targetCount} alvo(s) · Atualizada em ${_formatDateTime(campaign.updatedAt)}',
        ),
        const SizedBox(height: 28),
        _StatusSectionLabel('HISTÓRICO RECENTE'),
        const SizedBox(height: 12),
        if (posts.isEmpty)
          const _StatusEmptyLine('Sem postagens recentes deste perfil.')
        else
          ...posts.take(12).map((post) => _PostedStatusBubbleTile(post: post)),
      ],
    );
  }
}

class _ManagementSplitSurface extends StatelessWidget {
  const _ManagementSplitSurface({required this.list, required this.detail});

  final Widget list;
  final Widget detail;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 900) return list;
        return Row(
          children: [
            SizedBox(width: 430, child: list),
            VerticalDivider(width: 1, thickness: 1, color: wa.divider),
            Expanded(child: detail),
          ],
        );
      },
    );
  }
}

class _SplitEmptyDetail extends StatelessWidget {
  const _SplitEmptyDetail({
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 34,
              backgroundColor: wa.searchBg,
              child: Icon(icon, color: wa.icon, size: 34),
            ),
            const SizedBox(height: 14),
            Text(
              title,
              style: TextStyle(
                color: wa.textPrimary,
                fontWeight: FontWeight.w900,
                fontSize: 20,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(color: wa.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}

class _CampaignDetailPane extends StatelessWidget {
  const _CampaignDetailPane({
    required this.campaign,
    required this.busy,
    required this.onAction,
  });

  final BotAdCampaignSummary? campaign;
  final bool busy;
  final ValueChanged<String>? onAction;

  @override
  Widget build(BuildContext context) {
    final item = campaign;
    if (item == null) {
      return _SplitEmptyDetail(
        icon: Icons.outbox_outlined,
        title: 'Selecione uma divulgação',
        subtitle: 'Abra um anúncio para editar destinos, mensagem e intervalo.',
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
      children: [
        _PanelCard(
          title: item.name,
          subtitle:
              '${item.active ? 'Divulgação ativa' : 'Divulgação pausada'} · ${_promoterIntervalLabel(item)}',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (item.description?.isNotEmpty == true) ...[
                Text(item.description!),
                const SizedBox(height: 14),
              ],
              _InfoTile(
                icon: Icons.inventory_2_outlined,
                title: 'Conteúdos e alvos',
                subtitle:
                    '${item.targetCount} grupo(s) de destino\nAtualizada em ${_formatDateTime(item.updatedAt)}',
                active: item.active,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.tonalIcon(
                    onPressed: busy || onAction == null
                        ? null
                        : () => onAction!('edit'),
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Editar'),
                  ),
                  FilledButton.icon(
                    onPressed: busy || onAction == null
                        ? null
                        : () => onAction!('run'),
                    icon: const Icon(Icons.send_rounded),
                    label: const Text('Enviar agora'),
                  ),
                  OutlinedButton.icon(
                    onPressed: busy || onAction == null
                        ? null
                        : () => onAction!('toggle'),
                    icon: Icon(
                      item.active
                          ? Icons.pause_circle_outline
                          : Icons.play_circle_outline,
                    ),
                    label: Text(item.active ? 'Pausar' : 'Ativar'),
                  ),
                  OutlinedButton.icon(
                    onPressed: busy || onAction == null
                        ? null
                        : () => onAction!('delete'),
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Excluir'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class CallsPanel extends ConsumerStatefulWidget {
  const CallsPanel({super.key, required this.instances});

  final List<BotInstance> instances;

  @override
  ConsumerState<CallsPanel> createState() => _CallsPanelState();
}

class _CallsPanelState extends ConsumerState<CallsPanel> {
  bool _acting = false;
  String? _selectedCallKey;
  String? _busyCallAudioId;
  CallAudioBridgeSnapshot _audioSnapshot = callAudioBridge.current();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(liveCallsControllerProvider.notifier)
          .bindInstances(widget.instances);
    });
  }

  @override
  void didUpdateWidget(covariant CallsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.instances != widget.instances) {
      ref
          .read(liveCallsControllerProvider.notifier)
          .bindInstances(widget.instances);
    }
  }

  @override
  void dispose() {
    callAudioBridge.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final live = ref.watch(liveCallsControllerProvider);
    final connected = widget.instances.where((item) => item.isConnected).length;
    final compact = MediaQuery.sizeOf(context).width < 860;

    final callEntries = live.items
        .map((item) => _CallEntry(instance: item.instance, call: item.call))
        .toList(growable: false);
    final selected = _selectedCallEntry(callEntries);
    final ringing = callEntries
        .where((e) => e.call.isRinging)
        .toList(growable: false);
    final ongoing = callEntries
        .where((e) => e.call.isLive && !e.call.isRinging)
        .toList(growable: false);
    final recent = callEntries
        .where((e) => e.call.isTerminal)
        .toList(growable: false);

    if (live.loading && callEntries.isEmpty) {
      return ColoredBox(color: wa.contentBg, child: const _LoadingBlock());
    }
    if (live.error != null && callEntries.isEmpty) {
      return ColoredBox(
        color: wa.contentBg,
        child: _ErrorBlock(
          message: live.error.toString(),
          onRetry: () => unawaited(
            ref
                .read(liveCallsControllerProvider.notifier)
                .refresh(showLoading: true),
          ),
        ),
      );
    }

    final listPane = ColoredBox(
      color: wa.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _CallsHeader(
            activeCalls: ringing.length + ongoing.length,
            historyCount: recent.length,
            connectedInstances: connected,
            refreshing: live.loading,
            onRefresh: () => unawaited(
              ref.read(liveCallsControllerProvider.notifier).refresh(),
            ),
            onStart: connected == 0
                ? null
                : () => unawaited(_openStartCallDialog()),
          ),
          // Banners de recebimento no topo (estilo WhatsApp).
          for (final entry in ringing)
            _IncomingCallBanner(
              entry: entry,
              acting: _acting,
              onAccept: () =>
                  unawaited(_execute(entry.instance, entry.call, 'accept')),
              onReject: () =>
                  unawaited(_execute(entry.instance, entry.call, 'reject')),
            ),
          Expanded(
            child: callEntries.isEmpty
                ? const _CallsEmptyList()
                : ListView(
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      if (ongoing.isNotEmpty) ...[
                        _CallSectionLabel(label: 'Em andamento'),
                        for (final entry in ongoing)
                          _CallListTile(
                            entry: entry,
                            selected: entry.call.key == selected?.call.key,
                            audioSnapshot: _audioSnapshot,
                            onTap: () => _onSelectEntry(entry, compact),
                          ),
                      ],
                      if (ringing.isNotEmpty) ...[
                        _CallSectionLabel(label: 'Recebendo'),
                        for (final entry in ringing)
                          _CallListTile(
                            entry: entry,
                            selected: entry.call.key == selected?.call.key,
                            audioSnapshot: _audioSnapshot,
                            onTap: () => _onSelectEntry(entry, compact),
                          ),
                      ],
                      _CallSectionLabel(
                        label: recent.isEmpty ? 'Histórico' : 'Recentes',
                      ),
                      if (recent.isEmpty && ongoing.isEmpty && ringing.isEmpty)
                        const _CallsEmptyList()
                      else if (recent.isEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(26, 8, 26, 16),
                          child: Text(
                            'Quando houver chamadas finalizadas, elas aparecem aqui.',
                            style: TextStyle(color: wa.textMuted, height: 1.35),
                          ),
                        )
                      else
                        for (final entry in recent)
                          _CallListTile(
                            entry: entry,
                            selected: entry.call.key == selected?.call.key,
                            audioSnapshot: _audioSnapshot,
                            onTap: () => _onSelectEntry(entry, compact),
                          ),
                    ],
                  ),
          ),
        ],
      ),
    );

    if (compact) {
      return ColoredBox(color: wa.contentBg, child: listPane);
    }

    return ColoredBox(
      color: wa.contentBg,
      child: Row(
        children: [
          SizedBox(
            width: 372,
            child: DecoratedBox(
              decoration: BoxDecoration(
                border: Border(right: BorderSide(color: wa.border)),
              ),
              child: listPane,
            ),
          ),
          Expanded(
            child: _CallDetailPane(
              entry: selected,
              acting: _acting,
              audioSnapshot: _audioSnapshot,
              busyCallAudioId: _busyCallAudioId,
              onAction: selected == null
                  ? null
                  : (action) =>
                        _execute(selected.instance, selected.call, action),
              onStartAudio: selected == null
                  ? null
                  : () => _startAudio(selected.instance, selected.call),
              onStopAudio: _stopAudio,
              onStartCall: connected == 0
                  ? null
                  : () => unawaited(_openStartCallDialog()),
              onRefresh: () => unawaited(
                ref.read(liveCallsControllerProvider.notifier).refresh(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _onSelectEntry(_CallEntry entry, bool compact) {
    setState(() => _selectedCallKey = entry.call.key);
    // Chamadas ativas abrem o atendimento imediatamente em qualquer tamanho
    // de tela; o painel inferior fica reservado ao historico.
    if (entry.call.isRinging ||
        entry.call.isConnected ||
        entry.call.isOutgoingPending) {
      unawaited(_openCallDialog(entry));
      return;
    }
    if (!compact) return;
    unawaited(
      showBotAdminBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: WaTheme.of(context).panel,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        builder: (context) {
          return SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.78,
            child: _CallDetailPane(
              entry: entry,
              acting: _acting,
              audioSnapshot: _audioSnapshot,
              busyCallAudioId: _busyCallAudioId,
              onAction: (action) =>
                  _execute(entry.instance, entry.call, action),
              onStartAudio: () => _startAudio(entry.instance, entry.call),
              onStopAudio: _stopAudio,
              onStartCall: null,
              onRefresh: () => unawaited(
                ref.read(liveCallsControllerProvider.notifier).refresh(),
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _openCallDialog(_CallEntry entry) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => _IncomingCallDialog(
        entry: entry,
        acting: _acting,
        onAccept: () => _execute(entry.instance, entry.call, 'accept'),
        onReject: () async {
          await _execute(entry.instance, entry.call, 'reject');
          if (dialogContext.mounted) Navigator.of(dialogContext).pop();
        },
        onEnd: () async {
          await _execute(entry.instance, entry.call, 'end');
          if (dialogContext.mounted) Navigator.of(dialogContext).pop();
        },
        onSpeakerphone: (enabled) => callAudioBridge.setSpeakerphone(enabled),
        onMicrophoneMuted: (muted) => callAudioBridge.setMicrophoneMuted(muted),
      ),
    );
  }

  _CallEntry? _selectedCallEntry(List<_CallEntry> entries) {
    if (entries.isEmpty) return null;
    final selectedKey = _selectedCallKey;
    if (selectedKey != null) {
      for (final entry in entries) {
        if (entry.call.key == selectedKey) return entry;
      }
    }
    // Prefere chamada ao vivo / tocando na seleção inicial.
    for (final entry in entries) {
      if (entry.call.isRinging || entry.call.isConnected) return entry;
    }
    return entries.first;
  }

  Future<bool> _execute(
    BotInstance instance,
    WhatsappCallRecord call,
    String action,
  ) async {
    if (_acting) return false;
    setState(() => _acting = true);
    try {
      await ref
          .read(apiClientProvider)
          .executeCallAction(
            instance,
            action: action,
            callId: call.id,
            chatJid: call.chatJid,
            callCreator: call.callCreatorJid,
          );
      if (mounted) {
        if ((action == 'end' || action == 'reject') &&
            _audioSnapshot.callId == call.id) {
          callAudioBridge.stop();
          _audioSnapshot = callAudioBridge.current();
        }
        // Aceitar → tenta conectar áudio automaticamente (voz).
        if (action == 'accept' && !call.isVideo) {
          unawaited(_startAudio(instance, call));
        }
        showSuccessToast(context, 'Chamada ${_actionLabel(action)}.');
      }
      await ref.read(liveCallsControllerProvider.notifier).refresh();
      return true;
    } catch (error) {
      if (mounted) showErrorToast(context, error);
      return false;
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _startAudio(
    BotInstance instance,
    WhatsappCallRecord call,
  ) async {
    final callId = call.id.trim();
    if (callId.isEmpty || _busyCallAudioId != null) return;
    setState(() => _busyCallAudioId = callId);
    try {
      final snapshot = await callAudioBridge.start(
        instanceId: instance.id,
        callId: callId,
      );
      if (!mounted) return;
      setState(() => _audioSnapshot = snapshot);
      showSuccessToast(context, 'Áudio da chamada conectado.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _audioSnapshot = callAudioBridge.current());
      showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyCallAudioId = null);
    }
  }

  Future<void> _startAudioById(BotInstance instance, String callId) async {
    final normalized = callId.trim();
    if (normalized.isEmpty || _busyCallAudioId != null) return;
    if (mounted) setState(() => _busyCallAudioId = normalized);
    try {
      final snapshot = await callAudioBridge.start(
        instanceId: instance.id,
        callId: normalized,
      );
      if (mounted) setState(() => _audioSnapshot = snapshot);
    } catch (_) {
      if (mounted) setState(() => _audioSnapshot = callAudioBridge.current());
    } finally {
      if (mounted && _busyCallAudioId == normalized) {
        setState(() => _busyCallAudioId = null);
      }
    }
  }

  void _stopAudio() {
    callAudioBridge.stop();
    setState(() => _audioSnapshot = callAudioBridge.current());
  }

  Future<void> _openStartCallDialog() async {
    final connectedInstances = widget.instances
        .where((instance) => instance.isConnected)
        .toList(growable: false);
    if (connectedInstances.isEmpty) return;
    final draft = await showDialog<_StartCallDraft>(
      context: context,
      builder: (context) => _StartCallDialog(instances: connectedInstances),
    );
    if (draft == null) return;
    setState(() => _acting = true);
    ref
        .read(liveCallsControllerProvider.notifier)
        .addOptimisticOutgoing(
          instance: draft.instance,
          chatJid: draft.chatJid,
          video: draft.video,
        );
    if (mounted) {
      showSuccessToast(
        context,
        draft.video ? 'Iniciando chamada de vídeo…' : 'Chamando…',
      );
    }
    try {
      final callId = await ref
          .read(apiClientProvider)
          .executeCallAction(
            draft.instance,
            action: 'start',
            chatJid: draft.chatJid,
            video: draft.video,
          );
      if (!mounted) return;
      if (!draft.video && callId != null && callId.isNotEmpty) {
        unawaited(_startAudioById(draft.instance, callId));
      }
      await ref.read(liveCallsControllerProvider.notifier).refresh();
    } catch (error) {
      if (mounted) showErrorToast(context, error);
      await ref.read(liveCallsControllerProvider.notifier).refresh();
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }
}

/// Overlay global: banner de chamada recebida no topo (qualquer tela).
class LiveCallsOverlayHost extends ConsumerStatefulWidget {
  const LiveCallsOverlayHost({
    super.key,
    required this.instances,
    required this.child,
  });

  final List<BotInstance> instances;
  final Widget child;

  @override
  ConsumerState<LiveCallsOverlayHost> createState() =>
      _LiveCallsOverlayHostState();
}

class _LiveCallsOverlayHostState extends ConsumerState<LiveCallsOverlayHost> {
  bool _acting = false;
  bool _dialogOpen = false;
  String? _dialogCallKey;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(liveCallsControllerProvider.notifier)
          .bindInstances(widget.instances);
    });
  }

  @override
  void didUpdateWidget(covariant LiveCallsOverlayHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.instances != widget.instances) {
      ref
          .read(liveCallsControllerProvider.notifier)
          .bindInstances(widget.instances);
    }
  }

  @override
  Widget build(BuildContext context) {
    final live = ref.watch(liveCallsControllerProvider);
    final liveItems = live.items
        .where((item) => item.call.isLive)
        .toList(growable: false);
    final ringing = liveItems.where((item) => item.call.isRinging).toList();
    if (ringing.isNotEmpty &&
        !_dialogOpen &&
        _dialogCallKey != ringing.first.call.key) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_dialogOpen) {
          unawaited(_openIncomingCall(ringing.first));
        }
      });
    }
    return Stack(
      children: [
        widget.child,
        if (liveItems.isNotEmpty)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final item in liveItems.take(2))
                    _IncomingCallBanner(
                      entry: _CallEntry(
                        instance: item.instance,
                        call: item.call,
                      ),
                      acting: _acting,
                      elevated: true,
                      onAccept: () => unawaited(_overlayAction(item, 'accept')),
                      onReject: () => unawaited(_overlayAction(item, 'reject')),
                      onEnd: item.call.id.startsWith('local-')
                          ? null
                          : () => unawaited(_overlayAction(item, 'end')),
                      onOpen: item.call.isRinging
                          ? () => unawaited(_openIncomingCall(item))
                          : null,
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Future<bool> _overlayAction(LiveCallItem item, String action) async {
    if (_acting) return false;
    setState(() => _acting = true);
    try {
      await ref
          .read(apiClientProvider)
          .executeCallAction(
            item.instance,
            action: action,
            callId: item.call.id,
            chatJid: item.call.chatJid,
            callCreator: item.call.callCreatorJid,
          );
      if (!mounted) return false;
      if (action == 'accept' && !item.call.isVideo) {
        await _startOverlayAudio(item);
      }
      if (!mounted) return false;
      if (action == 'reject' || action == 'end') {
        callAudioBridge.stop();
      }
      showSuccessToast(context, 'Chamada ${_actionLabel(action)}.');
      await ref.read(liveCallsControllerProvider.notifier).refresh();
      return true;
    } catch (error) {
      if (mounted) showErrorToast(context, error);
      return false;
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _startOverlayAudio(LiveCallItem item) async {
    if (item.call.id.trim().isEmpty || item.call.isVideo) return;
    try {
      await callAudioBridge.start(
        instanceId: item.instance.id,
        callId: item.call.id,
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _openIncomingCall(LiveCallItem item) async {
    if (_dialogOpen) return;
    _dialogOpen = true;
    _dialogCallKey = item.call.key;
    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => _IncomingCallDialog(
          entry: _CallEntry(instance: item.instance, call: item.call),
          acting: _acting,
          onAccept: () async {
            final accepted = await _overlayAction(item, 'accept');
            return accepted;
          },
          onReject: () async {
            await _overlayAction(item, 'reject');
            if (dialogContext.mounted) Navigator.of(dialogContext).pop();
          },
          onEnd: () async {
            await _overlayAction(item, 'end');
            if (dialogContext.mounted) Navigator.of(dialogContext).pop();
          },
          onSpeakerphone: (enabled) => callAudioBridge.setSpeakerphone(enabled),
          onMicrophoneMuted: (muted) =>
              callAudioBridge.setMicrophoneMuted(muted),
        ),
      );
    } finally {
      _dialogOpen = false;
    }
  }
}

class ToolsPanel extends ConsumerStatefulWidget {
  const ToolsPanel({super.key, required this.instances});

  final List<BotInstance> instances;

  @override
  ConsumerState<ToolsPanel> createState() => _ToolsPanelState();
}

class _ToolsPanelState extends ConsumerState<ToolsPanel> {
  String? _busyKey;

  @override
  Widget build(BuildContext context) {
    final flows = ref.watch(botFlowsProvider);
    final raffles = ref.watch(userRafflesProvider);
    final affiliateProviders = ref.watch(affiliateProvidersProvider);
    final affiliateLinks = ref.watch(affiliateLinksProvider);
    return _ModuleSurface(
      title: 'Ferramentas',
      subtitle:
          'Fluxos, rifas, afiliados e recursos conectados ao atendimento.',
      icon: Icons.storefront_outlined,
      onRefresh: _refreshTools,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
        children: [
          flows.when(
            data: _buildFlowsCard,
            error: (error, _) => _PanelCard(
              title: 'Fluxos da instância',
              child: _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(botFlowsProvider),
              ),
            ),
            loading: () => const _PanelCard(
              title: 'Fluxos da instância',
              child: _LoadingBlock(compact: true),
            ),
          ),
          SizedBox(height: 14),
          raffles.when(
            data: _buildRafflesCard,
            error: (error, _) => _PanelCard(
              title: 'Rifas',
              child: _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(userRafflesProvider),
              ),
            ),
            loading: () => const _PanelCard(
              title: 'Rifas',
              child: _LoadingBlock(compact: true),
            ),
          ),
          SizedBox(height: 14),
          affiliateProviders.when(
            data: _buildAffiliateProvidersCard,
            error: (error, _) => _PanelCard(
              title: 'Contas afiliadas',
              child: _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(affiliateProvidersProvider),
              ),
            ),
            loading: () => const _PanelCard(
              title: 'Contas afiliadas',
              child: _LoadingBlock(compact: true),
            ),
          ),
          SizedBox(height: 14),
          affiliateLinks.when(
            data: _buildAffiliateLinksCard,
            error: (error, _) => _PanelCard(
              title: 'Produtos afiliados',
              child: _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(affiliateLinksProvider),
              ),
            ),
            loading: () => const _PanelCard(
              title: 'Produtos afiliados',
              child: _LoadingBlock(compact: true),
            ),
          ),
          SizedBox(height: 14),
          _buildInstancesCard(),
        ],
      ),
    );
  }

  void _refreshTools() {
    ref.invalidate(botFlowsProvider);
    ref.invalidate(userRafflesProvider);
    ref.invalidate(affiliateProvidersProvider);
    ref.invalidate(affiliateLinksProvider);
  }

  Widget _buildFlowsCard(List<BotFlowSummary> items) {
    return _PanelCard(
      title: 'Fluxos da instância',
      subtitle: 'Crie fluxos rápidos e ligue/desligue automações.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: _busyKey == null ? _openCreateFlowDialog : null,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Novo fluxo rápido'),
            ),
          ),
          SizedBox(height: 12),
          _ListOrEmpty(
            isEmpty: items.isEmpty,
            emptyText: 'Nenhum fluxo criado ainda.',
            children: items
                .map(
                  (flow) => _FlowTile(
                    flow: flow,
                    busy: _busyKey == 'flow-${flow.id}',
                    onToggle: (value) => _toggleFlow(flow, value),
                    onDelete: () => _deleteFlow(flow),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildRafflesCard(List<UserRaffleSummary> raffles) {
    return _PanelCard(
      title: 'Rifas',
      subtitle: 'Acompanhe venda, reservas e grupos vinculados.',
      child: _ListOrEmpty(
        isEmpty: raffles.isEmpty,
        emptyText: 'Nenhuma rifa criada ainda.',
        children: raffles
            .take(12)
            .map((raffle) => _RaffleTile(raffle: raffle))
            .toList(),
      ),
    );
  }

  Widget _buildAffiliateProvidersCard(
    List<AffiliateProviderSummary> providers,
  ) {
    return _PanelCard(
      title: 'Contas afiliadas',
      subtitle: 'Conexões configuradas para catálogos e links automáticos.',
      child: _ListOrEmpty(
        isEmpty: providers.isEmpty,
        emptyText: 'Nenhum provedor afiliado configurado.',
        children: providers
            .map((provider) => _AffiliateProviderTile(provider: provider))
            .toList(),
      ),
    );
  }

  Widget _buildAffiliateLinksCard(AffiliateLinksSnapshot snapshot) {
    final links = snapshot.allLinks.take(14).toList();
    return _PanelCard(
      title: 'Produtos afiliados',
      subtitle:
          '${snapshot.activeLinks} ativo(s) em ${snapshot.totalLinks} link(s) carregados.',
      child: _ListOrEmpty(
        isEmpty: links.isEmpty,
        emptyText: 'Nenhum produto afiliado salvo ainda.',
        children: links
            .map((link) => _AffiliateProductTile(link: link))
            .toList(),
      ),
    );
  }

  Widget _buildInstancesCard() {
    return _PanelCard(
      title: 'Instâncias disponíveis',
      child: _ListOrEmpty(
        isEmpty: widget.instances.isEmpty,
        emptyText: 'Nenhuma instância cadastrada.',
        children: widget.instances
            .map(
              (instance) => _InfoTile(
                icon: Icons.smart_toy_rounded,
                title: instance.name,
                subtitle:
                    '${instance.sessionStatus}${instance.phoneNumber == null ? '' : ' · ${instance.phoneNumber}'}',
                active: instance.isConnected,
              ),
            )
            .toList(),
      ),
    );
  }

  Future<void> _openCreateFlowDialog() async {
    final draft = await showDialog<_FlowDraft>(
      context: context,
      builder: (context) => const _CreateFlowDialog(),
    );
    if (draft == null) return;
    await _runFlowAction('create', () {
      return ref
          .read(apiClientProvider)
          .createBotFlow(
            name: draft.name,
            command: draft.command,
            scope: draft.scope,
            text: draft.text,
          );
    });
  }

  Future<void> _toggleFlow(BotFlowSummary flow, bool enabled) {
    return _runFlowAction('flow-${flow.id}', () {
      return ref
          .read(apiClientProvider)
          .updateBotFlow(flow.copyForEnabled(enabled));
    });
  }

  Future<void> _deleteFlow(BotFlowSummary flow) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remover fluxo?'),
        content: Text('O fluxo "${flow.name}" será removido definitivamente.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton.tonal(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remover'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _runFlowAction('flow-${flow.id}', () {
      return ref.read(apiClientProvider).deleteBotFlow(flow.id);
    });
  }

  Future<void> _runFlowAction(
    String key,
    Future<List<BotFlowSummary>> Function() action,
  ) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = key);
    try {
      await action();
      ref.invalidate(botFlowsProvider);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Fluxos atualizados.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }
}

class RafflesPanel extends ConsumerStatefulWidget {
  const RafflesPanel({super.key});

  @override
  ConsumerState<RafflesPanel> createState() => _RafflesPanelState();
}

class _RafflesPanelState extends ConsumerState<RafflesPanel> {
  String? _busyKey;

  @override
  Widget build(BuildContext context) {
    final raffles = ref.watch(userRafflesProvider);
    final paymentSettings = ref.watch(rafflePaymentSettingsProvider);
    final dashboard = ref.watch(dashboardSnapshotProvider);
    return _ModuleSurface(
      title: 'Rifas',
      subtitle: 'Reservas, vendas, sorteios e grupos vinculados.',
      icon: Icons.confirmation_number_outlined,
      onRefresh: () {
        ref.invalidate(userRafflesProvider);
        ref.invalidate(dashboardSnapshotProvider);
      },
      child: raffles.when(
        data: (items) {
          return ListView(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
            children: [
              paymentSettings.when(
                data: (settings) => _RafflePaymentBar(
                  settings: settings,
                  onConfigure: () => _openPaymentSettings(settings),
                ),
                loading: () => const LinearProgressIndicator(minHeight: 3),
                error: (_, _) => _RafflePaymentBar(
                  onConfigure: () => _openPaymentSettings(null),
                ),
              ),
              const SizedBox(height: 12),
              _PanelCard(
                title: 'Gerenciar rifas',
                subtitle:
                    'Área dedicada para acompanhar vendas, reservas e sorteios sem sair do painel Flutter.',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.icon(
                        onPressed: _busyKey == null
                            ? () => _startNewRaffle(
                                paymentSettings.asData?.value,
                                dashboard.asData?.value.groups ?? const [],
                              )
                            : null,
                        icon: const Icon(Icons.add_rounded),
                        label: const Text('Nova rifa'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    _ListOrEmpty(
                      isEmpty: items.isEmpty,
                      emptyText: 'Nenhuma rifa criada ainda.',
                      children: items
                          .take(24)
                          .map(
                            (raffle) => _RaffleTile(
                              raffle: raffle,
                              busy: _busyKey == 'raffle-${raffle.id}',
                              onAction: (action) => _handleRaffleAction(
                                raffle,
                                action,
                                dashboard.asData?.value.groups ?? const [],
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
        error: (error, _) => _ErrorBlock(
          message: error.toString(),
          onRetry: () => ref.invalidate(userRafflesProvider),
        ),
        loading: () => const _LoadingBlock(),
      ),
    );
  }

  Future<void> _startNewRaffle(
    RafflePaymentSettings? settings,
    List<BotGroup> groups,
  ) async {
    if (settings?.configured != true) {
      final configure = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          icon: const Icon(
            Icons.account_balance_wallet_outlined,
            color: Color(0xFF008069),
            size: 34,
          ),
          title: const Text('Configure o recebimento'),
          content: const Text(
            'Cadastre suas credenciais de pagamento para receber o valor das rifas.',
            textAlign: TextAlign.center,
          ),
          actionsAlignment: MainAxisAlignment.center,
          actions: [
            FilledButton.icon(
              onPressed: () => Navigator.of(context).pop(true),
              icon: const Icon(Icons.settings_outlined),
              label: const Text('Configurar pagamento'),
            ),
          ],
        ),
      );
      if (configure != true || !mounted) return;
      final saved = await _openPaymentSettings(settings);
      if (!saved || !mounted) return;
    }
    await _openRaffleEditor(groups: groups);
  }

  Future<bool> _openPaymentSettings(RafflePaymentSettings? settings) async {
    final draft = await showDialog<_RafflePaymentDraft>(
      context: context,
      builder: (context) => _RafflePaymentDialog(settings: settings),
    );
    if (draft == null) return false;
    try {
      await ref
          .read(apiClientProvider)
          .saveRafflePaymentSettings(
            provider: draft.provider,
            credential: draft.credential,
            pixExpirationMinutes: draft.pixExpirationMinutes,
          );
      ref.invalidate(rafflePaymentSettingsProvider);
      if (mounted) showSuccessToast(context, 'Recebimento configurado.');
      return true;
    } catch (error) {
      if (mounted) showErrorToast(context, error);
      return false;
    }
  }

  Future<void> _openRaffleEditor({
    UserRaffleSummary? raffle,
    required List<BotGroup> groups,
  }) async {
    final draft = await showDialog<_RaffleDraft>(
      context: context,
      builder: (context) => _RaffleEditDialog(raffle: raffle, groups: groups),
    );
    if (draft == null) return;

    await _runRaffleAction(
      raffle == null ? 'raffle-new' : 'raffle-${raffle.id}',
      raffle == null ? 'Rifa criada.' : 'Rifa atualizada.',
      () async {
        if (raffle == null) {
          await ref.read(apiClientProvider).createRaffle(draft.toPayload());
        } else {
          await ref
              .read(apiClientProvider)
              .updateRaffle(raffle.id, draft.toPayload());
        }
      },
    );
  }

  Future<void> _handleRaffleAction(
    UserRaffleSummary raffle,
    String action,
    List<BotGroup> groups,
  ) async {
    switch (action) {
      case 'edit':
        await _openRaffleEditor(raffle: raffle, groups: groups);
        return;
      case 'toggle':
        await _runRaffleAction(
          'raffle-${raffle.id}',
          raffle.active ? 'Rifa pausada.' : 'Rifa ativada.',
          () => ref
              .read(apiClientProvider)
              .updateRaffleStatus(
                raffle.id,
                raffle.active ? 'draft' : 'active',
              ),
        );
        return;
      case 'release':
        await _runRaffleAction(
          'raffle-${raffle.id}',
          'Reservas liberadas.',
          () =>
              ref.read(apiClientProvider).releaseRaffleReservations(raffle.id),
        );
        return;
      case 'draw':
        final confirmed = await _confirmAction(
          context,
          title: 'Sortear rifa',
          message:
              'Sortear "${raffle.title}" agora? Essa ação define ganhadores.',
          confirmLabel: 'Sortear',
        );
        if (!confirmed) return;
        await _runRaffleAction(
          'raffle-${raffle.id}',
          'Rifa sorteada.',
          () =>
              ref.read(apiClientProvider).drawRaffle(raffle.id, announce: true),
        );
        return;
      case 'delete':
        final confirmed = await _confirmAction(
          context,
          title: 'Excluir rifa',
          message: 'Excluir "${raffle.title}" definitivamente?',
          confirmLabel: 'Excluir',
          destructive: true,
        );
        if (!confirmed) return;
        await _runRaffleAction(
          'raffle-${raffle.id}',
          'Rifa excluída.',
          () => ref.read(apiClientProvider).deleteRaffle(raffle.id),
        );
        return;
    }
  }

  Future<void> _runRaffleAction(
    String key,
    String success,
    Future<void> Function() action,
  ) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = key);
    try {
      await action();
      ref.invalidate(userRafflesProvider);
      if (mounted) showSuccessToast(context, success);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }
}

class _RafflePaymentBar extends StatelessWidget {
  const _RafflePaymentBar({required this.onConfigure, this.settings});

  final RafflePaymentSettings? settings;
  final VoidCallback onConfigure;

  @override
  Widget build(BuildContext context) {
    final configured = settings?.configured == true;
    final provider = switch (settings?.activeProvider) {
      'polopag_pix' => 'PoloPag',
      'mercadopago_pix' => 'Mercado Pago',
      _ => 'Não configurado',
    };
    return Material(
      color: configured ? const Color(0xFFE7F8EF) : const Color(0xFFFFF4E5),
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onConfigure,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            border: Border.all(
              color: configured
                  ? const Color(0xFF72C89A)
                  : const Color(0xFFE8B45A),
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Icon(
                configured
                    ? Icons.verified_outlined
                    : Icons.account_balance_wallet_outlined,
                color: configured
                    ? const Color(0xFF008069)
                    : const Color(0xFF8A5A00),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Recebimento das rifas',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      configured
                          ? '$provider ativo para novas compras'
                          : 'Configure antes de criar uma rifa',
                      style: const TextStyle(
                        color: Color(0xFF54656F),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              TextButton.icon(
                onPressed: onConfigure,
                icon: const Icon(Icons.settings_outlined, size: 18),
                label: Text(configured ? 'Editar' : 'Configurar'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RafflePaymentDraft {
  const _RafflePaymentDraft({
    required this.provider,
    required this.credential,
    required this.pixExpirationMinutes,
  });

  final String provider;
  final String credential;
  final int pixExpirationMinutes;
}

class _RafflePaymentDialog extends StatefulWidget {
  const _RafflePaymentDialog({this.settings});

  final RafflePaymentSettings? settings;

  @override
  State<_RafflePaymentDialog> createState() => _RafflePaymentDialogState();
}

class _RafflePaymentDialogState extends State<_RafflePaymentDialog> {
  late String _provider = widget.settings?.activeProvider ?? 'mercadopago_pix';
  late final TextEditingController _credential = TextEditingController();
  late final TextEditingController _expiration = TextEditingController(
    text: _selectedExpiration.toString(),
  );
  bool _obscureCredential = true;
  String? _error;

  int get _selectedExpiration => _provider == 'polopag_pix'
      ? widget.settings?.poloPagExpirationMinutes ?? 30
      : widget.settings?.mercadoPagoExpirationMinutes ?? 30;

  bool get _selectedConfigured => _provider == 'polopag_pix'
      ? widget.settings?.poloPagConfigured == true
      : widget.settings?.mercadoPagoConfigured == true;

  String? get _selectedMask => _provider == 'polopag_pix'
      ? widget.settings?.poloPagCredentialMask
      : widget.settings?.mercadoPagoCredentialMask;

  @override
  void dispose() {
    _credential.dispose();
    _expiration.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 560;
    return AlertDialog(
      title: const Text('Recebimento das rifas'),
      content: SizedBox(
        width: 500,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButtonFormField<String>(
                initialValue: _provider,
                decoration: const InputDecoration(
                  labelText: 'Plataforma',
                  prefixIcon: Icon(Icons.payments_outlined),
                ),
                items: const [
                  DropdownMenuItem(
                    value: 'mercadopago_pix',
                    child: Text('Mercado Pago'),
                  ),
                  DropdownMenuItem(
                    value: 'polopag_pix',
                    child: Text('PoloPag'),
                  ),
                ],
                onChanged: (value) {
                  if (value == null) return;
                  setState(() {
                    _provider = value;
                    _credential.clear();
                    _expiration.text = _selectedExpiration.toString();
                    _error = null;
                  });
                },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _credential,
                obscureText: _obscureCredential,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  labelText: _provider == 'polopag_pix'
                      ? 'Chave da API'
                      : 'Access Token',
                  hintText: _selectedConfigured
                      ? 'Manter $_selectedMask'
                      : 'Cole a credencial',
                  errorText: _error,
                  prefixIcon: const Icon(Icons.key_outlined),
                  suffixIcon: IconButton(
                    onPressed: () => setState(
                      () => _obscureCredential = !_obscureCredential,
                    ),
                    tooltip: _obscureCredential ? 'Mostrar' : 'Ocultar',
                    icon: Icon(
                      _obscureCredential
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _expiration,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'Reserva Pix (minutos)',
                  prefixIcon: Icon(Icons.timer_outlined),
                ),
              ),
              if (_provider == 'mercadopago_pix') ...[
                const SizedBox(height: 8),
                Align(
                  alignment: compact
                      ? Alignment.centerLeft
                      : Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: () {
                      final url =
                          widget.settings?.mercadoPagoCredentialsUrl ??
                          'https://www.mercadopago.com.br/developers/panel/app';
                      launchUrl(
                        Uri.parse(url),
                        mode: LaunchMode.externalApplication,
                      );
                    },
                    icon: const Icon(Icons.open_in_new_rounded, size: 17),
                    label: const Text('Obter credenciais'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.save_outlined),
          label: const Text('Salvar'),
        ),
      ],
    );
  }

  void _submit() {
    final credential = _credential.text.trim();
    if (credential.isEmpty && !_selectedConfigured) {
      setState(() => _error = 'Informe a credencial.');
      return;
    }
    final expiration = int.tryParse(_expiration.text.trim()) ?? 30;
    Navigator.of(context).pop(
      _RafflePaymentDraft(
        provider: _provider,
        credential: credential,
        pixExpirationMinutes: expiration.clamp(5, 1440),
      ),
    );
  }
}

class StorePanel extends ConsumerStatefulWidget {
  const StorePanel({
    required this.instances,
    this.threads = const [],
    this.onOpenConversation,
    super.key,
  });

  final List<BotInstance> instances;
  final List<ConversationThread> threads;
  final ValueChanged<ConversationThread>? onOpenConversation;

  @override
  ConsumerState<StorePanel> createState() => _StorePanelState();
}

class _StorePanelState extends ConsumerState<StorePanel> {
  int? _instanceId;
  int? _selectedCategoryId;
  int? _selectedProductId;
  int? _selectedInventoryId;
  int? _selectedWwPanelOfferId;
  int? _selectedWwPanelClientId;
  int? _selectedSmmServiceId;
  int? _selectedSmmOrderId;
  String? _selectedSmmCategory;
  final Set<int> _selectedSmmServiceIds = <int>{};
  bool _selectingSmmServices = false;
  String? _selectedCustomerJid;
  bool _creatingCategory = false;
  bool _creatingProduct = false;
  bool _creatingInventory = false;
  bool _creatingWwPanelOffer = false;
  bool _creatingWwPanelTrial = false;
  String? _busyKey;
  final _inventorySearch = TextEditingController();
  final _smmSearch = TextEditingController();
  final _customerSearch = TextEditingController();

  @override
  void dispose() {
    _inventorySearch.dispose();
    _smmSearch.dispose();
    _customerSearch.dispose();
    super.dispose();
  }

  int? get _activeInstanceId {
    final selected = _instanceId;
    if (selected != null &&
        widget.instances.any((instance) => instance.id == selected)) {
      return selected;
    }
    return widget.instances.isEmpty ? null : widget.instances.first.id;
  }

  @override
  Widget build(BuildContext context) {
    final instanceId = _activeInstanceId;
    final snapshot = instanceId == null
        ? null
        : ref.watch(botStoreProvider(instanceId));
    final loadedSnapshot = snapshot?.asData?.value;
    return _ModuleSurface(
      title: 'Store',
      subtitle: 'Produtos digitais e vendas automáticas no privado do robô.',
      icon: Icons.storefront_outlined,
      onRefresh: instanceId == null
          ? null
          : () => ref.invalidate(botStoreProvider(instanceId)),
      actions: [
        IconButton(
          onPressed: widget.instances.isEmpty ? null : _selectInstance,
          icon: const Icon(Icons.swap_horiz_rounded),
          tooltip: 'Trocar perfil',
        ),
        if (instanceId != null && loadedSnapshot != null)
          _StoreQuickSettingsButton(
            instance: widget.instances.firstWhere(
              (instance) => instance.id == instanceId,
            ),
            store: loadedSnapshot.store,
            wwPanel: loadedSnapshot.wwPanel,
            busy: _busyKey != null,
            onToggle: (enabled) => _saveStore(
              instanceId,
              {'enabled': enabled},
              success: enabled ? 'Loja ativada no privado.' : 'Loja pausada.',
            ),
            onSettings: () => _openStoreSettings(instanceId, loadedSnapshot),
            onCentralCart: () => _openCentralCart(instanceId, loadedSnapshot),
            onWwPanel: () => _openWwPanel(instanceId, loadedSnapshot),
          ),
      ],
      child: instanceId == null || snapshot == null
          ? const _SplitEmptyDetail(
              icon: Icons.qr_code_scanner_rounded,
              title: 'Crie ou conecte um perfil',
              subtitle:
                  'A loja utiliza o WhatsApp conectado para atender e entregar os produtos.',
            )
          : snapshot.when(
              data: (data) => _buildStore(context, instanceId, data),
              error: (error, _) => _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(botStoreProvider(instanceId)),
              ),
              loading: () => const _LoadingBlock(),
            ),
    );
  }

  Widget _buildStore(
    BuildContext context,
    int instanceId,
    BotStoreSnapshot snapshot,
  ) {
    final pane = ref.watch(storePaneProvider);
    final selectedCategory = snapshot.categories
        .where((category) => category.id == _selectedCategoryId)
        .firstOrNull;
    final selectedProduct = snapshot.products
        .where((product) => product.id == _selectedProductId)
        .firstOrNull;
    final selectedInventory = snapshot.inventory
        .where((item) => item.id == _selectedInventoryId)
        .firstOrNull;
    final selectedWwPanelOffer = snapshot.wwPanelOffers
        .where((offer) => offer.id == _selectedWwPanelOfferId)
        .firstOrNull;
    final selectedWwPanelClient = snapshot.wwPanelClients
        .where((client) => client.id == _selectedWwPanelClientId)
        .firstOrNull;
    final selectedSmmService = snapshot.smmServices
        .where((service) => service.id == _selectedSmmServiceId)
        .firstOrNull;
    final selectedSmmOrder = snapshot.smmOrders
        .where((order) => order.id == _selectedSmmOrderId)
        .firstOrNull;
    final selectedCustomer = snapshot.customers
        .where((customer) => customer.customerJid == _selectedCustomerJid)
        .firstOrNull;
    final inventoryQuery = _inventorySearch.text.trim().toLowerCase();
    final inventoryProducts = snapshot.products
        .where((product) {
          if (inventoryQuery.isEmpty) return true;
          final items = snapshot.inventory.where(
            (item) => item.productId == product.id,
          );
          return product.name.toLowerCase().contains(inventoryQuery) ||
              (product.sku ?? '').toLowerCase().contains(inventoryQuery) ||
              items.any(
                (item) =>
                    item.contentLabel.toLowerCase().contains(inventoryQuery) ||
                    (item.deliveryValue ?? '').toLowerCase().contains(
                      inventoryQuery,
                    ) ||
                    (item.deliveryFileName ?? '').toLowerCase().contains(
                      inventoryQuery,
                    ),
              );
        })
        .toList(growable: false);
    final customerQuery = _customerSearch.text.trim().toLowerCase();
    final smmQuery = _smmSearch.text.trim().toLowerCase();
    final smmCategories =
        snapshot.smmServices
            .map((service) => service.category)
            .where((category) => category.trim().isNotEmpty)
            .toSet()
            .toList(growable: false)
          ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    final smmServices = snapshot.smmServices
        .where((service) {
          if (_selectedSmmCategory != null &&
              service.category != _selectedSmmCategory) {
            return false;
          }
          if (smmQuery.isEmpty) return true;
          return service.name.toLowerCase().contains(smmQuery) ||
              service.category.toLowerCase().contains(smmQuery) ||
              service.serviceType.toLowerCase().contains(smmQuery) ||
              service.providerServiceId.toString().contains(smmQuery);
        })
        .take(200)
        .toList(growable: false);
    final customers = snapshot.customers
        .where((customer) {
          if (customerQuery.isEmpty) return true;
          return customer.displayName.toLowerCase().contains(customerQuery) ||
              (customer.customerPhone ?? '').contains(customerQuery) ||
              customer.customerJid.toLowerCase().contains(customerQuery) ||
              (customer.notes ?? '').toLowerCase().contains(customerQuery);
        })
        .toList(growable: false);
    final common = <Widget>[
      _StorePaneSelector(
        selected: pane,
        onSelected: (value) {
          setState(() {
            _creatingCategory = false;
            _creatingProduct = false;
            _creatingInventory = false;
            _creatingWwPanelOffer = false;
          });
          ref.read(storePaneProvider.notifier).select(value);
        },
      ),
      if (snapshot.centralCartError != null) ...[
        const SizedBox(height: 10),
        _StoreNotice(
          icon: Icons.sync_problem_rounded,
          text: snapshot.centralCartError!,
          danger: true,
        ),
      ],
      const SizedBox(height: 18),
    ];

    final paneChildren = switch (pane) {
      StorePane.categories => <Widget>[
        _StoreSectionHeader(
          title: 'Categorias',
          count: snapshot.categories.length,
          actionLabel: 'Nova',
          onAction: _busyKey == null
              ? () => _startCategoryEditor(instanceId)
              : null,
        ),
        const SizedBox(height: 8),
        if (snapshot.categories.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.category_outlined,
            text: 'Crie categorias para organizar seus produtos.',
          )
        else
          ...snapshot.categories.map(
            (category) => _StoreCategoryTile(
              category: category,
              productCount: snapshot.products
                  .where((product) => product.categoryId == category.id)
                  .length,
              selected:
                  !_creatingCategory && category.id == _selectedCategoryId,
              onTap: () => _selectCategory(instanceId, category),
              onEdit: () => _selectCategory(instanceId, category),
              onDelete: () => _deleteCategory(instanceId, category),
            ),
          ),
      ],
      StorePane.products => <Widget>[
        _StoreSectionHeader(
          title: 'Produtos',
          count: snapshot.products.length,
          actionLabel: 'Novo',
          onAction: _busyKey == null
              ? () => _startProductEditor(instanceId, snapshot)
              : null,
        ),
        const SizedBox(height: 8),
        if (snapshot.products.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.inventory_2_outlined,
            text: 'Nenhum produto cadastrado.',
          )
        else
          ...snapshot.products.map(
            (product) => _StoreProductTile(
              product: product,
              selected: product.id == _selectedProductId,
              onTap: () => _selectProduct(instanceId, snapshot, product),
              onEdit: () => _selectProduct(instanceId, snapshot, product),
              onDelete: () => _deleteProduct(instanceId, product),
            ),
          ),
      ],
      StorePane.inventory => <Widget>[
        _StoreSectionHeader(
          title: 'Estoque por produto',
          count: snapshot.inventory.length,
          actionLabel: 'Abastecer',
          onAction: snapshot.products.isEmpty || _busyKey != null
              ? null
              : () => _startInventoryEditor(instanceId, snapshot, null),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _inventorySearch,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            hintText: 'Buscar produto, e-mail, senha ou conteúdo',
            prefixIcon: Icon(Icons.search_rounded),
            border: OutlineInputBorder(),
            isDense: true,
          ),
        ),
        const SizedBox(height: 10),
        if (snapshot.products.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.inventory_outlined,
            text: 'Cadastre um produto antes de abastecer.',
          )
        else if (snapshot.inventory.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.inventory_2_outlined,
            text: 'O estoque ainda não possui itens.',
          )
        else if (inventoryProducts.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.search_off_rounded,
            text: 'Nenhum item corresponde à busca.',
          )
        else
          ...inventoryProducts.map((product) {
            final items = snapshot.inventory
                .where((item) => item.productId == product.id)
                .toList(growable: false);
            return _StoreInventoryProductTile(
              product: product,
              itemCount: items.length,
              selected: product.id == _selectedProductId,
              onTap: () =>
                  _selectInventoryProduct(instanceId, snapshot, product),
            );
          }),
      ],
      StorePane.iptv => <Widget>[
        if (!snapshot.wwPanel.connected) ...[
          _StoreNotice(
            icon: Icons.link_off_rounded,
            text:
                'Conecte o WWPanel para vender e entregar acessos IPTV automaticamente.',
          ),
          const SizedBox(height: 14),
        ],
        _StoreSectionHeader(
          title: 'Planos IPTV',
          count: snapshot.wwPanelOffers.length,
          actionLabel: 'Novo',
          onAction: snapshot.wwPanel.connected && _busyKey == null
              ? () => _startWwPanelOfferEditor(instanceId, snapshot)
              : null,
        ),
        if (snapshot.wwPanel.connected) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: _busyKey != null
                  ? null
                  : () => _startWwPanelOfferEditor(
                      instanceId,
                      snapshot,
                      trial: true,
                    ),
              icon: const Icon(Icons.science_outlined),
              label: const Text('Novo teste'),
            ),
          ),
        ],
        const SizedBox(height: 8),
        if (snapshot.wwPanelOffers.isEmpty)
          _StoreEmptyLine(
            icon: Icons.live_tv_outlined,
            text: snapshot.wwPanel.connected
                ? 'Crie um plano com preço e validade para exibir na Store.'
                : 'Use a configuração da Store para conectar o WWPanel.',
          )
        else
          ...snapshot.wwPanelOffers.map(
            (offer) => _WwPanelOfferTile(
              offer: offer,
              selected:
                  !_creatingWwPanelOffer && offer.id == _selectedWwPanelOfferId,
              onTap: () => _selectWwPanelOffer(instanceId, snapshot, offer),
              onEdit: () => _selectWwPanelOffer(instanceId, snapshot, offer),
              onDelete: () => _deleteWwPanelOffer(instanceId, offer),
            ),
          ),
        const SizedBox(height: 20),
        _StoreSectionHeader(
          title: 'Acessos vendidos',
          count: snapshot.wwPanelClients.length,
        ),
        const SizedBox(height: 8),
        if (snapshot.wwPanelClients.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.connected_tv_outlined,
            text: 'Os acessos provisionados aparecerão aqui.',
          )
        else
          ...snapshot.wwPanelClients.map(
            (client) => _WwPanelClientTile(
              client: client,
              selected: client.id == _selectedWwPanelClientId,
              onTap: () => _selectWwPanelClient(instanceId, snapshot, client),
            ),
          ),
      ],
      StorePane.smm => <Widget>[
        if (!snapshot.smm.connected) ...[
          const _StoreNotice(
            icon: Icons.link_off_rounded,
            text:
                'Conecte sua API SMMHype para importar o catálogo e vender em reais.',
          ),
          const SizedBox(height: 12),
        ],
        _SmmConnectionSummary(
          settings: snapshot.smm,
          serviceCount: snapshot.smmServices.length,
          enabledCount: snapshot.smmServices
              .where((service) => service.enabled)
              .length,
          busy: _busyKey != null,
          onConfigure: () => _openSmmSettings(instanceId, snapshot),
          onSync: snapshot.smm.connected ? () => _syncSmm(instanceId) : null,
        ),
        const SizedBox(height: 16),
        _StoreSectionHeader(
          title: 'Serviços SMM',
          count: snapshot.smmServices.length,
          actionLabel: 'Adicionar',
          onAction: snapshot.smm.connected && _busyKey == null
              ? () => _openSmmCatalogImporter(
                  instanceId,
                  snapshot.smmCatalogCount,
                )
              : null,
        ),
        if (snapshot.smmServices.isNotEmpty) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              TextButton.icon(
                onPressed: _busyKey != null
                    ? null
                    : () => setState(() {
                        _selectingSmmServices = !_selectingSmmServices;
                        if (!_selectingSmmServices) {
                          _selectedSmmServiceIds.clear();
                        }
                      }),
                icon: Icon(
                  _selectingSmmServices
                      ? Icons.close_rounded
                      : Icons.library_add_check_outlined,
                  size: 19,
                ),
                label: Text(
                  _selectingSmmServices ? 'Cancelar seleção' : 'Selecionar',
                ),
              ),
              if (_selectingSmmServices) ...[
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '${_selectedSmmServiceIds.length} selecionado(s)',
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      color: WaTheme.of(context).textMuted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Selecionar resultados exibidos',
                  onPressed: _busyKey != null
                      ? null
                      : () => setState(() {
                          _selectedSmmServiceIds.addAll(
                            smmServices.map((service) => service.id),
                          );
                        }),
                  icon: const Icon(Icons.select_all_rounded),
                ),
                FilledButton.tonalIcon(
                  onPressed:
                      _busyKey == null && _selectedSmmServiceIds.isNotEmpty
                      ? () => _deleteSelectedSmmServices(instanceId)
                      : null,
                  icon: const Icon(Icons.delete_outline_rounded, size: 19),
                  label: const Text('Apagar'),
                ),
              ],
            ],
          ),
        ],
        const SizedBox(height: 10),
        TextField(
          controller: _smmSearch,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            hintText: 'Buscar serviço, categoria, tipo ou ID',
            prefixIcon: Icon(Icons.search_rounded),
            border: OutlineInputBorder(),
            isDense: true,
          ),
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<String?>(
          initialValue: _selectedSmmCategory,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: 'Categoria',
            border: OutlineInputBorder(),
            isDense: true,
          ),
          items: [
            const DropdownMenuItem<String?>(
              value: null,
              child: Text('Todas as categorias'),
            ),
            ...smmCategories.map(
              (category) => DropdownMenuItem<String?>(
                value: category,
                child: Text(
                  category,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
          onChanged: (value) => setState(() => _selectedSmmCategory = value),
        ),
        if (snapshot.smm.connected && _selectedSmmCategory != null) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busyKey == null
                      ? () => _bulkSmmCategory(
                          instanceId,
                          _selectedSmmCategory!,
                          true,
                        )
                      : null,
                  icon: const Icon(Icons.check_circle_outline_rounded),
                  label: const Text('Ativar categoria'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busyKey == null
                      ? () => _bulkSmmCategory(
                          instanceId,
                          _selectedSmmCategory!,
                          false,
                        )
                      : null,
                  icon: const Icon(Icons.pause_circle_outline_rounded),
                  label: const Text('Pausar categoria'),
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: 10),
        if (snapshot.smmServices.isEmpty)
          _StoreEmptyLine(
            icon: Icons.rocket_launch_outlined,
            text: snapshot.smm.connected
                ? 'Sincronize o catálogo para listar os serviços.'
                : 'A API key fica criptografada e não aparece no aplicativo.',
          )
        else if (smmServices.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.search_off_rounded,
            text: 'Nenhum serviço corresponde ao filtro.',
          )
        else ...[
          ...smmServices.map(
            (service) => _SmmServiceTile(
              service: service,
              selected: service.id == _selectedSmmServiceId,
              selectionMode: _selectingSmmServices,
              checked: _selectedSmmServiceIds.contains(service.id),
              busy: _busyKey != null,
              onTap: () => _selectSmmService(instanceId, snapshot, service),
              onLongPress: () => _toggleSmmServiceSelection(service.id),
              onSelectionToggle: () => _toggleSmmServiceSelection(service.id),
              onToggle: (enabled) =>
                  _quickToggleSmmService(instanceId, service, enabled),
              onDelete: () => _deleteSmmService(instanceId, service),
            ),
          ),
          if (snapshot.smmServices.length > smmServices.length)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Mostrando até 200 resultados. Use a busca ou a categoria para refinar.',
                style: TextStyle(
                  color: WaTheme.of(context).textMuted,
                  fontSize: 12,
                ),
              ),
            ),
        ],
        const SizedBox(height: 22),
        _StoreSectionHeader(
          title: 'Pedidos SMM',
          count: snapshot.smmOrders.length,
        ),
        const SizedBox(height: 8),
        if (snapshot.smmOrders.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.receipt_long_outlined,
            text: 'Os pedidos pagos e provisionados aparecerão aqui.',
          )
        else
          ...snapshot.smmOrders
              .take(50)
              .map(
                (order) => _SmmOrderTile(
                  order: order,
                  selected: order.id == _selectedSmmOrderId,
                  onTap: () => _selectSmmOrder(instanceId, snapshot, order),
                ),
              ),
      ],
      StorePane.customers => <Widget>[
        _StoreSectionHeader(
          title: 'Clientes',
          count: snapshot.customers.length,
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _customerSearch,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            hintText: 'Buscar nome, telefone ou observação',
            prefixIcon: Icon(Icons.search_rounded),
            border: OutlineInputBorder(),
            isDense: true,
          ),
        ),
        const SizedBox(height: 10),
        if (customers.isEmpty)
          const _StoreEmptyLine(
            icon: Icons.people_outline_rounded,
            text: 'Os clientes aparecem após a primeira compra.',
          )
        else
          ...customers.map(
            (customer) => _StoreCustomerTile(
              customer: customer,
              selected: customer.customerJid == _selectedCustomerJid,
              onTap: () => _selectStoreCustomer(instanceId, snapshot, customer),
              onEdit: () => _openCustomerEditor(instanceId, snapshot, customer),
            ),
          ),
      ],
    };

    final list = ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [...common, ...paneChildren],
    );

    return _ManagementSplitSurface(
      list: list,
      detail: switch (pane) {
        StorePane.products =>
          _creatingProduct || selectedProduct != null
              ? _StoreProductDialog(
                  key: ValueKey(
                    _creatingProduct
                        ? 'new-product'
                        : 'product-${selectedProduct!.id}-${selectedProduct.name}-${selectedProduct.priceCents}',
                  ),
                  categories: snapshot.categories,
                  product: _creatingProduct ? null : selectedProduct,
                  embedded: true,
                  busy: _busyKey != null,
                  onCancel: _clearStoreEditor,
                  onSave: (draft) => _saveProductDraft(instanceId, draft),
                )
              : _StorePreviewPane(
                  snapshot: snapshot,
                  product: null,
                  onEditProduct: () =>
                      _startProductEditor(instanceId, snapshot),
                ),
        StorePane.inventory =>
          _creatingInventory || selectedInventory != null
              ? _StoreInventoryDialog(
                  key: ValueKey(
                    _creatingInventory
                        ? 'new-inventory'
                        : 'inventory-${selectedInventory!.id}-${selectedInventory.status}-${selectedInventory.deliveryValue}',
                  ),
                  products: snapshot.products,
                  item: _creatingInventory ? null : selectedInventory,
                  preferredProductId: _creatingInventory
                      ? null
                      : selectedInventory?.productId,
                  embedded: true,
                  busy: _busyKey != null,
                  onCancel: _clearStoreEditor,
                  onSave: (draft) => _saveInventoryDraft(instanceId, draft),
                )
              : selectedProduct == null
              ? const _SplitEmptyDetail(
                  icon: Icons.inventory_2_outlined,
                  title: 'Estoque organizado',
                  subtitle:
                      'Selecione um produto para ver e editar os itens disponíveis.',
                )
              : _StoreInventoryProductDetail(
                  product: selectedProduct,
                  items: snapshot.inventory
                      .where((item) => item.productId == selectedProduct.id)
                      .toList(growable: false),
                  query: inventoryQuery,
                  onAdd: () => _startInventoryEditor(
                    instanceId,
                    snapshot,
                    selectedProduct,
                  ),
                  onOpen: (item) =>
                      _selectInventory(instanceId, snapshot, item),
                  onStatus: (item) => _setInventoryStatus(instanceId, item),
                  onDelete: (item) => _deleteInventory(instanceId, item),
                ),
        StorePane.categories =>
          _creatingCategory || selectedCategory != null
              ? _StoreCategoryDialog(
                  key: ValueKey(
                    _creatingCategory
                        ? 'new-category'
                        : 'category-${selectedCategory!.id}-${selectedCategory.name}-${selectedCategory.position}',
                  ),
                  category: _creatingCategory ? null : selectedCategory,
                  embedded: true,
                  busy: _busyKey != null,
                  onCancel: _clearStoreEditor,
                  onSave: (draft) => _saveCategoryDraft(instanceId, draft),
                )
              : const _SplitEmptyDetail(
                  icon: Icons.category_outlined,
                  title: 'Organize o catálogo',
                  subtitle:
                      'Selecione uma categoria para editar ou crie uma nova.',
                ),
        StorePane.iptv =>
          _creatingWwPanelOffer || selectedWwPanelOffer != null
              ? _WwPanelOfferDialog(
                  key: ValueKey(
                    _creatingWwPanelOffer
                        ? 'new-wwpanel-offer'
                        : 'wwpanel-offer-${selectedWwPanelOffer!.id}-${selectedWwPanelOffer.name}-${selectedWwPanelOffer.priceCents}',
                  ),
                  settings: snapshot.wwPanel,
                  offer: _creatingWwPanelOffer ? null : selectedWwPanelOffer,
                  startAsTrial: _creatingWwPanelOffer && _creatingWwPanelTrial,
                  embedded: true,
                  busy: _busyKey != null,
                  onCancel: _clearStoreEditor,
                  onSave: (draft) => _saveWwPanelOfferDraft(instanceId, draft),
                )
              : selectedWwPanelClient != null
              ? _WwPanelClientDetail(
                  client: selectedWwPanelClient,
                  settings: snapshot.wwPanel,
                  busy: _busyKey != null,
                  onRevealPassword: () => ref
                      .read(apiClientProvider)
                      .revealBotStoreWwPanelPassword(
                        instanceId,
                        selectedWwPanelClient.id,
                      ),
                  onAction: (action) => _runWwPanelClientAction(
                    instanceId,
                    selectedWwPanelClient,
                    snapshot.wwPanel,
                    action,
                  ),
                )
              : _SplitEmptyDetail(
                  icon: Icons.live_tv_outlined,
                  title: snapshot.wwPanel.connected
                      ? 'Venda IPTV pela Store'
                      : 'Conecte o WWPanel',
                  subtitle: snapshot.wwPanel.connected
                      ? 'Crie planos comerciais ou selecione um acesso vendido para gerenciar.'
                      : 'A chave fica protegida no servidor e nunca é exposta no aplicativo.',
                ),
        StorePane.smm =>
          selectedSmmOrder != null
              ? _SmmOrderDetail(
                  order: selectedSmmOrder,
                  service: snapshot.smmServices
                      .where(
                        (service) => service.id == selectedSmmOrder.serviceId,
                      )
                      .firstOrNull,
                  busy: _busyKey != null,
                  onSync: () => _manageSmmOrder(
                    instanceId,
                    selectedSmmOrder,
                    'sync_smm_order',
                  ),
                  onRefill: () => _manageSmmOrder(
                    instanceId,
                    selectedSmmOrder,
                    selectedSmmOrder.refillId == null
                        ? 'refill_smm_order'
                        : 'sync_smm_refill',
                  ),
                  onCancel: () => _manageSmmOrder(
                    instanceId,
                    selectedSmmOrder,
                    'cancel_smm_order',
                  ),
                )
              : selectedSmmService != null
              ? _SmmServiceDetail(
                  service: selectedSmmService,
                  busy: _busyKey != null,
                  onSave: (draft) =>
                      _saveSmmService(instanceId, selectedSmmService, draft),
                  onDelete: () =>
                      _deleteSmmService(instanceId, selectedSmmService),
                )
              : _SplitEmptyDetail(
                  icon: Icons.rocket_launch_outlined,
                  title: snapshot.smm.connected
                      ? 'Venda serviços SMM'
                      : 'Conecte a SMMHype',
                  subtitle: snapshot.smm.connected
                      ? 'Selecione um serviço para definir preço e disponibilidade, ou abra um pedido para acompanhar.'
                      : 'O catálogo, a conversão para reais e a margem ficam centralizados nesta tela.',
                ),
        StorePane.customers =>
          selectedCustomer == null
              ? const _SplitEmptyDetail(
                  icon: Icons.support_agent_rounded,
                  title: 'Atendimento da loja',
                  subtitle:
                      'Selecione um cliente para abrir a conversa e acessar as ações da venda.',
                )
              : ChatScreen(
                  thread: _threadForStoreCustomer(instanceId, selectedCustomer),
                ),
      },
    );
  }

  Future<void> _selectInstance() async {
    final selected = await showBotAdminBottomSheet<int>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 20),
        children: [
          const ListTile(
            title: Text(
              'Perfil da loja',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
          ),
          ...widget.instances.map(
            (instance) => ListTile(
              leading: CircleAvatar(
                backgroundImage: instance.avatarUrl?.trim().isNotEmpty == true
                    ? NetworkImage(instance.avatarUrl!)
                    : null,
                child: instance.avatarUrl?.trim().isNotEmpty == true
                    ? null
                    : const Icon(Icons.storefront_outlined),
              ),
              title: Text(instance.name),
              subtitle: Text(instance.phoneNumber ?? instance.statusLabel),
              trailing: instance.id == _activeInstanceId
                  ? const Icon(Icons.check_circle_rounded)
                  : null,
              onTap: () => Navigator.of(context).pop(instance.id),
            ),
          ),
        ],
      ),
    );
    if (selected == null || !mounted) return;
    setState(() {
      _instanceId = selected;
      _selectedCategoryId = null;
      _selectedProductId = null;
      _selectedInventoryId = null;
      _selectedWwPanelOfferId = null;
      _selectedWwPanelClientId = null;
      _selectedSmmServiceId = null;
      _selectedSmmOrderId = null;
      _selectedSmmCategory = null;
      _selectedSmmServiceIds.clear();
      _selectingSmmServices = false;
      _selectedCustomerJid = null;
      _creatingCategory = false;
      _creatingProduct = false;
      _creatingInventory = false;
      _creatingWwPanelOffer = false;
      _creatingWwPanelTrial = false;
    });
    _smmSearch.clear();
  }

  bool get _desktopEditor => MediaQuery.sizeOf(context).width >= 900;

  void _clearStoreEditor() {
    if (!mounted) return;
    setState(() {
      _creatingCategory = false;
      _creatingProduct = false;
      _creatingInventory = false;
      _creatingWwPanelOffer = false;
      _creatingWwPanelTrial = false;
    });
  }

  void _startCategoryEditor(int instanceId) {
    if (!_desktopEditor) {
      _openCategoryEditor(instanceId);
      return;
    }
    setState(() {
      _selectedCategoryId = null;
      _creatingCategory = true;
    });
  }

  void _selectCategory(int instanceId, BotStoreCategory category) {
    if (!_desktopEditor) {
      _openCategoryEditor(instanceId, category);
      return;
    }
    setState(() {
      _selectedCategoryId = category.id;
      _creatingCategory = false;
    });
  }

  void _startProductEditor(int instanceId, BotStoreSnapshot snapshot) {
    if (!_desktopEditor) {
      _openProductEditor(instanceId, snapshot);
      return;
    }
    setState(() {
      _selectedProductId = null;
      _creatingProduct = true;
    });
  }

  void _selectProduct(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreProduct product,
  ) {
    if (!_desktopEditor) {
      _openProductEditor(instanceId, snapshot, product);
      return;
    }
    setState(() {
      _selectedProductId = product.id;
      _creatingProduct = false;
    });
  }

  void _selectInventoryProduct(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreProduct product,
  ) {
    if (!_desktopEditor) {
      _openInventoryProduct(instanceId, snapshot, product);
      return;
    }
    setState(() {
      _selectedProductId = product.id;
      _selectedInventoryId = null;
      _creatingInventory = false;
    });
  }

  Future<void> _openInventoryProduct(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreProduct product,
  ) async {
    final items = snapshot.inventory
        .where((item) => item.productId == product.id)
        .toList(growable: false);
    await showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => FractionallySizedBox(
        heightFactor: 0.92,
        child: _StoreInventoryProductDetail(
          product: product,
          items: items,
          query: _inventorySearch.text.trim().toLowerCase(),
          onAdd: () {
            Navigator.of(sheetContext).pop();
            _startInventoryEditor(instanceId, snapshot, product);
          },
          onOpen: (item) {
            Navigator.of(sheetContext).pop();
            _selectInventory(instanceId, snapshot, item);
          },
          onStatus: (item) {
            Navigator.of(sheetContext).pop();
            _setInventoryStatus(instanceId, item);
          },
          onDelete: (item) {
            Navigator.of(sheetContext).pop();
            _deleteInventory(instanceId, item);
          },
        ),
      ),
    );
  }

  ConversationThread _threadForStoreCustomer(
    int instanceId,
    BotStoreCustomer customer,
  ) {
    final phone = (customer.customerPhone ?? '').replaceAll(
      RegExp(r'[^0-9]'),
      '',
    );
    for (final thread in widget.threads) {
      if (thread.instanceId != instanceId || !thread.isContact) continue;
      final threadPhone = (thread.phone ?? thread.chatJid).replaceAll(
        RegExp(r'[^0-9]'),
        '',
      );
      if (thread.chatJid == customer.customerJid ||
          (phone.isNotEmpty && threadPhone.endsWith(phone))) {
        return thread;
      }
    }
    return ConversationThread(
      instanceId: instanceId,
      chatJid: customer.customerJid,
      title: customer.displayName,
      lastMessage: '',
      lastActivity: customer.lastOrderAt ?? customer.updatedAt,
      unreadCount: 0,
      phone: customer.customerPhone,
      avatarUrl: customer.avatarUrl,
      chatType: 'contact',
    );
  }

  void _selectStoreCustomer(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreCustomer customer,
  ) {
    final thread = _threadForStoreCustomer(instanceId, customer);
    if (!_desktopEditor && widget.onOpenConversation != null) {
      widget.onOpenConversation!(thread);
      return;
    }
    setState(() => _selectedCustomerJid = customer.customerJid);
  }

  Future<void> _openCustomerEditor(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreCustomer customer,
  ) async {
    final draft = await showDialog<_StoreCustomerDraft>(
      context: context,
      builder: (context) => _StoreCustomerDialog(customer: customer),
    );
    if (draft == null) return;
    await _runAction(instanceId, 'update_customer', {
      'customer': draft.toJson(),
    }, success: 'Cliente atualizado.');
  }

  void _startInventoryEditor(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreProduct? preferredProduct,
  ) {
    if (!_desktopEditor) {
      _openInventoryEditor(instanceId, snapshot, null, preferredProduct);
      return;
    }
    setState(() {
      _selectedProductId =
          preferredProduct?.id ??
          _selectedProductId ??
          snapshot.products.first.id;
      _selectedInventoryId = null;
      _creatingInventory = true;
    });
  }

  void _selectInventory(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreInventoryItem item,
  ) {
    if (!_desktopEditor) {
      _openInventoryEditor(instanceId, snapshot, item);
      return;
    }
    setState(() {
      _selectedProductId = item.productId;
      _selectedInventoryId = item.id;
      _creatingInventory = false;
    });
  }

  void _selectSmmService(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreSmmService service,
  ) {
    if (_desktopEditor) {
      setState(() {
        _selectedSmmServiceId = service.id;
        _selectedSmmOrderId = null;
      });
      return;
    }
    showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => FractionallySizedBox(
        heightFactor: .92,
        child: _SmmServiceDetail(
          service: service,
          busy: _busyKey != null,
          onSave: (draft) async {
            Navigator.of(sheetContext).pop();
            await _saveSmmService(instanceId, service, draft);
          },
          onDelete: () async {
            Navigator.of(sheetContext).pop();
            await _deleteSmmService(instanceId, service);
          },
        ),
      ),
    );
  }

  void _selectSmmOrder(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreSmmOrder order,
  ) {
    final service = snapshot.smmServices
        .where((item) => item.id == order.serviceId)
        .firstOrNull;
    if (_desktopEditor) {
      setState(() {
        _selectedSmmOrderId = order.id;
        _selectedSmmServiceId = null;
      });
      return;
    }
    showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => FractionallySizedBox(
        heightFactor: .9,
        child: _SmmOrderDetail(
          order: order,
          service: service,
          busy: _busyKey != null,
          onSync: () async {
            Navigator.of(sheetContext).pop();
            await _manageSmmOrder(instanceId, order, 'sync_smm_order');
          },
          onRefill: () async {
            Navigator.of(sheetContext).pop();
            await _manageSmmOrder(
              instanceId,
              order,
              order.refillId == null ? 'refill_smm_order' : 'sync_smm_refill',
            );
          },
          onCancel: () async {
            Navigator.of(sheetContext).pop();
            await _manageSmmOrder(instanceId, order, 'cancel_smm_order');
          },
        ),
      ),
    );
  }

  Future<void> _openSmmSettings(
    int instanceId,
    BotStoreSnapshot snapshot,
  ) async {
    final draft = await showDialog<_SmmSettingsDraft>(
      context: context,
      builder: (context) => _SmmSettingsDialog(settings: snapshot.smm),
    );
    if (draft == null) return;
    if (draft.disconnect) {
      if (!await _confirmDelete('Desconectar a SMMHype desta Store?')) return;
      await _runAction(
        instanceId,
        'disconnect_smm',
        const {},
        success: 'Painel SMM desconectado.',
      );
      return;
    }
    await _runAction(
      instanceId,
      'connect_smm',
      {'smm': draft.toJson()},
      success: snapshot.smm.connected
          ? 'Configuração SMM atualizada.'
          : 'SMMHype conectada e catálogo sincronizado.',
    );
  }

  Future<void> _syncSmm(int instanceId) =>
      _runAction(instanceId, 'sync_smm', const {
        'smm': {'enableNewServices': false},
      }, success: 'Saldo, câmbio e catálogo SMM sincronizados.');

  Future<void> _openSmmCatalogImporter(int instanceId, int catalogCount) async {
    final providerIds = await showDialog<List<int>>(
      context: context,
      builder: (context) => _SmmCatalogImportDialog(
        catalogCount: catalogCount,
        onSearch: (query) => ref
            .read(apiClientProvider)
            .searchBotStoreSmmCatalog(instanceId, query: query),
      ),
    );
    if (providerIds == null || providerIds.isEmpty) return;
    await _runAction(
      instanceId,
      'import_smm_services',
      {
        'services': {'providerServiceIds': providerIds},
      },
      success: '${providerIds.length} serviço(s) adicionado(s) à Store.',
    );
  }

  Future<void> _deleteSmmService(
    int instanceId,
    BotStoreSmmService service,
  ) async {
    if (!await _confirmDelete(
      'Remover "${service.name}" da Store? Pedidos antigos serão preservados.',
    )) {
      return;
    }
    final updated = await _runAction(instanceId, 'delete_smm_service', {
      'serviceId': service.id,
    }, success: 'Serviço removido da Store.');
    if (updated != null && mounted) {
      setState(() => _selectedSmmServiceId = null);
    }
  }

  void _toggleSmmServiceSelection(int serviceId) {
    setState(() {
      _selectingSmmServices = true;
      if (!_selectedSmmServiceIds.add(serviceId)) {
        _selectedSmmServiceIds.remove(serviceId);
      }
    });
  }

  Future<void> _deleteSelectedSmmServices(int instanceId) async {
    final ids = _selectedSmmServiceIds.toList(growable: false);
    if (ids.isEmpty) return;
    if (!await _confirmDelete(
      'Remover ${ids.length} serviço(s) da Store? Pedidos antigos serão preservados.',
    )) {
      return;
    }
    final updated = await _runAction(
      instanceId,
      'delete_smm_services',
      {'serviceIds': ids},
      success: '${ids.length} serviço(s) removido(s) da Store.',
    );
    if (updated != null && mounted) {
      setState(() {
        if (_selectedSmmServiceId != null &&
            _selectedSmmServiceIds.contains(_selectedSmmServiceId)) {
          _selectedSmmServiceId = null;
        }
        _selectedSmmServiceIds.clear();
        _selectingSmmServices = false;
      });
    }
  }

  Future<void> _bulkSmmCategory(
    int instanceId,
    String category,
    bool enabled,
  ) => _runAction(
    instanceId,
    'bulk_update_smm_services',
    {
      'services': {'category': category, 'enabled': enabled},
    },
    success: enabled ? 'Categoria SMM ativada.' : 'Categoria SMM pausada.',
  );

  Future<void> _quickToggleSmmService(
    int instanceId,
    BotStoreSmmService service,
    bool enabled,
  ) => _runAction(
    instanceId,
    'save_smm_service',
    {
      'service': {
        'serviceId': service.id,
        'enabled': enabled,
        'position': service.position,
        'customSaleRateCents': service.customSaleRateCents,
      },
    },
    success: enabled ? 'Serviço SMM ativado.' : 'Serviço SMM pausado.',
  );

  Future<void> _saveSmmService(
    int instanceId,
    BotStoreSmmService service,
    _SmmServiceDraft draft,
  ) async {
    final updated = await _runAction(instanceId, 'save_smm_service', {
      'service': {'serviceId': service.id, ...draft.toJson()},
    }, success: 'Serviço SMM atualizado.');
    if (updated != null && mounted) {
      setState(() => _selectedSmmServiceId = service.id);
    }
  }

  Future<void> _manageSmmOrder(
    int instanceId,
    BotStoreSmmOrder order,
    String action,
  ) async {
    if (action == 'cancel_smm_order' &&
        !await _confirmDelete('Solicitar cancelamento deste pedido SMM?')) {
      return;
    }
    final label = switch (action) {
      'sync_smm_order' => 'Status do pedido atualizado.',
      'refill_smm_order' => 'Reposição solicitada.',
      'sync_smm_refill' => 'Status da reposição atualizado.',
      'cancel_smm_order' => 'Cancelamento solicitado.',
      _ => 'Pedido SMM atualizado.',
    };
    await _runAction(instanceId, action, {
      'order': {'smmOrderId': order.id},
    }, success: label);
  }

  Future<void> _saveStore(
    int instanceId,
    Map<String, Object?> payload, {
    required String success,
  }) async {
    setState(() => _busyKey = 'store');
    try {
      await ref.read(apiClientProvider).saveBotStore(instanceId, payload);
      ref.invalidate(botStoreProvider(instanceId));
      if (mounted) showSuccessToast(context, success);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  Future<void> _openStoreSettings(
    int instanceId,
    BotStoreSnapshot snapshot,
  ) async {
    final draft = await showDialog<_StoreSettingsDraft>(
      context: context,
      builder: (context) => _StoreSettingsDialog(store: snapshot.store),
    );
    if (draft == null) return;
    await _saveStore(
      instanceId,
      draft.toJson(),
      success: 'Configurações da loja salvas.',
    );
  }

  Future<void> _openCentralCart(
    int instanceId,
    BotStoreSnapshot snapshot,
  ) async {
    final action = await showDialog<_CentralCartDraft>(
      context: context,
      builder: (context) => _CentralCartDialog(store: snapshot.store),
    );
    if (action == null) return;
    setState(() => _busyKey = 'central-cart');
    try {
      if (action.disconnect) {
        await ref
            .read(apiClientProvider)
            .runBotStoreAction(instanceId, 'disconnect_central_cart');
      } else {
        await ref
            .read(apiClientProvider)
            .runBotStoreAction(
              instanceId,
              action.syncOnly ? 'sync_central_cart' : 'connect_central_cart',
              payload: {'centralCart': action.toJson()},
            );
      }
      ref.invalidate(botStoreProvider(instanceId));
      if (mounted) {
        showSuccessToast(
          context,
          action.disconnect
              ? 'Central Cart desconectada.'
              : 'Central Cart sincronizada.',
        );
      }
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  Future<void> _openWwPanel(int instanceId, BotStoreSnapshot snapshot) async {
    final draft = await showDialog<_WwPanelSettingsDraft>(
      context: context,
      builder: (context) => _WwPanelSettingsDialog(
        settings: snapshot.wwPanel,
        busy: _busyKey != null,
      ),
    );
    if (draft == null) return;
    if (draft.disconnect) {
      if (!await _confirmDelete('Desconectar o WWPanel desta Store?')) return;
      await _runAction(
        instanceId,
        'disconnect_wwpanel',
        const {},
        success: 'WWPanel desconectado.',
      );
      return;
    }
    await _runAction(
      instanceId,
      draft.syncOnly ? 'sync_wwpanel' : 'connect_wwpanel',
      {'wwPanel': draft.toJson()},
      success: draft.syncOnly
          ? 'Conta WWPanel sincronizada.'
          : 'WWPanel conectado à Store.',
    );
  }

  void _startWwPanelOfferEditor(
    int instanceId,
    BotStoreSnapshot snapshot, {
    bool trial = false,
  }) {
    if (!_desktopEditor) {
      _openWwPanelOfferEditor(instanceId, snapshot, trial: trial);
      return;
    }
    setState(() {
      _selectedWwPanelOfferId = null;
      _selectedWwPanelClientId = null;
      _creatingWwPanelOffer = true;
      _creatingWwPanelTrial = trial;
    });
  }

  void _selectWwPanelOffer(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreWwPanelOffer offer,
  ) {
    if (!_desktopEditor) {
      _openWwPanelOfferEditor(instanceId, snapshot, offer: offer);
      return;
    }
    setState(() {
      _selectedWwPanelOfferId = offer.id;
      _selectedWwPanelClientId = null;
      _creatingWwPanelOffer = false;
      _creatingWwPanelTrial = false;
    });
  }

  Future<void> _openWwPanelOfferEditor(
    int instanceId,
    BotStoreSnapshot snapshot, {
    BotStoreWwPanelOffer? offer,
    bool trial = false,
  }) async {
    final draft = await showDialog<_WwPanelOfferDraft>(
      context: context,
      builder: (context) => _WwPanelOfferDialog(
        settings: snapshot.wwPanel,
        offer: offer,
        startAsTrial: trial,
      ),
    );
    if (draft == null) return;
    await _saveWwPanelOfferDraft(instanceId, draft);
  }

  Future<void> _saveWwPanelOfferDraft(
    int instanceId,
    _WwPanelOfferDraft draft,
  ) async {
    final updated = await _runAction(
      instanceId,
      'save_wwpanel_offer',
      {'offer': draft.toJson()},
      success: draft.id == null
          ? 'Plano IPTV criado.'
          : 'Plano IPTV atualizado.',
    );
    if (updated == null || !mounted) return;
    final selectedId =
        draft.id ??
        updated.wwPanelOffers
            .where((offer) => offer.name == draft.name)
            .fold<int?>(null, (latest, offer) {
              if (latest == null || offer.id > latest) return offer.id;
              return latest;
            });
    setState(() {
      _creatingWwPanelOffer = false;
      _creatingWwPanelTrial = false;
      _selectedWwPanelOfferId = selectedId;
      _selectedWwPanelClientId = null;
    });
  }

  Future<void> _deleteWwPanelOffer(
    int instanceId,
    BotStoreWwPanelOffer offer,
  ) async {
    if (!await _confirmDelete('Excluir o plano ${offer.name}?')) return;
    await _runAction(instanceId, 'delete_wwpanel_offer', {
      'offerId': offer.id,
    }, success: 'Plano IPTV removido.');
    if (mounted && _selectedWwPanelOfferId == offer.id) {
      setState(() => _selectedWwPanelOfferId = null);
    }
  }

  void _selectWwPanelClient(
    int instanceId,
    BotStoreSnapshot snapshot,
    BotStoreWwPanelClient client,
  ) {
    if (_desktopEditor) {
      setState(() {
        _selectedWwPanelClientId = client.id;
        _selectedWwPanelOfferId = null;
        _creatingWwPanelOffer = false;
      });
      return;
    }
    showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => FractionallySizedBox(
        heightFactor: .88,
        child: _WwPanelClientDetail(
          client: client,
          settings: snapshot.wwPanel,
          busy: _busyKey != null,
          onRevealPassword: () => ref
              .read(apiClientProvider)
              .revealBotStoreWwPanelPassword(instanceId, client.id),
          onAction: (action) {
            Navigator.of(sheetContext).pop();
            unawaited(
              _runWwPanelClientAction(
                instanceId,
                client,
                snapshot.wwPanel,
                action,
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _runWwPanelClientAction(
    int instanceId,
    BotStoreWwPanelClient client,
    BotStoreWwPanelSettings settings,
    String action,
  ) async {
    if (action == 'delete_wwpanel_client') {
      if (!await _confirmDelete('Excluir o acesso ${client.username}?')) return;
      await _runAction(instanceId, action, {
        'client': {'clientId': client.id},
      }, success: 'Acesso removido do WWPanel.');
      return;
    }
    final draft = await showDialog<_WwPanelClientActionDraft>(
      context: context,
      builder: (context) => _WwPanelClientActionDialog(
        action: action,
        client: client,
        settings: settings,
      ),
    );
    if (draft == null) return;
    await _runAction(instanceId, action, {
      'client': {'clientId': client.id, ...draft.payload},
    }, success: draft.successMessage);
  }

  Future<void> _openCategoryEditor(
    int instanceId, [
    BotStoreCategory? category,
  ]) async {
    final draft = await showDialog<_StoreCategoryDraft>(
      context: context,
      builder: (context) => _StoreCategoryDialog(category: category),
    );
    if (draft == null) return;
    await _runAction(
      instanceId,
      'save_category',
      {'category': draft.toJson()},
      success: category == null ? 'Categoria criada.' : 'Categoria atualizada.',
    );
  }

  Future<void> _openProductEditor(
    int instanceId,
    BotStoreSnapshot snapshot, [
    BotStoreProduct? product,
  ]) async {
    final draft = await showDialog<_StoreProductDraft>(
      context: context,
      builder: (context) => _StoreProductDialog(
        product: product,
        categories: snapshot.categories,
      ),
    );
    if (draft == null) return;
    await _runAction(
      instanceId,
      'save_product',
      {'product': draft.toJson()},
      success: product == null ? 'Produto criado.' : 'Produto atualizado.',
    );
  }

  Future<void> _openInventoryEditor(
    int instanceId,
    BotStoreSnapshot snapshot, [
    BotStoreInventoryItem? item,
    BotStoreProduct? preferredProduct,
  ]) async {
    final draft = await showDialog<_StoreInventoryDraft>(
      context: context,
      builder: (context) => _StoreInventoryDialog(
        products: snapshot.products,
        item: item,
        preferredProductId:
            item?.productId ?? preferredProduct?.id ?? _selectedProductId,
      ),
    );
    if (draft == null) return;
    await _runAction(
      instanceId,
      item == null ? 'save_inventory' : 'update_inventory',
      {'inventory': draft.toJson()},
      success: item == null
          ? '${draft.quantityLabel} adicionada(s) ao estoque.'
          : 'Item de estoque atualizado.',
    );
    if (mounted) {
      setState(() {
        _selectedProductId = draft.productId;
        _selectedInventoryId = item?.id;
      });
    }
  }

  Future<void> _saveCategoryDraft(
    int instanceId,
    _StoreCategoryDraft draft,
  ) async {
    final updated = await _runAction(
      instanceId,
      'save_category',
      {'category': draft.toJson()},
      success: draft.id == null ? 'Categoria criada.' : 'Categoria atualizada.',
    );
    if (updated == null || !mounted) return;
    final selectedId =
        draft.id ??
        updated.categories
            .where((category) => category.name == draft.name)
            .fold<int?>(null, (latest, category) {
              if (latest == null || category.id > latest) return category.id;
              return latest;
            });
    setState(() {
      _creatingCategory = false;
      _selectedCategoryId = selectedId;
    });
  }

  Future<void> _saveProductDraft(
    int instanceId,
    _StoreProductDraft draft,
  ) async {
    final updated = await _runAction(
      instanceId,
      'save_product',
      {'product': draft.toJson()},
      success: draft.id == null ? 'Produto criado.' : 'Produto atualizado.',
    );
    if (updated == null || !mounted) return;
    final selectedId =
        draft.id ??
        updated.products
            .where((product) => product.name == draft.name)
            .fold<int?>(null, (latest, product) {
              if (latest == null || product.id > latest) return product.id;
              return latest;
            });
    setState(() {
      _creatingProduct = false;
      _selectedProductId = selectedId;
    });
  }

  Future<void> _saveInventoryDraft(
    int instanceId,
    _StoreInventoryDraft draft,
  ) async {
    final updated = await _runAction(
      instanceId,
      draft.id == null ? 'save_inventory' : 'update_inventory',
      {'inventory': draft.toJson()},
      success: draft.id == null
          ? '${draft.quantityLabel} adicionada(s) ao estoque.'
          : 'Item de estoque atualizado.',
    );
    if (updated == null || !mounted) return;
    setState(() {
      _creatingInventory = false;
      _selectedProductId = draft.productId;
      _selectedInventoryId = draft.id;
    });
  }

  Future<void> _setInventoryStatus(
    int instanceId,
    BotStoreInventoryItem item,
  ) async {
    final nextStatus = item.status == 'disabled' ? 'available' : 'disabled';
    await _runAction(
      instanceId,
      'set_inventory_status',
      {'inventoryId': item.id, 'status': nextStatus},
      success: nextStatus == 'available'
          ? 'Item devolvido ao estoque.'
          : 'Item pausado.',
    );
  }

  Future<void> _deleteInventory(
    int instanceId,
    BotStoreInventoryItem item,
  ) async {
    if (!await _confirmDelete('Excluir este item do estoque?')) return;
    await _runAction(instanceId, 'delete_inventory', {
      'inventoryId': item.id,
    }, success: 'Item removido do estoque.');
    if (mounted && _selectedInventoryId == item.id) {
      setState(() => _selectedInventoryId = null);
    }
  }

  Future<void> _deleteCategory(
    int instanceId,
    BotStoreCategory category,
  ) async {
    if (!await _confirmDelete('Excluir ${category.name}?')) return;
    await _runAction(instanceId, 'delete_category', {
      'categoryId': category.id,
    }, success: 'Categoria excluída.');
  }

  Future<void> _deleteProduct(int instanceId, BotStoreProduct product) async {
    if (!await _confirmDelete('Excluir ${product.name}?')) return;
    await _runAction(instanceId, 'delete_product', {
      'productId': product.id,
    }, success: 'Produto excluído.');
  }

  Future<bool> _confirmDelete(String title) async {
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(title),
            content: const Text('Esta ação não pode ser desfeita.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Excluir'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<BotStoreSnapshot?> _runAction(
    int instanceId,
    String action,
    Map<String, Object?> payload, {
    required String success,
  }) async {
    setState(() => _busyKey = action);
    try {
      final updated = await ref
          .read(apiClientProvider)
          .runBotStoreAction(instanceId, action, payload: payload);
      ref.invalidate(botStoreProvider(instanceId));
      if (mounted) showSuccessToast(context, success);
      return updated;
    } catch (error) {
      if (mounted) showErrorToast(context, error);
      return null;
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }
}

class _StoreQuickSettingsButton extends StatefulWidget {
  const _StoreQuickSettingsButton({
    required this.instance,
    required this.store,
    required this.wwPanel,
    required this.busy,
    required this.onToggle,
    required this.onSettings,
    required this.onCentralCart,
    required this.onWwPanel,
  });

  final BotInstance instance;
  final BotStoreSettings store;
  final BotStoreWwPanelSettings wwPanel;
  final bool busy;
  final ValueChanged<bool> onToggle;
  final VoidCallback onSettings;
  final VoidCallback onCentralCart;
  final VoidCallback onWwPanel;

  @override
  State<_StoreQuickSettingsButton> createState() =>
      _StoreQuickSettingsButtonState();
}

class _StoreQuickSettingsButtonState extends State<_StoreQuickSettingsButton> {
  final OverlayPortalController _overlay = OverlayPortalController();
  final LayerLink _layerLink = LayerLink();
  Timer? _closeTimer;

  @override
  void dispose() {
    _closeTimer?.cancel();
    super.dispose();
  }

  void _show() {
    _closeTimer?.cancel();
    if (!_overlay.isShowing) _overlay.show();
  }

  void _scheduleClose() {
    _closeTimer?.cancel();
    _closeTimer = Timer(const Duration(milliseconds: 180), () {
      if (mounted && _overlay.isShowing) _overlay.hide();
    });
  }

  void _toggle() {
    _closeTimer?.cancel();
    if (_overlay.isShowing) {
      _overlay.hide();
    } else {
      _overlay.show();
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 700;
    return OverlayPortal(
      controller: _overlay,
      overlayChildBuilder: (overlayContext) {
        final panelWidth = (MediaQuery.sizeOf(overlayContext).width - 24)
            .clamp(280.0, 340.0)
            .toDouble();
        return CompositedTransformFollower(
          link: _layerLink,
          showWhenUnlinked: false,
          targetAnchor: Alignment.bottomRight,
          followerAnchor: Alignment.topLeft,
          offset: Offset(-panelWidth, 8),
          child: Align(
            alignment: Alignment.topLeft,
            widthFactor: 1,
            heightFactor: 1,
            child: TapRegion(
              onTapOutside: (_) {
                if (_overlay.isShowing) _overlay.hide();
              },
              child: MouseRegion(
                onEnter: (_) {
                  if (!compact) _show();
                },
                onExit: (_) {
                  if (!compact) _scheduleClose();
                },
                child: Material(
                  elevation: 14,
                  color: wa.panel,
                  borderRadius: BorderRadius.circular(8),
                  clipBehavior: Clip.antiAlias,
                  child: SizedBox(
                    width: panelWidth,
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            children: [
                              CircleAvatar(
                                radius: 20,
                                backgroundImage:
                                    widget.instance.avatarUrl
                                            ?.trim()
                                            .isNotEmpty ==
                                        true
                                    ? NetworkImage(widget.instance.avatarUrl!)
                                    : null,
                                child:
                                    widget.instance.avatarUrl
                                            ?.trim()
                                            .isNotEmpty ==
                                        true
                                    ? null
                                    : const Icon(
                                        Icons.storefront_outlined,
                                        size: 20,
                                      ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      widget.store.name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    Text(
                                      widget.store.enabled
                                          ? 'Atendendo no privado'
                                          : 'Loja pausada',
                                      style: TextStyle(
                                        color: wa.textMuted,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Switch(
                                value: widget.store.enabled,
                                onChanged: widget.busy ? null : widget.onToggle,
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              OutlinedButton.icon(
                                onPressed: widget.busy
                                    ? null
                                    : () {
                                        _overlay.hide();
                                        widget.onSettings();
                                      },
                                icon: const Icon(Icons.tune_rounded, size: 18),
                                label: const Text('Configurar'),
                              ),
                              OutlinedButton.icon(
                                onPressed: widget.busy
                                    ? null
                                    : () {
                                        _overlay.hide();
                                        widget.onCentralCart();
                                      },
                                icon: const Icon(Icons.hub_outlined, size: 18),
                                label: Text(
                                  widget.store.centralCartConnected
                                      ? 'Central Cart'
                                      : 'Central Cart',
                                ),
                              ),
                              OutlinedButton.icon(
                                onPressed: widget.busy
                                    ? null
                                    : () {
                                        _overlay.hide();
                                        widget.onWwPanel();
                                      },
                                icon: const Icon(
                                  Icons.live_tv_outlined,
                                  size: 18,
                                ),
                                label: Text(
                                  widget.wwPanel.connected
                                      ? 'WWPanel'
                                      : 'Conectar IPTV',
                                ),
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
          ),
        );
      },
      child: CompositedTransformTarget(
        link: _layerLink,
        child: MouseRegion(
          onEnter: (_) {
            if (!compact) _show();
          },
          onExit: (_) {
            if (!compact) _scheduleClose();
          },
          child: IconButton(
            onPressed: _toggle,
            style: IconButton.styleFrom(
              backgroundColor: widget.store.enabled
                  ? wa.accentSoft
                  : wa.searchBg,
              foregroundColor: widget.store.enabled ? wa.accent : wa.icon,
            ),
            icon: Badge(
              isLabelVisible: widget.store.enabled,
              smallSize: 7,
              backgroundColor: wa.accent,
              child: const Icon(Icons.settings_outlined),
            ),
            tooltip: 'Configurar Store',
          ),
        ),
      ),
    );
  }
}

class _StoreNotice extends StatelessWidget {
  const _StoreNotice({
    required this.icon,
    required this.text,
    this.danger = false,
  });

  final IconData icon;
  final String text;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: danger ? const Color(0xFFFFEEEE) : wa.accentSoft,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(
          children: [
            Icon(icon, color: danger ? Colors.red.shade700 : wa.accent),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
          ],
        ),
      ),
    );
  }
}

class _SmmConnectionSummary extends StatelessWidget {
  const _SmmConnectionSummary({
    required this.settings,
    required this.serviceCount,
    required this.enabledCount,
    required this.busy,
    required this.onConfigure,
    this.onSync,
  });

  final BotStoreSmmSettings settings;
  final int serviceCount;
  final int enabledCount;
  final bool busy;
  final VoidCallback onConfigure;
  final VoidCallback? onSync;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final balance = settings.providerBalance == null
        ? 'Saldo não consultado'
        : '${settings.providerCurrency} ${settings.providerBalance!.toStringAsFixed(2)}';
    return DecoratedBox(
      decoration: BoxDecoration(
        color: settings.connected ? wa.accentSoft : wa.searchBg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: settings.connected
              ? wa.accent.withValues(alpha: .35)
              : wa.divider,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 21,
                  backgroundColor: settings.connected ? wa.accent : wa.panel,
                  child: Icon(
                    Icons.rocket_launch_outlined,
                    color: settings.connected ? Colors.white : wa.icon,
                    size: 21,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        settings.connected
                            ? 'SMMHype conectada'
                            : 'Configurar painel SMM',
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        settings.connected
                            ? '$balance · $enabledCount de $serviceCount ativos'
                            : 'Catálogo, câmbio e margem em um só lugar.',
                        style: TextStyle(color: wa.textMuted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: busy ? null : onConfigure,
                  icon: const Icon(Icons.settings_outlined),
                  tooltip: 'Configurar SMM',
                ),
                if (onSync != null)
                  IconButton(
                    onPressed: busy ? null : onSync,
                    icon: const Icon(Icons.sync_rounded),
                    tooltip: 'Sincronizar catálogo',
                  ),
              ],
            ),
            if (settings.connected) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  _SmmInfoChip(
                    icon: Icons.currency_exchange_rounded,
                    label:
                        'USD 1 = R\$ ${settings.usdBrlRate.toStringAsFixed(4).replaceAll('.', ',')}',
                  ),
                  _SmmInfoChip(
                    icon: Icons.trending_up_rounded,
                    label:
                        '${settings.markupPercent.toStringAsFixed(settings.markupPercent % 1 == 0 ? 0 : 2)}% de margem',
                  ),
                  _SmmInfoChip(
                    icon: settings.enabled
                        ? Icons.check_circle_outline_rounded
                        : Icons.pause_circle_outline_rounded,
                    label: settings.enabled ? 'Venda ativa' : 'Venda pausada',
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SmmInfoChip extends StatelessWidget {
  const _SmmInfoChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.panel.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: wa.accent),
            const SizedBox(width: 5),
            Text(
              label,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

class _SmmServiceTile extends StatelessWidget {
  const _SmmServiceTile({
    required this.service,
    required this.selected,
    required this.selectionMode,
    required this.checked,
    required this.busy,
    required this.onTap,
    required this.onLongPress,
    required this.onSelectionToggle,
    required this.onToggle,
    required this.onDelete,
  });

  final BotStoreSmmService service;
  final bool selected;
  final bool selectionMode;
  final bool checked;
  final bool busy;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onSelectionToggle;
  final ValueChanged<bool> onToggle;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final fixed = _smmServiceUsesFixedPrice(service.serviceType);
    final sale = _formatMoney((service.estimatedSaleCents ?? 0) / 100);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: selected || checked ? wa.accentSoft : wa.panel,
        borderRadius: BorderRadius.circular(7),
        child: InkWell(
          onTap: selectionMode ? onSelectionToggle : onTap,
          onLongPress: busy ? null : onLongPress,
          borderRadius: BorderRadius.circular(7),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 8, 8),
            child: Row(
              children: [
                if (selectionMode) ...[
                  Checkbox(
                    value: checked,
                    onChanged: busy ? null : (_) => onSelectionToggle(),
                    visualDensity: VisualDensity.compact,
                  ),
                  const SizedBox(width: 4),
                ],
                SizedBox(
                  width: 36,
                  height: 36,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: service.enabled ? wa.accentSoft : wa.searchBg,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Center(
                      child: Text(
                        '#${service.providerServiceId}',
                        style: TextStyle(
                          color: service.enabled ? wa.accent : wa.textMuted,
                          fontSize: 9,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        service.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${service.category} · ${service.serviceType}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: wa.textMuted, fontSize: 11),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '$sale ${fixed ? 'por pedido' : 'por 1.000'} · ${service.min}-${service.max}',
                        style: TextStyle(
                          color: service.enabled ? wa.accent : wa.textMuted,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!selectionMode)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Switch(
                        value: service.enabled,
                        onChanged: busy ? null : onToggle,
                      ),
                      IconButton(
                        onPressed: busy ? null : onDelete,
                        tooltip: 'Remover serviço',
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(
                          Icons.delete_outline_rounded,
                          size: 19,
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SmmOrderTile extends StatelessWidget {
  const _SmmOrderTile({
    required this.order,
    required this.selected,
    required this.onTap,
  });

  final BotStoreSmmOrder order;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final color = _smmStatusColor(order.status);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: selected ? wa.accentSoft : wa.panel,
        borderRadius: BorderRadius.circular(7),
        child: ListTile(
          onTap: onTap,
          dense: true,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(7)),
          leading: CircleAvatar(
            backgroundColor: color.withValues(alpha: .13),
            child: Icon(Icons.receipt_long_outlined, color: color, size: 20),
          ),
          title: Text(
            order.serviceName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          subtitle: Text(
            '#${order.orderId} · ${order.quantity} · ${_formatMoney(order.saleTotalCents / 100)}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          trailing: Text(
            order.status,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }
}

class _SmmServiceDraft {
  const _SmmServiceDraft({
    required this.name,
    required this.category,
    required this.description,
    required this.min,
    required this.max,
    required this.enabled,
    required this.position,
    this.customSaleRateCents,
  });

  final String name;
  final String category;
  final String description;
  final int min;
  final int max;
  final bool enabled;
  final int position;
  final int? customSaleRateCents;

  Map<String, Object?> toJson() => {
    'name': name,
    'category': category,
    'description': description,
    'min': min,
    'max': max,
    'enabled': enabled,
    'position': position,
    'customSaleRateCents': customSaleRateCents,
  };
}

class _SmmServiceDetail extends StatefulWidget {
  const _SmmServiceDetail({
    required this.service,
    required this.busy,
    required this.onSave,
    required this.onDelete,
  });

  final BotStoreSmmService service;
  final bool busy;
  final Future<void> Function(_SmmServiceDraft) onSave;
  final Future<void> Function() onDelete;

  @override
  State<_SmmServiceDetail> createState() => _SmmServiceDetailState();
}

class _SmmServiceDetailState extends State<_SmmServiceDetail> {
  late bool _enabled;
  late final TextEditingController _name;
  late final TextEditingController _category;
  late final TextEditingController _description;
  late final TextEditingController _min;
  late final TextEditingController _max;
  late final TextEditingController _position;
  late final TextEditingController _customRate;

  @override
  void initState() {
    super.initState();
    _enabled = widget.service.enabled;
    _name = TextEditingController(text: widget.service.name);
    _category = TextEditingController(text: widget.service.category);
    _description = TextEditingController(
      text: widget.service.description ?? '',
    );
    _min = TextEditingController(text: widget.service.min.toString());
    _max = TextEditingController(text: widget.service.max.toString());
    _position = TextEditingController(text: widget.service.position.toString());
    _customRate = TextEditingController(
      text: widget.service.customSaleRateCents == null
          ? ''
          : (widget.service.customSaleRateCents! / 100).toStringAsFixed(2),
    );
  }

  @override
  void didUpdateWidget(covariant _SmmServiceDetail oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.service.id != widget.service.id) {
      _enabled = widget.service.enabled;
      _name.text = widget.service.name;
      _category.text = widget.service.category;
      _description.text = widget.service.description ?? '';
      _min.text = widget.service.min.toString();
      _max.text = widget.service.max.toString();
      _position.text = widget.service.position.toString();
      _customRate.text = widget.service.customSaleRateCents == null
          ? ''
          : (widget.service.customSaleRateCents! / 100).toStringAsFixed(2);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _category.dispose();
    _description.dispose();
    _min.dispose();
    _max.dispose();
    _position.dispose();
    _customRate.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final fixed = _smmServiceUsesFixedPrice(widget.service.serviceType);
    return Material(
      color: wa.panel,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(22, 22, 22, 32),
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: wa.accentSoft,
                child: Icon(Icons.rocket_launch_outlined, color: wa.accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.service.name,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      '#${widget.service.providerServiceId} · ${widget.service.category}',
                      style: TextStyle(color: wa.textMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          _SmmDetailBlock(
            title: 'Dados do fornecedor',
            rows: [
              ('Tipo', widget.service.serviceType),
              (
                'Custo',
                '${widget.service.providerRate.toStringAsFixed(6)} USD',
              ),
              ('Limites', '${widget.service.min} a ${widget.service.max}'),
              ('Reposição', widget.service.refill ? 'Disponível' : 'Não'),
              ('Cancelamento', widget.service.cancel ? 'Disponível' : 'Não'),
              ('Drip-feed', widget.service.dripfeed ? 'Disponível' : 'Não'),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Nome exibido na Store',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _category,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Categoria exibida',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _description,
            minLines: 3,
            maxLines: 6,
            maxLength: 8000,
            decoration: const InputDecoration(
              labelText: 'Descrição e instruções para o cliente',
              hintText: 'Explique o link necessário e o que será entregue.',
              alignLabelWithHint: true,
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _min,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(
                    labelText: 'Mínimo de venda',
                    helperText: 'Fornecedor: ${widget.service.providerMin}',
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _max,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(
                    labelText: 'Máximo de venda',
                    helperText: 'Fornecedor: ${widget.service.providerMax}',
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text(
              'Exibir na Store',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: const Text(
              'O cliente poderá localizar e comprar este serviço.',
            ),
            value: _enabled,
            onChanged: widget.busy
                ? null
                : (value) => setState(() => _enabled = value),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _customRate,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]')),
            ],
            decoration: InputDecoration(
              labelText: fixed
                  ? 'Preço personalizado por pedido'
                  : 'Preço personalizado por 1.000',
              hintText: _formatMoney(
                (widget.service.estimatedSaleCents ?? 0) / 100,
              ),
              prefixText: 'R\$ ',
              helperText:
                  'Deixe vazio para usar câmbio, margem e lucro mínimo automáticos.',
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _position,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(
              labelText: 'Posição no catálogo',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: widget.busy ? null : _submit,
            icon: const Icon(Icons.save_outlined),
            label: const Text('Salvar serviço'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: widget.busy ? null : widget.onDelete,
            icon: const Icon(Icons.delete_outline_rounded),
            label: const Text('Remover da Store'),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final category = _category.text.trim();
    final min = int.tryParse(_min.text.trim());
    final max = int.tryParse(_max.text.trim());
    if (name.isEmpty || category.isEmpty) {
      showErrorToast(context, 'Informe o nome e a categoria do serviço.');
      return;
    }
    if (min == null ||
        max == null ||
        min < widget.service.providerMin ||
        max > widget.service.providerMax ||
        min > max) {
      showErrorToast(
        context,
        'Use limites entre ${widget.service.providerMin} e ${widget.service.providerMax}.',
      );
      return;
    }
    final raw = _customRate.text.trim().replaceAll(',', '.');
    final custom = raw.isEmpty ? null : double.tryParse(raw);
    if (raw.isNotEmpty && (custom == null || custom <= 0)) {
      showErrorToast(context, 'Informe um preço válido em reais.');
      return;
    }
    await widget.onSave(
      _SmmServiceDraft(
        name: name,
        category: category,
        description: _description.text.trim(),
        min: min,
        max: max,
        enabled: _enabled,
        position: int.tryParse(_position.text.trim()) ?? 0,
        customSaleRateCents: custom == null ? null : (custom * 100).round(),
      ),
    );
  }
}

class _SmmDetailBlock extends StatelessWidget {
  const _SmmDetailBlock({required this.title, required this.rows});

  final String title;
  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.searchBg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: wa.divider),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            for (var index = 0; index < rows.length; index++) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 118,
                    child: Text(
                      rows[index].$1,
                      style: TextStyle(color: wa.textMuted),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      rows[index].$2,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
              if (index < rows.length - 1) const SizedBox(height: 8),
            ],
          ],
        ),
      ),
    );
  }
}

class _SmmOrderDetail extends StatelessWidget {
  const _SmmOrderDetail({
    required this.order,
    required this.service,
    required this.busy,
    required this.onSync,
    required this.onRefill,
    required this.onCancel,
  });

  final BotStoreSmmOrder order;
  final BotStoreSmmService? service;
  final bool busy;
  final Future<void> Function() onSync;
  final Future<void> Function() onRefill;
  final Future<void> Function() onCancel;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final statusColor = _smmStatusColor(order.status);
    return Material(
      color: wa.panel,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(22, 22, 22, 32),
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 25,
                backgroundColor: statusColor.withValues(alpha: .13),
                child: Icon(Icons.receipt_long_outlined, color: statusColor),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      order.serviceName,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      'Pedido #${order.orderId}',
                      style: TextStyle(color: wa.textMuted),
                    ),
                  ],
                ),
              ),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 6,
                  ),
                  child: Text(
                    order.status,
                    style: TextStyle(
                      color: statusColor,
                      fontWeight: FontWeight.w900,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          _SmmDetailBlock(
            title: 'Detalhes',
            rows: [
              ('Categoria', order.serviceCategory),
              ('Tipo', order.serviceType),
              ('Alvo', order.target),
              ('Quantidade', order.quantity.toString()),
              ('Total', _formatMoney(order.saleTotalCents / 100)),
              ('ID SMMHype', order.providerOrderId ?? 'Aguardando pagamento'),
              ('Contagem inicial', order.startCount ?? '-'),
              ('Restante', order.remains ?? '-'),
              ('Reposição', order.refillStatus ?? 'Não solicitada'),
              (
                'Criado em',
                DateFormat(
                  'dd/MM/yyyy HH:mm',
                ).format(order.createdAt.toLocal()),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: busy || order.providerOrderId == null
                    ? null
                    : onSync,
                icon: const Icon(Icons.sync_rounded),
                label: const Text('Atualizar status'),
              ),
              if (service?.refill == true)
                OutlinedButton.icon(
                  onPressed: busy || order.providerOrderId == null
                      ? null
                      : onRefill,
                  icon: const Icon(Icons.replay_rounded),
                  label: Text(
                    order.refillId == null
                        ? 'Solicitar reposição'
                        : 'Atualizar reposição',
                  ),
                ),
              if (service?.cancel == true)
                OutlinedButton.icon(
                  onPressed: busy || order.providerOrderId == null
                      ? null
                      : onCancel,
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text('Cancelar pedido'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SmmCatalogImportDialog extends StatefulWidget {
  const _SmmCatalogImportDialog({
    required this.catalogCount,
    required this.onSearch,
  });

  final int catalogCount;
  final Future<List<BotStoreSmmService>> Function(String query) onSearch;

  @override
  State<_SmmCatalogImportDialog> createState() =>
      _SmmCatalogImportDialogState();
}

class _SmmCatalogImportDialogState extends State<_SmmCatalogImportDialog> {
  final _search = TextEditingController();
  final Set<int> _selected = {};
  Timer? _debounce;
  List<BotStoreSmmService> _services = const [];
  bool _loading = true;
  String? _error;
  int _requestId = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _scheduleSearch(String _) {
    _debounce?.cancel();
    setState(() {});
    _debounce = Timer(const Duration(milliseconds: 350), _load);
  }

  Future<void> _load() async {
    final requestId = ++_requestId;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final services = await widget.onSearch(_search.text.trim());
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _services = services;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 760, maxHeight: 760),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 12),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: wa.accentSoft,
                    child: Icon(Icons.add_business_outlined, color: wa.accent),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Adicionar serviços SMM',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          '${widget.catalogCount} serviços disponíveis na API',
                          style: TextStyle(color: wa.textMuted, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    tooltip: 'Fechar',
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: TextField(
                controller: _search,
                autofocus: true,
                onChanged: _scheduleSearch,
                onSubmitted: (_) => _load(),
                decoration: InputDecoration(
                  hintText: 'Pesquisar por ID, nome ou categoria',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          onPressed: () {
                            _search.clear();
                            _load();
                          },
                          tooltip: 'Limpar busca',
                          icon: const Icon(Icons.close_rounded),
                        ),
                  border: const OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                  ? _ErrorBlock(message: _error!, onRetry: _load)
                  : _services.isEmpty
                  ? const _StoreEmptyLine(
                      icon: Icons.search_off_rounded,
                      text: 'Nenhum serviço encontrado na API.',
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      itemCount: _services.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final service = _services[index];
                        final selected = _selected.contains(
                          service.providerServiceId,
                        );
                        return CheckboxListTile(
                          value: service.imported || selected,
                          onChanged: service.imported
                              ? null
                              : (checked) => setState(() {
                                  if (checked == true) {
                                    _selected.add(service.providerServiceId);
                                  } else {
                                    _selected.remove(service.providerServiceId);
                                  }
                                }),
                          secondary: SizedBox(
                            width: 48,
                            child: Text(
                              '#${service.providerServiceId}',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: wa.accent,
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          title: Text(
                            service.providerName,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          subtitle: Text(
                            '${service.providerCategory}\n'
                            '${service.serviceType} · ${service.min}-${service.max} · '
                            '${service.providerRate.toStringAsFixed(6)} USD',
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                          isThreeLine: true,
                          controlAffinity: ListTileControlAffinity.trailing,
                        );
                      },
                    ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _selected.isEmpty
                          ? 'Selecione os serviços que deseja vender.'
                          : '${_selected.length} serviço(s) selecionado(s)',
                      style: TextStyle(color: wa.textMuted),
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: _selected.isEmpty
                        ? null
                        : () => Navigator.of(
                            context,
                          ).pop(_selected.toList(growable: false)),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Adicionar'),
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

class _SmmSettingsDraft {
  const _SmmSettingsDraft({
    required this.apiKey,
    required this.enabled,
    required this.fxMode,
    required this.usdBrlRate,
    required this.markupPercent,
    required this.fixedMarkupCents,
    required this.minimumProfitCents,
    this.disconnect = false,
  });

  final String apiKey;
  final bool enabled;
  final String fxMode;
  final double usdBrlRate;
  final double markupPercent;
  final int fixedMarkupCents;
  final int minimumProfitCents;
  final bool disconnect;

  Map<String, Object?> toJson() => {
    if (apiKey.isNotEmpty) 'apiKey': apiKey,
    'enabled': enabled,
    'fxMode': fxMode,
    'usdBrlRate': usdBrlRate,
    'markupPercent': markupPercent,
    'fixedMarkupCents': fixedMarkupCents,
    'minimumProfitCents': minimumProfitCents,
    'syncCatalog': true,
    'enableNewServices': false,
  };
}

class _SmmSettingsDialog extends StatefulWidget {
  const _SmmSettingsDialog({required this.settings});

  final BotStoreSmmSettings settings;

  @override
  State<_SmmSettingsDialog> createState() => _SmmSettingsDialogState();
}

class _SmmSettingsDialogState extends State<_SmmSettingsDialog> {
  late final TextEditingController _apiKey;
  late final TextEditingController _rate;
  late final TextEditingController _markup;
  late final TextEditingController _fixed;
  late final TextEditingController _minimum;
  late bool _enabled;
  late String _fxMode;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _apiKey = TextEditingController();
    _rate = TextEditingController(
      text: widget.settings.usdBrlRate.toStringAsFixed(4),
    );
    _markup = TextEditingController(
      text: widget.settings.markupPercent.toStringAsFixed(2),
    );
    _fixed = TextEditingController(
      text: (widget.settings.fixedMarkupCents / 100).toStringAsFixed(2),
    );
    _minimum = TextEditingController(
      text: (widget.settings.minimumProfitCents / 100).toStringAsFixed(2),
    );
    _enabled = widget.settings.connected ? widget.settings.enabled : true;
    _fxMode = widget.settings.fxMode;
  }

  @override
  void dispose() {
    _apiKey.dispose();
    _rate.dispose();
    _markup.dispose();
    _fixed.dispose();
    _minimum.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final viewport = MediaQuery.sizeOf(context);
    return AlertDialog(
      insetPadding: EdgeInsets.symmetric(
        horizontal: viewport.width < 700 ? 12 : 32,
        vertical: 24,
      ),
      title: const Text('Configurar Painel SMM'),
      content: SizedBox(
        width: 660,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _apiKey,
                obscureText: _obscure,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  labelText: widget.settings.connected
                      ? 'API key (${widget.settings.apiKeyHint ?? 'protegida'})'
                      : 'API key SMMHype',
                  hintText: widget.settings.connected
                      ? 'Deixe vazio para manter a atual'
                      : 'Cole a chave fornecida pela SMMHype',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    onPressed: () => setState(() => _obscure = !_obscure),
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Vender serviços SMM'),
                subtitle: const Text(
                  'Mantém o catálogo conectado, mas permite pausar as vendas.',
                ),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              const SizedBox(height: 4),
              DropdownButtonFormField<String>(
                initialValue: _fxMode,
                decoration: const InputDecoration(
                  labelText: 'Conversão USD para BRL',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(
                    value: 'auto',
                    child: Text('Automática, atualizada pela cotação'),
                  ),
                  DropdownMenuItem(
                    value: 'manual',
                    child: Text('Taxa definida manualmente'),
                  ),
                ],
                onChanged: (value) => setState(() => _fxMode = value ?? 'auto'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _rate,
                enabled: _fxMode == 'manual',
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]')),
                ],
                decoration: const InputDecoration(
                  labelText: 'Valor de USD 1 em reais',
                  prefixText: 'R\$ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              LayoutBuilder(
                builder: (context, constraints) {
                  final compact = constraints.maxWidth < 560;
                  final fields = [
                    TextField(
                      controller: _markup,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]')),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Margem percentual',
                        suffixText: '%',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    TextField(
                      controller: _fixed,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]')),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Acréscimo fixo',
                        prefixText: 'R\$ ',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    TextField(
                      controller: _minimum,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]')),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Lucro mínimo',
                        prefixText: 'R\$ ',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ];
                  if (compact) {
                    return Column(
                      children: [
                        for (var index = 0; index < fields.length; index++) ...[
                          fields[index],
                          if (index < fields.length - 1)
                            const SizedBox(height: 12),
                        ],
                      ],
                    );
                  }
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var index = 0; index < fields.length; index++) ...[
                        Expanded(child: fields[index]),
                        if (index < fields.length - 1)
                          const SizedBox(width: 10),
                      ],
                    ],
                  );
                },
              ),
              const SizedBox(height: 8),
              const _StoreNotice(
                icon: Icons.playlist_add_rounded,
                text:
                    'A sincronização atualiza custos e limites. Novos serviços são adicionados pela busca do catálogo.',
              ),
            ],
          ),
        ),
      ),
      actions: [
        if (widget.settings.connected)
          TextButton.icon(
            onPressed: () => Navigator.of(context).pop(
              const _SmmSettingsDraft(
                apiKey: '',
                enabled: false,
                fxMode: 'auto',
                usdBrlRate: 1,
                markupPercent: 0,
                fixedMarkupCents: 0,
                minimumProfitCents: 0,
                disconnect: true,
              ),
            ),
            icon: const Icon(Icons.link_off_rounded),
            label: const Text('Desconectar'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.save_outlined),
          label: Text(widget.settings.connected ? 'Salvar' : 'Conectar'),
        ),
      ],
    );
  }

  void _submit() {
    if (!widget.settings.connected && _apiKey.text.trim().isEmpty) {
      showErrorToast(context, 'Informe a API key da SMMHype.');
      return;
    }
    double number(TextEditingController controller) =>
        double.tryParse(controller.text.trim().replaceAll(',', '.')) ?? 0;
    final rate = number(_rate);
    if (_fxMode == 'manual' && rate <= 0) {
      showErrorToast(context, 'Informe uma cotação válida.');
      return;
    }
    Navigator.of(context).pop(
      _SmmSettingsDraft(
        apiKey: _apiKey.text.trim(),
        enabled: _enabled,
        fxMode: _fxMode,
        usdBrlRate: rate > 0 ? rate : widget.settings.usdBrlRate,
        markupPercent: number(_markup).clamp(0, 10000),
        fixedMarkupCents: (number(_fixed).clamp(0, double.infinity) * 100)
            .round(),
        minimumProfitCents: (number(_minimum).clamp(0, double.infinity) * 100)
            .round(),
      ),
    );
  }
}

bool _smmServiceUsesFixedPrice(String type) {
  final normalized = type.trim().toLowerCase();
  return normalized == 'package' || normalized == 'custom comments package';
}

Color _smmStatusColor(String status) {
  final value = status.trim().toLowerCase();
  if (value.contains('complete')) return const Color(0xFF008069);
  if (value.contains('cancel') ||
      value.contains('fail') ||
      value.contains('error')) {
    return const Color(0xFFD93025);
  }
  if (value.contains('progress') || value.contains('processing')) {
    return const Color(0xFF1A73E8);
  }
  return const Color(0xFFE08A00);
}

class _StorePaneSelector extends StatelessWidget {
  const _StorePaneSelector({required this.selected, required this.onSelected});

  final StorePane selected;
  final ValueChanged<StorePane> onSelected;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    const items = [
      (StorePane.categories, Icons.category_outlined, 'Categorias'),
      (StorePane.products, Icons.shopping_bag_outlined, 'Produtos'),
      (StorePane.inventory, Icons.inventory_2_outlined, 'Estoque'),
      (StorePane.iptv, Icons.live_tv_outlined, 'IPTV'),
      (StorePane.smm, Icons.rocket_launch_outlined, 'Painel SMM'),
      (StorePane.customers, Icons.people_outline_rounded, 'Clientes'),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 360;
        final availableItemWidth = (constraints.maxWidth - 16) / items.length;
        final itemWidth = compact
            ? 54.0
            : availableItemWidth.clamp(68.0, 104.0).toDouble();
        final tight = !compact && itemWidth < 88;
        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (var index = 0; index < items.length; index++) ...[
                if (index > 0) const SizedBox(width: 4),
                SizedBox(
                  width: itemWidth,
                  child: Material(
                    color: selected == items[index].$1
                        ? wa.accentSoft
                        : wa.searchBg,
                    borderRadius: BorderRadius.circular(8),
                    child: InkWell(
                      onTap: () => onSelected(items[index].$1),
                      borderRadius: BorderRadius.circular(8),
                      child: SizedBox(
                        height: 46,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              items[index].$2,
                              size: tight ? 16 : 18,
                              color: selected == items[index].$1
                                  ? wa.accent
                                  : wa.icon,
                            ),
                            if (!compact) ...[
                              SizedBox(width: tight ? 4 : 6),
                              Flexible(
                                child: Text(
                                  items[index].$3,
                                  maxLines: 1,
                                  style: TextStyle(
                                    color: selected == items[index].$1
                                        ? wa.accent
                                        : wa.textPrimary,
                                    fontWeight: FontWeight.w800,
                                    fontSize: tight ? 10 : 12,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _StoreSectionHeader extends StatelessWidget {
  const _StoreSectionHeader({
    required this.title,
    required this.count,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final int count;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            '$title  $count',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
          ),
        ),
        if (actionLabel != null)
          TextButton.icon(
            onPressed: onAction,
            icon: const Icon(Icons.add_rounded, size: 18),
            label: Text(actionLabel!),
          ),
      ],
    );
  }
}

class _StoreEmptyLine extends StatelessWidget {
  const _StoreEmptyLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        children: [
          Icon(icon, color: wa.textMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: TextStyle(color: wa.textMuted)),
          ),
        ],
      ),
    );
  }
}

class _WwPanelSettingsDraft {
  const _WwPanelSettingsDraft({
    this.apiKey = '',
    this.enabled = true,
    this.syncOnly = false,
    this.disconnect = false,
  });

  final String apiKey;
  final bool enabled;
  final bool syncOnly;
  final bool disconnect;

  Map<String, Object?> toJson() => {
    if (apiKey.trim().isNotEmpty) 'apiKey': apiKey.trim(),
    'enabled': enabled,
  };
}

class _WwPanelSettingsDialog extends StatefulWidget {
  const _WwPanelSettingsDialog({required this.settings, required this.busy});

  final BotStoreWwPanelSettings settings;
  final bool busy;

  @override
  State<_WwPanelSettingsDialog> createState() => _WwPanelSettingsDialogState();
}

class _WwPanelSettingsDialogState extends State<_WwPanelSettingsDialog> {
  final _apiKey = TextEditingController();
  bool _enabled = true;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _enabled = widget.settings.enabled || !widget.settings.connected;
  }

  @override
  void dispose() {
    _apiKey.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final credits =
        widget.settings.account['credits'] ??
        widget.settings.account['credit'] ??
        widget.settings.account['balance'];
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 24),
      title: const Row(
        children: [
          Icon(Icons.live_tv_outlined),
          SizedBox(width: 10),
          Expanded(child: Text('Integração IPTV')),
        ],
      ),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.settings.connected) ...[
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: wa.accentSoft,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: wa.border),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        CircleAvatar(
                          backgroundColor: wa.accent,
                          foregroundColor: Colors.white,
                          child: const Icon(Icons.verified_user_outlined),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                widget.settings.accountName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                [
                                  if (widget.settings.apiKeyHint != null)
                                    widget.settings.apiKeyHint!,
                                  if (credits != null)
                                    'Créditos: ${credits.toString()}',
                                ].join(' · '),
                                style: TextStyle(
                                  color: wa.textMuted,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
              ],
              TextField(
                controller: _apiKey,
                obscureText: _obscure,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  labelText: widget.settings.connected
                      ? 'Nova API key (opcional)'
                      : 'API key do WWPanel',
                  hintText: widget.settings.connected
                      ? 'Deixe vazio para manter a atual'
                      : 'Cole a chave da integração',
                  prefixIcon: const Icon(Icons.key_outlined),
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    tooltip: _obscure ? 'Mostrar chave' : 'Ocultar chave',
                    onPressed: () => setState(() => _obscure = !_obscure),
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Venda automática ativa'),
                subtitle: const Text(
                  'Provisiona o acesso após a confirmação do pagamento.',
                ),
                value: _enabled,
                onChanged: widget.busy
                    ? null
                    : (value) => setState(() => _enabled = value),
              ),
            ],
          ),
        ),
      ),
      actions: [
        if (widget.settings.connected)
          TextButton.icon(
            onPressed: widget.busy
                ? null
                : () => Navigator.of(
                    context,
                  ).pop(const _WwPanelSettingsDraft(disconnect: true)),
            icon: const Icon(Icons.link_off_rounded),
            label: const Text('Desconectar'),
          ),
        TextButton(
          onPressed: widget.busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        if (widget.settings.connected)
          OutlinedButton.icon(
            onPressed: widget.busy
                ? null
                : () => Navigator.of(context).pop(
                    _WwPanelSettingsDraft(
                      apiKey: _apiKey.text,
                      enabled: _enabled,
                      syncOnly: true,
                    ),
                  ),
            icon: const Icon(Icons.sync_rounded),
            label: const Text('Sincronizar'),
          ),
        FilledButton.icon(
          onPressed: widget.busy
              ? null
              : () {
                  if (!widget.settings.connected &&
                      _apiKey.text.trim().isEmpty) {
                    showErrorToast(context, 'Informe a API key do WWPanel.');
                    return;
                  }
                  Navigator.of(context).pop(
                    _WwPanelSettingsDraft(
                      apiKey: _apiKey.text,
                      enabled: _enabled,
                    ),
                  );
                },
          icon: const Icon(Icons.save_outlined),
          label: Text(widget.settings.connected ? 'Salvar' : 'Conectar'),
        ),
      ],
    );
  }
}

class _WwPanelOfferTile extends StatelessWidget {
  const _WwPanelOfferTile({
    required this.offer,
    required this.selected,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  final BotStoreWwPanelOffer offer;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: selected ? wa.accentSoft : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        leading: _StoreProductImage(url: offer.imageUrl, size: 44),
        title: Text(
          offer.name,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(
          '${offer.isTrial ? 'Teste gratuito' : _formatMoney(offer.price)} · ${offer.validityLabel} · '
          '${offer.enabled ? 'visível' : 'oculto'}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: PopupMenuButton<String>(
          tooltip: 'Ações do plano',
          onSelected: (action) => action == 'edit' ? onEdit() : onDelete(),
          itemBuilder: (context) => const [
            PopupMenuItem(value: 'edit', child: Text('Editar')),
            PopupMenuItem(value: 'delete', child: Text('Excluir')),
          ],
        ),
      ),
    );
  }
}

class _WwPanelClientTile extends StatelessWidget {
  const _WwPanelClientTile({
    required this.client,
    required this.selected,
    required this.onTap,
  });

  final BotStoreWwPanelClient client;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final active = client.status.toLowerCase() != 'deleted';
    return Material(
      color: selected ? wa.accentSoft : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        leading: CircleAvatar(
          backgroundColor: active
              ? wa.accent.withValues(alpha: .14)
              : wa.searchBg,
          child: Icon(
            Icons.connected_tv_outlined,
            color: active ? wa.accent : wa.textMuted,
          ),
        ),
        title: Text(
          client.customerLabel,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(
          '${client.username} · ${client.expiresAt == null ? 'sem validade' : DateFormat('dd/MM/yyyy').format(client.expiresAt!.toLocal())}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
      ),
    );
  }
}

class _WwPanelClientDetail extends StatefulWidget {
  const _WwPanelClientDetail({
    required this.client,
    required this.settings,
    required this.busy,
    required this.onRevealPassword,
    required this.onAction,
  });

  final BotStoreWwPanelClient client;
  final BotStoreWwPanelSettings settings;
  final bool busy;
  final Future<String> Function() onRevealPassword;
  final ValueChanged<String> onAction;

  @override
  State<_WwPanelClientDetail> createState() => _WwPanelClientDetailState();
}

class _WwPanelClientDetailState extends State<_WwPanelClientDetail> {
  String? _password;
  bool _passwordVisible = false;
  bool _loadingPassword = false;

  @override
  void didUpdateWidget(covariant _WwPanelClientDetail oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.client.id != widget.client.id) {
      _password = null;
      _passwordVisible = false;
      _loadingPassword = false;
    }
  }

  Future<void> _togglePassword() async {
    if (_passwordVisible) {
      setState(() => _passwordVisible = false);
      return;
    }
    if (_password != null) {
      setState(() => _passwordVisible = true);
      return;
    }
    setState(() => _loadingPassword = true);
    try {
      final password = await widget.onRevealPassword();
      if (!mounted) return;
      setState(() {
        _password = password;
        _passwordVisible = true;
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _loadingPassword = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final actions = <(String, IconData, String)>[
      ('renew_wwpanel_client', Icons.update_rounded, 'Renovar acesso'),
      ('edit_wwpanel_client', Icons.edit_outlined, 'Editar cliente'),
      ('manage_wwpanel_plan', Icons.tune_rounded, 'Plano e pacotes'),
      ('recreate_wwpanel_client', Icons.password_rounded, 'Trocar senha'),
      ('activate_wwpanel_app', Icons.tv_rounded, 'Ativar aplicativo'),
      ('delete_wwpanel_client', Icons.delete_outline_rounded, 'Excluir acesso'),
    ];
    return Material(
      color: wa.panel,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(24, 22, 24, 32),
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: wa.accentSoft,
                child: Icon(
                  Icons.connected_tv_outlined,
                  color: wa.accent,
                  size: 28,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.client.customerLabel,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      widget.client.customerPhone ??
                          widget.client.customerJid ??
                          'WhatsApp',
                      style: TextStyle(color: wa.textMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          _WwPanelInfoLine(label: 'Usuário', value: widget.client.username),
          _WwPanelPasswordLine(
            label: 'Senha',
            value: _passwordVisible
                ? _password ?? ''
                : widget.client.passwordHint ?? 'Protegida',
            visible: _passwordVisible,
            loading: _loadingPassword,
            onToggle: _togglePassword,
          ),
          _WwPanelInfoLine(
            label: 'Validade',
            value: widget.client.expiresAt == null
                ? 'Não informada'
                : DateFormat(
                    'dd/MM/yyyy HH:mm',
                  ).format(widget.client.expiresAt!.toLocal()),
          ),
          _WwPanelInfoLine(label: 'Status', value: widget.client.status),
          const SizedBox(height: 18),
          Text(
            'Gerenciar',
            style: TextStyle(color: wa.textMuted, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          ...actions.map(
            (action) => ListTile(
              enabled: !widget.busy && widget.settings.connected,
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                action.$2,
                color: action.$1 == 'delete_wwpanel_client'
                    ? Colors.red.shade700
                    : wa.icon,
              ),
              title: Text(
                action.$3,
                style: TextStyle(
                  color: action.$1 == 'delete_wwpanel_client'
                      ? Colors.red.shade700
                      : null,
                ),
              ),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => widget.onAction(action.$1),
            ),
          ),
        ],
      ),
    );
  }
}

class _WwPanelPasswordLine extends StatelessWidget {
  const _WwPanelPasswordLine({
    required this.label,
    required this.value,
    required this.visible,
    required this.loading,
    required this.onToggle,
  });

  final String label;
  final String value;
  final bool visible;
  final bool loading;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            child: Text(label, style: TextStyle(color: wa.textMuted)),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          IconButton(
            tooltip: visible ? 'Ocultar senha' : 'Mostrar senha',
            onPressed: loading ? null : onToggle,
            icon: loading
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(
                    visible
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                  ),
          ),
        ],
      ),
    );
  }
}

class _WwPanelInfoLine extends StatelessWidget {
  const _WwPanelInfoLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(label, style: TextStyle(color: wa.textMuted)),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

class _WwPanelOfferDraft {
  const _WwPanelOfferDraft({
    required this.name,
    required this.description,
    required this.priceCents,
    required this.imagePath,
    required this.enabled,
    required this.position,
    required this.isTrial,
    required this.days,
    required this.months,
    required this.planId,
    required this.packageP2p,
    required this.packageIptv,
    required this.accessIptv,
    required this.accessNexus,
    required this.addons,
    required this.country,
    this.id,
  });

  final int? id;
  final String name;
  final String description;
  final int priceCents;
  final String? imagePath;
  final bool enabled;
  final int position;
  final bool isTrial;
  final int? days;
  final int? months;
  final int planId;
  final String packageP2p;
  final int packageIptv;
  final int accessIptv;
  final int accessNexus;
  final List<int> addons;
  final String country;

  Map<String, Object?> toJson() => {
    if (id != null) 'id': id,
    'name': name,
    'description': description,
    'priceCents': priceCents,
    'imagePath': imagePath,
    'enabled': enabled,
    'position': position,
    'isTrial': isTrial,
    'days': days,
    'months': months,
    'planId': planId,
    'packageP2p': packageP2p,
    'packageIptv': packageIptv,
    'accessIptv': accessIptv,
    'accessNexus': accessNexus,
    'addons': addons,
    'country': country,
  };
}

class _WwPanelOfferDialog extends ConsumerStatefulWidget {
  const _WwPanelOfferDialog({
    required this.settings,
    this.offer,
    this.startAsTrial = false,
    this.embedded = false,
    this.busy = false,
    this.onCancel,
    this.onSave,
    super.key,
  });

  final BotStoreWwPanelSettings settings;
  final BotStoreWwPanelOffer? offer;
  final bool startAsTrial;
  final bool embedded;
  final bool busy;
  final VoidCallback? onCancel;
  final Future<void> Function(_WwPanelOfferDraft draft)? onSave;

  @override
  ConsumerState<_WwPanelOfferDialog> createState() =>
      _WwPanelOfferDialogState();
}

class _WwPanelOfferDialogState extends ConsumerState<_WwPanelOfferDialog> {
  late final TextEditingController _name;
  late final TextEditingController _description;
  late final TextEditingController _price;
  late final TextEditingController _position;
  late final TextEditingController _period;
  late final TextEditingController _accessIptv;
  late final TextEditingController _accessNexus;
  late final TextEditingController _country;
  late bool _enabled;
  late bool _isTrial;
  late bool _periodInMonths;
  late int _planId;
  late int _packageIptv;
  late String _packageP2p;
  late Set<int> _addons;
  String? _imagePath;
  String? _imageUrl;
  bool _uploading = false;

  int _mapInt(Map<String, dynamic> value, String key, int fallback) =>
      int.tryParse(value[key]?.toString() ?? '') ?? fallback;

  String _mapName(Map<String, dynamic> value) =>
      value['name']?.toString().trim().isNotEmpty == true
      ? value['name'].toString()
      : value['id'].toString();

  @override
  void initState() {
    super.initState();
    final offer = widget.offer;
    final defaultPlan = widget.settings.plans.isEmpty
        ? 2
        : _mapInt(widget.settings.plans.first, 'id', 2);
    final defaultIptv = widget.settings.iptvPackages.isEmpty
        ? 30
        : _mapInt(widget.settings.iptvPackages.first, 'id', 30);
    final defaultP2p = widget.settings.p2pPackages.isEmpty
        ? '64399dca5ea59e8a1de2b083'
        : widget.settings.p2pPackages.first['id'].toString();
    _name = TextEditingController(
      text: offer?.name ?? (widget.startAsTrial ? 'Teste IPTV' : ''),
    );
    _description = TextEditingController(
      text:
          offer?.description ??
          (widget.startAsTrial
              ? 'Teste temporário para validar canais e compatibilidade.'
              : ''),
    );
    _price = TextEditingController(
      text: offer == null ? '' : offer.price.toStringAsFixed(2),
    );
    _position = TextEditingController(text: '${offer?.position ?? 0}');
    _periodInMonths =
        !widget.startAsTrial &&
        offer?.months != null &&
        (offer?.months ?? 0) > 0;
    _period = TextEditingController(
      text:
          '${_periodInMonths ? offer?.months ?? 1 : offer?.days ?? (widget.startAsTrial ? 1 : 30)}',
    );
    _accessIptv = TextEditingController(text: '${offer?.accessIptv ?? 1}');
    _accessNexus = TextEditingController(text: '${offer?.accessNexus ?? 0}');
    _country = TextEditingController(text: offer?.country ?? 'Brasil');
    _enabled = offer?.enabled ?? true;
    _isTrial = offer?.isTrial ?? widget.startAsTrial;
    _planId = offer?.planId ?? defaultPlan;
    _packageIptv = offer?.packageIptv ?? defaultIptv;
    _packageP2p = offer?.packageP2p.isNotEmpty == true
        ? offer!.packageP2p
        : defaultP2p;
    _addons = {...?offer?.addons};
    _imagePath = offer?.imagePath;
    _imageUrl = offer?.imageUrl;
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _price.dispose();
    _position.dispose();
    _period.dispose();
    _accessIptv.dispose();
    _accessNexus.dispose();
    _country.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.offer == null
        ? _isTrial
              ? 'Novo teste IPTV'
              : 'Novo plano IPTV'
        : 'Editar plano IPTV';
    final form = ListView(
      shrinkWrap: widget.embedded,
      primary: false,
      physics: widget.embedded ? const NeverScrollableScrollPhysics() : null,
      padding: const EdgeInsets.fromLTRB(2, 2, 2, 20),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _StoreProductImage(url: _imageUrl, size: 88),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  OutlinedButton.icon(
                    onPressed: _uploading || widget.busy ? null : _pickFile,
                    icon: const Icon(Icons.photo_camera_outlined),
                    label: Text(
                      _imageUrl == null ? 'Adicionar imagem' : 'Trocar imagem',
                    ),
                  ),
                  if (_imageUrl != null)
                    TextButton.icon(
                      onPressed: _uploading || widget.busy
                          ? null
                          : () => setState(() {
                              _imagePath = null;
                              _imageUrl = null;
                            }),
                      icon: const Icon(Icons.delete_outline_rounded),
                      label: const Text('Remover'),
                    ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _name,
          decoration: const InputDecoration(
            labelText: 'Nome comercial',
            prefixIcon: Icon(Icons.live_tv_outlined),
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _description,
          minLines: 3,
          maxLines: 6,
          decoration: const InputDecoration(
            labelText: 'Descrição exibida ao cliente',
            alignLabelWithHint: true,
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 520;
            final price = TextField(
              controller: _price,
              enabled: !_isTrial,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]')),
              ],
              decoration: InputDecoration(
                labelText: _isTrial ? 'Teste gratuito' : 'Preço',
                prefixText: 'R\$ ',
                border: const OutlineInputBorder(),
              ),
            );
            final position = TextField(
              controller: _position,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Posição',
                border: OutlineInputBorder(),
              ),
            );
            if (compact) {
              return Column(
                children: [price, const SizedBox(height: 12), position],
              );
            }
            return Row(
              children: [
                Expanded(child: price),
                const SizedBox(width: 12),
                SizedBox(width: 130, child: position),
              ],
            );
          },
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<int>(
          initialValue: _planId,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: 'Plano técnico WWPanel',
            border: OutlineInputBorder(),
          ),
          items: widget.settings.plans
              .map(
                (item) => DropdownMenuItem(
                  value: _mapInt(item, 'id', 0),
                  child: Text(_mapName(item), overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(growable: false),
          onChanged: (value) => setState(() => _planId = value ?? _planId),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<int>(
          initialValue: _packageIptv,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: 'Pacote IPTV',
            border: OutlineInputBorder(),
          ),
          items: widget.settings.iptvPackages
              .map(
                (item) => DropdownMenuItem(
                  value: _mapInt(item, 'id', 0),
                  child: Text(_mapName(item), overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(growable: false),
          onChanged: (value) =>
              setState(() => _packageIptv = value ?? _packageIptv),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _packageP2p,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: 'Pacote P2P',
            border: OutlineInputBorder(),
          ),
          items: widget.settings.p2pPackages
              .map(
                (item) => DropdownMenuItem(
                  value: item['id'].toString(),
                  child: Text(_mapName(item), overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(growable: false),
          onChanged: (value) =>
              setState(() => _packageP2p = value ?? _packageP2p),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _accessIptv,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'Telas IPTV',
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _accessNexus,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'Acessos Nexus',
                  border: OutlineInputBorder(),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _period,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  labelText: _isTrial
                      ? 'Duração do teste (dias)'
                      : _periodInMonths
                      ? 'Meses'
                      : 'Dias',
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            if (!_isTrial)
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('Dias')),
                  ButtonSegment(value: true, label: Text('Meses')),
                ],
                selected: {_periodInMonths},
                onSelectionChanged: (value) =>
                    setState(() => _periodInMonths = value.first),
              ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _country,
          decoration: const InputDecoration(
            labelText: 'País do cliente',
            prefixIcon: Icon(Icons.public_rounded),
            border: OutlineInputBorder(),
          ),
        ),
        if (widget.settings.addons.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Text(
            'Adicionais',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: widget.settings.addons
                .map((item) {
                  final id = _mapInt(item, 'id', 0);
                  return FilterChip(
                    label: Text(_mapName(item)),
                    selected: _addons.contains(id),
                    onSelected: (selected) => setState(() {
                      if (selected) {
                        _addons.add(id);
                      } else {
                        _addons.remove(id);
                      }
                    }),
                  );
                })
                .toList(growable: false),
          ),
        ],
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Oferta de teste'),
          subtitle: const Text('Cria uma linha de teste no WWPanel.'),
          value: _isTrial,
          onChanged: (value) => setState(() {
            _isTrial = value;
            if (value) {
              _periodInMonths = false;
              _period.text = '1';
              _price.text = '0';
            }
          }),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Exibir na Store'),
          value: _enabled,
          onChanged: (value) => setState(() => _enabled = value),
        ),
      ],
    );
    if (widget.embedded) {
      return _StoreEmbeddedEditor(
        title: title,
        subtitle: 'Defina preço, validade e pacote entregue após o pagamento.',
        onCancel: widget.onCancel,
        onSave: _submit,
        saveLabel: 'Salvar plano',
        saveIcon: Icons.save_outlined,
        busy: _uploading || widget.busy,
        child: form,
      );
    }
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 18),
      title: Text(title),
      content: SizedBox(
        width: 720,
        height: MediaQuery.sizeOf(context).height * .74,
        child: form,
      ),
      actions: [
        TextButton(
          onPressed: _uploading || widget.busy
              ? null
              : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _uploading || widget.busy ? null : _submit,
          icon: const Icon(Icons.save_outlined),
          label: const Text('Salvar plano'),
        ),
      ],
    );
  }

  Future<void> _pickFile() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        ),
      ],
    );
    if (file == null) return;
    setState(() => _uploading = true);
    try {
      final uploaded = await ref
          .read(apiClientProvider)
          .uploadBotStoreFile(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: _storeMimeType(file.name),
            kind: 'image',
            previousPath: _imagePath,
          );
      if (!mounted) return;
      setState(() {
        _imagePath = uploaded['path']?.toString();
        _imageUrl = uploaded['url']?.toString();
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final price = _isTrial
        ? 0.0
        : double.tryParse(_price.text.trim().replaceAll(',', '.'));
    final period = int.tryParse(_period.text.trim()) ?? 0;
    if (name.isEmpty) {
      showErrorToast(context, 'Informe o nome do plano IPTV.');
      return;
    }
    if (price == null || price < 0) {
      showErrorToast(context, 'Informe um preço válido.');
      return;
    }
    if (period <= 0) {
      showErrorToast(context, 'Informe a validade do plano.');
      return;
    }
    final draft = _WwPanelOfferDraft(
      id: widget.offer?.id,
      name: name,
      description: _description.text.trim(),
      priceCents: (price * 100).round(),
      imagePath: _imagePath,
      enabled: _enabled,
      position: int.tryParse(_position.text) ?? 0,
      isTrial: _isTrial,
      days: _periodInMonths ? null : period,
      months: _periodInMonths ? period : null,
      planId: _planId,
      packageP2p: _packageP2p,
      packageIptv: _packageIptv,
      accessIptv: int.tryParse(_accessIptv.text) ?? 1,
      accessNexus: int.tryParse(_accessNexus.text) ?? 0,
      addons: _addons.toList(growable: false),
      country: _country.text.trim().isEmpty ? 'Brasil' : _country.text.trim(),
    );
    if (widget.onSave != null) {
      await widget.onSave!(draft);
    } else if (mounted) {
      Navigator.of(context).pop(draft);
    }
  }
}

class _WwPanelClientActionDraft {
  const _WwPanelClientActionDraft({
    required this.payload,
    required this.successMessage,
  });

  final Map<String, Object?> payload;
  final String successMessage;
}

class _WwPanelClientActionDialog extends StatefulWidget {
  const _WwPanelClientActionDialog({
    required this.action,
    required this.client,
    required this.settings,
  });

  final String action;
  final BotStoreWwPanelClient client;
  final BotStoreWwPanelSettings settings;

  @override
  State<_WwPanelClientActionDialog> createState() =>
      _WwPanelClientActionDialogState();
}

class _WwPanelClientActionDialogState
    extends State<_WwPanelClientActionDialog> {
  final _period = TextEditingController(text: '1');
  final _password = TextEditingController();
  final _whatsapp = TextEditingController();
  final _country = TextEditingController(text: 'Brasil');
  final _notes = TextEditingController();
  final _saleValue = TextEditingController();
  final _accessIptv = TextEditingController(text: '1');
  final _accessNexus = TextEditingController(text: '0');
  final _mac = TextEditingController();
  final _playlist = TextEditingController();
  bool _periodInMonths = true;
  int _planId = 2;
  int _packageIptv = 30;
  String _packageP2p = '64399dca5ea59e8a1de2b083';
  final Set<int> _addons = {};
  String _app = 'Wapp';

  List<Map<String, dynamic>> get _plans => widget.settings.plans;
  List<Map<String, dynamic>> get _iptvPackages => widget.settings.iptvPackages;
  List<Map<String, dynamic>> get _p2pPackages => widget.settings.p2pPackages;
  List<Map<String, dynamic>> get _availableAddons => widget.settings.addons;
  List<String> get _apps =>
      widget.settings.apps.isEmpty ? const ['Wapp'] : widget.settings.apps;
  String _appType(String app) =>
      widget.settings.appTypes[app] == 'xstream' ? 'Xtream' : 'IPTV';

  int _id(Map<String, dynamic> item, int fallback) =>
      int.tryParse(item['id']?.toString() ?? '') ?? fallback;
  String _name(Map<String, dynamic> item) =>
      item['name']?.toString() ?? item['id'].toString();

  @override
  void initState() {
    super.initState();
    _whatsapp.text = widget.client.customerPhone ?? '';
    if (_plans.isNotEmpty) _planId = _id(_plans.first, 2);
    if (_iptvPackages.isNotEmpty) {
      _packageIptv = _id(_iptvPackages.first, 30);
    }
    if (_p2pPackages.isNotEmpty) {
      _packageP2p = _p2pPackages.first['id'].toString();
    }
    if (_apps.isNotEmpty) _app = _apps.first;
  }

  @override
  void dispose() {
    _period.dispose();
    _password.dispose();
    _whatsapp.dispose();
    _country.dispose();
    _notes.dispose();
    _saleValue.dispose();
    _accessIptv.dispose();
    _accessNexus.dispose();
    _mac.dispose();
    _playlist.dispose();
    super.dispose();
  }

  String get _title => switch (widget.action) {
    'renew_wwpanel_client' => 'Renovar acesso',
    'edit_wwpanel_client' => 'Editar cliente',
    'recreate_wwpanel_client' => 'Trocar senha',
    'manage_wwpanel_plan' => 'Plano e pacotes',
    'activate_wwpanel_app' => 'Ativar aplicativo',
    _ => 'Gerenciar acesso',
  };

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 24),
      title: Text(_title),
      content: SizedBox(
        width: 540,
        child: SingleChildScrollView(child: _fields()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.check_rounded),
          label: const Text('Confirmar'),
        ),
      ],
    );
  }

  Widget _fields() {
    switch (widget.action) {
      case 'renew_wwpanel_client':
        return Row(
          children: [
            Expanded(
              child: TextField(
                controller: _period,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  labelText: _periodInMonths ? 'Meses' : 'Dias',
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, label: Text('Dias')),
                ButtonSegment(value: true, label: Text('Meses')),
              ],
              selected: {_periodInMonths},
              onSelectionChanged: (value) =>
                  setState(() => _periodInMonths = value.first),
            ),
          ],
        );
      case 'edit_wwpanel_client':
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _whatsapp,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'WhatsApp',
                prefixIcon: Icon(Icons.phone_outlined),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _country,
              decoration: const InputDecoration(
                labelText: 'País',
                prefixIcon: Icon(Icons.public_rounded),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Nova senha (opcional)',
                prefixIcon: Icon(Icons.password_rounded),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _saleValue,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]')),
              ],
              decoration: const InputDecoration(
                labelText: 'Valor registrado no painel (opcional)',
                prefixText: 'R\$ ',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notes,
              minLines: 2,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Observações',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        );
      case 'recreate_wwpanel_client':
        return TextField(
          controller: _password,
          obscureText: true,
          decoration: const InputDecoration(
            labelText: 'Nova senha',
            prefixIcon: Icon(Icons.password_rounded),
            border: OutlineInputBorder(),
          ),
        );
      case 'manage_wwpanel_plan':
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<int>(
              initialValue: _planId,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Plano',
                border: OutlineInputBorder(),
              ),
              items: _plans
                  .map(
                    (item) => DropdownMenuItem(
                      value: _id(item, 0),
                      child: Text(_name(item), overflow: TextOverflow.ellipsis),
                    ),
                  )
                  .toList(growable: false),
              onChanged: (value) => setState(() => _planId = value ?? _planId),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              initialValue: _packageIptv,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Pacote IPTV',
                border: OutlineInputBorder(),
              ),
              items: _iptvPackages
                  .map(
                    (item) => DropdownMenuItem(
                      value: _id(item, 0),
                      child: Text(_name(item), overflow: TextOverflow.ellipsis),
                    ),
                  )
                  .toList(growable: false),
              onChanged: (value) =>
                  setState(() => _packageIptv = value ?? _packageIptv),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _packageP2p,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Pacote P2P',
                border: OutlineInputBorder(),
              ),
              items: _p2pPackages
                  .map(
                    (item) => DropdownMenuItem(
                      value: item['id'].toString(),
                      child: Text(_name(item), overflow: TextOverflow.ellipsis),
                    ),
                  )
                  .toList(growable: false),
              onChanged: (value) =>
                  setState(() => _packageP2p = value ?? _packageP2p),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _accessIptv,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(
                      labelText: 'Telas IPTV',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _accessNexus,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(
                      labelText: 'Nexus',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),
            if (_availableAddons.isNotEmpty) ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: Wrap(
                  spacing: 8,
                  children: _availableAddons
                      .map((item) {
                        final id = _id(item, 0);
                        return FilterChip(
                          label: Text(_name(item)),
                          selected: _addons.contains(id),
                          onSelected: (selected) => setState(() {
                            if (selected) {
                              _addons.add(id);
                            } else {
                              _addons.remove(id);
                            }
                          }),
                        );
                      })
                      .toList(growable: false),
                ),
              ),
            ],
          ],
        );
      case 'activate_wwpanel_app':
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _app,
              decoration: const InputDecoration(
                labelText: 'Aplicativo',
                border: OutlineInputBorder(),
              ),
              items: _apps
                  .map(
                    (app) => DropdownMenuItem(
                      value: app,
                      child: Text('$app · ${_appType(app)}'),
                    ),
                  )
                  .toList(growable: false),
              onChanged: (value) => setState(() => _app = value ?? _app),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _mac,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: 'MAC ou identificador',
                prefixIcon: Icon(Icons.pin_outlined),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _playlist,
              decoration: const InputDecoration(
                labelText: 'Nome da playlist',
                prefixIcon: Icon(Icons.playlist_play_rounded),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'O tipo de ativação é selecionado automaticamente para o aplicativo.',
                style: TextStyle(color: Color(0xFF667781), fontSize: 13),
              ),
            ),
          ],
        );
      default:
        return const Text('Ação indisponível.');
    }
  }

  void _submit() {
    Map<String, Object?> payload;
    String success;
    switch (widget.action) {
      case 'renew_wwpanel_client':
        final value = int.tryParse(_period.text) ?? 0;
        if (value <= 0) {
          showErrorToast(context, 'Informe a validade.');
          return;
        }
        payload = {if (_periodInMonths) 'months': value else 'days': value};
        success = 'Acesso renovado.';
      case 'edit_wwpanel_client':
        payload = {
          'whatsapp': _whatsapp.text.trim(),
          'country': _country.text.trim(),
          'password': _password.text,
          'notes': _notes.text.trim(),
          if (_saleValue.text.trim().isNotEmpty)
            'saleValue':
                double.tryParse(_saleValue.text.replaceAll(',', '.')) ?? 0,
        };
        success = 'Cliente IPTV atualizado.';
      case 'recreate_wwpanel_client':
        if (_password.text.trim().isEmpty) {
          showErrorToast(context, 'Informe a nova senha.');
          return;
        }
        payload = {'password': _password.text.trim()};
        success = 'Senha recriada.';
      case 'manage_wwpanel_plan':
        payload = {
          'planId': _planId,
          'packageIptv': _packageIptv,
          'packageP2p': _packageP2p,
          'accessIptv': int.tryParse(_accessIptv.text) ?? 1,
          'accessNexus': int.tryParse(_accessNexus.text) ?? 0,
          'addons': _addons.toList(growable: false),
        };
        success = 'Plano do acesso atualizado.';
      case 'activate_wwpanel_app':
        if (_mac.text.trim().isEmpty || _playlist.text.trim().isEmpty) {
          showErrorToast(context, 'Informe MAC e nome da playlist.');
          return;
        }
        payload = {
          'nameApp': _app,
          'mac': _mac.text.trim(),
          'namePlaylist': _playlist.text.trim(),
        };
        success = 'Aplicativo ativado.';
      default:
        return;
    }
    Navigator.of(
      context,
    ).pop(_WwPanelClientActionDraft(payload: payload, successMessage: success));
  }
}

class _StoreCategoryTile extends StatelessWidget {
  const _StoreCategoryTile({
    required this.category,
    required this.productCount,
    required this.selected,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  final BotStoreCategory category;
  final int productCount;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: selected ? wa.accentSoft : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        leading: category.imageUrl?.trim().isNotEmpty == true
            ? _StoreProductImage(url: category.imageUrl, size: 44)
            : CircleAvatar(
                backgroundColor: category.enabled
                    ? wa.accent.withValues(alpha: .12)
                    : wa.searchBg,
                child: Icon(
                  Icons.category_outlined,
                  color: category.enabled ? wa.accent : wa.textMuted,
                  size: 20,
                ),
              ),
        title: Text(
          category.name,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(
          '$productCount produto(s) · ${category.enabled ? 'visível' : 'oculta'}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: PopupMenuButton<String>(
          tooltip: 'Ações da categoria',
          onSelected: (action) => action == 'edit' ? onEdit() : onDelete(),
          itemBuilder: (context) => const [
            PopupMenuItem(value: 'edit', child: Text('Editar')),
            PopupMenuItem(value: 'delete', child: Text('Excluir')),
          ],
        ),
      ),
    );
  }
}

class _StoreProductTile extends StatelessWidget {
  const _StoreProductTile({
    required this.product,
    required this.selected,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  final BotStoreProduct product;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: selected ? wa.accentSoft : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        leading: _StoreProductImage(url: product.imageUrl, size: 48),
        title: Text(
          product.name,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          NumberFormat.simpleCurrency(locale: 'pt_BR').format(product.price),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StoreStockBadge(quantity: product.inventoryAvailable),
            PopupMenuButton<String>(
              onSelected: (action) => action == 'edit' ? onEdit() : onDelete(),
              itemBuilder: (context) => const [
                PopupMenuItem(value: 'edit', child: Text('Editar')),
                PopupMenuItem(value: 'delete', child: Text('Excluir')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StoreStockBadge extends StatelessWidget {
  const _StoreStockBadge({required this.quantity});

  final int quantity;

  @override
  Widget build(BuildContext context) {
    final (background, foreground, tooltip) = switch (quantity) {
      <= 0 => (Colors.red.shade50, Colors.red.shade800, 'Sem estoque'),
      <= 3 => (
        Colors.amber.shade100,
        Colors.orange.shade900,
        '$quantity restante${quantity == 1 ? '' : 's'}',
      ),
      _ => (
        Colors.green.shade50,
        Colors.green.shade800,
        '$quantity disponíveis',
      ),
    };
    return Tooltip(
      message: tooltip,
      child: Container(
        constraints: const BoxConstraints(minWidth: 32, minHeight: 28),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: foreground.withValues(alpha: .28)),
        ),
        child: Text(
          '$quantity',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: foreground,
            fontSize: 12,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }
}

class _StoreInventoryProductTile extends StatelessWidget {
  const _StoreInventoryProductTile({
    required this.product,
    required this.itemCount,
    required this.selected,
    required this.onTap,
  });

  final BotStoreProduct product;
  final int itemCount;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: selected ? wa.accentSoft : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        leading: _StoreProductImage(url: product.imageUrl, size: 48),
        title: Text(
          product.name,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(
          '$itemCount item(ns) cadastrado(s) · '
          '${product.inventoryAvailable} venda(s) disponível(is)',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StoreStockBadge(quantity: product.inventoryAvailable),
            const SizedBox(width: 4),
            Icon(Icons.chevron_right_rounded, color: wa.icon),
          ],
        ),
      ),
    );
  }
}

class _StoreInventoryProductDetail extends StatelessWidget {
  const _StoreInventoryProductDetail({
    required this.product,
    required this.items,
    required this.query,
    required this.onAdd,
    required this.onOpen,
    required this.onStatus,
    required this.onDelete,
  });

  final BotStoreProduct product;
  final List<BotStoreInventoryItem> items;
  final String query;
  final VoidCallback onAdd;
  final ValueChanged<BotStoreInventoryItem> onOpen;
  final ValueChanged<BotStoreInventoryItem> onStatus;
  final ValueChanged<BotStoreInventoryItem> onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final normalizedQuery = query.trim().toLowerCase();
    final visibleItems = items
        .where((item) {
          if (normalizedQuery.isEmpty) return true;
          return item.contentLabel.toLowerCase().contains(normalizedQuery) ||
              (item.deliveryValue ?? '').toLowerCase().contains(
                normalizedQuery,
              ) ||
              (item.deliveryFileName ?? '').toLowerCase().contains(
                normalizedQuery,
              );
        })
        .toList(growable: false);
    return ColoredBox(
      color: wa.panel,
      child: Column(
        children: [
          Material(
            color: wa.panel,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 12, 12),
              child: Row(
                children: [
                  _StoreProductImage(url: product.imageUrl, size: 52),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          product.name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '${product.inventoryAvailable} venda(s) disponível(is) em ${items.length} item(ns)',
                          style: TextStyle(color: wa.textMuted),
                        ),
                      ],
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: onAdd,
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Abastecer'),
                  ),
                ],
              ),
            ),
          ),
          Divider(height: 1, color: wa.border),
          Expanded(
            child: visibleItems.isEmpty
                ? const _SplitEmptyDetail(
                    icon: Icons.search_off_rounded,
                    title: 'Nenhum item encontrado',
                    subtitle:
                        'Altere a busca ou abasteça este produto com novos itens.',
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 28),
                    itemCount: visibleItems.length,
                    separatorBuilder: (_, _) =>
                        Divider(height: 1, color: wa.border),
                    itemBuilder: (context, index) {
                      final item = visibleItems[index];
                      return _StoreInventoryItemTile(
                        item: item,
                        product: product,
                        selected: false,
                        onTap: () => onOpen(item),
                        onEdit: () => onOpen(item),
                        onStatus: () => onStatus(item),
                        onDelete: () => onDelete(item),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _StoreInventoryItemTile extends StatelessWidget {
  const _StoreInventoryItemTile({
    required this.item,
    required this.product,
    required this.selected,
    required this.onTap,
    required this.onEdit,
    required this.onStatus,
    required this.onDelete,
  });

  final BotStoreInventoryItem item;
  final BotStoreProduct? product;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback? onEdit;
  final VoidCallback? onStatus;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final (icon, color, label) = switch (item.status) {
      'reserved' => (
        Icons.schedule_rounded,
        Colors.orange.shade700,
        'Reservado',
      ),
      'delivered' => (
        Icons.check_circle_outline_rounded,
        wa.accent,
        'Entregue',
      ),
      'disabled' => (
        Icons.pause_circle_outline_rounded,
        wa.textMuted,
        'Pausado',
      ),
      _ => (Icons.inventory_2_outlined, wa.accent, 'Disponível'),
    };
    return Material(
      color: selected ? wa.accentSoft : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: ListTile(
        dense: true,
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8),
        leading: Stack(
          clipBehavior: Clip.none,
          children: [
            _StoreProductImage(url: product?.imageUrl, size: 42),
            Positioned(
              right: -4,
              bottom: -4,
              child: CircleAvatar(
                radius: 10,
                backgroundColor: color,
                child: Icon(icon, color: Colors.white, size: 12),
              ),
            ),
          ],
        ),
        title: Text(
          _safeStoreInventoryLabel(item),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${product?.name ?? 'Produto removido'} · ${_storeInventoryTypeLabel(item.itemType)} · '
          '${item.remainingUses}/${item.maxUses} uso(s) · $label',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: onEdit == null && onStatus == null && onDelete == null
            ? null
            : PopupMenuButton<String>(
                onSelected: (action) {
                  if (action == 'edit') onEdit?.call();
                  if (action == 'status') onStatus?.call();
                  if (action == 'delete') onDelete?.call();
                },
                itemBuilder: (context) => [
                  if (onEdit != null)
                    const PopupMenuItem(value: 'edit', child: Text('Editar')),
                  if (onStatus != null)
                    PopupMenuItem(
                      value: 'status',
                      child: Text(
                        item.status == 'disabled' ? 'Reativar' : 'Pausar',
                      ),
                    ),
                  if (onDelete != null)
                    const PopupMenuItem(
                      value: 'delete',
                      child: Text('Excluir'),
                    ),
                ],
              ),
      ),
    );
  }
}

String _safeStoreInventoryLabel(BotStoreInventoryItem item) {
  final label = item.label?.trim();
  if (label != null && label.isNotEmpty) return label;
  final file = item.deliveryFileName?.trim();
  if (file != null && file.isNotEmpty) return file;
  return '${_storeInventoryTypeLabel(item.itemType)} #${item.id}';
}

class _StoreCustomerTile extends StatelessWidget {
  const _StoreCustomerTile({
    required this.customer,
    required this.selected,
    required this.onTap,
    required this.onEdit,
  });

  final BotStoreCustomer customer;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final avatar = customer.avatarUrl?.trim();
    return Material(
      color: selected ? wa.accentSoft : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        leading: _MigrationCircleAvatar(
          url: avatar,
          radius: 23,
          backgroundColor: wa.searchBg,
          icon: Icons.person_outline_rounded,
          iconColor: wa.icon,
        ),
        title: Row(
          children: [
            Flexible(
              child: Text(
                customer.displayName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
            if (customer.blocked) ...[
              const SizedBox(width: 6),
              Icon(Icons.block_rounded, size: 16, color: Colors.red.shade700),
            ],
          ],
        ),
        subtitle: Text(
          '${customer.customerPhone ?? customer.customerJid} · '
          '${customer.ordersCount} compra(s)',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              NumberFormat.simpleCurrency(
                locale: 'pt_BR',
              ).format(customer.balance),
              style: TextStyle(
                color: customer.balanceCents < 0
                    ? Colors.red.shade700
                    : wa.accent,
                fontWeight: FontWeight.w900,
              ),
            ),
            IconButton(
              onPressed: onEdit,
              icon: const Icon(Icons.more_vert_rounded),
              tooltip: 'Gerenciar cliente',
            ),
          ],
        ),
      ),
    );
  }
}

class _StoreProductImage extends StatelessWidget {
  const _StoreProductImage({required this.url, this.size = 62});

  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final image = url?.trim();
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: SizedBox(
        width: size,
        height: size,
        child: image == null || image.isEmpty
            ? ColoredBox(
                color: wa.searchBg,
                child: Icon(Icons.inventory_2_outlined, color: wa.icon),
              )
            : BotAdminCachedImage(
                imageUrl: image,
                fit: BoxFit.cover,
                fadeInDuration: const Duration(milliseconds: 100),
                errorWidget: (_, _, _) => ColoredBox(
                  color: wa.searchBg,
                  child: Icon(Icons.broken_image_outlined, color: wa.icon),
                ),
              ),
      ),
    );
  }
}

class _StorePreviewPane extends StatelessWidget {
  const _StorePreviewPane({
    required this.snapshot,
    required this.product,
    required this.onEditProduct,
  });

  final BotStoreSnapshot snapshot;
  final BotStoreProduct? product;
  final VoidCallback? onEditProduct;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final item = product;
    return ColoredBox(
      color: wa.panel,
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 430),
            child: Column(
              children: [
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: wa.bubbleIn,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(4),
                      topRight: Radius.circular(8),
                      bottomLeft: Radius.circular(8),
                      bottomRight: Radius.circular(8),
                    ),
                    boxShadow: const [
                      BoxShadow(color: Color(0x18000000), blurRadius: 2),
                    ],
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if ((item?.imageUrl ?? snapshot.store.imageUrl)
                                ?.trim()
                                .isNotEmpty ==
                            true)
                          ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: AspectRatio(
                              aspectRatio: 16 / 10,
                              child: BotAdminCachedImage(
                                imageUrl:
                                    item?.imageUrl ?? snapshot.store.imageUrl!,
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(8, 9, 8, 6),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item?.name ?? snapshot.store.name,
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              if ((item?.description ??
                                          snapshot.store.description)
                                      ?.trim()
                                      .isNotEmpty ==
                                  true) ...[
                                const SizedBox(height: 5),
                                Text(
                                  item?.description ??
                                      snapshot.store.description!,
                                ),
                              ],
                              if (item != null) ...[
                                const SizedBox(height: 9),
                                Text(
                                  NumberFormat.simpleCurrency(
                                    locale: 'pt_BR',
                                  ).format(item.price),
                                  style: TextStyle(
                                    color: wa.accent,
                                    fontWeight: FontWeight.w900,
                                    fontSize: 16,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  'Estoque disponível: ${item.inventoryAvailable}',
                                  style: TextStyle(color: wa.textMuted),
                                ),
                              ],
                            ],
                          ),
                        ),
                        Divider(height: 1, color: wa.divider),
                        TextButton.icon(
                          onPressed: onEditProduct,
                          icon: const Icon(Icons.shopping_bag_outlined),
                          label: Text(
                            item == null
                                ? 'Escolha um produto'
                                : 'Comprar agora',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  item == null
                      ? 'Selecione um produto para conferir o balão enviado no WhatsApp.'
                      : 'Prévia da experiência no privado do robô.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: wa.textMuted),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StoreSettingsDraft {
  const _StoreSettingsDraft({
    required this.enabled,
    required this.autoOpenPrivate,
    required this.name,
    required this.description,
    required this.imagePath,
    required this.commands,
    required this.paymentProvider,
    required this.rootMenu,
    required this.categoryMenu,
    required this.productMenu,
    required this.iptvMenu,
    required this.smmMenu,
    required this.deliveryMenu,
  });

  final bool enabled;
  final bool autoOpenPrivate;
  final String name;
  final String description;
  final String? imagePath;
  final List<String> commands;
  final String paymentProvider;
  final _StoreMenuDraft rootMenu;
  final _StoreMenuDraft categoryMenu;
  final _StoreMenuDraft productMenu;
  final _StoreMenuDraft iptvMenu;
  final _StoreMenuDraft smmMenu;
  final _StoreMenuDraft deliveryMenu;

  Map<String, Object?> toJson() => {
    'enabled': enabled,
    'autoOpenPrivate': autoOpenPrivate,
    'name': name,
    'description': description,
    'imagePath': imagePath,
    'commands': commands,
    'paymentProvider': paymentProvider,
    'menuConfig': {
      'root': rootMenu.toJson(),
      'category': categoryMenu.toJson(),
      'product': productMenu.toJson(),
      'iptv': iptvMenu.toJson(),
      'smm': smmMenu.toJson(),
      'delivery': deliveryMenu.toJson(),
    },
  };
}

class _StoreMenuDraft {
  const _StoreMenuDraft({
    required this.title,
    required this.body,
    required this.footer,
    required this.listButton,
    this.imagePath,
    this.imageUrl,
    this.buyButton,
    this.backButton,
    this.categoryRow,
    this.productRow,
    this.trialUsedBody,
    this.trialUsedButton,
    this.macPromptBody,
    this.macAccessBody,
    this.macAccessButton,
    this.macAppBody,
    this.macAppButton,
    this.appActivatedBody,
    this.linkPromptBody,
    this.quantityPromptBody,
    this.detailsPromptBody,
    this.orderSummaryBody,
    this.orderCreatedBody,
    this.statusBody,
  });

  factory _StoreMenuDraft.fromModel(BotStoreMenuTemplate value) =>
      _StoreMenuDraft(
        title: value.title,
        body: value.body,
        footer: value.footer,
        listButton: value.listButton,
        imagePath: value.imagePath,
        imageUrl: value.imageUrl,
        buyButton: value.buyButton,
        backButton: value.backButton,
        categoryRow: value.categoryRow,
        productRow: value.productRow,
        trialUsedBody: value.trialUsedBody,
        trialUsedButton: value.trialUsedButton,
        macPromptBody: value.macPromptBody,
        macAccessBody: value.macAccessBody,
        macAccessButton: value.macAccessButton,
        macAppBody: value.macAppBody,
        macAppButton: value.macAppButton,
        appActivatedBody: value.appActivatedBody,
        linkPromptBody: value.linkPromptBody,
        quantityPromptBody: value.quantityPromptBody,
        detailsPromptBody: value.detailsPromptBody,
        orderSummaryBody: value.orderSummaryBody,
        orderCreatedBody: value.orderCreatedBody,
        statusBody: value.statusBody,
      );

  final String title;
  final String body;
  final String footer;
  final String listButton;
  final String? imagePath;
  final String? imageUrl;
  final String? buyButton;
  final String? backButton;
  final String? categoryRow;
  final String? productRow;
  final String? trialUsedBody;
  final String? trialUsedButton;
  final String? macPromptBody;
  final String? macAccessBody;
  final String? macAccessButton;
  final String? macAppBody;
  final String? macAppButton;
  final String? appActivatedBody;
  final String? linkPromptBody;
  final String? quantityPromptBody;
  final String? detailsPromptBody;
  final String? orderSummaryBody;
  final String? orderCreatedBody;
  final String? statusBody;

  _StoreMenuDraft copyWith({
    String? title,
    String? body,
    String? footer,
    String? listButton,
    String? imagePath,
    String? imageUrl,
    bool clearImage = false,
    String? buyButton,
    String? backButton,
    String? categoryRow,
    String? productRow,
    String? trialUsedBody,
    String? trialUsedButton,
    String? macPromptBody,
    String? macAccessBody,
    String? macAccessButton,
    String? macAppBody,
    String? macAppButton,
    String? appActivatedBody,
    String? linkPromptBody,
    String? quantityPromptBody,
    String? detailsPromptBody,
    String? orderSummaryBody,
    String? orderCreatedBody,
    String? statusBody,
  }) => _StoreMenuDraft(
    title: title ?? this.title,
    body: body ?? this.body,
    footer: footer ?? this.footer,
    listButton: listButton ?? this.listButton,
    imagePath: clearImage ? null : imagePath ?? this.imagePath,
    imageUrl: clearImage ? null : imageUrl ?? this.imageUrl,
    buyButton: buyButton ?? this.buyButton,
    backButton: backButton ?? this.backButton,
    categoryRow: categoryRow ?? this.categoryRow,
    productRow: productRow ?? this.productRow,
    trialUsedBody: trialUsedBody ?? this.trialUsedBody,
    trialUsedButton: trialUsedButton ?? this.trialUsedButton,
    macPromptBody: macPromptBody ?? this.macPromptBody,
    macAccessBody: macAccessBody ?? this.macAccessBody,
    macAccessButton: macAccessButton ?? this.macAccessButton,
    macAppBody: macAppBody ?? this.macAppBody,
    macAppButton: macAppButton ?? this.macAppButton,
    appActivatedBody: appActivatedBody ?? this.appActivatedBody,
    linkPromptBody: linkPromptBody ?? this.linkPromptBody,
    quantityPromptBody: quantityPromptBody ?? this.quantityPromptBody,
    detailsPromptBody: detailsPromptBody ?? this.detailsPromptBody,
    orderSummaryBody: orderSummaryBody ?? this.orderSummaryBody,
    orderCreatedBody: orderCreatedBody ?? this.orderCreatedBody,
    statusBody: statusBody ?? this.statusBody,
  );

  Map<String, Object?> toJson() => {
    'title': title,
    'body': body,
    'footer': footer,
    'listButton': listButton,
    'imagePath': imagePath,
    'buyButton': buyButton,
    'backButton': backButton,
    'categoryRow': categoryRow,
    'productRow': productRow,
    'trialUsedBody': trialUsedBody,
    'trialUsedButton': trialUsedButton,
    'macPromptBody': macPromptBody,
    'macAccessBody': macAccessBody,
    'macAccessButton': macAccessButton,
    'macAppBody': macAppBody,
    'macAppButton': macAppButton,
    'appActivatedBody': appActivatedBody,
    'linkPromptBody': linkPromptBody,
    'quantityPromptBody': quantityPromptBody,
    'detailsPromptBody': detailsPromptBody,
    'orderSummaryBody': orderSummaryBody,
    'orderCreatedBody': orderCreatedBody,
    'statusBody': statusBody,
  };
}

enum _StoreMenuKind { root, category, product, iptv, smm, delivery }

enum _StoreMenuField {
  title,
  body,
  footer,
  listButton,
  buyButton,
  backButton,
  categoryRow,
  productRow,
  trialUsedBody,
  trialUsedButton,
  macPromptBody,
  macAccessBody,
  macAccessButton,
  macAppBody,
  macAppButton,
  appActivatedBody,
  linkPromptBody,
  quantityPromptBody,
  detailsPromptBody,
  orderSummaryBody,
  orderCreatedBody,
  statusBody,
}

const _storeVariableDescriptions = <String, String>{
  '{{pushname}}': 'Nome público recebido diretamente do WhatsApp.',
  '{{nome_cliente}}': 'Nome salvo do cliente ou nome recebido do WhatsApp.',
  '{{numero_cliente}}': 'Número do WhatsApp que está falando com a Store.',
  '{{saldo_cliente}}': 'Saldo atual do cliente, já formatado em reais.',
  '{{store}}': 'Nome configurado para esta Store.',
  '{{description}}': 'Descrição da Store, categoria ou produto atual.',
  '{{category}}': 'Nome da categoria que o cliente selecionou.',
  '{{product}}': 'Nome do produto exibido na opção.',
  '{{price}}': 'Preço do produto já formatado em reais.',
  '{{stock}}': 'Situação atual do estoque ou da entrega digital.',
  '{{count}}': 'Quantidade de produtos disponíveis na categoria.',
  '{{countLabel}}': 'Texto produto ou produtos conforme a quantidade.',
  '{{produto}}': 'Nome do produto que foi comprado.',
  '{{valor}}': 'Valor pago, já formatado em reais.',
  '{{data_compra}}': 'Data e hora em que o pedido foi criado.',
  '{{dados}}': 'Conteúdo real retirado do estoque para esta entrega.',
  '{{pedido}}': 'Identificador curto do pedido.',
  '{{validity}}': 'Validade comercial configurada para o plano IPTV.',
  '{{screens}}': 'Quantidade de telas incluídas no plano IPTV.',
  '{{plan_count}}': 'Quantidade de planos e testes IPTV disponíveis.',
  '{{access_count}}': 'Quantidade de acessos IPTV deste cliente.',
  '{{app}}': 'Nome do aplicativo IPTV selecionado.',
  '{{usuario}}': 'Usuário do acesso IPTV selecionado.',
  '{{mac}}': 'MAC ou identificador informado pelo cliente.',
  '{{service}}': 'Nome do serviço SMM selecionado.',
  '{{target}}': 'Link, perfil ou página informada pelo cliente.',
  '{{quantity}}': 'Quantidade solicitada para o serviço.',
  '{{min}}': 'Quantidade mínima aceita pelo fornecedor.',
  '{{max}}': 'Quantidade máxima aceita pelo fornecedor.',
  '{{status}}': 'Status atual retornado pelo painel SMM.',
  '{{remains}}': 'Quantidade restante informada pelo painel SMM.',
  '{{instructions}}': 'Orientação específica conforme o tipo do serviço.',
};

List<String> _storeVariablesFor(_StoreMenuKind kind, _StoreMenuField field) {
  final variables = <String>[
    '{{pushname}}',
    '{{nome_cliente}}',
    '{{numero_cliente}}',
    '{{saldo_cliente}}',
    '{{store}}',
  ];
  switch (kind) {
    case _StoreMenuKind.root:
      variables.add('{{description}}');
      if (field == _StoreMenuField.categoryRow) {
        variables.addAll(['{{category}}', '{{count}}', '{{countLabel}}']);
      }
      if (field == _StoreMenuField.productRow) {
        variables.addAll(['{{product}}', '{{price}}', '{{stock}}']);
      }
      break;
    case _StoreMenuKind.category:
      variables.addAll(['{{category}}', '{{description}}']);
      if (field == _StoreMenuField.productRow) {
        variables.addAll(['{{product}}', '{{price}}', '{{stock}}']);
      }
      break;
    case _StoreMenuKind.product:
      variables.addAll([
        '{{product}}',
        '{{description}}',
        '{{price}}',
        '{{stock}}',
      ]);
      break;
    case _StoreMenuKind.iptv:
      variables.addAll([
        '{{product}}',
        '{{description}}',
        '{{price}}',
        '{{validity}}',
        '{{screens}}',
        '{{plan_count}}',
        '{{access_count}}',
        '{{app}}',
        '{{usuario}}',
        '{{mac}}',
      ]);
      break;
    case _StoreMenuKind.smm:
      variables.addAll([
        '{{service}}',
        '{{category}}',
        '{{target}}',
        '{{quantity}}',
        '{{min}}',
        '{{max}}',
        '{{price}}',
        '{{status}}',
        '{{remains}}',
        '{{instructions}}',
        '{{pedido}}',
        '{{count}}',
        '{{countLabel}}',
      ]);
      break;
    case _StoreMenuKind.delivery:
      variables.addAll([
        '{{produto}}',
        '{{valor}}',
        '{{data_compra}}',
        '{{dados}}',
        '{{pedido}}',
      ]);
      break;
  }
  return variables.toSet().toList();
}

class _StoreSettingsDialog extends ConsumerStatefulWidget {
  const _StoreSettingsDialog({required this.store});

  final BotStoreSettings store;

  @override
  ConsumerState<_StoreSettingsDialog> createState() =>
      _StoreSettingsDialogState();
}

class _StoreSettingsDialogState extends ConsumerState<_StoreSettingsDialog> {
  late final TextEditingController _name;
  late final TextEditingController _description;
  late final TextEditingController _commands;
  late bool _enabled;
  late bool _autoOpenPrivate;
  late String _provider;
  late _StoreMenuDraft _rootMenu;
  late _StoreMenuDraft _categoryMenu;
  late _StoreMenuDraft _productMenu;
  late _StoreMenuDraft _iptvMenu;
  late _StoreMenuDraft _smmMenu;
  late _StoreMenuDraft _deliveryMenu;
  _StoreMenuKind _selectedMenuKind = _StoreMenuKind.root;
  String? _imagePath;
  String? _imageUrl;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.store.name);
    _description = TextEditingController(text: widget.store.description);
    _commands = TextEditingController(text: widget.store.commands.join(', '));
    _enabled = widget.store.enabled;
    _autoOpenPrivate = widget.store.autoOpenPrivate;
    _provider = widget.store.paymentProvider ?? 'mercadopago_pix';
    _rootMenu = _StoreMenuDraft.fromModel(widget.store.rootMenu);
    _categoryMenu = _StoreMenuDraft.fromModel(widget.store.categoryMenu);
    _productMenu = _StoreMenuDraft.fromModel(widget.store.productMenu);
    _iptvMenu = _StoreMenuDraft.fromModel(widget.store.iptvMenu);
    _smmMenu = _StoreMenuDraft.fromModel(widget.store.smmMenu);
    _deliveryMenu = _StoreMenuDraft.fromModel(widget.store.deliveryMenu);
    _imagePath = widget.store.imagePath;
    _imageUrl = widget.store.imageUrl;
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _commands.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final viewport = MediaQuery.sizeOf(context);
    final compact = viewport.width < 700;
    return AlertDialog(
      insetPadding: EdgeInsets.symmetric(
        horizontal: compact ? 12 : 32,
        vertical: 24,
      ),
      title: const Text('Configurar Store'),
      content: SizedBox(
        width: compact ? viewport.width - 48 : 980,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Atender no privado'),
                subtitle: const Text('Ativa a Store neste número do WhatsApp.'),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Qualquer mensagem abre a loja'),
                subtitle: const Text(
                  'Desative para responder apenas aos comandos configurados.',
                ),
                value: _autoOpenPrivate,
                onChanged: _enabled
                    ? (value) => setState(() => _autoOpenPrivate = value)
                    : null,
              ),
              Row(
                children: [
                  _StoreProductImage(url: _imageUrl, size: 68),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        OutlinedButton.icon(
                          onPressed: _uploading ? null : _pickStoreImage,
                          icon: _uploading
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.add_photo_alternate_outlined),
                          label: Text(
                            _imageUrl?.trim().isNotEmpty == true
                                ? 'Trocar capa da Store'
                                : 'Adicionar capa da Store',
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Esta capa identifica a Store no painel. Ela não é '
                          'enviada nos menus sem você escolhê-la no balão.',
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
              const SizedBox(height: 12),
              TextField(
                controller: _name,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Nome da loja',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _description,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Apresentação',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _commands,
                decoration: const InputDecoration(
                  labelText: 'Comandos separados por vírgula',
                  hintText: 'loja, store, catalogo',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _provider,
                decoration: const InputDecoration(
                  labelText: 'Recebimento local',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(
                    value: 'mercadopago_pix',
                    child: Text('Mercado Pago Pix'),
                  ),
                  DropdownMenuItem(
                    value: 'polopag_pix',
                    child: Text('PoloPag Pix'),
                  ),
                ],
                onChanged: (value) =>
                    setState(() => _provider = value ?? _provider),
              ),
              const SizedBox(height: 22),
              const Divider(),
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Menus da Store',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(height: 4),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Edite exatamente o que o cliente recebe no WhatsApp.',
                  style: TextStyle(color: WaTheme.of(context).textMuted),
                ),
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children:
                      const [
                            (_StoreMenuKind.root, 'Inicial'),
                            (_StoreMenuKind.category, 'Categorias'),
                            (_StoreMenuKind.product, 'Produto'),
                            (_StoreMenuKind.iptv, 'IPTV'),
                            (_StoreMenuKind.smm, 'SMM'),
                            (_StoreMenuKind.delivery, 'Entrega'),
                          ]
                          .map((entry) {
                            return ChoiceChip(
                              label: Text(entry.$2),
                              selected: _selectedMenuKind == entry.$1,
                              onSelected: (_) =>
                                  setState(() => _selectedMenuKind = entry.$1),
                            );
                          })
                          .toList(growable: false),
                ),
              ),
              const SizedBox(height: 14),
              _buildSelectedMenuPreview(),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'As variáveis disponíveis são explicadas dentro de cada lápis.',
                  style: TextStyle(
                    color: WaTheme.of(context).textMuted,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _uploading || _name.text.trim().isEmpty
              ? null
              : () => Navigator.of(context).pop(
                  _StoreSettingsDraft(
                    enabled: _enabled,
                    autoOpenPrivate: _autoOpenPrivate,
                    name: _name.text.trim(),
                    description: _description.text.trim(),
                    imagePath: _imagePath,
                    commands: _commands.text
                        .split(',')
                        .map((value) => value.trim().toLowerCase())
                        .where((value) => value.isNotEmpty)
                        .toSet()
                        .toList(),
                    paymentProvider: _provider,
                    rootMenu: _rootMenu,
                    categoryMenu: _categoryMenu,
                    productMenu: _productMenu,
                    iptvMenu: _iptvMenu,
                    smmMenu: _smmMenu,
                    deliveryMenu: _deliveryMenu,
                  ),
                ),
          child: const Text('Salvar'),
        ),
      ],
    );
  }

  Widget _buildSelectedMenuPreview() {
    final kind = _selectedMenuKind;
    final menu = _menuFor(kind);
    final label = switch (kind) {
      _StoreMenuKind.root => 'Menu inicial',
      _StoreMenuKind.category => 'Lista da categoria',
      _StoreMenuKind.product => 'Produto e compra',
      _StoreMenuKind.iptv => 'Planos, testes e acessos IPTV',
      _StoreMenuKind.smm => 'Serviços e pedidos SMM',
      _StoreMenuKind.delivery => 'Entrega do produto',
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _StoreMenuPreviewCard(
          label: label,
          kind: kind,
          menu: menu,
          storeName: _name.text.trim(),
          storeDescription: _description.text.trim(),
          uploading: kind == _StoreMenuKind.delivery ? false : _uploading,
          onEdit: (field) => _editMenuField(kind, field),
          onImage: kind == _StoreMenuKind.delivery
              ? () {}
              : () => _pickMenuImage(kind),
          onDeleteImage: menu.imageUrl == null
              ? null
              : () => _setMenu(kind, menu.copyWith(clearImage: true)),
        ),
        if (kind == _StoreMenuKind.iptv) ...[
          const SizedBox(height: 20),
          Text(
            'Mensagens automáticas IPTV',
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'Edite os retornos do teste e da ativação por MAC.',
            style: TextStyle(color: WaTheme.of(context).textMuted),
          ),
          const SizedBox(height: 10),
          _StoreIptvAutomationPreview(
            menu: menu,
            onEdit: (field) => _editMenuField(kind, field),
          ),
        ],
        if (kind == _StoreMenuKind.smm) ...[
          const SizedBox(height: 20),
          Text(
            'Mensagens automáticas SMM',
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'Personalize cada etapa da compra e do acompanhamento do pedido.',
            style: TextStyle(color: WaTheme.of(context).textMuted),
          ),
          const SizedBox(height: 10),
          _StoreSmmAutomationPreview(
            menu: menu,
            onEdit: (field) => _editMenuField(kind, field),
          ),
        ],
      ],
    );
  }

  Future<void> _pickStoreImage() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        ),
      ],
    );
    if (file == null) return;
    setState(() => _uploading = true);
    try {
      final uploaded = await ref
          .read(apiClientProvider)
          .uploadBotStoreFile(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: _storeMimeType(file.name),
            kind: 'image',
          );
      if (!mounted) return;
      setState(() {
        _imagePath = uploaded['path']?.toString();
        _imageUrl = uploaded['url']?.toString();
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  _StoreMenuDraft _menuFor(_StoreMenuKind kind) => switch (kind) {
    _StoreMenuKind.root => _rootMenu,
    _StoreMenuKind.category => _categoryMenu,
    _StoreMenuKind.product => _productMenu,
    _StoreMenuKind.iptv => _iptvMenu,
    _StoreMenuKind.smm => _smmMenu,
    _StoreMenuKind.delivery => _deliveryMenu,
  };

  void _setMenu(_StoreMenuKind kind, _StoreMenuDraft value) {
    setState(() {
      switch (kind) {
        case _StoreMenuKind.root:
          _rootMenu = value;
          break;
        case _StoreMenuKind.category:
          _categoryMenu = value;
          break;
        case _StoreMenuKind.product:
          _productMenu = value;
          break;
        case _StoreMenuKind.iptv:
          _iptvMenu = value;
          break;
        case _StoreMenuKind.smm:
          _smmMenu = value;
          break;
        case _StoreMenuKind.delivery:
          _deliveryMenu = value;
          break;
      }
    });
  }

  Future<void> _editMenuField(
    _StoreMenuKind kind,
    _StoreMenuField field,
  ) async {
    final menu = _menuFor(kind);
    final current = switch (field) {
      _StoreMenuField.title => menu.title,
      _StoreMenuField.body => menu.body,
      _StoreMenuField.footer => menu.footer,
      _StoreMenuField.listButton => menu.listButton,
      _StoreMenuField.buyButton => menu.buyButton ?? '',
      _StoreMenuField.backButton => menu.backButton ?? '',
      _StoreMenuField.categoryRow => menu.categoryRow ?? '',
      _StoreMenuField.productRow => menu.productRow ?? '',
      _StoreMenuField.trialUsedBody => menu.trialUsedBody ?? '',
      _StoreMenuField.trialUsedButton => menu.trialUsedButton ?? '',
      _StoreMenuField.macPromptBody => menu.macPromptBody ?? '',
      _StoreMenuField.macAccessBody => menu.macAccessBody ?? '',
      _StoreMenuField.macAccessButton => menu.macAccessButton ?? '',
      _StoreMenuField.macAppBody => menu.macAppBody ?? '',
      _StoreMenuField.macAppButton => menu.macAppButton ?? '',
      _StoreMenuField.appActivatedBody => menu.appActivatedBody ?? '',
      _StoreMenuField.linkPromptBody => menu.linkPromptBody ?? '',
      _StoreMenuField.quantityPromptBody => menu.quantityPromptBody ?? '',
      _StoreMenuField.detailsPromptBody => menu.detailsPromptBody ?? '',
      _StoreMenuField.orderSummaryBody => menu.orderSummaryBody ?? '',
      _StoreMenuField.orderCreatedBody => menu.orderCreatedBody ?? '',
      _StoreMenuField.statusBody => menu.statusBody ?? '',
    };
    final labels = {
      _StoreMenuField.title: 'Título',
      _StoreMenuField.body: 'Texto',
      _StoreMenuField.footer: 'Rodapé',
      _StoreMenuField.listButton: 'Botão da lista',
      _StoreMenuField.buyButton: 'Botão de compra',
      _StoreMenuField.backButton: 'Botão de voltar',
      _StoreMenuField.categoryRow: 'Linha da categoria',
      _StoreMenuField.productRow: 'Linha do produto',
      _StoreMenuField.trialUsedBody: 'Teste já utilizado',
      _StoreMenuField.trialUsedButton: 'Botão de voltar do teste',
      _StoreMenuField.macPromptBody: 'Pedido do endereço MAC',
      _StoreMenuField.macAccessBody: 'Seleção do acesso IPTV',
      _StoreMenuField.macAccessButton: 'Botão de escolher acesso',
      _StoreMenuField.macAppBody: 'Seleção do aplicativo',
      _StoreMenuField.macAppButton: 'Botão de escolher aplicativo',
      _StoreMenuField.appActivatedBody: 'Confirmação da ativação',
      _StoreMenuField.linkPromptBody: 'Solicitação do link',
      _StoreMenuField.quantityPromptBody: 'Solicitação da quantidade',
      _StoreMenuField.detailsPromptBody: 'Detalhes adicionais',
      _StoreMenuField.orderSummaryBody: 'Resumo antes do pagamento',
      _StoreMenuField.orderCreatedBody: 'Pedido criado',
      _StoreMenuField.statusBody: 'Status do pedido',
    };
    final controller = TextEditingController(text: current);
    final variables = _storeVariablesFor(kind, field);
    final multiline = {
      _StoreMenuField.body,
      _StoreMenuField.trialUsedBody,
      _StoreMenuField.macPromptBody,
      _StoreMenuField.macAccessBody,
      _StoreMenuField.macAppBody,
      _StoreMenuField.appActivatedBody,
      _StoreMenuField.linkPromptBody,
      _StoreMenuField.quantityPromptBody,
      _StoreMenuField.detailsPromptBody,
      _StoreMenuField.orderSummaryBody,
      _StoreMenuField.orderCreatedBody,
      _StoreMenuField.statusBody,
    }.contains(field);
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(labels[field]!),
        content: SizedBox(
          width: 660,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: controller,
                  autofocus: true,
                  minLines: multiline ? 5 : 1,
                  maxLines: multiline ? 12 : 4,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    hintText: 'Digite o texto que aparecerá no WhatsApp',
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Variáveis disponíveis',
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: WaTheme.of(context).panel,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: WaTheme.of(context).divider),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (
                          var index = 0;
                          index < variables.length;
                          index++
                        ) ...[
                          _StoreVariableDescription(
                            token: variables[index],
                            description:
                                _storeVariableDescriptions[variables[index]] ??
                                '',
                            onInsert: () {
                              final token = variables[index];
                              final selection = controller.selection;
                              final start = selection.isValid
                                  ? selection.start
                                  : controller.text.length;
                              final end = selection.isValid
                                  ? selection.end
                                  : controller.text.length;
                              controller.value = controller.value.copyWith(
                                text: controller.text.replaceRange(
                                  start,
                                  end,
                                  token,
                                ),
                                selection: TextSelection.collapsed(
                                  offset: start + token.length,
                                ),
                              );
                            },
                          ),
                          if (index < variables.length - 1)
                            Divider(
                              height: 17,
                              color: WaTheme.of(context).divider,
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
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Aplicar'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (value == null || !mounted) return;
    _setMenu(kind, switch (field) {
      _StoreMenuField.title => menu.copyWith(title: value),
      _StoreMenuField.body => menu.copyWith(body: value),
      _StoreMenuField.footer => menu.copyWith(footer: value),
      _StoreMenuField.listButton => menu.copyWith(listButton: value),
      _StoreMenuField.buyButton => menu.copyWith(buyButton: value),
      _StoreMenuField.backButton => menu.copyWith(backButton: value),
      _StoreMenuField.categoryRow => menu.copyWith(categoryRow: value),
      _StoreMenuField.productRow => menu.copyWith(productRow: value),
      _StoreMenuField.trialUsedBody => menu.copyWith(trialUsedBody: value),
      _StoreMenuField.trialUsedButton => menu.copyWith(trialUsedButton: value),
      _StoreMenuField.macPromptBody => menu.copyWith(macPromptBody: value),
      _StoreMenuField.macAccessBody => menu.copyWith(macAccessBody: value),
      _StoreMenuField.macAccessButton => menu.copyWith(macAccessButton: value),
      _StoreMenuField.macAppBody => menu.copyWith(macAppBody: value),
      _StoreMenuField.macAppButton => menu.copyWith(macAppButton: value),
      _StoreMenuField.appActivatedBody => menu.copyWith(
        appActivatedBody: value,
      ),
      _StoreMenuField.linkPromptBody => menu.copyWith(linkPromptBody: value),
      _StoreMenuField.quantityPromptBody => menu.copyWith(
        quantityPromptBody: value,
      ),
      _StoreMenuField.detailsPromptBody => menu.copyWith(
        detailsPromptBody: value,
      ),
      _StoreMenuField.orderSummaryBody => menu.copyWith(
        orderSummaryBody: value,
      ),
      _StoreMenuField.orderCreatedBody => menu.copyWith(
        orderCreatedBody: value,
      ),
      _StoreMenuField.statusBody => menu.copyWith(statusBody: value),
    });
  }

  Future<void> _pickMenuImage(_StoreMenuKind kind) async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        ),
      ],
    );
    if (file == null) return;
    setState(() => _uploading = true);
    try {
      final uploaded = await ref
          .read(apiClientProvider)
          .uploadBotStoreFile(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: _storeMimeType(file.name),
            kind: 'image',
          );
      if (!mounted) return;
      _setMenu(
        kind,
        _menuFor(kind).copyWith(
          imagePath: uploaded['path']?.toString(),
          imageUrl: uploaded['url']?.toString(),
        ),
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }
}

class _StoreVariableDescription extends StatelessWidget {
  const _StoreVariableDescription({
    required this.token,
    required this.description,
    required this.onInsert,
  });

  final String token;
  final String description;
  final VoidCallback onInsert;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onInsert,
    borderRadius: BorderRadius.circular(4),
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 142),
            child: Text(
              token,
              style: const TextStyle(
                color: Color(0xFF008069),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              description,
              style: TextStyle(color: WaTheme.of(context).textMuted),
            ),
          ),
          const SizedBox(width: 6),
          const Icon(
            Icons.add_circle_outline_rounded,
            size: 18,
            color: Color(0xFF008069),
          ),
        ],
      ),
    ),
  );
}

class _StoreMenuPreviewCard extends StatelessWidget {
  const _StoreMenuPreviewCard({
    required this.label,
    required this.kind,
    required this.menu,
    required this.storeName,
    required this.storeDescription,
    required this.uploading,
    required this.onEdit,
    required this.onImage,
    this.onDeleteImage,
  });

  final String label;
  final _StoreMenuKind kind;
  final _StoreMenuDraft menu;
  final String storeName;
  final String storeDescription;
  final bool uploading;
  final ValueChanged<_StoreMenuField> onEdit;
  final VoidCallback onImage;
  final VoidCallback? onDeleteImage;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final replacements = <String, String>{
      'store': storeName.isEmpty ? 'Minha loja' : storeName,
      'description': storeDescription.isEmpty
          ? kind == _StoreMenuKind.product
                ? 'Acesso liberado logo após a confirmação.'
                : 'Escolha uma opção para continuar.'
          : storeDescription,
      'category': 'Assinaturas',
      'product': 'Plano mensal',
      'produto': 'CANVA PRO [LINK DE CONVITE]',
      'price': 'R\$ 25,00',
      'valor': 'R\$ 5,00',
      'stock': '⚡ Entrega digital',
      'data_compra': '15/07/2026 às 13:30:06',
      'dados':
          '├📧 Email: https://www.canva.com/brand/join?token=convite\n'
          '└🔑 Senha: LEIA ⬇️\n\n'
          'Clique no link para copiar e colar no seu navegador.',
      'pedido': 'A1B2C3D4',
      'count': '4',
      'countLabel': 'produtos',
      'nome_cliente': 'Douglas Reis',
      'nomecliente': 'Douglas Reis',
      'pushname': 'Douglas Reis',
      'numero_cliente': '+55 92 95333-3643',
      'saldo_cliente': 'R\$ 0,00',
      'validity': '30 dias',
      'screens': '1 tela',
      'plan_count': '3',
      'access_count': '1',
      'service': 'Instagram · Seguidores brasileiros',
      'target': 'https://instagram.com/botadmin',
      'quantity': '1.000',
      'min': '100',
      'max': '100.000',
      'status': 'Em andamento',
      'remains': '420',
      'instructions': 'Envie um comentário por linha.',
    };
    String preview(String? value) {
      var result = value ?? '';
      replacements.forEach((key, replacement) {
        result = result.replaceAll(
          RegExp('{{\\s*$key\\s*}}', caseSensitive: false),
          replacement,
        );
      });
      return result.replaceAll(r'\n', '\n').trim();
    }

    final title = preview(menu.title);
    final body = preview(menu.body);
    final footer = preview(menu.footer);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: wa.bubbleOut,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: wa.accent.withValues(alpha: .22)),
                boxShadow: const [
                  BoxShadow(color: Color(0x16000000), blurRadius: 3),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (kind != _StoreMenuKind.delivery)
                      _StoreMenuPreviewHeader(
                        imageUrl: menu.imageUrl,
                        uploading: uploading,
                        onImage: onImage,
                        onDelete: onDeleteImage,
                      ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 10, 8, 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (title.isNotEmpty)
                            _StoreMenuEditableLine(
                              text: title,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 15,
                              ),
                              onTap: () => onEdit(_StoreMenuField.title),
                            ),
                          if (body.isNotEmpty) ...[
                            if (title.isNotEmpty) const SizedBox(height: 7),
                            _StoreMenuEditableLine(
                              text: body,
                              style: const TextStyle(fontSize: 14, height: 1.3),
                              onTap: () => onEdit(_StoreMenuField.body),
                            ),
                          ],
                          if (footer.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            _StoreMenuEditableLine(
                              text: footer,
                              style: TextStyle(
                                color: wa.textMuted,
                                fontSize: 12,
                              ),
                              onTap: () => onEdit(_StoreMenuField.footer),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (kind == _StoreMenuKind.root ||
                        kind == _StoreMenuKind.category) ...[
                      Divider(height: 1, color: wa.divider),
                      _StoreMenuPreviewAction(
                        icon: Icons.list_alt_rounded,
                        text: preview(menu.listButton),
                        onTap: () => onEdit(_StoreMenuField.listButton),
                      ),
                      _StoreMenuRowsPreview(
                        kind: kind,
                        categoryText: preview(menu.categoryRow),
                        productText: preview(menu.productRow),
                        onEditCategory: kind == _StoreMenuKind.root
                            ? () => onEdit(_StoreMenuField.categoryRow)
                            : null,
                        onEditProduct: () => onEdit(_StoreMenuField.productRow),
                      ),
                    ] else if (kind == _StoreMenuKind.iptv ||
                        kind == _StoreMenuKind.smm) ...[
                      Divider(height: 1, color: wa.divider),
                      _StoreMenuPreviewAction(
                        icon: kind == _StoreMenuKind.smm
                            ? Icons.rocket_launch_outlined
                            : Icons.live_tv_outlined,
                        text: preview(menu.listButton),
                        onTap: () => onEdit(_StoreMenuField.listButton),
                      ),
                      _StoreMenuRowsPreview(
                        kind: kind,
                        categoryText: preview(menu.categoryRow),
                        productText: preview(menu.productRow),
                        onEditCategory: kind == _StoreMenuKind.smm
                            ? () => onEdit(_StoreMenuField.categoryRow)
                            : null,
                        onEditProduct: () => onEdit(_StoreMenuField.productRow),
                      ),
                      Divider(height: 1, color: wa.divider),
                      _StoreMenuPreviewAction(
                        icon: Icons.shopping_bag_outlined,
                        text: preview(menu.buyButton),
                        onTap: () => onEdit(_StoreMenuField.buyButton),
                      ),
                      Divider(height: 1, color: wa.divider),
                      _StoreMenuPreviewAction(
                        icon: Icons.reply_rounded,
                        text: preview(menu.backButton),
                        onTap: () => onEdit(_StoreMenuField.backButton),
                      ),
                    ] else if (kind == _StoreMenuKind.product) ...[
                      Divider(height: 1, color: wa.divider),
                      _StoreMenuPreviewAction(
                        icon: Icons.shopping_bag_outlined,
                        text: preview(menu.buyButton),
                        onTap: () => onEdit(_StoreMenuField.buyButton),
                      ),
                      Divider(height: 1, color: wa.divider),
                      _StoreMenuPreviewAction(
                        icon: Icons.reply_rounded,
                        text: preview(menu.backButton),
                        onTap: () => onEdit(_StoreMenuField.backButton),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _StoreSmmAutomationPreview extends StatelessWidget {
  const _StoreSmmAutomationPreview({required this.menu, required this.onEdit});

  final _StoreMenuDraft menu;
  final ValueChanged<_StoreMenuField> onEdit;

  @override
  Widget build(BuildContext context) {
    String preview(String? value) => (value ?? '')
        .replaceAll('{{service}}', 'Instagram · Seguidores brasileiros')
        .replaceAll('{{category}}', 'Instagram')
        .replaceAll('{{target}}', 'https://instagram.com/botadmin')
        .replaceAll('{{quantity}}', '1.000')
        .replaceAll('{{min}}', '100')
        .replaceAll('{{max}}', '100.000')
        .replaceAll('{{price}}', 'R\$ 24,90')
        .replaceAll('{{status}}', 'Em andamento')
        .replaceAll('{{remains}}', '420')
        .replaceAll('{{instructions}}', 'Envie um comentário por linha.')
        .replaceAll('{{pedido}}', 'SMM-1042')
        .replaceAll(r'\n', '\n')
        .trim();

    final cards = <Widget>[
      _StoreIptvAutomationCard(
        title: 'Solicitar link',
        body: preview(menu.linkPromptBody),
        onEditBody: () => onEdit(_StoreMenuField.linkPromptBody),
      ),
      _StoreIptvAutomationCard(
        title: 'Solicitar quantidade',
        body: preview(menu.quantityPromptBody),
        onEditBody: () => onEdit(_StoreMenuField.quantityPromptBody),
      ),
      _StoreIptvAutomationCard(
        title: 'Solicitar detalhes',
        body: preview(menu.detailsPromptBody),
        onEditBody: () => onEdit(_StoreMenuField.detailsPromptBody),
      ),
      _StoreIptvAutomationCard(
        title: 'Resumo do pedido',
        body: preview(menu.orderSummaryBody),
        onEditBody: () => onEdit(_StoreMenuField.orderSummaryBody),
      ),
      _StoreIptvAutomationCard(
        title: 'Pedido criado',
        body: preview(menu.orderCreatedBody),
        onEditBody: () => onEdit(_StoreMenuField.orderCreatedBody),
      ),
      _StoreIptvAutomationCard(
        title: 'Acompanhamento',
        body: preview(menu.statusBody),
        onEditBody: () => onEdit(_StoreMenuField.statusBody),
      ),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth >= 720
            ? (constraints.maxWidth - 12) / 2
            : constraints.maxWidth;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: cards
              .map((card) => SizedBox(width: width, child: card))
              .toList(growable: false),
        );
      },
    );
  }
}

class _StoreIptvAutomationPreview extends StatelessWidget {
  const _StoreIptvAutomationPreview({required this.menu, required this.onEdit});

  final _StoreMenuDraft menu;
  final ValueChanged<_StoreMenuField> onEdit;

  @override
  Widget build(BuildContext context) {
    String preview(String? value) => (value ?? '')
        .replaceAll('{{app}}', 'Kplay')
        .replaceAll('{{usuario}}', 'cliente01')
        .replaceAll('{{mac}}', '00:1A:2B:3C:4D:5E')
        .replaceAll(r'\n', '\n')
        .trim();

    final cards = <Widget>[
      _StoreIptvAutomationCard(
        title: 'Teste já utilizado',
        body: preview(menu.trialUsedBody),
        button: preview(menu.trialUsedButton),
        onEditBody: () => onEdit(_StoreMenuField.trialUsedBody),
        onEditButton: () => onEdit(_StoreMenuField.trialUsedButton),
      ),
      _StoreIptvAutomationCard(
        title: 'Solicitar MAC',
        body: preview(menu.macPromptBody),
        onEditBody: () => onEdit(_StoreMenuField.macPromptBody),
      ),
      _StoreIptvAutomationCard(
        title: 'Selecionar acesso',
        body: preview(menu.macAccessBody),
        button: preview(menu.macAccessButton),
        onEditBody: () => onEdit(_StoreMenuField.macAccessBody),
        onEditButton: () => onEdit(_StoreMenuField.macAccessButton),
      ),
      _StoreIptvAutomationCard(
        title: 'Selecionar aplicativo',
        body: preview(menu.macAppBody),
        button: preview(menu.macAppButton),
        onEditBody: () => onEdit(_StoreMenuField.macAppBody),
        onEditButton: () => onEdit(_StoreMenuField.macAppButton),
      ),
      _StoreIptvAutomationCard(
        title: 'Ativação concluída',
        body: preview(menu.appActivatedBody),
        onEditBody: () => onEdit(_StoreMenuField.appActivatedBody),
      ),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth >= 720
            ? (constraints.maxWidth - 12) / 2
            : constraints.maxWidth;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: cards
              .map((card) => SizedBox(width: width, child: card))
              .toList(growable: false),
        );
      },
    );
  }
}

class _StoreIptvAutomationCard extends StatelessWidget {
  const _StoreIptvAutomationCard({
    required this.title,
    required this.body,
    required this.onEditBody,
    this.button,
    this.onEditButton,
  });

  final String title;
  final String body;
  final String? button;
  final VoidCallback onEditBody;
  final VoidCallback? onEditButton;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.bubbleOut,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: wa.accent.withValues(alpha: .22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: wa.textMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 7),
                _StoreMenuEditableLine(
                  text: body,
                  style: const TextStyle(fontSize: 14, height: 1.3),
                  onTap: onEditBody,
                ),
              ],
            ),
          ),
          if (button?.isNotEmpty == true && onEditButton != null) ...[
            Divider(height: 1, color: wa.divider),
            _StoreMenuPreviewAction(
              icon: Icons.reply_rounded,
              text: button!,
              onTap: onEditButton!,
            ),
          ],
        ],
      ),
    );
  }
}

class _StoreMenuPreviewHeader extends StatelessWidget {
  const _StoreMenuPreviewHeader({
    required this.imageUrl,
    required this.uploading,
    required this.onImage,
    this.onDelete,
  });

  final String? imageUrl;
  final bool uploading;
  final VoidCallback onImage;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl?.trim() ?? '';
    if (url.isEmpty) {
      return SizedBox(
        height: 42,
        child: Align(
          alignment: Alignment.centerRight,
          child: Padding(
            padding: const EdgeInsets.only(right: 7),
            child: _StorePreviewIconButton(
              tooltip: 'Adicionar imagem ao menu',
              onPressed: uploading ? null : onImage,
              icon: Icons.photo_camera_outlined,
              color: const Color(0xFF008069),
            ),
          ),
        ),
      );
    }
    return AspectRatio(
      aspectRatio: 16 / 7,
      child: Stack(
        fit: StackFit.expand,
        children: [
          BotAdminCachedImage(
            imageUrl: url,
            fit: BoxFit.cover,
            errorWidget: (_, _, _) => _placeholder(),
          ),
          if (uploading)
            const ColoredBox(
              color: Color(0x55000000),
              child: Center(child: CircularProgressIndicator()),
            ),
          Positioned(
            top: 7,
            right: 7,
            child: Row(
              children: [
                _StorePreviewIconButton(
                  tooltip: 'Trocar imagem',
                  onPressed: uploading ? null : onImage,
                  icon: Icons.photo_camera_outlined,
                  color: const Color(0xFF008069),
                ),
                if (onDelete != null)
                  _StorePreviewIconButton(
                    tooltip: 'Remover imagem',
                    onPressed: uploading ? null : onDelete,
                    icon: Icons.delete_outline_rounded,
                    color: Colors.red.shade700,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _placeholder() => const ColoredBox(
    color: Color(0xFFE9EDEF),
    child: Center(
      child: Icon(Icons.add_photo_alternate_outlined, color: Color(0xFF667781)),
    ),
  );
}

class _StoreMenuEditableLine extends StatelessWidget {
  const _StoreMenuEditableLine({
    required this.text,
    required this.style,
    required this.onTap,
  });

  final String text;
  final TextStyle style;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(child: Text(text.isEmpty ? 'Sem texto' : text, style: style)),
      const SizedBox(width: 4),
      _StorePreviewIconButton(
        tooltip: 'Editar',
        onPressed: onTap,
        icon: Icons.edit_outlined,
        color: const Color(0xFF008069),
      ),
    ],
  );
}

class _StorePreviewIconButton extends StatelessWidget {
  const _StorePreviewIconButton({
    required this.tooltip,
    required this.onPressed,
    required this.icon,
    required this.color,
  });

  final String tooltip;
  final VoidCallback? onPressed;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: tooltip,
    onPressed: onPressed,
    visualDensity: VisualDensity.compact,
    constraints: const BoxConstraints.tightFor(width: 34, height: 34),
    padding: EdgeInsets.zero,
    style: IconButton.styleFrom(
      backgroundColor: Theme.of(
        context,
      ).colorScheme.surface.withValues(alpha: .92),
    ),
    icon: Icon(icon, color: color, size: 18),
  );
}

class _StoreMenuPreviewAction extends StatelessWidget {
  const _StoreMenuPreviewAction({
    required this.icon,
    required this.text,
    required this.onTap,
  });

  final IconData icon;
  final String text;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: SizedBox(
      height: 46,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: const Color(0xFF008069), size: 18),
          const SizedBox(width: 7),
          Flexible(
            child: Text(
              text.isEmpty ? 'Editar botão' : text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFF008069),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 5),
          const Icon(Icons.edit_outlined, color: Color(0xFF008069), size: 16),
        ],
      ),
    ),
  );
}

class _StoreMenuRowsPreview extends StatelessWidget {
  const _StoreMenuRowsPreview({
    required this.kind,
    required this.categoryText,
    required this.productText,
    this.onEditCategory,
    required this.onEditProduct,
  });

  final _StoreMenuKind kind;
  final String categoryText;
  final String productText;
  final VoidCallback? onEditCategory;
  final VoidCallback onEditProduct;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final entries = <({String title, String subtitle, VoidCallback edit})>[
      if (onEditCategory != null)
        (
          title: kind == _StoreMenuKind.smm ? 'Instagram' : 'Assinaturas',
          subtitle: categoryText,
          edit: onEditCategory!,
        ),
      (
        title: kind == _StoreMenuKind.root
            ? 'Produto avulso'
            : kind == _StoreMenuKind.smm
            ? 'Seguidores brasileiros'
            : 'Plano mensal',
        subtitle: productText,
        edit: onEditProduct,
      ),
    ];
    return ColoredBox(
      color: wa.panel,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(10, 4, 8, 7),
        child: Column(
          children: [
            for (final entry in entries)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  entry.title,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  entry.subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: IconButton(
                  tooltip: 'Editar linha',
                  onPressed: entry.edit,
                  icon: const Icon(Icons.edit_outlined, size: 18),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _CentralCartDraft {
  const _CentralCartDraft({
    required this.apiKey,
    required this.mode,
    required this.gateway,
    this.disconnect = false,
    this.syncOnly = false,
  });

  final String apiKey;
  final String mode;
  final String gateway;
  final bool disconnect;
  final bool syncOnly;

  Map<String, Object?> toJson() => {
    if (apiKey.isNotEmpty) 'apiKey': apiKey,
    'mode': mode,
    'gateway': gateway,
  };
}

class _CentralCartDialog extends StatefulWidget {
  const _CentralCartDialog({required this.store});

  final BotStoreSettings store;

  @override
  State<_CentralCartDialog> createState() => _CentralCartDialogState();
}

class _CentralCartDialogState extends State<_CentralCartDialog> {
  final TextEditingController _apiKey = TextEditingController();
  late String _mode;
  late String _gateway;

  @override
  void initState() {
    super.initState();
    _mode = widget.store.centralCartMode;
    _gateway = widget.store.centralCartGateway;
  }

  @override
  void dispose() {
    _apiKey.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final connected = widget.store.centralCartConnected;
    return AlertDialog(
      title: const Text('Central Cart'),
      content: SizedBox(
        width: 500,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (connected)
                _StoreNotice(
                  icon: Icons.verified_rounded,
                  text:
                      '${widget.store.centralCartAppName ?? 'Aplicativo conectado'} · ${widget.store.centralCartApiKeyHint ?? 'credencial protegida'}',
                ),
              if (connected) const SizedBox(height: 12),
              TextField(
                controller: _apiKey,
                obscureText: true,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: connected
                      ? 'Nova API key (opcional)'
                      : 'API key da Central Cart',
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _mode,
                decoration: const InputDecoration(
                  labelText: 'Modo do catálogo',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(
                    value: 'live',
                    child: Text('Catálogo ao vivo'),
                  ),
                  DropdownMenuItem(
                    value: 'import',
                    child: Text('Sincronizado'),
                  ),
                ],
                onChanged: (value) => setState(() => _mode = value ?? _mode),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _gateway,
                decoration: const InputDecoration(
                  labelText: 'Gateway do checkout',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 'OTHER', child: Text('Automático')),
                  DropdownMenuItem(
                    value: 'MERCADO_PAGO',
                    child: Text('Mercado Pago'),
                  ),
                  DropdownMenuItem(value: 'PIX', child: Text('Pix')),
                ],
                onChanged: (value) =>
                    setState(() => _gateway = value ?? _gateway),
              ),
            ],
          ),
        ),
      ),
      actions: [
        if (connected)
          TextButton(
            onPressed: () => Navigator.of(context).pop(
              const _CentralCartDraft(
                apiKey: '',
                mode: 'live',
                gateway: 'OTHER',
                disconnect: true,
              ),
            ),
            child: const Text('Desconectar'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: !connected && _apiKey.text.trim().isEmpty
              ? null
              : () => Navigator.of(context).pop(
                  _CentralCartDraft(
                    apiKey: _apiKey.text.trim(),
                    mode: _mode,
                    gateway: _gateway,
                    syncOnly: connected && _apiKey.text.trim().isEmpty,
                  ),
                ),
          icon: const Icon(Icons.sync_rounded),
          label: Text(connected ? 'Sincronizar' : 'Conectar'),
        ),
      ],
    );
  }
}

class _StoreCategoryDraft {
  const _StoreCategoryDraft({
    required this.id,
    required this.name,
    required this.description,
    required this.imagePath,
    required this.position,
    required this.enabled,
  });

  final int? id;
  final String name;
  final String description;
  final String? imagePath;
  final int position;
  final bool enabled;

  Map<String, Object?> toJson() => {
    if (id != null) 'id': id,
    'name': name,
    'description': description,
    'imagePath': imagePath,
    'position': position,
    'enabled': enabled,
  };
}

class _StoreEmbeddedEditor extends StatelessWidget {
  const _StoreEmbeddedEditor({
    required this.title,
    required this.subtitle,
    required this.child,
    required this.onCancel,
    required this.onSave,
    required this.saveLabel,
    required this.saveIcon,
    required this.busy,
  });

  final String title;
  final String subtitle;
  final Widget child;
  final VoidCallback? onCancel;
  final VoidCallback? onSave;
  final String saveLabel;
  final IconData saveIcon;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.panel,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: wa.panel,
                border: Border(bottom: BorderSide(color: wa.divider)),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(28, 22, 20, 20),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(subtitle, style: TextStyle(color: wa.textMuted)),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: busy ? null : onCancel,
                      icon: const Icon(Icons.close_rounded),
                      tooltip: 'Fechar edição',
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(28, 24, 28, 32),
                child: SizedBox(width: double.infinity, child: child),
              ),
            ),
            DecoratedBox(
              decoration: BoxDecoration(
                color: wa.panel,
                border: Border(top: BorderSide(color: wa.divider)),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(28, 12, 28, 14),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: busy ? null : onCancel,
                      child: const Text('Cancelar'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      onPressed: busy ? null : onSave,
                      icon: busy
                          ? const SizedBox.square(
                              dimension: 17,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Icon(saveIcon),
                      label: Text(busy ? 'Salvando...' : saveLabel),
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

class _StoreCategoryDialog extends ConsumerStatefulWidget {
  const _StoreCategoryDialog({
    super.key,
    this.category,
    this.embedded = false,
    this.busy = false,
    this.onSave,
    this.onCancel,
  });

  final BotStoreCategory? category;
  final bool embedded;
  final bool busy;
  final Future<void> Function(_StoreCategoryDraft draft)? onSave;
  final VoidCallback? onCancel;

  @override
  ConsumerState<_StoreCategoryDialog> createState() =>
      _StoreCategoryDialogState();
}

class _StoreCategoryDialogState extends ConsumerState<_StoreCategoryDialog> {
  late final TextEditingController _name;
  late final TextEditingController _description;
  late final TextEditingController _position;
  late bool _enabled;
  String? _imagePath;
  String? _imageUrl;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.category?.name);
    _description = TextEditingController(text: widget.category?.description);
    _position = TextEditingController(
      text: (widget.category?.position ?? 0).toString(),
    );
    _enabled = widget.category?.enabled ?? true;
    _imagePath = widget.category?.imagePath;
    _imageUrl = widget.category?.imageUrl;
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _position.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.category == null
        ? 'Nova categoria'
        : 'Editar categoria';
    final form = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        InkWell(
          onTap: _uploading || widget.busy ? null : _pickImage,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            height: 132,
            width: double.infinity,
            decoration: BoxDecoration(
              border: Border.all(color: WaTheme.of(context).border),
              borderRadius: BorderRadius.circular(8),
            ),
            child: _uploading
                ? const Center(child: CircularProgressIndicator())
                : _imageUrl?.trim().isNotEmpty == true
                ? ClipRRect(
                    borderRadius: BorderRadius.circular(7),
                    child: BotAdminCachedImage(
                      imageUrl: _imageUrl!,
                      fit: BoxFit.cover,
                    ),
                  )
                : const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_photo_alternate_outlined, size: 32),
                      SizedBox(height: 6),
                      Text('Adicionar imagem da categoria'),
                    ],
                  ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _name,
          decoration: const InputDecoration(
            labelText: 'Nome',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _description,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Descrição',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _position,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(
            labelText: 'Ordem',
            border: OutlineInputBorder(),
          ),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Categoria visível'),
          value: _enabled,
          onChanged: widget.busy
              ? null
              : (value) => setState(() => _enabled = value),
        ),
      ],
    );
    if (widget.embedded) {
      return _StoreEmbeddedEditor(
        title: title,
        subtitle: 'Organize os produtos exibidos no menu da loja.',
        onCancel: widget.onCancel,
        onSave: _submit,
        saveLabel: 'Salvar categoria',
        saveIcon: Icons.save_outlined,
        busy: _uploading || widget.busy,
        child: form,
      );
    }
    return AlertDialog(
      title: Text(title),
      content: SizedBox(width: 460, child: SingleChildScrollView(child: form)),
      actions: [
        TextButton(
          onPressed: _uploading || widget.busy ? null : _cancel,
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _uploading || widget.busy ? null : _submit,
          child: const Text('Salvar'),
        ),
      ],
    );
  }

  void _cancel() {
    if (widget.embedded) {
      widget.onCancel?.call();
    } else {
      Navigator.of(context).pop();
    }
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      showErrorToast(context, 'Informe o nome da categoria.');
      return;
    }
    final draft = _StoreCategoryDraft(
      id: widget.category?.id,
      name: name,
      description: _description.text.trim(),
      imagePath: _imagePath,
      position: int.tryParse(_position.text) ?? 0,
      enabled: _enabled,
    );
    if (widget.onSave != null) {
      await widget.onSave!(draft);
    } else if (mounted) {
      Navigator.of(context).pop(draft);
    }
  }

  Future<void> _pickImage() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        ),
      ],
    );
    if (file == null) return;
    setState(() => _uploading = true);
    try {
      final uploaded = await ref
          .read(apiClientProvider)
          .uploadBotStoreFile(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: _storeMimeType(file.name),
            kind: 'image',
          );
      if (!mounted) return;
      setState(() {
        _imagePath = uploaded['path']?.toString();
        _imageUrl = uploaded['url']?.toString();
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }
}

class _StoreProductDraft {
  const _StoreProductDraft({
    required this.id,
    required this.categoryId,
    required this.name,
    required this.sku,
    required this.description,
    required this.priceCents,
    required this.imagePath,
    required this.enabled,
    required this.position,
  });

  final int? id;
  final int? categoryId;
  final String name;
  final String sku;
  final String description;
  final int priceCents;
  final String? imagePath;
  final bool enabled;
  final int position;

  Map<String, Object?> toJson() => {
    if (id != null) 'id': id,
    'categoryId': categoryId,
    'name': name,
    'sku': sku,
    'description': description,
    'priceCents': priceCents,
    'imagePath': imagePath,
    'enabled': enabled,
    'position': position,
  };
}

class _StoreProductDialog extends ConsumerStatefulWidget {
  const _StoreProductDialog({
    super.key,
    required this.categories,
    this.product,
    this.embedded = false,
    this.busy = false,
    this.onSave,
    this.onCancel,
  });

  final BotStoreProduct? product;
  final List<BotStoreCategory> categories;
  final bool embedded;
  final bool busy;
  final Future<void> Function(_StoreProductDraft draft)? onSave;
  final VoidCallback? onCancel;

  @override
  ConsumerState<_StoreProductDialog> createState() =>
      _StoreProductDialogState();
}

class _StoreProductDialogState extends ConsumerState<_StoreProductDialog> {
  late final TextEditingController _name;
  late final TextEditingController _sku;
  late final TextEditingController _description;
  late final TextEditingController _price;
  late final TextEditingController _position;
  late int? _categoryId;
  late bool _enabled;
  String? _imagePath;
  String? _imageUrl;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    final product = widget.product;
    _name = TextEditingController(text: product?.name);
    _sku = TextEditingController(text: product?.sku);
    _description = TextEditingController(text: product?.description);
    _price = TextEditingController(
      text: product == null ? '' : product.price.toStringAsFixed(2),
    );
    _position = TextEditingController(
      text: (product?.position ?? 0).toString(),
    );
    _categoryId = product?.categoryId;
    _enabled = product?.enabled ?? true;
    _imagePath = product?.imagePath;
    _imageUrl = product?.imageUrl;
  }

  @override
  void dispose() {
    _name.dispose();
    _sku.dispose();
    _description.dispose();
    _price.dispose();
    _position.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.product == null ? 'Novo produto' : 'Editar produto';
    final form = SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: _uploading || widget.busy ? null : _pickFile,
            borderRadius: BorderRadius.circular(8),
            child: Container(
              height: 150,
              decoration: BoxDecoration(
                border: Border.all(color: WaTheme.of(context).border),
                borderRadius: BorderRadius.circular(8),
              ),
              child: _uploading
                  ? const Center(child: CircularProgressIndicator())
                  : _imageUrl?.trim().isNotEmpty == true
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(7),
                      child: BotAdminCachedImage(
                        imageUrl: _imageUrl!,
                        fit: BoxFit.cover,
                      ),
                    )
                  : const Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.add_photo_alternate_outlined, size: 34),
                        SizedBox(height: 6),
                        Text('Adicionar imagem do produto'),
                      ],
                    ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _name,
            decoration: const InputDecoration(
              labelText: 'Nome',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _description,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Descrição',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _price,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Preço',
              prefixText: 'R\$ ',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              final categoryField = DropdownButtonFormField<int?>(
                initialValue: _categoryId,
                decoration: const InputDecoration(
                  labelText: 'Categoria',
                  border: OutlineInputBorder(),
                ),
                items: [
                  const DropdownMenuItem<int?>(
                    value: null,
                    child: Text('Sem categoria'),
                  ),
                  ...widget.categories.map(
                    (category) => DropdownMenuItem<int?>(
                      value: category.id,
                      child: Text(
                        category.name,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
                onChanged: widget.busy
                    ? null
                    : (value) => setState(() => _categoryId = value),
              );
              final skuField = TextField(
                controller: _sku,
                decoration: const InputDecoration(
                  labelText: 'SKU',
                  border: OutlineInputBorder(),
                ),
              );
              final positionField = TextField(
                controller: _position,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'Ordem',
                  border: OutlineInputBorder(),
                ),
              );
              if (constraints.maxWidth < 480) {
                return Column(
                  children: [
                    categoryField,
                    const SizedBox(height: 12),
                    skuField,
                    const SizedBox(height: 12),
                    positionField,
                  ],
                );
              }
              return Row(
                children: [
                  Expanded(flex: 2, child: categoryField),
                  const SizedBox(width: 10),
                  Expanded(child: skuField),
                  const SizedBox(width: 10),
                  SizedBox(width: 104, child: positionField),
                ],
              );
            },
          ),
          const SizedBox(height: 12),
          DecoratedBox(
            decoration: BoxDecoration(
              color: WaTheme.of(context).accentSoft,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: WaTheme.of(context).border),
            ),
            child: const Padding(
              padding: EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(Icons.inventory_2_outlined, size: 20),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Conteúdo entregue e quantidade são gerenciados separadamente em Estoque.',
                    ),
                  ),
                ],
              ),
            ),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Produto disponível'),
            value: _enabled,
            onChanged: widget.busy
                ? null
                : (value) => setState(() => _enabled = value),
          ),
        ],
      ),
    );
    if (widget.embedded) {
      return _StoreEmbeddedEditor(
        title: title,
        subtitle:
            'Edite os dados comerciais; as unidades vendáveis ficam no Estoque.',
        onCancel: widget.onCancel,
        onSave: _submit,
        saveLabel: 'Salvar produto',
        saveIcon: Icons.save_outlined,
        busy: _uploading || widget.busy,
        child: form,
      );
    }
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 20),
      title: Text(title),
      content: SizedBox(
        width: 760,
        height: MediaQuery.sizeOf(context).height * .72,
        child: form,
      ),
      actions: [
        TextButton(
          onPressed: _uploading || widget.busy ? null : _cancel,
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _uploading || widget.busy ? null : _submit,
          child: const Text('Salvar produto'),
        ),
      ],
    );
  }

  Future<void> _pickFile() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        ),
      ],
    );
    if (file == null) return;
    setState(() => _uploading = true);
    try {
      final uploaded = await ref
          .read(apiClientProvider)
          .uploadBotStoreFile(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: _storeMimeType(file.name),
            kind: 'image',
          );
      if (!mounted) return;
      setState(() {
        _imagePath = uploaded['path']?.toString();
        _imageUrl = uploaded['url']?.toString();
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  void _cancel() {
    if (widget.embedded) {
      widget.onCancel?.call();
    } else {
      Navigator.of(context).pop();
    }
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      showErrorToast(context, 'Informe o nome do produto.');
      return;
    }
    final priceText = _price.text.trim().replaceAll(',', '.');
    final price = double.tryParse(priceText);
    if (price == null || price < 0) {
      showErrorToast(context, 'Informe um preço válido.');
      return;
    }
    final draft = _StoreProductDraft(
      id: widget.product?.id,
      categoryId: _categoryId,
      name: name,
      sku: _sku.text.trim(),
      description: _description.text.trim(),
      priceCents: (price * 100).round(),
      imagePath: _imagePath,
      enabled: _enabled,
      position: int.tryParse(_position.text) ?? 0,
    );
    if (widget.onSave != null) {
      await widget.onSave!(draft);
    } else if (mounted) {
      Navigator.of(context).pop(draft);
    }
  }
}

class _StoreCustomerDraft {
  const _StoreCustomerDraft({
    required this.customerJid,
    required this.customerName,
    required this.customerPhone,
    required this.avatarUrl,
    required this.balanceMode,
    required this.balanceCents,
    required this.notes,
    required this.blocked,
  });

  final String customerJid;
  final String customerName;
  final String customerPhone;
  final String avatarUrl;
  final String balanceMode;
  final int balanceCents;
  final String notes;
  final bool blocked;

  Map<String, Object?> toJson() => {
    'customerJid': customerJid,
    'customerName': customerName,
    'customerPhone': customerPhone,
    'avatarUrl': avatarUrl,
    'balanceMode': balanceMode,
    'balanceCents': balanceCents,
    'notes': notes,
    'blocked': blocked,
  };
}

class _StoreCustomerDialog extends StatefulWidget {
  const _StoreCustomerDialog({required this.customer});

  final BotStoreCustomer customer;

  @override
  State<_StoreCustomerDialog> createState() => _StoreCustomerDialogState();
}

class _StoreCustomerDialogState extends State<_StoreCustomerDialog> {
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _balance;
  late final TextEditingController _notes;
  String _balanceMode = 'set';
  late bool _blocked;

  @override
  void initState() {
    super.initState();
    final customer = widget.customer;
    _name = TextEditingController(text: customer.customerName);
    _phone = TextEditingController(text: customer.customerPhone);
    _balance = TextEditingController(
      text: customer.balance.toStringAsFixed(2).replaceAll('.', ','),
    );
    _notes = TextEditingController(text: customer.notes);
    _blocked = customer.blocked;
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _balance.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final customer = widget.customer;
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 20),
      title: const Text('Gerenciar cliente'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: _MigrationCircleAvatar(
                  url: customer.avatarUrl,
                  icon: Icons.person_outline_rounded,
                ),
                title: Text(
                  customer.displayName,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(
                  '${customer.ordersCount} compra(s) · '
                  '${NumberFormat.simpleCurrency(locale: 'pt_BR').format(customer.totalSpent)} em vendas',
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _name,
                decoration: const InputDecoration(
                  labelText: 'Nome',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'WhatsApp',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _balanceMode,
                decoration: const InputDecoration(
                  labelText: 'Operação do saldo',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 'set', child: Text('Definir saldo')),
                  DropdownMenuItem(
                    value: 'credit',
                    child: Text('Adicionar crédito'),
                  ),
                  DropdownMenuItem(
                    value: 'debit',
                    child: Text('Descontar saldo'),
                  ),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _balanceMode = value);
                },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _balance,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Valor',
                  prefixText: 'R\$ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _notes,
                minLines: 3,
                maxLines: 6,
                decoration: const InputDecoration(
                  labelText: 'Observações internas',
                  alignLabelWithHint: true,
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 4),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text(
                  'Bloquear compras automáticas',
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: const Text(
                  'O atendimento manual continua disponível.',
                ),
                value: _blocked,
                onChanged: (value) => setState(() => _blocked = value),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.save_outlined),
          label: const Text('Salvar'),
        ),
      ],
    );
  }

  void _submit() {
    final rawBalance = _balance.text
        .trim()
        .replaceAll('.', '')
        .replaceAll(',', '.');
    final value = double.tryParse(rawBalance);
    if (value == null || value < 0) {
      showErrorToast(context, 'Informe um valor de saldo válido.');
      return;
    }
    Navigator.of(context).pop(
      _StoreCustomerDraft(
        customerJid: widget.customer.customerJid,
        customerName: _name.text.trim(),
        customerPhone: _phone.text.trim(),
        avatarUrl: widget.customer.avatarUrl ?? '',
        balanceMode: _balanceMode,
        balanceCents: (value * 100).round(),
        notes: _notes.text.trim(),
        blocked: _blocked,
      ),
    );
  }
}

class _StoreInventoryDraft {
  const _StoreInventoryDraft({
    required this.id,
    required this.productId,
    required this.itemType,
    required this.label,
    required this.values,
    required this.deliveryFilePath,
    required this.deliveryFileName,
    required this.deliveryMimeType,
    required this.maxUses,
  });

  final int? id;
  final int productId;
  final String itemType;
  final String label;
  final List<String> values;
  final String? deliveryFilePath;
  final String? deliveryFileName;
  final String? deliveryMimeType;
  final int maxUses;

  int get quantityLabel => itemType == 'file' ? 1 : values.length;

  Map<String, Object?> toJson() => {
    if (id != null) 'id': id,
    'productId': productId,
    'itemType': itemType,
    'label': label,
    if (id == null && itemType != 'file') 'values': values,
    if (id != null && itemType != 'file')
      'deliveryValue': values.isEmpty ? null : values.first,
    'deliveryFilePath': deliveryFilePath,
    'deliveryFileName': deliveryFileName,
    'deliveryMimeType': deliveryMimeType,
    'maxUses': maxUses,
    if (id == null && itemType == 'file') 'quantity': 1,
  };
}

class _StoreInventoryDialog extends ConsumerStatefulWidget {
  const _StoreInventoryDialog({
    super.key,
    required this.products,
    this.item,
    this.preferredProductId,
    this.embedded = false,
    this.busy = false,
    this.onSave,
    this.onCancel,
  });

  final List<BotStoreProduct> products;
  final BotStoreInventoryItem? item;
  final int? preferredProductId;
  final bool embedded;
  final bool busy;
  final Future<void> Function(_StoreInventoryDraft draft)? onSave;
  final VoidCallback? onCancel;

  @override
  ConsumerState<_StoreInventoryDialog> createState() =>
      _StoreInventoryDialogState();
}

class _StoreInventoryDialogState extends ConsumerState<_StoreInventoryDialog> {
  late int _productId;
  late String _itemType;
  late final TextEditingController _label;
  late final TextEditingController _values;
  late final TextEditingController _maxUses;
  late bool _multipleUses;
  String? _deliveryFilePath;
  String? _deliveryFileName;
  String? _deliveryMimeType;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    final item = widget.item;
    final preferred = widget.preferredProductId;
    _productId = widget.products.any((product) => product.id == preferred)
        ? preferred!
        : widget.products.first.id;
    _itemType = item?.itemType ?? 'license';
    _label = TextEditingController(text: item?.label);
    _values = TextEditingController(text: item?.deliveryValue);
    _multipleUses = (item?.maxUses ?? 1) > 1;
    _maxUses = TextEditingController(text: (item?.maxUses ?? 2).toString());
    _deliveryFilePath = item?.deliveryFilePath;
    _deliveryFileName = item?.deliveryFileName;
    _deliveryMimeType = item?.deliveryMimeType;
  }

  @override
  void dispose() {
    _label.dispose();
    _values.dispose();
    _maxUses.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.item != null;
    final title = editing ? 'Editar item do estoque' : 'Abastecer estoque';
    final form = SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<int>(
            initialValue: _productId,
            decoration: const InputDecoration(
              labelText: 'Produto',
              border: OutlineInputBorder(),
            ),
            items: widget.products
                .map(
                  (product) => DropdownMenuItem(
                    value: product.id,
                    child: Text(product.name, overflow: TextOverflow.ellipsis),
                  ),
                )
                .toList(growable: false),
            onChanged: editing || widget.busy
                ? null
                : (value) {
                    if (value != null) setState(() => _productId = value);
                  },
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _itemType,
            decoration: const InputDecoration(
              labelText: 'Tipo de item entregue',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(
                value: 'license',
                child: Text('Licença ou chave'),
              ),
              DropdownMenuItem(value: 'code', child: Text('Código digital')),
              DropdownMenuItem(value: 'url', child: Text('Link de acesso')),
              DropdownMenuItem(value: 'text', child: Text('Texto')),
              DropdownMenuItem(value: 'file', child: Text('Arquivo digital')),
            ],
            onChanged: editing || widget.busy
                ? null
                : (value) {
                    if (value != null) setState(() => _itemType = value);
                  },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _label,
            decoration: const InputDecoration(
              labelText: 'Identificação interna (opcional)',
              hintText: 'Ex.: licença mensal',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          DecoratedBox(
            decoration: BoxDecoration(
              color: WaTheme.of(context).searchBg,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: WaTheme.of(context).border),
            ),
            child: Column(
              children: [
                SwitchListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                  title: const Text(
                    'Pode ser vendido várias vezes',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                  subtitle: Text(
                    _multipleUses
                        ? 'O mesmo item será entregue até atingir o limite.'
                        : 'Após uma venda, este item fica esgotado.',
                  ),
                  value: _multipleUses,
                  onChanged: widget.busy
                      ? null
                      : (value) => setState(() => _multipleUses = value),
                ),
                if (_multipleUses)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                    child: TextField(
                      controller: _maxUses,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(
                        labelText: 'Quantidade máxima de vendas',
                        helperText:
                            'Ex.: um pack vendido 30 vezes usa o limite 30.',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (_itemType == 'file') ...[
            OutlinedButton.icon(
              onPressed: _uploading || widget.busy ? null : _pickDeliveryFile,
              icon: _uploading
                  ? const SizedBox.square(
                      dimension: 17,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.upload_file_outlined),
              label: Text(
                _deliveryFileName?.trim().isNotEmpty == true
                    ? _deliveryFileName!
                    : 'Selecionar arquivo entregue',
              ),
            ),
          ] else
            TextField(
              controller: _values,
              minLines: editing ? 3 : 7,
              maxLines: 12,
              decoration: InputDecoration(
                labelText: editing
                    ? 'Conteúdo entregue'
                    : 'Itens, um por linha',
                hintText: _itemType == 'url'
                    ? 'https://acesso-1...\nhttps://acesso-2...'
                    : 'CHAVE-001\nCHAVE-002\nCHAVE-003',
                helperText: editing
                    ? null
                    : 'Cada linha vira uma unidade disponível para venda.',
                alignLabelWithHint: true,
                border: const OutlineInputBorder(),
              ),
            ),
        ],
      ),
    );
    if (widget.embedded) {
      return _StoreEmbeddedEditor(
        title: title,
        subtitle:
            'Defina o produto, o conteúdo entregue e quantas vendas este item suporta.',
        onCancel: widget.onCancel,
        onSave: _submit,
        saveLabel: editing ? 'Salvar item' : 'Abastecer',
        saveIcon: editing ? Icons.save_outlined : Icons.add_rounded,
        busy: _uploading || widget.busy,
        child: form,
      );
    }
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 20),
      title: Text(title),
      content: SizedBox(
        width: 760,
        height: MediaQuery.sizeOf(context).height * .72,
        child: form,
      ),
      actions: [
        TextButton(
          onPressed: _uploading || widget.busy ? null : _cancel,
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _uploading || widget.busy ? null : _submit,
          icon: const Icon(Icons.save_outlined),
          label: Text(editing ? 'Salvar item' : 'Abastecer'),
        ),
      ],
    );
  }

  Future<void> _pickDeliveryFile() async {
    final file = await openFile();
    if (file == null) return;
    setState(() => _uploading = true);
    try {
      final uploaded = await ref
          .read(apiClientProvider)
          .uploadBotStoreFile(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: _storeMimeType(file.name),
            kind: 'delivery',
          );
      if (!mounted) return;
      setState(() {
        _deliveryFilePath = uploaded['path']?.toString();
        _deliveryFileName = uploaded['fileName']?.toString() ?? file.name;
        _deliveryMimeType =
            uploaded['mimeType']?.toString() ?? _storeMimeType(file.name);
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  void _cancel() {
    if (widget.embedded) {
      widget.onCancel?.call();
    } else {
      Navigator.of(context).pop();
    }
  }

  Future<void> _submit() async {
    final rawValue = _values.text.trim();
    final values = widget.item == null
        ? rawValue
              .split(RegExp(r'\r?\n'))
              .map((value) => value.trim())
              .where((value) => value.isNotEmpty)
              .toList(growable: false)
        : rawValue.isEmpty
        ? const <String>[]
        : <String>[rawValue];
    final maxUses = _multipleUses ? int.tryParse(_maxUses.text.trim()) ?? 0 : 1;
    if (_itemType == 'file' && _deliveryFilePath?.trim().isNotEmpty != true) {
      showErrorToast(context, 'Selecione o arquivo que será entregue.');
      return;
    }
    if (_itemType != 'file' && values.isEmpty) {
      showErrorToast(context, 'Informe ao menos um item para o estoque.');
      return;
    }
    if (maxUses < 1 || maxUses > 100000) {
      showErrorToast(
        context,
        'Informe uma quantidade de vendas entre 1 e 100.000.',
      );
      return;
    }
    final minimumUses =
        (widget.item?.usedCount ?? 0) + (widget.item?.reservedUses ?? 0);
    if (maxUses < minimumUses) {
      showErrorToast(
        context,
        'Este item já possui $minimumUses venda(s) concluída(s) ou reservada(s).',
      );
      return;
    }
    final draft = _StoreInventoryDraft(
      id: widget.item?.id,
      productId: _productId,
      itemType: _itemType,
      label: _label.text.trim(),
      values: values,
      deliveryFilePath: _deliveryFilePath,
      deliveryFileName: _deliveryFileName,
      deliveryMimeType: _deliveryMimeType,
      maxUses: maxUses,
    );
    if (widget.onSave != null) {
      await widget.onSave!(draft);
    } else if (mounted) {
      Navigator.of(context).pop(draft);
    }
  }
}

String _storeInventoryTypeLabel(String type) {
  return switch (type.toLowerCase()) {
    'file' => 'Arquivo',
    'url' => 'Link',
    'text' => 'Texto',
    'license' => 'Licença',
    _ => 'Código',
  };
}

String _storeMimeType(String fileName) {
  final extension = fileName.split('.').last.toLowerCase();
  return switch (extension) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    'pdf' => 'application/pdf',
    'zip' => 'application/zip',
    'rar' => 'application/vnd.rar',
    '7z' => 'application/x-7z-compressed',
    'txt' => 'text/plain',
    'doc' => 'application/msword',
    'docx' =>
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls' => 'application/vnd.ms-excel',
    'xlsx' =>
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'mp3' => 'audio/mpeg',
    'mp4' => 'video/mp4',
    'apk' => 'application/vnd.android.package-archive',
    _ => 'application/octet-stream',
  };
}

class AutoPromoterPanel extends ConsumerStatefulWidget {
  const AutoPromoterPanel({super.key});

  @override
  ConsumerState<AutoPromoterPanel> createState() => _AutoPromoterPanelState();
}

class _AutoPromoterPanelState extends ConsumerState<AutoPromoterPanel> {
  String? _busyKey;
  String? _selectedKey;

  @override
  Widget build(BuildContext context) {
    final campaigns = ref.watch(botAdCampaignsProvider);
    final dashboard = ref.watch(dashboardSnapshotProvider);
    return _ModuleSurface(
      title: 'Autodivulgador',
      subtitle:
          'Divulgue seus grupos com intervalos e validação em tempo real.',
      icon: Icons.outbox_outlined,
      onRefresh: () {
        ref.invalidate(botAdCampaignsProvider);
        ref.invalidate(dashboardSnapshotProvider);
      },
      child: campaigns.when(
        data: (data) {
          final snapshot = dashboard.asData?.value;
          final campaigns = data.campaigns
              .where((campaign) => !campaign.isStatusCampaign)
              .toList(growable: false);
          final selected = _selectedCampaign(campaigns);
          final list = ListView(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
            children: [
              _PanelCard(
                title: 'Divulgações automáticas',
                subtitle:
                    'Cada envio confirma conexão, participação e permissão do grupo.',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.icon(
                        onPressed: _busyKey == null
                            ? () => _openCampaignEditor(
                                groups: snapshot?.groups ?? const [],
                                instances: snapshot?.instances ?? const [],
                              )
                            : null,
                        icon: const Icon(Icons.add_rounded),
                        label: const Text('Nova divulgação'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    _ListOrEmpty(
                      isEmpty: campaigns.isEmpty,
                      emptyText: 'Nenhuma divulgação automática criada ainda.',
                      children: campaigns
                          .map(
                            (campaign) => _CampaignTile(
                              campaign: campaign,
                              selected:
                                  _selectedKey == 'campaign-${campaign.id}',
                              busy: _busyKey == 'campaign-${campaign.id}',
                              onTap: () {
                                final compact =
                                    MediaQuery.sizeOf(context).width < 900;
                                if (compact) {
                                  _openCampaignEditor(
                                    campaign: campaign,
                                    groups: snapshot?.groups ?? const [],
                                    instances: snapshot?.instances ?? const [],
                                  );
                                } else {
                                  setState(
                                    () => _selectedKey =
                                        'campaign-${campaign.id}',
                                  );
                                }
                              },
                              onAction: (action) => _handleCampaignAction(
                                campaign,
                                action,
                                groups: snapshot?.groups ?? const [],
                                instances: snapshot?.instances ?? const [],
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ],
                ),
              ),
            ],
          );
          return _ManagementSplitSurface(
            list: list,
            detail: _CampaignDetailPane(
              campaign: selected,
              busy: selected != null && _busyKey == 'campaign-${selected.id}',
              onAction: selected == null
                  ? null
                  : (action) => _handleCampaignAction(
                      selected,
                      action,
                      groups: snapshot?.groups ?? const [],
                      instances: snapshot?.instances ?? const [],
                    ),
            ),
          );
        },
        error: (error, _) => _ErrorBlock(
          message: error.toString(),
          onRetry: () => ref.invalidate(botAdCampaignsProvider),
        ),
        loading: () => const _LoadingBlock(),
      ),
    );
  }

  BotAdCampaignSummary? _selectedCampaign(List<BotAdCampaignSummary> items) {
    if (items.isEmpty) return null;
    final selected = _selectedKey;
    if (selected == null) return items.first;
    for (final item in items) {
      if ('campaign-${item.id}' == selected) return item;
    }
    return items.first;
  }

  Future<void> _openCampaignEditor({
    BotAdCampaignSummary? campaign,
    required List<BotGroup> groups,
    required List<BotInstance> instances,
  }) async {
    if (instances.where((instance) => instance.isConnected).isEmpty) {
      showErrorToast(
        context,
        'Conecte ao menos um perfil do WhatsApp antes de divulgar.',
      );
      return;
    }
    final draft = await showDialog<_AutoPromoterDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _AutoPromoterEditor(
        campaign: campaign,
        groups: groups,
        instances: instances,
      ),
    );
    if (draft == null) return;
    await _runCampaignAction(
      campaign == null ? 'campaign-new' : 'campaign-${campaign.id}',
      campaign == null ? 'Divulgação criada.' : 'Divulgação atualizada.',
      () => ref
          .read(apiClientProvider)
          .saveAutoPromoter(
            campaignId: campaign?.id,
            name: draft.name,
            description: draft.description,
            content: draft.content,
            targets: draft.targets,
            intervalMinutes: draft.intervalMinutes,
            targetMode: draft.targetMode,
            targetDelayMinMinutes: draft.targetDelayMinMinutes,
            targetDelayMaxMinutes: draft.targetDelayMaxMinutes,
            prioritizeNeverSent: draft.prioritizeNeverSent,
            enabled: draft.enabled,
          ),
    );
  }

  Future<void> _handleCampaignAction(
    BotAdCampaignSummary campaign,
    String action, {
    required List<BotGroup> groups,
    required List<BotInstance> instances,
  }) async {
    switch (action) {
      case 'edit':
        await _openCampaignEditor(
          campaign: campaign,
          groups: groups,
          instances: instances,
        );
        return;
      case 'run':
        await _runCampaignAction(
          'campaign-${campaign.id}',
          'Divulgação enviada para processamento.',
          () => ref.read(apiClientProvider).runBotAdCampaignNow(campaign.id),
        );
        return;
      case 'toggle':
        await _runCampaignAction(
          'campaign-${campaign.id}',
          campaign.active ? 'Divulgação pausada.' : 'Divulgação ativada.',
          () => ref
              .read(apiClientProvider)
              .updateBotAdCampaignStatus(
                campaign.id,
                campaign.active ? 'paused' : 'scheduled',
              ),
        );
        return;
      case 'delete':
        final confirmed = await _confirmAction(
          context,
          title: 'Excluir divulgação',
          message: 'Excluir "${campaign.name}" definitivamente?',
          confirmLabel: 'Excluir',
          destructive: true,
        );
        if (!confirmed) return;
        await _runCampaignAction(
          'campaign-${campaign.id}',
          'Divulgação excluída.',
          () => ref.read(apiClientProvider).deleteBotAdCampaign(campaign.id),
        );
        return;
    }
  }

  Future<void> _runCampaignAction(
    String key,
    String success,
    Future<void> Function() action,
  ) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = key);
    try {
      await action();
      ref.invalidate(botAdCampaignsProvider);
      if (mounted) showSuccessToast(context, success);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }
}

class AffiliatesPanel extends ConsumerStatefulWidget {
  const AffiliatesPanel({
    super.key,
    this.partnerSection,
    this.onCustomers,
    this.onCredits,
    this.onTeam,
  });

  final PartnerWorkspaceSection? partnerSection;
  final VoidCallback? onCustomers;
  final VoidCallback? onCredits;
  final VoidCallback? onTeam;

  @override
  ConsumerState<AffiliatesPanel> createState() => _AffiliatesPanelState();
}

class _AffiliatesPanelState extends ConsumerState<AffiliatesPanel> {
  String? _busyKey;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(authControllerProvider).value;
    final reseller = ref.watch(resellerDashboardProvider);
    // Parceiros usam o mesmo painel visual do usuário, mas não precisam
    // carregar os módulos de afiliados de catálogo. Isso deixa a tela leve e
    // evita misturar dados do consumidor final com a carteira de revenda.
    if ((session?.user.partnerRole ?? '').isNotEmpty &&
        widget.partnerSection != null) {
      return _buildPartnerSection(reseller);
    }
    if ((session?.user.partnerRole ?? '').isNotEmpty) {
      return _ModuleSurface(
        title: 'Painel de parceiros',
        subtitle: 'Clientes, créditos e ativações em um único lugar.',
        icon: Icons.handshake_outlined,
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
          children: [
            reseller.when(
              data: (snapshot) => snapshot.enabled
                  ? _ResellerProgramCard(
                      snapshot: snapshot,
                      busy: _busyKey != null,
                      onCreateCustomer: () =>
                          _openResellerCustomerEditor(snapshot),
                      onActivate: (customer) =>
                          _activateResellerCustomer(customer, snapshot),
                    )
                  : const _PanelCard(
                      title: 'Programa de parceiros',
                      child: Text(
                        'O programa ainda não está habilitado para esta conta.',
                      ),
                    ),
              error: (error, _) => _PanelCard(
                title: 'Programa de parceiros',
                child: _ErrorBlock(
                  message: error.toString(),
                  onRetry: () => ref.invalidate(resellerDashboardProvider),
                ),
              ),
              loading: () => const _PanelCard(
                title: 'Programa de parceiros',
                child: _LoadingBlock(compact: true),
              ),
            ),
          ],
        ),
      );
    }
    final providers = ref.watch(affiliateProvidersProvider);
    final links = ref.watch(affiliateLinksProvider);
    return _ModuleSurface(
      title: 'Afiliados',
      subtitle: 'Provedores, links automáticos e produtos salvos.',
      icon: Icons.sell_outlined,
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
        children: [
          reseller.when(
            data: (snapshot) => snapshot.enabled
                ? _ResellerProgramCard(
                    snapshot: snapshot,
                    busy: _busyKey != null,
                    onCreateCustomer: () =>
                        _openResellerCustomerEditor(snapshot),
                    onActivate: (customer) =>
                        _activateResellerCustomer(customer, snapshot),
                  )
                : const SizedBox.shrink(),
            error: (error, _) => _PanelCard(
              title: 'Programa de revenda',
              child: _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(resellerDashboardProvider),
              ),
            ),
            loading: () => const _PanelCard(
              title: 'Programa de revenda',
              child: _LoadingBlock(compact: true),
            ),
          ),
          if (reseller.value?.enabled == true) const SizedBox(height: 14),
          providers.when(
            data: (items) => _PanelCard(
              title: 'Contas afiliadas',
              subtitle: 'Conexões configuradas para catálogos e links.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: _busyKey == null
                          ? () => _openCredentialsEditor()
                          : null,
                      icon: const Icon(Icons.add_link_rounded),
                      label: const Text('Conectar conta'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ListOrEmpty(
                    isEmpty: items.isEmpty,
                    emptyText: 'Nenhum provedor afiliado configurado.',
                    children: items
                        .map(
                          (provider) => _AffiliateProviderTile(
                            provider: provider,
                            busy: _busyKey == 'provider-${provider.provider}',
                            onAction: (action) =>
                                _handleProviderAction(provider, action),
                          ),
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
            error: (error, _) => _PanelCard(
              title: 'Contas afiliadas',
              child: _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(affiliateProvidersProvider),
              ),
            ),
            loading: () => const _PanelCard(
              title: 'Contas afiliadas',
              child: _LoadingBlock(compact: true),
            ),
          ),
          const SizedBox(height: 14),
          links.when(
            data: (data) => _PanelCard(
              title: 'Produtos afiliados',
              subtitle: 'Clique em um produto para editar em modal.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: _busyKey == null ? _openLinkEditor : null,
                      icon: const Icon(Icons.add_rounded),
                      label: const Text('Novo produto'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ListOrEmpty(
                    isEmpty: data.allLinks.isEmpty,
                    emptyText: 'Nenhum produto afiliado salvo ainda.',
                    children: data.allLinks
                        .take(60)
                        .map(
                          (link) => _AffiliateProductTile(
                            link: link,
                            busy:
                                _busyKey ==
                                'link-${link.provider}-${link.itemId}',
                            onAction: (action) =>
                                _handleAffiliateLinkAction(link, action),
                          ),
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
            error: (error, _) => _PanelCard(
              title: 'Produtos afiliados',
              child: _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(affiliateLinksProvider),
              ),
            ),
            loading: () => const _PanelCard(
              title: 'Produtos afiliados',
              child: _LoadingBlock(compact: true),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPartnerSection(AsyncValue<ResellerDashboardSnapshot> reseller) {
    final section = widget.partnerSection!;
    final wa = WaTheme.of(context);
    // O header da área de parceiros é o mesmo header WhatsApp do painel do
    // usuário. Não renderize um segundo título/subtítulo de módulo aqui.
    return ColoredBox(
      color: wa.contentBg,
      child: reseller.when(
        loading: () => const _LoadingBlock(compact: true),
        error: (error, _) => _ErrorBlock(
          message: error.toString(),
          onRetry: () => ref.invalidate(resellerDashboardProvider),
        ),
        data: (snapshot) => switch (section) {
          PartnerWorkspaceSection.customers => ListView(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  onPressed: _busyKey == null
                      ? () => _openResellerCustomerEditor(snapshot)
                      : null,
                  icon: const Icon(Icons.person_add_alt_1_outlined),
                  label: const Text('Novo cliente'),
                ),
              ),
              const SizedBox(height: 12),
              _PartnerCustomersView(
                snapshot: snapshot,
                onActivate: (customer) =>
                    _activateResellerCustomer(customer, snapshot),
                onImpersonate: (customer) => _enterResellerCustomer(customer),
                onEdit: (customer) => _editResellerCustomer(customer),
              ),
            ],
          ),
          PartnerWorkspaceSection.team => _PartnerTeamView(
            snapshot: snapshot,
            onCreate: () => _openPartnerMemberEditor(snapshot),
            onEdit: _editPartnerMember,
            onGrantCredits: _grantPartnerCredits,
            onImpersonate: _enterSubpartner,
            onRemove: _removePartnerMember,
            onFinance: (member) => _openPartnerFinanceFor(member, snapshot),
          ),
          PartnerWorkspaceSection.credits => _PartnerCreditsView(
            snapshot: snapshot,
            onBuyCredits: () => _openPartnerCreditPurchase(context, ref),
          ),
          PartnerWorkspaceSection.payments => _PartnerPaymentsView(
            snapshot: snapshot,
          ),
          PartnerWorkspaceSection.overview => _PartnerOverviewView(
            snapshot: snapshot,
            onCustomers: widget.onCustomers,
            onCredits: widget.onCredits,
            onTeam: _permissionEnabled(snapshot, 'manage_partners')
                ? widget.onTeam
                : null,
          ),
        },
      ),
    );
  }

  void _refresh() {
    ref.invalidate(affiliateProvidersProvider);
    ref.invalidate(affiliateLinksProvider);
    ref.invalidate(resellerDashboardProvider);
  }

  Future<void> _openResellerCustomerEditor(
    ResellerDashboardSnapshot snapshot,
  ) async {
    final draft = await showDialog<_ResellerCustomerDraft>(
      context: context,
      builder: (_) => _ResellerCustomerDialog(plans: snapshot.plans),
    );
    if (draft == null) return;
    await _runAffiliateAction(
      'reseller-customer-new',
      draft.planId == null ? 'Cliente criado.' : 'Cliente criado e ativado.',
      () => ref
          .read(apiClientProvider)
          .createResellerCustomer(
            name: draft.name,
            email: draft.email,
            password: draft.password,
            whatsappNumber: draft.whatsappNumber,
            planId: draft.planId,
          ),
    );
  }

  Future<void> _activateResellerCustomer(
    ResellerCustomerSummary customer,
    ResellerDashboardSnapshot snapshot,
  ) async {
    if (snapshot.plans.isEmpty) {
      showErrorToast(context, 'Nenhum plano ativo disponível.');
      return;
    }
    var selectedPlanId = customer.planId ?? snapshot.plans.first.id;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('Ativar ${customer.name}'),
          content: DropdownButtonFormField<int>(
            initialValue: selectedPlanId,
            decoration: const InputDecoration(labelText: 'Plano'),
            items: snapshot.plans
                .map(
                  (plan) => DropdownMenuItem(
                    value: plan.id,
                    child: Text('${plan.name} · ${plan.durationDays} dias'),
                  ),
                )
                .toList(),
            onChanged: (value) {
              if (value != null) setDialogState(() => selectedPlanId = value);
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Usar 1 crédito'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    await _runAffiliateAction(
      'reseller-activate-${customer.userId}',
      'Cliente ativado com sucesso.',
      () => ref
          .read(apiClientProvider)
          .activateResellerCustomer(
            customerUserId: customer.userId,
            planId: selectedPlanId,
            idempotencyKey:
                'flutter:${customer.userId}:$selectedPlanId:${DateTime.now().millisecondsSinceEpoch}',
          ),
    );
  }

  Future<void> _enterResellerCustomer(ResellerCustomerSummary customer) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Entrar como ${customer.name}'),
        content: const Text(
          'O painel do cliente será aberto nesta sessão para suporte. Você poderá voltar ao painel de parceiros ao sair.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Entrar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final session = await ref
          .read(apiClientProvider)
          .impersonateResellerCustomer(customer.userId);
      ref.read(authControllerProvider.notifier).setSession(session);
      if (mounted)
        showSuccessToast(context, 'Sessão iniciada como ${session.user.name}.');
      redirectToPath('/dashboard/user');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _editResellerCustomer(ResellerCustomerSummary customer) async {
    final draft = await showDialog<_ResellerCustomerEditDraft>(
      context: context,
      builder: (_) => _PartnerCustomerEditDialog(customer: customer),
    );
    if (draft == null) return;
    await _runAffiliateAction(
      'reseller-customer-edit-${customer.userId}',
      'Cliente atualizado.',
      () => ref
          .read(apiClientProvider)
          .updateResellerCustomer(
            customerUserId: customer.userId,
            name: draft.name,
            email: draft.email,
            whatsappNumber: draft.whatsappNumber,
          ),
    );
  }

  Future<void> _openPartnerMemberEditor(
    ResellerDashboardSnapshot snapshot,
  ) async {
    final draft = await showDialog<_PartnerMemberDraft>(
      context: context,
      builder: (_) => _PartnerMemberDialog(
        allowMaster: snapshot.role == 'owner',
      ),
    );
    if (draft == null) return;
    await _runAffiliateAction(
      'partner-member-create-${draft.email}',
      'Revendedor criado e acesso liberado.',
      () => ref
          .read(apiClientProvider)
          .createPartnerMember(
            name: draft.name,
            email: draft.email,
            password: draft.password,
            whatsappNumber: draft.whatsappNumber,
            permissions: const {
              'manage_customers': true,
              'activate_customers': true,
              'view_financial': true,
            },
            role: draft.role,
            initialCredits: draft.initialCredits,
          ),
    );
  }

  Future<void> _openPartnerFinanceFor(
    PartnerMemberSummary member,
    ResellerDashboardSnapshot snapshot,
  ) async {
    final current = await ref
        .read(apiClientProvider)
        .getPartnerFinancialSettings(member.userId);
    if (!mounted) return;
    final settings = current['settings'] is Map
        ? Map<String, dynamic>.from(current['settings'] as Map)
        : const <String, dynamic>{};
    final result = await showDialog<_PartnerFinanceDraft>(
      context: context,
      builder: (_) => _PartnerFinanceDialog(
        settings: settings,
        plans: snapshot.plans,
        canConfigureChildren: false,
      ),
    );
    if (result == null) return;
    try {
      await ref
          .read(apiClientProvider)
          .savePartnerFinancialSettings(
            userId: member.userId,
            creditUnitPrice: result.creditUnitPrice,
            manualPaymentsEnabled: result.manualPaymentsEnabled,
            allowChildManualPayments: false,
            manualPixKey: result.pixKey,
            manualInstructions: result.instructions,
            proxySalesMode: result.proxySalesMode,
            proxyMonthlyPrice: result.proxyMonthlyPrice,
            allowCustomerProxy: result.allowCustomerProxy,
            proxySalesInstructions: result.proxySalesInstructions,
            planCosts: result.planCosts,
          );
      ref.invalidate(resellerDashboardProvider);
      if (mounted)
        showSuccessToast(context, 'Regras de ${member.name} atualizadas.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _editPartnerMember(PartnerMemberSummary member) async {
    final draft = await showDialog<_PartnerMemberEditDraft>(
      context: context,
      builder: (_) => _PartnerMemberEditDialog(member: member),
    );
    if (draft == null) return;
    await _runAffiliateAction(
      'partner-member-edit-${member.userId}',
      'Revendedor atualizado.',
      () => ref
          .read(apiClientProvider)
          .updateSubpartner(
            userId: member.userId,
            name: draft.name,
            email: draft.email,
            whatsappNumber: draft.whatsappNumber,
            password: draft.password,
            status: draft.status,
            commissionRate: draft.commissionRate,
            permissions: draft.permissions,
          ),
    );
  }

  Future<void> _grantPartnerCredits(PartnerMemberSummary member) async {
    final controller = TextEditingController();
    final credits = await showDialog<int>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Créditos para ${member.name}'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Quantidade'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(
              dialogContext,
              int.tryParse(controller.text.trim()),
            ),
            child: const Text('Distribuir'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (credits == null || credits <= 0) return;
    await _runAffiliateAction(
      'partner-member-credits-${member.userId}',
      'Créditos distribuídos.',
      () => ref
          .read(apiClientProvider)
          .grantPartnerCredits(
            resellerUserId: member.userId,
            credits: credits,
            idempotencyKey:
                'flutter:partner:${member.userId}:$credits:${DateTime.now().millisecondsSinceEpoch}',
          ),
    );
  }

  Future<void> _enterSubpartner(PartnerMemberSummary member) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Entrar como ${member.name}'),
        content: const Text('O painel do revendedor será aberto para suporte.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Entrar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final session = await ref
          .read(apiClientProvider)
          .impersonateSubpartner(member.userId);
      // Nunca reaproveite dados, contagens ou permissões da conta Master na
      // sessão do revendedor que acabou de ser aberta.
      ref.invalidate(resellerDashboardProvider);
      ref.read(authControllerProvider.notifier).setSession(session);
      redirectToPath('/dashboard/partner');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _removePartnerMember(PartnerMemberSummary member) async {
    final confirmed = await _confirmAction(
      context,
      title: 'Remover ${member.name} da equipe?',
      message:
          'A conta permanecerá no sistema, mas perderá o acesso ao painel de parceiros.',
      confirmLabel: 'Remover',
      destructive: true,
    );
    if (!confirmed) return;
    await _runAffiliateAction(
      'partner-member-remove-${member.userId}',
      'Revendedor removido da equipe.',
      () => ref.read(apiClientProvider).removeSubpartner(member.userId),
    );
  }

  Future<void> _openCredentialsEditor([
    AffiliateProviderSummary? provider,
  ]) async {
    final draft = await showDialog<_AffiliateCredentialsDraft>(
      context: context,
      builder: (context) => _AffiliateCredentialsDialog(provider: provider),
    );
    if (draft == null) return;
    await _runAffiliateAction(
      'provider-${draft.provider}',
      'Credenciais salvas.',
      () => ref
          .read(apiClientProvider)
          .saveAffiliateProviderCredentials(
            draft.provider,
            accountName: draft.accountName,
            appId: draft.appId,
            clientSecret: draft.clientSecret,
            appToken: draft.appToken,
          ),
    );
  }

  Future<void> _openLinkEditor([AffiliateProductLink? link]) async {
    final draft = await showDialog<_AffiliateLinkDraft>(
      context: context,
      builder: (context) => _AffiliateLinkDialog(link: link),
    );
    if (draft == null) return;
    await _runAffiliateAction(
      link == null ? 'link-new' : 'link-${link.provider}-${link.itemId}',
      link == null ? 'Produto salvo.' : 'Produto atualizado.',
      () {
        if (link == null) {
          return ref
              .read(apiClientProvider)
              .createAffiliateLink(
                provider: draft.provider,
                affiliateUrl: draft.affiliateUrl,
                note: draft.note,
              );
        }
        return ref
            .read(apiClientProvider)
            .updateAffiliateLink(link, draft.toUpdatePayload());
      },
    );
  }

  Future<void> _handleProviderAction(
    AffiliateProviderSummary provider,
    String action,
  ) async {
    switch (action) {
      case 'edit':
        await _openCredentialsEditor(provider);
        return;
      case 'refresh':
        await _runAffiliateAction(
          'provider-${provider.provider}',
          'Provedor atualizado.',
          () => ref
              .read(apiClientProvider)
              .refreshAffiliateProvider(provider.provider),
        );
        return;
      case 'disconnect':
        final confirmed = await _confirmAction(
          context,
          title: 'Desconectar conta',
          message: 'Desconectar ${provider.label}?',
          confirmLabel: 'Desconectar',
          destructive: true,
        );
        if (!confirmed) return;
        await _runAffiliateAction(
          'provider-${provider.provider}',
          'Conta desconectada.',
          () => ref
              .read(apiClientProvider)
              .disconnectAffiliateProvider(provider.provider),
        );
        return;
    }
  }

  Future<void> _handleAffiliateLinkAction(
    AffiliateProductLink link,
    String action,
  ) async {
    switch (action) {
      case 'edit':
        await _openLinkEditor(link);
        return;
      case 'toggle':
        await _runAffiliateAction(
          'link-${link.provider}-${link.itemId}',
          link.active ? 'Produto pausado.' : 'Produto ativado.',
          () => ref.read(apiClientProvider).updateAffiliateLink(link, {
            'isActive': !link.active,
          }),
        );
        return;
      case 'open':
        await _openUrl(link.affiliateUrl);
        return;
      case 'delete':
        final confirmed = await _confirmAction(
          context,
          title: 'Excluir produto',
          message: 'Excluir "${link.displayTitle}"?',
          confirmLabel: 'Excluir',
          destructive: true,
        );
        if (!confirmed) return;
        await _runAffiliateAction(
          'link-${link.provider}-${link.itemId}',
          'Produto excluído.',
          () => ref.read(apiClientProvider).deleteAffiliateLink(link),
        );
        return;
    }
  }

  Future<void> _runAffiliateAction(
    String key,
    String success,
    Future<void> Function() action,
  ) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = key);
    try {
      await action();
      _refresh();
      if (mounted) showSuccessToast(context, success);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }
}

bool _permissionEnabled(ResellerDashboardSnapshot snapshot, String key) {
  final value = snapshot.permissions[key];
  if (value is bool) return value;
  if (value is num) return value != 0;
  return switch (value?.toString().trim().toLowerCase()) {
    'true' || '1' || 'on' || 'sim' => true,
    _ => false,
  };
}

class _PartnerCustomersView extends StatefulWidget {
  const _PartnerCustomersView({
    required this.snapshot,
    required this.onActivate,
    required this.onImpersonate,
    required this.onEdit,
  });

  final ResellerDashboardSnapshot snapshot;
  final ValueChanged<ResellerCustomerSummary> onActivate;
  final ValueChanged<ResellerCustomerSummary> onImpersonate;
  final ValueChanged<ResellerCustomerSummary> onEdit;

  @override
  State<_PartnerCustomersView> createState() => _PartnerCustomersViewState();
}

class _PartnerCustomersViewState extends State<_PartnerCustomersView> {
  final _searchController = TextEditingController();
  String _query = '';
  int _visibleCount = 50;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      if (mounted) {
        setState(() {
          _query = _searchController.text.trim().toLowerCase();
          _visibleCount = 50;
        });
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final canActivate = _permissionEnabled(
      widget.snapshot,
      'activate_customers',
    );
    final filtered = widget.snapshot.customers.where((customer) {
      if (_query.isEmpty) return true;
      return '${customer.name} ${customer.email} ${customer.whatsappNumber ?? ''}'
          .toLowerCase()
          .contains(_query);
    }).toList();
    final visible = filtered.take(_visibleCount).toList(growable: false);
    return _PanelCard(
      title: 'Clientes',
      subtitle: 'Pesquise, abra o painel do cliente e gerencie sua assinatura.',
      child: Column(
        children: [
          TextField(
            controller: _searchController,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Limpar pesquisa',
                      onPressed: _searchController.clear,
                      icon: const Icon(Icons.clear_rounded),
                    ),
              hintText: 'Pesquisar por nome, e-mail ou WhatsApp',
              filled: true,
              fillColor: wa.inputFill,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 10),
          if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Text(
                widget.snapshot.customers.isEmpty
                    ? 'Nenhum cliente cadastrado ainda.'
                    : 'Nenhum cliente corresponde à pesquisa.',
                style: TextStyle(color: wa.textSecondary),
              ),
            )
          else
            ...visible.map(
              (customer) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  backgroundColor: wa.avatarFallback,
                  child: Text(
                    customer.name.trim().isEmpty
                        ? '?'
                        : customer.name.trim()[0].toUpperCase(),
                  ),
                ),
                title: Text(
                  customer.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  [
                    customer.email,
                    if (customer.whatsappNumber?.trim().isNotEmpty == true)
                      customer.whatsappNumber!,
                    if (customer.planName?.trim().isNotEmpty == true)
                      customer.planName!,
                  ].where((value) => value.trim().isNotEmpty).join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: PopupMenuButton<String>(
                  tooltip: 'Ações do cliente',
                  onSelected: (action) {
                    if (action == 'edit') widget.onEdit(customer);
                    if (action == 'enter') widget.onImpersonate(customer);
                    if (action == 'activate' && canActivate)
                      widget.onActivate(customer);
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(
                      value: 'edit',
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.edit_outlined),
                        title: Text('Editar cadastro'),
                      ),
                    ),
                    const PopupMenuItem(
                      value: 'enter',
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.login_rounded),
                        title: Text('Entrar no painel'),
                      ),
                    ),
                    if (canActivate)
                      PopupMenuItem(
                        value: 'activate',
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.workspace_premium_outlined),
                          title: Text(
                            customer.planName == null ? 'Ativar' : 'Renovar',
                          ),
                        ),
                      ),
                  ],
                ),
                onTap: () => widget.onImpersonate(customer),
              ),
            ),
          if (visible.length < filtered.length)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: OutlinedButton.icon(
                onPressed: () => setState(
                  () => _visibleCount = (_visibleCount + 50).clamp(
                    0,
                    filtered.length,
                  ),
                ),
                icon: const Icon(Icons.expand_more_rounded),
                label: Text(
                  'Carregar mais (${filtered.length - visible.length})',
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ResellerCustomerEditDraft {
  const _ResellerCustomerEditDraft({
    required this.name,
    required this.email,
    this.whatsappNumber,
  });
  final String name;
  final String email;
  final String? whatsappNumber;
}

class _PartnerCustomerEditDialog extends StatefulWidget {
  const _PartnerCustomerEditDialog({required this.customer});
  final ResellerCustomerSummary customer;

  @override
  State<_PartnerCustomerEditDialog> createState() =>
      _PartnerCustomerEditDialogState();
}

class _PartnerCustomerEditDialogState
    extends State<_PartnerCustomerEditDialog> {
  late final TextEditingController _name = TextEditingController(
    text: widget.customer.name,
  );
  late final TextEditingController _email = TextEditingController(
    text: widget.customer.email,
  );
  late final TextEditingController _whatsapp = TextEditingController(
    text: widget.customer.whatsappNumber ?? '',
  );

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _whatsapp.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Editar cliente'),
    content: SizedBox(
      width: 420,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Nome'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'E-mail'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _whatsapp,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'WhatsApp'),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: () {
          final name = _name.text.trim();
          final email = _email.text.trim();
          if (name.isEmpty || !email.contains('@')) return;
          Navigator.pop(
            context,
            _ResellerCustomerEditDraft(
              name: name,
              email: email,
              whatsappNumber: _whatsapp.text.trim().isEmpty
                  ? null
                  : _whatsapp.text.trim(),
            ),
          );
        },
        child: const Text('Salvar'),
      ),
    ],
  );
}

class _ResellerProgramCard extends StatelessWidget {
  const _ResellerProgramCard({
    required this.snapshot,
    required this.busy,
    required this.onCreateCustomer,
    required this.onActivate,
    this.showCreateButton = true,
  });

  final ResellerDashboardSnapshot snapshot;
  final bool busy;
  final VoidCallback onCreateCustomer;
  final ValueChanged<ResellerCustomerSummary> onActivate;
  final bool showCreateButton;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final canViewFinancial = _permissionEnabled(snapshot, 'view_financial');
    final canManageCustomers = _permissionEnabled(snapshot, 'manage_customers');
    final canActivateCustomers = _permissionEnabled(
      snapshot,
      'activate_customers',
    );
    final canManagePartners = _permissionEnabled(snapshot, 'manage_partners');
    final isSupport = snapshot.role == 'support';
    return _PanelCard(
      title: isSupport ? 'Central de suporte' : 'Programa de parceiros',
      subtitle: isSupport
          ? 'Acesso operacional sem carteira ou ativação de clientes.'
          : 'Venda acessos, gerencie seus clientes e ative planos usando créditos.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              if (canViewFinancial)
                _ResellerMetric(
                  icon: Icons.bolt_rounded,
                  label: 'Créditos disponíveis',
                  value: '${snapshot.wallet.availableCredits}',
                ),
              if (canManageCustomers)
                _ResellerMetric(
                  icon: Icons.people_alt_outlined,
                  label: 'Clientes',
                  value: '${snapshot.customers.length}',
                ),
              _ResellerMetric(
                icon: Icons.workspace_premium_outlined,
                label: 'Papel',
                value: _partnerRoleLabel(snapshot.role),
              ),
              if (canManagePartners)
                const _ResellerMetric(
                  icon: Icons.groups_2_outlined,
                  label: 'Gestão de equipe',
                  value: 'Ativa',
                ),
            ],
          ),
          if (canManageCustomers && showCreateButton)
            const SizedBox(height: 14),
          if (canManageCustomers && showCreateButton)
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: busy ? null : onCreateCustomer,
                icon: const Icon(Icons.person_add_alt_1_outlined),
                label: const Text('Novo cliente'),
              ),
            ),
          if (canManageCustomers) const SizedBox(height: 10),
          if (!canManageCustomers)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Text(
                isSupport
                    ? 'As funções de suporte ficam disponíveis conforme a permissão atribuída pelo administrador.'
                    : 'Sua conta não possui permissão para gerenciar clientes.',
                textAlign: TextAlign.center,
                style: TextStyle(color: wa.textSecondary),
              ),
            )
          else if (snapshot.customers.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'Sua carteira ainda não possui clientes.',
                textAlign: TextAlign.center,
                style: TextStyle(color: wa.textSecondary),
              ),
            )
          else
            ...snapshot.customers
                .take(50)
                .map(
                  (customer) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      backgroundColor: wa.avatarFallback,
                      child: Text(
                        customer.name.trim().isEmpty
                            ? '?'
                            : customer.name.trim()[0].toUpperCase(),
                      ),
                    ),
                    title: Text(customer.name),
                    subtitle: Text(
                      [
                        customer.email,
                        if (customer.planName != null) customer.planName!,
                      ].where((item) => item.trim().isNotEmpty).join(' · '),
                    ),
                    trailing: canActivateCustomers
                        ? OutlinedButton(
                            onPressed: busy ? null : () => onActivate(customer),
                            child: Text(
                              customer.planName == null ? 'Ativar' : 'Renovar',
                            ),
                          )
                        : null,
                  ),
                ),
        ],
      ),
    );
  }
}

class _ResellerMetric extends StatelessWidget {
  const _ResellerMetric({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      constraints: const BoxConstraints(minWidth: 170),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: wa.inputFill,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: wa.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: const Color(0xFF00A884)),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                value,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(label, style: TextStyle(color: wa.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }
}

class _PartnerOverviewView extends StatelessWidget {
  const _PartnerOverviewView({
    required this.snapshot,
    this.onCustomers,
    this.onCredits,
    this.onTeam,
  });
  final ResellerDashboardSnapshot snapshot;
  final VoidCallback? onCustomers;
  final VoidCallback? onCredits;
  final VoidCallback? onTeam;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _PartnerShortcutCard(
              icon: Icons.people_alt_outlined,
              label: 'Clientes',
              value: '${snapshot.customers.length}',
              onTap: onCustomers,
            ),
            if (_permissionEnabled(snapshot, 'view_financial'))
              _PartnerShortcutCard(
                icon: Icons.bolt_rounded,
                label: 'Créditos disponíveis',
                value: '${snapshot.wallet.availableCredits}',
                onTap: onCredits,
              ),
            if (onTeam != null)
              _PartnerShortcutCard(
                icon: Icons.groups_2_outlined,
                label: 'Equipe',
                value: '${snapshot.partners.length}',
                onTap: onTeam,
              ),
          ],
        ),
        const SizedBox(height: 18),
        _PanelCard(
          title: 'Operação organizada',
          child: Text(
            'Use o menu para alternar entre clientes, equipe e créditos. Cada área respeita as permissões definidas pelo administrador.',
            style: TextStyle(color: wa.textSecondary, height: 1.4),
          ),
        ),
      ],
    );
  }
}

class _PartnerShortcutCard extends StatelessWidget {
  const _PartnerShortcutCard({
    required this.icon,
    required this.label,
    required this.value,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        constraints: const BoxConstraints(minWidth: 190),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: wa.inputFill,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: wa.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: wa.accent),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(label, style: TextStyle(color: wa.textSecondary)),
                if (onTap != null)
                  Text(
                    'Abrir',
                    style: TextStyle(
                      color: wa.accent,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
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

Future<void> _openPartnerCreditPurchase(
  BuildContext context,
  WidgetRef ref,
) async {
  final controller = TextEditingController(text: '10');
  final credits = await showDialog<int>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Comprar créditos'),
      content: TextField(
        controller: controller,
        autofocus: true,
        keyboardType: TextInputType.number,
        decoration: const InputDecoration(
          labelText: 'Quantidade',
          helperText: 'De 1 a 10.000 créditos.',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(
            dialogContext,
            int.tryParse(controller.text.trim()),
          ),
          child: const Text('Continuar'),
        ),
      ],
    ),
  );
  controller.dispose();
  if (credits == null || credits < 1) return;
  try {
    final checkout = await ref
        .read(apiClientProvider)
        .createResellerCreditCheckout(credits: credits);
    final url = (checkout['checkoutUrl'] ?? '').toString();
    if (url.isEmpty) throw Exception('O checkout não foi gerado.');
    final opened = await launchUrl(
      Uri.parse(url),
      mode: LaunchMode.externalApplication,
    );
    if (!opened && context.mounted) {
      showErrorToast(context, 'Não foi possível abrir o checkout.');
    }
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

Future<void> _openManualPartnerPayment(
  BuildContext context,
  WidgetRef ref,
) async {
  final creditsController = TextEditingController(text: '1');
  final noteController = TextEditingController();
  XFile? selected;
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: const Text('Comprar créditos por Pix'),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Faça o Pix conforme as instruções da sua conta e envie o comprovante.',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: creditsController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Quantidade de créditos',
                ),
              ),
              TextField(
                controller: noteController,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Observação (opcional)',
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  final file = await openFile(
                    acceptedTypeGroups: [
                      const XTypeGroup(
                        label: 'Comprovante',
                        extensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
                      ),
                    ],
                  );
                  if (file != null) setState(() => selected = file);
                },
                icon: const Icon(Icons.attach_file),
                label: Text(
                  selected == null ? 'Selecionar comprovante' : selected!.name,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: selected == null
                ? null
                : () => Navigator.pop(dialogContext, true),
            child: const Text('Enviar para aprovação'),
          ),
        ],
      ),
    ),
  );
  if (result != true || selected == null) {
    creditsController.dispose();
    noteController.dispose();
    return;
  }
  try {
    final credits = int.tryParse(creditsController.text.trim()) ?? 0;
    if (credits <= 0)
      throw Exception('Informe uma quantidade válida de créditos.');
    final bytes = await selected!.readAsBytes();
    await ref
        .read(apiClientProvider)
        .submitManualPartnerPayment(
          credits: credits,
          proofBytes: bytes,
          proofFileName: selected!.name,
          proofMimeType: selected!.mimeType,
          note: noteController.text,
        );
    if (context.mounted)
      showSuccessToast(context, 'Comprovante enviado. Aguarde a aprovação.');
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  } finally {
    creditsController.dispose();
    noteController.dispose();
  }
}

class _PartnerCreditsView extends ConsumerWidget {
  const _PartnerCreditsView({
    required this.snapshot,
    required this.onBuyCredits,
  });
  final ResellerDashboardSnapshot snapshot;
  final VoidCallback onBuyCredits;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final title = Text(
              'Carteira',
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 22,
                fontWeight: FontWeight.w700,
              ),
            );
            final actions = Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.end,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _openManualPartnerPayment(context, ref),
                  icon: const Icon(Icons.upload_file_outlined),
                  label: const Text('Pix manual'),
                ),
                FilledButton.icon(
                  onPressed: onBuyCredits,
                  icon: const Icon(Icons.add_card_outlined),
                  label: const Text('Comprar créditos'),
                ),
              ],
            );
            if (constraints.maxWidth < 560) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [title, const SizedBox(height: 12), actions],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(child: title),
                actions,
              ],
            );
          },
        ),
        const SizedBox(height: 18),
        Text(
          '${snapshot.wallet.availableCredits}',
          style: TextStyle(
            color: wa.accent,
            fontSize: 46,
            fontWeight: FontWeight.w800,
          ),
        ),
        Text(
          'créditos disponíveis',
          style: TextStyle(color: wa.textSecondary, fontSize: 16),
        ),
        const SizedBox(height: 18),
        Text(
          '${snapshot.wallet.reservedCredits} reservados · saldo total ${snapshot.wallet.creditBalance}',
          style: TextStyle(color: wa.textSecondary),
        ),
      ],
    );
  }
}

class _PartnerPaymentsView extends ConsumerStatefulWidget {
  const _PartnerPaymentsView({required this.snapshot});
  final ResellerDashboardSnapshot snapshot;

  @override
  ConsumerState<_PartnerPaymentsView> createState() =>
      _PartnerPaymentsViewState();
}

class _PartnerPaymentsViewState extends ConsumerState<_PartnerPaymentsView> {
  bool _busy = false;
  late Future<List<Map<String, dynamic>>> _proxies;

  @override
  void initState() {
    super.initState();
    _proxies = ref.read(apiClientProvider).loadPartnerCustomerProxies();
  }

  void _reloadProxies() {
    setState(() {
      _proxies = ref.read(apiClientProvider).loadPartnerCustomerProxies();
    });
  }

  Future<void> _editManagedProxy(Map<String, dynamic> instance) async {
    final result = await showDialog<Map<String, Object?>>(
      context: context,
      builder: (_) => _ManagedProxyDialog(instance: instance),
    );
    if (result == null) return;
    try {
      await ref.read(apiClientProvider).savePartnerCustomerProxy(
        instanceId: int.parse('${instance['id']}'),
        proxy: result,
      );
      _reloadProxies();
      if (mounted) showSuccessToast(context, 'Proxy do cliente atualizado.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _connect() async {
    setState(() => _busy = true);
    try {
      final url = await ref
          .read(apiClientProvider)
          .connectResellerMercadoPago();
      if (url.isEmpty)
        throw Exception(
          'O Mercado Pago não retornou o endereço de autorização.',
        );
      final opened = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted)
        showErrorToast(context, 'Não foi possível abrir o Mercado Pago.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _disconnect() async {
    final confirmed = await _confirmAction(
      context,
      title: 'Desconectar Mercado Pago',
      message: 'As novas vendas deixarão de usar split até uma nova conexão.',
      confirmLabel: 'Desconectar',
      destructive: true,
    );
    if (!confirmed) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).disconnectResellerMercadoPago();
      ref.invalidate(partnerPaymentSettingsProvider);
      if (mounted)
        showSuccessToast(context, 'Conta Mercado Pago desconectada.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final payment = ref.watch(partnerPaymentSettingsProvider);
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        payment.when(
          loading: () => const _PanelCard(
            title: 'Mercado Pago',
            child: _LoadingBlock(compact: true),
          ),
          error: (error, _) => _PanelCard(
            title: 'Mercado Pago',
            child: _ErrorBlock(
              message: error.toString(),
              onRetry: () => ref.invalidate(partnerPaymentSettingsProvider),
            ),
          ),
          data: (data) {
            final connected = data['connected'] == true;
            final configured = data['marketplaceConfigured'] == true;
            final account = data['account'] is Map
                ? Map<String, dynamic>.from(data['account'] as Map)
                : const <String, dynamic>{};
            final commission =
                '${(double.tryParse('${data['commissionRate'] ?? 20}') ?? 20).toStringAsFixed(1)}%';
            return _PanelCard(
              title: 'Mercado Pago Marketplace',
              subtitle:
                  'Receba renovações e distribua automaticamente a parte do Master ou revendedor.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Align(
                    alignment: Alignment.centerRight,
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : _openFinanceRules,
                      icon: const Icon(Icons.tune_rounded),
                      label: const Text('Regras financeiras'),
                    ),
                  ),
                  if (!configured)
                    const Text(
                      'O administrador ainda precisa cadastrar o aplicativo Marketplace (Client ID e Client Secret) no servidor.',
                      style: TextStyle(color: Colors.orange),
                    ),
                  if (configured) ...[
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        connected
                            ? Icons.verified_rounded
                            : Icons.link_outlined,
                        color: connected ? wa.accent : wa.icon,
                      ),
                      title: Text(
                        connected ? 'Conta conectada' : 'Conta não conectada',
                      ),
                      subtitle: Text(
                        connected
                            ? '${account['nickname'] ?? account['email'] ?? 'Mercado Pago'} · sua comissão: $commission'
                            : 'Conecte sua conta para habilitar o split automático.',
                      ),
                      trailing: connected
                          ? OutlinedButton(
                              onPressed: _busy ? null : _disconnect,
                              child: const Text('Desconectar'),
                            )
                          : FilledButton.icon(
                              onPressed: _busy ? null : _connect,
                              icon: const Icon(Icons.open_in_new),
                              label: const Text('Conectar'),
                            ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'O cliente paga uma única vez. O Mercado Pago repassa a taxa da plataforma e o restante fica na conta conectada, sem transferências manuais.',
                      style: TextStyle(color: wa.textSecondary, height: 1.35),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 12),
        Text(
          'A compra utiliza a carteira de créditos. Para revendedores, o pagamento pode ser dividido entre o Master responsável e a plataforma.',
          style: TextStyle(color: wa.textSecondary, height: 1.35),
        ),
        const SizedBox(height: 12),
        _PanelCard(
          title: 'Proxies dos clientes',
          subtitle: 'Atribua uma rota testada ao perfil. IP, região e latência ficam visíveis ao cliente.',
          child: FutureBuilder<List<Map<String, dynamic>>>(
            future: _proxies,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const _LoadingBlock(compact: true);
              }
              if (snapshot.hasError) {
                return _ErrorBlock(message: snapshot.error.toString(), onRetry: _reloadProxies);
              }
              final rows = snapshot.data ?? const <Map<String, dynamic>>[];
              if (rows.isEmpty) {
                return const Text('Nenhum perfil de cliente disponível para configurar proxy.');
              }
              return Column(
                children: rows.map((row) {
                  final proxy = row['proxy'] is Map ? Map<String, dynamic>.from(row['proxy'] as Map) : const <String, dynamic>{};
                  final enabled = proxy['enabled'] == true;
                  final location = [proxy['resolvedIp'], proxy['countryName'], proxy['regionName']]
                      .where((value) => value != null && value.toString().trim().isNotEmpty)
                      .join(' · ');
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(enabled ? Icons.shield_rounded : Icons.shield_outlined, color: enabled ? wa.accent : wa.icon),
                    title: Text('${row['customerName'] ?? 'Cliente'} · ${row['name'] ?? 'Perfil'}'),
                    subtitle: Text(enabled ? (location.isEmpty ? 'Proxy ativo' : location) : 'Sem proxy configurado'),
                    trailing: OutlinedButton(
                      onPressed: () => _editManagedProxy(row),
                      child: Text(enabled ? 'Editar' : 'Configurar'),
                    ),
                  );
                }).toList(),
              );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _openFinanceRules() async {
    final current = await ref
        .read(apiClientProvider)
        .getPartnerFinancialSettings();
    if (!mounted) return;
    final settings = current['settings'] is Map
        ? Map<String, dynamic>.from(current['settings'] as Map)
        : const <String, dynamic>{};
    final result = await showDialog<_PartnerFinanceDraft>(
      context: context,
      builder: (_) => _PartnerFinanceDialog(
        settings: settings,
        plans: widget.snapshot.plans,
        canConfigureChildren:
            widget.snapshot.role == 'master' || widget.snapshot.role == 'owner',
      ),
    );
    if (result == null) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .savePartnerFinancialSettings(
            creditUnitPrice: result.creditUnitPrice,
            manualPaymentsEnabled: result.manualPaymentsEnabled,
            allowChildManualPayments: result.allowChildManualPayments,
            manualPixKey: result.pixKey,
            manualInstructions: result.instructions,
            proxySalesMode: result.proxySalesMode,
            proxyMonthlyPrice: result.proxyMonthlyPrice,
            allowCustomerProxy: result.allowCustomerProxy,
            proxySalesInstructions: result.proxySalesInstructions,
            planCosts: result.planCosts,
          );
      ref.invalidate(partnerPaymentSettingsProvider);
      ref.invalidate(resellerDashboardProvider);
      if (mounted) showSuccessToast(context, 'Regras financeiras salvas.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _ManagedProxyDialog extends StatefulWidget {
  const _ManagedProxyDialog({required this.instance});
  final Map<String, dynamic> instance;
  @override
  State<_ManagedProxyDialog> createState() => _ManagedProxyDialogState();
}

class _ManagedProxyDialogState extends State<_ManagedProxyDialog> {
  late final TextEditingController _host;
  late final TextEditingController _port;
  final _user = TextEditingController();
  final _password = TextEditingController();
  late bool _enabled;
  late String _protocol;

  @override
  void initState() {
    super.initState();
    final proxy = widget.instance['proxy'] is Map ? Map<String, dynamic>.from(widget.instance['proxy'] as Map) : const <String, dynamic>{};
    _enabled = proxy['enabled'] == true;
    _protocol = proxy['protocol'] == 'http' ? 'http' : 'socks5';
    _host = TextEditingController(text: proxy['host']?.toString() ?? '');
    _port = TextEditingController(text: proxy['port']?.toString() ?? '');
  }

  @override
  void dispose() {
    _host.dispose();
    _port.dispose();
    _user.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('Proxy · ${widget.instance['customerName'] ?? 'cliente'}'),
    content: SizedBox(
      width: 430,
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          SwitchListTile.adaptive(contentPadding: EdgeInsets.zero, title: const Text('Ativar proxy'), value: _enabled, onChanged: (v) => setState(() => _enabled = v)),
          DropdownButtonFormField<String>(value: _protocol, decoration: const InputDecoration(labelText: 'Protocolo'), items: const [DropdownMenuItem(value: 'socks5', child: Text('SOCKS5')), DropdownMenuItem(value: 'http', child: Text('HTTP / HTTPS'))], onChanged: _enabled ? (v) => setState(() => _protocol = v ?? 'socks5') : null),
          const SizedBox(height: 8),
          Row(children: [Expanded(child: TextField(controller: _host, enabled: _enabled, decoration: const InputDecoration(labelText: 'Host ou IP'))), const SizedBox(width: 8), SizedBox(width: 100, child: TextField(controller: _port, enabled: _enabled, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Porta')))]),
          const SizedBox(height: 8),
          TextField(controller: _user, enabled: _enabled, decoration: const InputDecoration(labelText: 'Usuário (opcional)', hintText: 'Em branco mantém o atual')),
          const SizedBox(height: 8),
          TextField(controller: _password, enabled: _enabled, obscureText: true, decoration: const InputDecoration(labelText: 'Senha (opcional)', hintText: 'Em branco mantém a atual')),
        ]),
      ),
    ),
    actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')), FilledButton(onPressed: () => Navigator.pop(context, <String, Object?>{'enabled': _enabled, 'protocol': _protocol, 'host': _host.text.trim(), 'port': int.tryParse(_port.text.trim()) ?? 0, 'username': _user.text.trim(), 'password': _password.text, 'preserveUsername': _user.text.trim().isEmpty, 'preservePassword': _password.text.isEmpty}), child: const Text('Testar e salvar'))],
  );
}

class _PartnerFinanceDraft {
  const _PartnerFinanceDraft({
    required this.creditUnitPrice,
    required this.manualPaymentsEnabled,
    required this.allowChildManualPayments,
    this.pixKey,
    this.instructions,
    required this.proxySalesMode,
    required this.proxyMonthlyPrice,
    required this.allowCustomerProxy,
    this.proxySalesInstructions,
    required this.planCosts,
  });
  final double creditUnitPrice;
  final bool manualPaymentsEnabled;
  final bool allowChildManualPayments;
  final String? pixKey;
  final String? instructions;
  final String proxySalesMode;
  final double proxyMonthlyPrice;
  final bool allowCustomerProxy;
  final String? proxySalesInstructions;
  final List<Map<String, Object?>> planCosts;
}

class _PartnerFinanceDialog extends StatefulWidget {
  const _PartnerFinanceDialog({
    required this.settings,
    required this.plans,
    required this.canConfigureChildren,
  });
  final Map<String, dynamic> settings;
  final List<SubscriptionPlanSummary> plans;
  final bool canConfigureChildren;
  @override
  State<_PartnerFinanceDialog> createState() => _PartnerFinanceDialogState();
}

class _PartnerFinanceDialogState extends State<_PartnerFinanceDialog> {
  late final _price = TextEditingController(
    text: '${widget.settings['creditUnitPrice'] ?? 29.90}',
  );
  late final _pix = TextEditingController(
    text: widget.settings['manualPixKey']?.toString() ?? '',
  );
  late final _instructions = TextEditingController(
    text: widget.settings['manualInstructions']?.toString() ?? '',
  );
  late final _proxyPrice = TextEditingController(
    text: '${widget.settings['proxyMonthlyPrice'] ?? 0}',
  );
  late final _proxyInstructions = TextEditingController(
    text: widget.settings['proxySalesInstructions']?.toString() ?? '',
  );
  late String _proxyMode = widget.settings['proxySalesMode'] == 'automatic' ? 'automatic' : 'manual';
  late bool _allowCustomerProxy = widget.settings['allowCustomerProxy'] != false;
  late bool _manual = widget.settings['manualPaymentsEnabled'] == true;
  late bool _children = widget.settings['allowChildManualPayments'] == true;
  late final Map<int, TextEditingController> _costs = {
    for (final p in widget.plans)
      p.id: TextEditingController(text: '${p.creditCost ?? 1}'),
  };
  @override
  void dispose() {
    _price.dispose();
    _pix.dispose();
    _instructions.dispose();
    _proxyPrice.dispose();
    _proxyInstructions.dispose();
    for (final c in _costs.values) c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 24),
      title: const Text('Regras financeiras'),
      content: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: size.width - 48,
          maxHeight: size.height - 180,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _price,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Valor de cada crédito (R\$)',
                ),
              ),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Permitir pagamento manual'),
                subtitle: const Text(
                  'Cliente envia Pix e comprovante para aprovação.',
                ),
                value: _manual,
                onChanged: (v) => setState(() => _manual = v),
              ),
              if (widget.canConfigureChildren)
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Liberar pagamento manual para subordinados',
                  ),
                  value: _children,
                  onChanged: (v) => setState(() => _children = v),
                ),
              TextField(
                controller: _pix,
                decoration: const InputDecoration(labelText: 'Chave Pix'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _instructions,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Instruções para o comprovante',
                ),
              ),
              const SizedBox(height: 14),
              const Align(
                alignment: Alignment.centerLeft,
                child: Text('Proxy para clientes', style: TextStyle(fontWeight: FontWeight.w700)),
              ),
              const SizedBox(height: 4),
              DropdownButtonFormField<String>(
                value: _proxyMode,
                decoration: const InputDecoration(labelText: 'Como vender o proxy'),
                items: const [
                  DropdownMenuItem(value: 'manual', child: Text('Venda manual (fora da assinatura)')),
                  DropdownMenuItem(value: 'automatic', child: Text('Incluir no valor final automaticamente')),
                ],
                onChanged: (value) => setState(() => _proxyMode = value ?? 'manual'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _proxyPrice,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Valor mensal do proxy (R\$)'),
              ),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Permitir proxy personalizado pelo cliente'),
                subtitle: const Text('O cliente poderá informar host, porta e protocolo ao conectar.'),
                value: _allowCustomerProxy,
                onChanged: (value) => setState(() => _allowCustomerProxy = value),
              ),
              TextField(
                controller: _proxyInstructions,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Orientações da venda manual (opcional)'),
              ),
              const SizedBox(height: 14),
              const Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Créditos exigidos por plano',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              ...widget.plans.map(
                (p) => TextField(
                  controller: _costs[p.id],
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: '${p.name} (${p.durationDays} dias)',
                  ),
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
        FilledButton(
          onPressed: () {
            final price = double.tryParse(_price.text.replaceAll(',', '.'));
            if (price == null || price <= 0) return;
            Navigator.pop(
              context,
              _PartnerFinanceDraft(
                creditUnitPrice: price,
                manualPaymentsEnabled: _manual,
                allowChildManualPayments: _children,
                pixKey: _pix.text,
                instructions: _instructions.text,
                proxySalesMode: _proxyMode,
                proxyMonthlyPrice: double.tryParse(_proxyPrice.text.replaceAll(',', '.')) ?? 0,
                allowCustomerProxy: _allowCustomerProxy,
                proxySalesInstructions: _proxyInstructions.text,
                planCosts: [
                  for (final p in widget.plans)
                    {
                      'planId': p.id,
                      'creditCost':
                          int.tryParse(_costs[p.id]!.text) ??
                          (p.creditCost ?? 1),
                    },
                ],
              ),
            );
          },
          child: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _PartnerTeamView extends StatefulWidget {
  const _PartnerTeamView({
    required this.snapshot,
    required this.onCreate,
    required this.onEdit,
    required this.onGrantCredits,
    required this.onImpersonate,
    required this.onRemove,
    required this.onFinance,
  });
  final ResellerDashboardSnapshot snapshot;
  final VoidCallback onCreate;
  final ValueChanged<PartnerMemberSummary> onEdit;
  final ValueChanged<PartnerMemberSummary> onGrantCredits;
  final ValueChanged<PartnerMemberSummary> onImpersonate;
  final ValueChanged<PartnerMemberSummary> onRemove;
  final ValueChanged<PartnerMemberSummary> onFinance;

  @override
  State<_PartnerTeamView> createState() => _PartnerTeamViewState();
}

class _PartnerTeamViewState extends State<_PartnerTeamView> {
  final _searchController = TextEditingController();
  String _query = '';
  int _visibleCount = 50;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      if (mounted) {
        setState(() {
          _query = _searchController.text.trim().toLowerCase();
          _visibleCount = 50;
        });
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final members = widget.snapshot.partners.where((partner) {
      if (_query.isEmpty) return true;
      return '${partner.name} ${partner.email} ${partner.whatsappNumber ?? ''}'
          .toLowerCase()
          .contains(_query);
    }).toList();
    final visible = members.take(_visibleCount).toList(growable: false);
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton.icon(
            onPressed: widget.onCreate,
            icon: const Icon(Icons.person_add_alt_1_outlined),
            label: const Text('Novo revendedor'),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _searchController,
          decoration: InputDecoration(
            prefixIcon: const Icon(Icons.search_rounded),
            hintText: 'Pesquisar revendedor',
            filled: true,
            fillColor: wa.inputFill,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
          ),
        ),
        const SizedBox(height: 10),
        if (members.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Text(
                widget.snapshot.partners.isEmpty
                    ? 'Nenhum revendedor subordinado cadastrado.'
                    : 'Nenhum revendedor corresponde à pesquisa.',
                style: TextStyle(color: wa.textSecondary),
              ),
            ),
          )
        else
          ...visible.map(
            (partner) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                backgroundColor: wa.avatarFallback,
                child: Text(
                  partner.name.trim().isEmpty
                      ? '?'
                      : partner.name.trim()[0].toUpperCase(),
                ),
              ),
              title: Text(partner.name),
              subtitle: Text(
                '${partner.email} · ${_partnerRoleLabel(partner.role)} · ${partner.creditBalance} créditos'
                '${partner.whatsappNumber == null ? '' : ' · ${partner.whatsappNumber}'}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: PopupMenuButton<String>(
                tooltip: 'Ações da equipe',
                onSelected: (action) {
                  if (action == 'edit') widget.onEdit(partner);
                  if (action == 'credits') widget.onGrantCredits(partner);
                  if (action == 'enter') widget.onImpersonate(partner);
                  if (action == 'finance') widget.onFinance(partner);
                  if (action == 'remove') widget.onRemove(partner);
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(
                    value: 'edit',
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.edit_outlined),
                      title: Text('Editar acesso'),
                    ),
                  ),
                  const PopupMenuItem(
                    value: 'credits',
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.bolt_outlined),
                      title: Text('Distribuir créditos'),
                    ),
                  ),
                  const PopupMenuItem(
                    value: 'enter',
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.login_rounded),
                      title: Text('Entrar no painel'),
                    ),
                  ),
                  const PopupMenuItem(
                    value: 'finance',
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.tune_rounded),
                      title: Text('Regras financeiras'),
                    ),
                  ),
                  const PopupMenuDivider(),
                  const PopupMenuItem(
                    value: 'remove',
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.person_remove_outlined),
                      title: Text('Remover da equipe'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (visible.length < members.length)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton.icon(
              onPressed: () => setState(
                () => _visibleCount = (_visibleCount + 50).clamp(
                  0,
                  members.length,
                ),
              ),
              icon: const Icon(Icons.expand_more_rounded),
              label: Text('Carregar mais (${members.length - visible.length})'),
            ),
          ),
      ],
    );
  }
}

class _PartnerMemberDraft {
  const _PartnerMemberDraft({
    required this.name,
    required this.email,
    required this.password,
    this.whatsappNumber,
    required this.initialCredits,
    required this.role,
  });
  final String name;
  final String email;
  final String password;
  final String? whatsappNumber;
  final int initialCredits;
  final String role;
}

class _PartnerMemberEditDraft {
  const _PartnerMemberEditDraft({
    required this.name,
    required this.email,
    required this.whatsappNumber,
    required this.password,
    required this.status,
    required this.commissionRate,
    required this.permissions,
  });
  final String name;
  final String email;
  final String? whatsappNumber;
  final String? password;
  final String status;
  final double commissionRate;
  final Map<String, Object?> permissions;
}

class _PartnerMemberEditDialog extends StatefulWidget {
  const _PartnerMemberEditDialog({required this.member});
  final PartnerMemberSummary member;

  @override
  State<_PartnerMemberEditDialog> createState() =>
      _PartnerMemberEditDialogState();
}

class _PartnerMemberEditDialogState extends State<_PartnerMemberEditDialog> {
  late final _name = TextEditingController(text: widget.member.name);
  late final _email = TextEditingController(text: widget.member.email);
  late final _whatsapp = TextEditingController(
    text: widget.member.whatsappNumber ?? '',
  );
  final _password = TextEditingController();
  late final _commission = TextEditingController(
    text: widget.member.commissionRate.toStringAsFixed(1),
  );
  late bool _active = widget.member.status == 'active';
  late bool _manageCustomers =
      widget.member.permissions['manage_customers'] == true;
  late bool _activateCustomers =
      widget.member.permissions['activate_customers'] == true;
  late bool _viewFinancial =
      widget.member.permissions['view_financial'] == true;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _whatsapp.dispose();
    _password.dispose();
    _commission.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('Editar ${widget.member.name}'),
    content: SizedBox(
      width: 460,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Nome completo'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'E-mail'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _whatsapp,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'WhatsApp'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Nova senha (opcional)',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _commission,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(labelText: 'Comissão (%)'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Acesso ativo'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Gerenciar clientes'),
              value: _manageCustomers,
              onChanged: (v) => setState(() => _manageCustomers = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Ativar e renovar clientes'),
              value: _activateCustomers,
              onChanged: (v) => setState(() => _activateCustomers = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Ver carteira financeira'),
              value: _viewFinancial,
              onChanged: (v) => setState(() => _viewFinancial = v),
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
      FilledButton(
        onPressed: () {
          final name = _name.text.trim();
          final email = _email.text.trim();
          final commission = double.tryParse(
            _commission.text.trim().replaceAll(',', '.'),
          );
          if (name.length < 2 ||
              !email.contains('@') ||
              commission == null ||
              commission < 0 ||
              commission > 100)
            return;
          Navigator.pop(
            context,
            _PartnerMemberEditDraft(
              name: name,
              email: email,
              whatsappNumber: _whatsapp.text.trim().isEmpty
                  ? null
                  : _whatsapp.text.trim(),
              password: _password.text.trim().isEmpty
                  ? null
                  : _password.text.trim(),
              status: _active ? 'active' : 'suspended',
              commissionRate: commission,
              permissions: {
                'manage_customers': _manageCustomers,
                'activate_customers': _activateCustomers,
                'view_financial': _viewFinancial,
              },
            ),
          );
        },
        child: const Text('Salvar'),
      ),
    ],
  );
}

class _PartnerMemberDialog extends StatefulWidget {
  const _PartnerMemberDialog({required this.allowMaster});
  final bool allowMaster;
  @override
  State<_PartnerMemberDialog> createState() => _PartnerMemberDialogState();
}

class _PartnerMemberDialogState extends State<_PartnerMemberDialog> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _whatsapp = TextEditingController();
  final _password = TextEditingController();
  final _credits = TextEditingController(text: '0');
  String _role = 'reseller';

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _whatsapp.dispose();
    _password.dispose();
    _credits.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.allowMaster ? 'Cadastrar parceiro' : 'Cadastrar revendedor'),
    content: SizedBox(
      width: 430,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Nome completo'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'E-mail'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _whatsapp,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'WhatsApp'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Senha inicial'),
            ),
            if (widget.allowMaster) ...[
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: _role,
                decoration: const InputDecoration(labelText: 'Tipo de acesso'),
                items: const [
                  DropdownMenuItem(value: 'master', child: Text('Master')),
                  DropdownMenuItem(value: 'reseller', child: Text('Revendedor')),
                ],
                onChanged: (value) => setState(() => _role = value ?? 'reseller'),
              ),
            ],
            const SizedBox(height: 8),
            TextField(
              controller: _credits,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Créditos iniciais',
                helperText: 'Serão transferidos da carteira do Master.',
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
      FilledButton(
        onPressed: () {
          final name = _name.text.trim();
          final email = _email.text.trim();
          final password = _password.text;
          if (name.length < 2 || !email.contains('@') || password.length < 6)
            return;
          Navigator.pop(
            context,
            _PartnerMemberDraft(
              name: name,
              email: email,
              password: password,
              whatsappNumber: _whatsapp.text.trim().isEmpty
                  ? null
                  : _whatsapp.text.trim(),
              initialCredits: int.tryParse(_credits.text.trim()) ?? 0,
              role: _role,
            ),
          );
        },
        child: const Text('Cadastrar'),
      ),
    ],
  );
}

class _ResellerCustomerDraft {
  const _ResellerCustomerDraft({
    required this.name,
    required this.email,
    required this.password,
    this.whatsappNumber,
    this.planId,
  });

  final String name;
  final String email;
  final String password;
  final String? whatsappNumber;
  final int? planId;
}

class _ResellerCustomerDialog extends StatefulWidget {
  const _ResellerCustomerDialog({required this.plans});

  final List<SubscriptionPlanSummary> plans;

  @override
  State<_ResellerCustomerDialog> createState() =>
      _ResellerCustomerDialogState();
}

class _ResellerCustomerDialogState extends State<_ResellerCustomerDialog> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _whatsapp = TextEditingController();
  final _password = TextEditingController();
  int? _planId;
  bool _hidePassword = true;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _whatsapp.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Novo cliente'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'Nome'),
                  validator: (value) =>
                      value?.trim().isEmpty == true ? 'Informe o nome.' : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'E-mail'),
                  validator: (value) => value?.contains('@') == true
                      ? null
                      : 'Informe um e-mail válido.',
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _whatsapp,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'WhatsApp (opcional)',
                  ),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _password,
                  obscureText: _hidePassword,
                  decoration: InputDecoration(
                    labelText: 'Senha inicial',
                    suffixIcon: IconButton(
                      onPressed: () =>
                          setState(() => _hidePassword = !_hidePassword),
                      icon: Icon(
                        _hidePassword
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                      ),
                    ),
                  ),
                  validator: (value) => (value?.length ?? 0) < 6
                      ? 'Use pelo menos 6 caracteres.'
                      : null,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<int?>(
                  initialValue: _planId,
                  decoration: const InputDecoration(
                    labelText: 'Ativar plano (opcional)',
                    helperText: 'A ativação consome 1 crédito.',
                  ),
                  items: [
                    const DropdownMenuItem<int?>(
                      value: null,
                      child: Text('Criar sem ativar'),
                    ),
                    ...widget.plans.map(
                      (plan) => DropdownMenuItem<int?>(
                        value: plan.id,
                        child: Text(plan.name),
                      ),
                    ),
                  ],
                  onChanged: (value) => setState(() => _planId = value),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Criar cliente')),
      ],
    );
  }

  void _submit() {
    if (_formKey.currentState?.validate() != true) return;
    Navigator.pop(
      context,
      _ResellerCustomerDraft(
        name: _name.text.trim(),
        email: _email.text.trim(),
        password: _password.text,
        whatsappNumber: _whatsapp.text.trim().isEmpty
            ? null
            : _whatsapp.text.trim(),
        planId: _planId,
      ),
    );
  }
}

String _partnerRoleLabel(String role) => switch (role) {
  'owner' => 'Proprietário',
  'master' || 'manager' => 'Master',
  'support' => 'Suporte',
  _ => 'Revendedor',
};

class PaymentsPanel extends ConsumerStatefulWidget {
  const PaymentsPanel({super.key});

  @override
  ConsumerState<PaymentsPanel> createState() => _PaymentsPanelState();
}

class _PaymentsPanelState extends ConsumerState<PaymentsPanel> {
  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(rafflePaymentSettingsProvider);
    return _ModuleSurface(
      title: 'Pagamentos',
      subtitle: 'Credenciais para receber pagamentos.',
      icon: Icons.payments_outlined,
      actions: [
        TextButton.icon(
          onPressed: _openHistory,
          icon: const Icon(Icons.receipt_long_outlined, size: 19),
          label: const Text('Histórico'),
        ),
      ],
      onRefresh: () {
        ref.invalidate(rafflePaymentSettingsProvider);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
        children: [
          _PanelCard(
            title: 'Credenciais de pagamento',
            subtitle:
                'Conecte a plataforma que receberá os pagamentos das suas vendas e rifas.',
            child: settings.when(
              data: (data) => _PaymentCredentialsOverview(
                settings: data,
                onConfigure: () => _openPaymentSettings(data),
              ),
              error: (error, _) => _ErrorBlock(
                message: error.toString(),
                onRetry: () => ref.invalidate(rafflePaymentSettingsProvider),
              ),
              loading: () => const _LoadingBlock(compact: true),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openPaymentSettings(RafflePaymentSettings? settings) async {
    final draft = await showDialog<_RafflePaymentDraft>(
      context: context,
      builder: (context) => _RafflePaymentDialog(settings: settings),
    );
    if (draft == null) return;
    try {
      await ref
          .read(apiClientProvider)
          .saveRafflePaymentSettings(
            provider: draft.provider,
            credential: draft.credential,
            pixExpirationMinutes: draft.pixExpirationMinutes,
          );
      ref.invalidate(rafflePaymentSettingsProvider);
      if (mounted) showSuccessToast(context, 'Credenciais atualizadas.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    }
  }

  Future<void> _openHistory() {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => Dialog(
        insetPadding: const EdgeInsets.all(18),
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        child: SizedBox(
          width: 860,
          height: (MediaQuery.sizeOf(dialogContext).height - 36)
              .clamp(480.0, 680.0)
              .toDouble(),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 14, 10),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: () => Navigator.of(dialogContext).pop(),
                      tooltip: 'Fechar',
                      icon: const Icon(Icons.close_rounded),
                    ),
                    const SizedBox(width: 4),
                    const Expanded(
                      child: Text(
                        'Histórico de pagamentos',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: Consumer(
                  builder: (context, ref, _) {
                    final history = ref.watch(commerceHistoryProvider);
                    return history.when(
                      data: (data) => Padding(
                        padding: const EdgeInsets.all(16),
                        child: _CommerceHistoryCard(snapshot: data),
                      ),
                      error: (error, _) => _ErrorBlock(
                        message: error.toString(),
                        onRetry: () => ref.invalidate(commerceHistoryProvider),
                      ),
                      loading: () => const _LoadingBlock(),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaymentCredentialsOverview extends StatelessWidget {
  const _PaymentCredentialsOverview({
    required this.settings,
    required this.onConfigure,
  });

  final RafflePaymentSettings settings;
  final VoidCallback onConfigure;

  @override
  Widget build(BuildContext context) {
    final activeProvider = switch (settings.activeProvider) {
      'polopag_pix' => 'PoloPag',
      'mercadopago_pix' => 'Mercado Pago',
      _ => 'Nenhuma plataforma ativa',
    };
    final configured = settings.configured;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: CircleAvatar(
            backgroundColor: configured
                ? const Color(0xFFD9FDD3)
                : const Color(0xFFE9EDEF),
            child: Icon(
              configured
                  ? Icons.verified_outlined
                  : Icons.account_balance_wallet_outlined,
              color: configured
                  ? const Color(0xFF008069)
                  : const Color(0xFF54656F),
            ),
          ),
          title: Text(
            activeProvider,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          subtitle: Text(
            configured
                ? 'Pronta para receber novos pagamentos.'
                : 'Configure uma plataforma para começar a receber.',
          ),
        ),
        const Divider(height: 20),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton.icon(
            onPressed: onConfigure,
            icon: const Icon(Icons.settings_outlined),
            label: Text(configured ? 'Editar credenciais' : 'Configurar'),
          ),
        ),
      ],
    );
  }
}

class _CommerceHistoryCard extends StatelessWidget {
  const _CommerceHistoryCard({required this.snapshot});

  final CommerceHistorySnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabBar(
            isScrollable: true,
            tabs: [
              Tab(text: 'Compras (${snapshot.purchases.length})'),
              Tab(text: 'Cobranças (${snapshot.charges.length})'),
            ],
          ),
          Expanded(
            child: TabBarView(
              children: [
                _HistoryList(
                  emptyText: 'Nenhuma compra registrada ainda.',
                  children: snapshot.purchases
                      .map((item) => _PurchaseHistoryTile(purchase: item))
                      .toList(growable: false),
                ),
                _HistoryList(
                  emptyText: 'Nenhuma cobrança registrada ainda.',
                  children: snapshot.charges
                      .map((item) => _PaymentChargeHistoryTile(charge: item))
                      .toList(growable: false),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryList extends StatelessWidget {
  const _HistoryList({required this.emptyText, required this.children});

  final String emptyText;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: _EmptyMessage(emptyText),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.only(top: 12),
      itemCount: children.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (context, index) => children[index],
    );
  }
}

class _PurchaseHistoryTile extends StatelessWidget {
  const _PurchaseHistoryTile({required this.purchase});

  final PurchaseHistorySummary purchase;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final subtitle = [
      purchase.customerLabel,
      _formatDateTime(purchase.purchasedAt),
      if ((purchase.description ?? '').isNotEmpty) purchase.description!,
    ].join(' · ');
    return _InfoTile(
      icon: Icons.shopping_bag_outlined,
      title: purchase.categoryName,
      subtitle: subtitle,
      active: true,
      trailing: Text(
        _formatMoney(purchase.amount),
        style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w900),
      ),
      onTap: () => _showPurchaseDetails(context, purchase),
    );
  }
}

class _PaymentChargeHistoryTile extends StatelessWidget {
  const _PaymentChargeHistoryTile({required this.charge});

  final PaymentChargeSummary charge;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final active = charge.approved;
    final subtitle = [
      charge.customerLabel,
      _providerLabel(charge.provider),
      _formatDateTime(charge.createdAt),
    ].join(' · ');
    return _InfoTile(
      icon: active
          ? Icons.check_circle_outline_rounded
          : charge.pending
          ? Icons.schedule_rounded
          : Icons.error_outline_rounded,
      title: _paymentStatusLabel(charge.status),
      subtitle: subtitle,
      active: active || charge.pending,
      trailing: Text(
        _formatMoney(charge.amount),
        style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w900),
      ),
      onTap: () => _showChargeDetails(context, charge),
    );
  }
}

Future<void> _showPurchaseDetails(
  BuildContext context,
  PurchaseHistorySummary purchase,
) {
  final productPath = purchase.productFilePath?.trim();
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(purchase.categoryName),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _DetailLine('Cliente', purchase.customerLabel),
              _DetailLine('Valor', _formatMoney(purchase.amount)),
              _DetailLine('Data', _formatDateTime(purchase.purchasedAt)),
              if ((purchase.description ?? '').isNotEmpty)
                _DetailLine('Descrição', purchase.description!),
              if (purchase.productDetails.trim().isNotEmpty)
                _DetailLine('Produto', purchase.productDetails.trim()),
              if (productPath != null && productPath.isNotEmpty)
                _DetailLine('Arquivo', productPath),
              if (purchase.note.isNotEmpty) _DetailLine('Nota', purchase.note),
            ],
          ),
        ),
      ),
      actions: [
        if (productPath != null && productPath.isNotEmpty)
          TextButton.icon(
            onPressed: () => _openUrl(productPath),
            icon: const Icon(Icons.open_in_new_rounded),
            label: const Text('Abrir arquivo'),
          ),
        TextButton.icon(
          onPressed: () async {
            await Clipboard.setData(
              ClipboardData(
                text:
                    '${purchase.categoryName}\n${purchase.customerLabel}\n${_formatMoney(purchase.amount)}',
              ),
            );
            if (context.mounted) showSuccessToast(context, 'Dados copiados.');
          },
          icon: const Icon(Icons.copy_rounded),
          label: const Text('Copiar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Fechar'),
        ),
      ],
    ),
  );
}

Future<void> _showChargeDetails(
  BuildContext context,
  PaymentChargeSummary charge,
) {
  final ticketUrl = charge.ticketUrl?.trim();
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(_paymentStatusLabel(charge.status)),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _DetailLine('Cliente', charge.customerLabel),
              _DetailLine('Valor', _formatMoney(charge.amount)),
              _DetailLine('Método', _providerLabel(charge.provider)),
              if (charge.publicId.isNotEmpty)
                _DetailLine('ID', charge.publicId),
              _DetailLine('Criado em', _formatDateTime(charge.createdAt)),
              if (charge.note.isNotEmpty) _DetailLine('Nota', charge.note),
              if (ticketUrl != null && ticketUrl.isNotEmpty)
                _DetailLine('Comprovante', ticketUrl),
            ],
          ),
        ),
      ),
      actions: [
        if (ticketUrl != null && ticketUrl.isNotEmpty)
          TextButton.icon(
            onPressed: () => _openUrl(ticketUrl),
            icon: const Icon(Icons.open_in_new_rounded),
            label: const Text('Abrir'),
          ),
        TextButton.icon(
          onPressed: () async {
            await Clipboard.setData(
              ClipboardData(
                text:
                    '${_paymentStatusLabel(charge.status)}\n${charge.customerLabel}\n${_formatMoney(charge.amount)}',
              ),
            );
            if (context.mounted) showSuccessToast(context, 'Dados copiados.');
          },
          icon: const Icon(Icons.copy_rounded),
          label: const Text('Copiar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Fechar'),
        ),
      ],
    ),
  );
}

class _DetailLine extends StatelessWidget {
  const _DetailLine(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: wa.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          SelectableText(
            value,
            style: TextStyle(color: wa.textPrimary, height: 1.35),
          ),
        ],
      ),
    );
  }
}

class ApiRestPanel extends ConsumerStatefulWidget {
  const ApiRestPanel({super.key});

  @override
  ConsumerState<ApiRestPanel> createState() => _ApiRestPanelState();
}

class _ApiRestPanelState extends ConsumerState<ApiRestPanel> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final snapshot = ref.watch(apiRestKeyProvider);
    return _ModuleSurface(
      title: 'API REST',
      subtitle: 'Tokens, documentação, limites e integração externa.',
      icon: Icons.api_outlined,
      onRefresh: () => ref.invalidate(apiRestKeyProvider),
      child: snapshot.when(
        data: (data) => ListView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
          children: [
            _PanelCard(
              title: 'Token da API',
              subtitle:
                  'Gerencie a chave usada por integrações externas do perfil.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: TextEditingController(text: data.apiKey),
                    readOnly: true,
                    decoration: const InputDecoration(
                      labelText: 'Chave atual',
                      prefixIcon: Icon(Icons.key_outlined),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      FilledButton.icon(
                        onPressed: _busy
                            ? null
                            : () => _copyApiKey(data.apiKey),
                        icon: const Icon(Icons.copy_rounded),
                        label: const Text('Copiar'),
                      ),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _rotateApiKey,
                        icon: const Icon(Icons.autorenew_rounded),
                        label: const Text('Gerar nova'),
                      ),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _setCustomApiKey,
                        icon: const Icon(Icons.edit_rounded),
                        label: const Text('Personalizar'),
                      ),
                    ],
                  ),
                  if (data.rotationLockedUntil != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      'Próxima rotação liberada em ${_formatDateTime(data.rotationLockedUntil!)}.',
                      style: const TextStyle(color: Color(0xFF667781)),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        error: (error, _) => _ErrorBlock(
          message: error.toString(),
          onRetry: () => ref.invalidate(apiRestKeyProvider),
        ),
        loading: () => const _LoadingBlock(),
      ),
    );
  }

  Future<void> _copyApiKey(String apiKey) async {
    await Clipboard.setData(ClipboardData(text: apiKey));
    if (mounted) showSuccessToast(context, 'Chave copiada.');
  }

  Future<void> _rotateApiKey() async {
    final confirmed = await _confirmAction(
      context,
      title: 'Gerar nova chave',
      message:
          'A chave atual deixa de funcionar nas integrações assim que a nova for gerada.',
      confirmLabel: 'Gerar',
    );
    if (!confirmed) return;
    await _runApiAction(
      'Nova chave gerada.',
      () => ref.read(apiClientProvider).rotateApiRestKey(),
    );
  }

  Future<void> _setCustomApiKey() async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Chave personalizada'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Nova chave',
            prefixIcon: Icon(Icons.key_outlined),
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
    );
    controller.dispose();
    if (value == null || value.isEmpty) return;
    await _runApiAction(
      'Chave personalizada aplicada.',
      () => ref.read(apiClientProvider).setCustomApiRestKey(value),
    );
  }

  Future<void> _runApiAction(
    String success,
    Future<void> Function() action,
  ) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(apiRestKeyProvider);
      if (mounted) showSuccessToast(context, success);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class WebhooksPanel extends ConsumerStatefulWidget {
  const WebhooksPanel({super.key});

  @override
  ConsumerState<WebhooksPanel> createState() => _WebhooksPanelState();
}

class _WebhooksPanelState extends ConsumerState<WebhooksPanel> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(metaWebhookSettingsProvider);
    return _ModuleSurface(
      title: 'Webhooks',
      subtitle: 'Eventos, URLs, credenciais e teste de entrega.',
      icon: Icons.webhook_outlined,
      onRefresh: () => ref.invalidate(metaWebhookSettingsProvider),
      child: settings.when(
        data: (data) => ListView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
          children: [
            _PanelCard(
              title: 'Meta Cloud API',
              subtitle:
                  'Configure credenciais, verify token e teste a comunicação.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _ListOrEmpty(
                    isEmpty: false,
                    emptyText: '',
                    children: [
                      _InfoTile(
                        icon: Icons.verified_user_outlined,
                        title: data?.id == null
                            ? 'Webhook ainda sem configuração'
                            : 'Webhook ${data!.id}',
                        subtitle:
                            'Verify token: ${data?.verifyToken.isNotEmpty == true ? data!.verifyToken : 'não definido'}\nToken Meta: ${data?.accessTokenPreview ?? (data?.accessTokenPresent == true ? 'configurado' : 'não definido')}',
                        active: data?.verifyToken.isNotEmpty == true,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      FilledButton.icon(
                        onPressed: _busy
                            ? null
                            : () => _openWebhookEditor(data),
                        icon: const Icon(Icons.settings_rounded),
                        label: const Text('Configurar'),
                      ),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : () => _testWebhook(data),
                        icon: const Icon(Icons.science_outlined),
                        label: const Text('Testar comunicação'),
                      ),
                    ],
                  ),
                  if (data?.updatedAt != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      'Atualizado em ${_formatDateTime(data!.updatedAt!)}.',
                      style: const TextStyle(color: Color(0xFF667781)),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        error: (error, _) => _ErrorBlock(
          message: error.toString(),
          onRetry: () => ref.invalidate(metaWebhookSettingsProvider),
        ),
        loading: () => const _LoadingBlock(),
      ),
    );
  }

  Future<void> _openWebhookEditor(MetaWebhookSettings? settings) async {
    final draft = await showDialog<_WebhookSettingsDraft>(
      context: context,
      builder: (context) => _WebhookSettingsDialog(settings: settings),
    );
    if (draft == null) return;
    await _runWebhookAction(
      'Webhook salvo.',
      () => ref
          .read(apiClientProvider)
          .saveMetaWebhookSettings(
            verifyToken: draft.verifyToken,
            appId: draft.appId,
            businessAccountId: draft.businessAccountId,
            phoneNumberId: draft.phoneNumberId,
            accessToken: draft.accessToken,
          ),
    );
  }

  Future<void> _testWebhook(MetaWebhookSettings? settings) async {
    await _runWebhookAction('Webhook testado.', () async {
      final message = await ref
          .read(apiClientProvider)
          .testMetaWebhookSettings(
            verifyToken: settings?.verifyToken,
            appId: settings?.appId,
            businessAccountId: settings?.businessAccountId,
            phoneNumberId: settings?.phoneNumberId,
          );
      if (mounted) showSuccessToast(context, message);
    }, showDefaultSuccess: false);
  }

  Future<void> _runWebhookAction(
    String success,
    Future<void> Function() action, {
    bool showDefaultSuccess = true,
  }) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(metaWebhookSettingsProvider);
      if (mounted && showDefaultSuccess) showSuccessToast(context, success);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class MediaPanel extends ConsumerWidget {
  const MediaPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final storage = ref.watch(mediaStorageProvider);
    final mobile = ref.watch(mobileUpdateProvider);
    return _ModuleSurface(
      title: 'Mídia',
      subtitle: 'Storage persistente, cache de mídias e app Android.',
      icon: Icons.image_outlined,
      onRefresh: () {
        ref.invalidate(mediaStorageProvider);
        ref.invalidate(mobileUpdateProvider);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
        children: [
          storage.when(
            data: (data) => _StorageOverview(snapshot: data),
            error: (error, _) => _ErrorBlock(
              message: error.toString(),
              onRetry: () => ref.invalidate(mediaStorageProvider),
            ),
            loading: () => const _LoadingBlock(compact: true),
          ),
          SizedBox(height: 14),
          mobile.when(
            data: (data) => _PanelCard(
              title: 'Aplicativo Android',
              subtitle: data.required
                  ? 'Atualização obrigatória disponível.'
                  : data.updateAvailable
                  ? 'Nova versão disponível.'
                  : 'Canal de atualização configurado.',
              child: _InfoTile(
                icon: Icons.android_rounded,
                title: data.versionName.isEmpty
                    ? 'Versão disponível'
                    : data.versionName,
                subtitle:
                    'Código ${data.versionCode}${data.downloadUrl == null ? '' : '\n${data.downloadUrl}'}',
                active: true,
                trailing: data.downloadUrl == null
                    ? null
                    : FilledButton.tonalIcon(
                        onPressed: () => _openUrl(data.downloadUrl!),
                        icon: const Icon(Icons.download_rounded),
                        label: const Text('Baixar'),
                      ),
              ),
            ),
            error: (error, _) => _ErrorBlock(
              message: error.toString(),
              onRetry: () => ref.invalidate(mobileUpdateProvider),
            ),
            loading: () => const _LoadingBlock(compact: true),
          ),
        ],
      ),
    );
  }
}

class ProfileConnectionPanel extends ConsumerStatefulWidget {
  const ProfileConnectionPanel({super.key, this.onActivate});

  final ValueChanged<BotInstance>? onActivate;

  @override
  ConsumerState<ProfileConnectionPanel> createState() =>
      _ProfileConnectionPanelState();
}

class _ProfileConnectionPanelState
    extends ConsumerState<ProfileConnectionPanel> {
  int _handledCreationRequest = 0;

  @override
  Widget build(BuildContext context) {
    final request = ref.watch(profileCreationRequestProvider);
    if (request > _handledCreationRequest) {
      _handledCreationRequest = request;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(profileCreationRequestProvider.notifier).consume(request);
        if (mounted) unawaited(openCreateProfileSheet(context, ref));
      });
    }
    return _ModuleSurface(
      title: 'Perfis',
      subtitle: 'Gestão de instâncias, perfis WhatsApp e conexão do número.',
      icon: Icons.qr_code_scanner_rounded,
      onRefresh: () {
        ref.invalidate(botInstancesProvider);
        ref.invalidate(botServersProvider);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
        children: [
          _PanelCard(
            title: 'Perfis WhatsApp',
            subtitle:
                'Crie um perfil, conecte o número por QR/código e gerencie os grupos nele.',
            child: ProfilesInstancesPanel(onActivate: widget.onActivate),
          ),
        ],
      ),
    );
  }
}

class SettingsPanel extends ConsumerStatefulWidget {
  const SettingsPanel({super.key, required this.instances});

  final List<BotInstance> instances;

  @override
  ConsumerState<SettingsPanel> createState() => _SettingsPanelState();
}

class _SettingsPanelState extends ConsumerState<SettingsPanel> {
  int? _selectedInstanceId;
  String? _savingKey;

  BotInstance? get _selectedInstance {
    final id = _selectedInstanceId;
    if (id == null && widget.instances.isNotEmpty) {
      return widget.instances.first;
    }
    return widget.instances.where((item) => item.id == id).firstOrNull;
  }

  @override
  Widget build(BuildContext context) {
    final pane = ref.watch(settingsPaneProvider);
    final instance = _selectedInstance;
    final settings = instance == null
        ? null
        : ref.watch(instanceSettingsProvider(instance.id));
    final session = ref.watch(authControllerProvider).value;
    final isAccount = pane == SettingsPane.account;
    final showPaneSelector = MediaQuery.sizeOf(context).width < 720;
    return _ModuleSurface(
      title: isAccount ? 'Conta' : 'Instância',
      subtitle: isAccount
          ? 'Foto, e-mail, senha e WhatsApp cadastrado.'
          : 'Ajustes essenciais do perfil WhatsApp selecionado.',
      icon: isAccount ? Icons.person_outline_rounded : Icons.smartphone_rounded,
      onRefresh: () {
        if (instance != null) {
          ref.invalidate(instanceSettingsProvider(instance.id));
        }
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
        children: [
          if (showPaneSelector) ...[
            _SettingsPaneSelector(
              pane: pane,
              onChanged: (value) =>
                  ref.read(settingsPaneProvider.notifier).select(value),
            ),
            const SizedBox(height: 12),
          ],
          if (isAccount)
            if (session == null)
              const _EmptyMessage('Sessão do usuário não carregada.')
            else
              _PanelCard(
                title: 'Conta',
                subtitle: 'Foto, e-mail, senha e WhatsApp cadastrado.',
                child: _AccountSettingsCard(user: session.user),
              )
          else ...[
            _PanelCard(
              title: 'Instância',
              subtitle: 'Escolha o perfil WhatsApp que receberá os ajustes.',
              child: DropdownButtonFormField<int>(
                initialValue: instance?.id,
                items: widget.instances
                    .map(
                      (instance) => DropdownMenuItem(
                        value: instance.id,
                        child: Text(instance.name),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setState(() => _selectedInstanceId = value),
                decoration: const InputDecoration(
                  labelText: 'Instância',
                  prefixIcon: Icon(Icons.smart_toy_rounded),
                ),
              ),
            ),
            const SizedBox(height: 14),
            if (instance == null)
              const _EmptyMessage('Nenhuma instância cadastrada.')
            else
              settings!.when(
                data: (bundle) => _InstanceSettingsCard(
                  instance: instance,
                  bundle: bundle,
                  savingKey: _savingKey,
                  onToggle: _saveToggle,
                ),
                error: (error, _) => _ErrorBlock(
                  message: error.toString(),
                  onRetry: () =>
                      ref.invalidate(instanceSettingsProvider(instance.id)),
                ),
                loading: () => const _LoadingBlock(),
              ),
          ],
        ],
      ),
    );
  }

  Future<void> _saveToggle(BotInstance instance, String key, bool value) async {
    if (_savingKey != null) return;
    setState(() => _savingKey = key);
    try {
      await ref.read(apiClientProvider).updateInstanceSettings(instance.id, {
        'commandToggles': {key: value},
      });
      ref.invalidate(instanceSettingsProvider(instance.id));
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Configuração salva.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => _savingKey = null);
    }
  }
}

class _SettingsPaneSelector extends StatelessWidget {
  const _SettingsPaneSelector({required this.pane, required this.onChanged});

  final SettingsPane pane;
  final ValueChanged<SettingsPane> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<SettingsPane>(
      segments: const [
        ButtonSegment(
          value: SettingsPane.account,
          icon: Icon(Icons.person_outline_rounded),
          label: Text('Conta'),
        ),
        ButtonSegment(
          value: SettingsPane.instance,
          icon: Icon(Icons.smartphone_rounded),
          label: Text('Instância'),
        ),
      ],
      selected: {pane},
      onSelectionChanged: (selection) => onChanged(selection.first),
      showSelectedIcon: false,
    );
  }
}

class _AccountSettingsCard extends ConsumerStatefulWidget {
  const _AccountSettingsCard({required this.user});

  final SessionUser user;

  @override
  ConsumerState<_AccountSettingsCard> createState() =>
      _AccountSettingsCardState();
}

class _AccountSettingsCardState extends ConsumerState<_AccountSettingsCard> {
  late final TextEditingController _name;
  late final TextEditingController _email;
  late final TextEditingController _whatsappDialCode;
  late final TextEditingController _whatsappNumber;
  final _password = TextEditingController();
  final _passwordConfirm = TextEditingController();
  Uint8List? _avatarBytes;
  String? _avatarFileName;
  String? _avatarMimeType;
  bool _removeAvatar = false;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final phone = _splitWhatsapp(widget.user.whatsappNumber);
    _name = TextEditingController(text: widget.user.name);
    _email = TextEditingController(text: widget.user.email ?? '');
    _whatsappDialCode = TextEditingController(text: phone.dialCode);
    _whatsappNumber = TextEditingController(text: phone.number);
  }

  @override
  void didUpdateWidget(covariant _AccountSettingsCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.user.id != widget.user.id) return;
    if (!_saving) {
      final phone = _splitWhatsapp(widget.user.whatsappNumber);
      _name.text = widget.user.name;
      _email.text = widget.user.email ?? '';
      _whatsappDialCode.text = phone.dialCode;
      _whatsappNumber.text = phone.number;
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _whatsappDialCode.dispose();
    _whatsappNumber.dispose();
    _password.dispose();
    _passwordConfirm.dispose();
    super.dispose();
  }

  Future<void> _pickAvatar() async {
    final file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: 'Imagens',
          extensions: ['jpg', 'jpeg', 'png', 'webp'],
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        ),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    setState(() {
      _avatarBytes = bytes;
      _avatarFileName = file.name;
      _avatarMimeType = file.mimeType;
      _removeAvatar = false;
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    final name = _name.text.trim();
    final email = _email.text.trim();
    final dial = _whatsappDialCode.text.replaceAll(RegExp(r'\D'), '');
    final phone = _whatsappNumber.text.replaceAll(RegExp(r'\D'), '');
    final pass = _password.text;
    final confirm = _passwordConfirm.text;
    if (name.isEmpty) {
      setState(() => _error = 'Informe seu nome.');
      return;
    }
    if (email.isNotEmpty && !email.contains('@')) {
      setState(() => _error = 'Informe um e-mail válido.');
      return;
    }
    if (pass.isNotEmpty && pass.length < 6) {
      setState(() => _error = 'A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (pass != confirm) {
      setState(() => _error = 'A confirmação da senha não confere.');
      return;
    }
    if ((dial.isEmpty && phone.isNotEmpty) ||
        (dial.isNotEmpty && phone.isEmpty)) {
      setState(() => _error = 'Informe DDI e número do WhatsApp.');
      return;
    }
    final currentDigits = _digitsOnly(widget.user.whatsappNumber);
    final nextDigits = dial.isEmpty && phone.isEmpty
        ? currentDigits
        : '$dial$phone';
    if (nextDigits != currentDigits) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: WaTheme.of(context).panel,
          title: Text(
            'Confirmar WhatsApp',
            style: TextStyle(
              color: WaTheme.of(context).textPrimary,
              fontWeight: FontWeight.w800,
            ),
          ),
          content: Text(
            'Salvar este número como WhatsApp cadastrado da conta: +$nextDigits?',
            style: TextStyle(color: WaTheme.of(context).textSecondary),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Confirmar'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .updateProfile(
            name: name,
            email: email.isEmpty ? null : email,
            password: pass.isEmpty ? null : pass,
            whatsappDialCode: phone.isEmpty ? null : '+$dial',
            whatsappNumber: phone.isEmpty ? null : phone,
            avatarBytes: _avatarBytes,
            avatarFileName: _avatarFileName,
            avatarMimeType: _avatarMimeType,
            removeAvatar: _removeAvatar,
          );
      if (!mounted) return;
      setState(() {
        _avatarBytes = null;
        _avatarFileName = null;
        _avatarMimeType = null;
        _removeAvatar = false;
        _password.clear();
        _passwordConfirm.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Perfil atualizado com sucesso.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final avatar = _avatarBytes != null
        ? ClipOval(
            child: Image.memory(
              _avatarBytes!,
              width: 72,
              height: 72,
              fit: BoxFit.cover,
            ),
          )
        : _removeAvatar
        ? _AccountAvatarFallback(name: _name.text)
        : _AccountAvatarNetwork(user: widget.user);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final narrow = constraints.maxWidth < 640;
            final avatarBlock = Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(width: 72, height: 72, child: avatar),
                const SizedBox(width: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _saving ? null : _pickAvatar,
                      icon: const Icon(Icons.photo_camera_outlined, size: 18),
                      label: const Text('Trocar foto'),
                    ),
                    TextButton.icon(
                      onPressed: _saving
                          ? null
                          : () => setState(() {
                              _avatarBytes = null;
                              _avatarFileName = null;
                              _avatarMimeType = null;
                              _removeAvatar = true;
                            }),
                      icon: const Icon(Icons.delete_outline_rounded, size: 18),
                      label: const Text('Remover'),
                    ),
                  ],
                ),
              ],
            );
            if (narrow) return avatarBlock;
            return Row(children: [avatarBlock]);
          },
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _name,
          enabled: !_saving,
          decoration: const InputDecoration(
            labelText: 'Nome',
            prefixIcon: Icon(Icons.person_outline_rounded),
            filled: true,
          ),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _email,
          enabled: !_saving,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(
            labelText: 'E-mail',
            prefixIcon: Icon(Icons.alternate_email_rounded),
            filled: true,
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            SizedBox(
              width: 96,
              child: TextField(
                controller: _whatsappDialCode,
                enabled: !_saving,
                keyboardType: TextInputType.phone,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'DDI',
                  prefixText: '+',
                  filled: true,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: _whatsappNumber,
                enabled: !_saving,
                keyboardType: TextInputType.phone,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'WhatsApp cadastrado',
                  prefixIcon: Icon(Icons.call_outlined),
                  filled: true,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _password,
                enabled: !_saving,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Nova senha',
                  prefixIcon: Icon(Icons.lock_outline_rounded),
                  filled: true,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: _passwordConfirm,
                enabled: !_saving,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Confirmar senha',
                  prefixIcon: Icon(Icons.lock_reset_rounded),
                  filled: true,
                ),
              ),
            ),
          ],
        ),
        if (_error != null) ...[
          const SizedBox(height: 10),
          Text(_error!, style: const TextStyle(color: Color(0xFFEA0038))),
        ],
        const SizedBox(height: 14),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save_outlined, size: 18),
            label: const Text('Salvar conta'),
          ),
        ),
      ],
    );
  }
}

class _AccountAvatarNetwork extends StatelessWidget {
  const _AccountAvatarNetwork({required this.user});

  final SessionUser user;

  @override
  Widget build(BuildContext context) {
    final url = _settingsAvatarUrl(user.avatarUrl);
    if (url == null) return _AccountAvatarFallback(name: user.name);
    return ClipOval(
      child: Image.network(
        url,
        width: 72,
        height: 72,
        fit: BoxFit.cover,
        errorBuilder: (context, _, _) =>
            _AccountAvatarFallback(name: user.name),
      ),
    );
  }
}

class _AccountAvatarFallback extends StatelessWidget {
  const _AccountAvatarFallback({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final initial = name.trim().isEmpty
        ? '?'
        : name.trim().characters.first.toUpperCase();
    return CircleAvatar(
      radius: 36,
      backgroundColor: wa.accentSoft,
      child: Text(
        initial,
        style: TextStyle(
          color: wa.accent,
          fontSize: 24,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

({String dialCode, String number}) _splitWhatsapp(String? value) {
  final digits = _digitsOnly(value);
  if (digits.isEmpty) return (dialCode: '55', number: '');
  if (digits.startsWith('55') && digits.length > 2) {
    return (dialCode: '55', number: digits.substring(2));
  }
  if (digits.startsWith('1') && digits.length > 10) {
    return (dialCode: '1', number: digits.substring(1));
  }
  if (digits.length > 11) {
    return (dialCode: digits.substring(0, 2), number: digits.substring(2));
  }
  return (dialCode: '55', number: digits);
}

String _digitsOnly(String? value) => value?.replaceAll(RegExp(r'\D'), '') ?? '';

String? _settingsAvatarUrl(String? value) {
  final raw = value?.trim();
  if (raw == null || raw.isEmpty) return null;
  if (raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('data:')) {
    return raw;
  }
  return Uri.base.resolve(raw.startsWith('/') ? raw : '/$raw').toString();
}

class _PlanManagementCard extends ConsumerStatefulWidget {
  const _PlanManagementCard({required this.snapshot});

  final PlanSnapshot snapshot;

  @override
  ConsumerState<_PlanManagementCard> createState() =>
      _PlanManagementCardState();
}

class _PlanManagementCardState extends ConsumerState<_PlanManagementCard> {
  static const _providerOrder = [
    'mercadopago_pix',
    'polopag_pix',
    'mercadopago_checkout',
  ];

  String? _provider;
  int? _busyPlanId;
  String? _error;

  PlanSnapshot get snapshot => widget.snapshot;

  List<String> get _availableProviders {
    final available = <String>[
      for (final key in _providerOrder)
        if (snapshot.paymentMethods.any(
          (method) => method.provider == key && method.available,
        ))
          key,
    ];
    return available;
  }

  String get _selectedProvider {
    final providers = _availableProviders;
    if (providers.isEmpty) return 'mercadopago_pix';
    if (_provider != null && providers.contains(_provider)) return _provider!;
    return providers.first;
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final plans =
        snapshot.plans.where((plan) => plan.id > 0 && plan.active).toList()
          ..sort((a, b) => a.price.compareTo(b.price));
    final providers = _availableProviders;
    final period = snapshot.currentPeriodEnd == null
        ? null
        : 'vence em ${_formatDateTime(snapshot.currentPeriodEnd!)}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _MetricsRow(
          metrics: [
            _Metric('Plano', snapshot.planName),
            _Metric('Status', _planStatusLabel(snapshot.status)),
            _Metric(
              'Perfil',
              snapshot.profileUnlimited ? 'Liberado' : 'Limitado',
            ),
            _Metric('Saldo', _formatMoney(snapshot.balance)),
          ],
        ),
        const SizedBox(height: 12),
        DecoratedBox(
          decoration: BoxDecoration(
            color: wa.searchBg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: wa.border),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Icon(Icons.workspace_premium_rounded, color: wa.accent),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    [
                      snapshot.profileUnlimited
                          ? 'Seu perfil libera todos os grupos e funcionalidades.'
                          : 'Assine um plano para liberar o perfil completo.',
                      if (snapshot.daysRemaining != null)
                        '${snapshot.daysRemaining} dia(s) restante(s).',
                      ?period,
                    ].join(' '),
                    style: TextStyle(color: wa.textSecondary, height: 1.35),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (providers.isNotEmpty) ...[
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _selectedProvider,
            items: providers
                .map(
                  (provider) => DropdownMenuItem(
                    value: provider,
                    child: Text(_providerLabel(provider)),
                  ),
                )
                .toList(),
            onChanged: _busyPlanId == null
                ? (value) => setState(() => _provider = value)
                : null,
            decoration: const InputDecoration(
              labelText: 'Forma de pagamento',
              prefixIcon: Icon(Icons.payments_outlined),
              filled: true,
            ),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 10),
          Text(_error!, style: const TextStyle(color: Color(0xFFB42318))),
        ],
        const SizedBox(height: 14),
        if (plans.isEmpty)
          const _EmptyMessage('Nenhum plano ativo disponível para compra.')
        else
          ...plans.map((plan) {
            final current = snapshot.currentPlanId == plan.id;
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _PlanOptionTile(
                plan: plan,
                current: current,
                canPayWithBalance:
                    plan.price > 0 && snapshot.balance >= plan.price,
                paymentEnabled: providers.isNotEmpty && plan.price > 0,
                busy: _busyPlanId == plan.id,
                onCheckout: () => _createCheckout(plan),
                onBalance: () => _payWithBalance(plan),
              ),
            );
          }),
      ],
    );
  }

  Future<void> _createCheckout(SubscriptionPlanSummary plan) async {
    if (_busyPlanId != null) return;
    setState(() {
      _busyPlanId = plan.id;
      _error = null;
    });
    try {
      final checkout = await ref
          .read(apiClientProvider)
          .createPlanCheckout(planId: plan.id, provider: _selectedProvider);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) =>
            _PlanCheckoutDialog(plan: plan, checkout: checkout),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busyPlanId = null);
    }
  }

  Future<void> _payWithBalance(SubscriptionPlanSummary plan) async {
    if (_busyPlanId != null) return;
    setState(() {
      _busyPlanId = plan.id;
      _error = null;
    });
    try {
      final message = await ref
          .read(apiClientProvider)
          .activatePlanWithBalance(planId: plan.id);
      ref.invalidate(planSnapshotProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busyPlanId = null);
    }
  }
}

class _PlanOptionTile extends StatelessWidget {
  const _PlanOptionTile({
    required this.plan,
    required this.current,
    required this.canPayWithBalance,
    required this.paymentEnabled,
    required this.busy,
    required this.onCheckout,
    required this.onBalance,
  });

  final SubscriptionPlanSummary plan;
  final bool current;
  final bool canPayWithBalance;
  final bool paymentEnabled;
  final bool busy;
  final VoidCallback onCheckout;
  final VoidCallback onBalance;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: current ? wa.accentSoft : wa.panelElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: current ? wa.accent : wa.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 620;
            final actions = Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: busy || !paymentEnabled ? null : onCheckout,
                  icon: busy
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.pix_rounded, size: 18),
                  label: Text(current ? 'Renovar perfil' : 'Assinar perfil'),
                ),
                OutlinedButton.icon(
                  onPressed: busy || !canPayWithBalance ? null : onBalance,
                  icon: const Icon(
                    Icons.account_balance_wallet_outlined,
                    size: 18,
                  ),
                  label: const Text('Usar saldo'),
                ),
              ],
            );
            final content = Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        plan.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                        ),
                      ),
                    ),
                    if (current)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: wa.accent,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: const Text(
                          'Atual',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  plan.description?.trim().isNotEmpty == true
                      ? plan.description!
                      : 'Perfil completo para usar o BotAdmin.',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: wa.textMuted, height: 1.3),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    _PlanChip(
                      Icons.payments_outlined,
                      _formatMoney(plan.price),
                    ),
                    _PlanChip(
                      Icons.smartphone_rounded,
                      plan.instanceLimit <= 0
                          ? 'instâncias livres'
                          : '${plan.instanceLimit} instância(s)',
                    ),
                    _PlanChip(
                      Icons.groups_rounded,
                      plan.profileUnlimited
                          ? 'todos os grupos'
                          : '${plan.groupLimit} grupo(s)',
                    ),
                    _PlanChip(Icons.event_rounded, '${plan.durationDays} dias'),
                    if (plan.allowFlows)
                      const _PlanChip(Icons.account_tree_outlined, 'fluxos'),
                  ],
                ),
              ],
            );
            if (compact) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [content, const SizedBox(height: 12), actions],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: content),
                const SizedBox(width: 12),
                actions,
              ],
            );
          },
        ),
      ),
    );
  }
}

class _PlanChip extends StatelessWidget {
  const _PlanChip(this.icon, this.label);

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.searchBg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: wa.textMuted),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                color: wa.textSecondary,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlanCheckoutDialog extends StatelessWidget {
  const _PlanCheckoutDialog({required this.plan, required this.checkout});

  final SubscriptionPlanSummary plan;
  final PlanCheckout checkout;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final qrBytes = _decodeQrCode(checkout.qrCodeBase64);
    return AlertDialog(
      backgroundColor: wa.panel,
      title: Text(
        'Pagamento do perfil',
        style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w800),
      ),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${plan.name} · ${_formatMoney(checkout.amount > 0 ? checkout.amount : plan.price)}',
                style: TextStyle(
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Depois do pagamento a liberação do perfil é automática.',
                style: TextStyle(color: wa.textMuted, height: 1.35),
              ),
              if (checkout.expiresAt != null) ...[
                const SizedBox(height: 6),
                Text(
                  'Expira em ${_formatDateTime(checkout.expiresAt!)}',
                  style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                ),
              ],
              if (qrBytes != null) ...[
                const SizedBox(height: 16),
                Center(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: ColoredBox(
                      color: Colors.white,
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Image.memory(
                          qrBytes,
                          width: 210,
                          height: 210,
                          fit: BoxFit.contain,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
              if ((checkout.qrCode ?? '').trim().isNotEmpty) ...[
                const SizedBox(height: 14),
                TextField(
                  readOnly: true,
                  minLines: 3,
                  maxLines: 5,
                  controller: TextEditingController(text: checkout.qrCode),
                  decoration: const InputDecoration(
                    labelText: 'Pix copia e cola',
                    filled: true,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).maybePop(),
          child: const Text('Fechar'),
        ),
        if ((checkout.ticketUrl ?? '').trim().isNotEmpty)
          OutlinedButton.icon(
            onPressed: () => _openUrl(checkout.ticketUrl!),
            icon: const Icon(Icons.open_in_new_rounded, size: 18),
            label: const Text('Abrir link'),
          ),
        if ((checkout.qrCode ?? '').trim().isNotEmpty)
          FilledButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: checkout.qrCode!));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Código Pix copiado.')),
              );
            },
            icon: const Icon(Icons.copy_rounded, size: 18),
            label: const Text('Copiar Pix'),
          ),
      ],
    );
  }
}

Uint8List? _decodeQrCode(String? value) {
  final raw = value?.trim();
  if (raw == null || raw.isEmpty) return null;
  final payload = raw.startsWith('data:image')
      ? raw.substring(raw.indexOf(',') + 1)
      : raw;
  try {
    return base64Decode(payload);
  } catch (_) {
    return null;
  }
}

class _InstanceSettingsCard extends StatelessWidget {
  const _InstanceSettingsCard({
    required this.instance,
    required this.bundle,
    required this.savingKey,
    required this.onToggle,
  });

  final BotInstance instance;
  final InstanceSettingsBundle bundle;
  final String? savingKey;
  final Future<void> Function(BotInstance instance, String key, bool value)
  onToggle;

  @override
  Widget build(BuildContext context) {
    final items = const [
      _SettingToggle(
        keyName: 'nativeButtons',
        title: 'Botões nativos',
        subtitle: 'Usa botões interativos reais quando disponíveis.',
        icon: Icons.smart_button_rounded,
      ),
      _SettingToggle(
        keyName: 'recoverDeletedMessages',
        title: 'Recuperar apagadas',
        subtitle: 'Mantém conteúdo recuperável no histórico quando possível.',
        icon: Icons.restore_rounded,
      ),
      _SettingToggle(
        keyName: 'keepDeletedChatsInHistory',
        title: 'Manter chats apagados',
        subtitle: 'Não remove conversas locais quando apagadas no WhatsApp.',
        icon: Icons.history_rounded,
      ),
      _SettingToggle(
        keyName: 'persistentMediaStorage',
        title: 'Mídia persistente',
        subtitle: 'Cacha mídias no storage contratado.',
        icon: Icons.cloud_done_rounded,
      ),
      _SettingToggle(
        keyName: 'prefixoPv',
        title: 'Comandos no PV',
        subtitle: 'Libera comandos com prefixo em conversas privadas.',
        icon: Icons.terminal_rounded,
      ),
      _SettingToggle(
        keyName: 'notifyOnlinePresence',
        title: 'Avisar online',
        subtitle: 'Monitora presença online dos contatos configurados.',
        icon: Icons.online_prediction_rounded,
      ),
    ];
    return _PanelCard(
      title: instance.name,
      subtitle:
          '${instance.sessionStatus} · ${bundle.settings.autoResponsesCount} auto resposta(s)',
      child: Column(
        children: [
          LinearProgressIndicator(value: bundle.storage.usageRatio),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Storage: ${_formatBytes(bundle.storage.usedBytes)} de ${_formatBytes(bundle.storage.quotaBytes)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox(height: 14),
          ...items.map((item) {
            final saving = savingKey == item.keyName;
            return SwitchListTile(
              contentPadding: EdgeInsets.zero,
              secondary: saving
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(item.icon),
              title: Text(item.title),
              subtitle: Text(item.subtitle),
              value: bundle.settings.enabled(item.keyName),
              onChanged: savingKey == null
                  ? (value) => onToggle(instance, item.keyName, value)
                  : null,
            );
          }),
        ],
      ),
    );
  }
}

class _SettingToggle {
  const _SettingToggle({
    required this.keyName,
    required this.title,
    required this.subtitle,
    required this.icon,
  });

  final String keyName;
  final String title;
  final String subtitle;
  final IconData icon;
}

class _CallEntry {
  const _CallEntry({required this.instance, required this.call});

  final BotInstance instance;
  final WhatsappCallRecord call;
}

class _CallsHeader extends StatelessWidget {
  const _CallsHeader({
    required this.activeCalls,
    required this.historyCount,
    required this.connectedInstances,
    required this.refreshing,
    required this.onRefresh,
    required this.onStart,
  });

  final int activeCalls;
  final int historyCount;
  final int connectedInstances;
  final bool refreshing;
  final VoidCallback onRefresh;
  final VoidCallback? onStart;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 18, 12, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Chamadas',
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              IconButton(
                onPressed: onStart,
                tooltip: 'Nova chamada',
                icon: Icon(Icons.add_ic_call_rounded, size: 22, color: wa.icon),
              ),
              IconButton(
                onPressed: refreshing ? null : onRefresh,
                tooltip: 'Atualizar',
                icon: refreshing
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: wa.accent,
                        ),
                      )
                    : Icon(Icons.refresh_rounded, size: 22, color: wa.icon),
              ),
            ],
          ),
          Text(
            activeCalls > 0
                ? '$activeCalls em curso · $historyCount no histórico'
                : historyCount > 0
                ? '$historyCount no histórico · $connectedInstances perfil(is) online'
                : 'Histórico e chamadas ativas · $connectedInstances online',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: wa.textMuted, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _CallSectionLabel extends StatelessWidget {
  const _CallSectionLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 14, 22, 6),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          color: wa.textMuted,
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

class _IncomingCallBanner extends StatelessWidget {
  const _IncomingCallBanner({
    required this.entry,
    required this.acting,
    required this.onAccept,
    required this.onReject,
    this.onEnd,
    this.onOpen,
    this.elevated = false,
  });

  final _CallEntry entry;
  final bool acting;
  final VoidCallback onAccept;
  final VoidCallback onReject;
  final VoidCallback? onEnd;
  final VoidCallback? onOpen;
  final bool elevated;

  @override
  Widget build(BuildContext context) {
    final call = entry.call;
    final title = _callTitle(call);
    final ringing = call.isRinging;
    final connected = call.isConnected;
    final outgoing = call.isOutgoingPending;
    final subtitle = call.isVideo
        ? ringing
              ? 'Chamada de vídeo recebida…'
              : connected
              ? 'Chamada de vídeo em andamento…'
              : outgoing
              ? 'Chamada de vídeo iniciada…'
              : call.statusLabel
        : ringing
        ? 'Chamada de voz recebida…'
        : connected
        ? 'Chamada de voz em andamento…'
        : outgoing
        ? 'Chamando…'
        : call.statusLabel;
    return Material(
      elevation: elevated ? 10 : 0,
      color: const Color(0xFF1FA855),
      child: SafeArea(
        bottom: false,
        top: elevated,
        child: InkWell(
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 12, 12),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: Colors.white.withValues(alpha: 0.18),
                  child: Icon(
                    call.isVideo ? Icons.videocam_rounded : Icons.call_rounded,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.9),
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                if (ringing) ...[
                  _CallRoundButton(
                    color: const Color(0xFFE53935),
                    icon: Icons.call_end_rounded,
                    tooltip: 'Recusar',
                    onPressed: acting ? null : onReject,
                  ),
                  const SizedBox(width: 10),
                  _CallRoundButton(
                    color: const Color(0xFF25D366),
                    icon: Icons.call_rounded,
                    tooltip: 'Atender',
                    onPressed: acting ? null : onAccept,
                  ),
                ] else
                  _CallRoundButton(
                    color: onEnd == null
                        ? const Color(0xFF78909C)
                        : const Color(0xFFE53935),
                    icon: Icons.call_end_rounded,
                    tooltip: onEnd == null
                        ? 'Aguardando confirmação da chamada'
                        : 'Encerrar',
                    onPressed: acting ? null : onEnd,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CallRoundButton extends StatelessWidget {
  const _CallRoundButton({
    required this.color,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final Color color;
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: color,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: 46,
            height: 46,
            child: Icon(icon, color: Colors.white, size: 24),
          ),
        ),
      ),
    );
  }
}

class _IncomingCallDialog extends ConsumerStatefulWidget {
  const _IncomingCallDialog({
    required this.entry,
    required this.acting,
    required this.onAccept,
    required this.onReject,
    required this.onEnd,
    required this.onSpeakerphone,
    required this.onMicrophoneMuted,
  });

  final _CallEntry entry;
  final bool acting;
  final Future<bool> Function() onAccept;
  final Future<void> Function() onReject;
  final Future<void> Function() onEnd;
  final Future<void> Function(bool enabled) onSpeakerphone;
  final Future<void> Function(bool muted) onMicrophoneMuted;

  @override
  ConsumerState<_IncomingCallDialog> createState() =>
      _IncomingCallDialogState();
}

class _IncomingCallDialogState extends ConsumerState<_IncomingCallDialog> {
  bool _accepted = false;
  bool _busy = false;
  bool _speakerphone = false;
  bool _microphoneMuted = false;
  bool _dismissScheduled = false;

  @override
  void initState() {
    super.initState();
    _accepted = widget.entry.call.isConnected;
  }

  bool _isCurrentCallStillLive(LiveCallsSnapshot snapshot) {
    return snapshot.items.any(
      (item) =>
          item.instance.id == widget.entry.instance.id &&
          item.call.key == widget.entry.call.key &&
          item.call.isLive,
    );
  }

  void _dismissAfterRemoteEnd() {
    if (_dismissScheduled) return;
    _dismissScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      callAudioBridge.stop();
      Navigator.of(context).maybePop();
    });
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final call = widget.entry.call;
    final liveCalls = ref.watch(liveCallsControllerProvider);
    if (!liveCalls.loading && !_isCurrentCallStillLive(liveCalls)) {
      _dismissAfterRemoteEnd();
    }
    final title = _callTitle(call);
    final phone = _callPhoneLabel(call);
    final active = _accepted || call.isConnected;
    return AlertDialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      contentPadding: const EdgeInsets.fromLTRB(24, 26, 24, 20),
      content: SizedBox(
        width: 330,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _CallAvatar(call: call, active: active, radius: 48),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
            ),
            if (phone.isNotEmpty) ...[
              const SizedBox(height: 5),
              Text(phone, style: TextStyle(color: wa.textMuted, fontSize: 15)),
            ],
            const SizedBox(height: 8),
            Text(
              active
                  ? 'Chamada de voz em andamento'
                  : 'Chamada de voz recebida',
              style: TextStyle(color: wa.accent, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 26),
            if (active)
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 16,
                runSpacing: 14,
                children: [
                  _CallDialogAction(
                    icon: _microphoneMuted
                        ? Icons.mic_off_rounded
                        : Icons.mic_rounded,
                    label: _microphoneMuted ? 'Ativar microfone' : 'Microfone',
                    selected: _microphoneMuted,
                    onPressed: _busy
                        ? null
                        : () async {
                            final next = !_microphoneMuted;
                            setState(() => _microphoneMuted = next);
                            await widget.onMicrophoneMuted(next);
                          },
                  ),
                  _CallDialogAction(
                    icon: _speakerphone
                        ? Icons.volume_up_rounded
                        : Icons.volume_down_rounded,
                    label: 'Viva-voz',
                    selected: _speakerphone,
                    onPressed: _busy
                        ? null
                        : () async {
                            final next = !_speakerphone;
                            setState(() => _speakerphone = next);
                            await widget.onSpeakerphone(next);
                          },
                  ),
                  _CallDialogAction(
                    icon: Icons.call_end_rounded,
                    label: 'Encerrar',
                    destructive: true,
                    onPressed: _busy
                        ? null
                        : () async {
                            setState(() => _busy = true);
                            await widget.onEnd();
                          },
                  ),
                ],
              )
            else
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 24,
                children: [
                  _CallDialogAction(
                    icon: Icons.call_end_rounded,
                    label: 'Recusar',
                    destructive: true,
                    onPressed: _busy
                        ? null
                        : () async {
                            setState(() => _busy = true);
                            await widget.onReject();
                          },
                  ),
                  const SizedBox(width: 24),
                  _CallDialogAction(
                    icon: Icons.call_rounded,
                    label: _busy ? 'Conectando…' : 'Atender',
                    onPressed: _busy
                        ? null
                        : () async {
                            setState(() => _busy = true);
                            final accepted = await widget.onAccept();
                            if (mounted) {
                              setState(() {
                                _busy = false;
                                _accepted = accepted;
                              });
                            }
                          },
                  ),
                ],
              ),
            if (_busy) ...[
              const SizedBox(height: 18),
              const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Fechar painel'),
        ),
      ],
    );
  }
}

class _CallDialogAction extends StatelessWidget {
  const _CallDialogAction({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.destructive = false,
    this.selected = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final bool destructive;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final color = destructive ? const Color(0xFFE53935) : wa.accent;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: selected ? color : color.withValues(alpha: 0.14),
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onPressed,
            child: SizedBox(
              width: 58,
              height: 58,
              child: Icon(
                icon,
                color: selected ? Colors.white : color,
                size: 27,
              ),
            ),
          ),
        ),
        const SizedBox(height: 7),
        Text(label, style: TextStyle(color: wa.textMuted, fontSize: 12)),
      ],
    );
  }
}

class _CallsEmptyList extends StatelessWidget {
  const _CallsEmptyList();

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(28, 32, 28, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.call_rounded, size: 48, color: wa.textMuted),
            const SizedBox(height: 14),
            Text(
              'Nenhuma chamada por enquanto',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 17,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'O histórico e as chamadas ativas aparecem aqui, como no WhatsApp.',
              textAlign: TextAlign.center,
              style: TextStyle(color: wa.textMuted, height: 1.35),
            ),
          ],
        ),
      ),
    );
  }
}

class _CallListTile extends StatelessWidget {
  const _CallListTile({
    required this.entry,
    required this.selected,
    required this.audioSnapshot,
    required this.onTap,
  });

  final _CallEntry entry;
  final bool selected;
  final CallAudioBridgeSnapshot audioSnapshot;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final call = entry.call;
    final audioActive =
        audioSnapshot.callId == call.id && audioSnapshot.isActive;
    final wa = WaTheme.of(context);
    final missed =
        call.isTerminal &&
        (call.isIncoming ||
            call.statusLabel.toLowerCase().contains('perdida') ||
            call.statusLabel.toLowerCase().contains('recusada'));
    final arrowColor = missed
        ? const Color(0xFFE53935)
        : call.isIncoming
        ? const Color(0xFF25D366)
        : wa.textMuted;
    final arrowIcon = call.isIncoming
        ? (missed ? Icons.call_missed_rounded : Icons.call_received_rounded)
        : Icons.call_made_rounded;

    return Material(
      color: selected ? wa.selectedRow : wa.panel,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 72,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 14, 8),
            child: Row(
              children: [
                _CallAvatar(
                  call: call,
                  active: audioActive || call.isRinging || call.isConnected,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _callTitle(call),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          Icon(arrowIcon, size: 15, color: arrowColor),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              call.statusLabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: wa.textMuted,
                                fontSize: 13.2,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      _formatCallTimestamp(call.timestamp),
                      style: TextStyle(color: wa.textMuted, fontSize: 12),
                    ),
                    const SizedBox(height: 6),
                    Icon(
                      call.isVideo
                          ? Icons.videocam_rounded
                          : Icons.call_rounded,
                      color: call.isRinging || call.isConnected || audioActive
                          ? wa.accent
                          : wa.icon,
                      size: 18,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CallDetailPane extends StatelessWidget {
  const _CallDetailPane({
    required this.entry,
    required this.acting,
    required this.audioSnapshot,
    required this.busyCallAudioId,
    required this.onAction,
    required this.onStartAudio,
    required this.onStopAudio,
    required this.onStartCall,
    required this.onRefresh,
  });

  final _CallEntry? entry;
  final bool acting;
  final CallAudioBridgeSnapshot audioSnapshot;
  final String? busyCallAudioId;
  final ValueChanged<String>? onAction;
  final VoidCallback? onStartAudio;
  final VoidCallback onStopAudio;
  final VoidCallback? onStartCall;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final resolved = entry;
    if (resolved == null) {
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircleAvatar(
                  radius: 40,
                  backgroundColor: wa.searchBg,
                  child: Icon(Icons.call_rounded, color: wa.icon, size: 36),
                ),
                const SizedBox(height: 18),
                Text(
                  'Chamadas',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 26,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Selecione uma chamada do histórico ou inicie uma nova ligação privada.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: wa.textMuted, height: 1.35),
                ),
                const SizedBox(height: 20),
                if (onStartCall != null)
                  FilledButton.icon(
                    onPressed: onStartCall,
                    icon: const Icon(Icons.add_ic_call_rounded),
                    label: const Text('Nova chamada'),
                  ),
              ],
            ),
          ),
        ),
      );
    }

    final call = resolved.call;
    final audioForCall = audioSnapshot.callId == call.id;
    final audioActive = audioForCall && audioSnapshot.isActive;
    final audioBusy = busyCallAudioId == call.id;
    final canRun = !acting && call.id.trim().isNotEmpty;
    final ringing = call.isRinging;
    final connected = call.isConnected;
    final ended = call.isTerminal;

    return ColoredBox(
      color: wa.contentBg,
      child: Column(
        children: [
          Material(
            color: wa.headerBg,
            child: SizedBox(
              height: 60,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    _CallAvatar(call: call, active: audioActive, radius: 18),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _callTitle(call),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: wa.textPrimary,
                              fontSize: 16.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            call.statusLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: wa.textMuted, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: onRefresh,
                      tooltip: 'Atualizar',
                      icon: Icon(Icons.refresh_rounded, color: wa.icon),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 28, 20, 28),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _CallAvatar(
                        call: call,
                        active: audioActive || connected || ringing,
                        radius: 52,
                      ),
                      const SizedBox(height: 18),
                      Text(
                        _callTitle(call),
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontSize: 24,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        call.statusLabel,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: ringing
                              ? wa.accent
                              : connected
                              ? const Color(0xFF25D366)
                              : wa.textMuted,
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (audioActive) ...[
                        const SizedBox(height: 12),
                        Text(
                          'Áudio conectado',
                          style: TextStyle(
                            color: wa.accent,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                      const SizedBox(height: 28),
                      // Botões contextuais (só o que faz sentido no estado atual).
                      if (ringing)
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            _CallRoundButton(
                              color: const Color(0xFFE53935),
                              icon: Icons.call_end_rounded,
                              tooltip: 'Recusar',
                              onPressed: canRun
                                  ? () => onAction?.call('reject')
                                  : null,
                            ),
                            const SizedBox(width: 28),
                            _CallRoundButton(
                              color: const Color(0xFF25D366),
                              icon: Icons.call_rounded,
                              tooltip: 'Atender',
                              onPressed: canRun
                                  ? () => onAction?.call('accept')
                                  : null,
                            ),
                          ],
                        )
                      else if (connected || call.isOutgoingPending)
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            if (!call.isVideo) ...[
                              _CallRoundButton(
                                color: audioActive
                                    ? wa.searchBg
                                    : const Color(0xFF54656F),
                                icon: audioBusy
                                    ? Icons.hourglass_top_rounded
                                    : audioActive
                                    ? Icons.volume_up_rounded
                                    : Icons.volume_off_rounded,
                                tooltip: audioActive
                                    ? 'Áudio ativo'
                                    : 'Conectar áudio',
                                onPressed: canRun && !audioBusy
                                    ? audioActive
                                          ? onStopAudio
                                          : onStartAudio
                                    : null,
                              ),
                              const SizedBox(width: 28),
                            ],
                            _CallRoundButton(
                              color: const Color(0xFFE53935),
                              icon: Icons.call_end_rounded,
                              tooltip: 'Encerrar',
                              onPressed: canRun
                                  ? () => onAction?.call('end')
                                  : null,
                            ),
                          ],
                        )
                      else if (ended)
                        Text(
                          'Esta chamada já foi finalizada.',
                          style: TextStyle(color: wa.textMuted),
                        ),
                    ],
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

class _CallAvatar extends StatelessWidget {
  const _CallAvatar({
    required this.call,
    required this.active,
    this.radius = 25,
  });

  final WhatsappCallRecord call;
  final bool active;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final avatarUrl = _absoluteCallAvatarUrl(call.avatarUrl);
    return CircleAvatar(
      radius: radius,
      backgroundColor: active ? wa.accentSoft : wa.avatarFallback,
      foregroundColor: active ? wa.accent : wa.icon,
      child: avatarUrl != null && avatarUrl.isNotEmpty
          ? ClipOval(
              child: BotAdminCachedImage(
                imageUrl: avatarUrl,
                width: radius * 2,
                height: radius * 2,
                fit: BoxFit.cover,
                fadeInDuration: const Duration(milliseconds: 120),
                errorWidget: (_, _, _) => _callFallback(call, radius),
              ),
            )
          : _callFallback(call, radius),
    );
  }

  Widget _callFallback(WhatsappCallRecord call, double radius) => call.isVideo
      ? Icon(Icons.videocam_rounded, size: radius * 0.92)
      : Text(
          _callInitials(call),
          style: TextStyle(
            fontSize: radius * 0.58,
            fontWeight: FontWeight.w800,
          ),
        );
}

class _StartCallDraft {
  const _StartCallDraft({
    required this.instance,
    required this.chatJid,
    required this.video,
  });

  final BotInstance instance;
  final String chatJid;
  final bool video;
}

class _StartCallDialog extends StatefulWidget {
  const _StartCallDialog({required this.instances});

  final List<BotInstance> instances;

  @override
  State<_StartCallDialog> createState() => _StartCallDialogState();
}

class _StartCallDialogState extends State<_StartCallDialog> {
  late BotInstance _instance = widget.instances.first;
  final _target = TextEditingController();
  final bool _video = false;
  String? _error;

  @override
  void dispose() {
    _target.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Nova chamada'),
      content: SizedBox(
        width: 430,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<BotInstance>(
              initialValue: _instance,
              decoration: InputDecoration(
                labelText: 'Instancia',
                prefixIcon: Icon(Icons.smartphone_rounded),
              ),
              items: widget.instances
                  .map(
                    (instance) => DropdownMenuItem(
                      value: instance,
                      child: Text(instance.name),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null) setState(() => _instance = value);
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _target,
              autofocus: true,
              decoration: InputDecoration(
                labelText: 'Numero ou JID privado',
                hintText: '5592999999999',
                prefixIcon: const Icon(Icons.person_search_rounded),
                errorText: _error,
              ),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Chamada de video'),
              subtitle: const Text(
                'Indisponivel por enquanto. Use chamada de audio.',
              ),
              value: false,
              onChanged: null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.add_call),
          label: const Text('Iniciar'),
        ),
      ],
    );
  }

  void _submit() {
    final chatJid = _normalizePrivateCallTarget(_target.text);
    if (chatJid.isEmpty) {
      setState(() => _error = 'Informe um numero privado valido.');
      return;
    }
    Navigator.of(context).pop(
      _StartCallDraft(instance: _instance, chatJid: chatJid, video: _video),
    );
  }
}

class _FlowTile extends StatelessWidget {
  const _FlowTile({
    required this.flow,
    required this.busy,
    required this.onToggle,
    required this.onDelete,
  });

  final BotFlowSummary flow;
  final bool busy;
  final ValueChanged<bool> onToggle;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: flow.enabled
              ? const Color(0xFFE9FCEF)
              : const Color(0xFFFFEBEE),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: flow.enabled
                ? const Color(0xFF1DAA61)
                : const Color(0xFFE57373),
          ),
        ),
        child: ListTile(
          leading: busy
              ? const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Icon(
                  flow.enabled ? Icons.bolt_rounded : Icons.bolt_outlined,
                  color: flow.enabled
                      ? const Color(0xFF008069)
                      : const Color(0xFFC62828),
                ),
          title: Text(
            flow.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          subtitle: Text(
            '${flow.command.isEmpty ? flow.triggerType : flow.command} · ${flow.scope} · ${flow.nodeCount} bloco(s)\nAtualizado em ${_formatDateTime(flow.updatedAt)}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          trailing: Wrap(
            spacing: 6,
            children: [
              Switch(value: flow.enabled, onChanged: busy ? null : onToggle),
              IconButton(
                onPressed: busy ? null : onDelete,
                icon: const Icon(Icons.delete_outline_rounded),
                tooltip: 'Remover fluxo',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CampaignTile extends StatelessWidget {
  const _CampaignTile({
    required this.campaign,
    required this.busy,
    required this.onAction,
    this.selected = false,
    this.onTap,
  });

  final BotAdCampaignSummary campaign;
  final bool busy;
  final ValueChanged<String> onAction;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return _InfoTile(
      icon: campaign.active ? Icons.outbox_rounded : Icons.outbox_outlined,
      title: campaign.name,
      subtitle:
          '${campaign.active ? 'Divulgando' : 'Pausada'} · ${campaign.targetCount} grupo(s)\n${_promoterIntervalLabel(campaign)} · atualizada em ${_formatDateTime(campaign.updatedAt)}',
      active: campaign.active,
      selected: selected,
      onTap: onTap,
      trailing: busy
          ? const SizedBox(
              width: 34,
              height: 34,
              child: Padding(
                padding: EdgeInsets.all(8),
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          : PopupMenuButton<String>(
              tooltip: 'Ações da campanha',
              onSelected: onAction,
              itemBuilder: (context) => [
                const PopupMenuItem(value: 'edit', child: Text('Editar')),
                const PopupMenuItem(value: 'run', child: Text('Enviar agora')),
                PopupMenuItem(
                  value: 'toggle',
                  child: Text(campaign.active ? 'Pausar' : 'Ativar'),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem(value: 'delete', child: Text('Excluir')),
              ],
            ),
    );
  }
}

class _RaffleTile extends StatelessWidget {
  const _RaffleTile({required this.raffle, this.busy = false, this.onAction});

  final UserRaffleSummary raffle;
  final bool busy;
  final ValueChanged<String>? onAction;

  @override
  Widget build(BuildContext context) {
    final active = raffle.active;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: active ? const Color(0xFFE9FCEF) : const Color(0xFFFFF7E6),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: active ? const Color(0xFF1DAA61) : const Color(0xFFE0A63A),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: Colors.white,
                    child: Icon(
                      Icons.confirmation_number_rounded,
                      color: active
                          ? const Color(0xFF008069)
                          : const Color(0xFF9A6A00),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          raffle.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          raffle.groupLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Color(0xFF667781)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  _StatusPill(
                    label: _raffleStatusLabel(raffle.status),
                    active: active,
                  ),
                  const SizedBox(width: 4),
                  busy
                      ? const SizedBox(
                          width: 34,
                          height: 34,
                          child: Padding(
                            padding: EdgeInsets.all(8),
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : PopupMenuButton<String>(
                          tooltip: 'Ações da rifa',
                          enabled: onAction != null,
                          onSelected: onAction,
                          itemBuilder: (context) => [
                            const PopupMenuItem(
                              value: 'edit',
                              child: Text('Editar'),
                            ),
                            PopupMenuItem(
                              value: 'toggle',
                              child: Text(active ? 'Pausar' : 'Ativar'),
                            ),
                            const PopupMenuItem(
                              value: 'release',
                              child: Text('Liberar reservas'),
                            ),
                            const PopupMenuItem(
                              value: 'draw',
                              child: Text('Sortear'),
                            ),
                            const PopupMenuDivider(),
                            const PopupMenuItem(
                              value: 'delete',
                              child: Text('Excluir'),
                            ),
                          ],
                        ),
                ],
              ),
              const SizedBox(height: 12),
              LinearProgressIndicator(value: raffle.soldRatio),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 6,
                children: [
                  _InlineMetric(
                    icon: Icons.sell_rounded,
                    text: '${raffle.soldCount} vendidos',
                  ),
                  _InlineMetric(
                    icon: Icons.lock_clock_rounded,
                    text: '${raffle.reservedCount} reservados',
                  ),
                  _InlineMetric(
                    icon: Icons.grid_3x3_rounded,
                    text:
                        '${raffle.availableCount}/${raffle.numbersTotal} livres',
                  ),
                  _InlineMetric(
                    icon: Icons.payments_rounded,
                    text: _formatMoney(raffle.revenue),
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

class _AffiliateProviderTile extends StatelessWidget {
  const _AffiliateProviderTile({
    required this.provider,
    this.busy = false,
    this.onAction,
  });

  final AffiliateProviderSummary provider;
  final bool busy;
  final ValueChanged<String>? onAction;

  @override
  Widget build(BuildContext context) {
    final active = provider.active;
    return _InfoTile(
      icon: active ? Icons.link_rounded : Icons.link_off_rounded,
      title: provider.label,
      subtitle:
          '${_providerStatusLabel(provider.status)} · ${provider.accountName ?? '${provider.accountCount} conta(s)'}\n${provider.lastError ?? provider.description}',
      active: active,
      trailing: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 4,
        children: [
          _StatusPill(
            label: provider.implemented
                ? (provider.enabled ? 'Ativo' : 'Off')
                : 'Indisponível',
            active: active,
          ),
          busy
              ? const SizedBox(
                  width: 34,
                  height: 34,
                  child: Padding(
                    padding: EdgeInsets.all(8),
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : PopupMenuButton<String>(
                  tooltip: 'Ações do provedor',
                  enabled: onAction != null,
                  onSelected: onAction,
                  itemBuilder: (context) => const [
                    PopupMenuItem(
                      value: 'edit',
                      child: Text('Configurar credenciais'),
                    ),
                    PopupMenuItem(
                      value: 'refresh',
                      child: Text('Atualizar catálogo'),
                    ),
                    PopupMenuDivider(),
                    PopupMenuItem(
                      value: 'disconnect',
                      child: Text('Desconectar'),
                    ),
                  ],
                ),
        ],
      ),
    );
  }
}

class _AffiliateProductTile extends StatelessWidget {
  const _AffiliateProductTile({
    required this.link,
    this.busy = false,
    this.onAction,
  });

  final AffiliateProductLink link;
  final bool busy;
  final ValueChanged<String>? onAction;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: wa.panel,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: wa.border),
        ),
        child: ListTile(
          dense: true,
          leading: _ProductThumb(
            url: link.imageUrl,
            provider: link.providerLabel,
          ),
          title: Text(
            link.displayTitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          subtitle: Text(
            '${link.providerLabel} · ${link.priceFormatted ?? (link.priceAmount == null ? 'sem preço' : _formatMoney(link.priceAmount!))}\n${link.categoryId ?? link.itemId} · atualizado em ${_formatDateTime(link.updatedAt)}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: wa.textMuted),
          ),
          trailing: busy
              ? const SizedBox(
                  width: 34,
                  height: 34,
                  child: Padding(
                    padding: EdgeInsets.all(8),
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : PopupMenuButton<String>(
                  tooltip: 'Ações do produto',
                  enabled: onAction != null,
                  onSelected: onAction,
                  itemBuilder: (context) => [
                    const PopupMenuItem(value: 'edit', child: Text('Editar')),
                    if (link.affiliateUrl.trim().isNotEmpty)
                      const PopupMenuItem(
                        value: 'open',
                        child: Text('Abrir link'),
                      ),
                    PopupMenuItem(
                      value: 'toggle',
                      child: Text(link.active ? 'Pausar' : 'Ativar'),
                    ),
                    const PopupMenuDivider(),
                    const PopupMenuItem(
                      value: 'delete',
                      child: Text('Excluir'),
                    ),
                  ],
                ),
          onTap: onAction == null ? null : () => onAction!('edit'),
        ),
      ),
    );
  }
}

class _ProductThumb extends StatelessWidget {
  const _ProductThumb({required this.url, required this.provider});

  final String? url;
  final String provider;

  @override
  Widget build(BuildContext context) {
    final imageUrl = url?.trim();
    if (imageUrl == null || imageUrl.isEmpty) {
      final initial = provider.trim().isEmpty
          ? '?'
          : provider.trim().substring(0, 1).toUpperCase();
      return CircleAvatar(
        backgroundColor: Colors.white,
        child: Text(
          initial,
          style: const TextStyle(
            color: Color(0xFF008069),
            fontWeight: FontWeight.w900,
          ),
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.network(
        imageUrl,
        width: 46,
        height: 46,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) => CircleAvatar(
          backgroundColor: Colors.white,
          child: Icon(Icons.inventory_2_rounded, color: Color(0xFF008069)),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.active});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: active ? const Color(0xFFD9FDD3) : const Color(0xFFFFD6DB),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: active ? const Color(0xFF007A5A) : const Color(0xFFC62828),
            fontSize: 12,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }
}

class _InlineMetric extends StatelessWidget {
  const _InlineMetric({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: const Color(0xFF667781)),
        const SizedBox(width: 5),
        Text(text, style: const TextStyle(color: Color(0xFF3B4A54))),
      ],
    );
  }
}

Future<bool> _confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          style: destructive
              ? FilledButton.styleFrom(backgroundColor: const Color(0xFFC62828))
              : null,
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result == true;
}

class _RaffleDraft {
  const _RaffleDraft({
    required this.title,
    required this.price,
    required this.numbersTotal,
    required this.winnersCount,
    required this.groupIds,
    this.description,
    this.announcementMessage,
    this.finalMessage,
    this.announcementMentionAll = false,
    this.announcementMedia,
    this.buttons = const [],
    required this.purchaseMenu,
  });

  final String title;
  final String? description;
  final double price;
  final int numbersTotal;
  final int winnersCount;
  final List<int> groupIds;
  final String? announcementMessage;
  final String? finalMessage;
  final bool announcementMentionAll;
  final Map<String, Object?>? announcementMedia;
  final List<_RaffleButtonDraft> buttons;
  final UserRafflePurchaseMenuSettings purchaseMenu;

  Map<String, Object?> toPayload() {
    return {
      'title': title,
      'description': description,
      'price': price,
      'numbersTotal': numbersTotal,
      'winnersCount': winnersCount,
      'groupIds': groupIds,
      'announcement': {
        'message': announcementMessage,
        'mentionAll': announcementMentionAll,
        'media': announcementMedia,
        'buttons': buttons.map((button) => button.toJson()).toList(),
      },
      'finalization': {'message': finalMessage},
      'purchaseMenu': purchaseMenu.toJson(),
    };
  }
}

class _RaffleButtonDraft {
  const _RaffleButtonDraft({
    required this.id,
    required this.text,
    required this.type,
    required this.value,
  });

  final String id;
  final String text;
  final String type;
  final String value;

  Map<String, Object?> toJson() => {
    'id': id,
    'text': text,
    'type': type,
    'value': value,
  };
}

class _RaffleEditDialog extends ConsumerStatefulWidget {
  const _RaffleEditDialog({required this.groups, this.raffle});

  final UserRaffleSummary? raffle;
  final List<BotGroup> groups;

  @override
  ConsumerState<_RaffleEditDialog> createState() => _RaffleEditDialogState();
}

class _RaffleEditDialogState extends ConsumerState<_RaffleEditDialog> {
  late final TextEditingController _title;
  late final TextEditingController _description;
  late final TextEditingController _price;
  late final TextEditingController _numbersTotal;
  late final TextEditingController _winnersCount;
  late final TextEditingController _announcement;
  late final TextEditingController _finalMessage;
  late final TextEditingController _purchaseTitle;
  late final TextEditingController _purchaseDescription;
  late final TextEditingController _purchaseButtonText;
  late final TextEditingController _purchaseFooterText;
  late final TextEditingController _purchaseCardTitle;
  late final TextEditingController _purchaseRowTitle;
  late final TextEditingController _purchaseRowDescription;
  late final Set<int> _groupIds;
  final List<_RaffleButtonDraft> _buttons = [];
  Map<String, Object?>? _media;
  bool _mentionAll = true;
  bool _uploading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final raffle = widget.raffle;
    _title = TextEditingController(text: raffle?.title ?? '');
    _description = TextEditingController(text: raffle?.description ?? '');
    _price = TextEditingController(
      text: raffle == null ? '' : raffle.price.toStringAsFixed(2),
    );
    _numbersTotal = TextEditingController(
      text: raffle == null ? '100' : raffle.numbersTotal.toString(),
    );
    _winnersCount = TextEditingController(
      text: raffle == null ? '1' : raffle.winnersCount.toString(),
    );
    _groupIds = raffle?.groups.map((group) => group.groupId).toSet() ?? <int>{};
    _announcement = TextEditingController(
      text:
          raffle?.announcement.message ??
          '🎉 Nova rifa aberta: *{{title}}*\n'
              '🎟️ Cada número: {{price}}\n'
              '🔢 Números disponíveis: {{numbersTotal}}\n'
              '🏆 Ganhadores: {{winnersCount}}\n\n'
              'Toque no botão abaixo para participar. Boa sorte! 🍀',
    );
    _finalMessage = TextEditingController(
      text:
          raffle?.finalization.message ??
          '🏆 Resultado da rifa *{{title}}*\n\n'
              '{{winnerList}}\n\n'
              'Parabéns aos ganhadores e obrigado a todos que participaram! 🎉',
    );
    final purchaseMenu = raffle?.purchaseMenu;
    _purchaseTitle = TextEditingController(
      text: purchaseMenu?.title ?? 'Comprar números',
    );
    _purchaseDescription = TextEditingController(
      text:
          purchaseMenu?.description ??
          'Escolha quantos números deseja reservar. O valor total aparece em cada opção.',
    );
    _purchaseButtonText = TextEditingController(
      text: purchaseMenu?.buttonText ?? 'Escolher quantidade',
    );
    _purchaseFooterText = TextEditingController(
      text: purchaseMenu?.footerText ?? '{{title}} · {{price}} por número',
    );
    _purchaseCardTitle = TextEditingController(
      text: purchaseMenu?.cardTitleTemplate ?? '{{from}} a {{to}} números',
    );
    _purchaseRowTitle = TextEditingController(
      text:
          purchaseMenu?.rowTitleTemplate ??
          '{{quantity}} número(s) · {{total}}',
    );
    _purchaseRowDescription = TextEditingController(
      text: purchaseMenu?.rowDescriptionTemplate ?? '{{quantity}} × {{price}}',
    );
    _mentionAll = raffle?.announcement.mentionAll ?? true;
    final raffleMedia = raffle?.announcement.media;
    if (raffleMedia != null) _media = raffleMedia.toJson();
    final savedButtons = raffle?.announcement.buttons ?? const [];
    _buttons.addAll(
      savedButtons.map(
        (button) => _RaffleButtonDraft(
          id: button.id,
          text: button.text,
          type: button.type,
          value: button.value,
        ),
      ),
    );
    if (_buttons.isEmpty) {
      _buttons.add(
        const _RaffleButtonDraft(
          id: '!comprarrifa',
          text: 'Comprar rifa',
          type: 'quick_reply',
          value: '!comprarrifa',
        ),
      );
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _price.dispose();
    _numbersTotal.dispose();
    _winnersCount.dispose();
    _announcement.dispose();
    _finalMessage.dispose();
    _purchaseTitle.dispose();
    _purchaseDescription.dispose();
    _purchaseButtonText.dispose();
    _purchaseFooterText.dispose();
    _purchaseCardTitle.dispose();
    _purchaseRowTitle.dispose();
    _purchaseRowDescription.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 760;
    return Dialog(
      insetPadding: compact ? EdgeInsets.zero : const EdgeInsets.all(24),
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(compact ? 0 : 8),
      ),
      child: SizedBox(
        width: 1040,
        height: compact ? MediaQuery.sizeOf(context).height : 760,
        child: Column(
          children: [
            _RaffleEditorHeader(
              editing: widget.raffle != null,
              onClose: () => Navigator.of(context).pop(),
            ),
            Expanded(
              child: compact
                  ? ListView(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                      children: [
                        _buildPreview(),
                        const SizedBox(height: 18),
                        _buildSettings(),
                      ],
                    )
                  : Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SizedBox(
                          width: 400,
                          child: ColoredBox(
                            color: const Color(0xFFEFEAE2),
                            child: SingleChildScrollView(
                              padding: const EdgeInsets.all(22),
                              child: _buildPreview(),
                            ),
                          ),
                        ),
                        const VerticalDivider(width: 1),
                        Expanded(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.all(22),
                            child: _buildSettings(),
                          ),
                        ),
                      ],
                    ),
            ),
            _buildActions(),
          ],
        ),
      ),
    );
  }

  Widget _buildPreview() {
    final announcement = _announcement.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'PRÉVIA DO WHATSAPP',
          style: TextStyle(
            color: Color(0xFF667781),
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 12),
        DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(8),
            boxShadow: const [
              BoxShadow(color: Color(0x22000000), blurRadius: 4),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _media == null ? _buildEmptyMedia() : _buildMediaPreview(),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 4, 9),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        announcement.isEmpty
                            ? 'Configure a mensagem da rifa'
                            : announcement,
                        style: const TextStyle(
                          color: Color(0xFF111B21),
                          fontSize: 15,
                          height: 1.28,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: _editMessages,
                      tooltip: 'Editar mensagens',
                      icon: const Icon(Icons.edit_outlined, size: 19),
                    ),
                  ],
                ),
              ),
              for (var index = 0; index < _buttons.length; index++)
                _RafflePreviewButton(
                  button: _buttons[index],
                  onEdit: () => _editButton(index),
                  onDelete: () => setState(() => _buttons.removeAt(index)),
                ),
              if (_buttons.length < 3)
                InkWell(
                  onTap: () => _editButton(null),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 13),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.add_rounded, color: Color(0xFF008069)),
                        SizedBox(width: 6),
                        Text(
                          'Adicionar botão',
                          style: TextStyle(
                            color: Color(0xFF008069),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        const Text(
          'MENSAGEM DE RESULTADO',
          style: TextStyle(
            color: Color(0xFF667781),
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        Material(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          child: InkWell(
            onTap: _editMessages,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      _finalMessage.text.trim(),
                      maxLines: 7,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Icon(Icons.edit_outlined, size: 19),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyMedia() => InkWell(
    onTap: _uploading ? null : _pickMedia,
    child: AspectRatio(
      aspectRatio: 16 / 7,
      child: ColoredBox(
        color: const Color(0xFFE9EDEF),
        child: Center(
          child: _uploading
              ? const CircularProgressIndicator(strokeWidth: 2.5)
              : const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.add_photo_alternate_outlined,
                      size: 38,
                      color: Color(0xFF667781),
                    ),
                    SizedBox(height: 7),
                    Text(
                      'Adicionar mídia ao cabeçalho',
                      style: TextStyle(
                        color: Color(0xFF54656F),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    ),
  );

  Widget _buildMediaPreview() {
    final url = (_media?['url'] ?? '').toString();
    final image = (_media?['mediaType'] ?? 'image') == 'image';
    return Stack(
      children: [
        AspectRatio(
          aspectRatio: 16 / 10,
          child: url.isNotEmpty && image
              ? BotAdminCachedImage(
                  imageUrl: url,
                  fit: BoxFit.cover,
                  errorWidget: (_, _, _) => _raffleMediaPlaceholder(),
                )
              : _raffleMediaPlaceholder(),
        ),
        Positioned(
          top: 6,
          right: 6,
          child: Row(
            children: [
              IconButton.filledTonal(
                onPressed: _uploading ? null : _pickMedia,
                tooltip: 'Trocar mídia',
                icon: const Icon(Icons.edit_outlined, size: 19),
              ),
              const SizedBox(width: 4),
              IconButton.filledTonal(
                onPressed: () => setState(() => _media = null),
                tooltip: 'Remover mídia',
                icon: const Icon(Icons.delete_outline_rounded, size: 19),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _raffleMediaPlaceholder() => ColoredBox(
    color: const Color(0xFFE9EDEF),
    child: Center(
      child: Icon(
        (_media?['mediaType'] ?? '') == 'video'
            ? Icons.play_circle_outline_rounded
            : Icons.description_outlined,
        size: 46,
        color: const Color(0xFF667781),
      ),
    ),
  );

  Widget _buildSettings() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      TextField(
        controller: _title,
        onChanged: (_) => setState(() {}),
        decoration: InputDecoration(
          labelText: 'Título da rifa',
          prefixIcon: const Icon(Icons.confirmation_number_outlined),
          errorText: _error,
        ),
      ),
      const SizedBox(height: 10),
      TextField(
        controller: _description,
        decoration: const InputDecoration(
          labelText: 'Descrição (opcional)',
          prefixIcon: Icon(Icons.notes_rounded),
        ),
      ),
      const SizedBox(height: 10),
      LayoutBuilder(
        builder: (context, constraints) {
          final fields = [
            TextField(
              controller: _price,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Preço por número',
                prefixIcon: Icon(Icons.payments_outlined),
              ),
            ),
            TextField(
              controller: _numbersTotal,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Total de números',
                prefixIcon: Icon(Icons.grid_3x3_rounded),
              ),
            ),
            TextField(
              controller: _winnersCount,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Ganhadores',
                prefixIcon: Icon(Icons.emoji_events_outlined),
              ),
            ),
          ];
          if (constraints.maxWidth < 600) {
            return Column(
              children: [
                fields[0],
                const SizedBox(height: 10),
                fields[1],
                const SizedBox(height: 10),
                fields[2],
              ],
            );
          }
          return Row(
            children: [
              for (var index = 0; index < fields.length; index++) ...[
                Expanded(child: fields[index]),
                if (index < fields.length - 1) const SizedBox(width: 10),
              ],
            ],
          );
        },
      ),
      const Divider(height: 30),
      const _PromoterSectionTitle(
        icon: Icons.groups_2_outlined,
        title: 'Grupos da rifa',
      ),
      const SizedBox(height: 8),
      _buildGroupSelector(),
      const SizedBox(height: 10),
      SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        value: _mentionAll,
        title: const Text('Mencionar todos'),
        subtitle: const Text('Menção fantasma no anúncio e no resultado.'),
        onChanged: (value) => setState(() => _mentionAll = value),
      ),
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.edit_note_rounded, color: Color(0xFF008069)),
        title: const Text('Editar anúncio, compra e resultado'),
        subtitle: const Text(
          'Personalize o anúncio, a lista de 1 a 100 e a finalização.',
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: _editMessages,
      ),
    ],
  );

  Widget _buildGroupSelector() {
    final names = widget.groups
        .where((group) => _groupIds.contains(group.id))
        .map((group) => group.name)
        .take(2)
        .toList();
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _openGroupSelector,
        borderRadius: BorderRadius.circular(7),
        child: Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            color: const Color(0xFFF7F9FA),
            border: Border.all(color: const Color(0xFFD8DEE2)),
            borderRadius: BorderRadius.circular(7),
          ),
          child: Row(
            children: [
              const CircleAvatar(
                backgroundColor: Color(0xFFD9FDD3),
                child: Icon(Icons.groups_2_outlined, color: Color(0xFF008069)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Selecionar grupos',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    Text(
                      _groupIds.isEmpty
                          ? 'Escolha onde a rifa será válida'
                          : '${_groupIds.length} selecionado${_groupIds.length == 1 ? '' : 's'} · ${names.join(', ')}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF667781),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openGroupSelector() async {
    final initial = Set<int>.from(_groupIds);
    final search = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, refresh) {
          final query = search.text.trim().toLowerCase();
          final groups = widget.groups
              .where(
                (group) =>
                    query.isEmpty ||
                    group.name.toLowerCase().contains(query) ||
                    group.remoteJid.toLowerCase().contains(query),
              )
              .toList();
          return AlertDialog(
            title: const Text('Grupos da rifa'),
            content: SizedBox(
              width: 600,
              height: 520,
              child: Column(
                children: [
                  TextField(
                    controller: search,
                    onChanged: (_) => refresh(() {}),
                    decoration: const InputDecoration(
                      hintText: 'Pesquisar grupo',
                      prefixIcon: Icon(Icons.search_rounded),
                    ),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${_groupIds.length} selecionado${_groupIds.length == 1 ? '' : 's'}',
                        ),
                      ),
                      TextButton(
                        onPressed: () => refresh(() {
                          if (_groupIds.length == widget.groups.length) {
                            _groupIds.clear();
                          } else {
                            _groupIds.addAll(
                              widget.groups.map((group) => group.id),
                            );
                          }
                        }),
                        child: Text(
                          _groupIds.length == widget.groups.length
                              ? 'Limpar'
                              : 'Selecionar todos',
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: groups.isEmpty
                        ? const Center(child: Text('Nenhum grupo encontrado.'))
                        : ListView.builder(
                            itemCount: groups.length,
                            itemBuilder: (context, index) {
                              final group = groups[index];
                              final avatar = group.avatarUrl?.trim() ?? '';
                              return CheckboxListTile(
                                value: _groupIds.contains(group.id),
                                secondary: _MigrationCircleAvatar(
                                  url: avatar,
                                  icon: Icons.groups_2_outlined,
                                ),
                                title: Text(group.name),
                                subtitle: Text(group.remoteJid),
                                onChanged: (value) => refresh(() {
                                  if (value == true) {
                                    _groupIds.add(group.id);
                                  } else {
                                    _groupIds.remove(group.id);
                                  }
                                }),
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Cancelar'),
              ),
              FilledButton.icon(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                icon: const Icon(Icons.check_rounded),
                label: const Text('Concluir'),
              ),
            ],
          );
        },
      ),
    );
    search.dispose();
    if (accepted != true) {
      _groupIds
        ..clear()
        ..addAll(initial);
    }
    if (mounted) setState(() {});
  }

  Future<void> _editMessages() async {
    final result = await showDialog<_RaffleMessageDraft>(
      context: context,
      builder: (context) => _RaffleMessageDialog(
        announcement: _announcement.text,
        finalMessage: _finalMessage.text,
        purchaseTitle: _purchaseTitle.text,
        purchaseDescription: _purchaseDescription.text,
        purchaseButtonText: _purchaseButtonText.text,
        purchaseFooterText: _purchaseFooterText.text,
        purchaseCardTitle: _purchaseCardTitle.text,
        purchaseRowTitle: _purchaseRowTitle.text,
        purchaseRowDescription: _purchaseRowDescription.text,
      ),
    );
    if (result == null) return;
    setState(() {
      _announcement.text = result.announcement;
      _finalMessage.text = result.finalMessage;
      _purchaseTitle.text = result.purchaseTitle;
      _purchaseDescription.text = result.purchaseDescription;
      _purchaseButtonText.text = result.purchaseButtonText;
      _purchaseFooterText.text = result.purchaseFooterText;
      _purchaseCardTitle.text = result.purchaseCardTitle;
      _purchaseRowTitle.text = result.purchaseRowTitle;
      _purchaseRowDescription.text = result.purchaseRowDescription;
    });
  }

  Future<void> _editButton(int? index) async {
    final result = await showDialog<_RaffleButtonDraft>(
      context: context,
      builder: (context) =>
          _RaffleButtonDialog(initial: index == null ? null : _buttons[index]),
    );
    if (result == null) return;
    setState(() {
      if (index == null) {
        _buttons.add(result);
      } else {
        _buttons[index] = result;
      }
    });
  }

  Future<void> _pickMedia() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Mídia da rifa',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'pdf'],
        ),
      ],
    );
    if (file == null) return;
    final extension = file.name.split('.').last.toLowerCase();
    final mediaType = extension == 'mp4'
        ? 'video'
        : extension == 'pdf'
        ? 'document'
        : 'image';
    final mimeType = switch (extension) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      'mp4' => 'video/mp4',
      'pdf' => 'application/pdf',
      _ => 'application/octet-stream',
    };
    setState(() => _uploading = true);
    try {
      final media = await ref
          .read(apiClientProvider)
          .uploadRaffleMedia(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: mimeType,
            mediaType: mediaType,
            previousPath: _media?['path']?.toString(),
          );
      if (mounted) setState(() => _media = Map<String, Object?>.from(media));
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Widget _buildActions() => DecoratedBox(
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(top: BorderSide(color: Color(0xFFE3E8EB))),
    ),
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          TextButton(
            onPressed: _uploading ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancelar'),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: _uploading ? null : _submit,
            icon: const Icon(Icons.save_rounded),
            label: const Text('Salvar rifa'),
          ),
        ],
      ),
    ),
  );

  void _submit() {
    final title = _title.text.trim();
    final price = _parseMoney(_price.text);
    final numbersTotal = int.tryParse(_numbersTotal.text.trim()) ?? 0;
    final winnersCount = int.tryParse(_winnersCount.text.trim()) ?? 0;
    if (title.isEmpty || price <= 0 || numbersTotal <= 0 || winnersCount <= 0) {
      setState(() => _error = 'Preencha título, preço, números e ganhadores.');
      return;
    }
    if (_groupIds.isEmpty) {
      setState(() => _error = 'Selecione ao menos um grupo para a rifa.');
      return;
    }
    Navigator.of(context).pop(
      _RaffleDraft(
        title: title,
        description: _optionalText(_description.text),
        price: price,
        numbersTotal: numbersTotal,
        winnersCount: winnersCount,
        groupIds: _groupIds.toList(),
        announcementMessage: _optionalText(_announcement.text),
        finalMessage: _optionalText(_finalMessage.text),
        announcementMentionAll: _mentionAll,
        announcementMedia: _media,
        buttons: List.unmodifiable(_buttons),
        purchaseMenu: UserRafflePurchaseMenuSettings(
          title: _purchaseTitle.text.trim(),
          description: _purchaseDescription.text.trim(),
          buttonText: _purchaseButtonText.text.trim(),
          footerText: _purchaseFooterText.text.trim(),
          cardTitleTemplate: _purchaseCardTitle.text.trim(),
          rowTitleTemplate: _purchaseRowTitle.text.trim(),
          rowDescriptionTemplate: _purchaseRowDescription.text.trim(),
        ),
      ),
    );
  }
}

class _RaffleEditorHeader extends StatelessWidget {
  const _RaffleEditorHeader({required this.editing, required this.onClose});

  final bool editing;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(bottom: BorderSide(color: Color(0xFFE3E8EB))),
    ),
    child: Padding(
      padding: const EdgeInsets.fromLTRB(10, 8, 18, 8),
      child: Row(
        children: [
          IconButton(
            onPressed: onClose,
            tooltip: 'Fechar',
            icon: const Icon(Icons.close_rounded),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  editing ? 'Editar rifa' : 'Nova rifa',
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const Text(
                  'Anúncio, grupos, números e resultado',
                  style: TextStyle(color: Color(0xFF667781), fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class _RafflePreviewButton extends StatelessWidget {
  const _RafflePreviewButton({
    required this.button,
    required this.onEdit,
    required this.onDelete,
  });

  final _RaffleButtonDraft button;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      border: Border(top: BorderSide(color: Color(0xFFE3E8EB))),
    ),
    child: Row(
      children: [
        const SizedBox(width: 42),
        Icon(
          button.type == 'cta_copy'
              ? Icons.content_copy_rounded
              : button.type == 'cta_url'
              ? Icons.open_in_new_rounded
              : Icons.reply_rounded,
          color: const Color(0xFF008069),
          size: 17,
        ),
        const SizedBox(width: 7),
        Expanded(
          child: Text(
            button.text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF008069),
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        IconButton(
          onPressed: onEdit,
          tooltip: 'Editar botão',
          icon: const Icon(Icons.edit_outlined, size: 18),
        ),
        IconButton(
          onPressed: onDelete,
          tooltip: 'Excluir botão',
          icon: const Icon(Icons.delete_outline_rounded, size: 18),
        ),
      ],
    ),
  );
}

class _RaffleMessageDraft {
  const _RaffleMessageDraft({
    required this.announcement,
    required this.finalMessage,
    required this.purchaseTitle,
    required this.purchaseDescription,
    required this.purchaseButtonText,
    required this.purchaseFooterText,
    required this.purchaseCardTitle,
    required this.purchaseRowTitle,
    required this.purchaseRowDescription,
  });

  final String announcement;
  final String finalMessage;
  final String purchaseTitle;
  final String purchaseDescription;
  final String purchaseButtonText;
  final String purchaseFooterText;
  final String purchaseCardTitle;
  final String purchaseRowTitle;
  final String purchaseRowDescription;
}

class _RaffleMessageDialog extends StatefulWidget {
  const _RaffleMessageDialog({
    required this.announcement,
    required this.finalMessage,
    required this.purchaseTitle,
    required this.purchaseDescription,
    required this.purchaseButtonText,
    required this.purchaseFooterText,
    required this.purchaseCardTitle,
    required this.purchaseRowTitle,
    required this.purchaseRowDescription,
  });

  final String announcement;
  final String finalMessage;
  final String purchaseTitle;
  final String purchaseDescription;
  final String purchaseButtonText;
  final String purchaseFooterText;
  final String purchaseCardTitle;
  final String purchaseRowTitle;
  final String purchaseRowDescription;

  @override
  State<_RaffleMessageDialog> createState() => _RaffleMessageDialogState();
}

class _RaffleMessageDialogState extends State<_RaffleMessageDialog> {
  late final TextEditingController _announcement = TextEditingController(
    text: widget.announcement,
  );
  late final TextEditingController _finalMessage = TextEditingController(
    text: widget.finalMessage,
  );
  late final TextEditingController _purchaseTitle = TextEditingController(
    text: widget.purchaseTitle,
  );
  late final TextEditingController _purchaseDescription = TextEditingController(
    text: widget.purchaseDescription,
  );
  late final TextEditingController _purchaseButtonText = TextEditingController(
    text: widget.purchaseButtonText,
  );
  late final TextEditingController _purchaseFooterText = TextEditingController(
    text: widget.purchaseFooterText,
  );
  late final TextEditingController _purchaseCardTitle = TextEditingController(
    text: widget.purchaseCardTitle,
  );
  late final TextEditingController _purchaseRowTitle = TextEditingController(
    text: widget.purchaseRowTitle,
  );
  late final TextEditingController _purchaseRowDescription =
      TextEditingController(text: widget.purchaseRowDescription);

  @override
  void dispose() {
    _announcement.dispose();
    _finalMessage.dispose();
    _purchaseTitle.dispose();
    _purchaseDescription.dispose();
    _purchaseButtonText.dispose();
    _purchaseFooterText.dispose();
    _purchaseCardTitle.dispose();
    _purchaseRowTitle.dispose();
    _purchaseRowDescription.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Mensagens da rifa'),
    content: SizedBox(
      width: 560,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _announcement,
              minLines: 6,
              maxLines: 10,
              decoration: const InputDecoration(
                labelText: 'Anúncio',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _finalMessage,
              minLines: 5,
              maxLines: 9,
              decoration: const InputDecoration(
                labelText: 'Resultado e finalização',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 18),
            const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'LISTA DE COMPRA · 1 A 100',
                style: TextStyle(
                  color: Color(0xFF667781),
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 8),
            DecoratedBox(
              decoration: BoxDecoration(
                color: const Color(0xFFF7F9FA),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFD8DEE2)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      _purchaseTitle.text.trim().isEmpty
                          ? 'Comprar números'
                          : _purchaseTitle.text.trim(),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _purchaseDescription.text.trim(),
                      style: const TextStyle(color: Color(0xFF54656F)),
                    ),
                    const Divider(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.list_alt_rounded,
                          size: 18,
                          color: Color(0xFF008069),
                        ),
                        const SizedBox(width: 7),
                        Text(
                          _purchaseButtonText.text.trim().isEmpty
                              ? 'Escolher quantidade'
                              : _purchaseButtonText.text.trim(),
                          style: const TextStyle(
                            color: Color(0xFF008069),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _purchaseTitle,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(labelText: 'Título da lista'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _purchaseDescription,
              onChanged: (_) => setState(() {}),
              minLines: 2,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Descrição da lista',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _purchaseButtonText,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'Texto para abrir as opções',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _purchaseFooterText,
              decoration: const InputDecoration(labelText: 'Rodapé'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _purchaseCardTitle,
              decoration: const InputDecoration(
                labelText: 'Título de cada faixa',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _purchaseRowTitle,
              decoration: const InputDecoration(
                labelText: 'Título de cada quantidade',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _purchaseRowDescription,
              decoration: const InputDecoration(labelText: 'Detalhe de preço'),
            ),
            const SizedBox(height: 8),
            const Text(
              'Variáveis: {{title}}, {{price}}, {{quantity}}, {{total}}, {{from}}, {{to}}, {{numbersTotal}}, {{winnersCount}}, {{winnerList}} e {{groupName}}.',
              style: TextStyle(color: Color(0xFF667781), fontSize: 12),
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: () => Navigator.of(context).pop(
          _RaffleMessageDraft(
            announcement: _announcement.text.trim(),
            finalMessage: _finalMessage.text.trim(),
            purchaseTitle: _purchaseTitle.text.trim(),
            purchaseDescription: _purchaseDescription.text.trim(),
            purchaseButtonText: _purchaseButtonText.text.trim(),
            purchaseFooterText: _purchaseFooterText.text.trim(),
            purchaseCardTitle: _purchaseCardTitle.text.trim(),
            purchaseRowTitle: _purchaseRowTitle.text.trim(),
            purchaseRowDescription: _purchaseRowDescription.text.trim(),
          ),
        ),
        child: const Text('Aplicar'),
      ),
    ],
  );
}

class _RaffleButtonDialog extends StatefulWidget {
  const _RaffleButtonDialog({this.initial});

  final _RaffleButtonDraft? initial;

  @override
  State<_RaffleButtonDialog> createState() => _RaffleButtonDialogState();
}

class _RaffleButtonDialogState extends State<_RaffleButtonDialog> {
  late final TextEditingController _text = TextEditingController(
    text: widget.initial?.text ?? 'Comprar rifa',
  );
  late final TextEditingController _value = TextEditingController(
    text: widget.initial?.value ?? '!comprarrifa',
  );
  late String _type = widget.initial?.type ?? 'quick_reply';
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    _value.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.initial == null ? 'Adicionar botão' : 'Editar botão'),
    content: SizedBox(
      width: 480,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(
                value: 'quick_reply',
                icon: Icon(Icons.reply_rounded),
                label: Text('Comando'),
              ),
              ButtonSegment(
                value: 'cta_url',
                icon: Icon(Icons.link_rounded),
                label: Text('Link'),
              ),
              ButtonSegment(
                value: 'cta_copy',
                icon: Icon(Icons.content_copy_rounded),
                label: Text('Copiar'),
              ),
            ],
            selected: {_type},
            onSelectionChanged: (value) => setState(() {
              _type = value.first;
              _value.text = switch (_type) {
                'quick_reply' => '!comprarrifa',
                'cta_url' => 'https://',
                _ => '',
              };
            }),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _text,
            decoration: InputDecoration(
              labelText: 'Texto do botão',
              errorText: _error,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _value,
            keyboardType: _type == 'cta_url'
                ? TextInputType.url
                : TextInputType.text,
            decoration: InputDecoration(
              labelText: switch (_type) {
                'quick_reply' => 'Comando',
                'cta_url' => 'URL',
                _ => 'Conteúdo para copiar',
              },
            ),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancelar'),
      ),
      FilledButton(onPressed: _submit, child: const Text('Aplicar')),
    ],
  );

  void _submit() {
    final text = _text.text.trim();
    final value = _value.text.trim();
    if (text.isEmpty ||
        value.isEmpty ||
        (_type == 'cta_url' && !value.startsWith('http'))) {
      setState(() => _error = 'Informe um botão válido.');
      return;
    }
    Navigator.of(context).pop(
      _RaffleButtonDraft(
        id: widget.initial?.id ?? value,
        text: text,
        type: _type,
        value: value,
      ),
    );
  }
}

class _AutoPromoterDraft {
  const _AutoPromoterDraft({
    required this.name,
    required this.content,
    required this.targets,
    required this.intervalMinutes,
    required this.targetMode,
    required this.targetDelayMinMinutes,
    required this.targetDelayMaxMinutes,
    required this.prioritizeNeverSent,
    required this.enabled,
    this.description,
  });

  final String name;
  final String? description;
  final Map<String, Object?> content;
  final List<Map<String, Object?>> targets;
  final int intervalMinutes;
  final String targetMode;
  final int targetDelayMinMinutes;
  final int targetDelayMaxMinutes;
  final bool prioritizeNeverSent;
  final bool enabled;
}

class _PromoterButtonDraft {
  const _PromoterButtonDraft({
    required this.id,
    required this.text,
    required this.value,
    this.type = 'cta_url',
    this.urlSource = 'manual',
    this.groupId,
  });

  final String id;
  final String text;
  final String value;
  final String type;
  final String urlSource;
  final int? groupId;

  Map<String, Object?> toJson() => {
    'id': id,
    'text': text,
    'type': type,
    if (type == 'cta_url') ...{
      'urlSource': urlSource == 'group_invite' ? 'group_invite' : 'manual',
      if (value.trim().isNotEmpty) 'url': value,
      if (urlSource == 'group_invite' && groupId != null) 'groupId': groupId,
    },
    if (type == 'cta_copy') 'copyCode': value,
  };
}

const _initialPublicGroupCategories = <PublicGroupCategory>[
  PublicGroupCategory(name: 'Amizade', slug: 'amizade'),
  PublicGroupCategory(name: 'Amor e Romance', slug: 'amor-e-romance'),
  PublicGroupCategory(name: 'Carros e Motos', slug: 'carros-e-motos'),
  PublicGroupCategory(name: 'Cidades', slug: 'cidades'),
  PublicGroupCategory(name: 'Compra e Venda', slug: 'compra-venda'),
  PublicGroupCategory(name: 'Concursos', slug: 'concursos'),
  PublicGroupCategory(name: 'Desenhos e Animes', slug: 'desenhos-e-animes'),
  PublicGroupCategory(name: 'Divulgação', slug: 'divulgacao'),
  PublicGroupCategory(name: 'Educação', slug: 'educacao'),
  PublicGroupCategory(
    name: 'Emagrecimento e Perda de Peso',
    slug: 'emagrecimento-e-perda-de-peso',
  ),
  PublicGroupCategory(name: 'Esportes', slug: 'esportes'),
  PublicGroupCategory(name: 'Eventos', slug: 'eventos'),
  PublicGroupCategory(name: 'Fãs', slug: 'fas'),
  PublicGroupCategory(
    name: 'Figurinhas e Stickers',
    slug: 'figurinhas-e-stickers',
  ),
  PublicGroupCategory(name: 'Filmes e Séries', slug: 'filmes-e-series'),
  PublicGroupCategory(name: 'Frases e Mensagens', slug: 'frases-e-mensagens'),
  PublicGroupCategory(name: 'Futebol', slug: 'futebol'),
  PublicGroupCategory(name: 'Games e Jogos', slug: 'games-e-jogos'),
  PublicGroupCategory(name: 'Ganhar Dinheiro', slug: 'ganhar-dinheiro'),
  PublicGroupCategory(name: 'Imobiliária', slug: 'imobiliaria'),
  PublicGroupCategory(
    name: 'Investimentos e Finanças',
    slug: 'investimentos-e-financas',
  ),
  PublicGroupCategory(name: 'Links', slug: 'links'),
  PublicGroupCategory(
    name: 'Memes, Engraçados e Zoeira',
    slug: 'memes-engracados',
  ),
  PublicGroupCategory(name: 'Moda e Beleza', slug: 'moda-e-beleza'),
  PublicGroupCategory(name: 'Música', slug: 'musica'),
  PublicGroupCategory(name: 'Namoro', slug: 'namoro'),
  PublicGroupCategory(
    name: 'Negócios & Empreendedorismo',
    slug: 'negocios-e-empreendedorismo',
  ),
  PublicGroupCategory(name: 'Notícias', slug: 'noticias'),
  PublicGroupCategory(name: 'Outros', slug: 'outros'),
  PublicGroupCategory(name: 'Política', slug: 'politica'),
  PublicGroupCategory(name: 'Profissões', slug: 'profissoes'),
  PublicGroupCategory(name: 'Receitas', slug: 'receitas'),
  PublicGroupCategory(name: 'Redes Sociais', slug: 'redes-sociais'),
  PublicGroupCategory(name: 'Religião', slug: 'religiao'),
  PublicGroupCategory(name: 'Shitpost', slug: 'shitpost'),
  PublicGroupCategory(name: 'Tecnologia', slug: 'tecnologia'),
  PublicGroupCategory(name: 'TV', slug: 'tv-televisao'),
  PublicGroupCategory(name: 'Vagas de Empregos', slug: 'vagas-de-empregos'),
  PublicGroupCategory(name: 'Viagem e Turismo', slug: 'viagem-e-turismo'),
  PublicGroupCategory(name: 'Vídeos', slug: 'videos'),
];

String? _absoluteCampaignMediaUrl(String? value) {
  final raw = value?.trim();
  if (raw == null || raw.isEmpty) return null;
  if (raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('data:') ||
      raw.startsWith('blob:')) {
    return raw;
  }
  final base = AppConfig.apiBaseUrl.replaceFirst(RegExp(r'/+$'), '');
  final path = raw.startsWith('/') ? raw : '/$raw';
  return '$base$path';
}

class _AutoPromoterEditor extends ConsumerStatefulWidget {
  const _AutoPromoterEditor({
    required this.groups,
    required this.instances,
    this.campaign,
  });

  final BotAdCampaignSummary? campaign;
  final List<BotGroup> groups;
  final List<BotInstance> instances;

  @override
  ConsumerState<_AutoPromoterEditor> createState() =>
      _AutoPromoterEditorState();
}

class _AutoPromoterEditorState extends ConsumerState<_AutoPromoterEditor> {
  late final TextEditingController _name;
  late final TextEditingController _description;
  late final TextEditingController _message;
  late final TextEditingController _footer;
  late final TextEditingController _interval;
  late final TextEditingController _targetDelayMin;
  late final TextEditingController _targetDelayMax;
  late final TextEditingController _inviteLinks;
  late final TextEditingController _currentGroupSearch;
  late final TextEditingController _publicGroupSearch;
  final Set<int> _targetGroupIds = <int>{};
  final List<_PromoterButtonDraft> _buttons = [];
  final Map<String, PublicGroupInviteInspection> _inviteInspections = {};
  final Map<String, String> _inviteValidationErrors = {};
  List<PublicGroupCategory> _publicCategories = _initialPublicGroupCategories;
  List<PublicGroupCandidate> _publicGroups = const [];
  Map<String, dynamic>? _media;
  int? _externalInstanceId;
  String _targetMode = 'selected';
  String _selectedPublicCategory = 'divulgacao';
  bool _enabled = true;
  bool _mentionAll = true;
  bool _excludeAdmins = true;
  bool _prioritizeNeverSent = true;
  bool _uploading = false;
  bool _loadingPublicGroups = false;
  bool _publicDiscoveryQueued = false;
  bool _validatingInvites = false;
  String? _publicGroupError;
  String? _error;

  List<BotInstance> get _connectedInstances => widget.instances
      .where((instance) => instance.isConnected)
      .toList(growable: false);

  List<BotGroup> get _eligibleGroups {
    final connectedIds = _connectedInstances.map((item) => item.id).toSet();
    return widget.groups
        .where(
          (group) =>
              group.remoteJid.trim().isNotEmpty &&
              (group.instanceId == null ||
                  connectedIds.contains(group.instanceId)),
        )
        .toList(growable: false);
  }

  @override
  void initState() {
    super.initState();
    final campaign = widget.campaign;
    final content = campaign?.contents.isNotEmpty == true
        ? campaign!.contents.first
        : const <String, dynamic>{};
    final schedule = campaign?.schedule ?? const <String, dynamic>{};
    final groupDispatch = campaign?.options['groupDispatch'] is Map
        ? Map<String, dynamic>.from(campaign!.options['groupDispatch'] as Map)
        : const <String, dynamic>{};
    _name = TextEditingController(text: campaign?.name ?? 'Nova divulgação');
    _description = TextEditingController(text: campaign?.description ?? '');
    _message = TextEditingController(
      text: (content['body'] ?? content['text'] ?? content['caption'] ?? '')
          .toString(),
    );
    _footer = TextEditingController(text: (content['footer'] ?? '').toString());
    _interval = TextEditingController(
      text: (schedule['everyMinutes'] ?? 60).toString(),
    );
    _targetDelayMin = TextEditingController(
      text: (groupDispatch['targetDelayMinMinutes'] ?? 5).toString(),
    );
    _targetDelayMax = TextEditingController(
      text: (groupDispatch['targetDelayMaxMinutes'] ?? 10).toString(),
    );
    _inviteLinks = TextEditingController();
    _currentGroupSearch = TextEditingController();
    _publicGroupSearch = TextEditingController();
    _enabled = campaign?.active ?? true;
    _targetMode = groupDispatch['targetMode'] == 'all_open'
        ? 'all_open'
        : 'selected';
    _prioritizeNeverSent = groupDispatch['prioritizeNeverSent'] != false;
    final media = content['headerMedia'] ?? content['media'];
    if (media is Map) _media = Map<String, dynamic>.from(media);
    final rawButtons = content['ctaButtons'];
    if (rawButtons is List) {
      for (final raw in rawButtons.whereType<Map>()) {
        final button = Map<String, dynamic>.from(raw);
        final type = (button['type'] ?? 'cta_url').toString();
        _buttons.add(
          _PromoterButtonDraft(
            id: (button['id'] ?? 'button-${_buttons.length + 1}').toString(),
            text: (button['text'] ?? 'Abrir link').toString(),
            type: type,
            urlSource: button['urlSource'] == 'group_invite'
                ? 'group_invite'
                : 'manual',
            groupId: _intValue(button['groupId']),
            value:
                (type == 'cta_copy' ? button['copyCode'] : button['url'])
                    ?.toString() ??
                '',
          ),
        );
      }
    }
    final externalLinks = <String>[];
    for (final target in campaign?.targets ?? const <Map<String, dynamic>>[]) {
      final groupId = _intValue(target['groupId']);
      if (groupId != null) _targetGroupIds.add(groupId);
      final invite = (target['inviteLink'] ?? '').toString().trim();
      if (groupId == null && invite.isNotEmpty) externalLinks.add(invite);
      _externalInstanceId ??= _intValue(target['instanceId']);
      _mentionAll = target['mentionAll'] != false;
      _excludeAdmins = target['excludeAdmins'] != false;
    }
    _inviteLinks.text = externalLinks.join('\n');
    _externalInstanceId ??= _connectedInstances.isNotEmpty
        ? _connectedInstances.first.id
        : null;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _publicGroups.isEmpty) {
        unawaited(_discoverPublicGroups());
      }
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _message.dispose();
    _footer.dispose();
    _interval.dispose();
    _targetDelayMin.dispose();
    _targetDelayMax.dispose();
    _inviteLinks.dispose();
    _currentGroupSearch.dispose();
    _publicGroupSearch.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 760;
    final body = compact
        ? ListView(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
            children: [
              _buildPreview(),
              const SizedBox(height: 18),
              _buildSettings(),
            ],
          )
        : Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: 400,
                child: ColoredBox(
                  color: const Color(0xFFEFEAE2),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(22),
                    child: _buildPreview(),
                  ),
                ),
              ),
              const VerticalDivider(width: 1),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(22),
                  child: _buildSettings(),
                ),
              ),
            ],
          );
    return Dialog(
      insetPadding: compact ? EdgeInsets.zero : const EdgeInsets.all(24),
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(compact ? 0 : 8),
      ),
      child: SizedBox(
        width: 1040,
        height: compact ? MediaQuery.sizeOf(context).height : 760,
        child: Column(
          children: [
            _PromoterEditorHeader(
              editing: widget.campaign != null,
              onClose: () => Navigator.of(context).pop(),
            ),
            Expanded(child: body),
            _buildActions(),
          ],
        ),
      ),
    );
  }

  Widget _buildPreview() {
    final message = _message.text.trim();
    final footer = _footer.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'PRÉVIA DO WHATSAPP',
          style: TextStyle(
            color: Color(0xFF667781),
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 12),
        DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(8),
            boxShadow: const [
              BoxShadow(color: Color(0x22000000), blurRadius: 4),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_media != null)
                _buildMediaPreview()
              else
                _buildEmptyMediaHeader(),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 6, 9),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        message.isEmpty
                            ? 'Digite a mensagem do anúncio'
                            : message,
                        style: TextStyle(
                          color: message.isEmpty
                              ? const Color(0xFF8696A0)
                              : const Color(0xFF111B21),
                          fontSize: 15,
                          height: 1.28,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: _editMessage,
                      tooltip: 'Editar mensagem',
                      icon: const Icon(Icons.edit_outlined, size: 19),
                    ),
                  ],
                ),
              ),
              if (footer.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 9),
                  child: Text(
                    footer,
                    style: const TextStyle(
                      color: Color(0xFF667781),
                      fontSize: 12,
                    ),
                  ),
                ),
              for (var index = 0; index < _buttons.length; index++)
                _PromoterPreviewButton(
                  button: _buttons[index],
                  onEdit: () => _editButton(index),
                  onDelete: () => setState(() => _buttons.removeAt(index)),
                ),
              if (_buttons.length < 3)
                InkWell(
                  onTap: () => _editButton(null),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 13),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.add_rounded,
                          color: Color(0xFF008069),
                          size: 19,
                        ),
                        SizedBox(width: 6),
                        Text(
                          'Adicionar botão',
                          style: TextStyle(
                            color: Color(0xFF008069),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyMediaHeader() => InkWell(
    onTap: _uploading ? null : _pickMedia,
    borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
    child: AspectRatio(
      aspectRatio: 16 / 7,
      child: ColoredBox(
        color: const Color(0xFFE9EDEF),
        child: Center(
          child: _uploading
              ? const SizedBox.square(
                  dimension: 24,
                  child: CircularProgressIndicator(strokeWidth: 2.5),
                )
              : const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.add_photo_alternate_outlined,
                      size: 38,
                      color: Color(0xFF667781),
                    ),
                    SizedBox(height: 7),
                    Text(
                      'Adicionar mídia',
                      style: TextStyle(
                        color: Color(0xFF54656F),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    ),
  );

  Widget _buildMediaPreview() {
    final url = _absoluteCampaignMediaUrl(
      (_media?['url'] ?? _media?['path'])?.toString(),
    );
    final isImage = (_media?['mediaType'] ?? 'image').toString() == 'image';
    return Stack(
      children: [
        AspectRatio(
          aspectRatio: 16 / 10,
          child: ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
            child: url != null && isImage
                ? BotAdminCachedImage(
                    imageUrl: url,
                    fit: BoxFit.cover,
                    errorWidget: (context, url, error) => _mediaPlaceholder(),
                  )
                : url != null
                ? LayoutBuilder(
                    builder: (context, constraints) => InlineVideoPlayer(
                      url: url,
                      width: constraints.maxWidth,
                      height: constraints.maxHeight,
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(8),
                      ),
                      mimeType: _media?['mimeType']?.toString(),
                      autoplayLoopMuted: true,
                    ),
                  )
                : _mediaPlaceholder(),
          ),
        ),
        Positioned(
          top: 6,
          right: 6,
          child: Row(
            children: [
              IconButton.filledTonal(
                onPressed: _uploading ? null : _pickMedia,
                tooltip: 'Trocar mídia',
                icon: const Icon(Icons.edit_outlined, size: 19),
              ),
              const SizedBox(width: 4),
              IconButton.filledTonal(
                onPressed: () => setState(() => _media = null),
                tooltip: 'Remover mídia',
                icon: const Icon(Icons.delete_outline_rounded, size: 19),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _mediaPlaceholder() => ColoredBox(
    color: const Color(0xFFE9EDEF),
    child: Center(
      child: Icon(
        (_media?['mediaType'] ?? '').toString() == 'video'
            ? Icons.play_circle_outline_rounded
            : Icons.image_outlined,
        size: 46,
        color: const Color(0xFF667781),
      ),
    ),
  );

  Widget _buildTargetSelectorCard(List<BotGroup> eligibleGroups) {
    final selectedCurrent = eligibleGroups
        .where((group) => _targetGroupIds.contains(group.id))
        .length;
    final publicCount = _parsedInviteLinks().length;
    final parts = <String>[
      if (selectedCurrent > 0) '$selectedCurrent do robô',
      if (publicCount > 0) '$publicCount público${publicCount == 1 ? '' : 's'}',
    ];
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _openTargetSelector,
        borderRadius: BorderRadius.circular(7),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: BoxDecoration(
            color: const Color(0xFFF7F9FA),
            border: Border.all(color: const Color(0xFFD8DEE2)),
            borderRadius: BorderRadius.circular(7),
          ),
          child: Row(
            children: [
              const CircleAvatar(
                radius: 21,
                backgroundColor: Color(0xFFD9FDD3),
                child: Icon(Icons.groups_2_outlined, color: Color(0xFF008069)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Selecionar grupos-alvo',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      parts.isEmpty
                          ? 'Grupos do robô, públicos ou links manuais'
                          : parts.join(' · '),
                      style: const TextStyle(
                        color: Color(0xFF667781),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: Color(0xFF54656F)),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openTargetSelector() async {
    final initialMode = _targetMode;
    final initialGroupIds = Set<int>.from(_targetGroupIds);
    final initialInviteLinks = _inviteLinks.text;
    final initialInstanceId = _externalInstanceId;
    var source = 'current';

    final accepted = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, refreshDialog) {
          final size = MediaQuery.sizeOf(context);
          final compact = size.width < 680;
          final query = _currentGroupSearch.text.trim().toLowerCase();
          final filteredGroups = _eligibleGroups
              .where(
                (group) =>
                    query.isEmpty ||
                    group.name.toLowerCase().contains(query) ||
                    group.remoteJid.toLowerCase().contains(query),
              )
              .toList(growable: false);
          final allCurrentSelected =
              _eligibleGroups.isNotEmpty &&
              _eligibleGroups.every(
                (group) => _targetGroupIds.contains(group.id),
              );

          void update(VoidCallback callback) {
            callback();
            refreshDialog(() {});
          }

          return Dialog(
            insetPadding: compact ? EdgeInsets.zero : const EdgeInsets.all(24),
            clipBehavior: Clip.antiAlias,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(compact ? 0 : 8),
            ),
            child: SizedBox(
              width: 780,
              height: compact
                  ? size.height
                  : (size.height - 48).clamp(560.0, 760.0).toDouble(),
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 10, 18, 10),
                    child: Row(
                      children: [
                        IconButton(
                          onPressed: () =>
                              Navigator.of(dialogContext).pop(false),
                          tooltip: 'Fechar',
                          icon: const Icon(Icons.close_rounded),
                        ),
                        const SizedBox(width: 4),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Selecionar grupos-alvo',
                                style: TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Text(
                                'Escolha onde esta divulgação será enviada.',
                                style: TextStyle(
                                  color: Color(0xFF667781),
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
                    child: SizedBox(
                      width: double.infinity,
                      child: SegmentedButton<String>(
                        segments: const [
                          ButtonSegment<String>(
                            value: 'current',
                            icon: Icon(Icons.smart_toy_outlined),
                            label: Text('Grupos do robô'),
                          ),
                          ButtonSegment<String>(
                            value: 'public',
                            icon: Icon(Icons.public_rounded),
                            label: Text('Grupos públicos'),
                          ),
                        ],
                        selected: {source},
                        onSelectionChanged: (selection) {
                          final selected = selection.first;
                          update(() => source = selected);
                          if (selected == 'public' && _publicGroups.isEmpty) {
                            unawaited(
                              _discoverPublicGroups(
                                refreshDialog: () => refreshDialog(() {}),
                              ),
                            );
                          }
                        },
                      ),
                    ),
                  ),
                  Expanded(
                    child: source == 'current'
                        ? Padding(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                            child: Column(
                              children: [
                                TextField(
                                  controller: _currentGroupSearch,
                                  onChanged: (_) => refreshDialog(() {}),
                                  decoration: const InputDecoration(
                                    hintText: 'Pesquisar nos grupos do robô',
                                    prefixIcon: Icon(Icons.search_rounded),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        '${_targetGroupIds.length} selecionado${_targetGroupIds.length == 1 ? '' : 's'}',
                                        style: const TextStyle(
                                          color: Color(0xFF667781),
                                          fontSize: 13,
                                        ),
                                      ),
                                    ),
                                    TextButton.icon(
                                      onPressed: _eligibleGroups.isEmpty
                                          ? null
                                          : () => update(() {
                                              if (allCurrentSelected) {
                                                _targetGroupIds.clear();
                                              } else {
                                                _targetGroupIds.addAll(
                                                  _eligibleGroups.map(
                                                    (group) => group.id,
                                                  ),
                                                );
                                              }
                                            }),
                                      icon: Icon(
                                        allCurrentSelected
                                            ? Icons.deselect_rounded
                                            : Icons.select_all_rounded,
                                      ),
                                      label: Text(
                                        allCurrentSelected
                                            ? 'Limpar seleção'
                                            : 'Selecionar todos',
                                      ),
                                    ),
                                  ],
                                ),
                                const Divider(height: 1),
                                Expanded(
                                  child: filteredGroups.isEmpty
                                      ? const Center(
                                          child: Text(
                                            'Nenhum grupo encontrado.',
                                            style: TextStyle(
                                              color: Color(0xFF667781),
                                            ),
                                          ),
                                        )
                                      : ListView.builder(
                                          itemCount: filteredGroups.length,
                                          itemBuilder: (context, index) {
                                            final group = filteredGroups[index];
                                            final selected = _targetGroupIds
                                                .contains(group.id);
                                            return CheckboxListTile(
                                              dense: true,
                                              value: selected,
                                              title: Text(
                                                group.name,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                              subtitle: Text(
                                                group.remoteJid,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                              onChanged: (value) => update(() {
                                                if (value == true) {
                                                  _targetGroupIds.add(group.id);
                                                } else {
                                                  _targetGroupIds.remove(
                                                    group.id,
                                                  );
                                                }
                                              }),
                                            );
                                          },
                                        ),
                                ),
                              ],
                            ),
                          )
                        : SingleChildScrollView(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
                            child: _buildPublicGroupDiscovery(
                              refreshDialog: () => refreshDialog(() {}),
                            ),
                          ),
                  ),
                  DecoratedBox(
                    decoration: const BoxDecoration(
                      border: Border(top: BorderSide(color: Color(0xFFE3E8EB))),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: () =>
                                Navigator.of(dialogContext).pop(false),
                            child: const Text('Cancelar'),
                          ),
                          const SizedBox(width: 8),
                          FilledButton.icon(
                            onPressed: _validatingInvites
                                ? null
                                : () => Navigator.of(dialogContext).pop(true),
                            icon: const Icon(Icons.check_rounded),
                            label: const Text('Concluir seleção'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );

    if (accepted != true) {
      _targetMode = initialMode;
      _targetGroupIds
        ..clear()
        ..addAll(initialGroupIds);
      _inviteLinks.text = initialInviteLinks;
      _externalInstanceId = initialInstanceId;
    }
    if (mounted) setState(() {});
  }

  Widget _buildPublicGroupDiscovery({VoidCallback? refreshDialog}) {
    final selectedCategory =
        _publicCategories.any((item) => item.slug == _selectedPublicCategory)
        ? _selectedPublicCategory
        : null;
    final selectedLinks = _parsedInviteLinks().toSet();
    final resolvedPublicGroups = _publicGroups
        .where((group) => group.hasInvite)
        .toList(growable: false);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F9FA),
        border: Border.all(color: const Color(0xFFD8DEE2)),
        borderRadius: BorderRadius.circular(7),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.language_rounded, color: Color(0xFF008069)),
              SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Pesquisa de grupos públicos',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    Text(
                      'Fonte: gruposwhats.app',
                      style: TextStyle(color: Color(0xFF667781), fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: _targetMode == 'all_open',
            title: const Text('Todos os grupos abertos'),
            subtitle: const Text(
              'Inclui automaticamente os convites abertos encontrados nesta pesquisa.',
            ),
            onChanged: (value) {
              setState(() {
                _targetMode = value ? 'all_open' : 'selected';
                if (value) {
                  _appendInviteLinks(
                    resolvedPublicGroups.map((group) => group.inviteLink!),
                  );
                }
              });
              refreshDialog?.call();
            },
          ),
          const SizedBox(height: 10),
          LayoutBuilder(
            builder: (context, constraints) {
              final compact = constraints.maxWidth < 560;
              final search = TextField(
                controller: _publicGroupSearch,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) =>
                    _discoverPublicGroups(refreshDialog: refreshDialog),
                decoration: const InputDecoration(
                  labelText: 'Pesquisar no gruposwhats.app',
                  prefixIcon: Icon(Icons.search_rounded),
                ),
              );
              final category = DropdownButtonFormField<String>(
                initialValue: selectedCategory,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Categoria'),
                hint: const Text('Divulgação'),
                items: _publicCategories
                    .map(
                      (item) => DropdownMenuItem<String>(
                        value: item.slug,
                        child: Text(item.name, overflow: TextOverflow.ellipsis),
                      ),
                    )
                    .toList(growable: false),
                onChanged: (value) {
                  if (value == null) return;
                  setState(() => _selectedPublicCategory = value);
                  refreshDialog?.call();
                  _discoverPublicGroups(refreshDialog: refreshDialog);
                },
              );
              if (compact) {
                return Column(
                  children: [search, const SizedBox(height: 10), category],
                );
              }
              return Row(
                children: [
                  Expanded(flex: 3, child: search),
                  const SizedBox(width: 10),
                  Expanded(flex: 2, child: category),
                ],
              );
            },
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.tonalIcon(
              onPressed: _loadingPublicGroups
                  ? null
                  : () => _discoverPublicGroups(refreshDialog: refreshDialog),
              icon: _loadingPublicGroups
                  ? const SizedBox.square(
                      dimension: 17,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.manage_search_rounded),
              label: const Text('Buscar'),
            ),
          ),
          if (_publicGroupError != null) ...[
            const SizedBox(height: 8),
            Text(
              _publicGroupError!,
              style: const TextStyle(color: Color(0xFFB42318), fontSize: 13),
            ),
          ],
          if (_publicGroups.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              '${selectedLinks.length} convite${selectedLinks.length == 1 ? '' : 's'} selecionado${selectedLinks.length == 1 ? '' : 's'}',
              style: const TextStyle(color: Color(0xFF667781), fontSize: 13),
            ),
            const SizedBox(height: 6),
            SizedBox(
              height: 250,
              child: ListView.separated(
                itemCount: _publicGroups.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final group = _publicGroups[index];
                  final imageUrl = group.imageUrl?.trim() ?? '';
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 2),
                    leading: _MigrationCircleAvatar(
                      url: imageUrl,
                      radius: 22,
                      backgroundColor: const Color(0xFFE9EDEF),
                      icon: Icons.groups_2_outlined,
                    ),
                    title: Text(
                      group.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      [
                        if (group.category?.trim().isNotEmpty == true)
                          group.category!.trim(),
                        if (group.description?.trim().isNotEmpty == true)
                          group.description!.trim(),
                      ].join(' · '),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: group.hasInvite
                        ? Checkbox(
                            value: selectedLinks.contains(group.inviteLink),
                            onChanged: (_) => _togglePublicGroup(
                              group,
                              refreshDialog: refreshDialog,
                            ),
                          )
                        : IconButton(
                            onPressed: () => _usePublicGroup(
                              group,
                              refreshDialog: refreshDialog,
                            ),
                            tooltip: 'Abrir no gruposwhats.app',
                            icon: const Icon(
                              Icons.open_in_new_rounded,
                              color: Color(0xFF008069),
                            ),
                          ),
                  );
                },
              ),
            ),
          ],
          const Divider(height: 28),
          const Text(
            'Perfil e links manuais',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<int>(
            initialValue: _externalInstanceId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Perfil responsável'),
            items: _connectedInstances
                .map(
                  (instance) => DropdownMenuItem<int>(
                    value: instance.id,
                    child: Text(instance.name, overflow: TextOverflow.ellipsis),
                  ),
                )
                .toList(),
            onChanged: (value) {
              setState(() => _externalInstanceId = value);
              refreshDialog?.call();
            },
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _inviteLinks,
            minLines: 2,
            maxLines: 5,
            onChanged: (_) {
              setState(() {
                _targetMode = 'selected';
                _inviteInspections.clear();
                _inviteValidationErrors.clear();
              });
              refreshDialog?.call();
            },
            decoration: const InputDecoration(
              labelText: 'Links dos grupos',
              hintText: 'https://chat.whatsapp.com/...',
              helperText: 'Um convite por linha.',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              onPressed: _validatingInvites
                  ? null
                  : () => _validateInviteLinks(refreshDialog: refreshDialog),
              icon: _validatingInvites
                  ? const SizedBox.square(
                      dimension: 17,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.fact_check_outlined),
              label: const Text('Validar convites'),
            ),
          ),
          if (_inviteInspections.isNotEmpty ||
              _inviteValidationErrors.isNotEmpty) ...[
            const SizedBox(height: 8),
            _buildInviteValidationResults(),
          ],
        ],
      ),
    );
  }

  Widget _buildInviteValidationResults() {
    final links = _parsedInviteLinks();
    return Column(
      children: links
          .map((link) {
            final inspection = _inviteInspections[link];
            final error = _inviteValidationErrors[link];
            final valid = inspection?.canPublish == true;
            final label =
                error ??
                (inspection == null
                    ? 'Ainda não validado'
                    : inspection.adminsOnly
                    ? 'Somente administradores podem enviar'
                    : inspection.joinApprovalRequired
                    ? 'Exige aprovação para entrar'
                    : inspection.groupJid == null
                    ? 'Grupo não identificado'
                    : 'Aberto para divulgação');
            final groupName = inspection?.groupName?.trim();
            return ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                valid
                    ? Icons.check_circle_rounded
                    : Icons.error_outline_rounded,
                color: valid
                    ? const Color(0xFF008069)
                    : const Color(0xFFB42318),
              ),
              title: Text(
                groupName?.isNotEmpty == true ? groupName! : link,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                [
                  label,
                  if (inspection?.memberCount != null)
                    '${inspection!.memberCount} membros',
                ].join(' · '),
              ),
            );
          })
          .toList(growable: false),
    );
  }

  Widget _buildSettings() {
    final eligibleGroups = _eligibleGroups;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _name,
          decoration: InputDecoration(
            labelText: 'Nome da divulgação',
            errorText: _error,
            prefixIcon: const Icon(Icons.outbox_outlined),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _description,
          decoration: const InputDecoration(
            labelText: 'Descrição interna (opcional)',
            prefixIcon: Icon(Icons.notes_outlined),
          ),
        ),
        const SizedBox(height: 20),
        const _PromoterSectionTitle(
          icon: Icons.send_outlined,
          title: 'Grupos de destino',
        ),
        const SizedBox(height: 8),
        _buildTargetSelectorCard(eligibleGroups),
        const Divider(height: 30),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          value: _mentionAll,
          title: const Text('Mencionar todos'),
          subtitle: const Text('Menção fantasma aos participantes no envio.'),
          onChanged: (value) => setState(() {
            _mentionAll = value;
            if (!value) _excludeAdmins = false;
          }),
        ),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          value: _mentionAll && _excludeAdmins,
          title: const Text('Não mencionar administradores'),
          subtitle: const Text('Remove os admins da lista de menções.'),
          onChanged: !_mentionAll
              ? null
              : (value) => setState(() => _excludeAdmins = value),
        ),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _interval,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'Intervalo entre ciclos',
                  suffixText: 'minutos',
                  prefixIcon: Icon(Icons.schedule_outlined),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                value: _enabled,
                title: const Text('Ativa'),
                subtitle: const Text('Executar automaticamente'),
                onChanged: (value) => setState(() => _enabled = value),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final fields = [
              TextField(
                controller: _targetDelayMin,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'Espera mínima entre grupos',
                  suffixText: 'min',
                  prefixIcon: Icon(Icons.timer_outlined),
                ),
              ),
              TextField(
                controller: _targetDelayMax,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                  labelText: 'Espera máxima entre grupos',
                  suffixText: 'min',
                  prefixIcon: Icon(Icons.timelapse_rounded),
                ),
              ),
            ];
            if (constraints.maxWidth < 560) {
              return Column(
                children: [
                  fields.first,
                  const SizedBox(height: 10),
                  fields.last,
                ],
              );
            }
            return Row(
              children: [
                Expanded(child: fields.first),
                const SizedBox(width: 12),
                Expanded(child: fields.last),
              ],
            );
          },
        ),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          value: _prioritizeNeverSent,
          title: const Text('Priorizar grupos ainda não atendidos'),
          subtitle: const Text(
            'Antes de repetir, envia primeiro aos destinos sem divulgação bem-sucedida.',
          ),
          onChanged: (value) => setState(() => _prioritizeNeverSent = value),
        ),
        const SizedBox(height: 8),
        const _PromoterSafetyNote(),
      ],
    );
  }

  Widget _buildActions() {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFE3E8EB))),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(
              onPressed: _uploading || _validatingInvites
                  ? null
                  : () => Navigator.of(context).pop(),
              child: const Text('Cancelar'),
            ),
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed: _uploading || _validatingInvites ? null : _submit,
              icon: _validatingInvites
                  ? const SizedBox.square(
                      dimension: 17,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined),
              label: const Text('Salvar divulgação'),
            ),
          ],
        ),
      ),
    );
  }

  List<String> _parsedInviteLinks() => _inviteLinks.text
      .split(RegExp(r'[\r\n]+'))
      .map((item) => item.trim())
      .where((item) => item.isNotEmpty)
      .toSet()
      .toList();

  void _appendInviteLinks(Iterable<String> inviteLinks) {
    final links = _parsedInviteLinks();
    for (final invite in inviteLinks) {
      final normalized = invite.trim();
      if (normalized.isNotEmpty && !links.contains(normalized)) {
        links.add(normalized);
      }
    }
    _inviteLinks.text = links.join('\n');
    _inviteInspections.clear();
    _inviteValidationErrors.clear();
  }

  void _togglePublicGroup(
    PublicGroupCandidate group, {
    VoidCallback? refreshDialog,
  }) {
    final invite = group.inviteLink?.trim() ?? '';
    if (invite.isEmpty) return;
    final links = _parsedInviteLinks();
    setState(() {
      _targetMode = 'selected';
      if (links.contains(invite)) {
        links.remove(invite);
      } else {
        links.add(invite);
      }
      _inviteLinks.text = links.join('\n');
      _inviteInspections.clear();
      _inviteValidationErrors.clear();
    });
    refreshDialog?.call();
  }

  Future<void> _discoverPublicGroups({VoidCallback? refreshDialog}) async {
    if (_loadingPublicGroups) {
      _publicDiscoveryQueued = true;
      return;
    }
    _publicDiscoveryQueued = false;
    setState(() {
      _loadingPublicGroups = true;
      _publicGroupError = null;
    });
    refreshDialog?.call();
    try {
      final result = await ref
          .read(apiClientProvider)
          .discoverPublicGroups(
            query: _publicGroupSearch.text,
            category: _selectedPublicCategory,
          );
      if (!mounted) return;
      setState(() {
        _publicCategories = result.categories;
        _publicGroups = result.groups;
        if (_publicCategories.isNotEmpty &&
            !_publicCategories.any(
              (item) => item.slug == _selectedPublicCategory,
            )) {
          _selectedPublicCategory = _publicCategories.first.slug;
        }
        if (_publicGroups.isEmpty) {
          _publicGroupError = 'Nenhum grupo encontrado nesta busca.';
        }
        if (_targetMode == 'all_open') {
          _appendInviteLinks(
            _publicGroups
                .where((group) => group.hasInvite)
                .map((group) => group.inviteLink!),
          );
        }
      });
      refreshDialog?.call();
    } catch (error) {
      if (!mounted) return;
      setState(() => _publicGroupError = error.toString());
      refreshDialog?.call();
    } finally {
      if (mounted) setState(() => _loadingPublicGroups = false);
      refreshDialog?.call();
      if (mounted && _publicDiscoveryQueued) {
        _publicDiscoveryQueued = false;
        unawaited(_discoverPublicGroups(refreshDialog: refreshDialog));
      }
    }
  }

  Future<void> _usePublicGroup(
    PublicGroupCandidate group, {
    VoidCallback? refreshDialog,
  }) async {
    final invite = group.inviteLink?.trim() ?? '';
    if (invite.isNotEmpty) {
      setState(() {
        _targetMode = 'selected';
        _appendInviteLinks([invite]);
      });
      refreshDialog?.call();
      return;
    }
    final detailUrl = group.detailUrl?.trim() ?? '';
    if (detailUrl.isEmpty) return;
    await _openUrl(detailUrl);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Copie o convite do WhatsApp na página aberta e cole no campo abaixo.',
        ),
      ),
    );
  }

  Future<void> _validateInviteLinks({VoidCallback? refreshDialog}) async {
    await _inspectInviteLinks(showResult: true, refreshDialog: refreshDialog);
  }

  Future<bool> _inspectInviteLinks({
    required bool showResult,
    VoidCallback? refreshDialog,
  }) async {
    final links = _parsedInviteLinks();
    if (links.isEmpty) {
      setState(() => _error = 'Cole ao menos um convite do WhatsApp.');
      return false;
    }
    final instanceId = _externalInstanceId;
    if (instanceId == null) {
      setState(() => _error = 'Selecione o perfil que validará os convites.');
      return false;
    }
    setState(() {
      _validatingInvites = true;
      _error = null;
      _inviteInspections.clear();
      _inviteValidationErrors.clear();
    });
    refreshDialog?.call();
    final inspections = <String, PublicGroupInviteInspection>{};
    final errors = <String, String>{};
    for (final link in links) {
      if (!RegExp(
        r'^https?://chat\.whatsapp\.com/[A-Za-z0-9_-]+',
        caseSensitive: false,
      ).hasMatch(link)) {
        errors[link] = 'Use o convite real chat.whatsapp.com.';
        continue;
      }
      try {
        inspections[link] = await ref
            .read(apiClientProvider)
            .inspectPublicGroupInvite(instanceId: instanceId, inviteLink: link);
      } catch (error) {
        errors[link] = error.toString();
      }
    }
    if (!mounted) return false;
    setState(() {
      _inviteInspections.addAll(inspections);
      _inviteValidationErrors.addAll(errors);
      _validatingInvites = false;
    });
    refreshDialog?.call();
    final valid =
        errors.isEmpty &&
        links.every((link) => inspections[link]?.canPublish == true);
    if (showResult) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            valid
                ? 'Todos os convites estão abertos para divulgação.'
                : 'Há convites inválidos, fechados ou que exigem aprovação.',
          ),
        ),
      );
    }
    return valid;
  }

  Future<void> _editMessage() async {
    final result = await showDialog<_PromoterTextDraft>(
      context: context,
      builder: (context) =>
          _PromoterTextDialog(message: _message.text, footer: _footer.text),
    );
    if (result == null) return;
    setState(() {
      _message.text = result.message;
      _footer.text = result.footer;
    });
  }

  Future<void> _editButton(int? index) async {
    final result = await showDialog<_PromoterButtonDraft>(
      context: context,
      builder: (context) => _PromoterButtonDialog(
        initial: index == null ? null : _buttons[index],
        groups: _eligibleGroups,
      ),
    );
    if (result == null) return;
    setState(() {
      if (index == null) {
        _buttons.add(result);
      } else {
        _buttons[index] = result;
      }
    });
  }

  Future<void> _pickMedia() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem ou vídeo',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4'],
        ),
      ],
    );
    if (file == null) return;
    final extension = file.name.split('.').last.toLowerCase();
    final mediaType = extension == 'mp4' ? 'video' : 'image';
    final mimeType = switch (extension) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      'mp4' => 'video/mp4',
      _ => 'application/octet-stream',
    };
    setState(() => _uploading = true);
    try {
      final media = await ref
          .read(apiClientProvider)
          .uploadBotAdCampaignMedia(
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: mimeType,
            mediaType: mediaType,
            previousPath: _media?['path']?.toString(),
          );
      if (mounted) setState(() => _media = media);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final message = _message.text.trim();
    final interval = int.tryParse(_interval.text.trim()) ?? 0;
    final targetDelayMin = int.tryParse(_targetDelayMin.text.trim()) ?? 0;
    final targetDelayMax = int.tryParse(_targetDelayMax.text.trim()) ?? 0;
    final inviteLinks = _parsedInviteLinks();
    if (name.isEmpty || message.isEmpty) {
      setState(() => _error = 'Informe o nome e a mensagem da divulgação.');
      return;
    }
    if (interval < 15) {
      setState(() => _error = 'Use ao menos 15 minutos entre os ciclos.');
      return;
    }
    if (targetDelayMin < 1 || targetDelayMax < targetDelayMin) {
      setState(
        () => _error =
            'A espera entre grupos deve ser de ao menos 1 minuto e o máximo não pode ser menor que o mínimo.',
      );
      return;
    }
    final eligibleGroups = _eligibleGroups;
    if (_targetGroupIds.isEmpty && inviteLinks.isEmpty) {
      setState(() => _error = 'Selecione ao menos um grupo de destino.');
      return;
    }
    if (inviteLinks.isNotEmpty && _externalInstanceId == null) {
      setState(() => _error = 'Selecione o perfil dos links externos.');
      return;
    }
    if (inviteLinks.isNotEmpty &&
        !await _inspectInviteLinks(showResult: false)) {
      if (mounted) {
        setState(
          () => _error =
              'Revise os convites: todos precisam estar abertos e validados.',
        );
      }
      return;
    }
    if (!mounted) return;
    final contentId =
        widget.campaign?.contents.firstOrNull?['id']?.toString() ??
        DateTime.now().microsecondsSinceEpoch.toString();
    final content = <String, Object?>{
      'id': contentId,
      if (_buttons.isNotEmpty) ...{
        'type': 'buttons',
        'style': 'cta',
        'body': message,
        'footer': _optionalText(_footer.text),
        'ctaButtons': _buttons.map((button) => button.toJson()).toList(),
        if (_media != null) 'headerMedia': _media,
      } else if (_media != null) ...{
        'type': (_media?['mediaType'] ?? 'image').toString(),
        'caption': message,
        'media': _media,
      } else ...{
        'type': 'text',
        'text': message,
      },
      'mentionAll': _mentionAll,
    };
    final connectedFallback = _connectedInstances.firstOrNull?.id;
    final targets = <Map<String, Object?>>[];
    for (final group in eligibleGroups) {
      if (!_targetGroupIds.contains(group.id)) {
        continue;
      }
      final instanceId = group.instanceId ?? connectedFallback;
      if (instanceId == null) continue;
      targets.add({
        'type': 'group',
        'instanceId': instanceId,
        'groupId': group.id,
        'remoteId': group.remoteJid,
        'mentionAll': _mentionAll,
        'excludeAdmins': _mentionAll && _excludeAdmins,
        'audience': {
          'title': group.name,
          'description': group.description,
          'imageUrl': group.avatarUrl,
        },
      });
    }
    for (final invite in inviteLinks) {
      final inspection = _inviteInspections[invite];
      targets.add({
        'type': 'group',
        'instanceId': _externalInstanceId!,
        'inviteLink': invite,
        'mentionAll': _mentionAll,
        'excludeAdmins': _mentionAll && _excludeAdmins,
        'audience': {
          'title': inspection?.groupName ?? 'Grupo por convite',
          'description': inspection?.memberCount == null
              ? null
              : '${inspection!.memberCount} membros',
        },
      });
    }
    if (targets.isEmpty) {
      setState(
        () =>
            _error = 'Os grupos selecionados não possuem um perfil conectado.',
      );
      return;
    }
    Navigator.of(context).pop(
      _AutoPromoterDraft(
        name: name,
        description: _optionalText(_description.text),
        content: content,
        targets: targets,
        intervalMinutes: interval,
        targetMode: _targetMode,
        targetDelayMinMinutes: targetDelayMin,
        targetDelayMaxMinutes: targetDelayMax,
        prioritizeNeverSent: _prioritizeNeverSent,
        enabled: _enabled,
      ),
    );
  }
}

class _PromoterEditorHeader extends StatelessWidget {
  const _PromoterEditorHeader({required this.editing, required this.onClose});

  final bool editing;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(bottom: BorderSide(color: Color(0xFFE3E8EB))),
    ),
    child: Padding(
      padding: const EdgeInsets.fromLTRB(10, 8, 18, 8),
      child: Row(
        children: [
          IconButton(
            onPressed: onClose,
            tooltip: 'Fechar',
            icon: const Icon(Icons.close_rounded),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  editing ? 'Editar divulgação' : 'Nova divulgação',
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const Text(
                  'Anúncio, destinos e intervalo',
                  style: TextStyle(color: Color(0xFF667781), fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class _PromoterSectionTitle extends StatelessWidget {
  const _PromoterSectionTitle({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 21, color: const Color(0xFF008069)),
      const SizedBox(width: 8),
      Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
    ],
  );
}

class _PromoterPreviewButton extends StatelessWidget {
  const _PromoterPreviewButton({
    required this.button,
    required this.onEdit,
    required this.onDelete,
  });

  final _PromoterButtonDraft button;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      border: Border(top: BorderSide(color: Color(0xFFE3E8EB))),
    ),
    child: Row(
      children: [
        const SizedBox(width: 42),
        Icon(
          button.type == 'cta_copy'
              ? Icons.content_copy_rounded
              : Icons.open_in_new_rounded,
          color: const Color(0xFF008069),
          size: 17,
        ),
        const SizedBox(width: 7),
        Expanded(
          child: Text(
            button.text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF008069),
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        IconButton(
          onPressed: onEdit,
          tooltip: 'Editar botão',
          icon: const Icon(Icons.edit_outlined, size: 18),
        ),
        IconButton(
          onPressed: onDelete,
          tooltip: 'Excluir botão',
          icon: const Icon(Icons.delete_outline_rounded, size: 18),
        ),
      ],
    ),
  );
}

class _PromoterSafetyNote extends StatelessWidget {
  const _PromoterSafetyNote();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFFEAF7F2),
      borderRadius: BorderRadius.circular(7),
      border: Border.all(color: const Color(0xFFB7E1D2)),
    ),
    child: const Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.verified_user_outlined, color: Color(0xFF008069)),
        SizedBox(width: 9),
        Expanded(
          child: Text(
            'Antes de cada envio o sistema confirma conexão, entrada no grupo, grupo aberto e permissão para publicar.',
          ),
        ),
      ],
    ),
  );
}

class _PromoterTextDraft {
  const _PromoterTextDraft({required this.message, required this.footer});

  final String message;
  final String footer;
}

class _PromoterTextDialog extends StatefulWidget {
  const _PromoterTextDialog({required this.message, required this.footer});

  final String message;
  final String footer;

  @override
  State<_PromoterTextDialog> createState() => _PromoterTextDialogState();
}

class _PromoterTextDialogState extends State<_PromoterTextDialog> {
  late final TextEditingController _message = TextEditingController(
    text: widget.message,
  );
  late final TextEditingController _footer = TextEditingController(
    text: widget.footer,
  );

  @override
  void dispose() {
    _message.dispose();
    _footer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Texto do anúncio'),
    content: SizedBox(
      width: 520,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _message,
            autofocus: true,
            minLines: 5,
            maxLines: 10,
            decoration: const InputDecoration(
              labelText: 'Mensagem',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _footer,
            decoration: const InputDecoration(labelText: 'Rodapé (opcional)'),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: () => Navigator.of(context).pop(
          _PromoterTextDraft(
            message: _message.text.trim(),
            footer: _footer.text.trim(),
          ),
        ),
        child: const Text('Aplicar'),
      ),
    ],
  );
}

class _PromoterButtonDialog extends StatefulWidget {
  const _PromoterButtonDialog({required this.groups, this.initial});

  final _PromoterButtonDraft? initial;
  final List<BotGroup> groups;

  @override
  State<_PromoterButtonDialog> createState() => _PromoterButtonDialogState();
}

class _PromoterButtonDialogState extends State<_PromoterButtonDialog> {
  late final TextEditingController _text = TextEditingController(
    text: widget.initial?.text ?? 'Entrar no grupo',
  );
  late final TextEditingController _value = TextEditingController(
    text: widget.initial?.value ?? '',
  );
  late String _type = widget.initial?.type ?? 'cta_url';
  late String _urlSource = widget.initial?.urlSource == 'group_invite'
      ? 'group_invite'
      : 'manual';
  late int? _groupId = widget.initial?.groupId;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    _value.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.initial == null ? 'Adicionar botão' : 'Editar botão'),
    content: SizedBox(
      width: 460,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(
                value: 'cta_url',
                icon: Icon(Icons.link_rounded),
                label: Text('Link'),
              ),
              ButtonSegment(
                value: 'cta_copy',
                icon: Icon(Icons.content_copy_rounded),
                label: Text('Copiar'),
              ),
            ],
            selected: {_type},
            onSelectionChanged: (value) => setState(() => _type = value.first),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _text,
            decoration: InputDecoration(
              labelText: 'Texto do botão',
              errorText: _error,
            ),
          ),
          const SizedBox(height: 12),
          if (_type == 'cta_url') ...[
            Align(
              alignment: Alignment.centerLeft,
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ChoiceChip(
                    avatar: const Icon(Icons.link_rounded, size: 18),
                    label: const Text('Link manual'),
                    selected: _urlSource == 'manual',
                    onSelected: (_) => setState(() {
                      _urlSource = 'manual';
                      _error = null;
                    }),
                  ),
                  ChoiceChip(
                    avatar: const Icon(Icons.groups_2_outlined, size: 18),
                    label: const Text('Link atualizado do grupo'),
                    selected: _urlSource == 'group_invite',
                    onSelected: (_) => setState(() {
                      _urlSource = 'group_invite';
                      _groupId ??= widget.groups.firstOrNull?.id;
                      _error = null;
                    }),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            if (_urlSource == 'group_invite')
              DropdownButtonFormField<int>(
                initialValue: widget.groups.any((group) => group.id == _groupId)
                    ? _groupId
                    : null,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Grupo divulgado pelo botão',
                  helperText:
                      'O convite será atualizado pela API em cada envio.',
                ),
                items: widget.groups
                    .map(
                      (group) => DropdownMenuItem<int>(
                        value: group.id,
                        child: Text(
                          group.name,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                    .toList(growable: false),
                onChanged: (value) => setState(() {
                  _groupId = value;
                  _error = null;
                }),
              )
            else
              TextField(
                controller: _value,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: 'URL',
                  hintText: 'https://...',
                ),
              ),
          ] else
            TextField(
              controller: _value,
              keyboardType: TextInputType.text,
              decoration: const InputDecoration(
                labelText: 'Conteúdo para copiar',
              ),
            ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancelar'),
      ),
      FilledButton(onPressed: _submit, child: const Text('Aplicar')),
    ],
  );

  void _submit() {
    final text = _text.text.trim();
    final value = _value.text.trim();
    final dynamicGroup = _type == 'cta_url' && _urlSource == 'group_invite';
    final invalidManualUrl =
        _type == 'cta_url' && !dynamicGroup && !value.startsWith('http');
    if (text.isEmpty ||
        (!dynamicGroup && value.isEmpty) ||
        invalidManualUrl ||
        (dynamicGroup && _groupId == null)) {
      setState(() => _error = 'Informe um botão válido.');
      return;
    }
    Navigator.of(context).pop(
      _PromoterButtonDraft(
        id:
            widget.initial?.id ??
            'cta-${DateTime.now().microsecondsSinceEpoch}',
        text: text,
        value: value,
        type: _type,
        urlSource: dynamicGroup ? 'group_invite' : 'manual',
        groupId: dynamicGroup ? _groupId : null,
      ),
    );
  }
}

int? _intValue(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '');
}

class _AffiliateCredentialsDraft {
  const _AffiliateCredentialsDraft({
    required this.provider,
    required this.accountName,
    this.appId,
    this.clientSecret,
    this.appToken,
  });

  final String provider;
  final String accountName;
  final String? appId;
  final String? clientSecret;
  final String? appToken;
}

class _AffiliateCredentialsDialog extends StatefulWidget {
  const _AffiliateCredentialsDialog({this.provider});

  final AffiliateProviderSummary? provider;

  @override
  State<_AffiliateCredentialsDialog> createState() =>
      _AffiliateCredentialsDialogState();
}

class _AffiliateCredentialsDialogState
    extends State<_AffiliateCredentialsDialog> {
  late String _provider;
  late final TextEditingController _accountName;
  final _appId = TextEditingController();
  final _clientSecret = TextEditingController();
  final _appToken = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    _provider = widget.provider?.provider == 'mercadolivre'
        ? 'mercadolivre'
        : 'shopee';
    _accountName = TextEditingController(
      text: widget.provider?.accountName ?? widget.provider?.label ?? '',
    );
  }

  @override
  void dispose() {
    _accountName.dispose();
    _appId.dispose();
    _clientSecret.dispose();
    _appToken.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Conta afiliada'),
      content: SizedBox(
        width: 540,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: _provider,
                decoration: const InputDecoration(
                  labelText: 'Provedor',
                  prefixIcon: Icon(Icons.storefront_outlined),
                ),
                items: const [
                  DropdownMenuItem(value: 'shopee', child: Text('Shopee')),
                  DropdownMenuItem(
                    value: 'mercadolivre',
                    child: Text('Mercado Livre'),
                  ),
                ],
                onChanged: widget.provider == null
                    ? (value) => setState(() => _provider = value ?? 'shopee')
                    : null,
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _accountName,
                decoration: InputDecoration(
                  labelText: 'Nome da conta',
                  prefixIcon: const Icon(Icons.badge_outlined),
                  errorText: _error,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _appId,
                decoration: const InputDecoration(
                  labelText: 'App ID',
                  prefixIcon: Icon(Icons.key_outlined),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _clientSecret,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Client secret',
                  prefixIcon: Icon(Icons.lock_outline_rounded),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _appToken,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'App token',
                  prefixIcon: Icon(Icons.password_outlined),
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }

  void _submit() {
    final accountName = _accountName.text.trim();
    if (accountName.isEmpty) {
      setState(() => _error = 'Informe o nome da conta.');
      return;
    }
    Navigator.of(context).pop(
      _AffiliateCredentialsDraft(
        provider: _provider,
        accountName: accountName,
        appId: _optionalText(_appId.text),
        clientSecret: _optionalText(_clientSecret.text),
        appToken: _optionalText(_appToken.text),
      ),
    );
  }
}

class _AffiliateLinkDraft {
  const _AffiliateLinkDraft({
    required this.provider,
    required this.affiliateUrl,
    this.note,
    this.title,
    this.productUrl,
    this.imageUrl,
    this.isActive,
  });

  final String provider;
  final String affiliateUrl;
  final String? note;
  final String? title;
  final String? productUrl;
  final String? imageUrl;
  final bool? isActive;

  Map<String, Object?> toUpdatePayload() {
    return {
      'affiliateUrl': affiliateUrl,
      'note': note,
      'title': title,
      'productUrl': productUrl,
      'imageUrl': imageUrl,
      if (isActive != null) 'isActive': isActive,
    };
  }
}

class _AffiliateLinkDialog extends StatefulWidget {
  const _AffiliateLinkDialog({this.link});

  final AffiliateProductLink? link;

  @override
  State<_AffiliateLinkDialog> createState() => _AffiliateLinkDialogState();
}

class _AffiliateLinkDialogState extends State<_AffiliateLinkDialog> {
  late String _provider;
  late final TextEditingController _affiliateUrl;
  late final TextEditingController _note;
  late final TextEditingController _title;
  late final TextEditingController _productUrl;
  late final TextEditingController _imageUrl;
  late bool _active;
  String? _error;

  @override
  void initState() {
    super.initState();
    final link = widget.link;
    _provider = link?.provider == 'mercadolivre' ? 'mercadolivre' : 'shopee';
    _affiliateUrl = TextEditingController(text: link?.affiliateUrl ?? '');
    _note = TextEditingController(text: link?.note ?? '');
    _title = TextEditingController(text: link?.title ?? '');
    _productUrl = TextEditingController(text: link?.productUrl ?? '');
    _imageUrl = TextEditingController(text: link?.imageUrl ?? '');
    _active = link?.isActive ?? true;
  }

  @override
  void dispose() {
    _affiliateUrl.dispose();
    _note.dispose();
    _title.dispose();
    _productUrl.dispose();
    _imageUrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.link == null ? 'Novo produto' : 'Editar produto'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: _provider,
                decoration: const InputDecoration(
                  labelText: 'Provedor',
                  prefixIcon: Icon(Icons.storefront_outlined),
                ),
                items: const [
                  DropdownMenuItem(value: 'shopee', child: Text('Shopee')),
                  DropdownMenuItem(
                    value: 'mercadolivre',
                    child: Text('Mercado Livre'),
                  ),
                ],
                onChanged: widget.link == null
                    ? (value) => setState(() => _provider = value ?? 'shopee')
                    : null,
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _affiliateUrl,
                decoration: InputDecoration(
                  labelText: 'URL afiliada',
                  prefixIcon: const Icon(Icons.link_rounded),
                  errorText: _error,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _note,
                decoration: const InputDecoration(
                  labelText: 'Nota interna',
                  prefixIcon: Icon(Icons.notes_rounded),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _title,
                decoration: const InputDecoration(
                  labelText: 'Título',
                  prefixIcon: Icon(Icons.sell_outlined),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _productUrl,
                decoration: const InputDecoration(
                  labelText: 'URL do produto',
                  prefixIcon: Icon(Icons.open_in_new_rounded),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _imageUrl,
                decoration: const InputDecoration(
                  labelText: 'URL da imagem',
                  prefixIcon: Icon(Icons.image_outlined),
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Produto ativo'),
                value: _active,
                onChanged: (value) => setState(() => _active = value),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }

  void _submit() {
    final url = _affiliateUrl.text.trim();
    if (url.isEmpty) {
      setState(() => _error = 'Informe a URL afiliada.');
      return;
    }
    Navigator.of(context).pop(
      _AffiliateLinkDraft(
        provider: _provider,
        affiliateUrl: url,
        note: _optionalText(_note.text),
        title: _optionalText(_title.text),
        productUrl: _optionalText(_productUrl.text),
        imageUrl: _optionalText(_imageUrl.text),
        isActive: _active,
      ),
    );
  }
}

class _WebhookSettingsDraft {
  const _WebhookSettingsDraft({
    required this.verifyToken,
    this.appId,
    this.businessAccountId,
    this.phoneNumberId,
    this.accessToken,
  });

  final String verifyToken;
  final String? appId;
  final String? businessAccountId;
  final String? phoneNumberId;
  final String? accessToken;
}

class _WebhookSettingsDialog extends StatefulWidget {
  const _WebhookSettingsDialog({this.settings});

  final MetaWebhookSettings? settings;

  @override
  State<_WebhookSettingsDialog> createState() => _WebhookSettingsDialogState();
}

class _WebhookSettingsDialogState extends State<_WebhookSettingsDialog> {
  late final TextEditingController _verifyToken;
  late final TextEditingController _appId;
  late final TextEditingController _businessAccountId;
  late final TextEditingController _phoneNumberId;
  final _accessToken = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    final settings = widget.settings;
    _verifyToken = TextEditingController(text: settings?.verifyToken ?? '');
    _appId = TextEditingController(text: settings?.appId ?? '');
    _businessAccountId = TextEditingController(
      text: settings?.businessAccountId ?? '',
    );
    _phoneNumberId = TextEditingController(text: settings?.phoneNumberId ?? '');
  }

  @override
  void dispose() {
    _verifyToken.dispose();
    _appId.dispose();
    _businessAccountId.dispose();
    _phoneNumberId.dispose();
    _accessToken.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Configurar Meta webhook'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _verifyToken,
                decoration: InputDecoration(
                  labelText: 'Verify token',
                  prefixIcon: const Icon(Icons.verified_user_outlined),
                  errorText: _error,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _appId,
                decoration: const InputDecoration(
                  labelText: 'App ID',
                  prefixIcon: Icon(Icons.apps_rounded),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _businessAccountId,
                decoration: const InputDecoration(
                  labelText: 'Business Account ID',
                  prefixIcon: Icon(Icons.business_center_outlined),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _phoneNumberId,
                decoration: const InputDecoration(
                  labelText: 'Phone Number ID',
                  prefixIcon: Icon(Icons.phone_android_outlined),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _accessToken,
                obscureText: true,
                decoration: InputDecoration(
                  labelText: 'Access token',
                  helperText: widget.settings?.accessTokenPresent == true
                      ? 'Deixe vazio para manter o token atual.'
                      : null,
                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }

  void _submit() {
    final verifyToken = _verifyToken.text.trim();
    if (verifyToken.isEmpty) {
      setState(() => _error = 'Informe o verify token.');
      return;
    }
    Navigator.of(context).pop(
      _WebhookSettingsDraft(
        verifyToken: verifyToken,
        appId: _optionalText(_appId.text),
        businessAccountId: _optionalText(_businessAccountId.text),
        phoneNumberId: _optionalText(_phoneNumberId.text),
        accessToken: _optionalText(_accessToken.text),
      ),
    );
  }
}

class _CreateFlowDialog extends StatefulWidget {
  const _CreateFlowDialog();

  @override
  State<_CreateFlowDialog> createState() => _CreateFlowDialogState();
}

class _CreateFlowDialogState extends State<_CreateFlowDialog> {
  final _name = TextEditingController();
  final _command = TextEditingController();
  final _text = TextEditingController(text: 'Olá! Como posso ajudar?');
  String _scope = 'both';

  @override
  void dispose() {
    _name.dispose();
    _command.dispose();
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Novo fluxo rápido'),
      content: SizedBox(
        width: 520,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _name,
              decoration: InputDecoration(
                labelText: 'Nome',
                prefixIcon: Icon(Icons.edit_note_rounded),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _command,
              decoration: InputDecoration(
                labelText: 'Comando',
                helperText: 'Ex: menu ou !menu',
                prefixIcon: Icon(Icons.terminal_rounded),
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _scope,
              decoration: InputDecoration(
                labelText: 'Onde roda',
                prefixIcon: Icon(Icons.route_rounded),
              ),
              items: const [
                DropdownMenuItem(value: 'both', child: Text('Grupo e privado')),
                DropdownMenuItem(value: 'group', child: Text('Somente grupos')),
                DropdownMenuItem(value: 'private', child: Text('Somente PV')),
              ],
              onChanged: (value) => setState(() => _scope = value ?? 'both'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _text,
              minLines: 3,
              maxLines: 6,
              decoration: InputDecoration(
                labelText: 'Mensagem de resposta',
                alignLabelWithHint: true,
                prefixIcon: Icon(Icons.chat_bubble_outline_rounded),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.save_rounded),
          label: const Text('Criar'),
        ),
      ],
    );
  }

  void _submit() {
    final command = _command.text.trim();
    if (command.isEmpty) return;
    Navigator.of(context).pop(
      _FlowDraft(
        name: _name.text.trim().isEmpty ? 'Fluxo $command' : _name.text.trim(),
        command: command,
        scope: _scope,
        text: _text.text.trim().isEmpty
            ? 'Olá! Como posso ajudar?'
            : _text.text.trim(),
      ),
    );
  }
}

class _FlowDraft {
  const _FlowDraft({
    required this.name,
    required this.command,
    required this.scope,
    required this.text,
  });

  final String name;
  final String command;
  final String scope;
  final String text;
}

class _StorageOverview extends ConsumerStatefulWidget {
  const _StorageOverview({required this.snapshot});

  final MediaStorageSnapshot snapshot;

  @override
  ConsumerState<_StorageOverview> createState() => _StorageOverviewState();
}

class _StorageOverviewState extends ConsumerState<_StorageOverview> {
  String _provider = 'mercadopago_pix';
  int? _busyPlanId;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final snapshot = widget.snapshot;
    final plans = snapshot.plans.where((plan) => plan.id > 0).toList()
      ..sort((a, b) => a.price.compareTo(b.price));
    return _PanelCard(
      title: 'Storage de mídia',
      subtitle: snapshot.adminExempt
          ? 'Conta admin liberada.'
          : snapshot.storage.hasActivePlan
          ? 'Pacote de armazenamento ativo.'
          : 'Contrate storage para cache persistente de mídias.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _MetricsRow(
            metrics: [
              _Metric('Usado', _formatBytes(snapshot.storage.usedBytes)),
              _Metric('Cota', _formatBytes(snapshot.storage.quotaBytes)),
              _Metric('Livre', _formatBytes(snapshot.storage.remainingBytes)),
              _Metric('Planos', snapshot.plans.length.toString()),
            ],
          ),
          const SizedBox(height: 12),
          LinearProgressIndicator(value: snapshot.storage.usageRatio),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _provider,
            items: const [
              DropdownMenuItem(
                value: 'mercadopago_pix',
                child: Text('Mercado Pago Pix'),
              ),
              DropdownMenuItem(
                value: 'polopag_pix',
                child: Text('PoloPag Pix'),
              ),
              DropdownMenuItem(
                value: 'mercadopago_checkout',
                child: Text('Mercado Pago checkout'),
              ),
            ],
            onChanged: _busyPlanId == null
                ? (value) =>
                      setState(() => _provider = value ?? 'mercadopago_pix')
                : null,
            decoration: const InputDecoration(
              labelText: 'Pagamento do storage',
              prefixIcon: Icon(Icons.payments_outlined),
              filled: true,
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!, style: const TextStyle(color: Color(0xFFB42318))),
          ],
          const SizedBox(height: 16),
          _ListOrEmpty(
            isEmpty: plans.isEmpty,
            emptyText: 'Nenhum plano de storage cadastrado.',
            children: plans
                .map(
                  (plan) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _MediaStoragePlanTile(
                      plan: plan,
                      busy: _busyPlanId == plan.id,
                      onCheckout: () => _createStorageCheckout(plan),
                    ),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }

  Future<void> _createStorageCheckout(MediaStoragePlan plan) async {
    if (_busyPlanId != null) return;
    setState(() {
      _busyPlanId = plan.id;
      _error = null;
    });
    try {
      final checkout = await ref
          .read(apiClientProvider)
          .createMediaStorageCheckout(planId: plan.id, provider: _provider);
      if (!mounted) return;
      if (checkout == null) {
        ref.invalidate(mediaStorageProvider);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Storage liberado para esta conta.')),
        );
        return;
      }
      await showDialog<void>(
        context: context,
        builder: (context) =>
            _MediaStorageCheckoutDialog(plan: plan, checkout: checkout),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busyPlanId = null);
    }
  }
}

class _MediaStoragePlanTile extends StatelessWidget {
  const _MediaStoragePlanTile({
    required this.plan,
    required this.busy,
    required this.onCheckout,
  });

  final MediaStoragePlan plan;
  final bool busy;
  final VoidCallback onCheckout;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final quota = plan.quotaGb.toStringAsFixed(
      plan.quotaGb.truncateToDouble() == plan.quotaGb ? 0 : 1,
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.panelElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: wa.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 560;
            final content = Row(
              children: [
                CircleAvatar(
                  backgroundColor: wa.accentSoft,
                  foregroundColor: wa.accent,
                  child: const Icon(Icons.cloud_done_outlined),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        plan.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontWeight: FontWeight.w900,
                          fontSize: 15.5,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$quota GB persistente · ${_formatMoney(plan.price)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: wa.textMuted, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              ],
            );
            final action = FilledButton.icon(
              onPressed: busy ? null : onCheckout,
              icon: busy
                  ? const SizedBox(
                      width: 15,
                      height: 15,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.pix_rounded, size: 18),
              label: const Text('Comprar storage'),
            );
            if (compact) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [content, const SizedBox(height: 10), action],
              );
            }
            return Row(
              children: [
                Expanded(child: content),
                const SizedBox(width: 12),
                action,
              ],
            );
          },
        ),
      ),
    );
  }
}

class _MediaStorageCheckoutDialog extends StatelessWidget {
  const _MediaStorageCheckoutDialog({
    required this.plan,
    required this.checkout,
  });

  final MediaStoragePlan plan;
  final PlanCheckout checkout;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final qrBytes = _decodeQrCode(checkout.qrCodeBase64);
    return AlertDialog(
      backgroundColor: wa.panel,
      title: Text(
        'Pagamento do storage',
        style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w800),
      ),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${plan.name} · ${_formatMoney(checkout.amount > 0 ? checkout.amount : plan.price)}',
                style: TextStyle(
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Depois do pagamento o storage persistente é liberado automaticamente.',
                style: TextStyle(color: wa.textMuted, height: 1.35),
              ),
              if (checkout.expiresAt != null) ...[
                const SizedBox(height: 6),
                Text(
                  'Expira em ${_formatDateTime(checkout.expiresAt!)}',
                  style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                ),
              ],
              if (qrBytes != null) ...[
                const SizedBox(height: 16),
                Center(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: ColoredBox(
                      color: Colors.white,
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Image.memory(
                          qrBytes,
                          width: 210,
                          height: 210,
                          fit: BoxFit.contain,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
              if ((checkout.qrCode ?? '').trim().isNotEmpty) ...[
                const SizedBox(height: 14),
                TextField(
                  readOnly: true,
                  minLines: 3,
                  maxLines: 5,
                  controller: TextEditingController(text: checkout.qrCode),
                  decoration: const InputDecoration(
                    labelText: 'Pix copia e cola',
                    filled: true,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).maybePop(),
          child: const Text('Fechar'),
        ),
        if ((checkout.ticketUrl ?? '').trim().isNotEmpty)
          OutlinedButton.icon(
            onPressed: () => _openUrl(checkout.ticketUrl!),
            icon: const Icon(Icons.open_in_new_rounded, size: 18),
            label: const Text('Abrir link'),
          ),
        if ((checkout.qrCode ?? '').trim().isNotEmpty)
          FilledButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: checkout.qrCode!));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Código Pix copiado.')),
              );
            },
            icon: const Icon(Icons.copy_rounded, size: 18),
            label: const Text('Copiar Pix'),
          ),
      ],
    );
  }
}

class _ModuleSurface extends StatelessWidget {
  const _ModuleSurface({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.child,
    this.onRefresh,
    this.actions = const [],
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Widget child;
  final VoidCallback? onRefresh;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Column(
      children: [
        Material(
          color: wa.headerBg,
          child: Container(
            height: 72,
            padding: const EdgeInsets.symmetric(horizontal: 18),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: wa.divider)),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: wa.accentSoft,
                  child: Icon(icon, color: wa.accent),
                ),
                SizedBox(width: 14),
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
                          fontWeight: FontWeight.w800,
                          color: wa.textPrimary,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 13, color: wa.textMuted),
                      ),
                    ],
                  ),
                ),
                ...actions,
                IconButton(
                  onPressed: onRefresh,
                  icon: Icon(Icons.refresh_rounded, color: wa.icon),
                  tooltip: 'Atualizar',
                ),
              ],
            ),
          ),
        ),
        Expanded(
          child: ColoredBox(color: wa.contentBg, child: child),
        ),
      ],
    );
  }
}

class _PanelCard extends StatelessWidget {
  const _PanelCard({required this.title, required this.child, this.subtitle});

  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.panel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: wa.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
                color: wa.textPrimary,
              ),
            ),
            if (subtitle != null) ...[
              SizedBox(height: 4),
              Text(subtitle!, style: TextStyle(color: wa.textMuted)),
            ],
            SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }
}

class _MetricsRow extends StatelessWidget {
  const _MetricsRow({required this.metrics});

  final List<_Metric> metrics;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 900 ? 4 : 2;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: metrics.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            mainAxisExtent: 82,
          ),
          itemBuilder: (context, index) {
            final metric = metrics[index];
            return DecoratedBox(
              decoration: BoxDecoration(
                color: wa.searchBg,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      metric.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: wa.textMuted, fontSize: 12),
                    ),
                    SizedBox(height: 6),
                    Text(
                      metric.value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: wa.textPrimary,
                        fontWeight: FontWeight.w900,
                        fontSize: 18,
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _Metric {
  const _Metric(this.label, this.value);

  final String label;
  final String value;
}

class _ListOrEmpty extends StatelessWidget {
  const _ListOrEmpty({
    required this.isEmpty,
    required this.emptyText,
    required this.children,
  });

  final bool isEmpty;
  final String emptyText;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (isEmpty) return _EmptyMessage(emptyText);
    return Column(children: children);
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.active,
    this.selected = false,
    this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool active;
  final bool selected;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final bg = active
        ? (wa.isDark ? const Color(0xFF0A332C) : const Color(0xFFE9FCEF))
        : (wa.isDark ? const Color(0xFF3A1F22) : const Color(0xFFFFEBEE));
    final border = selected
        ? wa.accent
        : active
        ? const Color(0xFF1DAA61)
        : const Color(0xFFE57373);
    final iconColor = active ? wa.accent : const Color(0xFFE57373);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: border),
        ),
        child: ListTile(
          onTap: onTap,
          selected: selected,
          leading: Icon(icon, color: iconColor),
          title: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: wa.textPrimary,
            ),
          ),
          subtitle: Text(
            subtitle,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: wa.textMuted),
          ),
          trailing: trailing,
        ),
      ),
    );
  }
}

class _EmptyMessage extends StatelessWidget {
  const _EmptyMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.searchBg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
        child: Row(
          children: [
            Icon(Icons.info_outline_rounded, color: wa.icon),
            const SizedBox(width: 10),
            Expanded(
              child: Text(message, style: TextStyle(color: wa.textMuted)),
            ),
          ],
        ),
      ),
    );
  }
}

class _LoadingBlock extends StatelessWidget {
  const _LoadingBlock({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(compact ? 18 : 42),
        child: const CircularProgressIndicator(),
      ),
    );
  }
}

class _ErrorBlock extends StatelessWidget {
  const _ErrorBlock({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}

String _callTitle(WhatsappCallRecord call) {
  final name = call.displayName?.trim();
  if (name != null && name.isNotEmpty && !_looksLikeCallTechnicalId(name)) {
    return name;
  }
  final phoneFromPayload = _digitsOnly(call.phone ?? '');
  if (_isDisplayableCallPhone(phoneFromPayload)) return '+$phoneFromPayload';
  final raw = call.chatJid.trim();
  if (raw.isEmpty) {
    final creator = call.callCreatorJid?.trim() ?? '';
    final creatorPhone = _digitsOnly(creator);
    if (!_looksLikeCallLid(creator) && _isDisplayableCallPhone(creatorPhone)) {
      return '+$creatorPhone';
    }
    return 'Chamada';
  }
  final withoutDevice = raw.split(':').first;
  final phone = _digitsOnly(withoutDevice.split('@').first);
  if (!_looksLikeCallLid(withoutDevice) && _isDisplayableCallPhone(phone)) {
    return '+$phone';
  }
  final fallback = withoutDevice.isEmpty ? raw : withoutDevice;
  return _looksLikeCallLid(fallback) ||
          _looksLikeCallNumericTechnicalId(fallback) ||
          _looksLikeCallTechnicalId(fallback)
      ? 'Chamada'
      : fallback;
}

String _callPhoneLabel(WhatsappCallRecord call) {
  final direct = _digitsOnly(call.phone ?? '');
  if (_isDisplayableCallPhone(direct)) return '+$direct';
  final candidates = [call.chatJid, call.callCreatorJid ?? ''];
  for (final candidate in candidates) {
    final raw = candidate.split(':').first.split('@').first;
    final digits = _digitsOnly(raw);
    if (!_looksLikeCallLid(raw) && _isDisplayableCallPhone(digits)) {
      return '+$digits';
    }
  }
  return '';
}

String? _absoluteCallAvatarUrl(String? value) {
  final raw = value?.trim() ?? '';
  if (raw.isEmpty) return null;
  if (raw.startsWith('https://pps.whatsapp.net/')) {
    return '${AppConfig.apiBaseUrl}/api/whatsapp-avatar-proxy?url=${Uri.encodeComponent(raw)}';
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return '${AppConfig.apiBaseUrl}/${raw.replaceFirst(RegExp(r'^/+'), '')}';
}

bool _looksLikeCallLid(String value) {
  final text = value.trim().toLowerCase();
  return text.contains('@lid') || text.endsWith('.lid') || text == 'lid';
}

bool _isDisplayableCallPhone(String digits) {
  // The call API can surface LID digits as a long numeric value. Brazilian
  // Keep real international numbers, including countries whose WhatsApp
  // number is longer than a Brazilian number, while rejecting LID-sized IDs.
  return digits.length >= 10 && digits.length <= 16;
}

bool _looksLikeCallNumericTechnicalId(String value) {
  final digits = _digitsOnly(value);
  if (digits.isEmpty || digits.length <= 13) return false;
  return value.replaceAll(RegExp(r'\D+'), '') == digits;
}

bool _looksLikeCallTechnicalId(String value) {
  final text = value.trim();
  if (text.length < 16) return false;
  if (RegExp(r'^[A-Fa-f0-9:_-]+$').hasMatch(text)) return true;
  if (text.length >= 20 &&
      RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(text) &&
      !RegExp(r'\s').hasMatch(text)) {
    return true;
  }
  final letters = RegExp(r'[A-Za-z]').allMatches(text).length;
  final digits = RegExp(r'\d').allMatches(text).length;
  return text.length >= 22 && digits > 0 && letters > 8;
}

String _callInitials(WhatsappCallRecord call) {
  final title = _callTitle(call).replaceAll(RegExp(r'[^0-9A-Za-z]+'), '');
  if (title.isEmpty) return call.isVideo ? 'V' : 'C';
  if (title.length == 1) return title.toUpperCase();
  return title.substring(title.length - 2).toUpperCase();
}

String _formatCallTimestamp(DateTime? value) {
  if (value == null || value.millisecondsSinceEpoch <= 0) return 'agora';
  final local = value.toLocal();
  final now = DateTime.now();
  final sameDay =
      now.year == local.year &&
      now.month == local.month &&
      now.day == local.day;
  if (sameDay) return DateFormat('HH:mm').format(local);
  return DateFormat('dd/MM').format(local);
}

String _normalizePrivateCallTarget(String value) {
  final raw = value.trim();
  if (raw.isEmpty) return '';
  if (raw.contains('@')) {
    final lower = raw.toLowerCase();
    if (lower.endsWith('@g.us') ||
        lower.endsWith('@newsletter') ||
        lower.endsWith('@broadcast')) {
      return '';
    }
    return raw;
  }
  final digits = raw.replaceAll(RegExp(r'\D+'), '');
  if (digits.length < 8) return '';
  return '$digits@s.whatsapp.net';
}

IconData _statusIcon(String? type) {
  final normalized = (type ?? '').toLowerCase();
  if (normalized.contains('image')) return Icons.image_rounded;
  if (normalized.contains('video')) return Icons.play_circle_rounded;
  if (normalized.contains('document')) return Icons.description_rounded;
  return Icons.notes_rounded;
}

String _statusTypeLabel(String? type) {
  final normalized = (type ?? '').toLowerCase();
  if (normalized.contains('video')) return 'Vídeo';
  if (normalized.contains('image') || normalized.contains('foto')) {
    return 'Foto';
  }
  if (normalized.contains('audio')) return 'Áudio';
  if (normalized.contains('document')) return 'Documento';
  return 'Texto';
}

Color? _parseStatusColor(String? raw) {
  var value = raw?.trim().replaceFirst('#', '') ?? '';
  if (value.length == 6) value = 'FF$value';
  if (value.length != 8) return null;
  final parsed = int.tryParse(value, radix: 16);
  return parsed == null ? null : Color(parsed);
}

TextStyle _receivedStatusTextStyle(String? rawFont, Color color) {
  final font = (rawFont ?? '').trim().toUpperCase();
  return TextStyle(
    color: color,
    fontFamily: font.contains('SERIF') ? 'serif' : null,
    fontStyle: font.contains('NORICAN') || font.contains('BRYNDAN')
        ? FontStyle.italic
        : FontStyle.normal,
    fontWeight: font.contains('BEBAS') || font.contains('OSWALD')
        ? FontWeight.w900
        : FontWeight.w800,
    letterSpacing: font.contains('BEBAS') ? 1.2 : 0,
  );
}

String _formatDateTime(DateTime value) {
  if (value.millisecondsSinceEpoch <= 0) return 'sem data';
  return DateFormat('dd/MM/yyyy HH:mm').format(value.toLocal());
}

String _formatStatusTime(DateTime value) {
  if (value.millisecondsSinceEpoch <= 0) return 'sem data';
  final now = DateTime.now();
  final local = value.toLocal();
  final sameDay =
      now.year == local.year &&
      now.month == local.month &&
      now.day == local.day;
  if (sameDay) return 'Hoje às ${DateFormat('HH:mm').format(local)}';
  final yesterday = now.subtract(const Duration(days: 1));
  final wasYesterday =
      yesterday.year == local.year &&
      yesterday.month == local.month &&
      yesterday.day == local.day;
  if (wasYesterday) return 'Ontem às ${DateFormat('HH:mm').format(local)}';
  return DateFormat('dd/MM/yyyy HH:mm').format(local);
}

String _formatBytes(int bytes) {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var size = bytes.toDouble();
  var unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return '${size.toStringAsFixed(size >= 10 || unit == 0 ? 0 : 1)} ${units[unit]}';
}

String _formatMoney(double value) {
  return NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$').format(value);
}

String _providerLabel(String provider) {
  switch (provider) {
    case 'mercadopago_pix':
      return 'Mercado Pago Pix';
    case 'polopag_pix':
      return 'PoloPag Pix';
    case 'mercadopago_checkout':
      return 'Mercado Pago checkout';
    default:
      return provider.isEmpty ? 'Pagamento' : provider;
  }
}

String _planStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'active':
      return 'Ativo';
    case 'pending':
      return 'Pendente';
    case 'expired':
      return 'Expirado';
    case 'cancelled':
      return 'Cancelado';
    case 'inactive':
    case '':
      return 'Sem plano';
    default:
      return status;
  }
}

String _paymentStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'approved':
    case 'accredited':
      return 'Pagamento aprovado';
    case 'pending':
      return 'Pagamento pendente';
    case 'in_process':
      return 'Pagamento em análise';
    case 'rejected':
      return 'Pagamento recusado';
    case 'cancelled':
    case 'cancelado':
      return 'Pagamento cancelado';
    default:
      return status.isEmpty ? 'Pagamento' : status;
  }
}

String _raffleStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'draft':
      return 'Rascunho';
    case 'active':
      return 'Ativa';
    case 'selling':
      return 'Vendendo';
    case 'sold_out':
      return 'Esgotada';
    case 'completed':
      return 'Finalizada';
    case 'cancelled':
      return 'Cancelada';
    default:
      return status.isEmpty ? 'Sem status' : status;
  }
}

String _providerStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'connected':
      return 'Conectado';
    case 'not_connected':
      return 'Não conectado';
    case 'expired':
      return 'Expirado';
    case 'error':
      return 'Erro';
    case 'unavailable':
      return 'Indisponível';
    default:
      return status.isEmpty ? 'Sem status' : status;
  }
}

String _campaignStatusLabel(String status) {
  switch (status.toLowerCase()) {
    case 'draft':
      return 'Rascunho';
    case 'scheduled':
      return 'Agendada';
    case 'running':
      return 'Rodando';
    case 'paused':
      return 'Pausada';
    case 'completed':
      return 'Finalizada';
    case 'cancelled':
      return 'Cancelada';
    default:
      return status.isEmpty ? 'Sem status' : status;
  }
}

String _scheduleKindLabel(String kind) {
  switch (kind.toLowerCase()) {
    case 'manual':
      return 'Manual';
    case 'immediate':
      return 'Imediata';
    case 'once':
      return 'Uma vez';
    case 'recurring':
      return 'Recorrente';
    case 'window':
      return 'Janela';
    default:
      return kind.isEmpty ? 'Sem agenda' : kind;
  }
}

String _promoterIntervalLabel(BotAdCampaignSummary campaign) {
  final raw = campaign.schedule['everyMinutes'];
  final minutes = raw is num
      ? raw.toInt()
      : int.tryParse(raw?.toString() ?? '');
  if (minutes == null || minutes <= 0) return 'Intervalo não definido';
  if (minutes % 1440 == 0) {
    final days = minutes ~/ 1440;
    return days == 1 ? 'A cada dia' : 'A cada $days dias';
  }
  if (minutes % 60 == 0) {
    final hours = minutes ~/ 60;
    return hours == 1 ? 'A cada hora' : 'A cada $hours horas';
  }
  return 'A cada $minutes minutos';
}

String _actionLabel(String action) {
  switch (action) {
    case 'accept':
      return 'atendida';
    case 'reject':
      return 'recusada';
    case 'end':
      return 'encerrada';
    default:
      return 'atualizada';
  }
}

String? _optionalText(String value) {
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

double _parseMoney(String value) {
  final raw = value.trim();
  final normalized = raw.contains(',')
      ? raw.replaceAll('.', '').replaceAll(',', '.')
      : raw;
  return double.tryParse(normalized) ?? 0;
}

Future<void> _openUrl(String value) async {
  final parsed = Uri.tryParse(value);
  final uri = parsed == null
      ? null
      : parsed.hasScheme
      ? parsed
      : Uri.base.resolve(value);
  if (uri == null) return;
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
