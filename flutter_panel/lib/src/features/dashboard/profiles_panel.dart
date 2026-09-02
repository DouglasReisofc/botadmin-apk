import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/wa_theme.dart';
import '../../models/bot_instance.dart';
import '../../models/migration_models.dart';
import 'dashboard_controller.dart';

/// Lista de perfis/instâncias + criar + conectar (QR/código).
final botInstancesProvider = FutureProvider.autoDispose<List<BotInstance>>((
  ref,
) {
  return ref.watch(apiClientProvider).listInstances();
});

final botServersProvider = FutureProvider.autoDispose<List<BotServer>>((ref) {
  return ref.watch(apiClientProvider).listBotServers();
});

final instanceProfileProvider = FutureProvider.autoDispose
    .family<BotInstanceProfile, int>((ref, id) {
      return ref.watch(apiClientProvider).loadInstanceProfile(id);
    });

final instanceProxyProvider = FutureProvider.autoDispose
    .family<InstanceProxyBundle, int>((ref, id) {
      return ref.watch(apiClientProvider).loadInstanceProxy(id);
    });

final profileCreationRequestProvider =
    NotifierProvider<ProfileCreationRequestController, int>(
      ProfileCreationRequestController.new,
    );

class ProfileCreationRequestController extends Notifier<int> {
  @override
  int build() => 0;

  void request() => state = state.abs() + 1;

  void consume(int request) {
    if (state == request) state = -request;
  }
}

Future<bool> openCreateProfileSheet(BuildContext context, WidgetRef ref) async {
  final servers = await ref.read(botServersProvider.future);
  if (servers.isEmpty) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nenhum servidor disponível.')),
      );
    }
    return false;
  }
  if (!context.mounted) return false;
  final created = await showBotAdminBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: WaTheme.of(context).panel,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (context) => _CreateProfileSheet(servers: servers),
  );
  if (created == true) {
    ref.invalidate(botInstancesProvider);
    ref.invalidate(botServersProvider);
    ref.invalidate(dashboardSnapshotProvider);
  }
  return created == true;
}

Future<bool> openRenewProfileSheet(
  BuildContext context,
  WidgetRef ref,
  BotInstance instance,
) async {
  final renewed = await showBotAdminBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: WaTheme.of(context).panel,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (context) => _RenewProfileSheet(instance: instance),
  );
  if (renewed == true) {
    ref.invalidate(botInstancesProvider);
    ref.invalidate(dashboardSnapshotProvider);
  }
  return renewed == true;
}

Future<void> openProfileHistoryResyncDialog(
  BuildContext context,
  BotInstance instance,
) {
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (context) => _ProfileHistoryResyncDialog(instance: instance),
  );
}

Future<void> openInstanceProxyDialog(
  BuildContext context,
  WidgetRef ref,
  BotInstance instance,
) async {
  await showDialog<void>(
    context: context,
    builder: (context) => _InstanceProxyDialog(instance: instance),
  );
  ref.invalidate(instanceProxyProvider(instance.id));
  ref.invalidate(botInstancesProvider);
}

class _ProfileHistoryResyncDialog extends ConsumerStatefulWidget {
  const _ProfileHistoryResyncDialog({required this.instance});

  final BotInstance instance;

  @override
  ConsumerState<_ProfileHistoryResyncDialog> createState() =>
      _ProfileHistoryResyncDialogState();
}

class _ProfileHistoryResyncDialogState
    extends ConsumerState<_ProfileHistoryResyncDialog> {
  String _status = 'requested';
  String? _error;
  int _progress = 0;
  int _messages = 0;
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

  int _intValue(Object? value) => switch (value) {
    int number => number,
    num number => number.toInt(),
    String text => int.tryParse(text) ?? 0,
    _ => 0,
  };

  void _apply(Map<String, dynamic> json) {
    final raw = json['resync'];
    final data = raw is Map ? Map<String, dynamic>.from(raw) : json;
    if (!mounted) return;
    setState(() {
      _status = data['status']?.toString().trim().toLowerCase() ?? _status;
      _progress = _intValue(data['progress']).clamp(0, 100).toInt();
      _messages = _intValue(data['messages']);
      _conversations = _intValue(data['conversations']);
      final error = data['error']?.toString().trim();
      _error = error?.isNotEmpty == true ? error : null;
      _starting = false;
    });
  }

  Future<void> _startAndMonitor() async {
    final api = ref.read(apiClientProvider);
    try {
      _apply(await api.startFullHistoryResync(widget.instance.id));
    } on BotAdminApiException catch (error) {
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
            ref.invalidate(botInstancesProvider);
          }
          return;
        }
      } catch (_) {
        // O trabalho continua no servidor durante uma falha temporária de rede.
      }
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final failed = _status == 'failed';
    final completed = _status == 'completed';
    final title = completed
        ? 'Histórico resincronizado'
        : failed
        ? 'Resincronização interrompida'
        : 'Resincronizando ${widget.instance.name}';
    final description = completed
        ? '$_messages mensagem(ns) recuperada(s) em $_conversations conversa(s), sem desconectar o perfil.'
        : failed
        ? (_error ?? 'O telefone não reemitiu o histórico disponível.')
        : 'Mantenha o WhatsApp principal conectado à internet. Você pode fechar esta janela; o processo continuará no servidor.';

    return AlertDialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      title: Row(
        children: [
          Icon(
            completed
                ? Icons.check_circle_rounded
                : failed
                ? Icons.error_outline_rounded
                : Icons.sync_rounded,
            color: failed ? Colors.orange : wa.accent,
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(title)),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(description, style: TextStyle(color: wa.textSecondary)),
            if (!_finished) ...[
              const SizedBox(height: 20),
              LinearProgressIndicator(
                value: _starting || _progress <= 0 ? null : _progress / 100,
              ),
              const SizedBox(height: 10),
              Text(
                _progress > 0
                    ? '$_progress% · $_messages mensagem(ns) recuperada(s)'
                    : 'Solicitando o histórico local…',
                style: TextStyle(color: wa.textMuted, fontSize: 12.5),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).maybePop(),
          child: Text(_finished ? 'Fechar' : 'Continuar em segundo plano'),
        ),
      ],
    );
  }
}

class _RenewProfileSheet extends ConsumerStatefulWidget {
  const _RenewProfileSheet({required this.instance});

  final BotInstance instance;

  @override
  ConsumerState<_RenewProfileSheet> createState() => _RenewProfileSheetState();
}

class _RenewProfileSheetState extends ConsumerState<_RenewProfileSheet> {
  static const _providerOrder = [
    'mercadopago_pix',
    'polopag_pix',
    'mercadopago_checkout',
  ];

  late Future<PlanSnapshot> _future;
  int? _planId;
  String? _provider;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _future = ref.read(apiClientProvider).loadPlanSnapshot();
  }

  List<SubscriptionPlanSummary> _plans(PlanSnapshot snapshot) {
    return snapshot.plans.where((plan) => plan.id > 0 && plan.active).toList()
      ..sort((a, b) => a.price.compareTo(b.price));
  }

  List<String> _providers(PlanSnapshot snapshot) => [
    for (final key in _providerOrder)
      if (snapshot.paymentMethods.any(
        (method) => method.provider == key && method.available,
      ))
        key,
  ];

  int? _effectivePlanId(PlanSnapshot snapshot) {
    final plans = _plans(snapshot);
    if (_planId != null && plans.any((plan) => plan.id == _planId)) {
      return _planId;
    }
    final preferred = widget.instance.planId ?? snapshot.currentPlanId;
    if (preferred != null && plans.any((plan) => plan.id == preferred)) {
      return preferred;
    }
    return plans.firstOrNull?.id;
  }

  String? _effectiveProvider(PlanSnapshot snapshot) {
    final providers = _providers(snapshot);
    if (_provider != null && providers.contains(_provider)) return _provider;
    return providers.firstOrNull;
  }

  Future<void> _submit(PlanSnapshot snapshot) async {
    final planId = _effectivePlanId(snapshot);
    final provider = _effectiveProvider(snapshot);
    final plan = _plans(
      snapshot,
    ).where((entry) => entry.id == planId).firstOrNull;
    if (plan == null || provider == null) {
      setState(
        () => _error = 'Nenhum plano ou meio de pagamento está disponível.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final checkout = await ref
          .read(apiClientProvider)
          .createPlanCheckout(
            planId: plan.id,
            provider: provider,
            mode: 'instance_renewal',
            instanceId: widget.instance.id,
          );
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => _ProfileCheckoutDialog(
          plan: plan,
          checkout: checkout,
          provider: provider,
          title: 'Renovar ${widget.instance.name}',
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final bottom =
        MediaQuery.viewInsetsOf(context).bottom >
            MediaQuery.viewPaddingOf(context).bottom
        ? MediaQuery.viewInsetsOf(context).bottom
        : MediaQuery.viewPaddingOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 12, 18, 18 + bottom),
      child: FutureBuilder<PlanSnapshot>(
        future: _future,
        builder: (context, state) {
          final snapshot = state.data;
          final plans = snapshot == null
              ? const <SubscriptionPlanSummary>[]
              : _plans(snapshot);
          final providers = snapshot == null
              ? const <String>[]
              : _providers(snapshot);
          final selectedPlanId = snapshot == null
              ? null
              : _effectivePlanId(snapshot);
          final selectedProvider = snapshot == null
              ? null
              : _effectiveProvider(snapshot);
          return SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Center(
                  child: Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: wa.border,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Renovar perfil',
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  widget.instance.name,
                  style: TextStyle(color: wa.textMuted),
                ),
                const SizedBox(height: 16),
                if (state.connectionState == ConnectionState.waiting)
                  const Center(child: CircularProgressIndicator())
                else if (state.hasError)
                  Text(
                    state.error.toString(),
                    style: const TextStyle(color: Color(0xFFB42318)),
                  )
                else ...[
                  DropdownButtonFormField<int>(
                    initialValue: selectedPlanId,
                    items: plans
                        .map(
                          (plan) => DropdownMenuItem(
                            value: plan.id,
                            child: Text(
                              '${plan.name} · ${_formatProfileMoney(plan.price)}',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: _busy
                        ? null
                        : (value) => setState(() => _planId = value),
                    decoration: const InputDecoration(
                      labelText: 'Plano',
                      prefixIcon: Icon(Icons.workspace_premium_outlined),
                      filled: true,
                    ),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: selectedProvider,
                    items: providers
                        .map(
                          (provider) => DropdownMenuItem(
                            value: provider,
                            child: Text(_profileProviderLabel(provider)),
                          ),
                        )
                        .toList(),
                    onChanged: _busy
                        ? null
                        : (value) => setState(() => _provider = value),
                    decoration: const InputDecoration(
                      labelText: 'Forma de pagamento',
                      prefixIcon: Icon(Icons.payments_outlined),
                      filled: true,
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    style: const TextStyle(color: Color(0xFFB42318)),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: snapshot == null || _busy
                      ? null
                      : () => _submit(snapshot),
                  icon: _busy
                      ? const SizedBox(
                          width: 17,
                          height: 17,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.refresh_rounded),
                  label: const Text('Gerar pagamento da renovação'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class ProfilesInstancesPanel extends ConsumerWidget {
  const ProfilesInstancesPanel({super.key, this.onActivate});

  final ValueChanged<BotInstance>? onActivate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final instances = ref.watch(botInstancesProvider);
    final servers = ref.watch(botServersProvider);

    return instances.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(error.toString(), style: TextStyle(color: wa.textSecondary)),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => ref.invalidate(botInstancesProvider),
              child: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
      data: (list) {
        final serverList = servers.maybeWhen(
          data: (value) => value,
          orElse: () => const <BotServer>[],
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Perfis e conexões',
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Atualizar',
                  onPressed: () {
                    ref.invalidate(botInstancesProvider);
                    ref.invalidate(botServersProvider);
                    ref.invalidate(dashboardSnapshotProvider);
                  },
                  icon: Icon(Icons.refresh_rounded, color: wa.icon),
                ),
                FilledButton.tonalIcon(
                  onPressed: serverList.isEmpty
                      ? null
                      : () => openCreateProfileSheet(context, ref),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Novo perfil'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Cada perfil é uma instância do WhatsApp. Conecte o número e gerencie os grupos nele.',
              style: TextStyle(color: wa.textMuted, fontSize: 13, height: 1.35),
            ),
            const SizedBox(height: 14),
            if (list.isEmpty)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: wa.searchBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  'Nenhum perfil ainda. Crie o primeiro e conecte o WhatsApp pelo QR Code ou código de pareamento.',
                  style: TextStyle(color: wa.textSecondary, height: 1.4),
                ),
              )
            else
              ...list.map(
                (instance) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _InstanceCard(
                    instance: instance,
                    onActivate: onActivate,
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _InstanceCard extends ConsumerStatefulWidget {
  const _InstanceCard({required this.instance, this.onActivate});

  final BotInstance instance;
  final ValueChanged<BotInstance>? onActivate;

  @override
  ConsumerState<_InstanceCard> createState() => _InstanceCardState();
}

class _InstanceCardState extends ConsumerState<_InstanceCard> {
  bool _busy = false;
  String? _localStatus;

  BotInstance get instance => widget.instance;

  @override
  void didUpdateWidget(covariant _InstanceCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.instance.id != instance.id ||
        oldWidget.instance.sessionStatus != instance.sessionStatus) {
      _localStatus = null;
    }
  }

  String get status => (_localStatus ?? instance.sessionStatus).trim().isEmpty
      ? instance.sessionStatus
      : (_localStatus ?? instance.sessionStatus);

  bool get connected {
    final s = status.toLowerCase();
    return s.contains('conect') && !s.contains('desconect');
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _fetchAndApplyStatus() async {
    final next = await ref
        .read(apiClientProvider)
        .refreshInstanceStatus(instance.id);
    if (!mounted) return;
    setState(() => _localStatus = next);
    ref.invalidate(botInstancesProvider);
    ref.invalidate(dashboardSnapshotProvider);
  }

  Future<void> _refreshStatus() async {
    await _run(_fetchAndApplyStatus);
  }

  Future<void> _action(String action) async {
    await _run(() async {
      final msg = await ref
          .read(apiClientProvider)
          .runInstanceAction(instance.id, action);
      if (!mounted) return;
      if (action == 'logout') {
        setState(() => _localStatus = 'desconectado');
        ref.invalidate(botInstancesProvider);
        ref.invalidate(dashboardSnapshotProvider);
      } else {
        await _fetchAndApplyStatus();
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    });
  }

  Future<void> _pair(String mode) async {
    await _run(() async {
      final payload = await ref
          .read(apiClientProvider)
          .pairInstance(instance.id, mode: mode);
      if (!mounted) return;
      if (payload.alreadyConnected) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(payload.message ?? 'Conexão já está ativa.')),
        );
        await _refreshStatus();
        return;
      }
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => _PairingDialog(
          instance: instance,
          payload: payload,
          onConnected: () {
            ref.invalidate(botInstancesProvider);
            ref.invalidate(dashboardSnapshotProvider);
          },
        ),
      );
      await _refreshStatus();
    });
  }

  Future<void> _choosePairMode() async {
    final mode = await showBotAdminBottomSheet<String>(
      context: context,
      backgroundColor: WaTheme.of(context).panel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        final wa = WaTheme.of(context);
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Como conectar ${instance.name}?',
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 12),
                ListTile(
                  leading: Icon(Icons.qr_code_2_rounded, color: wa.icon),
                  title: Text(
                    'QR Code',
                    style: TextStyle(color: wa.textPrimary),
                  ),
                  subtitle: Text(
                    'Escaneie no WhatsApp do celular',
                    style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                  ),
                  onTap: () => Navigator.pop(context, 'qr'),
                ),
                ListTile(
                  leading: Icon(Icons.pin_rounded, color: wa.icon),
                  title: Text(
                    'Código de pareamento',
                    style: TextStyle(color: wa.textPrimary),
                  ),
                  subtitle: Text(
                    'Digite o código no WhatsApp vinculado',
                    style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                  ),
                  onTap: () => Navigator.pop(context, 'code'),
                ),
                ListTile(
                  leading: Icon(Icons.auto_awesome_rounded, color: wa.icon),
                  title: Text(
                    'Automático',
                    style: TextStyle(color: wa.textPrimary),
                  ),
                  onTap: () => Navigator.pop(context, 'auto'),
                ),
                const Divider(height: 18),
                ListTile(
                  leading: Icon(Icons.shield_outlined, color: wa.accent),
                  title: Text(
                    'Configurar proxy antes de conectar',
                    style: TextStyle(color: wa.textPrimary),
                  ),
                  subtitle: Text(
                    'Defina protocolo, servidor e credenciais com segurança',
                    style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                  ),
                  onTap: () => Navigator.pop(context, 'proxy'),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (mode == 'proxy') {
      await openInstanceProxyDialog(context, ref, instance);
      if (mounted) await _choosePairMode();
      return;
    }
    if (mode != null) await _pair(mode);
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final profile = ref.watch(instanceProfileProvider(instance.id));
    final profileUrl = profile.maybeWhen(
      data: (value) => value.avatarUrl,
      orElse: () => null,
    );
    final avatarUrl = _profileImageUrl(profileUrl ?? instance.avatarUrl);
    final statusColor = connected
        ? const Color(0xFF00A884)
        : (instance.isAwaitingPair ? const Color(0xFFF59E0B) : wa.textMuted);
    final proxy = ref.watch(instanceProxyProvider(instance.id));
    final proxyValue = proxy.maybeWhen(data: (value) => value.proxy, orElse: () => null);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.panelElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: wa.border),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                _ProfilePhoto(
                  label: instance.name,
                  avatarUrl: avatarUrl,
                  connected: connected,
                  size: 40,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        instance.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontWeight: FontWeight.w800,
                          fontSize: 15.5,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        instance.phoneNumber?.isNotEmpty == true
                            ? '+${instance.phoneNumber}'
                            : 'Sem número vinculado',
                        style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
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
                    BotInstance(
                      id: instance.id,
                      name: instance.name,
                      sessionStatus: status,
                    ).statusLabel,
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
            if (instance.serverName != null &&
                instance.serverName!.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Servidor: ${instance.serverName}',
                style: TextStyle(color: wa.textMuted, fontSize: 12),
              ),
            ],
            if (instance.expiresAt != null) ...[
              const SizedBox(height: 6),
              Text(
                'Validade: ${DateFormat('dd/MM/yyyy HH:mm').format(instance.expiresAt!.toLocal())}',
                style: TextStyle(
                  color: instance.expiresAt!.isBefore(DateTime.now())
                      ? const Color(0xFFDC2626)
                      : wa.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            if (proxyValue?.enabled == true) ...[
              const SizedBox(height: 7),
              Row(
                children: [
                  Icon(Icons.shield_outlined, size: 15, color: const Color(0xFF0EA5E9)),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      'Proxy: ${proxyValue?.resolvedIp ?? '${proxyValue?.host}:${proxyValue?.port}'}'
                      '${proxyValue?.regionName != null ? ' · ${proxyValue?.regionName}' : ''}'
                      '${proxyValue?.latencyMs != null ? ' · ${proxyValue?.latencyMs} ms' : ''}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: wa.textMuted, fontSize: 12),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (!connected)
                  FilledButton.icon(
                    onPressed: _busy ? null : _choosePairMode,
                    icon: _busy
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.qr_code_scanner_rounded, size: 18),
                    label: const Text('Conectar'),
                  ),
                if (connected)
                  OutlinedButton.icon(
                    onPressed: _busy ? null : () => _action('logout'),
                    icon: const Icon(Icons.link_off_rounded, size: 18),
                    label: const Text('Desconectar'),
                  ),
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _action('restart'),
                  icon: const Icon(Icons.restart_alt_rounded, size: 18),
                  label: const Text('Reiniciar'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy || !connected
                      ? null
                      : () => openProfileHistoryResyncDialog(context, instance),
                  icon: const Icon(Icons.sync_rounded, size: 18),
                  label: const Text('Resincronizar histórico'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy
                      ? null
                      : () => openRenewProfileSheet(context, ref, instance),
                  icon: const Icon(Icons.workspace_premium_outlined, size: 18),
                  label: const Text('Renovar'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy
                      ? null
                      : () => openInstanceProxyDialog(context, ref, instance),
                  icon: const Icon(Icons.security_rounded, size: 18),
                  label: Text(proxyValue?.enabled == true ? 'Editar proxy' : 'Adicionar proxy'),
                ),
                FilledButton.tonalIcon(
                  onPressed: _busy || widget.onActivate == null
                      ? null
                      : () => widget.onActivate!(instance),
                  icon: const Icon(Icons.bolt_rounded, size: 18),
                  label: const Text('Ativar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CreateProfileSheet extends ConsumerStatefulWidget {
  const _CreateProfileSheet({required this.servers});

  final List<BotServer> servers;

  @override
  ConsumerState<_CreateProfileSheet> createState() =>
      _CreateProfileSheetState();
}

class _CreateProfileSheetState extends ConsumerState<_CreateProfileSheet> {
  static const _providerOrder = [
    'mercadopago_pix',
    'polopag_pix',
    'mercadopago_checkout',
  ];

  late int _serverId;
  late Future<PlanSnapshot> _planFuture;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _ddi = TextEditingController(text: '55');
  int? _planId;
  String? _provider;
  PlanSnapshot? _latestPlanSnapshot;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _serverId = widget.servers.first.id;
    _planFuture = ref.read(apiClientProvider).loadPlanSnapshot();
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _ddi.dispose();
    super.dispose();
  }

  List<SubscriptionPlanSummary> _activePlans(PlanSnapshot snapshot) {
    return snapshot.plans.where((plan) => plan.id > 0 && plan.active).toList()
      ..sort((a, b) => a.price.compareTo(b.price));
  }

  List<String> _availableProviders(PlanSnapshot snapshot) {
    return [
      for (final key in _providerOrder)
        if (snapshot.paymentMethods.any(
          (method) => method.provider == key && method.available,
        ))
          key,
    ];
  }

  SubscriptionPlanSummary? _selectedPlan(PlanSnapshot snapshot) {
    final plans = _activePlans(snapshot);
    if (plans.isEmpty) return null;
    final selectedId = _planId;
    if (selectedId != null) {
      for (final plan in plans) {
        if (plan.id == selectedId) return plan;
      }
    }
    return plans.first;
  }

  String? _selectedProvider(PlanSnapshot snapshot) {
    final providers = _availableProviders(snapshot);
    if (providers.isEmpty) return null;
    final selected = _provider;
    if (selected != null && providers.contains(selected)) return selected;
    return providers.first;
  }

  bool _canSubmit(PlanSnapshot? snapshot) {
    if (snapshot == null) return false;
    if (snapshot.profileSlotAvailable > 0) return true;
    final plan = _selectedPlan(snapshot);
    if (plan == null) return false;
    if (plan.price <= 0) return true;
    return _selectedProvider(snapshot) != null;
  }

  Future<void> _submit(PlanSnapshot? snapshot) async {
    final local = _phone.text.replaceAll(RegExp(r'\D'), '');
    final dial = _ddi.text.replaceAll(RegExp(r'\D'), '');
    if (local.isEmpty) {
      setState(() => _error = 'Informe o número com DDD.');
      return;
    }
    if (snapshot == null) {
      setState(() => _error = 'Carregue os planos antes de criar o perfil.');
      return;
    }
    final hasProfileSlot = snapshot.profileSlotAvailable > 0;
    final plan = _selectedPlan(snapshot);
    if (!hasProfileSlot && plan == null) {
      setState(
        () => _error = 'Nenhum plano ativo disponível para este perfil.',
      );
      return;
    }
    final provider = !hasProfileSlot && (plan?.price ?? 0) > 0
        ? _selectedProvider(snapshot)
        : null;
    if (!hasProfileSlot && (plan?.price ?? 0) > 0 && provider == null) {
      setState(
        () =>
            _error = 'Nenhuma forma de pagamento ativa para liberar o perfil.',
      );
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(apiClientProvider)
          .createInstanceWithResult(
            serverId: _serverId,
            phone: '$dial$local',
            name: _name.text.trim().isEmpty ? null : _name.text.trim(),
          );
      if (!mounted) return;
      if (result.requiresProfilePayment && plan != null && provider != null) {
        final checkout = await ref
            .read(apiClientProvider)
            .createPlanCheckout(
              planId: plan.id,
              provider: provider,
              mode: 'instance_creation',
              instanceId: result.instance.id,
            );
        if (!mounted) return;
        await showDialog<void>(
          context: context,
          builder: (context) => _ProfileCheckoutDialog(
            plan: plan,
            checkout: checkout,
            provider: provider,
          ),
        );
        if (!mounted) return;
      } else if (result.requiresProfilePayment) {
        setState(() {
          _saving = false;
          _error =
              'O slot liberado não está mais disponível. Recarregue e escolha um plano.';
          _planFuture = ref.read(apiClientProvider).loadPlanSnapshot();
        });
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final bottom =
        MediaQuery.viewInsetsOf(context).bottom >
            MediaQuery.viewPaddingOf(context).bottom
        ? MediaQuery.viewInsetsOf(context).bottom
        : MediaQuery.viewPaddingOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 14, 18, 18 + bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: wa.border,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Novo perfil',
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Crie o perfil e conecte o WhatsApp por QR ou código.',
              style: TextStyle(color: wa.textMuted, height: 1.35),
            ),
            const SizedBox(height: 16),
            if (widget.servers.length > 1) ...[
              Text(
                'Servidor',
                style: TextStyle(
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              DropdownButtonFormField<int>(
                initialValue: _serverId,
                items: widget.servers
                    .map(
                      (s) => DropdownMenuItem(value: s.id, child: Text(s.name)),
                    )
                    .toList(),
                onChanged: _saving
                    ? null
                    : (value) {
                        if (value != null) setState(() => _serverId = value);
                      },
                decoration: const InputDecoration(filled: true),
              ),
              const SizedBox(height: 12),
            ],
            Text(
              'Nome do perfil (opcional)',
              style: TextStyle(
                color: wa.textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _name,
              enabled: !_saving,
              decoration: const InputDecoration(
                hintText: 'Ex.: Atendimento, Loja, Suporte',
                filled: true,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'WhatsApp (DDI + número)',
              style: TextStyle(
                color: wa.textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                SizedBox(
                  width: 88,
                  child: TextField(
                    controller: _ddi,
                    enabled: !_saving,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(
                      hintText: '55',
                      filled: true,
                      prefixText: '+',
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _phone,
                    enabled: !_saving,
                    keyboardType: TextInputType.phone,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(
                      hintText: '11999999999',
                      filled: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            FutureBuilder<PlanSnapshot>(
              future: _planFuture,
              builder: (context, snapshot) {
                final data = snapshot.data;
                if (data != null && !identical(_latestPlanSnapshot, data)) {
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    if (!mounted || identical(_latestPlanSnapshot, data)) {
                      return;
                    }
                    setState(() => _latestPlanSnapshot = data);
                  });
                }
                if (snapshot.connectionState == ConnectionState.waiting &&
                    data == null) {
                  return _InlinePanel(
                    child: Row(
                      children: [
                        const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        const SizedBox(width: 10),
                        Text(
                          'Carregando planos...',
                          style: TextStyle(color: wa.textMuted),
                        ),
                      ],
                    ),
                  );
                }
                if (snapshot.hasError && data == null) {
                  return _InlinePanel(
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Não foi possível carregar os planos.',
                            style: TextStyle(color: wa.textSecondary),
                          ),
                        ),
                        TextButton(
                          onPressed: _saving
                              ? null
                              : () => setState(() {
                                  _planFuture = ref
                                      .read(apiClientProvider)
                                      .loadPlanSnapshot();
                                }),
                          child: const Text('Tentar'),
                        ),
                      ],
                    ),
                  );
                }
                if (data == null) return const SizedBox.shrink();
                return _CreateProfilePaymentBlock(
                  snapshot: data,
                  selectedPlanId: _selectedPlan(data)?.id,
                  selectedProvider: _selectedProvider(data),
                  enabled: !_saving,
                  onPlanChanged: (value) => setState(() => _planId = value),
                  onProviderChanged: (value) =>
                      setState(() => _provider = value),
                );
              },
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Color(0xFFEA0038))),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving || !_canSubmit(_latestPlanSnapshot)
                  ? null
                  : () => _submit(_latestPlanSnapshot),
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      (_latestPlanSnapshot?.profileSlotAvailable ?? 0) > 0
                          ? 'Criar gratuitamente'
                          : 'Criar perfil e pagar',
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CreateProfilePaymentBlock extends StatelessWidget {
  const _CreateProfilePaymentBlock({
    required this.snapshot,
    required this.selectedPlanId,
    required this.selectedProvider,
    required this.enabled,
    required this.onPlanChanged,
    required this.onProviderChanged,
  });

  static const _providerOrder = [
    'mercadopago_pix',
    'polopag_pix',
    'mercadopago_checkout',
  ];

  final PlanSnapshot snapshot;
  final int? selectedPlanId;
  final String? selectedProvider;
  final bool enabled;
  final ValueChanged<int?> onPlanChanged;
  final ValueChanged<String?> onProviderChanged;

  List<SubscriptionPlanSummary> get plans {
    return snapshot.plans.where((plan) => plan.id > 0 && plan.active).toList()
      ..sort((a, b) => a.price.compareTo(b.price));
  }

  List<String> get providers {
    return [
      for (final key in _providerOrder)
        if (snapshot.paymentMethods.any(
          (method) => method.provider == key && method.available,
        ))
          key,
    ];
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final availablePlans = plans;
    final availableProviders = providers;
    final slotAvailable = snapshot.profileSlotAvailable > 0;
    SubscriptionPlanSummary? selectedPlan;
    if (selectedPlanId != null) {
      for (final plan in availablePlans) {
        if (plan.id == selectedPlanId) {
          selectedPlan = plan;
          break;
        }
      }
    }
    return _InlinePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.workspace_premium_rounded, color: wa.accent, size: 20),
              const SizedBox(width: 8),
              Text(
                slotAvailable
                    ? 'Criação gratuita disponível'
                    : 'Pagamento do perfil',
                style: TextStyle(
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (slotAvailable) ...[
            Text(
              'Você possui um slot disponível. Nenhuma forma de pagamento será necessária.',
              style: TextStyle(color: wa.textSecondary),
            ),
            if (snapshot.nextProfileSlotExpiresAt != null) ...[
              const SizedBox(height: 6),
              Text(
                'Validade: ${DateFormat('dd/MM/yyyy HH:mm').format(snapshot.nextProfileSlotExpiresAt!.toLocal())}',
                style: TextStyle(color: wa.textMuted, fontSize: 12.5),
              ),
            ],
          ] else if (availablePlans.isEmpty)
            Text(
              'Nenhum plano ativo disponível para criar perfil.',
              style: TextStyle(color: wa.textSecondary),
            )
          else ...[
            DropdownButtonFormField<int>(
              initialValue: selectedPlanId,
              items: availablePlans
                  .map(
                    (plan) => DropdownMenuItem(
                      value: plan.id,
                      child: Text(
                        '${plan.name} · ${_formatProfileMoney(plan.price)}',
                      ),
                    ),
                  )
                  .toList(),
              onChanged: enabled ? onPlanChanged : null,
              decoration: const InputDecoration(
                labelText: 'Plano do perfil',
                prefixIcon: Icon(Icons.assignment_turned_in_outlined),
                filled: true,
              ),
            ),
            if (selectedPlan != null) ...[
              const SizedBox(height: 8),
              Text(
                '${selectedPlan.durationDays} dia(s) · todos os grupos e funcionalidades liberados neste perfil.',
                style: TextStyle(color: wa.textMuted, fontSize: 12.5),
              ),
            ],
            if ((selectedPlan?.price ?? 0) > 0) ...[
              const SizedBox(height: 10),
              if (availableProviders.isEmpty)
                Text(
                  'Nenhuma forma de pagamento ativa para este perfil.',
                  style: TextStyle(color: wa.textSecondary),
                )
              else
                DropdownButtonFormField<String>(
                  initialValue: selectedProvider,
                  items: availableProviders
                      .map(
                        (provider) => DropdownMenuItem(
                          value: provider,
                          child: Text(_profileProviderLabel(provider)),
                        ),
                      )
                      .toList(),
                  onChanged: enabled ? onProviderChanged : null,
                  decoration: const InputDecoration(
                    labelText: 'Forma de pagamento',
                    prefixIcon: Icon(Icons.payments_outlined),
                    filled: true,
                  ),
                ),
            ],
          ],
        ],
      ),
    );
  }
}

class _InlinePanel extends StatelessWidget {
  const _InlinePanel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.searchBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: wa.border),
      ),
      child: Padding(padding: const EdgeInsets.all(12), child: child),
    );
  }
}

class _ProfileCheckoutDialog extends StatelessWidget {
  const _ProfileCheckoutDialog({
    required this.plan,
    required this.checkout,
    required this.provider,
    this.title = 'Liberar novo perfil',
  });

  final SubscriptionPlanSummary plan;
  final PlanCheckout checkout;
  final String provider;
  final String title;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final qrBytes = _decodeProfileQrCode(checkout.qrCodeBase64);
    final pixCode = checkout.qrCode?.trim();
    return AlertDialog(
      backgroundColor: wa.panel,
      title: Text(
        title,
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
                '${plan.name} · ${_formatProfileMoney(checkout.amount > 0 ? checkout.amount : plan.price)}',
                style: TextStyle(
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${_profileProviderLabel(provider)} · liberação automática após confirmação.',
                style: TextStyle(color: wa.textMuted, height: 1.35),
              ),
              if (checkout.expiresAt != null) ...[
                const SizedBox(height: 6),
                Text(
                  'Expira em ${DateFormat('dd/MM/yyyy HH:mm').format(checkout.expiresAt!.toLocal())}',
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
              if (pixCode != null && pixCode.isNotEmpty) ...[
                const SizedBox(height: 14),
                Container(
                  constraints: const BoxConstraints(maxHeight: 120),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: wa.searchBg,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: wa.border),
                  ),
                  child: SingleChildScrollView(
                    child: SelectableText(
                      pixCode,
                      style: TextStyle(color: wa.textSecondary, fontSize: 12),
                    ),
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
            onPressed: () => _openProfileUrl(checkout.ticketUrl!),
            icon: const Icon(Icons.open_in_new_rounded, size: 18),
            label: const Text('Abrir link'),
          ),
        if (pixCode != null && pixCode.isNotEmpty)
          FilledButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: pixCode));
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

class _ProfilePhoto extends StatelessWidget {
  const _ProfilePhoto({
    required this.label,
    required this.avatarUrl,
    required this.connected,
    this.size = 40,
  });

  final String label;
  final String? avatarUrl;
  final bool connected;
  final double size;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final initial = label.trim().isEmpty
        ? '?'
        : label.trim().characters.first.toUpperCase();
    final url = _profileImageUrl(avatarUrl);
    final fallback = CircleAvatar(
      radius: size / 2,
      backgroundColor: connected ? wa.accentSoft : wa.searchBg,
      child: Text(
        initial,
        style: TextStyle(
          color: connected ? wa.accent : wa.textSecondary,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
    if (url == null) return fallback;
    return ClipOval(
      child: Image.network(
        url,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (context, _, _) => fallback,
      ),
    );
  }
}

Uint8List? _decodeProfileQrCode(String? value) {
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

String _formatProfileMoney(double value) {
  return NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$').format(value);
}

String _profileProviderLabel(String provider) {
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

String? _profileImageUrl(String? value) {
  final raw = value?.trim();
  if (raw == null || raw.isEmpty) return null;
  if (raw.startsWith('https://pps.whatsapp.net/')) {
    return Uri.base
        .resolve('/api/whatsapp-avatar-proxy?url=${Uri.encodeComponent(raw)}')
        .toString();
  }
  if (raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('data:') ||
      raw.startsWith('blob:')) {
    return raw;
  }
  if (raw.startsWith('/')) return Uri.base.resolve(raw).toString();
  return raw;
}

Future<void> _openProfileUrl(String value) async {
  final uri = Uri.tryParse(value.trim());
  if (uri == null) return;
  await launchUrl(uri, webOnlyWindowName: '_blank');
}

class _InstanceProxyDialog extends ConsumerStatefulWidget {
  const _InstanceProxyDialog({required this.instance});
  final BotInstance instance;

  @override
  ConsumerState<_InstanceProxyDialog> createState() => _InstanceProxyDialogState();
}

class _InstanceProxyDialogState extends ConsumerState<_InstanceProxyDialog> {
  final _host = TextEditingController();
  final _port = TextEditingController();
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _enabled = false;
  String _protocol = 'socks5';
  bool _loading = true;
  bool _saving = false;
  bool _testing = false;
  InstanceProxyBundle? _bundle;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _host.dispose();
    _port.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final bundle = await ref.read(apiClientProvider).loadInstanceProxy(widget.instance.id);
      if (!mounted) return;
      _bundle = bundle;
      _enabled = bundle.proxy.enabled;
      _protocol = const {'http', 'https', 'socks4', 'socks4a', 'socks5', 'socks5h'}
              .contains(bundle.proxy.protocol)
          ? bundle.proxy.protocol
          : 'socks5';
      _host.text = bundle.proxy.host ?? '';
      _port.text = bundle.proxy.port?.toString() ?? '';
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, Object?> _payload() => {
        'enabled': _enabled,
        'protocol': _protocol,
        'host': _host.text.trim(),
        'port': int.tryParse(_port.text.trim()) ?? 0,
        'username': _username.text.trim(),
        'password': _password.text,
        'preserveUsername': _username.text.trim().isEmpty && (_bundle?.proxy.hasUsername ?? false),
        'preservePassword': _password.text.isEmpty && (_bundle?.proxy.hasPassword ?? false),
      };

  Future<void> _test() async {
    if (_testing || _saving) return;
    setState(() => _testing = true);
    try {
      final result = await ref.read(apiClientProvider).testInstanceProxy(widget.instance.id, _payload());
      if (!mounted) return;
      final check = result['check'];
      final ip = check is Map ? check['resolvedIp']?.toString() : null;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ip == null ? 'Proxy desativado.' : 'Proxy acessível. IP público: $ip')));
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  Future<void> _save() async {
    if (_saving || _loading) return;
    setState(() => _saving = true);
    try {
      final bundle = await ref.read(apiClientProvider).saveInstanceProxy(widget.instance.id, _payload());
      if (!mounted) return;
      Navigator.of(context).pop();
      final text = bundle.connected
          ? 'Proxy salvo e aplicado. A conexão foi reiniciada com segurança.'
          : 'Proxy salvo e pronto para a próxima conexão.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final size = MediaQuery.sizeOf(context);
    final policy = _bundle?.policy;
    final customerCanConfigure = policy?.allowCustomerProxy ?? true;
    return AlertDialog(
      backgroundColor: wa.panel,
      insetPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 24),
      title: Row(
        children: [
          const Icon(Icons.shield_outlined, color: Color(0xFF0EA5E9)),
          const SizedBox(width: 8),
          Expanded(child: Text('Proxy da conexão', style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w800))),
        ],
      ),
      content: SizedBox(
        width: size.width > 520 ? 470 : size.width - 58,
        child: _loading
            ? const SizedBox(height: 120, child: Center(child: CircularProgressIndicator()))
            : SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('A rota fica vinculada somente a este perfil. A senha nunca é exibida novamente.', style: TextStyle(color: wa.textMuted, fontSize: 12.5)),
                    if (!customerCanConfigure) ...[
                      const SizedBox(height: 10),
                      Text(
                        policy?.instructions?.trim().isNotEmpty == true
                            ? policy!.instructions!
                            : 'Seu responsável comercial gerencia o proxy deste perfil. Entre em contato para contratar ou alterar a rota.',
                        style: const TextStyle(color: Color(0xFFF59E0B), fontSize: 12.5, fontWeight: FontWeight.w700),
                      ),
                    ],
                    const SizedBox(height: 12),
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      title: Text('Usar proxy', style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w700)),
                      subtitle: Text('Recomendado: proxy fixo e exclusivo por perfil.', style: TextStyle(color: wa.textMuted, fontSize: 12)),
                      value: _enabled,
                      onChanged: customerCanConfigure ? (value) => setState(() => _enabled = value) : null,
                    ),
                    DropdownButtonFormField<String>(
                      value: _protocol,
                      decoration: const InputDecoration(labelText: 'Protocolo'),
                      items: const [
                        DropdownMenuItem(value: 'socks5', child: Text('SOCKS5')),
                        DropdownMenuItem(value: 'socks5h', child: Text('SOCKS5H (DNS pelo proxy)')),
                        DropdownMenuItem(value: 'socks4', child: Text('SOCKS4')),
                        DropdownMenuItem(value: 'socks4a', child: Text('SOCKS4A')),
                        DropdownMenuItem(value: 'http', child: Text('HTTP / HTTPS')),
                        DropdownMenuItem(value: 'https', child: Text('HTTPS (túnel seguro)')),
                      ],
                      onChanged: customerCanConfigure ? (value) => setState(() => _protocol = value ?? 'socks5') : null,
                    ),
                    const SizedBox(height: 10),
                    Row(children: [
                      Expanded(child: TextField(controller: _host, enabled: _enabled && customerCanConfigure, decoration: const InputDecoration(labelText: 'Host ou IP'))),
                      const SizedBox(width: 10),
                      SizedBox(width: 105, child: TextField(controller: _port, enabled: _enabled && customerCanConfigure, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Porta'))),
                    ]),
                    const SizedBox(height: 10),
                    TextField(controller: _username, enabled: _enabled && customerCanConfigure, decoration: InputDecoration(labelText: 'Usuário (opcional)', hintText: _bundle?.proxy.hasUsername == true ? 'Já configurado' : null)),
                    const SizedBox(height: 10),
                    TextField(controller: _password, enabled: _enabled && customerCanConfigure, obscureText: true, decoration: InputDecoration(labelText: 'Senha (opcional)', hintText: _bundle?.proxy.hasPassword == true ? 'Já configurada' : null)),
                    if (policy != null && policy.monthlyPrice > 0) ...[
                      const SizedBox(height: 12),
                      Text(policy.mode == 'automatic'
                          ? 'Proxy gerenciado pelo master: R\$ ${policy.monthlyPrice.toStringAsFixed(2)}/mês.'
                          : 'Venda manual de proxy disponível com ${policy.sellerName ?? 'seu master'}.', style: TextStyle(color: wa.textMuted, fontSize: 12)),
                    ],
                    if (_bundle?.proxy.resolvedIp != null) ...[
                      const SizedBox(height: 12),
                      Text('IP conectado: ${_bundle!.proxy.resolvedIp} · ${_bundle!.proxy.countryName ?? ''}${_bundle!.proxy.regionName == null ? '' : ' · ${_bundle!.proxy.regionName}'}', style: TextStyle(color: const Color(0xFF0EA5E9), fontSize: 12.5, fontWeight: FontWeight.w700)),
                    ],
                  ],
                ),
              ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.of(context).pop(), child: const Text('Cancelar')),
        OutlinedButton.icon(onPressed: _testing || _saving || _loading || !customerCanConfigure ? null : _test, icon: _testing ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.network_check_rounded, size: 17), label: const Text('Testar')),
        FilledButton.icon(onPressed: _saving || _loading || !customerCanConfigure ? null : _save, icon: _saving ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_rounded, size: 17), label: const Text('Salvar')),
      ],
    );
  }
}

class _PairingDialog extends ConsumerStatefulWidget {
  const _PairingDialog({
    required this.instance,
    required this.payload,
    required this.onConnected,
  });

  final BotInstance instance;
  final PairingPayload payload;
  final VoidCallback onConnected;

  @override
  ConsumerState<_PairingDialog> createState() => _PairingDialogState();
}

class _PairingDialogState extends ConsumerState<_PairingDialog> {
  Timer? _poll;
  bool _connected = false;
  bool _checking = true;
  String? _status;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _check());
    _check();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    try {
      final status = await ref
          .read(apiClientProvider)
          .refreshInstanceStatus(widget.instance.id);
      if (!mounted) return;
      setState(() => _status = status);
      final ok =
          status.toLowerCase().contains('conect') &&
          !status.toLowerCase().contains('desconect');
      if (ok) {
        _poll?.cancel();
        setState(() {
          _connected = true;
          _checking = false;
        });
        widget.onConnected();
        await Future<void>.delayed(const Duration(milliseconds: 700));
        if (mounted) Navigator.of(context).maybePop();
      }
    } catch (_) {
      // keep polling
    }
  }

  Widget _qrImage(String raw) {
    final value = raw.trim();
    if (value.startsWith('data:image')) {
      final comma = value.indexOf(',');
      if (comma > 0) {
        final bytes = base64Decode(value.substring(comma + 1));
        return Image.memory(
          bytes,
          width: 240,
          height: 240,
          fit: BoxFit.contain,
        );
      }
    }
    try {
      final bytes = base64Decode(value);
      return Image.memory(bytes, width: 240, height: 240, fit: BoxFit.contain);
    } catch (_) {
      return Image.network(value, width: 240, height: 240, fit: BoxFit.contain);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final code = widget.payload.linkingCode?.trim();
    final qr = widget.payload.qrCode?.trim();

    return AlertDialog(
      backgroundColor: wa.panel,
      title: Text(
        _connected ? 'Conectado!' : 'Conectar ${widget.instance.name}',
        style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w800),
      ),
      content: SizedBox(
        width: 320,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_connected)
              Icon(Icons.check_circle_rounded, color: wa.accent, size: 56)
            else ...[
              if (code != null && code.isNotEmpty) ...[
                Text(
                  'Código de pareamento',
                  style: TextStyle(color: wa.textMuted, fontSize: 13),
                ),
                const SizedBox(height: 8),
                SelectableText(
                  code,
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2,
                  ),
                ),
                const SizedBox(height: 14),
              ],
              if (qr != null && qr.isNotEmpty) ...[
                Text(
                  'Escaneie o QR Code no WhatsApp',
                  style: TextStyle(color: wa.textMuted, fontSize: 13),
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: ColoredBox(
                    color: Colors.white,
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: _qrImage(qr),
                    ),
                  ),
                ),
              ],
              if ((code == null || code.isEmpty) &&
                  (qr == null || qr.isEmpty)) ...[
                Text(
                  'Não recebemos QR nem código. Tente novamente.',
                  style: TextStyle(color: wa.textSecondary),
                ),
              ],
              const SizedBox(height: 14),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (_checking)
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  if (_checking) const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      _status == null
                          ? 'Aguardando pareamento no celular…'
                          : 'Status: $_status',
                      style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(_connected ? 'Fechar' : 'Cancelar'),
        ),
      ],
    );
  }
}
