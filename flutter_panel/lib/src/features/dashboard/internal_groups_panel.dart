import 'dart:async';
import 'dart:math' as math;
import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/app_config.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/top_toast.dart';
import '../../core/wa_theme.dart';
import '../../core/whatsapp_realtime_client.dart';
import '../../models/internal_group.dart';
import '../../models/conversation_thread.dart';
import '../chat/media_local_file.dart';
import '../chat/media_players.dart';
import 'dashboard_controller.dart';

final selectedInternalGroupIdProvider =
    NotifierProvider<SelectedInternalGroupIdController, int?>(
      SelectedInternalGroupIdController.new,
    );

class SelectedInternalGroupIdController extends Notifier<int?> {
  @override
  int? build() =>
      int.tryParse(Uri.base.queryParameters['internalGroupId']?.trim() ?? '');

  void select(int? value) => state = value;
}

Future<void> showInternalGroupManagement(
  BuildContext context,
  WidgetRef ref,
  ConversationThread thread, {
  VoidCallback? onDeleted,
}) async {
  final groupId =
      thread.linkedGroupId ?? int.tryParse(thread.chatJid.split(':').last);
  if (groupId == null) {
    showErrorToast(context, 'Não foi possível identificar o grupo BotAdmin.');
    return;
  }
  try {
    final details = await ref
        .read(apiClientProvider)
        .loadInternalGroup(groupId);
    if (!context.mounted) return;
    await showBotAdminBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) =>
          _InternalGroupManagementSheet(initial: details, onDeleted: onDeleted),
    );
  } catch (error) {
    if (context.mounted) showErrorToast(context, error.toString());
  }
}

Future<InternalGroup?> showCreateInternalGroupDialog(
  BuildContext context,
  WidgetRef ref,
) async {
  final name = TextEditingController();
  final description = TextEditingController();
  XFile? avatarFile;
  Uint8List? avatarBytes;
  String? dialogError;
  bool pickingAvatar = false;
  try {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Criar grupo BotAdmin'),
          content: SingleChildScrollView(
            child: SizedBox(
              width: 430,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'O grupo usa o chat do BotAdmin e não depende do WhatsApp. Convidados entram pelo link privado.',
                  ),
                  const SizedBox(height: 16),
                  InkWell(
                    borderRadius: BorderRadius.circular(48),
                    onTap: pickingAvatar
                        ? null
                        : () async {
                            setDialogState(() {
                              pickingAvatar = true;
                              dialogError = null;
                            });
                            try {
                              final file = await openFile(
                                acceptedTypeGroups: const [
                                  XTypeGroup(
                                    label: 'Imagem',
                                    extensions: ['jpg', 'jpeg', 'png', 'webp'],
                                  ),
                                ],
                              );
                              if (file == null || !dialogContext.mounted) {
                                return;
                              }
                              final bytes = await file.readAsBytes();
                              if (bytes.length > 8 * 1024 * 1024) {
                                throw Exception(
                                  'A foto deve ter no máximo 8 MB.',
                                );
                              }
                              setDialogState(() {
                                avatarFile = file;
                                avatarBytes = bytes;
                              });
                            } catch (error) {
                              if (dialogContext.mounted) {
                                setDialogState(
                                  () => dialogError = error
                                      .toString()
                                      .replaceFirst('Exception: ', ''),
                                );
                              }
                            } finally {
                              if (dialogContext.mounted) {
                                setDialogState(() => pickingAvatar = false);
                              }
                            }
                          },
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        CircleAvatar(
                          radius: 43,
                          backgroundColor: WaTheme.of(context).searchBg,
                          backgroundImage: avatarBytes == null
                              ? null
                              : MemoryImage(avatarBytes!),
                          child: avatarBytes == null
                              ? Icon(
                                  Icons.groups_3_rounded,
                                  size: 40,
                                  color: WaTheme.of(context).icon,
                                )
                              : null,
                        ),
                        Positioned(
                          right: -3,
                          bottom: -3,
                          child: CircleAvatar(
                            radius: 16,
                            backgroundColor: WaTheme.of(context).accent,
                            foregroundColor: Colors.white,
                            child: pickingAvatar
                                ? const SizedBox.square(
                                    dimension: 15,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(
                                    Icons.add_a_photo_rounded,
                                    size: 17,
                                  ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    avatarBytes == null
                        ? 'Adicionar foto (opcional)'
                        : 'Trocar foto do grupo',
                    style: TextStyle(
                      color: WaTheme.of(context).accent,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: name,
                    autofocus: true,
                    maxLength: 120,
                    decoration: const InputDecoration(
                      labelText: 'Nome do grupo',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: description,
                    maxLength: 500,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Descrição opcional',
                    ),
                  ),
                  if (dialogError != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      dialogError!,
                      style: const TextStyle(color: Color(0xFFE53935)),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: pickingAvatar
                  ? null
                  : () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton.icon(
              onPressed: pickingAvatar
                  ? null
                  : () {
                      if (name.text.trim().isEmpty) {
                        setDialogState(
                          () => dialogError = 'Informe o nome do grupo.',
                        );
                        return;
                      }
                      Navigator.pop(dialogContext, true);
                    },
              icon: const Icon(Icons.add_rounded),
              label: const Text('Criar'),
            ),
          ],
        ),
      ),
    );
    if (accepted != true || !context.mounted) return null;
    final created = await ref
        .read(apiClientProvider)
        .createInternalGroup(
          name: name.text.trim(),
          description: description.text.trim(),
        );
    var group = created.group;
    if (avatarFile != null && avatarBytes != null) {
      group = await ref
          .read(apiClientProvider)
          .uploadInternalGroupAvatar(
            group.id,
            bytes: avatarBytes!,
            fileName: avatarFile!.name,
            mimeType: avatarFile!.mimeType ?? _mimeForName(avatarFile!.name),
          );
    }
    if (created.inviteUrl != null) {
      await Clipboard.setData(ClipboardData(text: created.inviteUrl!));
    }
    ref.invalidate(dashboardSnapshotProvider);
    if (context.mounted) {
      showSuccessToast(
        context,
        created.inviteUrl == null
            ? 'Grupo criado.'
            : 'Grupo criado e link privado copiado.',
      );
    }
    return group;
  } catch (error) {
    if (context.mounted) showErrorToast(context, error.toString());
    return null;
  } finally {
    name.dispose();
    description.dispose();
  }
}

Future<InternalGroup?> showJoinInternalGroupDialog(
  BuildContext context,
  WidgetRef ref,
) async {
  final controller = TextEditingController();
  try {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Entrar em grupo BotAdmin'),
        content: SizedBox(
          width: 430,
          child: TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Link ou código do convite',
              hintText: 'https://botadmin.shop/g/...',
              prefixIcon: Icon(Icons.link_rounded),
            ),
          ),
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
    if (accepted != true || !context.mounted) return null;
    final group = await ref
        .read(apiClientProvider)
        .joinInternalGroup(controller.text);
    ref.invalidate(dashboardSnapshotProvider);
    if (context.mounted) {
      showSuccessToast(context, 'Você entrou em ${group.name}.');
    }
    return group;
  } catch (error) {
    if (context.mounted) showErrorToast(context, error.toString());
    return null;
  } finally {
    controller.dispose();
  }
}

class _InternalGroupManagementSheet extends ConsumerStatefulWidget {
  const _InternalGroupManagementSheet({required this.initial, this.onDeleted});

  final InternalGroupDetails initial;
  final VoidCallback? onDeleted;

  @override
  ConsumerState<_InternalGroupManagementSheet> createState() =>
      _InternalGroupManagementSheetState();
}

class _InternalGroupManagementSheetState
    extends ConsumerState<_InternalGroupManagementSheet> {
  late InternalGroupDetails _details;
  late final TextEditingController _name;
  late final TextEditingController _description;
  late final TextEditingController _botName;
  late bool _membersCanSend;
  late bool _membersCanAdd;
  late bool _approvalRequired;
  late bool _adminsCanEdit;
  late bool _membersCanStartPv;
  late bool _groupOpen;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _details = widget.initial;
    _name = TextEditingController(text: _details.group.name);
    _description = TextEditingController(text: _details.group.description);
    _botName = TextEditingController(text: _details.group.botName);
    _membersCanSend = _details.group.membersCanSend;
    _membersCanAdd = _details.group.membersCanAdd;
    _approvalRequired = _details.group.approvalRequired;
    _adminsCanEdit = _details.group.adminsCanEdit;
    _membersCanStartPv = _details.group.membersCanStartPv;
    _groupOpen = _details.group.membersCanSend;
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _botName.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    final details = await ref
        .read(apiClientProvider)
        .loadInternalGroup(_details.group.id);
    if (!mounted) return;
    setState(() {
      _details = details;
      _membersCanSend = details.group.membersCanSend;
      _membersCanAdd = details.group.membersCanAdd;
      _approvalRequired = details.group.approvalRequired;
      _adminsCanEdit = details.group.adminsCanEdit;
      _membersCanStartPv = details.group.membersCanStartPv;
      _groupOpen = details.group.membersCanSend;
    });
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .updateInternalGroup(
            _details.group.id,
            name: _name.text,
            description: _description.text,
            botName: _botName.text,
            membersCanSend: _membersCanSend,
            membersCanAdd: _membersCanAdd,
            approvalRequired: _approvalRequired,
            adminsCanEdit: _adminsCanEdit,
            membersCanStartPv: _membersCanStartPv,
          );
      await _reload();
      ref.invalidate(dashboardSnapshotProvider);
      if (mounted) showSuccessToast(context, 'Grupo BotAdmin atualizado.');
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _persistPermission(String key, bool value) async {
    if (_busy) return;
    final old = <String, bool>{
      'groupOpen': _groupOpen,
      'membersCanSend': _membersCanSend,
      'membersCanAdd': _membersCanAdd,
      'approvalRequired': _approvalRequired,
      'adminsCanEdit': _adminsCanEdit,
      'membersCanStartPv': _membersCanStartPv,
    }[key];
    setState(() {
      switch (key) {
        case 'groupOpen':
          _groupOpen = value;
          _membersCanSend = value;
        case 'membersCanSend':
          _membersCanSend = value;
          _groupOpen = value;
        case 'membersCanAdd':
          _membersCanAdd = value;
        case 'approvalRequired':
          _approvalRequired = value;
        case 'adminsCanEdit':
          _adminsCanEdit = value;
        case 'membersCanStartPv':
          _membersCanStartPv = value;
      }
      _busy = true;
    });
    try {
      await ref
          .read(apiClientProvider)
          .updateInternalGroup(
            _details.group.id,
            membersCanSend: key == 'membersCanSend' || key == 'groupOpen'
                ? value
                : null,
            membersCanAdd: key == 'membersCanAdd' ? value : null,
            approvalRequired: key == 'approvalRequired' ? value : null,
            adminsCanEdit: key == 'adminsCanEdit' ? value : null,
            membersCanStartPv: key == 'membersCanStartPv' ? value : null,
          );
      await _reload();
      ref.invalidate(dashboardSnapshotProvider);
    } catch (error) {
      if (mounted) {
        if (old != null) {
          setState(() {
            switch (key) {
              case 'groupOpen':
                _groupOpen = old;
                _membersCanSend = old;
              case 'membersCanSend':
                _membersCanSend = old;
                _groupOpen = old;
              case 'membersCanAdd':
                _membersCanAdd = old;
              case 'approvalRequired':
                _approvalRequired = old;
              case 'adminsCanEdit':
                _adminsCanEdit = old;
              case 'membersCanStartPv':
                _membersCanStartPv = old;
            }
          });
        }
        showErrorToast(context, error.toString());
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickAvatar() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(label: 'Imagem', extensions: ['jpg', 'jpeg', 'png', 'webp']),
      ],
    );
    if (file == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 8 * 1024 * 1024) {
        throw Exception('A foto deve ter no máximo 8 MB.');
      }
      await ref
          .read(apiClientProvider)
          .uploadInternalGroupAvatar(
            _details.group.id,
            bytes: bytes,
            fileName: file.name,
            mimeType: file.mimeType ?? _mimeForName(file.name),
          );
      await _reload();
      ref.invalidate(dashboardSnapshotProvider);
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickBotAvatar() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(label: 'Imagem', extensions: ['jpg', 'jpeg', 'png', 'webp']),
      ],
    );
    if (file == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 8 * 1024 * 1024) {
        throw Exception('A foto deve ter no máximo 8 MB.');
      }
      await ref
          .read(apiClientProvider)
          .uploadInternalGroupBotAvatar(
            _details.group.id,
            bytes: bytes,
            fileName: file.name,
            mimeType: file.mimeType ?? _mimeForName(file.name),
          );
      await _reload();
      ref.invalidate(dashboardSnapshotProvider);
      if (mounted) showSuccessToast(context, 'Foto do robô atualizada.');
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeBotAvatar() async {
    if (_details.group.botAvatarUrl == null || _busy) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .removeInternalGroupBotAvatar(_details.group.id);
      await _reload();
      ref.invalidate(dashboardSnapshotProvider);
      if (mounted) showSuccessToast(context, 'Foto do robô removida.');
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _newInvite() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Redefinir link do grupo?'),
        content: const Text(
          'O link atual deixará de funcionar imediatamente e um novo será criado.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Redefinir link'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      final url = await ref
          .read(apiClientProvider)
          .rotateInternalGroupInvite(_details.group.id);
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) {
        showSuccessToast(
          context,
          'Link privado copiado. O convite anterior foi revogado.',
        );
      }
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  Future<void> _deleteGroupPermanently() async {
    if (!_details.group.isOwner || _busy) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Apagar grupo definitivamente?'),
        content: const Text(
          'O grupo, todas as mensagens, membros, convites e configurações serão apagados para todos. Esta ação não pode ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Apagar grupo'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .runInternalGroupAction(_details.group.id, 'delete');
      ref.invalidate(dashboardSnapshotProvider);
      ref.read(selectedInternalGroupIdProvider.notifier).select(null);
      widget.onDeleted?.call();
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _copyCurrentInvite() async {
    final url = _details?.group.inviteUrl;
    if (url == null || url.trim().isEmpty) {
      if (mounted)
        showErrorToast(
          context,
          'O link está sendo preparado. Tente novamente.',
        );
      return;
    }
    await _copyInvite(url);
  }

  Future<void> _copyInvite(String url) async {
    final absolute = AppConfig.publicInviteUrl(url);
    await Clipboard.setData(ClipboardData(text: absolute));
    if (mounted) showSuccessToast(context, 'Link copiado.');
  }

  Future<void> _customizeInvite() async {
    final current = _details.group.inviteUrl?.split('/').last ?? '';
    final controller = TextEditingController(
      text: current.length <= 80 ? current : '',
    );
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Personalizar link do grupo'),
          content: TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(
              prefixText: 'botadmin.shop/g/',
              hintText: 'grupotal',
              helperText: 'Use letras, números, hífen ou underline.',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Aplicar'),
            ),
          ],
        ),
      );
      if (confirmed != true || controller.text.trim().isEmpty || !mounted)
        return;
      await ref
          .read(apiClientProvider)
          .updateInternalGroup(
            _details.group.id,
            inviteSlug: controller.text.trim(),
          );
      await _reload();
      ref.invalidate(dashboardSnapshotProvider);
      if (mounted) showSuccessToast(context, 'Link personalizado salvo.');
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      controller.dispose();
    }
  }

  Future<void> _memberAction(InternalGroupMember member, String action) async {
    try {
      await ref
          .read(apiClientProvider)
          .updateInternalGroupMember(_details.group.id, member.userId, action);
      await _reload();
      ref.invalidate(dashboardSnapshotProvider);
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final group = _details.group;
    final size = MediaQuery.sizeOf(context);
    return SafeArea(
      top: false,
      child: SizedBox(
        width: math.min(620, size.width),
        height: size.height * .88,
        child: Column(
          children: [
            ListTile(
              contentPadding: const EdgeInsets.fromLTRB(18, 2, 8, 4),
              leading: InkWell(
                onTap: group.canManage && !_busy ? _pickAvatar : null,
                borderRadius: BorderRadius.circular(30),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    _GroupAvatar(group: group, radius: 26),
                    if (group.canManage)
                      const Positioned(
                        right: -3,
                        bottom: -3,
                        child: CircleAvatar(
                          radius: 10,
                          child: Icon(Icons.photo_camera_rounded, size: 12),
                        ),
                      ),
                  ],
                ),
              ),
              title: const Text(
                'Dados do grupo BotAdmin',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Text('${_details.members.length} membros'),
              trailing: IconButton(
                tooltip: 'Fechar',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded),
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
                children: [
                  TextField(
                    controller: _name,
                    enabled: group.canManage && !_busy,
                    maxLength: 120,
                    decoration: const InputDecoration(
                      labelText: 'Nome do grupo',
                      prefixIcon: Icon(Icons.groups_rounded),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _description,
                    enabled: group.canManage && !_busy,
                    maxLength: 500,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Descrição',
                      prefixIcon: Icon(Icons.info_outline_rounded),
                    ),
                  ),
                  if (group.canManage)
                    ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      leading: _InternalBotAvatar(group: group, radius: 22),
                      title: const Text('Identidade do robô interno'),
                      subtitle: const Text('Toque para editar nome e foto'),
                      children: [
                        Text(
                          'O robô é um participante próprio do grupo BotAdmin e não usa uma conta do WhatsApp.',
                          style: TextStyle(
                            color: WaTheme.of(context).textMuted,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            _InternalBotAvatar(group: group, radius: 31),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: _busy ? null : _pickBotAvatar,
                                    icon: const Icon(Icons.add_a_photo_rounded),
                                    label: Text(
                                      group.botAvatarUrl == null
                                          ? 'Adicionar foto do robô'
                                          : 'Trocar foto do robô',
                                    ),
                                  ),
                                  if (group.botAvatarUrl != null)
                                    TextButton.icon(
                                      onPressed: _busy
                                          ? null
                                          : _removeBotAvatar,
                                      icon: const Icon(
                                        Icons.delete_outline_rounded,
                                      ),
                                      label: const Text('Remover foto'),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _botName,
                          enabled: !_busy,
                          maxLength: 120,
                          decoration: const InputDecoration(
                            labelText: 'Nome do robô',
                            prefixIcon: Icon(Icons.smart_toy_rounded),
                            helperText:
                                'Nome exibido nas respostas, mídias e comandos.',
                          ),
                        ),
                      ],
                    ),
                  if (group.canManage) ...[
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        _groupOpen ? 'Grupo aberto' : 'Grupo fechado',
                      ),
                      subtitle: const Text(
                        'Quando fechado, somente admins podem enviar mensagens',
                      ),
                      value: _groupOpen,
                      onChanged: _busy
                          ? null
                          : (value) => _persistPermission('groupOpen', value),
                    ),
                    const SizedBox(height: 12),
                    ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      leading: const Icon(Icons.tune_rounded),
                      title: const Text('Permissões do grupo'),
                      subtitle: const Text('Mesmo modelo do WhatsApp'),
                      children: [
                        SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Enviar novas mensagens'),
                          value: _membersCanSend,
                          onChanged: _busy
                              ? null
                              : (value) =>
                                    _persistPermission('membersCanSend', value),
                        ),
                        SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Adicionar novos membros'),
                          value: _membersCanAdd,
                          onChanged: _busy
                              ? null
                              : (value) =>
                                    _persistPermission('membersCanAdd', value),
                        ),
                        SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Aprovar novos membros'),
                          value: _approvalRequired,
                          onChanged: _busy
                              ? null
                              : (value) => _persistPermission(
                                  'approvalRequired',
                                  value,
                                ),
                        ),
                        SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          title: const Text(
                            'Editar configurações e administradores',
                          ),
                          value: _adminsCanEdit,
                          onChanged: _busy
                              ? null
                              : (value) =>
                                    _persistPermission('adminsCanEdit', value),
                        ),
                        SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          title: const Text(
                            'Permitir conversa privada entre membros',
                          ),
                          subtitle: const Text(
                            'Desative para que somente administradores iniciem PVs',
                          ),
                          value: _membersCanStartPv,
                          onChanged: _busy
                              ? null
                              : (value) => _persistPermission(
                                  'membersCanStartPv',
                                  value,
                                ),
                        ),
                      ],
                    ),
                  ],
                  if (group.canManage) ...[
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      onPressed: _busy ? null : _save,
                      icon: _busy
                          ? const SizedBox.square(
                              dimension: 17,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save_rounded),
                      label: const Text('Salvar nome, descrição e robô'),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
                      decoration: BoxDecoration(
                        color: WaTheme.of(context).panel,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: WaTheme.of(context).divider),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.link_rounded, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              group.inviteUrl ?? 'Link privado indisponível',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          IconButton(
                            tooltip: 'Copiar link',
                            onPressed: group.inviteUrl == null
                                ? null
                                : () => _copyInvite(group.inviteUrl!),
                            icon: const Icon(Icons.copy_rounded),
                          ),
                          PopupMenuButton<String>(
                            tooltip: 'Opções do convite',
                            onSelected: (value) {
                              if (value == 'reset') unawaited(_newInvite());
                              if (value == 'customize')
                                unawaited(_customizeInvite());
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(
                                value: 'customize',
                                child: Text('Personalizar link'),
                              ),
                              PopupMenuItem(
                                value: 'reset',
                                child: Text('Redefinir link'),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  Text(
                    'Membros (${_details.members.length})',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ..._details.members.map(
                    (member) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: _InternalMemberAvatar(member: member),
                      title: Text(member.name),
                      subtitle: Text(
                        member.isBot
                            ? 'Robô interno · comandos e automações'
                            : member.role == 'owner'
                            ? 'Proprietário'
                            : member.role == 'admin'
                            ? 'Administrador'
                            : 'Membro',
                      ),
                      trailing:
                          !group.canManage ||
                              member.isMe ||
                              member.isBot ||
                              member.role == 'owner'
                          ? null
                          : PopupMenuButton<String>(
                              onSelected: (action) =>
                                  _memberAction(member, action),
                              itemBuilder: (_) => [
                                if (group.isOwner)
                                  PopupMenuItem(
                                    value: member.role == 'admin'
                                        ? 'demote'
                                        : 'promote',
                                    child: Text(
                                      member.role == 'admin'
                                          ? 'Remover admin'
                                          : 'Tornar admin',
                                    ),
                                  ),
                                const PopupMenuItem(
                                  value: 'remove',
                                  child: Text('Remover do grupo'),
                                ),
                                const PopupMenuItem(
                                  value: 'ban',
                                  child: Text('Bloquear convite'),
                                ),
                              ],
                            ),
                    ),
                  ),
                  if (group.isOwner) ...[
                    const SizedBox(height: 22),
                    const Divider(),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(
                        Icons.delete_forever_rounded,
                        color: Color(0xFFB42318),
                      ),
                      title: const Text(
                        'Apagar grupo definitivamente',
                        style: TextStyle(
                          color: Color(0xFFB42318),
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: const Text(
                        'Remove o grupo e todo o histórico para todos',
                      ),
                      onTap: _busy ? null : _deleteGroupPermanently,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class InternalGroupsPanel extends ConsumerStatefulWidget {
  const InternalGroupsPanel({super.key});

  @override
  ConsumerState<InternalGroupsPanel> createState() =>
      _InternalGroupsPanelState();
}

class _InternalGroupsPanelState extends ConsumerState<InternalGroupsPanel> {
  List<InternalGroup> _groups = const [];
  bool _loading = true;
  String? _error;
  WhatsappRealtimeClient? _socket;
  Timer? _realtimeRefreshDebounce;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _socket = WhatsappRealtimeClient(
      sessionStore: ref.read(sessionStoreProvider),
      onEvent: (event) {
        if (!mounted ||
            event.eventType?.startsWith('internal-group.') != true) {
          return;
        }
        _realtimeRefreshDebounce?.cancel();
        _realtimeRefreshDebounce = Timer(const Duration(milliseconds: 180), () {
          if (mounted) unawaited(_load(silent: true));
        });
      },
      onReconnectNeeded: () {
        if (mounted) unawaited(_load(silent: true));
      },
    )..start();
    final inviteError = Uri.base.queryParameters['inviteError'];
    if (inviteError != null && inviteError.trim().isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) showErrorToast(context, inviteError);
      });
    }
  }

  @override
  void dispose() {
    _realtimeRefreshDebounce?.cancel();
    unawaited(_socket?.dispose());
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _loading = true);
    try {
      final groups = await ref.read(apiClientProvider).loadInternalGroups();
      if (!mounted) return;
      setState(() {
        _groups = groups;
        _loading = false;
        _error = null;
      });
      final selected = ref.read(selectedInternalGroupIdProvider);
      if (selected != null && !groups.any((group) => group.id == selected)) {
        ref.read(selectedInternalGroupIdProvider.notifier).select(null);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (!silent) _error = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final selectedId = ref.watch(selectedInternalGroupIdProvider);
    final selected = _groups
        .where((group) => group.id == selectedId)
        .firstOrNull;
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 780;
        if (compact && selected != null) {
          return _InternalGroupChat(
            key: ValueKey(selected.id),
            group: selected,
            leading: IconButton(
              tooltip: 'Voltar aos grupos',
              onPressed: () => ref
                  .read(selectedInternalGroupIdProvider.notifier)
                  .select(null),
              icon: const Icon(Icons.arrow_back_rounded),
            ),
            onChanged: () => unawaited(_load(silent: true)),
          );
        }

        final list = _buildGroupList(context);
        if (compact) return list;
        return Row(
          children: [
            SizedBox(width: 360, child: list),
            VerticalDivider(width: 1, color: WaTheme.of(context).divider),
            Expanded(
              child: selected == null
                  ? const _InternalGroupsEmptyConversation()
                  : _InternalGroupChat(
                      key: ValueKey(selected.id),
                      group: selected,
                      onChanged: () => unawaited(_load(silent: true)),
                    ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildGroupList(BuildContext context) {
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.panel,
      child: Column(
        children: [
          Container(
            height: 64,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: wa.headerBg,
              border: Border(bottom: BorderSide(color: wa.divider)),
            ),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: wa.accent.withValues(alpha: .14),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.forum_rounded, color: wa.accent),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Grupos BotAdmin',
                        style: TextStyle(fontWeight: FontWeight.w800),
                      ),
                      Text(
                        'Conversas privadas, sem WhatsApp',
                        style: TextStyle(fontSize: 11.5),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Entrar com convite',
                  onPressed: _joinGroup,
                  icon: const Icon(Icons.link_rounded),
                ),
                IconButton.filled(
                  tooltip: 'Criar grupo',
                  onPressed: _createGroup,
                  icon: const Icon(Icons.add_rounded),
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _loading && _groups.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null && _groups.isEmpty
                  ? ListView(
                      children: [
                        const SizedBox(height: 100),
                        Icon(
                          Icons.cloud_off_rounded,
                          size: 46,
                          color: wa.textMuted,
                        ),
                        const SizedBox(height: 12),
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 10),
                        Center(
                          child: FilledButton.tonalIcon(
                            onPressed: _load,
                            icon: const Icon(Icons.refresh_rounded),
                            label: const Text('Tentar novamente'),
                          ),
                        ),
                      ],
                    )
                  : _groups.isEmpty
                  ? ListView(
                      padding: const EdgeInsets.all(28),
                      children: [
                        const SizedBox(height: 60),
                        Icon(
                          Icons.groups_3_outlined,
                          size: 74,
                          color: wa.textMuted,
                        ),
                        const SizedBox(height: 18),
                        const Text(
                          'Seu espaço privado começa aqui',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Crie um grupo com sua assinatura ou entre gratuitamente usando um convite.',
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 20),
                        FilledButton.icon(
                          onPressed: _createGroup,
                          icon: const Icon(Icons.add_rounded),
                          label: const Text('Criar grupo privado'),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: _joinGroup,
                          icon: const Icon(Icons.link_rounded),
                          label: const Text('Usar convite'),
                        ),
                      ],
                    )
                  : ListView.separated(
                      itemCount: _groups.length,
                      separatorBuilder: (_, _) =>
                          Divider(height: 1, indent: 72, color: wa.divider),
                      itemBuilder: (context, index) {
                        final group = _groups[index];
                        return _InternalGroupTile(
                          group: group,
                          selected:
                              ref.watch(selectedInternalGroupIdProvider) ==
                              group.id,
                          onTap: () => ref
                              .read(selectedInternalGroupIdProvider.notifier)
                              .select(group.id),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _createGroup() async {
    final name = TextEditingController();
    final description = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Criar grupo BotAdmin'),
        content: SizedBox(
          width: 430,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Somente sua conta precisa ter assinatura. Convidados poderão conversar gratuitamente.',
              ),
              const SizedBox(height: 16),
              TextField(
                controller: name,
                autofocus: true,
                maxLength: 120,
                decoration: const InputDecoration(labelText: 'Nome do grupo'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: description,
                maxLength: 500,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Descrição opcional',
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Criar'),
          ),
        ],
      ),
    );
    if (result != true || !mounted) return;
    try {
      final created = await ref
          .read(apiClientProvider)
          .createInternalGroup(name: name.text, description: description.text);
      await _load(silent: true);
      ref
          .read(selectedInternalGroupIdProvider.notifier)
          .select(created.group.id);
      if (!mounted || created.inviteUrl == null) return;
      await _showInvite(created.inviteUrl!);
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      name.dispose();
      description.dispose();
    }
  }

  Future<void> _joinGroup() async {
    final controller = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Entrar em grupo privado'),
        content: SizedBox(
          width: 430,
          child: TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Link ou código do convite',
              hintText: 'https://botadmin.shop/g/...',
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Entrar'),
          ),
        ],
      ),
    );
    if (accepted != true || !mounted) return;
    try {
      final group = await ref
          .read(apiClientProvider)
          .joinInternalGroup(controller.text);
      await _load(silent: true);
      ref.read(selectedInternalGroupIdProvider.notifier).select(group.id);
      if (mounted) showSuccessToast(context, 'Você entrou em ${group.name}.');
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      controller.dispose();
    }
  }

  Future<void> _showInvite(String url) => showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      icon: const Icon(Icons.link_rounded),
      title: const Text('Convite privado criado'),
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Qualquer pessoa com este link poderá entrar após fazer login ou criar uma conta gratuita.',
            ),
            const SizedBox(height: 14),
            SelectableText(url),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Fechar'),
        ),
        FilledButton.icon(
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: url));
            if (context.mounted) Navigator.pop(context);
            if (mounted) showSuccessToast(this.context, 'Link copiado.');
          },
          icon: const Icon(Icons.copy_rounded),
          label: const Text('Copiar link'),
        ),
      ],
    ),
  );
}

class _InternalGroupTile extends StatelessWidget {
  const _InternalGroupTile({
    required this.group,
    required this.selected,
    required this.onTap,
  });
  final InternalGroup group;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final preview = group.lastMessage?.deleted == true
        ? 'Mensagem apagada'
        : group.lastMessage?.text ??
              (group.lastMessage?.type == 'image'
                  ? '📷 Foto'
                  : group.lastMessage?.type == 'video'
                  ? '🎬 Vídeo'
                  : group.lastMessage?.type == 'audio'
                  ? '🎤 Áudio'
                  : group.lastMessage == null
                  ? '${group.memberCount} membro(s)'
                  : '📎 Arquivo');
    return Material(
      color: selected ? wa.selectedRow : Colors.transparent,
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        leading: _GroupAvatar(group: group),
        title: Row(
          children: [
            Expanded(
              child: Text(
                group.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            if (group.lastMessage?.createdAt != null)
              Text(
                DateFormat(
                  'HH:mm',
                ).format(group.lastMessage!.createdAt!.toLocal()),
                style: TextStyle(fontSize: 11, color: wa.textMuted),
              ),
          ],
        ),
        subtitle: Row(
          children: [
            Icon(Icons.shield_outlined, size: 13, color: wa.accent),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                preview,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (group.unreadCount > 0)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: wa.accent,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  group.unreadCount > 99 ? '99+' : '${group.unreadCount}',
                  style: const TextStyle(color: Colors.white, fontSize: 11),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _GroupAvatar extends StatelessWidget {
  const _GroupAvatar({required this.group, this.radius = 24});
  final InternalGroup group;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final url = group.avatarUrl;
    return SizedBox.square(
      dimension: radius * 2,
      child: ClipOval(
        child: url == null
            ? ColoredBox(
                color: WaTheme.of(context).accent.withValues(alpha: .15),
                child: Icon(
                  Icons.groups_3_rounded,
                  color: WaTheme.of(context).accent,
                ),
              )
            : BotAdminCachedImage(
                imageUrl: url,
                width: radius * 2,
                height: radius * 2,
                fit: BoxFit.cover,
                errorWidget: (_, __, ___) => ColoredBox(
                  color: WaTheme.of(context).accent.withValues(alpha: .15),
                  child: Icon(
                    Icons.groups_3_rounded,
                    color: WaTheme.of(context).accent,
                  ),
                ),
              ),
      ),
    );
  }
}

class _InternalBotAvatar extends StatelessWidget {
  const _InternalBotAvatar({required this.group, this.radius = 24});

  final InternalGroup group;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final fallback = ColoredBox(
      color: WaTheme.of(context).accent.withValues(alpha: .16),
      child: Icon(Icons.smart_toy_rounded, color: WaTheme.of(context).accent),
    );
    return SizedBox.square(
      dimension: radius * 2,
      child: ClipOval(
        child: group.botAvatarUrl == null
            ? fallback
            : BotAdminCachedImage(
                imageUrl: group.botAvatarUrl!,
                width: radius * 2,
                height: radius * 2,
                fit: BoxFit.cover,
                errorWidget: (_, __, ___) => fallback,
              ),
      ),
    );
  }
}

class _InternalGroupWallpaper extends StatelessWidget {
  const _InternalGroupWallpaper({this.imageUrl, this.imageBytes});

  final String? imageUrl;
  final Uint8List? imageBytes;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final source = imageUrl?.trim() ?? '';
    return Stack(
      fit: StackFit.expand,
      children: [
        ColoredBox(color: wa.chatWallpaper),
        if (imageBytes != null)
          Image.memory(
            imageBytes!,
            key: ValueKey<int>(identityHashCode(imageBytes)),
            fit: BoxFit.cover,
            filterQuality: FilterQuality.medium,
            gaplessPlayback: true,
          )
        else if (source.isNotEmpty)
          BotAdminCachedImage(
            key: ValueKey<String>('internal-group-wallpaper:$source'),
            imageUrl: source,
            fit: BoxFit.cover,
            useOldImageOnUrlChange: false,
            maxWidthDiskCache: 2560,
            maxHeightDiskCache: 2560,
            errorWidget: (_, __, ___) => const SizedBox.shrink(),
          ),
        if (imageBytes != null || source.isNotEmpty)
          ColoredBox(color: Colors.black.withValues(alpha: .05)),
      ],
    );
  }
}

class _InternalGroupsEmptyConversation extends StatelessWidget {
  const _InternalGroupsEmptyConversation();

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 420),
      child: const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.lock_person_outlined, size: 86),
          SizedBox(height: 20),
          Text(
            'Conversas privadas do BotAdmin',
            style: TextStyle(fontSize: 23, fontWeight: FontWeight.w800),
            textAlign: TextAlign.center,
          ),
          SizedBox(height: 10),
          Text(
            'Selecione um grupo. As mensagens ficam no BotAdmin e não geram eventos no WhatsApp.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    ),
  );
}

class _InternalAdminsOnlyBanner extends StatelessWidget {
  const _InternalAdminsOnlyBanner();

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return SafeArea(
      top: false,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
        color: wa.panel,
        child: Center(
          child: RichText(
            text: TextSpan(
              style: TextStyle(color: wa.textMuted, fontSize: 14),
              children: [
                const TextSpan(text: 'Somente '),
                TextSpan(
                  text: 'admins',
                  style: TextStyle(
                    color: wa.accent,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const TextSpan(text: ' podem enviar mensagens'),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InternalGroupChat extends ConsumerStatefulWidget {
  const _InternalGroupChat({
    super.key,
    required this.group,
    required this.onChanged,
    this.leading,
  });
  final InternalGroup group;
  final VoidCallback onChanged;
  final Widget? leading;

  @override
  ConsumerState<_InternalGroupChat> createState() => _InternalGroupChatState();
}

class _InternalGroupChatState extends ConsumerState<_InternalGroupChat> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  final _plusKey = GlobalKey();
  List<InternalGroupMessage> _messages = const [];
  InternalGroupDetails? _details;
  InternalGroupMessage? _reply;
  WhatsappRealtimeClient? _socket;
  bool _loading = true;
  bool _sending = false;
  bool _polling = false;
  bool _wallpaperBusy = false;
  Uint8List? _localWallpaperBytes;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_initialLoad());
    _socket = WhatsappRealtimeClient(
      sessionStore: ref.read(sessionStoreProvider),
      onEvent: (event) {
        if (!mounted || event.chatJid != 'internal-group:${widget.group.id}') {
          return;
        }
        final type = event.eventType ?? '';
        if (type == 'internal-group.messages.cleared') {
          if (mounted) setState(() => _messages = const []);
          return;
        }
        if (type == 'internal-group.group.deleted') {
          if (mounted) {
            ref.read(selectedInternalGroupIdProvider.notifier).select(null);
            widget.onChanged();
          }
          return;
        }
        unawaited(
          _poll(
            refreshDetails:
                type == 'internal-group.group.updated' ||
                type == 'internal-group.member.updated',
          ),
        );
      },
      onReconnectNeeded: () {
        if (mounted) unawaited(_poll(refreshDetails: true));
      },
    )..start();
  }

  @override
  void dispose() {
    unawaited(_socket?.dispose());
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _initialLoad() async {
    try {
      final results = await Future.wait<Object>([
        ref.read(apiClientProvider).loadInternalGroup(widget.group.id),
        ref.read(apiClientProvider).loadInternalGroupMessages(widget.group.id),
      ]);
      final page = results[1] as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _details = results[0] as InternalGroupDetails;
        _messages = (page['messages'] as List).cast<InternalGroupMessage>();
        _loading = false;
        _error = null;
      });
      _markReadAndScroll();
    } catch (error) {
      if (mounted)
        setState(() {
          _loading = false;
          _error = error.toString();
        });
    }
  }

  Future<void> _poll({bool refreshDetails = false}) async {
    if (_polling || !mounted) return;
    _polling = true;
    try {
      final latest = _messages.isEmpty ? 0 : _messages.last.id;
      final api = ref.read(apiClientProvider);
      final results = await Future.wait<Object?>([
        api.loadInternalGroupMessages(widget.group.id, after: latest),
        if (refreshDetails) api.loadInternalGroup(widget.group.id),
      ]);
      final page = results[0] as Map<String, dynamic>;
      final incoming = (page['messages'] as List).cast<InternalGroupMessage>();
      if (!mounted) return;
      setState(() {
        if (incoming.isNotEmpty) {
          final byId = {for (final message in _messages) message.id: message};
          for (final message in incoming) byId[message.id] = message;
          _messages = byId.values.toList()
            ..sort((a, b) => a.id.compareTo(b.id));
        }
        if (refreshDetails && results.length > 1) {
          _details = results[1] as InternalGroupDetails;
        }
      });
      if (incoming.isNotEmpty) _markReadAndScroll();
      widget.onChanged();
    } catch (_) {
      // O histórico continua utilizável durante oscilações breves.
    } finally {
      _polling = false;
    }
  }

  void _markReadAndScroll() {
    if (_messages.isNotEmpty) {
      unawaited(
        ref
            .read(apiClientProvider)
            .markInternalGroupRead(widget.group.id, _messages.last.id),
      );
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final group = _details?.group ?? widget.group;
    final wa = WaTheme.of(context);
    return ColoredBox(
      color: wa.chatBg,
      child: Column(
        children: [
          Container(
            height: 64,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            color: wa.headerBg,
            child: Row(
              children: [
                ?widget.leading,
                _GroupAvatar(group: group, radius: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: InkWell(
                    onTap: () => unawaited(
                      showInternalGroupManagement(
                        context,
                        ref,
                        widget.group.toConversationThread(),
                        onDeleted: () {
                          ref
                              .read(selectedInternalGroupIdProvider.notifier)
                              .select(null);
                          widget.onChanged();
                        },
                      ),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          group.name,
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        Text(
                          '${_details?.members.length ?? group.memberCount} membros · grupo BotAdmin',
                          style: TextStyle(fontSize: 11.5, color: wa.textMuted),
                        ),
                      ],
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Membros',
                  onPressed: _showMembers,
                  icon: const Icon(Icons.group_outlined),
                ),
                PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'link-options') unawaited(_showLinkActions());
                    if (value == 'wallpaper') unawaited(_changeWallpaper());
                    if (value == 'custom-link')
                      unawaited(_customizeCurrentInvite());
                    if (value == 'invite') unawaited(_newInvite());
                    if (value == 'permissions') {
                      unawaited(
                        showInternalGroupManagement(
                          context,
                          ref,
                          widget.group.toConversationThread(),
                          onDeleted: () {
                            ref
                                .read(selectedInternalGroupIdProvider.notifier)
                                .select(null);
                            widget.onChanged();
                          },
                        ),
                      );
                    }
                    if (value == 'leave') unawaited(_leaveGroup());
                    if (value == 'clear') unawaited(_clearGroupMessages());
                    if (value == 'info') unawaited(_showMembers());
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(
                      value: 'info',
                      child: Text('Dados e membros'),
                    ),
                    if (group.canManage)
                      const PopupMenuItem(
                        value: 'permissions',
                        child: Text('Permissões do grupo'),
                      ),
                    if (group.canManage)
                      const PopupMenuItem(
                        value: 'link-options',
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(Icons.link_rounded),
                          title: Text('Link do grupo'),
                          trailing: Icon(Icons.arrow_drop_down_rounded),
                        ),
                      ),
                    if (group.canManage)
                      const PopupMenuItem(
                        value: 'wallpaper',
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(Icons.wallpaper_rounded),
                          title: Text('Plano de fundo'),
                        ),
                      ),
                    if (group.canManage)
                      const PopupMenuItem(
                        value: 'clear',
                        child: Text('Limpar mensagens para todos'),
                      ),
                    if (!group.isOwner)
                      const PopupMenuItem(
                        value: 'leave',
                        child: Text('Sair do grupo'),
                      ),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: _InternalGroupWallpaper(
                    imageUrl: group.wallpaperUrl,
                    imageBytes: _localWallpaperBytes,
                  ),
                ),
                Positioned.fill(
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : _error != null
                      ? Center(
                          child: FilledButton.tonalIcon(
                            onPressed: _initialLoad,
                            icon: const Icon(Icons.refresh_rounded),
                            label: Text(_error!),
                          ),
                        )
                      : _messages.isEmpty
                      ? const Center(
                          child: Text(
                            'Nenhuma mensagem ainda. Comece a conversa.',
                          ),
                        )
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 16,
                          ),
                          itemCount: _messages.length,
                          itemBuilder: (context, index) =>
                              _InternalMessageBubble(
                                message: _messages[index],
                                canModerate: group.canManage,
                                onReply: () =>
                                    setState(() => _reply = _messages[index]),
                                onDelete: () =>
                                    _deleteMessage(_messages[index]),
                                onPin: () => _pinMessage(_messages[index]),
                                onButton: (button) =>
                                    _runMessageButton(_messages[index], button),
                              ),
                        ),
                ),
              ],
            ),
          ),
          if (_reply != null)
            Container(
              padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
              color: wa.panel,
              child: Row(
                children: [
                  Container(width: 3, height: 38, color: wa.accent),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _reply!.senderName,
                          style: TextStyle(
                            color: wa.accent,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          _reply!.text ?? 'Mídia',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => setState(() => _reply = null),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
          if (group.adminsOnly && !group.canManage)
            const _InternalAdminsOnlyBanner()
          else
            SafeArea(
              top: false,
              child: Container(
                padding: const EdgeInsets.fromLTRB(8, 7, 8, 8),
                color: wa.panel,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    IconButton(
                      key: _plusKey,
                      tooltip: 'Anexar',
                      onPressed: _sending ? null : _openAttachmentCanvas,
                      icon: const Icon(Icons.add_rounded, size: 29),
                    ),
                    IconButton(
                      tooltip: 'Emojis, GIFs e figurinhas',
                      onPressed: _sending
                          ? null
                          : () =>
                                setState(() => _text.text = '${_text.text}🙂'),
                      icon: const Icon(Icons.emoji_emotions_outlined, size: 24),
                    ),
                    Expanded(
                      child: TextField(
                        controller: _text,
                        minLines: 1,
                        maxLines: 5,
                        textInputAction: TextInputAction.newline,
                        decoration: const InputDecoration(
                          hintText: 'Mensagem para o grupo',
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 11,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 7),
                    IconButton.filled(
                      tooltip: 'Enviar',
                      onPressed: _sending ? null : _sendText,
                      icon: _sending
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send_rounded),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _sendText() async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      final message = await ref
          .read(apiClientProvider)
          .sendInternalGroupText(
            widget.group.id,
            text,
            replyToMessageId: _reply?.id,
          );
      if (!mounted) return;
      setState(() {
        _messages = [..._messages, message];
        _text.clear();
        _reply = null;
      });
      _markReadAndScroll();
      widget.onChanged();
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickMedia({bool asSticker = false}) async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Mídias e documentos',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'webm',
            'mp3',
            'm4a',
            'ogg',
            'opus',
            'pdf',
            'txt',
            'zip',
          ],
        ),
      ],
    );
    if (file == null || !mounted) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 25 * 1024 * 1024) {
      if (mounted) showErrorToast(context, 'A mídia deve ter no máximo 25 MB.');
      return;
    }
    setState(() => _sending = true);
    try {
      final message = await ref
          .read(apiClientProvider)
          .sendInternalGroupMedia(
            widget.group.id,
            bytes: bytes,
            fileName: file.name,
            mimeType: file.mimeType ?? _mimeForName(file.name),
            text: _text.text,
            replyToMessageId: _reply?.id,
            asSticker: asSticker,
          );
      if (!mounted) return;
      setState(() {
        _messages = [..._messages, message];
        _text.clear();
        _reply = null;
      });
      _markReadAndScroll();
      widget.onChanged();
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _openAttachmentCanvas() async {
    final box = _plusKey.currentContext?.findRenderObject() as RenderBox?;
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox?;
    if (box == null || overlay == null) return;
    final origin = box.localToGlobal(Offset.zero, ancestor: overlay);
    // O menu usa a própria âncora do “+”. Assim o Flutter escolhe abrir acima
    // do compositor quando há espaço (como no WhatsApp), sem saltar para o
    // topo da tela em aparelhos menores.
    final position = RelativeRect.fromLTRB(
      math.max(8, origin.dx - 4),
      math.max(8, origin.dy - 4),
      math.max(8, overlay.size.width - origin.dx - box.size.width + 4),
      math.max(8, overlay.size.height - origin.dy - box.size.height + 4),
    );
    final action = await showMenu<String>(
      context: context,
      position: position,
      elevation: 8,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      constraints: BoxConstraints(
        maxHeight: math.min(560, overlay.size.height * .72),
        minWidth: 220,
      ),
      items: [
        _attachmentItem(
          'document',
          Icons.description_rounded,
          'Documento',
          const Color(0xFF7E57C2),
        ),
        _attachmentItem(
          'media',
          Icons.photo_library_rounded,
          'Fotos e vídeos',
          const Color(0xFF168AFF),
        ),
        _attachmentItem(
          'contact',
          Icons.person_rounded,
          'Contato',
          const Color(0xFF039BE5),
        ),
        _attachmentItem(
          'poll',
          Icons.poll_rounded,
          'Enquete',
          const Color(0xFFFFB300),
        ),
        _attachmentItem(
          'event',
          Icons.calendar_month_rounded,
          'Evento',
          const Color(0xFFFF3366),
        ),
        _attachmentItem(
          'sticker',
          Icons.add_reaction_rounded,
          'Nova figurinha',
          const Color(0xFF00BFA5),
        ),
        const PopupMenuDivider(),
        _attachmentItem(
          'pix',
          Icons.diamond_rounded,
          'Pix',
          const Color(0xFF16A765),
        ),
      ],
    );
    if (!mounted || action == null) return;
    if (action == 'document' || action == 'media') {
      await _pickMedia();
    } else if (action == 'sticker') {
      await _pickMedia(asSticker: true);
    } else if (action == 'contact') {
      await _sendSpecialMessage(
        type: 'contact',
        title: 'Enviar contato',
        hint: 'Nome do contato e telefone',
        prefix: '👤 Contato\n',
      );
    } else if (action == 'poll') {
      await _sendSpecialMessage(
        type: 'poll',
        title: 'Criar enquete',
        hint: 'Pergunta e opções (uma por linha)',
        prefix: '📊 Enquete\n',
      );
    } else if (action == 'event') {
      await _sendSpecialMessage(
        type: 'event',
        title: 'Criar evento',
        hint: 'Título, data, horário e detalhes',
        prefix: '📅 Evento\n',
      );
    } else if (action == 'pix') {
      await _sendSpecialMessage(
        type: 'pix',
        title: 'Enviar Pix',
        hint: 'Chave Pix, valor e descrição',
        prefix: '💠 Pix\n',
      );
    } else {
      showSuccessToast(
        context,
        '$action ficará disponível nos grupos BotAdmin em breve.',
      );
    }
  }

  Future<void> _sendSpecialMessage({
    required String type,
    required String title,
    required String hint,
    required String prefix,
  }) async {
    final controller = TextEditingController();
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(title),
          content: TextField(
            controller: controller,
            autofocus: true,
            minLines: 3,
            maxLines: 7,
            decoration: InputDecoration(hintText: hint),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Enviar'),
            ),
          ],
        ),
      );
      final value = controller.text.trim();
      if (confirmed != true || value.isEmpty || !mounted) return;
      setState(() => _sending = true);
      final sent = await ref
          .read(apiClientProvider)
          .sendInternalGroupText(
            widget.group.id,
            '$prefix$value',
            replyToMessageId: _reply?.id,
            messageType: type,
          );
      if (!mounted) return;
      setState(() {
        _messages = [..._messages, sent];
        _reply = null;
      });
      _markReadAndScroll();
      widget.onChanged();
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      controller.dispose();
      if (mounted) setState(() => _sending = false);
    }
  }

  PopupMenuItem<String> _attachmentItem(
    String value,
    IconData icon,
    String label,
    Color color,
  ) => PopupMenuItem(
    value: value,
    height: 48,
    child: Row(
      children: [
        Icon(icon, color: color, size: 22),
        const SizedBox(width: 14),
        Text(label),
      ],
    ),
  );

  Future<void> _deleteMessage(InternalGroupMessage message) async {
    try {
      await ref
          .read(apiClientProvider)
          .deleteInternalGroupMessage(widget.group.id, message.id);
      if (!mounted) return;
      await _initialLoad();
      widget.onChanged();
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  Future<void> _pinMessage(InternalGroupMessage message) async {
    if (!(_details?.group.canManage ?? false)) return;
    try {
      await ref
          .read(apiClientProvider)
          .pinInternalGroupMessage(
            widget.group.id,
            message.id,
            !message.pinned,
          );
      await _initialLoad();
      widget.onChanged();
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  Future<void> _runMessageButton(
    InternalGroupMessage message,
    InternalGroupButton button,
  ) async {
    try {
      final id = button.id.toLowerCase();
      final payload = button.payload;
      final type = (payload['type'] ?? payload['responseType'] ?? id)
          .toString()
          .toLowerCase();
      if (type.contains('url') ||
          type.contains('link') ||
          id.contains('url') ||
          id.contains('link')) {
        final url =
            payload['url']?.toString() ?? payload['displayText']?.toString();
        if (url != null &&
            await launchUrl(
              Uri.parse(url),
              mode: LaunchMode.externalApplication,
            ))
          return;
      }
      if (id.contains('copy')) {
        final value =
            payload['text']?.toString() ??
            payload['copyCode']?.toString() ??
            payload['url']?.toString();
        if (value != null && value.isNotEmpty) {
          await Clipboard.setData(ClipboardData(text: value));
          if (mounted) showSuccessToast(context, 'Conteúdo copiado.');
          return;
        }
      }
      if (type.contains('call') ||
          type.contains('phone') ||
          id.contains('call') ||
          id.contains('phone')) {
        final phone =
            payload['phone']?.toString() ?? payload['number']?.toString();
        if (phone != null) {
          await launchUrl(Uri.parse('tel:$phone'));
          return;
        }
      }
      final requestedFormat = (payload['format'] ?? button.id)
          .toString()
          .toLowerCase();
      if (requestedFormat == 'mp3' || requestedFormat == 'mp4') {
        await ref
            .read(apiClientProvider)
            .runInternalGroupMessageAction(
              widget.group.id,
              message.id,
              'play_format',
              data: {'format': requestedFormat, ...payload},
            );
        await _initialLoad();
        return;
      }
      // Reply buttons must be acknowledged by the internal-group endpoint,
      // just like a WhatsApp button response.  Previously every non-URL
      // button was sent as `play_format`, which made reply buttons silently
      // fail with “Escolha MP3 ou MP4”.
      await ref
          .read(apiClientProvider)
          .runInternalGroupMessageAction(
            widget.group.id,
            message.id,
            'interactive_reply',
            data: {
              'responseType': 'button',
              'selectedId': button.id,
              'selectedText': button.title,
              ...payload,
            },
          );
      await _initialLoad();
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  Future<void> _copyCurrentInvite() async {
    final url = _details?.group.inviteUrl;
    if (url == null || url.trim().isEmpty) {
      if (mounted)
        showErrorToast(
          context,
          'O link está sendo preparado. Tente novamente.',
        );
      return;
    }
    final absolute = AppConfig.publicInviteUrl(url);
    await Clipboard.setData(ClipboardData(text: absolute));
    if (mounted) showSuccessToast(context, 'Link do grupo copiado.');
  }

  Future<void> _showLinkActions() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(
              leading: Icon(Icons.link_rounded),
              title: Text(
                'Link do grupo',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.content_copy_rounded),
              title: const Text('Copiar link'),
              onTap: () => Navigator.pop(sheetContext, 'copy'),
            ),
            ListTile(
              leading: const Icon(Icons.link_rounded),
              title: const Text('Personalizar link'),
              onTap: () => Navigator.pop(sheetContext, 'customize'),
            ),
            ListTile(
              leading: const Icon(Icons.link_off_rounded),
              title: const Text('Revogar e gerar um novo link'),
              onTap: () => Navigator.pop(sheetContext, 'rotate'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (selected == 'copy') await _copyCurrentInvite();
    if (selected == 'customize') await _customizeCurrentInvite();
    if (selected == 'rotate') await _newInvite();
  }

  Future<void> _changeWallpaper() async {
    if (_wallpaperBusy) return;
    final currentUrl =
        _details?.group.wallpaperUrl ?? widget.group.wallpaperUrl;
    final selected = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(
              leading: Icon(Icons.wallpaper_rounded),
              title: Text(
                'Plano de fundo do grupo',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.add_photo_alternate_rounded),
              title: Text(
                currentUrl == null && _localWallpaperBytes == null
                    ? 'Escolher imagem'
                    : 'Trocar imagem',
              ),
              onTap: () => Navigator.pop(sheetContext, 'pick'),
            ),
            if (currentUrl != null || _localWallpaperBytes != null)
              ListTile(
                leading: const Icon(Icons.restore_rounded),
                title: const Text('Restaurar plano de fundo padrão'),
                onTap: () => Navigator.pop(sheetContext, 'remove'),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (!mounted || selected == null) return;
    if (selected == 'remove') {
      setState(() {
        _wallpaperBusy = true;
        _localWallpaperBytes = null;
      });
      try {
        await ref
            .read(apiClientProvider)
            .removeInternalGroupWallpaper(widget.group.id);
        await _poll(refreshDetails: true);
        if (mounted) showSuccessToast(context, 'Plano de fundo restaurado.');
      } catch (error) {
        if (mounted) showErrorToast(context, error.toString());
      } finally {
        if (mounted) setState(() => _wallpaperBusy = false);
      }
      return;
    }
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(label: 'Imagem', extensions: ['jpg', 'jpeg', 'png', 'webp']),
      ],
    );
    if (file == null || !mounted) return;
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    if (bytes.length > 15 * 1024 * 1024) {
      showErrorToast(context, 'O plano de fundo deve ter no máximo 15 MB.');
      return;
    }
    setState(() {
      _wallpaperBusy = true;
      // Renderiza no mesmo frame antes do upload.
      _localWallpaperBytes = bytes;
    });
    try {
      await ref
          .read(apiClientProvider)
          .uploadInternalGroupWallpaper(
            widget.group.id,
            bytes: bytes,
            fileName: file.name,
            mimeType: file.mimeType ?? _mimeForName(file.name),
          );
      await _poll(refreshDetails: true);
      if (mounted) {
        showSuccessToast(
          context,
          'Plano de fundo atualizado para todos os membros.',
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() => _localWallpaperBytes = null);
        showErrorToast(context, error.toString());
      }
    } finally {
      if (mounted) setState(() => _wallpaperBusy = false);
    }
  }

  Future<void> _customizeCurrentInvite() async {
    final controller = TextEditingController(
      text: _details?.group.inviteUrl?.split('/').last ?? '',
    );
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Personalizar link'),
          content: TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(prefixText: 'botadmin.shop/g/'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Salvar'),
            ),
          ],
        ),
      );
      if (confirmed != true || controller.text.trim().isEmpty || !mounted)
        return;
      await ref
          .read(apiClientProvider)
          .updateInternalGroup(
            widget.group.id,
            inviteSlug: controller.text.trim(),
          );
      await _initialLoad();
      widget.onChanged();
      if (mounted) showSuccessToast(context, 'Link personalizado salvo.');
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    } finally {
      controller.dispose();
    }
  }

  Future<void> _newInvite() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Redefinir link do grupo?'),
        content: const Text(
          'O link atual deixará de funcionar imediatamente e um novo será criado.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Redefinir link'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      final url = await ref
          .read(apiClientProvider)
          .rotateInternalGroupInvite(widget.group.id);
      if (!mounted) return;
      await Clipboard.setData(ClipboardData(text: url));
      showSuccessToast(
        context,
        'Novo link copiado. O convite anterior foi revogado.',
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  Future<void> _leaveGroup() async {
    final me = _details?.members.where((member) => member.isMe).firstOrNull;
    if (me == null) return;
    try {
      if (me.role == 'owner') {
        final admins = (_details?.members ?? const <InternalGroupMember>[])
            .where(
              (member) =>
                  !member.isBot && !member.isMe && member.role == 'admin',
            )
            .toList(growable: false);
        if (admins.isEmpty) {
          if (mounted) {
            showErrorToast(
              context,
              'Antes de sair, torne um membro administrador para assumir o grupo.',
            );
          }
          return;
        }
        final selectedId = await showDialog<int>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Transferir grupo e sair'),
            content: SizedBox(
              width: 420,
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
                        onTap: () =>
                            Navigator.pop(dialogContext, member.userId),
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
        if (selectedId == null || !mounted) return;
        final selected = admins.firstWhere(
          (member) => member.userId == selectedId,
        );
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text('Transferir para ${selected.name}?'),
            content: Text(
              '${selected.name} será o novo proprietário. Você sairá, mas o grupo e o robô continuarão ativos.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('Transferir e sair'),
              ),
            ],
          ),
        );
        if (confirmed != true || !mounted) return;
        await ref
            .read(apiClientProvider)
            .transferInternalGroupAndLeave(widget.group.id, selectedId);
      } else {
        await ref
            .read(apiClientProvider)
            .updateInternalGroupMember(widget.group.id, me.userId, 'leave');
      }
      if (!mounted) return;
      ref.read(selectedInternalGroupIdProvider.notifier).select(null);
      widget.onChanged();
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  Future<void> _clearGroupMessages() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Limpar mensagens para todos?'),
        content: const Text(
          'Todo o histórico deste grupo BotAdmin será removido para todos os participantes. Esta ação não pode ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Limpar para todos'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref
          .read(apiClientProvider)
          .runInternalGroupAction(widget.group.id, 'clear');
      if (!mounted) return;
      setState(() => _messages = const []);
      showSuccessToast(context, 'Mensagens limpas para todos.');
      widget.onChanged();
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  Future<void> _deleteGroup() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Apagar grupo BotAdmin?'),
        content: const Text(
          'O grupo, o histórico, os convites e as configurações do robô serão apagados permanentemente para todos.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Apagar grupo'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref
          .read(apiClientProvider)
          .runInternalGroupAction(widget.group.id, 'delete');
      if (!mounted) return;
      ref.read(selectedInternalGroupIdProvider.notifier).select(null);
      widget.onChanged();
      showSuccessToast(context, 'Grupo apagado.');
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }

  Future<void> _showMembers() async {
    try {
      final details = await ref
          .read(apiClientProvider)
          .loadInternalGroup(widget.group.id);
      if (!mounted) return;
      setState(() => _details = details);
      await showBotAdminBottomSheet<void>(
        context: context,
        useSafeArea: true,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (sheetContext) => SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * .78,
          child: Column(
            children: [
              ListTile(
                leading: _GroupAvatar(group: details.group),
                title: Text(
                  details.group.name,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(
                  details.group.description ??
                      '${details.members.length} membros',
                ),
                trailing: details.group.canManage
                    ? IconButton(
                        tooltip: 'Novo convite',
                        onPressed: () {
                          Navigator.pop(sheetContext);
                          unawaited(_newInvite());
                        },
                        icon: const Icon(Icons.add_link_rounded),
                      )
                    : null,
              ),
              const Divider(),
              Expanded(
                child: ListView.builder(
                  itemCount: details.members.length,
                  itemBuilder: (context, index) {
                    final member = details.members[index];
                    return ListTile(
                      leading: _InternalMemberAvatar(member: member),
                      title: Text(member.name),
                      subtitle: Text(
                        member.isBot
                            ? 'Robô interno · comandos e automações'
                            : member.role == 'owner'
                            ? 'Proprietário'
                            : member.role == 'admin'
                            ? 'Administrador'
                            : 'Membro',
                      ),
                      trailing:
                          !details.group.canManage ||
                              member.isMe ||
                              member.isBot ||
                              member.role == 'owner'
                          ? null
                          : PopupMenuButton<String>(
                              onSelected: (action) async {
                                Navigator.pop(sheetContext);
                                try {
                                  await ref
                                      .read(apiClientProvider)
                                      .updateInternalGroupMember(
                                        widget.group.id,
                                        member.userId,
                                        action,
                                      );
                                  await _initialLoad();
                                  widget.onChanged();
                                } catch (error) {
                                  if (mounted)
                                    showErrorToast(
                                      this.context,
                                      error.toString(),
                                    );
                                }
                              },
                              itemBuilder: (_) => [
                                if (details.group.isOwner)
                                  PopupMenuItem(
                                    value: member.role == 'admin'
                                        ? 'demote'
                                        : 'promote',
                                    child: Text(
                                      member.role == 'admin'
                                          ? 'Remover admin'
                                          : 'Tornar admin',
                                    ),
                                  ),
                                const PopupMenuItem(
                                  value: 'remove',
                                  child: Text('Remover do grupo'),
                                ),
                                const PopupMenuItem(
                                  value: 'ban',
                                  child: Text('Bloquear convite'),
                                ),
                              ],
                            ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error.toString());
    }
  }
}

class _InternalMessageBubble extends ConsumerWidget {
  const _InternalMessageBubble({
    required this.message,
    required this.canModerate,
    required this.onReply,
    required this.onDelete,
    required this.onPin,
    required this.onButton,
  });
  final InternalGroupMessage message;
  final bool canModerate;
  final VoidCallback onReply;
  final VoidCallback onDelete;
  final VoidCallback onPin;
  final ValueChanged<InternalGroupButton> onButton;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wa = WaTheme.of(context);
    if (message.type == 'system') {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 5),
        child: Center(
          child: Container(
            constraints: const BoxConstraints(maxWidth: 520),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(
              color: wa.accentSoft,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: wa.accent.withValues(alpha: .18)),
            ),
            child: Text(
              message.text ?? '',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: wa.textSecondary,
                fontSize: 12.5,
                height: 1.28,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ),
      );
    }
    return Align(
      alignment: message.isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () => _showActions(context),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 520),
          margin: const EdgeInsets.only(bottom: 7),
          padding: const EdgeInsets.fromLTRB(10, 7, 10, 6),
          decoration: BoxDecoration(
            color: message.isMine ? wa.bubbleOut : wa.bubbleIn,
            borderRadius: BorderRadius.circular(11),
            boxShadow: const [
              BoxShadow(color: Color(0x19000000), blurRadius: 1.5),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!message.isMine)
                Text(
                  message.senderName,
                  style: TextStyle(
                    color: wa.accent,
                    fontWeight: FontWeight.w800,
                    fontSize: 12.5,
                  ),
                ),
              if (message.replyTo != null)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(top: 3, bottom: 5),
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: .07),
                    borderRadius: BorderRadius.circular(7),
                  ),
                  child: Text(
                    '${message.replyTo!.senderName ?? 'Membro'}\n${message.replyTo!.text ?? 'Mídia'}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5),
                  ),
                ),
              if (message.deleted)
                const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.block_rounded, size: 16),
                    SizedBox(width: 5),
                    Text(
                      'Mensagem apagada',
                      style: TextStyle(fontStyle: FontStyle.italic),
                    ),
                  ],
                )
              else ...[
                if (message.mediaUrl != null)
                  _InternalMessageMedia(message: message),
                if (message.text != null && message.text!.isNotEmpty)
                  Padding(
                    padding: EdgeInsets.only(
                      top: message.mediaUrl == null ? 0 : 6,
                    ),
                    child: Text(
                      _normalizeInternalGroupText(message.text!),
                      textAlign: TextAlign.left,
                      softWrap: true,
                      style: TextStyle(
                        color: wa.bubbleText,
                        fontFamily: 'Roboto',
                        fontSize: 15,
                        height: 1.24,
                        letterSpacing: 0,
                        wordSpacing: 0,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ),
                if (message.buttons.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: message.buttons
                          .where((button) => button.title.trim().isNotEmpty)
                          .map(
                            (button) => OutlinedButton(
                              onPressed: () => onButton(button),
                              style: OutlinedButton.styleFrom(
                                minimumSize: const Size(0, 36),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                ),
                                visualDensity: VisualDensity.compact,
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    _internalButtonIcon(button.id),
                                    size: 17,
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    _normalizeInternalGroupText(button.title),
                                  ),
                                ],
                              ),
                            ),
                          )
                          .toList(growable: false),
                    ),
                  ),
              ],
              const SizedBox(height: 2),
              Align(
                alignment: Alignment.centerRight,
                child: Text(
                  message.createdAt == null
                      ? ''
                      : DateFormat(
                          'HH:mm',
                        ).format(message.createdAt!.toLocal()),
                  style: TextStyle(fontSize: 10.5, color: wa.textMuted),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  IconData _internalButtonIcon(String id) {
    final value = id.toLowerCase();
    if (value.contains('copy')) return Icons.copy_rounded;
    if (value.contains('url') || value.contains('link'))
      return Icons.open_in_new_rounded;
    if (value.contains('call') || value.contains('phone'))
      return Icons.call_rounded;
    return Icons.reply_rounded;
  }

  Future<void> _showActions(BuildContext context) async {
    final action = await showBotAdminBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.reply_rounded),
              title: const Text('Responder'),
              onTap: () => Navigator.pop(context, 'reply'),
            ),
            if (canModerate)
              ListTile(
                leading: Icon(
                  message.pinned ? Icons.push_pin : Icons.push_pin_outlined,
                ),
                title: Text(
                  message.pinned ? 'Desafixar mensagem' : 'Fixar mensagem',
                ),
                onTap: () => Navigator.pop(context, 'pin'),
              ),
            if (!message.deleted && (message.isMine || canModerate))
              ListTile(
                leading: const Icon(Icons.delete_outline_rounded),
                title: const Text('Apagar mensagem'),
                onTap: () => Navigator.pop(context, 'delete'),
              ),
          ],
        ),
      ),
    );
    if (action == 'reply') onReply();
    if (action == 'delete') onDelete();
    if (action == 'pin') onPin();
  }
}

String _normalizeInternalGroupText(String value) {
  return value
      .replaceAll('\u00A0', ' ')
      .replaceAll('\u2007', ' ')
      .replaceAll('\u202F', ' ')
      .replaceAll(RegExp(r'[\u200B-\u200D\uFEFF]'), '')
      .replaceAll(RegExp(r'[^\S\r\n]+'), ' ')
      .trim();
}

class _InternalMemberAvatar extends StatelessWidget {
  const _InternalMemberAvatar({required this.member});

  final InternalGroupMember member;

  @override
  Widget build(BuildContext context) {
    final fallback = ColoredBox(
      color: WaTheme.of(context).accent.withValues(alpha: .15),
      child: Center(
        child: member.isBot
            ? Icon(Icons.smart_toy_rounded, color: WaTheme.of(context).accent)
            : Text(
                member.name.isEmpty
                    ? '?'
                    : member.name.substring(0, 1).toUpperCase(),
                style: TextStyle(
                  color: WaTheme.of(context).accent,
                  fontWeight: FontWeight.w800,
                ),
              ),
      ),
    );
    return SizedBox.square(
      dimension: 40,
      child: ClipOval(
        child: member.avatarUrl == null
            ? fallback
            : BotAdminCachedImage(
                imageUrl: member.avatarUrl!,
                width: 40,
                height: 40,
                fit: BoxFit.cover,
                errorWidget: (_, __, ___) => fallback,
              ),
      ),
    );
  }
}

class _InternalMessageMedia extends ConsumerWidget {
  const _InternalMessageMedia({required this.message});
  final InternalGroupMessage message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final url = message.mediaUrl!;
    if (message.type == 'image') {
      return _AuthenticatedImage(url: url);
    }
    if (message.type == 'video') {
      return InlineVideoPlayer(
        url: url,
        mimeType: message.mediaMimeType,
        width: 340,
        height: 210,
      );
    }
    if (message.type == 'audio') {
      return InlineAudioPlayer(url: url, mimeType: message.mediaMimeType);
    }
    return InkWell(
      onTap: () => _openDocument(context, ref, url),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.insert_drive_file_outlined),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                message.mediaFileName ?? 'Abrir arquivo',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.download_rounded, size: 19),
          ],
        ),
      ),
    );
  }

  Future<void> _openDocument(
    BuildContext context,
    WidgetRef ref,
    String url,
  ) async {
    try {
      if (kIsWeb) {
        await launchUrl(
          Uri.parse(Uri.base.resolve(url).toString()),
          mode: LaunchMode.externalApplication,
        );
        return;
      }
      final media = await ref.read(apiClientProvider).downloadMediaBytes(url);
      final local = await createLocalMediaFile(
        media.bytes,
        media.mimeType,
        message.mediaFileName ?? url,
      );
      if (local == null)
        throw StateError('Não foi possível preparar o arquivo.');
      await OpenFilex.open(local);
    } catch (error) {
      if (context.mounted) showErrorToast(context, error.toString());
    }
  }
}

class _AuthenticatedImage extends ConsumerStatefulWidget {
  const _AuthenticatedImage({required this.url});
  final String url;

  @override
  ConsumerState<_AuthenticatedImage> createState() =>
      _AuthenticatedImageState();
}

class _AuthenticatedImageState extends ConsumerState<_AuthenticatedImage> {
  late Future<MediaBytes> _future;

  @override
  void initState() {
    super.initState();
    _future = ref.read(apiClientProvider).downloadMediaBytes(widget.url);
  }

  @override
  void didUpdateWidget(covariant _AuthenticatedImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) {
      _future = ref.read(apiClientProvider).downloadMediaBytes(widget.url);
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<MediaBytes>(
    future: _future,
    builder: (context, snapshot) {
      if (snapshot.hasData) {
        return ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.memory(
            snapshot.data!.bytes,
            width: 340,
            height: 260,
            fit: BoxFit.cover,
            gaplessPlayback: true,
          ),
        );
      }
      if (snapshot.hasError)
        return const SizedBox(
          width: 260,
          height: 100,
          child: Center(child: Icon(Icons.broken_image_outlined)),
        );
      return const SizedBox(
        width: 260,
        height: 150,
        child: Center(child: CircularProgressIndicator()),
      );
    },
  );
}

String _mimeForName(String name) {
  final lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}
