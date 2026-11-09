import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_panel/src/core/api_client.dart';
import 'package:flutter_panel/src/features/admin/admin_conversation_inbox.dart';
import 'package:flutter_panel/src/features/admin/admin_instance_conversations_workspace.dart';
import 'package:flutter_panel/src/models/admin_support.dart';
import 'package:flutter_panel/src/models/conversation_thread.dart';

const phone = '5511987654321';
AdminSupportThreadEntry support({int userId = 10, String? number = phone}) =>
    AdminSupportThreadEntry(
      user: AdminSupportUser(
        id: userId,
        name: 'Cliente $userId',
        email: 'cliente$userId@example.test',
        whatsappNumber: number,
        hasActiveSubscription: true,
      ),
      thread: const AdminSupportThreadSummary(
        whatsappId: '__admin__',
        isAdminThread: true,
        status: 'open',
        handlingMode: 'human',
        within24h: true,
        minutesLeft24h: 100,
        lastMessagePreview: 'Mensagem do suporte',
        lastMessageAt: '2026-11-09T09:00:00Z',
        unreadCount: 2,
      ),
    );

ConversationThread whatsapp(
  int id, {
  String jid = '$phone@s.whatsapp.net',
  int unread = 3,
  bool pinned = false,
}) => ConversationThread(
  instanceId: id,
  chatJid: jid,
  title: 'Contato WhatsApp',
  lastMessage: 'Mensagem do WhatsApp',
  lastActivity: DateTime.parse('2026-11-09T10:00:00Z'),
  unreadCount: unread,
  pinned: pinned,
);

class InboxApi extends Fake implements BotAdminApiClient {
  InboxApi({this.metaFails = false});
  final bool metaFails;
  final loaded = <int>[];
  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    if (path == '/api/meta/connection') {
      if (metaFails) throw Exception('Meta indisponível');
      return {
        'connections': [
          {
            'instanceId': 666,
            'displayPhoneNumber': phone,
            'status': 'connected',
          },
        ],
      };
    }
    return {
      'instances': [
        {
          'id': 554,
          'phone': phone,
          'purpose': 'admin_system',
          'sessionStatus': 'desconectado',
        },
      ],
    };
  }

  @override
  Future<List<ConversationThread>> loadConversationThreadsForInstance(
    int instanceId, {
    bool syncDirectory = false,
    Duration syncTimeout = const Duration(seconds: 18),
  }) async {
    loaded.add(instanceId);
    expect(
      syncDirectory,
      false,
    ); // Never reconnect a logged-out bot for the inbox.
    return [whatsapp(instanceId)];
  }
}

void main() {
  test(
    'one contact combines support, Meta and Bot without losing channel identities',
    () {
      final inbox = buildAdminConversationInbox([
        AdminInboxChannel.support(support()),
        AdminInboxChannel.whatsapp(whatsapp(666), 'Meta'),
        AdminInboxChannel.whatsapp(whatsapp(554, jid: '$phone@c.us'), 'Bot'),
      ]);
      expect(inbox, hasLength(1));
      expect(inbox.single.channels, hasLength(3));
      expect(
        inbox.single.channels.map((channel) => channel.key).toSet(),
        hasLength(3),
      );
      expect(inbox.single.unreadCount, 5); // 2 support + 3 mirrored WhatsApp.
      expect(inbox.single.latest.whatsapp, isNotNull);
    },
  );

  test(
    'unknown support identities and group ids do not merge by display name',
    () {
      final inbox = buildAdminConversationInbox([
        AdminInboxChannel.support(support(userId: 1, number: null)),
        AdminInboxChannel.support(support(userId: 2, number: null)),
        AdminInboxChannel.whatsapp(whatsapp(554, jid: '123456789@g.us'), 'Bot'),
        AdminInboxChannel.whatsapp(whatsapp(666), 'Meta'),
      ]);
      expect(inbox, hasLength(4));
    },
  );

  test(
    'broadcasts are hidden and repeated source snapshots do not duplicate rows',
    () {
      final channel = AdminInboxChannel.whatsapp(whatsapp(666), 'Meta');
      final inbox = buildAdminConversationInbox([
        channel,
        channel,
        AdminInboxChannel.whatsapp(
          whatsapp(554, jid: 'status@broadcast'),
          'Bot',
        ),
      ]);
      expect(inbox, hasLength(1));
      expect(inbox.single.channels, hasLength(1));
    },
  );

  test('support filters and search remain scoped to the selected channel', () {
    final row = buildAdminConversationInbox([
      AdminInboxChannel.support(support()),
      AdminInboxChannel.whatsapp(whatsapp(666), 'Meta'),
    ]).single;
    expect(row.matches(query: 'cliente10@example.test', filter: 'human'), true);
    expect(
      row.matches(query: '', filter: 'subscription_active', source: 'support'),
      true,
    );
    expect(
      row.matches(query: '', filter: 'human', source: 'instance:666'),
      false,
    );
    expect(
      row.matches(
        query: 'Mensagem do WhatsApp',
        filter: 'all',
        source: 'support',
      ),
      false,
    );
    expect(
      row.matches(query: '', filter: 'all', source: 'instance:554'),
      false,
    );
  });

  for (final width in [360.0, 1100.0]) {
    for (final metaFails in [false, true]) {
      testWidgets(
        'unified inbox works at $width with Meta failure=$metaFails',
        (tester) async {
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = Size(width, 844);
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final api = InboxApi(metaFails: metaFails);
          final selected = ValueNotifier<AdminSupportThreadEntry?>(null);
          final key = GlobalKey<AdminInstanceConversationsWorkspaceState>();
          await tester.pumpWidget(
            ProviderScope(
              overrides: [apiClientProvider.overrideWithValue(api)],
              child: MaterialApp(
                home: Scaffold(
                  body: ValueListenableBuilder(
                    valueListenable: selected,
                    builder: (context, entry, _) =>
                        AdminInstanceConversationsWorkspace(
                          key: key,
                          supportThreads: AsyncData([support()]),
                          selectedSupportThread: entry,
                          onSelectSupport: (value) => selected.value = value,
                          onRefreshSupport: () async {},
                          supportThreadBuilder: (entry, active, onTap, row) =>
                              Material(
                                child: ListTile(
                                  title: Text(entry.displayName),
                                  subtitle: Text(row.labels),
                                  onTap: onTap,
                                ),
                              ),
                          supportConversationBuilder: (entry, leading) =>
                              Column(
                                children: [
                                  if (leading != null) leading,
                                  const Text('Atendimento de suporte original'),
                                ],
                              ),
                        ),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.text('Conversas'), findsOneWidget);
          expect(find.text('Cliente 10'), findsOneWidget);
          expect(
            api.loaded,
            contains(554),
          ); // Bot available without Meta metadata.
          if (!metaFails) expect(api.loaded, contains(666));
          expect(tester.takeException(), isNull);
          // Filtering in place keeps the original support pane and back action.
          await tester.tap(find.byType(DropdownButtonFormField<String>));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Suporte').last);
          await tester.pumpAndSettle();
          await tester.tap(find.text('Cliente 10'));
          await tester.pumpAndSettle();
          expect(find.text('Atendimento de suporte original'), findsOneWidget);
          expect(
            find
                .byType(ChoiceChip)
                .evaluate()
                .where(
                  (node) =>
                      (node.widget as ChoiceChip).label is Text &&
                      ((node.widget as ChoiceChip).label as Text).data!
                          .contains('Bot'),
                )
                .length,
            greaterThanOrEqualTo(1),
          );
          expect(key.currentState!.closeConversation(), true);
          await tester.pumpAndSettle();
          expect(find.text('Cliente 10'), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
          selected.dispose();
        },
      );
    }
  }
}
