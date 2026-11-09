import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../core/botadmin_cached_image.dart';
import '../../core/wa_theme.dart';
import '../../models/admin_support.dart';
import '../../models/chat_message.dart';
import '../../models/conversation_thread.dart';
import '../chat/chat_screen.dart';
import 'admin_conversation_inbox.dart';

class AdminInstanceConversationsWorkspace extends ConsumerStatefulWidget {
  const AdminInstanceConversationsWorkspace({
    super.key,
    required this.supportThreads,
    required this.selectedSupportThread,
    required this.onSelectSupport,
    required this.onRefreshSupport,
    required this.supportConversationBuilder,
    required this.supportThreadBuilder,
  });
  final AsyncValue<List<AdminSupportThreadEntry>> supportThreads;
  final AdminSupportThreadEntry? selectedSupportThread;
  final ValueChanged<AdminSupportThreadEntry?> onSelectSupport;
  final Future<void> Function() onRefreshSupport;
  final Widget Function(AdminSupportThreadEntry entry, Widget? leading)
  supportConversationBuilder;
  final Widget Function(
    AdminSupportThreadEntry entry,
    bool selected,
    VoidCallback onTap,
    AdminInboxConversation conversation,
  )
  supportThreadBuilder;
  @override
  ConsumerState<AdminInstanceConversationsWorkspace> createState() =>
      AdminInstanceConversationsWorkspaceState();
}

class AdminInstanceConversationsWorkspaceState
    extends ConsumerState<AdminInstanceConversationsWorkspace>
    with WidgetsBindingObserver {
  final _search = TextEditingController();
  Timer? _refreshTimer;
  List<_MetaConversationInstance> _instances = const [];
  final Map<int, List<ConversationThread>> _threads = {};
  AdminInboxChannel? _selected;
  String? _source;
  String _filter = 'all';
  String _query = '';
  bool _loadingInstances = true;
  bool _loadingThreads = false;
  Object? _error;
  Object? _instanceError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_loadInstances());
    _refreshTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (!_loadingInstances && !_loadingThreads) {
        unawaited(_refresh(silent: true));
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
    if (state == AppLifecycleState.resumed) unawaited(_refresh(silent: true));
  }

  bool closeConversation() {
    if (_activeChannel == null) return false;
    widget.onSelectSupport(null);
    setState(() => _selected = null);
    return true;
  }

  AdminInboxChannel? get _activeChannel {
    final support = widget.selectedSupportThread;
    if (support != null) return AdminInboxChannel.support(support);
    return _selected?.whatsapp == null ? null : _selected;
  }

  List<AdminInboxConversation> get _inbox => buildAdminConversationInbox([
    for (final support
        in widget.supportThreads.value ?? const <AdminSupportThreadEntry>[])
      AdminInboxChannel.support(support),
    for (final instance in _instances)
      for (final thread
          in _threads[instance.instanceId] ?? const <ConversationThread>[])
        AdminInboxChannel.whatsapp(thread, instance.label),
  ]);
  void _selectChannel(AdminInboxChannel channel) {
    widget.onSelectSupport(channel.support);
    setState(() => _selected = channel);
  }

  Future<void> _loadInstances() async {
    if (!mounted) return;
    setState(() => _loadingInstances = true);
    final api = ref.read(apiClientProvider);
    Object? loadError;
    final directories = await Future.wait([
      api.getJson('/api/meta/connection').catchError((Object error) {
        loadError = error;
        return <String, dynamic>{};
      }),
      api.getJson('/api/bot-instances?refreshStatus=0').catchError((
        Object error,
      ) {
        loadError = error;
        return <String, dynamic>{};
      }),
    ]);
    if (!mounted) return;
    final rows = <int, _MetaConversationInstance>{};
    final metaPhones = <String>{};
    for (final raw
        in (directories[0]['connections'] as List? ?? const [])
            .whereType<Map>()) {
      final meta = _MetaConversationInstance.fromJson(raw);
      if (meta.instanceId <= 0) continue;
      rows[meta.instanceId] = meta;
      final phone = '${raw['displayPhoneNumber'] ?? ''}'.replaceAll(
        RegExp(r'\D'),
        '',
      );
      if (phone.isNotEmpty) metaPhones.add(phone);
      final peer = raw['coexistencePeerId'] ?? raw['meshPeerId'];
      final peerId = peer is num ? peer.toInt() : int.tryParse('$peer');
      if (peerId != null && peerId > 0) {
        rows.putIfAbsent(
          peerId,
          () => _MetaConversationInstance(
            instanceId: peerId,
            label: 'Bot · $phone',
            connected: false,
            isCoexistenceBot: true,
          ),
        );
      }
    }
    for (final raw
        in (directories[1]['instances'] as List? ?? const [])
            .whereType<Map>()) {
      final id = raw['id'] is num
          ? (raw['id'] as num).toInt()
          : int.tryParse('${raw['id']}');
      if (id == null || id <= 0) continue;
      final phone = '${raw['phone'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
      final isBot =
          raw['purpose'] == 'admin_system' ||
          rows[id]?.isCoexistenceBot == true;
      if (!isBot && (!metaPhones.contains(phone) || rows.containsKey(id))) {
        continue;
      }
      rows[id] = _MetaConversationInstance(
        instanceId: id,
        label: 'Bot · ${phone.isEmpty ? raw['name'] ?? '#$id' : phone}',
        connected: const ['connected', 'conectado'].contains(
          '${raw['sessionStatus'] ?? raw['session_status']}'.toLowerCase(),
        ),
        isCoexistenceBot: true,
      );
    }
    setState(() {
      if (loadError != null) {
        for (final existing in _instances) {
          rows.putIfAbsent(existing.instanceId, () => existing);
        }
      }
      _instances = rows.values.toList();
      if (_source != null &&
          _source != 'support' &&
          !_instances.any((row) => _source == 'instance:${row.instanceId}')) {
        _source = null;
      }
      _loadingInstances = false;
      _instanceError = loadError;
    });
    await _loadThreads();
  }

  Future<void> _loadThreads() async {
    if (_loadingThreads || !mounted) return;
    setState(() => _loadingThreads = true);
    Object? loadError;
    await Future.wait(
      _instances.map((instance) async {
        try {
          final rows = await ref
              .read(apiClientProvider)
              .loadConversationThreadsForInstance(instance.instanceId);
          if (mounted) setState(() => _threads[instance.instanceId] = rows);
        } catch (error) {
          loadError = error;
        }
      }),
    );
    if (!mounted) return;
    setState(() {
      _loadingThreads = false;
      _error = loadError;
      final selected = _selected?.whatsapp;
      if (selected != null) {
        final updated =
            (_threads[selected.instanceId] ?? const <ConversationThread>[])
                .where((thread) => _threadKey(thread) == _threadKey(selected))
                .firstOrNull;
        if (updated != null) {
          _selected = AdminInboxChannel.whatsapp(updated, _selected!.label);
        }
      }
    });
  }

  Future<void> _refresh({bool silent = false}) async {
    await Future.wait([
      widget.onRefreshSupport().catchError((Object error) {
        if (mounted) setState(() => _error = error);
      }),
      if (silent) _loadThreads() else _loadInstances(),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final wa = WaTheme.of(context);
    final inbox = _inbox;
    final active = _activeChannel;
    final conversation = inbox
        .where(
          (item) => item.channels.any((channel) => channel.key == active?.key),
        )
        .firstOrNull;
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 820;
        final leading = compact
            ? IconButton(
                tooltip: 'Voltar para conversas',
                icon: const Icon(Icons.arrow_back_rounded),
                onPressed: closeConversation,
              )
            : null;
        final pane = active == null
            ? const _AdminConversationEmpty()
            : Column(
                children: [
                  if (conversation != null && conversation.channels.length > 1)
                    Container(
                      width: double.infinity,
                      color: wa.panel,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          for (final channel in conversation.channels)
                            ChoiceChip(
                              label: Text(channel.label),
                              selected: channel.key == active.key,
                              onSelected: (_) => _selectChannel(channel),
                            ),
                        ],
                      ),
                    ),
                  Expanded(
                    child: active.support != null
                        ? widget.supportConversationBuilder(
                            active.support!,
                            leading,
                          )
                        : _buildChat(active.whatsapp!, leading: leading),
                  ),
                ],
              );
        if (compact && active != null) return pane;
        final list = _buildListPane(context, wa, inbox, conversation);
        return Row(
          children: [
            if (compact)
              Expanded(child: list)
            else
              SizedBox(width: 400, child: list),
            if (!compact) Expanded(child: pane),
          ],
        );
      },
    );
  }

  Widget _buildListPane(
    BuildContext context,
    WaTheme wa,
    List<AdminInboxConversation> inbox,
    AdminInboxConversation? selected,
  ) {
    final visible = inbox
        .where(
          (item) =>
              item.matches(query: _query, filter: _filter, source: _source),
        )
        .toList();
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
                Icon(Icons.forum_rounded, color: wa.accent),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Conversas',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 18,
                        ),
                      ),
                      Text(
                        'Suporte · Meta · Bot',
                        style: TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Atualizar conversas',
                  onPressed: _loadingThreads ? null : () => _refresh(),
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: DropdownButtonFormField<String>(
              key: ValueKey('source:${_source ?? 'all'}:${_instances.length}'),
              initialValue: _source ?? 'all',
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Canal',
                prefixIcon: Icon(Icons.hub_outlined),
              ),
              items: [
                const DropdownMenuItem(
                  value: 'all',
                  child: Text('Todos os canais'),
                ),
                const DropdownMenuItem(
                  value: 'support',
                  child: Text('Suporte'),
                ),
                for (final instance in _instances)
                  DropdownMenuItem(
                    value: 'instance:${instance.instanceId}',
                    child: Text(
                      '${instance.label}${instance.connected ? '' : ' · offline'}',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (value) => setState(() {
                _source = value == 'all' ? null : value;
                _filter = 'all';
              }),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
            child: TextField(
              controller: _search,
              onChanged: (value) => setState(() => _query = value),
              decoration: InputDecoration(
                hintText: 'Pesquisar nome, e-mail ou WhatsApp',
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
                  ('open', 'Abertos'),
                  ('closed', 'Fechados'),
                  ('human', 'Humano'),
                  ('bot', 'Bot'),
                  ('subscription_active', 'Assinatura ativa'),
                  ('subscription_inactive', 'Sem assinatura'),
                  ('account_active', 'Conta ativa'),
                  ('account_blocked', 'Conta bloqueada'),
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
          if (_loadingThreads ||
              _loadingInstances ||
              widget.supportThreads.isLoading)
            const LinearProgressIndicator(minHeight: 2),
          if (_error != null ||
              _instanceError != null ||
              widget.supportThreads.hasError)
            _ConversationLoadWarning(
              error: _error ?? _instanceError ?? widget.supportThreads.error!,
              onRetry: _refresh,
            ),
          Expanded(
            child: visible.isEmpty
                ? _ConversationListEmpty(
                    label: 'os canais selecionados',
                    hasSearch: _query.isNotEmpty || _filter != 'all',
                  )
                : RefreshIndicator(
                    onRefresh: _refresh,
                    child: ListView.builder(
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: visible.length,
                      itemBuilder: (context, index) {
                        final item = visible[index];
                        final support = item.channels
                            .where((channel) => channel.support != null)
                            .firstOrNull
                            ?.support;
                        final preferred = _source == null
                            ? item.latest
                            : item.channels
                                  .where(
                                    (channel) => channel.support != null
                                        ? _source == 'support'
                                        : _source ==
                                              'instance:${channel.whatsapp!.instanceId}',
                                  )
                                  .first;
                        void open() => _selectChannel(preferred);
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (support != null)
                              widget.supportThreadBuilder(
                                support,
                                selected?.key == item.key,
                                open,
                                item,
                              )
                            else
                              _ConversationTile(
                                thread: item.latest.whatsapp!.copyWith(
                                  unreadCount: item.unreadCount,
                                ),
                                selected: selected?.key == item.key,
                                onTap: open,
                              ),
                            Padding(
                              padding: const EdgeInsets.fromLTRB(78, 0, 16, 6),
                              child: Text(
                                item.labels,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: wa.accent,
                                  fontSize: 11,
                                ),
                              ),
                            ),
                          ],
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
    key: ValueKey('whatsapp:${_threadKey(thread)}'),
    thread: thread,
    leading: leading,
    onOpenThreadJid: (jid) => _openThread(jid),
    onOpenParticipantConversation: (jid, name) => _openThread(jid, title: name),
    onOpenContact: (ChatContactCard contact) =>
        _openThread(contact.whatsappJid, title: contact.displayName),
  );
  void _openThread(String jid, {String? title}) {
    final clean = jid.trim();
    final active = _activeChannel;
    final instanceId = active?.whatsapp?.instanceId;
    if (clean.isEmpty || instanceId == null) return;
    final existing = (_threads[instanceId] ?? const <ConversationThread>[])
        .where((thread) => thread.chatJid == clean)
        .firstOrNull;
    _selectChannel(
      AdminInboxChannel.whatsapp(
        existing ??
            ConversationThread(
              instanceId: instanceId,
              chatJid: clean,
              title: title?.trim().isNotEmpty == true
                  ? title!.trim()
                  : clean.split('@').first,
              lastMessage: '',
              lastActivity: DateTime.now(),
              unreadCount: 0,
              chatType: clean.endsWith('@g.us') ? 'group' : 'contact',
            ),
        active!.label,
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
      label:
          'Meta · ${phone.isNotEmpty ? phone : (fallback.isNotEmpty ? fallback : '#$instanceId')}',
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

class _AdminConversationEmpty extends StatelessWidget {
  const _AdminConversationEmpty();
  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.forum_outlined, size: 52),
        const SizedBox(height: 12),
        const Text(
          'Selecione uma conversa.',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 4),
        const Text('Suporte, Meta e Bot em um só lugar.'),
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
