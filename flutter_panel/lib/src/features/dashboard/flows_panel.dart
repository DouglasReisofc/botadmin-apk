import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/top_toast.dart';
import '../../core/wa_theme.dart';
import '../../models/migration_models.dart';
import 'flow_folders_storage.dart';
import 'flow_visual_editor.dart';
import 'migration_panels.dart' show botFlowsProvider;

/// Painel de Fluxos: divisão permanente (lateral | conteúdo).
/// Biblioteca na lateral → ao editar, a mesma lateral vira a paleta de nós.
class FlowsPanel extends ConsumerStatefulWidget {
  const FlowsPanel({super.key});

  @override
  ConsumerState<FlowsPanel> createState() => _FlowsPanelState();
}

class _FlowsPanelState extends ConsumerState<FlowsPanel> {
  static const _sideRailWidth = 320.0;

  int? _selectedId;
  String _search = '';
  String? _busyKey;
  bool _dirty = false;
  FlowOrgState _org = const FlowOrgState();

  /// Pasta aberta (null = raiz da biblioteca).
  String? _currentFolderId;

  /// Key do canvas para a paleta lateral adicionar nós.
  /// Recriada a cada abertura de fluxo (evita conflito no AnimatedSwitcher).
  GlobalKey<FlowVisualEditorState> _editorKey =
      GlobalKey<FlowVisualEditorState>();

  BotFlowSummary? _draft;
  late final TextEditingController _name;
  late final TextEditingController _command;
  late final TextEditingController _description;
  String _scope = 'both';
  String _triggerType = 'command';
  String _matchMode = 'exact';
  bool _enabled = true;
  List<Map<String, dynamic>> _nodes = const [];
  List<Map<String, dynamic>> _edges = const [];

  @override
  void initState() {
    super.initState();
    _name = TextEditingController();
    _command = TextEditingController();
    _description = TextEditingController();
    _org = loadFlowOrg();
  }

  @override
  void dispose() {
    _name.dispose();
    _command.dispose();
    _description.dispose();
    super.dispose();
  }

  void _persistOrg(FlowOrgState next) {
    setState(() => _org = next);
    saveFlowOrg(next);
  }

  void _openEditor(BotFlowSummary flow) {
    // Nova key a cada fluxo: paleta lateral aponta pro canvas correto.
    _editorKey = GlobalKey<FlowVisualEditorState>();
    setState(() {
      _selectedId = flow.id;
      _draft = flow;
      _name.text = flow.name;
      _command.text = flow.command;
      _description.text = flow.description ?? '';
      _scope = flow.scope.trim().isEmpty ? 'both' : flow.scope;
      _triggerType = flow.triggerType.trim().isEmpty
          ? 'command'
          : flow.triggerType;
      _matchMode = flow.matchMode.trim().isEmpty ? 'exact' : flow.matchMode;
      _enabled = flow.enabled;
      _nodes = flow.nodes.map((n) => Map<String, dynamic>.from(n)).toList();
      _edges = flow.edges.map((e) => Map<String, dynamic>.from(e)).toList();
      _dirty = false;
    });
  }

  Future<void> _closeEditor({bool force = false}) async {
    if (_dirty && !force) {
      final action = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Sair do editor?'),
          content: const Text(
            'Há alterações não salvas neste fluxo. O que deseja fazer?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, 'cancel'),
              child: const Text('Continuar editando'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, 'discard'),
              child: const Text('Descartar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, 'save'),
              child: const Text('Salvar e sair'),
            ),
          ],
        ),
      );
      if (action == null || action == 'cancel') return;
      if (action == 'save') {
        await _saveDraft();
        if (_dirty) return; // save failed
      }
    }
    if (!mounted) return;
    setState(() {
      _selectedId = null;
      _draft = null;
      _dirty = false;
    });
  }

  void _addFromPalette(FlowPaletteItem item, {Offset? global}) {
    final state = _editorKey.currentState;
    if (state == null) return;
    if (global != null) {
      state.addPaletteItemAtGlobal(item, global);
    } else {
      state.addPaletteItem(item);
    }
  }

  List<BotFlowSummary> _filtered(List<BotFlowSummary> items) {
    final q = _search.trim().toLowerCase();
    if (q.isEmpty) return items;
    return items
        .where((flow) {
          return flow.name.toLowerCase().contains(q) ||
              flow.command.toLowerCase().contains(q) ||
              flow.triggerType.toLowerCase().contains(q) ||
              (flow.description ?? '').toLowerCase().contains(q);
        })
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final flowsAsync = ref.watch(botFlowsProvider);
    final width = MediaQuery.sizeOf(context).width;
    final compact = width < 820;
    final editing = _draft != null && _selectedId != null;

    return ColoredBox(
      color: wa.contentBg,
      child: flowsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(error.toString(), textAlign: TextAlign.center),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () => ref.invalidate(botFlowsProvider),
                  child: const Text('Tentar de novo'),
                ),
              ],
            ),
          ),
        ),
        data: (flows) {
          final filtered = _filtered(flows);

          FlowFolder? currentFolder;
          if (_currentFolderId != null) {
            for (final f in _org.folders) {
              if (f.id == _currentFolderId) {
                currentFolder = f;
                break;
              }
            }
            // Se a pasta aberta foi apagada, volta à raiz.
            if (currentFolder == null) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) setState(() => _currentFolderId = null);
              });
            }
          }

          final library = _FlowsLibraryPane(
            flows: filtered,
            totalCount: flows.length,
            selectedId: _selectedId,
            search: _search,
            busyKey: _busyKey,
            org: _org,
            currentFolderId: _currentFolderId,
            currentFolder: currentFolder,
            compact: true,
            onSearch: (v) => setState(() => _search = v),
            onOpenFlow: _openEditor,
            onOpenFolder: (id) => setState(() {
              _currentFolderId = id;
              _search = '';
            }),
            onBackToRoot: () => setState(() {
              _currentFolderId = null;
              _search = '';
            }),
            onCreateMenu: () => _showCreateMenu(folderId: _currentFolderId),
            onCreateFlowHere: () =>
                unawaited(_createFlow(folderId: _currentFolderId)),
            onRefresh: () => ref.invalidate(botFlowsProvider),
            onToggle: _toggleFlow,
            onDeleteFlow: _deleteFlow,
            onRenameFolder: _renameFolder,
            onDeleteFolder: _deleteFolder,
            onMoveFlow: _moveFlowToFolder,
          );

          final sideRail = AnimatedSwitcher(
            duration: const Duration(milliseconds: 280),
            switchInCurve: Curves.easeOutCubic,
            switchOutCurve: Curves.easeInCubic,
            transitionBuilder: (child, anim) {
              final offset = Tween<Offset>(
                begin: const Offset(-0.06, 0),
                end: Offset.zero,
              ).animate(anim);
              return FadeTransition(
                opacity: anim,
                child: SlideTransition(position: offset, child: child),
              );
            },
            child: editing
                ? KeyedSubtree(
                    key: const ValueKey('palette-rail'),
                    child: _EditingSideRail(
                      flowName: _name.text.trim().isEmpty
                          ? (_draft?.name ?? 'Fluxo')
                          : _name.text.trim(),
                      dirty: _dirty,
                      saving: _busyKey == 'save-${_draft!.id}',
                      enabled: _enabled,
                      nodeCount: _nodes.length,
                      onBack: () => unawaited(_closeEditor()),
                      onSave: _saveDraft,
                      onSettings: _openSettingsModal,
                      onEnabled: (v) => setState(() {
                        _enabled = v;
                        _dirty = true;
                      }),
                      onAddNode: (item) => _addFromPalette(item),
                      onDragAddNode: (item, global) =>
                          _addFromPalette(item, global: global),
                    ),
                  )
                : KeyedSubtree(
                    key: const ValueKey('library-rail'),
                    child: library,
                  ),
          );

          final content = AnimatedSwitcher(
            duration: const Duration(milliseconds: 260),
            switchInCurve: Curves.easeOutCubic,
            switchOutCurve: Curves.easeInCubic,
            child: editing
                ? KeyedSubtree(
                    key: ValueKey('editor-${_draft!.id}'),
                    child: _FlowEditorPane(
                      editorKey: _editorKey,
                      nameController: _name,
                      enabled: _enabled,
                      nodes: _nodes,
                      edges: _edges,
                      dirty: _dirty,
                      saving: _busyKey == 'save-${_draft!.id}',
                      compact: compact,
                      onBack: () => unawaited(_closeEditor()),
                      onOpenSettings: _openSettingsModal,
                      onOpenPaletteSheet: compact
                          ? () => _showMobilePaletteSheet()
                          : null,
                      onEnabled: (v) => setState(() {
                        _enabled = v;
                        _dirty = true;
                      }),
                      onNodesChanged: (nodes) => setState(() {
                        _nodes = nodes;
                        _dirty = true;
                      }),
                      onEdgesChanged: (edges) => setState(() {
                        _edges = edges;
                        _dirty = true;
                      }),
                      onSave: _saveDraft,
                      onDelete: () => _deleteFlow(_draft!),
                    ),
                  )
                : KeyedSubtree(
                    key: const ValueKey('empty-hero'),
                    child: _FlowsEmptyHero(
                      totalCount: flows.length,
                      folderCount: _org.folders.length,
                      activeCount: flows.where((f) => f.enabled).length,
                      onCreateFlow: () =>
                          unawaited(_createFlow(folderId: _currentFolderId)),
                      onCreateFolder: () => unawaited(_createFolder()),
                    ),
                  ),
          );

          // Mobile: biblioteca full ou editor full (paleta via bottom sheet).
          if (compact) {
            return editing ? content : library;
          }

          // Desktop: divisão permanente lateral | conteúdo.
          return Row(
            children: [
              SizedBox(
                width: _sideRailWidth,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: wa.panel,
                    border: Border(right: BorderSide(color: wa.border)),
                  ),
                  child: sideRail,
                ),
              ),
              Expanded(child: content),
            ],
          );
        },
      ),
    );
  }

  Future<void> _showMobilePaletteSheet() async {
    await showBotAdminBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: WaTheme.of(context).panel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (context) {
        final h = MediaQuery.sizeOf(context).height * 0.72;
        return SizedBox(
          height: h,
          child: FlowNodePalette(
            compact: true,
            onAdd: (item) {
              Navigator.pop(context);
              _addFromPalette(item);
            },
            onDragAdd: (item, _) {
              Navigator.pop(context);
              _addFromPalette(item);
            },
            header: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Text(
                'Adicionar nó',
                style: TextStyle(
                  color: WaTheme.of(context).textPrimary,
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _showCreateMenu({String? folderId}) async {
    final insideFolder = folderId != null && folderId.isNotEmpty;
    final choice = await showBotAdminBottomSheet<String>(
      context: context,
      showDragHandle: true,
      backgroundColor: WaTheme.of(context).panel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (context) {
        final wa = WaTheme.of(context);
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: CircleAvatar(
                    backgroundColor: wa.accentSoft,
                    child: Icon(Icons.account_tree_rounded, color: wa.accent),
                  ),
                  title: Text(
                    insideFolder ? 'Novo fluxo nesta pasta' : 'Novo fluxo',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  subtitle: Text(
                    insideFolder
                        ? 'Cria e salva dentro da pasta aberta'
                        : 'Automação arrasta e solta no canvas',
                  ),
                  onTap: () => Navigator.pop(context, 'flow'),
                ),
                if (!insideFolder)
                  ListTile(
                    leading: CircleAvatar(
                      backgroundColor: wa.searchBg,
                      child: Icon(Icons.folder_rounded, color: wa.icon),
                    ),
                    title: const Text(
                      'Nova pasta',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                    subtitle: const Text(
                      'Organize fluxos por projeto ou cliente',
                    ),
                    onTap: () => Navigator.pop(context, 'folder'),
                  ),
              ],
            ),
          ),
        );
      },
    );
    if (choice == 'flow') await _createFlow(folderId: folderId);
    if (choice == 'folder') await _createFolder();
  }

  Future<void> _createFolder() async {
    final name = await showDialog<String>(
      context: context,
      builder: (context) => const _NameDialog(
        title: 'Nova pasta',
        label: 'Nome da pasta',
        initial: 'Minha pasta',
        confirmLabel: 'Criar pasta',
      ),
    );
    if (name == null || name.trim().isEmpty) return;
    final id = 'folder-${DateTime.now().microsecondsSinceEpoch}';
    final folder = FlowFolder(
      id: id,
      name: name.trim(),
      order: _org.folders.length,
    );
    final next = _org.copyWith(folders: [..._org.folders, folder]);
    _persistOrg(next);
    if (mounted) {
      // Entra direto na pasta recém-criada.
      setState(() => _currentFolderId = id);
      showSuccessToast(context, 'Pasta "${folder.name}" criada.');
    }
  }

  Future<void> _renameFolder(FlowFolder folder) async {
    final name = await showDialog<String>(
      context: context,
      builder: (context) => _NameDialog(
        title: 'Renomear pasta',
        label: 'Nome da pasta',
        initial: folder.name,
        confirmLabel: 'Salvar',
      ),
    );
    if (name == null || name.trim().isEmpty) return;
    final nextFolders = _org.folders
        .map(
          (f) => f.id == folder.id
              ? FlowFolder(id: f.id, name: name.trim(), order: f.order)
              : f,
        )
        .toList();
    _persistOrg(_org.copyWith(folders: nextFolders));
    if (mounted) showSuccessToast(context, 'Pasta renomeada.');
  }

  Future<void> _deleteFolder(FlowFolder folder) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir pasta?'),
        content: Text(
          'A pasta "${folder.name}" será removida. Os fluxos dentro dela voltam para a raiz (não são apagados).',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Excluir pasta'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final nextFolders = _org.folders.where((f) => f.id != folder.id).toList();
    final nextAssign = Map<String, String>.from(_org.assignments)
      ..removeWhere((_, folderId) => folderId == folder.id);
    _persistOrg(FlowOrgState(folders: nextFolders, assignments: nextAssign));
    if (mounted) {
      setState(() {
        if (_currentFolderId == folder.id) _currentFolderId = null;
      });
      showSuccessToast(context, 'Pasta removida.');
    }
  }

  Future<void> _moveFlowToFolder(BotFlowSummary flow, String? folderId) async {
    final next = Map<String, String>.from(_org.assignments);
    if (folderId == null || folderId.isEmpty) {
      next.remove('${flow.id}');
    } else {
      next['${flow.id}'] = folderId;
    }
    _persistOrg(_org.copyWith(assignments: next));
    var folderName = 'raiz';
    if (folderId != null) {
      for (final f in _org.folders) {
        if (f.id == folderId) {
          folderName = f.name;
          break;
        }
      }
    }
    if (mounted) {
      showSuccessToast(context, 'Fluxo movido para $folderName.');
    }
  }

  Future<void> _openSettingsModal() async {
    final result = await showBotAdminBottomSheet<_FlowSettingsResult>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: WaTheme.of(context).panel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (context) {
        return _FlowSettingsSheet(
          name: _name.text,
          command: _command.text,
          description: _description.text,
          scope: _scope,
          triggerType: _triggerType,
          matchMode: _matchMode,
          enabled: _enabled,
        );
      },
    );
    if (result == null) return;
    setState(() {
      _name.text = result.name;
      _command.text = result.command;
      _description.text = result.description;
      _scope = result.scope;
      _triggerType = result.triggerType;
      _matchMode = result.matchMode;
      _enabled = result.enabled;
      _dirty = true;
    });
  }

  Future<void> _createFlow({String? folderId}) async {
    final draft = await showDialog<_NewFlowDraft>(
      context: context,
      builder: (context) =>
          _NewFlowDialog(folders: _org.folders, initialFolderId: folderId),
    );
    if (draft == null) return;
    await _run('create', () async {
      final list = await ref
          .read(apiClientProvider)
          .createBotFlow(
            name: draft.name,
            command: draft.command,
            scope: draft.scope,
            text: draft.text,
          );
      ref.invalidate(botFlowsProvider);
      final created = list.cast<BotFlowSummary?>().firstWhere(
        (f) => f?.name == draft.name && f?.command == draft.command,
        orElse: () => list.isNotEmpty ? list.last : null,
      );
      if (created != null) {
        if (draft.folderId != null && draft.folderId!.isNotEmpty) {
          final next = Map<String, String>.from(_org.assignments);
          next['${created.id}'] = draft.folderId!;
          _persistOrg(_org.copyWith(assignments: next));
          setState(() => _currentFolderId = draft.folderId);
        }
        if (mounted) {
          showSuccessToast(context, 'Fluxo criado com sucesso.');
          _openEditor(created);
        }
      }
    });
  }

  Future<void> _toggleFlow(BotFlowSummary flow, bool enabled) async {
    await _run('toggle-${flow.id}', () async {
      await ref
          .read(apiClientProvider)
          .updateBotFlow(flow.copyForEnabled(enabled));
      ref.invalidate(botFlowsProvider);
      if (_draft?.id == flow.id && mounted) {
        setState(() {
          _enabled = enabled;
          _draft = _draft!.copyWith(enabled: enabled);
        });
      }
      if (mounted) {
        showSuccessToast(
          context,
          enabled ? 'Fluxo ativado.' : 'Fluxo desativado.',
        );
      }
    });
  }

  Future<void> _deleteFlow(BotFlowSummary flow) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remover fluxo?'),
        content: Text('O fluxo "${flow.name}" será removido definitivamente.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remover'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run('delete-${flow.id}', () async {
      await ref.read(apiClientProvider).deleteBotFlow(flow.id);
      final nextAssign = Map<String, String>.from(_org.assignments)
        ..remove('${flow.id}');
      _persistOrg(_org.copyWith(assignments: nextAssign));
      ref.invalidate(botFlowsProvider);
      if (mounted && _selectedId == flow.id) {
        setState(() {
          _selectedId = null;
          _draft = null;
          _dirty = false;
        });
      }
      if (mounted) showSuccessToast(context, 'Fluxo removido.');
    });
  }

  Future<void> _saveDraft() async {
    final current = _draft;
    if (current == null) return;
    final name = _name.text.trim();
    if (name.isEmpty) {
      showErrorToast(context, 'Informe o nome do fluxo.');
      return;
    }
    final nodes = _nodes.map((n) => Map<String, dynamic>.from(n)).toList();
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i]['kind']?.toString() ?? '') == 'trigger') {
        nodes[i] = {
          ...nodes[i],
          'triggerType': _triggerType,
          'triggerMatchMode': _matchMode,
          'triggerValue': _command.text.trim(),
        };
      }
    }

    final payload = current.copyWith(
      name: name,
      command: _command.text.trim(),
      triggerType: _triggerType,
      matchMode: _matchMode,
      scope: _scope,
      enabled: _enabled,
      description: _description.text.trim().isEmpty
          ? null
          : _description.text.trim(),
      nodes: nodes,
      edges: _edges,
    );

    await _run('save-${current.id}', () async {
      final list = await ref.read(apiClientProvider).updateBotFlow(payload);
      ref.invalidate(botFlowsProvider);
      final updated = list.cast<BotFlowSummary?>().firstWhere(
        (f) => f?.id == current.id,
        orElse: () => payload,
      );
      if (mounted && updated != null) {
        setState(() {
          _draft = updated;
          _name.text = updated.name;
          _command.text = updated.command;
          _description.text = updated.description ?? '';
          _scope = updated.scope;
          _triggerType = updated.triggerType;
          _matchMode = updated.matchMode;
          _enabled = updated.enabled;
          _nodes = updated.nodes
              .map((n) => Map<String, dynamic>.from(n))
              .toList();
          _edges = updated.edges
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          _dirty = false;
        });
        showSuccessToast(context, 'Fluxo salvo com sucesso.');
      }
    });
  }

  Future<void> _run(String key, Future<void> Function() action) async {
    if (_busyKey != null) return;
    setState(() => _busyKey = key);
    try {
      await action();
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }
}

// ─── Biblioteca (navegação por pastas) ───────────────────────────────

class _FlowsLibraryPane extends StatelessWidget {
  const _FlowsLibraryPane({
    required this.flows,
    required this.totalCount,
    required this.selectedId,
    required this.search,
    required this.busyKey,
    required this.org,
    required this.currentFolderId,
    required this.currentFolder,
    required this.onSearch,
    required this.onOpenFlow,
    required this.onOpenFolder,
    required this.onBackToRoot,
    required this.onCreateMenu,
    required this.onCreateFlowHere,
    required this.onRefresh,
    required this.onToggle,
    required this.onDeleteFlow,
    required this.onRenameFolder,
    required this.onDeleteFolder,
    required this.onMoveFlow,
    this.compact = false,
  });

  final List<BotFlowSummary> flows;
  final int totalCount;
  final int? selectedId;
  final String search;
  final String? busyKey;
  final FlowOrgState org;
  final String? currentFolderId;
  final FlowFolder? currentFolder;
  final bool compact;
  final ValueChanged<String> onSearch;
  final ValueChanged<BotFlowSummary> onOpenFlow;
  final ValueChanged<String> onOpenFolder;
  final VoidCallback onBackToRoot;
  final Future<void> Function() onCreateMenu;
  final VoidCallback onCreateFlowHere;
  final VoidCallback onRefresh;
  final Future<void> Function(BotFlowSummary flow, bool enabled) onToggle;
  final Future<void> Function(BotFlowSummary flow) onDeleteFlow;
  final Future<void> Function(FlowFolder folder) onRenameFolder;
  final Future<void> Function(FlowFolder folder) onDeleteFolder;
  final Future<void> Function(BotFlowSummary flow, String? folderId) onMoveFlow;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final insideFolder = currentFolder != null;
    final activeCount = flows.where((f) => f.enabled).length;

    final rootFlows = <BotFlowSummary>[];
    final byFolder = <String, List<BotFlowSummary>>{
      for (final f in org.folders) f.id: <BotFlowSummary>[],
    };
    for (final flow in flows) {
      final folderId = org.assignments['${flow.id}'];
      if (folderId != null && byFolder.containsKey(folderId)) {
        byFolder[folderId]!.add(flow);
      } else {
        rootFlows.add(flow);
      }
    }

    // Conteúdo da “tela” atual: raiz (pastas + fluxos soltos) ou dentro da pasta.
    final List<BotFlowSummary> visibleFlows;
    final List<FlowFolder> visibleFolders;
    if (insideFolder) {
      visibleFolders = const [];
      visibleFlows = byFolder[currentFolder!.id] ?? const <BotFlowSummary>[];
    } else {
      visibleFolders = org.folders;
      visibleFlows = rootFlows;
    }

    // Na raiz com busca: acha fluxos em qualquer pasta.
    // Dentro da pasta: só o conteúdo da pasta (já filtrado).
    final searching = search.trim().isNotEmpty;
    final displayFlows = insideFolder
        ? visibleFlows
        : (searching ? flows : rootFlows);
    final displayFolders = insideFolder
        ? const <FlowFolder>[]
        : (searching
              ? org.folders
                    .where(
                      (f) => f.name.toLowerCase().contains(
                        search.trim().toLowerCase(),
                      ),
                    )
                    .toList()
              : visibleFolders);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 16, 12, 6),
          child: Row(
            children: [
              if (insideFolder)
                IconButton(
                  tooltip: 'Voltar',
                  onPressed: onBackToRoot,
                  icon: const Icon(Icons.arrow_back_rounded),
                )
              else
                const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      insideFolder ? currentFolder!.name : 'Fluxos',
                      style: TextStyle(
                        color: wa.textPrimary,
                        fontSize: compact
                            ? (insideFolder ? 18 : 20)
                            : (insideFolder ? 22 : 26),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      insideFolder
                          ? '${visibleFlows.length} fluxo(s) nesta pasta'
                          : compact
                          ? '$totalCount · $activeCount ativos'
                          : '$totalCount fluxo(s) · $activeCount ativo(s) · ${org.folders.length} pasta(s)',
                      style: TextStyle(
                        color: wa.textMuted,
                        fontSize: compact ? 12 : 13,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: onRefresh,
                tooltip: 'Atualizar',
                icon: Icon(Icons.refresh_rounded, color: wa.icon),
              ),
              FilledButton.icon(
                onPressed: insideFolder
                    ? onCreateFlowHere
                    : () => unawaited(onCreateMenu()),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: Text(insideFolder ? 'Novo fluxo' : 'Novo'),
              ),
              const SizedBox(width: 4),
            ],
          ),
        ),
        if (insideFolder)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(
              children: [
                InkWell(
                  onTap: onBackToRoot,
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 4,
                    ),
                    child: Text(
                      'Fluxos',
                      style: TextStyle(
                        color: wa.accent,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 18,
                  color: wa.textMuted,
                ),
                Flexible(
                  child: Text(
                    currentFolder!.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const Spacer(),
                TextButton(
                  onPressed: () => unawaited(onRenameFolder(currentFolder!)),
                  child: const Text('Renomear'),
                ),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: TextField(
            onChanged: onSearch,
            decoration: InputDecoration(
              hintText: insideFolder
                  ? 'Buscar nesta pasta…'
                  : 'Buscar fluxos e pastas…',
              prefixIcon: const Icon(Icons.search_rounded),
              isDense: true,
              filled: true,
              fillColor: wa.searchBg,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),
        Expanded(
          child: displayFlows.isEmpty && displayFolders.isEmpty
              ? _EmptyLibrary(
                  onCreate: onCreateMenu,
                  insideFolder: insideFolder,
                  folderName: currentFolder?.name,
                  onCreateFlowHere: onCreateFlowHere,
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 28),
                  children: [
                    for (final folder in displayFolders)
                      _FolderTile(
                        folder: folder,
                        count: byFolder[folder.id]?.length ?? 0,
                        onOpen: () => onOpenFolder(folder.id),
                        onRename: () => unawaited(onRenameFolder(folder)),
                        onDelete: () => unawaited(onDeleteFolder(folder)),
                      ),
                    if (!insideFolder &&
                        displayFolders.isNotEmpty &&
                        displayFlows.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(8, 14, 8, 6),
                        child: Text(
                          searching ? 'FLUXOS ENCONTRADOS' : 'FLUXOS',
                          style: TextStyle(
                            color: wa.textMuted,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    for (final flow in displayFlows)
                      _FlowRow(
                        flow: flow,
                        selected: flow.id == selectedId,
                        busy:
                            busyKey == 'toggle-${flow.id}' ||
                            busyKey == 'delete-${flow.id}',
                        folders: org.folders,
                        currentFolderId: currentFolderId,
                        showFolderHint: searching || !insideFolder,
                        folderName: () {
                          final fid = org.assignments['${flow.id}'];
                          if (fid == null) return null;
                          for (final f in org.folders) {
                            if (f.id == fid) return f.name;
                          }
                          return null;
                        }(),
                        onOpen: () => onOpenFlow(flow),
                        onToggle: (v) => unawaited(onToggle(flow, v)),
                        onDelete: () => unawaited(onDeleteFlow(flow)),
                        onMove: (folderId) =>
                            unawaited(onMoveFlow(flow, folderId)),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _EmptyLibrary extends StatelessWidget {
  const _EmptyLibrary({
    required this.onCreate,
    this.insideFolder = false,
    this.folderName,
    this.onCreateFlowHere,
  });

  final Future<void> Function() onCreate;
  final bool insideFolder;
  final String? folderName;
  final VoidCallback? onCreateFlowHere;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400),
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                insideFolder ? Icons.folder_open_rounded : Icons.hub_outlined,
                size: 56,
                color: wa.textMuted,
              ),
              const SizedBox(height: 16),
              Text(
                insideFolder ? 'Pasta vazia' : 'Sua biblioteca de automações',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                insideFolder
                    ? 'Crie um fluxo dentro de "${folderName ?? 'esta pasta'}" para começar.'
                    : 'Crie pastas, entre nelas e monte fluxos com editor visual arrasta e solta.',
                textAlign: TextAlign.center,
                style: TextStyle(color: wa.textMuted, height: 1.4),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: insideFolder
                    ? onCreateFlowHere
                    : () => unawaited(onCreate()),
                icon: const Icon(Icons.add_rounded),
                label: Text(insideFolder ? 'Criar fluxo aqui' : 'Começar'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FolderTile extends StatelessWidget {
  const _FolderTile({
    required this.folder,
    required this.count,
    required this.onOpen,
    required this.onRename,
    required this.onDelete,
  });

  final FlowFolder folder;
  final int count;
  final VoidCallback onOpen;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: wa.panel,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 4, 12),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: const Color(0x22E0A63A),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.folder_rounded,
                    color: Color(0xFFE0A63A),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        folder.name,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontWeight: FontWeight.w800,
                          fontSize: 15.5,
                        ),
                      ),
                      Text(
                        count == 0
                            ? 'Vazia · toque para abrir'
                            : '$count fluxo(s) · toque para abrir',
                        style: TextStyle(color: wa.textMuted, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded, color: wa.icon),
                PopupMenuButton<String>(
                  tooltip: 'Opções da pasta',
                  color: wa.menuBg,
                  onSelected: (value) {
                    switch (value) {
                      case 'rename':
                        onRename();
                      case 'delete':
                        onDelete();
                    }
                  },
                  itemBuilder: (context) => const [
                    PopupMenuItem(value: 'rename', child: Text('Renomear')),
                    PopupMenuItem(
                      value: 'delete',
                      child: Text('Excluir pasta'),
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

class _FlowRow extends StatelessWidget {
  const _FlowRow({
    required this.flow,
    required this.selected,
    required this.busy,
    required this.folders,
    required this.onOpen,
    required this.onToggle,
    required this.onDelete,
    required this.onMove,
    this.currentFolderId,
    this.showFolderHint = false,
    this.folderName,
  });

  final BotFlowSummary flow;
  final bool selected;
  final bool busy;
  final List<FlowFolder> folders;
  final VoidCallback onOpen;
  final ValueChanged<bool> onToggle;
  final VoidCallback onDelete;
  final ValueChanged<String?> onMove;
  final String? currentFolderId;
  final bool showFolderHint;
  final String? folderName;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: selected ? wa.selectedRow : wa.panel,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: flow.enabled
                      ? wa.accentSoft
                      : wa.avatarFallback,
                  child: busy
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(
                          Icons.account_tree_rounded,
                          size: 18,
                          color: flow.enabled ? wa.accent : wa.icon,
                        ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        flow.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontWeight: FontWeight.w700,
                          fontSize: 14.5,
                        ),
                      ),
                      Text(
                        showFolderHint && folderName != null
                            ? '$folderName · ${flow.triggerLabel}'
                            : '${flow.triggerLabel} · ${flow.nodeCount} nós',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: wa.textMuted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Switch.adaptive(
                  value: flow.enabled,
                  activeTrackColor: wa.accent,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  onChanged: busy ? null : onToggle,
                ),
                PopupMenuButton<String>(
                  tooltip: 'Mais',
                  color: wa.menuBg,
                  onSelected: (value) {
                    if (value == 'open') onOpen();
                    if (value == 'delete') onDelete();
                    if (value == 'root') onMove(null);
                    if (value.startsWith('folder:')) {
                      onMove(value.substring('folder:'.length));
                    }
                  },
                  itemBuilder: (context) => [
                    const PopupMenuItem(
                      value: 'open',
                      child: Text('Abrir editor'),
                    ),
                    if (folders.isNotEmpty) ...[
                      const PopupMenuDivider(),
                      const PopupMenuItem(
                        enabled: false,
                        child: Text('Mover para…'),
                      ),
                      if (currentFolderId != null)
                        const PopupMenuItem(
                          value: 'root',
                          child: Text('Raiz (sair da pasta)'),
                        ),
                      for (final f in folders)
                        if (f.id != currentFolderId)
                          PopupMenuItem(
                            value: 'folder:${f.id}',
                            child: Text(f.name),
                          ),
                    ],
                    const PopupMenuDivider(),
                    const PopupMenuItem(
                      value: 'delete',
                      child: Text(
                        'Excluir fluxo',
                        style: TextStyle(color: Color(0xFFB42318)),
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

// ─── Lateral em modo edição (paleta de nós) ──────────────────────────

class _EditingSideRail extends StatelessWidget {
  const _EditingSideRail({
    required this.flowName,
    required this.dirty,
    required this.saving,
    required this.enabled,
    required this.nodeCount,
    required this.onBack,
    required this.onSave,
    required this.onSettings,
    required this.onEnabled,
    required this.onAddNode,
    required this.onDragAddNode,
  });

  final String flowName;
  final bool dirty;
  final bool saving;
  final bool enabled;
  final int nodeCount;
  final VoidCallback onBack;
  final Future<void> Function() onSave;
  final Future<void> Function() onSettings;
  final ValueChanged<bool> onEnabled;
  final ValueChanged<FlowPaletteItem> onAddNode;
  final void Function(FlowPaletteItem item, Offset global) onDragAddNode;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return FlowNodePalette(
      compact: true,
      onAdd: onAddNode,
      onDragAdd: onDragAddNode,
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(6, 8, 8, 0),
            child: Row(
              children: [
                IconButton(
                  tooltip: 'Voltar à biblioteca',
                  onPressed: onBack,
                  icon: const Icon(Icons.arrow_back_rounded),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Editando',
                        style: TextStyle(
                          color: wa.accent,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.3,
                        ),
                      ),
                      Text(
                        flowName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontWeight: FontWeight.w800,
                          fontSize: 14.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: saving || !dirty
                        ? null
                        : () => unawaited(onSave()),
                    icon: saving
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_rounded, size: 16),
                    label: Text(
                      saving ? '…' : (dirty ? 'Salvar' : 'Salvo'),
                      style: const TextStyle(fontSize: 13),
                    ),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Tooltip(
                  message: enabled ? 'Fluxo ativo' : 'Fluxo inativo',
                  child: Switch.adaptive(
                    value: enabled,
                    activeTrackColor: wa.accent,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    onChanged: onEnabled,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: wa.searchBg,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: wa.border),
              ),
              child: Row(
                children: [
                  Icon(Icons.grid_view_rounded, size: 16, color: wa.accent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Arraste nós para o canvas',
                      style: TextStyle(
                        color: wa.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 12.5,
                      ),
                    ),
                  ),
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
                      '$nodeCount',
                      style: TextStyle(
                        color: wa.accent,
                        fontWeight: FontWeight.w800,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Hero vazio (direita, quando nenhum fluxo aberto) ────────────────

class _FlowsEmptyHero extends StatelessWidget {
  const _FlowsEmptyHero({
    required this.totalCount,
    required this.folderCount,
    required this.activeCount,
    required this.onCreateFlow,
    required this.onCreateFolder,
  });

  final int totalCount;
  final int folderCount;
  final int activeCount;
  final VoidCallback onCreateFlow;
  final VoidCallback onCreateFolder;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  color: wa.accentSoft,
                  borderRadius: BorderRadius.circular(28),
                ),
                child: Icon(Icons.hub_rounded, size: 44, color: wa.accent),
              ),
              const SizedBox(height: 22),
              Text(
                'Editor de fluxos',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: wa.textPrimary,
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                totalCount == 0
                    ? 'Crie pastas na lateral, entre nelas e monte automações com arrasta e solta — webhooks, mensagens, condições e mais.'
                    : 'Selecione um fluxo na lateral para editar no canvas. A biblioteca vira a paleta de nós enquanto você edita.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: wa.textMuted,
                  height: 1.45,
                  fontSize: 14.5,
                ),
              ),
              const SizedBox(height: 22),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                alignment: WrapAlignment.center,
                children: [
                  _StatChip(
                    icon: Icons.account_tree_rounded,
                    label: '$totalCount fluxos',
                  ),
                  _StatChip(
                    icon: Icons.check_circle_outline_rounded,
                    label: '$activeCount ativos',
                  ),
                  _StatChip(
                    icon: Icons.folder_outlined,
                    label: '$folderCount pastas',
                  ),
                ],
              ),
              const SizedBox(height: 28),
              Wrap(
                spacing: 12,
                runSpacing: 10,
                alignment: WrapAlignment.center,
                children: [
                  FilledButton.icon(
                    onPressed: onCreateFlow,
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Novo fluxo'),
                  ),
                  OutlinedButton.icon(
                    onPressed: onCreateFolder,
                    icon: const Icon(Icons.create_new_folder_outlined),
                    label: const Text('Nova pasta'),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Text(
                'Dica: clique em um fluxo na lista para abrir o editor instantaneamente.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: wa.textMuted.withValues(alpha: 0.85),
                  fontSize: 12.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: wa.panel,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: wa.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: wa.icon),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: wa.textPrimary,
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Canvas (direita em modo edição) ─────────────────────────────────

class _FlowEditorPane extends StatelessWidget {
  const _FlowEditorPane({
    required this.editorKey,
    required this.nameController,
    required this.enabled,
    required this.nodes,
    required this.edges,
    required this.dirty,
    required this.saving,
    required this.compact,
    required this.onBack,
    required this.onOpenSettings,
    required this.onEnabled,
    required this.onNodesChanged,
    required this.onEdgesChanged,
    required this.onSave,
    required this.onDelete,
    this.onOpenPaletteSheet,
  });

  final GlobalKey<FlowVisualEditorState> editorKey;
  final TextEditingController nameController;
  final bool enabled;
  final List<Map<String, dynamic>> nodes;
  final List<Map<String, dynamic>> edges;
  final bool dirty;
  final bool saving;
  final bool compact;
  final VoidCallback onBack;
  final Future<void> Function() onOpenSettings;
  final ValueChanged<bool> onEnabled;
  final ValueChanged<List<Map<String, dynamic>>> onNodesChanged;
  final ValueChanged<List<Map<String, dynamic>>> onEdgesChanged;
  final Future<void> Function() onSave;
  final Future<void> Function() onDelete;
  final VoidCallback? onOpenPaletteSheet;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final flowName = nameController.text.trim().isEmpty
        ? 'Fluxo'
        : nameController.text.trim();
    final statusText = dirty
        ? 'Não salvo · ${nodes.length} nós'
        : '${nodes.length} nós · ${edges.length} ligações';
    final statusColor = dirty ? const Color(0xFFE0A63A) : wa.textMuted;

    final canvasChip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: wa.accentSoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.hub_rounded, size: 15, color: wa.accent),
          const SizedBox(width: 5),
          Text(
            'Canvas',
            style: TextStyle(
              color: wa.accent,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );

    final moreButton = PopupMenuButton<String>(
      tooltip: 'Mais',
      color: wa.menuBg,
      onSelected: (v) {
        if (v == 'delete') unawaited(onDelete());
        if (v == 'palette' && onOpenPaletteSheet != null) {
          onOpenPaletteSheet!();
        }
      },
      itemBuilder: (context) => [
        if (compact && onOpenPaletteSheet != null)
          const PopupMenuItem(value: 'palette', child: Text('Adicionar nó')),
        const PopupMenuItem(
          value: 'delete',
          child: Text(
            'Excluir fluxo',
            style: TextStyle(color: Color(0xFFB42318)),
          ),
        ),
      ],
    );

    final saveButton = FilledButton.icon(
      onPressed: saving || !dirty ? null : () => unawaited(onSave()),
      icon: saving
          ? const SizedBox(
              width: 15,
              height: 15,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.save_rounded, size: 18),
      label: Text(saving ? '…' : 'Salvar'),
    );

    return Column(
      children: [
        Material(
          color: wa.panel,
          elevation: 1,
          child: SafeArea(
            bottom: false,
            child: compact
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(4, 4, 8, 6),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            IconButton(
                              tooltip: 'Voltar à biblioteca',
                              onPressed: onBack,
                              icon: const Icon(Icons.arrow_back_rounded),
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    flowName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      color: wa.textPrimary,
                                      fontSize: 15.5,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  Text(
                                    statusText,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      color: statusColor,
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            saveButton,
                          ],
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            canvasChip,
                            const Spacer(),
                            if (onOpenPaletteSheet != null)
                              IconButton(
                                tooltip: 'Adicionar nó',
                                onPressed: onOpenPaletteSheet,
                                icon: Icon(
                                  Icons.add_box_outlined,
                                  color: wa.accent,
                                ),
                              ),
                            Switch.adaptive(
                              value: enabled,
                              activeTrackColor: wa.accent,
                              onChanged: onEnabled,
                            ),
                            moreButton,
                          ],
                        ),
                      ],
                    ),
                  )
                : Padding(
                    padding: const EdgeInsets.fromLTRB(6, 6, 10, 6),
                    child: Row(
                      children: [
                        canvasChip,
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                flowName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: wa.textPrimary,
                                  fontSize: 15.5,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                statusText,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: statusColor,
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Switch.adaptive(
                          value: enabled,
                          activeTrackColor: wa.accent,
                          onChanged: onEnabled,
                        ),
                        moreButton,
                        const SizedBox(width: 4),
                        saveButton,
                      ],
                    ),
                  ),
          ),
        ),
        Divider(height: 1, color: wa.border),
        Expanded(
          child: FlowVisualEditor(
            key: editorKey,
            nodes: nodes,
            edges: edges,
            showEmbeddedPalette: false,
            autoFitOnOpen: compact,
            onChanged: (nextNodes, nextEdges) {
              onNodesChanged(nextNodes);
              onEdgesChanged(nextEdges);
            },
          ),
        ),
      ],
    );
  }
}

// ─── Modals ──────────────────────────────────────────────────────────

class _NameDialog extends StatefulWidget {
  const _NameDialog({
    required this.title,
    required this.label,
    required this.initial,
    required this.confirmLabel,
  });

  final String title;
  final String label;
  final String initial;
  final String confirmLabel;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initial);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        controller: _controller,
        autofocus: true,
        decoration: InputDecoration(labelText: widget.label),
        onSubmitted: (_) => Navigator.pop(context, _controller.text.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, _controller.text.trim()),
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}

class _NewFlowDraft {
  const _NewFlowDraft({
    required this.name,
    required this.command,
    required this.scope,
    required this.text,
    this.folderId,
  });

  final String name;
  final String command;
  final String scope;
  final String text;
  final String? folderId;
}

class _NewFlowDialog extends StatefulWidget {
  const _NewFlowDialog({this.folders = const [], this.initialFolderId});

  final List<FlowFolder> folders;
  final String? initialFolderId;

  @override
  State<_NewFlowDialog> createState() => _NewFlowDialogState();
}

class _NewFlowDialogState extends State<_NewFlowDialog> {
  final _name = TextEditingController(text: 'Novo fluxo');
  final _command = TextEditingController(text: '!menu');
  final _text = TextEditingController(text: 'Olá! Como posso ajudar?');
  String _scope = 'both';
  String? _folderId;

  @override
  void initState() {
    super.initState();
    _folderId = widget.initialFolderId;
  }

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
      title: const Text('Novo fluxo'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _name,
                autofocus: true,
                decoration: const InputDecoration(labelText: 'Nome'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _command,
                decoration: const InputDecoration(
                  labelText: 'Comando (ex: !menu)',
                ),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _scope,
                decoration: const InputDecoration(labelText: 'Escopo'),
                items: const [
                  DropdownMenuItem(
                    value: 'both',
                    child: Text('Grupos e privado'),
                  ),
                  DropdownMenuItem(value: 'group', child: Text('Grupos')),
                  DropdownMenuItem(value: 'private', child: Text('Privado')),
                ],
                onChanged: (v) {
                  if (v != null) setState(() => _scope = v);
                },
              ),
              if (widget.folders.isNotEmpty) ...[
                const SizedBox(height: 10),
                DropdownButtonFormField<String?>(
                  initialValue: _folderId,
                  decoration: const InputDecoration(labelText: 'Pasta'),
                  items: [
                    const DropdownMenuItem<String?>(
                      value: null,
                      child: Text('Sem pasta (raiz)'),
                    ),
                    for (final f in widget.folders)
                      DropdownMenuItem<String?>(
                        value: f.id,
                        child: Text(f.name),
                      ),
                  ],
                  onChanged: (v) => setState(() => _folderId = v),
                ),
              ],
              const SizedBox(height: 10),
              TextField(
                controller: _text,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Primeira mensagem',
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
            final command = _command.text.trim();
            if (name.isEmpty || command.isEmpty) return;
            Navigator.pop(
              context,
              _NewFlowDraft(
                name: name,
                command: command,
                scope: _scope,
                text: _text.text.trim().isEmpty
                    ? 'Olá! Como posso ajudar?'
                    : _text.text.trim(),
                folderId: _folderId,
              ),
            );
          },
          child: const Text('Criar e abrir editor'),
        ),
      ],
    );
  }
}

class _FlowSettingsResult {
  const _FlowSettingsResult({
    required this.name,
    required this.command,
    required this.description,
    required this.scope,
    required this.triggerType,
    required this.matchMode,
    required this.enabled,
  });

  final String name;
  final String command;
  final String description;
  final String scope;
  final String triggerType;
  final String matchMode;
  final bool enabled;
}

class _FlowSettingsSheet extends StatefulWidget {
  const _FlowSettingsSheet({
    required this.name,
    required this.command,
    required this.description,
    required this.scope,
    required this.triggerType,
    required this.matchMode,
    required this.enabled,
  });

  final String name;
  final String command;
  final String description;
  final String scope;
  final String triggerType;
  final String matchMode;
  final bool enabled;

  @override
  State<_FlowSettingsSheet> createState() => _FlowSettingsSheetState();
}

class _FlowSettingsSheetState extends State<_FlowSettingsSheet> {
  late final TextEditingController _name;
  late final TextEditingController _command;
  late final TextEditingController _description;
  late String _scope;
  late String _triggerType;
  late String _matchMode;
  late bool _enabled;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.name);
    _command = TextEditingController(text: widget.command);
    _description = TextEditingController(text: widget.description);
    _scope = widget.scope;
    _triggerType = widget.triggerType;
    _matchMode = widget.matchMode;
    _enabled = widget.enabled;
  }

  @override
  void dispose() {
    _name.dispose();
    _command.dispose();
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Configurações do fluxo',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: WaTheme.of(context).textPrimary,
                fontWeight: FontWeight.w800,
                fontSize: 17,
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Nome'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _command,
              decoration: const InputDecoration(labelText: 'Comando / gatilho'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _description,
              minLines: 2,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Descrição'),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _safe(_triggerType, const [
                'command',
                'keyword',
                'message',
                'media',
              ], 'command'),
              decoration: const InputDecoration(labelText: 'Tipo de gatilho'),
              items: const [
                DropdownMenuItem(value: 'command', child: Text('Comando')),
                DropdownMenuItem(value: 'keyword', child: Text('Keyword')),
                DropdownMenuItem(value: 'message', child: Text('Mensagem')),
                DropdownMenuItem(value: 'media', child: Text('Mídia')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _triggerType = v);
              },
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _safe(_matchMode, const [
                'exact',
                'contains',
                'starts_with',
              ], 'exact'),
              decoration: const InputDecoration(labelText: 'Match'),
              items: const [
                DropdownMenuItem(value: 'exact', child: Text('Exato')),
                DropdownMenuItem(value: 'contains', child: Text('Contém')),
                DropdownMenuItem(
                  value: 'starts_with',
                  child: Text('Começa com'),
                ),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _matchMode = v);
              },
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _safe(_scope, const [
                'both',
                'group',
                'private',
              ], 'both'),
              decoration: const InputDecoration(labelText: 'Escopo'),
              items: const [
                DropdownMenuItem(
                  value: 'both',
                  child: Text('Grupos e privado'),
                ),
                DropdownMenuItem(value: 'group', child: Text('Grupos')),
                DropdownMenuItem(value: 'private', child: Text('Privado')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _scope = v);
              },
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Fluxo ativo'),
              value: _enabled,
              onChanged: (v) => setState(() => _enabled = v),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () {
                Navigator.pop(
                  context,
                  _FlowSettingsResult(
                    name: _name.text.trim(),
                    command: _command.text.trim(),
                    description: _description.text.trim(),
                    scope: _scope,
                    triggerType: _triggerType,
                    matchMode: _matchMode,
                    enabled: _enabled,
                  ),
                );
              },
              child: const Text('Aplicar'),
            ),
          ],
        ),
      ),
    );
  }

  String _safe(String value, List<String> allowed, String fallback) {
    return allowed.contains(value) ? value : fallback;
  }
}
