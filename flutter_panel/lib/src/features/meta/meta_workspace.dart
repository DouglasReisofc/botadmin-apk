import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:app_links/app_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:async';
import '../../core/api_client.dart';
import '../../core/app_config.dart';
import 'meta_onboarding_frame.dart';

class MetaPlatformWorkspace extends ConsumerStatefulWidget {
  const MetaPlatformWorkspace({super.key});
  @override
  ConsumerState<MetaPlatformWorkspace> createState() =>
      _MetaPlatformWorkspaceState();
}

class _MetaPlatformWorkspaceState extends ConsumerState<MetaPlatformWorkspace> {
  final appId = TextEditingController();
  final configId = TextEditingController();
  final secret = TextEditingController();
  final version = TextEditingController(text: 'v25.0');
  bool enabled = false, busy = true, secretPresent = false;
  String callbackUrl = '', verifyToken = '';
  List<dynamic> queue = [], failures = [], groupEvents = [];
  String? error;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    appId.dispose();
    configId.dispose();
    secret.dispose();
    version.dispose();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final result = await ref
          .read(apiClientProvider)
          .getJson('/api/admin/meta/platform');
      final data = result['platform'] as Map;
      if (!mounted) return;
      final configuredAppId = '${data['appId'] ?? ''}';
      final configuredConfigId = '${data['configId'] ?? ''}';
      appId.text = configuredAppId.isNotEmpty
          ? configuredAppId
          : '1152037773010407';
      configId.text = configuredConfigId.isNotEmpty
          ? configuredConfigId
          : '903119712177389';
      version.text = '${data['apiVersion'] ?? 'v25.0'}';
      setState(() {
        enabled = data['enabled'] == true;
        secretPresent = data['appSecretPresent'] == true;
        callbackUrl = '${data['callbackUrl'] ?? ''}';
        verifyToken = '${data['verifyToken'] ?? ''}';
        queue = result['queue'] as List? ?? [];
        failures = result['failures'] as List? ?? [];
        groupEvents = result['groupEvents'] as List? ?? [];
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> save() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .putJson(
            '/api/admin/meta/platform',
            data: {
              'appId': appId.text,
              'configId': configId.text,
              'apiVersion': version.text,
              'enabled': enabled,
              if (secret.text.trim().isNotEmpty) 'appSecret': secret.text,
            },
          );
      secret.clear();
      if (mounted) {
        await load();
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Integração Meta salva.')));
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      Text('Meta API', style: Theme.of(context).textTheme.headlineMedium),
      const SizedBox(height: 8),
      const Text('Conexão oficial e coexistência com o WhatsApp Business.'),
      const SizedBox(height: 24),
      Align(
        alignment: Alignment.topLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Oferecer conexão oficial aos clientes'),
                    value: enabled,
                    onChanged: busy ? null : (v) => setState(() => enabled = v),
                  ),
                  for (final field in [
                    (appId, 'ID do aplicativo Meta'),
                    (configId, 'ID da configuração do cadastro integrado'),
                    (version, 'Versão da Graph API'),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: TextField(
                        controller: field.$1,
                        enabled: !busy,
                        decoration: InputDecoration(
                          labelText: field.$2,
                          border: const OutlineInputBorder(),
                        ),
                      ),
                    ),
                  TextField(
                    controller: secret,
                    enabled: !busy,
                    obscureText: true,
                    enableSuggestions: false,
                    autocorrect: false,
                    decoration: InputDecoration(
                      labelText: 'Segredo do aplicativo',
                      helperText: secretPresent
                          ? 'Já configurado. Deixe vazio para preservar.'
                          : 'Salvo criptografado; nunca exibido ao cliente.',
                      border: const OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 20),
                  if (callbackUrl.isNotEmpty) ...[
                    SelectableText('Webhook: $callbackUrl'),
                    const SizedBox(height: 8),
                    SelectableText('Token de verificação: $verifyToken'),
                    const SizedBox(height: 16),
                  ],
                  const Text(
                    'Configure o cadastro integrado para clientes e habilite a coexistência no aplicativo Meta. A aprovação e a elegibilidade são verificadas pela Meta durante a conexão.',
                  ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: SelectableText(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  const SizedBox(height: 20),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: busy ? null : save,
                      icon: const Icon(Icons.save_outlined),
                      label: Text(busy ? 'Carregando…' : 'Salvar configuração'),
                    ),
                  ),
                  if (queue.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        'Webhooks: ${queue.map((row) => '${row['status']}: ${row['total']}').join(' · ')}',
                      ),
                    ),
                  for (final failure in failures)
                    ListTile(
                      leading: const Icon(Icons.error_outline),
                      title: Text(
                        'Evento ${failure['id']} · ${failure['attempts']} tentativas',
                      ),
                      subtitle: Text('${failure['error_message']}'),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
      const SizedBox(height: 16),
      Align(
        alignment: Alignment.topLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Eventos de grupos Meta',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Os eventos recebidos ficam disponíveis aqui para inspeção e tratamento no painel.',
                  ),
                  const SizedBox(height: 12),
                  if (groupEvents.isEmpty)
                    const Text('Nenhum evento de grupo recebido ainda.'),
                  for (final event in groupEvents)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.groups_outlined),
                      title: Text(
                        '${event['event_type'] ?? event['field']} · ${event['group_id']}',
                      ),
                      subtitle: Text(
                        '${event['field']} · ${event['received_at']}',
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    ],
  );
}

Future<bool> openMetaProfileConnection(
  BuildContext context,
  WidgetRef ref, {
  required String purpose,
  String? profileName,
  int? instanceId,
}) async {
  try {
    final data = await ref
        .read(apiClientProvider)
        .getJson('/api/meta/connection');
    if (!context.mounted) return false;
    final onboarding = data['onboarding'] as Map? ?? {};
    if (onboarding['ready'] != true) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'A conexão Meta ainda não foi configurada pelo administrador.',
          ),
        ),
      );
      return false;
    }
    final rows = data['connections'] as List? ?? [];
    final isDark = Theme.of(context).brightness == Brightness.dark;
    var resolvedInstanceId = instanceId;
    if (resolvedInstanceId == null &&
        profileName == 'Painel admin (Meta)' &&
        rows.length == 1) {
      resolvedInstanceId = int.tryParse('${rows.first['instanceId']}');
    }
    final createdPendingProfile = resolvedInstanceId == null;
    String? connectionContext;
    {
      final prepared = await ref
          .read(apiClientProvider)
          .postJson(
            '/api/meta/onboarding/start',
            data: {
              'purpose': purpose,
              'name': profileName?.trim() ?? '',
              'native': !kIsWeb,
              if (resolvedInstanceId != null) 'instanceId': resolvedInstanceId,
            },
          );
      if (!context.mounted) return false;
      resolvedInstanceId = int.tryParse('${prepared['instanceId']}');
      connectionContext = prepared['context']?.toString();
      if (resolvedInstanceId == null) {
        throw Exception(
          'O perfil Meta foi autorizado, mas não pôde ser preparado.',
        );
      }
    }
    final url = Uri.parse('${AppConfig.apiBaseUrl}/api/meta/onboarding/frame')
        .replace(
          queryParameters: {
            'purpose': purpose,
            'theme': isDark ? 'dark' : 'light',
            if (profileName?.trim().isNotEmpty == true)
              'name': profileName!.trim(),
            'instanceId': '$resolvedInstanceId',
            if (connectionContext != null) 'context': connectionContext,
          },
        );
    final connected =
        await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (_) => _MetaOnboardingDialog(
            url: url.toString(),
            instanceId: resolvedInstanceId!,
            existingPhoneNumberIds: rows
                .map((row) => '${row['phoneNumberId']}')
                .toSet(),
          ),
        ) ==
        true;
    // A new Meta profile is intentionally saved before opening Meta. If the
    // user closes the signup or Meta needs another step, keep it visible as
    // pending instead of silently losing the profile they just configured.
    return connected || createdPendingProfile;
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$error')));
    }
    return false;
  }
}

class _MetaOnboardingDialog extends ConsumerStatefulWidget {
  const _MetaOnboardingDialog({
    required this.url,
    required this.instanceId,
    required this.existingPhoneNumberIds,
  });

  final String url;
  final int instanceId;
  final Set<String> existingPhoneNumberIds;

  @override
  ConsumerState<_MetaOnboardingDialog> createState() =>
      _MetaOnboardingDialogState();
}

class _MetaOnboardingDialogState extends ConsumerState<_MetaOnboardingDialog>
    with WidgetsBindingObserver {
  StreamSubscription<Uri>? _returnSubscription;
  bool _returnedFromMeta = false;
  Timer? _poll;
  Timer? _closeAfterSuccess;
  bool _checking = true;
  bool _connected = false;
  bool _pending = false;
  bool _checkingRequest = false;
  bool _closing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (!kIsWeb) {
      _returnSubscription = AppLinks().uriLinkStream.listen((uri) {
        if (uri.scheme == 'botadmin' &&
            uri.host == 'meta-connected' &&
            uri.queryParameters['instanceId'] == '${widget.instanceId}') {
          _returnedFromMeta = true;
          _checkConnection();
        }
      });
    }
    _checkConnection();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!_connected) _checkConnection();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _returnSubscription?.cancel();
    _poll?.cancel();
    _closeAfterSuccess?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _checkConnection();
  }

  void _finishConnection({bool pending = false}) {
    if (!mounted || _closing) return;
    _closing = true;
    _poll?.cancel();
    setState(() {
      _connected = !pending;
      _pending = pending;
      _checking = false;
      _error = null;
    });
    if (!kIsWeb) {
      unawaited(
        const MethodChannel(
          'botadmin/native',
        ).invokeMethod<bool>('returnFromMeta').catchError((_) => false),
      );
    }
    // Let the success state render briefly, then return to the profiles panel.
    // The caller invalidates and reloads the profile list when this dialog
    // returns true.
    _closeAfterSuccess = Timer(const Duration(milliseconds: 450), () {
      if (mounted) Navigator.of(context).pop(true);
    });
  }

  Future<void> _checkConnection() async {
    if (_checkingRequest || _connected) return;
    _checkingRequest = true;
    try {
      final result = await ref
          .read(apiClientProvider)
          .getJson('/api/meta/connection');
      final rows = result['connections'] as List? ?? [];
      final pendingIds = (result['onboardingPendingInstanceIds'] as List? ?? [])
          .map((id) => '$id')
          .toSet();
      if (!mounted) return;
      final hasNewConnection = rows.any(
        (row) =>
            '${row['instanceId']}' == '${widget.instanceId}' &&
            row['status'] == 'connected' &&
            (_returnedFromMeta ||
                !pendingIds.contains('${widget.instanceId}') ||
                !widget.existingPhoneNumberIds.contains(
                  '${row['phoneNumberId']}',
                )),
      );
      if (hasNewConnection) {
        _finishConnection();
        return;
      }
      setState(() {
        _checking = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _checking = false;
        _error = '$e';
      });
    } finally {
      _checkingRequest = false;
    }
  }

  void _onConnected() {
    _finishConnection();
  }

  void _onPending() {
    _finishConnection(pending: true);
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final compact = size.width < 700;
    return Dialog(
      insetPadding: EdgeInsets.all(compact ? 8 : 24),
      clipBehavior: Clip.antiAlias,
      child: SizedBox(
        width: compact ? size.width : 680,
        height: (compact ? 600.0 : 560.0)
            .clamp(0.0, size.height * .94)
            .toDouble(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(
                compact ? 16 : 24,
                compact ? 12 : 18,
                compact ? 8 : 12,
                compact ? 12 : 18,
              ),
              child: Row(
                children: [
                  const Icon(Icons.verified_user_outlined),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Conectar WhatsApp Business',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        if (!compact)
                          const Text(
                            'Cadastro seguro fornecido pela Meta',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Fechar',
                    onPressed: () => Navigator.of(context).pop(_connected),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            if (_connected || _pending)
              MaterialBanner(
                content: Text(
                  _pending
                      ? 'Perfil Meta salvo. A conexão ficou pendente e pode ser retomada pelo painel.'
                      : 'WhatsApp conectado. Feche esta janela para atualizar o painel.',
                ),
                leading: Icon(
                  _pending
                      ? Icons.hourglass_top_rounded
                      : Icons.check_circle_outline,
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(true),
                    child: const Text('Concluir'),
                  ),
                ],
              )
            else if (_error != null && !_checking)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                child: Text(
                  'Não foi possível consultar a conexão: $_error',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            Expanded(
              child: Padding(
                padding: EdgeInsets.all(compact ? 8 : 16),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: MetaOnboardingFrame(
                    url: widget.url,
                    onConnected: _onConnected,
                    onPending: _onPending,
                  ),
                ),
              ),
            ),
            if (!_connected)
              Padding(
                padding: EdgeInsets.fromLTRB(
                  compact ? 16 : 24,
                  0,
                  compact ? 16 : 24,
                  compact ? 12 : 18,
                ),
                child: Row(
                  children: [
                    const Icon(Icons.lock_outline, size: 17),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        'A autorização e a escolha da conta acontecem diretamente na Meta.',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (_checking)
                      const Padding(
                        padding: EdgeInsets.only(left: 12),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
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
