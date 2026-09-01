import 'dart:async';
import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/wa_theme.dart';
import '../../models/migration_models.dart';
import '../../models/whatsapp_contact.dart';
import '../chat/media_players.dart';
import 'dashboard_controller.dart';

class BroadcastPanel extends ConsumerStatefulWidget {
  const BroadcastPanel({
    super.key,
    required this.instanceId,
    this.onCreateProfile,
  });

  final int? instanceId;
  final VoidCallback? onCreateProfile;

  @override
  ConsumerState<BroadcastPanel> createState() => _BroadcastPanelState();
}

class _BroadcastPanelState extends ConsumerState<BroadcastPanel> {
  List<Map<String, dynamic>> _lists = const [];
  Map<String, dynamic>? _detail;
  String? _selectedId;
  String? _loadingDetailId;
  bool _loading = true;
  bool _sending = false;
  final _composer = TextEditingController();
  Map<String, dynamic>? _media;
  final List<OutgoingInteractiveButton> _buttons = [];
  final List<Map<String, dynamic>> _variables = [];
  final List<Map<String, dynamic>> _messageVariants = [];
  String? _selectedTemplateId;
  Map<String, dynamic>? _selectedTemplate;
  Timer? _progressPoller;
  bool _pollingProgress = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _progressPoller = Timer.periodic(
      const Duration(seconds: 2),
      (_) => _pollProgress(),
    );
  }

  @override
  void didUpdateWidget(covariant BroadcastPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.instanceId != widget.instanceId) {
      _selectedId = null;
      _detail = null;
      _loadingDetailId = null;
      _composer.clear();
      _media = null;
      _buttons.clear();
      _variables.clear();
      _messageVariants.clear();
      _selectedTemplateId = null;
      _selectedTemplate = null;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    _progressPoller?.cancel();
    _composer.dispose();
    super.dispose();
  }

  Future<void> _pollProgress() async {
    if (_pollingProgress || _selectedId == null || !mounted) return;
    final runs = _records(_detail?['runs']);
    final schedules = _records(_detail?['schedules']);
    final hasRunning =
        runs.isNotEmpty &&
        ['queued', 'running'].contains(runs.first['status']?.toString());
    final hasActiveSchedule = schedules.any(
      (item) => item['status']?.toString() == 'pending',
    );
    if (!hasRunning && !hasActiveSchedule) return;
    _pollingProgress = true;
    try {
      await _openList(_selectedId!, quiet: true);
    } finally {
      _pollingProgress = false;
    }
  }

  Future<void> _load() async {
    final id = widget.instanceId;
    if (id == null) {
      if (mounted)
        setState(() {
          _lists = const [];
          _detail = null;
          _loadingDetailId = null;
          _loading = false;
        });
      return;
    }
    if (mounted) setState(() => _loading = true);
    try {
      final lists = await ref.read(apiClientProvider).loadBroadcastLists(id);
      if (!mounted) return;
      setState(() {
        _lists = lists;
        _loading = false;
      });
      final selected = _selectedId;
      if (selected != null && lists.any((item) => item['id'] == selected)) {
        await _openList(selected, quiet: true);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _loading = false);
      _notice('Não consegui carregar as listas: $error', error: true);
    }
  }

  Future<void> _openList(String id, {bool quiet = false}) async {
    final instanceId = widget.instanceId;
    if (instanceId == null) return;
    final changedList = _selectedId != id;
    if (changedList) {
      _composer.clear();
    }
    if (mounted) {
      setState(() {
        _selectedId = id;
        // Silent refreshes poll progress in the background. Keep the current
        // detail visible instead of replacing it with a spinner every cycle,
        // which made the transmission conversation blink.
        _loadingDetailId = !quiet || _detail == null ? id : null;
        if (changedList) {
          // Never render the previously selected conversation while the new
          // list is loading. Empty lists are valid details and must replace
          // the old panel just like populated lists do.
          _detail = null;
          _media = null;
          _buttons.clear();
          _variables.clear();
          _messageVariants.clear();
          _selectedTemplateId = null;
          _selectedTemplate = null;
        }
      });
    }
    try {
      final detail = await ref
          .read(apiClientProvider)
          .loadBroadcastList(instanceId, id);
      if (!mounted || _selectedId != id) return;
      setState(() {
        _detail = detail;
        _loadingDetailId = null;
      });
    } catch (error) {
      if (mounted && _selectedId == id) {
        setState(() => _loadingDetailId = null);
      }
      if (!quiet) _notice('Não consegui abrir a lista: $error', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final instanceId = widget.instanceId;
    if (instanceId == null) {
      return _EmptyPanel(wa: wa, onCreateProfile: widget.onCreateProfile);
    }
    if (_loading)
      return const Center(child: CircularProgressIndicator(strokeWidth: 2.4));
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 820;
        final list = _ListsPane(
          lists: _lists,
          selectedId: _selectedId,
          onCreate: () => _showCreateList(instanceId),
          onSelect: _openList,
          onRefresh: _load,
        );
        final detail = _DetailPane(
          detail: _detail,
          loading: _selectedId != null && _loadingDetailId == _selectedId,
          sending: _sending,
          onBack: compact
              ? () => setState(() {
                  _selectedId = null;
                  _detail = null;
                  _loadingDetailId = null;
                })
              : null,
          onManageContacts: () => _showContacts(instanceId),
          onOpenTemplates: () => _showTemplatePicker(instanceId),
          onToggleSchedule: (schedule, enabled) =>
              _toggleSchedule(instanceId, schedule, enabled),
          onEditSchedule: (schedule) => _editSchedule(instanceId, schedule),
          onDeleteSchedule: (schedule) => _deleteSchedule(instanceId, schedule),
          onEditHistoryMessage: (message) =>
              _editHistoryMessage(instanceId, message),
        );
        if (compact) return _selectedId == null ? list : detail;
        return Row(
          children: [
            SizedBox(width: 360, child: list),
            VerticalDivider(width: 1, color: wa.divider),
            Expanded(child: detail),
          ],
        );
      },
    );
  }

  Future<void> _showCreateList(int instanceId) async {
    final result = await showBotAdminBottomSheet<_CreateListDraft>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CreateListSheet(instanceId: instanceId),
    );
    if (result == null || !mounted) return;
    try {
      final created = await ref
          .read(apiClientProvider)
          .createBroadcastList(
            instanceId,
            name: result.name,
            description: result.description,
            contacts: result.contacts,
          );
      final list = Map<String, dynamic>.from(
        created['list'] as Map? ?? const {},
      );
      final listId = list['id']?.toString() ?? '';
      if (result.googleSheetUrl.isNotEmpty && listId.isNotEmpty) {
        await ref
            .read(apiClientProvider)
            .importBroadcastContacts(
              instanceId,
              listId,
              googleSheetUrl: result.googleSheetUrl,
              googleSheetMapping: result.googleSheetMapping,
            );
      }
      await _load();
      if (listId.isNotEmpty) await _openList(listId);
      _notice(
        'Lista criada. Destinatários repetidos foram combinados automaticamente.',
      );
    } catch (error) {
      _notice('Não consegui criar a lista: $error', error: true);
    }
  }

  Future<void> _showContacts(int instanceId) async {
    final id = _selectedId;
    if (id == null) return;
    await showBotAdminBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ContactsManager(
        instanceId: instanceId,
        listId: id,
        contacts: _records(_detail?['contacts']),
        googleSheetConfigured:
            (_detail?['googleSheet'] as Map?)?['configured'] == true,
      ),
    );
    if (!mounted) return;
    await _openList(id);
    await _load();
  }

  Future<void> _addContacts(int instanceId) async {
    final id = _selectedId;
    if (id == null) return;
    final draft = await showBotAdminBottomSheet<_ContactImportDraft>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ContactImportSheet(instanceId: instanceId),
    );
    if (draft == null) return;
    try {
      await ref
          .read(apiClientProvider)
          .importBroadcastContacts(
            instanceId,
            id,
            contacts: draft.contacts,
            googleSheetUrl: draft.googleSheetUrl,
            googleSheetMapping: draft.googleSheetMapping,
          );
      await _openList(id);
      await _load();
      _notice('Destinatários adicionados sem duplicação.');
    } catch (error) {
      _notice('Não consegui importar os destinatários: $error', error: true);
    }
  }

  Future<void> _startBroadcast(int instanceId, _SendSettings options) async {
    final detail = _detail;
    final listId = _selectedId;
    final body = _composer.text.trim();
    if (detail == null ||
        listId == null ||
        _selectedTemplateId == null ||
        (body.isEmpty && _media == null && _buttons.isEmpty)) {
      _notice('Selecione uma mensagem salva antes de enviar.');
      return;
    }
    final contacts = _records(detail['contacts']);
    if (contacts.isEmpty) {
      _notice('Adicione contatos ou grupos antes de enviar.');
      return;
    }
    if (!await _checkGoogleSheetBeforeSend(instanceId, listId)) return;
    if (!mounted) return;
    setState(() => _sending = true);
    try {
      final data = <String, dynamic>{
        'body': body,
        'typingEnabled': options.typing,
        'minDelayMs': options.minDelayMs,
        'maxDelayMs': options.maxDelayMs,
        'pacing': options.pacing,
        if (_media != null) 'media': _media,
        if (_buttons.isNotEmpty)
          'buttons': _buttons.map((item) => item.toJson()).toList(),
        if (_variables.isNotEmpty) 'variables': _variables,
        if (_messageVariants.length >= 2) 'messageVariants': _messageVariants,
        if (options.quietHoursEnabled)
          'quietHours': {
            'enabled': true,
            'startMinutes': options.quietStartMinutes,
            'endMinutes': options.quietEndMinutes,
            'timezone': options.timezone,
          },
      };
      if (options.mode == 'schedule' || options.mode == 'recurring') {
        data['scheduledAt'] = options.scheduledAt;
        data['timezone'] = options.timezone;
        if (options.recurrenceMinutes > 0)
          data['recurrenceMinutes'] = options.recurrenceMinutes;
        await ref
            .read(apiClientProvider)
            .scheduleBroadcastRun(instanceId, listId, data);
      } else {
        await ref
            .read(apiClientProvider)
            .startBroadcastRun(
              instanceId,
              listId,
              body: body,
              typingEnabled: options.typing,
              minDelayMs: options.minDelayMs,
              maxDelayMs: options.maxDelayMs,
              media: _media,
              quietHours: options.quietHoursEnabled
                  ? {
                      'enabled': true,
                      'startMinutes': options.quietStartMinutes,
                      'endMinutes': options.quietEndMinutes,
                      'timezone': options.timezone,
                    }
                  : null,
              pacing: options.pacing,
              buttons: _buttons,
              variables: _variables,
              messageVariants: _messageVariants,
            );
      }
      await _openList(listId);
      await _load();
      _notice(
        options.mode == 'schedule' || options.mode == 'recurring'
            ? 'Transmissão agendada com sucesso.'
            : 'Transmissão iniciada em segundo plano. O andamento aparece nesta conversa.',
      );
    } catch (error) {
      _notice('Não consegui iniciar a transmissão: $error', error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _updateGroupMentions(
    int instanceId,
    bool mentionAll,
    bool excludeAdmins,
  ) async {
    final listId = _selectedId;
    if (listId == null) return;
    try {
      await ref
          .read(apiClientProvider)
          .updateBroadcastGroupMentions(
            instanceId,
            listId,
            mentionAll: mentionAll,
            excludeAdmins: excludeAdmins,
          );
      await _openList(listId, quiet: true);
    } catch (error) {
      _notice('Não consegui atualizar as menções: $error', error: true);
      rethrow;
    }
  }

  void _clearDraft() {
    _composer.clear();
    setState(() {
      _media = null;
      _buttons.clear();
      _variables.clear();
      _messageVariants.clear();
      _selectedTemplateId = null;
      _selectedTemplate = null;
    });
  }

  void _selectTemplate(Map<String, dynamic> template) {
    final payload = template['payload'] is Map
        ? Map<String, dynamic>.from(template['payload'] as Map)
        : <String, dynamic>{};
    final rawMedia = payload['media'];
    final rawButtons = payload['buttons'];
    final rawVariables = payload['variables'];
    final rawVariants = payload['messageVariants'];
    _composer.text = template['body']?.toString() ?? '';
    _composer.selection = TextSelection.collapsed(
      offset: _composer.text.length,
    );
    setState(() {
      _selectedTemplateId = template['id']?.toString();
      _selectedTemplate = Map<String, dynamic>.from(template);
      _media = rawMedia is Map ? Map<String, dynamic>.from(rawMedia) : null;
      _buttons
        ..clear()
        ..addAll(_buttonsFromPayload(rawButtons));
      _variables
        ..clear()
        ..addAll(_records(rawVariables));
      _messageVariants
        ..clear()
        ..addAll(_records(rawVariants));
    });
  }

  Future<void> _toggleSchedule(
    int instanceId,
    Map<String, dynamic> schedule,
    bool enabled,
  ) async {
    final listId = _selectedId;
    final scheduleId = schedule['id']?.toString() ?? '';
    if (listId == null || scheduleId.isEmpty) return;
    try {
      await ref
          .read(apiClientProvider)
          .updateBroadcastSchedule(
            instanceId,
            listId,
            scheduleId,
            enabled: enabled,
          );
      await _openList(listId);
      _notice(enabled ? 'Programação reativada.' : 'Programação pausada.');
    } catch (error) {
      _notice('Não consegui atualizar a programação: $error', error: true);
    }
  }

  Future<void> _editSchedule(
    int instanceId,
    Map<String, dynamic> schedule,
  ) async {
    final listId = _selectedId;
    final scheduleId = schedule['id']?.toString() ?? '';
    if (listId == null || scheduleId.isEmpty) return;
    final payload = schedule['payload'] is Map
        ? Map<String, dynamic>.from(schedule['payload'] as Map)
        : <String, dynamic>{};
    final value = await showDialog<_ScheduleSettingsResult>(
      context: context,
      builder: (_) => _RecurrenceEditorDialog(
        initialMinutes: _asInt(schedule['recurrenceMinutes'], 60),
        initialQuietHours: payload['quietHours'] is Map
            ? Map<String, dynamic>.from(payload['quietHours'] as Map)
            : null,
      ),
    );
    if (value == null || !mounted) return;
    try {
      await ref
          .read(apiClientProvider)
          .updateBroadcastSchedule(
            instanceId,
            listId,
            scheduleId,
            recurrenceMinutes: value.recurrenceMinutes,
            quietHours: value.quietHours,
          );
      await _openList(listId);
      _notice(
        value.recurrenceMinutes > 0
            ? 'Programação atualizada para ${_formatRecurrence(value.recurrenceMinutes)}.'
            : 'Recorrência removida; este envio acontecerá apenas uma vez.',
      );
    } catch (error) {
      _notice('Não consegui editar a recorrência: $error', error: true);
    }
  }

  Future<void> _deleteSchedule(
    int instanceId,
    Map<String, dynamic> schedule,
  ) async {
    final listId = _selectedId;
    final scheduleId = schedule['id']?.toString() ?? '';
    if (listId == null || scheduleId.isEmpty) return;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Excluir programação?'),
        content: const Text(
          'O histórico já enviado será preservado. Apenas os próximos envios serão removidos.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (accepted != true) return;
    try {
      await ref
          .read(apiClientProvider)
          .deleteBroadcastSchedule(instanceId, listId, scheduleId);
      await _openList(listId);
      _notice('Programação excluída.');
    } catch (error) {
      _notice('Não consegui excluir a programação: $error', error: true);
    }
  }

  Future<void> _showTemplatePicker(int instanceId) async {
    final listId = _selectedId;
    if (listId == null) return;
    final action = await showDialog<_SavedMessageAction>(
      context: context,
      builder: (_) => _SavedMessagesDialog(
        templates: _records(_detail?['templates']),
        selectedId: _selectedTemplateId,
      ),
    );
    if (action == null || !mounted) return;
    if (action.type == _SavedMessageActionType.select &&
        action.template != null) {
      _selectTemplate(action.template!);
      await _showSelectedTemplateDialog(instanceId);
      return;
    }
    if (action.type == _SavedMessageActionType.delete &&
        action.template != null) {
      await _deleteTemplate(instanceId, action.template!);
      if (mounted) await _showTemplatePicker(instanceId);
      return;
    }
    await _openTemplateEditor(instanceId, action.template);
  }

  Future<void> _openTemplateEditor(
    int instanceId,
    Map<String, dynamic>? template,
  ) async {
    final listId = _selectedId;
    if (listId == null) return;
    final result = await showDialog<_BroadcastMessageEditorResult>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _BroadcastMessageEditorDialog(
        instanceId: instanceId,
        listId: listId,
        template: template,
        contacts: _records(_detail?['contacts']),
      ),
    );
    if (result == null || !mounted) return;
    setState(() => _sending = true);
    try {
      final saved = await ref
          .read(apiClientProvider)
          .saveBroadcastTemplate(instanceId, listId, {
            if (result.templateId != null) 'templateId': result.templateId,
            'templateName': result.name,
            'body': result.body,
            if (result.media != null) 'media': result.media,
            if (result.buttons.isNotEmpty)
              'buttons': result.buttons.map((item) => item.toJson()).toList(),
            if (result.variables.isNotEmpty) 'variables': result.variables,
            if (result.messageVariants.length >= 2)
              'messageVariants': result.messageVariants,
          });
      final templateId = saved['templateId']?.toString() ?? result.templateId;
      await _openList(listId);
      final selected = _records(
        _detail?['templates'],
      ).where((item) => item['id']?.toString() == templateId);
      if (selected.isNotEmpty) {
        _selectTemplate(selected.first);
        if (mounted) setState(() => _sending = false);
        await _showSelectedTemplateDialog(instanceId);
      }
      _notice(
        saved['updated'] == true
            ? 'Mensagem atualizada e selecionada para envio.'
            : 'Mensagem criada e selecionada para envio.',
      );
    } catch (error) {
      _notice('Não consegui salvar a mensagem: $error', error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _editHistoryMessage(
    int instanceId,
    Map<String, dynamic> message,
  ) async {
    final payload = message['payload'] is Map
        ? Map<String, dynamic>.from(message['payload'] as Map)
        : <String, dynamic>{};
    await _openTemplateEditor(instanceId, {
      'name': 'Mensagem reaproveitada',
      'body': message['body']?.toString() ?? '',
      'payload': payload,
    });
  }

  Future<void> _showSelectedTemplateDialog(int instanceId) async {
    final template = _selectedTemplate;
    final detail = _detail;
    if (template == null || detail == null || !mounted) return;
    final contacts = _records(detail['contacts']);
    final payload = template['payload'] is Map
        ? Map<String, dynamic>.from(template['payload'] as Map)
        : <String, dynamic>{};
    final result = await showDialog<Object>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _BroadcastSendDialog(
        template: template,
        media: payload['media'] is Map
            ? Map<String, dynamic>.from(payload['media'] as Map)
            : null,
        buttons: _buttonsFromPayload(payload['buttons']),
        contactCount: contacts.length,
        groupCount: contacts
            .where((item) => item['recipientType'] == 'group')
            .length,
        mentionAll: contacts.any(
          (item) =>
              item['recipientType'] == 'group' && item['mentionAll'] == true,
        ),
        excludeAdmins: contacts.any(
          (item) =>
              item['recipientType'] == 'group' && item['excludeAdmins'] == true,
        ),
        sending: _sending,
        messageVariantCount: _messageVariants.length,
        onUpdateGroupMentions: (mentionAll, excludeAdmins) =>
            _updateGroupMentions(instanceId, mentionAll, excludeAdmins),
        onEditMessage: () =>
            Navigator.pop(context, _BroadcastSendDialogAction.editMessage),
      ),
    );
    if (!mounted) return;
    if (result == _BroadcastSendDialogAction.editMessage) {
      await _openTemplateEditor(instanceId, template);
      return;
    }
    if (result is _SendSettings) {
      await _startBroadcast(instanceId, result);
      _clearDraft();
      return;
    }
    _clearDraft();
    if (result == _BroadcastSendDialogAction.changeMessage) {
      await _showTemplatePicker(instanceId);
    }
  }

  Future<void> _deleteTemplate(
    int instanceId,
    Map<String, dynamic> template,
  ) async {
    final listId = _selectedId;
    final templateId = template['id']?.toString() ?? '';
    if (listId == null || templateId.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir mensagem salva?'),
        content: Text(
          '“${template['name'] ?? 'Mensagem'}” deixará de aparecer nesta lista.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref
          .read(apiClientProvider)
          .deleteBroadcastTemplate(instanceId, listId, templateId);
      if (_selectedTemplateId == templateId) _clearDraft();
      await _openList(listId);
      _notice('Mensagem salva excluída.');
    } catch (error) {
      _notice('Não consegui excluir a mensagem: $error', error: true);
    }
  }

  Future<bool> _checkGoogleSheetBeforeSend(
    int instanceId,
    String listId,
  ) async {
    final source = _detail?['googleSheet'];
    if (source is! Map || source['configured'] != true) return true;
    try {
      _notice('Conferindo novos contatos na planilha…');
      final result = await ref
          .read(apiClientProvider)
          .syncBroadcastGoogleSheet(instanceId, listId);
      final amount = _asInt(result['newContacts']);
      if (amount <= 0) return true;
      if (!mounted) return false;
      final preview = _records(result['preview']);
      final decision = await showDialog<String>(
        context: context,
        builder: (_) =>
            _NewSheetContactsDialog(amount: amount, contacts: preview),
      );
      if (decision == 'skip') return true;
      if (decision != 'include') return false;
      await ref
          .read(apiClientProvider)
          .syncBroadcastGoogleSheet(instanceId, listId, apply: true);
      await _openList(listId);
      await _load();
      _notice('$amount novo(s) contato(s) incluído(s) nesta transmissão.');
      return true;
    } catch (error) {
      if (!mounted) return false;
      final continueWithoutSync = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Não consegui conferir a planilha'),
          content: Text(
            '$error\n\nVocê pode continuar usando os contatos já salvos ou cancelar para revisar a conexão.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Continuar sem sincronizar'),
            ),
          ],
        ),
      );
      return continueWithoutSync == true;
    }
  }

  Future<void> _pickMedia(int instanceId) async {
    final id = _selectedId;
    if (id == null) return;
    final file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: 'Mídia',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'mov',
            'mkv',
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
    final mime = _mimeFor(file.name);
    final kind = mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
        ? 'audio'
        : 'document';
    try {
      _notice('Enviando mídia para a transmissão…');
      final uploaded = await ref
          .read(apiClientProvider)
          .uploadBroadcastMedia(
            instanceId,
            id,
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: mime,
            mediaType: kind,
          );
      if (mounted) setState(() => _media = uploaded);
    } catch (error) {
      _notice('Não consegui anexar a mídia: $error', error: true);
    }
  }

  Future<void> _editButtons() async {
    final values = await showDialog<List<OutgoingInteractiveButton>>(
      context: context,
      builder: (_) => _ButtonsDialog(
        initial: _buttons,
        body: _composer.text,
        media: _media,
      ),
    );
    if (values != null && mounted)
      setState(() {
        _buttons
          ..clear()
          ..addAll(values);
      });
  }

  Future<void> _editVariables() async {
    final contacts = _records(_detail?['contacts']);
    final values = await showDialog<List<Map<String, dynamic>>>(
      context: context,
      builder: (_) => _VariablesDialog(initial: _variables, contacts: contacts),
    );
    if (values != null && mounted)
      setState(() {
        _variables
          ..clear()
          ..addAll(values);
      });
  }

  void _notice(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? Colors.red.shade700 : null,
      ),
    );
  }
}

class _ListsPane extends StatelessWidget {
  const _ListsPane({
    required this.lists,
    required this.selectedId,
    required this.onCreate,
    required this.onSelect,
    required this.onRefresh,
  });
  final List<Map<String, dynamic>> lists;
  final String? selectedId;
  final VoidCallback onCreate;
  final ValueChanged<String> onSelect;
  final VoidCallback onRefresh;
  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: wa.panel,
      child: Column(
        children: [
          Container(
            height: 72,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: wa.divider)),
            ),
            child: Row(
              children: [
                Icon(Icons.campaign_rounded, color: wa.accent),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Transmissões',
                        style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        'Listas e mensagens reutilizáveis',
                        style: TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: onRefresh,
                  tooltip: 'Atualizar',
                  icon: const Icon(Icons.refresh_rounded),
                ),
                FilledButton.icon(
                  onPressed: onCreate,
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Nova'),
                ),
              ],
            ),
          ),
          Expanded(
            child: lists.isEmpty
                ? const _NoLists()
                : ListView.separated(
                    itemCount: lists.length,
                    separatorBuilder: (_, _) =>
                        Divider(height: 1, indent: 72, color: wa.divider),
                    itemBuilder: (context, index) {
                      final item = lists[index];
                      final id = item['id']?.toString() ?? '';
                      final active = id == selectedId;
                      final count = _asInt(item['contactCount']);
                      return Material(
                        color: active ? wa.accentSoft : Colors.transparent,
                        child: ListTile(
                          onTap: id.isEmpty ? null : () => onSelect(id),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 5,
                          ),
                          leading: CircleAvatar(
                            backgroundColor: active ? wa.accent : wa.searchBg,
                            foregroundColor: active ? Colors.white : wa.accent,
                            child: const Icon(Icons.people_alt_rounded),
                          ),
                          title: Text(
                            item['name']?.toString() ?? 'Lista',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          subtitle: Text(
                            '${count} destinatário(s) · ${_preview(item['lastMessage'])}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: _StatusDot(
                            status: item['lastRunStatus']?.toString() ?? '',
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _DetailPane extends StatelessWidget {
  const _DetailPane({
    required this.detail,
    required this.loading,
    required this.sending,
    required this.onBack,
    required this.onManageContacts,
    required this.onOpenTemplates,
    required this.onToggleSchedule,
    required this.onEditSchedule,
    required this.onDeleteSchedule,
    required this.onEditHistoryMessage,
  });
  final Map<String, dynamic>? detail;
  final bool loading;
  final bool sending;
  final VoidCallback? onBack;
  final VoidCallback onManageContacts;
  final VoidCallback onOpenTemplates;
  final void Function(Map<String, dynamic>, bool) onToggleSchedule;
  final void Function(Map<String, dynamic>) onEditSchedule;
  final void Function(Map<String, dynamic>) onDeleteSchedule;
  final void Function(Map<String, dynamic>) onEditHistoryMessage;
  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final list = detail?['list'] as Map?;
    final messages = _records(detail?['messages']);
    final runs = _records(detail?['runs']);
    final schedules = _records(detail?['schedules']);
    final contacts = _records(detail?['contacts']);
    final latestRunContacts = _records(detail?['latestRunContacts']);
    if (loading) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2.4));
    }
    if (detail == null || list == null)
      return const Center(
        child: Text(
          'Selecione uma lista para abrir a conversa de transmissão.',
        ),
      );
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 640;
        return ColoredBox(
          color: wa.chatWallpaper,
          child: Column(
            children: [
              Container(
                height: 72,
                padding: EdgeInsets.symmetric(horizontal: compact ? 6 : 14),
                decoration: BoxDecoration(
                  color: wa.headerBg,
                  border: Border(bottom: BorderSide(color: wa.divider)),
                ),
                child: Row(
                  children: [
                    if (onBack != null)
                      IconButton(
                        onPressed: onBack,
                        icon: const Icon(Icons.arrow_back_rounded),
                      ),
                    CircleAvatar(
                      radius: compact ? 18 : 20,
                      backgroundColor: wa.accentSoft,
                      foregroundColor: wa.accent,
                      child: const Icon(Icons.campaign_rounded, size: 21),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            list['name']?.toString() ?? 'Lista',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: compact ? 15 : 17,
                            ),
                          ),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.groups_2_outlined,
                                size: 14,
                                color: wa.textSecondary,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                '${contacts.length}',
                                style: TextStyle(
                                  color: wa.textSecondary,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    if (!compact)
                      TextButton.icon(
                        onPressed: onManageContacts,
                        icon: const Icon(Icons.groups_2_outlined, size: 18),
                        label: const Text('Destinatários'),
                      )
                    else
                      IconButton(
                        onPressed: onManageContacts,
                        tooltip: 'Destinatários',
                        icon: Badge(
                          label: Text('${contacts.length}'),
                          child: const Icon(Icons.groups_2_outlined),
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
                  children: [
                    if (schedules.isNotEmpty) ...[
                      _SectionLabel(
                        icon: Icons.schedule_send_rounded,
                        label: 'Programações',
                        count: schedules.length,
                      ),
                      const SizedBox(height: 8),
                      for (final schedule in schedules)
                        _ScheduleCard(
                          schedule: schedule,
                          run: _runById(runs, schedule['runId']),
                          runContacts: latestRunContacts,
                          instanceId: _asInt(list['instanceId']),
                          listId: list['id']?.toString() ?? '',
                          onToggle: (enabled) =>
                              onToggleSchedule(schedule, enabled),
                          onEdit: () => onEditSchedule(schedule),
                          onDelete: () => onDeleteSchedule(schedule),
                        ),
                      const SizedBox(height: 16),
                    ],
                    if (messages.isEmpty && runs.isEmpty && schedules.isEmpty)
                      const _EmptyBroadcastHistory(),
                    for (final message in messages) ...[
                      _MessageBubble(
                        text: message['body']?.toString() ?? '',
                        createdAt: message['createdAt']?.toString(),
                        run: _runForMessage(runs, message['id']),
                        runContacts: latestRunContacts,
                        instanceId: _asInt(list['instanceId']),
                        listId: list['id']?.toString() ?? '',
                        payload: message['payload'] is Map
                            ? Map<String, dynamic>.from(
                                message['payload'] as Map,
                              )
                            : null,
                        onEdit: () => onEditHistoryMessage(message),
                      ),
                    ],
                  ],
                ),
              ),
              SafeArea(
                top: false,
                child: Container(
                  padding: EdgeInsets.fromLTRB(
                    compact ? 10 : 16,
                    9,
                    compact ? 10 : 16,
                    10,
                  ),
                  color: wa.composerBg,
                  child: SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: sending ? null : onOpenTemplates,
                      icon: const Icon(Icons.bookmarks_outlined),
                      label: const Text('Selecionar mensagem'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({
    required this.icon,
    required this.label,
    required this.count,
  });
  final IconData icon;
  final String label;
  final int count;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Row(
      children: [
        Icon(icon, size: 18, color: wa.accent),
        const SizedBox(width: 7),
        Text(label, style: const TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(width: 7),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: wa.accentSoft,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            '$count',
            style: TextStyle(
              color: wa.accent,
              fontWeight: FontWeight.w900,
              fontSize: 11,
            ),
          ),
        ),
      ],
    );
  }
}

class _SendInfoChip extends StatelessWidget {
  const _SendInfoChip({required this.icon, required this.label});
  final IconData icon;
  final String label;
  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: wa.searchBg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: wa.divider),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: wa.accent),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

enum _BroadcastSendDialogAction { changeMessage, editMessage }

class _BroadcastSendDialog extends StatelessWidget {
  const _BroadcastSendDialog({
    required this.template,
    required this.media,
    required this.buttons,
    required this.contactCount,
    required this.groupCount,
    required this.mentionAll,
    required this.excludeAdmins,
    required this.sending,
    required this.messageVariantCount,
    required this.onUpdateGroupMentions,
    required this.onEditMessage,
  });

  final Map<String, dynamic> template;
  final Map<String, dynamic>? media;
  final List<OutgoingInteractiveButton> buttons;
  final int contactCount;
  final int groupCount;
  final bool mentionAll;
  final bool excludeAdmins;
  final bool sending;
  final int messageVariantCount;
  final Future<void> Function(bool mentionAll, bool excludeAdmins)
  onUpdateGroupMentions;
  final VoidCallback onEditMessage;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final viewport = MediaQuery.sizeOf(context);
    final body = template['body']?.toString() ?? '';
    final title = template['name']?.toString().trim();
    final settings = _InlineBroadcastSettings(
      key: ValueKey(template['id']?.toString()),
      contactCount: contactCount,
      groupCount: groupCount,
      mentionAll: mentionAll,
      excludeAdmins: excludeAdmins,
      sending: sending,
      onChangeMessage: () =>
          Navigator.pop(context, _BroadcastSendDialogAction.changeMessage),
      onCancel: () => Navigator.pop(context),
      onSend: (options) => Navigator.pop(context, options),
      onUpdateGroupMentions: onUpdateGroupMentions,
    );
    final preview = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Icon(Icons.chat_rounded, color: wa.accent, size: 19),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'Prévia da mensagem',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (messageVariantCount >= 2) ...[
          Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: wa.accentSoft,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: wa.accent.withValues(alpha: .35)),
            ),
            child: Row(
              children: [
                Icon(Icons.shuffle_rounded, color: wa.accent),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    'Randomizador ativo: $messageVariantCount versões deste mesmo modelo serão alternadas entre os destinatários.',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
        ],
        _BroadcastAdaptiveCard(
          body: body,
          media: media,
          buttons: buttons,
          compact: viewport.width < 720,
          selected: true,
          fullContent: true,
          metaLabel: 'pronta para enviar',
          onEditContent: onEditMessage,
        ),
      ],
    );
    return Dialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      insetPadding: EdgeInsets.symmetric(
        horizontal: viewport.width < 720 ? 8 : 28,
        vertical: viewport.width < 720 ? 8 : 24,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 1080,
          maxHeight: viewport.height * .92,
        ),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(20, 14, 10, 14),
              decoration: BoxDecoration(
                color: wa.headerBg,
                border: Border(bottom: BorderSide(color: wa.divider)),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 19,
                    backgroundColor: wa.accentSoft,
                    foregroundColor: wa.accent,
                    child: const Icon(Icons.campaign_rounded, size: 20),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Preparar transmissão',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          title?.isNotEmpty == true
                              ? title!
                              : 'Mensagem selecionada',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: wa.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    tooltip: 'Cancelar seleção',
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  if (constraints.maxWidth < 780) {
                    return SingleChildScrollView(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        children: [
                          preview,
                          const SizedBox(height: 14),
                          settings,
                        ],
                      ),
                    );
                  }
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
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
                        width: 500,
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.all(18),
                          child: settings,
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InlineBroadcastSettings extends StatefulWidget {
  const _InlineBroadcastSettings({
    super.key,
    required this.contactCount,
    required this.groupCount,
    required this.mentionAll,
    required this.excludeAdmins,
    required this.sending,
    required this.onChangeMessage,
    required this.onCancel,
    required this.onSend,
    required this.onUpdateGroupMentions,
  });
  final int contactCount;
  final int groupCount;
  final bool mentionAll;
  final bool excludeAdmins;
  final bool sending;
  final VoidCallback onChangeMessage;
  final VoidCallback onCancel;
  final ValueChanged<_SendSettings> onSend;
  final Future<void> Function(bool mentionAll, bool excludeAdmins)
  onUpdateGroupMentions;

  @override
  State<_InlineBroadcastSettings> createState() =>
      _InlineBroadcastSettingsState();
}

class _InlineBroadcastSettingsState extends State<_InlineBroadcastSettings> {
  String mode = 'send';
  bool typing = true;
  bool quietHoursEnabled = false;
  TimeOfDay quietStart = const TimeOfDay(hour: 22, minute: 0);
  TimeOfDay quietEnd = const TimeOfDay(hour: 8, minute: 0);
  late bool mentionAll;
  late bool excludeAdmins;
  bool savingMentions = false;
  final minDelay = TextEditingController(text: '30');
  final maxDelay = TextEditingController(text: '60');
  final batchSize = TextEditingController(text: '20');
  final batchPauseMin = TextEditingController(text: '180');
  final batchPauseMax = TextEditingController(text: '300');
  final scheduledAt = TextEditingController(
    text: DateTime.now()
        .add(const Duration(hours: 1))
        .toIso8601String()
        .substring(0, 16)
        .replaceFirst('T', ' '),
  );
  final recurrence = TextEditingController(text: '24');
  String recurrenceUnit = 'hours';

  @override
  void initState() {
    super.initState();
    mentionAll = widget.mentionAll;
    excludeAdmins = widget.excludeAdmins;
  }

  @override
  void dispose() {
    minDelay.dispose();
    maxDelay.dispose();
    batchSize.dispose();
    batchPauseMin.dispose();
    batchPauseMax.dispose();
    scheduledAt.dispose();
    recurrence.dispose();
    super.dispose();
  }

  Future<void> _setMentions({bool? mention, bool? exclude}) async {
    final nextMention = mention ?? mentionAll;
    final nextExclude = nextMention ? (exclude ?? excludeAdmins) : false;
    setState(() {
      mentionAll = nextMention;
      excludeAdmins = nextExclude;
      savingMentions = true;
    });
    try {
      await widget.onUpdateGroupMentions(nextMention, nextExclude);
    } catch (_) {
      if (mounted) {
        setState(() {
          mentionAll = widget.mentionAll;
          excludeAdmins = widget.excludeAdmins;
        });
      }
    } finally {
      if (mounted) setState(() => savingMentions = false);
    }
  }

  void _send() {
    final min = _asInt(minDelay.text, 30).clamp(10, 300);
    final max = _asInt(maxDelay.text, 60).clamp(min, 300);
    final batch = _asInt(batchSize.text, 20).clamp(5, 100);
    final pauseMin = _asInt(batchPauseMin.text, 180).clamp(60, 1800);
    final pauseMax = _asInt(batchPauseMax.text, 300).clamp(pauseMin, 1800);
    final factor = recurrenceUnit == 'days'
        ? 1440
        : recurrenceUnit == 'hours'
        ? 60
        : 1;
    widget.onSend(
      _SendSettings(
        mode,
        typing,
        min * 1000,
        max * 1000,
        batch,
        pauseMin * 1000,
        pauseMax * 1000,
        mode == 'send' ? '' : scheduledAt.text.trim().replaceFirst(' ', 'T'),
        mode == 'recurring'
            ? _asInt(recurrence.text, 24).clamp(1, 43200) * factor
            : 0,
        quietHoursEnabled,
        quietStart.hour * 60 + quietStart.minute,
        quietEnd.hour * 60 + quietEnd.minute,
        'America/Sao_Paulo',
      ),
    );
  }

  Future<void> _pickQuietTime({required bool start}) async {
    final value = await showTimePicker(
      context: context,
      initialTime: start ? quietStart : quietEnd,
      helpText: start ? 'Início da pausa' : 'Retomar os disparos',
    );
    if (value == null || !mounted) return;
    setState(() {
      if (start) {
        quietStart = value;
      } else {
        quietEnd = value;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: wa.panel,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: wa.divider),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .1),
            blurRadius: 12,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.tune_rounded, size: 19, color: wa.accent),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Preparar transmissão',
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              TextButton.icon(
                onPressed: widget.sending ? null : widget.onChangeMessage,
                icon: const Icon(Icons.swap_horiz_rounded, size: 18),
                label: const Text('Trocar'),
              ),
              IconButton(
                onPressed: widget.sending ? null : widget.onCancel,
                tooltip: 'Cancelar seleção',
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          Text(
            '${widget.contactCount} destinatário(s) · configure antes de iniciar',
            style: TextStyle(color: wa.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              ChoiceChip(
                selected: mode == 'send',
                onSelected: (_) => setState(() => mode = 'send'),
                avatar: const Icon(Icons.send_rounded, size: 17),
                label: const Text('Agora'),
              ),
              ChoiceChip(
                selected: mode == 'schedule',
                onSelected: (_) => setState(() => mode = 'schedule'),
                avatar: const Icon(Icons.schedule_rounded, size: 17),
                label: const Text('Agendar'),
              ),
              ChoiceChip(
                selected: mode == 'recurring',
                onSelected: (_) => setState(() => mode = 'recurring'),
                avatar: const Icon(Icons.autorenew_rounded, size: 17),
                label: const Text('Recorrente'),
              ),
            ],
          ),
          if (mode != 'send') ...[
            const SizedBox(height: 10),
            TextField(
              controller: scheduledAt,
              decoration: const InputDecoration(
                labelText: 'Data e horário de início',
                helperText: 'Formato: 2026-08-21 14:30',
              ),
            ),
          ],
          if (mode == 'recurring') ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: recurrence,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Repetir a cada',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: recurrenceUnit,
                    decoration: const InputDecoration(labelText: 'Unidade'),
                    items: const [
                      DropdownMenuItem(
                        value: 'minutes',
                        child: Text('Minutos'),
                      ),
                      DropdownMenuItem(value: 'hours', child: Text('Horas')),
                      DropdownMenuItem(value: 'days', child: Text('Dias')),
                    ],
                    onChanged: (value) =>
                        setState(() => recurrenceUnit = value ?? 'hours'),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: minDelay,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Delay mín. (s)',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: maxDelay,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Delay máx. (s)',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Intervalo aleatório persistido entre cada envio. Recomendado: 30–60 segundos.',
            style: TextStyle(color: wa.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: batchSize,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Mensagens por lote',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: batchPauseMin,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Pausa mín. (s)',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: batchPauseMax,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Pausa máx. (s)',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Após cada lote, a fila faz uma pausa maior. Isso reduz rajadas, mas não substitui consentimento dos destinatários.',
            style: TextStyle(color: wa.textSecondary, fontSize: 12),
          ),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: typing,
            onChanged: (value) => setState(() => typing = value),
            title: const Text('Mostrar “digitando”'),
          ),
          Divider(height: 1, color: wa.divider),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: quietHoursEnabled,
            onChanged: (value) => setState(() => quietHoursEnabled = value),
            secondary: const Icon(Icons.bedtime_outlined),
            title: const Text('Pausa automática à noite'),
            subtitle: const Text(
              'Não perde destinatários: o envio aguarda e continua pela manhã.',
            ),
          ),
          if (quietHoursEnabled)
            Row(
              children: [
                Expanded(
                  child: _QuietTimeButton(
                    label: 'Pausar às',
                    value: quietStart.format(context),
                    onTap: () => _pickQuietTime(start: true),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 7),
                  child: Icon(Icons.arrow_forward_rounded, size: 18),
                ),
                Expanded(
                  child: _QuietTimeButton(
                    label: 'Retomar às',
                    value: quietEnd.format(context),
                    onTap: () => _pickQuietTime(start: false),
                  ),
                ),
              ],
            ),
          if (widget.groupCount > 0) ...[
            Divider(height: 1, color: wa.divider),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: mentionAll,
              onChanged: savingMentions
                  ? null
                  : (value) => _setMentions(mention: value),
              title: const Text('Mencionar participantes dos grupos'),
              subtitle: Text('${widget.groupCount} grupo(s) nesta lista'),
            ),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: excludeAdmins,
              onChanged: !mentionAll || savingMentions
                  ? null
                  : (value) => _setMentions(exclude: value),
              title: const Text('Não mencionar administradores'),
            ),
          ],
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: widget.sending ? null : widget.onCancel,
                  child: const Text('Cancelar'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: FilledButton.icon(
                  onPressed: widget.sending ? null : _send,
                  icon: widget.sending
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          mode == 'send'
                              ? Icons.send_rounded
                              : Icons.schedule_send_rounded,
                        ),
                  label: Text(
                    mode == 'send'
                        ? 'Iniciar transmissão'
                        : mode == 'recurring'
                        ? 'Ativar recorrência'
                        : 'Agendar transmissão',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuietTimeButton extends StatelessWidget {
  const _QuietTimeButton({
    required this.label,
    required this.value,
    required this.onTap,
  });
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: wa.searchBg,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          child: Row(
            children: [
              Icon(Icons.schedule_rounded, size: 18, color: wa.accent),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(fontSize: 11, color: wa.textSecondary),
                    ),
                    Text(
                      value,
                      style: const TextStyle(fontWeight: FontWeight.w900),
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

class _ScheduleCard extends StatelessWidget {
  const _ScheduleCard({
    required this.schedule,
    required this.run,
    required this.runContacts,
    required this.instanceId,
    required this.listId,
    required this.onToggle,
    required this.onEdit,
    required this.onDelete,
  });
  final Map<String, dynamic> schedule;
  final Map<String, dynamic>? run;
  final List<Map<String, dynamic>> runContacts;
  final int instanceId;
  final String listId;
  final ValueChanged<bool> onToggle;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final payload = schedule['payload'] is Map
        ? Map<String, dynamic>.from(schedule['payload'] as Map)
        : <String, dynamic>{};
    final recurrence = _asInt(schedule['recurrenceMinutes']);
    final quiet = payload['quietHours'] is Map
        ? Map<String, dynamic>.from(payload['quietHours'] as Map)
        : null;
    final quietEnabled = quiet?['enabled'] == true;
    final status = schedule['status']?.toString() ?? '';
    final enabled = status == 'pending';
    final editable = status != 'dispatched';
    final sentTotal = _asInt(schedule['sentTotal']);
    final failedTotal = _asInt(schedule['failedTotal']);
    final scheduled = DateTime.tryParse(
      schedule['scheduledFor']?.toString() ?? '',
    )?.toLocal();
    final when = scheduled == null
        ? 'Horário indisponível'
        : '${scheduled.day.toString().padLeft(2, '0')}/${scheduled.month.toString().padLeft(2, '0')} · ${scheduled.hour.toString().padLeft(2, '0')}:${scheduled.minute.toString().padLeft(2, '0')}';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 7, 10),
      decoration: BoxDecoration(
        color: wa.panel,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: enabled ? wa.accent.withValues(alpha: .45) : wa.divider,
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: enabled ? wa.accentSoft : wa.searchBg,
            foregroundColor: enabled ? wa.accent : wa.textMuted,
            child: Icon(
              recurrence > 0
                  ? Icons.autorenew_rounded
                  : Icons.schedule_send_rounded,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  schedule['body']?.toString().trim().isNotEmpty == true
                      ? schedule['body'].toString().trim()
                      : (payload['media'] != null
                            ? 'Mensagem com mídia'
                            : 'Mensagem programada'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 3),
                Text(
                  '$when${recurrence > 0 ? ' · ${_formatRecurrence(recurrence)}' : ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: wa.textSecondary, fontSize: 12),
                ),
                if (enabled && recurrence > 0 && scheduled != null)
                  _LiveScheduleCountdown(nextAt: scheduled),
                if (quietEnabled)
                  Text(
                    'Pausa ${_minutesAsClock(_asInt(quiet?['startMinutes'], 23 * 60))}–${_minutesAsClock(_asInt(quiet?['endMinutes'], 6 * 60))}',
                    style: TextStyle(
                      color: wa.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                Text(
                  enabled
                      ? 'Ativa'
                      : status == 'dispatched'
                      ? 'Concluída'
                      : status == 'failed'
                      ? 'Falhou · pode reativar'
                      : 'Pausada',
                  style: TextStyle(
                    color: enabled ? wa.accent : wa.textMuted,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '$sentTotal enviado${sentTotal == 1 ? '' : 's'}',
                style: TextStyle(
                  color: wa.accent,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
              if (failedTotal > 0)
                Text(
                  '$failedTotal falha${failedTotal == 1 ? '' : 's'}',
                  style: const TextStyle(
                    color: Colors.orange,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              Switch.adaptive(
                value: enabled,
                onChanged: editable ? onToggle : null,
              ),
            ],
          ),
          PopupMenuButton<String>(
            tooltip: 'Opções da programação',
            onSelected: (value) {
              if (value == 'progress' && run != null) {
                _showRunProgress(
                  context,
                  instanceId,
                  listId,
                  run!,
                  runContacts,
                );
              } else if (value == 'edit') {
                onEdit();
              } else if (value == 'delete') {
                onDelete();
              }
            },
            itemBuilder: (_) => [
              if (run != null)
                const PopupMenuItem(
                  value: 'progress',
                  child: ListTile(
                    leading: Icon(Icons.list_alt_rounded),
                    title: Text('Ver progresso'),
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              const PopupMenuItem(
                value: 'edit',
                child: ListTile(
                  leading: Icon(Icons.edit_calendar_outlined),
                  title: Text('Editar intervalo'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              const PopupMenuItem(
                value: 'delete',
                child: ListTile(
                  leading: Icon(Icons.delete_outline_rounded),
                  title: Text('Excluir programação'),
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

class _LiveScheduleCountdown extends StatefulWidget {
  const _LiveScheduleCountdown({required this.nextAt});
  final DateTime nextAt;

  @override
  State<_LiveScheduleCountdown> createState() => _LiveScheduleCountdownState();
}

class _LiveScheduleCountdownState extends State<_LiveScheduleCountdown> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final seconds = widget.nextAt
        .difference(DateTime.now())
        .inSeconds
        .clamp(0, 2592000);
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Text(
        'Próximo envio em ${_clockDuration(seconds)}',
        style: TextStyle(
          color: wa.accent,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _EmptyBroadcastHistory extends StatelessWidget {
  const _EmptyBroadcastHistory();

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.only(top: 96),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.outgoing_mail, size: 46, color: wa.textMuted),
            const SizedBox(height: 12),
            Text(
              'Nenhum envio nesta lista',
              style: TextStyle(
                color: wa.textPrimary,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              'Os envios e o progresso aparecerão aqui.',
              style: TextStyle(color: wa.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}

enum _SavedMessageActionType { select, create, edit, delete }

class _SavedMessageAction {
  const _SavedMessageAction(this.type, [this.template]);
  final _SavedMessageActionType type;
  final Map<String, dynamic>? template;
}

class _SavedMessagesDialog extends StatelessWidget {
  const _SavedMessagesDialog({
    required this.templates,
    required this.selectedId,
  });
  final List<Map<String, dynamic>> templates;
  final String? selectedId;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final height = MediaQuery.sizeOf(context).height * .72;
    return Dialog(
      backgroundColor: wa.panel,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: SizedBox(
        width: 560,
        height: height.clamp(460, 720),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
              child: Row(
                children: [
                  Icon(Icons.bookmarks_rounded, color: wa.accent),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Mensagens salvas',
                          style: TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          'Selecione uma mensagem ou abra o editor pelo lápis.',
                          style: TextStyle(fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    tooltip: 'Fechar',
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: wa.divider),
            Expanded(
              child: templates.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.chat_bubble_outline_rounded,
                            size: 44,
                            color: wa.textMuted,
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'Nenhuma mensagem salva',
                            style: TextStyle(fontWeight: FontWeight.w800),
                          ),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: templates.length,
                      separatorBuilder: (_, __) =>
                          Divider(height: 1, indent: 72, color: wa.divider),
                      itemBuilder: (context, index) {
                        final template = templates[index];
                        final payload = template['payload'] is Map
                            ? Map<String, dynamic>.from(
                                template['payload'] as Map,
                              )
                            : <String, dynamic>{};
                        final selected =
                            template['id']?.toString() == selectedId;
                        final mediaData = payload['media'] is Map
                            ? Map<String, dynamic>.from(payload['media'] as Map)
                            : null;
                        final media = mediaData != null;
                        final buttonCount = _buttonsFromPayload(
                          payload['buttons'],
                        ).length;
                        final variantCount = _records(
                          payload['messageVariants'],
                        ).length;
                        final summary = [
                          if (media)
                            mediaData['mediaType']?.toString() == 'video'
                                ? 'Vídeo'
                                : 'Mídia',
                          if ((template['body']?.toString().trim() ?? '')
                              .isNotEmpty)
                            'Texto',
                          if (buttonCount > 0)
                            '$buttonCount ${buttonCount == 1 ? 'botão' : 'botões'}',
                          if (variantCount >= 2)
                            '$variantCount variações internas',
                        ].join(' · ');
                        return Material(
                          color: selected ? wa.accentSoft : Colors.transparent,
                          child: ListTile(
                            onTap: () => Navigator.pop(
                              context,
                              _SavedMessageAction(
                                _SavedMessageActionType.select,
                                template,
                              ),
                            ),
                            contentPadding: const EdgeInsets.fromLTRB(
                              16,
                              7,
                              6,
                              7,
                            ),
                            leading: CircleAvatar(
                              backgroundColor: selected
                                  ? wa.accent
                                  : wa.searchBg,
                              foregroundColor: selected
                                  ? Colors.white
                                  : wa.accent,
                              child: Icon(
                                media
                                    ? Icons.perm_media_rounded
                                    : Icons.chat_bubble_outline_rounded,
                              ),
                            ),
                            title: Text(
                              template['name']?.toString() ?? 'Mensagem salva',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            subtitle: Text(
                              summary.isEmpty ? 'Mensagem pronta' : summary,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (selected)
                                  Icon(
                                    Icons.check_circle_rounded,
                                    color: wa.accent,
                                    size: 20,
                                  ),
                                IconButton(
                                  onPressed: () => Navigator.pop(
                                    context,
                                    _SavedMessageAction(
                                      _SavedMessageActionType.edit,
                                      template,
                                    ),
                                  ),
                                  tooltip: 'Editar no preview',
                                  icon: const Icon(Icons.edit_outlined),
                                ),
                                IconButton(
                                  onPressed: () => Navigator.pop(
                                    context,
                                    _SavedMessageAction(
                                      _SavedMessageActionType.delete,
                                      template,
                                    ),
                                  ),
                                  tooltip: 'Excluir mensagem',
                                  icon: const Icon(
                                    Icons.delete_outline_rounded,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
            Divider(height: 1, color: wa.divider),
            Padding(
              padding: const EdgeInsets.all(14),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(
                    context,
                    const _SavedMessageAction(_SavedMessageActionType.create),
                  ),
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('Criar nova mensagem'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BroadcastAdaptiveCard extends StatelessWidget {
  const _BroadcastAdaptiveCard({
    required this.body,
    required this.media,
    required this.buttons,
    required this.compact,
    required this.selected,
    this.fullContent = false,
    this.metaLabel = 'prévia',
    this.deliveryLabel,
    this.onViewProgress,
    this.onEditContent,
  });
  final String body;
  final Map<String, dynamic>? media;
  final List<OutgoingInteractiveButton> buttons;
  final bool compact;
  final bool selected;
  final bool fullContent;
  final String metaLabel;
  final String? deliveryLabel;
  final VoidCallback? onViewProgress;
  final VoidCallback? onEditContent;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final actionColor = wa.isDark
        ? const Color(0xFF8AF5DF)
        : const Color(0xFF008069);
    final card = Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: wa.bubbleOut,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: selected ? wa.accent : wa.divider,
          width: selected ? 2 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .08),
            blurRadius: 5,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (media != null)
            Stack(
              children: [
                SizedBox(
                  height: (selected || fullContent)
                      ? (compact ? 190 : 230)
                      : 120,
                  width: double.infinity,
                  child: _BroadcastMediaPreview(media: media!),
                ),
                if (onEditContent != null)
                  Positioned(
                    right: 8,
                    top: 8,
                    child: _PreviewRoundAction(
                      icon: Icons.edit_rounded,
                      tooltip: 'Editar ou remover mídia',
                      onTap: onEditContent!,
                    ),
                  ),
              ],
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 9),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    body.trim().isEmpty
                        ? 'Mensagem somente com mídia ou botões'
                        : body.trim(),
                    maxLines: (selected || fullContent)
                        ? null
                        : (compact ? 5 : 6),
                    overflow: (selected || fullContent)
                        ? TextOverflow.visible
                        : TextOverflow.ellipsis,
                    style: TextStyle(color: wa.bubbleText, height: 1.3),
                  ),
                ),
                if (onEditContent != null) ...[
                  const SizedBox(width: 6),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    tooltip: 'Editar texto e variáveis',
                    onPressed: onEditContent,
                    icon: Icon(
                      Icons.edit_rounded,
                      size: 17,
                      color: actionColor,
                    ),
                  ),
                ],
              ],
            ),
          ),
          for (final button in buttons) ...[
            Divider(height: 1, color: wa.divider),
            SizedBox(
              height: 42,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    _broadcastButtonIcon(button.type),
                    size: 17,
                    color: actionColor,
                  ),
                  const SizedBox(width: 7),
                  Flexible(
                    child: Text(
                      button.text,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: actionColor,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  if (onEditContent != null) ...[
                    const SizedBox(width: 8),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      tooltip: 'Editar ou remover botão',
                      onPressed: onEditContent,
                      icon: Icon(
                        Icons.edit_rounded,
                        size: 16,
                        color: actionColor,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 4, 10, 7),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Text(
                  '$metaLabel  ✓✓',
                  style: TextStyle(fontSize: 10.5, color: wa.bubbleMeta),
                ),
                if (deliveryLabel != null) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: wa.accentSoft,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      deliveryLabel!,
                      style: TextStyle(
                        color: wa.accent,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
                if (onViewProgress != null)
                  SizedBox.square(
                    dimension: 28,
                    child: PopupMenuButton<String>(
                      padding: EdgeInsets.zero,
                      tooltip: 'Opções do envio',
                      iconSize: 18,
                      icon: Icon(Icons.more_vert_rounded, color: wa.bubbleMeta),
                      onSelected: (_) => onViewProgress!(),
                      itemBuilder: (_) => const [
                        PopupMenuItem(
                          value: 'progress',
                          child: ListTile(
                            leading: Icon(Icons.list_alt_rounded),
                            title: Text('Ver progresso'),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
    if (!compact) return card;
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(bottom: 9),
        constraints: const BoxConstraints(maxWidth: 430),
        child: card,
      ),
    );
  }
}

class _BroadcastMediaPreview extends StatelessWidget {
  const _BroadcastMediaPreview({required this.media});
  final Map<String, dynamic> media;
  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final type = media['mediaType']?.toString() ?? '';
    final url = media['url']?.toString() ?? '';
    if (type == 'image' && url.isNotEmpty)
      return Image.network(
        url,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => _fallback(wa, type),
      );
    if (type == 'video' && url.isNotEmpty) {
      return LayoutBuilder(
        builder: (context, constraints) => ColoredBox(
          color: Colors.black,
          child: InlineVideoPlayer(
            url: url,
            width: constraints.maxWidth,
            height: constraints.maxHeight,
            borderRadius: BorderRadius.zero,
            title: media['fileName']?.toString() ?? 'Vídeo',
          ),
        ),
      );
    }
    return _fallback(wa, type);
  }

  Widget _fallback(WaTheme wa, String type) => ColoredBox(
    color: wa.searchBg,
    child: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(_mediaIcon(type), size: 38, color: wa.icon),
          const SizedBox(height: 6),
          Text(
            media['fileName']?.toString() ?? 'Mídia anexada',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
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

class _PreviewRoundAction extends StatelessWidget {
  const _PreviewRoundAction({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => IconButton.filled(
    onPressed: onTap,
    tooltip: tooltip,
    visualDensity: VisualDensity.compact,
    style: IconButton.styleFrom(
      backgroundColor: Colors.white.withValues(alpha: .92),
      foregroundColor: const Color(0xFF008069),
    ),
    icon: Icon(icon, size: 17),
  );
}

class _BroadcastMessageEditorResult {
  const _BroadcastMessageEditorResult({
    required this.templateId,
    required this.name,
    required this.body,
    required this.media,
    required this.buttons,
    required this.variables,
    required this.messageVariants,
  });
  final String? templateId;
  final String name;
  final String body;
  final Map<String, dynamic>? media;
  final List<OutgoingInteractiveButton> buttons;
  final List<Map<String, dynamic>> variables;
  final List<Map<String, dynamic>> messageVariants;
}

class _BroadcastVariantDraft {
  _BroadcastVariantDraft({
    required this.label,
    required this.body,
    required this.media,
    required this.buttons,
    required this.variables,
  });

  String label;
  String body;
  Map<String, dynamic>? media;
  List<OutgoingInteractiveButton> buttons;
  List<Map<String, dynamic>> variables;

  _BroadcastVariantDraft copyWithLabel(String nextLabel) =>
      _BroadcastVariantDraft(
        label: nextLabel,
        body: body,
        media: media == null ? null : Map<String, dynamic>.from(media!),
        buttons: buttons
            .map(
              (item) => OutgoingInteractiveButton(
                id: item.id,
                text: item.text,
                type: item.type,
                url: item.url,
                copyCode: item.copyCode,
              ),
            )
            .toList(),
        variables: variables
            .map((item) => Map<String, dynamic>.from(item))
            .toList(),
      );

  Map<String, dynamic> toJson() => {
    'name': label,
    'body': body.trim(),
    if (media != null) 'media': media,
    if (buttons.isNotEmpty)
      'buttons': buttons.map((item) => item.toJson()).toList(),
    if (variables.isNotEmpty) 'variables': variables,
  };
}

class _BroadcastMessageEditorDialog extends ConsumerStatefulWidget {
  const _BroadcastMessageEditorDialog({
    required this.instanceId,
    required this.listId,
    required this.template,
    required this.contacts,
  });
  final int instanceId;
  final String listId;
  final Map<String, dynamic>? template;
  final List<Map<String, dynamic>> contacts;

  @override
  ConsumerState<_BroadcastMessageEditorDialog> createState() =>
      _BroadcastMessageEditorDialogState();
}

class _BroadcastMessageEditorDialogState
    extends ConsumerState<_BroadcastMessageEditorDialog> {
  late String name;
  final List<_BroadcastVariantDraft> drafts = [];
  int activeDraft = 0;
  bool uploading = false;

  _BroadcastVariantDraft get draft => drafts[activeDraft];
  String get body => draft.body;
  set body(String value) => draft.body = value;
  Map<String, dynamic>? get media => draft.media;
  set media(Map<String, dynamic>? value) => draft.media = value;
  List<OutgoingInteractiveButton> get buttons => draft.buttons;
  List<Map<String, dynamic>> get variables => draft.variables;
  set variables(List<Map<String, dynamic>> value) => draft.variables = value;

  @override
  void initState() {
    super.initState();
    final template = widget.template;
    final payload = template?['payload'] is Map
        ? Map<String, dynamic>.from(template!['payload'] as Map)
        : <String, dynamic>{};
    name = template?['name']?.toString().trim() ?? '';
    if (name.isEmpty) name = 'Nova mensagem';
    final storedVariants = _records(payload['messageVariants']);
    if (storedVariants.length >= 2) {
      for (var index = 0; index < storedVariants.length; index++) {
        final item = storedVariants[index];
        drafts.add(
          _BroadcastVariantDraft(
            label: item['name']?.toString().trim().isNotEmpty == true
                ? item['name'].toString().trim()
                : (index == 0 ? 'Principal' : 'Variação $index'),
            body: item['body']?.toString() ?? '',
            media: item['media'] is Map
                ? Map<String, dynamic>.from(item['media'] as Map)
                : null,
            buttons: _buttonsFromPayload(item['buttons']),
            variables: _records(item['variables']),
          ),
        );
      }
    } else {
      drafts.add(
        _BroadcastVariantDraft(
          label: 'Principal',
          body: template?['body']?.toString() ?? '',
          media: payload['media'] is Map
              ? Map<String, dynamic>.from(payload['media'] as Map)
              : null,
          buttons: _buttonsFromPayload(payload['buttons']),
          variables: _records(payload['variables']),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final size = MediaQuery.sizeOf(context);
    final height = (size.height - 36).clamp(560.0, 780.0);
    final headerBg = wa.isDark
        ? const Color(0xFF1F2C33)
        : const Color(0xFF008069);
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(10),
      child: Container(
        width: 620,
        height: height,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: wa.panel,
          border: Border.all(color: wa.border, width: 1),
          borderRadius: BorderRadius.circular(22),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: .28),
              blurRadius: 28,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Column(
          children: [
            Container(
              color: headerBg,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              child: Row(
                children: [
                  IconButton(
                    onPressed: uploading ? null : () => Navigator.pop(context),
                    tooltip: 'Fechar',
                    icon: const Icon(Icons.close_rounded, color: Colors.white),
                  ),
                  Expanded(
                    child: InkWell(
                      onTap: _editName,
                      borderRadius: BorderRadius.circular(8),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Row(
                          children: [
                            Flexible(
                              child: Text(
                                'Editor · $name · ${draft.label}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            const SizedBox(width: 5),
                            const Icon(
                              Icons.edit_rounded,
                              color: Colors.white70,
                              size: 15,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: uploading ? null : _save,
                    tooltip: 'Salvar mensagem',
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: const Color(0xFF008069),
                    ),
                    icon: uploading
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.check_rounded),
                  ),
                ],
              ),
            ),
            ColoredBox(
              color: wa.panel,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _BroadcastEditorControl(
                            label: media == null
                                ? 'Adicionar mídia'
                                : 'Mídia pronta',
                            icon: media == null
                                ? Icons.add_a_photo_outlined
                                : Icons.check_circle_rounded,
                            active: media != null,
                            onTap: uploading ? null : _pickMedia,
                          ),
                        ),
                        const SizedBox(width: 7),
                        Expanded(
                          child: _BroadcastEditorControl(
                            label: variables.isEmpty
                                ? 'Variáveis'
                                : '${variables.length} variáveis',
                            icon: Icons.data_object_rounded,
                            active: variables.isNotEmpty,
                            onTap: _editVariables,
                          ),
                        ),
                        const SizedBox(width: 7),
                        Expanded(
                          child: _BroadcastEditorControl(
                            label: drafts.length == 1
                                ? 'Criar variação'
                                : '${drafts.length} variações',
                            icon: Icons.shuffle_rounded,
                            active: drafts.length > 1,
                            onTap: _addVariant,
                          ),
                        ),
                      ],
                    ),
                    if (drafts.length > 1) ...[
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 38,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: drafts.length + 1,
                          separatorBuilder: (_, _) => const SizedBox(width: 6),
                          itemBuilder: (context, index) {
                            if (index == drafts.length) {
                              return ActionChip(
                                avatar: const Icon(Icons.add_rounded, size: 17),
                                label: const Text('Copiar esta'),
                                onPressed: _addVariant,
                              );
                            }
                            final selected = activeDraft == index;
                            return InputChip(
                              selected: selected,
                              avatar: Icon(
                                index == 0
                                    ? Icons.star_outline_rounded
                                    : Icons.shuffle_rounded,
                                size: 16,
                              ),
                              label: Text(drafts[index].label),
                              onSelected: (_) =>
                                  setState(() => activeDraft = index),
                              onPressed: () =>
                                  setState(() => activeDraft = index),
                              onDeleted: index == 0
                                  ? null
                                  : () => _removeVariant(index),
                              deleteButtonTooltipMessage: 'Excluir variação',
                            );
                          },
                        ),
                      ),
                    ],
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
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: wa.bubbleIn,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: wa.border.withValues(alpha: .55),
                          ),
                        ),
                        child: Column(
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
                            if (media != null)
                              Stack(
                                children: [
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(8),
                                    child: SizedBox(
                                      height: 150,
                                      width: double.infinity,
                                      child: _BroadcastMediaPreview(
                                        media: media!,
                                      ),
                                    ),
                                  ),
                                  Positioned(
                                    right: 7,
                                    top: 7,
                                    child: Row(
                                      children: [
                                        _PreviewRoundAction(
                                          icon: Icons.add_a_photo_rounded,
                                          tooltip: 'Trocar mídia',
                                          onTap: _pickMedia,
                                        ),
                                        const SizedBox(width: 5),
                                        _PreviewRoundAction(
                                          icon: Icons.delete_outline_rounded,
                                          tooltip: 'Remover mídia',
                                          onTap: () =>
                                              setState(() => media = null),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              )
                            else
                              InkWell(
                                onTap: _pickMedia,
                                borderRadius: BorderRadius.circular(8),
                                child: Container(
                                  height: 88,
                                  width: double.infinity,
                                  decoration: BoxDecoration(
                                    color: wa.searchBg,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: wa.divider),
                                  ),
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Icon(
                                        Icons.add_photo_alternate_outlined,
                                        color: wa.icon,
                                        size: 28,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Adicionar mídia opcional',
                                        style: TextStyle(
                                          color: wa.textSecondary,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            const SizedBox(height: 8),
                            InkWell(
                              onTap: _editBody,
                              borderRadius: BorderRadius.circular(8),
                              child: Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(9),
                                decoration: BoxDecoration(
                                  color: wa.isDark
                                      ? const Color(0xFF1A252B)
                                      : const Color(0xFFF5F6F6),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: wa.border.withValues(alpha: .45),
                                  ),
                                ),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        body.trim().isEmpty
                                            ? 'Toque para escrever a mensagem'
                                            : body.trim(),
                                        style: TextStyle(
                                          color: body.trim().isEmpty
                                              ? wa.textMuted
                                              : wa.bubbleText,
                                          height: 1.35,
                                        ),
                                      ),
                                    ),
                                    _PreviewRoundAction(
                                      icon: Icons.edit_rounded,
                                      tooltip: 'Editar texto',
                                      onTap: _editBody,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            for (var index = 0; index < buttons.length; index++)
                              _BroadcastEditorButtonRow(
                                button: buttons[index],
                                onEdit: () => _editButton(index),
                                onDelete: () =>
                                    setState(() => buttons.removeAt(index)),
                              ),
                            if (buttons.length < 3)
                              _BroadcastEditorAddButton(onTap: _addButton),
                            Align(
                              alignment: Alignment.centerRight,
                              child: Text(
                                '11:14',
                                style: TextStyle(
                                  color: wa.bubbleMeta,
                                  fontSize: 11,
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
          ],
        ),
      ),
    );
  }

  void _addVariant() {
    if (drafts.length >= 12) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Use no máximo 12 variações por modelo.')),
      );
      return;
    }
    setState(() {
      drafts.add(draft.copyWithLabel('Variação ${drafts.length}'));
      activeDraft = drafts.length - 1;
    });
  }

  void _removeVariant(int index) {
    if (index <= 0 || index >= drafts.length) return;
    setState(() {
      drafts.removeAt(index);
      if (activeDraft >= drafts.length) activeDraft = drafts.length - 1;
      if (activeDraft > index) activeDraft -= 1;
    });
  }

  Future<void> _editName() async {
    final value = await _editBroadcastString(
      context,
      title: 'Nome da mensagem',
      label: 'Nome para encontrar na lista',
      value: name,
      maxLines: 1,
    );
    if (value != null && value.trim().isNotEmpty) {
      setState(() => name = value.trim());
    }
  }

  Future<void> _editBody() async {
    final value = await _editBroadcastString(
      context,
      title: 'Editar mensagem',
      label: 'Texto da mensagem',
      value: body,
      maxLines: 12,
      variableNames: [
        'nome',
        'pushName',
        'numero',
        'localizacao',
        'detalhes',
        ...variables.map((item) => item['name']?.toString() ?? ''),
      ],
    );
    if (value != null) setState(() => body = value);
  }

  Future<void> _pickMedia() async {
    final file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: 'Mídia',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'mov',
            'mkv',
            'mp3',
            'ogg',
            'opus',
            'pdf',
          ],
        ),
      ],
    );
    if (file == null) return;
    final mime = _mimeFor(file.name);
    final kind = mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
        ? 'audio'
        : 'document';
    setState(() => uploading = true);
    try {
      final uploaded = await ref
          .read(apiClientProvider)
          .uploadBroadcastMedia(
            widget.instanceId,
            widget.listId,
            bytes: await file.readAsBytes(),
            fileName: file.name,
            mimeType: mime,
            mediaType: kind,
          );
      if (mounted) setState(() => media = uploaded);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não consegui anexar a mídia: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => uploading = false);
    }
  }

  Future<void> _editVariables() async {
    final values = await showDialog<List<Map<String, dynamic>>>(
      context: context,
      builder: (_) => _VariablesDialog(
        initial: variables,
        contacts: widget.contacts,
        onPreview: (values) => ref
            .read(apiClientProvider)
            .previewBroadcastVariables(
              widget.instanceId,
              widget.listId,
              body: body,
              variables: values,
            ),
      ),
    );
    if (values != null && mounted) setState(() => variables = values);
  }

  Future<void> _addButton() async {
    final value = await showDialog<OutgoingInteractiveButton>(
      context: context,
      builder: (_) =>
          _SingleBroadcastButtonDialog(initial: null, index: buttons.length),
    );
    if (value != null && mounted) setState(() => buttons.add(value));
  }

  Future<void> _editButton(int index) async {
    final value = await showDialog<OutgoingInteractiveButton>(
      context: context,
      builder: (_) =>
          _SingleBroadcastButtonDialog(initial: buttons[index], index: index),
    );
    if (value != null && mounted) setState(() => buttons[index] = value);
  }

  void _save() {
    final invalidVariant = drafts.any(
      (item) =>
          item.body.trim().isEmpty &&
          item.media == null &&
          item.buttons.isEmpty,
    );
    if (name.trim().isEmpty || invalidVariant) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Informe o nome e algum conteúdo em todas as variações.',
          ),
        ),
      );
      return;
    }
    final primary = drafts.first;
    Navigator.pop(
      context,
      _BroadcastMessageEditorResult(
        templateId: widget.template?['id']?.toString(),
        name: name.trim(),
        body: primary.body.trim(),
        media: primary.media,
        buttons: primary.buttons,
        variables: primary.variables,
        messageVariants: drafts.length >= 2
            ? drafts.map((item) => item.toJson()).toList()
            : const [],
      ),
    );
  }
}

class _BroadcastEditorControl extends StatelessWidget {
  const _BroadcastEditorControl({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });
  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Material(
      color: active ? wa.accentSoft : wa.searchBg,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          child: Row(
            children: [
              Icon(icon, size: 18, color: active ? wa.accent : wa.icon),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
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

class _BroadcastEditorButtonRow extends StatelessWidget {
  const _BroadcastEditorButtonRow({
    required this.button,
    required this.onEdit,
    required this.onDelete,
  });
  final OutgoingInteractiveButton button;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 7),
      decoration: BoxDecoration(
        border: Border.all(color: wa.divider),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const SizedBox(width: 10),
          Icon(_broadcastButtonIcon(button.type), size: 17, color: wa.accent),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              button.text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: wa.accent, fontWeight: FontWeight.w800),
            ),
          ),
          IconButton(
            onPressed: onEdit,
            tooltip: 'Editar botão',
            icon: const Icon(Icons.edit_outlined, size: 17),
          ),
          IconButton(
            onPressed: onDelete,
            tooltip: 'Excluir botão',
            icon: const Icon(Icons.delete_outline_rounded, size: 17),
          ),
        ],
      ),
    );
  }
}

class _BroadcastEditorAddButton extends StatelessWidget {
  const _BroadcastEditorAddButton({required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        color: wa.accentSoft,
        border: Border.all(color: wa.accent.withValues(alpha: .4)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: TextButton.icon(
        onPressed: onTap,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Adicionar outro botão'),
      ),
    );
  }
}

class _SingleBroadcastButtonDialog extends StatefulWidget {
  const _SingleBroadcastButtonDialog({
    required this.initial,
    required this.index,
  });
  final OutgoingInteractiveButton? initial;
  final int index;
  @override
  State<_SingleBroadcastButtonDialog> createState() =>
      _SingleBroadcastButtonDialogState();
}

class _SingleBroadcastButtonDialogState
    extends State<_SingleBroadcastButtonDialog> {
  late final TextEditingController text;
  late final TextEditingController extra;
  late String type;
  @override
  void initState() {
    super.initState();
    text = TextEditingController(text: widget.initial?.text ?? '');
    type = widget.initial?.type ?? 'quick_reply';
    extra = TextEditingController(
      text: type == 'cta_url'
          ? widget.initial?.url ?? ''
          : widget.initial?.copyCode ?? '',
    );
  }

  @override
  void dispose() {
    text.dispose();
    extra.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.initial == null ? 'Adicionar botão' : 'Editar botão'),
    content: SizedBox(
      width: 440,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: text,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Texto do botão'),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: type,
            decoration: const InputDecoration(labelText: 'Ação'),
            items: const [
              DropdownMenuItem(
                value: 'quick_reply',
                child: Text('Resposta rápida'),
              ),
              DropdownMenuItem(value: 'cta_url', child: Text('Abrir link')),
              DropdownMenuItem(value: 'cta_copy', child: Text('Copiar código')),
            ],
            onChanged: (value) => setState(() {
              type = value ?? 'quick_reply';
              extra.clear();
            }),
          ),
          if (type == 'cta_url' || type == 'cta_copy') ...[
            const SizedBox(height: 10),
            TextField(
              controller: extra,
              decoration: InputDecoration(
                labelText: type == 'cta_url' ? 'Link' : 'Código para copiar',
              ),
            ),
          ],
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
          if (text.text.trim().isEmpty) return;
          Navigator.pop(
            context,
            OutgoingInteractiveButton(
              id: widget.initial?.id ?? 'broadcast_${widget.index + 1}',
              text: text.text.trim(),
              type: type,
              url: type == 'cta_url' ? extra.text.trim() : null,
              copyCode: type == 'cta_copy' ? extra.text.trim() : null,
            ),
          );
        },
        child: const Text('Aplicar'),
      ),
    ],
  );
}

Future<String?> _editBroadcastString(
  BuildContext context, {
  required String title,
  required String label,
  required String value,
  required int maxLines,
  List<String> variableNames = const [],
}) async {
  final controller = TextEditingController(text: value);
  final availableVariables = variableNames
      .map((item) => item.trim())
      .where((item) => item.isNotEmpty)
      .toSet()
      .toList();
  void insertVariable(String name) {
    final token = '{{$name}}';
    final selection = controller.selection;
    final start = selection.isValid ? selection.start : controller.text.length;
    final end = selection.isValid ? selection.end : controller.text.length;
    controller.text = controller.text.replaceRange(start, end, token);
    controller.selection = TextSelection.collapsed(
      offset: start + token.length,
    );
  }

  final result = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 520,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: controller,
              autofocus: true,
              minLines: maxLines == 1 ? 1 : 7,
              maxLines: maxLines,
              decoration: InputDecoration(
                labelText: label,
                suffixIcon: availableVariables.isEmpty
                    ? null
                    : PopupMenuButton<String>(
                        tooltip: 'Inserir variável',
                        icon: const Icon(Icons.data_object_rounded),
                        onSelected: insertVariable,
                        itemBuilder: (_) => availableVariables
                            .map(
                              (name) => PopupMenuItem(
                                value: name,
                                child: Row(
                                  children: [
                                    const Icon(Icons.add_rounded, size: 18),
                                    const SizedBox(width: 7),
                                    Text('{{$name}}'),
                                  ],
                                ),
                              ),
                            )
                            .toList(),
                      ),
              ),
            ),
            if (availableVariables.isNotEmpty) ...[
              const SizedBox(height: 7),
              const Text(
                'Use o botão { } no canto do editor para inserir uma variável na posição do cursor.',
                style: TextStyle(fontSize: 11),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, controller.text),
          child: const Text('Aplicar'),
        ),
      ],
    ),
  );
  controller.dispose();
  return result;
}

class _CreateListSheet extends ConsumerStatefulWidget {
  const _CreateListSheet({required this.instanceId});
  final int instanceId;
  @override
  ConsumerState<_CreateListSheet> createState() => _CreateListSheetState();
}

class _CreateListSheetState extends ConsumerState<_CreateListSheet> {
  final _name = TextEditingController();
  final _description = TextEditingController();
  final Map<String, Map<String, dynamic>> _contacts = {};
  String _googleSheetUrl = '';
  Map<String, dynamic>? _googleSheetMapping;
  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _ContactSheetFrame(
    title: 'Nova lista de transmissão',
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        TextField(
          controller: _name,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Nome da lista',
            hintText: 'Ex.: Clientes recorrentes',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _description,
          maxLines: 2,
          decoration: const InputDecoration(labelText: 'Descrição (opcional)'),
        ),
        const SizedBox(height: 18),
        _ContactSources(
          instanceId: widget.instanceId,
          contacts: _contacts,
          onChanged: () => setState(() {}),
          googleSheetUrl: _googleSheetUrl,
          googleSheetMapping: _googleSheetMapping,
          onGoogleSheetSelected: (item) => setState(() {
            _googleSheetUrl = item.url;
            _googleSheetMapping = item.mapping;
          }),
        ),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: _name.text.trim().isEmpty
              ? null
              : () => Navigator.pop(
                  context,
                  _CreateListDraft(
                    _name.text.trim(),
                    _description.text.trim(),
                    _contacts.values.toList(),
                    _googleSheetUrl,
                    _googleSheetMapping,
                  ),
                ),
          child: Text('Criar lista com ${_contacts.length} destinatário(s)'),
        ),
      ],
    ),
  );
}

class _ContactImportSheet extends ConsumerStatefulWidget {
  const _ContactImportSheet({required this.instanceId});
  final int instanceId;
  @override
  ConsumerState<_ContactImportSheet> createState() =>
      _ContactImportSheetState();
}

class _ContactImportSheetState extends ConsumerState<_ContactImportSheet> {
  final Map<String, Map<String, dynamic>> _contacts = {};
  String _googleSheetUrl = '';
  Map<String, dynamic>? _googleSheetMapping;
  @override
  Widget build(BuildContext context) => _ContactSheetFrame(
    title: 'Adicionar destinatários',
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        _ContactSources(
          instanceId: widget.instanceId,
          contacts: _contacts,
          onChanged: () => setState(() {}),
          googleSheetUrl: _googleSheetUrl,
          googleSheetMapping: _googleSheetMapping,
          onGoogleSheetSelected: (item) => setState(() {
            _googleSheetUrl = item.url;
            _googleSheetMapping = item.mapping;
          }),
        ),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: (_contacts.isEmpty && _googleSheetUrl.isEmpty)
              ? null
              : () => Navigator.pop(
                  context,
                  _ContactImportDraft(
                    _contacts.values.toList(),
                    _googleSheetUrl,
                    _googleSheetMapping,
                  ),
                ),
          child: Text('Adicionar ${_contacts.length} destinatário(s)'),
        ),
      ],
    ),
  );
}

class _ContactSources extends ConsumerWidget {
  const _ContactSources({
    required this.instanceId,
    required this.contacts,
    required this.onChanged,
    required this.googleSheetUrl,
    required this.googleSheetMapping,
    required this.onGoogleSheetSelected,
  });
  final int instanceId;
  final Map<String, Map<String, dynamic>> contacts;
  final VoidCallback onChanged;
  final String googleSheetUrl;
  final Map<String, dynamic>? googleSheetMapping;
  final ValueChanged<_GoogleSheetSelection> onGoogleSheetSelected;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    final loaded = ref.watch(instanceContactsProvider(instanceId));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Fontes de destinatários',
          style: TextStyle(
            color: wa.textPrimary,
            fontWeight: FontWeight.w900,
            fontSize: 16,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Combine contatos, grupos, arquivo CSV/JSON, números manuais e Google Sheets. Contatos e grupos repetidos são combinados automaticamente.',
          style: TextStyle(color: wa.textSecondary, height: 1.35),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => _selectInstanceContacts(context, ref, loaded),
          icon: const Icon(Icons.contacts_outlined),
          label: const Text('Selecionar contatos da instância'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _selectInstanceGroups(context, ref),
          icon: const Icon(Icons.groups_2_outlined),
          label: const Text('Selecionar grupos da instância'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _discoverAndJoinGroups(context),
          icon: const Icon(Icons.travel_explore_rounded),
          label: const Text('Procurar grupos'),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _importFile(context),
                icon: const Icon(Icons.upload_file_outlined),
                label: const Text('Importar CSV ou JSON'),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.outlined(
              onPressed: () => _showTemplate(context),
              icon: const Icon(Icons.help_outline_rounded),
              tooltip: 'Modelo de importação',
            ),
          ],
        ),
        const SizedBox(height: 10),
        const _GoogleSheetsConnectionTile(),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () async {
            final item = await showDialog<_GoogleSheetSelection>(
              context: context,
              builder: (_) => _GoogleSheetsMapDialog(
                initialUrl: googleSheetUrl,
                initialMapping: googleSheetMapping,
              ),
            );
            if (item != null) onGoogleSheetSelected(item);
          },
          icon: const Icon(Icons.table_chart_outlined),
          label: Text(
            googleSheetUrl.isEmpty
                ? 'Importar e mapear Google Sheets'
                : 'Planilha mapeada · editar',
          ),
        ),
        if (googleSheetUrl.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              '${_asInt(googleSheetMapping?['estimatedContacts'])} contato(s) encontrado(s) · ${_asStringList(googleSheetMapping?['attributeColumns']).length} variável(is) adicional(is).',
              style: TextStyle(color: wa.textSecondary, fontSize: 12),
            ),
          ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () async {
            final contact = await showDialog<Map<String, dynamic>>(
              context: context,
              builder: (_) => const _ManualContactDialog(),
            );
            if (contact != null) {
              contacts[_phoneKey(contact['phone']?.toString() ?? '')] = contact;
              onChanged();
            }
          },
          icon: const Icon(Icons.person_add_alt_1_rounded),
          label: const Text('Adicionar contato manualmente'),
        ),
        if (contacts.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                ...contacts.entries
                    .take(12)
                    .map(
                      (entry) => InputChip(
                        label: Text(
                          entry.value['name']?.toString().isNotEmpty == true
                              ? entry.value['name'].toString()
                              : _formatPhone(
                                  entry.value['phone']?.toString() ?? '',
                                ),
                        ),
                        onDeleted: () {
                          contacts.remove(entry.key);
                          onChanged();
                        },
                      ),
                    ),
                if (contacts.length > 12)
                  Chip(label: Text('+${contacts.length - 12}')),
              ],
            ),
          ),
      ],
    );
  }

  Future<void> _selectInstanceContacts(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<List<WhatsAppContact>> loaded,
  ) async {
    final values = await loaded.when(
      data: (contacts) async => showBotAdminBottomSheet<List<WhatsAppContact>>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _InstanceContactPicker(
          contacts: contacts,
          onOrganize: (selected) =>
              _organizeInstanceContacts(context, ref, selected),
        ),
      ),
      loading: () => Future.value(null),
      error: (_, __) => Future.value(null),
    );
    if (values == null) return;
    for (final value in values) {
      final phone = _contactPhone(value);
      if (phone != null)
        contacts[_phoneKey(phone)] = {
          'name': value.displayName,
          'phone': phone,
          'source': 'instance',
        };
    }
    onChanged();
  }

  Future<void> _organizeInstanceContacts(
    BuildContext context,
    WidgetRef ref,
    List<WhatsAppContact> selected,
  ) async {
    if (selected.isEmpty) return;
    try {
      final lists = await ref
          .read(apiClientProvider)
          .loadBroadcastLists(instanceId);
      if (!context.mounted) return;
      final draft = await showDialog<_ContactLabelsDraft>(
        context: context,
        builder: (_) => _ContactLabelsDialog(lists: lists),
      );
      if (draft == null) return;
      final recipients = selected
          .map((contact) {
            final phone = _contactPhone(contact);
            if (phone == null) return null;
            return <String, dynamic>{
              'name': contact.displayName,
              'phone': phone,
              'source': 'instance_label',
            };
          })
          .whereType<Map<String, dynamic>>()
          .toList();
      if (recipients.isEmpty) return;
      for (final listId in draft.listIds) {
        await ref
            .read(apiClientProvider)
            .importBroadcastContacts(instanceId, listId, contacts: recipients);
      }
      if (draft.newLabel.trim().isNotEmpty) {
        await ref
            .read(apiClientProvider)
            .createBroadcastList(
              instanceId,
              name: draft.newLabel.trim(),
              description: 'Etiqueta de contatos',
              contacts: recipients,
            );
      }
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${recipients.length} contato(s) organizado(s) em ${draft.listIds.length + (draft.newLabel.trim().isEmpty ? 0 : 1)} etiqueta(s).',
          ),
        ),
      );
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Não consegui aplicar as etiquetas: $error')),
      );
    }
  }

  Future<void> _selectInstanceGroups(
    BuildContext context,
    WidgetRef ref,
  ) async {
    try {
      final groups = await ref
          .read(apiClientProvider)
          .loadInstanceGroups(instanceId);
      if (!context.mounted) return;
      final values = await showBotAdminBottomSheet<List<Map<String, dynamic>>>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (_) => _InstanceGroupPicker(groups: groups),
      );
      if (values == null) return;
      for (final value in values) {
        final jid = value['remoteId']?.toString().trim() ?? '';
        if (jid.isEmpty) continue;
        contacts['group:$jid'] = value;
      }
      onChanged();
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Não consegui carregar os grupos: $error')),
      );
    }
  }

  Future<void> _discoverAndJoinGroups(BuildContext context) async {
    final values = await showBotAdminBottomSheet<List<Map<String, dynamic>>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _PublicGroupJoinSheet(instanceId: instanceId),
    );
    if (values == null || values.isEmpty) return;
    for (final value in values) {
      final jid = value['remoteId']?.toString().trim() ?? '';
      if (jid.isEmpty) continue;
      contacts['group:$jid'] = value;
    }
    onChanged();
  }

  Future<void> _importFile(BuildContext context) async {
    final file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(label: 'Contatos', extensions: ['csv', 'json', 'txt']),
      ],
    );
    if (file == null) return;
    try {
      final parsed = _parseImportedContacts(await file.readAsString());
      for (final contact in parsed) {
        contacts[_phoneKey(contact['phone']?.toString() ?? '')] = contact;
      }
      onChanged();
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${parsed.length} contato(s) lido(s).')),
        );
    } catch (_) {
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Não consegui ler o arquivo. Use CSV ou JSON.'),
          ),
        );
    }
  }

  void _showTemplate(BuildContext context) {
    showBotAdminBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Modelo de importação',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 10),
            const SelectableText(
              'nome,telefone,localizacao,detalhes\nMaria Silva,5592999999999,Manaus - AM,Cliente premium',
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () {
                Clipboard.setData(
                  const ClipboardData(
                    text:
                        'nome,telefone,localizacao,detalhes\nMaria Silva,5592999999999,Manaus - AM,Cliente premium',
                  ),
                );
                Navigator.pop(context);
              },
              icon: const Icon(Icons.copy_rounded),
              label: const Text('Copiar modelo'),
            ),
          ],
        ),
      ),
    );
  }
}

class _GoogleSheetsConnectionTile extends ConsumerStatefulWidget {
  const _GoogleSheetsConnectionTile();
  @override
  ConsumerState<_GoogleSheetsConnectionTile> createState() =>
      _GoogleSheetsConnectionTileState();
}

class _GoogleSheetsConnectionTileState
    extends ConsumerState<_GoogleSheetsConnectionTile> {
  Map<String, dynamic>? connection;
  bool loading = true;
  Timer? poller;
  @override
  void initState() {
    super.initState();
    load();
    poller = Timer.periodic(
      const Duration(seconds: 3),
      (_) => load(silent: true),
    );
  }

  @override
  void dispose() {
    poller?.cancel();
    super.dispose();
  }

  Future<void> load({bool silent = false}) async {
    try {
      final value = await ref
          .read(apiClientProvider)
          .getGoogleSheetsConnection();
      if (mounted) setState(() => connection = value);
    } catch (_) {
    } finally {
      if (mounted && !silent) setState(() => loading = false);
    }
  }

  Future<void> connect() async {
    try {
      final url = await ref
          .read(apiClientProvider)
          .createGoogleSheetsAuthorizationUrl();
      final opened = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.platformDefault,
        webOnlyWindowName: '_blank',
      );
      if (!opened && mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Não foi possível abrir a conexão com Google Sheets.',
            ),
          ),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Não consegui iniciar a conexão Google: $error'),
          ),
        );
    }
  }

  Future<void> disconnect() async {
    await ref.read(apiClientProvider).disconnectGoogleSheets();
    await load();
  }

  @override
  Widget build(BuildContext context) {
    final email = connection?['email']?.toString() ?? '';
    if (loading)
      return const Padding(
        padding: EdgeInsets.only(top: 6),
        child: LinearProgressIndicator(minHeight: 2),
      );
    if (email.isEmpty)
      return Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          onPressed: connect,
          icon: const Icon(Icons.link_rounded, size: 18),
          label: const Text('Conectar minha conta Google Sheets'),
        ),
      );
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.green.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.green.withValues(alpha: .32)),
      ),
      child: Row(
        children: [
          const Icon(Icons.verified_rounded, color: Colors.green, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Google Sheets conectado',
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
                Text(
                  email,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: connect,
            tooltip: 'Reconectar',
            icon: const Icon(Icons.sync_rounded, size: 19),
          ),
          IconButton(
            onPressed: disconnect,
            tooltip: 'Desconectar',
            icon: const Icon(Icons.link_off_rounded, size: 19),
          ),
        ],
      ),
    );
  }
}

class _ManualContactDialog extends StatefulWidget {
  const _ManualContactDialog();
  @override
  State<_ManualContactDialog> createState() => _ManualContactDialogState();
}

class _ManualContactDialogState extends State<_ManualContactDialog> {
  final name = TextEditingController();
  final phone = TextEditingController();
  @override
  void dispose() {
    name.dispose();
    phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Adicionar contato'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: name,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Nome (opcional)'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: phone,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(
            labelText: 'Telefone com DDI',
            hintText: '5592999999999',
          ),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: () {
          final value = _digits(phone.text);
          if (value.length < 10) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Informe um telefone válido.')),
            );
            return;
          }
          Navigator.pop(context, {
            'name': name.text.trim(),
            'phone': value,
            'source': 'manual',
          });
        },
        child: const Text('Adicionar'),
      ),
    ],
  );
}

class _GoogleSheetsMapDialog extends ConsumerStatefulWidget {
  const _GoogleSheetsMapDialog({required this.initialUrl, this.initialMapping});
  final String initialUrl;
  final Map<String, dynamic>? initialMapping;
  @override
  ConsumerState<_GoogleSheetsMapDialog> createState() =>
      _GoogleSheetsMapDialogState();
}

class _GoogleSheetsMapDialogState
    extends ConsumerState<_GoogleSheetsMapDialog> {
  late final TextEditingController url;
  Map<String, dynamic>? preview;
  bool loading = false;
  bool filesLoading = true;
  bool validatingMapping = false;
  List<Map<String, dynamic>> files = [];
  String? filesError,
      mappingError,
      selectedFileId,
      sheetId,
      nameColumn,
      phoneColumn;
  int? mappedContacts;
  Timer? mappingDebounce;
  final selectedAttributes = <String>{};

  @override
  void initState() {
    super.initState();
    url = TextEditingController(text: widget.initialUrl);
    sheetId = widget.initialMapping?['sheetId']?.toString();
    nameColumn = widget.initialMapping?['nameColumn']?.toString();
    phoneColumn = widget.initialMapping?['phoneColumn']?.toString();
    selectedAttributes.addAll(
      _asStringList(widget.initialMapping?['attributeColumns']),
    );
    unawaited(_loadFiles());
  }

  @override
  void dispose() {
    mappingDebounce?.cancel();
    url.dispose();
    super.dispose();
  }

  String? _guess(List<String> headers, List<String> terms) {
    for (final header in headers) {
      final normalized = header.toLowerCase();
      if (terms.any(normalized.contains)) return header;
    }
    return null;
  }

  Future<void> _loadFiles() async {
    try {
      final data = await ref.read(apiClientProvider).listGoogleSpreadsheets();
      if (mounted) setState(() => files = _records(data['files']));
    } catch (error) {
      if (mounted) setState(() => filesError = error.toString());
    } finally {
      if (mounted) setState(() => filesLoading = false);
    }
  }

  Future<void> _selectFile(String value) async {
    final matches = files.where((item) => item['id']?.toString() == value);
    if (matches.isEmpty) return;
    final file = matches.first;
    setState(() {
      selectedFileId = value;
      url.text =
          file['url']?.toString() ??
          'https://docs.google.com/spreadsheets/d/$value/edit';
    });
    await _open();
  }

  Future<void> _open({String? nextSheet}) async {
    if (url.text.trim().isEmpty) return;
    setState(() => loading = true);
    try {
      final map = <String, dynamic>{
        if ((nextSheet ?? sheetId)?.isNotEmpty == true)
          'sheetId': nextSheet ?? sheetId,
      };
      final data = await ref
          .read(apiClientProvider)
          .previewGoogleSheet(url.text.trim(), mapping: map);
      if (!mounted) return;
      final headers = _asStringList(data['headers']);
      setState(() {
        preview = data;
        sheetId = data['sheetId']?.toString();
        nameColumn = headers.contains(nameColumn)
            ? nameColumn
            : (_guess(headers, ['nome', 'name', 'cliente', 'contato']) ??
                  (headers.isEmpty ? null : headers.first));
        phoneColumn = headers.contains(phoneColumn)
            ? phoneColumn
            : (_guess(headers, [
                    'telefone',
                    'phone',
                    'celular',
                    'whatsapp',
                    'numero',
                    'número',
                  ]) ??
                  (headers.length > 1 ? headers[1] : null));
        selectedAttributes.removeWhere((item) => !headers.contains(item));
        mappedContacts = _asInt(data['estimatedContacts']);
        mappingError = null;
      });
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não consegui abrir a planilha: $error')),
        );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void _mappingChanged(VoidCallback update) {
    setState(update);
    mappingDebounce?.cancel();
    mappingDebounce = Timer(
      const Duration(milliseconds: 350),
      _validateMapping,
    );
  }

  Future<void> _validateMapping() async {
    if (preview == null || phoneColumn == null || url.text.trim().isEmpty)
      return;
    setState(() {
      validatingMapping = true;
      mappingError = null;
    });
    try {
      final data = await ref
          .read(apiClientProvider)
          .previewGoogleSheet(
            url.text.trim(),
            mapping: {
              'sheetId': sheetId,
              'nameColumn': nameColumn,
              'phoneColumn': phoneColumn,
              'attributeColumns': selectedAttributes.toList(),
            },
          );
      if (!mounted) return;
      setState(() => mappedContacts = _asInt(data['estimatedContacts']));
    } catch (error) {
      if (mounted) setState(() => mappingError = error.toString());
    } finally {
      if (mounted) setState(() => validatingMapping = false);
    }
  }

  Widget _step({
    required int number,
    required String title,
    required String description,
    required Widget child,
    bool enabled = true,
  }) {
    final color = enabled
        ? WaTheme.of(context).accent
        : WaTheme.of(context).textMuted;
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: color.withValues(alpha: .14),
            foregroundColor: color,
            child: Text(
              '$number',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: TextStyle(
                    fontSize: 12,
                    color: WaTheme.of(context).textSecondary,
                  ),
                ),
                const SizedBox(height: 10),
                child,
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _fieldPicker({
    required String label,
    required String? value,
    required List<String> headers,
    required ValueChanged<String?> onChanged,
    required IconData icon,
    bool required = false,
  }) => DropdownButtonFormField<String>(
    value: headers.contains(value) ? value : null,
    isExpanded: true,
    decoration: InputDecoration(
      labelText: '$label${required ? ' *' : ''}',
      prefixIcon: Icon(icon),
    ),
    hint: const Text('Selecionar coluna'),
    items: headers
        .map(
          (header) => DropdownMenuItem(
            value: header,
            child: Text(header, overflow: TextOverflow.ellipsis),
          ),
        )
        .toList(),
    onChanged: onChanged,
  );

  Widget _sampleTable(List<String> headers) {
    final rawRows = preview?['sampleRows'];
    final rows = rawRows is List
        ? rawRows
              .whereType<List>()
              .map((row) => row.map((cell) => cell?.toString() ?? '').toList())
              .toList()
        : const <List<String>>[];
    if (headers.isEmpty || rows.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: 10),
      decoration: BoxDecoration(
        border: Border.all(color: WaTheme.of(context).divider),
        borderRadius: BorderRadius.circular(10),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columnSpacing: 18,
          headingRowHeight: 34,
          dataRowMinHeight: 34,
          dataRowMaxHeight: 40,
          columns: headers
              .map(
                (header) => DataColumn(
                  label: Text(
                    header,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              )
              .toList(),
          rows: rows
              .map(
                (row) => DataRow(
                  cells: List.generate(
                    headers.length,
                    (index) => DataCell(
                      SizedBox(
                        width: 105,
                        child: Text(
                          index < row.length ? row[index] : '',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                  ),
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final headers = _asStringList(preview?['headers']);
    final sheets = _records(preview?['sheets']);
    final canConfirm =
        preview != null &&
        phoneColumn != null &&
        mappingError == null &&
        !validatingMapping;
    return AlertDialog(
      title: const Row(
        children: [
          Icon(Icons.table_chart_rounded),
          SizedBox(width: 10),
          Text('Importar contatos da planilha'),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'O BotAdmin só usará as colunas que você confirmar abaixo. A prévia permite conferir os dados antes de importar.',
              ),
              const SizedBox(height: 18),
              _step(
                number: 1,
                title: 'Escolha a planilha',
                description:
                    'As planilhas da conta Google conectada aparecem aqui automaticamente.',
                child: filesLoading
                    ? const LinearProgressIndicator()
                    : filesError != null
                    ? Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.orange.withValues(alpha: .10),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          filesError!,
                          style: const TextStyle(fontSize: 12),
                        ),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          DropdownButtonFormField<String>(
                            value: selectedFileId,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Minhas planilhas',
                              prefixIcon: Icon(Icons.folder_copy_outlined),
                            ),
                            hint: const Text('Selecione uma planilha'),
                            items: files
                                .map(
                                  (file) => DropdownMenuItem(
                                    value: file['id']?.toString(),
                                    child: Text(
                                      file['name']?.toString() ?? 'Planilha',
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: loading
                                ? null
                                : (value) {
                                    if (value != null) _selectFile(value);
                                  },
                          ),
                          ExpansionTile(
                            tilePadding: EdgeInsets.zero,
                            title: const Text(
                              'Usar um link específico',
                              style: TextStyle(fontSize: 13),
                            ),
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: url,
                                      decoration: const InputDecoration(
                                        labelText: 'Link da planilha',
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  FilledButton(
                                    onPressed: loading ? null : _open,
                                    child: const Text('Abrir'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
              ),
              _step(
                number: 2,
                title: 'Confira a aba e os dados',
                description: preview == null
                    ? 'Selecione uma planilha para carregar uma prévia.'
                    : '${_asInt(preview?['estimatedContacts'])} contato(s) válido(s) encontrado(s).',
                enabled: preview != null,
                child: preview == null
                    ? const SizedBox.shrink()
                    : Column(
                        children: [
                          DropdownButtonFormField<String>(
                            value: sheetId,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Aba da planilha',
                              prefixIcon: Icon(Icons.view_list_outlined),
                            ),
                            items: sheets
                                .map(
                                  (sheet) => DropdownMenuItem(
                                    value: sheet['id']?.toString(),
                                    child: Text(
                                      sheet['title']?.toString() ?? 'Aba',
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: loading
                                ? null
                                : (value) {
                                    if (value != null) _open(nextSheet: value);
                                  },
                          ),
                          _sampleTable(headers),
                        ],
                      ),
              ),
              _step(
                number: 3,
                title: 'Mapeie os dados de cada contato',
                description: preview == null
                    ? 'Aguardando a planilha.'
                    : validatingMapping
                    ? 'Conferindo os contatos com este mapeamento…'
                    : '${mappedContacts ?? _asInt(preview?['estimatedContacts'])} contato(s) pronto(s) para importar.',
                enabled: preview != null,
                child: preview == null
                    ? const SizedBox.shrink()
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: _fieldPicker(
                                  label: 'Nome do contato',
                                  value: nameColumn,
                                  headers: headers,
                                  icon: Icons.person_outline_rounded,
                                  onChanged: (value) =>
                                      _mappingChanged(() => nameColumn = value),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: _fieldPicker(
                                  label: 'Telefone / WhatsApp',
                                  value: phoneColumn,
                                  headers: headers,
                                  icon: Icons.phone_outlined,
                                  required: true,
                                  onChanged: (value) => _mappingChanged(
                                    () => phoneColumn = value,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (validatingMapping)
                            const Padding(
                              padding: EdgeInsets.only(top: 8),
                              child: LinearProgressIndicator(minHeight: 2),
                            ),
                          if (mappingError != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                mappingError!,
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          const SizedBox(height: 14),
                          const Text(
                            'Dados extras para personalização',
                            style: TextStyle(fontWeight: FontWeight.w900),
                          ),
                          const SizedBox(height: 3),
                          const Text(
                            'Marque colunas que poderá inserir na mensagem, por exemplo: {{cidade}} ou {{produto}}.',
                            style: TextStyle(fontSize: 12),
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 7,
                            runSpacing: 6,
                            children: headers
                                .where(
                                  (header) =>
                                      header != nameColumn &&
                                      header != phoneColumn,
                                )
                                .map(
                                  (header) => FilterChip(
                                    label: Text(header),
                                    selected: selectedAttributes.contains(
                                      header,
                                    ),
                                    onSelected: (selected) => _mappingChanged(
                                      () => selected
                                          ? selectedAttributes.add(header)
                                          : selectedAttributes.remove(header),
                                    ),
                                  ),
                                )
                                .toList(),
                          ),
                        ],
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
        FilledButton.icon(
          onPressed: canConfirm
              ? () => Navigator.pop(
                  context,
                  _GoogleSheetSelection(url.text.trim(), {
                    'sheetId': sheetId,
                    'nameColumn': nameColumn,
                    'phoneColumn': phoneColumn,
                    'attributeColumns': selectedAttributes.toList(),
                    'estimatedContacts':
                        mappedContacts ?? _asInt(preview?['estimatedContacts']),
                  }),
                )
              : null,
          icon: const Icon(Icons.check_rounded),
          label: const Text('Importar contatos'),
        ),
      ],
    );
  }
}

class _InstanceContactPicker extends StatefulWidget {
  const _InstanceContactPicker({
    required this.contacts,
    required this.onOrganize,
  });
  final List<WhatsAppContact> contacts;
  final Future<void> Function(List<WhatsAppContact>) onOrganize;
  @override
  State<_InstanceContactPicker> createState() => _InstanceContactPickerState();
}

class _InstanceContactPickerState extends State<_InstanceContactPicker> {
  final selected = <String>{};
  final search = TextEditingController();
  bool organizing = false;
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final q = search.text.toLowerCase();
    final contacts = widget.contacts
        .where(
          (c) =>
              q.isEmpty ||
              c.displayName.toLowerCase().contains(q) ||
              c.phone.contains(q),
        )
        .toList();
    final selectable = contacts
        .map((item) => _contactPhone(item))
        .whereType<String>()
        .map(_phoneKey)
        .where((item) => item.isNotEmpty)
        .toSet();
    final selectedContacts = widget.contacts
        .where(
          (item) => selected.contains(_phoneKey(_contactPhone(item) ?? '')),
        )
        .toList();
    return _ContactSheetFrame(
      title: 'Contatos da instância',
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: TextField(
              controller: search,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search_rounded),
                hintText: 'Pesquisar contatos',
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextButton.icon(
                    onPressed: selectable.isEmpty
                        ? null
                        : () => setState(() => selected.addAll(selectable)),
                    icon: const Icon(Icons.select_all_rounded),
                    label: Text('Selecionar todos (${selectable.length})'),
                  ),
                ),
                Expanded(
                  child: TextButton.icon(
                    onPressed: selected.isEmpty
                        ? null
                        : () => setState(selected.clear),
                    icon: const Icon(Icons.deselect_rounded),
                    label: const Text('Limpar seleção'),
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView.builder(
              itemCount: contacts.length,
              itemBuilder: (_, i) {
                final c = contacts[i];
                final phone = _contactPhone(c);
                if (phone == null) return const SizedBox.shrink();
                return CheckboxListTile(
                  value: selected.contains(_phoneKey(phone)),
                  onChanged: (_) {
                    setState(() {
                      selected.contains(_phoneKey(phone))
                          ? selected.remove(_phoneKey(phone))
                          : selected.add(_phoneKey(phone));
                    });
                  },
                  title: Text(c.displayName),
                  subtitle: Text(_formatPhone(phone)),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                OutlinedButton.icon(
                  onPressed: organizing || selectedContacts.isEmpty
                      ? null
                      : () async {
                          setState(() => organizing = true);
                          try {
                            await widget.onOrganize(selectedContacts);
                          } finally {
                            if (mounted) setState(() => organizing = false);
                          }
                        },
                  icon: organizing
                      ? const SizedBox.square(
                          dimension: 17,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.label_outline_rounded),
                  label: const Text('Adicionar às etiquetas/listas'),
                ),
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: selectedContacts.isEmpty
                      ? null
                      : () => Navigator.pop(context, selectedContacts),
                  child: Text(
                    'Usar ${selected.length} contato(s) na transmissão',
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

class _ContactLabelsDraft {
  const _ContactLabelsDraft(this.listIds, this.newLabel);
  final Set<String> listIds;
  final String newLabel;
}

class _ContactLabelsDialog extends StatefulWidget {
  const _ContactLabelsDialog({required this.lists});
  final List<Map<String, dynamic>> lists;

  @override
  State<_ContactLabelsDialog> createState() => _ContactLabelsDialogState();
}

class _ContactLabelsDialogState extends State<_ContactLabelsDialog> {
  final selected = <String>{};
  final newLabel = TextEditingController();

  @override
  void dispose() {
    newLabel.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final canSave = selected.isNotEmpty || newLabel.text.trim().isNotEmpty;
    return AlertDialog(
      title: const Row(
        children: [
          Icon(Icons.label_outline_rounded),
          SizedBox(width: 9),
          Expanded(child: Text('Etiquetas e listas')),
        ],
      ),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'O contato pode ficar em várias listas. Essas etiquetas também poderão ser usadas diretamente como público de uma transmissão.',
              ),
              const SizedBox(height: 12),
              if (widget.lists.isNotEmpty) ...[
                Text(
                  'Listas existentes',
                  style: TextStyle(
                    color: wa.textSecondary,
                    fontWeight: FontWeight.w900,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 5),
                Container(
                  constraints: const BoxConstraints(maxHeight: 260),
                  decoration: BoxDecoration(
                    border: Border.all(color: wa.divider),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: widget.lists.length,
                    itemBuilder: (_, index) {
                      final list = widget.lists[index];
                      final id = list['id']?.toString() ?? '';
                      return CheckboxListTile(
                        dense: true,
                        value: selected.contains(id),
                        onChanged: id.isEmpty
                            ? null
                            : (_) => setState(() {
                                selected.contains(id)
                                    ? selected.remove(id)
                                    : selected.add(id);
                              }),
                        title: Text(
                          list['name']?.toString() ?? 'Lista',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        subtitle: Text(
                          '${_asInt(list['contactCount'])} contato(s)',
                        ),
                        secondary: const Icon(Icons.label_rounded),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 14),
              ],
              TextField(
                controller: newLabel,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Criar uma nova etiqueta (opcional)',
                  hintText: 'Ex.: Lead, Cliente, Pós-venda',
                  prefixIcon: Icon(Icons.new_label_outlined),
                ),
              ),
              const SizedBox(height: 9),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: ['Lead', 'Cliente', 'Interessado', 'Pós-venda']
                    .map(
                      (label) => ActionChip(
                        label: Text(label),
                        onPressed: () => setState(() {
                          newLabel.text = label;
                          newLabel.selection = TextSelection.collapsed(
                            offset: label.length,
                          );
                        }),
                      ),
                    )
                    .toList(),
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
        FilledButton.icon(
          onPressed: canSave
              ? () => Navigator.pop(
                  context,
                  _ContactLabelsDraft({...selected}, newLabel.text.trim()),
                )
              : null,
          icon: const Icon(Icons.done_all_rounded),
          label: const Text('Aplicar etiquetas'),
        ),
      ],
    );
  }
}

class _PublicGroupJoinSheet extends ConsumerStatefulWidget {
  const _PublicGroupJoinSheet({required this.instanceId});

  final int instanceId;

  @override
  ConsumerState<_PublicGroupJoinSheet> createState() =>
      _PublicGroupJoinSheetState();
}

class _PublicGroupJoinSheetState extends ConsumerState<_PublicGroupJoinSheet> {
  final _query = TextEditingController();
  List<PublicGroupCategory> _categories = const [
    PublicGroupCategory(name: 'Divulgação', slug: 'divulgacao'),
    PublicGroupCategory(name: 'Amizade', slug: 'amizade'),
    PublicGroupCategory(name: 'Compra e venda', slug: 'compra-e-venda'),
    PublicGroupCategory(name: 'Esportes', slug: 'esportes'),
    PublicGroupCategory(name: 'Tecnologia', slug: 'tecnologia'),
    PublicGroupCategory(name: 'Vagas de empregos', slug: 'vagas-de-empregos'),
  ];
  List<PublicGroupCandidate> _groups = const [];
  final Map<String, Map<String, dynamic>> _joined = {};
  final Set<String> _joining = {};
  String _category = 'divulgacao';
  String? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _search());
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(apiClientProvider)
          .discoverPublicGroups(query: _query.text, category: _category);
      if (!mounted) return;
      setState(() {
        _groups = result.groups;
        if (result.categories.isNotEmpty) {
          _categories = result.categories;
          if (!_categories.any((item) => item.slug == _category)) {
            _category = _categories.first.slug;
          }
        }
        if (_groups.isEmpty) {
          _error = 'Nenhum grupo aberto encontrado nessa categoria.';
        }
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _join(PublicGroupCandidate candidate) async {
    final invite = candidate.inviteLink?.trim() ?? '';
    if (invite.isEmpty || _joining.contains(candidate.id)) return;
    setState(() {
      _joining.add(candidate.id);
      _error = null;
    });
    try {
      final group = await ref
          .read(apiClientProvider)
          .joinPublicGroup(instanceId: widget.instanceId, inviteLink: invite);
      if (!mounted) return;
      final awaitingApproval = group['awaitingApproval'] == true;
      final remoteId = (group['remoteId'] ?? '').toString().trim();
      if (awaitingApproval || !remoteId.endsWith('@g.us')) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'A solicitação foi enviada. O grupo será disponibilizado após a aprovação do administrador.',
            ),
          ),
        );
        return;
      }
      setState(() {
        _joined[candidate.id] = {
          'name': (group['name'] ?? candidate.title).toString(),
          'phone': remoteId,
          'jid': remoteId,
          'remoteId': remoteId,
          'recipientType': 'group',
          'groupId': group['id'],
          'source': 'public_group_discovery',
          'mentionAll': false,
          'excludeAdmins': false,
        };
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('O robô entrou em “${candidate.title}”.')),
        );
      }
    } catch (error) {
      if (mounted)
        setState(() => _error = 'Não foi possível entrar no grupo: $error');
    } finally {
      if (mounted) setState(() => _joining.remove(candidate.id));
    }
  }

  Future<void> _openDetails(PublicGroupCandidate candidate) async {
    final raw = candidate.detailUrl?.trim() ?? '';
    final uri = Uri.tryParse(raw);
    if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * .9,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 10, 12),
            child: Row(
              children: [
                Icon(Icons.travel_explore_rounded, color: wa.accent),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Procurar grupos',
                        style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        'Escolha a categoria e entre pelo endpoint da API.',
                        style: TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: wa.divider),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                DropdownButtonFormField<String>(
                  initialValue:
                      _categories.any((item) => item.slug == _category)
                      ? _category
                      : null,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Categoria de grupos',
                    prefixIcon: Icon(Icons.category_outlined),
                  ),
                  items: _categories
                      .map(
                        (item) => DropdownMenuItem(
                          value: item.slug,
                          child: Text(
                            item.name,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      )
                      .toList(growable: false),
                  onChanged: _loading
                      ? null
                      : (value) {
                          if (value == null) return;
                          setState(() => _category = value);
                          _search();
                        },
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _query,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _search(),
                  decoration: InputDecoration(
                    labelText: 'Palavra-chave opcional',
                    prefixIcon: const Icon(Icons.search_rounded),
                    suffixIcon: IconButton(
                      onPressed: _loading ? null : _search,
                      tooltip: 'Procurar grupos',
                      icon: _loading
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.manage_search_rounded),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          Expanded(
            child: _loading && _groups.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    itemCount: _groups.length,
                    separatorBuilder: (_, _) =>
                        Divider(height: 1, color: wa.divider),
                    itemBuilder: (context, index) {
                      final group = _groups[index];
                      final joined = _joined.containsKey(group.id);
                      final joining = _joining.contains(group.id);
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor: wa.searchBg,
                          child: const Icon(Icons.groups_2_outlined),
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
                            ? FilledButton.tonalIcon(
                                onPressed: joining || joined
                                    ? null
                                    : () => _join(group),
                                icon: joining
                                    ? const SizedBox.square(
                                        dimension: 16,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      )
                                    : Icon(
                                        joined
                                            ? Icons.check_rounded
                                            : Icons.login_rounded,
                                      ),
                                label: Text(joined ? 'Adicionado' : 'Entrar'),
                              )
                            : IconButton(
                                onPressed:
                                    group.detailUrl?.trim().isNotEmpty == true
                                    ? () => _openDetails(group)
                                    : null,
                                tooltip: 'Convite protegido · abrir detalhes',
                                icon: const Icon(Icons.lock_outline_rounded),
                              ),
                      );
                    },
                  ),
          ),
          Divider(height: 1, color: wa.divider),
          Padding(
            padding: const EdgeInsets.all(14),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _joined.isEmpty
                    ? null
                    : () => Navigator.pop(context, _joined.values.toList()),
                icon: const Icon(Icons.playlist_add_check_rounded),
                label: Text(
                  'Adicionar ${_joined.length} grupo(s) à transmissão',
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InstanceGroupPicker extends StatefulWidget {
  const _InstanceGroupPicker({required this.groups});
  final List<Map<String, dynamic>> groups;

  @override
  State<_InstanceGroupPicker> createState() => _InstanceGroupPickerState();
}

class _InstanceGroupPickerState extends State<_InstanceGroupPicker> {
  final selected = <String, Map<String, dynamic>>{};
  final search = TextEditingController();

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final query = search.text.trim().toLowerCase();
    final groups = widget.groups.where((group) {
      final name = group['name']?.toString().toLowerCase() ?? '';
      final jid = group['remoteId']?.toString().toLowerCase() ?? '';
      return query.isEmpty || name.contains(query) || jid.contains(query);
    }).toList();
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .82,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Grupos da instância',
                      style: TextStyle(
                        color: wa.textPrimary,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: search,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search_rounded),
                  hintText: 'Pesquisar grupo',
                ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView.builder(
                itemCount: groups.length,
                itemBuilder: (_, index) {
                  final group = groups[index];
                  final jid = group['remoteId']?.toString().trim() ?? '';
                  final draft = selected[jid];
                  final checked = draft != null;
                  return Column(
                    children: [
                      CheckboxListTile(
                        value: checked,
                        onChanged: (_) => setState(() {
                          if (checked) {
                            selected.remove(jid);
                          } else if (jid.isNotEmpty) {
                            selected[jid] = {
                              ...group,
                              'recipientType': 'group',
                              'jid': jid,
                              'remoteId': jid,
                              'groupId': group['linkedGroupId'],
                              'source': 'instance_group',
                              'mentionAll': false,
                              'excludeAdmins': false,
                            };
                          }
                        }),
                        title: Text(
                          group['name']?.toString().trim().isNotEmpty == true
                              ? group['name'].toString()
                              : 'Grupo do WhatsApp',
                        ),
                        subtitle: Text(
                          '${_asInt(group['participantsCount'])} participante(s)',
                        ),
                        secondary: const CircleAvatar(
                          child: Icon(Icons.groups_2_outlined),
                        ),
                      ),
                      if (draft != null)
                        Container(
                          margin: const EdgeInsets.fromLTRB(54, 0, 16, 10),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: wa.panelElevated,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: wa.divider),
                          ),
                          child: Column(
                            children: [
                              SwitchListTile.adaptive(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                title: const Text('Mencionar todos'),
                                subtitle: const Text(
                                  'Inclui os participantes na mensagem enviada.',
                                ),
                                value: draft['mentionAll'] == true,
                                onChanged: (value) =>
                                    setState(() => draft['mentionAll'] = value),
                              ),
                              SwitchListTile.adaptive(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                title: const Text(
                                  'Não mencionar administradores',
                                ),
                                value: draft['excludeAdmins'] == true,
                                onChanged: draft['mentionAll'] == true
                                    ? (value) => setState(
                                        () => draft['excludeAdmins'] = value,
                                      )
                                    : null,
                              ),
                            ],
                          ),
                        ),
                    ],
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: selected.isEmpty
                      ? null
                      : () => Navigator.pop(context, selected.values.toList()),
                  icon: const Icon(Icons.add_rounded),
                  label: Text('Adicionar ${selected.length} grupo(s)'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ContactsManager extends ConsumerStatefulWidget {
  const _ContactsManager({
    required this.instanceId,
    required this.listId,
    required this.contacts,
    required this.googleSheetConfigured,
  });
  final int instanceId;
  final String listId;
  final List<Map<String, dynamic>> contacts;
  final bool googleSheetConfigured;
  @override
  ConsumerState<_ContactsManager> createState() => _ContactsManagerState();
}

class _ContactsManagerState extends ConsumerState<_ContactsManager> {
  late List<Map<String, dynamic>> contacts;
  final selected = <String>{};
  final search = TextEditingController();
  bool removing = false;
  bool syncing = false;
  bool importing = false;
  @override
  void initState() {
    super.initState();
    contacts = [...widget.contacts];
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> remove({String? only, bool all = false}) async {
    final ids = only != null ? [only] : selected.toList();
    if (ids.isEmpty && !all) return;
    final amount = all ? contacts.length : ids.length;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(
          all
              ? 'Remover todos os destinatários?'
              : 'Remover $amount destinatário(s)?',
        ),
        content: const Text('Esta ação não pode ser desfeita.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remover'),
          ),
        ],
      ),
    );
    if (accepted != true) return;
    setState(() => removing = true);
    try {
      await ref
          .read(apiClientProvider)
          .removeBroadcastContacts(
            widget.instanceId,
            widget.listId,
            contactIds: all ? null : ids,
          );
      if (!mounted) return;
      setState(() {
        contacts.removeWhere(
          (item) => all || ids.contains(item['id']?.toString()),
        );
        selected.clear();
      });
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Não consegui remover: $error')));
    } finally {
      if (mounted) setState(() => removing = false);
    }
  }

  Future<void> syncSheet() async {
    setState(() => syncing = true);
    try {
      final result = await ref
          .read(apiClientProvider)
          .syncBroadcastGoogleSheet(
            widget.instanceId,
            widget.listId,
            apply: true,
          );
      final detail = await ref
          .read(apiClientProvider)
          .loadBroadcastList(widget.instanceId, widget.listId);
      if (!mounted) return;
      setState(() {
        contacts = _records(detail['contacts']);
        selected.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _asInt(result['newContacts']) > 0
                ? '${_asInt(result['newContacts'])} novo(s) contato(s) sincronizado(s).'
                : 'A lista já está atualizada com a planilha.',
          ),
        ),
      );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não consegui sincronizar: $error')),
        );
    } finally {
      if (mounted) setState(() => syncing = false);
    }
  }

  Future<void> addRecipients() async {
    final draft = await showBotAdminBottomSheet<_ContactImportDraft>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ContactImportSheet(instanceId: widget.instanceId),
    );
    if (draft == null || !mounted) return;
    setState(() => importing = true);
    try {
      await ref
          .read(apiClientProvider)
          .importBroadcastContacts(
            widget.instanceId,
            widget.listId,
            contacts: draft.contacts,
            googleSheetUrl: draft.googleSheetUrl,
            googleSheetMapping: draft.googleSheetMapping,
          );
      final detail = await ref
          .read(apiClientProvider)
          .loadBroadcastList(widget.instanceId, widget.listId);
      if (!mounted) return;
      setState(() {
        contacts = _records(detail['contacts']);
        selected.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Destinatários adicionados sem duplicação.'),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não consegui adicionar: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => importing = false);
    }
  }

  Future<void> organizeSelected() async {
    final recipients = contacts
        .where((item) => selected.contains(item['id']?.toString()))
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
    if (recipients.isEmpty) return;
    setState(() => importing = true);
    try {
      final lists = await ref
          .read(apiClientProvider)
          .loadBroadcastLists(widget.instanceId);
      final available = lists
          .where((item) => item['id']?.toString() != widget.listId)
          .toList();
      if (!mounted) return;
      final draft = await showDialog<_ContactLabelsDraft>(
        context: context,
        builder: (_) => _ContactLabelsDialog(lists: available),
      );
      if (draft == null) return;
      for (final listId in draft.listIds) {
        await ref
            .read(apiClientProvider)
            .importBroadcastContacts(
              widget.instanceId,
              listId,
              contacts: recipients,
            );
      }
      if (draft.newLabel.trim().isNotEmpty) {
        await ref
            .read(apiClientProvider)
            .createBroadcastList(
              widget.instanceId,
              name: draft.newLabel.trim(),
              description: 'Etiqueta de contatos',
              contacts: recipients,
            );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${recipients.length} contato(s) adicionado(s) às etiquetas.',
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não consegui aplicar as etiquetas: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => importing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = search.text.trim().toLowerCase();
    final visible = contacts
        .where(
          (c) =>
              q.isEmpty ||
              [
                c['name'],
                c['pushName'],
                c['phone'],
              ].any((v) => v?.toString().toLowerCase().contains(q) == true),
        )
        .toList();
    return _ContactSheetFrame(
      title: 'Destinatários da lista',
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 0, 18, 8),
            child: TextField(
              controller: search,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search_rounded),
                hintText: 'Buscar contato, grupo ou número',
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Wrap(
              alignment: WrapAlignment.start,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 6,
              runSpacing: 4,
              children: [
                FilledButton.icon(
                  onPressed: importing ? null : addRecipients,
                  icon: importing
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.person_add_alt_1_rounded, size: 18),
                  label: const Text('Adicionar destinatários'),
                ),
                if (widget.googleSheetConfigured)
                  FilledButton.tonalIcon(
                    onPressed: syncing ? null : syncSheet,
                    icon: syncing
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.sync_rounded, size: 18),
                    label: const Text('Sincronizar planilha'),
                  ),
                TextButton.icon(
                  onPressed: visible.isEmpty
                      ? null
                      : () => setState(() {
                          selected.addAll(
                            visible
                                .map((c) => c['id']?.toString() ?? '')
                                .where((id) => id.isNotEmpty),
                          );
                        }),
                  icon: const Icon(Icons.select_all_rounded),
                  label: Text('Selecionar todos (${visible.length})'),
                ),
                TextButton.icon(
                  onPressed: selected.isEmpty
                      ? null
                      : () => setState(selected.clear),
                  icon: const Icon(Icons.deselect_rounded),
                  label: const Text('Limpar seleção'),
                ),
                TextButton.icon(
                  onPressed: importing || selected.isEmpty
                      ? null
                      : organizeSelected,
                  icon: const Icon(Icons.label_outline_rounded),
                  label: const Text('Adicionar à lista'),
                ),
                IconButton(
                  onPressed: removing || selected.isEmpty
                      ? null
                      : () => remove(),
                  tooltip: 'Remover selecionados',
                  icon: const Icon(Icons.delete_sweep_outlined),
                ),
                IconButton(
                  onPressed: removing || contacts.isEmpty
                      ? null
                      : () => remove(all: true),
                  tooltip: 'Remover todos',
                  icon: const Icon(Icons.delete_forever_outlined),
                ),
              ],
            ),
          ),
          Expanded(
            child: visible.isEmpty
                ? const Center(child: Text('Nenhum destinatário nesta lista.'))
                : ListView.separated(
                    itemCount: visible.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, index) {
                      final c = visible[index];
                      final id = c['id']?.toString() ?? '';
                      final push = c['pushName']?.toString().trim() ?? '';
                      final name = c['name']?.toString().trim() ?? '';
                      final isGroup = c['recipientType'] == 'group';
                      return CheckboxListTile(
                        value: selected.contains(id),
                        onChanged: id.isEmpty
                            ? null
                            : (_) => setState(() {
                                selected.contains(id)
                                    ? selected.remove(id)
                                    : selected.add(id);
                              }),
                        title: Text(
                          push.isNotEmpty
                              ? push
                              : (name.isNotEmpty ? name : 'Sem nome'),
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        subtitle: Text(
                          isGroup
                              ? '${c['mentionAll'] == true ? 'Menciona participantes' : 'Sem menções'}${c['excludeAdmins'] == true ? ' · exceto admins' : ''}'
                              : '${_formatPhone(c['phone']?.toString() ?? '')}${name.isNotEmpty && push.isNotEmpty ? ' · $name' : ''}',
                        ),
                        secondary: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              isGroup
                                  ? Icons.groups_2_outlined
                                  : Icons.person_outline_rounded,
                            ),
                            IconButton(
                              onPressed: id.isEmpty
                                  ? null
                                  : () => remove(only: id),
                              tooltip: 'Remover destinatário',
                              icon: const Icon(Icons.delete_outline_rounded),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Text(
              '${contacts.length} destinatário(s) · ${selected.length} selecionado(s)',
            ),
          ),
        ],
      ),
    );
  }
}

class _ButtonsDialog extends StatefulWidget {
  const _ButtonsDialog({
    required this.initial,
    required this.body,
    required this.media,
  });
  final List<OutgoingInteractiveButton> initial;
  final String body;
  final Map<String, dynamic>? media;
  @override
  State<_ButtonsDialog> createState() => _ButtonsDialogState();
}

class _ButtonsDialogState extends State<_ButtonsDialog> {
  late List<_ButtonDraft> items;
  @override
  void initState() {
    super.initState();
    items = widget.initial
        .map(
          (b) => _ButtonDraft(
            b.id,
            b.text,
            b.type,
            b.type == 'cta_url' ? b.url ?? '' : b.copyCode ?? '',
          ),
        )
        .toList();
  }

  Widget editor() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text(
        'Até 3 botões. Edite os campos e confira ao lado exatamente como o card ficará.',
        style: TextStyle(fontSize: 12),
      ),
      const SizedBox(height: 10),
      ...items.asMap().entries.map((entry) {
        final i = entry.key;
        final item = entry.value;
        return Container(
          margin: const EdgeInsets.only(bottom: 9),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            border: Border.all(color: Theme.of(context).dividerColor),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 13,
                    child: Text(
                      '${i + 1}',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: item.text,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'Texto exibido',
                        prefixIcon: Icon(Icons.edit_outlined, size: 19),
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => setState(() => items.removeAt(i)),
                    tooltip: 'Remover botão',
                    icon: const Icon(Icons.delete_outline_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: item.type,
                decoration: const InputDecoration(labelText: 'Ação do botão'),
                items: const [
                  DropdownMenuItem(
                    value: 'quick_reply',
                    child: Text('Resposta rápida'),
                  ),
                  DropdownMenuItem(value: 'cta_url', child: Text('Abrir link')),
                  DropdownMenuItem(
                    value: 'cta_copy',
                    child: Text('Copiar código'),
                  ),
                ],
                onChanged: (value) =>
                    setState(() => item.type = value ?? 'quick_reply'),
              ),
              if (item.type == 'cta_url' || item.type == 'cta_copy')
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: TextField(
                    controller: item.extra,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      labelText: item.type == 'cta_url'
                          ? 'Endereço do link'
                          : 'Código para copiar',
                    ),
                  ),
                ),
            ],
          ),
        );
      }),
      if (items.length < 3)
        OutlinedButton.icon(
          onPressed: () => setState(
            () => items.add(
              _ButtonDraft(
                'broadcast_${items.length + 1}',
                '',
                'quick_reply',
                '',
              ),
            ),
          ),
          icon: const Icon(Icons.add_rounded),
          label: const Text('Adicionar botão'),
        ),
    ],
  );
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Row(
      children: [
        Icon(Icons.smart_button_outlined),
        SizedBox(width: 9),
        Text('Editor de botões'),
      ],
    ),
    content: SizedBox(
      width: 820,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final preview = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Prévia única da mensagem',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 8),
              _BroadcastAdaptiveCard(
                body: widget.body,
                media: widget.media,
                buttons: items
                    .where((item) => item.text.text.trim().isNotEmpty)
                    .map(
                      (item) => OutgoingInteractiveButton(
                        id: item.id,
                        text: item.text.text.trim(),
                        type: item.type,
                        url: item.type == 'cta_url'
                            ? item.extra.text.trim()
                            : null,
                        copyCode: item.type == 'cta_copy'
                            ? item.extra.text.trim()
                            : null,
                      ),
                    )
                    .toList(),
                compact: false,
                selected: false,
              ),
            ],
          );
          if (constraints.maxWidth < 680)
            return SingleChildScrollView(
              child: Column(
                children: [preview, const SizedBox(height: 16), editor()],
              ),
            );
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(flex: 6, child: SingleChildScrollView(child: editor())),
              const SizedBox(width: 18),
              Expanded(flex: 5, child: preview),
            ],
          );
        },
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton.icon(
        onPressed: () => Navigator.pop(
          context,
          items
              .where((x) => x.text.text.trim().isNotEmpty)
              .map(
                (x) => OutgoingInteractiveButton(
                  id: x.id,
                  text: x.text.text.trim(),
                  type: x.type,
                  url: x.type == 'cta_url' ? x.extra.text.trim() : null,
                  copyCode: x.type == 'cta_copy' ? x.extra.text.trim() : null,
                ),
              )
              .toList(),
        ),
        icon: const Icon(Icons.check_rounded),
        label: const Text('Aplicar ao card'),
      ),
    ],
  );
}

class _ButtonDraft {
  _ButtonDraft(this.id, String text, this.type, String extra)
    : text = TextEditingController(text: text),
      extra = TextEditingController(text: extra);
  final String id;
  final TextEditingController text, extra;
  String type;
}

class _VariablesDialog extends StatefulWidget {
  const _VariablesDialog({
    required this.initial,
    required this.contacts,
    this.onPreview,
  });
  final List<Map<String, dynamic>> initial, contacts;
  final Future<Map<String, dynamic>> Function(
    List<Map<String, dynamic>> values,
  )?
  onPreview;
  @override
  State<_VariablesDialog> createState() => _VariablesDialogState();
}

class _VariablesDialogState extends State<_VariablesDialog> {
  late List<_VariableDraft> items;
  late List<String> fields;
  String? errorText;
  String? previewText;
  bool testing = false;
  @override
  void initState() {
    super.initState();
    final extra = <String>{};
    for (final c in widget.contacts) {
      final attrs = c['attributes'];
      if (attrs is Map) extra.addAll(attrs.keys.map((x) => x.toString()));
    }
    fields = ['nome', 'pushName', 'numero', 'localizacao', 'detalhes', ...extra]
      ..sort();
    items = widget.initial.map(_VariableDraft.fromMap).toList();
  }

  @override
  void dispose() {
    for (final item in items) item.dispose();
    super.dispose();
  }

  void _remove(int index) {
    items[index].dispose();
    setState(() => items.removeAt(index));
  }

  void _save() {
    final names = <String>{};
    for (final item in items) {
      final name = item.name.text.trim();
      if (name.isEmpty || !RegExp(r'^[a-zA-Z0-9_]+$').hasMatch(name)) {
        setState(
          () => errorText =
              'Use apenas letras, números e _ no nome das variáveis.',
        );
        return;
      }
      if (!names.add(name.toLowerCase())) {
        setState(() => errorText = 'Existem variáveis com o mesmo nome.');
        return;
      }
      if (item.type == 'api' && item.apiUrl.text.trim().isEmpty) {
        setState(() => errorText = 'Informe a URL da variável de API.');
        return;
      }
    }
    Navigator.pop(context, items.map((item) => item.toJson()).toList());
  }

  Future<void> _testVariables() async {
    final callback = widget.onPreview;
    if (callback == null || testing) return;
    setState(() {
      testing = true;
      previewText = null;
      errorText = null;
    });
    try {
      final result = await callback(
        items.map((item) => item.toJson()).toList(),
      );
      if (!mounted) return;
      final contact = result['contact'] is Map
          ? Map<String, dynamic>.from(result['contact'] as Map)
          : const <String, dynamic>{};
      setState(() {
        previewText =
            'Prévia para ${contact['name'] ?? 'o primeiro destinatário'}:\n${result['rendered'] ?? ''}';
      });
    } catch (error) {
      if (mounted) setState(() => errorText = 'Teste falhou: $error');
    } finally {
      if (mounted) setState(() => testing = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Variáveis inteligentes'),
    content: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 680, maxHeight: 680),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Crie dados reutilizáveis para cada destinatário. Use {{variavel}} no texto ou até dentro da URL de uma consulta JSON.',
            ),
            const SizedBox(height: 7),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: const [
                Chip(label: Text('Contato/planilha')),
                Chip(label: Text('Texto fixo')),
                Chip(label: Text('Bom dia/tarde/noite')),
                Chip(label: Text('Data e hora')),
                Chip(label: Text('API JSON')),
              ],
            ),
            if (errorText != null) ...[
              const SizedBox(height: 8),
              Text(
                errorText!,
                style: const TextStyle(
                  color: Colors.red,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            const SizedBox(height: 10),
            ...items.asMap().entries.map((e) {
              final item = e.value;
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: item.name,
                              decoration: const InputDecoration(
                                labelText: 'Nome · ex.: saudacao',
                                prefixText: '{{ ',
                                suffixText: ' }}',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: DropdownButtonFormField<String>(
                              value: item.type,
                              isExpanded: true,
                              decoration: const InputDecoration(
                                labelText: 'Origem do valor',
                              ),
                              items: const [
                                DropdownMenuItem(
                                  value: 'contact',
                                  child: Text('Contato/planilha'),
                                ),
                                DropdownMenuItem(
                                  value: 'static',
                                  child: Text('Texto fixo'),
                                ),
                                DropdownMenuItem(
                                  value: 'greeting',
                                  child: Text('Saudação por horário'),
                                ),
                                DropdownMenuItem(
                                  value: 'datetime',
                                  child: Text('Data e hora'),
                                ),
                                DropdownMenuItem(
                                  value: 'api',
                                  child: Text('API JSON'),
                                ),
                              ],
                              onChanged: (value) => setState(
                                () => item.type = value ?? 'contact',
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Excluir variável',
                            onPressed: () => _remove(e.key),
                            icon: const Icon(Icons.delete_outline_rounded),
                          ),
                        ],
                      ),
                      const SizedBox(height: 9),
                      if (item.type == 'contact')
                        DropdownButtonFormField<String>(
                          value: fields.contains(item.source)
                              ? item.source
                              : fields.first,
                          isExpanded: true,
                          items: fields
                              .map(
                                (field) => DropdownMenuItem(
                                  value: field,
                                  child: Text(field),
                                ),
                              )
                              .toList(),
                          onChanged: (value) => setState(
                            () => item.source = value ?? fields.first,
                          ),
                          decoration: const InputDecoration(
                            labelText: 'Campo do contato ou coluna mapeada',
                            prefixIcon: Icon(Icons.table_view_outlined),
                          ),
                        ),
                      if (item.type == 'static')
                        TextField(
                          controller: item.value,
                          decoration: const InputDecoration(
                            labelText: 'Valor fixo',
                          ),
                        ),
                      if (item.type == 'greeting')
                        Column(
                          children: [
                            TextField(
                              controller: item.morningText,
                              decoration: const InputDecoration(
                                labelText: 'Manhã · antes das 12h',
                              ),
                            ),
                            const SizedBox(height: 7),
                            TextField(
                              controller: item.afternoonText,
                              decoration: const InputDecoration(
                                labelText: 'Tarde · antes das 18h',
                              ),
                            ),
                            const SizedBox(height: 7),
                            TextField(
                              controller: item.eveningText,
                              decoration: const InputDecoration(
                                labelText: 'Noite · a partir das 18h',
                              ),
                            ),
                          ],
                        ),
                      if (item.type == 'datetime')
                        DropdownButtonFormField<String>(
                          value: item.format,
                          decoration: const InputDecoration(
                            labelText: 'Formato',
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'date',
                              child: Text('Somente data'),
                            ),
                            DropdownMenuItem(
                              value: 'time',
                              child: Text('Somente hora'),
                            ),
                            DropdownMenuItem(
                              value: 'datetime',
                              child: Text('Data e hora'),
                            ),
                          ],
                          onChanged: (value) =>
                              setState(() => item.format = value ?? 'datetime'),
                        ),
                      if (item.type == 'api')
                        Column(
                          children: [
                            TextField(
                              controller: item.apiUrl,
                              keyboardType: TextInputType.url,
                              decoration: const InputDecoration(
                                labelText: 'URL HTTP/HTTPS',
                                hintText:
                                    'https://api.exemplo.com/clientes/{{numero}}',
                                prefixIcon: Icon(Icons.api_rounded),
                              ),
                            ),
                            const SizedBox(height: 7),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: item.jsonPath,
                                    decoration: const InputDecoration(
                                      labelText: 'Caminho no JSON',
                                      hintText: 'data.cliente.nome',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 7),
                                Expanded(
                                  child: TextField(
                                    controller: item.fallback,
                                    decoration: const InputDecoration(
                                      labelText: 'Valor se falhar',
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 5),
                            const Align(
                              alignment: Alignment.centerLeft,
                              child: Text(
                                'A consulta é feita no envio, individualmente e com bloqueio de endereços privados.',
                                style: TextStyle(fontSize: 11),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              );
            }),
            TextButton.icon(
              onPressed: () =>
                  setState(() => items.add(_VariableDraft.empty())),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Nova variável'),
            ),
            if (widget.onPreview != null)
              OutlinedButton.icon(
                onPressed: testing ? null : _testVariables,
                icon: testing
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.play_arrow_rounded),
                label: Text(
                  testing
                      ? 'Consultando…'
                      : 'Testar com o primeiro destinatário',
                ),
              ),
            if (previewText != null) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(11),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: SelectableText(previewText!),
              ),
            ],
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(onPressed: _save, child: const Text('Salvar')),
    ],
  );
}

class _VariableDraft {
  _VariableDraft.fromMap(Map<String, dynamic> value)
    : name = TextEditingController(text: value['name']?.toString() ?? ''),
      type = value['type']?.toString() ?? 'contact',
      source = value['source']?.toString() ?? 'nome',
      value = TextEditingController(text: value['value']?.toString() ?? ''),
      apiUrl = TextEditingController(text: value['apiUrl']?.toString() ?? ''),
      jsonPath = TextEditingController(
        text: value['jsonPath']?.toString() ?? '',
      ),
      fallback = TextEditingController(
        text: value['fallback']?.toString() ?? '',
      ),
      format = value['format']?.toString() ?? 'datetime',
      morningText = TextEditingController(
        text: value['morningText']?.toString() ?? 'Bom dia',
      ),
      afternoonText = TextEditingController(
        text: value['afternoonText']?.toString() ?? 'Boa tarde',
      ),
      eveningText = TextEditingController(
        text: value['eveningText']?.toString() ?? 'Boa noite',
      );

  factory _VariableDraft.empty() => _VariableDraft.fromMap(const {});

  final TextEditingController name, value, apiUrl, jsonPath, fallback;
  final TextEditingController morningText, afternoonText, eveningText;
  String type, source, format;

  Map<String, dynamic> toJson() => {
    'name': name.text.trim(),
    'type': type,
    if (type == 'contact') 'source': source,
    if (type == 'static') 'value': value.text,
    if (type == 'greeting') ...{
      'timezone': 'America/Sao_Paulo',
      'morningText': morningText.text.trim(),
      'afternoonText': afternoonText.text.trim(),
      'eveningText': eveningText.text.trim(),
    },
    if (type == 'datetime') ...{
      'timezone': 'America/Sao_Paulo',
      'format': format,
    },
    if (type == 'api') ...{
      'apiUrl': apiUrl.text.trim(),
      'jsonPath': jsonPath.text.trim(),
      'fallback': fallback.text,
    },
  };

  void dispose() {
    name.dispose();
    value.dispose();
    apiUrl.dispose();
    jsonPath.dispose();
    fallback.dispose();
    morningText.dispose();
    afternoonText.dispose();
    eveningText.dispose();
  }
}

class _SendSettingsDialog extends StatefulWidget {
  const _SendSettingsDialog({required this.count});
  final int count;
  @override
  State<_SendSettingsDialog> createState() => _SendSettingsDialogState();
}

class _SendSettingsDialogState extends State<_SendSettingsDialog> {
  bool typing = true;
  String mode = 'send';
  final min = TextEditingController(text: '30');
  final max = TextEditingController(text: '60');
  final scheduled = TextEditingController(
    text: DateTime.now()
        .add(const Duration(hours: 1))
        .toIso8601String()
        .substring(0, 16)
        .replaceFirst('T', ' '),
  );
  final recurrence = TextEditingController(text: '24');
  String recurrenceUnit = 'hours';
  @override
  void dispose() {
    min.dispose();
    max.dispose();
    scheduled.dispose();
    recurrence.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final fields = <Widget>[
      Text(
        'Envio individual para ${widget.count} destinatário(s). A mensagem salva continuará disponível para reutilização.',
      ),
      const SizedBox(height: 10),
      SegmentedButton<String>(
        segments: const [
          ButtonSegment(
            value: 'send',
            icon: Icon(Icons.send_rounded),
            label: Text('Enviar agora'),
          ),
          ButtonSegment(
            value: 'schedule',
            icon: Icon(Icons.schedule_rounded),
            label: Text('Agendar início'),
          ),
          ButtonSegment(
            value: 'recurring',
            icon: Icon(Icons.autorenew_rounded),
            label: Text('Recorrente'),
          ),
        ],
        selected: {mode},
        onSelectionChanged: (values) => setState(() => mode = values.first),
      ),
      const SizedBox(height: 12),
    ];
    if (mode == 'schedule' || mode == 'recurring') {
      fields.add(
        TextField(
          controller: scheduled,
          decoration: const InputDecoration(
            labelText: 'Data e horário de início',
            hintText: '2026-08-21 14:30',
            helperText: 'Horário local. Mínimo: 30 segundos no futuro.',
          ),
        ),
      );
      if (mode == 'recurring')
        fields.add(
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: recurrence,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Repetir a cada',
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: recurrenceUnit,
                    decoration: const InputDecoration(labelText: 'Unidade'),
                    items: const [
                      DropdownMenuItem(
                        value: 'minutes',
                        child: Text('Minutos'),
                      ),
                      DropdownMenuItem(value: 'hours', child: Text('Horas')),
                      DropdownMenuItem(value: 'days', child: Text('Dias')),
                    ],
                    onChanged: (value) =>
                        setState(() => recurrenceUnit = value ?? 'hours'),
                  ),
                ),
              ],
            ),
          ),
        );
    }
    fields.add(
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        value: typing,
        onChanged: (v) => setState(() => typing = v),
        title: const Text('Mostrar “digitando”'),
      ),
    );
    fields.add(
      Row(
        children: [
          Expanded(
            child: TextField(
              controller: min,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Delay mínimo (seg.)',
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: max,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Delay máximo (seg.)',
              ),
            ),
          ),
        ],
      ),
    );
    return AlertDialog(
      title: Text(
        mode == 'recurring'
            ? 'Programar recorrência'
            : mode == 'schedule'
            ? 'Agendar transmissão'
            : 'Iniciar transmissão',
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: fields,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: () => Navigator.pop(
            context,
            _SendSettings(
              mode,
              typing,
              (_asInt(min.text, 30) * 1000).clamp(10000, 300000).toInt(),
              (_asInt(max.text, 60) * 1000).clamp(10000, 300000).toInt(),
              20,
              180000,
              300000,
              mode == 'schedule' || mode == 'recurring'
                  ? scheduled.text.trim().replaceFirst(' ', 'T')
                  : '',
              mode == 'recurring'
                  ? _asInt(recurrence.text, 24) *
                        (recurrenceUnit == 'days'
                            ? 1440
                            : recurrenceUnit == 'hours'
                            ? 60
                            : 1)
                  : 0,
              false,
              23 * 60,
              6 * 60,
              'America/Sao_Paulo',
            ),
          ),
          icon: Icon(
            mode == 'schedule' || mode == 'recurring'
                ? Icons.schedule_send_rounded
                : Icons.send_rounded,
          ),
          label: Text(
            mode == 'recurring'
                ? 'Ativar recorrência'
                : mode == 'schedule'
                ? 'Agendar início'
                : 'Enviar agora',
          ),
        ),
      ],
    );
  }
}

class _ScheduleSettingsResult {
  const _ScheduleSettingsResult(this.recurrenceMinutes, this.quietHours);
  final int recurrenceMinutes;
  final Map<String, dynamic> quietHours;
}

class _RecurrenceEditorDialog extends StatefulWidget {
  const _RecurrenceEditorDialog({
    required this.initialMinutes,
    this.initialQuietHours,
  });
  final int initialMinutes;
  final Map<String, dynamic>? initialQuietHours;
  @override
  State<_RecurrenceEditorDialog> createState() =>
      _RecurrenceEditorDialogState();
}

class _RecurrenceEditorDialogState extends State<_RecurrenceEditorDialog> {
  late final TextEditingController amount;
  late String unit;
  bool recurring = true;
  late bool quietHoursEnabled;
  late TimeOfDay quietStart;
  late TimeOfDay quietEnd;

  @override
  void initState() {
    super.initState();
    final minutes = widget.initialMinutes <= 0 ? 60 : widget.initialMinutes;
    if (minutes % 1440 == 0) {
      unit = 'days';
      amount = TextEditingController(text: '${minutes ~/ 1440}');
    } else if (minutes % 60 == 0) {
      unit = 'hours';
      amount = TextEditingController(text: '${minutes ~/ 60}');
    } else {
      unit = 'minutes';
      amount = TextEditingController(text: '$minutes');
    }
    recurring = widget.initialMinutes > 0;
    final quiet = widget.initialQuietHours;
    quietHoursEnabled = quiet?['enabled'] == true;
    final start = _asInt(
      quiet?['startMinutes'],
      23 * 60,
    ).clamp(0, 1439).toInt();
    final end = _asInt(quiet?['endMinutes'], 6 * 60).clamp(0, 1439).toInt();
    quietStart = TimeOfDay(hour: start ~/ 60, minute: start % 60);
    quietEnd = TimeOfDay(hour: end ~/ 60, minute: end % 60);
  }

  @override
  void dispose() {
    amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Configurar programação'),
    content: SizedBox(
      width: 420,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: recurring,
            onChanged: (value) => setState(() => recurring = value),
            title: const Text('Repetir automaticamente'),
            subtitle: const Text(
              'Desative para executar somente no próximo horário.',
            ),
          ),
          if (recurring)
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: amount,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Intervalo'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: unit,
                    decoration: const InputDecoration(labelText: 'Unidade'),
                    items: const [
                      DropdownMenuItem(
                        value: 'minutes',
                        child: Text('Minutos'),
                      ),
                      DropdownMenuItem(value: 'hours', child: Text('Horas')),
                      DropdownMenuItem(value: 'days', child: Text('Dias')),
                    ],
                    onChanged: (value) =>
                        setState(() => unit = value ?? 'hours'),
                  ),
                ),
              ],
            ),
          const SizedBox(height: 8),
          const Divider(),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: quietHoursEnabled,
            onChanged: (value) => setState(() => quietHoursEnabled = value),
            secondary: const Icon(Icons.bedtime_outlined),
            title: const Text('Pausa automática à noite'),
            subtitle: const Text(
              'O envio continua automaticamente no horário permitido.',
            ),
          ),
          if (quietHoursEnabled)
            Row(
              children: [
                Expanded(
                  child: _QuietTimeButton(
                    label: 'Pausar às',
                    value: quietStart.format(context),
                    onTap: () async {
                      final picked = await showTimePicker(
                        context: context,
                        initialTime: quietStart,
                      );
                      if (picked != null && mounted)
                        setState(() => quietStart = picked);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _QuietTimeButton(
                    label: 'Retomar às',
                    value: quietEnd.format(context),
                    onTap: () async {
                      final picked = await showTimePicker(
                        context: context,
                        initialTime: quietEnd,
                      );
                      if (picked != null && mounted)
                        setState(() => quietEnd = picked);
                    },
                  ),
                ),
              ],
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
          final raw = recurring
              ? _asInt(amount.text, 1).clamp(1, 43200).toInt()
              : 0;
          final factor = unit == 'days'
              ? 1440
              : unit == 'hours'
              ? 60
              : 1;
          Navigator.pop(
            context,
            _ScheduleSettingsResult(
              recurring ? raw * factor : 0,
              quietHoursEnabled
                  ? {
                      'enabled': true,
                      'startMinutes': quietStart.hour * 60 + quietStart.minute,
                      'endMinutes': quietEnd.hour * 60 + quietEnd.minute,
                      'timezone': 'America/Sao_Paulo',
                    }
                  : {'enabled': false},
            ),
          );
        },
        child: const Text('Salvar configurações'),
      ),
    ],
  );
}

class _ContactSheetFrame extends StatelessWidget {
  const _ContactSheetFrame({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return FractionallySizedBox(
      heightFactor: .94,
      child: Container(
        decoration: BoxDecoration(
          color: wa.panel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Expanded(child: child),
          ],
        ),
      ),
    );
  }
}

class _NoLists extends StatelessWidget {
  const _NoLists();
  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.campaign_outlined, size: 52),
          SizedBox(height: 12),
          Text(
            'Nenhuma lista criada',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17),
          ),
          SizedBox(height: 6),
          Text(
            'Crie sua primeira lista para adicionar contatos ou grupos e conversar com ela.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    ),
  );
}

class _EmptyPanel extends StatelessWidget {
  const _EmptyPanel({required this.wa, this.onCreateProfile});
  final WaTheme wa;
  final VoidCallback? onCreateProfile;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: wa.isDark
            ? const [Color(0xFF111B21), Color(0xFF0B141A)]
            : const [Color(0xFFF7FBFA), Color(0xFFEAF6F2)],
      ),
    ),
    child: Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 30, 24, 36),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 430),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: wa.panel,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: wa.border),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: wa.isDark ? .18 : .07),
                  blurRadius: 28,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(26, 28, 26, 26),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 68,
                    height: 68,
                    decoration: BoxDecoration(
                      color: wa.accentSoft,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.campaign_rounded,
                      color: wa.accent,
                      size: 34,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Suas transmissões começam aqui',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: 21,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Você poderá começar a disparar mensagens quando conectar seu primeiro perfil do WhatsApp.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: wa.textSecondary,
                      fontSize: 14.5,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: onCreateProfile,
                      icon: const Icon(Icons.add_rounded),
                      label: const Text('Criar perfil'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.text,
    required this.run,
    required this.runContacts,
    required this.instanceId,
    required this.listId,
    required this.onEdit,
    this.payload,
    this.createdAt,
  });
  final String text;
  final Map<String, dynamic>? payload;
  final String? createdAt;
  final Map<String, dynamic>? run;
  final List<Map<String, dynamic>> runContacts;
  final int instanceId;
  final String listId;
  final VoidCallback onEdit;
  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final media = payload?['media'] is Map
        ? Map<String, dynamic>.from(payload!['media'] as Map)
        : null;
    final buttons = _buttonsFromPayload(payload?['buttons']);
    final created = DateTime.tryParse(createdAt ?? '')?.toLocal();
    final time = created == null
        ? 'enviada'
        : '${created.hour.toString().padLeft(2, '0')}:${created.minute.toString().padLeft(2, '0')}';
    final total = _asInt(run?['total']);
    final sent = _asInt(run?['sent']);
    final runId = run?['id']?.toString() ?? '';
    final contactsRunId = runContacts.isEmpty
        ? ''
        : runContacts.first['runId']?.toString() ?? '';
    final canViewProgress =
        run != null &&
        (contactsRunId.isEmpty || contactsRunId == runId) &&
        instanceId > 0 &&
        listId.isNotEmpty;
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        constraints: BoxConstraints(maxWidth: width < 700 ? width : 560),
        margin: const EdgeInsets.only(bottom: 10),
        child: _BroadcastAdaptiveCard(
          body: text,
          media: media,
          buttons: buttons,
          compact: width < 700,
          selected: false,
          fullContent: true,
          metaLabel: time,
          deliveryLabel: run == null || run?['scheduleId'] != null
              ? null
              : '$sent/$total',
          onViewProgress: !canViewProgress
              ? null
              : () => _showRunProgress(
                  context,
                  instanceId,
                  listId,
                  run!,
                  runContacts,
                ),
          onEditContent: onEdit,
        ),
      ),
    );
  }
}

class _RunBubble extends StatelessWidget {
  const _RunBubble({required this.run});
  final Map<String, dynamic> run;
  @override
  Widget build(BuildContext context) {
    final status = run['status']?.toString() ?? '';
    final failed = _asInt(run['failed']);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          'Envio ${_runLabel(status)} · ${_asInt(run['sent'])}/${_asInt(run['total'])} enviados${failed > 0 ? ' · $failed falhas' : ''}',
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

class _RunProgressCard extends StatefulWidget {
  const _RunProgressCard({
    required this.run,
    required this.recurringSchedule,
    required this.contacts,
    required this.instanceId,
    required this.listId,
  });
  final Map<String, dynamic> run;
  final Map<String, dynamic>? recurringSchedule;
  final List<Map<String, dynamic>> contacts;
  final int instanceId;
  final String listId;
  @override
  State<_RunProgressCard> createState() => _RunProgressCardState();
}

class _RunProgressCardState extends State<_RunProgressCard> {
  Timer? ticker;
  @override
  void initState() {
    super.initState();
    ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final total = _asInt(widget.run['total']);
    final sent = _asInt(widget.run['sent']);
    final failed = _asInt(widget.run['failed']);
    final done = sent + failed;
    final status = widget.run['status']?.toString() ?? '';
    final running = status == 'queued' || status == 'running';
    final recurringSchedule = widget.recurringSchedule;
    final recurrenceMinutes = _asInt(recurringSchedule?['recurrenceMinutes']);
    final recurringActive =
        recurrenceMinutes > 0 &&
        recurringSchedule?['status']?.toString() == 'pending';
    final nextCycleAt = DateTime.tryParse(
      recurringSchedule?['scheduledFor']?.toString() ?? '',
    )?.toLocal();
    final nextCycleSeconds = nextCycleAt == null
        ? 0
        : nextCycleAt.difference(DateTime.now()).inSeconds.clamp(0, 2592000);
    final cycleSeconds = recurrenceMinutes * 60;
    final cycleProgress = cycleSeconds > 0
        ? (1 - (nextCycleSeconds / cycleSeconds)).clamp(0.0, 1.0)
        : 0.0;
    final occurrenceCount = _asInt(recurringSchedule?['occurrenceCount']);
    Map<String, dynamic>? current;
    Map<String, dynamic>? next;
    for (final contact in widget.contacts) {
      if (contact['status'] == 'sending') current = contact;
      if (next == null && contact['status'] == 'pending') next = contact;
    }
    final nextAt = DateTime.tryParse(
      next?['scheduledAt']?.toString() ?? '',
    )?.toLocal();
    final seconds = nextAt == null
        ? 0
        : nextAt.difference(DateTime.now()).inSeconds.clamp(0, 86400);
    final person =
        (current?['name']?.toString().trim().isNotEmpty == true
                ? current!['name']
                : next?['name'])
            ?.toString()
            .trim();
    final phone =
        current?['phone']?.toString() ?? next?['phone']?.toString() ?? '';
    final runLabel = current != null
        ? 'Enviando agora para ${person?.isNotEmpty == true ? person : _formatPhone(phone)}'
        : next != null
        ? 'Próximo: ${person?.isNotEmpty == true ? person : _formatPhone(phone)}${seconds > 0 ? ' em ${_shortDuration(seconds)}' : ''}'
        : running
        ? 'Preparando o próximo envio…'
        : _runLabel(status);
    final label = recurringActive && !running
        ? 'Próximo envio em ${_clockDuration(nextCycleSeconds)}${nextCycleAt == null ? '' : ' · ${_shortDateTime(nextCycleAt)}'}'
        : runLabel;
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        width: 520,
        constraints: const BoxConstraints(maxWidth: 560),
        margin: const EdgeInsets.only(top: -7, bottom: 13),
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
        decoration: BoxDecoration(
          color: wa.bubbleOut,
          borderRadius: const BorderRadius.only(
            bottomLeft: Radius.circular(12),
            bottomRight: Radius.circular(12),
            topLeft: Radius.circular(12),
          ),
          border: Border.all(color: wa.accent.withValues(alpha: .28)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  recurringActive
                      ? Icons.autorenew_rounded
                      : running
                      ? Icons.outgoing_mail
                      : status == 'failed'
                      ? Icons.error_outline
                      : Icons.task_alt_rounded,
                  size: 18,
                  color: recurringActive
                      ? wa.accent
                      : running
                      ? wa.accent
                      : status == 'failed'
                      ? Colors.red
                      : Colors.green,
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    recurringActive
                        ? 'Recorrência ativa'
                        : running
                        ? 'Transmissão em andamento'
                        : 'Transmissão ${_runLabel(status)}',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
                Text(
                  recurringActive && !running
                      ? _clockDuration(nextCycleSeconds)
                      : '$done/$total',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
            const SizedBox(height: 9),
            ClipRRect(
              borderRadius: BorderRadius.circular(9),
              child: LinearProgressIndicator(
                value: recurringActive && !running
                    ? cycleProgress
                    : total > 0
                    ? done / total
                    : 0,
                minHeight: 8,
                backgroundColor: Colors.black.withValues(alpha: .08),
                color: failed > 0 && !running ? Colors.orange : wa.accent,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: wa.textSecondary),
            ),
            LayoutBuilder(
              builder: (context, constraints) {
                final summary = Text(
                  recurringActive && !running
                      ? '$occurrenceCount ciclo(s) realizado(s) · $sent enviado(s) no último ciclo'
                      : '$sent enviado(s)${failed > 0 ? ' · $failed falha(s)' : ''}',
                  style: TextStyle(fontSize: 12, color: wa.textSecondary),
                );
                final action = TextButton.icon(
                  onPressed: () => _showRunProgress(
                    context,
                    widget.instanceId,
                    widget.listId,
                    widget.run,
                    widget.contacts,
                  ),
                  icon: const Icon(Icons.list_alt_rounded, size: 17),
                  label: const Text('Ver progresso'),
                );
                if (constraints.maxWidth < 430) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 5),
                        child: summary,
                      ),
                      Align(alignment: Alignment.centerRight, child: action),
                    ],
                  );
                }
                return Row(
                  children: [
                    Expanded(child: summary),
                    action,
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _NewSheetContactsDialog extends StatelessWidget {
  const _NewSheetContactsDialog({required this.amount, required this.contacts});
  final int amount;
  final List<Map<String, dynamic>> contacts;
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Row(
      children: [
        const Icon(Icons.person_add_alt_1_rounded),
        const SizedBox(width: 9),
        Expanded(child: Text('$amount novo(s) contato(s)')),
      ],
    ),
    content: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 480),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'A planilha mudou desde a última sincronização. Deseja incluir os novos contatos nesta transmissão?',
          ),
          if (contacts.isNotEmpty) ...[
            const SizedBox(height: 12),
            ...contacts
                .take(5)
                .map<Widget>(
                  (contact) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(
                      radius: 17,
                      child: Icon(Icons.person_outline_rounded, size: 18),
                    ),
                    title: Text(
                      contact['name']?.toString().trim().isNotEmpty == true
                          ? contact['name'].toString()
                          : 'Sem nome',
                    ),
                    subtitle: Text(
                      _formatPhone(contact['phone']?.toString() ?? ''),
                    ),
                  ),
                ),
            if (amount > 5) Text('e mais ${amount - 5} contato(s)…'),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      TextButton(
        onPressed: () => Navigator.pop(context, 'skip'),
        child: const Text('Enviar sem incluir'),
      ),
      FilledButton.icon(
        onPressed: () => Navigator.pop(context, 'include'),
        icon: const Icon(Icons.sync_rounded),
        label: const Text('Incluir e enviar'),
      ),
    ],
  );
}

void _showRunProgress(
  BuildContext context,
  int instanceId,
  String listId,
  Map<String, dynamic> run,
  List<Map<String, dynamic>> contacts,
) {
  showBotAdminBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => _RunProgressSheet(
      instanceId: instanceId,
      listId: listId,
      initialRun: run,
      initialContacts: contacts,
    ),
  );
}

class _RunProgressSheet extends ConsumerStatefulWidget {
  const _RunProgressSheet({
    required this.instanceId,
    required this.listId,
    required this.initialRun,
    required this.initialContacts,
  });
  final int instanceId;
  final String listId;
  final Map<String, dynamic> initialRun;
  final List<Map<String, dynamic>> initialContacts;
  @override
  ConsumerState<_RunProgressSheet> createState() => _RunProgressSheetState();
}

class _RunProgressSheetState extends ConsumerState<_RunProgressSheet> {
  late Map<String, dynamic> run;
  late List<Map<String, dynamic>> contacts;
  Timer? poller;
  bool polling = false;
  @override
  void initState() {
    super.initState();
    run = widget.initialRun;
    contacts = widget.initialContacts;
    poller = Timer.periodic(const Duration(seconds: 2), (_) => load());
  }

  @override
  void dispose() {
    poller?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    if (polling || widget.instanceId <= 0 || widget.listId.isEmpty) return;
    polling = true;
    try {
      final detail = await ref
          .read(apiClientProvider)
          .loadBroadcastList(widget.instanceId, widget.listId);
      if (!mounted) return;
      final runs = _records(detail['runs']);
      setState(() {
        if (runs.isNotEmpty) run = runs.first;
        contacts = _records(detail['latestRunContacts']);
      });
      if (!['queued', 'running'].contains(run['status']?.toString())) {
        poller?.cancel();
      }
    } catch (_) {
    } finally {
      polling = false;
    }
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    height: MediaQuery.sizeOf(context).height * .78,
    child: Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 14),
          child: Row(
            children: [
              const Expanded(
                child: Text(
                  'Progresso da transmissão',
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                ),
              ),
              Text(
                '${_asInt(run['sent'])}/${_asInt(run['total'])} enviados',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: contacts.isEmpty
              ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
              : ListView.separated(
                  itemCount: contacts.length,
                  separatorBuilder: (_, __) =>
                      const Divider(height: 1, indent: 66),
                  itemBuilder: (_, index) {
                    final contact = contacts[index];
                    final status = contact['status']?.toString() ?? 'pending';
                    final name = contact['name']?.toString().trim() ?? '';
                    final icon = switch (status) {
                      'sent' => Icons.check_circle_rounded,
                      'failed' => Icons.error_rounded,
                      'sending' => Icons.send_rounded,
                      _ => Icons.schedule_rounded,
                    };
                    final color = switch (status) {
                      'sent' => Colors.green,
                      'failed' => Colors.red,
                      'sending' => Colors.orange,
                      _ => Colors.grey,
                    };
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundColor: color.withValues(alpha: .12),
                        foregroundColor: color,
                        child: Icon(icon, size: 19),
                      ),
                      title: Text(
                        name.isNotEmpty
                            ? name
                            : _formatPhone(contact['phone']?.toString() ?? ''),
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      subtitle: Text(
                        name.isNotEmpty
                            ? _formatPhone(contact['phone']?.toString() ?? '')
                            : _recipientStatusLabel(status),
                      ),
                      trailing: Text(
                        _recipientStatusLabel(status),
                        style: TextStyle(
                          color: color,
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    ),
  );
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.status});
  final String status;
  @override
  Widget build(BuildContext context) {
    final running = status == 'running' || status == 'queued';
    return Tooltip(
      message: _runLabel(status),
      child: Icon(
        running
            ? Icons.sync_rounded
            : status.startsWith('completed')
            ? Icons.check_circle_rounded
            : Icons.circle_outlined,
        size: 18,
        color: running
            ? Colors.orange
            : status.startsWith('completed')
            ? Colors.green
            : Colors.grey,
      ),
    );
  }
}

class _GoogleSheetSelection {
  const _GoogleSheetSelection(this.url, this.mapping);
  final String url;
  final Map<String, dynamic> mapping;
}

class _CreateListDraft {
  const _CreateListDraft(
    this.name,
    this.description,
    this.contacts,
    this.googleSheetUrl,
    this.googleSheetMapping,
  );
  final String name, description, googleSheetUrl;
  final List<Map<String, dynamic>> contacts;
  final Map<String, dynamic>? googleSheetMapping;
}

class _ContactImportDraft {
  const _ContactImportDraft(
    this.contacts,
    this.googleSheetUrl,
    this.googleSheetMapping,
  );
  final List<Map<String, dynamic>> contacts;
  final String googleSheetUrl;
  final Map<String, dynamic>? googleSheetMapping;
}

class _SendSettings {
  const _SendSettings(
    this.mode,
    this.typing,
    this.minDelayMs,
    this.maxDelayMs,
    this.batchSize,
    this.batchPauseMinMs,
    this.batchPauseMaxMs,
    this.scheduledAt,
    this.recurrenceMinutes,
    this.quietHoursEnabled,
    this.quietStartMinutes,
    this.quietEndMinutes,
    this.timezone,
  );
  final String mode;
  final bool typing;
  final int minDelayMs, maxDelayMs;
  final int batchSize, batchPauseMinMs, batchPauseMaxMs;
  final String scheduledAt;
  final int recurrenceMinutes;
  final bool quietHoursEnabled;
  final int quietStartMinutes, quietEndMinutes;
  final String timezone;

  Map<String, dynamic> get pacing => {
    'batchSize': batchSize,
    'batchPauseMinMs': batchPauseMinMs,
    'batchPauseMaxMs': batchPauseMaxMs,
  };
}

List<Map<String, dynamic>> _records(Object? value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList()
    : const [];
List<String> _asStringList(Object? value) => value is List
    ? value
          .map((item) => item.toString().trim())
          .where((item) => item.isNotEmpty)
          .toList()
    : const [];
int _asInt(Object? value, [int fallback = 0]) =>
    value is int ? value : int.tryParse(value?.toString() ?? '') ?? fallback;
String _preview(Object? value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? 'Nenhuma mensagem ainda' : text;
}

String _digits(String value) => value.replaceAll(RegExp(r'\D+'), '');
String _phoneKey(String value) {
  var d = _digits(value);
  if (d.length == 10 || d.length == 11) d = '55$d';
  if (d.startsWith('55') && d.length == 13 && d[4] == '9')
    d = '${d.substring(0, 4)}${d.substring(5)}';
  return d;
}

String _formatPhone(String value) {
  final digits = _digits(value);
  return digits.isEmpty ? value : '+$digits';
}

String _formatRecurrence(int minutes) {
  if (minutes <= 0) return 'Sem recorrência';
  if (minutes % 1440 == 0) {
    final days = minutes ~/ 1440;
    return 'a cada $days ${days == 1 ? 'dia' : 'dias'}';
  }
  if (minutes % 60 == 0) {
    final hours = minutes ~/ 60;
    return 'a cada $hours ${hours == 1 ? 'hora' : 'horas'}';
  }
  return 'a cada $minutes min';
}

String _minutesAsClock(int minutes) {
  final safe = minutes.clamp(0, 1439);
  return '${(safe ~/ 60).toString().padLeft(2, '0')}:${(safe % 60).toString().padLeft(2, '0')}';
}

String? _contactPhone(WhatsAppContact contact) {
  final direct = _digits(contact.phone);
  if (direct.length >= 10 && direct.length <= 13) return direct;
  final jid = _digits(contact.jid.split('@').first);
  return jid.length >= 10 && jid.length <= 13 ? jid : null;
}

String _runLabel(String status) => switch (status) {
  'queued' => 'na fila',
  'running' => 'em andamento',
  'completed' => 'concluído',
  'completed_with_errors' => 'concluído com falhas',
  'failed' => 'falhou',
  _ => 'aguardando',
};
String _recipientStatusLabel(String status) => switch (status) {
  'sending' => 'enviando agora',
  'sent' => 'enviado',
  'failed' => 'falhou',
  _ => 'aguardando',
};
String _shortDuration(int seconds) {
  final minutes = seconds ~/ 60;
  final rest = seconds % 60;
  return minutes > 0
      ? '${minutes}m ${rest.toString().padLeft(2, '0')}s'
      : '${rest}s';
}

String _clockDuration(int seconds) {
  final safe = seconds.clamp(0, 2592000);
  final hours = safe ~/ 3600;
  final minutes = (safe % 3600) ~/ 60;
  final rest = safe % 60;
  if (hours > 0) {
    return '${hours.toString().padLeft(2, '0')}:${minutes.toString().padLeft(2, '0')}:${rest.toString().padLeft(2, '0')}';
  }
  return '${minutes.toString().padLeft(2, '0')}:${rest.toString().padLeft(2, '0')}';
}

String _shortDateTime(DateTime value) =>
    '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';

Map<String, dynamic>? _recurringScheduleForRun(
  List<Map<String, dynamic>> schedules,
  Map<String, dynamic> run,
) {
  final runId = run['id']?.toString() ?? '';
  if (runId.isEmpty) return null;
  for (final schedule in schedules) {
    if (_asInt(schedule['recurrenceMinutes']) > 0 &&
        schedule['runId']?.toString() == runId) {
      return schedule;
    }
  }
  return null;
}

Map<String, dynamic>? _runById(List<Map<String, dynamic>> runs, Object? id) {
  final wanted = id?.toString() ?? '';
  if (wanted.isEmpty) return null;
  for (final run in runs) {
    if (run['id']?.toString() == wanted) return run;
  }
  return null;
}

Map<String, dynamic>? _runForMessage(
  List<Map<String, dynamic>> runs,
  Object? messageId,
) {
  final wanted = messageId?.toString() ?? '';
  if (wanted.isEmpty) return null;
  for (final run in runs) {
    if (run['messageId']?.toString() == wanted) return run;
  }
  return null;
}

IconData _mediaIcon(String type) => switch (type) {
  'image' => Icons.image_outlined,
  'video' => Icons.video_file_outlined,
  'audio' => Icons.audio_file_outlined,
  _ => Icons.insert_drive_file_outlined,
};
IconData _broadcastButtonIcon(String type) => switch (type) {
  'cta_url' => Icons.open_in_new_rounded,
  'cta_copy' => Icons.copy_rounded,
  'cta_call' => Icons.phone_rounded,
  _ => Icons.reply_rounded,
};
List<OutgoingInteractiveButton> _buttonsFromPayload(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((raw) {
        final item = Map<String, dynamic>.from(raw);
        return OutgoingInteractiveButton(
          id: item['id']?.toString() ?? 'broadcast_button',
          text: item['text']?.toString() ?? '',
          type: item['type']?.toString() ?? 'quick_reply',
          url: item['url']?.toString(),
          copyCode: item['copyCode']?.toString(),
        );
      })
      .where((item) => item.text.trim().isNotEmpty)
      .take(3)
      .toList();
}

String _mimeFor(String name) {
  final ext = name.split('.').last.toLowerCase();
  return switch (ext) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    'mp4' => 'video/mp4',
    'mov' => 'video/quicktime',
    'mkv' => 'video/x-matroska',
    'mp3' => 'audio/mpeg',
    'ogg' => 'audio/ogg',
    'opus' => 'audio/ogg',
    'pdf' => 'application/pdf',
    'doc' => 'application/msword',
    'docx' =>
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls' => 'application/vnd.ms-excel',
    'xlsx' =>
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    _ => 'application/octet-stream',
  };
}

void _showEmojiPicker(BuildContext context, TextEditingController controller) {
  const emojis = [
    '😀',
    '😁',
    '😂',
    '😍',
    '🔥',
    '✅',
    '🎉',
    '📌',
    '❤️',
    '👍',
    '🙏',
    '✨',
    '💬',
    '📲',
    '🚀',
  ];
  showBotAdminBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (_) => Padding(
      padding: const EdgeInsets.all(16),
      child: Wrap(
        spacing: 10,
        runSpacing: 10,
        children: emojis
            .map(
              (emoji) => InkResponse(
                onTap: () {
                  final selection = controller.selection;
                  final pos = selection.start < 0
                      ? controller.text.length
                      : selection.start;
                  controller.text =
                      '${controller.text.substring(0, pos)}$emoji${controller.text.substring(pos)}';
                  controller.selection = TextSelection.collapsed(
                    offset: pos + emoji.length,
                  );
                  Navigator.pop(context);
                },
                child: Text(emoji, style: const TextStyle(fontSize: 27)),
              ),
            )
            .toList(),
      ),
    ),
  );
}

void _showBroadcastActions(
  BuildContext context, {
  required VoidCallback onAttach,
  required VoidCallback onButtons,
  required VoidCallback onVariables,
  required TextEditingController composer,
}) {
  showBotAdminBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 4, 18, 22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Adicionar à transmissão',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              childAspectRatio: 2.9,
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              children: [
                _BroadcastActionTile(
                  icon: Icons.attach_file_rounded,
                  label: 'Mídia',
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onAttach();
                  },
                ),
                _BroadcastActionTile(
                  icon: Icons.smart_button_outlined,
                  label: 'Botões',
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onButtons();
                  },
                ),
                _BroadcastActionTile(
                  icon: Icons.data_object_rounded,
                  label: 'Variáveis',
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onVariables();
                  },
                ),
                _BroadcastActionTile(
                  icon: Icons.emoji_emotions_outlined,
                  label: 'Emoji',
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _showEmojiPicker(context, composer);
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}

class _BroadcastActionTile extends StatelessWidget {
  const _BroadcastActionTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    onPressed: onTap,
    icon: Icon(icon),
    label: Text(label),
  );
}

List<Map<String, dynamic>> _parseImportedContacts(String content) {
  final trimmed = content.trim();
  if (trimmed.isEmpty) return const [];
  if (trimmed.startsWith('[')) {
    final raw = jsonDecode(trimmed);
    if (raw is! List) throw const FormatException();
    return raw
        .whereType<Map>()
        .map((item) => _contactMap(Map<String, dynamic>.from(item), 'arquivo'))
        .whereType<Map<String, dynamic>>()
        .toList();
  }
  final lines = trimmed.split(RegExp(r'\r?\n'));
  final header = lines
      .removeAt(0)
      .split(RegExp('[,;]'))
      .map((item) => item.trim().toLowerCase())
      .toList();
  int find(List<String> names) =>
      header.indexWhere((item) => names.contains(item));
  final name = find(['nome', 'name', 'cliente']);
  final phone = find(['telefone', 'phone', 'numero', 'whatsapp', 'celular']);
  final location = find(['localizacao', 'location', 'cidade', 'endereco']);
  final details = find(['detalhes', 'details', 'obs', 'observacao']);
  if (phone < 0) throw const FormatException();
  return lines
      .map((line) {
        final row = line.split(RegExp('[,;]'));
        String at(int index) =>
            index >= 0 && index < row.length ? row[index].trim() : '';
        return _contactMap({
          'name': at(name),
          'phone': at(phone),
          'location': at(location),
          'details': at(details),
        }, 'arquivo');
      })
      .whereType<Map<String, dynamic>>()
      .toList();
}

Map<String, dynamic>? _contactMap(Map<String, dynamic> raw, String source) {
  final phone = _digits(
    (raw['phone'] ?? raw['telefone'] ?? raw['numero'] ?? raw['whatsapp'] ?? '')
        .toString(),
  );
  if (phone.length < 10) return null;
  return {
    'name': (raw['name'] ?? raw['nome'] ?? raw['cliente'] ?? '').toString(),
    'phone': phone,
    'location': (raw['location'] ?? raw['localizacao'] ?? raw['cidade'] ?? '')
        .toString(),
    'details': (raw['details'] ?? raw['detalhes'] ?? raw['obs'] ?? '')
        .toString(),
    'source': source,
  };
}
