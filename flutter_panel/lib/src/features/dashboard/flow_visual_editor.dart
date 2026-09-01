import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart' show ValueListenable, kIsWeb;
import 'package:flutter/gestures.dart' show kPrimaryButton;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import '../../core/api_client.dart';
import '../../core/session_store.dart';
import '../../core/wa_theme.dart';

// ═══════════════════════════════════════════════════════════════════════
// Editor visual estilo Typebot:
//   • Grupos (stacks) com blocos empilhados dentro
//   • Arrastar grupos no canvas
//   • Arrastar blocos entre grupos / reordenar
//   • Arrastar da paleta para dentro de um grupo ou canvas vazio
//   • Conectar grupos pelos portos (in/out)
// Backend já entende stackId + stackOrder (ver message-handler).
// ═══════════════════════════════════════════════════════════════════════

class FlowVisualEditor extends StatefulWidget {
  const FlowVisualEditor({
    super.key,
    required this.nodes,
    required this.edges,
    required this.onChanged,
    this.readOnly = false,
    this.showEmbeddedPalette = true,
    this.showInspector = true,
    this.autoFitOnOpen = false,
    this.onSelectionChanged,
  });

  final List<Map<String, dynamic>> nodes;
  final List<Map<String, dynamic>> edges;
  final void Function(
    List<Map<String, dynamic>> nodes,
    List<Map<String, dynamic>> edges,
  )
  onChanged;
  final bool readOnly;
  final bool showEmbeddedPalette;
  final bool showInspector;
  final bool autoFitOnOpen;
  final ValueChanged<String?>? onSelectionChanged;

  @override
  State<FlowVisualEditor> createState() => FlowVisualEditorState();
}

class FlowVisualEditorState extends State<FlowVisualEditor>
    with SingleTickerProviderStateMixin {
  static const _groupVisualW = 430.0;
  static const _branchLaneW = 70.0;
  static const _groupW = _groupVisualW + _branchLaneW;
  static const _blockH = 72.0;
  static const _headerH = 44.0;
  static const _footerH = 0.0;
  static const _canvasSize = 9000.0;
  static const _canvasBoundaryMargin = 6000.0;
  static const _sceneMin = -_canvasBoundaryMargin;
  static const _sceneMax = _canvasSize + _canvasBoundaryMargin;
  static const _blockPad = 8.0;
  static const _snapRadius = 132.0;
  static const _btnRowH = 40.0;
  static const _waCardPadY = 4.0;
  static const _waMediaH = 112.0;
  static const _waBodyNoMediaH = 108.0;
  static const _waBodyWithMediaH = 160.0;
  static const _waListOpenRowH = 44.0;
  static const _waListPanelHeaderH = 54.0;
  static const _waListOptionH = 52.0;
  static const _waOuterButtonGap = 8.0;
  static const _branchPortXFromGroupRight = 34.0;

  final _transform = TransformationController();
  final _canvasKey = GlobalKey();

  /// Viewport do InteractiveViewer (coordenadas de drop/clique corretas).
  final _viewerKey = GlobalKey();

  late final AnimationController _pulse;

  /// Rebuild leve só do canvas durante drag (sem setState no painel inteiro).
  final _canvasTick = ValueNotifier<int>(0);
  bool _canvasTickQueued = false;
  final _groupDragDelta = ValueNotifier<Offset>(Offset.zero);
  Offset _pendingGroupDragDelta = Offset.zero;
  bool _groupDragDeltaQueued = false;
  final _edgeDragTick = ValueNotifier<int>(0);

  String? _selectedNodeId;
  String? _selectedGroupId;
  String? _selectedEdgeId;
  String? _connectingFromNodeId;

  /// Ex: `button:btn-id` ou `menu:opt-id` ou `default`.
  String _connectingBranch = 'default';
  Offset? _connectCursor;
  String? _snapTargetGroupId;
  bool _inspectorOpen = true;
  bool _paletteOpen = true;

  /// Arrasto de grupo inteiro — offset local (não emite a cada frame).
  String? _draggingGroupId;
  Offset _liveGroupDelta = Offset.zero;
  Offset? _groupDragStartScene;
  bool _branchPointerActive = false;

  /// Arrasto de bloco (reorder / mover entre grupos).
  String? _draggingBlockId;
  int? _dropInsertIndex;
  String? _dropTargetGroupId;

  bool _browserMenuDisabled = false;

  void _tickCanvas() {
    if (_canvasTickQueued) return;
    _canvasTickQueued = true;
    SchedulerBinding.instance.scheduleFrameCallback((_) {
      _canvasTickQueued = false;
      if (!mounted) return;
      _canvasTick.value++;
    });
  }

  void _setGroupDragDelta(Offset delta) {
    _liveGroupDelta = delta;
    _pendingGroupDragDelta = delta;
    if (_groupDragDeltaQueued) return;
    _groupDragDeltaQueued = true;
    SchedulerBinding.instance.scheduleFrameCallback((_) {
      _groupDragDeltaQueued = false;
      if (!mounted) return;
      _groupDragDelta.value = _pendingGroupDragDelta;
    });
  }

  void _resetGroupDragDelta() {
    _liveGroupDelta = Offset.zero;
    _pendingGroupDragDelta = Offset.zero;
    _groupDragDelta.value = Offset.zero;
  }

  void _clearTransientDragState() {
    _draggingGroupId = null;
    _groupDragStartScene = null;
    _draggingBlockId = null;
    _dropTargetGroupId = null;
    _dropInsertIndex = null;
    _branchPointerActive = false;
    _resetGroupDragDelta();
    _edgeDragTick.value++;
  }

  double get _effectiveGroupW {
    final viewport = MediaQuery.maybeSizeOf(context)?.width ?? _groupW;
    if (viewport >= 700) return _groupW;
    return math.max(340.0, math.min(_groupW, viewport - 28));
  }

  double _clampSceneX(double value, {double width = 0}) =>
      value.clamp(_sceneMin, _sceneMax - width).toDouble();

  double _clampSceneY(double value, {double height = 0}) =>
      value.clamp(_sceneMin, _sceneMax - height).toDouble();

  /// true se o foco está em um campo de texto (não apagar blocos com Backspace).
  bool get _isTypingInTextField {
    final focus = FocusManager.instance.primaryFocus;
    final ctx = focus?.context;
    if (ctx == null) return false;
    final widget = focus!.context?.widget;
    if (widget is EditableText ||
        widget is TextField ||
        widget is TextFormField) {
      return true;
    }
    return ctx.findAncestorStateOfType<EditableTextState>() != null;
  }

  // ── API pública (paleta lateral) ───────────────────────────────────

  void addPaletteItem(FlowPaletteItem item, {Offset? at}) {
    // Clique na paleta com grupo selecionado → empilha dentro dele.
    if (at == null && _selectedGroupId != null) {
      final groups = _buildGroups();
      for (final g in groups) {
        if (g.id == _selectedGroupId) {
          _addBlock(item, intoGroupId: g.id, insertIndex: g.blocks.length);
          return;
        }
      }
    }
    _addBlock(item, at: at);
  }

  void addPaletteItemAtGlobal(FlowPaletteItem item, Offset global) {
    // O offset do Draggable é o canto do feedback — testa vários pontos.
    final candidates = <Offset>[
      global + const Offset(100, 28), // centro do chip de feedback
      global + const Offset(40, 20),
      global,
      global + const Offset(140, 40),
    ];

    for (final point in candidates) {
      final scene = _globalToScene(point);
      if (scene == null) continue;
      final hit = _hitGroup(scene);
      if (hit != null) {
        final pos = _groupVisualPos(hit);
        final localY = scene.dy - pos.dy - _headerH;
        final index = (localY / (_blockH + 4)).floor().clamp(
          0,
          hit.blocks.length,
        );
        _addBlock(
          item,
          intoGroupId: hit.id,
          insertIndex: index,
          openInspector: false,
        );
        return;
      }
    }

    // Canvas vazio → novo grupo na posição do drop.
    for (final point in candidates) {
      final scene = _globalToScene(point);
      if (scene != null) {
        _addBlock(item, at: scene, openInspector: false);
        return;
      }
    }
    _addBlock(item, openInspector: false);
  }

  void clearSelection() {
    setState(() {
      _selectedNodeId = null;
      _selectedGroupId = null;
      _selectedEdgeId = null;
      _inspectorOpen = false;
      _connectingFromNodeId = null;
      _connectCursor = null;
      _snapTargetGroupId = null;
      _branchPointerActive = false;
    });
    _stopConnectPulse();
    widget.onSelectionChanged?.call(null);
  }

  // ── Getters ────────────────────────────────────────────────────────

  List<Map<String, dynamic>> get _nodes => widget.nodes;
  List<Map<String, dynamic>> get _edges => widget.edges;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    );
    _disableBrowserContextMenu();
    if (widget.autoFitOnOpen) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _nodes.isNotEmpty) _fitInitialView();
      });
    }
  }

  Future<void> _disableBrowserContextMenu() async {
    if (!kIsWeb) return;
    try {
      await BrowserContextMenu.disableContextMenu();
      _browserMenuDisabled = true;
    } catch (_) {}
  }

  Future<void> _restoreBrowserContextMenu() async {
    if (!kIsWeb || !_browserMenuDisabled) return;
    try {
      await BrowserContextMenu.enableContextMenu();
    } catch (_) {}
  }

  @override
  void dispose() {
    _pulse.dispose();
    _canvasTick.dispose();
    _groupDragDelta.dispose();
    _edgeDragTick.dispose();
    _transform.dispose();
    _restoreBrowserContextMenu();
    super.dispose();
  }

  Map<String, dynamic>? get _selectedNode {
    if (_selectedNodeId == null) return null;
    for (final n in _nodes) {
      if (n['id']?.toString() == _selectedNodeId) return n;
    }
    return null;
  }

  // ── Grupos (Typebot-style) ─────────────────────────────────────────

  List<_CanvasGroup> _buildGroups() {
    final byStack = <String, List<Map<String, dynamic>>>{};
    final order = <String>[];

    for (final n in _nodes) {
      final id = n['id']?.toString() ?? '';
      if (id.isEmpty) continue;
      final stackRaw = (n['stackId'] ?? '').toString().trim();
      final stackId = stackRaw.isNotEmpty ? stackRaw : 'solo:$id';
      if (!byStack.containsKey(stackId)) {
        byStack[stackId] = [];
        order.add(stackId);
      }
      byStack[stackId]!.add(Map<String, dynamic>.from(n));
    }

    for (final list in byStack.values) {
      list.sort((a, b) {
        final ao = (a['stackOrder'] is num)
            ? (a['stackOrder'] as num).toInt()
            : 0;
        final bo = (b['stackOrder'] is num)
            ? (b['stackOrder'] as num).toInt()
            : 0;
        return ao.compareTo(bo);
      });
    }

    return [
      for (final stackId in order)
        _CanvasGroup(
          id: stackId,
          blocks: byStack[stackId]!,
          width: _effectiveGroupW,
          headerH: _headerH,
          blockH: _blockH,
          footerH: _footerH,
          blockPad: _blockPad,
        ),
    ];
  }

  /// Altura visual de cada bloco (botões/menu expandem como balão WA).
  static double blockHeightFor(Map<String, dynamic> node) {
    final kind = (node['kind'] ?? '').toString();
    if (kind == 'buttons') {
      final buttons = _asMapList(node['buttons']);
      final n = buttons.isEmpty ? 1 : buttons.length.clamp(1, 3);
      return _buttonPreviewRowsTop(node) +
          (n * (_btnRowH + _waOuterButtonGap)) +
          _waCardPadY;
    }
    if (kind == 'menu') {
      final opts = _asMapList(node['menuOptions']);
      final n = opts.isEmpty ? 1 : opts.length.clamp(1, 4);
      return _menuPreviewRowsTop(node) + (n * _waListOptionH) + _waCardPadY;
    }
    return _blockH;
  }

  static double _buttonPreviewMessageHeight(Map<String, dynamic> node) {
    final hasMedia = _flowPreviewMediaUrl(node).isNotEmpty;
    return (hasMedia ? _waMediaH : 0) +
        (hasMedia ? _waBodyWithMediaH : _waBodyNoMediaH);
  }

  static double _buttonPreviewRowsTop(Map<String, dynamic> node) {
    return _waCardPadY + _buttonPreviewMessageHeight(node) + _waOuterButtonGap;
  }

  static double _menuPreviewRowsTop(Map<String, dynamic> node) {
    return _waCardPadY +
        _buttonPreviewMessageHeight(node) +
        _waOuterButtonGap +
        _waListOpenRowH +
        _waOuterButtonGap +
        _waListPanelHeaderH;
  }

  Offset? _globalToScene(Offset global) {
    final box =
        (_viewerKey.currentContext ?? _canvasKey.currentContext)
                ?.findRenderObject()
            as RenderBox?;
    if (box == null || !box.hasSize) return null;
    final local = box.globalToLocal(global);
    // Aceita margem generosa (drop vindo da paleta lateral).
    if (local.dx < -120 ||
        local.dy < -80 ||
        local.dx > box.size.width + 80 ||
        local.dy > box.size.height + 80) {
      return null;
    }
    return _transform.toScene(local);
  }

  /// Scene (canvas) → coordenadas do viewport do InteractiveViewer.
  Offset? _sceneToViewport(Offset scene) {
    return MatrixUtils.transformPoint(_transform.value, scene);
  }

  _CanvasGroup? _hitGroup(Offset scene) {
    // Prioriza o grupo mais no topo (último na lista / maior y overlap).
    _CanvasGroup? found;
    for (final g in _buildGroups()) {
      final pos = _groupVisualPos(g);
      if (scene.dx >= pos.dx - 8 &&
          scene.dx <= pos.dx + g.width + 8 &&
          scene.dy >= pos.dy - 8 &&
          scene.dy <= pos.dy + g.height + 8) {
        found = g;
      }
    }
    return found;
  }

  // ── Mutações ───────────────────────────────────────────────────────

  void _emit(
    List<Map<String, dynamic>> nodes,
    List<Map<String, dynamic>> edges,
  ) {
    widget.onChanged(nodes, edges);
  }

  List<Map<String, dynamic>> _cloneNodes() =>
      _nodes.map((n) => Map<String, dynamic>.from(n)).toList();

  List<Map<String, dynamic>> _cloneEdges() =>
      _edges.map((e) => Map<String, dynamic>.from(e)).toList();

  void _selectNode(String? id, {String? groupId}) {
    setState(() {
      _selectedNodeId = id;
      _selectedGroupId = groupId;
      _selectedEdgeId = null;
      _inspectorOpen = id != null;
    });
    widget.onSelectionChanged?.call(id);
  }

  Offset _groupVisualPos(_CanvasGroup g) {
    if (_draggingGroupId == g.id) {
      return Offset(g.x + _liveGroupDelta.dx, g.y + _liveGroupDelta.dy);
    }
    return Offset(g.x, g.y);
  }

  void _updateNode(String id, Map<String, dynamic> patch) {
    final next = _cloneNodes();
    for (var i = 0; i < next.length; i++) {
      if (next[i]['id']?.toString() == id) {
        next[i] = {...next[i], ...patch};
        break;
      }
    }
    _emit(next, _cloneEdges());
  }

  void _beginGroupDrag(String groupId, Offset globalPosition) {
    if (_branchPointerActive || _connectingFromNodeId != null) return;
    final scene = _globalToScene(globalPosition);
    if (scene == null) return;
    setState(() {
      _draggingGroupId = groupId;
      _groupDragStartScene = scene;
      _resetGroupDragDelta();
      _edgeDragTick.value++;
    });
  }

  void _updateGroupDrag(String groupId, Offset globalPosition) {
    if (_branchPointerActive || _connectingFromNodeId != null) {
      if (_draggingGroupId == groupId) {
        setState(() {
          _draggingGroupId = null;
          _groupDragStartScene = null;
          _resetGroupDragDelta();
          _edgeDragTick.value++;
        });
      }
      return;
    }
    if (_draggingGroupId != groupId) return;
    final start = _groupDragStartScene;
    final scene = _globalToScene(globalPosition);
    if (start == null || scene == null) return;
    // O delta vem do espaço real do canvas. Isso evita salto quando há zoom/pan.
    _setGroupDragDelta(scene - start);
  }

  void _endGroupDrag(String groupId) {
    if (_branchPointerActive || _connectingFromNodeId != null) {
      if (_draggingGroupId == groupId) {
        setState(() {
          _draggingGroupId = null;
          _groupDragStartScene = null;
          _resetGroupDragDelta();
          _edgeDragTick.value++;
        });
      }
      return;
    }
    if (_draggingGroupId != groupId) return;
    final delta = _liveGroupDelta;
    setState(() {
      _draggingGroupId = null;
      _groupDragStartScene = null;
      _resetGroupDragDelta();
      _edgeDragTick.value++;
    });
    if (delta.distance < 0.5) return;

    final groups = _buildGroups();
    _CanvasGroup? g;
    for (final item in groups) {
      if (item.id == groupId) {
        g = item;
        break;
      }
    }
    if (g == null) return;
    final nx = _clampSceneX(g.x + delta.dx, width: g.width);
    final ny = _clampSceneY(g.y + delta.dy, height: 200);
    final dx = nx - g.x;
    final dy = ny - g.y;
    final ids = g.blocks.map((b) => b['id']?.toString()).toSet();
    final next = _cloneNodes();
    for (var i = 0; i < next.length; i++) {
      final id = next[i]['id']?.toString();
      if (!ids.contains(id)) continue;
      final x = (next[i]['x'] is num) ? (next[i]['x'] as num).toDouble() : g.x;
      final y = (next[i]['y'] is num) ? (next[i]['y'] as num).toDouble() : g.y;
      next[i] = {...next[i], 'x': x + dx, 'y': y + dy};
    }
    _emit(next, _cloneEdges());
  }

  void _normalizeStackOrders(List<Map<String, dynamic>> nodes, String stackId) {
    final indices = <int>[];
    for (var i = 0; i < nodes.length; i++) {
      final sid = (nodes[i]['stackId'] ?? '').toString().trim();
      final id = nodes[i]['id']?.toString() ?? '';
      final effective = sid.isNotEmpty ? sid : 'solo:$id';
      if (effective == stackId || sid == stackId) indices.add(i);
    }
    // Prefer matching by actual stackId field for real stacks.
    final real = <int>[];
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i]['stackId'] ?? '').toString().trim() == stackId) {
        real.add(i);
      }
    }
    final use = real.isNotEmpty ? real : indices;
    use.sort((a, b) {
      final ao = (nodes[a]['stackOrder'] is num)
          ? (nodes[a]['stackOrder'] as num).toInt()
          : a;
      final bo = (nodes[b]['stackOrder'] is num)
          ? (nodes[b]['stackOrder'] as num).toInt()
          : b;
      return ao.compareTo(bo);
    });
    for (var o = 0; o < use.length; o++) {
      final i = use[o];
      nodes[i] = {
        ...nodes[i],
        'stackId': stackId.startsWith('solo:') ? null : stackId,
        'stackOrder': o,
      };
      if (stackId.startsWith('solo:')) {
        nodes[i].remove('stackId');
        nodes[i].remove('stackOrder');
        nodes[i].remove('stackTitle');
      }
    }
  }

  String _ensureRealStackId(String groupId, List<Map<String, dynamic>> nodes) {
    if (!groupId.startsWith('solo:')) return groupId;
    // Promote solo → real stack when second block joins.
    final newId =
        'stack-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
    final nodeId = groupId.substring('solo:'.length);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i]['id']?.toString() == nodeId) {
        nodes[i] = {
          ...nodes[i],
          'stackId': newId,
          'stackOrder': 0,
          'stackTitle': nodes[i]['stackTitle'] ?? 'Grupo',
        };
      }
    }
    return newId;
  }

  void _addBlock(
    FlowPaletteItem item, {
    Offset? at,
    String? intoGroupId,
    int? insertIndex,
    bool openInspector = true,
  }) {
    if (widget.readOnly) return;

    // Flexível: vários gatilhos, empilhar o que quiser — sem forçar webhook.
    final paletteItem = item;

    final id =
        '${paletteItem.kind}-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
    final next = _cloneNodes();
    final edges = _cloneEdges();

    double x;
    double y;
    String? stackId;
    int stackOrder = 0;
    String? stackTitle;

    if (intoGroupId != null) {
      final groups = _buildGroups();
      _CanvasGroup? g;
      for (final itemG in groups) {
        if (itemG.id == intoGroupId) {
          g = itemG;
          break;
        }
      }
      if (g != null) {
        x = g.x;
        y = g.y;
        stackId = _ensureRealStackId(intoGroupId, next);
        // Also ensure existing solo node got stackId when promoted.
        if (intoGroupId.startsWith('solo:')) {
          final soloId = intoGroupId.substring('solo:'.length);
          for (var i = 0; i < next.length; i++) {
            if (next[i]['id']?.toString() == soloId) {
              next[i] = {
                ...next[i],
                'stackId': stackId,
                'stackOrder': 0,
                'stackTitle': 'Grupo',
              };
            }
          }
        }
        stackTitle = g.title;
        final idx = (insertIndex ?? g.blocks.length).clamp(0, g.blocks.length);
        // Shift orders >= idx
        for (var i = 0; i < next.length; i++) {
          if ((next[i]['stackId'] ?? '').toString().trim() != stackId) continue;
          final o = (next[i]['stackOrder'] is num)
              ? (next[i]['stackOrder'] as num).toInt()
              : 0;
          if (o >= idx) {
            next[i] = {...next[i], 'stackOrder': o + 1};
          }
        }
        stackOrder = idx;
      } else {
        x = at?.dx ?? 200;
        y = at?.dy ?? 200;
      }
    } else {
      // Novo grupo no canvas.
      if (at != null) {
        final groupW = _effectiveGroupW;
        x = at.dx - groupW / 2;
        y = at.dy - 40;
      } else {
        final box = context.findRenderObject() as RenderBox?;
        final size = box?.size ?? MediaQuery.sizeOf(context);
        final scene = _transform.toScene(
          Offset(size.width * 0.55, size.height * 0.4),
        );
        final n = _nodes.length;
        x = scene.dx + (n % 4) * 40;
        y = scene.dy + (n % 3) * 30;
      }
      // Auto-connect from selected node/group if possible.
    }

    final node = <String, dynamic>{
      'id': id,
      'kind': paletteItem.kind,
      'title': paletteItem.label,
      'x': _clampSceneX(x, width: _effectiveGroupW),
      'y': _clampSceneY(y, height: 200),
      ...paletteItem.defaults,
    };
    if (stackId != null) {
      node['stackId'] = stackId;
      node['stackOrder'] = stackOrder;
      node['stackTitle'] = stackTitle ?? 'Grupo';
    }
    next.add(node);

    if (stackId != null) {
      _normalizeStackOrders(next, stackId);
    } else if (_selectedNodeId != null) {
      // Liga ao nó selecionado (ou último do grupo dele).
      final fromId = _selectedNodeId!;
      final exists = edges.any(
        (e) => e['from']?.toString() == fromId && e['to']?.toString() == id,
      );
      if (!exists) {
        final fromKind = _nodes.cast<Map<String, dynamic>?>().firstWhere(
          (n) => n?['id']?.toString() == fromId,
          orElse: () => null,
        );
        if (fromKind != null &&
            (fromKind['kind']?.toString() ?? '') != 'jump') {
          edges.add({
            'id': 'edge-$fromId-$id',
            'from': fromId,
            'to': id,
            'branch': 'default',
          });
        }
      }
    }

    setState(() {
      _clearTransientDragState();
      _selectedNodeId = id;
      _selectedGroupId = stackId ?? 'solo:$id';
      _inspectorOpen = openInspector;
    });
    widget.onSelectionChanged?.call(id);
    _emit(next, edges);
  }

  void _moveBlockToGroup(
    String blockId,
    String targetGroupId,
    int insertIndex,
  ) {
    if (widget.readOnly) return;
    final next = _cloneNodes();
    final bi = next.indexWhere((n) => n['id']?.toString() == blockId);
    if (bi < 0) return;

    final oldStack = (next[bi]['stackId'] ?? '').toString().trim();
    final oldGroupId = oldStack.isNotEmpty ? oldStack : 'solo:$blockId';

    // Same group reorder
    var stackId = targetGroupId;
    if (targetGroupId.startsWith('solo:')) {
      stackId = _ensureRealStackId(targetGroupId, next);
      final soloId = targetGroupId.substring('solo:'.length);
      for (var i = 0; i < next.length; i++) {
        if (next[i]['id']?.toString() == soloId) {
          next[i] = {
            ...next[i],
            'stackId': stackId,
            'stackOrder': 0,
            'stackTitle': 'Grupo',
          };
        }
      }
    }

    // Remove from old stack assignment temporarily
    next[bi] = {...next[bi], 'stackId': '__moving__', 'stackOrder': -1};

    // Compact old stack
    if (oldStack.isNotEmpty) {
      _normalizeStackOrders(next, oldStack);
    }

    // Insert into new
    final targets = <int>[];
    for (var i = 0; i < next.length; i++) {
      if ((next[i]['stackId'] ?? '').toString().trim() == stackId &&
          next[i]['id']?.toString() != blockId) {
        targets.add(i);
      }
    }
    targets.sort((a, b) {
      final ao = (next[a]['stackOrder'] is num)
          ? (next[a]['stackOrder'] as num).toInt()
          : 0;
      final bo = (next[b]['stackOrder'] is num)
          ? (next[b]['stackOrder'] as num).toInt()
          : 0;
      return ao.compareTo(bo);
    });

    final idx = insertIndex.clamp(0, targets.length);
    // Find group position
    double gx = 120, gy = 120;
    if (targets.isNotEmpty) {
      gx = (next[targets.first]['x'] is num)
          ? (next[targets.first]['x'] as num).toDouble()
          : 120;
      gy = (next[targets.first]['y'] is num)
          ? (next[targets.first]['y'] as num).toDouble()
          : 120;
    } else if (targetGroupId.startsWith('solo:')) {
      final soloId = targetGroupId.substring('solo:'.length);
      for (final n in next) {
        if (n['id']?.toString() == soloId) {
          gx = (n['x'] is num) ? (n['x'] as num).toDouble() : 120;
          gy = (n['y'] is num) ? (n['y'] as num).toDouble() : 120;
        }
      }
    }

    // Re-assign orders
    final orderedIds = targets
        .map((i) => next[i]['id']?.toString() ?? '')
        .toList();
    orderedIds.insert(idx.clamp(0, orderedIds.length), blockId);

    for (var o = 0; o < orderedIds.length; o++) {
      final id = orderedIds[o];
      final i = next.indexWhere((n) => n['id']?.toString() == id);
      if (i < 0) continue;
      next[i] = {
        ...next[i],
        'stackId': stackId,
        'stackOrder': o,
        'stackTitle': next[i]['stackTitle'] ?? 'Grupo',
        'x': gx,
        'y': gy,
      };
    }

    // If old group was solo and emptied of stack field, clean
    if (oldGroupId != stackId && oldStack.isNotEmpty) {
      final remaining = next
          .where((n) => (n['stackId'] ?? '').toString().trim() == oldStack)
          .toList();
      if (remaining.length <= 1) {
        for (var i = 0; i < next.length; i++) {
          if ((next[i]['stackId'] ?? '').toString().trim() == oldStack) {
            final cleaned = Map<String, dynamic>.from(next[i]);
            cleaned.remove('stackId');
            cleaned.remove('stackOrder');
            cleaned.remove('stackTitle');
            next[i] = cleaned;
          }
        }
      }
    }

    setState(() {
      _clearTransientDragState();
      _selectedNodeId = blockId;
      _selectedGroupId = stackId;
    });
    _emit(next, _cloneEdges());
  }

  void _detachBlockAsNewGroup(String blockId, Offset scenePos) {
    if (widget.readOnly) return;
    final next = _cloneNodes();
    final bi = next.indexWhere((n) => n['id']?.toString() == blockId);
    if (bi < 0) return;

    final oldStack = (next[bi]['stackId'] ?? '').toString().trim();
    final cleaned = Map<String, dynamic>.from(next[bi])
      ..remove('stackId')
      ..remove('stackOrder')
      ..remove('stackTitle');
    cleaned['x'] = _clampSceneX(scenePos.dx, width: _effectiveGroupW);
    cleaned['y'] = _clampSceneY(scenePos.dy, height: 200);
    next[bi] = cleaned;

    if (oldStack.isNotEmpty) {
      final remaining = next
          .where((n) => (n['stackId'] ?? '').toString().trim() == oldStack)
          .toList();
      if (remaining.length <= 1) {
        for (var i = 0; i < next.length; i++) {
          if ((next[i]['stackId'] ?? '').toString().trim() == oldStack) {
            final c = Map<String, dynamic>.from(next[i]);
            c.remove('stackId');
            c.remove('stackOrder');
            c.remove('stackTitle');
            next[i] = c;
          }
        }
      } else {
        _normalizeStackOrders(next, oldStack);
      }
    }

    setState(() {
      _clearTransientDragState();
      _selectedNodeId = blockId;
      _selectedGroupId = 'solo:$blockId';
    });
    _emit(next, _cloneEdges());
  }

  void _dropBlockAtGlobal({required String blockId, required Offset global}) {
    if (widget.readOnly) return;
    void clearDragOnly() {
      setState(() {
        _draggingBlockId = null;
        _dropTargetGroupId = null;
        _dropInsertIndex = null;
      });
      _tickCanvas();
    }

    if (blockId.trim().isEmpty) {
      clearDragOnly();
      return;
    }

    final candidates = <Offset>[
      global + const Offset(120, 34),
      global + const Offset(60, 24),
      global,
      global + const Offset(180, 48),
    ];

    for (final point in candidates) {
      final scene = _globalToScene(point);
      if (scene == null) continue;
      final hit = _hitGroup(scene);
      if (hit != null) {
        final pos = _groupVisualPos(hit);
        final localY = scene.dy - pos.dy - _headerH;
        final index = (localY / (_blockH + 4)).floor().clamp(
          0,
          hit.blocks.length,
        );
        _moveBlockToGroup(blockId, hit.id, index);
        return;
      }
      _detachBlockAsNewGroup(blockId, scene);
      return;
    }

    clearDragOnly();
  }

  void _deleteSelected() {
    // Nunca apaga bloco enquanto digita em input/textarea.
    if (_isTypingInTextField) return;
    // Se uma linha está selecionada, Backspace/Delete remove a linha.
    if (_selectedEdgeId != null) {
      _removeEdge(_selectedEdgeId!);
      return;
    }
    final id = _selectedNodeId;
    if (id == null || widget.readOnly) return;
    _deleteNodeById(id);
  }

  void _deleteNodeById(String id) {
    if (widget.readOnly) return;
    Map<String, dynamic>? node;
    for (final n in _nodes) {
      if (n['id']?.toString() == id) {
        node = n;
        break;
      }
    }
    if (node == null) return;

    final next = _cloneNodes()
        .where((n) => n['id']?.toString() != id)
        .map((n) => Map<String, dynamic>.from(n))
        .toList();
    final edges = _cloneEdges()
        .where((e) => e['from']?.toString() != id && e['to']?.toString() != id)
        .toList();

    final oldStack = (node['stackId'] ?? '').toString().trim();
    if (oldStack.isNotEmpty) {
      final remaining = next
          .where((n) => (n['stackId'] ?? '').toString().trim() == oldStack)
          .toList();
      if (remaining.length <= 1) {
        for (var i = 0; i < next.length; i++) {
          if ((next[i]['stackId'] ?? '').toString().trim() == oldStack) {
            final c = Map<String, dynamic>.from(next[i]);
            c.remove('stackId');
            c.remove('stackOrder');
            c.remove('stackTitle');
            next[i] = c;
          }
        }
      } else {
        _normalizeStackOrders(next, oldStack);
      }
    }

    setState(() {
      if (_selectedNodeId == id) {
        _selectedNodeId = null;
        _selectedGroupId = null;
        _inspectorOpen = false;
      }
      _connectingFromNodeId = null;
      _connectCursor = null;
      _snapTargetGroupId = null;
      _branchPointerActive = false;
    });
    _stopConnectPulse();
    widget.onSelectionChanged?.call(null);
    _emit(next, edges);
  }

  void _duplicateNode(String id) {
    if (widget.readOnly) return;
    Map<String, dynamic>? src;
    for (final n in _nodes) {
      if (n['id']?.toString() == id) {
        src = n;
        break;
      }
    }
    if (src == null) return;
    final copy = Map<String, dynamic>.from(src);
    final newId =
        '${copy['kind']}-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
    copy['id'] = newId;
    copy['x'] = ((copy['x'] is num) ? (copy['x'] as num).toDouble() : 120) + 36;
    copy['y'] = ((copy['y'] is num) ? (copy['y'] as num).toDouble() : 120) + 36;
    // Duplicata sai do stack original (grupo próprio).
    copy.remove('stackId');
    copy.remove('stackOrder');
    copy.remove('stackTitle');
    final next = _cloneNodes()..add(copy);
    setState(() {
      _selectedNodeId = newId;
      _selectedGroupId = 'solo:$newId';
      _inspectorOpen = true;
    });
    _emit(next, _cloneEdges());
  }

  void _renameGroup(String groupId, String title) {
    final next = _cloneNodes();
    final stackId = groupId.startsWith('solo:') ? null : groupId;
    if (stackId == null) {
      // Promote to named stack even with one block.
      final nodeId = groupId.substring('solo:'.length);
      final newId =
          'stack-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
      for (var i = 0; i < next.length; i++) {
        if (next[i]['id']?.toString() == nodeId) {
          next[i] = {
            ...next[i],
            'stackId': newId,
            'stackOrder': 0,
            'stackTitle': title,
          };
        }
      }
      _emit(next, _cloneEdges());
      return;
    }
    for (var i = 0; i < next.length; i++) {
      if ((next[i]['stackId'] ?? '').toString().trim() == stackId) {
        next[i] = {...next[i], 'stackTitle': title};
      }
    }
    _emit(next, _cloneEdges());
  }

  void _connect(String fromId, String toId, {String? branch}) {
    if (fromId == toId || widget.readOnly) return;
    final br = (branch ?? _connectingBranch).trim().isEmpty
        ? 'default'
        : (branch ?? _connectingBranch);
    final next = _cloneEdges();
    final alreadyConnected = next.any(
      (e) =>
          e['from']?.toString() == fromId &&
          e['to']?.toString() == toId &&
          (e['branch']?.toString() ?? 'default') == br,
    );
    if (!alreadyConnected) {
      next.add({
        'id': 'edge-$fromId-$toId-${DateTime.now().microsecondsSinceEpoch}',
        'from': fromId,
        'to': toId,
        'branch': br,
      });
    }
    setState(() {
      _connectingFromNodeId = null;
      _connectingBranch = 'default';
      _connectCursor = null;
      _snapTargetGroupId = null;
      _selectedEdgeId = null;
      _branchPointerActive = false;
    });
    _stopConnectPulse();
    _emit(_cloneNodes(), next);
  }

  void _beginConnectFrom({
    required String nodeId,
    String branch = 'default',
    Offset? cursor,
  }) {
    setState(() {
      _draggingGroupId = null;
      _groupDragStartScene = null;
      _resetGroupDragDelta();
      _edgeDragTick.value++;
      _branchPointerActive = true;
      _connectingFromNodeId = nodeId;
      _connectingBranch = branch;
      _connectCursor = cursor;
      _snapTargetGroupId = null;
    });
    _startConnectPulse();
  }

  void _startConnectPulse() {
    if (!_pulse.isAnimating) {
      _pulse.repeat();
    }
  }

  void _stopConnectPulse() {
    if (_pulse.isAnimating) {
      _pulse.stop();
    }
  }

  void _removeEdge(String edgeId) {
    if (widget.readOnly) return;
    _emit(
      _cloneNodes(),
      _cloneEdges().where((e) => e['id']?.toString() != edgeId).toList(),
    );
  }

  void _fitInitialView() {
    final box = _viewerKey.currentContext?.findRenderObject() as RenderBox?;
    final size = box?.size ?? MediaQuery.sizeOf(context);
    if (size.width < 700) {
      _focusCompactStart(size);
    } else {
      _fitView();
    }
  }

  void _focusCompactStart(Size size) {
    final groups = _buildGroups();
    if (groups.isEmpty) return;
    final group = groups.firstWhere(
      (g) => g.blocks.any((b) => (b['kind'] ?? '').toString() != 'trigger'),
      orElse: () => groups.first,
    );
    final pos = _groupVisualPos(group);
    final veryCompact = size.width < 480;
    final scale = (size.width / (group.width + (veryCompact ? 150 : 28)))
        .clamp(veryCompact ? 0.50 : 0.72, veryCompact ? 0.68 : 0.92)
        .toDouble();
    final center = Offset(pos.dx + group.width / 2, pos.dy + group.height / 2);
    final dx = size.width / 2 - center.dx * scale;
    final dy = size.height * (veryCompact ? 0.36 : 0.45) - center.dy * scale;
    _transform.value = Matrix4.identity()
      ..translateByDouble(dx, dy, 0, 1)
      ..scaleByDouble(scale, scale, 1, 1);
    _tickCanvas();
  }

  void _fitView() {
    final groups = _buildGroups();
    if (groups.isEmpty) return;
    double minX = double.infinity, minY = double.infinity;
    double maxX = -double.infinity, maxY = -double.infinity;
    for (final g in groups) {
      minX = math.min(minX, g.x);
      minY = math.min(minY, g.y);
      maxX = math.max(maxX, g.x + g.width);
      maxY = math.max(maxY, g.y + g.height);
    }
    final box = _viewerKey.currentContext?.findRenderObject() as RenderBox?;
    final size = box?.size ?? MediaQuery.sizeOf(context);
    final contentW = maxX - minX + 200;
    final contentH = maxY - minY + 200;
    final scale = (math.min(
      size.width / contentW,
      size.height / contentH,
    )).clamp(0.3, 1.15);
    final dx = size.width / 2 - (minX + contentW / 2) * scale;
    final dy = size.height / 2 - (minY + contentH / 2) * scale;
    _transform.value = Matrix4.identity()
      ..translateByDouble(dx, dy, 0, 1)
      ..scaleByDouble(scale, scale, 1, 1);
    setState(() {});
  }

  // ── Ports geometry for edges ───────────────────────────────────────

  Offset _outPortOfNode(
    String nodeId,
    List<_CanvasGroup> groups, {
    String branch = 'default',
  }) {
    for (final g in groups) {
      for (var i = 0; i < g.blocks.length; i++) {
        final block = g.blocks[i];
        if (block['id']?.toString() != nodeId) continue;
        final pos = _groupVisualPos(g);
        final top = pos.dy + g.blockTop(i);
        final h = blockHeightFor(block);
        final kind = (block['kind'] ?? '').toString();

        // Porto por botão/item (linhas saem do pontinho de cada opção).
        if (branch.startsWith('button:') && kind == 'buttons') {
          final btnId = branch.substring('button:'.length);
          final buttons = _asMapList(block['buttons']);
          final bi = buttons.indexWhere((b) => b['id']?.toString() == btnId);
          if (bi >= 0) {
            final y =
                top +
                _buttonPreviewRowsTop(block) +
                bi * (_btnRowH + _waOuterButtonGap) +
                _btnRowH / 2;
            return Offset(
              pos.dx +
                  g.visualWidth +
                  _branchLaneW -
                  _branchPortXFromGroupRight,
              y,
            );
          }
        }
        if (branch.startsWith('menu:') && kind == 'menu') {
          final optId = branch.substring('menu:'.length);
          final opts = _asMapList(block['menuOptions']);
          final oi = opts.indexWhere((b) => b['id']?.toString() == optId);
          if (oi >= 0) {
            final y =
                top +
                _menuPreviewRowsTop(block) +
                oi * _waListOptionH +
                _waListOptionH / 2;
            return Offset(
              pos.dx +
                  g.visualWidth +
                  _branchLaneW -
                  _branchPortXFromGroupRight,
              y,
            );
          }
        }
        return Offset(pos.dx + g.visualWidth, top + h / 2);
      }
    }
    return const Offset(100, 100);
  }

  Offset _inPortOfNode(String nodeId, List<_CanvasGroup> groups) {
    for (final g in groups) {
      for (var i = 0; i < g.blocks.length; i++) {
        if (g.blocks[i]['id']?.toString() == nodeId) {
          final pos = _groupVisualPos(g);
          final top = pos.dy + g.blockTop(i);
          final h = blockHeightFor(g.blocks[i]);
          return Offset(pos.dx, top + h / 2);
        }
      }
    }
    return const Offset(100, 100);
  }

  Offset _groupOutPort(_CanvasGroup g) {
    final pos = _groupVisualPos(g);
    if (g.blocks.isEmpty) return Offset(pos.dx + g.visualWidth, pos.dy + 40);
    final lastI = g.blocks.length - 1;
    final top = pos.dy + g.blockTop(lastI);
    final h = blockHeightFor(g.blocks[lastI]);
    return Offset(pos.dx + g.visualWidth, top + h / 2);
  }

  Offset _groupInPort(_CanvasGroup g) {
    final pos = _groupVisualPos(g);
    if (g.blocks.isEmpty) return Offset(pos.dx, pos.dy + _headerH + 36);
    final h = blockHeightFor(g.blocks.first);
    return Offset(pos.dx, pos.dy + g.blockTop(0) + h / 2);
  }

  String _groupExitNodeId(_CanvasGroup g) =>
      g.blocks.isEmpty ? '' : g.blocks.last['id']?.toString() ?? '';

  String _groupEntryNodeId(_CanvasGroup g) =>
      g.blocks.isEmpty ? '' : g.blocks.first['id']?.toString() ?? '';

  /// Snap magnético: acha porto de entrada próximo no canvas.
  _CanvasGroup? _nearestInPortGroup(Offset scene, {String? excludeGroupId}) {
    _CanvasGroup? best;
    var bestDist = _snapRadius;
    for (final g in _buildGroups()) {
      if (excludeGroupId != null && g.id == excludeGroupId) continue;
      final port = _groupInPort(g);
      final d = (port - scene).distance;
      if (d <= bestDist) {
        bestDist = d;
        best = g;
      }
    }
    return best;
  }

  void _updateConnectCursor(Offset global, {String? fromGroupId}) {
    final scene = _globalToScene(global);
    if (scene == null) return;
    final snap = _nearestInPortGroup(scene, excludeGroupId: fromGroupId);
    if (snap != null) {
      _connectCursor = _groupInPort(snap);
      _snapTargetGroupId = snap.id;
    } else {
      _connectCursor = scene;
      _snapTargetGroupId = null;
    }
    // Rebuild leve do canvas (sem setState no painel).
    _tickCanvas();
  }

  void _finishConnect(Offset global, {String? fromGroupId}) {
    final scene = _globalToScene(global);
    final fromId = _connectingFromNodeId;
    if (fromId == null) {
      setState(() {
        _connectingFromNodeId = null;
        _connectingBranch = 'default';
        _connectCursor = null;
        _snapTargetGroupId = null;
        _branchPointerActive = false;
      });
      _stopConnectPulse();
      return;
    }

    _CanvasGroup? target;
    if (scene != null) {
      target =
          _nearestInPortGroup(scene, excludeGroupId: fromGroupId) ??
          _hitGroup(scene);
    }
    // Se cursor já estava snappado, usa o snap.
    if (target == null && _snapTargetGroupId != null) {
      for (final g in _buildGroups()) {
        if (g.id == _snapTargetGroupId) {
          target = g;
          break;
        }
      }
    }

    if (target != null) {
      final entry = _groupEntryNodeId(target);
      if (entry.isNotEmpty && entry != fromId) {
        _connect(fromId, entry, branch: _connectingBranch);
        return;
      }
    }
    setState(() {
      _connectingFromNodeId = null;
      _connectingBranch = 'default';
      _connectCursor = null;
      _snapTargetGroupId = null;
      _branchPointerActive = false;
    });
    _stopConnectPulse();
  }

  Future<void> _showBlockContextMenu({
    required Offset globalPosition,
    required String nodeId,
    required String groupId,
  }) async {
    final wa = WaTheme.of(context);
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox?;
    if (overlay == null) return;
    final selected = await showMenu<String>(
      context: context,
      color: wa.menuBg,
      position: RelativeRect.fromLTRB(
        globalPosition.dx,
        globalPosition.dy,
        overlay.size.width - globalPosition.dx,
        overlay.size.height - globalPosition.dy,
      ),
      items: [
        const PopupMenuItem(value: 'props', child: Text('Propriedades')),
        const PopupMenuItem(value: 'connect', child: Text('Ligar saída…')),
        const PopupMenuItem(value: 'duplicate', child: Text('Duplicar bloco')),
        const PopupMenuItem(
          value: 'detach',
          child: Text('Separar em novo grupo'),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem(
          value: 'delete',
          child: Text('Excluir', style: TextStyle(color: Color(0xFFB42318))),
        ),
      ],
    );
    if (!mounted || selected == null) return;
    switch (selected) {
      case 'props':
        _selectNode(nodeId, groupId: groupId);
      case 'connect':
        setState(() {
          _connectingFromNodeId = nodeId;
          _connectCursor = _outPortOfNode(nodeId, _buildGroups());
        });
        _startConnectPulse();
      case 'duplicate':
        _duplicateNode(nodeId);
      case 'detach':
        final groups = _buildGroups();
        Offset pos = const Offset(200, 200);
        for (final g in groups) {
          if (g.id == groupId) {
            final vp = _groupVisualPos(g);
            pos = Offset(vp.dx + g.width + 48, vp.dy);
            break;
          }
        }
        _detachBlockAsNewGroup(nodeId, pos);
      case 'delete':
        _deleteNodeById(nodeId);
    }
  }

  Future<void> _showGroupContextMenu({
    required Offset globalPosition,
    required String groupId,
  }) async {
    final wa = WaTheme.of(context);
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox?;
    if (overlay == null) return;
    final selected = await showMenu<String>(
      context: context,
      color: wa.menuBg,
      position: RelativeRect.fromLTRB(
        globalPosition.dx,
        globalPosition.dy,
        overlay.size.width - globalPosition.dx,
        overlay.size.height - globalPosition.dy,
      ),
      items: const [
        PopupMenuItem(value: 'rename', child: Text('Renomear grupo')),
        PopupMenuItem(value: 'connect', child: Text('Ligar saída…')),
      ],
    );
    if (!mounted || selected == null) return;
    final groups = _buildGroups();
    _CanvasGroup? g;
    for (final item in groups) {
      if (item.id == groupId) {
        g = item;
        break;
      }
    }
    if (g == null) return;
    switch (selected) {
      case 'rename':
        final controller = TextEditingController(text: g.title);
        final title = await showDialog<String>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Nome do grupo'),
            content: TextField(
              controller: controller,
              autofocus: true,
              onSubmitted: (v) => Navigator.pop(ctx, v),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, controller.text.trim()),
                child: const Text('Salvar'),
              ),
            ],
          ),
        );
        if (title != null && title.isNotEmpty) _renameGroup(groupId, title);
      case 'connect':
        final exit = _groupExitNodeId(g);
        if (exit.isNotEmpty) {
          setState(() {
            _connectingFromNodeId = exit;
            _connectCursor = _groupOutPort(g!);
          });
          _startConnectPulse();
        }
    }
  }

  // ── Build ──────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final isDark =
        wa.isDark ||
        Theme.of(context).brightness == Brightness.dark ||
        ThemeData.estimateBrightnessForColor(wa.searchBg) == Brightness.dark;
    final groups = _buildGroups();
    final panLocked =
        _draggingGroupId != null ||
        _draggingBlockId != null ||
        _connectingFromNodeId != null ||
        _branchPointerActive;
    final fastCanvasMode =
        _draggingGroupId != null ||
        _draggingBlockId != null ||
        _dropTargetGroupId != null;

    return Shortcuts(
      shortcuts: {
        LogicalKeySet(LogicalKeyboardKey.delete): const _DeleteIntent(),
      },
      child: Actions(
        actions: {
          // isEnabled=false quando digita → tecla chega no TextField.
          _DeleteIntent: _ConditionalDeleteAction(
            isTyping: () => _isTypingInTextField,
            onDelete: _deleteSelected,
          ),
        },
        child: Focus(
          // Sem autofocus: inputs do inspetor precisam receber Backspace.
          autofocus: false,
          // Drop interno de blocos. Paleta usa onDragEnd → addPaletteItemAtGlobal
          // (DragTarget + InteractiveViewer no Flutter web é instável).
          child: DragTarget<Object>(
            onWillAcceptWithDetails: (d) =>
                !widget.readOnly && d.data is _BlockDragData,
            onAcceptWithDetails: (details) {
              if (details.data is! _BlockDragData) return;
              final data = details.data as _BlockDragData;
              final scene =
                  _globalToScene(details.offset + const Offset(80, 28)) ??
                  _globalToScene(details.offset);
              if (scene == null) return;
              final hit = _hitGroup(scene);
              if (hit != null) {
                final pos = _groupVisualPos(hit);
                final localY = scene.dy - pos.dy - _headerH;
                final index = (localY / (_blockH + 4)).floor().clamp(
                  0,
                  hit.blocks.length,
                );
                _moveBlockToGroup(data.blockId, hit.id, index);
              } else {
                _detachBlockAsNewGroup(data.blockId, scene);
              }
            },
            builder: (context, candidate, rejected) {
              final dropping = candidate.isNotEmpty;
              return ColoredBox(
                color: isDark
                    ? const Color(0xFF0B141A)
                    : const Color(0xFFF0F2F5),
                child: Stack(
                  key: _canvasKey,
                  children: [
                    // Canvas (rebuild leve via _canvasTick no drag)
                    Positioned.fill(
                      child: InteractiveViewer(
                        key: _viewerKey,
                        transformationController: _transform,
                        constrained: false,
                        boundaryMargin: const EdgeInsets.all(
                          _canvasBoundaryMargin,
                        ),
                        minScale: 0.25,
                        maxScale: 2.0,
                        panEnabled: !panLocked,
                        scaleEnabled:
                            _draggingGroupId == null &&
                            _draggingBlockId == null,
                        interactionEndFrictionCoefficient: 0.0001,
                        child: SizedBox(
                          width: _canvasSize,
                          height: _canvasSize,
                          child: ListenableBuilder(
                            listenable: _connectingFromNodeId == null
                                ? _canvasTick
                                : Listenable.merge([_canvasTick, _pulse]),
                            builder: (context, _) {
                              final liveGroups = _buildGroups();
                              return Stack(
                                clipBehavior: Clip.none,
                                children: [
                                  // Fundo clicável: limpa seleção / fecha inspetor
                                  Positioned.fill(
                                    child: GestureDetector(
                                      behavior: HitTestBehavior.opaque,
                                      onTap: () {
                                        clearSelection();
                                      },
                                      onSecondaryTapDown: (_) {},
                                      child: RepaintBoundary(
                                        child: CustomPaint(
                                          size: const Size(
                                            _canvasSize,
                                            _canvasSize,
                                          ),
                                          isComplex: true,
                                          willChange: false,
                                          painter: _GridPainter(
                                            color: isDark
                                                ? const Color(0x14FFFFFF)
                                                : const Color(0x18000000),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  // Highlight de drop no canvas
                                  if (dropping)
                                    Positioned.fill(
                                      child: IgnorePointer(
                                        child: DecoratedBox(
                                          decoration: BoxDecoration(
                                            border: Border.all(
                                              color: wa.accent.withValues(
                                                alpha: 0.45,
                                              ),
                                              width: 2,
                                            ),
                                            color: wa.accent.withValues(
                                              alpha: 0.05,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  RepaintBoundary(
                                    child: CustomPaint(
                                      size: const Size(
                                        _canvasSize,
                                        _canvasSize,
                                      ),
                                      isComplex: true,
                                      willChange:
                                          _connectingFromNodeId != null ||
                                          _selectedEdgeId != null,
                                      painter: _GroupEdgesPainter(
                                        groups: liveGroups,
                                        edges: _edges,
                                        fastMode: fastCanvasMode,
                                        repaint: Listenable.merge([
                                          _edgeDragTick,
                                          _pulse,
                                        ]),
                                        edgeColor: isDark
                                            ? const Color(0xFF8696A0)
                                            : const Color(0xFF667781),
                                        activeColor: wa.accent,
                                        selectedEdgeId: _selectedEdgeId,
                                        connectingFromId: _connectingFromNodeId,
                                        connectCursor: _connectCursor,
                                        snapTargetGroupId: _snapTargetGroupId,
                                        animT: _pulse.value,
                                        connectingBranch: _connectingBranch,
                                        outPortOf:
                                            (id, {String branch = 'default'}) =>
                                                _outPortOfNode(
                                                  id,
                                                  liveGroups,
                                                  branch: branch,
                                                ),
                                        inPortOf: (id) =>
                                            _inPortOfNode(id, liveGroups),
                                      ),
                                    ),
                                  ),
                                  // Groups
                                  for (final g in liveGroups)
                                    _GroupCard(
                                      group: g,
                                      visualPos: Offset(g.x, g.y),
                                      dragging: _draggingGroupId == g.id,
                                      dragDeltaListenable: _groupDragDelta,
                                      selected:
                                          _selectedGroupId == g.id ||
                                          g.blocks.any(
                                            (b) =>
                                                b['id']?.toString() ==
                                                _selectedNodeId,
                                          ),
                                      selectedNodeId: _selectedNodeId,
                                      connectingFromId: _connectingFromNodeId,
                                      snapHighlight: _snapTargetGroupId == g.id,
                                      dropHover: _dropTargetGroupId == g.id,
                                      dropInsertIndex:
                                          _dropTargetGroupId == g.id
                                          ? _dropInsertIndex
                                          : null,
                                      fastMode: fastCanvasMode,
                                      readOnly: widget.readOnly,
                                      onSelectGroup: () {
                                        final first = g.blocks.isNotEmpty
                                            ? g.blocks.first['id']?.toString()
                                            : null;
                                        _selectNode(first, groupId: g.id);
                                        setState(() {
                                          _connectingFromNodeId = null;
                                          _connectCursor = null;
                                          _snapTargetGroupId = null;
                                        });
                                        _stopConnectPulse();
                                      },
                                      onSelectBlock: (nodeId) {
                                        if (_connectingFromNodeId != null) {
                                          _connect(
                                            _connectingFromNodeId!,
                                            nodeId,
                                            branch: _connectingBranch,
                                          );
                                          return;
                                        }
                                        _selectNode(nodeId, groupId: g.id);
                                      },
                                      onGroupPanStart: (global) =>
                                          _beginGroupDrag(g.id, global),
                                      onGroupPan: (global) =>
                                          _updateGroupDrag(g.id, global),
                                      onGroupPanEnd: () => _endGroupDrag(g.id),
                                      onStartConnectFromGroup: () {
                                        final exit = _groupExitNodeId(g);
                                        if (exit.isEmpty) return;
                                        _beginConnectFrom(
                                          nodeId: exit,
                                          branch: 'default',
                                          cursor: _groupOutPort(g),
                                        );
                                      },
                                      onAcceptConnectToGroup: () {
                                        final entry = _groupEntryNodeId(g);
                                        if (entry.isEmpty ||
                                            _connectingFromNodeId == null) {
                                          return;
                                        }
                                        _connect(
                                          _connectingFromNodeId!,
                                          entry,
                                          branch: _connectingBranch,
                                        );
                                      },
                                      onConnectCursor: (global) =>
                                          _updateConnectCursor(
                                            global,
                                            fromGroupId: g.id,
                                          ),
                                      onConnectEnd: (global) => _finishConnect(
                                        global,
                                        fromGroupId: g.id,
                                      ),
                                      onRename: (title) =>
                                          _renameGroup(g.id, title),
                                      onBlockReorder: (blockId, newIndex) {
                                        _moveBlockToGroup(
                                          blockId,
                                          g.id,
                                          newIndex,
                                        );
                                      },
                                      onBlockDragStarted: (blockId) {
                                        _draggingBlockId = blockId;
                                        _tickCanvas();
                                      },
                                      onBlockDragEnded: (blockId, details) {
                                        _dropBlockAtGlobal(
                                          blockId: blockId,
                                          global: details.offset,
                                        );
                                      },
                                      onAcceptPalette: (item, index) {
                                        _addBlock(
                                          item,
                                          intoGroupId: g.id,
                                          insertIndex: index,
                                        );
                                      },
                                      onAcceptBlock:
                                          (blockId, fromGroupId, index) {
                                            _moveBlockToGroup(
                                              blockId,
                                              g.id,
                                              index,
                                            );
                                          },
                                      onDropHover: (index) {
                                        if (_dropTargetGroupId == g.id &&
                                            _dropInsertIndex == index) {
                                          return;
                                        }
                                        _dropTargetGroupId = g.id;
                                        _dropInsertIndex = index;
                                        _tickCanvas();
                                      },
                                      onDropLeave: () {
                                        if (_dropTargetGroupId == g.id) {
                                          _dropTargetGroupId = null;
                                          _dropInsertIndex = null;
                                          _tickCanvas();
                                        }
                                      },
                                      onDeleteBlock: (nodeId) {
                                        _deleteNodeById(nodeId);
                                      },
                                      onBlockContextMenu: (nodeId, pos) {
                                        _showBlockContextMenu(
                                          globalPosition: pos,
                                          nodeId: nodeId,
                                          groupId: g.id,
                                        );
                                      },
                                      onGroupContextMenu: (pos) {
                                        _showGroupContextMenu(
                                          globalPosition: pos,
                                          groupId: g.id,
                                        );
                                      },
                                      onStartBranchConnect:
                                          (nodeId, branch, global) {
                                            _beginConnectFrom(
                                              nodeId: nodeId,
                                              branch: branch,
                                              cursor: _globalToScene(global),
                                            );
                                            _updateConnectCursor(
                                              global,
                                              fromGroupId: g.id,
                                            );
                                          },
                                    ),
                                ],
                              );
                            },
                          ),
                        ),
                      ),
                    ),

                    if (!fastCanvasMode && _connectingFromNodeId == null)
                      // Controles de linha no ESPAÇO DA TELA (fora do InteractiveViewer).
                      // ListenableBuilder acompanha pan/zoom do canvas.
                      ListenableBuilder(
                        listenable: Listenable.merge([_transform, _canvasTick]),
                        builder: (context, _) {
                          final edgeGroups = _buildGroups();
                          return Stack(
                            children: [
                              for (final edge in _edges)
                                if (_viewportEdgeMid(edge, edgeGroups) != null)
                                  Positioned(
                                    left:
                                        _viewportEdgeMid(edge, edgeGroups)!.dx -
                                        18,
                                    top:
                                        _viewportEdgeMid(edge, edgeGroups)!.dy -
                                        18,
                                    child: MouseRegion(
                                      cursor: SystemMouseCursors.click,
                                      child: GestureDetector(
                                        behavior: HitTestBehavior.opaque,
                                        onTap: widget.readOnly
                                            ? null
                                            : () {
                                                final id =
                                                    edge['id']?.toString() ??
                                                    '';
                                                if (id.isEmpty) return;
                                                // Clique único remove a linha.
                                                _removeEdge(id);
                                              },
                                        child: Container(
                                          width: 36,
                                          height: 36,
                                          alignment: Alignment.center,
                                          decoration: BoxDecoration(
                                            color:
                                                _selectedEdgeId ==
                                                    edge['id']?.toString()
                                                ? wa.accent
                                                : wa.panel,
                                            shape: BoxShape.circle,
                                            border: Border.all(
                                              color:
                                                  _selectedEdgeId ==
                                                      edge['id']?.toString()
                                                  ? wa.accent
                                                  : wa.border,
                                              width: 1.5,
                                            ),
                                            boxShadow: const [
                                              BoxShadow(
                                                color: Color(0x55000000),
                                                blurRadius: 8,
                                                offset: Offset(0, 2),
                                              ),
                                            ],
                                          ),
                                          child: Icon(
                                            Icons.close_rounded,
                                            size: 18,
                                            color:
                                                _selectedEdgeId ==
                                                    edge['id']?.toString()
                                                ? Colors.white
                                                : wa.icon,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                            ],
                          );
                        },
                      ),

                    // Toolbar
                    Positioned(
                      top: 10,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Material(
                          color: wa.panel,
                          elevation: 6,
                          borderRadius: BorderRadius.circular(12),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 6,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (widget.showEmbeddedPalette)
                                  _ToolBtn(
                                    icon: Icons.grid_view_rounded,
                                    tooltip: 'Paleta',
                                    active: _paletteOpen,
                                    onTap: () => setState(
                                      () => _paletteOpen = !_paletteOpen,
                                    ),
                                  ),
                                Container(
                                  width: 1,
                                  height: 22,
                                  margin: const EdgeInsets.symmetric(
                                    horizontal: 6,
                                  ),
                                  color: wa.border,
                                ),
                                _ToolBtn(
                                  icon: Icons.fit_screen_rounded,
                                  tooltip: 'Ajustar visão',
                                  onTap: _fitView,
                                ),
                                _ToolBtn(
                                  icon: Icons.zoom_in_rounded,
                                  tooltip: 'Zoom +',
                                  onTap: () {
                                    final m = _transform.value.clone()
                                      ..scaleByDouble(1.15, 1.15, 1, 1);
                                    _transform.value = m;
                                  },
                                ),
                                _ToolBtn(
                                  icon: Icons.zoom_out_rounded,
                                  tooltip: 'Zoom −',
                                  onTap: () {
                                    final m = _transform.value.clone()
                                      ..scaleByDouble(1 / 1.15, 1 / 1.15, 1, 1);
                                    _transform.value = m;
                                  },
                                ),
                                if (!widget.readOnly) ...[
                                  Container(
                                    width: 1,
                                    height: 22,
                                    margin: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                    ),
                                    color: wa.border,
                                  ),
                                  _ToolBtn(
                                    icon: Icons.delete_outline_rounded,
                                    tooltip: 'Apagar bloco selecionado',
                                    onTap: _deleteSelected,
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),

                    // Embedded palette
                    if (widget.showEmbeddedPalette && _paletteOpen)
                      Positioned(
                        left: 12,
                        top: 64,
                        bottom: 12,
                        child: FlowNodePalette(
                          onAdd: (item) => _addBlock(item),
                          onDragAdd: (item, global) =>
                              addPaletteItemAtGlobal(item, global),
                        ),
                      ),

                    // Modal central flutuante para editar o bloco.
                    if (widget.showInspector &&
                        _inspectorOpen &&
                        _selectedNode != null)
                      Positioned.fill(
                        child: _BlockEditModal(
                          node: _selectedNode!,
                          readOnly: widget.readOnly,
                          allNodes: _nodes,
                          onChanged: (patch) => _updateNode(
                            _selectedNode!['id']!.toString(),
                            patch,
                          ),
                          onDelete: _deleteSelected,
                          onClose: () => setState(() => _inspectorOpen = false),
                          onConnectTo: (toId) {
                            final from = _selectedNodeId;
                            if (from != null) _connect(from, toId);
                          },
                        ),
                      ),

                    // Connection hint
                    if (_connectingFromNodeId != null)
                      Positioned(
                        bottom: 18,
                        left: 0,
                        right: 0,
                        child: Center(
                          child: Material(
                            color: wa.accent,
                            borderRadius: BorderRadius.circular(999),
                            child: const Padding(
                              padding: EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 10,
                              ),
                              child: Text(
                                'Solte no porto de entrada (●) de outro grupo',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),

                    // Hint empty
                    if (groups.isEmpty)
                      Center(
                        child: Material(
                          color: wa.panel.withValues(alpha: 0.95),
                          borderRadius: BorderRadius.circular(16),
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.hub_outlined,
                                  size: 40,
                                  color: wa.textMuted,
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  'Arraste blocos da paleta para o canvas',
                                  style: TextStyle(
                                    color: wa.textPrimary,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  'Empilhe vários blocos no mesmo grupo\ncomo no Typebot',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: wa.textMuted),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),

                    if (candidate.isNotEmpty)
                      Positioned.fill(
                        child: IgnorePointer(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              border: Border.all(
                                color: wa.accent.withValues(alpha: 0.5),
                                width: 2,
                              ),
                              color: wa.accent.withValues(alpha: 0.05),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  Offset? _edgeMid(Map<String, dynamic> edge, List<_CanvasGroup> groups) {
    final fromId = edge['from']?.toString();
    final toId = edge['to']?.toString();
    if (fromId == null || toId == null) return null;
    // Pula edges internas do mesmo grupo (não desenhadas).
    String? gFrom;
    String? gTo;
    for (final g in groups) {
      for (final b in g.blocks) {
        final id = b['id']?.toString();
        if (id == fromId) gFrom = g.id;
        if (id == toId) gTo = g.id;
      }
    }
    if (gFrom != null && gFrom == gTo) return null;
    final branch = edge['branch']?.toString() ?? 'default';
    final a = _outPortOfNode(fromId, groups, branch: branch);
    final b = _inPortOfNode(toId, groups);
    return Offset((a.dx + b.dx) / 2, (a.dy + b.dy) / 2);
  }

  Offset? _viewportEdgeMid(
    Map<String, dynamic> edge,
    List<_CanvasGroup> groups,
  ) {
    final mid = _edgeMid(edge, groups);
    if (mid == null) return null;
    return _sceneToViewport(mid);
  }
}

class _DeleteIntent extends Intent {
  const _DeleteIntent();
}

/// Só apaga blocos/linhas quando NÃO está digitando em campo de texto.
class _ConditionalDeleteAction extends Action<_DeleteIntent> {
  _ConditionalDeleteAction({required this.isTyping, required this.onDelete});

  final bool Function() isTyping;
  final VoidCallback onDelete;

  @override
  bool isEnabled(_DeleteIntent intent) => !isTyping();

  @override
  bool consumesKey(_DeleteIntent intent) => !isTyping();

  @override
  Object? invoke(_DeleteIntent intent) {
    onDelete();
    return null;
  }
}

// ─── Model ───────────────────────────────────────────────────────────

class _CanvasGroup {
  _CanvasGroup({
    required this.id,
    required this.blocks,
    required this.width,
    required this.headerH,
    required this.blockH,
    required this.footerH,
    required this.blockPad,
  });

  final String id;
  final List<Map<String, dynamic>> blocks;
  final double width;
  final double headerH;
  final double blockH;
  final double footerH;
  final double blockPad;

  double get visualWidth => width - FlowVisualEditorState._branchLaneW;

  double get x {
    if (blocks.isEmpty) return 120;
    final v = blocks.first['x'];
    return (v is num) ? v.toDouble() : 120;
  }

  double get y {
    if (blocks.isEmpty) return 120;
    final v = blocks.first['y'];
    return (v is num) ? v.toDouble() : 120;
  }

  String get title {
    for (final b in blocks) {
      final t = (b['stackTitle'] ?? '').toString().trim();
      if (t.isNotEmpty) return t;
    }
    if (blocks.length == 1) {
      final kind = (blocks.first['kind'] ?? '').toString();
      if (kind == 'trigger') return 'Início';
      return (blocks.first['title'] ?? _metaForKind(kind).label).toString();
    }
    return 'Grupo';
  }

  double blockTop(int index) {
    var y = headerH + 6;
    for (var i = 0; i < index && i < blocks.length; i++) {
      y += FlowVisualEditorState.blockHeightFor(blocks[i]) + 4;
    }
    return y;
  }

  double get height {
    var h = headerH + footerH + blockPad + 4;
    for (final b in blocks) {
      h += FlowVisualEditorState.blockHeightFor(b) + 4;
    }
    return h;
  }
}

class _BlockDragData {
  const _BlockDragData({required this.blockId, required this.fromGroupId});
  final String blockId;
  final String fromGroupId;
}

// ─── Group card (Typebot style) ──────────────────────────────────────

class _GroupCard extends StatelessWidget {
  const _GroupCard({
    required this.group,
    required this.visualPos,
    required this.dragging,
    required this.dragDeltaListenable,
    required this.selected,
    required this.selectedNodeId,
    required this.connectingFromId,
    required this.snapHighlight,
    required this.dropHover,
    required this.dropInsertIndex,
    required this.fastMode,
    required this.readOnly,
    required this.onSelectGroup,
    required this.onSelectBlock,
    required this.onGroupPan,
    required this.onGroupPanStart,
    required this.onGroupPanEnd,
    required this.onStartConnectFromGroup,
    required this.onAcceptConnectToGroup,
    required this.onConnectCursor,
    required this.onConnectEnd,
    required this.onRename,
    required this.onBlockReorder,
    required this.onBlockDragStarted,
    required this.onBlockDragEnded,
    required this.onAcceptPalette,
    required this.onAcceptBlock,
    required this.onDropHover,
    required this.onDropLeave,
    required this.onDeleteBlock,
    required this.onBlockContextMenu,
    required this.onGroupContextMenu,
    required this.onStartBranchConnect,
  });

  final _CanvasGroup group;
  final Offset visualPos;
  final bool dragging;
  final ValueListenable<Offset> dragDeltaListenable;
  final bool selected;
  final String? selectedNodeId;
  final String? connectingFromId;
  final bool snapHighlight;
  final bool dropHover;
  final int? dropInsertIndex;
  final bool fastMode;
  final bool readOnly;
  final VoidCallback onSelectGroup;
  final ValueChanged<String> onSelectBlock;
  final ValueChanged<Offset> onGroupPan;
  final ValueChanged<Offset> onGroupPanStart;
  final VoidCallback onGroupPanEnd;
  final VoidCallback onStartConnectFromGroup;
  final VoidCallback onAcceptConnectToGroup;
  final ValueChanged<Offset> onConnectCursor;
  final ValueChanged<Offset> onConnectEnd;
  final ValueChanged<String> onRename;
  final void Function(String blockId, int newIndex) onBlockReorder;
  final ValueChanged<String> onBlockDragStarted;
  final void Function(String blockId, DraggableDetails details)
  onBlockDragEnded;
  final void Function(FlowPaletteItem item, int index) onAcceptPalette;
  final void Function(String blockId, String fromGroupId, int index)
  onAcceptBlock;
  final ValueChanged<int> onDropHover;
  final VoidCallback onDropLeave;
  final ValueChanged<String> onDeleteBlock;
  final void Function(String nodeId, Offset globalPos) onBlockContextMenu;
  final ValueChanged<Offset> onGroupContextMenu;
  final void Function(String nodeId, String branch, Offset global)
  onStartBranchConnect;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final singleSimpleBlock =
        group.blocks.length == 1 &&
        group.blocks.first['kind']?.toString() != 'buttons' &&
        group.blocks.first['kind']?.toString() != 'menu';

    final card = RepaintBoundary(
      child: DragTarget<Object>(
        // Só blocos internos. Itens da paleta caem via onDragEnd → hit-test manual.
        onWillAcceptWithDetails: (d) => !readOnly && d.data is _BlockDragData,
        onLeave: (_) => onDropLeave(),
        onAcceptWithDetails: (details) {
          final index = dropInsertIndex ?? group.blocks.length;
          if (details.data is _BlockDragData) {
            final d = details.data as _BlockDragData;
            onAcceptBlock(d.blockId, d.fromGroupId, index);
          }
          onDropLeave();
        },
        builder: (context, candidate, rejected) {
          final hovering = candidate.isNotEmpty || dropHover || snapHighlight;
          return Stack(
            clipBehavior: Clip.none,
            children: [
              GestureDetector(
                onTap: onSelectGroup,
                onSecondaryTapDown: (d) => onGroupContextMenu(d.globalPosition),
                child: SizedBox(
                  width: group.width,
                  height: group.height,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Positioned(
                        left: 0,
                        top: 0,
                        width: group.visualWidth,
                        height: group.height,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: wa.panel,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: hovering
                                  ? wa.accent
                                  : selected
                                  ? wa.accent
                                  : wa.border,
                              width: hovering || selected ? 2 : 1,
                            ),
                            boxShadow: [
                              if (!fastMode)
                                BoxShadow(
                                  color: Colors.black.withValues(
                                    alpha: selected || hovering ? 0.28 : 0.12,
                                  ),
                                  blurRadius: selected ? 18 : 10,
                                  offset: const Offset(0, 6),
                                ),
                            ],
                          ),
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // Header
                          SizedBox(
                            width: group.visualWidth,
                            child: _GroupDragHeader(
                              readOnly: readOnly,
                              onTap: onSelectGroup,
                              onStart: onGroupPanStart,
                              onUpdate: onGroupPan,
                              onEnd: onGroupPanEnd,
                              child: Container(
                                height: group.headerH,
                                padding: const EdgeInsets.fromLTRB(12, 0, 8, 0),
                                decoration: BoxDecoration(
                                  color: wa.searchBg,
                                  borderRadius: const BorderRadius.vertical(
                                    top: Radius.circular(15),
                                  ),
                                  border: Border(
                                    bottom: BorderSide(color: wa.border),
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      Icons.drag_indicator_rounded,
                                      size: 18,
                                      color: wa.textMuted,
                                    ),
                                    const SizedBox(width: 6),
                                    Expanded(
                                      child: GestureDetector(
                                        onDoubleTap: readOnly
                                            ? null
                                            : () async {
                                                final controller =
                                                    TextEditingController(
                                                      text: group.title,
                                                    );
                                                final title = await showDialog<String>(
                                                  context: context,
                                                  builder: (ctx) => AlertDialog(
                                                    title: const Text(
                                                      'Nome do grupo',
                                                    ),
                                                    content: TextField(
                                                      controller: controller,
                                                      autofocus: true,
                                                      decoration:
                                                          const InputDecoration(
                                                            labelText: 'Título',
                                                          ),
                                                      onSubmitted: (v) =>
                                                          Navigator.pop(ctx, v),
                                                    ),
                                                    actions: [
                                                      TextButton(
                                                        onPressed: () =>
                                                            Navigator.pop(ctx),
                                                        child: const Text(
                                                          'Cancelar',
                                                        ),
                                                      ),
                                                      FilledButton(
                                                        onPressed: () =>
                                                            Navigator.pop(
                                                              ctx,
                                                              controller.text
                                                                  .trim(),
                                                            ),
                                                        child: const Text(
                                                          'Salvar',
                                                        ),
                                                      ),
                                                    ],
                                                  ),
                                                );
                                                if (title != null &&
                                                    title.isNotEmpty) {
                                                  onRename(title);
                                                }
                                              },
                                        child: Text(
                                          group.title,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            color: wa.textPrimary,
                                            fontWeight: FontWeight.w800,
                                            fontSize: 13.5,
                                          ),
                                        ),
                                      ),
                                    ),
                                    Text(
                                      '${group.blocks.length}',
                                      style: TextStyle(
                                        color: wa.textMuted,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          // Blocks
                          Padding(
                            padding: EdgeInsets.fromLTRB(
                              group.blockPad,
                              6,
                              0,
                              4,
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                for (
                                  var i = 0;
                                  i < group.blocks.length;
                                  i++
                                ) ...[
                                  if (dropInsertIndex == i && hovering)
                                    SizedBox(
                                      width:
                                          group.visualWidth -
                                          group.blockPad * 2,
                                      child: _InsertLine(color: wa.accent),
                                    ),
                                  SizedBox(
                                    width:
                                        ((group.blocks[i]['kind'] ?? '')
                                                    .toString() ==
                                                'buttons' ||
                                            (group.blocks[i]['kind'] ?? '')
                                                    .toString() ==
                                                'menu')
                                        ? group.width - group.blockPad * 2
                                        : group.visualWidth -
                                              group.blockPad * 2,
                                    child: singleSimpleBlock
                                        ? _GroupDragHeader(
                                            readOnly: readOnly,
                                            onTap: () => onSelectBlock(
                                              group.blocks[i]['id']
                                                      ?.toString() ??
                                                  '',
                                            ),
                                            onStart: onGroupPanStart,
                                            onUpdate: onGroupPan,
                                            onEnd: onGroupPanEnd,
                                            child: _BlockTile(
                                              node: group.blocks[i],
                                              selected:
                                                  group.blocks[i]['id']
                                                      ?.toString() ==
                                                  selectedNodeId,
                                              readOnly: readOnly,
                                              dragEnabled: false,
                                              fastMode: fastMode,
                                              groupId: group.id,
                                              index: i,
                                              onTap: () => onSelectBlock(
                                                group.blocks[i]['id']
                                                        ?.toString() ??
                                                    '',
                                              ),
                                              onDelete: () => onDeleteBlock(
                                                group.blocks[i]['id']
                                                        ?.toString() ??
                                                    '',
                                              ),
                                              onDragStarted: () =>
                                                  onBlockDragStarted(
                                                    group.blocks[i]['id']
                                                            ?.toString() ??
                                                        '',
                                                  ),
                                              onDragEnded: (details) =>
                                                  onBlockDragEnded(
                                                    group.blocks[i]['id']
                                                            ?.toString() ??
                                                        '',
                                                    details,
                                                  ),
                                              onHoverInsert: onDropHover,
                                              onContextMenu: (pos) {
                                                final id =
                                                    group.blocks[i]['id']
                                                        ?.toString() ??
                                                    '';
                                                if (id.isNotEmpty) {
                                                  onBlockContextMenu(id, pos);
                                                }
                                              },
                                              onStartBranchConnect:
                                                  onStartBranchConnect,
                                              onConnectCursor: onConnectCursor,
                                              onConnectEnd: onConnectEnd,
                                            ),
                                          )
                                        : _BlockTile(
                                            node: group.blocks[i],
                                            selected:
                                                group.blocks[i]['id']
                                                    ?.toString() ==
                                                selectedNodeId,
                                            readOnly: readOnly,
                                            dragEnabled: true,
                                            fastMode: fastMode,
                                            groupId: group.id,
                                            index: i,
                                            onTap: () => onSelectBlock(
                                              group.blocks[i]['id']
                                                      ?.toString() ??
                                                  '',
                                            ),
                                            onDelete: () => onDeleteBlock(
                                              group.blocks[i]['id']
                                                      ?.toString() ??
                                                  '',
                                            ),
                                            onDragStarted: () =>
                                                onBlockDragStarted(
                                                  group.blocks[i]['id']
                                                          ?.toString() ??
                                                      '',
                                                ),
                                            onDragEnded: (details) =>
                                                onBlockDragEnded(
                                                  group.blocks[i]['id']
                                                          ?.toString() ??
                                                      '',
                                                  details,
                                                ),
                                            onHoverInsert: onDropHover,
                                            onContextMenu: (pos) {
                                              final id =
                                                  group.blocks[i]['id']
                                                      ?.toString() ??
                                                  '';
                                              if (id.isNotEmpty) {
                                                onBlockContextMenu(id, pos);
                                              }
                                            },
                                            onStartBranchConnect:
                                                onStartBranchConnect,
                                            onConnectCursor: onConnectCursor,
                                            onConnectEnd: onConnectEnd,
                                          ),
                                  ),
                                ],
                                if (dropInsertIndex == group.blocks.length &&
                                    hovering)
                                  SizedBox(
                                    width:
                                        group.visualWidth - group.blockPad * 2,
                                    child: _InsertLine(color: wa.accent),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              // Input port do grupo (entrada)
              Positioned(
                left: -30,
                top:
                    group.blockTop(0) +
                    (group.blocks.isEmpty
                        ? 36
                        : FlowVisualEditorState.blockHeightFor(
                                group.blocks.first,
                              ) /
                              2) -
                    30,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: onAcceptConnectToGroup,
                  child: SizedBox(
                    width: 60,
                    height: 60,
                    child: Center(
                      child: _PortDot(
                        color: snapHighlight || connectingFromId != null
                            ? wa.accent
                            : const Color(0xFF00A884),
                        filled: snapHighlight || connectingFromId != null,
                        size: snapHighlight ? 28 : 22,
                      ),
                    ),
                  ),
                ),
              ),
              // Output padrão do grupo (último bloco — se não for botões com portos próprios)
              if (group.blocks.isEmpty ||
                  (group.blocks.last['kind']?.toString() != 'buttons' &&
                      group.blocks.last['kind']?.toString() != 'menu'))
                Positioned(
                  right: group.width - group.visualWidth - 30,
                  top:
                      group.blockTop(math.max(0, group.blocks.length - 1)) +
                      (group.blocks.isEmpty
                          ? 36
                          : FlowVisualEditorState.blockHeightFor(
                                  group.blocks.last,
                                ) /
                                2) -
                      30,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onPanStart: readOnly
                        ? null
                        : (d) {
                            onStartConnectFromGroup();
                            onConnectCursor(d.globalPosition);
                          },
                    onPanUpdate: readOnly
                        ? null
                        : (d) => onConnectCursor(d.globalPosition),
                    onPanEnd: readOnly
                        ? null
                        : (d) => onConnectEnd(d.globalPosition),
                    onPanCancel: readOnly
                        ? null
                        : () => onConnectEnd(Offset.zero),
                    child: SizedBox(
                      width: 60,
                      height: 60,
                      child: Center(
                        child: _PortDot(
                          color: const Color(0xFF00A884),
                          filled: true,
                          size: 22,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );

    return Positioned(
      left: visualPos.dx,
      top: visualPos.dy,
      child: dragging
          ? ValueListenableBuilder<Offset>(
              valueListenable: dragDeltaListenable,
              child: card,
              builder: (context, delta, child) {
                return Transform.translate(offset: delta, child: child);
              },
            )
          : card,
    );
  }
}

class _GroupDragHeader extends StatefulWidget {
  const _GroupDragHeader({
    required this.readOnly,
    required this.onTap,
    required this.onStart,
    required this.onUpdate,
    required this.onEnd,
    required this.child,
  });

  final bool readOnly;
  final VoidCallback onTap;
  final ValueChanged<Offset> onStart;
  final ValueChanged<Offset> onUpdate;
  final VoidCallback onEnd;
  final Widget child;

  @override
  State<_GroupDragHeader> createState() => _GroupDragHeaderState();
}

class _GroupDragHeaderState extends State<_GroupDragHeader> {
  static const _tapSlop = 4.0;

  int? _pointer;
  Offset? _start;
  bool _moved = false;

  bool _acceptPointer(PointerDownEvent event) {
    if (widget.readOnly || _pointer != null) return false;
    if (event.kind == ui.PointerDeviceKind.touch ||
        event.kind == ui.PointerDeviceKind.stylus ||
        event.kind == ui.PointerDeviceKind.invertedStylus) {
      return true;
    }
    return (event.buttons & kPrimaryButton) != 0;
  }

  void _reset() {
    _pointer = null;
    _start = null;
    _moved = false;
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.opaque,
      onPointerDown: (event) {
        if (!_acceptPointer(event)) return;
        _pointer = event.pointer;
        _start = event.position;
        _moved = false;
        widget.onStart(event.position);
      },
      onPointerMove: (event) {
        if (_pointer != event.pointer) return;
        final start = _start;
        if (start != null && (event.position - start).distance > _tapSlop) {
          _moved = true;
        }
        widget.onUpdate(event.position);
      },
      onPointerUp: (event) {
        if (_pointer != event.pointer) return;
        final wasTap = !_moved;
        widget.onEnd();
        _reset();
        if (wasTap) widget.onTap();
      },
      onPointerCancel: (event) {
        if (_pointer != event.pointer) return;
        widget.onEnd();
        _reset();
      },
      child: widget.child,
    );
  }
}

class _InsertLine extends StatelessWidget {
  const _InsertLine({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 3,
      margin: const EdgeInsets.symmetric(vertical: 3),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}

class _BlockTile extends StatelessWidget {
  const _BlockTile({
    required this.node,
    required this.selected,
    required this.readOnly,
    this.dragEnabled = true,
    required this.fastMode,
    required this.groupId,
    required this.index,
    required this.onTap,
    required this.onDelete,
    required this.onDragStarted,
    required this.onDragEnded,
    required this.onHoverInsert,
    required this.onContextMenu,
    required this.onStartBranchConnect,
    required this.onConnectCursor,
    required this.onConnectEnd,
  });

  final Map<String, dynamic> node;
  final bool selected;
  final bool readOnly;
  final bool dragEnabled;
  final bool fastMode;
  final String groupId;
  final int index;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final VoidCallback onDragStarted;
  final ValueChanged<DraggableDetails> onDragEnded;
  final ValueChanged<int> onHoverInsert;
  final ValueChanged<Offset> onContextMenu;

  /// (nodeId, branch, globalPos)
  final void Function(String nodeId, String branch, Offset global)
  onStartBranchConnect;
  final ValueChanged<Offset> onConnectCursor;
  final ValueChanged<Offset> onConnectEnd;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final kind = (node['kind'] ?? 'text').toString();
    final meta = _metaForKind(kind);
    final title = (node['title'] ?? meta.label).toString();
    final subtitle = _nodeSubtitle(node);
    final id = node['id']?.toString() ?? '';
    final interactive = kind == 'buttons' || kind == 'menu';
    final h = FlowVisualEditorState.blockHeightFor(node);

    final tile = Material(
      color: interactive
          ? Colors.transparent
          : selected
          ? wa.accentSoft
          : wa.searchBg,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        onSecondaryTapDown: (d) => onContextMenu(d.globalPosition),
        child: Container(
          height: h,
          padding: interactive
              ? const EdgeInsets.fromLTRB(4, 2, 4, 2)
              : const EdgeInsets.fromLTRB(8, 6, 4, 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: interactive
                  ? Colors.transparent
                  : selected
                  ? meta.color
                  : wa.border,
              width: interactive
                  ? 0
                  : selected
                  ? 1.6
                  : 1,
            ),
          ),
          child: fastMode
              ? _FastFlowBlockPreview(
                  title: title,
                  subtitle: subtitle,
                  icon: meta.icon,
                  color: meta.color,
                  interactive: interactive,
                )
              : interactive
              ? _WhatsAppBubbleCard(
                  node: node,
                  selected: selected,
                  readOnly: readOnly,
                  onDelete: onDelete,
                  onContextMenu: onContextMenu,
                  onStartBranchConnect: onStartBranchConnect,
                  onConnectCursor: onConnectCursor,
                  onConnectEnd: onConnectEnd,
                )
              : Row(
                  children: [
                    if (!readOnly)
                      Icon(
                        Icons.drag_handle_rounded,
                        size: 16,
                        color: wa.textMuted,
                      )
                    else
                      const SizedBox(width: 4),
                    const SizedBox(width: 4),
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: meta.color.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(meta.icon, size: 16, color: meta.color),
                    ),
                    const SizedBox(width: 8),
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
                              color: wa.textPrimary,
                              fontWeight: FontWeight.w800,
                              fontSize: 12.5,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: wa.textMuted, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    if (!readOnly)
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 28,
                          minHeight: 28,
                        ),
                        icon: Icon(
                          Icons.close_rounded,
                          size: 15,
                          color: wa.textMuted,
                        ),
                        onPressed: onDelete,
                      ),
                  ],
                ),
        ),
      ),
    );

    if (readOnly || !dragEnabled) {
      return Padding(padding: const EdgeInsets.only(bottom: 4), child: tile);
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final feedbackWidth = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : 360.0;
        return Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: LongPressDraggable<_BlockDragData>(
            data: _BlockDragData(blockId: id, fromGroupId: groupId),
            delay: const Duration(milliseconds: 90),
            dragAnchorStrategy: childDragAnchorStrategy,
            maxSimultaneousDrags: 1,
            rootOverlay: true,
            ignoringFeedbackPointer: true,
            onDragStarted: onDragStarted,
            onDragEnd: onDragEnded,
            feedback: Material(
              color: Colors.transparent,
              elevation: 10,
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                width: feedbackWidth,
                height: h,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: wa.searchBg,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: meta.color, width: 1.4),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
                    child: _FastFlowBlockPreview(
                      title: title,
                      subtitle: subtitle,
                      icon: meta.icon,
                      color: meta.color,
                      interactive: interactive,
                    ),
                  ),
                ),
              ),
            ),
            childWhenDragging: Opacity(opacity: 0.3, child: tile),
            child: DragTarget<_BlockDragData>(
              onWillAcceptWithDetails: (d) => true,
              onMove: (_) => onHoverInsert(index),
              onAcceptWithDetails: (_) => onHoverInsert(index),
              builder: (context, cand, rej) => tile,
            ),
          ),
        );
      },
    );
  }
}

class _FastFlowBlockPreview extends StatelessWidget {
  const _FastFlowBlockPreview({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
    required this.interactive,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final bool interactive;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.16),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Icon(icon, size: 17, color: color),
        ),
        const SizedBox(width: 10),
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
                  color: wa.textPrimary,
                  fontWeight: FontWeight.w800,
                  fontSize: 12.5,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                interactive ? 'Prévia leve durante o movimento' : subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: wa.textMuted, fontSize: 11),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Balão estilo WhatsApp (mensagem + botões com pontinho de saída).
class _WhatsAppBubbleCard extends StatelessWidget {
  const _WhatsAppBubbleCard({
    required this.node,
    required this.selected,
    required this.readOnly,
    required this.onDelete,
    required this.onContextMenu,
    required this.onStartBranchConnect,
    required this.onConnectCursor,
    required this.onConnectEnd,
  });

  final Map<String, dynamic> node;
  final bool selected;
  final bool readOnly;
  final VoidCallback onDelete;
  final ValueChanged<Offset> onContextMenu;
  final void Function(String nodeId, String branch, Offset global)
  onStartBranchConnect;
  final ValueChanged<Offset> onConnectCursor;
  final ValueChanged<Offset> onConnectEnd;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final kind = (node['kind'] ?? '').toString();
    final nodeId = node['id']?.toString() ?? '';
    final headerTitle = (node['headerTitle'] ?? '').toString().trim();
    final text = (node['text'] ?? '').toString().trim();
    final footer = (node['footerText'] ?? '').toString().trim();
    final mediaUrl = _flowPreviewMediaUrl(node);
    final items = kind == 'menu'
        ? _asMapList(node['menuOptions'])
        : _asMapList(node['buttons']);
    final visibleItems = kind == 'menu'
        ? items.take(4).toList()
        : items.take(3).toList();
    const accent = Color(0xFF00A884);
    const buttonGreen = Color(0xFF008069);
    final bubbleBg = wa.isDark ? const Color(0xFF202C33) : Colors.white;
    final border = wa.isDark
        ? const Color(0xFF2A3942)
        : const Color(0xFFD1D7DB);

    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onSecondaryTapDown: (d) => onContextMenu(d.globalPosition),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 0, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  margin: const EdgeInsets.only(
                    right: FlowVisualEditorState._branchLaneW,
                  ),
                  decoration: BoxDecoration(
                    color: bubbleBg,
                    borderRadius: BorderRadius.circular(9),
                    border: Border.all(
                      color: selected ? accent : border,
                      width: selected ? 1.3 : 1,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(
                          alpha: wa.isDark ? 0.28 : 0.08,
                        ),
                        blurRadius: 5,
                        offset: const Offset(0, 1),
                      ),
                    ],
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (mediaUrl.isNotEmpty)
                        _WaMediaPreview(url: mediaUrl)
                      else if (kind == 'buttons')
                        const SizedBox.shrink(),
                      SizedBox(
                        height: mediaUrl.isNotEmpty
                            ? FlowVisualEditorState._waBodyWithMediaH
                            : FlowVisualEditorState._waBodyNoMediaH,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              if (headerTitle.isNotEmpty) ...[
                                Text(
                                  headerTitle,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: wa.textPrimary,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 13,
                                  ),
                                ),
                                const SizedBox(height: 4),
                              ],
                              Expanded(
                                child: Text(
                                  text.isEmpty
                                      ? (kind == 'menu'
                                            ? 'Selecione uma opção para continuar.'
                                            : 'Escolha uma opção abaixo.')
                                      : text,
                                  maxLines: mediaUrl.isNotEmpty ? 7 : 5,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: wa.textPrimary,
                                    fontSize: 13,
                                    height: 1.22,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                              Text(
                                footer.isEmpty
                                    ? 'Selecione uma das opções para continuar seu atendimento.'
                                    : footer,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: wa.textMuted,
                                  fontSize: 11.5,
                                  height: 1.15,
                                ),
                              ),
                              Align(
                                alignment: Alignment.centerRight,
                                child: Text(
                                  '19:09',
                                  style: TextStyle(
                                    color: wa.textMuted,
                                    fontSize: 10.5,
                                    height: 1,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (kind == 'menu')
                  _WaMenuOpenRow(
                    label: headerTitle.isEmpty ? 'Ver lista' : 'Ver opções',
                    color: buttonGreen,
                  ),
                if (kind == 'menu')
                  _WaListPreviewPanel(
                    title: headerTitle.isEmpty ? 'Ver lista' : headerTitle,
                    options: visibleItems,
                    readOnly: readOnly,
                    nodeId: nodeId,
                    onStartBranchConnect: onStartBranchConnect,
                    onConnectCursor: onConnectCursor,
                    onConnectEnd: onConnectEnd,
                  )
                else if (visibleItems.isEmpty)
                  _WaReplyButtonRow(
                    label: 'Opção 1',
                    type: 'reply',
                    showPort: false,
                    onPortPanStart: (_) {},
                    onPortPanUpdate: (_) {},
                    onPortPanEnd: (_) {},
                  )
                else
                  for (var i = 0; i < visibleItems.length; i++)
                    _WaReplyButtonRow(
                      label:
                          (visibleItems[i]['label'] ??
                                  visibleItems[i]['title'] ??
                                  visibleItems[i]['text'] ??
                                  (kind == 'menu' ? 'Item' : 'Botão'))
                              .toString(),
                      type: (visibleItems[i]['type'] ?? 'reply').toString(),
                      showPort: !readOnly,
                      onPortPanStart: (global) {
                        final id = visibleItems[i]['id']?.toString() ?? '';
                        if (id.isEmpty || nodeId.isEmpty) return;
                        onStartBranchConnect(
                          nodeId,
                          kind == 'menu' ? 'menu:$id' : 'button:$id',
                          global,
                        );
                      },
                      onPortPanUpdate: onConnectCursor,
                      onPortPanEnd: onConnectEnd,
                    ),
              ],
            ),
          ),
          if (!readOnly)
            Positioned(
              top: 2,
              right: FlowVisualEditorState._branchLaneW + 4,
              child: InkWell(
                onTap: onDelete,
                borderRadius: BorderRadius.circular(999),
                child: Container(
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(
                    color: wa.panel.withValues(alpha: 0.92),
                    shape: BoxShape.circle,
                    border: Border.all(color: border),
                  ),
                  child: Icon(
                    Icons.close_rounded,
                    size: 15,
                    color: wa.textMuted,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _WaMediaPreview extends StatelessWidget {
  const _WaMediaPreview({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return SizedBox(
      height: FlowVisualEditorState._waMediaH,
      child: Image.network(
        _resolveFlowMediaUrl(url),
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) {
          return DecoratedBox(
            decoration: BoxDecoration(
              color: wa.isDark
                  ? const Color(0xFF111B21)
                  : const Color(0xFFE9EDEF),
            ),
            child: Center(
              child: Icon(Icons.image_outlined, color: wa.textMuted, size: 28),
            ),
          );
        },
      ),
    );
  }
}

class _WaMenuOpenRow extends StatelessWidget {
  const _WaMenuOpenRow({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final bg = wa.isDark ? const Color(0xFF202C33) : Colors.white;
    final border = wa.isDark
        ? const Color(0xFF2A3942)
        : const Color(0xFFD1D7DB);
    return Container(
      height: FlowVisualEditorState._waListOpenRowH,
      margin: const EdgeInsets.only(
        top: FlowVisualEditorState._waOuterButtonGap,
        right: FlowVisualEditorState._branchLaneW,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: border),
      ),
      child: Center(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.list_alt_rounded, size: 15, color: color),
            const SizedBox(width: 7),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w800,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WaListPreviewPanel extends StatelessWidget {
  const _WaListPreviewPanel({
    required this.title,
    required this.options,
    required this.readOnly,
    required this.nodeId,
    required this.onStartBranchConnect,
    required this.onConnectCursor,
    required this.onConnectEnd,
  });

  final String title;
  final List<Map<String, dynamic>> options;
  final bool readOnly;
  final String nodeId;
  final void Function(String nodeId, String branch, Offset global)
  onStartBranchConnect;
  final ValueChanged<Offset> onConnectCursor;
  final ValueChanged<Offset> onConnectEnd;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final bg = wa.isDark ? const Color(0xFF202C33) : Colors.white;
    final border = wa.isDark
        ? const Color(0xFF2A3942)
        : const Color(0xFFD1D7DB);
    final items = options.isEmpty
        ? const [
            {'id': 'item_1', 'label': 'Item 1', 'value': 'Escolha uma opção'},
          ]
        : options;

    final panelH =
        FlowVisualEditorState._waListPanelHeaderH +
        items.length * FlowVisualEditorState._waListOptionH;

    return SizedBox(
      height: panelH + FlowVisualEditorState._waOuterButtonGap,
      child: Padding(
        padding: const EdgeInsets.only(
          top: FlowVisualEditorState._waOuterButtonGap,
        ),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              right: FlowVisualEditorState._branchLaneW,
              child: Container(
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: border),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: wa.isDark ? 0.24 : 0.08,
                      ),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      height: FlowVisualEditorState._waListPanelHeaderH,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 0, 10, 0),
                        child: Row(
                          children: [
                            Icon(
                              Icons.close_rounded,
                              size: 18,
                              color: wa.textMuted,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: wa.textPrimary,
                                  fontSize: 14,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    for (final item in items)
                      _WaListOptionVisualRow(option: item),
                  ],
                ),
              ),
            ),
            if (!readOnly && options.isNotEmpty && nodeId.isNotEmpty)
              for (var i = 0; i < items.length; i++)
                if ((items[i]['id'] ?? '').toString().isNotEmpty)
                  Positioned(
                    right: 6,
                    top:
                        FlowVisualEditorState._waListPanelHeaderH +
                        i * FlowVisualEditorState._waListOptionH +
                        (FlowVisualEditorState._waListOptionH - 44) / 2,
                    child: _BranchDragHandle(
                      tooltip: 'Arraste para conectar esta opção',
                      onStart: (global) => onStartBranchConnect(
                        nodeId,
                        'menu:${items[i]['id']}',
                        global,
                      ),
                      onUpdate: onConnectCursor,
                      onEnd: onConnectEnd,
                    ),
                  ),
          ],
        ),
      ),
    );
  }
}

class _WaListOptionVisualRow extends StatelessWidget {
  const _WaListOptionVisualRow({required this.option});

  final Map<String, dynamic> option;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final label = (option['label'] ?? option['title'] ?? 'Item').toString();
    final value = (option['description'] ?? option['value'] ?? '').toString();
    return SizedBox(
      height: FlowVisualEditorState._waListOptionH,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 4, 42, 4),
        child: Row(
          children: [
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (value.trim().isNotEmpty)
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: wa.textMuted, fontSize: 11.5),
                    ),
                ],
              ),
            ),
            Container(
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: wa.textMuted, width: 1.8),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WaReplyButtonRow extends StatelessWidget {
  const _WaReplyButtonRow({
    required this.label,
    required this.type,
    required this.showPort,
    required this.onPortPanStart,
    required this.onPortPanUpdate,
    required this.onPortPanEnd,
  });

  final String label;
  final String type;
  final bool showPort;
  final ValueChanged<Offset> onPortPanStart;
  final ValueChanged<Offset> onPortPanUpdate;
  final ValueChanged<Offset> onPortPanEnd;

  IconData get _icon {
    switch (type) {
      case 'url':
        return Icons.open_in_new_rounded;
      case 'call':
        return Icons.phone_rounded;
      case 'copy':
        return Icons.copy_rounded;
      default:
        return Icons.reply_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    const actionGreen = Color(0xFF008069);
    final bg = wa.isDark ? const Color(0xFF202C33) : Colors.white;
    final border = wa.isDark
        ? const Color(0xFF2A3942)
        : const Color(0xFFD1D7DB);

    return SizedBox(
      height: FlowVisualEditorState._btnRowH,
      child: Padding(
        padding: const EdgeInsets.only(
          top: FlowVisualEditorState._waOuterButtonGap,
        ),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              right: FlowVisualEditorState._branchLaneW,
              child: Container(
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: border),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: wa.isDark ? 0.18 : 0.05,
                      ),
                      blurRadius: 3,
                      offset: const Offset(0, 1),
                    ),
                  ],
                ),
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 28),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(_icon, size: 14, color: actionGreen),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: actionGreen,
                              fontWeight: FontWeight.w800,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            // Pontinho de saída por botão (liga fluxo a outro grupo)
            if (showPort)
              Positioned(
                right: 6,
                top: 0,
                bottom: 0,
                child: _BranchDragHandle(
                  tooltip: 'Arraste para conectar este botão',
                  onStart: onPortPanStart,
                  onUpdate: onPortPanUpdate,
                  onEnd: onPortPanEnd,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _BranchDragHandle extends StatefulWidget {
  const _BranchDragHandle({
    required this.tooltip,
    required this.onStart,
    required this.onUpdate,
    required this.onEnd,
  });

  final String tooltip;
  final ValueChanged<Offset> onStart;
  final ValueChanged<Offset> onUpdate;
  final ValueChanged<Offset> onEnd;

  @override
  State<_BranchDragHandle> createState() => _BranchDragHandleState();
}

class _BranchDragHandleState extends State<_BranchDragHandle> {
  bool _hover = false;
  int? _pointer;
  Offset? _lastPosition;

  void _resetPointer() {
    _pointer = null;
    _lastPosition = null;
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: (event) {
          if (_pointer != null) return;
          _pointer = event.pointer;
          _lastPosition = event.position;
          widget.onStart(event.position);
          widget.onUpdate(event.position);
        },
        onPointerMove: (event) {
          if (_pointer != event.pointer) return;
          _lastPosition = event.position;
          widget.onUpdate(event.position);
        },
        onPointerUp: (event) {
          if (_pointer != event.pointer) return;
          widget.onEnd(event.position);
          _resetPointer();
        },
        onPointerCancel: (event) {
          if (_pointer != event.pointer) return;
          widget.onEnd(_lastPosition ?? event.position);
          _resetPointer();
        },
        child: Tooltip(
          message: widget.tooltip,
          child: SizedBox(
            width: 56,
            height: 44,
            child: Center(
              child: Stack(
                alignment: Alignment.center,
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    left: -30,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 120),
                      width: _hover ? 64 : 58,
                      height: _hover ? 3 : 2,
                      decoration: BoxDecoration(
                        color: const Color(0xFF00A884),
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 120),
                    width: _hover ? 24 : 18,
                    height: _hover ? 24 : 18,
                    decoration: BoxDecoration(
                      color: _hover
                          ? const Color(0xFF06CF9C)
                          : const Color(0xFF00A884),
                      shape: BoxShape.circle,
                      border: Border.all(color: wa.panel, width: 2.4),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(
                            alpha: _hover ? 0.38 : 0.24,
                          ),
                          blurRadius: _hover ? 9 : 5,
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

class _PortDot extends StatelessWidget {
  const _PortDot({required this.color, this.filled = false, this.size = 16});

  final Color color;
  final bool filled;
  final double size;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: filled ? color : WaTheme.of(context).panel,
          shape: BoxShape.circle,
          border: Border.all(color: color, width: 2.5),
          boxShadow: const [BoxShadow(color: Color(0x44000000), blurRadius: 4)],
        ),
      ),
    );
  }
}

// ─── Palette ─────────────────────────────────────────────────────────

class FlowPaletteItem {
  const FlowPaletteItem({
    required this.kind,
    required this.label,
    required this.icon,
    required this.color,
    required this.category,
    this.defaults = const {},
  });

  final String kind;
  final String label;
  final IconData icon;
  final Color color;
  final String category;
  final Map<String, dynamic> defaults;
}

const List<FlowPaletteItem> kFlowPalette = [
  FlowPaletteItem(
    kind: 'trigger',
    label: 'Gatilho',
    icon: Icons.bolt_rounded,
    color: Color(0xFFFF6D5A),
    category: 'Gatilhos',
    defaults: {
      'triggerType': 'command',
      'triggerMatchMode': 'exact',
      'triggerValue': 'menu',
      'text': '/menu',
    },
  ),
  FlowPaletteItem(
    kind: 'webhook_wait',
    label: 'Webhook',
    icon: Icons.link_rounded,
    color: Color(0xFFFF6D5A),
    category: 'Gatilhos',
    defaults: {'triggerType': 'webhook', 'triggerValue': ''},
  ),
  FlowPaletteItem(
    kind: 'text',
    label: 'Mensagem',
    icon: Icons.chat_bubble_outline_rounded,
    color: Color(0xFF00A884),
    category: 'Mensagens',
    defaults: {'text': 'Olá! 👋'},
  ),
  FlowPaletteItem(
    kind: 'content',
    label: 'Conteúdo',
    icon: Icons.layers_outlined,
    color: Color(0xFF00A884),
    category: 'Mensagens',
    defaults: {
      'text': '',
      'contentItems': [
        {'id': 'c1', 'type': 'text', 'text': 'Conteúdo do fluxo'},
      ],
    },
  ),
  FlowPaletteItem(
    kind: 'media',
    label: 'Mídia',
    icon: Icons.perm_media_rounded,
    color: Color(0xFF00A884),
    category: 'Mensagens',
    defaults: {'mediaType': 'image', 'mediaUrl': '', 'text': ''},
  ),
  FlowPaletteItem(
    kind: 'buttons',
    label: 'Botões',
    icon: Icons.smart_button_rounded,
    color: Color(0xFF00A884),
    category: 'Mensagens',
    defaults: {
      'headerTitle': 'Atendimento',
      'text': 'Escolha uma opção:',
      'footerText': 'Selecione uma das opções para continuar seu atendimento.',
      'buttons': [
        {'id': 'b1', 'type': 'reply', 'label': 'Opção 1', 'value': 'opcao1'},
        {'id': 'b2', 'type': 'reply', 'label': 'Opção 2', 'value': 'opcao2'},
      ],
    },
  ),
  FlowPaletteItem(
    kind: 'menu',
    label: 'Menu / Lista',
    icon: Icons.list_alt_rounded,
    color: Color(0xFF00A884),
    category: 'Mensagens',
    defaults: {
      'headerTitle': 'Menu',
      'text': 'Selecione:',
      'footerText': 'Selecione uma das opções para continuar seu atendimento.',
      'menuMode': 'list',
      'menuOptions': [
        {'id': 'o1', 'label': 'Item 1', 'value': '1'},
        {'id': 'o2', 'label': 'Item 2', 'value': '2'},
      ],
    },
  ),
  FlowPaletteItem(
    kind: 'delay',
    label: 'Delay',
    icon: Icons.timer_outlined,
    color: Color(0xFFAF52DE),
    category: 'Lógica',
    defaults: {'delaySeconds': 3},
  ),
  FlowPaletteItem(
    kind: 'smart_delay',
    label: 'Delay inteligente',
    icon: Icons.schedule_rounded,
    color: Color(0xFFAF52DE),
    category: 'Lógica',
    defaults: {
      'smartDelayMode': 'relative',
      'smartDelayUnit': 'minutes',
      'delaySeconds': 60,
    },
  ),
  FlowPaletteItem(
    kind: 'condition',
    label: 'Condição IF',
    icon: Icons.call_split_rounded,
    color: Color(0xFFAF52DE),
    category: 'Lógica',
    defaults: {
      'conditionVariable': 'texto',
      'conditionOperator': 'contains',
      'conditionValue': '',
      'conditionLogic': 'AND',
    },
  ),
  FlowPaletteItem(
    kind: 'randomizer',
    label: 'Randomizer',
    icon: Icons.shuffle_rounded,
    color: Color(0xFFAF52DE),
    category: 'Lógica',
    defaults: {
      'randomizerMode': 'random',
      'randomizerOptions': [
        {'id': 'r1', 'label': 'A', 'weight': 1},
        {'id': 'r2', 'label': 'B', 'weight': 1},
      ],
    },
  ),
  FlowPaletteItem(
    kind: 'jump',
    label: 'Pular para',
    icon: Icons.redo_rounded,
    color: Color(0xFFAF52DE),
    category: 'Lógica',
    defaults: {'jumpTargetNodeId': ''},
  ),
  FlowPaletteItem(
    kind: 'flow_link',
    label: 'Chamar fluxo',
    icon: Icons.account_tree_rounded,
    color: Color(0xFFAF52DE),
    category: 'Lógica',
    defaults: {'targetFlowId': null, 'targetFlowName': ''},
  ),
  FlowPaletteItem(
    kind: 'set_variable',
    label: 'Variável',
    icon: Icons.data_object_rounded,
    color: Color(0xFF007AFF),
    category: 'Dados',
    defaults: {
      'variableName': 'minha_var',
      'variableValue': '',
      'variableOperation': 'set',
    },
  ),
  FlowPaletteItem(
    kind: 'capture',
    label: 'Capturar resposta',
    icon: Icons.input_rounded,
    color: Color(0xFF007AFF),
    category: 'Dados',
    defaults: {
      'captureType': 'text',
      'captureVariable': 'resposta',
      'captureFallbackText': 'Não entendi, tente de novo.',
      'text': 'Digite sua resposta:',
    },
  ),
  FlowPaletteItem(
    kind: 'http_request',
    label: 'HTTP Request',
    icon: Icons.http_rounded,
    color: Color(0xFF007AFF),
    category: 'Dados',
    defaults: {
      'httpMethod': 'GET',
      'httpUrl': 'https://',
      'httpTimeoutSeconds': 20,
      'httpBody': '',
    },
  ),
  FlowPaletteItem(
    kind: 'assistant_gpt',
    label: 'Assistente GPT',
    icon: Icons.psychology_rounded,
    color: Color(0xFF34C759),
    category: 'IA & Ações',
    defaults: {
      'assistantName': 'Assistente',
      'assistantInstructions': 'Você é um assistente útil.',
      'assistantTemperature': 0.7,
      'assistantModel': 'gpt-4o-mini',
    },
  ),
  FlowPaletteItem(
    kind: 'action',
    label: 'Ação',
    icon: Icons.flash_on_rounded,
    color: Color(0xFF34C759),
    category: 'IA & Ações',
    defaults: {
      'actions': [
        {'id': 'a1', 'type': 'add_tag', 'key': 'tag', 'value': 'lead'},
      ],
    },
  ),
  FlowPaletteItem(
    kind: 'integration',
    label: 'Integração / DB',
    icon: Icons.storage_rounded,
    color: Color(0xFF34C759),
    category: 'IA & Ações',
    defaults: {
      'databaseProvider': 'mysql',
      'databaseOperation': 'query',
      'databaseQuery': 'SELECT 1',
    },
  ),
];

class FlowNodePalette extends StatefulWidget {
  const FlowNodePalette({
    super.key,
    required this.onAdd,
    this.onDragAdd,
    this.header,
    this.footer,
    this.compact = false,
    this.showSearch = true,
  });

  final ValueChanged<FlowPaletteItem> onAdd;
  final void Function(FlowPaletteItem item, Offset global)? onDragAdd;
  final Widget? header;
  final Widget? footer;
  final bool compact;
  final bool showSearch;

  @override
  State<FlowNodePalette> createState() => _FlowNodePaletteState();
}

class _FlowNodePaletteState extends State<FlowNodePalette> {
  String _query = '';
  String? _categoryFilter;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final q = _query.trim().toLowerCase();
    final allCategories = <String>{
      for (final item in kFlowPalette) item.category,
    }.toList();

    final filtered = kFlowPalette.where((item) {
      if (_categoryFilter != null && item.category != _categoryFilter) {
        return false;
      }
      if (q.isEmpty) return true;
      return item.label.toLowerCase().contains(q) ||
          item.kind.toLowerCase().contains(q) ||
          item.category.toLowerCase().contains(q);
    }).toList();

    final categories = <String, List<FlowPaletteItem>>{};
    for (final item in filtered) {
      categories.putIfAbsent(item.category, () => []).add(item);
    }

    return Material(
      color: wa.panel,
      elevation: widget.compact ? 0 : 8,
      borderRadius: widget.compact
          ? BorderRadius.zero
          : BorderRadius.circular(14),
      child: SizedBox(
        width: widget.compact ? double.infinity : 280,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.header != null) widget.header!,
            if (widget.header == null)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
                child: Text(
                  'Blocos · arraste para o canvas ou grupo',
                  style: TextStyle(
                    color: wa.textPrimary,
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                  ),
                ),
              ),
            if (widget.showSearch) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                child: TextField(
                  onChanged: (v) => setState(() => _query = v),
                  decoration: InputDecoration(
                    hintText: 'Buscar blocos…',
                    prefixIcon: const Icon(Icons.search_rounded, size: 20),
                    isDense: true,
                    filled: true,
                    fillColor: wa.searchBg,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
              _CategorySlider(
                categories: allCategories,
                selected: _categoryFilter,
                onSelect: (cat) => setState(() => _categoryFilter = cat),
              ),
            ],
            Divider(height: 1, color: wa.border),
            Expanded(
              child: filtered.isEmpty
                  ? Center(
                      child: Text(
                        'Nenhum bloco',
                        style: TextStyle(color: wa.textMuted),
                      ),
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(10, 8, 10, 12),
                      children: [
                        for (final entry in categories.entries) ...[
                          Padding(
                            padding: const EdgeInsets.fromLTRB(4, 10, 4, 6),
                            child: Text(
                              entry.key.toUpperCase(),
                              style: TextStyle(
                                color: wa.textMuted,
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),
                          for (final item in entry.value)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Draggable<FlowPaletteItem>(
                                data: item,
                                feedback: Material(
                                  elevation: 10,
                                  borderRadius: BorderRadius.circular(10),
                                  child: _PaletteChip(
                                    item: item,
                                    dragging: true,
                                  ),
                                ),
                                childWhenDragging: Opacity(
                                  opacity: 0.35,
                                  child: _PaletteChip(item: item),
                                ),
                                onDragEnd: (details) {
                                  // Sempre aplica drop manualmente (confiável no web).
                                  widget.onDragAdd?.call(
                                    item,
                                    details.offset + const Offset(100, 28),
                                  );
                                },
                                // rootOverlay: feedback por cima de tudo no web
                                rootOverlay: true,
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(10),
                                  onTap: () => widget.onAdd(item),
                                  child: _PaletteChip(item: item),
                                ),
                              ),
                            ),
                        ],
                      ],
                    ),
            ),
            if (widget.footer != null) widget.footer!,
          ],
        ),
      ),
    );
  }
}

class _CategorySlider extends StatefulWidget {
  const _CategorySlider({
    required this.categories,
    required this.selected,
    required this.onSelect,
  });

  final List<String> categories;
  final String? selected;
  final ValueChanged<String?> onSelect;

  @override
  State<_CategorySlider> createState() => _CategorySliderState();
}

class _CategorySliderState extends State<_CategorySlider> {
  final _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _nudge(double dx) {
    if (!_scroll.hasClients) return;
    final next = (_scroll.offset + dx).clamp(
      0.0,
      _scroll.position.maxScrollExtent,
    );
    _scroll.animateTo(
      next,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
      child: Row(
        children: [
          _SliderArrow(
            icon: Icons.chevron_left_rounded,
            onTap: () => _nudge(-120),
          ),
          Expanded(
            child: ShaderMask(
              shaderCallback: (rect) {
                return const LinearGradient(
                  colors: [
                    Colors.transparent,
                    Colors.white,
                    Colors.white,
                    Colors.transparent,
                  ],
                  stops: [0.0, 0.06, 0.94, 1.0],
                ).createShader(rect);
              },
              blendMode: BlendMode.dstIn,
              child: SizedBox(
                height: 36,
                child: ListView(
                  controller: _scroll,
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  children: [
                    _CategoryChip(
                      label: 'Todos',
                      selected: widget.selected == null,
                      onTap: () => widget.onSelect(null),
                    ),
                    for (final cat in widget.categories)
                      _CategoryChip(
                        label: cat,
                        selected: widget.selected == cat,
                        onTap: () => widget.onSelect(
                          widget.selected == cat ? null : cat,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          _SliderArrow(
            icon: Icons.chevron_right_rounded,
            onTap: () => _nudge(120),
          ),
        ],
      ),
    );
  }
}

class _SliderArrow extends StatelessWidget {
  const _SliderArrow({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: SizedBox(
        width: 28,
        height: 32,
        child: Icon(icon, size: 20, color: wa.icon),
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Material(
        color: selected ? wa.accentSoft : wa.searchBg,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            child: Text(
              label,
              style: TextStyle(
                color: selected ? wa.accent : wa.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PaletteChip extends StatelessWidget {
  const _PaletteChip({required this.item, this.dragging = false});

  final FlowPaletteItem item;
  final bool dragging;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Container(
      width: dragging ? 200 : null,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: wa.searchBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: wa.border),
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: item.color.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(item.icon, size: 16, color: item.color),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              item.label,
              style: TextStyle(
                color: wa.textPrimary,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ),
          Icon(Icons.drag_indicator_rounded, size: 16, color: wa.textMuted),
        ],
      ),
    );
  }
}

// ─── Modal central de edição de bloco ────────────────────────────────

class _BlockEditModal extends StatelessWidget {
  const _BlockEditModal({
    required this.node,
    required this.readOnly,
    required this.allNodes,
    required this.onChanged,
    required this.onDelete,
    required this.onClose,
    required this.onConnectTo,
  });

  final Map<String, dynamic> node;
  final bool readOnly;
  final List<Map<String, dynamic>> allNodes;
  final ValueChanged<Map<String, dynamic>> onChanged;
  final VoidCallback onDelete;
  final VoidCallback onClose;
  final ValueChanged<String> onConnectTo;

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final maxW = math.min(520.0, size.width - 32);
    final maxH = math.min(size.height * 0.86, 680.0);

    return Material(
      type: MaterialType.transparency,
      child: Stack(
        children: [
          // Backdrop: clique fora fecha
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: onClose,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                color: Colors.black.withValues(alpha: 0.48),
              ),
            ),
          ),
          // Card central flutuante
          Center(
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.92, end: 1),
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOutCubic,
              builder: (context, scale, child) {
                return Transform.scale(
                  scale: scale,
                  child: Opacity(
                    opacity: ((scale - 0.92) / 0.08).clamp(0.0, 1.0),
                    child: child,
                  ),
                );
              },
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxWidth: maxW,
                  maxHeight: maxH,
                  minWidth: math.min(360, maxW),
                ),
                child: _NodeInspector(
                  node: node,
                  readOnly: readOnly,
                  onChanged: onChanged,
                  onDelete: onDelete,
                  onClose: onClose,
                  allNodes: allNodes,
                  onConnectTo: onConnectTo,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Inspector ───────────────────────────────────────────────────────

class _NodeInspector extends StatelessWidget {
  const _NodeInspector({
    required this.node,
    required this.readOnly,
    required this.onChanged,
    required this.onDelete,
    required this.onClose,
    required this.allNodes,
    required this.onConnectTo,
  });

  final Map<String, dynamic> node;
  final bool readOnly;
  final ValueChanged<Map<String, dynamic>> onChanged;
  final VoidCallback onDelete;
  final VoidCallback onClose;
  final List<Map<String, dynamic>> allNodes;
  final ValueChanged<String> onConnectTo;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final kind = (node['kind'] ?? 'text').toString();
    final meta = _metaForKind(kind);
    final isTrigger = kind == 'trigger';

    return Material(
      color: wa.panel,
      elevation: 28,
      shadowColor: Colors.black.withValues(alpha: 0.45),
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header com botão de fechar bem visível
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
            decoration: BoxDecoration(
              color: wa.searchBg,
              border: Border(bottom: BorderSide(color: wa.border)),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: meta.color.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(meta.icon, color: meta.color, size: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Editar bloco',
                        style: TextStyle(
                          color: wa.textMuted,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        (node['title'] ?? meta.label).toString(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: wa.textPrimary,
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!isTrigger && !readOnly)
                  IconButton(
                    tooltip: 'Apagar bloco',
                    onPressed: onDelete,
                    icon: const Icon(
                      Icons.delete_outline_rounded,
                      color: Color(0xFFB42318),
                    ),
                  ),
                // Botão fechar em destaque
                Material(
                  color: wa.panel,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: onClose,
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: Icon(
                        Icons.close_rounded,
                        color: wa.textPrimary,
                        size: 22,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
              ],
            ),
          ),
          Flexible(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
              shrinkWrap: true,
              children: [
                _field(
                  context,
                  label: 'Título do bloco',
                  value: (node['title'] ?? '').toString(),
                  onChanged: (v) => onChanged({'title': v}),
                  enabled: !readOnly,
                ),
                const SizedBox(height: 10),
                if (kind == 'text' ||
                    kind == 'buttons' ||
                    kind == 'menu' ||
                    kind == 'capture' ||
                    kind == 'content')
                  _field(
                    context,
                    label: 'Texto / mensagem',
                    value: (node['text'] ?? '').toString(),
                    maxLines: 4,
                    onChanged: (v) => onChanged({'text': v}),
                    enabled: !readOnly,
                  ),
                if (kind == 'buttons' || kind == 'menu') ...[
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'Header / título da mensagem',
                    value: (node['headerTitle'] ?? '').toString(),
                    onChanged: (v) => onChanged({'headerTitle': v}),
                    enabled: !readOnly,
                  ),
                  const SizedBox(height: 10),
                  _FlowHeaderImagePicker(
                    value: (node['mediaUrl'] ?? '').toString(),
                    enabled: !readOnly,
                    onChanged: (url) => onChanged({
                      'mediaUrl': url,
                      'mediaType': url.trim().isEmpty ? 'image' : 'image',
                    }),
                    onClear: () =>
                        onChanged({'mediaUrl': '', 'mediaType': 'image'}),
                  ),
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'Rodapé / instrução',
                    value: (node['footerText'] ?? '').toString(),
                    maxLines: 2,
                    onChanged: (v) => onChanged({'footerText': v}),
                    enabled: !readOnly,
                  ),
                ],
                if (kind == 'trigger') ...[
                  const SizedBox(height: 10),
                  _dropdown(
                    context,
                    label: 'Tipo de gatilho',
                    value: (node['triggerType'] ?? 'command').toString(),
                    items: const {
                      'command': 'Comando',
                      'keyword': 'Keyword',
                      'message': 'Mensagem',
                      'media': 'Mídia',
                      'webhook': 'Webhook',
                    },
                    onChanged: readOnly
                        ? null
                        : (v) => onChanged({'triggerType': v}),
                  ),
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'Valor / comando',
                    value: (node['triggerValue'] ?? node['text'] ?? '')
                        .toString(),
                    onChanged: (v) => onChanged({'triggerValue': v, 'text': v}),
                    enabled: !readOnly,
                  ),
                ],
                if (kind == 'delay' || kind == 'smart_delay') ...[
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'Segundos',
                    value: '${node['delaySeconds'] ?? 3}',
                    keyboard: TextInputType.number,
                    onChanged: (v) =>
                        onChanged({'delaySeconds': int.tryParse(v) ?? 3}),
                    enabled: !readOnly,
                  ),
                ],
                if (kind == 'condition') ...[
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'Variável',
                    value: (node['conditionVariable'] ?? '').toString(),
                    onChanged: (v) => onChanged({'conditionVariable': v}),
                    enabled: !readOnly,
                  ),
                  const SizedBox(height: 10),
                  _dropdown(
                    context,
                    label: 'Operador',
                    value: (node['conditionOperator'] ?? 'contains').toString(),
                    items: const {
                      'contains': 'Contém',
                      'equals': 'Igual',
                      'starts_with': 'Começa com',
                      'is_set': 'Está definido',
                      'is_empty': 'Está vazio',
                    },
                    onChanged: readOnly
                        ? null
                        : (v) => onChanged({'conditionOperator': v}),
                  ),
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'Valor',
                    value: (node['conditionValue'] ?? '').toString(),
                    onChanged: (v) => onChanged({'conditionValue': v}),
                    enabled: !readOnly,
                  ),
                ],
                if (kind == 'set_variable') ...[
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'Nome da variável',
                    value: (node['variableName'] ?? '').toString(),
                    onChanged: (v) => onChanged({'variableName': v}),
                    enabled: !readOnly,
                  ),
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'Valor',
                    value: (node['variableValue'] ?? '').toString(),
                    onChanged: (v) => onChanged({'variableValue': v}),
                    enabled: !readOnly,
                  ),
                ],
                if (kind == 'http_request') ...[
                  const SizedBox(height: 10),
                  _dropdown(
                    context,
                    label: 'Método',
                    value: (node['httpMethod'] ?? 'GET').toString(),
                    items: const {
                      'GET': 'GET',
                      'POST': 'POST',
                      'PUT': 'PUT',
                      'PATCH': 'PATCH',
                      'DELETE': 'DELETE',
                    },
                    onChanged: readOnly
                        ? null
                        : (v) => onChanged({'httpMethod': v}),
                  ),
                  const SizedBox(height: 10),
                  _field(
                    context,
                    label: 'URL',
                    value: (node['httpUrl'] ?? '').toString(),
                    onChanged: (v) => onChanged({'httpUrl': v}),
                    enabled: !readOnly,
                  ),
                ],
                if (kind == 'buttons') ...[
                  const SizedBox(height: 12),
                  Text(
                    'Botões',
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  _ButtonsMiniEditor(
                    buttons: _asMapList(node['buttons']),
                    readOnly: readOnly,
                    onChanged: (buttons) => onChanged({'buttons': buttons}),
                  ),
                ],
                if (kind == 'menu') ...[
                  const SizedBox(height: 12),
                  _dropdown(
                    context,
                    label: 'Tipo de menu',
                    value: (node['menuMode'] ?? 'list').toString(),
                    items: const {'list': 'Lista', 'buttons': 'Botões rápidos'},
                    onChanged: readOnly
                        ? null
                        : (v) => onChanged({'menuMode': v}),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Itens da lista',
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  _ButtonsMiniEditor(
                    buttons: _asMapList(node['menuOptions']),
                    readOnly: readOnly,
                    addLabel: 'Item',
                    onChanged: (items) => onChanged({'menuOptions': items}),
                  ),
                ],
                if (!isTrigger && !readOnly) ...[
                  const SizedBox(height: 16),
                  Text(
                    'Conectar saída a',
                    style: TextStyle(
                      color: wa.textPrimary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    decoration: const InputDecoration(
                      isDense: true,
                      labelText: 'Próximo bloco',
                    ),
                    items: [
                      const DropdownMenuItem(
                        value: '',
                        child: Text('Selecionar…'),
                      ),
                      for (final n in allNodes)
                        if (n['id']?.toString() != node['id']?.toString())
                          DropdownMenuItem(
                            value: n['id']?.toString() ?? '',
                            child: Text(
                              (n['title'] ?? n['kind'] ?? n['id']).toString(),
                            ),
                          ),
                    ],
                    onChanged: (v) {
                      if (v != null && v.isNotEmpty) onConnectTo(v);
                    },
                  ),
                ],
                const SizedBox(height: 16),
                Text(
                  'Dica Typebot: empilhe blocos no mesmo grupo para rodarem em sequência. Conecte grupos pelos portos laterais.',
                  style: TextStyle(
                    color: wa.textMuted,
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _field(
    BuildContext context, {
    required String label,
    required String value,
    required ValueChanged<String> onChanged,
    int maxLines = 1,
    TextInputType? keyboard,
    bool enabled = true,
  }) {
    return TextFormField(
      key: ValueKey('$label-$value-${node['id']}'),
      initialValue: value,
      maxLines: maxLines,
      enabled: enabled,
      keyboardType: keyboard,
      decoration: InputDecoration(labelText: label, isDense: true),
      onChanged: onChanged,
    );
  }

  Widget _dropdown(
    BuildContext context, {
    required String label,
    required String value,
    required Map<String, String> items,
    required ValueChanged<String>? onChanged,
  }) {
    final safe = items.containsKey(value) ? value : items.keys.first;
    return DropdownButtonFormField<String>(
      initialValue: safe,
      decoration: InputDecoration(labelText: label, isDense: true),
      items: [
        for (final e in items.entries)
          DropdownMenuItem(value: e.key, child: Text(e.value)),
      ],
      onChanged: onChanged == null
          ? null
          : (v) {
              if (v != null) onChanged(v);
            },
    );
  }
}

class _FlowHeaderImagePicker extends StatefulWidget {
  const _FlowHeaderImagePicker({
    required this.value,
    required this.enabled,
    required this.onChanged,
    required this.onClear,
  });

  final String value;
  final bool enabled;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  State<_FlowHeaderImagePicker> createState() => _FlowHeaderImagePickerState();
}

class _FlowHeaderImagePickerState extends State<_FlowHeaderImagePicker> {
  bool _uploading = false;

  Future<void> _pickAndUpload() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Imagem do header',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        ),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) {
      _showMessage('Arquivo vazio. Escolha outra imagem.');
      return;
    }
    if (!mounted) return;
    setState(() => _uploading = true);
    try {
      final media = await BotAdminApiClient(BotAdminSessionStore())
          .uploadBotFlowMedia(
            bytes: bytes,
            fileName: file.name,
            mimeType: file.mimeType ?? _guessFlowUploadMimeType(file.name),
          );
      final url = (media['url'] ?? media['path'] ?? '').toString().trim();
      if (url.isEmpty) {
        throw BotAdminApiException('Upload aceito, mas a URL não veio.');
      }
      widget.onChanged(url);
      _showMessage('Imagem do header enviada.');
    } catch (error) {
      _showMessage(error.toString());
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final hasImage = widget.value.trim().isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Imagem do header',
          style: TextStyle(
            color: wa.textMuted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Container(
          decoration: BoxDecoration(
            color: wa.searchBg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: wa.border),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (hasImage)
                SizedBox(
                  height: 112,
                  child: Image.network(
                    _resolveFlowMediaUrl(widget.value),
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => Center(
                      child: Icon(
                        Icons.broken_image_outlined,
                        color: wa.textMuted,
                        size: 28,
                      ),
                    ),
                  ),
                )
              else
                SizedBox(
                  height: 92,
                  child: Center(
                    child: Icon(
                      Icons.add_photo_alternate_outlined,
                      color: wa.textMuted,
                      size: 30,
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: widget.enabled && !_uploading
                            ? _pickAndUpload
                            : null,
                        icon: _uploading
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.upload_rounded, size: 17),
                        label: Text(
                          _uploading ? 'Enviando...' : 'Enviar imagem',
                        ),
                      ),
                    ),
                    if (hasImage) ...[
                      const SizedBox(width: 8),
                      IconButton.filledTonal(
                        tooltip: 'Remover imagem',
                        onPressed: widget.enabled && !_uploading
                            ? widget.onClear
                            : null,
                        icon: const Icon(
                          Icons.delete_outline_rounded,
                          size: 18,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ButtonsMiniEditor extends StatelessWidget {
  const _ButtonsMiniEditor({
    required this.buttons,
    required this.onChanged,
    required this.readOnly,
    this.addLabel = 'Botão',
  });

  final List<Map<String, dynamic>> buttons;
  final ValueChanged<List<Map<String, dynamic>>> onChanged;
  final bool readOnly;
  final String addLabel;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Column(
      children: [
        for (var i = 0; i < buttons.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Expanded(
                  child: TextFormField(
                    key: ValueKey('btn-${buttons[i]['id']}-$i'),
                    initialValue: (buttons[i]['label'] ?? '').toString(),
                    enabled: !readOnly,
                    decoration: const InputDecoration(
                      isDense: true,
                      labelText: 'Rótulo',
                    ),
                    onChanged: (v) {
                      final next = buttons
                          .map((b) => Map<String, dynamic>.from(b))
                          .toList();
                      next[i] = {...next[i], 'label': v, 'value': v};
                      onChanged(next);
                    },
                  ),
                ),
                if (!readOnly)
                  IconButton(
                    icon: Icon(Icons.close, size: 16, color: wa.textMuted),
                    onPressed: () {
                      final next =
                          buttons
                              .map((b) => Map<String, dynamic>.from(b))
                              .toList()
                            ..removeAt(i);
                      onChanged(next);
                    },
                  ),
              ],
            ),
          ),
        if (!readOnly)
          TextButton.icon(
            onPressed: () {
              final next = [
                ...buttons.map((b) => Map<String, dynamic>.from(b)),
                {
                  'id': 'b-${DateTime.now().microsecondsSinceEpoch}',
                  'type': 'reply',
                  'label': '$addLabel ${buttons.length + 1}',
                  'value': 'opcao${buttons.length + 1}',
                },
              ];
              onChanged(next);
            },
            icon: const Icon(Icons.add, size: 16),
            label: Text(addLabel),
          ),
      ],
    );
  }
}

// ─── Painters ────────────────────────────────────────────────────────

class _GridPainter extends CustomPainter {
  _GridPainter({required this.color});
  final Color color;
  static final Map<String, List<Offset>> _pointsCache = {};

  List<Offset> _pointsFor(Size size) {
    final key = '${size.width.round()}x${size.height.round()}';
    final cached = _pointsCache[key];
    if (cached != null) return cached;

    const step = 48.0;
    final points = <Offset>[];
    for (double x = 0; x <= size.width; x += step) {
      for (double y = 0; y <= size.height; y += step) {
        points.add(Offset(x, y));
      }
    }
    _pointsCache[key] = points;
    return points;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round;
    canvas.drawPoints(ui.PointMode.points, _pointsFor(size), paint);
  }

  @override
  bool shouldRepaint(covariant _GridPainter oldDelegate) =>
      oldDelegate.color != color;
}

class _GroupEdgesPainter extends CustomPainter {
  _GroupEdgesPainter({
    required this.groups,
    required this.edges,
    required this.fastMode,
    required Listenable repaint,
    required this.edgeColor,
    required this.activeColor,
    required this.selectedEdgeId,
    required this.connectingFromId,
    required this.connectCursor,
    required this.snapTargetGroupId,
    required this.animT,
    required this.connectingBranch,
    required this.outPortOf,
    required this.inPortOf,
  }) : super(repaint: repaint);

  final List<_CanvasGroup> groups;
  final List<Map<String, dynamic>> edges;
  final bool fastMode;
  final Color edgeColor;
  final Color activeColor;
  final String? selectedEdgeId;
  final String? connectingFromId;
  final Offset? connectCursor;
  final String? snapTargetGroupId;
  final double animT;
  final String connectingBranch;
  final Offset Function(String nodeId, {String branch}) outPortOf;
  final Offset Function(String nodeId) inPortOf;

  Path _bezierPath(Offset a, Offset b) {
    final dx = (b.dx - a.dx).abs().clamp(48.0, 220.0);
    return Path()
      ..moveTo(a.dx, a.dy)
      ..cubicTo(a.dx + dx, a.dy, b.dx - dx, b.dy, b.dx, b.dy);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final nodeGroup = <String, String>{};
    for (final g in groups) {
      for (final b in g.blocks) {
        final id = b['id']?.toString();
        if (id != null) nodeGroup[id] = g.id;
      }
    }

    for (final edge in edges) {
      final from = edge['from']?.toString();
      final to = edge['to']?.toString();
      final edgeId = edge['id']?.toString();
      if (from == null || to == null) continue;
      if (nodeGroup[from] != null && nodeGroup[from] == nodeGroup[to]) {
        continue;
      }
      final branch = edge['branch']?.toString() ?? 'default';
      final a = outPortOf(from, branch: branch);
      final b = inPortOf(to);
      final selected = edgeId != null && edgeId == selectedEdgeId;
      final path = _bezierPath(a, b);

      // Glow under selected / connecting.
      if (selected && !fastMode) {
        final glow = Paint()
          ..color = activeColor.withValues(alpha: 0.22)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 7
          ..strokeCap = StrokeCap.round
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);
        canvas.drawPath(path, glow);
      }

      final paint = Paint()
        ..color = selected ? activeColor : edgeColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = selected ? 2.8 : 2.3
        ..strokeCap = StrokeCap.round;
      canvas.drawPath(path, paint);
      _drawArrow(canvas, a, b, paint.color);

      // Pontinhos animados na linha selecionada (fluxo).
      if (selected && !fastMode) {
        _drawMarchingDots(canvas, path, activeColor, animT, strong: true);
      }
    }

    // Linha de conexão em andamento (tracejada + pontinhos).
    if (connectingFromId != null && connectCursor != null) {
      final a = outPortOf(connectingFromId!, branch: connectingBranch);
      final b = connectCursor!;
      final path = _bezierPath(a, b);
      final dashPaint = Paint()
        ..color = activeColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round;
      _drawDashedPath(canvas, path, dashPaint, animT);
      _drawMarchingDots(canvas, path, activeColor, animT, strong: true);
      // Cursor / snap halo
      final halo = Paint()
        ..color = activeColor.withValues(
          alpha: snapTargetGroupId != null ? 0.35 : 0.18,
        )
        ..style = PaintingStyle.fill;
      canvas.drawCircle(b, snapTargetGroupId != null ? 14 : 8, halo);
      canvas.drawCircle(b, 5, Paint()..color = activeColor);
    }
  }

  void _drawDashedPath(Canvas canvas, Path path, Paint paint, double t) {
    for (final metric in path.computeMetrics()) {
      const dash = 10.0;
      const gap = 7.0;
      final phase = t * (dash + gap);
      var distance = -phase;
      while (distance < metric.length) {
        final start = distance.clamp(0.0, metric.length);
        final end = (distance + dash).clamp(0.0, metric.length);
        if (end > start) {
          canvas.drawPath(metric.extractPath(start, end), paint);
        }
        distance += dash + gap;
      }
    }
  }

  void _drawMarchingDots(
    Canvas canvas,
    Path path,
    Color color,
    double t, {
    bool strong = false,
  }) {
    for (final metric in path.computeMetrics()) {
      if (metric.length < 8) continue;
      const spacing = 28.0;
      final offset = (t * spacing * 2) % spacing;
      var d = offset;
      while (d < metric.length) {
        final tan = metric.getTangentForOffset(d);
        if (tan != null) {
          canvas.drawCircle(
            tan.position,
            strong ? 3.2 : 2.4,
            Paint()..color = color,
          );
        }
        d += spacing;
      }
    }
  }

  void _drawArrow(Canvas canvas, Offset a, Offset b, Color color) {
    final angle = math.atan2(b.dy - a.dy, b.dx - a.dx);
    const len = 10.0;
    final path = Path()
      ..moveTo(b.dx, b.dy)
      ..lineTo(
        b.dx - len * math.cos(angle - 0.4),
        b.dy - len * math.sin(angle - 0.4),
      )
      ..lineTo(
        b.dx - len * math.cos(angle + 0.4),
        b.dy - len * math.sin(angle + 0.4),
      )
      ..close();
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = PaintingStyle.fill,
    );
  }

  @override
  bool shouldRepaint(covariant _GroupEdgesPainter old) {
    return old.animT != animT ||
        old.fastMode != fastMode ||
        old.selectedEdgeId != selectedEdgeId ||
        old.connectingFromId != connectingFromId ||
        old.connectCursor != connectCursor ||
        old.snapTargetGroupId != snapTargetGroupId ||
        old.edges != edges ||
        old.groups != groups;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

class _KindMeta {
  const _KindMeta(this.label, this.icon, this.color);
  final String label;
  final IconData icon;
  final Color color;
}

_KindMeta _metaForKind(String kind) {
  for (final item in kFlowPalette) {
    if (item.kind == kind) {
      return _KindMeta(item.label, item.icon, item.color);
    }
  }
  return const _KindMeta('Nó', Icons.extension_outlined, Color(0xFF8696A0));
}

String _nodeSubtitle(Map<String, dynamic> node) {
  final kind = (node['kind'] ?? '').toString();
  if (kind == 'trigger') {
    final t = (node['triggerType'] ?? 'command').toString();
    final v = (node['triggerValue'] ?? node['text'] ?? '').toString();
    return v.isEmpty ? t : '$t · $v';
  }
  if (kind == 'delay' || kind == 'smart_delay') {
    return '${node['delaySeconds'] ?? 0}s';
  }
  if (kind == 'http_request') {
    return '${node['httpMethod'] ?? 'GET'} ${node['httpUrl'] ?? ''}'.trim();
  }
  final text = (node['text'] ?? node['mediaUrl'] ?? node['variableName'] ?? '')
      .toString()
      .trim();
  if (text.isEmpty) return kind;
  return text.length > 40 ? '${text.substring(0, 40)}…' : text;
}

class _ToolBtn extends StatelessWidget {
  const _ToolBtn({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    return Tooltip(
      message: tooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active ? wa.accentSoft : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, size: 18, color: active ? wa.accent : wa.icon),
        ),
      ),
    );
  }
}

List<Map<String, dynamic>> _asMapList(Object? raw) {
  if (raw is! List) return const [];
  return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
}

String _flowPreviewMediaUrl(Map<String, dynamic> node) {
  const keys = [
    'mediaUrl',
    'buttonHeaderUrl',
    'buttonHeaderPath',
    'headerMediaUrl',
    'imageUrl',
    'thumbnail',
  ];
  for (final key in keys) {
    final value = (node[key] ?? '').toString().trim();
    if (value.isNotEmpty) return value;
  }
  return '';
}

String _resolveFlowMediaUrl(String raw) {
  final value = raw.trim();
  if (value.isEmpty) return value;
  if (value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('data:') ||
      value.startsWith('blob:')) {
    return value;
  }
  return Uri.base.resolve(value).toString();
}

String _guessFlowUploadMimeType(String fileName) {
  final lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}
