import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:file_selector/file_selector.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/app_config.dart';
import '../../core/app_ready.dart';
import '../../core/auth_redirect.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/theme_controller.dart';
import '../../core/top_toast.dart';
import '../../core/wa_theme.dart';
import '../../models/admin_support.dart';
import '../../models/migration_models.dart';
import '../auth/auth_controller.dart';

enum AdminPanelSection {
  support,
  users,
  instances,
  plans,
  partners,
  payments,
  campaigns,
  botinterage,
  settings,
}

final adminSectionProvider =
    NotifierProvider<AdminSectionController, AdminPanelSection>(
      AdminSectionController.new,
    );

final adminSupportThreadsProvider =
    FutureProvider.autoDispose<List<AdminSupportThreadEntry>>((ref) async {
      return ref.watch(apiClientProvider).loadAdminSupportThreads();
    });

final adminPartnersProvider =
    FutureProvider.autoDispose<List<PartnerMemberSummary>>(
      (ref) => ref.watch(apiClientProvider).loadPartnerMembers(),
    );

final selectedAdminSupportThreadProvider =
    NotifierProvider<
      SelectedAdminSupportThreadController,
      AdminSupportThreadEntry?
    >(SelectedAdminSupportThreadController.new);

final adminSupportConversationProvider =
    FutureProvider.autoDispose<AdminSupportConversation?>((ref) async {
      final selected = ref.watch(selectedAdminSupportThreadProvider);
      if (selected == null) return null;
      return ref
          .watch(apiClientProvider)
          .loadAdminSupportConversation(
            userId: selected.user.id,
            whatsappId: selected.thread.whatsappId,
          );
    });

final adminInstanceUserFilterProvider =
    NotifierProvider<AdminInstanceUserFilterController, int?>(
      AdminInstanceUserFilterController.new,
    );

Future<List<_AdminRecord>> _loadAdminUsers(
  BotAdminApiClient apiClient, {
  String query = '',
  String filter = 'all',
}) async {
  final params = <String, String>{'pageSize': '100'};
  final normalizedQuery = query.trim();
  if (normalizedQuery.isNotEmpty) {
    params['query'] = normalizedQuery;
  }
  switch (filter) {
    case 'subscription_active':
      params['plan'] = 'with_active';
      break;
    case 'subscription_inactive':
      params['plan'] = 'without_active';
      break;
    case 'account_active':
      params['status'] = 'active';
      break;
    case 'account_blocked':
      params['status'] = 'inactive';
      break;
  }
  final uri = Uri(path: '/api/admin/users/list', queryParameters: params);
  final json = await apiClient.getJson(uri.toString());
  return _jsonList(json['users']).map((item) {
    final active = item['isActive'] == true;
    final sessions = _asInt(item['activeSessions']);
    final hasSubscription = item['hasActiveSubscription'] == true;
    final name = _display(item['name'], fallback: 'Usuário #${item['id']}');
    return _AdminRecord(
      id: _display(item['id']),
      title: name,
      subtitle: _display(
        item['email'],
        fallback: _display(item['whatsappNumber']),
      ),
      badge: active ? 'Ativo' : 'Bloqueado',
      badgeColor: active ? const Color(0xFF00A884) : const Color(0xFFE5484D),
      avatarUrl: item['avatarUrl']?.toString(),
      icon: Icons.person_outline,
      raw: item,
      details: [
        _AdminDetail('ID', _display(item['id'])),
        _AdminDetail('E-mail', _display(item['email'])),
        _AdminDetail('WhatsApp', _display(item['whatsappNumber'])),
        _AdminDetail('Função', _display(item['role'])),
        _AdminDetail('Saldo', _money(item['balance'])),
        _AdminDetail('Sessões ativas', '$sessions'),
        _AdminDetail(
          'Assinatura',
          hasSubscription ? 'Ativa' : 'Sem assinatura ativa',
        ),
        _AdminDetail('Criado em', _formatDate(item['createdAt'])),
        _AdminDetail('Último acesso', _formatDate(item['lastSessionAt'])),
      ],
    );
  }).toList();
}

final adminUsersProvider = FutureProvider.autoDispose<List<_AdminRecord>>(
  (ref) => _loadAdminUsers(ref.watch(apiClientProvider)),
);

final adminBotInterageProvider = FutureProvider.autoDispose<List<_AdminRecord>>((
  ref,
) async {
  final json = await ref
      .watch(apiClientProvider)
      .getJson('/api/admin/botinterage/integrations');
  return _jsonList(json['integrations']).map((item) {
    final provider = _display(item['provider'], fallback: 'groq');
    final providerLabel = switch (provider) {
      'openai' => 'ChatGPT oficial',
      'chatgpt_system' => 'ChatGPT Sistema',
      _ => 'Groq',
    };
    final masked = item['maskedKeys'] is List
        ? (item['maskedKeys'] as List)
              .map((entry) => entry.toString())
              .join(', ')
        : '';
    return _AdminRecord(
      id: _display(item['id']),
      title: _display(item['groupName'], fallback: 'Grupo #${item['groupId']}'),
      subtitle:
          '${_display(item['userName'], fallback: 'Usuário')} · $providerLabel',
      badge: item['hasKey'] == true ? 'Pronto' : 'Sem chave',
      badgeColor: item['hasKey'] == true
          ? const Color(0xFF00A884)
          : const Color(0xFFE5484D),
      icon: Icons.psychology_alt_outlined,
      raw: item,
      details: [
        _AdminDetail('Usuário', _display(item['userName'])),
        _AdminDetail('E-mail', _display(item['userEmail'])),
        _AdminDetail('Grupo', _display(item['groupName'])),
        _AdminDetail('ID do grupo', _display(item['groupId'])),
        _AdminDetail('Provedor', providerLabel),
        _AdminDetail(
          'Chave',
          provider == 'chatgpt_system'
              ? 'Gerenciada pelo sistema'
              : (masked.isEmpty ? 'Não configurada' : masked),
        ),
        _AdminDetail('Modelo', _display(item['model'])),
        _AdminDetail('Prompt', _display(item['prompt'])),
        _AdminDetail('Atualizado em', _formatDate(item['updatedAt'])),
      ],
    );
  }).toList();
});

_AdminRecord _adminProfileRecord(Map<String, dynamic> item) {
  final profileId = _asInt(item['id']);
  final instanceId = _asIntOrNull(item['instanceId'] ?? item['instance_id']);
  final status = _display(item['sessionStatus'], fallback: 'desconhecido');
  final connected = status == 'conectado';
  final expiry = DateTime.tryParse(
    item['expiresAt']?.toString() ?? item['expires_at']?.toString() ?? '',
  );
  final licenseActive = expiry != null && expiry.isAfter(DateTime.now());
  final badge = !licenseActive
      ? 'Vencido'
      : connected
      ? 'Ativo'
      : instanceId == null
      ? 'Sem sessão'
      : 'Desconectado';
  final badgeColor = !licenseActive
      ? const Color(0xFFE5484D)
      : connected
      ? const Color(0xFF00A884)
      : const Color(0xFFE09F3E);
  final raw = <String, dynamic>{
    ...item,
    'profileId': profileId,
    'instanceId': instanceId,
  };
  return _AdminRecord(
    id: 'profile:$profileId',
    title: _display(item['name'], fallback: 'Perfil #$profileId'),
    subtitle:
        '${_display(item['userName'], fallback: 'Usuário')} · ${_display(item['phone'])}',
    badge: badge,
    badgeColor: badgeColor,
    icon: Icons.account_circle_outlined,
    raw: raw,
    details: [
      _AdminDetail('Perfil', '$profileId'),
      _AdminDetail(
        'Instância',
        instanceId?.toString() ?? 'Ainda não conectada',
      ),
      _AdminDetail('Usuário', _display(item['userName'])),
      _AdminDetail('E-mail', _display(item['userEmail'])),
      _AdminDetail('Telefone', _display(item['phone'])),
      _AdminDetail(
        'Servidor',
        _display(item['serverName'], fallback: 'Sem sessão'),
      ),
      _AdminDetail('Conexão', instanceId == null ? 'Sem sessão' : status),
      _AdminDetail('Licença', licenseActive ? 'Válida' : 'Vencida'),
      _AdminDetail('Expira em', _formatDate(item['expiresAt'])),
      _AdminDetail('Atualizado', _formatDate(item['updatedAt'])),
    ],
  );
}

final adminInstancesProvider = FutureProvider.autoDispose<List<_AdminRecord>>((
  ref,
) async {
  final filterUserId = ref.watch(adminInstanceUserFilterProvider);
  final suffix = filterUserId == null ? '' : '?userId=$filterUserId';
  final json = await ref
      .watch(apiClientProvider)
      .getJson('/api/admin/bot-instances$suffix');
  final source = json.containsKey('profiles')
      ? _jsonList(json['profiles'])
      : _jsonList(json['instances']);
  return source.map(_adminProfileRecord).toList();
});

final adminPlansProvider = FutureProvider.autoDispose<List<_AdminRecord>>((
  ref,
) async {
  final json = await ref.watch(apiClientProvider).getJson('/api/admin/plans');
  return _jsonList(json['plans']).map((item) {
    final active = item['isActive'] == true;
    return _AdminRecord(
      id: _display(item['id']),
      title: _display(item['name'], fallback: 'Plano #${item['id']}'),
      subtitle:
          '${_money(item['price'])} · ${_display(item['durationDays'])} dias',
      badge: active ? 'Ativo' : 'Desativado',
      badgeColor: active ? const Color(0xFF00A884) : const Color(0xFFE5484D),
      icon: Icons.workspace_premium_outlined,
      raw: item,
      details: [
        _AdminDetail('ID', _display(item['id'])),
        _AdminDetail('Preço', _money(item['price'])),
        _AdminDetail(
          'Adicional por perfil',
          _money(item['addonInstancePrice']),
        ),
        _AdminDetail('Adicional por grupo', _money(item['addonGroupPrice'])),
        _AdminDetail('Duração', '${_display(item['durationDays'])} dias'),
        _AdminDetail('Limite de perfis', _display(item['instanceLimit'])),
        _AdminDetail('Limite de grupos', _display(item['groupLimit'])),
        _AdminDetail(
          'Fluxos',
          item['allowFlows'] == true ? 'Liberado' : 'Bloqueado',
        ),
        _AdminDetail('Storage', '${_display(item['storageQuotaGb'])} GB'),
        _AdminDetail('Status', active ? 'Ativo' : 'Desativado'),
        _AdminDetail('Recursos', _enabledPlanFeatures(item['features'])),
        _AdminDetail('Descrição', _display(item['description'])),
      ],
    );
  }).toList();
});

final adminPaymentsProvider = FutureProvider.autoDispose<List<_AdminRecord>>((
  ref,
) async {
  final api = ref.watch(apiClientProvider);
  final results = await Future.wait([
    api.getJson('/api/admin/payments/mercadopago'),
    api.getJson('/api/admin/payments/polopag'),
    api.getJson('/api/admin/payments/mercadopago/checkout'),
    api.getJson('/api/admin/payments/mercadopago/marketplace'),
  ]);
  final records = <_AdminRecord>[];
  for (final entry in [
    ('mercadopago', 'Mercado Pago PIX', results[0]['config']),
    ('polopag', 'PoloPag PIX', results[1]['config']),
    ('mercadopago-checkout', 'Mercado Pago Checkout', results[2]['config']),
    (
      'mercadopago-marketplace',
      'Mercado Pago Marketplace / Split',
      results[3]['config'],
    ),
  ]) {
    final config = _jsonMap(entry.$3);
    final active = config['isActive'] == true;
    final isMarketplace = entry.$1 == 'mercadopago-marketplace';
    records.add(
      _AdminRecord(
        id: entry.$1,
        title: entry.$2,
        subtitle: isMarketplace
            ? 'OAuth e divisão automática para parceiros'
            : _display(config['displayName']),
        badge: isMarketplace
            ? (active ? 'Configurado' : 'Não configurado')
            : (active ? 'Ativo' : 'Desativado'),
        badgeColor: active ? const Color(0xFF00A884) : const Color(0xFFE5484D),
        icon: isMarketplace
            ? Icons.hub_outlined
            : Icons.account_balance_wallet_outlined,
        raw: config,
        details: isMarketplace
            ? [
                _AdminDetail(
                  'Credenciais',
                  config['isConfigured'] == true
                      ? 'Client ID e Secret cadastrados'
                      : 'Cadastro pendente',
                ),
                _AdminDetail(
                  'Client ID',
                  _jsonMap(config['credentialFields'])['marketplaceClientId'] ==
                          true
                      ? 'Cadastrado'
                      : 'Não cadastrado',
                ),
                _AdminDetail(
                  'Client Secret',
                  _jsonMap(
                            config['credentialFields'],
                          )['marketplaceClientSecret'] ==
                          true
                      ? 'Protegido'
                      : 'Não cadastrado',
                ),
                _AdminDetail('Redirect URI', _display(config['redirectUri'])),
                _AdminDetail('Atualizado', _formatDate(config['updatedAt'])),
              ]
            : [
                _AdminDetail('Nome', _display(config['displayName'])),
                _AdminDetail(
                  'Configurado',
                  config['isConfigured'] == true ? 'Sim' : 'Não',
                ),
                _AdminDetail(
                  'Expiração PIX',
                  config['pixExpirationMinutes'] == null
                      ? 'Não se aplica'
                      : '${_display(config['pixExpirationMinutes'])} min',
                ),
                _AdminDetail(
                  'Valores sugeridos',
                  config['amountOptions'] is List
                      ? (config['amountOptions'] as List).join(', ')
                      : 'Não informado',
                ),
                _AdminDetail('Atualizado', _formatDate(config['updatedAt'])),
                _AdminDetail(
                  'Webhook',
                  _display(config['webhookUrl'] ?? config['notificationUrl']),
                ),
              ],
      ),
    );
  }
  return records;
});

final adminPaymentHistoryProvider =
    FutureProvider.autoDispose<List<_AdminRecord>>((ref) async {
      final json = await ref
          .watch(apiClientProvider)
          .getJson('/api/admin/sales-events?limit=100');
      return _jsonList(json['events']).map((item) {
        return _AdminRecord(
          id: 'sale-${_display(item['id'])}',
          title: _display(
            item['customerName'],
            fallback: 'Venda #${item['id']}',
          ),
          subtitle: _display(item['message']),
          badge: _display(item['status']),
          badgeColor: item['status'] == 'approved'
              ? const Color(0xFF00A884)
              : const Color(0xFFE0A100),
          icon: Icons.receipt_long_outlined,
          raw: item,
          details: [
            _AdminDetail('Cliente', _display(item['customerName'])),
            _AdminDetail('E-mail', _display(item['customerEmail'])),
            _AdminDetail('Plano', _display(item['planName'])),
            _AdminDetail('Valor', _money(item['amount'])),
            _AdminDetail('Status', _display(item['status'])),
            _AdminDetail('Gateway', _display(item['provider'])),
            _AdminDetail('Data', _formatDate(item['createdAt'])),
          ],
        );
      }).toList();
    });

final adminCampaignsProvider = FutureProvider.autoDispose<List<_AdminRecord>>((
  ref,
) async {
  final json = await ref
      .watch(apiClientProvider)
      .getJson('/api/admin/campaigns');
  return _jsonList(json['campaigns']).map((item) {
    final stats = _jsonMap(item['stats']);
    return _AdminRecord(
      id: _display(item['campaignId'] ?? item['id']),
      title: _display(item['name'], fallback: 'Campanha #${item['id']}'),
      subtitle: _display(
        item['description'],
        fallback: _display(item['templateName']),
      ),
      badge: _display(item['status']),
      badgeColor: const Color(0xFF00A884),
      icon: Icons.campaign_outlined,
      raw: item,
      details: [
        _AdminDetail('ID', _display(item['campaignId'] ?? item['id'])),
        _AdminDetail('Template', _display(item['templateName'])),
        _AdminDetail('Status', _display(item['status'])),
        _AdminDetail('Contatos', _display(stats['totalContacts'])),
        _AdminDetail('Enviados', _display(stats['sentContacts'])),
        _AdminDetail('Falhas', _display(stats['failedContacts'])),
        _AdminDetail('Criada em', _formatDate(item['createdAt'])),
        _AdminDetail('Atualizada', _formatDate(item['updatedAt'])),
      ],
    );
  }).toList();
});

final adminSettingsProvider = FutureProvider.autoDispose<List<_AdminRecord>>((
  ref,
) async {
  final api = ref.watch(apiClientProvider);
  final results = await Future.wait([
    api.getJson('/api/admin/site'),
    api
        .getJson('/api/admin/notifications/smtp')
        .catchError((_) => <String, dynamic>{'settings': const {}}),
    api
        .getJson('/api/admin/firebase/settings')
        .catchError((_) => <String, dynamic>{'settings': const {}}),
    api
        .getJson('/api/admin/mobile/settings')
        .catchError((_) => <String, dynamic>{'settings': const {}}),
    api
        .getJson('/api/admin/whatsapp-verification')
        .catchError((_) => <String, dynamic>{'settings': const {}}),
    api
        .getJson('/api/admin/system-instance')
        .catchError(
          (_) => <String, dynamic>{'instance': null, 'servers': const []},
        ),
    api
        .getJson('/api/admin/push/subscribers')
        .catchError((_) => <String, dynamic>{'subscribers': const []}),
  ]);
  final settings = _jsonMap(results[0]['settings']);
  final smtpSettings = _jsonMap(results[1]['settings']);
  final firebaseSettings = _jsonMap(results[2]['settings']);
  final mobileSettings = _jsonMap(results[3]['settings']);
  final whatsappVerification = _jsonMap(results[4]['settings']);
  final systemInstanceResponse = _jsonMap(results[5]);
  final systemInstance = _jsonMap(systemInstanceResponse['instance']);
  final systemServers = _jsonList(systemInstanceResponse['servers']);
  final subscribers = _jsonList(results[6]['subscribers']);
  final whatsappEnabled = whatsappVerification['enabled'] != false;
  final whatsappMode =
      _display(whatsappVerification['mode'], fallback: 'user_sends_code') ==
      'send_code';
  final hasSystemInstance = systemInstance.isNotEmpty;
  final systemStatus = hasSystemInstance
      ? _display(systemInstance['sessionStatus'], fallback: 'desconectado')
      : 'não configurada';
  final systemConnected = systemStatus == 'conectado';
  return [
    _AdminRecord(
      id: 'site',
      title: _display(settings['siteName'], fallback: 'Site público'),
      subtitle: _display(settings['supportEmail']),
      badge: 'Site',
      badgeColor: const Color(0xFF00A884),
      icon: Icons.language_outlined,
      raw: settings,
      avatarUrl: settings['logoUrl']?.toString(),
      details: [
        _AdminDetail('Nome', _display(settings['siteName'])),
        _AdminDetail('Suporte', _display(settings['supportEmail'])),
        _AdminDetail('WhatsApp', _display(settings['supportWhatsappNumber'])),
        _AdminDetail('Canal', _display(settings['supportChannel'])),
        _AdminDetail('URL', _display(settings['supportUrl'])),
        _AdminDetail('SEO', _display(settings['seoTitle'])),
        _AdminDetail(
          'Favicon',
          _display(settings['faviconUrl'], fallback: 'Favicon padrão'),
        ),
      ],
    ),
    _AdminRecord(
      id: 'smtp',
      title: 'SMTP e e-mails',
      subtitle: _display(
        smtpSettings['host'],
        fallback: 'Envio de e-mails transacionais',
      ),
      badge: smtpSettings['isConfigured'] == true ? 'Configurado' : 'Pendente',
      badgeColor: smtpSettings['isConfigured'] == true
          ? const Color(0xFF00A884)
          : const Color(0xFFE5A400),
      icon: Icons.mark_email_read_outlined,
      raw: smtpSettings,
      details: [
        _AdminDetail('Host', _display(smtpSettings['host'])),
        _AdminDetail('Porta', _display(smtpSettings['port'])),
        _AdminDetail('Seguro', smtpSettings['secure'] == true ? 'Sim' : 'Não'),
        _AdminDetail('Usuário', _display(smtpSettings['username'])),
        _AdminDetail('Remetente', _display(smtpSettings['fromName'])),
        _AdminDetail('E-mail remetente', _display(smtpSettings['fromEmail'])),
        _AdminDetail('Responder para', _display(smtpSettings['replyTo'])),
        _AdminDetail(
          'Senha',
          smtpSettings['hasPassword'] == true ? 'Salva' : 'Não salva',
        ),
        _AdminDetail('Atualizada', _formatDate(smtpSettings['updatedAt'])),
      ],
    ),
    _AdminRecord(
      id: 'firebase',
      title: 'Firebase e push',
      subtitle: _display(
        firebaseSettings['webProjectId'] ?? firebaseSettings['projectId'],
        fallback: 'Credenciais web, push e service account',
      ),
      badge:
          (_display(firebaseSettings['webApiKey']).isNotEmpty ||
              _display(firebaseSettings['projectId']).isNotEmpty)
          ? 'Configurado'
          : 'Pendente',
      badgeColor:
          (_display(firebaseSettings['webApiKey']).isNotEmpty ||
              _display(firebaseSettings['projectId']).isNotEmpty)
          ? const Color(0xFF00A884)
          : const Color(0xFFE5A400),
      icon: Icons.cloud_sync_outlined,
      raw: firebaseSettings,
      details: [
        _AdminDetail('Project ID', _display(firebaseSettings['projectId'])),
        _AdminDetail('Web Project', _display(firebaseSettings['webProjectId'])),
        _AdminDetail(
          'Auth Domain',
          _display(firebaseSettings['webAuthDomain']),
        ),
        _AdminDetail(
          'Sender ID',
          _display(firebaseSettings['webMessagingSenderId']),
        ),
        _AdminDetail('App ID', _display(firebaseSettings['webAppId'])),
        _AdminDetail(
          'Measurement',
          _display(firebaseSettings['webMeasurementId']),
        ),
        _AdminDetail(
          'VAPID',
          _display(firebaseSettings['vapidKey']).isNotEmpty ? 'Salva' : 'Vazia',
        ),
      ],
    ),
    _AdminRecord(
      id: 'mobile',
      title: 'Aplicativo mobile',
      subtitle: _display(
        mobileSettings['packageName'],
        fallback: 'Pacote, versão, servidor e onboarding',
      ),
      badge: _display(mobileSettings['versionName'], fallback: 'App'),
      badgeColor: const Color(0xFF00A884),
      icon: Icons.phone_android_outlined,
      raw: mobileSettings,
      details: [
        _AdminDetail('Nome', _display(mobileSettings['appName'])),
        _AdminDetail('Pacote', _display(mobileSettings['packageName'])),
        _AdminDetail('Version code', _display(mobileSettings['versionCode'])),
        _AdminDetail('Versão', _display(mobileSettings['versionName'])),
        _AdminDetail('Servidor', _display(mobileSettings['serverUrl'])),
        _AdminDetail('Mínima', _display(mobileSettings['minVersionCode'])),
        _AdminDetail(
          'Onboarding',
          mobileSettings['onboardingEnabled'] == true ? 'Ligado' : 'Desligado',
        ),
        _AdminDetail('Atualizada', _formatDate(mobileSettings['updatedAt'])),
      ],
    ),
    _AdminRecord(
      id: 'system-instance',
      title: 'Instância do painel admin',
      subtitle: hasSystemInstance
          ? '${_display(systemInstance['name'])} · ${_display(systemInstance['phone'])}'
          : 'Responsável por confirmar cadastros via WhatsApp',
      badge: hasSystemInstance
          ? (systemConnected ? 'Conectada' : systemStatus)
          : 'Configurar',
      badgeColor: hasSystemInstance
          ? (systemConnected
                ? const Color(0xFF00A884)
                : const Color(0xFFE5A400))
          : const Color(0xFFE5484D),
      icon: Icons.admin_panel_settings_outlined,
      raw: {'instance': systemInstance, 'servers': systemServers},
      details: [
        _AdminDetail('ID', _display(systemInstance['id'])),
        _AdminDetail('Nome', _display(systemInstance['name'])),
        _AdminDetail('Telefone', _display(systemInstance['phone'])),
        _AdminDetail('Servidor', _display(systemInstance['serverName'])),
        _AdminDetail('Status', systemStatus),
        _AdminDetail('Atualizada', _formatDate(systemInstance['updatedAt'])),
      ],
    ),
    _AdminRecord(
      id: 'whatsapp-verification',
      title: 'Verificação de WhatsApp',
      subtitle: whatsappEnabled
          ? (whatsappMode
                ? 'Instância envia código ao usuário'
                : 'Usuário envia código para o bot')
          : 'Cadastro sem confirmação obrigatória',
      badge: whatsappEnabled ? 'Ativa' : 'Desligada',
      badgeColor: whatsappEnabled
          ? const Color(0xFF00A884)
          : const Color(0xFFE5484D),
      icon: Icons.verified_user_outlined,
      raw: whatsappVerification,
      details: [
        _AdminDetail('Obrigatória', whatsappEnabled ? 'Sim' : 'Não'),
        _AdminDetail(
          'Modo',
          whatsappMode ? 'Bot envia código' : 'Usuário envia código',
        ),
        _AdminDetail(
          'Número destino',
          _display(whatsappVerification['targetWhatsappNumber']),
        ),
        _AdminDetail(
          'Instruções',
          _display(whatsappVerification['instructions']),
        ),
        _AdminDetail('Suporte', _display(whatsappVerification['supportText'])),
      ],
    ),
    _AdminRecord(
      id: 'push',
      title: 'Push e notificações',
      subtitle: '${subscribers.length} inscritos carregados',
      badge: 'Push',
      badgeColor: const Color(0xFF00A884),
      icon: Icons.notifications_active_outlined,
      raw: {'subscribers': subscribers},
      details: [
        _AdminDetail('Inscritos', '${subscribers.length}'),
        _AdminDetail('Status', 'Configuração carregada'),
      ],
    ),
  ];
});

class AdminSectionController extends Notifier<AdminPanelSection> {
  final List<AdminPanelSection> _history = <AdminPanelSection>[];

  @override
  AdminPanelSection build() => AdminPanelSection.support;

  void select(AdminPanelSection section, {bool recordHistory = true}) {
    if (state == section) return;
    if (recordHistory) {
      _history.add(state);
    }
    state = section;
  }

  bool selectPrevious() {
    while (_history.isNotEmpty) {
      final previous = _history.removeLast();
      if (previous == state) continue;
      state = previous;
      return true;
    }
    return false;
  }
}

class AdminInstanceUserFilterController extends Notifier<int?> {
  @override
  int? build() => null;

  void setUserId(int userId) => state = userId;

  void clear() => state = null;
}

class SelectedAdminSupportThreadController
    extends Notifier<AdminSupportThreadEntry?> {
  @override
  AdminSupportThreadEntry? build() => null;

  void select(AdminSupportThreadEntry? entry) => state = entry;
}

class AdminDashboardShell extends ConsumerWidget {
  const AdminDashboardShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(themeControllerProvider);
    final wa = WaTheme.of(context);
    final section = ref.watch(adminSectionProvider);
    final session = ref.watch(authControllerProvider).value;
    final compact = MediaQuery.sizeOf(context).width < 760;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      signalAppReady();
    });

    final content = switch (section) {
      AdminPanelSection.support => const _AdminSupportWorkspace(),
      AdminPanelSection.users => _AdminRecordsWorkspace(
        title: 'Usuários',
        subtitle: 'Clientes, assinaturas e acesso.',
        icon: Icons.people_alt_outlined,
        recordsAsync: ref.watch(adminUsersProvider),
        onRefresh: () => ref.invalidate(adminUsersProvider),
        remoteSearch: (query, filter) => _loadAdminUsers(
          ref.read(apiClientProvider),
          query: query,
          filter: filter,
        ),
        filters: const [
          _AdminRecordFilter(value: 'all', label: 'Todos'),
          _AdminRecordFilter(
            value: 'subscription_active',
            label: 'Assinatura ativa',
          ),
          _AdminRecordFilter(
            value: 'subscription_inactive',
            label: 'Sem assinatura',
          ),
          _AdminRecordFilter(value: 'account_active', label: 'Conta ativa'),
          _AdminRecordFilter(
            value: 'account_blocked',
            label: 'Conta bloqueada',
          ),
        ],
        actionsBuilder: _userActions,
        leadingAction: Wrap(
          spacing: 8,
          children: [
            FilledButton.icon(
              onPressed: () => _openCreateUserDialog(context, ref),
              icon: const Icon(Icons.person_add_alt_1_outlined, size: 18),
              label: const Text('Novo'),
            ),
            OutlinedButton.icon(
              onPressed: () =>
                  _openEmptyRegistrationCleanupDialog(context, ref),
              icon: const Icon(Icons.delete_sweep_outlined, size: 18),
              label: const Text('Limpar vazios'),
            ),
          ],
        ),
      ),
      AdminPanelSection.instances => _AdminRecordsWorkspace(
        title: 'Perfis',
        subtitle: 'Todos os perfis, conectados ou ainda sem sessão.',
        icon: Icons.account_circle_outlined,
        recordsAsync: ref.watch(adminInstancesProvider),
        onRefresh: () => ref.invalidate(adminInstancesProvider),
        actionsBuilder: _instanceActions,
        filters: const [
          _AdminRecordFilter(value: 'all', label: 'Todos'),
          _AdminRecordFilter(value: 'license_active', label: 'Licença ativa'),
          _AdminRecordFilter(value: 'expired', label: 'Vencidos'),
          _AdminRecordFilter(value: 'connected', label: 'Conectados'),
          _AdminRecordFilter(value: 'without_session', label: 'Sem sessão'),
        ],
        leadingAction: Consumer(
          builder: (context, ref, _) {
            final filter = ref.watch(adminInstanceUserFilterProvider);
            if (filter == null) return const SizedBox.shrink();
            return TextButton.icon(
              onPressed: () {
                ref.read(adminInstanceUserFilterProvider.notifier).clear();
                ref.invalidate(adminInstancesProvider);
              },
              icon: const Icon(Icons.filter_alt_off_outlined, size: 18),
              label: const Text('Todos'),
            );
          },
        ),
      ),
      AdminPanelSection.plans => _AdminRecordsWorkspace(
        title: 'Planos',
        subtitle: 'Produtos principais do BotAdmin.',
        icon: Icons.workspace_premium_outlined,
        recordsAsync: ref.watch(adminPlansProvider),
        onRefresh: () => ref.invalidate(adminPlansProvider),
        actionsBuilder: _planActions,
        leadingAction: FilledButton.icon(
          onPressed: () => _openPlanDialog(context, ref),
          icon: const Icon(Icons.add_rounded, size: 18),
          label: const Text('Novo'),
        ),
      ),
      AdminPanelSection.partners => const _AdminPartnersWorkspace(),
      AdminPanelSection.payments => const _AdminPaymentsWorkspace(),
      AdminPanelSection.campaigns => _AdminRecordsWorkspace(
        title: 'Campanhas',
        subtitle: 'Avisos, tutoriais e anúncios globais.',
        icon: Icons.campaign_outlined,
        recordsAsync: ref.watch(adminCampaignsProvider),
        onRefresh: () => ref.invalidate(adminCampaignsProvider),
      ),
      AdminPanelSection.botinterage => _AdminRecordsWorkspace(
        title: 'BotInterage',
        subtitle: 'Integrações ativas, provedores e credenciais mascaradas.',
        icon: Icons.psychology_alt_outlined,
        recordsAsync: ref.watch(adminBotInterageProvider),
        onRefresh: () => ref.invalidate(adminBotInterageProvider),
        actionsBuilder: _botInterageActions,
        leadingAction: Wrap(
          spacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: () => _openBotInterageUsersDialog(context, ref),
              icon: const Icon(Icons.people_outline, size: 18),
              label: const Text('Usuários'),
            ),
            FilledButton.icon(
              onPressed: () => _openAdminBotInterageConfigDialog(context, ref),
              icon: const Icon(Icons.tune_rounded, size: 18),
              label: const Text('Sistema'),
            ),
          ],
        ),
      ),
      AdminPanelSection.settings => _AdminRecordsWorkspace(
        title: 'Configurações',
        subtitle: session?.user.name ?? 'Administrador',
        icon: Icons.settings_outlined,
        recordsAsync: ref.watch(adminSettingsProvider),
        onRefresh: () => ref.invalidate(adminSettingsProvider),
        actionsBuilder: _settingsActions,
      ),
    };

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _handleAdminBack(context, ref);
      },
      child: Scaffold(
        backgroundColor: wa.shellBg,
        body: SafeArea(
          child: compact
              ? Column(
                  children: [
                    Expanded(child: content),
                    _AdminBottomNav(section: section),
                  ],
                )
              : Row(
                  children: [
                    _AdminRail(section: section),
                    Expanded(child: content),
                  ],
                ),
        ),
      ),
    );
  }
}

void _handleAdminBack(BuildContext context, WidgetRef ref) {
  if (Navigator.of(context).canPop()) {
    Navigator.of(context).maybePop();
    return;
  }

  final section = ref.read(adminSectionProvider);
  if (section == AdminPanelSection.support &&
      ref.read(selectedAdminSupportThreadProvider) != null) {
    ref.read(selectedAdminSupportThreadProvider.notifier).select(null);
    return;
  }

  final sectionController = ref.read(adminSectionProvider.notifier);
  if (sectionController.selectPrevious()) return;

  if (section != AdminPanelSection.support) {
    sectionController.select(AdminPanelSection.support, recordHistory: false);
  }
}

class _AdminRail extends ConsumerWidget {
  const _AdminRail({required this.section});

  final AdminPanelSection section;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);

    return Container(
      width: 76,
      color: wa.rail,
      child: Column(
        children: [
          const SizedBox(height: 10),
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: wa.accentSoft,
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.admin_panel_settings_outlined, color: wa.accent),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 4),
              itemBuilder: (context, index) {
                final item = _adminNavItems[index];
                final selected = item.section == section;
                return Tooltip(
                  message: item.label,
                  waitDuration: const Duration(milliseconds: 450),
                  child: IconButton(
                    onPressed: () => ref
                        .read(adminSectionProvider.notifier)
                        .select(item.section),
                    style: IconButton.styleFrom(
                      backgroundColor: selected
                          ? wa.selectedRow
                          : Colors.transparent,
                      foregroundColor: selected ? wa.accent : wa.icon,
                      fixedSize: const Size(48, 48),
                    ),
                    icon: Icon(item.icon),
                  ),
                );
              },
              separatorBuilder: (_, _) => const SizedBox(height: 4),
              itemCount: _adminNavItems.length,
            ),
          ),
          IconButton(
            tooltip: 'Sair',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout_outlined),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _RailButton {
  const _RailButton(this.section, this.icon, this.label);

  final AdminPanelSection section;
  final IconData icon;
  final String label;
}

const _adminNavItems = [
  _RailButton(
    AdminPanelSection.support,
    Icons.support_agent_outlined,
    'Suporte',
  ),
  _RailButton(AdminPanelSection.users, Icons.people_alt_outlined, 'Usuários'),
  _RailButton(
    AdminPanelSection.instances,
    Icons.account_circle_outlined,
    'Perfis',
  ),
  _RailButton(
    AdminPanelSection.plans,
    Icons.workspace_premium_outlined,
    'Planos',
  ),
  _RailButton(
    AdminPanelSection.partners,
    Icons.handshake_outlined,
    'Parceiros',
  ),
  _RailButton(
    AdminPanelSection.payments,
    Icons.payments_outlined,
    'Pagamentos',
  ),
  _RailButton(
    AdminPanelSection.campaigns,
    Icons.campaign_outlined,
    'Campanhas',
  ),
  _RailButton(
    AdminPanelSection.botinterage,
    Icons.psychology_alt_outlined,
    'BotInterage',
  ),
  _RailButton(AdminPanelSection.settings, Icons.settings_outlined, 'Config'),
];

class _AdminBottomNav extends ConsumerStatefulWidget {
  const _AdminBottomNav({required this.section});

  final AdminPanelSection section;

  @override
  ConsumerState<_AdminBottomNav> createState() => _AdminBottomNavState();
}

class _AdminBottomNavState extends ConsumerState<_AdminBottomNav> {
  final ScrollController _controller = ScrollController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
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
              _AdminMobileNavArrow(
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
                    itemCount: _adminNavItems.length + 1,
                    separatorBuilder: (_, _) => const SizedBox(width: 2),
                    itemBuilder: (context, index) {
                      if (index == _adminNavItems.length) {
                        return SizedBox(
                          width: 82,
                          child: _AdminMobileNavItem(
                            selected: false,
                            icon: Icons.logout_rounded,
                            label: 'Sair',
                            danger: true,
                            onTap: () => ref
                                .read(authControllerProvider.notifier)
                                .logout(),
                          ),
                        );
                      }

                      final item = _adminNavItems[index];
                      return SizedBox(
                        width: 82,
                        child: _AdminMobileNavItem(
                          selected: item.section == widget.section,
                          icon: item.icon,
                          label: item.label,
                          onTap: () => ref
                              .read(adminSectionProvider.notifier)
                              .select(item.section),
                        ),
                      );
                    },
                  ),
                ),
              ),
              _AdminMobileNavArrow(
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

class _AdminMobileNavArrow extends StatelessWidget {
  const _AdminMobileNavArrow({required this.icon, required this.onTap});

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

class _AdminMobileNavItem extends StatelessWidget {
  const _AdminMobileNavItem({
    required this.selected,
    required this.icon,
    required this.label,
    required this.onTap,
    this.danger = false,
  });

  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final dangerColor = Theme.of(context).colorScheme.error;
    final color = danger
        ? dangerColor
        : selected
        ? wa.accent
        : wa.icon;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          padding: const EdgeInsets.symmetric(horizontal: 6),
          decoration: BoxDecoration(
            color: selected ? wa.selectedRow : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? wa.accent : Colors.transparent,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(height: 3),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: danger
                      ? dangerColor
                      : selected
                      ? wa.accent
                      : wa.textSecondary,
                  fontSize: 11,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AdminSupportWorkspace extends ConsumerStatefulWidget {
  const _AdminSupportWorkspace();

  @override
  ConsumerState<_AdminSupportWorkspace> createState() =>
      _AdminSupportWorkspaceState();
}

class _AdminSupportWorkspaceState
    extends ConsumerState<_AdminSupportWorkspace> {
  final _searchController = TextEditingController();
  var _query = '';
  var _filter = 'all';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<AdminSupportThreadEntry> _filterThreads(
    List<AdminSupportThreadEntry> items,
  ) {
    final normalized = _query.trim().toLowerCase();
    return items
        .where((entry) {
          final matchesFilter = switch (_filter) {
            'subscription_active' => entry.user.hasActiveSubscription,
            'subscription_inactive' => !entry.user.hasActiveSubscription,
            'account_active' => entry.user.isActive,
            'account_blocked' => !entry.user.isActive,
            'open' => entry.thread.isOpen,
            'closed' => !entry.thread.isOpen,
            'human' => entry.thread.isHuman,
            'bot' => !entry.thread.isHuman,
            _ => true,
          };
          if (!matchesFilter || normalized.isEmpty) return matchesFilter;
          return [
            entry.displayName,
            entry.user.name,
            entry.user.email,
            entry.user.whatsappNumber,
            entry.thread.displayWhatsappId,
            entry.thread.whatsappId,
            entry.thread.customerName,
            entry.thread.profileName,
          ].whereType<String>().any(
            (value) => value.toLowerCase().contains(normalized),
          );
        })
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 760;
    final threads = ref.watch(adminSupportThreadsProvider);
    final selected = ref.watch(selectedAdminSupportThreadProvider);

    Widget buildListPane() {
      return DecoratedBox(
        decoration: BoxDecoration(
          color: wa.panel,
          border: Border(
            right: compact ? BorderSide.none : BorderSide(color: wa.border),
          ),
        ),
        child: Column(
          children: [
            _AdminPanelHeader(
              title: 'Atendimentos',
              subtitle: 'Conversas de suporte dos usuários',
              actions: [
                IconButton(
                  tooltip: 'Atualizar',
                  onPressed: () => ref.invalidate(adminSupportThreadsProvider),
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 12),
              child: TextField(
                controller: _searchController,
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: 'Pesquisar por nome, e-mail ou WhatsApp',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _query = '');
                          },
                          icon: const Icon(Icons.close),
                        ),
                  fillColor: wa.searchBg,
                ),
              ),
            ),
            SizedBox(
              height: 45,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(18, 0, 18, 8),
                children: [
                  for (final option in const [
                    _AdminRecordFilter(value: 'all', label: 'Todos'),
                    _AdminRecordFilter(
                      value: 'subscription_active',
                      label: 'Assinatura ativa',
                    ),
                    _AdminRecordFilter(
                      value: 'subscription_inactive',
                      label: 'Sem assinatura',
                    ),
                    _AdminRecordFilter(value: 'open', label: 'Abertos'),
                    _AdminRecordFilter(value: 'closed', label: 'Fechados'),
                    _AdminRecordFilter(value: 'human', label: 'Humano'),
                    _AdminRecordFilter(value: 'bot', label: 'Bot'),
                    _AdminRecordFilter(
                      value: 'account_active',
                      label: 'Conta ativa',
                    ),
                    _AdminRecordFilter(
                      value: 'account_blocked',
                      label: 'Conta bloqueada',
                    ),
                  ]) ...[
                    ChoiceChip(
                      label: Text(option.label),
                      selected: _filter == option.value,
                      onSelected: (_) => setState(() => _filter = option.value),
                    ),
                    const SizedBox(width: 8),
                  ],
                ],
              ),
            ),
            Expanded(
              child: threads.when(
                data: (items) {
                  final filtered = _filterThreads(items);
                  if (!compact && filtered.isNotEmpty && selected == null) {
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      ref
                          .read(selectedAdminSupportThreadProvider.notifier)
                          .select(filtered.first);
                    });
                  }
                  if (filtered.isEmpty) {
                    return const _EmptyListMessage(
                      icon: Icons.support_agent_outlined,
                      text: 'Nenhum atendimento encontrado.',
                    );
                  }
                  return Scrollbar(
                    child: RefreshIndicator(
                      onRefresh: () async =>
                          ref.invalidate(adminSupportThreadsProvider),
                      child: ListView.builder(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.only(bottom: 20),
                        itemCount: filtered.length + 1,
                        itemBuilder: (context, index) {
                          if (index == filtered.length) {
                            return _AdminListFooter(
                              count: filtered.length,
                              singular: 'atendimento',
                            );
                          }
                          final entry = filtered[index];
                          return _SupportThreadTile(
                            entry: entry,
                            selected: selected?.key == entry.key,
                            onTap: () => ref
                                .read(
                                  selectedAdminSupportThreadProvider.notifier,
                                )
                                .select(entry),
                            onLongPress: () =>
                                _openSupportUserActions(context, ref, entry),
                          );
                        },
                      ),
                    ),
                  );
                },
                error: (error, _) => _ErrorState(
                  message: error.toString(),
                  onRetry: () => ref.invalidate(adminSupportThreadsProvider),
                ),
                loading: () => const Center(child: CircularProgressIndicator()),
              ),
            ),
          ],
        ),
      );
    }

    if (compact) {
      if (selected != null) {
        return _SupportConversationPane(
          entry: selected,
          leading: IconButton(
            tooltip: 'Voltar',
            onPressed: () => ref
                .read(selectedAdminSupportThreadProvider.notifier)
                .select(null),
            icon: const Icon(Icons.arrow_back_rounded),
          ),
        );
      }
      return buildListPane();
    }

    return Row(
      children: [
        SizedBox(width: 430, child: buildListPane()),
        Expanded(
          child: selected == null
              ? const _AdminEmptyConversation()
              : _SupportConversationPane(entry: selected),
        ),
      ],
    );
  }
}

class _SupportThreadTile extends StatelessWidget {
  const _SupportThreadTile({
    required this.entry,
    required this.selected,
    required this.onTap,
    required this.onLongPress,
  });

  final AdminSupportThreadEntry entry;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final time = _formatThreadTime(entry.thread.lastMessageAt);
    return Material(
      color: selected ? wa.selectedRow : wa.panel,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 10, 14, 10),
          child: Row(
            children: [
              _Avatar(
                name: entry.displayName,
                url: entry.user.avatarUrl,
                size: 52,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            entry.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: wa.textPrimary,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        Text(
                          time,
                          style: TextStyle(color: wa.textMuted, fontSize: 12),
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        _StatusDot(
                          color: entry.thread.isOpen
                              ? const Color(0xFF00A884)
                              : wa.textMuted,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            entry.subtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: wa.textSecondary,
                              fontSize: 13.5,
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
    );
  }
}

class _SupportConversationPane extends ConsumerStatefulWidget {
  const _SupportConversationPane({required this.entry, this.leading});

  final AdminSupportThreadEntry entry;
  final Widget? leading;

  @override
  ConsumerState<_SupportConversationPane> createState() =>
      _SupportConversationPaneState();
}

class _SupportConversationPaneState
    extends ConsumerState<_SupportConversationPane> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  var _sending = false;

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 620;
    final conversation = ref.watch(adminSupportConversationProvider);

    return Column(
      children: [
        _ChatHeader(entry: widget.entry, leading: widget.leading),
        Expanded(
          child: ColoredBox(
            color: wa.chatWallpaper,
            child: conversation.when(
              data: (payload) {
                final messages =
                    payload?.messages ?? const <AdminSupportMessage>[];
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (_scrollController.hasClients) {
                    _scrollController.jumpTo(
                      _scrollController.position.maxScrollExtent,
                    );
                  }
                });
                if (payload == null) return const _AdminEmptyConversation();
                if (messages.isEmpty) {
                  return const _EmptyListMessage(
                    icon: Icons.forum_outlined,
                    text: 'Este atendimento ainda não possui mensagens.',
                  );
                }
                return ListView.builder(
                  controller: _scrollController,
                  padding: EdgeInsets.fromLTRB(
                    compact ? 12 : 64,
                    16,
                    compact ? 12 : 64,
                    20,
                  ),
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    return _SupportMessageBubble(message: messages[index]);
                  },
                );
              },
              error: (error, _) => _ErrorState(
                message: error.toString(),
                onRetry: () => ref.invalidate(adminSupportConversationProvider),
              ),
              loading: () => const Center(child: CircularProgressIndicator()),
            ),
          ),
        ),
        _SupportComposer(
          controller: _messageController,
          sending: _sending,
          onSend: _sendText,
        ),
      ],
    );
  }

  Future<void> _sendText() async {
    final text = _messageController.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ref
          .read(apiClientProvider)
          .sendAdminSupportText(
            userId: widget.entry.user.id,
            whatsappId: widget.entry.thread.whatsappId,
            text: text,
          );
      _messageController.clear();
      ref.invalidate(adminSupportConversationProvider);
      ref.invalidate(adminSupportThreadsProvider);
    } catch (error) {
      if (mounted) {
        showErrorToast(context, error);
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }
}

class _ChatHeader extends ConsumerWidget {
  const _ChatHeader({required this.entry, this.leading});

  final AdminSupportThreadEntry entry;
  final Widget? leading;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 620;
    Future<void> setHandlingMode() async {
      final next = entry.thread.isHuman ? 'bot' : 'human';
      await ref
          .read(apiClientProvider)
          .updateAdminSupportHandlingMode(
            userId: entry.user.id,
            whatsappId: entry.thread.whatsappId,
            handlingMode: next,
          );
      ref.invalidate(adminSupportConversationProvider);
      ref.invalidate(adminSupportThreadsProvider);
    }

    Future<void> toggleOpen() async {
      await ref
          .read(apiClientProvider)
          .runAdminSupportThreadAction(
            userId: entry.user.id,
            whatsappId: entry.thread.whatsappId,
            action: entry.thread.isOpen ? 'close' : 'reopen',
          );
      ref.invalidate(adminSupportConversationProvider);
      ref.invalidate(adminSupportThreadsProvider);
    }

    return Container(
      height: 64,
      padding: EdgeInsets.symmetric(horizontal: compact ? 8 : 18),
      decoration: BoxDecoration(
        color: wa.headerBg,
        border: Border(bottom: BorderSide(color: wa.border)),
      ),
      child: Row(
        children: [
          ?leading,
          _Avatar(name: entry.displayName, url: entry.user.avatarUrl, size: 44),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${entry.user.email ?? entry.thread.displayWhatsappId ?? entry.thread.whatsappId} · ${entry.thread.isHuman ? 'humano' : 'bot'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: wa.textSecondary, fontSize: 12.5),
                ),
              ],
            ),
          ),
          if (compact) ...[
            IconButton(
              tooltip: 'Ações do usuário',
              onPressed: () => _openSupportUserActions(context, ref, entry),
              icon: Icon(Icons.manage_accounts_outlined, color: wa.accent),
            ),
            IconButton(
              tooltip: entry.thread.isHuman
                  ? 'Passar para bot'
                  : 'Passar para humano',
              onPressed: () async {
                try {
                  await setHandlingMode();
                } catch (error) {
                  if (context.mounted) showErrorToast(context, error);
                }
              },
              icon: Icon(
                entry.thread.isHuman
                    ? Icons.smart_toy_outlined
                    : Icons.support_agent_outlined,
                color: wa.accent,
              ),
            ),
            IconButton(
              tooltip: entry.thread.isOpen ? 'Fechar' : 'Reabrir',
              onPressed: () async {
                try {
                  await toggleOpen();
                } catch (error) {
                  if (context.mounted) showErrorToast(context, error);
                }
              },
              icon: Icon(
                entry.thread.isOpen
                    ? Icons.lock_outline
                    : Icons.lock_open_outlined,
                color: wa.accent,
              ),
            ),
          ] else ...[
            _ThreadActionButton(
              label: 'Ações',
              icon: Icons.manage_accounts_outlined,
              onPressed: () => _openSupportUserActions(context, ref, entry),
            ),
            const SizedBox(width: 8),
            _ThreadActionButton(
              label: entry.thread.isHuman ? 'Bot' : 'Humano',
              icon: entry.thread.isHuman
                  ? Icons.smart_toy_outlined
                  : Icons.support_agent_outlined,
              onPressed: setHandlingMode,
            ),
            const SizedBox(width: 8),
            _ThreadActionButton(
              label: entry.thread.isOpen ? 'Fechar' : 'Reabrir',
              icon: entry.thread.isOpen
                  ? Icons.lock_outline
                  : Icons.lock_open_outlined,
              onPressed: toggleOpen,
            ),
          ],
        ],
      ),
    );
  }
}

enum _SupportUserAction {
  edit,
  plan,
  balance,
  impersonate,
  toggleActive,
  revokeSessions,
  instances,
}

Future<void> _openSupportUserActions(
  BuildContext context,
  WidgetRef ref,
  AdminSupportThreadEntry entry,
) async {
  final fallback = _supportEntryToAdminRecord(entry);
  var record = fallback;
  try {
    final users = await ref.read(adminUsersProvider.future);
    record = users.firstWhere(
      (item) => item.id == fallback.id,
      orElse: () => fallback,
    );
  } catch (_) {
    record = fallback;
  }
  if (!context.mounted) return;

  final action = await showBotAdminBottomSheet<_SupportUserAction>(
    context: context,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _SupportUserActionSheet(record: record),
  );
  if (action == null || !context.mounted) return;

  switch (action) {
    case _SupportUserAction.edit:
      await _openEditUserDialog(context, ref, record);
    case _SupportUserAction.plan:
      await _openUserPlanDialog(context, ref, record);
    case _SupportUserAction.balance:
      await _openUserBalanceDialog(context, ref, record);
    case _SupportUserAction.impersonate:
      await _impersonateUser(context, ref, record);
    case _SupportUserAction.toggleActive:
      await _toggleUserActive(context, ref, record);
    case _SupportUserAction.revokeSessions:
      await _revokeUserSessions(context, ref, record);
    case _SupportUserAction.instances:
      final id = int.tryParse(record.id);
      if (id == null) return;
      ref.read(adminInstanceUserFilterProvider.notifier).setUserId(id);
      ref
          .read(adminSectionProvider.notifier)
          .select(AdminPanelSection.instances);
      ref.invalidate(adminInstancesProvider);
      showSuccessToast(context, 'Perfis do usuário carregados.');
  }
}

class _SupportUserActionSheet extends StatelessWidget {
  const _SupportUserActionSheet({required this.record});

  final _AdminRecord record;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final active = record.raw['isActive'] != false;
    final bottom = MediaQuery.paddingOf(context).bottom;
    return Align(
      alignment: Alignment.bottomCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
            border: Border.all(color: wa.border),
            boxShadow: const [
              BoxShadow(
                color: Color(0x33000000),
                blurRadius: 28,
                offset: Offset(0, -8),
              ),
            ],
          ),
          child: SingleChildScrollView(
            child: Padding(
              padding: EdgeInsets.fromLTRB(18, 14, 18, 14 + bottom),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: wa.border,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      record.avatarUrl == null
                          ? CircleAvatar(
                              radius: 24,
                              backgroundColor: wa.accentSoft,
                              child: Icon(record.icon, color: wa.accent),
                            )
                          : _Avatar(
                              name: record.title,
                              url: record.avatarUrl,
                              size: 48,
                            ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              record.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: wa.textPrimary,
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              record.subtitle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(color: wa.textSecondary),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: 'Fechar',
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _SupportActionTile(
                    icon: Icons.person_add_alt_1_outlined,
                    title: 'Liberar slots de perfil',
                    subtitle: 'Quantidade de perfis e validade.',
                    action: _SupportUserAction.plan,
                  ),
                  _SupportActionTile(
                    icon: Icons.account_balance_wallet_outlined,
                    title: 'Editar saldo',
                    subtitle: 'Ajuste rápido do saldo do usuário.',
                    action: _SupportUserAction.balance,
                  ),
                  _SupportActionTile(
                    icon: Icons.login_outlined,
                    title: 'Entrar como usuário',
                    subtitle: 'Acessa o painel dele sem sair do admin.',
                    action: _SupportUserAction.impersonate,
                  ),
                  _SupportActionTile(
                    icon: active
                        ? Icons.block_outlined
                        : Icons.check_circle_outline,
                    title: active ? 'Desativar conta' : 'Ativar conta',
                    subtitle: active
                        ? 'Bloqueia o acesso desse usuário.'
                        : 'Libera novamente o acesso.',
                    action: _SupportUserAction.toggleActive,
                    danger: active,
                  ),
                  _SupportActionTile(
                    icon: Icons.edit_outlined,
                    title: 'Editar dados',
                    subtitle: 'Nome, e-mail, senha e WhatsApp cadastrado.',
                    action: _SupportUserAction.edit,
                  ),
                  _SupportActionTile(
                    icon: Icons.qr_code_2_outlined,
                    title: 'Gerenciar perfis',
                    subtitle: 'Lista e renova todos os perfis desse usuário.',
                    action: _SupportUserAction.instances,
                  ),
                  _SupportActionTile(
                    icon: Icons.logout_outlined,
                    title: 'Encerrar sessões',
                    subtitle: 'Remove sessões abertas desse usuário.',
                    action: _SupportUserAction.revokeSessions,
                    danger: true,
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

class _SupportActionTile extends StatelessWidget {
  const _SupportActionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.action,
    this.danger = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final _SupportUserAction action;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final color = danger ? const Color(0xFFE5484D) : wa.accent;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => Navigator.of(context).pop(action),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
          child: Row(
            children: [
              CircleAvatar(
                radius: 21,
                backgroundColor: color.withValues(alpha: 0.13),
                child: Icon(icon, color: color, size: 21),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: danger ? color : wa.textPrimary,
                        fontSize: 15.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: wa.textSecondary, fontSize: 13),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: wa.icon),
            ],
          ),
        ),
      ),
    );
  }
}

class _ThreadActionButton extends StatelessWidget {
  const _ThreadActionButton({
    required this.label,
    required this.icon,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final Future<void> Function() onPressed;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return TextButton.icon(
      onPressed: () async {
        try {
          await onPressed();
        } catch (error) {
          if (context.mounted) {
            showErrorToast(context, error);
          }
        }
      },
      icon: Icon(icon, size: 18),
      label: Text(label),
      style: TextButton.styleFrom(
        foregroundColor: wa.accent,
        backgroundColor: wa.accentSoft,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    );
  }
}

class _SupportMessageBubble extends StatelessWidget {
  const _SupportMessageBubble({required this.message});

  final AdminSupportMessage message;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final outbound = message.isOutbound;
    final text = message.text?.trim();
    final media = message.media;
    return Align(
      alignment: outbound ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 520),
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
        decoration: BoxDecoration(
          color: outbound ? wa.bubbleOut : wa.bubbleIn,
          borderRadius: BorderRadius.circular(8),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 2,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (media != null) _SupportMediaPreview(media: media),
            if (text != null && text.isNotEmpty)
              Padding(
                padding: EdgeInsets.only(top: media == null ? 0 : 6),
                child: Text(
                  text,
                  style: TextStyle(color: wa.bubbleText, fontSize: 15),
                ),
              ),
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                _formatMessageTime(message.timestamp),
                style: TextStyle(color: wa.bubbleMeta, fontSize: 11),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SupportMediaPreview extends StatelessWidget {
  const _SupportMediaPreview({required this.media});

  final AdminSupportMedia media;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final url = _resolveUrl(media.resolvedUrl);
    if (url == null) {
      return Text(
        media.filename ?? 'Mídia indisponível',
        style: TextStyle(color: wa.textSecondary),
      );
    }
    if (media.mediaType == 'image' || media.mediaType == 'sticker') {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(
          url,
          width: 320,
          height: media.mediaType == 'sticker' ? 160 : 220,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _DocumentPreview(media: media),
        ),
      );
    }
    return _DocumentPreview(media: media);
  }
}

class _DocumentPreview extends StatelessWidget {
  const _DocumentPreview({required this.media});

  final AdminSupportMedia media;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      width: 300,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: wa.searchBg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(_mediaIcon(media.mediaType), color: wa.icon),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              media.caption?.trim().isNotEmpty == true
                  ? media.caption!.trim()
                  : media.filename ?? media.mediaType,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: wa.textPrimary),
            ),
          ),
        ],
      ),
    );
  }
}

class _SupportComposer extends StatelessWidget {
  const _SupportComposer({
    required this.controller,
    required this.sending,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool sending;
  final Future<void> Function() onSend;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      color: wa.composerBg,
      child: Row(
        children: [
          IconButton(
            tooltip: 'Anexar',
            onPressed: sending ? null : () {},
            icon: const Icon(Icons.add),
          ),
          Expanded(
            child: TextField(
              controller: controller,
              minLines: 1,
              maxLines: 5,
              onSubmitted: (_) => onSend(),
              decoration: InputDecoration(
                hintText: 'Digite uma mensagem',
                fillColor: wa.inputFill,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            tooltip: 'Enviar',
            onPressed: sending ? null : onSend,
            icon: sending
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.send),
          ),
        ],
      ),
    );
  }
}

typedef _AdminActionsBuilder =
    List<_AdminRecordAction> Function(
      BuildContext context,
      WidgetRef ref,
      _AdminRecord record,
    );

class _AdminRecordFilter {
  const _AdminRecordFilter({required this.value, required this.label});

  final String value;
  final String label;
}

class _AdminPartnersWorkspace extends ConsumerWidget {
  const _AdminPartnersWorkspace();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final partners = ref.watch(adminPartnersProvider);
    return ColoredBox(
      color: wa.contentBg,
      child: Column(
        children: [
          _AdminPanelHeader(
            title: 'Parceiros',
            subtitle: 'Equipe limitada, revendedores e créditos de ativação.',
            actions: [
              IconButton(
                tooltip: 'Atualizar',
                onPressed: () => ref.invalidate(adminPartnersProvider),
                icon: const Icon(Icons.refresh_rounded),
              ),
              const SizedBox(width: 6),
              FilledButton.icon(
                onPressed: () => _openPartnerEditor(context, ref),
                icon: const Icon(Icons.person_add_alt_1_outlined, size: 18),
                label: const Text('Adicionar'),
              ),
              OutlinedButton.icon(
                onPressed: () => _openAdminManualPayments(context, ref),
                icon: const Icon(Icons.receipt_long_outlined, size: 18),
                label: const Text('Pagamentos manuais'),
              ),
            ],
          ),
          Expanded(
            child: partners.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(error.toString(), textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: () => ref.invalidate(adminPartnersProvider),
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Tentar novamente'),
                      ),
                    ],
                  ),
                ),
              ),
              data: (items) => items.isEmpty
                  ? Center(
                      child: Text(
                        'Nenhum parceiro cadastrado.',
                        style: TextStyle(color: wa.textSecondary),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
                      itemCount: items.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (context, index) {
                        final member = items[index];
                        return Card(
                          margin: EdgeInsets.zero,
                          child: ListTile(
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 7,
                            ),
                            leading: CircleAvatar(
                              child: Text(
                                member.name.trim().isEmpty
                                    ? '?'
                                    : member.name.trim()[0].toUpperCase(),
                              ),
                            ),
                            title: Text(member.name),
                            subtitle: Text(
                              '${member.email}\n${_partnerAdminRoleLabel(member.role)} · ${member.creditBalance} créditos · ${member.commissionRate.toStringAsFixed(1)}% comissão',
                            ),
                            isThreeLine: true,
                            trailing: PopupMenuButton<String>(
                              onSelected: (action) async {
                                if (action == 'credits') {
                                  await _openPartnerCredits(
                                    context,
                                    ref,
                                    member,
                                  );
                                } else if (action == 'edit') {
                                  await _openPartnerEditor(
                                    context,
                                    ref,
                                    member: member,
                                  );
                                } else if (action == 'status') {
                                  await _togglePartnerStatus(
                                    context,
                                    ref,
                                    member,
                                  );
                                } else if (action == 'enter') {
                                  await _enterPartnerPanel(
                                    context,
                                    ref,
                                    member,
                                  );
                                }
                              },
                              itemBuilder: (_) => [
                                const PopupMenuItem(
                                  value: 'credits',
                                  child: ListTile(
                                    dense: true,
                                    leading: Icon(Icons.bolt_rounded),
                                    title: Text('Adicionar créditos'),
                                  ),
                                ),
                                const PopupMenuItem(
                                  value: 'edit',
                                  child: ListTile(
                                    dense: true,
                                    leading: Icon(
                                      Icons.admin_panel_settings_outlined,
                                    ),
                                    title: Text('Papel e permissões'),
                                  ),
                                ),
                                PopupMenuItem(
                                  value: 'status',
                                  child: ListTile(
                                    dense: true,
                                    leading: Icon(
                                      member.status == 'active'
                                          ? Icons.pause_circle_outline
                                          : Icons.play_circle_outline,
                                    ),
                                    title: Text(
                                      member.status == 'active'
                                          ? 'Suspender acesso'
                                          : 'Reativar acesso',
                                    ),
                                  ),
                                ),
                                const PopupMenuItem(
                                  value: 'enter',
                                  child: ListTile(
                                    dense: true,
                                    leading: Icon(Icons.login_rounded),
                                    title: Text('Entrar no painel'),
                                  ),
                                ),
                              ],
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
}

Future<void> _enterPartnerPanel(
  BuildContext context,
  WidgetRef ref,
  PartnerMemberSummary member,
) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text('Entrar como ${member.name}'),
      content: const Text(
        'O painel do parceiro será aberto para suporte. Você poderá retornar ao painel Admin pelo botão no topo.',
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
        .impersonateUser(member.userId);
    ref.read(authControllerProvider.notifier).setSession(session);
    redirectToPath('/dashboard/partner');
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

Future<void> _openAdminManualPayments(
  BuildContext context,
  WidgetRef ref,
) async {
  try {
    final requests = await ref
        .read(apiClientProvider)
        .loadManualPartnerPayments();
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Pagamentos manuais'),
        content: SizedBox(
          width: 620,
          child: requests.isEmpty
              ? const Text(
                  'Nenhum comprovante pendente ou histórico encontrado.',
                )
              : ListView.separated(
                  shrinkWrap: true,
                  itemCount: requests.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, index) {
                    final request = requests[index];
                    final status = '${request['status'] ?? 'pending'}';
                    final pending = status == 'pending';
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        '${request['buyerName'] ?? request['buyerEmail'] ?? 'Cliente'} · ${request['credits'] ?? 0} créditos',
                      ),
                      subtitle: Text(
                        'R\$ ${request['totalAmount'] ?? 0} · ${request['buyerEmail'] ?? ''}\n${request['proofUrl'] ?? ''}',
                      ),
                      isThreeLine: true,
                      trailing: pending
                          ? Wrap(
                              spacing: 4,
                              children: [
                                IconButton(
                                  tooltip: 'Aprovar',
                                  icon: const Icon(
                                    Icons.check_circle_outline,
                                    color: Colors.green,
                                  ),
                                  onPressed: () async {
                                    await ref
                                        .read(apiClientProvider)
                                        .reviewManualPartnerPayment(
                                          publicId: '${request['publicId']}',
                                          approve: true,
                                        );
                                    if (dialogContext.mounted)
                                      Navigator.pop(dialogContext);
                                    if (context.mounted)
                                      showSuccessToast(
                                        context,
                                        'Pagamento aprovado e créditos liberados.',
                                      );
                                  },
                                ),
                                IconButton(
                                  tooltip: 'Rejeitar',
                                  icon: const Icon(
                                    Icons.cancel_outlined,
                                    color: Colors.red,
                                  ),
                                  onPressed: () async {
                                    await ref
                                        .read(apiClientProvider)
                                        .reviewManualPartnerPayment(
                                          publicId: '${request['publicId']}',
                                          approve: false,
                                        );
                                    if (dialogContext.mounted)
                                      Navigator.pop(dialogContext);
                                    if (context.mounted)
                                      showSuccessToast(
                                        context,
                                        'Pagamento rejeitado.',
                                      );
                                  },
                                ),
                              ],
                            )
                          : Chip(
                              label: Text(
                                status == 'approved' ? 'Aprovado' : 'Rejeitado',
                              ),
                            ),
                    );
                  },
                ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Fechar'),
          ),
        ],
      ),
    );
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

const _partnerPermissionLabels = <String, String>{
  'manage_partners': 'Gerenciar parceiros',
  'grant_credits': 'Adicionar créditos',
  'manage_customers': 'Cadastrar clientes',
  'activate_customers': 'Ativar e renovar clientes',
  'view_financial': 'Visualizar financeiro',
  'support_users': 'Atender usuários',
};

Future<void> _openPartnerEditor(
  BuildContext context,
  WidgetRef ref, {
  PartnerMemberSummary? member,
}) async {
  var userId = member?.userId;
  var role = member?.role ?? 'reseller';
  var accountMode = 'new';
  var passwordVisible = false;
  final permissions = <String, bool>{
    for (final key in _partnerPermissionLabels.keys)
      key: member == null
          ? _defaultPartnerPermission(role, key)
          : member.permissions[key] == true,
  };
  final commissionController = TextEditingController(
    text: member?.commissionRate.toString() ?? '20',
  );
  final initialCreditsController = TextEditingController(text: '0');
  final creditUnitPriceController = TextEditingController(text: '29.90');
  final manualPixController = TextEditingController();
  final manualInstructionsController = TextEditingController();
  var manualPaymentsEnabled = false;
  var allowChildManualPayments = false;
  final nameController = TextEditingController();
  final emailController = TextEditingController();
  final whatsappController = TextEditingController();
  final passwordController = TextEditingController();
  final userSearchController = TextEditingController();
  Timer? userSearchDebounce;
  var userSearchRequest = 0;
  var usersLoading = false;
  List<_AdminRecord> users = const [];
  Object? usersError;
  if (member == null) {
    try {
      users = await _loadAdminUsers(ref.read(apiClientProvider));
    } catch (error) {
      usersError = error;
    }
  }
  if (member != null) {
    try {
      final finance = await ref
          .read(apiClientProvider)
          .getPartnerFinancialSettings(member.userId);
      final settings = finance['settings'] is Map
          ? Map<String, dynamic>.from(finance['settings'] as Map)
          : const <String, dynamic>{};
      creditUnitPriceController.text =
          '${settings['creditUnitPrice'] ?? 29.90}';
      manualPixController.text = settings['manualPixKey']?.toString() ?? '';
      manualInstructionsController.text =
          settings['manualInstructions']?.toString() ?? '';
      manualPaymentsEnabled = settings['manualPaymentsEnabled'] == true;
      allowChildManualPayments = settings['allowChildManualPayments'] == true;
    } catch (_) {}
  }
  if (!context.mounted) return;
  var dialogOpen = true;
  void scheduleUserSearch(String value, StateSetter setDialogState) {
    userSearchDebounce?.cancel();
    final requestId = ++userSearchRequest;
    setDialogState(() {
      usersLoading = true;
      usersError = null;
      userId = null;
    });
    userSearchDebounce = Timer(const Duration(milliseconds: 300), () async {
      try {
        final matches = await _loadAdminUsers(
          ref.read(apiClientProvider),
          query: value.trim(),
        );
        if (!context.mounted || !dialogOpen || requestId != userSearchRequest) {
          return;
        }
        setDialogState(() {
          users = matches;
          usersLoading = false;
        });
      } catch (error) {
        if (!context.mounted || !dialogOpen || requestId != userSearchRequest) {
          return;
        }
        setDialogState(() {
          usersError = error;
          usersLoading = false;
        });
      }
    });
  }

  final saved = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: Text(member == null ? 'Adicionar parceiro' : 'Editar parceiro'),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (member == null) ...[
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'new',
                        icon: Icon(Icons.person_add_alt_1_outlined),
                        label: Text('Nova conta'),
                      ),
                      ButtonSegment(
                        value: 'existing',
                        icon: Icon(Icons.person_search_outlined),
                        label: Text('Conta existente'),
                      ),
                    ],
                    selected: {accountMode},
                    onSelectionChanged: (selection) => setDialogState(() {
                      accountMode = selection.first;
                    }),
                  ),
                  const SizedBox(height: 14),
                  if (accountMode == 'new') ...[
                    TextField(
                      controller: nameController,
                      textCapitalization: TextCapitalization.words,
                      textInputAction: TextInputAction.next,
                      onChanged: (_) => setDialogState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'Nome completo',
                        prefixIcon: Icon(Icons.person_outline_rounded),
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: emailController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      onChanged: (_) => setDialogState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'E-mail de acesso',
                        prefixIcon: Icon(Icons.alternate_email_rounded),
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: whatsappController,
                      keyboardType: TextInputType.phone,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'WhatsApp (opcional)',
                        hintText: '+55 11 99999-9999',
                        prefixIcon: Icon(Icons.phone_outlined),
                        helperText: 'Informe DDI, DDD e número.',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: passwordController,
                      obscureText: !passwordVisible,
                      textInputAction: TextInputAction.next,
                      onChanged: (_) => setDialogState(() {}),
                      decoration: InputDecoration(
                        labelText: 'Senha inicial',
                        prefixIcon: const Icon(Icons.lock_outline_rounded),
                        helperText: 'Mínimo de 6 caracteres.',
                        suffixIcon: IconButton(
                          tooltip: passwordVisible
                              ? 'Ocultar senha'
                              : 'Mostrar senha',
                          onPressed: () => setDialogState(
                            () => passwordVisible = !passwordVisible,
                          ),
                          icon: Icon(
                            passwordVisible
                                ? Icons.visibility_off_outlined
                                : Icons.visibility_outlined,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: initialCreditsController,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(
                        labelText: 'Créditos iniciais',
                        prefixIcon: Icon(Icons.bolt_rounded),
                        helperText:
                            'O Admin geral pode liberar créditos já no cadastro.',
                      ),
                    ),
                  ] else ...[
                    TextField(
                      controller: userSearchController,
                      autofocus: true,
                      textInputAction: TextInputAction.search,
                      onChanged: (value) =>
                          scheduleUserSearch(value, setDialogState),
                      decoration: InputDecoration(
                        labelText: 'Buscar em todas as contas',
                        hintText: 'Nome, e-mail, WhatsApp ou ID',
                        prefixIcon: const Icon(Icons.search_rounded),
                        suffixIcon: userSearchController.text.isEmpty
                            ? null
                            : IconButton(
                                tooltip: 'Limpar busca',
                                onPressed: () {
                                  userSearchController.clear();
                                  scheduleUserSearch('', setDialogState);
                                },
                                icon: const Icon(Icons.close_rounded),
                              ),
                      ),
                    ),
                    if (usersLoading) ...[
                      const SizedBox(height: 8),
                      const LinearProgressIndicator(minHeight: 2),
                    ],
                    const SizedBox(height: 10),
                    if (usersError != null)
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Text(
                          'Não foi possível buscar as contas. Tente novamente ou use Nova conta.',
                        ),
                      )
                    else if (!usersLoading && users.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 10),
                        child: Text(
                          'Nenhuma conta encontrada. Refine a busca ou cadastre uma nova.',
                          textAlign: TextAlign.center,
                        ),
                      )
                    else
                      DropdownButtonFormField<int>(
                        key: ValueKey(
                          'partner-user-${userSearchController.text}-$userId',
                        ),
                        initialValue: userId,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'Usuário cadastrado',
                          prefixIcon: const Icon(Icons.person_search_outlined),
                          helperText: userSearchController.text.trim().isEmpty
                              ? 'Exibindo as contas mais recentes. Digite acima para localizar qualquer conta.'
                              : '${users.length} resultado(s) para a busca.',
                        ),
                        items: users
                            .map(
                              (user) => DropdownMenuItem(
                                value: int.tryParse(user.id),
                                child: Text('${user.title} · ${user.subtitle}'),
                              ),
                            )
                            .where((item) => item.value != null)
                            .toList(),
                        onChanged: (value) =>
                            setDialogState(() => userId = value),
                      ),
                  ],
                ] else
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(member.name),
                    subtitle: Text(member.email),
                  ),
                const SizedBox(height: 10),
                TextField(
                  controller: commissionController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Comissão do revendedor (%)',
                    helperText: 'Percentual usado nos relatórios de vendas.',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: role,
                  decoration: const InputDecoration(labelText: 'Papel'),
                  items: const [
                    DropdownMenuItem(value: 'master', child: Text('Master')),
                    DropdownMenuItem(
                      value: 'reseller',
                      child: Text('Revendedor'),
                    ),
                    DropdownMenuItem(value: 'support', child: Text('Suporte')),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setDialogState(() {
                        role = value;
                        if (member == null) {
                          for (final key in permissions.keys) {
                            permissions[key] = _defaultPartnerPermission(
                              role,
                              key,
                            );
                          }
                        }
                      });
                    }
                  },
                ),
                const SizedBox(height: 14),
                const Divider(),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Regras financeiras',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: creditUnitPriceController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Valor de cada crédito (R\$)',
                    helperText: 'Define quanto este parceiro paga por crédito.',
                  ),
                ),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Permitir pagamento manual'),
                  subtitle: const Text(
                    'O parceiro poderá enviar Pix e comprovante.',
                  ),
                  value: manualPaymentsEnabled,
                  onChanged: (value) =>
                      setDialogState(() => manualPaymentsEnabled = value),
                ),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Permitir pagamento manual para subordinados',
                  ),
                  value: allowChildManualPayments,
                  onChanged: (value) =>
                      setDialogState(() => allowChildManualPayments = value),
                ),
                TextField(
                  controller: manualPixController,
                  decoration: const InputDecoration(
                    labelText: 'Chave Pix para pagamentos manuais',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: manualInstructionsController,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Instruções do pagamento manual',
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Permissões específicas',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                ..._partnerPermissionLabels.entries.map(
                  (entry) => SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(entry.value),
                    value: permissions[entry.key] == true,
                    onChanged: (value) =>
                        setDialogState(() => permissions[entry.key] = value),
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed:
                member == null && accountMode == 'existing' && userId == null
                ? null
                : member == null &&
                      accountMode == 'new' &&
                      (nameController.text.trim().length < 2 ||
                          !emailController.text.trim().contains('@') ||
                          passwordController.text.length < 6)
                ? null
                : () => Navigator.pop(dialogContext, true),
            child: Text(
              member == null && accountMode == 'new'
                  ? 'Criar parceiro'
                  : 'Salvar',
            ),
          ),
        ],
      ),
    ),
  );
  final commissionRate = double.tryParse(commissionController.text.trim());
  final initialCredits =
      int.tryParse(initialCreditsController.text.trim()) ?? 0;
  final name = nameController.text.trim();
  final email = emailController.text.trim();
  final whatsapp = whatsappController.text.trim();
  final password = passwordController.text;
  final creditUnitPrice =
      double.tryParse(
        creditUnitPriceController.text.trim().replaceAll(',', '.'),
      ) ??
      29.90;
  final manualPix = manualPixController.text.trim();
  final manualInstructions = manualInstructionsController.text.trim();
  dialogOpen = false;
  userSearchDebounce?.cancel();
  commissionController.dispose();
  initialCreditsController.dispose();
  nameController.dispose();
  emailController.dispose();
  whatsappController.dispose();
  passwordController.dispose();
  creditUnitPriceController.dispose();
  manualPixController.dispose();
  manualInstructionsController.dispose();
  userSearchController.dispose();
  if (saved != true) return;
  try {
    if (member == null && accountMode == 'new') {
      final created = await ref
          .read(apiClientProvider)
          .createPartnerMember(
            name: name,
            email: email,
            password: password,
            whatsappNumber: whatsapp,
            role: role,
            permissions: permissions,
            commissionRate: commissionRate,
            initialCredits: initialCredits,
          );
      await ref
          .read(apiClientProvider)
          .savePartnerFinancialSettings(
            userId: created.userId,
            creditUnitPrice: creditUnitPrice,
            manualPaymentsEnabled: manualPaymentsEnabled,
            allowChildManualPayments: allowChildManualPayments,
            manualPixKey: manualPix,
            manualInstructions: manualInstructions,
          );
    } else {
      if (userId == null) return;
      await ref
          .read(apiClientProvider)
          .savePartnerMember(
            userId: userId!,
            role: role,
            permissions: permissions,
            status: member?.status ?? 'active',
            commissionRate: commissionRate,
          );
      await ref
          .read(apiClientProvider)
          .savePartnerFinancialSettings(
            userId: userId!,
            creditUnitPrice: creditUnitPrice,
            manualPaymentsEnabled: manualPaymentsEnabled,
            allowChildManualPayments: allowChildManualPayments,
            manualPixKey: manualPix,
            manualInstructions: manualInstructions,
          );
    }
    ref.invalidate(adminPartnersProvider);
    if (context.mounted) {
      showSuccessToast(
        context,
        member == null && accountMode == 'new'
            ? 'Parceiro criado e acesso liberado.'
            : 'Parceiro atualizado.',
      );
    }
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

Future<void> _openPartnerCredits(
  BuildContext context,
  WidgetRef ref,
  PartnerMemberSummary member,
) async {
  final controller = TextEditingController();
  final credits = await showDialog<int>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text('Créditos para ${member.name}'),
      content: TextField(
        controller: controller,
        autofocus: true,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: InputDecoration(
          labelText: 'Quantidade',
          helperText: 'Saldo atual: ${member.creditBalance}',
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
          child: const Text('Adicionar'),
        ),
      ],
    ),
  );
  controller.dispose();
  if (credits == null || credits <= 0) return;
  try {
    await ref
        .read(apiClientProvider)
        .grantPartnerCredits(
          resellerUserId: member.userId,
          credits: credits,
          idempotencyKey:
              'flutter-admin:${member.userId}:$credits:${DateTime.now().millisecondsSinceEpoch}',
        );
    ref.invalidate(adminPartnersProvider);
    if (context.mounted)
      showSuccessToast(context, '$credits créditos adicionados.');
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

Future<void> _togglePartnerStatus(
  BuildContext context,
  WidgetRef ref,
  PartnerMemberSummary member,
) async {
  try {
    await ref
        .read(apiClientProvider)
        .savePartnerMember(
          userId: member.userId,
          role: member.role,
          permissions: member.permissions,
          status: member.status == 'active' ? 'suspended' : 'active',
          commissionRate: member.commissionRate,
        );
    ref.invalidate(adminPartnersProvider);
    if (context.mounted) showSuccessToast(context, 'Acesso atualizado.');
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

String _partnerAdminRoleLabel(String role) => switch (role) {
  'manager' || 'master' => 'Master',
  'support' => 'Suporte',
  _ => 'Revendedor',
};

bool _defaultPartnerPermission(String role, String key) => switch (role) {
  'manager' || 'master' => true,
  'support' => key == 'support_users',
  _ =>
    key == 'manage_customers' ||
        key == 'activate_customers' ||
        key == 'view_financial',
};

class _AdminPaymentsWorkspace extends ConsumerStatefulWidget {
  const _AdminPaymentsWorkspace();

  @override
  ConsumerState<_AdminPaymentsWorkspace> createState() =>
      _AdminPaymentsWorkspaceState();
}

class _AdminPaymentsWorkspaceState
    extends ConsumerState<_AdminPaymentsWorkspace> {
  var _history = false;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Column(
      children: [
        Material(
          color: wa.panel,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 4),
            child: SizedBox(
              width: double.infinity,
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(
                    value: false,
                    icon: Icon(Icons.tune_rounded),
                    label: Text('Configurações'),
                  ),
                  ButtonSegment(
                    value: true,
                    icon: Icon(Icons.receipt_long_outlined),
                    label: Text('Histórico'),
                  ),
                ],
                selected: {_history},
                onSelectionChanged: (value) {
                  setState(() => _history = value.first);
                },
                showSelectedIcon: false,
              ),
            ),
          ),
        ),
        Expanded(
          child: _history
              ? _AdminRecordsWorkspace(
                  title: 'Histórico de pagamentos',
                  subtitle: 'Vendas e confirmações, sem misturar credenciais.',
                  icon: Icons.receipt_long_outlined,
                  recordsAsync: ref.watch(adminPaymentHistoryProvider),
                  onRefresh: () => ref.invalidate(adminPaymentHistoryProvider),
                )
              : _AdminRecordsWorkspace(
                  title: 'Métodos de pagamento',
                  subtitle:
                      'Credenciais, tokens, webhooks e regras de cobrança.',
                  icon: Icons.account_balance_wallet_outlined,
                  recordsAsync: ref.watch(adminPaymentsProvider),
                  onRefresh: () => ref.invalidate(adminPaymentsProvider),
                  actionsBuilder: _paymentActions,
                ),
        ),
      ],
    );
  }
}

class _AdminRecordsWorkspace extends ConsumerStatefulWidget {
  const _AdminRecordsWorkspace({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.recordsAsync,
    required this.onRefresh,
    this.actionsBuilder,
    this.leadingAction,
    this.remoteSearch,
    this.filters = const [],
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final AsyncValue<List<_AdminRecord>> recordsAsync;
  final VoidCallback onRefresh;
  final _AdminActionsBuilder? actionsBuilder;
  final Widget? leadingAction;
  final Future<List<_AdminRecord>> Function(String query, String filter)?
  remoteSearch;
  final List<_AdminRecordFilter> filters;

  @override
  ConsumerState<_AdminRecordsWorkspace> createState() =>
      _AdminRecordsWorkspaceState();
}

class _AdminRecordsWorkspaceState
    extends ConsumerState<_AdminRecordsWorkspace> {
  final _searchController = TextEditingController();
  Timer? _searchDebounce;
  String? _selectedId;
  var _query = '';
  var _activeFilter = 'all';
  AsyncValue<List<_AdminRecord>>? _remoteSearchRecords;
  var _remoteSearchRequest = 0;

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    setState(() => _query = value);
    _scheduleRemoteSearch();
  }

  void _onFilterChanged(String value) {
    if (_activeFilter == value) return;
    setState(() {
      _activeFilter = value;
      _selectedId = null;
    });
    _scheduleRemoteSearch();
  }

  void _scheduleRemoteSearch() {
    final remoteSearch = widget.remoteSearch;
    if (remoteSearch == null) return;

    _searchDebounce?.cancel();
    final normalizedQuery = _query.trim();
    final filter = _activeFilter;
    final requestId = ++_remoteSearchRequest;
    if (normalizedQuery.isEmpty && filter == 'all') {
      setState(() => _remoteSearchRecords = null);
      return;
    }

    _searchDebounce = Timer(const Duration(milliseconds: 300), () async {
      if (!mounted || requestId != _remoteSearchRequest) return;
      setState(() => _remoteSearchRecords = const AsyncLoading());
      try {
        final records = await remoteSearch(normalizedQuery, filter);
        if (!mounted || requestId != _remoteSearchRequest) return;
        setState(() => _remoteSearchRecords = AsyncData(records));
      } catch (error, stackTrace) {
        if (!mounted || requestId != _remoteSearchRequest) return;
        setState(() => _remoteSearchRecords = AsyncError(error, stackTrace));
      }
    });
  }

  void _refreshRecords() {
    widget.onRefresh();
    if (_query.trim().isNotEmpty || _activeFilter != 'all') {
      _scheduleRemoteSearch();
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 760;
    final recordsAsync = _remoteSearchRecords ?? widget.recordsAsync;
    final actions = <Widget>[
      if (widget.leadingAction != null) widget.leadingAction!,
      IconButton(
        tooltip: 'Atualizar',
        onPressed: _refreshRecords,
        icon: const Icon(Icons.refresh),
      ),
    ];

    Widget buildListPane() {
      return DecoratedBox(
        decoration: BoxDecoration(
          color: wa.panel,
          border: Border(
            right: compact ? BorderSide.none : BorderSide(color: wa.border),
          ),
        ),
        child: Column(
          children: [
            _AdminPanelHeader(
              title: widget.title,
              subtitle: widget.subtitle,
              actions: actions,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 12),
              child: TextField(
                controller: _searchController,
                onChanged: _onSearchChanged,
                decoration: InputDecoration(
                  hintText: 'Pesquisar em ${widget.title.toLowerCase()}',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.trim().isEmpty
                      ? null
                      : IconButton(
                          onPressed: () {
                            _searchController.clear();
                            _onSearchChanged('');
                          },
                          icon: const Icon(Icons.close),
                        ),
                  fillColor: wa.searchBg,
                ),
              ),
            ),
            if (widget.filters.isNotEmpty)
              SizedBox(
                height: 45,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(18, 0, 18, 8),
                  itemCount: widget.filters.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, index) {
                    final filter = widget.filters[index];
                    return ChoiceChip(
                      label: Text(filter.label),
                      selected: filter.value == _activeFilter,
                      onSelected: (_) => _onFilterChanged(filter.value),
                    );
                  },
                ),
              ),
            Expanded(
              child: recordsAsync.when(
                data: (records) {
                  final filtered = _filterRecords(records, _query);
                  if (!compact &&
                      filtered.isNotEmpty &&
                      !filtered.any((record) => record.id == _selectedId)) {
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (mounted) {
                        setState(() => _selectedId = filtered.first.id);
                      }
                    });
                  }
                  if (filtered.isEmpty) {
                    return _EmptyListMessage(
                      icon: widget.icon,
                      text: 'Nenhum item encontrado.',
                    );
                  }
                  return Scrollbar(
                    child: RefreshIndicator(
                      onRefresh: () async => _refreshRecords(),
                      child: ListView.builder(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.only(bottom: 20),
                        itemCount: filtered.length + 1,
                        itemBuilder: (context, index) {
                          if (index == filtered.length) {
                            return _AdminListFooter(
                              count: filtered.length,
                              singular: 'item',
                            );
                          }
                          final record = filtered[index];
                          return _AdminRecordTile(
                            record: record,
                            selected: !compact && record.id == _selectedId,
                            onTap: compact
                                ? () => _showRecordDetailPage(record)
                                : () => setState(() => _selectedId = record.id),
                            onLongPress: widget.actionsBuilder == null
                                ? null
                                : () => _showRecordDetailPage(record),
                          );
                        },
                      ),
                    ),
                  );
                },
                error: (error, _) => _ErrorState(
                  message: error.toString(),
                  onRetry: widget.onRefresh,
                ),
                loading: () => const Center(child: CircularProgressIndicator()),
              ),
            ),
          ],
        ),
      );
    }

    if (compact) return buildListPane();

    return Row(
      children: [
        SizedBox(width: 430, child: buildListPane()),
        Expanded(
          child: recordsAsync.when(
            data: (records) {
              final filtered = _filterRecords(records, _query);
              final selected = filtered.firstWhere(
                (record) => record.id == _selectedId,
                orElse: () => filtered.isNotEmpty
                    ? filtered.first
                    : _AdminRecord.empty(widget.title, widget.icon),
              );
              if (filtered.isEmpty) {
                return _AdminRecordEmptyDetail(
                  icon: widget.icon,
                  title: widget.title,
                );
              }
              return _AdminRecordDetail(
                record: selected,
                actionsBuilder: widget.actionsBuilder,
              );
            },
            error: (error, _) => _ErrorState(
              message: error.toString(),
              onRetry: widget.onRefresh,
            ),
            loading: () => ColoredBox(
              color: wa.contentBg,
              child: const Center(child: CircularProgressIndicator()),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _showRecordDetailPage(_AdminRecord record) {
    return Navigator.of(context).push<void>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _AdminRecordDetailPage(
          record: record,
          actionsBuilder: widget.actionsBuilder,
        ),
      ),
    );
  }

  List<_AdminRecord> _filterRecords(List<_AdminRecord> records, String query) {
    final byFilter = records.where((record) {
      switch (_activeFilter) {
        case 'subscription_active':
          return record.raw['hasActiveSubscription'] == true;
        case 'subscription_inactive':
          return record.raw['hasActiveSubscription'] != true;
        case 'account_active':
          return record.raw['isActive'] == true;
        case 'account_blocked':
          return record.raw['isActive'] == false;
        case 'license_active':
          return record.badge != 'Vencido';
        case 'expired':
          return record.badge == 'Vencido';
        case 'connected':
          return record.raw['sessionStatus'] == 'conectado';
        case 'without_session':
          return record.raw['instanceId'] == null &&
              record.raw['instance_id'] == null;
        default:
          return true;
      }
    });
    final normalized = query.trim().toLowerCase();
    if (normalized.isEmpty) return byFilter.toList();
    return byFilter.where((record) {
      return record.title.toLowerCase().contains(normalized) ||
          record.subtitle.toLowerCase().contains(normalized) ||
          record.badge.toLowerCase().contains(normalized) ||
          record.details.any(
            (detail) =>
                detail.label.toLowerCase().contains(normalized) ||
                detail.value.toLowerCase().contains(normalized),
          );
    }).toList();
  }
}

class _AdminRecordDetailPage extends ConsumerWidget {
  const _AdminRecordDetailPage({
    required this.record,
    required this.actionsBuilder,
  });

  final _AdminRecord record;
  final _AdminActionsBuilder? actionsBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final actions = actionsBuilder?.call(context, ref, record) ?? const [];
    return Scaffold(
      backgroundColor: wa.contentBg,
      appBar: AppBar(
        backgroundColor: wa.headerBg,
        foregroundColor: wa.textPrimary,
        title: Text(record.title),
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
          children: [
            Row(
              children: [
                record.avatarUrl == null
                    ? CircleAvatar(
                        radius: 25,
                        backgroundColor: wa.accentSoft,
                        child: Icon(record.icon, color: wa.accent),
                      )
                    : _Avatar(
                        name: record.title,
                        url: record.avatarUrl,
                        size: 50,
                      ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        record.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontSize: 19,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        record.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: wa.textSecondary),
                      ),
                    ],
                  ),
                ),
                _AdminBadge(record: record),
              ],
            ),
            const SizedBox(height: 18),
            if (actions.isNotEmpty) ...[
              Text(
                'Ações',
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 9,
                runSpacing: 9,
                children: actions
                    .map((action) => _AdminActionButton(action: action))
                    .toList(),
              ),
              const SizedBox(height: 20),
            ],
            Text(
              'Detalhes',
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 10),
            ...record.details.map(
              (detail) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _DetailChip(detail: detail),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AdminRecordTile extends StatelessWidget {
  const _AdminRecordTile({
    required this.record,
    required this.selected,
    required this.onTap,
    this.onLongPress,
  });

  final _AdminRecord record;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: selected ? wa.selectedRow : wa.panel,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 10, 14, 10),
          child: Row(
            children: [
              record.avatarUrl == null
                  ? CircleAvatar(
                      radius: 26,
                      backgroundColor: wa.accentSoft,
                      child: Icon(record.icon, color: wa.accent),
                    )
                  : _Avatar(
                      name: record.title,
                      url: record.avatarUrl,
                      size: 52,
                    ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            record.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: wa.textPrimary,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        _AdminBadge(record: record),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      record.subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: wa.textSecondary, fontSize: 13.5),
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

class _AdminRecordDetail extends ConsumerWidget {
  const _AdminRecordDetail({
    required this.record,
    required this.actionsBuilder,
  });

  final _AdminRecord record;
  final _AdminActionsBuilder? actionsBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final actions = actionsBuilder?.call(context, ref, record) ?? const [];
    return ColoredBox(
      color: wa.contentBg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            height: 82,
            padding: const EdgeInsets.symmetric(horizontal: 24),
            decoration: BoxDecoration(
              color: wa.headerBg,
              border: Border(bottom: BorderSide(color: wa.border)),
            ),
            child: Row(
              children: [
                record.avatarUrl == null
                    ? CircleAvatar(
                        radius: 26,
                        backgroundColor: wa.accentSoft,
                        child: Icon(record.icon, color: wa.accent),
                      )
                    : _Avatar(
                        name: record.title,
                        url: record.avatarUrl,
                        size: 52,
                      ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        record.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        record.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textSecondary,
                          fontSize: 13.5,
                        ),
                      ),
                    ],
                  ),
                ),
                _AdminBadge(record: record),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: record.details
                      .map((detail) => _DetailChip(detail: detail))
                      .toList(),
                ),
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text(
                    'Ações',
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: actions
                        .map((action) => _AdminActionButton(action: action))
                        .toList(),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AdminActionButton extends ConsumerStatefulWidget {
  const _AdminActionButton({required this.action});

  final _AdminRecordAction action;

  @override
  ConsumerState<_AdminActionButton> createState() => _AdminActionButtonState();
}

class _AdminActionButtonState extends ConsumerState<_AdminActionButton> {
  var _busy = false;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return FilledButton.icon(
      onPressed: _busy
          ? null
          : () async {
              setState(() => _busy = true);
              try {
                await widget.action.run();
                final successMessage = widget.action.successMessage;
                if (context.mounted &&
                    successMessage?.trim().isNotEmpty == true) {
                  showSuccessToast(context, successMessage!);
                }
              } catch (error) {
                if (context.mounted) showErrorToast(context, error);
              } finally {
                if (mounted) setState(() => _busy = false);
              }
            },
      style: FilledButton.styleFrom(
        backgroundColor: widget.action.danger
            ? const Color(0xFFE5484D)
            : wa.accent,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      icon: _busy
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
              ),
            )
          : Icon(widget.action.icon, size: 18),
      label: Text(widget.action.label),
    );
  }
}

class _DetailChip extends StatelessWidget {
  const _DetailChip({required this.detail});

  final _AdminDetail detail;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 190, maxWidth: 360),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: wa.panel,
          border: Border.all(color: wa.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                detail.label,
                style: TextStyle(
                  color: wa.textSecondary,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                detail.value,
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AdminBadge extends StatelessWidget {
  const _AdminBadge({required this.record});

  final _AdminRecord record;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: record.badgeColor.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        child: Text(
          record.badge,
          style: TextStyle(
            color: record.badgeColor,
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

class _AdminRecordEmptyDetail extends StatelessWidget {
  const _AdminRecordEmptyDetail({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.contentBg,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 72, color: wa.icon),
            const SizedBox(height: 18),
            Text(
              title,
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 28,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Nenhum item selecionado.',
              style: TextStyle(color: wa.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}

class _AdminRecord {
  const _AdminRecord({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.badge,
    required this.badgeColor,
    required this.icon,
    required this.raw,
    required this.details,
    this.avatarUrl,
  });

  factory _AdminRecord.empty(String title, IconData icon) {
    return _AdminRecord(
      id: '',
      title: title,
      subtitle: '',
      badge: '',
      badgeColor: const Color(0xFF00A884),
      icon: icon,
      raw: const {},
      details: const [],
    );
  }

  final String id;
  final String title;
  final String subtitle;
  final String badge;
  final Color badgeColor;
  final IconData icon;
  final Map<String, dynamic> raw;
  final List<_AdminDetail> details;
  final String? avatarUrl;
}

class _AdminDetail {
  const _AdminDetail(this.label, this.value);

  final String label;
  final String value;
}

class _AdminRecordAction {
  const _AdminRecordAction({
    required this.label,
    required this.icon,
    required this.run,
    this.successMessage,
    this.danger = false,
  });

  final String label;
  final IconData icon;
  final Future<void> Function() run;
  final String? successMessage;
  final bool danger;
}

List<_AdminRecordAction> _userActions(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) {
  final id = int.tryParse(record.id);
  if (id == null) return const [];
  final active = record.raw['isActive'] == true;
  return [
    _AdminRecordAction(
      label: 'Editar dados',
      icon: Icons.edit_outlined,
      run: () => _openEditUserDialog(context, ref, record),
    ),
    _AdminRecordAction(
      label: 'Saldo',
      icon: Icons.account_balance_wallet_outlined,
      run: () => _openUserBalanceDialog(context, ref, record),
    ),
    _AdminRecordAction(
      label: 'Slots de perfil',
      icon: Icons.person_add_alt_1_outlined,
      run: () => _openUserPlanDialog(context, ref, record),
    ),
    _AdminRecordAction(
      label: 'Entrar como usuário',
      icon: Icons.login_outlined,
      run: () => _impersonateUser(context, ref, record),
    ),
    _AdminRecordAction(
      label: active ? 'Desativar usuário' : 'Ativar usuário',
      icon: active ? Icons.block_outlined : Icons.check_circle_outline,
      danger: active,
      successMessage: active ? 'Usuário desativado.' : 'Usuário ativado.',
      run: () => _toggleUserActive(context, ref, record),
    ),
    _AdminRecordAction(
      label: 'Encerrar sessões',
      icon: Icons.logout_outlined,
      danger: true,
      successMessage: 'Sessões encerradas.',
      run: () => _revokeUserSessions(context, ref, record),
    ),
    _AdminRecordAction(
      label: 'Restaurar menus',
      icon: Icons.restore_outlined,
      run: () => _resetUserMenus(context, ref, record),
    ),
    _AdminRecordAction(
      label: 'Gerenciar perfis',
      icon: Icons.account_circle_outlined,
      successMessage: 'Perfis do usuário carregados.',
      run: () async {
        ref.read(adminInstanceUserFilterProvider.notifier).setUserId(id);
        ref
            .read(adminSectionProvider.notifier)
            .select(AdminPanelSection.instances);
        ref.invalidate(adminInstancesProvider);
      },
    ),
    _AdminRecordAction(
      label: 'Excluir usuário',
      icon: Icons.delete_outline,
      danger: true,
      run: () => _deleteUser(context, ref, record),
    ),
  ];
}

List<_AdminRecordAction> _settingsActions(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) {
  if (record.id == 'site') {
    return [
      _AdminRecordAction(
        label: 'Editar site',
        icon: Icons.language_outlined,
        run: () => _openAdminSiteSettingsDialog(context, ref, record),
      ),
    ];
  }
  if (record.id == 'smtp') {
    return [
      _AdminRecordAction(
        label: 'Editar SMTP',
        icon: Icons.mark_email_read_outlined,
        run: () => _openAdminSmtpSettingsDialog(context, ref, record),
      ),
      _AdminRecordAction(
        label: 'Testar envio',
        icon: Icons.outgoing_mail,
        successMessage: 'Teste SMTP enviado.',
        run: () => _sendAdminSmtpTest(context, ref),
      ),
    ];
  }
  if (record.id == 'firebase') {
    return [
      _AdminRecordAction(
        label: 'Editar Firebase',
        icon: Icons.cloud_sync_outlined,
        run: () => _openAdminFirebaseSettingsDialog(context, ref, record),
      ),
    ];
  }
  if (record.id == 'mobile') {
    return [
      _AdminRecordAction(
        label: 'Editar app',
        icon: Icons.phone_android_outlined,
        run: () => _openAdminMobileSettingsDialog(context, ref, record),
      ),
    ];
  }
  if (record.id == 'system-instance') {
    final instance = _jsonMap(record.raw['instance']);
    final hasInstance = instance.isNotEmpty;
    return [
      _AdminRecordAction(
        label: hasInstance ? 'Editar instância' : 'Criar instância',
        icon: Icons.admin_panel_settings_outlined,
        run: () => _openAdminSystemInstanceDialog(context, ref, record),
      ),
      if (hasInstance)
        _AdminRecordAction(
          label: 'Gerar pareamento',
          icon: Icons.qr_code_2_outlined,
          run: () => _pairAdminSystemInstance(context, ref),
        ),
    ];
  }
  if (record.id != 'whatsapp-verification') return const [];
  return [
    _AdminRecordAction(
      label: 'Editar regra',
      icon: Icons.tune_outlined,
      run: () => _openWhatsappVerificationDialog(context, ref, record),
    ),
  ];
}

Future<void> _openAdminSiteSettingsDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminSiteSettingsDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminSettingsProvider);
    if (context.mounted) {
      showSuccessToast(context, 'Configurações do site salvas.');
    }
  }
}

Future<void> _openAdminSmtpSettingsDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminSmtpSettingsDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminSettingsProvider);
    if (context.mounted) {
      showSuccessToast(context, 'SMTP atualizado.');
    }
  }
}

Future<void> _openAdminFirebaseSettingsDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminFirebaseSettingsDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminSettingsProvider);
    if (context.mounted) {
      showSuccessToast(context, 'Firebase atualizado.');
    }
  }
}

Future<void> _openAdminMobileSettingsDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminMobileSettingsDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminSettingsProvider);
    if (context.mounted) {
      showSuccessToast(context, 'Configurações do app salvas.');
    }
  }
}

Future<void> _sendAdminSmtpTest(BuildContext context, WidgetRef ref) async {
  final email = await _promptTextValue(
    context,
    title: 'Testar SMTP',
    label: 'E-mail de destino',
    hintText: 'seu@email.com',
    keyboardType: TextInputType.emailAddress,
  );
  if (email == null || email.trim().isEmpty) return;
  await ref
      .read(apiClientProvider)
      .postJson('/api/admin/notifications/smtp/test', data: {'email': email});
}

Future<String?> _promptTextValue(
  BuildContext context, {
  required String title,
  required String label,
  String? hintText,
  TextInputType? keyboardType,
}) async {
  final controller = TextEditingController();
  final result = await showDialog<String>(
    context: context,
    builder: (dialogContext) {
      final wa = WaTheme.of(dialogContext);
      return AlertDialog(
        backgroundColor: wa.panel,
        surfaceTintColor: Colors.transparent,
        title: Text(
          title,
          style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w800),
        ),
        content: TextField(
          controller: controller,
          keyboardType: keyboardType,
          autofocus: true,
          decoration: InputDecoration(labelText: label, hintText: hintText),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Enviar'),
          ),
        ],
      );
    },
  );
  controller.dispose();
  return result;
}

class _AdminPickedFile {
  const _AdminPickedFile({
    required this.name,
    required this.bytes,
    required this.mimeType,
  });

  final String name;
  final Uint8List bytes;
  final String mimeType;
}

const _adminImageTypeGroup = XTypeGroup(
  label: 'Imagens',
  extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'],
  mimeTypes: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
    'image/x-icon',
  ],
);

String _guessAdminMimeType(String fileName, String? candidate) {
  final typed = candidate?.trim();
  if (typed != null && typed.isNotEmpty) return typed;
  final lower = fileName.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

Future<_AdminPickedFile?> _pickAdminImageFile() async {
  final file = await openFile(acceptedTypeGroups: const [_adminImageTypeGroup]);
  if (file == null) return null;
  final bytes = await file.readAsBytes();
  if (bytes.isEmpty) return null;
  return _AdminPickedFile(
    name: file.name,
    bytes: bytes,
    mimeType: _guessAdminMimeType(file.name, file.mimeType),
  );
}

String _jsonArrayPayload(Object? value) {
  if (value is List) return jsonEncode(value);
  return '[]';
}

String _linesFromJsonArray(Object? value) {
  if (value is List) {
    return value
        .map((item) => item?.toString().trim() ?? '')
        .where((item) => item.isNotEmpty)
        .join('\n');
  }
  return '';
}

void _addFormText(FormData form, String key, Object? value) {
  form.fields.add(MapEntry(key, value?.toString() ?? ''));
}

void _addFormJsonArray(FormData form, String key, Object? value) {
  form.fields.add(MapEntry(key, _jsonArrayPayload(value)));
}

void _addFormFile(FormData form, String key, _AdminPickedFile? file) {
  if (file == null) return;
  form.files.add(
    MapEntry(
      key,
      MultipartFile.fromBytes(
        file.bytes,
        filename: file.name,
        contentType: DioMediaType.parse(file.mimeType),
      ),
    ),
  );
}

class _AdminSiteSettingsDialog extends ConsumerStatefulWidget {
  const _AdminSiteSettingsDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_AdminSiteSettingsDialog> createState() =>
      _AdminSiteSettingsDialogState();
}

class _AdminSiteSettingsDialogState
    extends ConsumerState<_AdminSiteSettingsDialog> {
  late final Map<String, dynamic> _raw;
  late final TextEditingController _siteName;
  late final TextEditingController _tagline;
  late final TextEditingController _supportEmail;
  late final TextEditingController _supportPhone;
  late final TextEditingController _supportUrl;
  late final TextEditingController _supportWhatsapp;
  late final TextEditingController _heroBadge;
  late final TextEditingController _heroTitle;
  late final TextEditingController _heroSubtitle;
  late final TextEditingController _heroButtonLabel;
  late final TextEditingController _heroButtonUrl;
  late final TextEditingController _heroSecondaryButtonLabel;
  late final TextEditingController _heroSecondaryButtonUrl;
  late final TextEditingController _featuresTitle;
  late final TextEditingController _featuresSubtitle;
  late final TextEditingController _workflowTitle;
  late final TextEditingController _workflowDescription;
  late final TextEditingController _workflowBullets;
  late final TextEditingController _ctaTitle;
  late final TextEditingController _ctaDescription;
  late final TextEditingController _ctaButtonLabel;
  late final TextEditingController _ctaButtonUrl;
  late final TextEditingController _seoTitle;
  late final TextEditingController _seoDescription;
  late final TextEditingController _seoKeywords;
  late final TextEditingController _seoHighlightKeywords;
  late final TextEditingController _footerText;
  late final TextEditingController _termsContent;
  late final TextEditingController _emailVerificationKeys;
  String _supportChannel = 'chat';
  var _emailVerificationEnabled = false;
  var _removeLogo = false;
  var _removeFavicon = false;
  var _removeSeoImage = false;
  var _removeAppIcon = false;
  var _removeHeroImage = false;
  var _removeWorkflowImage = false;
  _AdminPickedFile? _logoFile;
  _AdminPickedFile? _faviconFile;
  _AdminPickedFile? _seoImageFile;
  _AdminPickedFile? _appIconFile;
  _AdminPickedFile? _heroImageFile;
  _AdminPickedFile? _workflowImageFile;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    _raw = widget.record.raw;
    _siteName = TextEditingController(
      text: _display(_raw['siteName'], fallback: 'BotAdmin'),
    );
    _tagline = TextEditingController(text: _display(_raw['tagline']));
    _supportEmail = TextEditingController(text: _display(_raw['supportEmail']));
    _supportPhone = TextEditingController(text: _display(_raw['supportPhone']));
    _supportUrl = TextEditingController(text: _display(_raw['supportUrl']));
    _supportWhatsapp = TextEditingController(
      text: _display(_raw['supportWhatsappNumber']),
    );
    _heroBadge = TextEditingController(text: _display(_raw['heroBadge']));
    _heroTitle = TextEditingController(text: _display(_raw['heroTitle']));
    _heroSubtitle = TextEditingController(text: _display(_raw['heroSubtitle']));
    _heroButtonLabel = TextEditingController(
      text: _display(_raw['heroButtonLabel']),
    );
    _heroButtonUrl = TextEditingController(
      text: _display(_raw['heroButtonUrl']),
    );
    _heroSecondaryButtonLabel = TextEditingController(
      text: _display(_raw['heroSecondaryButtonLabel']),
    );
    _heroSecondaryButtonUrl = TextEditingController(
      text: _display(_raw['heroSecondaryButtonUrl']),
    );
    _featuresTitle = TextEditingController(
      text: _display(_raw['featuresTitle']),
    );
    _featuresSubtitle = TextEditingController(
      text: _display(_raw['featuresSubtitle']),
    );
    _workflowTitle = TextEditingController(
      text: _display(_raw['workflowTitle']),
    );
    _workflowDescription = TextEditingController(
      text: _display(_raw['workflowDescription']),
    );
    _workflowBullets = TextEditingController(
      text: _linesFromJsonArray(_raw['workflowBullets']),
    );
    _ctaTitle = TextEditingController(text: _display(_raw['ctaTitle']));
    _ctaDescription = TextEditingController(
      text: _display(_raw['ctaDescription']),
    );
    _ctaButtonLabel = TextEditingController(
      text: _display(_raw['ctaButtonLabel']),
    );
    _ctaButtonUrl = TextEditingController(text: _display(_raw['ctaButtonUrl']));
    _seoTitle = TextEditingController(text: _display(_raw['seoTitle']));
    _seoDescription = TextEditingController(
      text: _display(_raw['seoDescription']),
    );
    _seoKeywords = TextEditingController(
      text: _linesFromJsonArray(_raw['seoKeywords']),
    );
    _seoHighlightKeywords = TextEditingController(
      text: _linesFromJsonArray(_raw['seoHighlightKeywords']),
    );
    _footerText = TextEditingController(text: _display(_raw['footerText']));
    _termsContent = TextEditingController(text: _display(_raw['termsContent']));
    _emailVerificationKeys = TextEditingController(
      text: _linesFromJsonArray(_raw['emailVerificationApiKeys']),
    );
    _supportChannel = _display(_raw['supportChannel']) == 'whatsapp'
        ? 'whatsapp'
        : 'chat';
    _emailVerificationEnabled = _raw['emailVerificationEnabled'] == true;
  }

  @override
  void dispose() {
    for (final controller in [
      _siteName,
      _tagline,
      _supportEmail,
      _supportPhone,
      _supportUrl,
      _supportWhatsapp,
      _heroBadge,
      _heroTitle,
      _heroSubtitle,
      _heroButtonLabel,
      _heroButtonUrl,
      _heroSecondaryButtonLabel,
      _heroSecondaryButtonUrl,
      _featuresTitle,
      _featuresSubtitle,
      _workflowTitle,
      _workflowDescription,
      _workflowBullets,
      _ctaTitle,
      _ctaDescription,
      _ctaButtonLabel,
      _ctaButtonUrl,
      _seoTitle,
      _seoDescription,
      _seoKeywords,
      _seoHighlightKeywords,
      _footerText,
      _termsContent,
      _emailVerificationKeys,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _selectFile(String key) async {
    final file = await _pickAdminImageFile();
    if (file == null) return;
    setState(() {
      switch (key) {
        case 'logo':
          _logoFile = file;
          _removeLogo = false;
          break;
        case 'favicon':
          _faviconFile = file;
          _removeFavicon = false;
          break;
        case 'seo':
          _seoImageFile = file;
          _removeSeoImage = false;
          break;
        case 'app':
          _appIconFile = file;
          _removeAppIcon = false;
          break;
        case 'hero':
          _heroImageFile = file;
          _removeHeroImage = false;
          break;
        case 'workflow':
          _workflowImageFile = file;
          _removeWorkflowImage = false;
          break;
      }
    });
  }

  Future<void> _save() async {
    if (_siteName.text.trim().isEmpty) {
      showErrorToast(context, 'Informe o nome do site.');
      return;
    }
    setState(() => _busy = true);
    try {
      final form = FormData();
      _addFormText(form, 'siteName', _siteName.text);
      _addFormText(form, 'tagline', _tagline.text);
      _addFormText(form, 'supportEmail', _supportEmail.text);
      _addFormText(form, 'supportPhone', _supportPhone.text);
      _addFormText(form, 'supportUrl', _supportUrl.text);
      _addFormText(form, 'supportChatMode', _supportChannel);
      _addFormText(form, 'supportWhatsappNumber', _supportWhatsapp.text);
      _addFormText(
        form,
        'emailVerificationEnabled',
        _emailVerificationEnabled ? 'true' : 'false',
      );
      _addFormText(
        form,
        'emailVerificationApiKeys',
        _emailVerificationKeys.text,
      );
      _addFormText(form, 'heroBadge', _heroBadge.text);
      _addFormText(form, 'heroTitle', _heroTitle.text);
      _addFormText(form, 'heroSubtitle', _heroSubtitle.text);
      _addFormText(form, 'heroButtonLabel', _heroButtonLabel.text);
      _addFormText(form, 'heroButtonUrl', _heroButtonUrl.text);
      _addFormText(
        form,
        'heroSecondaryButtonLabel',
        _heroSecondaryButtonLabel.text,
      );
      _addFormText(
        form,
        'heroSecondaryButtonUrl',
        _heroSecondaryButtonUrl.text,
      );
      _addFormText(form, 'featuresTitle', _featuresTitle.text);
      _addFormText(form, 'featuresSubtitle', _featuresSubtitle.text);
      _addFormJsonArray(form, 'features', _raw['features']);
      _addFormText(form, 'workflowTitle', _workflowTitle.text);
      _addFormText(form, 'workflowDescription', _workflowDescription.text);
      _addFormText(
        form,
        'workflowBullets',
        jsonEncode(
          _workflowBullets.text
              .split(RegExp(r'\r?\n'))
              .map((line) => line.trim())
              .where((line) => line.isNotEmpty)
              .toList(),
        ),
      );
      _addFormText(form, 'ctaTitle', _ctaTitle.text);
      _addFormText(form, 'ctaDescription', _ctaDescription.text);
      _addFormText(form, 'ctaButtonLabel', _ctaButtonLabel.text);
      _addFormText(form, 'ctaButtonUrl', _ctaButtonUrl.text);
      _addFormText(form, 'seoTitle', _seoTitle.text);
      _addFormText(form, 'seoDescription', _seoDescription.text);
      _addFormText(form, 'seoKeywords', _seoKeywords.text);
      _addFormText(form, 'seoHighlightKeywords', _seoHighlightKeywords.text);
      _addFormText(form, 'footerText', _footerText.text);
      _addFormText(form, 'termsContent', _termsContent.text);
      _addFormJsonArray(form, 'userPanelBanners', _raw['userPanelBanners']);
      _addFormJsonArray(form, 'testGroups', _raw['testGroups']);
      _addFormJsonArray(form, 'officialGroups', _raw['officialGroups']);
      _addFormText(
        form,
        'officialGroupInstanceId',
        _raw['officialGroupInstanceId'],
      );
      _addFormText(form, 'officialGroupJid', _raw['officialGroupJid']);
      _addFormText(form, 'removeLogo', _removeLogo ? 'true' : 'false');
      _addFormText(form, 'removeFavicon', _removeFavicon ? 'true' : 'false');
      _addFormText(form, 'removeSeoImage', _removeSeoImage ? 'true' : 'false');
      _addFormText(form, 'removeAppIcon', _removeAppIcon ? 'true' : 'false');
      _addFormText(
        form,
        'removeHeroImage',
        _removeHeroImage ? 'true' : 'false',
      );
      _addFormText(
        form,
        'removeWorkflowImage',
        _removeWorkflowImage ? 'true' : 'false',
      );
      _addFormFile(form, 'logo', _logoFile);
      _addFormFile(form, 'favicon', _faviconFile);
      _addFormFile(form, 'seoImage', _seoImageFile);
      _addFormFile(form, 'appIcon', _appIconFile);
      _addFormFile(form, 'heroImage', _heroImageFile);
      _addFormFile(form, 'workflowImage', _workflowImageFile);
      await ref.read(apiClientProvider).putFormData('/api/admin/site', form);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 620;
    return _AdminSettingsDialogFrame(
      title: 'Configurações do site',
      subtitle: 'Marca, SEO, contatos e ícones.',
      icon: Icons.language_outlined,
      busy: _busy,
      maxWidth: 860,
      onClose: () => Navigator.of(context).pop(false),
      onSave: _save,
      saveLabel: 'Salvar site',
      children: [
        _SettingsSectionTitle('Marca'),
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _siteName,
              decoration: const InputDecoration(
                labelText: 'Nome do site',
                prefixIcon: Icon(Icons.badge_outlined),
              ),
            ),
            TextField(
              controller: _tagline,
              decoration: const InputDecoration(
                labelText: 'Tagline',
                prefixIcon: Icon(Icons.short_text_outlined),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _AdminAssetButton(
              label: 'Logo',
              currentUrl: _display(_raw['logoUrl']),
              selectedName: _logoFile?.name,
              removed: _removeLogo,
              onPick: () => _selectFile('logo'),
              onRemove: () => setState(() => _removeLogo = !_removeLogo),
            ),
            _AdminAssetButton(
              label: 'Favicon',
              currentUrl: _display(_raw['faviconUrl']),
              selectedName: _faviconFile?.name,
              removed: _removeFavicon,
              onPick: () => _selectFile('favicon'),
              onRemove: () => setState(() => _removeFavicon = !_removeFavicon),
            ),
            _AdminAssetButton(
              label: 'Ícone do app',
              currentUrl: _display(_raw['mobileAppIconUrl']),
              selectedName: _appIconFile?.name,
              removed: _removeAppIcon,
              onPick: () => _selectFile('app'),
              onRemove: () => setState(() => _removeAppIcon = !_removeAppIcon),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _SettingsSectionTitle('Suporte'),
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _supportEmail,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: 'E-mail de suporte',
                prefixIcon: Icon(Icons.alternate_email),
              ),
            ),
            TextField(
              controller: _supportPhone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Telefone de suporte',
                prefixIcon: Icon(Icons.phone_outlined),
              ),
            ),
            TextField(
              controller: _supportUrl,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'URL de suporte',
                prefixIcon: Icon(Icons.link_outlined),
              ),
            ),
            TextField(
              controller: _supportWhatsapp,
              keyboardType: TextInputType.phone,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
              ],
              decoration: const InputDecoration(
                labelText: 'WhatsApp suporte',
                prefixIcon: Icon(Icons.chat_outlined),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(
              value: 'chat',
              icon: Icon(Icons.support_agent_outlined),
              label: Text('Chat'),
            ),
            ButtonSegment(
              value: 'whatsapp',
              icon: Icon(Icons.chat_outlined),
              label: Text('WhatsApp'),
            ),
          ],
          selected: {_supportChannel},
          onSelectionChanged: _busy
              ? null
              : (values) => setState(() => _supportChannel = values.first),
        ),
        const SizedBox(height: 18),
        _SettingsSectionTitle('SEO'),
        TextField(
          controller: _seoTitle,
          decoration: const InputDecoration(
            labelText: 'Título SEO',
            prefixIcon: Icon(Icons.title_outlined),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _seoDescription,
          minLines: 3,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'Descrição SEO',
            alignLabelWithHint: true,
            prefixIcon: Icon(Icons.notes_outlined),
          ),
        ),
        const SizedBox(height: 12),
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _seoKeywords,
              minLines: 3,
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: 'Palavras-chave',
                alignLabelWithHint: true,
                prefixIcon: Icon(Icons.tag_outlined),
              ),
            ),
            TextField(
              controller: _seoHighlightKeywords,
              minLines: 3,
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: 'Destaques SEO',
                alignLabelWithHint: true,
                prefixIcon: Icon(Icons.auto_awesome_outlined),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _AdminAssetButton(
          label: 'Imagem SEO',
          currentUrl: _display(_raw['seoImageUrl']),
          selectedName: _seoImageFile?.name,
          removed: _removeSeoImage,
          onPick: () => _selectFile('seo'),
          onRemove: () => setState(() => _removeSeoImage = !_removeSeoImage),
        ),
        const SizedBox(height: 18),
        _SettingsSectionTitle('Homepage'),
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _heroBadge,
              decoration: const InputDecoration(labelText: 'Badge do hero'),
            ),
            TextField(
              controller: _heroTitle,
              decoration: const InputDecoration(labelText: 'Título do hero'),
            ),
            TextField(
              controller: _heroButtonLabel,
              decoration: const InputDecoration(labelText: 'Botão principal'),
            ),
            TextField(
              controller: _heroButtonUrl,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'URL principal'),
            ),
            TextField(
              controller: _heroSecondaryButtonLabel,
              decoration: const InputDecoration(labelText: 'Botão secundário'),
            ),
            TextField(
              controller: _heroSecondaryButtonUrl,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'URL secundária'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _heroSubtitle,
          minLines: 3,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'Subtítulo do hero',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _AdminAssetButton(
              label: 'Imagem hero',
              currentUrl: _display(_raw['heroImageUrl']),
              selectedName: _heroImageFile?.name,
              removed: _removeHeroImage,
              onPick: () => _selectFile('hero'),
              onRemove: () =>
                  setState(() => _removeHeroImage = !_removeHeroImage),
            ),
            _AdminAssetButton(
              label: 'Imagem workflow',
              currentUrl: _display(_raw['workflowImageUrl']),
              selectedName: _workflowImageFile?.name,
              removed: _removeWorkflowImage,
              onPick: () => _selectFile('workflow'),
              onRemove: () =>
                  setState(() => _removeWorkflowImage = !_removeWorkflowImage),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _featuresTitle,
              decoration: const InputDecoration(labelText: 'Título recursos'),
            ),
            TextField(
              controller: _featuresSubtitle,
              decoration: const InputDecoration(
                labelText: 'Subtítulo recursos',
              ),
            ),
            TextField(
              controller: _workflowTitle,
              decoration: const InputDecoration(labelText: 'Título workflow'),
            ),
            TextField(
              controller: _ctaTitle,
              decoration: const InputDecoration(labelText: 'Título CTA'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _workflowDescription,
          minLines: 3,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'Descrição workflow',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _workflowBullets,
          minLines: 3,
          maxLines: 6,
          decoration: const InputDecoration(
            labelText: 'Bullets do workflow',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _ctaButtonLabel,
              decoration: const InputDecoration(labelText: 'Botão CTA'),
            ),
            TextField(
              controller: _ctaButtonUrl,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'URL CTA'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _ctaDescription,
          minLines: 3,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'Descrição CTA',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 18),
        _SettingsSectionTitle('Cadastro e termos'),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          value: _emailVerificationEnabled,
          onChanged: _busy
              ? null
              : (value) => setState(() => _emailVerificationEnabled = value),
          title: Text(
            'Verificação por e-mail',
            style: TextStyle(color: wa.textPrimary),
          ),
          subtitle: Text(
            'Mantido para compatibilidade com o cadastro antigo.',
            style: TextStyle(color: wa.textSecondary),
          ),
        ),
        TextField(
          controller: _emailVerificationKeys,
          minLines: 2,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Chaves de validação de e-mail',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _footerText,
          decoration: const InputDecoration(labelText: 'Texto do rodapé'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _termsContent,
          minLines: 6,
          maxLines: 12,
          decoration: const InputDecoration(
            labelText: 'Termos',
            alignLabelWithHint: true,
          ),
        ),
      ],
    );
  }
}

class _AdminSmtpSettingsDialog extends ConsumerStatefulWidget {
  const _AdminSmtpSettingsDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_AdminSmtpSettingsDialog> createState() =>
      _AdminSmtpSettingsDialogState();
}

class _AdminSmtpSettingsDialogState
    extends ConsumerState<_AdminSmtpSettingsDialog> {
  late final TextEditingController _host;
  late final TextEditingController _port;
  late final TextEditingController _username;
  late final TextEditingController _password;
  late final TextEditingController _fromName;
  late final TextEditingController _fromEmail;
  late final TextEditingController _replyTo;
  var _secure = false;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    final raw = widget.record.raw;
    _host = TextEditingController(text: _display(raw['host']));
    _port = TextEditingController(text: _display(raw['port'], fallback: '587'));
    _username = TextEditingController(text: _display(raw['username']));
    _password = TextEditingController();
    _fromName = TextEditingController(
      text: _display(raw['fromName'], fallback: 'BotAdmin'),
    );
    _fromEmail = TextEditingController(text: _display(raw['fromEmail']));
    _replyTo = TextEditingController(text: _display(raw['replyTo']));
    _secure = raw['secure'] == true;
  }

  @override
  void dispose() {
    _host.dispose();
    _port.dispose();
    _username.dispose();
    _password.dispose();
    _fromName.dispose();
    _fromEmail.dispose();
    _replyTo.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .putJson(
            '/api/admin/notifications/smtp',
            data: {
              'host': _host.text,
              'port': int.tryParse(_port.text.trim()) ?? 587,
              'secure': _secure,
              'username': _username.text,
              'password': _password.text,
              'fromName': _fromName.text,
              'fromEmail': _fromEmail.text,
              'replyTo': _replyTo.text,
            },
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 620;
    return _AdminSettingsDialogFrame(
      title: 'SMTP e e-mails',
      subtitle: 'Envio de códigos, alertas e notificações.',
      icon: Icons.mark_email_read_outlined,
      busy: _busy,
      onClose: () => Navigator.of(context).pop(false),
      onSave: _save,
      saveLabel: 'Salvar SMTP',
      children: [
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _host,
              decoration: const InputDecoration(
                labelText: 'Host SMTP',
                prefixIcon: Icon(Icons.dns_outlined),
              ),
            ),
            TextField(
              controller: _port,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Porta',
                prefixIcon: Icon(Icons.numbers_outlined),
              ),
            ),
            TextField(
              controller: _username,
              decoration: const InputDecoration(
                labelText: 'Usuário',
                prefixIcon: Icon(Icons.person_outline),
              ),
            ),
            TextField(
              controller: _password,
              obscureText: true,
              decoration: InputDecoration(
                labelText: widget.record.raw['hasPassword'] == true
                    ? 'Nova senha (vazio mantém atual)'
                    : 'Senha',
                prefixIcon: const Icon(Icons.password_outlined),
              ),
            ),
            TextField(
              controller: _fromName,
              decoration: const InputDecoration(
                labelText: 'Nome do remetente',
                prefixIcon: Icon(Icons.badge_outlined),
              ),
            ),
            TextField(
              controller: _fromEmail,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: 'E-mail remetente',
                prefixIcon: Icon(Icons.alternate_email),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _replyTo,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(
            labelText: 'Responder para',
            prefixIcon: Icon(Icons.reply_outlined),
          ),
        ),
        const SizedBox(height: 8),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          value: _secure,
          onChanged: _busy ? null : (value) => setState(() => _secure = value),
          title: const Text('Usar conexão segura SSL/TLS'),
        ),
      ],
    );
  }
}

class _AdminFirebaseSettingsDialog extends ConsumerStatefulWidget {
  const _AdminFirebaseSettingsDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_AdminFirebaseSettingsDialog> createState() =>
      _AdminFirebaseSettingsDialogState();
}

class _AdminFirebaseSettingsDialogState
    extends ConsumerState<_AdminFirebaseSettingsDialog> {
  late final TextEditingController _projectId;
  late final TextEditingController _clientEmail;
  late final TextEditingController _privateKey;
  late final TextEditingController _webApiKey;
  late final TextEditingController _webAuthDomain;
  late final TextEditingController _webProjectId;
  late final TextEditingController _webStorageBucket;
  late final TextEditingController _webMessagingSenderId;
  late final TextEditingController _webAppId;
  late final TextEditingController _webMeasurementId;
  late final TextEditingController _vapidKey;
  _AdminPickedFile? _serviceAccountFile;
  _AdminPickedFile? _googleServicesFile;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    final raw = widget.record.raw;
    _projectId = TextEditingController(text: _display(raw['projectId']));
    _clientEmail = TextEditingController(text: _display(raw['clientEmail']));
    _privateKey = TextEditingController(text: _display(raw['privateKey']));
    _webApiKey = TextEditingController(text: _display(raw['webApiKey']));
    _webAuthDomain = TextEditingController(
      text: _display(raw['webAuthDomain']),
    );
    _webProjectId = TextEditingController(text: _display(raw['webProjectId']));
    _webStorageBucket = TextEditingController(
      text: _display(raw['webStorageBucket']),
    );
    _webMessagingSenderId = TextEditingController(
      text: _display(raw['webMessagingSenderId']),
    );
    _webAppId = TextEditingController(text: _display(raw['webAppId']));
    _webMeasurementId = TextEditingController(
      text: _display(raw['webMeasurementId']),
    );
    _vapidKey = TextEditingController(text: _display(raw['vapidKey']));
  }

  @override
  void dispose() {
    for (final controller in [
      _projectId,
      _clientEmail,
      _privateKey,
      _webApiKey,
      _webAuthDomain,
      _webProjectId,
      _webStorageBucket,
      _webMessagingSenderId,
      _webAppId,
      _webMeasurementId,
      _vapidKey,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<_AdminPickedFile?> _pickJsonFile() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'JSON',
          extensions: ['json'],
          mimeTypes: ['application/json'],
        ),
      ],
    );
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) return null;
    return _AdminPickedFile(
      name: file.name,
      bytes: bytes,
      mimeType: file.mimeType ?? 'application/json',
    );
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      final form = FormData();
      _addFormText(form, 'projectId', _projectId.text);
      _addFormText(form, 'clientEmail', _clientEmail.text);
      _addFormText(form, 'privateKey', _privateKey.text);
      _addFormText(form, 'webApiKey', _webApiKey.text);
      _addFormText(form, 'webAuthDomain', _webAuthDomain.text);
      _addFormText(form, 'webProjectId', _webProjectId.text);
      _addFormText(form, 'webStorageBucket', _webStorageBucket.text);
      _addFormText(form, 'webMessagingSenderId', _webMessagingSenderId.text);
      _addFormText(form, 'webAppId', _webAppId.text);
      _addFormText(form, 'webMeasurementId', _webMeasurementId.text);
      _addFormText(form, 'vapidKey', _vapidKey.text);
      _addFormFile(form, 'serviceAccount', _serviceAccountFile);
      _addFormFile(form, 'googleServices', _googleServicesFile);
      await ref
          .read(apiClientProvider)
          .postFormData('/api/admin/firebase/settings', form);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 620;
    return _AdminSettingsDialogFrame(
      title: 'Firebase e push',
      subtitle: 'Credenciais web, service account e VAPID.',
      icon: Icons.cloud_sync_outlined,
      busy: _busy,
      maxWidth: 820,
      onClose: () => Navigator.of(context).pop(false),
      onSave: _save,
      saveLabel: 'Salvar Firebase',
      children: [
        _SettingsSectionTitle('Service account'),
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _projectId,
              decoration: const InputDecoration(labelText: 'Project ID'),
            ),
            TextField(
              controller: _clientEmail,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Client email'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _privateKey,
          minLines: 3,
          maxLines: 6,
          decoration: const InputDecoration(
            labelText: 'Private key',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _AdminPlainButton(
              icon: Icons.upload_file_outlined,
              label: _serviceAccountFile?.name ?? 'Enviar serviceAccount JSON',
              onPressed: _busy
                  ? null
                  : () async {
                      final file = await _pickJsonFile();
                      if (file != null) {
                        setState(() => _serviceAccountFile = file);
                      }
                    },
            ),
            _AdminPlainButton(
              icon: Icons.android_outlined,
              label: _googleServicesFile?.name ?? 'Enviar google-services.json',
              onPressed: _busy
                  ? null
                  : () async {
                      final file = await _pickJsonFile();
                      if (file != null) {
                        setState(() => _googleServicesFile = file);
                      }
                    },
            ),
          ],
        ),
        const SizedBox(height: 18),
        _SettingsSectionTitle('Configuração web'),
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _webApiKey,
              decoration: const InputDecoration(labelText: 'Web API key'),
            ),
            TextField(
              controller: _webAuthDomain,
              decoration: const InputDecoration(labelText: 'Auth domain'),
            ),
            TextField(
              controller: _webProjectId,
              decoration: const InputDecoration(labelText: 'Web project ID'),
            ),
            TextField(
              controller: _webStorageBucket,
              decoration: const InputDecoration(labelText: 'Storage bucket'),
            ),
            TextField(
              controller: _webMessagingSenderId,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Messaging sender ID',
              ),
            ),
            TextField(
              controller: _webAppId,
              decoration: const InputDecoration(labelText: 'Web app ID'),
            ),
            TextField(
              controller: _webMeasurementId,
              decoration: const InputDecoration(labelText: 'Measurement ID'),
            ),
            TextField(
              controller: _vapidKey,
              decoration: const InputDecoration(labelText: 'VAPID key'),
            ),
          ],
        ),
      ],
    );
  }
}

class _AdminMobileSettingsDialog extends ConsumerStatefulWidget {
  const _AdminMobileSettingsDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_AdminMobileSettingsDialog> createState() =>
      _AdminMobileSettingsDialogState();
}

class _AdminMobileSettingsDialogState
    extends ConsumerState<_AdminMobileSettingsDialog> {
  late final TextEditingController _appName;
  late final TextEditingController _packageName;
  late final TextEditingController _versionCode;
  late final TextEditingController _versionName;
  late final TextEditingController _serverUrl;
  late final TextEditingController _minVersionCode;
  late final TextEditingController _releaseNotes;
  var _onboardingEnabled = false;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    final raw = widget.record.raw;
    _appName = TextEditingController(
      text: _display(raw['appName'], fallback: 'Bot Admin'),
    );
    _packageName = TextEditingController(
      text: _display(raw['packageName'], fallback: 'com.botadmin.shop'),
    );
    _versionCode = TextEditingController(
      text: _display(raw['versionCode'], fallback: '1'),
    );
    _versionName = TextEditingController(
      text: _display(raw['versionName'], fallback: '1.0'),
    );
    _serverUrl = TextEditingController(text: _display(raw['serverUrl']));
    _minVersionCode = TextEditingController(
      text: _display(raw['minVersionCode']),
    );
    _releaseNotes = TextEditingController(text: _display(raw['releaseNotes']));
    _onboardingEnabled = raw['onboardingEnabled'] == true;
  }

  @override
  void dispose() {
    _appName.dispose();
    _packageName.dispose();
    _versionCode.dispose();
    _versionName.dispose();
    _serverUrl.dispose();
    _minVersionCode.dispose();
    _releaseNotes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      final form = FormData();
      _addFormText(form, 'appName', _appName.text);
      _addFormText(form, 'packageName', _packageName.text);
      _addFormText(form, 'versionCode', _versionCode.text);
      _addFormText(form, 'versionName', _versionName.text);
      _addFormText(form, 'serverUrl', _serverUrl.text);
      _addFormText(form, 'minVersionCode', _minVersionCode.text);
      _addFormText(form, 'releaseNotes', _releaseNotes.text);
      _addFormText(
        form,
        'onboardingEnabled',
        _onboardingEnabled ? 'true' : 'false',
      );
      _addFormJsonArray(
        form,
        'onboardingSlides',
        widget.record.raw['onboardingSlides'],
      );
      await ref
          .read(apiClientProvider)
          .putFormData('/api/admin/mobile/settings', form);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 620;
    return _AdminSettingsDialogFrame(
      title: 'Aplicativo mobile',
      subtitle: 'Pacote, versão, servidor e regras de atualização.',
      icon: Icons.phone_android_outlined,
      busy: _busy,
      onClose: () => Navigator.of(context).pop(false),
      onSave: _save,
      saveLabel: 'Salvar app',
      children: [
        _ResponsiveFieldGrid(
          compact: compact,
          children: [
            TextField(
              controller: _appName,
              decoration: const InputDecoration(labelText: 'Nome do app'),
            ),
            TextField(
              controller: _packageName,
              decoration: const InputDecoration(labelText: 'Pacote Android'),
            ),
            TextField(
              controller: _versionCode,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Version code'),
            ),
            TextField(
              controller: _versionName,
              decoration: const InputDecoration(labelText: 'Version name'),
            ),
            TextField(
              controller: _serverUrl,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'URL do servidor'),
            ),
            TextField(
              controller: _minVersionCode,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Version code mínimo',
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _releaseNotes,
          minLines: 4,
          maxLines: 8,
          decoration: const InputDecoration(
            labelText: 'Notas da versão',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 8),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          value: _onboardingEnabled,
          onChanged: _busy
              ? null
              : (value) => setState(() => _onboardingEnabled = value),
          title: const Text('Onboarding ativo'),
        ),
      ],
    );
  }
}

class _AdminSettingsDialogFrame extends StatelessWidget {
  const _AdminSettingsDialogFrame({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.busy,
    required this.onClose,
    required this.onSave,
    required this.saveLabel,
    required this.children,
    this.maxWidth = 720,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final bool busy;
  final VoidCallback onClose;
  final VoidCallback onSave;
  final String saveLabel;
  final List<Widget> children;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 560;
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: EdgeInsets.all(compact ? 12 : 24),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: wa.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(
                  compact ? 16 : 22,
                  compact ? 16 : 20,
                  compact ? 10 : 16,
                  12,
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: wa.accentSoft,
                      child: Icon(icon, color: wa.accent),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: TextStyle(
                              color: wa.textPrimary,
                              fontSize: compact ? 20 : 22,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            subtitle,
                            style: TextStyle(color: wa.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: busy ? null : onClose,
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Divider(height: 1, color: wa.border),
              Flexible(
                child: SingleChildScrollView(
                  padding: EdgeInsets.all(compact ? 16 : 22),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: children,
                  ),
                ),
              ),
              Divider(height: 1, color: wa.border),
              Padding(
                padding: EdgeInsets.all(compact ? 12 : 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: busy ? null : onClose,
                      child: const Text('Cancelar'),
                    ),
                    const SizedBox(width: 10),
                    FilledButton.icon(
                      onPressed: busy ? null : onSave,
                      icon: busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.save_outlined),
                      label: Text(busy ? 'Salvando...' : saveLabel),
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

class _ResponsiveFieldGrid extends StatelessWidget {
  const _ResponsiveFieldGrid({required this.compact, required this.children});

  final bool compact;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (compact) {
      return Column(
        children: [
          for (final child in children) ...[
            child,
            if (child != children.last) const SizedBox(height: 12),
          ],
        ],
      );
    }
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: children
          .map((child) => SizedBox(width: 390, child: child))
          .toList(),
    );
  }
}

class _SettingsSectionTitle extends StatelessWidget {
  const _SettingsSectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        text,
        style: TextStyle(
          color: wa.textPrimary,
          fontSize: 16,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _AdminPlainButton extends StatelessWidget {
  const _AdminPlainButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 18),
      label: Text(label),
    );
  }
}

class _AdminAssetButton extends StatelessWidget {
  const _AdminAssetButton({
    required this.label,
    required this.currentUrl,
    required this.selectedName,
    required this.removed,
    required this.onPick,
    required this.onRemove,
  });

  final String label;
  final String currentUrl;
  final String? selectedName;
  final bool removed;
  final VoidCallback onPick;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final status = selectedName?.trim().isNotEmpty == true
        ? selectedName!
        : removed
        ? 'Será removido'
        : currentUrl.trim().isNotEmpty
        ? 'Arquivo atual salvo'
        : 'Sem arquivo';
    return Container(
      width: 260,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: wa.contentBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: wa.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              color: wa.textPrimary,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            status,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: wa.textSecondary, fontSize: 12.5),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onPick,
                  icon: const Icon(Icons.upload_outlined, size: 17),
                  label: const Text('Arquivo'),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                tooltip: removed ? 'Manter atual' : 'Remover atual',
                onPressed: onRemove,
                icon: Icon(
                  removed ? Icons.undo_outlined : Icons.delete_outline,
                  color: removed ? wa.accent : const Color(0xFFE5484D),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

_AdminRecord _supportEntryToAdminRecord(AdminSupportThreadEntry entry) {
  final raw = <String, dynamic>{
    'id': entry.user.id,
    'name': entry.user.name,
    'email': entry.user.email,
    'whatsappNumber': entry.user.whatsappNumber,
    'avatarUrl': entry.user.avatarUrl,
    'role': 'user',
    'isActive': entry.user.isActive,
    'hasActiveSubscription': entry.user.hasActiveSubscription,
  };
  final title = entry.displayName.trim().isEmpty
      ? 'Usuário #${entry.user.id}'
      : entry.displayName.trim();
  final subtitle = _display(
    entry.user.email,
    fallback: _display(
      entry.user.whatsappNumber,
      fallback: entry.thread.displayWhatsappId ?? entry.thread.whatsappId,
    ),
  );
  return _AdminRecord(
    id: '${entry.user.id}',
    title: title,
    subtitle: subtitle,
    badge: entry.user.hasActiveSubscription
        ? 'Assinatura ativa'
        : 'Sem assinatura',
    badgeColor: entry.user.hasActiveSubscription
        ? const Color(0xFF00A884)
        : const Color(0xFFE09F3E),
    avatarUrl: entry.user.avatarUrl,
    icon: Icons.person_outline,
    raw: raw,
    details: [
      _AdminDetail('ID', '${entry.user.id}'),
      _AdminDetail('E-mail', _display(entry.user.email)),
      _AdminDetail('WhatsApp', _display(entry.user.whatsappNumber)),
      _AdminDetail(
        'Assinatura',
        entry.user.hasActiveSubscription ? 'Ativa' : 'Sem assinatura ativa',
      ),
      _AdminDetail('Conta', entry.user.isActive ? 'Ativa' : 'Bloqueada'),
    ],
  );
}

Future<void> _openCreateUserDialog(BuildContext context, WidgetRef ref) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const _AdminUserEditorDialog(),
  );
  if (saved == true) {
    ref.invalidate(adminUsersProvider);
    if (context.mounted) showSuccessToast(context, 'Usuário criado.');
  }
}

Future<void> _openEditUserDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminUserEditorDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminUsersProvider);
    if (context.mounted) showSuccessToast(context, 'Dados do usuário salvos.');
  }
}

Future<void> _openWhatsappVerificationDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _WhatsappVerificationSettingsDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminSettingsProvider);
    if (context.mounted) {
      showSuccessToast(context, 'Verificação de WhatsApp atualizada.');
    }
  }
}

Future<void> _openAdminSystemInstanceDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminSystemInstanceDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminSettingsProvider);
    if (context.mounted) {
      showSuccessToast(context, 'Instância do painel admin atualizada.');
    }
  }
}

Future<void> _pairAdminSystemInstance(
  BuildContext context,
  WidgetRef ref,
) async {
  try {
    final json = await ref
        .read(apiClientProvider)
        .postJson('/api/admin/system-instance/pair', data: {'mode': 'auto'});
    if (!context.mounted) return;
    ref.invalidate(adminSettingsProvider);
    await showDialog<void>(
      context: context,
      builder: (_) => _AdminSystemPairingDialog(response: json),
    );
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

Future<void> _openUserBalanceDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminUserBalanceDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminUsersProvider);
    if (context.mounted) showSuccessToast(context, 'Saldo atualizado.');
  }
}

Future<void> _openUserPlanDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminUserPlanDialog(record: record),
  );
  if (saved == true) {
    ref.invalidate(adminUsersProvider);
    ref.invalidate(adminPlansProvider);
    if (context.mounted) {
      showSuccessToast(context, 'Slots de perfil atualizados.');
    }
  }
}

Future<void> _impersonateUser(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final confirmed = await _confirmAdminAction(
    context,
    title: 'Entrar como ${record.title}?',
    message:
        'A sessão atual será trocada para o painel desse usuário. Você poderá voltar pelo fluxo administrativo existente.',
    confirmLabel: 'Entrar',
  );
  if (confirmed != true) return;
  final id = int.tryParse(record.id);
  if (id == null) return;
  try {
    final session = await ref.read(apiClientProvider).impersonateUser(id);
    ref.read(authControllerProvider.notifier).setSession(session);
    if (context.mounted) {
      showSuccessToast(context, 'Sessão iniciada como ${session.user.name}.');
    }
    redirectToPath('/dashboard/user');
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

Future<void> _toggleUserActive(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final id = int.tryParse(record.id);
  if (id == null) return;
  final active = record.raw['isActive'] != false;
  final confirmed = await _confirmAdminAction(
    context,
    title: active ? 'Desativar ${record.title}?' : 'Ativar ${record.title}?',
    message: active
        ? 'Esse usuário perderá acesso ao painel até ser ativado novamente.'
        : 'Esse usuário voltará a acessar o painel normalmente.',
    confirmLabel: active ? 'Desativar' : 'Ativar',
    danger: active,
  );
  if (confirmed != true) return;
  await ref
      .read(apiClientProvider)
      .patchJson('/api/admin/users/$id', data: {'isActive': !active});
  ref.invalidate(adminUsersProvider);
}

Future<void> _revokeUserSessions(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final id = int.tryParse(record.id);
  if (id == null) return;
  final confirmed = await _confirmAdminAction(
    context,
    title: 'Encerrar sessões de ${record.title}?',
    message:
        'Todas as sessões abertas desse usuário serão encerradas e ele precisará entrar novamente.',
    confirmLabel: 'Encerrar sessões',
    danger: true,
  );
  if (confirmed != true) return;
  await ref
      .read(apiClientProvider)
      .patchJson('/api/admin/users/$id', data: {'revokeSessions': true});
  ref.invalidate(adminUsersProvider);
}

Future<void> _resetUserMenus(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final confirmed = await _confirmAdminAction(
    context,
    title: 'Restaurar menus do usuário?',
    message:
        'Os textos de menu dos grupos desse usuário serão restaurados para o padrão do BotAdmin.',
    confirmLabel: 'Restaurar',
  );
  if (confirmed != true) return;
  final json = await ref
      .read(apiClientProvider)
      .patchJson(
        '/api/admin/users/${record.id}',
        data: {'resetMenuTexts': true},
      );
  ref.invalidate(adminUsersProvider);
  if (context.mounted) {
    showSuccessToast(
      context,
      _display(json['message'], fallback: 'Menus restaurados.'),
    );
  }
}

Future<void> _deleteUser(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final confirmed = await _confirmAdminAction(
    context,
    title: 'Excluir ${record.title}?',
    message:
        'Essa ação remove permanentemente o usuário. Use apenas quando tiver certeza.',
    confirmLabel: 'Excluir',
    danger: true,
  );
  if (confirmed != true) return;
  final json = await ref
      .read(apiClientProvider)
      .deleteJson('/api/admin/users/${record.id}');
  ref.invalidate(adminUsersProvider);
  if (context.mounted) {
    showSuccessToast(
      context,
      _display(json['message'], fallback: 'Usuário excluído.'),
    );
  }
}

Future<void> _openEmptyRegistrationCleanupDialog(
  BuildContext context,
  WidgetRef ref,
) async {
  try {
    final api = ref.read(apiClientProvider);
    final preview = await api.getJson('/api/admin/users/cleanup?limit=10');
    if (!context.mounted) return;

    final eligibleCount = _asInt(preview['eligibleCount']);
    final minimumAgeDays = _asInt(preview['minimumAgeDays']);
    if (eligibleCount <= 0) {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Nenhum cadastro vazio'),
          content: Text(
            'Não há contas elegíveis para limpeza. A rotina preserva qualquer usuário com '
            'histórico, sessão, assinatura, pagamento, grupo, mensagem, saldo ou configuração.',
            style: TextStyle(color: WaTheme.of(dialogContext).textSecondary),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Entendi'),
            ),
          ],
        ),
      );
      return;
    }

    final confirmationController = TextEditingController();
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            final typedConfirmation = confirmationController.text;
            return AlertDialog(
              title: const Text('Limpar cadastros vazios?'),
              content: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$eligibleCount cadastro(s) com pelo menos $minimumAgeDays dias serão removidos permanentemente.',
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'A validação é feita novamente antes da exclusão e bloqueia qualquer conta que possua atividade ou vínculo.',
                    ),
                    const SizedBox(height: 18),
                    TextField(
                      controller: confirmationController,
                      onChanged: (_) => setDialogState(() {}),
                      decoration: const InputDecoration(
                        labelText:
                            'Digite LIMPAR-CADASTROS-VAZIOS para confirmar',
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
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFE5484D),
                    foregroundColor: Colors.white,
                  ),
                  onPressed: typedConfirmation == 'LIMPAR-CADASTROS-VAZIOS'
                      ? () => Navigator.of(dialogContext).pop(true)
                      : null,
                  child: const Text('Excluir cadastros'),
                ),
              ],
            );
          },
        ),
      );

      if (confirmed != true || !context.mounted) return;
      final result = await api.postJson(
        '/api/admin/users/cleanup',
        data: {'confirmation': 'LIMPAR-CADASTROS-VAZIOS'},
      );
      ref.invalidate(adminUsersProvider);
      if (context.mounted) {
        showSuccessToast(
          context,
          _display(result['message'], fallback: 'Limpeza concluída.'),
        );
      }
    } finally {
      confirmationController.dispose();
    }
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

Future<bool?> _confirmAdminAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool danger = false,
}) {
  final wa = WaTheme.of(context);
  return showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: wa.panel,
      title: Text(title, style: TextStyle(color: wa.textPrimary)),
      content: Text(message, style: TextStyle(color: wa.textSecondary)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: danger ? const Color(0xFFE5484D) : wa.accent,
            foregroundColor: Colors.white,
          ),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
}

class _AdminSystemInstanceDialog extends ConsumerStatefulWidget {
  const _AdminSystemInstanceDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_AdminSystemInstanceDialog> createState() =>
      _AdminSystemInstanceDialogState();
}

class _AdminSystemInstanceDialogState
    extends ConsumerState<_AdminSystemInstanceDialog> {
  late final Map<String, dynamic> _instance;
  late final List<Map<String, dynamic>> _servers;
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  int? _serverId;
  var _busy = false;

  bool get _hasInstance => _instance.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _instance = _jsonMap(widget.record.raw['instance']);
    _servers = _jsonList(widget.record.raw['servers']);
    _nameController = TextEditingController(
      text: _display(_instance['name'], fallback: 'BotAdmin Verificações'),
    );
    _phoneController = TextEditingController(
      text: _display(_instance['phone'], fallback: ''),
    );
    final currentServerId =
        _asIntOrNull(_instance['serverId']) ??
        _asIntOrNull(_instance['server_id']);
    _serverId =
        currentServerId ??
        (_servers.isNotEmpty ? _asIntOrNull(_servers.first['id']) : null);
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final phone = _phoneController.text.trim();
    if (phone.isEmpty) {
      showErrorToast(context, 'Informe o WhatsApp da instância admin.');
      return;
    }
    if (!_hasInstance && _serverId == null) {
      showErrorToast(context, 'Cadastre ou selecione um servidor.');
      return;
    }

    setState(() => _busy = true);
    try {
      final payload = <String, Object?>{
        'name': _nameController.text.trim().isEmpty
            ? 'BotAdmin Verificações'
            : _nameController.text.trim(),
        'phone': phone,
      };
      if (!_hasInstance) {
        payload['serverId'] = _serverId;
        await ref
            .read(apiClientProvider)
            .postJson('/api/admin/system-instance', data: payload);
      } else {
        await ref
            .read(apiClientProvider)
            .putJson('/api/admin/system-instance', data: payload);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 560;
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: EdgeInsets.all(compact ? 14 : 24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 620),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: wa.border),
          ),
          child: SingleChildScrollView(
            padding: EdgeInsets.all(compact ? 18 : 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: wa.accentSoft,
                      child: Icon(
                        Icons.admin_panel_settings_outlined,
                        color: wa.accent,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Instância do painel admin',
                            style: TextStyle(
                              color: wa.textPrimary,
                              fontSize: compact ? 20 : 22,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            'Número usado para confirmar cadastros pelo WhatsApp.',
                            style: TextStyle(color: wa.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).pop(false),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: 'Nome da instância',
                    prefixIcon: Icon(Icons.badge_outlined),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                    labelText: 'WhatsApp da instância',
                    hintText: '559295333643',
                    prefixIcon: Icon(Icons.phone_android_outlined),
                  ),
                ),
                if (!_hasInstance) ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<int>(
                    initialValue: _serverId,
                    decoration: const InputDecoration(
                      labelText: 'Servidor',
                      prefixIcon: Icon(Icons.dns_outlined),
                    ),
                    items: _servers
                        .map(
                          (server) => DropdownMenuItem<int>(
                            value: _asIntOrNull(server['id']),
                            child: Text(
                              _display(
                                server['name'],
                                fallback: 'Servidor ${server['id']}',
                              ),
                            ),
                          ),
                        )
                        .where((item) => item.value != null)
                        .toList(),
                    onChanged: _busy
                        ? null
                        : (value) => setState(() => _serverId = value),
                  ),
                ],
                if (_hasInstance) ...[
                  const SizedBox(height: 10),
                  Text(
                    'Para trocar de servidor, crie uma nova instância operacional.',
                    style: TextStyle(color: wa.textSecondary, fontSize: 12.5),
                  ),
                ],
                const SizedBox(height: 20),
                Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).pop(false),
                      child: const Text('Cancelar'),
                    ),
                    FilledButton.icon(
                      onPressed: _busy ? null : _save,
                      icon: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.save_outlined),
                      label: Text(_hasInstance ? 'Salvar' : 'Criar'),
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

class _AdminSystemPairingDialog extends StatelessWidget {
  const _AdminSystemPairingDialog({required this.response});

  final Map<String, dynamic> response;

  String _firstText(Map<String, dynamic> data, List<String> keys) {
    for (final key in keys) {
      final value = data[key]?.toString().trim();
      if (value != null && value.isNotEmpty && value != 'null') {
        return value;
      }
    }
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final data = _jsonMap(response['data']);
    final alreadyConnected = data['alreadyConnected'] == true;
    final linkingCode = _firstText(data, const [
      'linkingCode',
      'LinkingCode',
      'pairingCode',
      'code',
    ]);
    final qrCode = _firstText(data, const ['qrCode', 'qrcode', 'QRCode', 'qr']);
    final message = _display(
      response['message'],
      fallback: alreadyConnected
          ? 'Instância operacional já conectada.'
          : 'Dados de pareamento gerados.',
    );

    Widget payloadBox(String title, String value) {
      return DecoratedBox(
        decoration: BoxDecoration(
          color: wa.contentBg,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: wa.border),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: wa.textSecondary,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              SelectableText(
                value,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return AlertDialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      title: Text(
        'Pareamento da instância admin',
        style: TextStyle(color: wa.textPrimary, fontWeight: FontWeight.w800),
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(message, style: TextStyle(color: wa.textSecondary)),
            if (linkingCode.isNotEmpty) ...[
              const SizedBox(height: 14),
              payloadBox('Código', linkingCode),
            ],
            if (qrCode.isNotEmpty) ...[
              const SizedBox(height: 14),
              payloadBox('QR Code', qrCode),
            ],
            if (!alreadyConnected && linkingCode.isEmpty && qrCode.isEmpty) ...[
              const SizedBox(height: 14),
              Text(
                'Não veio código nem QR. Tente gerar novamente com a instância desconectada.',
                style: TextStyle(color: wa.textSecondary),
              ),
            ],
          ],
        ),
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Fechar'),
        ),
      ],
    );
  }
}

class _WhatsappVerificationSettingsDialog extends ConsumerStatefulWidget {
  const _WhatsappVerificationSettingsDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_WhatsappVerificationSettingsDialog> createState() =>
      _WhatsappVerificationSettingsDialogState();
}

class _WhatsappVerificationSettingsDialogState
    extends ConsumerState<_WhatsappVerificationSettingsDialog> {
  late bool _enabled;
  late String _mode;
  late final TextEditingController _targetController;
  late final TextEditingController _instructionsController;
  late final TextEditingController _supportController;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    final raw = widget.record.raw;
    _enabled = raw['enabled'] != false;
    _mode = _display(raw['mode'], fallback: 'user_sends_code') == 'send_code'
        ? 'send_code'
        : 'user_sends_code';
    _targetController = TextEditingController(
      text: _display(raw['targetWhatsappNumber'], fallback: ''),
    );
    _instructionsController = TextEditingController(
      text: _display(raw['instructions'], fallback: ''),
    );
    _supportController = TextEditingController(
      text: _display(raw['supportText'], fallback: ''),
    );
  }

  @override
  void dispose() {
    _targetController.dispose();
    _instructionsController.dispose();
    _supportController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .putJson(
            '/api/admin/whatsapp-verification',
            data: {
              'enabled': _enabled,
              'mode': _mode,
              'targetWhatsappNumber': _targetController.text,
              'instructions': _instructionsController.text,
              'supportText': _supportController.text,
            },
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 560;
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: EdgeInsets.all(compact ? 14 : 24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: wa.border),
          ),
          child: SingleChildScrollView(
            padding: EdgeInsets.all(compact ? 18 : 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: wa.accentSoft,
                      child: Icon(
                        Icons.verified_user_outlined,
                        color: wa.accent,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Verificação de WhatsApp',
                            style: TextStyle(
                              color: wa.textPrimary,
                              fontSize: compact ? 20 : 22,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            'Controle como o cadastro confirma o número.',
                            style: TextStyle(color: wa.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).pop(false),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  value: _enabled,
                  onChanged: _busy
                      ? null
                      : (value) => setState(() => _enabled = value),
                  title: Text(
                    'Exigir confirmação antes de liberar o painel',
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  subtitle: Text(
                    _enabled
                        ? 'O usuário precisa confirmar o WhatsApp.'
                        : 'O cadastro entra direto, apenas salvando o número informado.',
                    style: TextStyle(color: wa.textSecondary),
                  ),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  initialValue: _mode,
                  decoration: const InputDecoration(
                    labelText: 'Modo de confirmação',
                    prefixIcon: Icon(Icons.rule_outlined),
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'user_sends_code',
                      child: Text('Usuário envia o código para o bot'),
                    ),
                    DropdownMenuItem(
                      value: 'send_code',
                      child: Text('Bot envia código para o usuário'),
                    ),
                  ],
                  onChanged: _busy
                      ? null
                      : (value) =>
                            setState(() => _mode = value ?? 'user_sends_code'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _targetController,
                  keyboardType: TextInputType.phone,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
                  ],
                  decoration: const InputDecoration(
                    labelText: 'Número destino da confirmação',
                    hintText: '+5592995333643',
                    prefixIcon: Icon(Icons.chat_outlined),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Se ficar vazio, o sistema usa a instância operacional/admin conectada.',
                  style: TextStyle(color: wa.textSecondary, fontSize: 12.5),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _instructionsController,
                  minLines: 4,
                  maxLines: 7,
                  decoration: const InputDecoration(
                    labelText: 'Instruções exibidas no modal',
                    alignLabelWithHint: true,
                    prefixIcon: Icon(Icons.notes_outlined),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Variáveis: {{code}}, {{message}}, {{target}}.',
                  style: TextStyle(color: wa.textSecondary, fontSize: 12.5),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _supportController,
                  minLines: 3,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Texto de suporte para falhas',
                    alignLabelWithHint: true,
                    prefixIcon: Icon(Icons.support_agent_outlined),
                  ),
                ),
                const SizedBox(height: 20),
                Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).pop(false),
                      child: const Text('Cancelar'),
                    ),
                    FilledButton.icon(
                      onPressed: _busy ? null : _save,
                      icon: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.save_outlined),
                      label: Text(_busy ? 'Salvando...' : 'Salvar regra'),
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

class _AdminUserEditorDialog extends ConsumerStatefulWidget {
  const _AdminUserEditorDialog({this.record});

  final _AdminRecord? record;

  @override
  ConsumerState<_AdminUserEditorDialog> createState() =>
      _AdminUserEditorDialogState();
}

class _AdminUserEditorDialogState
    extends ConsumerState<_AdminUserEditorDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _emailController;
  late final TextEditingController _passwordController;
  late final TextEditingController _dialCodeController;
  late final TextEditingController _whatsappController;
  String _role = 'user';
  bool _active = true;
  int? _planId;
  var _busy = false;

  bool get _isEditing => widget.record != null;

  @override
  void initState() {
    super.initState();
    final raw = widget.record?.raw ?? const <String, dynamic>{};
    final phone = _display(raw['whatsappNumber']);
    final split = _splitWhatsapp(phone);
    _nameController = TextEditingController(
      text: _isEditing ? _display(raw['name'], fallback: '') : '',
    );
    _emailController = TextEditingController(
      text: _isEditing ? _display(raw['email'], fallback: '') : '',
    );
    _passwordController = TextEditingController();
    _dialCodeController = TextEditingController(text: split.$1);
    _whatsappController = TextEditingController(text: split.$2);
    _role = raw['role'] == 'admin' ? 'admin' : 'user';
    _active = raw['isActive'] != false;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _dialCodeController.dispose();
    _whatsappController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 560;
    final plansAsync = ref.watch(adminPlansProvider);
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 620),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: wa.border),
          ),
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(22),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        backgroundColor: wa.accentSoft,
                        child: Icon(
                          _isEditing
                              ? Icons.edit_outlined
                              : Icons.person_add_alt_1_outlined,
                          color: wa.accent,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _isEditing ? 'Editar usuário' : 'Novo usuário',
                              style: TextStyle(
                                color: wa.textPrimary,
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            Text(
                              _isEditing
                                  ? 'Dados, acesso e WhatsApp cadastrado.'
                                  : 'Cadastro rápido com plano opcional.',
                              style: TextStyle(color: wa.textSecondary),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: _busy
                            ? null
                            : () => Navigator.of(context).pop(false),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  TextFormField(
                    controller: _nameController,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Nome',
                      prefixIcon: Icon(Icons.person_outline),
                    ),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? 'Informe o nome.'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _emailController,
                    textInputAction: TextInputAction.next,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'E-mail',
                      prefixIcon: Icon(Icons.mail_outline),
                    ),
                    validator: (value) {
                      final text = value?.trim() ?? '';
                      if (!text.contains('@') || text.startsWith('@')) {
                        return 'Informe um e-mail válido.';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _passwordController,
                    obscureText: true,
                    textInputAction: TextInputAction.next,
                    decoration: InputDecoration(
                      labelText: _isEditing
                          ? 'Nova senha (opcional)'
                          : 'Senha temporária',
                      prefixIcon: const Icon(Icons.lock_outline),
                    ),
                    validator: (value) {
                      final text = value?.trim() ?? '';
                      if (!_isEditing && text.length < 6) {
                        return 'A senha deve ter pelo menos 6 caracteres.';
                      }
                      if (_isEditing && text.isNotEmpty && text.length < 6) {
                        return 'Use pelo menos 6 caracteres.';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  if (compact) ...[
                    TextFormField(
                      controller: _dialCodeController,
                      textInputAction: TextInputAction.next,
                      keyboardType: TextInputType.phone,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(labelText: 'DDI'),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _whatsappController,
                      textInputAction: TextInputAction.next,
                      keyboardType: TextInputType.phone,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(
                        labelText: 'WhatsApp',
                        prefixIcon: Icon(Icons.chat_outlined),
                      ),
                    ),
                  ] else
                    Row(
                      children: [
                        SizedBox(
                          width: 120,
                          child: TextFormField(
                            controller: _dialCodeController,
                            textInputAction: TextInputAction.next,
                            keyboardType: TextInputType.phone,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                            ],
                            decoration: const InputDecoration(labelText: 'DDI'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextFormField(
                            controller: _whatsappController,
                            textInputAction: TextInputAction.next,
                            keyboardType: TextInputType.phone,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                            ],
                            decoration: const InputDecoration(
                              labelText: 'WhatsApp',
                              prefixIcon: Icon(Icons.chat_outlined),
                            ),
                          ),
                        ),
                      ],
                    ),
                  const SizedBox(height: 12),
                  if (compact) ...[
                    DropdownButtonFormField<String>(
                      initialValue: _role,
                      decoration: const InputDecoration(
                        labelText: 'Função',
                        prefixIcon: Icon(Icons.admin_panel_settings_outlined),
                      ),
                      items: const [
                        DropdownMenuItem(value: 'user', child: Text('Usuário')),
                        DropdownMenuItem(value: 'admin', child: Text('Admin')),
                      ],
                      onChanged: _busy
                          ? null
                          : (value) => setState(() => _role = value ?? 'user'),
                    ),
                    SwitchListTile(
                      value: _active,
                      onChanged: _busy
                          ? null
                          : (value) => setState(() => _active = value),
                      title: const Text('Ativo'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ] else
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            initialValue: _role,
                            decoration: const InputDecoration(
                              labelText: 'Função',
                              prefixIcon: Icon(
                                Icons.admin_panel_settings_outlined,
                              ),
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: 'user',
                                child: Text('Usuário'),
                              ),
                              DropdownMenuItem(
                                value: 'admin',
                                child: Text('Admin'),
                              ),
                            ],
                            onChanged: _busy
                                ? null
                                : (value) =>
                                      setState(() => _role = value ?? 'user'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: SwitchListTile(
                            value: _active,
                            onChanged: _busy
                                ? null
                                : (value) => setState(() => _active = value),
                            title: const Text('Ativo'),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      ],
                    ),
                  if (!_isEditing) ...[
                    const SizedBox(height: 12),
                    plansAsync.when(
                      data: (plans) => DropdownButtonFormField<int?>(
                        initialValue: _planId,
                        decoration: const InputDecoration(
                          labelText: 'Plano inicial',
                          prefixIcon: Icon(Icons.workspace_premium_outlined),
                        ),
                        items: [
                          const DropdownMenuItem<int?>(
                            value: null,
                            child: Text('Sem plano inicial'),
                          ),
                          ...plans.map(
                            (plan) => DropdownMenuItem<int?>(
                              value: int.tryParse(plan.id),
                              child: Text(plan.title),
                            ),
                          ),
                        ],
                        onChanged: _busy
                            ? null
                            : (value) => setState(() => _planId = value),
                      ),
                      error: (_, _) => const SizedBox.shrink(),
                      loading: () => const LinearProgressIndicator(),
                    ),
                  ],
                  const SizedBox(height: 22),
                  Wrap(
                    alignment: WrapAlignment.end,
                    spacing: 10,
                    runSpacing: 8,
                    children: [
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => Navigator.of(context).pop(false),
                        child: const Text('Cancelar'),
                      ),
                      FilledButton.icon(
                        onPressed: _busy ? null : _submit,
                        icon: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.save_outlined),
                        label: Text(_isEditing ? 'Salvar' : 'Criar usuário'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (_formKey.currentState?.validate() != true) return;
    setState(() => _busy = true);
    try {
      final whatsappDigits = _whatsappController.text.replaceAll(
        RegExp(r'[^0-9]'),
        '',
      );
      final data = <String, Object?>{
        'name': _nameController.text.trim(),
        'email': _emailController.text.trim(),
        'role': _role,
        'isActive': _active,
      };
      final password = _passwordController.text.trim();
      if (password.isNotEmpty || !_isEditing) data['password'] = password;
      if (whatsappDigits.isEmpty) {
        if (_isEditing) {
          data['whatsappDialCode'] = null;
          data['whatsappNumber'] = null;
        }
      } else {
        data['whatsappDialCode'] = _normalizeDialCode(_dialCodeController.text);
        data['whatsappNumber'] = whatsappDigits;
      }
      if (!_isEditing && _planId != null) data['planId'] = _planId;

      if (_isEditing) {
        await ref
            .read(apiClientProvider)
            .patchJson('/api/admin/users/${widget.record!.id}', data: data);
      } else {
        await ref
            .read(apiClientProvider)
            .postJson('/api/admin/users', data: data);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _AdminUserBalanceDialog extends ConsumerStatefulWidget {
  const _AdminUserBalanceDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_AdminUserBalanceDialog> createState() =>
      _AdminUserBalanceDialogState();
}

class _AdminUserBalanceDialogState
    extends ConsumerState<_AdminUserBalanceDialog> {
  late final TextEditingController _controller;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    final balance = _asDouble(widget.record.raw['balance']);
    _controller = TextEditingController(
      text: balance == null
          ? ''
          : balance.toStringAsFixed(2).replaceAll('.', ','),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return AlertDialog(
      backgroundColor: wa.panel,
      title: Text('Editar saldo', style: TextStyle(color: wa.textPrimary)),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.record.title,
              style: TextStyle(color: wa.textSecondary),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _controller,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9,.-]')),
              ],
              decoration: const InputDecoration(
                labelText: 'Novo saldo',
                prefixText: 'R\$ ',
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _busy ? null : _submit,
          icon: _busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Icon(Icons.save_outlined),
          label: const Text('Salvar saldo'),
        ),
      ],
    );
  }

  Future<void> _submit() async {
    final value = _asDouble(_controller.text);
    if (value == null || value < 0) {
      showErrorToast(context, 'Informe um saldo válido.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .patchJson(
            '/api/admin/users/${widget.record.id}',
            data: {'balance': value},
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _AdminUserPlanDialog extends ConsumerStatefulWidget {
  const _AdminUserPlanDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_AdminUserPlanDialog> createState() =>
      _AdminUserPlanDialogState();
}

class _AdminUserPlanDialogState extends ConsumerState<_AdminUserPlanDialog> {
  final _slotExpiresControllers = <TextEditingController>[];
  var _profiles = <_AdminRecord>[];
  var _slotAvailable = 0;
  var _loading = true;
  var _busy = false;
  Object? _loadError;

  int get _validProfileCount => _profiles.where((profile) {
    final expiresAt = DateTime.tryParse(
      profile.raw['expiresAt']?.toString() ??
          profile.raw['expires_at']?.toString() ??
          '',
    );
    return expiresAt != null && expiresAt.isAfter(DateTime.now());
  }).length;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    for (final controller in _slotExpiresControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  String _defaultSlotExpiry() {
    return DateFormat(
      'yyyy-MM-dd HH:mm',
      'pt_BR',
    ).format(DateTime.now().add(const Duration(days: 30)));
  }

  void _setSlotControllers(List<String> values) {
    for (final controller in _slotExpiresControllers) {
      controller.dispose();
    }
    _slotExpiresControllers
      ..clear()
      ..addAll(values.map((value) => TextEditingController(text: value)));
  }

  void _addSlot() {
    setState(() {
      _slotExpiresControllers.add(
        TextEditingController(text: _defaultSlotExpiry()),
      );
    });
  }

  void _removeSlot(int index) {
    if (index < 0 || index >= _slotExpiresControllers.length) return;
    setState(() {
      final controller = _slotExpiresControllers.removeAt(index);
      controller.dispose();
    });
  }

  Future<void> _load() async {
    try {
      final json = await ref
          .read(apiClientProvider)
          .getJson('/api/admin/users/${widget.record.id}/plan');
      final slots = _jsonMap(json['profileSlots'] ?? json['profile_slots']);
      final manualTotal = _asInt(slots['manualTotal'] ?? slots['manual_total']);
      final profiles = _jsonList(
        json['profiles'],
      ).map(_adminProfileRecord).toList();
      final manualSlots = _jsonList(
        slots['manualSlots'] ?? slots['manual_slots'],
      );
      var slotValues = manualSlots
          .map(
            (slot) => _formatDateInput(slot['expiresAt'] ?? slot['expires_at']),
          )
          .toList();
      if (slotValues.isEmpty && manualTotal > 0) {
        final fallback = _formatDateInput(
          slots['manualExpiresAt'] ?? slots['manual_expires_at'],
        );
        slotValues = List<String>.filled(manualTotal, fallback);
      }
      if (!mounted) return;
      setState(() {
        _profiles = profiles;
        _slotAvailable = _asInt(slots['available']);
        _setSlotControllers(slotValues);
        _loading = false;
        _loadError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 560,
          maxHeight: MediaQuery.sizeOf(context).height - 48,
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: wa.border),
          ),
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: _loading
                ? const SizedBox(
                    height: 180,
                    child: Center(child: CircularProgressIndicator()),
                  )
                : _loadError != null
                ? _PlanLoadError(error: _loadError!, onRetry: _load)
                : SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            CircleAvatar(
                              backgroundColor: wa.accentSoft,
                              child: Icon(
                                Icons.person_add_alt_1_outlined,
                                color: wa.accent,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Slots de perfil',
                                    style: TextStyle(
                                      color: wa.textPrimary,
                                      fontSize: 22,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  Text(
                                    widget.record.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(color: wa.textSecondary),
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              onPressed: _busy
                                  ? null
                                  : () => Navigator.of(context).pop(false),
                              icon: const Icon(Icons.close),
                            ),
                          ],
                        ),
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            _ProfileSlotStat(
                              label: 'Perfis criados',
                              value: _profiles.length.toString(),
                            ),
                            const SizedBox(width: 8),
                            _ProfileSlotStat(
                              label: 'Perfis válidos',
                              value: _validProfileCount.toString(),
                            ),
                            const SizedBox(width: 8),
                            _ProfileSlotStat(
                              label: 'Slots livres',
                              value: _slotAvailable.toString(),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'Perfis criados',
                          style: TextStyle(
                            color: wa.textPrimary,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (_profiles.isEmpty)
                          DecoratedBox(
                            decoration: BoxDecoration(
                              color: wa.searchBg,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: wa.border),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Text(
                                'Nenhum perfil criado por este usuário.',
                                style: TextStyle(color: wa.textSecondary),
                              ),
                            ),
                          )
                        else
                          ..._profiles.map(
                            (profile) => Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  color: wa.searchBg,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: wa.border),
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.fromLTRB(
                                    12,
                                    10,
                                    8,
                                    10,
                                  ),
                                  child: Row(
                                    children: [
                                      CircleAvatar(
                                        radius: 18,
                                        backgroundColor: wa.accentSoft,
                                        child: Icon(
                                          Icons.account_circle_outlined,
                                          color: wa.accent,
                                          size: 20,
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              profile.title,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                color: wa.textPrimary,
                                                fontWeight: FontWeight.w800,
                                              ),
                                            ),
                                            Text(
                                              '${_display(profile.raw['phone'])} · validade ${_formatDate(profile.raw['expiresAt'])}',
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                color: wa.textSecondary,
                                                fontSize: 12.5,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        profile.badge,
                                        style: TextStyle(
                                          color: profile.badgeColor,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                      IconButton(
                                        tooltip: 'Renovar perfil',
                                        onPressed: _busy
                                            ? null
                                            : () async {
                                                await _openProfileRenewalDialog(
                                                  context,
                                                  ref,
                                                  profile,
                                                );
                                                await _load();
                                              },
                                        icon: const Icon(
                                          Icons.autorenew_rounded,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Slots manuais liberados pelo admin',
                                style: TextStyle(
                                  color: wa.textPrimary,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            TextButton.icon(
                              onPressed: _busy ? null : _addSlot,
                              icon: const Icon(Icons.add_rounded),
                              label: const Text('Adicionar slot'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        if (_slotExpiresControllers.isEmpty)
                          DecoratedBox(
                            decoration: BoxDecoration(
                              color: wa.searchBg,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: wa.border),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Text(
                                'Nenhum slot manual liberado.',
                                style: TextStyle(color: wa.textSecondary),
                              ),
                            ),
                          )
                        else
                          ...List.generate(_slotExpiresControllers.length, (
                            index,
                          ) {
                            final controller = _slotExpiresControllers[index];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 18,
                                    backgroundColor: wa.accentSoft,
                                    child: Text(
                                      '${index + 1}',
                                      style: TextStyle(
                                        color: wa.accent,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: TextField(
                                      controller: controller,
                                      enabled: !_busy,
                                      keyboardType: TextInputType.datetime,
                                      decoration: const InputDecoration(
                                        labelText: 'Validade do slot',
                                        hintText: '2026-08-12 10:00',
                                        helperText:
                                            'Vazio libera este slot por 30 dias.',
                                        prefixIcon: Icon(
                                          Icons.event_available_outlined,
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  IconButton(
                                    tooltip: 'Remover slot',
                                    onPressed: _busy
                                        ? null
                                        : () => _removeSlot(index),
                                    icon: const Icon(Icons.delete_outline),
                                  ),
                                ],
                              ),
                            );
                          }),
                        const SizedBox(height: 8),
                        Text(
                          'Para remover a liberação manual, deixe a lista vazia e salve.',
                          style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                        ),
                        const SizedBox(height: 18),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: wa.accentSoft.withValues(alpha: 0.7),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: wa.border),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(
                                  Icons.info_outline_rounded,
                                  color: wa.accent,
                                  size: 20,
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    'Os slots manuais somam aos perfis pagos. Quando houver slot disponível, o usuário cria o perfil direto sem checkout até a validade definida aqui.',
                                    style: TextStyle(
                                      color: wa.textSecondary,
                                      height: 1.35,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 18),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            TextButton(
                              onPressed: _busy
                                  ? null
                                  : () => Navigator.of(context).pop(false),
                              child: const Text('Cancelar'),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Align(
                                alignment: Alignment.centerRight,
                                child: FilledButton.icon(
                                  onPressed: _busy ? null : _submit,
                                  icon: _busy
                                      ? const SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: Colors.white,
                                          ),
                                        )
                                      : const Icon(Icons.save_outlined),
                                  label: const Text('Salvar slots'),
                                ),
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
    );
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .putJson(
            '/api/admin/users/${widget.record.id}/plan',
            data: {
              'profileSlots': {
                'slots': [
                  for (final controller in _slotExpiresControllers)
                    {'expiresAt': _nullableDatePayload(controller.text)},
                ],
              },
            },
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _ProfileSlotStat extends StatelessWidget {
  const _ProfileSlotStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Expanded(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: wa.searchBg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: wa.border),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
              const SizedBox(height: 4),
              Text(
                value,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlanLoadError extends StatelessWidget {
  const _PlanLoadError({required this.error, required this.onRetry});

  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return SizedBox(
      width: 420,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, color: const Color(0xFFE5484D), size: 44),
          const SizedBox(height: 12),
          Text(
            friendlyErrorMessage(error),
            textAlign: TextAlign.center,
            style: TextStyle(color: wa.textPrimary),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Tentar novamente'),
          ),
        ],
      ),
    );
  }
}

Future<void> _openProfileRenewalDialog(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) async {
  final changed = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminProfileRenewalDialog(record: record),
  );
  if (changed == true) {
    ref.invalidate(adminInstancesProvider);
  }
}

class _AdminProfileRenewalDialog extends ConsumerStatefulWidget {
  const _AdminProfileRenewalDialog({required this.record});

  final _AdminRecord record;

  @override
  ConsumerState<_AdminProfileRenewalDialog> createState() =>
      _AdminProfileRenewalDialogState();
}

class _AdminProfileRenewalDialogState
    extends ConsumerState<_AdminProfileRenewalDialog> {
  late final TextEditingController _expiresAt;
  var _busy = false;

  int get _profileId =>
      _asInt(widget.record.raw['profileId'] ?? widget.record.raw['id']);

  @override
  void initState() {
    super.initState();
    final current = DateTime.tryParse(
      widget.record.raw['expiresAt']?.toString() ??
          widget.record.raw['expires_at']?.toString() ??
          '',
    );
    final initial = current != null && current.isAfter(DateTime.now())
        ? current
        : DateTime.now().add(const Duration(days: 30));
    _expiresAt = TextEditingController(
      text: DateFormat('yyyy-MM-dd HH:mm', 'pt_BR').format(initial.toLocal()),
    );
  }

  @override
  void dispose() {
    _expiresAt.dispose();
    super.dispose();
  }

  Future<void> _submit(Map<String, dynamic> data) async {
    if (_profileId <= 0) {
      showErrorToast(context, 'Perfil inválido.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .putJson('/api/admin/profiles/$_profileId', data: data);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveExactDate() async {
    final value = _nullableDatePayload(_expiresAt.text);
    if (value == null || DateTime.tryParse(value) == null) {
      showErrorToast(context, 'Informe uma validade válida.');
      return;
    }
    await _submit({'expiresAt': value});
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(20),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: wa.panel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: wa.border),
          ),
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: wa.accentSoft,
                      child: Icon(Icons.autorenew_rounded, color: wa.accent),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Renovar perfil',
                            style: TextStyle(
                              color: wa.textPrimary,
                              fontSize: 21,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            widget.record.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: wa.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).pop(false),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Text(
                  'Validade atual: ${_formatDate(widget.record.raw['expiresAt'])}',
                  style: TextStyle(
                    color: wa.textSecondary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final days in const [30, 90, 180, 365])
                      OutlinedButton(
                        onPressed: _busy
                            ? null
                            : () => _submit({'extendDays': days}),
                        child: Text('+$days dias'),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _expiresAt,
                  enabled: !_busy,
                  keyboardType: TextInputType.datetime,
                  decoration: const InputDecoration(
                    labelText: 'Definir validade exata',
                    hintText: '2026-12-31 23:59',
                    prefixIcon: Icon(Icons.event_available_outlined),
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).pop(false),
                      child: const Text('Cancelar'),
                    ),
                    const SizedBox(width: 10),
                    FilledButton.icon(
                      onPressed: _busy ? null : _saveExactDate,
                      icon: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.save_outlined),
                      label: const Text('Salvar validade'),
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

List<_AdminRecordAction> _instanceActions(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) {
  final profileId = _asIntOrNull(
    record.raw['profileId'] ?? record.raw['profile_id'],
  );
  final instanceId = _asIntOrNull(
    record.raw['instanceId'] ?? record.raw['instance_id'],
  );
  final ownerId = _asIntOrNull(record.raw['userId'] ?? record.raw['user_id']);
  final ownerRecord = ownerId == null
      ? null
      : _AdminRecord(
          id: '$ownerId',
          title: _display(
            record.raw['userName'],
            fallback: 'Usuário #$ownerId',
          ),
          subtitle: _display(
            record.raw['userEmail'],
            fallback: _display(record.raw['userWhatsapp']),
          ),
          badge: 'Usuário',
          badgeColor: const Color(0xFF00A884),
          icon: Icons.person_outline,
          raw: {
            'id': ownerId,
            'name': record.raw['userName'],
            'email': record.raw['userEmail'],
            'whatsappNumber': record.raw['userWhatsapp'],
            'isActive': true,
          },
          details: [
            _AdminDetail('ID', '$ownerId'),
            _AdminDetail('E-mail', _display(record.raw['userEmail'])),
            _AdminDetail('WhatsApp', _display(record.raw['userWhatsapp'])),
          ],
        );
  if (profileId == null) return const [];
  Future<void> run(String action) async {
    if (instanceId == null) {
      throw StateError('Este perfil ainda não possui uma sessão conectada.');
    }
    await ref
        .read(apiClientProvider)
        .postJson(
          '/api/admin/bot-instances/$instanceId/actions',
          data: {'action': action},
        );
    ref.invalidate(adminInstancesProvider);
  }

  return [
    _AdminRecordAction(
      label: 'Renovar perfil',
      icon: Icons.autorenew_rounded,
      run: () => _openProfileRenewalDialog(context, ref, record),
    ),
    if (ownerRecord != null)
      _AdminRecordAction(
        label: 'Entrar como usuário',
        icon: Icons.login_outlined,
        run: () => _impersonateUser(context, ref, ownerRecord),
      ),
    if (instanceId != null)
      _AdminRecordAction(
        label: 'Conectar',
        icon: Icons.qr_code_scanner_outlined,
        successMessage: 'Conexão solicitada.',
        run: () => run('connect'),
      ),
    if (instanceId != null)
      _AdminRecordAction(
        label: 'Reiniciar',
        icon: Icons.restart_alt_outlined,
        successMessage: 'Reinício solicitado.',
        run: () => run('restart'),
      ),
    if (instanceId != null)
      _AdminRecordAction(
        label: 'Desconectar',
        icon: Icons.link_off_outlined,
        danger: true,
        successMessage: 'Desconexão solicitada.',
        run: () => run('logout'),
      ),
    if (instanceId != null)
      _AdminRecordAction(
        label: 'Remover somente sessão',
        icon: Icons.cleaning_services_outlined,
        danger: true,
        run: () async {
          final confirmed = await _confirmAdminAction(
            context,
            title: 'Remover a sessão de ${record.title}?',
            message:
                'A sessão e os dados do servidor serão removidos. O perfil e a licença ficam preservados para uma nova conexão.',
            confirmLabel: 'Remover sessão',
            danger: true,
          );
          if (confirmed != true) return;
          final json = await ref
              .read(apiClientProvider)
              .postJson('/api/admin/bot-instances/$instanceId/purge');
          ref.invalidate(adminInstancesProvider);
          if (context.mounted) {
            showSuccessToast(
              context,
              _display(json['message'], fallback: 'Sessão removida.'),
            );
          }
        },
      ),
    _AdminRecordAction(
      label: 'Excluir perfil completo',
      icon: Icons.delete_forever_outlined,
      danger: true,
      run: () async {
        final confirmed = await _confirmAdminAction(
          context,
          title: 'Excluir ${record.title} permanentemente?',
          message: instanceId == null
              ? 'O perfil e sua licença serão removidos definitivamente.'
              : 'O perfil, a instância, conversas, histórico e mídias associadas serão removidos definitivamente.',
          confirmLabel: 'Excluir tudo',
          danger: true,
        );
        if (confirmed != true) return;
        final endpoint = instanceId == null
            ? '/api/admin/profiles/$profileId'
            : '/api/admin/bot-instances/$instanceId';
        final json = await ref.read(apiClientProvider).deleteJson(endpoint);
        ref.invalidate(adminInstancesProvider);
        if (context.mounted) {
          showSuccessToast(
            context,
            _display(json['message'], fallback: 'Perfil excluído.'),
          );
        }
      },
    ),
  ];
}

class _PlanDraft {
  const _PlanDraft(this.data);
  final Map<String, dynamic> data;
}

const _planFeatureLabels = <String, String>{
  'conversas': 'Conversas WhatsApp',
  'grupos_botadmin': 'Grupos BotAdmin',
  'status': 'Status',
  'status_programado': 'Status programado',
  'transmissao': 'Transmissões',
  'bot_interage': 'BotInterage',
  'antilink': 'Antilink',
  'boas_vindas': 'Boas-vindas',
  'download_media': 'Download de mídias',
  'midia_persistente': 'Mídias persistentes',
  'multi_perfil': 'Múltiplos perfis',
  'api': 'API REST',
  'suporte_prioritario': 'Suporte prioritário',
  'revenda': 'Programa de revenda',
};

String _enabledPlanFeatures(Object? value) {
  if (value is! Map) return 'Padrão';
  final names = value.entries
      .where((entry) => entry.value == true)
      .map(
        (entry) =>
            _planFeatureLabels[entry.key.toString()] ?? entry.key.toString(),
      )
      .toList();
  return names.isEmpty ? 'Nenhum' : names.join(', ');
}

class _PlanDialog extends StatefulWidget {
  const _PlanDialog({this.record});

  final _AdminRecord? record;

  @override
  State<_PlanDialog> createState() => _PlanDialogState();
}

class _PlanDialogState extends State<_PlanDialog> {
  late final TextEditingController _name;
  late final TextEditingController _description;
  late final TextEditingController _price;
  late final TextEditingController _addonInstancePrice;
  late final TextEditingController _addonGroupPrice;
  late final TextEditingController _groupLimit;
  late final TextEditingController _instanceLimit;
  late final TextEditingController _storageQuotaGb;
  late final TextEditingController _durationDays;
  late bool _allowFlows;
  late bool _active;
  late final Map<String, bool> _features;

  Map<String, dynamic> get _raw => widget.record?.raw ?? const {};

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: _display(_raw['name'], fallback: ''));
    _description = TextEditingController(
      text: _display(_raw['description'], fallback: ''),
    );
    _price = TextEditingController(
      text: _display(_raw['price'], fallback: '0'),
    );
    _addonInstancePrice = TextEditingController(
      text: _display(_raw['addonInstancePrice'], fallback: '0'),
    );
    _addonGroupPrice = TextEditingController(
      text: _display(_raw['addonGroupPrice'], fallback: '0'),
    );
    _groupLimit = TextEditingController(
      text: _display(_raw['groupLimit'], fallback: '0'),
    );
    _instanceLimit = TextEditingController(
      text: _display(_raw['instanceLimit'], fallback: '1'),
    );
    _storageQuotaGb = TextEditingController(
      text: _display(_raw['storageQuotaGb'], fallback: '0'),
    );
    _durationDays = TextEditingController(
      text: _display(_raw['durationDays'], fallback: '30'),
    );
    _allowFlows = _raw['allowFlows'] != false;
    _active = widget.record == null || _raw['isActive'] == true;
    final rawFeatures = _raw['features'];
    _features = {
      for (final key in _planFeatureLabels.keys)
        key: rawFeatures is Map ? rawFeatures[key] != false : true,
    };
  }

  @override
  void dispose() {
    for (final controller in [
      _name,
      _description,
      _price,
      _addonInstancePrice,
      _addonGroupPrice,
      _groupLimit,
      _instanceLimit,
      _storageQuotaGb,
      _durationDays,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _submit() {
    if (_name.text.trim().isEmpty) {
      showErrorToast(context, 'Informe o nome do plano.');
      return;
    }
    final price = _asDouble(_price.text);
    final duration = int.tryParse(_durationDays.text.trim());
    if (price == null || price < 0 || duration == null || duration <= 0) {
      showErrorToast(context, 'Revise o preço e a duração do plano.');
      return;
    }
    Navigator.of(context).pop(
      _PlanDraft({
        'name': _name.text.trim(),
        'description': _description.text.trim(),
        'price': price,
        'addonInstancePrice': _asDouble(_addonInstancePrice.text) ?? 0,
        'addonGroupPrice': _asDouble(_addonGroupPrice.text) ?? 0,
        'groupLimit': int.tryParse(_groupLimit.text.trim()) ?? 0,
        'instanceLimit': int.tryParse(_instanceLimit.text.trim()) ?? 0,
        'allowFlows': _allowFlows,
        'storageQuotaGb': _asDouble(_storageQuotaGb.text) ?? 0,
        'durationDays': duration,
        'isActive': _active,
        'features': _features,
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    Widget numberField(
      TextEditingController controller,
      String label, {
      String? suffix,
    }) {
      return TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(labelText: label, suffixText: suffix),
      );
    }

    return AlertDialog(
      title: Text(widget.record == null ? 'Novo plano' : 'Editar plano'),
      content: SizedBox(
        width: 680,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Nome do plano'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _description,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(labelText: 'Descrição'),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: numberField(_price, 'Preço', suffix: 'R\$')),
                  const SizedBox(width: 12),
                  Expanded(
                    child: numberField(
                      _addonInstancePrice,
                      'Adicional por perfil',
                      suffix: 'R\$',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: numberField(
                      _addonGroupPrice,
                      'Adicional por grupo',
                      suffix: 'R\$',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: numberField(
                      _durationDays,
                      'Duração',
                      suffix: 'dias',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: numberField(_instanceLimit, 'Limite de perfis'),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: numberField(_groupLimit, 'Limite de grupos')),
                  const SizedBox(width: 12),
                  Expanded(
                    child: numberField(
                      _storageQuotaGb,
                      'Storage',
                      suffix: 'GB',
                    ),
                  ),
                ],
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Liberar funcionalidades e fluxos'),
                value: _allowFlows,
                onChanged: (value) => setState(() => _allowFlows = value),
              ),
              const Align(
                alignment: Alignment.centerLeft,
                child: Padding(
                  padding: EdgeInsets.only(top: 8, bottom: 2),
                  child: Text(
                    'Recursos liberados neste plano',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              ..._planFeatureLabels.entries.map(
                (entry) => SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(entry.value),
                  value: _features[entry.key] == true,
                  onChanged: (value) =>
                      setState(() => _features[entry.key] = value),
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Plano ativo para novas assinaturas'),
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
          icon: const Icon(Icons.save_outlined),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

Future<void> _openPlanDialog(
  BuildContext context,
  WidgetRef ref, [
  _AdminRecord? record,
]) async {
  final draft = await showDialog<_PlanDraft>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _PlanDialog(record: record),
  );
  if (draft == null || !context.mounted) return;
  final api = ref.read(apiClientProvider);
  if (record == null) {
    await api.postJson('/api/admin/plans', data: draft.data);
  } else {
    await api.putJson('/api/admin/plans/${record.id}', data: draft.data);
  }
  ref.invalidate(adminPlansProvider);
  if (context.mounted) {
    showSuccessToast(
      context,
      record == null ? 'Plano criado com sucesso.' : 'Plano atualizado.',
    );
  }
}

List<_AdminRecordAction> _planActions(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) {
  final id = int.tryParse(record.id);
  if (id == null) return const [];
  final active = record.raw['isActive'] == true;
  return [
    _AdminRecordAction(
      label: 'Editar plano',
      icon: Icons.edit_outlined,
      run: () => _openPlanDialog(context, ref, record),
    ),
    _AdminRecordAction(
      label: active ? 'Desativar plano' : 'Ativar plano',
      icon: active ? Icons.visibility_off_outlined : Icons.visibility_outlined,
      danger: active,
      successMessage: active ? 'Plano desativado.' : 'Plano ativado.',
      run: () async {
        await ref
            .read(apiClientProvider)
            .putJson(
              '/api/admin/plans/$id',
              data: {
                'name': record.raw['name'],
                'description': record.raw['description'],
                'price': record.raw['price'],
                'addonInstancePrice': record.raw['addonInstancePrice'],
                'addonGroupPrice': record.raw['addonGroupPrice'],
                'groupLimit': record.raw['groupLimit'],
                'instanceLimit': record.raw['instanceLimit'],
                'allowFlows': record.raw['allowFlows'],
                'storageQuotaGb': record.raw['storageQuotaGb'],
                'durationDays': record.raw['durationDays'],
                'isActive': !active,
                'features': record.raw['features'],
              },
            );
        ref.invalidate(adminPlansProvider);
      },
    ),
    _AdminRecordAction(
      label: 'Excluir plano',
      icon: Icons.delete_outline,
      danger: true,
      run: () async {
        final confirmed = await _confirmAdminAction(
          context,
          title: 'Excluir o plano ${record.title}?',
          message:
              'O plano deixará de existir para novas assinaturas. Assinaturas vinculadas podem impedir a exclusão.',
          confirmLabel: 'Excluir plano',
          danger: true,
        );
        if (confirmed != true) return;
        final json = await ref
            .read(apiClientProvider)
            .deleteJson('/api/admin/plans/$id');
        ref.invalidate(adminPlansProvider);
        if (context.mounted) {
          showSuccessToast(
            context,
            _display(json['message'], fallback: 'Plano excluído.'),
          );
        }
      },
    ),
  ];
}

String _paymentCredentialProvider(_AdminRecord record) => switch (record.id) {
  'polopag' => 'polopag_pix',
  'mercadopago-checkout' => 'mercadopago_checkout',
  'mercadopago-marketplace' => 'mercadopago_checkout',
  _ => 'mercadopago_pix',
};

String _paymentCredentialLabel(String field) => switch (field) {
  'accessToken' => 'Access token',
  'apiKey' => 'API Key',
  'publicKey' => 'Public key',
  'pixKey' => 'Chave PIX',
  'marketplaceClientId' => 'Marketplace Client ID',
  'marketplaceClientSecret' => 'Marketplace Client Secret',
  _ => field,
};

class _AdminCredentialPasswordDialog extends StatefulWidget {
  const _AdminCredentialPasswordDialog({
    required this.api,
    required this.record,
  });

  final BotAdminApiClient api;
  final _AdminRecord record;

  @override
  State<_AdminCredentialPasswordDialog> createState() =>
      _AdminCredentialPasswordDialogState();
}

class _AdminCredentialPasswordDialogState
    extends State<_AdminCredentialPasswordDialog> {
  final _password = TextEditingController();
  final _focusNode = FocusNode();
  bool _submitting = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final password = _password.text;
    if (password.isEmpty || _submitting) {
      setState(() => _error = 'Informe sua senha administrativa.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final response = await widget.api.postJson(
        '/api/admin/payments/credentials/reveal',
        data: {
          'provider': _paymentCredentialProvider(widget.record),
          'password': password,
        },
      );
      if (!mounted) return;
      Navigator.of(context).pop(_jsonMap(response['credentials']));
    } on BotAdminApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _submitting = false;
      });
      _password.clear();
      _focusNode.requestFocus();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Não foi possível confirmar a senha agora.';
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Row(
        children: [
          Icon(Icons.lock_outline_rounded),
          SizedBox(width: 10),
          Expanded(child: Text('Confirmar senha administrativa')),
        ],
      ),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Para visualizar ou copiar as credenciais de ${widget.record.title}, confirme a senha do administrador conectado.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _password,
              focusNode: _focusNode,
              autofocus: true,
              obscureText: _obscurePassword,
              enableSuggestions: false,
              autocorrect: false,
              autofillHints: const [AutofillHints.password],
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _confirm(),
              decoration: InputDecoration(
                labelText: 'Senha do administrador',
                errorText: _error,
                prefixIcon: const Icon(Icons.password_rounded),
                suffixIcon: IconButton(
                  tooltip: _obscurePassword ? 'Mostrar senha' : 'Ocultar senha',
                  onPressed: _submitting
                      ? null
                      : () => setState(
                          () => _obscurePassword = !_obscurePassword,
                        ),
                  icon: Icon(
                    _obscurePassword
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'A senha e as credenciais não ficam salvas neste aparelho.',
              style: TextStyle(fontSize: 12, color: Color(0xFF667781)),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _submitting ? null : _confirm,
          icon: _submitting
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.verified_user_outlined),
          label: Text(
            _submitting ? 'Confirmando...' : 'Confirmar e visualizar',
          ),
        ),
      ],
    );
  }
}

Future<void> _showProtectedPaymentCredentials(
  BuildContext context,
  BotAdminApiClient api,
  _AdminRecord record,
) async {
  final credentials = await showDialog<Map<String, dynamic>>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _AdminCredentialPasswordDialog(api: api, record: record),
  );
  if (credentials == null || !context.mounted) return;
  final entries = credentials.entries
      .where((entry) => entry.value?.toString().trim().isNotEmpty == true)
      .toList(growable: false);

  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.shield_outlined),
          const SizedBox(width: 10),
          Expanded(child: Text('Credenciais · ${record.title}')),
        ],
      ),
      content: SizedBox(
        width: 680,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Visualização temporária. Feche este modal assim que terminar de copiar.',
              ),
              const SizedBox(height: 16),
              if (entries.isEmpty)
                const Text(
                  'Nenhuma credencial foi configurada para este método.',
                )
              else
                ...entries.map((entry) {
                  final value = entry.value.toString();
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: InputDecorator(
                      decoration: InputDecoration(
                        labelText: _paymentCredentialLabel(entry.key),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(child: SelectableText(value)),
                          IconButton(
                            tooltip:
                                'Copiar ${_paymentCredentialLabel(entry.key)}',
                            onPressed: () async {
                              await Clipboard.setData(
                                ClipboardData(text: value),
                              );
                              if (dialogContext.mounted) {
                                showSuccessToast(
                                  dialogContext,
                                  'Credencial copiada.',
                                );
                              }
                            },
                            icon: const Icon(Icons.copy_rounded),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              const Text(
                'Por segurança, este conteúdo não é armazenado no cache local do painel.',
                style: TextStyle(fontSize: 12, color: Color(0xFF667781)),
              ),
            ],
          ),
        ),
      ),
      actions: [
        FilledButton.icon(
          onPressed: () => Navigator.of(dialogContext).pop(),
          icon: const Icon(Icons.lock_outline_rounded),
          label: const Text('Fechar e proteger'),
        ),
      ],
    ),
  );
  credentials.clear();
}

class _PaymentConfigDraft {
  const _PaymentConfigDraft(this.data);
  final Map<String, dynamic> data;
}

class _MarketplaceConfigDialog extends StatefulWidget {
  const _MarketplaceConfigDialog({required this.record, required this.api});

  final _AdminRecord record;
  final BotAdminApiClient api;

  @override
  State<_MarketplaceConfigDialog> createState() =>
      _MarketplaceConfigDialogState();
}

class _MarketplaceConfigDialogState extends State<_MarketplaceConfigDialog> {
  late final TextEditingController _clientId;
  late final TextEditingController _clientSecret;
  bool _clearCredentials = false;
  bool _obscureSecret = true;

  Map<String, dynamic> get _config => widget.record.raw;

  bool get _hasSecret =>
      _jsonMap(_config['credentialFields'])['marketplaceClientSecret'] == true;

  @override
  void initState() {
    super.initState();
    _clientId = TextEditingController(
      text: _display(_config['marketplaceClientId'], fallback: ''),
    );
    _clientSecret = TextEditingController();
  }

  @override
  void dispose() {
    _clientId.dispose();
    _clientSecret.dispose();
    super.dispose();
  }

  void _submit() {
    if (_clearCredentials) {
      Navigator.of(
        context,
      ).pop(const _PaymentConfigDraft({'clearMarketplaceCredentials': true}));
      return;
    }
    if (_clientId.text.trim().isEmpty) {
      showErrorToast(context, 'Informe o Client ID do Mercado Pago.');
      return;
    }
    if (!_hasSecret && _clientSecret.text.trim().isEmpty) {
      showErrorToast(context, 'Informe o Client Secret do Mercado Pago.');
      return;
    }
    Navigator.of(context).pop(
      _PaymentConfigDraft({
        'marketplaceClientId': _clientId.text.trim(),
        if (_clientSecret.text.trim().isNotEmpty)
          'marketplaceClientSecret': _clientSecret.text.trim(),
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final redirectUri = _display(
      _config['redirectUri'],
      fallback: 'https://botadmin.shop/api/payments/mercadopago/oauth/callback',
    );
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      title: const Text('Mercado Pago Marketplace / Split'),
      content: SizedBox(
        width: 680,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Cadastre as credenciais do aplicativo Mercado Pago usado no OAuth de Masters e revendedores. O Client Secret fica protegido no servidor.',
              ),
              const SizedBox(height: 18),
              TextField(
                controller: _clientId,
                enabled: !_clearCredentials,
                decoration: const InputDecoration(
                  labelText: 'Client ID',
                  hintText: 'Ex.: 1234567890123456',
                  prefixIcon: Icon(Icons.badge_outlined),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _clientSecret,
                enabled: !_clearCredentials,
                obscureText: _obscureSecret,
                enableSuggestions: false,
                autocorrect: false,
                decoration: InputDecoration(
                  labelText: _hasSecret
                      ? 'Novo Client Secret (opcional)'
                      : 'Client Secret',
                  helperText: _hasSecret
                      ? 'Já existe um segredo protegido. Deixe vazio para mantê-lo.'
                      : 'Copie o Client Secret das credenciais de produção do aplicativo.',
                  prefixIcon: const Icon(Icons.key_outlined),
                  suffixIcon: IconButton(
                    tooltip: _obscureSecret ? 'Mostrar' : 'Ocultar',
                    onPressed: () =>
                        setState(() => _obscureSecret = !_obscureSecret),
                    icon: Icon(
                      _obscureSecret
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'URL de redirecionamento (Redirect URI)',
                  helperText:
                      'Cadastre exatamente esta URL no aplicativo do Mercado Pago.',
                  prefixIcon: Icon(Icons.link_rounded),
                ),
                child: Row(
                  children: [
                    Expanded(child: SelectableText(redirectUri)),
                    IconButton(
                      tooltip: 'Copiar Redirect URI',
                      onPressed: () async {
                        await Clipboard.setData(
                          ClipboardData(text: redirectUri),
                        );
                        if (context.mounted) {
                          showSuccessToast(context, 'Redirect URI copiada.');
                        }
                      },
                      icon: const Icon(Icons.copy_rounded),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: () => _showProtectedPaymentCredentials(
                  context,
                  widget.api,
                  widget.record,
                ),
                icon: const Icon(Icons.visibility_outlined),
                label: const Text('Confirmar senha e visualizar credenciais'),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _clearCredentials,
                onChanged: (value) =>
                    setState(() => _clearCredentials = value == true),
                title: const Text('Remover credenciais do Marketplace'),
                subtitle: const Text(
                  'Desativa novas conexões OAuth de parceiros até cadastrar novamente.',
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
          icon: Icon(
            _clearCredentials ? Icons.delete_outline : Icons.save_outlined,
          ),
          label: Text(_clearCredentials ? 'Remover credenciais' : 'Salvar'),
        ),
      ],
    );
  }
}

class _PaymentConfigDialog extends StatefulWidget {
  const _PaymentConfigDialog({required this.record, required this.api});

  final _AdminRecord record;
  final BotAdminApiClient api;

  @override
  State<_PaymentConfigDialog> createState() => _PaymentConfigDialogState();
}

class _PaymentConfigDialogState extends State<_PaymentConfigDialog> {
  late bool _active;
  late bool _clearCredential;
  late final TextEditingController _displayName;
  late final TextEditingController _credential;
  late final TextEditingController _publicKey;
  late final TextEditingController _pixKey;
  late final TextEditingController _webhook;
  late final TextEditingController _expiration;
  late final TextEditingController _amounts;
  late final TextEditingController _instructions;
  late final TextEditingController _marketplaceClientId;
  late final TextEditingController _marketplaceClientSecret;
  late final Set<String> _paymentTypes;
  late bool _pixCheckout;

  Map<String, dynamic> get _config => widget.record.raw;
  bool get _isPolo => widget.record.id == 'polopag';
  bool get _isCheckout => widget.record.id == 'mercadopago-checkout';

  bool _hasCredentialField(String field) {
    final fields = _jsonMap(_config['credentialFields']);
    if (fields.containsKey(field)) return fields[field] == true;
    if (field == 'apiKey' || field == 'accessToken') {
      return _config['isConfigured'] == true;
    }
    return false;
  }

  Future<void> _revealCredentials() =>
      _showProtectedPaymentCredentials(context, widget.api, widget.record);

  @override
  void initState() {
    super.initState();
    _active = _config['isActive'] == true;
    _clearCredential = false;
    _displayName = TextEditingController(
      text: _display(_config['displayName'], fallback: ''),
    );
    _credential = TextEditingController();
    _publicKey = TextEditingController();
    _pixKey = TextEditingController();
    _webhook = TextEditingController(
      text: _display(
        _config['webhookUrl'] ?? _config['notificationUrl'],
        fallback: '',
      ),
    );
    _expiration = TextEditingController(
      text: _display(_config['pixExpirationMinutes'], fallback: '30'),
    );
    _amounts = TextEditingController(
      text: _config['amountOptions'] is List
          ? (_config['amountOptions'] as List).join(', ')
          : '',
    );
    _instructions = TextEditingController(
      text: _display(_config['instructions'], fallback: ''),
    );
    _marketplaceClientId = TextEditingController(
      text: _display(_config['marketplaceClientId'], fallback: ''),
    );
    _marketplaceClientSecret = TextEditingController();
    _paymentTypes =
        (_config['allowedPaymentTypes'] is List
                ? _config['allowedPaymentTypes'] as List
                : const <dynamic>[])
            .map((value) => value.toString())
            .toSet();
    _pixCheckout =
        (_config['allowedPaymentMethods'] is List) &&
        (_config['allowedPaymentMethods'] as List).contains('pix');
  }

  @override
  void dispose() {
    for (final controller in [
      _displayName,
      _credential,
      _publicKey,
      _pixKey,
      _webhook,
      _expiration,
      _amounts,
      _instructions,
      _marketplaceClientId,
      _marketplaceClientSecret,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _submit() {
    if (_displayName.text.trim().isEmpty) {
      showErrorToast(context, 'Informe o nome do método de pagamento.');
      return;
    }
    final hasCredential = _config['isConfigured'] == true;
    if (_active && !hasCredential && _credential.text.trim().isEmpty) {
      showErrorToast(context, 'Informe a credencial para ativar este método.');
      return;
    }
    if (_active && _clearCredential) {
      showErrorToast(
        context,
        'Desative o método antes de remover a credencial.',
      );
      return;
    }
    final amounts =
        _amounts.text
            .split(RegExp(r'[,;\n]+'))
            .map(_asDouble)
            .whereType<double>()
            .where((value) => value > 0)
            .toSet()
            .toList()
          ..sort();
    final data = <String, dynamic>{
      'isActive': _active,
      'displayName': _displayName.text.trim(),
      'clearCredential': _clearCredential,
      'amountOptions': amounts,
      if (_credential.text.trim().isNotEmpty)
        (_isPolo ? 'apiKey' : 'accessToken'): _credential.text.trim(),
      if (!_isPolo && _publicKey.text.trim().isNotEmpty)
        'publicKey': _publicKey.text.trim(),
      if (!_isPolo) 'notificationUrl': _webhook.text.trim(),
      if (_isPolo) 'webhookUrl': _webhook.text.trim(),
      if (!_isCheckout) 'pixExpirationMinutes': int.tryParse(_expiration.text),
      if (!_isCheckout) 'instructions': _instructions.text.trim(),
      if (!_isPolo && !_isCheckout && _pixKey.text.trim().isNotEmpty)
        'pixKey': _pixKey.text.trim(),
      if (_isCheckout) 'allowedPaymentTypes': _paymentTypes.toList(),
      if (_isCheckout) 'allowedPaymentMethods': _pixCheckout ? ['pix'] : [],
      if (_isCheckout && _marketplaceClientId.text.trim().isNotEmpty)
        'marketplaceClientId': _marketplaceClientId.text.trim(),
      if (_isCheckout && _marketplaceClientSecret.text.trim().isNotEmpty)
        'marketplaceClientSecret': _marketplaceClientSecret.text.trim(),
    };
    Navigator.of(context).pop(_PaymentConfigDraft(data));
  }

  @override
  Widget build(BuildContext context) {
    final hasCredential = _config['isConfigured'] == true;
    const checkoutTypes = <String, String>{
      'credit_card': 'Crédito',
      'debit_card': 'Débito',
      'ticket': 'Boleto',
      'bank_transfer': 'Transferência',
      'atm': 'ATM',
      'account_money': 'Saldo Mercado Pago',
    };
    return AlertDialog(
      title: Text('Editar ${widget.record.title}'),
      content: SizedBox(
        width: 700,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Método ativo'),
                subtitle: const Text('Disponibiliza esta forma de pagamento.'),
                value: _active,
                onChanged: (value) => setState(() => _active = value),
              ),
              TextField(
                controller: _displayName,
                decoration: const InputDecoration(labelText: 'Nome exibido'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _credential,
                obscureText: true,
                enableSuggestions: false,
                autocorrect: false,
                decoration: InputDecoration(
                  labelText: _isPolo
                      ? 'Nova chave da API'
                      : 'Novo access token',
                  helperText: hasCredential
                      ? 'Protegida. Use o olho para visualizar/copiar ou digite uma nova para substituir.'
                      : 'Nenhuma credencial configurada.',
                  suffixIcon: IconButton(
                    tooltip: 'Confirmar senha e visualizar credenciais',
                    onPressed: _revealCredentials,
                    icon: const Icon(Icons.visibility_outlined),
                  ),
                ),
              ),
              if (_isCheckout) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _marketplaceClientId,
                  decoration: const InputDecoration(
                    labelText: 'Marketplace Client ID',
                    helperText:
                        'Usado para o OAuth dos Masters e revendedores.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _marketplaceClientSecret,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Marketplace Client Secret',
                    helperText:
                        'Fica protegido no servidor. Não é enviado ao parceiro. Redirect URI: /api/payments/mercadopago/oauth/callback',
                  ),
                ),
              ],
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Remover credencial salva'),
                subtitle: const Text('O método precisa permanecer desativado.'),
                value: _clearCredential,
                onChanged: (value) =>
                    setState(() => _clearCredential = value == true),
              ),
              if (!_isPolo) ...[
                TextField(
                  controller: _publicKey,
                  obscureText: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  decoration: InputDecoration(
                    labelText: 'Nova public key',
                    helperText: _hasCredentialField('publicKey')
                        ? 'Public key protegida. Deixe vazio para manter.'
                        : 'Nenhuma public key configurada.',
                    suffixIcon: IconButton(
                      tooltip: 'Confirmar senha e visualizar credenciais',
                      onPressed: _revealCredentials,
                      icon: const Icon(Icons.visibility_outlined),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (!_isCheckout && !_isPolo) ...[
                TextField(
                  controller: _pixKey,
                  obscureText: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  decoration: InputDecoration(
                    labelText: 'Nova chave PIX',
                    helperText: _hasCredentialField('pixKey')
                        ? 'Chave PIX protegida. Deixe vazio para manter.'
                        : 'Nenhuma chave PIX configurada.',
                    suffixIcon: IconButton(
                      tooltip: 'Confirmar senha e visualizar credenciais',
                      onPressed: _revealCredentials,
                      icon: const Icon(Icons.visibility_outlined),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                controller: _webhook,
                decoration: const InputDecoration(
                  labelText: 'Webhook / URL de notificação',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _amounts,
                decoration: const InputDecoration(
                  labelText: 'Valores sugeridos',
                  helperText: 'Separe por vírgula, por exemplo: 10, 25, 50.',
                ),
              ),
              if (!_isCheckout) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _expiration,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Expiração do PIX',
                    suffixText: 'min',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _instructions,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Instruções ao cliente',
                  ),
                ),
              ],
              if (_isCheckout) ...[
                const SizedBox(height: 18),
                const Text(
                  'Formas aceitas no checkout',
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
                ...checkoutTypes.entries.map(
                  (entry) => CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(entry.value),
                    value: _paymentTypes.contains(entry.key),
                    onChanged: (value) => setState(() {
                      if (value == true) {
                        _paymentTypes.add(entry.key);
                      } else {
                        _paymentTypes.remove(entry.key);
                      }
                    }),
                  ),
                ),
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: const Text('PIX'),
                  value: _pixCheckout,
                  onChanged: (value) =>
                      setState(() => _pixCheckout = value == true),
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
          label: const Text('Salvar método'),
        ),
      ],
    );
  }
}

List<_AdminRecordAction> _paymentActions(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) {
  return [
    _AdminRecordAction(
      label: 'Visualizar credenciais',
      icon: Icons.visibility_outlined,
      run: () => _showProtectedPaymentCredentials(
        context,
        ref.read(apiClientProvider),
        record,
      ),
    ),
    _AdminRecordAction(
      label: record.id == 'mercadopago-marketplace'
          ? 'Cadastrar credenciais'
          : 'Editar método',
      icon: Icons.edit_outlined,
      run: () async {
        final draft = await showDialog<_PaymentConfigDraft>(
          context: context,
          barrierDismissible: false,
          builder: (_) => record.id == 'mercadopago-marketplace'
              ? _MarketplaceConfigDialog(
                  record: record,
                  api: ref.read(apiClientProvider),
                )
              : _PaymentConfigDialog(
                  record: record,
                  api: ref.read(apiClientProvider),
                ),
        );
        if (draft == null || !context.mounted) return;
        final endpoint = switch (record.id) {
          'polopag' => '/api/admin/payments/polopag',
          'mercadopago-checkout' => '/api/admin/payments/mercadopago/checkout',
          'mercadopago-marketplace' =>
            '/api/admin/payments/mercadopago/marketplace',
          _ => '/api/admin/payments/mercadopago',
        };
        final json = await ref
            .read(apiClientProvider)
            .putJson(endpoint, data: draft.data);
        ref.invalidate(adminPaymentsProvider);
        if (context.mounted) {
          showSuccessToast(
            context,
            _display(json['message'], fallback: 'Método atualizado.'),
          );
        }
      },
    ),
  ];
}

class _BotInterageGroupDraft {
  const _BotInterageGroupDraft(this.data);
  final Map<String, dynamic> data;
}

class _BotInterageGroupDialog extends StatefulWidget {
  const _BotInterageGroupDialog({required this.record});

  final _AdminRecord record;

  @override
  State<_BotInterageGroupDialog> createState() =>
      _BotInterageGroupDialogState();
}

class _BotInterageGroupDialogState extends State<_BotInterageGroupDialog> {
  late bool _enabled;
  late bool _listenToAudio;
  late bool _mentionOnly;
  late bool _clearProviderKey;
  late String _provider;
  late final TextEditingController _keys;
  late final TextEditingController _prompt;
  late final TextEditingController _model;

  Map<String, dynamic> get _raw => widget.record.raw;

  @override
  void initState() {
    super.initState();
    _enabled = _raw['enabled'] != false;
    _listenToAudio = _raw['listenToAudio'] == true;
    _mentionOnly = _raw['mentionOnly'] != false;
    _clearProviderKey = false;
    _provider =
        const {'groq', 'openai', 'chatgpt_system'}.contains(_raw['provider'])
        ? _raw['provider'].toString()
        : 'groq';
    _keys = TextEditingController();
    _prompt = TextEditingController(
      text: _display(_raw['prompt'], fallback: ''),
    );
    _model = TextEditingController(
      text: _display(_raw['model'], fallback: 'auto'),
    );
  }

  @override
  void dispose() {
    _keys.dispose();
    _prompt.dispose();
    _model.dispose();
    super.dispose();
  }

  void _selectProvider(String provider) {
    setState(() {
      _provider = provider;
      _listenToAudio = provider == 'chatgpt_system' && _listenToAudio;
      if (provider == 'chatgpt_system') {
        _model.text = 'auto';
      } else if (_model.text.trim().isEmpty || _model.text.trim() == 'auto') {
        _model.text = provider == 'openai'
            ? 'gpt-4.1-mini'
            : 'llama-3.1-8b-instant';
      }
    });
  }

  void _submit() {
    final newKeys = _keys.text
        .split(RegExp(r'[,;\n]+'))
        .map((value) => value.replaceAll(RegExp(r'\s+'), ''))
        .where((value) => value.isNotEmpty)
        .toSet()
        .toList();
    final hadKey = _raw['hasKey'] == true;
    if (_enabled &&
        _provider != 'chatgpt_system' &&
        !hadKey &&
        newKeys.isEmpty) {
      showErrorToast(
        context,
        'Informe a credencial para ativar este provedor.',
      );
      return;
    }
    if (_enabled && _provider != 'chatgpt_system' && _clearProviderKey) {
      showErrorToast(
        context,
        'Desative o BotInterage antes de remover a chave.',
      );
      return;
    }
    final commandToggles = <String, dynamic>{
      ..._jsonMap(_raw['commandToggles']),
      'botinterage': _enabled,
      'ouviraudiobotinterage': _provider == 'chatgpt_system' && _listenToAudio,
    };
    final featureFlags = <String, dynamic>{
      ..._jsonMap(_raw['featureFlags']),
      'botInterageMentionOnly': _mentionOnly,
      'iaSomenteMencao': _mentionOnly,
      'iaConversas': !_mentionOnly,
    };
    Navigator.of(context).pop(
      _BotInterageGroupDraft({
        'commandToggles': commandToggles,
        'featureFlags': featureFlags,
        'aiProvider': _provider,
        'aiPrompt': _prompt.text.trim(),
        'aiModel': _provider == 'chatgpt_system'
            ? 'auto'
            : (_model.text.trim().isEmpty
                  ? (_provider == 'openai'
                        ? 'gpt-4.1-mini'
                        : 'llama-3.1-8b-instant')
                  : _model.text.trim()),
        if (_provider == 'groq' && newKeys.isNotEmpty) 'groqKeys': newKeys,
        if (_provider == 'openai' && newKeys.isNotEmpty)
          'openAiApiKey': newKeys.first,
        if (_clearProviderKey && _provider == 'groq') 'groqKeys': <String>[],
        if (_clearProviderKey && _provider == 'openai') 'openAiApiKey': null,
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final masked = _raw['maskedKeys'] is List
        ? (_raw['maskedKeys'] as List).join(', ')
        : '';
    return AlertDialog(
      title: Text('BotInterage · ${widget.record.title}'),
      content: SizedBox(
        width: 680,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('BotInterage ativo neste grupo'),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Responder somente quando chamado'),
                subtitle: const Text(
                  'Desative para responder a todas as mensagens elegíveis.',
                ),
                value: _mentionOnly,
                onChanged: _enabled
                    ? (value) => setState(() => _mentionOnly = value)
                    : null,
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                secondary: const Icon(Icons.hearing_rounded),
                title: const Text('Ouvir áudios'),
                subtitle: const Text('Disponível no ChatGPT Sistema.'),
                value: _provider == 'chatgpt_system' && _listenToAudio,
                onChanged: _provider == 'chatgpt_system'
                    ? (value) => setState(() => _listenToAudio = value)
                    : null,
              ),
              DropdownButtonFormField<String>(
                initialValue: _provider,
                decoration: const InputDecoration(labelText: 'Provedor'),
                items: const [
                  DropdownMenuItem(value: 'groq', child: Text('Groq')),
                  DropdownMenuItem(
                    value: 'openai',
                    child: Text('ChatGPT oficial'),
                  ),
                  DropdownMenuItem(
                    value: 'chatgpt_system',
                    child: Text('ChatGPT Sistema'),
                  ),
                ],
                onChanged: (value) {
                  if (value != null) _selectProvider(value);
                },
              ),
              if (_provider != 'chatgpt_system') ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _keys,
                  obscureText: true,
                  minLines: 1,
                  maxLines: _provider == 'groq' ? 4 : 1,
                  decoration: InputDecoration(
                    labelText: _provider == 'groq'
                        ? 'Novas chaves Groq'
                        : 'Nova chave OpenAI',
                    helperText: masked.isEmpty
                        ? 'Nenhuma chave salva.'
                        : 'Salva: $masked. Deixe vazio para manter.',
                  ),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Remover chave salva'),
                  value: _clearProviderKey,
                  onChanged: (value) =>
                      setState(() => _clearProviderKey = value == true),
                ),
              ],
              if (_provider != 'chatgpt_system') ...[
                TextField(
                  controller: _model,
                  decoration: const InputDecoration(labelText: 'Modelo'),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                controller: _prompt,
                minLines: 4,
                maxLines: 10,
                decoration: const InputDecoration(
                  labelText: 'Prompt de comportamento',
                  alignLabelWithHint: true,
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
          icon: const Icon(Icons.save_outlined),
          label: const Text('Salvar grupo'),
        ),
      ],
    );
  }
}

List<_AdminRecordAction> _botInterageActions(
  BuildContext context,
  WidgetRef ref,
  _AdminRecord record,
) {
  final groupId = _asIntOrNull(record.raw['groupId']);
  if (groupId == null) return const [];
  return [
    _AdminRecordAction(
      label: 'Editar integração',
      icon: Icons.edit_outlined,
      run: () async {
        final draft = await showDialog<_BotInterageGroupDraft>(
          context: context,
          barrierDismissible: false,
          builder: (_) => _BotInterageGroupDialog(record: record),
        );
        if (draft == null || !context.mounted) return;
        final json = await ref
            .read(apiClientProvider)
            .patchJson('/api/admin/groups/$groupId', data: draft.data);
        ref.invalidate(adminBotInterageProvider);
        if (context.mounted) {
          showSuccessToast(
            context,
            _display(json['message'], fallback: 'BotInterage atualizado.'),
          );
        }
      },
    ),
  ];
}

class _BotInterageUsersDialog extends ConsumerStatefulWidget {
  const _BotInterageUsersDialog();

  @override
  ConsumerState<_BotInterageUsersDialog> createState() =>
      _BotInterageUsersDialogState();
}

class _BotInterageUsersDialogState
    extends ConsumerState<_BotInterageUsersDialog> {
  List<Map<String, dynamic>> _allowed = const [];
  List<_AdminRecord> _users = const [];
  int? _selectedUserId;
  var _loading = true;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        ref.read(apiClientProvider).getJson('/api/admin/botinterage/users'),
        ref.read(adminUsersProvider.future),
      ]);
      if (!mounted) return;
      setState(() {
        _allowed = _jsonList((results[0] as Map<String, dynamic>)['users']);
        _users = results[1] as List<_AdminRecord>;
        _loading = false;
      });
    } catch (error) {
      if (mounted) {
        setState(() => _loading = false);
        showErrorToast(context, error);
      }
    }
  }

  Future<void> _add() async {
    final userId = _selectedUserId;
    if (userId == null || _busy) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .postJson('/api/admin/botinterage/users', data: {'userId': userId});
      _selectedUserId = null;
      await _load();
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(int userId) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .deleteJson('/api/admin/botinterage/users', data: {'userId': userId});
      await _load();
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final allowedIds = _allowed
        .map((item) => _asInt(item['id'] ?? item['userId']))
        .toSet();
    final available = _users
        .where((user) => !allowedIds.contains(int.tryParse(user.id)))
        .toList();
    return AlertDialog(
      title: const Text('Usuários liberados no BotInterage'),
      content: SizedBox(
        width: 650,
        height: 480,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<int>(
                          initialValue: _selectedUserId,
                          decoration: const InputDecoration(
                            labelText: 'Liberar usuário',
                          ),
                          items: available
                              .map(
                                (user) => DropdownMenuItem(
                                  value: int.tryParse(user.id),
                                  child: Text(
                                    '${user.title} · ${user.subtitle}',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: _busy
                              ? null
                              : (value) =>
                                    setState(() => _selectedUserId = value),
                        ),
                      ),
                      const SizedBox(width: 10),
                      FilledButton.icon(
                        onPressed: _busy || _selectedUserId == null
                            ? null
                            : _add,
                        icon: const Icon(Icons.add_rounded),
                        label: const Text('Liberar'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: _allowed.isEmpty
                        ? const Center(child: Text('Nenhum usuário liberado.'))
                        : ListView.separated(
                            itemCount: _allowed.length,
                            separatorBuilder: (_, _) =>
                                const Divider(height: 1),
                            itemBuilder: (context, index) {
                              final user = _allowed[index];
                              final userId = _asInt(
                                user['id'] ?? user['userId'],
                              );
                              return ListTile(
                                leading: const CircleAvatar(
                                  child: Icon(Icons.person_outline),
                                ),
                                title: Text(_display(user['name'])),
                                subtitle: Text(_display(user['email'])),
                                trailing: IconButton(
                                  tooltip: 'Remover acesso',
                                  onPressed: _busy
                                      ? null
                                      : () => _remove(userId),
                                  icon: const Icon(Icons.delete_outline),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Fechar'),
        ),
      ],
    );
  }
}

Future<void> _openBotInterageUsersDialog(
  BuildContext context,
  WidgetRef ref,
) async {
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const _BotInterageUsersDialog(),
  );
  ref.invalidate(adminBotInterageProvider);
}

class _AdminPanelHeader extends StatelessWidget {
  const _AdminPanelHeader({
    required this.title,
    required this.subtitle,
    this.actions = const [],
  });

  final String title;
  final String subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 620;
        final heading = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              maxLines: compact ? 1 : 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: compact ? 21 : 26,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              maxLines: compact ? 2 : 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: wa.textSecondary, fontSize: 13.5),
            ),
          ],
        );
        final actionRow = Wrap(
          spacing: 8,
          runSpacing: 8,
          alignment: WrapAlignment.end,
          children: actions,
        );
        return Container(
          padding: EdgeInsets.fromLTRB(
            compact ? 14 : 22,
            compact ? 14 : 18,
            compact ? 14 : 14,
            compact ? 12 : 14,
          ),
          decoration: BoxDecoration(
            color: wa.panel,
            border: Border(bottom: BorderSide(color: wa.divider)),
          ),
          child: compact
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    heading,
                    if (actions.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      actionRow,
                    ],
                  ],
                )
              : Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(child: heading),
                    ...actions,
                  ],
                ),
        );
      },
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name, required this.url, required this.size});

  final String name;
  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final resolved = _resolveUrl(url);
    if (resolved != null) {
      return SizedBox.square(
        dimension: size,
        child: ClipOval(
          child: BotAdminCachedImage(
            imageUrl: resolved,
            width: size,
            height: size,
            fit: BoxFit.cover,
            memCacheWidth: (size * MediaQuery.devicePixelRatioOf(context))
                .round(),
            memCacheHeight: (size * MediaQuery.devicePixelRatioOf(context))
                .round(),
            placeholder: (_, _) => _InitialAvatar(name: name, size: size),
            errorWidget: (_, _, _) => _InitialAvatar(name: name, size: size),
          ),
        ),
      );
    }
    return _InitialAvatar(name: name, size: size, color: wa.avatarFallback);
  }
}

class _InitialAvatar extends StatelessWidget {
  const _InitialAvatar({required this.name, required this.size, this.color});

  final String name;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color ?? wa.avatarFallback,
        shape: BoxShape.circle,
      ),
      child: Text(
        _initials(name),
        style: TextStyle(color: wa.textSecondary, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _EmptyListMessage extends StatelessWidget {
  const _EmptyListMessage({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: wa.icon, size: 42),
          const SizedBox(height: 12),
          Text(text, style: TextStyle(color: wa.textSecondary)),
        ],
      ),
    );
  }
}

class _AdminListFooter extends StatelessWidget {
  const _AdminListFooter({required this.count, required this.singular});

  final int count;
  final String singular;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final label = count == 1 ? singular : '${singular}s';
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
      child: Row(
        children: [
          Expanded(child: Divider(color: wa.divider)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              '$count $label · fim da lista',
              style: TextStyle(color: wa.textMuted, fontSize: 12),
            ),
          ),
          Expanded(child: Divider(color: wa.divider)),
        ],
      ),
    );
  }
}

class _AdminEmptyConversation extends StatelessWidget {
  const _AdminEmptyConversation();

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.contentBg,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.support_agent_outlined, size: 76, color: wa.icon),
            const SizedBox(height: 20),
            Text(
              'Selecione um atendimento',
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 28,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Responda usuários e gerencie o modo bot/humano pelo painel admin Flutter.',
              style: TextStyle(color: wa.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 10),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(color: wa.textSecondary),
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: onRetry,
              child: const Text('Tentar de novo'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AdminBotInterageConfigDraft {
  const _AdminBotInterageConfigDraft({
    required this.enabled,
    required this.baseUrl,
    required this.token,
    required this.model,
  });

  final bool enabled;
  final String baseUrl;
  final String token;
  final String model;
}

class _AdminBotInterageConfigDialog extends StatefulWidget {
  const _AdminBotInterageConfigDialog({required this.config});

  final Map<String, dynamic> config;

  @override
  State<_AdminBotInterageConfigDialog> createState() =>
      _AdminBotInterageConfigDialogState();
}

class _AdminBotInterageConfigDialogState
    extends State<_AdminBotInterageConfigDialog> {
  late bool _enabled;
  late final TextEditingController _baseUrl;
  late final TextEditingController _token;
  late final TextEditingController _model;

  @override
  void initState() {
    super.initState();
    _enabled = widget.config['enabled'] == true;
    _baseUrl = TextEditingController(
      text: _display(
        widget.config['baseUrl'],
        fallback: 'https://chatgpt-api.botadmin.shop',
      ),
    );
    _token = TextEditingController();
    _model = TextEditingController(
      text: _display(widget.config['model'], fallback: 'auto'),
    );
  }

  @override
  void dispose() {
    _baseUrl.dispose();
    _token.dispose();
    _model.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hasToken = widget.config['hasToken'] == true;
    return AlertDialog(
      title: const Text('ChatGPT Sistema'),
      content: SizedBox(
        width: 580,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Disponibilizar para os usuários'),
                subtitle: const Text(
                  'Usa a API gerenciada sem exigir chave por grupo.',
                ),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _baseUrl,
                decoration: const InputDecoration(labelText: 'URL base da API'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _token,
                obscureText: true,
                enableSuggestions: false,
                autocorrect: false,
                decoration: InputDecoration(
                  labelText: hasToken
                      ? 'Novo token (opcional)'
                      : 'Token da API',
                  helperText: hasToken
                      ? 'Já existe um token salvo. Deixe vazio para manter.'
                      : 'Informe o token do cliente BotAdmin.',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _model,
                decoration: const InputDecoration(labelText: 'Modelo padrão'),
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
          onPressed: () {
            if (_enabled && _baseUrl.text.trim().isEmpty) {
              showErrorToast(context, 'Informe a URL base da API.');
              return;
            }
            if (_enabled && !hasToken && _token.text.trim().isEmpty) {
              showErrorToast(context, 'Informe o token da API.');
              return;
            }
            Navigator.of(context).pop(
              _AdminBotInterageConfigDraft(
                enabled: _enabled,
                baseUrl: _baseUrl.text.trim(),
                token: _token.text.trim(),
                model: _model.text.trim().isEmpty ? 'auto' : _model.text.trim(),
              ),
            );
          },
          icon: const Icon(Icons.save_outlined),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

Future<void> _openAdminBotInterageConfigDialog(
  BuildContext context,
  WidgetRef ref,
) async {
  try {
    final response = await ref
        .read(apiClientProvider)
        .getJson('/api/admin/botinterage');
    if (!context.mounted) return;
    final draft = await showDialog<_AdminBotInterageConfigDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) =>
          _AdminBotInterageConfigDialog(config: _jsonMap(response['config'])),
    );
    if (draft == null || !context.mounted) return;
    await ref
        .read(apiClientProvider)
        .putJson(
          '/api/admin/botinterage',
          data: {
            'enabled': draft.enabled,
            'baseUrl': draft.baseUrl,
            if (draft.token.isNotEmpty) 'token': draft.token,
            'model': draft.model,
          },
        );
    ref.invalidate(adminBotInterageProvider);
    if (context.mounted) {
      showSuccessToast(context, 'ChatGPT Sistema atualizado com sucesso.');
    }
  } catch (error) {
    if (context.mounted) showErrorToast(context, error);
  }
}

List<Map<String, dynamic>> _jsonList(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((item) => item.cast<String, dynamic>())
      .toList();
}

Map<String, dynamic> _jsonMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return const {};
}

int _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

int? _asIntOrNull(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  final text = value.toString().trim();
  if (text.isEmpty || text.toLowerCase() == 'null') return null;
  return int.tryParse(text);
}

double? _asDouble(Object? value) {
  if (value is num) return value.toDouble();
  final text = value?.toString().trim();
  if (text == null || text.isEmpty) return null;
  final normalized = text.contains(',') && text.contains('.')
      ? text.replaceAll('.', '').replaceAll(',', '.')
      : text.replaceAll(',', '.');
  return double.tryParse(normalized);
}

String _display(Object? value, {String fallback = 'Não informado'}) {
  final text = value?.toString().trim();
  if (text == null || text.isEmpty || text == 'null') return fallback;
  return text;
}

String _money(Object? value) {
  final number = value is num
      ? value.toDouble()
      : double.tryParse(value?.toString().replaceAll(',', '.') ?? '');
  if (number == null) return 'R\$ 0,00';
  return NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$').format(number);
}

String _formatDate(Object? value) {
  final date = DateTime.tryParse(value?.toString() ?? '');
  if (date == null) return 'Não informado';
  return DateFormat('dd/MM/yyyy HH:mm', 'pt_BR').format(date.toLocal());
}

String _formatDateInput(Object? value) {
  final date = DateTime.tryParse(value?.toString() ?? '');
  if (date == null) return '';
  return DateFormat('yyyy-MM-dd HH:mm', 'pt_BR').format(date.toLocal());
}

String? _nullableDatePayload(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  final direct = DateTime.tryParse(trimmed);
  if (direct != null) return direct.toIso8601String();
  final parsed = DateFormat('yyyy-MM-dd HH:mm', 'pt_BR').tryParse(trimmed);
  return parsed?.toIso8601String() ?? trimmed;
}

String _formatThreadTime(String? value) {
  final date = DateTime.tryParse(value ?? '');
  if (date == null) return '';
  final now = DateTime.now();
  if (date.year == now.year && date.month == now.month && date.day == now.day) {
    return DateFormat('HH:mm', 'pt_BR').format(date);
  }
  return DateFormat('dd/MM', 'pt_BR').format(date);
}

String _formatMessageTime(String value) {
  final date = DateTime.tryParse(value);
  if (date == null) return '';
  return DateFormat('HH:mm', 'pt_BR').format(date);
}

String _initials(String value) {
  final parts = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((e) => e.isNotEmpty)
      .toList();
  if (parts.isEmpty) return 'A';
  final first = parts.first.substring(0, 1);
  final second = parts.length > 1 ? parts.last.substring(0, 1) : '';
  return '$first$second'.toUpperCase();
}

(String, String) _splitWhatsapp(String value) {
  final digits = value.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.isEmpty) return ('+55', '');
  if (digits.startsWith('55') && digits.length > 10) {
    return ('+55', digits.substring(2));
  }
  return ('+55', digits);
}

String _normalizeDialCode(String value) {
  final digits = value.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.isEmpty) return '+55';
  return '+$digits';
}

String? _resolveUrl(String? input) {
  final value = input?.trim();
  if (value == null || value.isEmpty) return null;
  final uri = Uri.tryParse(value);
  if (uri != null && uri.hasScheme) return value;
  final normalized = value.replaceFirst(RegExp(r'^/+'), '');
  final apiBase = Uri.tryParse(AppConfig.apiBaseUrl);
  if (apiBase == null || !apiBase.hasScheme) return null;
  return apiBase.resolve('/$normalized').toString();
}

IconData _mediaIcon(String type) {
  return switch (type) {
    'image' => Icons.image_outlined,
    'video' => Icons.play_circle_outline,
    'audio' => Icons.graphic_eq,
    'sticker' => Icons.emoji_emotions_outlined,
    _ => Icons.description_outlined,
  };
}
