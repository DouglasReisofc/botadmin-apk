import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/wa_theme.dart';
import '../../models/chat_message.dart';
import '../../models/conversation_thread.dart';
import '../chat/chat_screen.dart';

/// Superadmin view of the WhatsApp number connected to the administrative
/// Meta account. The message body is the exact [ChatScreen] used by the user
/// dashboard; this widget only supplies an administrative instance picker and
/// its existing conversation index.
class AdminInstanceConversationsWorkspace extends ConsumerStatefulWidget {
  const AdminInstanceConversationsWorkspace({super.key});

  @override
  ConsumerState<AdminInstanceConversationsWorkspace> createState() =>
      _AdminInstanceConversationsWorkspaceState();
}

class _AdminInstanceConversationsWorkspaceState
    extends ConsumerState<AdminInstanceConversationsWorkspace>
    with WidgetsBindingObserver {
  final _search = TextEditingController();
  Timer? _refreshTimer;
  List<_MetaConversationInstance> _instances = const [];
  List<ConversationThread> _threads = const [];
  ConversationThread? _selected;
  int? _instanceId;
  String _filter = 'all';
  String _query = '';
  bool _loadingInstances = true;
  bool _loadingThreads = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_loadInstances());
    _refreshTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (_instanceId != null && !_loadingThreads) {
        unawaited(_loadThreads(silent: true));
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    _search.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _instanceId != null) {
      unawaited(_loadThreads(silent: true));
    }
  }

  Future<void> _loadInstances() async {
    setState(() {
      _loadingInstances = true;
      _error = null;
    });
    try {
      final json = await ref
          .read(apiClientProvider)
          .getJson('/api/meta/connection');
      final rows = <_MetaConversationInstance>[];
      final knownIds = <int>{};
      for (final raw
          in (json['connections'] as List? ?? const []).whereType<Map>()) {
        final meta = _MetaConversationInstance.fromJson(raw);
        if (meta.connected &&
            meta.instanceId > 0 &&
            knownIds.add(meta.instanceId)) {
          rows.add(meta);
        }
        final peerId = raw['coexistencePeerId'] ?? raw['meshPeerId'];
        final coexistencePeerId = peerId is num
            ? peerId.toInt()
            : int.tryParse('$peerId');
        if (meta.connected &&
            coexistencePeerId != null &&
            coexistencePeerId > 0 &&
            knownIds.add(coexistencePeerId)) {
          rows.add(
            _MetaConversationInstance(
              instanceId: coexistencePeerId,
              label: '${meta.label} · Bot coexistente',
              connected: true,
              isCoexistenceBot: true,
            ),
          );
        }
      }
      if (!mounted) return;
      final preferredId = (json['connection'] as Map?)?['instanceId'];
      final preferred = preferredId is num
          ? preferredId.toInt()
          : int.tryParse('$preferredId');
      final keepCurrent = rows.any((row) => row.instanceId == _instanceId);
      final coexistenceBotId = rows
          .where((row) => row.isCoexistenceBot)
          .firstOrNull
          ?.instanceId;
      final initial = keepCurrent
          ? _instanceId
          : coexistenceBotId ??
                (rows.any((row) => row.instanceId == preferred)
                    ? preferred
                    : rows.firstOrNull?.instanceId);
      setState(() {
        _instances = rows;
        _instanceId = initial;
        _loadingInstances = false;
      });
      if (initial != null) await _loadThreads();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingInstances = false;
        _error = error;
      });
    }
  }

  Future<void> _loadThreads({bool silent = false}) async {
    final instanceId = _instanceId;
    if (instanceId == null) return;
    if (!silent) setState(() => _loadingThreads = true);
    try {
      final rows = await ref
          .read(apiClientProvider)
          .loadConversationThreadsForInstance(instanceId, syncDirectory: true);
      if (!mounted || instanceId != _instanceId) return;
      final selectedKey = _selected == null ? null : _threadKey(_selected!);
      final nextSelected = selectedKey == null
          ? null
          : rows.where((item) => _threadKey(item) == selectedKey).firstOrNull;
      setState(() {
        _threads = rows;
        _selected = nextSelected ?? _selected;
        _error = null;
      });
    } catch (error) {
      if (!mounted || instanceId != _instanceId) return;
      setState(() => _error = error);
    } finally {
      if (mounted && instanceId == _instanceId && !silent) {
        setState(() => _loadingThreads = false);
      }
    }
  }

  void _selectInstance(int? id) {
    if (id == null || id == _instanceId) return;
    setState(() {
      _instanceId = id;
      _threads = const [];
      _selected = null;
      _error = null;
    });
    unawaited(_loadThreads());
  }

  List<ConversationThread> get _visibleThreads {
    final normalized = _query.trim().toLowerCase();
    return _threads
        .where((thread) {
          if (!thread.isSafeConversationListItem) return false;
          final matchesFilter = switch (_filter) {
            'unread' => thread.unreadCount > 0,
            'groups' => thread.isGroup,
            'private' => thread.isContact,
            'pinned' => thread.pinned,
            'archived' => thread.archived,
            _ => true,
          };
          if (!matchesFilter) return false;
          if (normalized.isEmpty) return true;
          return '${thread.title} ${thread.phone ?? ''} ${thread.lastMessage}'
              .toLowerCase()
              .contains(normalized);
        })
        .toList(growable: false)
      ..sort((a, b) {
        if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
        return b.lastActivity.compareTo(a.lastActivity);
      });
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 820;
    if (_loadingInstances) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_instances.isEmpty) {
      return _NoMetaConversationConnection(onRetry: _loadInstances);
    }
    final list = _buildListPane(context, wa);
    if (compact && _selected != null) {
      return _buildChat(
        _selected!,
        leading: IconButton(
          tooltip: 'Voltar para conversas',
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => setState(() => _selected = null),
        ),
      );
    }
    return Row(
      children: [
        SizedBox(
          width: compact ? MediaQuery.sizeOf(context).width : 390,
          child: list,
        ),
        if (!compact)
          Expanded(
            child: _selected == null
                ? _AdminConversationEmpty(
                    instance: _instances.firstWhere(
                      (row) => row.instanceId == _instanceId,
                    ),
                  )
                : _buildChat(_selected!),
          ),
      ],
    );
  }

  Widget _buildListPane(BuildContext context, WaTheme wa) {
    final visible = _visibleThreads;
    final selectedInstance = _instances.firstWhere(
      (row) => row.instanceId == _instanceId,
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wa.panel,
        border: Border(right: BorderSide(color: wa.divider)),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 12, 10),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: wa.accentSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.forum_rounded, color: wa.accent),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Conversas do WhatsApp',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                      Text(
                        'Instância da API Meta do painel',
                        style: TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Atualizar conversas',
                  onPressed: _loadingThreads ? null : () => _loadThreads(),
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: DropdownButtonFormField<int>(
              initialValue: _instanceId,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Número conectado',
                prefixIcon: Icon(Icons.verified_outlined),
              ),
              items: _instances
                  .map(
                    (item) => DropdownMenuItem(
                      value: item.instanceId,
                      child: Text(item.label, overflow: TextOverflow.ellipsis),
                    ),
                  )
                  .toList(growable: false),
              onChanged: _selectInstance,
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
            child: TextField(
              controller: _search,
              onChanged: (value) => setState(() => _query = value),
              decoration: InputDecoration(
                hintText: 'Pesquisar conversa',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Limpar pesquisa',
                        icon: const Icon(Icons.close_rounded),
                        onPressed: () {
                          _search.clear();
                          setState(() => _query = '');
                        },
                      ),
              ),
            ),
          ),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              children: [
                for (final item in const [
                  ('all', 'Todas'),
                  ('unread', 'Não lidas'),
                  ('private', 'Privadas'),
                  ('groups', 'Grupos'),
                  ('pinned', 'Fixadas'),
                  ('archived', 'Arquivadas'),
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 7),
                    child: ChoiceChip(
                      label: Text(item.$2),
                      selected: _filter == item.$1,
                      onSelected: (_) => setState(() => _filter = item.$1),
                    ),
                  ),
              ],
            ),
          ),
          if (_loadingThreads) const LinearProgressIndicator(minHeight: 2),
          if (_error != null)
            _ConversationLoadWarning(error: _error!, onRetry: _loadThreads),
          Expanded(
            child: visible.isEmpty
                ? _ConversationListEmpty(
                    label: selectedInstance.label,
                    hasSearch: _query.isNotEmpty || _filter != 'all',
                  )
                : RefreshIndicator(
                    onRefresh: _loadThreads,
                    child: ListView.builder(
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: visible.length,
                      itemBuilder: (context, index) {
                        final thread = visible[index];
                        return _ConversationTile(
                          thread: thread,
                          selected: _threadKey(thread) == _threadKey(_selected),
                          onTap: () => setState(() => _selected = thread),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildChat(ConversationThread thread, {Widget? leading}) => ChatScreen(
    thread: thread,
    leading: leading,
    onOpenThreadJid: (jid) => _openThread(jid),
    onOpenParticipantConversation: (jid, name) => _openThread(jid, title: name),
    onOpenContact: (ChatContactCard contact) =>
        _openThread(contact.whatsappJid, title: contact.displayName),
  );

  void _openThread(String jid, {String? title}) {
    final clean = jid.trim();
    if (clean.isEmpty || _instanceId == null) return;
    final existing = _threads
        .where((thread) => thread.chatJid == clean)
        .firstOrNull;
    setState(
      () => _selected =
          existing ??
          ConversationThread(
            instanceId: _instanceId!,
            chatJid: clean,
            title: title?.trim().isNotEmpty == true
                ? title!.trim()
                : clean.split('@').first,
            lastMessage: '',
            lastActivity: DateTime.now(),
            unreadCount: 0,
            chatType: clean.endsWith('@g.us') ? 'group' : 'contact',
          ),
    );
  }
}

class _MetaConversationInstance {
  const _MetaConversationInstance({
    required this.instanceId,
    required this.label,
    required this.connected,
    this.isCoexistenceBot = false,
  });
  final int instanceId;
  final String label;
  final bool connected;
  final bool isCoexistenceBot;

  factory _MetaConversationInstance.fromJson(Map row) {
    final instanceId = row['instanceId'] is num
        ? (row['instanceId'] as num).toInt()
        : int.tryParse('${row['instanceId']}') ?? 0;
    final phone = '${row['displayPhoneNumber'] ?? ''}'.trim();
    final fallback = '${row['phoneNumberId'] ?? ''}'.trim();
    return _MetaConversationInstance(
      instanceId: instanceId,
      label: phone.isNotEmpty
          ? phone
          : (fallback.isNotEmpty ? fallback : 'Perfil Meta #$instanceId'),
      connected: '${row['status']}'.toLowerCase() == 'connected',
    );
  }
}

String _threadKey(ConversationThread? thread) =>
    thread == null ? '' : '${thread.instanceId}:${thread.chatJid}';

class _ConversationTile extends StatelessWidget {
  const _ConversationTile({
    required this.thread,
    required this.selected,
    required this.onTap,
  });
  final ConversationThread thread;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final initials = thread.title.trim().isEmpty
        ? '?'
        : thread.title.trim().substring(0, 1).toUpperCase();
    return Material(
      color: selected ? wa.selectedRow : wa.panel,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
          child: Row(
            children: [
              SizedBox.square(
                dimension: 48,
                child: ClipOval(
                  child: thread.avatarUrl?.trim().isNotEmpty == true
                      ? BotAdminCachedImage(
                          imageUrl: thread.avatarUrl!,
                          fit: BoxFit.cover,
                        )
                      : ColoredBox(
                          color: wa.accentSoft,
                          child: Center(
                            child: Text(
                              initials,
                              style: TextStyle(
                                color: wa.accent,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            thread.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Text(
                          _threadTime(thread.lastActivity),
                          style: TextStyle(color: wa.textMuted, fontSize: 11),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        if (thread.pinned)
                          Padding(
                            padding: const EdgeInsets.only(right: 4),
                            child: Icon(
                              Icons.push_pin_rounded,
                              size: 13,
                              color: wa.textMuted,
                            ),
                          ),
                        Expanded(
                          child: Text(
                            thread.previewText.isEmpty
                                ? thread.conversationTypeLabel
                                : thread.previewText,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: wa.textMuted,
                              fontSize: 12.5,
                            ),
                          ),
                        ),
                        if (thread.unreadCount > 0)
                          Container(
                            margin: const EdgeInsets.only(left: 8),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: wa.accent,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              '${thread.unreadCount}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
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

String _threadTime(DateTime value) {
  final now = DateTime.now();
  if (value.year == now.year &&
      value.month == now.month &&
      value.day == now.day) {
    return '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
  }
  return '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}';
}

class _NoMetaConversationConnection extends StatelessWidget {
  const _NoMetaConversationConnection({required this.onRetry});
  final Future<void> Function() onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.mark_chat_unread_outlined, size: 48),
          const SizedBox(height: 12),
          const Text(
            'Conecte o WhatsApp do painel à Meta para acessar as conversas.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Verificar novamente'),
          ),
        ],
      ),
    ),
  );
}

class _AdminConversationEmpty extends StatelessWidget {
  const _AdminConversationEmpty({required this.instance});
  final _MetaConversationInstance instance;
  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.forum_outlined, size: 52),
        const SizedBox(height: 12),
        Text(
          'Selecione uma conversa de ${instance.label}.',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 4),
        const Text(
          'O atendimento usa a mesma tela e o mesmo histórico do painel do usuário.',
        ),
      ],
    ),
  );
}

class _ConversationListEmpty extends StatelessWidget {
  const _ConversationListEmpty({required this.label, required this.hasSearch});
  final String label;
  final bool hasSearch;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Text(
        hasSearch
            ? 'Nenhuma conversa corresponde aos filtros.'
            : 'Ainda não há conversas sincronizadas para $label.',
        textAlign: TextAlign.center,
      ),
    ),
  );
}

class _ConversationLoadWarning extends StatelessWidget {
  const _ConversationLoadWarning({required this.error, required this.onRetry});
  final Object error;
  final Future<void> Function() onRetry;
  @override
  Widget build(BuildContext context) => MaterialBanner(
    content: const Text('Não foi possível atualizar as conversas agora.'),
    actions: [TextButton(onPressed: onRetry, child: const Text('Tentar'))],
  );
}
