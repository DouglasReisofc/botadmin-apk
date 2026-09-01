import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_panel/src/models/chat_message.dart';
import 'package:flutter_panel/src/models/conversation_thread.dart';
import 'package:flutter_panel/src/models/internal_group.dart';

void main() {
  final thread = ConversationThread(
    instanceId: 1,
    chatJid: '120363000000000000@g.us',
    title: 'Grupo',
    lastMessage: '',
    lastActivity: DateTime(2026),
    unreadCount: 0,
    chatType: 'group',
  );

  test('oculta evento unknown vazio que nao representa uma mensagem', () {
    final message = ChatMessage.fromJson({
      'id': 'unknown-empty',
      'messageType': 'unknown',
      'text': '',
      'media': <String, dynamic>{},
      'timestamp': '2026-07-25T12:00:00.000Z',
    }, thread: thread);

    expect(message.isUserVisible, isFalse);
  });

  test('mensagem apagada permanece oculta ate revelacao explicita', () {
    final hidden = ChatMessage.fromJson({
      'id': 'deleted-hidden',
      'messageType': 'text',
      'text': 'Conteudo que foi apagado',
      'deletedAt': '2026-07-28T12:00:00.000Z',
      'deletedPlaceholder': 'Mensagem apagada',
      'timestamp': '2026-07-28T11:59:00.000Z',
    }, thread: thread);
    final revealed = ChatMessage.fromJson({
      'id': 'deleted-revealed',
      'messageType': 'text',
      'text': 'Conteudo que foi apagado',
      'deletedAt': '2026-07-28T12:00:00.000Z',
      'revealDeletedContent': true,
      'timestamp': '2026-07-28T11:59:00.000Z',
    }, thread: thread);

    expect(hidden.isDeleted, isTrue);
    expect(hidden.shouldHideDeletedContent, isTrue);
    expect(hidden.deletedDisplayText, 'Mensagem apagada');
    expect(revealed.shouldHideDeletedContent, isFalse);
  });

  test('mantem mensagem antiga unknown quando ha texto recuperavel', () {
    final message = ChatMessage.fromJson({
      'id': 'unknown-text',
      'messageType': 'unknown',
      'media': {'body': 'Conteudo recuperado do payload antigo'},
      'timestamp': '2026-07-25T12:00:00.000Z',
    }, thread: thread);

    expect(message.displayText, 'Conteudo recuperado do payload antigo');
    expect(message.isUserVisible, isTrue);
  });

  test('distingue visualizacao unica realmente indisponivel', () {
    final message = ChatMessage.fromJson({
      'id': 'view-once',
      'messageType': 'undecryptable',
      'media': {'mediaType': 'undecryptable', 'viewOnce': true},
      'timestamp': '2026-07-25T12:00:00.000Z',
    }, thread: thread);

    expect(message.isUserVisible, isTrue);
    expect(
      message.unavailableDisplayText,
      'Mensagem de visualização única indisponível',
    );
  });

  test('cria endpoint recuperavel para midia que so tem metadados', () {
    final message = ChatMessage.fromJson({
      'id': 'db-row-42',
      'messageId': 'WA-MEDIA-42',
      'messageType': 'image',
      'media': {'mimeType': 'image/jpeg', 'fileLength': 23841},
      'timestamp': '2026-07-25T12:00:00.000Z',
    }, thread: thread);

    expect(message.hasRenderableMedia, isTrue);
    expect(
      message.mediaUrl,
      '/api/bot-instances/1/whatsapp-conversations/'
      '120363000000000000%40g.us/messages/WA-MEDIA-42/media',
    );
  });

  test('renderiza enquete recebida com opcoes no nivel principal da midia', () {
    final message = ChatMessage.fromJson({
      'id': 'poll-real',
      'messageType': 'poll',
      'media': {
        'kind': 'poll',
        'mediaType': 'poll',
        'name': 'Jk',
        'title': 'Jk',
        'options': [
          {
            'id':
                '44bd7ae60f478fae1061e11a7739f4b94d1daf917982d33b6fc8a01a63f89c21',
            'title': 'H',
            'votes': 0,
          },
          {
            'id':
                'fb8868acd9cbbd68964baa1cfa6b893a6269e01569183474e6c1c4242a0071a9',
            'name': 'Gg',
            'voteCount': 1,
          },
        ],
      },
      'timestamp': '2026-07-25T18:18:48.000Z',
    }, thread: thread);

    expect(message.hasRenderableMedia, isTrue);
    expect(message.isUserVisible, isTrue);
    expect(message.mediaTitle, 'Jk');
    expect(message.pollOptions.map((option) => option.title), ['H', 'Gg']);
    expect(message.pollOptions.last.voteCount, 1);
  });

  test('preserva contatos compartilhados e extrai telefone do vcard', () {
    final message = ChatMessage.fromJson({
      'id': 'contacts-real',
      'messageType': 'contact',
      'media': {
        'kind': 'contact',
        'mediaType': 'contact',
        'title': '2 contatos',
        'contacts': [
          {
            'displayName': 'Doguinha (Contas Premium)',
            'vcard':
                'BEGIN:VCARD\nVERSION:3.0\nFN:Doguinha (Contas Premium)\n'
                'item1.TEL;waid=5527981361934:+55 27 98136-1934\nEND:VCARD',
          },
          {
            'displayName': '-Lucas Lopes Revenda',
            'vcard':
                'BEGIN:VCARD\nVERSION:3.0\nFN:-Lucas Lopes Revenda\n'
                'item1.TEL;waid=553185231750:+55 31 8523-1750\nEND:VCARD',
          },
        ],
      },
      'timestamp': '2026-07-25T18:16:46.000Z',
    }, thread: thread);

    expect(message.hasRenderableMedia, isTrue);
    expect(message.contacts, hasLength(2));
    expect(message.contacts.first.displayName, 'Doguinha (Contas Premium)');
    expect(message.contacts.first.phoneDigits, '5527981361934');
    expect(message.contacts.first.whatsappJid, '5527981361934@s.whatsapp.net');
    expect(message.contacts.last.phoneDigits, '553185231750');
  });

  test('preserva localizacao ao vivo e converte miniatura em data url', () {
    final message = ChatMessage.fromJson({
      'id': 'live-location-real',
      'messageType': 'location',
      'media': {
        'kind': 'location',
        'mediaType': 'location',
        'locationType': 'live',
        'isLive': true,
        'latitude': -3.0278528,
        'longitude': -59.9420799,
        'title': 'Localização ao vivo',
        'thumbnail':
            'aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ'
            'gaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=',
      },
      'timestamp': '2026-07-25T21:06:53.000Z',
    }, thread: thread);

    expect(message.hasRenderableMedia, isTrue);
    expect(message.media['isLive'], isTrue);
    expect(message.media['latitude'], -3.0278528);
    expect(message.mediaTitle, 'Localização ao vivo');
    expect(message.mediaThumbnailUrl, startsWith('data:image/jpeg;base64,'));
  });

  test('normaliza botao de formulario nativo do WhatsApp', () {
    final message = ChatMessage.fromJson({
      'id': 'flow-form-real',
      'messageType': 'interactive',
      'text': 'Por favor, envie-nos seus dados.',
      'media': {
        'kind': 'interactive',
        'mediaType': 'buttons',
        'buttons': [
          {
            'name': 'galaxy_message',
            'buttonParamsJson':
                '{"flow_message_version":"4","flow_id":"2009159069721562",'
                '"flow_cta":"__localize:FLOWS_COMPLETE_FORM_BUTTON_TITLE",'
                '"flow_action":"navigate","flow_token":"TOKEN",'
                '"form_type":"template"}',
          },
        ],
      },
      'timestamp': '2026-07-25T21:07:42.000Z',
    }, thread: thread);

    expect(message.interactiveButtons, hasLength(1));
    expect(message.interactiveButtons.first.title, 'Preencher formulário');
    expect(message.interactiveButtons.first.type, 'flow');
    expect(message.interactiveButtons.first.id, '2009159069721562');
  });

  test('preserva idempotencia e recibos da mensagem otimista reconciliada', () {
    final message = ChatMessage.fromJson({
      'id': '9812',
      'messageId': 'server-message-9812',
      'clientMessageId': 'client-android-42',
      'messageType': 'text',
      'text': 'Mensagem reconciliada',
      'fromMe': true,
      'deliveryState': 'read',
      'receiptSummary': {
        'recipientCount': 3,
        'deliveredCount': 3,
        'readCount': 1,
      },
      'receipts': [
        {
          'userId': '7',
          'name': 'Maria',
          'state': 'read',
          'deliveredAt': '2026-08-26T17:10:00.000Z',
          'readAt': '2026-08-26T17:11:00.000Z',
        },
      ],
      'timestamp': '2026-08-26T17:09:59.000Z',
    }, thread: thread);

    expect(message.clientMessageId, 'client-android-42');
    expect(message.deliveryState, MessageDeliveryState.read);
    expect(message.receiptSummary['deliveredCount'], 3);
    expect(message.receiptSummary['readCount'], 1);
    expect(message.receipts, hasLength(1));
    expect(message.receipts.single.name, 'Maria');
    expect(message.receipts.single.state, MessageDeliveryState.read);
    expect(message.receipts.single.readAt, isNotNull);
  });

  test('confirmacao e realtime usam uma unica identidade de mensagem', () {
    final confirmed = ChatMessage(
      id: '418',
      remoteId: '418',
      clientMessageId: 'local-android-42',
      text: '!s',
      timestamp: DateTime(2026, 8, 26, 20),
      fromMe: true,
      senderName: 'Você',
    );
    final realtimeWithoutClientId = ChatMessage(
      id: '418',
      remoteId: '418',
      text: '!s',
      timestamp: DateTime(2026, 8, 26, 20),
      fromMe: true,
      senderName: 'Você',
    );

    expect(confirmed.identityKey, 'remote:418');
    expect(realtimeWithoutClientId.identityKey, confirmed.identityKey);
  });

  test('mantem proxy e fallback da capa do play em grupo BotAdmin', () {
    final message = InternalGroupMessage.fromJson({
      'id': 99,
      'groupId': 4,
      'senderId': 1,
      'senderName': 'Robô',
      'isBot': true,
      'isMine': false,
      'deleted': false,
      'type': 'image',
      'text': 'Escolha o formato para baixar:',
      'mediaUrl': '/api/internal-groups/4/media/99',
      'mediaSourceUrl': 'https://i.ytimg.com/vi/SBs_pd1QQu8/hq720.jpg',
      'mediaMimeType': 'image/jpeg',
      'buttons': [
        {'id': 'mp3', 'title': 'Baixar MP3'},
        {'id': 'mp4', 'title': 'Baixar MP4'},
      ],
      'createdAt': '2026-08-26T18:00:00.000Z',
    }).toChatMessage(thread);

    expect(message.normalizedType, 'interactive');
    expect(message.mediaUrl, '/api/internal-groups/4/media/99');
    expect(message.mediaThumbnailUrl, contains('i.ytimg.com'));
    expect(message.media['fallbackUrl'], contains('i.ytimg.com'));
    expect(message.interactiveButtons, hasLength(2));
  });

  test('download MP3 do grupo sempre resolve como audio renderizavel', () {
    final message = InternalGroupMessage.fromJson({
      'id': 101,
      'groupId': 4,
      'senderId': 1,
      'senderName': 'Robô',
      'isBot': true,
      'isMine': false,
      'deleted': false,
      'type': 'audio',
      'text': 'Charlie Brown Jr. - Só Os Loucos Sabem — Charlie Brown Jr.',
      'mediaUrl': '/api/internal-groups/4/media/101',
      'mediaMimeType': 'audio/mpeg',
      'mediaFileName': 'Charlie Brown Jr. - So Os Loucos Sabem.mp3',
      'replyTo': {'id': 100, 'text': 'Baixar MP3', 'senderName': 'Usuário'},
      'createdAt': '2026-08-27T16:00:00.000Z',
    }).toChatMessage(thread);

    expect(message.resolvedMediaKind, 'audio');
    expect(message.hasRenderableMedia, isTrue);
  });

  test('MIME de MP3 corrige envelope interativo ou imagem antigo', () {
    final stale = ChatMessage(
      id: 'legacy-mp3',
      remoteId: 'legacy-mp3',
      text: 'Faixa baixada',
      timestamp: DateTime(2026, 8, 27, 16),
      fromMe: false,
      senderName: 'Robô',
      mediaUrl: '/api/playaudio/abc123',
      messageType: 'image',
      mediaMimeType: 'audio/mpeg',
      mediaFileName: 'faixa.mp3',
      media: const {'mediaType': 'image', 'url': '/api/playaudio/abc123'},
      interactiveButtons: const [
        ChatInteractiveButton(id: 'old', title: 'Botão antigo'),
      ],
    );

    expect(stale.resolvedMediaKind, 'audio');
    expect(stale.hasRenderableMedia, isTrue);
  });
}
