import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_panel/src/models/conversation_thread.dart';

void main() {
  group('ConversationThread classification', () {
    test('keeps channels in the conversation list', () {
      final thread = ConversationThread.fromJson({
        'chatJid': '120363000000000000@newsletter',
        'chatType': 'channel',
        'title': 'Canal BotAdmin',
      }, fallbackInstanceId: 1);

      expect(thread.isChannel, isTrue);
      expect(thread.isGroup, isFalse);
      expect(thread.isSafeConversationListItem, isTrue);
      expect(thread.conversationTypeLabel, 'Canal');
      expect(thread.canCompose, isFalse);
    });

    test('recognizes a community from the normalized chat type', () {
      final thread = ConversationThread.fromJson({
        'chatJid': '120363111111111111@g.us',
        'chatType': 'community',
        'title': 'Comunidade BotAdmin',
      }, fallbackInstanceId: 1);

      expect(thread.isCommunity, isTrue);
      expect(thread.isGroup, isTrue);
      expect(thread.isChannel, isFalse);
      expect(thread.conversationTypeLabel, 'Comunidade');
    });

    test('recognizes legacy isParent community payloads', () {
      final thread = ConversationThread.fromJson({
        'chatJid': '120363222222222222@g.us',
        'chatType': 'group',
        'isParent': true,
        'title': 'Comunidade Legada',
      }, fallbackInstanceId: 1);

      expect(thread.chatType, 'community');
      expect(thread.isCommunity, isTrue);
    });

    test('allows channel publishing only for an admin or owner role', () {
      final admin = ConversationThread.fromJson({
        'chatJid': '120363333333333333@newsletter',
        'chatType': 'channel',
        'title': 'Canal administrado',
        'channelRole': 'admin',
        'canSendMessages': true,
      }, fallbackInstanceId: 1);
      final subscriber = ConversationThread.fromJson({
        'chatJid': '120363444444444444@newsletter',
        'chatType': 'channel',
        'title': 'Canal acompanhado',
        'channelRole': 'subscriber',
        'canSendMessages': false,
      }, fallbackInstanceId: 1);

      expect(admin.canCompose, isTrue);
      expect(subscriber.canCompose, isFalse);
    });

    test('hides composer in admin-only groups for a non-admin instance', () {
      final thread = ConversationThread.fromJson({
        'chatJid': '120363555555555555@g.us',
        'chatType': 'group',
        'title': 'Grupo de avisos',
        'announceOnly': true,
        'instanceIsAdmin': false,
      }, fallbackInstanceId: 1);

      expect(thread.canCompose, isFalse);
      expect(thread.conversationTypeLabel, 'Grupo');
    });

    test('keeps direct conversations writable', () {
      final thread = ConversationThread.fromJson({
        'chatJid': '5592999999999@s.whatsapp.net',
        'chatType': 'contact',
        'title': 'Contato',
      }, fallbackInstanceId: 1);

      expect(thread.canCompose, isTrue);
      expect(thread.conversationTypeLabel, 'PV');
    });

    test('keeps the internal support chat as a writable conversation', () {
      final thread = ConversationThread.fromJson({
        'chatJid': '__admin__',
        'chatType': 'support',
        'title': 'Suporte BotAdmin',
        'canSendMessages': true,
      }, fallbackInstanceId: 0);

      expect(thread.isSupport, isTrue);
      expect(thread.isSafeConversationListItem, isTrue);
      expect(thread.canCompose, isTrue);
      expect(thread.conversationTypeLabel, 'Suporte');
    });

    test('replaces a generic group label with the real directory name', () {
      final thread = ConversationThread.fromJson({
        'chatJid': '120363666666666666@g.us',
        'chatType': 'group',
        'title': 'Grupo',
        'name': 'Equipe BotAdmin',
      }, fallbackInstanceId: 1);

      expect(thread.title, 'Equipe BotAdmin');
    });
  });
}
