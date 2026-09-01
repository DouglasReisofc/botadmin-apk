import 'dart:convert';

import '../../core/theme_storage.dart';

const _storageKey = 'botadmin-flow-org';

/// Organização local de pastas de fluxos (client-side).
class FlowFolder {
  const FlowFolder({
    required this.id,
    required this.name,
    this.order = 0,
  });

  final String id;
  final String name;
  final int order;

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'order': order};

  factory FlowFolder.fromJson(Map<String, dynamic> json) {
    return FlowFolder(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? 'Pasta').toString(),
      order: json['order'] is int
          ? json['order'] as int
          : int.tryParse('${json['order']}') ?? 0,
    );
  }
}

class FlowOrgState {
  const FlowOrgState({
    this.folders = const [],
    this.assignments = const {},
  });

  final List<FlowFolder> folders;
  /// flowId (string) → folderId
  final Map<String, String> assignments;

  FlowOrgState copyWith({
    List<FlowFolder>? folders,
    Map<String, String>? assignments,
  }) {
    return FlowOrgState(
      folders: folders ?? this.folders,
      assignments: assignments ?? this.assignments,
    );
  }
}

FlowOrgState loadFlowOrg() {
  try {
    final raw = readThemeStorage(_storageKey);
    if (raw == null || raw.trim().isEmpty) return const FlowOrgState();
    final json = jsonDecode(raw);
    if (json is! Map) return const FlowOrgState();
    final foldersRaw = json['folders'];
    final folders = <FlowFolder>[];
    if (foldersRaw is List) {
      for (final item in foldersRaw) {
        if (item is Map) {
          final folder = FlowFolder.fromJson(
            item is Map<String, dynamic>
                ? item
                : item.cast<String, dynamic>(),
          );
          if (folder.id.isNotEmpty) folders.add(folder);
        }
      }
    }
    folders.sort((a, b) => a.order.compareTo(b.order));
    final assignments = <String, String>{};
    final assignRaw = json['assignments'];
    if (assignRaw is Map) {
      assignRaw.forEach((key, value) {
        final k = key.toString();
        final v = value?.toString() ?? '';
        if (k.isNotEmpty && v.isNotEmpty) assignments[k] = v;
      });
    }
    return FlowOrgState(folders: folders, assignments: assignments);
  } catch (_) {
    return const FlowOrgState();
  }
}

void saveFlowOrg(FlowOrgState state) {
  try {
    final payload = {
      'folders': state.folders.map((f) => f.toJson()).toList(),
      'assignments': state.assignments,
    };
    writeThemeStorage(_storageKey, jsonEncode(payload));
  } catch (_) {
    // ignore
  }
}
