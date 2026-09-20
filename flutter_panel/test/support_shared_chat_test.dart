import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_panel/src/core/api_client.dart';
import 'package:flutter_panel/src/features/chat/chat_screen.dart';
import 'package:flutter_panel/src/models/admin_support.dart';
import 'package:flutter_panel/src/models/chat_message.dart';
import 'package:flutter_panel/src/features/support/user_support_chat_screen.dart';

class _SupportApi extends Fake implements BotAdminApiClient {
  bool? adminRequested;
  final conversation = AdminSupportConversation.fromJson({
    'thread': {'whatsappId': '__admin__', 'isAdminThread': true},
    'messages': [
      {
        'id': 1,
        'senderRole': 'user',
        'direction': 'outbound',
        'text': 'Mensagem do usuário',
        'timestamp': '2026-09-20T12:00:00Z',
      },
      {
        'id': 2,
        'senderRole': 'admin',
        'direction': 'inbound',
        'text': 'Resposta do administrador',
        'timestamp': '2026-09-20T12:01:00Z',
        'deliveryState': 'read',
      },
    ],
  });
  @override
  Future<AdminSupportConversation> loadUserSupportConversation({
    String whatsappId = '__admin__',
  }) async {
    adminRequested = false;
    return conversation;
  }

  @override
  Future<AdminSupportConversation> loadAdminSupportConversation({
    required int userId,
    required String whatsappId,
  }) async {
    adminRequested = true;
    return conversation;
  }
}

void main() {
  for (final admin in [false, true]) {
    testWidgets(
      'support uses normal bubbles and composer as ${admin ? 'admin' : 'user'}',
      (tester) async {
        tester.view.physicalSize = const Size(320, 700);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = _SupportApi();
        const snapshot = DashboardSnapshot(
          instances: [],
          groups: [],
          threads: [],
        );
        await tester.pumpWidget(
          ProviderScope(
            overrides: [apiClientProvider.overrideWithValue(api)],
            child: MaterialApp(
              home: Scaffold(
                body: UserSupportChatScreen(
                  thread: snapshot.threads.single,
                  adminEntry: admin
                      ? AdminSupportThreadEntry(
                          user: const AdminSupportUser(id: 1, name: 'Cliente'),
                          thread: api.conversation.thread,
                        )
                      : null,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(api.adminRequested, admin);
        expect(find.byType(ConversationComposer), findsOneWidget);
        expect(find.byType(ConversationMessageBubble), findsNWidgets(2));
        final bubbles = tester
            .widgetList<ConversationMessageBubble>(
              find.byType(ConversationMessageBubble),
            )
            .toList();
        expect(
          bubbles.every((bubble) => bubble.enableActions == admin),
          isTrue,
        );
        expect(bubbles[0].message.fromMe, !admin);
        expect(bubbles[1].message.fromMe, admin);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
  test('support remains in an empty or cached conversation directory', () {
    const snapshot = DashboardSnapshot(instances: [], groups: [], threads: []);
    expect(snapshot.threads.single.chatJid, '__admin__');
    expect(snapshot.threads.single.canCompose, isTrue);
  });

  test('support adapts authors, audio and genuine receipts to normal chat', () {
    final message = AdminSupportMessage.fromJson({
      'id': 9,
      'direction': 'inbound',
      'senderRole': 'admin',
      'timestamp': '2026-09-20T12:00:00Z',
      'messageType': 'audio',
      'deliveryState': 'read',
      'media': {'mediaType': 'audio', 'mediaId': '42', 'mimeType': 'audio/mp4'},
    });
    final admin = message.toChatMessage(
      forAdmin: true,
      isAdminThread: true,
      incomingName: 'Cliente',
    );
    final user = message.toChatMessage(
      forAdmin: false,
      isAdminThread: true,
      incomingName: 'Admin',
    );
    expect(admin.fromMe, isTrue);
    expect(user.fromMe, isFalse);
    expect(admin.deliveryState, MessageDeliveryState.read);
    expect(user.deliveryState, isNull);
    expect(admin.mediaUrl, '/api/admin/support/media/42');
    expect(user.mediaUrl, '/api/support/media/42');
    expect(user.resolvedMediaKind, 'audio');
    expect(user.hasRenderableMedia, isTrue);
    expect(
      AdminSupportMessage.fromJson({'id': 10}).deliveryState,
      MessageDeliveryState.sent,
    );
  });

  test('support preserves edit, delete and reaction metadata', () {
    final message = AdminSupportMessage.fromJson({
      'id': 11,
      'direction': 'inbound',
      'senderRole': 'admin',
      'timestamp': '2026-09-20T12:00:00Z',
      'messageType': 'text',
      'text': 'Mensagem atualizada',
      'isDeleted': true,
      'editedAt': '2026-09-20T12:01:00Z',
      'reactions': [
        {
          'emoji': '👍',
          'senderRole': 'admin',
          'senderUserId': 1,
          'timestamp': '2026-09-20T12:02:00Z',
        },
      ],
    });
    final adapted = message.toChatMessage(
      forAdmin: true,
      isAdminThread: true,
      incomingName: 'Cliente',
    );
    expect(adapted.isDeleted, isTrue);
    expect(adapted.editedAt, isNotNull);
    expect(adapted.reactions.single.emoji, '👍');
  });

  for (final width in [320.0, 390.0, 1280.0]) {
    testWidgets('normal chat composer works at $width without lottery', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = TextEditingController();
      var attachments = 0;
      var emojis = 0;
      var sent = 0;
      Widget composer() => ConversationComposer(
        controller: controller,
        mentionAll: false,
        buttonsEnabled: false,
        buttons: const [],
        botEnabled: false,
        showBotButton: false,
        showStoreButton: false,
        internalGroup: false,
        voiceRecording: false,
        voiceRecordingBusy: false,
        voiceDuration: Duration.zero,
        voiceViewOnce: false,
        onSend: () async {
          sent++;
        },
        onAttach: () async {
          attachments++;
        },
        onEmoji: () {
          emojis++;
        },
        onStore: () {},
        showSweepstakeButton: false,
        onSweepstake: () {},
        onBot: () {},
        onVoiceStart: () async {},
        onVoiceStop: () async {},
        onCancelVoice: () async {},
        onVoiceViewOnceChanged: null,
        onMentionAllChanged: null,
        onEditButtons: null,
        onClearButtons: null,
      );
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: Scaffold(
              body: Column(children: [const Spacer(), composer()]),
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(
        find.byTooltip('Segure para gravar · arraste para cancelar'),
        findsOneWidget,
      );
      await tester.tap(find.byTooltip('Emojis, GIFs e figurinhas'));
      expect(emojis, 1);
      await tester.tap(find.byTooltip('Adicionar'));
      await tester.pumpAndSettle();
      expect(find.text('Sorteio'), findsNothing);
      await tester.tap(find.text('Mídia ou documento'));
      await tester.pumpAndSettle();
      expect(attachments, 1);
      await tester.enterText(find.byType(TextField), 'Olá');
      await tester.pump();
      await tester.tap(find.byTooltip('Enviar'));
      expect(sent, 1);
      expect(tester.takeException(), isNull);
      // Two chats can be mounted without a shared GlobalKey collision.
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: Column(children: [composer(), composer()])),
        ),
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
    });
  }
}
