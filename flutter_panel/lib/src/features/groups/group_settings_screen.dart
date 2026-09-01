import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/app_config.dart';
import '../../core/wa_theme.dart';
import '../../core/top_toast.dart';
import '../../models/bot_group.dart';
import '../../models/bot_group_settings.dart';
import '../dashboard/dashboard_controller.dart';
import 'group_settings_controller.dart';

class GroupSettingsScreen extends ConsumerStatefulWidget {
  const GroupSettingsScreen({super.key, required this.group, this.leading});

  final BotGroup? group;
  final Widget? leading;

  @override
  ConsumerState<GroupSettingsScreen> createState() =>
      _GroupSettingsScreenState();
}

class _GroupSettingsScreenState extends ConsumerState<GroupSettingsScreen> {
  final _allowedLinks = TextEditingController();
  final _bannedWords = TextEditingController();
  final _blacklist = TextEditingController();
  final _welcomeCaption = TextEditingController();
  final _welcomeMediaUrl = TextEditingController();
  final _farewellCaption = TextEditingController();
  final _farewellMediaUrl = TextEditingController();
  final _commandPrefixes = TextEditingController();
  final _maxInfractions = TextEditingController(text: '5');
  final _antipalavrasLimit = TextEditingController(text: '5');
  final _scrollController = ScrollController();
  String? _seedKey;
  String? _savingKey;
  int? _botOverrideGroupId;
  bool? _botEnabledOverride;

  @override
  void dispose() {
    _allowedLinks.dispose();
    _bannedWords.dispose();
    _blacklist.dispose();
    _welcomeCaption.dispose();
    _welcomeMediaUrl.dispose();
    _farewellCaption.dispose();
    _farewellMediaUrl.dispose();
    _commandPrefixes.dispose();
    _maxInfractions.dispose();
    _antipalavrasLimit.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final group = widget.group;
    if (group == null) {
      return _NoGroupSelected();
    }

    final settings = ref.watch(groupSettingsProvider(group.id));
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.contentBg,
      child: Column(
        children: [
          _GroupHeader(
            group: group,
            leading: widget.leading,
            onOpenActivations: () {
              final bundle = ref
                  .read(groupSettingsProvider(group.id))
                  .asData
                  ?.value;
              if (bundle == null) {
                _showConfigNotice('Aguarde as configuracoes carregarem.');
                return;
              }
              _openActivationsModal(group, bundle.settings);
            },
          ),
          Expanded(
            child: settings.when(
              data: (bundle) {
                _seed(group, bundle.settings);
                return RefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(groupSettingsProvider(group.id));
                    await ref.read(groupSettingsProvider(group.id).future);
                  },
                  child: SingleChildScrollView(
                    controller: _scrollController,
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _BotControlPanel(
                          group: group,
                          botEnabled: _botEnabledOverride ?? group.botEnabled,
                          settings: bundle.settings,
                          savingKey: _savingKey,
                          onBotChanged: (value) =>
                              _saveBotStatus(group.id, value),
                          onWelcomeChanged: (value) =>
                              _saveActivation(group.id, 'bemvindo', value),
                          onFarewellChanged: (value) =>
                              _saveActivation(group.id, 'despedida', value),
                          onConfigureWelcome: () =>
                              _openWelcomeModal(group, bundle.settings),
                          onConfigureFarewell: () =>
                              _openFarewellModal(group, bundle.settings),
                          onConfigurePrefixes: () =>
                              _openCommandPrefixesModal(group, bundle.settings),
                          onConfigureMenus: () => _openMenuCarouselModal(
                            group,
                            bundle.settings,
                            bundle.menuPreview,
                          ),
                          onConfigureAutoResponses: () =>
                              _openAutoResponsesModal(
                                group.id,
                                bundle.settings,
                              ),
                          onConfigureAds: () =>
                              _openScheduledAdsCanvas(group, bundle.settings),
                          onOpenActivations: () =>
                              _openActivationsModal(group, bundle.settings),
                        ),
                        const SizedBox(height: 12),
                        _BotActionTile(
                          icon: Icons.lock_person_rounded,
                          title: 'Privacidade dos membros',
                          subtitle:
                              bundle
                                      .settings
                                      .featureFlags['restrictMemberPrivateChat'] ==
                                  true
                              ? 'Somente administradores podem iniciar PV com membros.'
                              : 'Membros podem ser chamados no privado (padrão).',
                          onTap: () =>
                              _openMemberPrivacyModal(group, bundle.settings),
                        ),
                      ],
                    ),
                  ),
                );
              },
              error: (error, _) => _LoadError(
                message: error.toString(),
                onRetry: () => ref.invalidate(groupSettingsProvider(group.id)),
              ),
              loading: () => Center(child: CircularProgressIndicator()),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openMemberPrivacyModal(
    BotGroup group,
    BotGroupSettings settings,
  ) async {
    var restricted = settings.featureFlags['restrictMemberPrivateChat'] == true;
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Privacidade dos membros'),
          content: SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: const Text('Bloquear PV de membros'),
            subtitle: const Text(
              'Quando ativado, somente administradores podem iniciar uma conversa privada a partir deste grupo.',
            ),
            value: restricted,
            onChanged: (value) => setDialogState(() => restricted = value),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(restricted),
              child: const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
    if (result == null) return;
    await _save(
      group.id,
      'member-private-privacy',
      {
        'featureFlags': {
          ...settings.featureFlags,
          'restrictMemberPrivateChat': result,
        },
      },
      successMessage: result
          ? 'PV de membros bloqueado para não administradores.'
          : 'PV de membros liberado.',
    );
  }

  void _seed(BotGroup group, BotGroupSettings settings) {
    final nextKey = '${group.id}:${settings.updatedAt}';
    if (_seedKey == nextKey) return;
    _seedKey = nextKey;
    if (_botOverrideGroupId != group.id) {
      _botOverrideGroupId = group.id;
      _botEnabledOverride = null;
    }
    _allowedLinks.text = settings.allowedLinks.join('\n');
    _bannedWords.text = settings.bannedWords.join('\n');
    _blacklist.text = settings.blacklist.join('\n');
    _welcomeCaption.text = settings.welcomeConfig.caption;
    _welcomeMediaUrl.text =
        settings.welcomeConfig.mediaUrl ??
        settings.welcomeConfig.mediaPath ??
        '';
    _farewellCaption.text = settings.farewellConfig.caption;
    _farewellMediaUrl.text =
        settings.farewellConfig.mediaUrl ??
        settings.farewellConfig.mediaPath ??
        '';
    _commandPrefixes.text = settings.commandPrefixes.join('\n');
    _maxInfractions.text = settings.maxInfractions.toString();
    _antipalavrasLimit.text = settings.antipalavrasMaxInfractions.toString();
  }

  Future<void> _saveActivation(int groupId, String key, bool value) async {
    final payload = <String, Object?>{
      'commandToggles': {key: value},
    };
    _applyActivationSideEffects(payload, key, value);
    if (key == 'schedule') {
      final current = ref.read(groupSettingsProvider(groupId)).asData?.value;
      final config = current?.settings.scheduleConfig;
      payload['scheduleConfig'] = {
        'closeEnabled': value,
        'openEnabled': value,
        'closeTimes': config?.closeTimes.isNotEmpty == true
            ? config!.closeTimes
            : const ['00:00'],
        'openTimes': config?.openTimes.isNotEmpty == true
            ? config!.openTimes
            : const ['07:00'],
        'closeMessage':
            config?.closeMessage ??
            'Grupo fechado automaticamente conforme programacao.',
        'openMessage':
            config?.openMessage ??
            'Grupo aberto automaticamente conforme programacao.',
        'timezone': config?.timezone ?? 'America/Sao_Paulo',
      };
    }
    if (key == 'horapg') {
      final current = ref.read(groupSettingsProvider(groupId)).asData?.value;
      final config = current?.settings.horapgConfig;
      payload['horapgConfig'] = {
        'enabled': value,
        'times': config?.times.isNotEmpty == true
            ? config!.times
            : const ['08:00'],
        'imageUrl': config?.imageUrl,
        'imagePath': config?.imagePath,
        'mentionAll': config?.mentionAll ?? false,
        'timezone': config?.timezone ?? 'America/Sao_Paulo',
      };
    }
    await _save(
      groupId,
      key,
      payload,
      successMessage: _activationToggleMessage(key, value),
    );
  }

  void _putFeatureFlag(Map<String, Object?> payload, String key, bool value) {
    final current = payload['featureFlags'];
    final flags = current is Map<String, Object?>
        ? Map<String, Object?>.from(current)
        : current is Map
        ? Map<String, Object?>.from(current.cast<String, Object?>())
        : <String, Object?>{};
    flags[key] = value;
    payload['featureFlags'] = flags;
  }

  void _applyActivationSideEffects(
    Map<String, Object?> payload,
    String key,
    bool value,
  ) {
    switch (key) {
      case 'bemvindo':
        payload['welcomeEnabled'] = value;
        return;
      case 'despedida':
        payload['farewellEnabled'] = value;
        return;
      case 'antilink':
        payload['antilink'] = value;
        _putFeatureFlag(payload, 'bloqueiolinks', value);
        return;
      case 'antilinkgp':
        payload['antilinkGroupInvite'] = value;
        return;
      case 'banextremo':
        payload['banExtremo'] = value;
        return;
      case 'soadm':
        _putFeatureFlag(payload, 'soadm', value);
        return;
      case 'antipalavras':
        _putFeatureFlag(payload, 'antipalavras', value);
        return;
      case 'bangringos':
        _putFeatureFlag(payload, 'bangringos', value);
        return;
      case 'antinsfwimagem':
        _putFeatureFlag(payload, 'antinsfwimagem', value);
        return;
    }
  }

  Future<void> _saveModerationActionConfig(
    int groupId,
    String key,
    _ModerationActionDraft draft,
  ) {
    final payload = <String, Object?>{
      'commandToggles': {key: draft.enabled},
      'moderationActions': {key: draft.action.toJson()},
    };
    _applyActivationSideEffects(payload, key, draft.enabled);
    if (draft.allowedLinks != null) {
      payload['allowedLinks'] = _lineList(draft.allowedLinks!);
      _allowedLinks.text = draft.allowedLinks!;
    }
    if (draft.bannedWords != null) {
      payload['bannedWords'] = _lineList(draft.bannedWords!);
      _bannedWords.text = draft.bannedWords!;
    }
    if (draft.blacklist != null) {
      payload['blacklist'] = _lineList(draft.blacklist!);
      _blacklist.text = draft.blacklist!;
    }
    if (draft.maxInfractions != null) {
      payload['maxInfractions'] =
          int.tryParse(draft.maxInfractions!.trim()) ?? 5;
      _maxInfractions.text = draft.maxInfractions!;
    }
    if (draft.antipalavrasLimit != null) {
      payload['antipalavrasMaxInfractions'] =
          int.tryParse(draft.antipalavrasLimit!.trim()) ?? 5;
      _antipalavrasLimit.text = draft.antipalavrasLimit!;
    }
    return _save(
      groupId,
      'moderation-action-$key',
      payload,
      successMessage: 'Ações de moderação atualizadas.',
    );
  }

  Future<void> _saveWelcomeConfig(
    int groupId,
    BotGroupSettings settings,
    _MessageConfigDraft draft,
  ) {
    return _save(groupId, 'welcome-config', {
      'welcomeConfig': {
        'enabled': draft.enabled,
        'caption': draft.caption,
        ..._mediaPayload(draft),
        'useParticipantProfilePhoto': draft.useParticipantProfilePhoto,
        'asSticker': draft.asSticker,
        'replyButtons': draft.replyButtons?.toJson(),
      },
      'commandToggles': {'bemvindo': draft.enabled},
    }, successMessage: 'Boas-vindas salvas com sucesso.');
  }

  Future<void> _saveFarewellConfig(
    int groupId,
    BotGroupSettings settings,
    _MessageConfigDraft draft,
  ) {
    return _save(
      groupId,
      'farewell-config',
      {
        'farewellConfig': {
          'enabled': draft.enabled,
          'caption': draft.caption,
          ..._mediaPayload(draft),
          'useParticipantProfilePhoto': draft.useParticipantProfilePhoto,
          'asSticker': draft.asSticker,
        },
        'commandToggles': {'despedida': draft.enabled},
      },
      successMessage: 'Mensagem de saída salva com sucesso.',
    );
  }

  /// Monta mediaUrl/mediaPath para o patch de settings.
  Map<String, Object?> _mediaPayload(_MessageConfigDraft draft) {
    if (draft.clearMedia) {
      return {'mediaUrl': null, 'mediaPath': null};
    }
    final url = _nullableText(draft.mediaUrl);
    final path = _nullableText(draft.mediaPath ?? '');
    if (url != null) {
      // URL externa tem prioridade e limpa path local.
      return {'mediaUrl': url, 'mediaPath': null};
    }
    if (path != null) {
      return {'mediaUrl': null, 'mediaPath': path};
    }
    // Sem mídia: limpa ambos para não reaproveitar lixo.
    return {'mediaUrl': null, 'mediaPath': null};
  }

  Future<void> _saveProtectionConfig(int groupId) {
    return _save(
      groupId,
      'protection-config',
      {
        'allowedLinks': _lineList(_allowedLinks.text),
        'bannedWords': _lineList(_bannedWords.text),
        'blacklist': _lineList(_blacklist.text),
        'maxInfractions': int.tryParse(_maxInfractions.text.trim()) ?? 5,
        'antipalavrasMaxInfractions':
            int.tryParse(_antipalavrasLimit.text.trim()) ?? 5,
      },
      successMessage: 'Proteções do grupo atualizadas.',
    );
  }

  Future<void> _saveScheduleConfig(int groupId, _ScheduleConfigDraft draft) {
    return _save(
      groupId,
      'schedule-config',
      {
        'scheduleConfig': {
          'closeEnabled': draft.closeEnabled,
          'openEnabled': draft.openEnabled,
          'closeTimes': _lineList(draft.closeTimes),
          'openTimes': _lineList(draft.openTimes),
          'closeMessage': _nullableText(draft.closeMessage),
          'openMessage': _nullableText(draft.openMessage),
          'timezone': _nullableText(draft.timezone) ?? 'America/Sao_Paulo',
        },
        'commandToggles': {'schedule': draft.closeEnabled || draft.openEnabled},
      },
      successMessage: 'Abertura e fechamento automaticos atualizados.',
    );
  }

  Future<void> _saveHorapgConfig(int groupId, _HorapgConfigDraft draft) {
    return _save(groupId, 'horapg-config', {
      'horapgConfig': {
        'enabled': draft.enabled,
        'times': _lineList(draft.times),
        'imageUrl': _nullableText(draft.imageUrl),
        'imagePath': _nullableText(draft.imagePath),
        'mentionAll': draft.mentionAll,
        'timezone': _nullableText(draft.timezone) ?? 'America/Sao_Paulo',
      },
      'commandToggles': {'horapg': draft.enabled},
    }, successMessage: 'HoraPG atualizado.');
  }

  Future<void> _saveAutoResponsesConfig(
    int groupId,
    List<GroupAutoResponseConfig> items,
  ) {
    return _save(groupId, 'autoresposta-config', {
      'autoResponses': items.map((entry) => entry.toJson()).toList(),
      'commandToggles': {'autoresposta': items.isNotEmpty},
    }, successMessage: 'Auto respostas atualizadas.');
  }

  Future<void> _saveAutodownloaderConfig(
    int groupId,
    _AutodownloaderConfigDraft draft,
  ) {
    return _save(groupId, 'autodownloader-config', {
      'commandToggles': {'autodownloader': draft.enabled},
      'featureFlags': {'downloaderOnlyMode': draft.downloaderOnlyMode},
    }, successMessage: 'Auto download atualizado.');
  }

  Future<void> _save(
    int groupId,
    String key,
    Map<String, Object?> payload, {
    String? successMessage,
  }) async {
    if (_savingKey != null) return;
    setState(() => _savingKey = key);
    try {
      await ref.read(apiClientProvider).updateGroupSettings(groupId, payload);
      ref.invalidate(groupSettingsProvider(groupId));
      if (mounted) {
        showSuccessToast(context, successMessage ?? _settingsSaveMessage(key));
      }
    } catch (error) {
      if (mounted) {
        showErrorToast(context, error);
      }
    } finally {
      if (mounted) setState(() => _savingKey = null);
    }
  }

  String _settingsSaveMessage(String key) {
    return switch (key) {
      'welcome-config' => 'Boas-vindas salvas com sucesso.',
      'farewell-config' => 'Mensagem de saída salva com sucesso.',
      'schedule-config' => 'Abertura e fechamento automaticos atualizados.',
      'horapg-config' => 'HoraPG atualizado.',
      'autoresposta-config' => 'Auto respostas atualizadas.',
      'autodownloader-config' => 'Auto download atualizado.',
      'protection-config' => 'Proteções do grupo atualizadas.',
      'command-prefixes' => 'Prefixos do robô atualizados.',
      'bemvindo' => 'Boas-vindas atualizadas.',
      'despedida' => 'Saída atualizada.',
      _ => 'Configuração salva com sucesso.',
    };
  }

  String _activationToggleMessage(String key, bool enabled) {
    final label = switch (key) {
      'bemvindo' => 'Boas-vindas',
      'despedida' => 'Saída',
      'antilink' => 'Anti-link',
      'antilinkgp' => 'Anti-link de grupo',
      'banextremo' => 'Ban extremo',
      'soadm' => 'Só admins',
      'antipalavras' => 'Anti-palavras',
      'bangringos' => 'Ban gringos',
      'antinsfwimagem' => 'Anti-NSFW',
      'moderacaocomia' => 'Moderação com IA',
      'schedule' => 'Abrir/fechar automático',
      'horapg' => 'HoraPG',
      _ => 'Ativação',
    };
    return enabled ? '$label ativada.' : '$label desativada.';
  }

  Future<void> _saveBotStatus(int groupId, bool value) async {
    if (_savingKey != null) return;
    setState(() {
      _savingKey = 'bot-status';
      _botOverrideGroupId = groupId;
      _botEnabledOverride = value;
    });
    try {
      final group = widget.group;
      if (group?.isInternalGroup == true && group?.internalGroupId != null) {
        await ref
            .read(apiClientProvider)
            .updateInternalGroup(group!.internalGroupId!, botEnabled: value);
      } else {
        await ref
            .read(apiClientProvider)
            .updateGroupStatus(groupId, active: value);
      }
      ref.invalidate(dashboardSnapshotProvider);
      if (mounted) {
        showSuccessToast(context, botAdminStatusMessage(value));
      }
    } catch (error) {
      if (mounted) {
        setState(() => _botEnabledOverride = !value);
        showErrorToast(context, error);
      }
    } finally {
      if (mounted) setState(() => _savingKey = null);
    }
  }

  Future<void> _configureActivation(_ActivationDefinition item) async {
    final group = widget.group;
    if (group == null) return;
    final currentSettings = ref.read(groupSettingsProvider(group.id)).asData;
    final settings = currentSettings?.value.settings;
    if (settings == null) {
      _showConfigNotice('Aguarde as configuracoes do grupo carregarem.');
      return;
    }
    final key = item.keyName;
    if (_hasModerationActions(key)) {
      final draft = await showDialog<_ModerationActionDraft>(
        context: context,
        barrierDismissible: false,
        builder: (context) => _ModerationActionDialog(
          item: item,
          enabled: _activationEnabled(settings, key),
          action: settings.moderationActionFor(key),
          allowedLinks: _allowedLinks.text,
          bannedWords: _bannedWords.text,
          blacklist: _blacklist.text,
          maxInfractions: _maxInfractions.text,
          antipalavrasLimit: _antipalavrasLimit.text,
        ),
      );
      if (draft == null) return;
      await _saveModerationActionConfig(group.id, key, draft);
      return;
    }
    switch (key) {
      case 'autoresposta':
        _openAutoResponsesModal(group.id, settings);
        return;
      case 'bemvindo':
        _openWelcomeModal(group, settings);
        return;
      case 'despedida':
        _openFarewellModal(group, settings);
        return;
      case 'schedule':
        _openScheduleModal(group.id, settings);
        return;
      case 'horapg':
        _openHorapgModal(group.id, settings);
        return;
      case 'autodownloader':
        final draft = await showDialog<_AutodownloaderConfigDraft>(
          context: context,
          barrierDismissible: false,
          builder: (context) => _AutodownloaderConfigDialog(
            enabled: _activationEnabled(settings, key),
            downloaderOnlyMode:
                settings.featureFlags['downloaderOnlyMode'] == true,
          ),
        );
        if (draft == null) return;
        await _saveAutodownloaderConfig(group.id, draft);
        return;
      case 'botinterage':
        final draft = await showDialog<_BotInterageConfigDraft>(
          context: context,
          barrierDismissible: false,
          builder: (context) => _BotInterageConfigDialog(
            enabled: _activationEnabled(settings, key),
            listenToAudio: settings.isEnabled('ouviraudiobotinterage'),
            provider: settings.aiProvider,
            groqKeys: settings.groqKeys,
            openAiApiKey: settings.openAiApiKey,
            prompt: settings.aiPrompt,
            model: settings.aiModel,
            mentionOnly:
                settings.featureFlags.containsKey('botInterageMentionOnly')
                ? settings.featureFlags['botInterageMentionOnly'] == true
                : settings.featureFlags['iaSomenteMencao'] == true ||
                      settings.featureFlags['iaConversas'] == false,
          ),
        );
        if (draft == null) return;
        await _save(
          group.id,
          'botinterage-config',
          {
            'commandToggles': {
              ...settings.commandToggles,
              'botinterage': draft.enabled,
              'ouviraudiobotinterage': draft.listenToAudio,
            },
            'aiProvider': draft.provider,
            'groqKeys': draft.groqKeys,
            'openAiApiKey': draft.openAiApiKey,
            'aiPrompt': draft.prompt,
            'aiModel': draft.model,
            'featureFlags': {
              ...settings.featureFlags,
              'botInterageMentionOnly': draft.mentionOnly,
              // Mantém grupos legados coerentes e evita que clientes antigos
              // reativem o modo de menção ao salvar outra configuração.
              'iaSomenteMencao': draft.mentionOnly,
              'iaConversas': !draft.mentionOnly,
            },
          },
          successMessage: 'BotInterage configurado com sucesso.',
        );
        return;
      case 'moderacaocomia':
        _openProtectionModal(group.id);
        return;
      default:
        final enabled = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (context) => _ActivationConfigDialog(
            item: item,
            enabled: settings.isEnabled(key),
          ),
        );
        if (enabled == null) return;
        await _saveActivation(group.id, key, enabled);
    }
  }

  void _showConfigNotice(String message) {
    showTopToast(
      context,
      message: message,
      icon: Icons.info_outline_rounded,
      color: const Color(0xFF54656F),
    );
  }

  Future<void> _openWelcomeModal(
    BotGroup group,
    BotGroupSettings settings,
  ) async {
    final draft = await showDialog<_MessageConfigDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _MessageConfigDialog(
        title: 'Configurar boas-vindas',
        kind: _MessageMediaKind.welcome,
        group: group,
        config: settings.welcomeConfig,
        defaultCaption: _welcomeCaption.text,
        allowButtons: true,
      ),
    );
    if (draft == null) return;
    _welcomeCaption.text = draft.caption;
    _welcomeMediaUrl.text = draft.displayMediaRef;
    await _saveWelcomeConfig(group.id, settings, draft);
  }

  Future<void> _openCommandPrefixesModal(
    BotGroup group,
    BotGroupSettings settings,
  ) async {
    final draft = await showDialog<_CommandPrefixDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _CommandPrefixDialog(
        prefixes: settings.commandPrefixes,
        allowWithoutPrefix: settings.allowCommandsWithoutPrefix,
      ),
    );
    if (draft == null) return;
    _commandPrefixes.text = draft.prefixes.join('\n');
    await _save(group.id, 'command-prefixes', {
      'commandPrefixes': draft.prefixes,
      'allowCommandsWithoutPrefix': draft.allowWithoutPrefix,
    });
  }

  Future<void> _openFarewellModal(
    BotGroup group,
    BotGroupSettings settings,
  ) async {
    final draft = await showDialog<_MessageConfigDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _MessageConfigDialog(
        title: 'Configurar saida',
        kind: _MessageMediaKind.farewell,
        group: group,
        config: settings.farewellConfig,
        defaultCaption: _farewellCaption.text,
        allowButtons: false,
      ),
    );
    if (draft == null) return;
    _farewellCaption.text = draft.caption;
    _farewellMediaUrl.text = draft.displayMediaRef;
    await _saveFarewellConfig(group.id, settings, draft);
  }

  Future<void> _openProtectionModal(int groupId) async {
    final draft = await showDialog<_ProtectionConfigDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _ProtectionConfigDialog(
        allowedLinks: _allowedLinks.text,
        bannedWords: _bannedWords.text,
        blacklist: _blacklist.text,
        maxInfractions: _maxInfractions.text,
        antipalavrasLimit: _antipalavrasLimit.text,
      ),
    );
    if (draft == null) return;
    _allowedLinks.text = draft.allowedLinks;
    _bannedWords.text = draft.bannedWords;
    _blacklist.text = draft.blacklist;
    _maxInfractions.text = draft.maxInfractions;
    _antipalavrasLimit.text = draft.antipalavrasLimit;
    await _saveProtectionConfig(groupId);
  }

  Future<void> _openScheduleModal(
    int groupId,
    BotGroupSettings settings,
  ) async {
    final draft = await showDialog<_ScheduleConfigDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) =>
          _ScheduleConfigDialog(config: settings.scheduleConfig),
    );
    if (draft == null) return;
    await _saveScheduleConfig(groupId, draft);
  }

  Future<void> _openHorapgModal(int groupId, BotGroupSettings settings) async {
    final draft = await showDialog<_HorapgConfigDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _HorapgConfigDialog(config: settings.horapgConfig),
    );
    if (draft == null) return;
    await _saveHorapgConfig(groupId, draft);
  }

  Future<void> _openAutoResponsesModal(
    int groupId,
    BotGroupSettings settings,
  ) async {
    final draft = await showDialog<List<GroupAutoResponseConfig>>(
      context: context,
      barrierDismissible: false,
      builder: (context) =>
          _AutoResponsesConfigDialog(items: settings.autoResponses),
    );
    if (draft == null) return;
    await _saveAutoResponsesConfig(groupId, draft);
  }

  Future<void> _openActivationsModal(
    BotGroup group,
    BotGroupSettings settings,
  ) {
    return showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (context) => _AllActivationsDialog(
        settings: settings,
        onConfigure: _configureActivation,
        onChanged: (key, value) => _saveActivation(group.id, key, value),
      ),
    );
  }

  Future<void> _openMenuCarouselModal(
    BotGroup group,
    BotGroupSettings settings,
    GroupMenuCarouselConfig menuPreview,
  ) async {
    final updated = await showDialog<GroupMenuCarouselConfig>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _MenuCarouselEditorDialog(
        groupId: group.id,
        initial: settings.menuCarousel,
        preview: menuPreview,
      ),
    );
    if (updated == null) return;
    await _save(group.id, 'menu-carousel', {
      'menuCarousel': updated.toJson(),
    }, successMessage: 'Menus do robô atualizados.');
  }

  Future<void> _openScheduledAdsCanvas(
    BotGroup group,
    BotGroupSettings settings,
  ) async {
    await showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) =>
          _ScheduledAdsCanvas(group: group, initialAds: settings.ads),
    );
    ref.invalidate(groupSettingsProvider(group.id));
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({
    required this.group,
    required this.onOpenActivations,
    this.leading,
  });

  final BotGroup group;
  final Widget? leading;
  final VoidCallback onOpenActivations;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: ListTile(
        leading:
            leading ??
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              child: const Icon(Icons.groups_rounded),
            ),
        title: Text(
          group.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w900),
        ),
        subtitle: Text(
          group.remoteJid,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: FilledButton.tonalIcon(
          onPressed: onOpenActivations,
          icon: const Icon(Icons.settings_rounded),
          label: const Text('Ativacoes'),
        ),
      ),
    );
  }
}

class _BotControlPanel extends StatelessWidget {
  const _BotControlPanel({
    required this.group,
    required this.botEnabled,
    required this.settings,
    required this.savingKey,
    required this.onBotChanged,
    required this.onWelcomeChanged,
    required this.onFarewellChanged,
    required this.onConfigureWelcome,
    required this.onConfigureFarewell,
    required this.onConfigurePrefixes,
    required this.onConfigureMenus,
    required this.onConfigureAutoResponses,
    required this.onConfigureAds,
    required this.onOpenActivations,
  });

  final BotGroup group;
  final bool botEnabled;
  final BotGroupSettings settings;
  final String? savingKey;
  final ValueChanged<bool> onBotChanged;
  final ValueChanged<bool> onWelcomeChanged;
  final ValueChanged<bool> onFarewellChanged;
  final VoidCallback onConfigureWelcome;
  final VoidCallback onConfigureFarewell;
  final VoidCallback onConfigurePrefixes;
  final VoidCallback onConfigureMenus;
  final VoidCallback onConfigureAutoResponses;
  final VoidCallback onConfigureAds;
  final VoidCallback onOpenActivations;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      title: 'Bot do grupo',
      subtitle: 'Controles principais deste grupo.',
      child: Column(
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final stacked = constraints.maxWidth < 720;
              final primaryChildren = [
                _BotControlTile(
                  icon: Icons.smart_toy_rounded,
                  title: 'Robô no grupo',
                  subtitle: botEnabled
                      ? 'Bot operando neste grupo.'
                      : 'Bot pausado neste grupo.',
                  active: botEnabled,
                  saving: savingKey == 'bot-status',
                  onChanged: onBotChanged,
                ),
                _BotActionTile(
                  icon: Icons.tag_rounded,
                  title: 'Prefixos',
                  subtitle: _formatPrefixSummary(settings),
                  onTap: onConfigurePrefixes,
                ),
                _BotActionTile(
                  icon: Icons.tune_rounded,
                  title: 'Ativações',
                  subtitle: 'Abrir painel completo de recursos.',
                  onTap: onOpenActivations,
                ),
                _BotActionTile(
                  icon: Icons.view_carousel_rounded,
                  title: 'Menus do robô',
                  subtitle: 'Editar cards, textos e imagens.',
                  onTap: onConfigureMenus,
                ),
              ];
              final messageChildren = [
                _BotControlTile(
                  icon: Icons.waving_hand_rounded,
                  title: 'Boas-vindas',
                  subtitle: 'Mensagem, mídia, foto do perfil e botões.',
                  active: settings.welcomeConfig.enabled,
                  saving: savingKey == 'bemvindo',
                  onChanged: onWelcomeChanged,
                  onConfigure: onConfigureWelcome,
                ),
                _BotControlTile(
                  icon: Icons.logout_rounded,
                  title: 'Saída',
                  subtitle: 'Mensagem enviada quando alguém sai.',
                  active: settings.farewellConfig.enabled,
                  saving: savingKey == 'despedida',
                  onChanged: onFarewellChanged,
                  onConfigure: onConfigureFarewell,
                ),
                _BotActionTile(
                  icon: Icons.schedule_send_rounded,
                  title: 'Mensagens programadas',
                  subtitle: settings.ads.isEmpty
                      ? 'Criar o primeiro ADS deste grupo.'
                      : '${settings.ads.length} mensagem(ns) configurada(s).',
                  onTap: onConfigureAds,
                ),
                _BotActionTile(
                  icon: Icons.quickreply_rounded,
                  title: 'Respostas automáticas',
                  subtitle: settings.autoResponses.isEmpty
                      ? 'Nenhuma resposta configurada.'
                      : '${settings.autoResponses.length} resposta(s) configurada(s).',
                  onTap: onConfigureAutoResponses,
                ),
              ];
              if (stacked) {
                return Column(
                  children: [
                    for (
                      var index = 0;
                      index < primaryChildren.length;
                      index++
                    ) ...[
                      if (index > 0) SizedBox(height: 10),
                      primaryChildren[index],
                    ],
                    SizedBox(height: 10),
                    messageChildren[0],
                    SizedBox(height: 10),
                    messageChildren[1],
                    SizedBox(height: 10),
                    messageChildren[2],
                    SizedBox(height: 10),
                    messageChildren[3],
                  ],
                );
              }
              return Column(
                children: [
                  Row(
                    children: [
                      Expanded(child: primaryChildren[0]),
                      SizedBox(width: 10),
                      Expanded(child: primaryChildren[1]),
                      SizedBox(width: 10),
                      Expanded(child: primaryChildren[2]),
                      SizedBox(width: 10),
                      Expanded(child: primaryChildren[3]),
                    ],
                  ),
                  SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(child: messageChildren[0]),
                      SizedBox(width: 10),
                      Expanded(child: messageChildren[1]),
                    ],
                  ),
                  SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(child: messageChildren[2]),
                      SizedBox(width: 10),
                      Expanded(child: messageChildren[3]),
                    ],
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  String _formatPrefixSummary(BotGroupSettings settings) {
    final prefixes = settings.commandPrefixes.isEmpty
        ? '/'
        : settings.commandPrefixes.take(4).join(' ');
    final noPrefix = settings.allowCommandsWithoutPrefix
        ? 'sem prefixo ligado'
        : 'sem prefixo desligado';
    return '$prefixes · $noPrefix';
  }
}

class _BotControlTile extends StatelessWidget {
  const _BotControlTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.active,
    required this.saving,
    required this.onChanged,
    this.onConfigure,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool active;
  final bool saving;
  final ValueChanged<bool> onChanged;
  final VoidCallback? onConfigure;

  @override
  Widget build(BuildContext context) {
    final colors = _activationStateColors(context, active);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(10, 9, 8, 9),
        child: Row(
          children: [
            Icon(icon, size: 20, color: colors.foreground),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    active ? 'Ligado' : 'Desligado',
                    style: TextStyle(
                      color: colors.foreground,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontSize: 11.5,
                      color: colors.muted,
                    ),
                  ),
                ],
              ),
            ),
            if (onConfigure != null)
              IconButton(
                onPressed: onConfigure,
                icon: const Icon(Icons.settings_rounded),
                tooltip: 'Configurar $title',
                iconSize: 18,
                constraints: const BoxConstraints.tightFor(
                  width: 30,
                  height: 30,
                ),
                padding: EdgeInsets.zero,
                visualDensity: VisualDensity.compact,
                color: colors.foreground,
              ),
            saving
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : SizedBox(
                    width: 42,
                    child: Transform.scale(
                      scale: 0.74,
                      child: Switch(value: active, onChanged: onChanged),
                    ),
                  ),
          ],
        ),
      ),
    );
  }
}

class _BotActionTile extends StatelessWidget {
  const _BotActionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerHighest,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
          child: Row(
            children: [
              Icon(icon, color: scheme.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Configurar',
                      style: TextStyle(
                        color: scheme.primary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

class _CommandPrefixDraft {
  const _CommandPrefixDraft({
    required this.prefixes,
    required this.allowWithoutPrefix,
  });

  final List<String> prefixes;
  final bool allowWithoutPrefix;
}

class _CommandPrefixDialog extends StatefulWidget {
  const _CommandPrefixDialog({
    required this.prefixes,
    required this.allowWithoutPrefix,
  });

  final List<String> prefixes;
  final bool allowWithoutPrefix;

  @override
  State<_CommandPrefixDialog> createState() => _CommandPrefixDialogState();
}

class _CommandPrefixDialogState extends State<_CommandPrefixDialog> {
  late final TextEditingController _prefixes;
  late bool _allowWithoutPrefix;

  @override
  void initState() {
    super.initState();
    _prefixes = TextEditingController(
      text: widget.prefixes.isEmpty ? '/\n!\n#' : widget.prefixes.join('\n'),
    );
    _allowWithoutPrefix = widget.allowWithoutPrefix;
  }

  @override
  void dispose() {
    _prefixes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final previewPrefix = _normalizedPrefixes(_prefixes.text).isEmpty
        ? '/'
        : _normalizedPrefixes(_prefixes.text).first;
    return AlertDialog(
      title: Row(
        children: [
          Icon(Icons.tag_rounded, color: scheme.primary),
          const SizedBox(width: 10),
          const Expanded(child: Text('Configurar prefixos')),
        ],
      ),
      content: SizedBox(
        width: 560,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _prefixes,
              minLines: 3,
              maxLines: 6,
              decoration: const InputDecoration(
                labelText: 'Prefixos',
                helperText: 'Um por linha. Exemplo: /, !, #',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 14),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Comandos sem prefixo'),
              subtitle: const Text(
                'Permite usar menu, play, musica e video sem / ou !.',
              ),
              value: _allowWithoutPrefix,
              onChanged: (value) => setState(() => _allowWithoutPrefix = value),
            ),
            const SizedBox(height: 8),
            DecoratedBox(
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  _allowWithoutPrefix
                      ? 'Aceita: ${previewPrefix}menu, menu, musica nome e video nome'
                      : 'Aceita: ${previewPrefix}menu e ${previewPrefix}play nome',
                  style: TextStyle(
                    color: scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
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
          onPressed: () {
            final prefixes = _normalizedPrefixes(_prefixes.text);
            Navigator.of(context).pop(
              _CommandPrefixDraft(
                prefixes: prefixes.isEmpty ? const ['/', '!', '#'] : prefixes,
                allowWithoutPrefix: _allowWithoutPrefix,
              ),
            );
          },
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _ActivationSection extends StatelessWidget {
  const _ActivationSection({
    required this.title,
    required this.items,
    required this.settings,
    required this.savingKey,
    required this.onConfigure,
    required this.onChanged,
    this.isEnabled,
  });

  final String title;
  final List<_ActivationDefinition> items;
  final BotGroupSettings settings;
  final String? savingKey;
  final void Function(_ActivationDefinition item) onConfigure;
  final void Function(String key, bool value) onChanged;
  final bool Function(String key)? isEnabled;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      title: title,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final columns = constraints.maxWidth >= 1280
              ? 5
              : constraints.maxWidth >= 980
              ? 4
              : constraints.maxWidth >= 760
              ? 3
              : constraints.maxWidth >= 560
              ? 2
              : 1;
          final mobileList = columns == 1;
          final compact = constraints.maxWidth < 560;
          return GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: items.length,
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: columns,
              mainAxisExtent: mobileList
                  ? 96
                  : compact
                  ? 78
                  : 88,
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
            ),
            itemBuilder: (context, index) {
              final item = items[index];
              final active =
                  isEnabled?.call(item.keyName) ??
                  settings.isEnabled(item.keyName);
              final saving = savingKey == item.keyName;
              return _ActivationCard(
                item: item,
                active: active,
                saving: saving,
                onConfigure: () => onConfigure(item),
                onChanged: (value) => onChanged(item.keyName, value),
              );
            },
          );
        },
      ),
    );
  }
}

class _ActivationDefinition {
  const _ActivationDefinition({
    required this.keyName,
    required this.label,
    required this.description,
    required this.icon,
  });

  final String keyName;
  final String label;
  final String description;
  final IconData icon;
}

class _ActivationCategory {
  const _ActivationCategory({
    required this.id,
    required this.title,
    required this.items,
  });

  final String id;
  final String title;
  final List<_ActivationDefinition> items;
}

class _ActivationStateColors {
  const _ActivationStateColors({
    required this.background,
    required this.border,
    required this.foreground,
    required this.muted,
  });

  final Color background;
  final Color border;
  final Color foreground;
  final Color muted;
}

_ActivationStateColors _activationStateColors(
  BuildContext context,
  bool active,
) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  if (active) {
    return _ActivationStateColors(
      background: dark ? const Color(0xFF10372F) : const Color(0xFFE7F7EF),
      border: dark ? const Color(0xFF2EA37A) : const Color(0xFF84CFAF),
      foreground: dark ? const Color(0xFF68D8AA) : const Color(0xFF087A59),
      muted: dark ? const Color(0xFFA8D9C7) : const Color(0xFF3E735F),
    );
  }
  return _ActivationStateColors(
    background: dark ? const Color(0xFF36282A) : const Color(0xFFFFF4F4),
    border: dark ? const Color(0xFF87565B) : const Color(0xFFEAC0C0),
    foreground: dark ? const Color(0xFFE69A9A) : const Color(0xFF9D3A3A),
    muted: dark ? const Color(0xFFD5B0B0) : const Color(0xFF7C5555),
  );
}

const List<_ActivationDefinition> _attentionActivationItems = [
  _ActivationDefinition(
    keyName: 'autoresposta',
    label: 'Auto resposta',
    description: 'Responde gatilhos cadastrados.',
    icon: Icons.quickreply_rounded,
  ),
  _ActivationDefinition(
    keyName: 'botinterage',
    label: 'BotInterage',
    description: 'IA conversa no grupo.',
    icon: Icons.psychology_alt_rounded,
  ),
  _ActivationDefinition(
    keyName: 'vozbotinterage',
    label: 'IA por voz',
    description: 'Respostas em audio.',
    icon: Icons.record_voice_over_rounded,
  ),
  _ActivationDefinition(
    keyName: 'lerimagem',
    label: 'Ler imagem',
    description: 'IA interpreta imagens.',
    icon: Icons.image_search_rounded,
  ),
];

const List<_ActivationDefinition> _messageActivationItems = [
  _ActivationDefinition(
    keyName: 'bemvindo',
    label: 'Boas-vindas',
    description: 'Recebe novos membros.',
    icon: Icons.waving_hand_rounded,
  ),
  _ActivationDefinition(
    keyName: 'despedida',
    label: 'Saida',
    description: 'Mensagem quando alguem sai.',
    icon: Icons.logout_rounded,
  ),
  _ActivationDefinition(
    keyName: 'horapg',
    label: 'HoraPG',
    description: 'Dispara imagem por horario.',
    icon: Icons.schedule_send_rounded,
  ),
];

const List<_ActivationDefinition> _groupControlActivationItems = [
  _ActivationDefinition(
    keyName: 'soadm',
    label: 'So admin',
    description: 'Restringe comandos criticos.',
    icon: Icons.admin_panel_settings_rounded,
  ),
  _ActivationDefinition(
    keyName: 'schedule',
    label: 'Abrir/fechar',
    description: 'Programa horarios do grupo.',
    icon: Icons.schedule_rounded,
  ),
  _ActivationDefinition(
    keyName: 'linkmembro',
    label: 'Link membro',
    description: 'Permite link por membro.',
    icon: Icons.link_rounded,
  ),
];

const List<_ActivationDefinition> _protectionActivationItems = [
  _ActivationDefinition(
    keyName: 'antilink',
    label: 'Anti-link',
    description: 'Bloqueia links comuns.',
    icon: Icons.link_off_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antilinkgp',
    label: 'Anti-link GP',
    description: 'Bloqueia convites de grupo.',
    icon: Icons.group_remove_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antipalavras',
    label: 'Anti-palavras',
    description: 'Remove termos proibidos.',
    icon: Icons.report_gmailerrorred_rounded,
  ),
  _ActivationDefinition(
    keyName: 'banextremo',
    label: 'Ban extremo',
    description: 'Remove infracoes graves.',
    icon: Icons.gavel_rounded,
  ),
  _ActivationDefinition(
    keyName: 'bangringos',
    label: 'Ban gringos',
    description: 'Controla DDIs nao permitidos.',
    icon: Icons.public_off_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antinsfwimagem',
    label: 'Anti-NSFW',
    description: 'Modera imagens sensiveis.',
    icon: Icons.visibility_off_rounded,
  ),
  _ActivationDefinition(
    keyName: 'proibirnsfw',
    label: 'Proibir NSFW',
    description: 'Bloqueia midias sensiveis.',
    icon: Icons.no_adult_content_rounded,
  ),
  _ActivationDefinition(
    keyName: 'moderacaocomia',
    label: 'Moderacao IA',
    description: 'Usa IA para moderacao.',
    icon: Icons.shield_rounded,
  ),
];

const List<_ActivationDefinition> _mediaActivationItems = [
  _ActivationDefinition(
    keyName: 'autosticker',
    label: 'Auto sticker',
    description: 'Cria stickers automaticamente.',
    icon: Icons.auto_awesome_motion_rounded,
  ),
  _ActivationDefinition(
    keyName: 'autodownloader',
    label: 'Auto download',
    description: 'Baixa links suportados.',
    icon: Icons.download_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antisticker',
    label: 'Anti-sticker',
    description: 'Bloqueia stickers.',
    icon: Icons.hide_image_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antimage',
    label: 'Anti-imagem',
    description: 'Bloqueia imagens.',
    icon: Icons.image_not_supported_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antvideo',
    label: 'Anti-video',
    description: 'Bloqueia videos.',
    icon: Icons.videocam_off_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antaudio',
    label: 'Anti-audio',
    description: 'Bloqueia audios.',
    icon: Icons.volume_off_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antdoc',
    label: 'Anti-doc',
    description: 'Bloqueia documentos.',
    icon: Icons.file_present_rounded,
  ),
  _ActivationDefinition(
    keyName: 'antvcard',
    label: 'Anti-contato',
    description: 'Bloqueia cartoes de contato.',
    icon: Icons.contact_page_rounded,
  ),
];

const List<_ActivationDefinition> _utilityActivationItems = [
  _ActivationDefinition(
    keyName: 'brincadeiras',
    label: 'Brincadeiras',
    description: 'Comandos de diversao.',
    icon: Icons.celebration_rounded,
  ),
];

const List<_ActivationCategory> _activationCategories = [
  _ActivationCategory(
    id: 'attention',
    title: 'Atendimento e IA',
    items: _attentionActivationItems,
  ),
  _ActivationCategory(
    id: 'messages',
    title: 'Mensagens automáticas',
    items: _messageActivationItems,
  ),
  _ActivationCategory(
    id: 'control',
    title: 'Controle do grupo',
    items: _groupControlActivationItems,
  ),
  _ActivationCategory(
    id: 'protection',
    title: 'Proteções e punições',
    items: _protectionActivationItems,
  ),
  _ActivationCategory(
    id: 'media',
    title: 'Mídia, downloads e bloqueios',
    items: _mediaActivationItems,
  ),
  _ActivationCategory(
    id: 'utilities',
    title: 'Utilidades',
    items: _utilityActivationItems,
  ),
];

class _ActivationCard extends StatelessWidget {
  const _ActivationCard({
    required this.item,
    required this.active,
    required this.saving,
    required this.onConfigure,
    required this.onChanged,
  });

  final _ActivationDefinition item;
  final bool active;
  final bool saving;
  final VoidCallback onConfigure;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = _activationStateColors(context, active);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.border),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 230;
          return Padding(
            padding: const EdgeInsets.fromLTRB(8, 7, 6, 7),
            child: Row(
              children: [
                Icon(item.icon, size: 18, color: colors.foreground),
                const SizedBox(width: 6),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        item.label,
                        maxLines: 2,
                        overflow: TextOverflow.visible,
                        style: const TextStyle(
                          fontSize: 12.8,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        active ? 'Ligado' : 'Desligado',
                        style: TextStyle(
                          color: colors.foreground,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (!compact) ...[
                        const SizedBox(height: 1),
                        Text(
                          item.description,
                          maxLines: 2,
                          overflow: TextOverflow.visible,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(fontSize: 11, color: colors.muted),
                        ),
                      ],
                    ],
                  ),
                ),
                IconButton(
                  onPressed: onConfigure,
                  tooltip: 'Configurar ${item.label}',
                  icon: const Icon(Icons.settings_rounded),
                  iconSize: 17,
                  color: colors.foreground,
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints.tightFor(
                    width: 28,
                    height: 28,
                  ),
                  padding: EdgeInsets.zero,
                ),
                saving
                    ? const SizedBox(
                        width: 23,
                        height: 23,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : SizedBox(
                        width: 40,
                        child: Transform.scale(
                          scale: 0.7,
                          child: Switch(value: active, onChanged: onChanged),
                        ),
                      ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _AllActivationsDialog extends StatefulWidget {
  const _AllActivationsDialog({
    required this.settings,
    required this.onConfigure,
    required this.onChanged,
  });

  final BotGroupSettings settings;
  final void Function(_ActivationDefinition item) onConfigure;
  final Future<void> Function(String key, bool value) onChanged;

  @override
  State<_AllActivationsDialog> createState() => _AllActivationsDialogState();
}

class _AllActivationsDialogState extends State<_AllActivationsDialog> {
  final Map<String, bool> _overrides = {};
  String? _savingKey;
  String _categoryId = 'all';

  List<_ActivationCategory> get _visibleCategories {
    if (_categoryId == 'all') return _activationCategories;
    return _activationCategories
        .where((category) => category.id == _categoryId)
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final mobile = size.width < 700;
    final visibleCategories = _visibleCategories;
    return AlertDialog(
      title: LayoutBuilder(
        builder: (context, constraints) {
          final stacked = constraints.maxWidth < 560;
          final title = Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.tune_rounded),
              const SizedBox(width: 10),
              Text(
                'Ativações',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
              ),
            ],
          );
          final filter = SizedBox(
            width: stacked ? double.infinity : 260,
            child: DropdownButtonFormField<String>(
              key: ValueKey(_categoryId),
              initialValue: _categoryId,
              isExpanded: true,
              decoration: const InputDecoration(
                isDense: true,
                labelText: 'Categoria',
                prefixIcon: Icon(Icons.filter_alt_rounded),
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
              ),
              items: [
                const DropdownMenuItem(
                  value: 'all',
                  child: Text('Todas as categorias'),
                ),
                for (final category in _activationCategories)
                  DropdownMenuItem(
                    value: category.id,
                    child: Text(category.title),
                  ),
              ],
              onChanged: (value) {
                if (value == null) return;
                setState(() => _categoryId = value);
              },
            ),
          );
          if (stacked) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [title, const SizedBox(height: 10), filter],
            );
          }
          return Row(
            children: [
              Expanded(child: title),
              const SizedBox(width: 12),
              filter,
            ],
          );
        },
      ),
      insetPadding: EdgeInsets.symmetric(
        horizontal: mobile ? 10 : 40,
        vertical: mobile ? 12 : 24,
      ),
      contentPadding: EdgeInsets.fromLTRB(
        mobile ? 10 : 18,
        8,
        mobile ? 10 : 18,
        10,
      ),
      content: SizedBox(
        width: mobile
            ? (size.width - 20).clamp(300.0, 680.0).toDouble()
            : (size.width - 96).clamp(720.0, 1180.0).toDouble(),
        height: mobile
            ? (size.height - 116).clamp(420.0, 720.0).toDouble()
            : (size.height - 160).clamp(520.0, 760.0).toDouble(),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (
                var index = 0;
                index < visibleCategories.length;
                index++
              ) ...[
                if (index > 0) const SizedBox(height: 14),
                _ActivationSection(
                  title: visibleCategories[index].title,
                  items: visibleCategories[index].items,
                  settings: widget.settings,
                  savingKey: _savingKey,
                  isEnabled: _isEnabled,
                  onConfigure: widget.onConfigure,
                  onChanged: _setActivation,
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Fechar'),
        ),
      ],
    );
  }

  bool _isEnabled(String key) {
    if (_overrides.containsKey(key)) return _overrides[key]!;
    return _activationEnabled(widget.settings, key);
  }

  Future<void> _setActivation(String key, bool value) async {
    if (_savingKey != null) return;
    setState(() {
      _overrides[key] = value;
      _savingKey = key;
    });
    await widget.onChanged(key, value);
    if (mounted) setState(() => _savingKey = null);
  }
}

class _BotInterageConfigDraft {
  const _BotInterageConfigDraft({
    required this.enabled,
    required this.listenToAudio,
    required this.provider,
    required this.groqKeys,
    required this.openAiApiKey,
    required this.prompt,
    required this.model,
    required this.mentionOnly,
  });

  final bool enabled;
  final bool listenToAudio;
  final String provider;
  final List<String> groqKeys;
  final String? openAiApiKey;
  final String prompt;
  final String model;
  final bool mentionOnly;
}

class _BotInterageConfigDialog extends StatefulWidget {
  const _BotInterageConfigDialog({
    required this.enabled,
    required this.listenToAudio,
    required this.provider,
    required this.groqKeys,
    required this.openAiApiKey,
    required this.prompt,
    required this.model,
    required this.mentionOnly,
  });

  final bool enabled;
  final bool listenToAudio;
  final String provider;
  final List<String> groqKeys;
  final String? openAiApiKey;
  final String prompt;
  final String? model;
  final bool mentionOnly;

  @override
  State<_BotInterageConfigDialog> createState() =>
      _BotInterageConfigDialogState();
}

class _BotInterageConfigDialogState extends State<_BotInterageConfigDialog> {
  late bool _enabled;
  late bool _listenToAudio;
  late String _provider;
  late final TextEditingController _groqKeys;
  late final TextEditingController _openAiKey;
  late final TextEditingController _prompt;
  late final TextEditingController _model;
  late bool _mentionOnly;

  @override
  void initState() {
    super.initState();
    _enabled = widget.enabled;
    _listenToAudio = widget.listenToAudio;
    _provider =
        const {'groq', 'openai', 'chatgpt_system'}.contains(widget.provider)
        ? widget.provider
        : 'groq';
    _groqKeys = TextEditingController(text: widget.groqKeys.join('\n'));
    _openAiKey = TextEditingController(text: widget.openAiApiKey ?? '');
    _prompt = TextEditingController(text: widget.prompt);
    _model = TextEditingController(text: widget.model ?? '');
    if (_provider == 'chatgpt_system') _model.text = 'auto';
    _mentionOnly = widget.mentionOnly;
  }

  @override
  void dispose() {
    _groqKeys.dispose();
    _openAiKey.dispose();
    _prompt.dispose();
    _model.dispose();
    super.dispose();
  }

  void _selectProvider(String value) {
    setState(() {
      _provider = value;
      if (value == 'chatgpt_system') {
        _model.text = 'auto';
      } else if (_model.text.trim().isEmpty ||
          _model.text == 'llama-3.1-8b-instant' ||
          _model.text == 'qwen2.5:7b' ||
          _model.text == 'gpt-4.1-mini' ||
          _model.text == 'auto') {
        _model.text = switch (value) {
          'openai' => 'gpt-4.1-mini',
          'chatgpt_system' => 'auto',
          _ => 'llama-3.1-8b-instant',
        };
      }
    });
  }

  void _save() {
    final groqKeys = _groqKeys.text
        .split(RegExp(r'[\n,;]+'))
        .map((value) => value.replaceAll(RegExp(r'\s+'), ''))
        .where((value) => value.isNotEmpty)
        .toSet()
        .toList();
    final openAiKey = _openAiKey.text.replaceAll(RegExp(r'\s+'), '');
    if (_enabled && _provider == 'groq' && groqKeys.isEmpty) {
      showErrorToast(context, 'Informe ao menos uma chave Groq.');
      return;
    }
    if (_enabled && _provider == 'openai' && openAiKey.isEmpty) {
      showErrorToast(context, 'Informe a chave da API oficial da OpenAI.');
      return;
    }
    Navigator.of(context).pop(
      _BotInterageConfigDraft(
        enabled: _enabled,
        listenToAudio: _provider == 'chatgpt_system' && _listenToAudio,
        provider: _provider,
        groqKeys: groqKeys,
        openAiApiKey: openAiKey.isEmpty ? null : openAiKey,
        prompt: _prompt.text.trim(),
        model: _provider == 'chatgpt_system'
            ? 'auto'
            : _model.text.trim().isEmpty
            ? (_provider == 'openai'
                  ? 'gpt-4.1-mini'
                  : _provider == 'chatgpt_system'
                  ? 'auto'
                  : 'llama-3.1-8b-instant')
            : _model.text.trim(),
        mentionOnly: _mentionOnly,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Row(
        children: [
          Icon(Icons.psychology_alt_rounded),
          SizedBox(width: 10),
          Expanded(child: Text('Configurar BotInterage')),
        ],
      ),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Ativar respostas com IA'),
                subtitle: const Text(
                  'O prompt e o provedor são exclusivos deste grupo.',
                ),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Responder somente quando chamado'),
                subtitle: const Text(
                  'Ativado: responde apenas a menções ou quando alguém cita uma mensagem do bot. Desativado: responde a todas as mensagens elegíveis.',
                ),
                value: _mentionOnly,
                onChanged: _enabled
                    ? (value) => setState(() => _mentionOnly = value)
                    : null,
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                secondary: const Icon(Icons.hearing_rounded),
                title: const Text('Ouvir áudios no BotInterage'),
                subtitle: Text(
                  _provider == 'chatgpt_system'
                      ? 'Notas de voz serão entendidas pelo ChatGPT e respondidas no grupo.'
                      : 'Disponível ao selecionar ChatGPT Sistema (gerenciado).',
                ),
                value: _provider == 'chatgpt_system' && _listenToAudio,
                onChanged: _provider == 'chatgpt_system'
                    ? (value) => setState(() => _listenToAudio = value)
                    : null,
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _provider,
                decoration: const InputDecoration(labelText: 'Integração'),
                items: const [
                  DropdownMenuItem(
                    value: 'groq',
                    child: Text('Groq (chave do usuário)'),
                  ),
                  DropdownMenuItem(
                    value: 'openai',
                    child: Text('ChatGPT oficial (chave do usuário)'),
                  ),
                  DropdownMenuItem(
                    value: 'chatgpt_system',
                    child: Text('ChatGPT Sistema (gerenciado)'),
                  ),
                ],
                onChanged: (value) {
                  if (value != null) _selectProvider(value);
                },
              ),
              const SizedBox(height: 14),
              if (_provider == 'groq')
                TextField(
                  controller: _groqKeys,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Chaves Groq',
                    hintText: 'Uma chave por linha',
                  ),
                ),
              if (_provider == 'openai')
                TextField(
                  controller: _openAiKey,
                  obscureText: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Chave da API OpenAI',
                  ),
                ),
              if (_provider == 'chatgpt_system')
                const ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.verified_user_outlined),
                  title: Text('Credencial gerenciada pelo BotAdmin'),
                  subtitle: Text('Não é necessário informar uma chave de API.'),
                ),
              if (_provider != 'chatgpt_system') ...[
                const SizedBox(height: 14),
                TextField(
                  controller: _model,
                  decoration: const InputDecoration(labelText: 'Modelo'),
                ),
              ],
              const SizedBox(height: 14),
              TextField(
                controller: _prompt,
                minLines: 5,
                maxLines: 10,
                decoration: const InputDecoration(
                  labelText: 'Prompt de comportamento',
                  hintText:
                      'Defina como o ChatGPT deve falar e responder neste grupo.',
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
          onPressed: _save,
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _ActivationConfigDialog extends StatefulWidget {
  const _ActivationConfigDialog({required this.item, required this.enabled});

  final _ActivationDefinition item;
  final bool enabled;

  @override
  State<_ActivationConfigDialog> createState() =>
      _ActivationConfigDialogState();
}

class _ActivationConfigDialogState extends State<_ActivationConfigDialog> {
  late bool _enabled;

  @override
  void initState() {
    super.initState();
    _enabled = widget.enabled;
  }

  @override
  Widget build(BuildContext context) {
    final commands = _activationCommands(widget.item.keyName);
    final notes = _activationNotes(widget.item.keyName);
    final scheme = Theme.of(context).colorScheme;
    return AlertDialog(
      title: Row(
        children: [
          Icon(widget.item.icon, color: scheme.primary),
          const SizedBox(width: 10),
          Expanded(child: Text('Configurar ${widget.item.label}')),
        ],
      ),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('Ativar ${widget.item.label}'),
                subtitle: Text(widget.item.description),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              if (notes.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  'Como funciona',
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                for (final note in notes)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.check_circle_outline_rounded,
                          size: 18,
                          color: scheme.primary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(child: Text(note)),
                      ],
                    ),
                  ),
              ],
              if (commands.isNotEmpty) ...[
                const SizedBox(height: 12),
                _ActivationCommandHelp(commands: commands),
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
          onPressed: () => Navigator.of(context).pop(_enabled),
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _AutodownloaderConfigDraft {
  const _AutodownloaderConfigDraft({
    required this.enabled,
    required this.downloaderOnlyMode,
  });

  final bool enabled;
  final bool downloaderOnlyMode;
}

class _AutodownloaderConfigDialog extends StatefulWidget {
  const _AutodownloaderConfigDialog({
    required this.enabled,
    required this.downloaderOnlyMode,
  });

  final bool enabled;
  final bool downloaderOnlyMode;

  @override
  State<_AutodownloaderConfigDialog> createState() =>
      _AutodownloaderConfigDialogState();
}

class _AutodownloaderConfigDialogState
    extends State<_AutodownloaderConfigDialog> {
  late bool _enabled;
  late bool _downloaderOnlyMode;

  @override
  void initState() {
    super.initState();
    _enabled = widget.enabled;
    _downloaderOnlyMode = widget.downloaderOnlyMode;
  }

  Future<bool> _confirmDownloaderOnlyMode() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Ativar grupo só para downloads?'),
        content: const Text(
          'Com isso, qualquer texto enviado no grupo vira uma busca de música ou vídeo.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Ativar'),
          ),
        ],
      ),
    );
    return result == true;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AlertDialog(
      title: Row(
        children: [
          Icon(Icons.download_rounded, color: scheme.primary),
          const SizedBox(width: 10),
          const Expanded(child: Text('Configurar Auto download')),
        ],
      ),
      content: SizedBox(
        width: 560,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Ativar Auto download'),
              subtitle: const Text('Baixa links suportados enviados no grupo.'),
              value: _enabled,
              onChanged: (value) => setState(() {
                _enabled = value;
                if (!value) _downloaderOnlyMode = false;
              }),
            ),
            const Divider(height: 18),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Grupo usado só para downloads'),
              subtitle: const Text(
                'Texto comum vira busca com botões MP3 e MP4.',
              ),
              value: _enabled && _downloaderOnlyMode,
              onChanged: !_enabled
                  ? null
                  : (value) async {
                      if (value && !(await _confirmDownloaderOnlyMode())) {
                        return;
                      }
                      setState(() => _downloaderOnlyMode = value);
                    },
            ),
            const SizedBox(height: 12),
            _ActivationCommandHelp(
              commands: const ['!autodownloader', '!play <termo>'],
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
          onPressed: () => Navigator.of(context).pop(
            _AutodownloaderConfigDraft(
              enabled: _enabled,
              downloaderOnlyMode: _enabled && _downloaderOnlyMode,
            ),
          ),
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _ActivationCommandHelp extends StatelessWidget {
  const _ActivationCommandHelp({required this.commands});

  final List<String> commands;

  @override
  Widget build(BuildContext context) {
    if (commands.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.terminal_rounded, size: 18, color: scheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Ativar/desativar pelo grupo',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Envie o comando no grupo para inverter rapidamente o status da função.',
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 9),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final command in commands)
                  InputChip(
                    avatar: const Icon(Icons.content_copy_rounded, size: 16),
                    label: Text(command),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: command));
                      if (!context.mounted) return;
                      showSuccessToast(context, '$command copiado.');
                    },
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

const Set<String> _moderationActionActivationKeys = {
  'antilink',
  'antilinkgp',
  'banextremo',
  'antipalavras',
  'bangringos',
  'antinsfwimagem',
  'proibirnsfw',
  'antisticker',
  'antimage',
  'antvideo',
  'antaudio',
  'antdoc',
  'antvcard',
};

bool _hasModerationActions(String key) =>
    _moderationActionActivationKeys.contains(key);

bool _activationEnabled(BotGroupSettings settings, String key) {
  if (key == 'schedule') {
    return settings.scheduleConfig.closeEnabled ||
        settings.scheduleConfig.openEnabled;
  }
  if (key == 'horapg') {
    return settings.horapgConfig.enabled;
  }
  return settings.isEnabled(key);
}

List<String> _activationCommands(String key) {
  switch (key) {
    case 'autoresposta':
      return const ['!autoresposta', '!addautorepo', '!listaautorepo'];
    case 'botinterage':
      return const ['!botinterage', '!promptbot'];
    case 'vozbotinterage':
      return const ['!vozbotinterage', '!tts'];
    case 'lerimagem':
      return const ['!lerimagem'];
    case 'bemvindo':
      return const ['!bemvindo', '!fundobemvindo', '!legendabemvindo'];
    case 'despedida':
      return const ['!despedida', '!saida'];
    case 'soadm':
      return const ['!soadm'];
    case 'schedule':
      return const [
        '!abrirgp 07:00',
        '!fechargp 00:00',
        '!abrirauto off',
        '!fecharauto off',
      ];
    case 'antilink':
      return const ['!antilink'];
    case 'antilinkgp':
      return const ['!antilinkgp'];
    case 'banextremo':
      return const ['!banextremo'];
    case 'antipalavras':
      return const ['!antipalavras'];
    case 'bangringos':
      return const ['!bangringos'];
    case 'antinsfwimagem':
      return const ['!antinsfwimagem', '!antinsfw'];
    case 'proibirnsfw':
      return const ['!proibirnsfw'];
    case 'autosticker':
      return const ['!autosticker', '!s'];
    case 'autodownloader':
      return const ['!autodownloader'];
    case 'antisticker':
      return const ['!antifigurinha', '!antisticker'];
    case 'antimage':
      return const ['!antiimagem', '!antimage'];
    case 'antvideo':
      return const ['!antivideo', '!antvideo'];
    case 'antaudio':
      return const ['!antiaudio', '!antaudio'];
    case 'antdoc':
      return const ['!antidoc', '!antidocumento'];
    case 'antvcard':
      return const ['!anticontato', '!antvcard'];
    case 'brincadeiras':
      return const ['!brincadeiras', '!menubrincadeiras'];
    case 'linkmembro':
      return const ['!permitirlink', '!removerlink'];
    case 'horapg':
      return const ['!horapg', '!horapg off'];
    case 'moderacaocomia':
      return const ['!moderacaocomia'];
    default:
      return const [];
  }
}

List<String> _activationNotes(String key) {
  switch (key) {
    case 'autoresposta':
      return const [
        'Liga o mecanismo de respostas automaticas por gatilho.',
        'O cadastro dos gatilhos pode ser feito pelos comandos de autoresposta.',
      ];
    case 'botinterage':
      return const [
        'Permite que a IA responda mensagens do grupo conforme a configuracao global.',
        'Use promptbot para ajustar o comportamento quando precisar.',
      ];
    case 'vozbotinterage':
      return const [
        'Envia respostas da IA em audio quando a rotina de voz estiver disponivel.',
      ];
    case 'lerimagem':
      return const [
        'Permite que a IA interprete imagens recebidas ou mencionadas no grupo.',
      ];
    case 'bemvindo':
      return const [
        'Envia a mensagem configurada quando novos membros entram.',
        'A mídia, foto do perfil e legenda continuam editáveis pelo modal visual.',
      ];
    case 'despedida':
      return const [
        'Envia a mensagem configurada quando um membro sai do grupo.',
      ];
    case 'soadm':
      return const [
        'Restringe comandos criticos para administradores do grupo.',
        'Tambem sincroniza a flag interna usada pelas rotas antigas.',
      ];
    case 'schedule':
      return const [
        'Programa abertura e fechamento automático do grupo.',
        'Os comandos com horário agendam, e os comandos off desligam a programação.',
      ];
    case 'antilink':
      return const [
        'Bloqueia links comuns que não estejam na lista permitida.',
      ];
    case 'antilinkgp':
      return const ['Bloqueia convites de outros grupos do WhatsApp.'];
    case 'banextremo':
      return const [
        'Trata links como infração grave e pode remover o usuário conforme a ação configurada.',
      ];
    case 'antipalavras':
      return const [
        'Remove termos cadastrados na lista de palavras proibidas.',
      ];
    case 'bangringos':
      return const [
        'Controla números com DDI fora da lista permitida do grupo.',
      ];
    case 'antinsfwimagem':
    case 'proibirnsfw':
      return const [
        'Analisa mídias sensíveis e aplica a ação configurada para este grupo.',
      ];
    case 'autosticker':
      return const ['Converte midias recebidas em figurinha automaticamente.'];
    case 'autodownloader':
      return const [
        'Baixa links suportados automaticamente e envia a midia no grupo.',
        'No modo exclusivo, texto sem comando vira busca com opcoes de MP3 e MP4.',
      ];
    case 'antisticker':
    case 'antimage':
    case 'antvideo':
    case 'antaudio':
    case 'antdoc':
    case 'antvcard':
      return const [
        'Bloqueia esse tipo de midia quando enviado por participantes comuns.',
        'Administradores continuam respeitando as regras de bypass do bot.',
      ];
    case 'brincadeiras':
      return const ['Libera comandos de diversao e interacao social no grupo.'];
    case 'linkmembro':
      return const [
        'Permite controlar quais membros podem enviar links mesmo com anti-link ativo.',
      ];
    case 'moderacaocomia':
      return const [
        'Usa IA como apoio para moderação conforme as regras configuradas.',
      ];
    case 'horapg':
      return const [
        'Dispara uma imagem de destaque nos horarios definidos.',
        'Pode mencionar todos de forma invisivel quando a API suportar.',
      ];
    default:
      return const [
        'Esta engrenagem salva a ativacao diretamente para este grupo.',
      ];
  }
}

enum _MessageMediaKind { welcome, farewell }

class _MenuCarouselEditorDialog extends ConsumerStatefulWidget {
  const _MenuCarouselEditorDialog({
    required this.groupId,
    required this.initial,
    required this.preview,
  });

  final int groupId;
  final GroupMenuCarouselConfig initial;
  final GroupMenuCarouselConfig preview;

  @override
  ConsumerState<_MenuCarouselEditorDialog> createState() =>
      _MenuCarouselEditorDialogState();
}

class _MenuCarouselEditorDialogState
    extends ConsumerState<_MenuCarouselEditorDialog> {
  late List<GroupMenuCardConfig> _cards;
  final ScrollController _carouselController = ScrollController();
  String? _busyCard;

  @override
  void initState() {
    super.initState();
    _cards = [...widget.initial.cards];
    WidgetsBinding.instance.addPostFrameCallback((_) => _teaseCarousel());
  }

  @override
  void dispose() {
    _carouselController.dispose();
    super.dispose();
  }

  Future<void> _teaseCarousel() async {
    await Future<void>.delayed(const Duration(milliseconds: 260));
    if (!mounted || !_carouselController.hasClients) return;
    final max = _carouselController.position.maxScrollExtent;
    if (max <= 24) return;
    await _carouselController.animateTo(
      max,
      duration: const Duration(milliseconds: 720),
      curve: Curves.easeOutCubic,
    );
    await Future<void>.delayed(const Duration(milliseconds: 220));
    if (!mounted || !_carouselController.hasClients) return;
    await _carouselController.animateTo(
      0,
      duration: const Duration(milliseconds: 620),
      curve: Curves.easeInOutCubic,
    );
  }

  GroupMenuCardConfig _previewFor(int index) {
    final kind = _cards[index].kind;
    return widget.preview.cards.firstWhere(
      (card) => card.kind == kind,
      orElse: () => _cards[index],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final wa = WaTheme.of(context);
    return Dialog(
      insetPadding: const EdgeInsets.all(12),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1180, maxHeight: 820),
        child: Column(
          children: [
            Material(
              color: theme.colorScheme.surface,
              child: ListTile(
                leading: IconButton(
                  tooltip: 'Fechar',
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded),
                ),
                title: const Text(
                  'Menus do robô',
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: const Text('Deslize para editar cada menu.'),
                trailing: FilledButton.icon(
                  onPressed: _busyCard == null
                      ? () => Navigator.of(
                          context,
                        ).pop(GroupMenuCarouselConfig(cards: _cards))
                      : null,
                  icon: const Icon(Icons.save_rounded),
                  label: const Text('Salvar'),
                ),
              ),
            ),
            Expanded(
              child: ColoredBox(
                color: wa.chatWallpaper,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final cardWidth = constraints.maxWidth < 620
                        ? (constraints.maxWidth - 28).clamp(280.0, 380.0)
                        : 360.0;
                    return ListView.separated(
                      controller: _carouselController,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 24,
                      ),
                      scrollDirection: Axis.horizontal,
                      physics: const BouncingScrollPhysics(),
                      itemCount: _cards.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 16),
                      itemBuilder: (context, index) => SizedBox(
                        width: cardWidth,
                        child: _MenuCardPreview(
                          card: _cards[index],
                          preview: _previewFor(index),
                          busy: _busyCard == _cards[index].kind,
                          onEdit: (field) => _editField(index, field),
                          onEditSections: () => _editSections(index),
                          onEditButtons: () => _editButtons(index),
                          onPickImage: () => _pickImage(index),
                          onDeleteImage:
                              _cards[index].imageUrl == null &&
                                  _cards[index].imagePath == null
                              ? null
                              : () => _deleteImage(index),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _editField(int index, _MenuCardField field) async {
    final card = _cards[index];
    final preview = _previewFor(index);
    final currentValue = switch (field) {
      _MenuCardField.title => card.title ?? preview.title ?? card.previewTitle,
      _MenuCardField.description =>
        card.description ?? preview.description ?? card.previewDescription,
      _MenuCardField.footer =>
        card.footerText ?? preview.footerText ?? card.previewFooter,
      _MenuCardField.listButton =>
        card.listButtonText ?? preview.listButtonText ?? card.previewListButton,
    };
    final controller = TextEditingController(text: currentValue);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(switch (field) {
          _MenuCardField.title => 'Editar título',
          _MenuCardField.description => 'Editar mensagem',
          _MenuCardField.footer => 'Editar rodapé',
          _MenuCardField.listButton => 'Editar botão da lista',
        }),
        content: TextField(
          controller: controller,
          autofocus: true,
          minLines: field == _MenuCardField.description ? 5 : 1,
          maxLines: field == _MenuCardField.description ? 9 : 3,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'Digite o texto',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Aplicar'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result == null || !mounted) return;
    setState(() {
      final current = _cards[index];
      _cards[index] = switch (field) {
        _MenuCardField.title => current.copyWith(
          title: result,
          clearTitle: result.isEmpty,
        ),
        _MenuCardField.description => current.copyWith(
          description: result,
          clearDescription: result.isEmpty,
        ),
        _MenuCardField.footer => current.copyWith(
          footerText: result,
          clearFooterText: result.isEmpty,
        ),
        _MenuCardField.listButton => current.copyWith(
          listButtonText: result,
          clearListButtonText: result.isEmpty,
        ),
      };
    });
  }

  Future<void> _editSections(int index) async {
    final card = _cards[index];
    final preview = _previewFor(index);
    final result = await showDialog<List<GroupMenuListSectionConfig>>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _MenuSectionsEditorDialog(
        sections: card.sections ?? preview.sections ?? const [],
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      _cards[index] = _cards[index].copyWith(sections: result);
    });
  }

  Future<void> _editButtons(int index) async {
    final card = _cards[index];
    final preview = _previewFor(index);
    final result = await showDialog<List<GroupMenuButtonConfig>>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _MenuButtonsEditorDialog(
        buttons: card.buttons ?? preview.buttons ?? const [],
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      _cards[index] = _cards[index].copyWith(buttons: result);
    });
  }

  Future<void> _pickImage(int index) async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagens',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        ),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty || !mounted) return;
    final kind = _cards[index].kind;
    setState(() => _busyCard = kind);
    try {
      final settings = await ref
          .read(apiClientProvider)
          .uploadMenuCardMedia(
            widget.groupId,
            kind,
            bytes: bytes,
            fileName: file.name,
            mimeType: file.mimeType ?? _guessUploadMimeType(file.name),
          );
      final uploaded = settings.menuCarousel.cards.firstWhere(
        (entry) => entry.kind == kind,
        orElse: () => _cards[index],
      );
      if (!mounted) return;
      setState(() {
        _cards[index] = _cards[index].copyWith(
          imageUrl: uploaded.imageUrl,
          clearImageUrl: uploaded.imageUrl == null,
          imagePath: uploaded.imagePath,
          clearImagePath: uploaded.imagePath == null,
        );
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyCard = null);
    }
  }

  Future<void> _deleteImage(int index) async {
    final kind = _cards[index].kind;
    setState(() => _busyCard = kind);
    try {
      await ref
          .read(apiClientProvider)
          .deleteMenuCardMedia(widget.groupId, kind);
      if (!mounted) return;
      setState(() {
        _cards[index] = _cards[index].copyWith(
          clearImageUrl: true,
          clearImagePath: true,
        );
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyCard = null);
    }
  }
}

enum _MenuCardField { title, description, footer, listButton }

class _MenuCardPreview extends StatelessWidget {
  const _MenuCardPreview({
    required this.card,
    required this.preview,
    required this.busy,
    required this.onEdit,
    required this.onEditSections,
    required this.onEditButtons,
    required this.onPickImage,
    this.onDeleteImage,
  });

  final GroupMenuCardConfig card;
  final GroupMenuCardConfig preview;
  final bool busy;
  final ValueChanged<_MenuCardField> onEdit;
  final VoidCallback onEditSections;
  final VoidCallback onEditButtons;
  final VoidCallback onPickImage;
  final VoidCallback? onDeleteImage;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = card.title ?? preview.title ?? card.previewTitle;
    final description =
        card.description ?? preview.description ?? card.previewDescription;
    final footer = card.footerText ?? preview.footerText ?? card.previewFooter;
    final listButton =
        card.listButtonText ?? preview.listButtonText ?? card.previewListButton;
    final sections = card.sections ?? preview.sections ?? const [];
    final buttons = card.buttons ?? preview.buttons ?? const [];
    final mediaRef =
        card.imageUrl ??
        card.imagePath ??
        preview.displayMediaRef ??
        card.effectiveImageRef;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, right: 4, bottom: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  card.label,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Editar comandos',
                onPressed: onEditSections,
                icon: const Icon(Icons.list_alt_rounded),
                visualDensity: VisualDensity.compact,
              ),
              IconButton(
                tooltip: 'Editar botões',
                onPressed: onEditButtons,
                icon: const Icon(Icons.ads_click_rounded),
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            child: Align(
              alignment: Alignment.topCenter,
              child: Material(
                color: const Color(0xFFD9FDD3),
                borderRadius: BorderRadius.circular(8),
                clipBehavior: Clip.antiAlias,
                elevation: 1,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _MenuHeaderPreview(
                      mediaRef: mediaRef,
                      busy: busy,
                      onPick: onPickImage,
                      onDelete: onDeleteImage,
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 10, 8, 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _EditablePreviewText(
                            text: title,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                            ),
                            onTap: () => onEdit(_MenuCardField.title),
                          ),
                          const SizedBox(height: 8),
                          _EditablePreviewText(
                            text: description,
                            style: const TextStyle(fontSize: 14, height: 1.25),
                            onTap: () => onEdit(_MenuCardField.description),
                          ),
                          const SizedBox(height: 8),
                          _EditablePreviewText(
                            text: footer,
                            style: TextStyle(
                              color: Colors.blueGrey.shade600,
                              fontSize: 12,
                            ),
                            onTap: () => onEdit(_MenuCardField.footer),
                          ),
                        ],
                      ),
                    ),
                    if (sections.isNotEmpty) ...[
                      const Divider(height: 1),
                      _MenuButtonPreview(
                        icon: Icons.list_alt_rounded,
                        label: listButton,
                        onTap: onEditSections,
                        onEdit: () => onEdit(_MenuCardField.listButton),
                      ),
                    ],
                    for (final button in buttons) ...[
                      const Divider(height: 1),
                      _MenuButtonPreview(
                        icon: _menuButtonIcon(button.type),
                        label: button.label,
                        onTap: onEditButtons,
                        onEdit: onEditButtons,
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

class _MenuHeaderPreview extends StatelessWidget {
  const _MenuHeaderPreview({
    required this.mediaRef,
    required this.busy,
    required this.onPick,
    this.onDelete,
  });

  final String? mediaRef;
  final bool busy;
  final VoidCallback onPick;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final value = mediaRef?.trim() ?? '';
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (value.isNotEmpty)
            Image.network(
              _absoluteUploadUrl(value),
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => _emptyHeader(),
            )
          else
            _emptyHeader(),
          if (busy)
            const ColoredBox(
              color: Color(0x66000000),
              child: Center(child: CircularProgressIndicator()),
            ),
          Positioned(
            top: 8,
            right: 8,
            child: Row(
              children: [
                _RoundPreviewButton(
                  tooltip: 'Trocar imagem',
                  icon: Icons.photo_camera_rounded,
                  onTap: busy ? null : onPick,
                ),
                if (onDelete != null) ...[
                  const SizedBox(width: 6),
                  _RoundPreviewButton(
                    tooltip: 'Remover imagem',
                    icon: Icons.delete_outline_rounded,
                    onTap: busy ? null : onDelete,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyHeader() => ColoredBox(
    color: const Color(0xFFE9EDEF),
    child: Center(
      child: Icon(
        Icons.image_outlined,
        size: 46,
        color: Colors.blueGrey.shade400,
      ),
    ),
  );
}

class _EditablePreviewText extends StatelessWidget {
  const _EditablePreviewText({
    required this.text,
    required this.style,
    required this.onTap,
  });

  final String text;
  final TextStyle style;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            text,
            style: style,
            softWrap: true,
            overflow: TextOverflow.visible,
          ),
        ),
        const SizedBox(width: 6),
        _RoundPreviewButton(
          tooltip: 'Editar',
          icon: Icons.edit_rounded,
          onTap: onTap,
        ),
      ],
    );
  }
}

class _MenuButtonPreview extends StatelessWidget {
  const _MenuButtonPreview({
    required this.icon,
    required this.label,
    this.onTap,
    this.onEdit,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: SizedBox(
        height: 48,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 19, color: const Color(0xFF008069)),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF008069),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (onEdit != null) ...[
              const SizedBox(width: 4),
              _CompactPreviewIconButton(
                tooltip: 'Editar',
                onPressed: onEdit,
                icon: Icons.edit_rounded,
                color: const Color(0xFF008069),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

IconData _menuButtonIcon(String type) => switch (type) {
  'copy' => Icons.copy_rounded,
  'reply' => Icons.reply_rounded,
  _ => Icons.open_in_new_rounded,
};

class _MenuSectionsEditorDialog extends StatefulWidget {
  const _MenuSectionsEditorDialog({required this.sections});

  final List<GroupMenuListSectionConfig> sections;

  @override
  State<_MenuSectionsEditorDialog> createState() =>
      _MenuSectionsEditorDialogState();
}

class _MenuSectionsEditorDialogState extends State<_MenuSectionsEditorDialog> {
  late List<GroupMenuListSectionConfig> _sections;

  @override
  void initState() {
    super.initState();
    _sections = [
      for (final section in widget.sections)
        section.copyWith(rows: [...section.rows]),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Comandos da lista'),
      content: SizedBox(
        width: 620,
        child: _sections.isEmpty
            ? const Padding(
                padding: EdgeInsets.symmetric(vertical: 28),
                child: Center(child: Text('Nenhum comando nesta lista.')),
              )
            : ListView.builder(
                shrinkWrap: true,
                itemCount: _sections.length,
                itemBuilder: (context, sectionIndex) {
                  final section = _sections[sectionIndex];
                  return ExpansionTile(
                    initiallyExpanded: true,
                    title: Text(
                      section.title,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    trailing: Wrap(
                      children: [
                        IconButton(
                          tooltip: 'Editar seção',
                          onPressed: () => _editSection(sectionIndex),
                          icon: const Icon(Icons.edit_rounded),
                        ),
                        IconButton(
                          tooltip: 'Excluir seção',
                          onPressed: () =>
                              setState(() => _sections.removeAt(sectionIndex)),
                          icon: const Icon(Icons.delete_outline_rounded),
                        ),
                      ],
                    ),
                    children: [
                      for (
                        var rowIndex = 0;
                        rowIndex < section.rows.length;
                        rowIndex++
                      )
                        ListTile(
                          leading: const Icon(Icons.terminal_rounded),
                          title: Text(section.rows[rowIndex].title),
                          subtitle: Text(
                            [
                              section.rows[rowIndex].command,
                              if (section.rows[rowIndex].description != null)
                                section.rows[rowIndex].description!,
                            ].join(' · '),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          onTap: () => _editRow(sectionIndex, rowIndex),
                          trailing: IconButton(
                            tooltip: 'Remover comando',
                            onPressed: () => _removeRow(sectionIndex, rowIndex),
                            icon: const Icon(Icons.delete_outline_rounded),
                          ),
                        ),
                      ListTile(
                        leading: const Icon(Icons.add_rounded),
                        title: const Text('Adicionar comando'),
                        onTap: () => _editRow(sectionIndex, null),
                      ),
                    ],
                  );
                },
              ),
      ),
      actions: [
        TextButton.icon(
          onPressed: _sections.length >= 8 ? null : _addSection,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Nova seção'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_sections),
          child: const Text('Aplicar'),
        ),
      ],
    );
  }

  Future<void> _addSection() async {
    final controller = TextEditingController();
    final title = await _editSingleValue(
      context,
      title: 'Nova seção',
      controller: controller,
      hint: 'Ex.: Downloads',
    );
    controller.dispose();
    if (title == null || title.trim().isEmpty || !mounted) return;
    setState(() {
      _sections.add(
        GroupMenuListSectionConfig(
          id: 'section-${DateTime.now().microsecondsSinceEpoch}',
          title: title.trim(),
          rows: const [],
        ),
      );
    });
  }

  Future<void> _editSection(int index) async {
    final controller = TextEditingController(text: _sections[index].title);
    final title = await _editSingleValue(
      context,
      title: 'Editar seção',
      controller: controller,
      hint: 'Nome da seção',
    );
    controller.dispose();
    if (title == null || title.trim().isEmpty || !mounted) return;
    setState(() {
      _sections[index] = _sections[index].copyWith(title: title.trim());
    });
  }

  Future<void> _editRow(int sectionIndex, int? rowIndex) async {
    final current = rowIndex == null
        ? null
        : _sections[sectionIndex].rows[rowIndex];
    final result = await showDialog<GroupMenuListRowConfig>(
      context: context,
      builder: (context) => _MenuCommandEditorDialog(command: current),
    );
    if (result == null || !mounted) return;
    setState(() {
      final rows = [..._sections[sectionIndex].rows];
      if (rowIndex == null) {
        rows.add(result);
      } else {
        rows[rowIndex] = result;
      }
      _sections[sectionIndex] = _sections[sectionIndex].copyWith(rows: rows);
    });
  }

  void _removeRow(int sectionIndex, int rowIndex) {
    setState(() {
      final rows = [..._sections[sectionIndex].rows]..removeAt(rowIndex);
      _sections[sectionIndex] = _sections[sectionIndex].copyWith(rows: rows);
    });
  }
}

class _MenuCommandEditorDialog extends StatefulWidget {
  const _MenuCommandEditorDialog({this.command});

  final GroupMenuListRowConfig? command;

  @override
  State<_MenuCommandEditorDialog> createState() =>
      _MenuCommandEditorDialogState();
}

class _MenuCommandEditorDialogState extends State<_MenuCommandEditorDialog> {
  late final TextEditingController _title;
  late final TextEditingController _command;
  late final TextEditingController _description;

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: widget.command?.title ?? '');
    _command = TextEditingController(text: widget.command?.command ?? '');
    _description = TextEditingController(
      text: widget.command?.description ?? '',
    );
  }

  @override
  void dispose() {
    _title.dispose();
    _command.dispose();
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(
        widget.command == null ? 'Adicionar comando' : 'Editar comando',
      ),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _title,
              autofocus: true,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'Nome exibido',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _command,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'Comando',
                hintText: '/menu',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _description,
              minLines: 2,
              maxLines: 4,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'Descrição',
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
        FilledButton(
          onPressed: () {
            if (_title.text.trim().isEmpty || _command.text.trim().isEmpty) {
              return;
            }
            Navigator.of(context).pop(
              GroupMenuListRowConfig(
                id:
                    widget.command?.id ??
                    'row-${DateTime.now().microsecondsSinceEpoch}',
                title: _title.text.trim(),
                description: _nullableText(_description.text),
                command: _command.text.trim(),
              ),
            );
          },
          child: const Text('Aplicar'),
        ),
      ],
    );
  }
}

class _MenuButtonsEditorDialog extends StatefulWidget {
  const _MenuButtonsEditorDialog({required this.buttons});

  final List<GroupMenuButtonConfig> buttons;

  @override
  State<_MenuButtonsEditorDialog> createState() =>
      _MenuButtonsEditorDialogState();
}

class _MenuButtonsEditorDialogState extends State<_MenuButtonsEditorDialog> {
  late List<GroupMenuButtonConfig> _buttons;

  @override
  void initState() {
    super.initState();
    _buttons = [...widget.buttons];
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Botões do menu'),
      content: SizedBox(
        width: 520,
        child: _buttons.isEmpty
            ? const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: Text('Nenhum botão adicional.')),
              )
            : ListView.separated(
                shrinkWrap: true,
                itemCount: _buttons.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final button = _buttons[index];
                  return ListTile(
                    leading: Icon(_menuButtonIcon(button.type)),
                    title: Text(button.label),
                    subtitle: Text(
                      button.value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onTap: () => _editButton(index),
                    trailing: IconButton(
                      tooltip: 'Remover botão',
                      onPressed: () => setState(() => _buttons.removeAt(index)),
                      icon: const Icon(Icons.delete_outline_rounded),
                    ),
                  );
                },
              ),
      ),
      actions: [
        TextButton.icon(
          onPressed: _buttons.length >= 2 ? null : () => _editButton(null),
          icon: const Icon(Icons.add_rounded),
          label: const Text('Adicionar'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_buttons),
          child: const Text('Aplicar'),
        ),
      ],
    );
  }

  Future<void> _editButton(int? index) async {
    final result = await showDialog<GroupMenuButtonConfig>(
      context: context,
      builder: (context) => _MenuButtonEditorDialog(
        button: index == null ? null : _buttons[index],
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      if (index == null) {
        _buttons.add(result);
      } else {
        _buttons[index] = result;
      }
    });
  }
}

class _MenuButtonEditorDialog extends StatefulWidget {
  const _MenuButtonEditorDialog({this.button});

  final GroupMenuButtonConfig? button;

  @override
  State<_MenuButtonEditorDialog> createState() =>
      _MenuButtonEditorDialogState();
}

class _MenuButtonEditorDialogState extends State<_MenuButtonEditorDialog> {
  late String _type;
  late final TextEditingController _label;
  late final TextEditingController _value;

  @override
  void initState() {
    super.initState();
    _type = widget.button?.type ?? 'url';
    _label = TextEditingController(text: widget.button?.label ?? '');
    _value = TextEditingController(text: widget.button?.value ?? '');
  }

  @override
  void dispose() {
    _label.dispose();
    _value.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final valueLabel = switch (_type) {
      'copy' => 'Conteúdo para copiar',
      'reply' => 'Comando da resposta',
      _ => 'Link',
    };
    return AlertDialog(
      title: Text(widget.button == null ? 'Adicionar botão' : 'Editar botão'),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'Tipo',
              ),
              items: const [
                DropdownMenuItem(value: 'url', child: Text('Abrir link')),
                DropdownMenuItem(value: 'copy', child: Text('Copiar')),
                DropdownMenuItem(value: 'reply', child: Text('Responder')),
              ],
              onChanged: (value) => setState(() => _type = value ?? 'url'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _label,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'Texto do botão',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _value,
              keyboardType: _type == 'url'
                  ? TextInputType.url
                  : TextInputType.text,
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                labelText: valueLabel,
                hintText: _type == 'reply' ? '/menu' : null,
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
        FilledButton(
          onPressed: () {
            if (_label.text.trim().isEmpty || _value.text.trim().isEmpty) {
              return;
            }
            Navigator.of(context).pop(
              GroupMenuButtonConfig(
                id:
                    widget.button?.id ??
                    'button-${DateTime.now().microsecondsSinceEpoch}',
                type: _type,
                label: _label.text.trim(),
                value: _value.text.trim(),
              ),
            );
          },
          child: const Text('Aplicar'),
        ),
      ],
    );
  }
}

Future<String?> _editSingleValue(
  BuildContext context, {
  required String title,
  required TextEditingController controller,
  required String hint,
}) {
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: InputDecoration(
          border: const OutlineInputBorder(),
          hintText: hint,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          child: const Text('Aplicar'),
        ),
      ],
    ),
  );
}

class _RoundPreviewButton extends StatelessWidget {
  const _RoundPreviewButton({
    required this.tooltip,
    required this.icon,
    this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: 34,
      child: Material(
        color: Colors.white.withValues(alpha: 0.94),
        shape: const CircleBorder(),
        child: IconButton(
          tooltip: tooltip,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints.tightFor(width: 34, height: 34),
          visualDensity: VisualDensity.compact,
          onPressed: onTap,
          icon: Icon(icon, size: 17),
        ),
      ),
    );
  }
}

class _CompactPreviewIconButton extends StatelessWidget {
  const _CompactPreviewIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    required this.color,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: 32,
      child: IconButton(
        tooltip: tooltip,
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints.tightFor(width: 32, height: 32),
        visualDensity: VisualDensity.compact,
        onPressed: onPressed,
        icon: Icon(icon, size: 16, color: color),
      ),
    );
  }
}

class _ScheduledAdsCanvas extends ConsumerStatefulWidget {
  const _ScheduledAdsCanvas({required this.group, required this.initialAds});

  final BotGroup group;
  final List<GroupScheduledAdConfig> initialAds;

  @override
  ConsumerState<_ScheduledAdsCanvas> createState() =>
      _ScheduledAdsCanvasState();
}

class _ScheduledAdsCanvasState extends ConsumerState<_ScheduledAdsCanvas> {
  late List<GroupScheduledAdConfig> _ads;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _ads = [...widget.initialAds];
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final size = MediaQuery.sizeOf(context);
    final width = size.width < 760
        ? size.width
        : (size.width - 80).clamp(760.0, 1120.0).toDouble();
    return Align(
      alignment: Alignment.bottomCenter,
      child: SizedBox(
        width: width,
        height: size.height * 0.9,
        child: Material(
          color: wa.panel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: wa.border,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              ListTile(
                leading: IconButton(
                  tooltip: 'Fechar',
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded),
                ),
                title: const Text(
                  'Mensagens programadas',
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
                subtitle: Text(
                  'ADS de ${widget.group.name}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: FilledButton.icon(
                  onPressed: _ads.length >= 20 || _busyId != null
                      ? null
                      : () => _editAd(),
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('Criar'),
                ),
              ),
              Divider(height: 1, color: wa.divider),
              Expanded(
                child: _ads.isEmpty
                    ? _ScheduledAdsEmpty(onCreate: () => _editAd())
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
                        itemCount: _ads.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          final ad = _ads[index];
                          return _ScheduledAdListTile(
                            ad: ad,
                            busy: _busyId == ad.id,
                            onTap: () => _editAd(ad),
                            onEnabledChanged: (value) => _setEnabled(ad, value),
                            onDelete: () => _deleteAd(ad),
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

  Future<void> _editAd([GroupScheduledAdConfig? current]) async {
    final draft = await showDialog<_ScheduledAdDraft>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _ScheduledAdEditorDialog(
        group: widget.group,
        initial: current ?? GroupScheduledAdConfig.newDraft(),
      ),
    );
    if (draft == null || !mounted) return;
    final key = current?.id ?? 'new';
    setState(() => _busyId = key);
    try {
      final api = ref.read(apiClientProvider);
      final saved = current == null
          ? await api.createGroupAd(widget.group.id, draft.toPayload())
          : await api.updateGroupAd(
              widget.group.id,
              current.id,
              draft.toPayload(),
            );
      if (!mounted) return;
      setState(() {
        if (current == null) {
          _ads.insert(0, saved);
        } else {
          final index = _ads.indexWhere((entry) => entry.id == current.id);
          if (index >= 0) _ads[index] = saved;
        }
      });
      showSuccessToast(
        context,
        current == null
            ? 'Mensagem programada criada.'
            : 'Mensagem atualizada.',
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _setEnabled(GroupScheduledAdConfig ad, bool enabled) async {
    if (_busyId != null) return;
    setState(() => _busyId = ad.id);
    try {
      final updated = await ref.read(apiClientProvider).updateGroupAd(
        widget.group.id,
        ad.id,
        {'enabled': enabled},
      );
      if (!mounted) return;
      setState(() {
        final index = _ads.indexWhere((entry) => entry.id == ad.id);
        if (index >= 0) _ads[index] = updated;
      });
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _deleteAd(GroupScheduledAdConfig ad) async {
    if (_busyId != null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir mensagem?'),
        content: const Text('Essa programação deixará de ser enviada.'),
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
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busyId = ad.id);
    try {
      await ref.read(apiClientProvider).deleteGroupAd(widget.group.id, ad.id);
      if (!mounted) return;
      setState(() => _ads.removeWhere((entry) => entry.id == ad.id));
      showSuccessToast(context, 'Mensagem programada excluída.');
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }
}

class _ScheduledAdsEmpty extends StatelessWidget {
  const _ScheduledAdsEmpty({required this.onCreate});

  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.schedule_send_rounded, size: 48, color: wa.accent),
            const SizedBox(height: 14),
            Text(
              'Nenhuma mensagem programada',
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onCreate,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Criar mensagem'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScheduledAdListTile extends StatelessWidget {
  const _ScheduledAdListTile({
    required this.ad,
    required this.busy,
    required this.onTap,
    required this.onEnabledChanged,
    required this.onDelete,
  });

  final GroupScheduledAdConfig ad;
  final bool busy;
  final VoidCallback onTap;
  final ValueChanged<bool> onEnabledChanged;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final content = ad.caption.trim().isNotEmpty
        ? ad.caption.trim()
        : ad.media != null
        ? 'Mídia programada'
        : '${ad.buttons.length} botão(ões)';
    final schedule = ad.scheduleType == 'times'
        ? (ad.times.isEmpty ? 'Horários' : ad.times.join(', '))
        : 'A cada ${ad.frequency ?? '24h'}';
    return Material(
      color: ad.enabled ? wa.accentSoft : wa.searchBg,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: busy ? null : onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: ad.enabled ? wa.accent.withValues(alpha: 0.55) : wa.border,
            ),
          ),
          child: Row(
            children: [
              Icon(
                ad.media == null
                    ? Icons.chat_rounded
                    : Icons.perm_media_rounded,
                color: ad.enabled ? wa.accent : wa.icon,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      content,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: wa.textPrimary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '$schedule${ad.buttons.isEmpty ? '' : ' · ${ad.buttons.length} botão(ões)'}',
                      style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                    ),
                  ],
                ),
              ),
              if (busy)
                const SizedBox(
                  width: 34,
                  height: 34,
                  child: Padding(
                    padding: EdgeInsets.all(8),
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              else ...[
                Switch.adaptive(
                  value: ad.enabled,
                  onChanged: onEnabledChanged,
                  activeTrackColor: wa.accent,
                ),
                IconButton(
                  onPressed: onDelete,
                  icon: const Icon(Icons.delete_outline_rounded),
                  tooltip: 'Excluir',
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ScheduledAdDraft {
  const _ScheduledAdDraft({
    required this.enabled,
    required this.caption,
    required this.mentionAll,
    required this.scheduleType,
    required this.frequency,
    required this.times,
    required this.media,
    required this.buttons,
  });

  final bool enabled;
  final String caption;
  final bool mentionAll;
  final String scheduleType;
  final String frequency;
  final List<String> times;
  final GroupScheduledAdMedia? media;
  final List<GroupReplyButton> buttons;

  Map<String, Object?> toPayload() => {
    'enabled': enabled,
    'caption': caption,
    'mentionAll': mentionAll,
    'scheduleType': scheduleType,
    'frequency': frequency,
    'times': times,
    'media': media?.toJson(),
    'responseButtons': null,
    'interactiveButtons': buttons.map((button) => button.toJson()).toList(),
  };
}

class _ScheduledAdEditorDialog extends ConsumerStatefulWidget {
  const _ScheduledAdEditorDialog({required this.group, required this.initial});

  final BotGroup group;
  final GroupScheduledAdConfig initial;

  @override
  ConsumerState<_ScheduledAdEditorDialog> createState() =>
      _ScheduledAdEditorDialogState();
}

class _ScheduledAdEditorDialogState
    extends ConsumerState<_ScheduledAdEditorDialog> {
  late final TextEditingController _caption;
  late final TextEditingController _frequency;
  late final TextEditingController _times;
  late bool _enabled;
  late bool _mentionAll;
  late String _scheduleType;
  late GroupScheduledAdMedia? _media;
  late List<GroupReplyButton> _buttons;
  Uint8List? _localMediaBytes;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    _caption = TextEditingController(text: initial.caption);
    _frequency = TextEditingController(text: initial.frequency ?? '24h');
    _times = TextEditingController(text: initial.times.join(', '));
    _enabled = initial.enabled;
    _mentionAll = initial.mentionAll;
    _scheduleType = initial.scheduleType == 'times' ? 'times' : 'frequency';
    _media = initial.media;
    _buttons = [...initial.buttons];
  }

  @override
  void dispose() {
    _caption.dispose();
    _frequency.dispose();
    _times.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final size = MediaQuery.sizeOf(context);
    final compact = size.width < 760;
    final preview = _ScheduledAdBubblePreview(
      caption: _caption.text,
      media: _media,
      localMediaBytes: _localMediaBytes,
      uploading: _uploading,
      buttons: _buttons,
      onEditText: _editText,
      onPickMedia: _uploading ? null : _pickMedia,
      onClearMedia: _uploading
          ? null
          : () => setState(() {
              _media = null;
              _localMediaBytes = null;
            }),
      onAddButton: _buttons.length >= 3 ? null : _addButton,
      onEditButton: _editButton,
      onRemoveButton: (index) => setState(() => _buttons.removeAt(index)),
    );
    final schedule = _ScheduledAdScheduleForm(
      enabled: _enabled,
      mentionAll: _mentionAll,
      scheduleType: _scheduleType,
      frequency: _frequency,
      times: _times,
      onEnabledChanged: (value) => setState(() => _enabled = value),
      onMentionAllChanged: (value) => setState(() => _mentionAll = value),
      onScheduleTypeChanged: (value) => setState(() => _scheduleType = value),
    );
    return Dialog(
      backgroundColor: wa.panel,
      insetPadding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 24,
        vertical: compact ? 8 : 18,
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 980, maxHeight: 860),
        child: Column(
          children: [
            ListTile(
              leading: IconButton(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close_rounded),
                tooltip: 'Fechar',
              ),
              title: Text(
                widget.initial.id.isEmpty
                    ? 'Nova mensagem programada'
                    : 'Editar mensagem programada',
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              trailing: FilledButton.icon(
                onPressed: _uploading ? null : _save,
                icon: const Icon(Icons.save_rounded),
                label: const Text('Salvar'),
              ),
            ),
            Divider(height: 1, color: wa.divider),
            Expanded(
              child: compact
                  ? ListView(
                      padding: const EdgeInsets.all(12),
                      children: [preview, const SizedBox(height: 12), schedule],
                    )
                  : Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                          flex: 6,
                          child: ColoredBox(
                            color: wa.chatWallpaper,
                            child: SingleChildScrollView(
                              padding: const EdgeInsets.all(22),
                              child: preview,
                            ),
                          ),
                        ),
                        VerticalDivider(width: 1, color: wa.divider),
                        SizedBox(
                          width: 350,
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.all(16),
                            child: schedule,
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

  Future<void> _editText() async {
    final controller = TextEditingController(text: _caption.text);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Editar mensagem'),
        content: SizedBox(
          width: 560,
          child: TextField(
            controller: controller,
            autofocus: true,
            minLines: 7,
            maxLines: 12,
            decoration: const InputDecoration(
              labelText: 'Texto ou legenda',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Aplicar'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result == null || !mounted) return;
    setState(() => _caption.text = result);
  }

  Future<void> _pickMedia() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Mídias',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'mov',
            'webm',
            'mp3',
            'ogg',
            'opus',
            'pdf',
            'doc',
            'docx',
            'xls',
            'xlsx',
          ],
        ),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty || !mounted) return;
    final mime = file.mimeType ?? _guessUploadMimeType(file.name);
    final mediaType = _scheduledAdMediaType(file.name, mime);
    setState(() {
      _localMediaBytes = bytes;
      _uploading = true;
    });
    try {
      final media = await ref
          .read(apiClientProvider)
          .uploadGroupAdMedia(
            widget.group.id,
            bytes: bytes,
            fileName: file.name,
            mediaType: mediaType,
            mimeType: mime,
          );
      if (!mounted) return;
      setState(() => _media = media);
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  void _addButton() {
    if (_buttons.length >= 3) return;
    final index = _buttons.length;
    _editButtonDraft(GroupReplyButton.newDraft(index), insertAt: index);
  }

  Future<void> _editButton(int index) async {
    if (index < 0 || index >= _buttons.length) return;
    await _editButtonDraft(_buttons[index], insertAt: index, replace: true);
  }

  Future<void> _editButtonDraft(
    GroupReplyButton button, {
    required int insertAt,
    bool replace = false,
  }) async {
    final edited = await showDialog<GroupReplyButton>(
      context: context,
      builder: (context) => _ButtonEditDialog(button: button),
    );
    if (edited == null || !mounted) return;
    final editedFamily = _scheduledAdButtonFamily(edited.type);
    final hasDifferentFamily = _buttons.indexed.any((entry) {
      final (index, current) = entry;
      if (replace && index == insertAt) return false;
      return _scheduledAdButtonFamily(current.type) != editedFamily;
    });
    if (hasDifferentFamily) {
      showErrorToast(
        context,
        'Use respostas rápidas ou botões de ação no mesmo balão.',
      );
      return;
    }
    setState(() {
      if (replace) {
        _buttons[insertAt] = edited;
      } else {
        _buttons.insert(insertAt, edited);
      }
    });
  }

  void _save() {
    final caption = _caption.text.trim();
    if (caption.isEmpty && _media == null && _buttons.isEmpty) {
      showErrorToast(context, 'Adicione texto, mídia ou pelo menos um botão.');
      return;
    }
    final times = _times.text
        .split(RegExp(r'[\s,;]+'))
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toSet()
        .toList();
    if (_scheduleType == 'times' && times.isEmpty) {
      showErrorToast(context, 'Informe pelo menos um horário.');
      return;
    }
    final frequency = _frequency.text.trim().toLowerCase();
    if (_scheduleType == 'frequency' &&
        !RegExp(r'^\d+[mhd]$').hasMatch(frequency)) {
      showErrorToast(context, 'Use uma frequência como 30m, 2h ou 1d.');
      return;
    }
    Navigator.of(context).pop(
      _ScheduledAdDraft(
        enabled: _enabled,
        caption: caption,
        mentionAll: _mentionAll,
        scheduleType: _scheduleType,
        frequency: frequency.isEmpty ? '24h' : frequency,
        times: times,
        media: _media,
        buttons: _buttons,
      ),
    );
  }
}

class _ScheduledAdBubblePreview extends StatelessWidget {
  const _ScheduledAdBubblePreview({
    required this.caption,
    required this.media,
    required this.localMediaBytes,
    required this.uploading,
    required this.buttons,
    required this.onEditText,
    required this.onPickMedia,
    required this.onClearMedia,
    required this.onAddButton,
    required this.onEditButton,
    required this.onRemoveButton,
  });

  final String caption;
  final GroupScheduledAdMedia? media;
  final Uint8List? localMediaBytes;
  final bool uploading;
  final List<GroupReplyButton> buttons;
  final VoidCallback onEditText;
  final VoidCallback? onPickMedia;
  final VoidCallback? onClearMedia;
  final VoidCallback? onAddButton;
  final void Function(int index) onEditButton;
  final void Function(int index) onRemoveButton;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final hasMedia = media != null || localMediaBytes != null;
    final hasText = caption.trim().isNotEmpty;
    return Align(
      alignment: Alignment.topCenter,
      child: Material(
        color: wa.bubbleOut,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        elevation: 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 430),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _ScheduledAdMediaPreview(
                media: media,
                localMediaBytes: localMediaBytes,
                uploading: uploading,
                onPick: onPickMedia,
                onClear: hasMedia ? onClearMedia : null,
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 8, 7),
                child: _EditablePreviewText(
                  text: hasText
                      ? caption.trim()
                      : 'Toque no lápis para escrever a mensagem.',
                  style: TextStyle(
                    color: hasText ? wa.bubbleText : wa.textMuted,
                    fontSize: 14.5,
                    height: 1.3,
                    fontStyle: hasText ? FontStyle.normal : FontStyle.italic,
                  ),
                  onTap: onEditText,
                ),
              ),
              for (var index = 0; index < buttons.length; index++) ...[
                Divider(height: 1, color: wa.border.withValues(alpha: 0.55)),
                _ScheduledAdButtonPreview(
                  button: buttons[index],
                  onEdit: () => onEditButton(index),
                  onRemove: () => onRemoveButton(index),
                ),
              ],
              if (onAddButton != null) ...[
                Divider(height: 1, color: wa.border.withValues(alpha: 0.55)),
                SizedBox(
                  height: 42,
                  child: Center(
                    child: IconButton(
                      tooltip: 'Adicionar botão',
                      visualDensity: VisualDensity.compact,
                      onPressed: onAddButton,
                      icon: Icon(
                        Icons.add_circle_outline_rounded,
                        color: wa.accent,
                        size: 21,
                      ),
                    ),
                  ),
                ),
              ],
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 2, 10, 7),
                child: Align(
                  alignment: Alignment.centerRight,
                  child: Text(
                    'agora ✓✓',
                    style: TextStyle(fontSize: 10.5, color: wa.bubbleMeta),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ScheduledAdMediaPreview extends StatelessWidget {
  const _ScheduledAdMediaPreview({
    required this.media,
    required this.localMediaBytes,
    required this.uploading,
    required this.onPick,
    required this.onClear,
  });

  final GroupScheduledAdMedia? media;
  final Uint8List? localMediaBytes;
  final bool uploading;
  final VoidCallback? onPick;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final mediaRef = media?.displayRef ?? '';
    final hasMedia = media != null || localMediaBytes != null;
    final mediaType = media?.mediaType.toLowerCase() ?? '';
    final looksLikeImage =
        mediaType == 'image' ||
        mediaType == 'sticker' ||
        _looksLikeImage(mediaRef) ||
        (localMediaBytes != null &&
            _looksLikeImageBytes(localMediaBytes!, mediaRef));

    Widget content;
    if (!hasMedia) {
      content = AspectRatio(
        aspectRatio: 16 / 9,
        child: ColoredBox(
          color: wa.isDark ? const Color(0xFF1A252B) : const Color(0xFFE9EDEF),
          child: Center(
            child: Icon(Icons.image_outlined, size: 46, color: wa.textMuted),
          ),
        ),
      );
    } else if (localMediaBytes != null && looksLikeImage) {
      content = AspectRatio(
        aspectRatio: 16 / 9,
        child: Image.memory(
          localMediaBytes!,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _mediaFallback(context, mediaType),
        ),
      );
    } else if (mediaRef.isNotEmpty && looksLikeImage) {
      content = AspectRatio(
        aspectRatio: 16 / 9,
        child: Image.network(
          _absoluteUploadUrl(mediaRef),
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _mediaFallback(context, mediaType),
        ),
      );
    } else {
      content = SizedBox(
        height: 132,
        child: _mediaFallback(context, mediaType),
      );
    }

    return Stack(
      children: [
        content,
        Positioned(
          top: 8,
          right: 8,
          child: Row(
            children: [
              _RoundPreviewButton(
                tooltip: hasMedia ? 'Trocar mídia' : 'Enviar mídia',
                icon: Icons.photo_camera_rounded,
                onTap: uploading ? null : onPick,
              ),
              if (onClear != null) ...[
                const SizedBox(width: 6),
                _RoundPreviewButton(
                  tooltip: 'Remover mídia',
                  icon: Icons.delete_outline_rounded,
                  onTap: uploading ? null : onClear,
                ),
              ],
            ],
          ),
        ),
        if (uploading)
          Positioned.fill(
            child: ColoredBox(
              color: Colors.black.withValues(alpha: 0.38),
              child: const Center(child: CircularProgressIndicator()),
            ),
          ),
      ],
    );
  }

  Widget _mediaFallback(BuildContext context, String mediaType) {
    final wa = WaTheme.of(context);
    final (icon, label) = switch (mediaType) {
      'video' => (Icons.play_circle_outline_rounded, 'Vídeo'),
      'audio' => (Icons.graphic_eq_rounded, 'Áudio'),
      'document' => (Icons.description_outlined, 'Documento'),
      'sticker' => (Icons.auto_awesome_motion_rounded, 'Figurinha'),
      _ => (Icons.perm_media_outlined, 'Mídia'),
    };
    return ColoredBox(
      color: wa.isDark ? const Color(0xFF1A252B) : const Color(0xFFE9EDEF),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 38, color: wa.accent),
            const SizedBox(height: 7),
            Text(
              label,
              style: TextStyle(
                color: wa.textSecondary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScheduledAdButtonPreview extends StatelessWidget {
  const _ScheduledAdButtonPreview({
    required this.button,
    required this.onEdit,
    required this.onRemove,
  });

  final GroupReplyButton button;
  final VoidCallback onEdit;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return SizedBox(
      height: 48,
      child: Row(
        children: [
          const SizedBox(width: 8),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(_buttonIcon(button.type), size: 18, color: wa.accent),
                const SizedBox(width: 7),
                Flexible(
                  child: Text(
                    button.label.trim().isEmpty ? 'Botão' : button.label.trim(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.accent,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
          _CompactPreviewIconButton(
            tooltip: 'Editar botão',
            onPressed: onEdit,
            icon: Icons.edit_rounded,
            color: wa.accent,
          ),
          _CompactPreviewIconButton(
            tooltip: 'Remover botão',
            onPressed: onRemove,
            icon: Icons.delete_outline_rounded,
            color: wa.icon,
          ),
          const SizedBox(width: 4),
        ],
      ),
    );
  }
}

class _ScheduledAdScheduleForm extends StatelessWidget {
  const _ScheduledAdScheduleForm({
    required this.enabled,
    required this.mentionAll,
    required this.scheduleType,
    required this.frequency,
    required this.times,
    required this.onEnabledChanged,
    required this.onMentionAllChanged,
    required this.onScheduleTypeChanged,
  });

  final bool enabled;
  final bool mentionAll;
  final String scheduleType;
  final TextEditingController frequency;
  final TextEditingController times;
  final ValueChanged<bool> onEnabledChanged;
  final ValueChanged<bool> onMentionAllChanged;
  final ValueChanged<String> onScheduleTypeChanged;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Envio',
          style: TextStyle(
            color: wa.textPrimary,
            fontSize: 17,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 8),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          title: const Text('Programação ativa'),
          value: enabled,
          onChanged: onEnabledChanged,
          activeTrackColor: wa.accent,
        ),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          title: const Text('Mencionar todos'),
          subtitle: const Text('Menção invisível quando disponível.'),
          value: mentionAll,
          onChanged: onMentionAllChanged,
          activeTrackColor: wa.accent,
        ),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(
              value: 'frequency',
              icon: Icon(Icons.repeat_rounded),
              label: Text('Intervalo'),
            ),
            ButtonSegment(
              value: 'times',
              icon: Icon(Icons.schedule_rounded),
              label: Text('Horários'),
            ),
          ],
          selected: {scheduleType},
          onSelectionChanged: (value) => onScheduleTypeChanged(value.first),
        ),
        const SizedBox(height: 14),
        if (scheduleType == 'frequency')
          TextField(
            controller: frequency,
            decoration: const InputDecoration(
              labelText: 'Frequência',
              hintText: 'Ex.: 30m, 2h ou 1d',
              border: OutlineInputBorder(),
            ),
          )
        else
          TextField(
            controller: times,
            keyboardType: TextInputType.datetime,
            decoration: const InputDecoration(
              labelText: 'Horários',
              hintText: '08:00, 12:30, 19:00',
              border: OutlineInputBorder(),
            ),
          ),
      ],
    );
  }
}

String _scheduledAdMediaType(String fileName, String mimeType) {
  final mime = mimeType.toLowerCase();
  final name = fileName.toLowerCase();
  if (mime.contains('webp') && name.endsWith('.webp')) return 'sticker';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

String _scheduledAdButtonFamily(String type) {
  return type == 'quick_reply' ? 'reply' : 'action';
}

class _MessageConfigDialog extends ConsumerStatefulWidget {
  const _MessageConfigDialog({
    required this.title,
    required this.kind,
    required this.group,
    required this.config,
    required this.defaultCaption,
    required this.allowButtons,
  });

  final String title;
  final _MessageMediaKind kind;
  final BotGroup group;
  final GroupMessageConfig config;
  final String defaultCaption;
  final bool allowButtons;

  @override
  ConsumerState<_MessageConfigDialog> createState() =>
      _MessageConfigDialogState();
}

class _MessageConfigDialogState extends ConsumerState<_MessageConfigDialog> {
  late final TextEditingController _caption;
  late bool _enabled;
  late bool _profilePhoto;
  late bool _asSticker;
  late List<GroupReplyButton> _buttons;
  String? _mediaUrl;
  String? _mediaPath;
  Uint8List? _localPreviewBytes;
  bool _clearMedia = false;
  bool _uploadingMedia = false;

  @override
  void initState() {
    super.initState();
    _caption = TextEditingController(text: widget.defaultCaption);
    _enabled = widget.config.enabled;
    _profilePhoto = widget.config.useParticipantProfilePhoto;
    _asSticker = widget.config.asSticker;
    _mediaUrl = widget.config.mediaUrl;
    _mediaPath = widget.config.mediaPath;
    final replyButtons = widget.config.replyButtons;
    final buttonsEnabled =
        widget.allowButtons && (replyButtons?.hasButtons ?? false);
    _buttons = replyButtons?.buttons.map((button) => button).toList() ?? [];
    if (widget.allowButtons && buttonsEnabled && _buttons.isEmpty) {
      _buttons = [GroupReplyButton.newDraft(0)];
    }
  }

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  String get _previewMediaRef {
    if (_clearMedia && _localPreviewBytes == null) return '';
    final url = (_mediaUrl ?? '').trim();
    if (url.isNotEmpty) return url;
    final path = (_mediaPath ?? '').trim();
    if (path.isNotEmpty) return path;
    return '';
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
      child: SingleChildScrollView(
        child: _PhonePreview(
          title: widget.title,
          group: widget.group,
          caption: _caption.text,
          mediaUrl: _previewMediaRef,
          localMediaBytes: _localPreviewBytes,
          mediaUploading: _uploadingMedia,
          profilePhoto: _profilePhoto,
          asSticker: _asSticker,
          allowButtons: widget.allowButtons,
          buttons: _buttons,
          onClose: () => Navigator.of(context).pop(),
          onSave: _uploadingMedia ? null : _saveAndClose,
          onToggleProfilePhoto: () =>
              setState(() => _profilePhoto = !_profilePhoto),
          onToggleSticker: () => setState(() => _asSticker = !_asSticker),
          onEditCaption: _editCaption,
          onEditMedia: _uploadingMedia ? null : _pickAndUploadMedia,
          onClearMedia: _uploadingMedia
              ? null
              : () => setState(() {
                  _profilePhoto = false;
                  _mediaUrl = null;
                  _mediaPath = null;
                  _localPreviewBytes = null;
                  _clearMedia = true;
                }),
          onAddButton: widget.allowButtons ? _addButton : null,
          onEditButton: widget.allowButtons ? _editButton : null,
          onRemoveButton: widget.allowButtons
              ? (index) => setState(() => _buttons.removeAt(index))
              : null,
        ),
      ),
    );
  }

  void _saveAndClose() {
    Navigator.of(context).pop(
      _MessageConfigDraft(
        enabled: _enabled,
        caption: _caption.text,
        mediaUrl: _mediaUrl ?? '',
        mediaPath: _mediaPath,
        clearMedia:
            _clearMedia &&
            (_mediaUrl == null || _mediaUrl!.trim().isEmpty) &&
            (_mediaPath == null || _mediaPath!.trim().isEmpty) &&
            _localPreviewBytes == null,
        useParticipantProfilePhoto: _profilePhoto,
        asSticker: _asSticker,
        replyButtons: _buildReplyButtonsConfig(),
      ),
    );
  }

  Future<void> _editCaption() async {
    final value = await _showTextEditor(
      title: 'Editar texto',
      label: 'Legenda',
      value: _caption.text,
      minLines: 8,
      maxLines: 12,
    );
    if (value == null) return;
    setState(() => _caption.text = value);
  }

  Future<void> _pickAndUploadMedia() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagens e midias',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'mov',
            'webm',
            'mp3',
            'ogg',
            'opus',
            'pdf',
          ],
        ),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) {
      if (!mounted) return;
      showErrorToast(context, 'Arquivo vazio. Escolha outra midia.');
      return;
    }

    final mimeType = file.mimeType ?? _guessUploadMimeType(file.name);
    setState(() {
      _profilePhoto = false;
      _localPreviewBytes = bytes;
      _uploadingMedia = true;
      _clearMedia = false;
    });

    try {
      final api = ref.read(apiClientProvider);
      final settings = widget.kind == _MessageMediaKind.welcome
          ? await api.uploadWelcomeMedia(
              widget.group.id,
              bytes: bytes,
              fileName: file.name,
              mimeType: mimeType,
            )
          : await api.uploadFarewellMedia(
              widget.group.id,
              bytes: bytes,
              fileName: file.name,
              mimeType: mimeType,
            );
      final config = widget.kind == _MessageMediaKind.welcome
          ? settings.welcomeConfig
          : settings.farewellConfig;
      if (!mounted) return;
      setState(() {
        _mediaPath = config.mediaPath;
        _mediaUrl = config.mediaUrl;
        _clearMedia = false;
        _uploadingMedia = false;
      });
      ref.invalidate(groupSettingsProvider(widget.group.id));
      showSuccessToast(
        context,
        widget.kind == _MessageMediaKind.welcome
            ? 'Midia de boas-vindas enviada.'
            : 'Midia de saida enviada.',
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _uploadingMedia = false;
        // Mantém preview local se o upload falhar, mas sem path persistido.
      });
      showErrorToast(context, error.toString());
    }
  }

  void _addButton() {
    if (_buttons.length >= 3) return;
    setState(() => _buttons.add(GroupReplyButton.newDraft(_buttons.length)));
  }

  Future<void> _editButton(int index) async {
    if (index < 0 || index >= _buttons.length) return;
    final edited = await showDialog<GroupReplyButton>(
      context: context,
      builder: (context) => _ButtonEditDialog(button: _buttons[index]),
    );
    if (edited == null) return;
    setState(() => _buttons[index] = edited);
  }

  Future<String?> _showTextEditor({
    required String title,
    required String label,
    required String value,
    required int minLines,
    required int maxLines,
  }) async {
    final controller = TextEditingController(text: value);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: 560,
          child: TextField(
            controller: controller,
            autofocus: true,
            minLines: minLines,
            maxLines: maxLines,
            decoration: InputDecoration(labelText: label),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Aplicar'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  GroupReplyButtonsConfig? _buildReplyButtonsConfig() {
    if (!widget.allowButtons) return null;
    final valid = _buttons
        .map(
          (button) => button.copyWith(
            label: button.label.trim(),
            command: _nullableText(button.command ?? ''),
            args: _nullableText(button.args ?? ''),
            url: _nullableText(button.url ?? ''),
            phoneNumber: _nullableText(button.phoneNumber ?? ''),
            copyCode: _nullableText(button.copyCode ?? ''),
          ),
        )
        .where(_isValidButton)
        .take(3)
        .toList();
    if (valid.isEmpty) return null;
    return GroupReplyButtonsConfig(
      enabled: true,
      position: 'before_attachments',
      body: '',
      footer: null,
      buttons: valid,
    );
  }

  bool _isValidButton(GroupReplyButton button) {
    if (button.label.trim().isEmpty) return false;
    switch (button.type) {
      case 'cta_url':
        return (button.url ?? '').trim().isNotEmpty;
      case 'cta_call':
        return (button.phoneNumber ?? '').trim().isNotEmpty;
      case 'cta_copy':
        return (button.copyCode ?? '').trim().isNotEmpty;
      default:
        return (button.command ?? '').trim().isNotEmpty;
    }
  }
}

class _PhonePreview extends StatelessWidget {
  const _PhonePreview({
    required this.title,
    required this.group,
    required this.caption,
    required this.mediaUrl,
    this.localMediaBytes,
    this.mediaUploading = false,
    required this.profilePhoto,
    required this.asSticker,
    required this.allowButtons,
    required this.buttons,
    required this.onClose,
    required this.onSave,
    required this.onToggleProfilePhoto,
    required this.onToggleSticker,
    required this.onEditCaption,
    required this.onEditMedia,
    required this.onClearMedia,
    required this.onAddButton,
    required this.onEditButton,
    required this.onRemoveButton,
  });

  final String title;
  final BotGroup group;
  final String caption;
  final String mediaUrl;
  final Uint8List? localMediaBytes;
  final bool mediaUploading;
  final bool profilePhoto;
  final bool asSticker;
  final bool allowButtons;
  final List<GroupReplyButton> buttons;
  final VoidCallback onClose;
  final VoidCallback? onSave;
  final VoidCallback onToggleProfilePhoto;
  final VoidCallback onToggleSticker;
  final VoidCallback onEditCaption;
  final VoidCallback? onEditMedia;
  final VoidCallback? onClearMedia;
  final VoidCallback? onAddButton;
  final void Function(int index)? onEditButton;
  final void Function(int index)? onRemoveButton;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final text = caption.trim().isEmpty
        ? 'Ola {{pushName}}, seja bem-vindo ao {{nomeGrupo}}!'
        : caption.trim();
    final maxHeight = MediaQuery.sizeOf(context).height - 32;
    final phoneHeight = maxHeight.clamp(640.0, 820.0);
    // Bolha / superfícies no estilo WhatsApp (dark e clean)
    final bubbleBg = wa.bubbleIn;
    final bubbleSoft = wa.isDark
        ? const Color(0xFF1A252B)
        : const Color(0xFFF5F6F6);
    final statusFg = wa.textPrimary;
    final headerBg = wa.isDark
        ? const Color(0xFF1F2C33)
        : const Color(0xFF008069);
    final headerFg = wa.isDark ? wa.textPrimary : Colors.white;
    final headerIcon = wa.isDark ? wa.icon : Colors.white;

    return Container(
      width: 390,
      height: phoneHeight,
      decoration: BoxDecoration(
        color: wa.panel,
        border: Border.all(
          color: wa.isDark ? wa.border : const Color(0xFF111827),
          width: 4,
        ),
        borderRadius: BorderRadius.circular(28),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          ColoredBox(
            color: wa.panel,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 8),
              child: Row(
                children: [
                  Text(
                    '11:14',
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      color: statusFg,
                    ),
                  ),
                  const Spacer(),
                  Icon(Icons.network_cell_rounded, size: 14, color: statusFg),
                  const SizedBox(width: 4),
                  Text(
                    '4G',
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      color: statusFg,
                    ),
                  ),
                ],
              ),
            ),
          ),
          Container(
            color: headerBg,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                IconButton(
                  onPressed: onClose,
                  icon: Icon(Icons.chevron_left_rounded, color: headerIcon),
                  tooltip: 'Fechar',
                  visualDensity: VisualDensity.compact,
                ),
                CircleAvatar(
                  radius: 19,
                  backgroundColor: wa.isDark
                      ? wa.avatarFallback
                      : Colors.white24,
                  child: Text(
                    _initial(group.name),
                    style: TextStyle(
                      color: headerFg,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    group.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      color: headerFg,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: onSave,
                  icon: const Icon(Icons.check_rounded),
                  tooltip: 'Salvar',
                  visualDensity: VisualDensity.compact,
                  style: IconButton.styleFrom(
                    backgroundColor: wa.isDark ? wa.accent : Colors.white,
                    foregroundColor: wa.isDark
                        ? Colors.white
                        : const Color(0xFF008069),
                  ),
                ),
              ],
            ),
          ),
          ColoredBox(
            color: wa.panel,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
              child: Row(
                children: [
                  _MiniSwitchControl(
                    label: 'Foto do perfil',
                    icon: Icons.account_circle_rounded,
                    active: profilePhoto,
                    onChanged: onToggleProfilePhoto,
                  ),
                  const SizedBox(width: 6),
                  _MiniSwitchControl(
                    label: 'Sticker',
                    icon: Icons.auto_awesome_motion_rounded,
                    active: asSticker,
                    onChanged: onToggleSticker,
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: ColoredBox(
              color: wa.chatWallpaper,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: SingleChildScrollView(
                  child: Align(
                    alignment: Alignment.topLeft,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: bubbleBg,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: wa.border.withValues(alpha: 0.55),
                        ),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'BotAdmin',
                              style: TextStyle(
                                color: wa.accent,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Stack(
                              children: [
                                GestureDetector(
                                  onTap: onEditMedia,
                                  child: _PreviewMediaBlock(
                                    mediaUrl: mediaUrl,
                                    localBytes: localMediaBytes,
                                    uploading: mediaUploading,
                                    profilePhoto: profilePhoto,
                                    asSticker: asSticker,
                                  ),
                                ),
                                Positioned(
                                  right: 8,
                                  top: 8,
                                  child: Row(
                                    children: [
                                      _BubbleIconButton(
                                        icon: Icons.add_a_photo_rounded,
                                        tooltip: 'Enviar midia',
                                        onTap: onEditMedia ?? () {},
                                      ),
                                      const SizedBox(width: 6),
                                      _BubbleIconButton(
                                        icon: Icons.delete_outline_rounded,
                                        tooltip: 'Remover midia',
                                        onTap: onClearMedia ?? () {},
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            DecoratedBox(
                              decoration: BoxDecoration(
                                color: bubbleSoft,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: wa.border.withValues(alpha: 0.45),
                                ),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(8),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        text,
                                        style: TextStyle(
                                          color: wa.bubbleText,
                                          height: 1.35,
                                        ),
                                      ),
                                    ),
                                    _BubbleIconButton(
                                      icon: Icons.edit_rounded,
                                      tooltip: 'Editar texto',
                                      onTap: onEditCaption,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            if (allowButtons) ...[
                              const SizedBox(height: 10),
                              if (buttons.isNotEmpty)
                                for (
                                  var index = 0;
                                  index < buttons.take(3).length;
                                  index++
                                )
                                  _PreviewButtonRow(
                                    button: buttons[index],
                                    onEdit: () => onEditButton?.call(index),
                                    onRemove: () => onRemoveButton?.call(index),
                                  )
                              else
                                _AddButtonTile(
                                  label: 'Adicionar botoes interativos',
                                  onTap: onAddButton ?? () {},
                                ),
                              if (buttons.isNotEmpty && buttons.length < 3)
                                _AddButtonTile(
                                  label: 'Adicionar outro botao',
                                  onTap: onAddButton ?? () {},
                                ),
                            ],
                            Align(
                              alignment: Alignment.centerRight,
                              child: Text(
                                '11:14',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: wa.bubbleMeta,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
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

class _MiniSwitchControl extends StatelessWidget {
  const _MiniSwitchControl({
    required this.label,
    required this.icon,
    required this.active,
    required this.onChanged,
  });

  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final scheme = Theme.of(context).colorScheme;
    final bg = active
        ? (wa.isDark ? wa.accentSoft : scheme.primaryContainer)
        : wa.searchBg;
    final border = active ? wa.accent : wa.border;
    final fg = active ? wa.accent : wa.icon;
    return Expanded(
      child: InkWell(
        onTap: onChanged,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          height: 42,
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: border),
          ),
          padding: const EdgeInsets.only(left: 9, right: 4),
          child: Row(
            children: [
              Icon(icon, size: 16, color: fg),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: active ? wa.accent : wa.textSecondary,
                  ),
                ),
              ),
              SizedBox(
                width: 42,
                height: 26,
                child: FittedBox(
                  fit: BoxFit.contain,
                  child: Switch(
                    value: active,
                    onChanged: (_) => onChanged(),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    activeThumbColor: Colors.white,
                    activeTrackColor: wa.accent,
                    inactiveThumbColor: wa.isDark
                        ? const Color(0xFFAEBAC1)
                        : Colors.white,
                    inactiveTrackColor: wa.isDark
                        ? const Color(0xFF2A3942)
                        : const Color(0xFFCBD5DF),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BubbleIconButton extends StatelessWidget {
  const _BubbleIconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: wa.isDark
                ? const Color(0xFF2A3942)
                : Colors.white.withAlpha(235),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: wa.border.withValues(alpha: 0.6)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: wa.isDark ? 0.35 : 0.12),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Icon(icon, size: 16, color: wa.accent),
        ),
      ),
    );
  }
}

class _PreviewButtonRow extends StatelessWidget {
  const _PreviewButtonRow({
    required this.button,
    required this.onEdit,
    required this.onRemove,
  });

  final GroupReplyButton button;
  final VoidCallback onEdit;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.fromLTRB(8, 6, 5, 6),
      decoration: BoxDecoration(
        color: wa.isDark ? const Color(0xFF1A252B) : Colors.transparent,
        border: Border.all(color: wa.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(_buttonIcon(button.type), size: 16, color: wa.accent),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              button.label.trim().isEmpty ? 'Botao' : button.label.trim(),
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: wa.accent, fontWeight: FontWeight.w800),
            ),
          ),
          _CompactPreviewIconButton(
            tooltip: 'Editar botão',
            icon: Icons.edit_rounded,
            color: wa.icon,
            onPressed: onEdit,
          ),
          _CompactPreviewIconButton(
            tooltip: 'Remover botão',
            icon: Icons.delete_outline_rounded,
            color: wa.icon,
            onPressed: onRemove,
          ),
        ],
      ),
    );
  }
}

class _AddButtonTile extends StatelessWidget {
  const _AddButtonTile({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(top: 7),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          color: wa.accentSoft,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: wa.accent.withValues(alpha: 0.45)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_rounded, size: 17, color: wa.accent),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(color: wa.accent, fontWeight: FontWeight.w900),
            ),
          ],
        ),
      ),
    );
  }
}

class _PreviewMediaBlock extends StatelessWidget {
  const _PreviewMediaBlock({
    required this.mediaUrl,
    this.localBytes,
    this.uploading = false,
    required this.profilePhoto,
    required this.asSticker,
  });

  final String mediaUrl;
  final Uint8List? localBytes;
  final bool uploading;
  final bool profilePhoto;
  final bool asSticker;

  @override
  Widget build(BuildContext context) {
    if (profilePhoto) {
      return _mediaShell(
        context,
        icon: asSticker
            ? Icons.auto_awesome_motion_rounded
            : Icons.account_circle_rounded,
        label: asSticker
            ? 'Foto do participante como sticker'
            : 'Foto do participante',
      );
    }

    Widget content;
    final bytes = localBytes;
    if (bytes != null &&
        bytes.isNotEmpty &&
        _looksLikeImageBytes(bytes, mediaUrl)) {
      content = ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.memory(
          bytes,
          height: 150,
          width: double.infinity,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => _mediaShell(
            context,
            icon: Icons.broken_image_rounded,
            label: 'Midia selecionada',
          ),
        ),
      );
    } else if (bytes != null && bytes.isNotEmpty) {
      content = _mediaShell(
        context,
        icon: asSticker ? Icons.auto_awesome_motion_rounded : Icons.perm_media,
        label: asSticker ? 'Sticker selecionado' : 'Arquivo selecionado',
      );
    } else if (mediaUrl.trim().isEmpty) {
      content = _mediaShell(
        context,
        icon: Icons.add_a_photo_rounded,
        label: 'Toque para enviar midia',
      );
    } else {
      final absolute = _absoluteUploadUrl(mediaUrl);
      if (_looksLikeImage(mediaUrl) || _looksLikeImage(absolute)) {
        content = ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.network(
            absolute,
            height: 150,
            width: double.infinity,
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) => _mediaShell(
              context,
              icon: Icons.broken_image_rounded,
              label: 'Midia configurada',
            ),
          ),
        );
      } else {
        content = _mediaShell(
          context,
          icon: asSticker
              ? Icons.auto_awesome_motion_rounded
              : Icons.perm_media,
          label: asSticker ? 'Sticker configurado' : 'Midia configurada',
        );
      }
    }

    if (!uploading) return content;
    return Stack(
      alignment: Alignment.center,
      children: [
        content,
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(
              child: SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(
                  strokeWidth: 2.6,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _mediaShell(
    BuildContext context, {
    required IconData icon,
    required String label,
  }) {
    final wa = WaTheme.of(context);
    return Container(
      height: 128,
      width: double.infinity,
      decoration: BoxDecoration(
        color: wa.isDark ? const Color(0xFF1A252B) : const Color(0xFFEFF4F6),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: wa.border),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: wa.accent),
          const SizedBox(height: 8),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: wa.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _ButtonEditDialog extends StatefulWidget {
  const _ButtonEditDialog({required this.button});

  final GroupReplyButton button;

  @override
  State<_ButtonEditDialog> createState() => _ButtonEditDialogState();
}

class _ButtonEditDialogState extends State<_ButtonEditDialog> {
  late final TextEditingController _label;
  late final TextEditingController _command;
  late final TextEditingController _args;
  late final TextEditingController _url;
  late final TextEditingController _phone;
  late final TextEditingController _copyCode;
  late String _type;

  @override
  void initState() {
    super.initState();
    _label = TextEditingController(text: widget.button.label);
    _command = TextEditingController(text: widget.button.command ?? '');
    _args = TextEditingController(text: widget.button.args ?? '');
    _url = TextEditingController(text: widget.button.url ?? '');
    _phone = TextEditingController(text: widget.button.phoneNumber ?? '');
    _copyCode = TextEditingController(text: widget.button.copyCode ?? '');
    _type = _validButtonType(widget.button.type);
  }

  @override
  void dispose() {
    _label.dispose();
    _command.dispose();
    _args.dispose();
    _url.dispose();
    _phone.dispose();
    _copyCode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Editar botao'),
      content: SizedBox(
        width: 520,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _label,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Titulo do botao'),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: const InputDecoration(labelText: 'Tipo'),
              items: const [
                DropdownMenuItem(
                  value: 'quick_reply',
                  child: Text('Resposta rapida'),
                ),
                DropdownMenuItem(value: 'cta_url', child: Text('Abrir link')),
                DropdownMenuItem(value: 'cta_call', child: Text('Ligar')),
                DropdownMenuItem(
                  value: 'cta_copy',
                  child: Text('Copiar codigo'),
                ),
              ],
              onChanged: (value) =>
                  setState(() => _type = value ?? 'quick_reply'),
            ),
            const SizedBox(height: 8),
            if (_type == 'cta_url')
              TextField(
                controller: _url,
                decoration: const InputDecoration(labelText: 'Link'),
              )
            else if (_type == 'cta_call')
              TextField(
                controller: _phone,
                decoration: const InputDecoration(labelText: 'Telefone'),
              )
            else if (_type == 'cta_copy')
              TextField(
                controller: _copyCode,
                decoration: const InputDecoration(labelText: 'Codigo'),
              )
            else
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _command,
                      decoration: const InputDecoration(labelText: 'Comando'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _args,
                      decoration: const InputDecoration(
                        labelText: 'Argumentos',
                      ),
                    ),
                  ),
                ],
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
            widget.button.copyWith(
              label: _label.text,
              type: _type,
              command: _command.text,
              args: _args.text,
              url: _url.text,
              phoneNumber: _phone.text,
              copyCode: _copyCode.text,
            ),
          ),
          child: const Text('Aplicar'),
        ),
      ],
    );
  }
}

class _MessageConfigPanel extends StatefulWidget {
  const _MessageConfigPanel({
    required this.title,
    required this.description,
    required this.config,
    required this.captionController,
    required this.mediaUrlController,
    required this.saving,
    required this.onSave,
  });

  final String title;
  final String description;
  final GroupMessageConfig config;
  final TextEditingController captionController;
  final TextEditingController mediaUrlController;
  final bool saving;
  final ValueChanged<_MessageConfigDraft> onSave;

  @override
  State<_MessageConfigPanel> createState() => _MessageConfigPanelState();
}

class _MessageConfigPanelState extends State<_MessageConfigPanel> {
  late bool _enabled = widget.config.enabled;
  late bool _profilePhoto = widget.config.useParticipantProfilePhoto;
  late bool _asSticker = widget.config.asSticker;

  @override
  void didUpdateWidget(covariant _MessageConfigPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.config != widget.config) {
      _enabled = widget.config.enabled;
      _profilePhoto = widget.config.useParticipantProfilePhoto;
      _asSticker = widget.config.asSticker;
    }
  }

  @override
  Widget build(BuildContext context) {
    return _Panel(
      title: widget.title,
      subtitle: widget.description,
      child: Column(
        children: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${widget.title} ativa'),
            subtitle: const Text('Liga ou desliga o disparo automatico.'),
            value: _enabled,
            onChanged: widget.saving
                ? null
                : (value) => setState(() => _enabled = value),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Enviar foto de perfil da pessoa'),
            subtitle: const Text(
              'Usa a foto do participante em alta qualidade quando disponivel.',
            ),
            value: _profilePhoto,
            onChanged: widget.saving
                ? null
                : (value) => setState(() => _profilePhoto = value),
          ),
          TextField(
            controller: widget.mediaUrlController,
            enabled: !widget.saving && !_profilePhoto,
            decoration: const InputDecoration(
              labelText: 'Midia personalizada por URL ou caminho',
              prefixIcon: Icon(Icons.perm_media_rounded),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: widget.captionController,
            enabled: !widget.saving,
            minLines: 4,
            maxLines: 10,
            decoration: const InputDecoration(
              labelText: 'Legenda',
              alignLabelWithHint: true,
              prefixIcon: Icon(Icons.notes_rounded),
            ),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Enviar como sticker'),
            value: _asSticker,
            onChanged: widget.saving
                ? null
                : (value) => setState(() => _asSticker = value),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: widget.saving
                  ? null
                  : () => widget.onSave(
                      _MessageConfigDraft(
                        enabled: _enabled,
                        caption: widget.captionController.text,
                        mediaUrl: widget.mediaUrlController.text,
                        mediaPath: widget.config.mediaPath,
                        clearMedia:
                            widget.mediaUrlController.text.trim().isEmpty &&
                            (widget.config.mediaPath ?? '').trim().isEmpty,
                        useParticipantProfilePhoto: _profilePhoto,
                        asSticker: _asSticker,
                        replyButtons: widget.config.replyButtons,
                      ),
                    ),
              icon: widget.saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_rounded),
              label: const Text('Salvar'),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageConfigDraft {
  const _MessageConfigDraft({
    required this.enabled,
    required this.caption,
    required this.mediaUrl,
    required this.mediaPath,
    required this.clearMedia,
    required this.useParticipantProfilePhoto,
    required this.asSticker,
    required this.replyButtons,
  });

  final bool enabled;
  final String caption;
  final String mediaUrl;
  final String? mediaPath;
  final bool clearMedia;
  final bool useParticipantProfilePhoto;
  final bool asSticker;
  final GroupReplyButtonsConfig? replyButtons;

  /// Referência para exibir no seed local (URL ou path).
  String get displayMediaRef {
    if (clearMedia) return '';
    final url = mediaUrl.trim();
    if (url.isNotEmpty) return url;
    return (mediaPath ?? '').trim();
  }
}

class _ScheduleConfigDraft {
  const _ScheduleConfigDraft({
    required this.closeEnabled,
    required this.openEnabled,
    required this.closeTimes,
    required this.openTimes,
    required this.closeMessage,
    required this.openMessage,
    required this.timezone,
  });

  final bool closeEnabled;
  final bool openEnabled;
  final String closeTimes;
  final String openTimes;
  final String closeMessage;
  final String openMessage;
  final String timezone;
}

class _ScheduleConfigDialog extends StatefulWidget {
  const _ScheduleConfigDialog({required this.config});

  final GroupScheduleConfig config;

  @override
  State<_ScheduleConfigDialog> createState() => _ScheduleConfigDialogState();
}

class _ScheduleConfigDialogState extends State<_ScheduleConfigDialog> {
  late bool _closeEnabled;
  late bool _openEnabled;
  late final TextEditingController _closeTimes;
  late final TextEditingController _openTimes;
  late final TextEditingController _closeMessage;
  late final TextEditingController _openMessage;
  late final TextEditingController _timezone;

  @override
  void initState() {
    super.initState();
    final config = widget.config;
    _closeEnabled = config.closeEnabled;
    _openEnabled = config.openEnabled;
    _closeTimes = TextEditingController(
      text: config.closeTimes.isEmpty ? '00:00' : config.closeTimes.join('\n'),
    );
    _openTimes = TextEditingController(
      text: config.openTimes.isEmpty ? '07:00' : config.openTimes.join('\n'),
    );
    _closeMessage = TextEditingController(
      text:
          config.closeMessage ??
          'Grupo fechado automaticamente conforme programacao.',
    );
    _openMessage = TextEditingController(
      text:
          config.openMessage ??
          'Grupo aberto automaticamente conforme programacao.',
    );
    _timezone = TextEditingController(
      text: config.timezone ?? 'America/Sao_Paulo',
    );
  }

  @override
  void dispose() {
    _closeTimes.dispose();
    _openTimes.dispose();
    _closeMessage.dispose();
    _openMessage.dispose();
    _timezone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final mobile = size.width < 680;
    return AlertDialog(
      title: const Text('Abrir e fechar grupo'),
      insetPadding: EdgeInsets.symmetric(
        horizontal: mobile ? 10 : 40,
        vertical: mobile ? 14 : 24,
      ),
      content: SizedBox(
        width: mobile ? (size.width - 20).clamp(300.0, 620.0).toDouble() : 720,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Fechar automaticamente'),
                subtitle: const Text('Fecha o grupo nos horarios definidos.'),
                value: _closeEnabled,
                onChanged: (value) => setState(() => _closeEnabled = value),
              ),
              TextField(
                controller: _closeTimes,
                enabled: _closeEnabled,
                minLines: 2,
                maxLines: 5,
                decoration: const InputDecoration(
                  labelText: 'Horários para fechar',
                  helperText: 'Um horário por linha, exemplo: 00:00',
                  prefixIcon: Icon(Icons.lock_outline_rounded),
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _closeMessage,
                enabled: _closeEnabled,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Mensagem ao fechar',
                  prefixIcon: Icon(Icons.chat_bubble_outline_rounded),
                  alignLabelWithHint: true,
                ),
              ),
              const Divider(height: 28),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Abrir automaticamente'),
                subtitle: const Text('Abre o grupo nos horários definidos.'),
                value: _openEnabled,
                onChanged: (value) => setState(() => _openEnabled = value),
              ),
              TextField(
                controller: _openTimes,
                enabled: _openEnabled,
                minLines: 2,
                maxLines: 5,
                decoration: const InputDecoration(
                  labelText: 'Horários para abrir',
                  helperText: 'Um horário por linha, exemplo: 07:00',
                  prefixIcon: Icon(Icons.lock_open_rounded),
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _openMessage,
                enabled: _openEnabled,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Mensagem ao abrir',
                  prefixIcon: Icon(Icons.mark_chat_read_outlined),
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _timezone,
                decoration: const InputDecoration(
                  labelText: 'Timezone',
                  helperText: 'Padrao: America/Sao_Paulo',
                  prefixIcon: Icon(Icons.public_rounded),
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
          onPressed: () => Navigator.of(context).pop(
            _ScheduleConfigDraft(
              closeEnabled: _closeEnabled,
              openEnabled: _openEnabled,
              closeTimes: _closeTimes.text,
              openTimes: _openTimes.text,
              closeMessage: _closeMessage.text,
              openMessage: _openMessage.text,
              timezone: _timezone.text,
            ),
          ),
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _HorapgConfigDraft {
  const _HorapgConfigDraft({
    required this.enabled,
    required this.times,
    required this.imageUrl,
    required this.imagePath,
    required this.mentionAll,
    required this.timezone,
  });

  final bool enabled;
  final String times;
  final String imageUrl;
  final String imagePath;
  final bool mentionAll;
  final String timezone;
}

class _HorapgConfigDialog extends StatefulWidget {
  const _HorapgConfigDialog({required this.config});

  final GroupHorapgConfig config;

  @override
  State<_HorapgConfigDialog> createState() => _HorapgConfigDialogState();
}

class _HorapgConfigDialogState extends State<_HorapgConfigDialog> {
  late bool _enabled;
  late bool _mentionAll;
  late final TextEditingController _times;
  late final TextEditingController _imageUrl;
  late final TextEditingController _imagePath;
  late final TextEditingController _timezone;

  @override
  void initState() {
    super.initState();
    final config = widget.config;
    _enabled = config.enabled;
    _mentionAll = config.mentionAll;
    _times = TextEditingController(
      text: config.times.isEmpty ? '08:00' : config.times.join('\n'),
    );
    _imageUrl = TextEditingController(text: config.imageUrl ?? '');
    _imagePath = TextEditingController(text: config.imagePath ?? '');
    _timezone = TextEditingController(
      text: config.timezone ?? 'America/Sao_Paulo',
    );
  }

  @override
  void dispose() {
    _times.dispose();
    _imageUrl.dispose();
    _imagePath.dispose();
    _timezone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final mobile = size.width < 680;
    return AlertDialog(
      title: const Text('Configurar HoraPG'),
      insetPadding: EdgeInsets.symmetric(
        horizontal: mobile ? 10 : 40,
        vertical: mobile ? 14 : 24,
      ),
      content: SizedBox(
        width: mobile ? (size.width - 20).clamp(300.0, 620.0).toDouble() : 680,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('HoraPG ligado'),
                subtitle: const Text('Envia a arte nos horarios definidos.'),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              TextField(
                controller: _times,
                enabled: _enabled,
                minLines: 3,
                maxLines: 7,
                decoration: const InputDecoration(
                  labelText: 'Horarios de envio',
                  helperText: 'Um horario por linha.',
                  prefixIcon: Icon(Icons.schedule_send_rounded),
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _imageUrl,
                enabled: _enabled,
                decoration: const InputDecoration(
                  labelText: 'Imagem por URL',
                  prefixIcon: Icon(Icons.image_outlined),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _imagePath,
                enabled: _enabled,
                decoration: const InputDecoration(
                  labelText: 'Caminho de imagem salva',
                  prefixIcon: Icon(Icons.folder_open_rounded),
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Mencionar todos'),
                subtitle: const Text('Usa mencao invisivel quando suportado.'),
                value: _mentionAll,
                onChanged: _enabled
                    ? (value) => setState(() => _mentionAll = value)
                    : null,
              ),
              TextField(
                controller: _timezone,
                enabled: _enabled,
                decoration: const InputDecoration(
                  labelText: 'Timezone',
                  helperText: 'Padrao: America/Sao_Paulo',
                  prefixIcon: Icon(Icons.public_rounded),
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
          onPressed: () => Navigator.of(context).pop(
            _HorapgConfigDraft(
              enabled: _enabled,
              times: _times.text,
              imageUrl: _imageUrl.text,
              imagePath: _imagePath.text,
              mentionAll: _mentionAll,
              timezone: _timezone.text,
            ),
          ),
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _AutoResponsesConfigDialog extends StatefulWidget {
  const _AutoResponsesConfigDialog({required this.items});

  final List<GroupAutoResponseConfig> items;

  @override
  State<_AutoResponsesConfigDialog> createState() =>
      _AutoResponsesConfigDialogState();
}

class _AutoResponsesConfigDialogState
    extends State<_AutoResponsesConfigDialog> {
  late List<GroupAutoResponseConfig> _items;

  @override
  void initState() {
    super.initState();
    _items = widget.items.map((entry) => entry).toList();
  }

  Future<void> _editItem([GroupAutoResponseConfig? item]) async {
    final draft = await showDialog<GroupAutoResponseConfig>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _AutoResponseEditDialog(
        item: item ?? GroupAutoResponseConfig.newDraft(),
      ),
    );
    if (draft == null) return;
    setState(() {
      final index = _items.indexWhere((entry) => entry.id == draft.id);
      if (index >= 0) {
        _items[index] = draft;
      } else {
        _items.add(draft);
      }
    });
  }

  void _removeItem(GroupAutoResponseConfig item) {
    setState(() => _items.removeWhere((entry) => entry.id == item.id));
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final mobile = size.width < 720;
    return AlertDialog(
      title: const Text('Auto respostas'),
      insetPadding: EdgeInsets.symmetric(
        horizontal: mobile ? 10 : 40,
        vertical: mobile ? 14 : 24,
      ),
      content: SizedBox(
        width: mobile ? (size.width - 20).clamp(300.0, 680.0).toDouble() : 820,
        height: mobile
            ? (size.height - 160).clamp(380.0, 680.0).toDouble()
            : 560,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: () => _editItem(),
                icon: const Icon(Icons.add_rounded),
                label: const Text('Adicionar gatilho'),
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _items.isEmpty
                  ? const _EmptyState(
                      icon: Icons.quickreply_outlined,
                      title: 'Nenhuma auto resposta',
                      subtitle: 'Adicione gatilhos para o robo responder.',
                    )
                  : ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, index) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        return _AutoResponseTile(
                          item: item,
                          onEdit: () => _editItem(item),
                          onDelete: () => _removeItem(item),
                        );
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
        FilledButton.icon(
          onPressed: () => Navigator.of(context).pop(_items),
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _AutoResponseTile extends StatelessWidget {
  const _AutoResponseTile({
    required this.item,
    required this.onEdit,
    required this.onDelete,
  });

  final GroupAutoResponseConfig item;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final triggerText = item.matchAnyMessage
        ? 'Todas as mensagens'
        : item.triggers.isEmpty
        ? 'Sem gatilho'
        : item.triggers.join(', ');
    final hasMedia =
        item.raw['responseMedia'] != null || item.raw['media'] != null;
    final hasButtons =
        item.raw['responseButtons'] != null || item.raw['buttons'] != null;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: scheme.primaryContainer,
          child: Icon(Icons.quickreply_rounded, color: scheme.primary),
        ),
        title: Text(
          triggerText,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(
          [
            if (item.responseText.trim().isNotEmpty) item.responseText.trim(),
            if (hasMedia) 'midia preservada',
            if (hasButtons) 'botoes preservados',
            item.matchMode == 'contains' ? 'contem' : 'igual',
          ].join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Wrap(
          spacing: 2,
          children: [
            IconButton(
              onPressed: onEdit,
              tooltip: 'Editar',
              icon: const Icon(Icons.edit_rounded),
            ),
            IconButton(
              onPressed: onDelete,
              tooltip: 'Excluir',
              icon: const Icon(Icons.delete_outline_rounded),
            ),
          ],
        ),
      ),
    );
  }
}

class _AutoResponseEditDialog extends StatefulWidget {
  const _AutoResponseEditDialog({required this.item});

  final GroupAutoResponseConfig item;

  @override
  State<_AutoResponseEditDialog> createState() =>
      _AutoResponseEditDialogState();
}

class _AutoResponseEditDialogState extends State<_AutoResponseEditDialog> {
  late final TextEditingController _triggers;
  late final TextEditingController _response;
  late bool _matchAny;
  late String _matchMode;

  @override
  void initState() {
    super.initState();
    _triggers = TextEditingController(text: widget.item.triggers.join('\n'));
    _response = TextEditingController(text: widget.item.responseText);
    _matchAny = widget.item.matchAnyMessage;
    _matchMode = widget.item.matchMode;
  }

  @override
  void dispose() {
    _triggers.dispose();
    _response.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Editar auto resposta'),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Responder qualquer mensagem'),
                value: _matchAny,
                onChanged: (value) => setState(() => _matchAny = value),
              ),
              TextField(
                controller: _triggers,
                enabled: !_matchAny,
                minLines: 4,
                maxLines: 8,
                decoration: const InputDecoration(
                  labelText: 'Gatilhos',
                  helperText: 'Um gatilho por linha.',
                  prefixIcon: Icon(Icons.bolt_rounded),
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'equals', label: Text('Igual')),
                  ButtonSegment(value: 'contains', label: Text('Contem')),
                ],
                selected: {_matchMode},
                onSelectionChanged: (value) =>
                    setState(() => _matchMode = value.first),
                showSelectedIcon: false,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _response,
                minLines: 5,
                maxLines: 12,
                decoration: const InputDecoration(
                  labelText: 'Resposta',
                  prefixIcon: Icon(Icons.notes_rounded),
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
          onPressed: () => Navigator.of(context).pop(
            widget.item.copyWith(
              triggers: _matchAny ? const [] : _lineList(_triggers.text),
              responseText: _response.text,
              matchMode: _matchMode,
              matchAnyMessage: _matchAny,
            ),
          ),
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: scheme.primary),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProtectionConfigDraft {
  const _ProtectionConfigDraft({
    required this.allowedLinks,
    required this.bannedWords,
    required this.blacklist,
    required this.maxInfractions,
    required this.antipalavrasLimit,
  });

  final String allowedLinks;
  final String bannedWords;
  final String blacklist;
  final String maxInfractions;
  final String antipalavrasLimit;
}

class _ModerationActionDraft {
  const _ModerationActionDraft({
    required this.enabled,
    required this.action,
    this.allowedLinks,
    this.bannedWords,
    this.blacklist,
    this.maxInfractions,
    this.antipalavrasLimit,
  });

  final bool enabled;
  final ModerationActionConfig action;
  final String? allowedLinks;
  final String? bannedWords;
  final String? blacklist;
  final String? maxInfractions;
  final String? antipalavrasLimit;
}

class _ModerationActionDialog extends StatefulWidget {
  const _ModerationActionDialog({
    required this.item,
    required this.enabled,
    required this.action,
    required this.allowedLinks,
    required this.bannedWords,
    required this.blacklist,
    required this.maxInfractions,
    required this.antipalavrasLimit,
  });

  final _ActivationDefinition item;
  final bool enabled;
  final ModerationActionConfig action;
  final String allowedLinks;
  final String bannedWords;
  final String blacklist;
  final String maxInfractions;
  final String antipalavrasLimit;

  @override
  State<_ModerationActionDialog> createState() =>
      _ModerationActionDialogState();
}

class _ModerationActionDialogState extends State<_ModerationActionDialog> {
  late bool _enabled;
  late bool _deleteMessage;
  late bool _registerInfraction;
  late bool _banUser;
  late final TextEditingController _allowedLinks;
  late final TextEditingController _bannedWords;
  late final TextEditingController _blacklist;
  late final TextEditingController _maxInfractions;

  @override
  void initState() {
    super.initState();
    _enabled = widget.enabled;
    _deleteMessage = widget.action.deleteMessage;
    _registerInfraction = widget.action.registerInfraction;
    _banUser = widget.action.banUser;
    _allowedLinks = TextEditingController(text: widget.allowedLinks);
    _bannedWords = TextEditingController(text: widget.bannedWords);
    _blacklist = TextEditingController(text: widget.blacklist);
    _maxInfractions = TextEditingController(
      text: widget.action.maxInfractions?.toString() ?? '',
    );
  }

  @override
  void dispose() {
    _allowedLinks.dispose();
    _bannedWords.dispose();
    _blacklist.dispose();
    _maxInfractions.dispose();
    super.dispose();
  }

  bool get _isLinkRule =>
      widget.item.keyName == 'antilink' ||
      widget.item.keyName == 'antilinkgp' ||
      widget.item.keyName == 'banextremo';

  bool get _isWordsRule => widget.item.keyName == 'antipalavras';

  bool get _isBlacklistRule => widget.item.keyName == 'bangringos';

  String get _fallbackLimitLabel {
    final value =
        (_isWordsRule ? widget.antipalavrasLimit : widget.maxInfractions)
            .trim();
    return value.isEmpty ? '3' : value;
  }

  int? _parseActionLimit(String value) {
    final digits = value.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) return null;
    final parsed = int.tryParse(digits);
    if (parsed == null || parsed <= 0) return null;
    return parsed.clamp(1, 20).toInt();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final size = MediaQuery.sizeOf(context);
    final compact = size.width < 560;
    final commands = _activationCommands(widget.item.keyName);
    return AlertDialog(
      title: Row(
        children: [
          Icon(widget.item.icon, color: scheme.primary),
          const SizedBox(width: 10),
          Expanded(child: Text('Ações - ${widget.item.label}')),
        ],
      ),
      insetPadding: EdgeInsets.symmetric(
        horizontal: compact ? 12 : 40,
        vertical: compact ? 14 : 24,
      ),
      content: SizedBox(
        width: compact ? (size.width - 32).clamp(300.0, 520.0).toDouble() : 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('Ativar ${widget.item.label}'),
                subtitle: Text(widget.item.description),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              if (commands.isNotEmpty) ...[
                const SizedBox(height: 8),
                _ActivationCommandHelp(commands: commands),
              ],
              const Divider(height: 18),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Apagar mensagem enviada'),
                subtitle: const Text('Remove a mensagem que violou a regra.'),
                value: _deleteMessage,
                onChanged: (value) => setState(() => _deleteMessage = value),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Registrar infração'),
                subtitle: const Text('Soma infração no histórico do membro.'),
                value: _registerInfraction,
                onChanged: (value) =>
                    setState(() => _registerInfraction = value),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Remover usuário do grupo'),
                subtitle: Text(
                  _registerInfraction
                      ? 'Remove quando atingir o limite desta função.'
                      : 'Remove imediatamente quando violar esta regra.',
                ),
                value: _banUser,
                onChanged: (value) => setState(() => _banUser = value),
              ),
              if (_registerInfraction) ...[
                const SizedBox(height: 10),
                TextField(
                  controller: _maxInfractions,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(
                    labelText: 'Limite de infrações desta função',
                    helperText:
                        'Vazio usa o limite padrão do grupo ($_fallbackLimitLabel).',
                    prefixIcon: const Icon(Icons.warning_amber_rounded),
                  ),
                ),
              ],
              if (_isLinkRule) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _allowedLinks,
                  minLines: 5,
                  maxLines: 10,
                  decoration: const InputDecoration(
                    labelText: 'Links permitidos',
                    helperText: 'Um domínio ou link por linha.',
                    alignLabelWithHint: true,
                    prefixIcon: Icon(Icons.verified_rounded),
                  ),
                ),
              ],
              if (_isWordsRule) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _bannedWords,
                  minLines: 5,
                  maxLines: 10,
                  decoration: const InputDecoration(
                    labelText: 'Palavras proibidas',
                    helperText: 'Um termo por linha.',
                    alignLabelWithHint: true,
                    prefixIcon: Icon(Icons.block_rounded),
                  ),
                ),
              ],
              if (_isBlacklistRule) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _blacklist,
                  minLines: 4,
                  maxLines: 8,
                  decoration: const InputDecoration(
                    labelText: 'Blacklist',
                    helperText: 'Um número por linha com DDI.',
                    alignLabelWithHint: true,
                    prefixIcon: Icon(Icons.person_off_rounded),
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
          onPressed: () => Navigator.of(context).pop(
            _ModerationActionDraft(
              enabled: _enabled,
              action: ModerationActionConfig(
                deleteMessage: _deleteMessage,
                registerInfraction: _registerInfraction,
                banUser: _banUser,
                maxInfractions: _registerInfraction
                    ? _parseActionLimit(_maxInfractions.text)
                    : null,
              ),
              allowedLinks: _isLinkRule ? _allowedLinks.text : null,
              bannedWords: _isWordsRule ? _bannedWords.text : null,
              blacklist: _isBlacklistRule ? _blacklist.text : null,
              maxInfractions: null,
              antipalavrasLimit: null,
            ),
          ),
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _ProtectionConfigDialog extends StatefulWidget {
  const _ProtectionConfigDialog({
    required this.allowedLinks,
    required this.bannedWords,
    required this.blacklist,
    required this.maxInfractions,
    required this.antipalavrasLimit,
  });

  final String allowedLinks;
  final String bannedWords;
  final String blacklist;
  final String maxInfractions;
  final String antipalavrasLimit;

  @override
  State<_ProtectionConfigDialog> createState() =>
      _ProtectionConfigDialogState();
}

class _ProtectionConfigDialogState extends State<_ProtectionConfigDialog> {
  late final TextEditingController _allowedLinks;
  late final TextEditingController _bannedWords;
  late final TextEditingController _blacklist;
  late final TextEditingController _maxInfractions;
  late final TextEditingController _antipalavrasLimit;

  @override
  void initState() {
    super.initState();
    _allowedLinks = TextEditingController(text: widget.allowedLinks);
    _bannedWords = TextEditingController(text: widget.bannedWords);
    _blacklist = TextEditingController(text: widget.blacklist);
    _maxInfractions = TextEditingController(text: widget.maxInfractions);
    _antipalavrasLimit = TextEditingController(text: widget.antipalavrasLimit);
  }

  @override
  void dispose() {
    _allowedLinks.dispose();
    _bannedWords.dispose();
    _blacklist.dispose();
    _maxInfractions.dispose();
    _antipalavrasLimit.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Configurar protecao'),
      content: SizedBox(
        width: 720,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _allowedLinks,
                minLines: 7,
                maxLines: 12,
                decoration: const InputDecoration(
                  labelText: 'Links permitidos no anti-link',
                  helperText: 'Um dominio ou link por linha.',
                  alignLabelWithHint: true,
                  prefixIcon: Icon(Icons.verified_rounded),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _bannedWords,
                minLines: 5,
                maxLines: 10,
                decoration: const InputDecoration(
                  labelText: 'Palavras proibidas',
                  helperText: 'Um termo por linha.',
                  alignLabelWithHint: true,
                  prefixIcon: Icon(Icons.block_rounded),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _blacklist,
                minLines: 4,
                maxLines: 8,
                decoration: const InputDecoration(
                  labelText: 'Blacklist',
                  helperText: 'Um numero por linha. Use apenas DDI + numero.',
                  alignLabelWithHint: true,
                  prefixIcon: Icon(Icons.person_off_rounded),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _maxInfractions,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(
                        labelText: 'Limite geral',
                        prefixIcon: Icon(Icons.warning_amber_rounded),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: _antipalavrasLimit,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(
                        labelText: 'Limite anti-palavras',
                        prefixIcon: Icon(Icons.rule_rounded),
                      ),
                    ),
                  ),
                ],
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
          onPressed: () => Navigator.of(context).pop(
            _ProtectionConfigDraft(
              allowedLinks: _allowedLinks.text,
              bannedWords: _bannedWords.text,
              blacklist: _blacklist.text,
              maxInfractions: _maxInfractions.text,
              antipalavrasLimit: _antipalavrasLimit.text,
            ),
          ),
          icon: const Icon(Icons.save_rounded),
          label: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.title, this.subtitle, required this.child});

  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(
                subtitle!,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }
}

class _NoGroupSelected extends StatelessWidget {
  const _NoGroupSelected();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.groups_2_outlined,
            size: 72,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(height: 12),
          const Text('Selecione um grupo para configurar as ativacoes.'),
        ],
      ),
    );
  }
}

class _LoadError extends StatelessWidget {
  const _LoadError({required this.message, required this.onRetry});

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

List<String> _lineList(String value) {
  return value
      .split(RegExp(r'[\n,;,]+'))
      .map((entry) => entry.trim())
      .where((entry) => entry.isNotEmpty)
      .toSet()
      .toList();
}

List<String> _normalizedPrefixes(String value) {
  final seen = <String>{};
  final result = <String>[];
  for (final raw in value.split(RegExp(r'[\n,;,]+'))) {
    final normalized = raw.replaceAll(RegExp(r'\s+'), '');
    if (normalized.isEmpty || seen.contains(normalized)) continue;
    seen.add(normalized);
    result.add(normalized);
    if (result.length >= 10) break;
  }
  return result;
}

String? _nullableText(String value) {
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

String _initial(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return 'G';
  return trimmed.substring(0, 1).toUpperCase();
}

bool _looksLikeImage(String value) {
  final lower = value.toLowerCase().split('?').first;
  return lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.gif') ||
      lower.contains('/welcome-media') ||
      lower.contains('/farewell-media');
}

bool _looksLikeImageBytes(Uint8List bytes, String nameHint) {
  if (_looksLikeImage(nameHint)) return true;
  if (bytes.length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8) return true;
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4E &&
      bytes[3] == 0x47) {
    return true;
  }
  if (bytes.length >= 6 &&
      bytes[0] == 0x47 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46) {
    return true;
  }
  if (bytes.length >= 12 &&
      bytes[0] == 0x52 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x46 &&
      bytes[8] == 0x57 &&
      bytes[9] == 0x45 &&
      bytes[10] == 0x42 &&
      bytes[11] == 0x50) {
    return true;
  }
  return false;
}

String _absoluteUploadUrl(String value) {
  final raw = value.trim();
  if (raw.isEmpty) return raw;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  final normalized = raw.startsWith('/') ? raw : '/$raw';
  final base = AppConfig.apiBaseUrl.trim();
  if (base.isEmpty) return normalized;
  return '$base$normalized';
}

String _guessUploadMimeType(String fileName) {
  final lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.opus')) return 'audio/opus';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

IconData _buttonIcon(String type) {
  switch (type) {
    case 'cta_url':
      return Icons.open_in_new_rounded;
    case 'cta_call':
      return Icons.call_rounded;
    case 'cta_copy':
      return Icons.copy_rounded;
    default:
      return Icons.reply_rounded;
  }
}

String _validButtonType(String value) {
  const allowed = {'quick_reply', 'cta_url', 'cta_call', 'cta_copy'};
  return allowed.contains(value) ? value : 'quick_reply';
}
