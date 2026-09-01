import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../models/bot_instance.dart';
import '../../models/migration_models.dart';

/// Item de chamada (ativa ou recente) vinculado a uma instância.
class LiveCallItem {
  const LiveCallItem({required this.instance, required this.call});

  final BotInstance instance;
  final WhatsappCallRecord call;

  String get key => '${instance.id}|${call.key}';
}

/// Snapshot de chamadas ao vivo (polling leve).
class LiveCallsSnapshot {
  const LiveCallsSnapshot({
    this.items = const [],
    this.loading = false,
    this.error,
  });

  final List<LiveCallItem> items;
  final bool loading;
  final Object? error;

  List<LiveCallItem> get ringing =>
      items.where((item) => item.call.isRinging).toList(growable: false);

  List<LiveCallItem> get active => items
      .where((item) => item.call.isLive && !item.call.isRinging)
      .toList(growable: false);

  List<LiveCallItem> get history =>
      items.where((item) => item.call.isTerminal).toList(growable: false);
}

class LiveCallsController extends Notifier<LiveCallsSnapshot> {
  Timer? _timer;
  int _generation = 0;
  bool _inFlight = false;
  List<BotInstance> _instances = const [];

  @override
  LiveCallsSnapshot build() {
    ref.onDispose(() {
      _timer?.cancel();
      _timer = null;
    });
    return const LiveCallsSnapshot(loading: true);
  }

  void bindInstances(List<BotInstance> instances) {
    _instances = instances;
    if (_timer == null) {
      _timer = Timer.periodic(
        const Duration(seconds: 3),
        (_) => unawaited(refresh(silent: true)),
      );
      unawaited(refresh(showLoading: true));
    } else {
      unawaited(refresh(silent: true));
    }
  }

  Future<void> refresh({bool showLoading = false, bool silent = false}) async {
    if (_inFlight) return;
    final connected = _instances
        .where((instance) => instance.isConnected)
        .toList();
    if (connected.isEmpty) {
      state = const LiveCallsSnapshot();
      return;
    }

    final generation = ++_generation;
    _inFlight = true;
    if (showLoading && state.items.isEmpty) {
      state = LiveCallsSnapshot(items: state.items, loading: true);
    }

    try {
      final api = ref.read(apiClientProvider);
      final data = await api.loadCallsForInstances(connected);
      if (generation != _generation) return;

      final items = <LiveCallItem>[];
      for (final snapshot in data) {
        for (final call in snapshot.calls) {
          if (call.id.trim().isEmpty && call.chatJid.trim().isEmpty) continue;
          items.add(LiveCallItem(instance: snapshot.instance, call: call));
        }
      }
      items.sort((a, b) {
        final aTime = a.call.timestamp?.millisecondsSinceEpoch ?? 0;
        final bTime = b.call.timestamp?.millisecondsSinceEpoch ?? 0;
        return bTime.compareTo(aTime);
      });

      state = LiveCallsSnapshot(items: items);
    } catch (error) {
      if (generation != _generation) return;
      state = LiveCallsSnapshot(
        items: state.items,
        error: error,
        loading: false,
      );
    } finally {
      _inFlight = false;
    }
  }

  void addOptimisticOutgoing({
    required BotInstance instance,
    required String chatJid,
    bool video = false,
  }) {
    final normalizedChat = chatJid.trim();
    if (normalizedChat.isEmpty) return;
    final now = DateTime.now();
    final optimistic = LiveCallItem(
      instance: instance,
      call: WhatsappCallRecord(
        id: 'local-${instance.id}-${now.microsecondsSinceEpoch}',
        chatJid: normalizedChat,
        direction: 'outgoing',
        status: 'calling',
        isVideo: video,
        timestamp: now,
        displayName: normalizedChat.replaceAll('@s.whatsapp.net', ''),
        phone: normalizedChat.replaceAll(RegExp(r'\D+'), ''),
        raw: const {'direction': 'outgoing', 'status': 'calling'},
      ),
    );
    final next = [
      optimistic,
      ...state.items.where(
        (item) =>
            item.instance.id != instance.id ||
            item.call.chatJid.trim().toLowerCase() !=
                normalizedChat.toLowerCase() ||
            item.call.isTerminal,
      ),
    ];
    state = LiveCallsSnapshot(items: next, loading: state.loading);
  }
}

final liveCallsControllerProvider =
    NotifierProvider<LiveCallsController, LiveCallsSnapshot>(
      LiveCallsController.new,
    );
