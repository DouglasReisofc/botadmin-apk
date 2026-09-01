import 'dart:convert';

import 'conversation_thread.dart';

/// Client-only delivery state for optimistic outbound messages.
enum MessageLocalStatus { pending, sent, failed }

enum MessageDeliveryState { sent, delivered, read }

class MessageReceipt {
  const MessageReceipt({
    required this.userId,
    required this.name,
    this.avatarUrl,
    required this.state,
    this.deliveredAt,
    this.readAt,
  });

  final String userId;
  final String name;
  final String? avatarUrl;
  final MessageDeliveryState state;
  final DateTime? deliveredAt;
  final DateTime? readAt;
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.remoteId,
    this.clientMessageId,
    required this.text,
    required this.timestamp,
    required this.fromMe,
    required this.senderName,
    this.senderJid,
    this.senderAvatarUrl,
    this.mediaUrl,
    this.messageType,
    this.mediaFileName,
    this.mediaMimeType,
    this.mediaCaption,
    this.mediaTitle,
    this.mediaSizeBytes,
    this.mediaThumbnailUrl,
    this.mediaDurationSeconds,
    this.media = const {},
    this.isAnimatedMedia = false,
    this.pollOptions = const [],
    this.contacts = const [],
    this.interactiveButtons = const [],
    this.interactiveSections = const [],
    this.interactiveFooter,
    this.quoted,
    this.reaction,
    this.reactions = const [],
    this.deletedAt,
    this.editedAt,
    this.deletedByJid,
    this.deletedByName,
    this.deletedPlaceholder,
    this.canRevealDeletedContent = false,
    this.revealDeletedContent = false,
    this.localStatus,
    this.deliveryState,
    this.receiptSummary = const <String, int>{},
    this.receipts = const <MessageReceipt>[],
  });

  final String id;
  final String remoteId;
  final String? clientMessageId;
  final String text;
  final DateTime timestamp;
  final bool fromMe;
  final String senderName;
  final String? senderJid;
  final String? senderAvatarUrl;
  final String? mediaUrl;
  final String? messageType;
  final String? mediaFileName;
  final String? mediaMimeType;
  final String? mediaCaption;
  final String? mediaTitle;
  final int? mediaSizeBytes;
  final String? mediaThumbnailUrl;
  final int? mediaDurationSeconds;
  final Map<String, dynamic> media;
  final bool isAnimatedMedia;
  final List<ChatPollOption> pollOptions;
  final List<ChatContactCard> contacts;
  final List<ChatInteractiveButton> interactiveButtons;
  final List<ChatInteractiveSection> interactiveSections;
  final String? interactiveFooter;
  final ChatQuotedMessage? quoted;
  final ChatReaction? reaction;
  final List<ChatReaction> reactions;
  final DateTime? deletedAt;
  final DateTime? editedAt;
  final String? deletedByJid;
  final String? deletedByName;
  final String? deletedPlaceholder;
  final bool canRevealDeletedContent;
  final bool revealDeletedContent;
  final MessageLocalStatus? localStatus;
  final MessageDeliveryState? deliveryState;
  final Map<String, int> receiptSummary;
  final List<MessageReceipt> receipts;

  /// Stable UI/cache identity across optimistic send and realtime delivery.
  /// A definitive server id wins after acknowledgement; the client id is
  /// used only while the row is still local.
  String get identityKey {
    final normalizedRemoteId = remoteId.trim();
    if (normalizedRemoteId.isNotEmpty &&
        !normalizedRemoteId.startsWith('local-')) {
      return 'remote:$normalizedRemoteId';
    }
    final normalizedClientId = clientMessageId?.trim() ?? '';
    if (normalizedClientId.isNotEmpty) {
      return 'client:$normalizedClientId';
    }
    if (normalizedRemoteId.isNotEmpty) return 'remote:$normalizedRemoteId';
    final normalizedId = id.trim();
    if (normalizedId.isNotEmpty) return 'id:$normalizedId';
    return 'fallback:${timestamp.microsecondsSinceEpoch}:$text';
  }

  bool get isLocalOptimistic =>
      localStatus == MessageLocalStatus.pending ||
      localStatus == MessageLocalStatus.failed ||
      id.startsWith('local-') ||
      remoteId.startsWith('local-');

  bool get isReaction => normalizedType == 'reaction' || reaction != null;

  String get normalizedType => _normalizeType(messageType);

  /// Media discriminator used by the renderer.
  ///
  /// Some bot/download responses are delivered with a stale `image` or
  /// `interactive` envelope even though the concrete payload is an MP3.  The
  /// MIME type, download endpoint and file extension are authoritative for
  /// audio/video and must win over that envelope.  Keeping this normalization
  /// in the model also makes cached, realtime and freshly fetched messages
  /// behave identically.
  String get resolvedMediaKind {
    final type = normalizedType;
    final mime = (mediaMimeType ?? '').trim().toLowerCase();
    final url = <Object?>[
      mediaUrl,
      media['publicUrl'],
      media['localUrl'],
      media['url'],
      media['mediaUrl'],
      media['path'],
    ].map((value) => value?.toString().trim() ?? '').join(' ').toLowerCase();
    final file = <Object?>[
      mediaFileName,
      media['fileName'],
      media['filename'],
      media['name'],
    ].map((value) => value?.toString().trim() ?? '').join(' ').toLowerCase();
    final embedded = <Object?>[
      media['mediaType'],
      media['mimeType'],
      media['mimetype'],
    ].map((value) => value?.toString().trim() ?? '').join(' ').toLowerCase();
    final quotedText = <String?>[
      quoted?.text,
      quoted?.title,
      quoted?.participant,
    ].whereType<String>().join(' ').toLowerCase();

    final isAudio =
        mime.startsWith('audio/') ||
        embedded.contains('audio/') ||
        embedded.split(RegExp(r'\s+')).contains('audio') ||
        url.contains('/playaudio/') ||
        RegExp(
          r'\.(mp3|m4a|aac|ogg|opus|wav)(?:$|[?#\s])',
        ).hasMatch('$url $file') ||
        quotedText.contains('baixar mp3');
    if (isAudio) return 'audio';

    final isVideo =
        mime.startsWith('video/') ||
        embedded.contains('video/') ||
        embedded.split(RegExp(r'\s+')).contains('video') ||
        url.contains('/api/play/') ||
        RegExp(r'\.(mp4|webm|mov|mkv)(?:$|[?#\s])').hasMatch('$url $file') ||
        quotedText.contains('baixar mp4');
    if (isVideo) return 'video';

    // Interactive cards can legitimately have an image header. They stay
    // interactive unless the concrete payload above identifies a download.
    if (interactiveButtons.isNotEmpty ||
        interactiveSections.any((section) => section.rows.isNotEmpty)) {
      return 'interactive';
    }

    if (mime == 'image/webp' || embedded.contains('sticker')) return 'sticker';
    if (mime.startsWith('image/') || embedded.contains('image')) return 'image';
    if (mime.startsWith('application/')) return 'document';
    return type;
  }

  bool get hasMedia {
    final type = normalizedType;
    return mediaUrl != null ||
        mediaMimeType != null ||
        mediaFileName != null ||
        mediaCaption != null ||
        mediaTitle != null ||
        const {
          'image',
          'video',
          'audio',
          'document',
          'sticker',
          'contact',
          'location',
          'poll',
          'interactive',
          'undecryptable',
        }.contains(type);
  }

  /// A type by itself is not enough to render media. Older WhatsApp records
  /// can retain `image`/`interactive` metadata after their payload is gone.
  bool get hasRenderableMedia {
    if (isReaction) return false;
    final type = resolvedMediaKind;
    if (const {'interactive', 'undecryptable'}.contains(type)) {
      return false;
    }
    if (type == 'poll') {
      return pollOptions.isNotEmpty ||
          mediaTitle?.trim().isNotEmpty == true ||
          media.isNotEmpty;
    }
    if (const {'contact', 'location'}.contains(type)) {
      return media.isNotEmpty;
    }
    if (!const {
      'image',
      'video',
      'audio',
      'sticker',
      'document',
    }.contains(type)) {
      return false;
    }
    final candidates = <Object?>[
      mediaUrl,
      mediaThumbnailUrl,
      media['publicUrl'],
      media['localUrl'],
      media['dataUrl'],
      media['url'],
      media['URL'],
      media['mediaUrl'],
      media['MediaUrl'],
      media['path'],
      media['filePath'],
      media['directPath'],
      media['DirectPath'],
      media['mediaKey'],
      media['MediaKey'],
    ];
    if (candidates.any(
      (value) => value?.toString().trim().isNotEmpty == true,
    )) {
      return true;
    }
    return false;
  }

  bool get hasDisplayText => text.trim().isNotEmpty;

  String get displayText => text.trim();

  /// Empty protocol/status events can be persisted by WhatsApp as `unknown`.
  /// They are synchronization events, not user-visible chat messages.
  bool get isUserVisible {
    if (isReaction) return false;
    if (isDeleted || hasDisplayText || hasRenderableMedia) return true;
    if (quoted?.hasContent == true ||
        pollOptions.isNotEmpty ||
        interactiveButtons.isNotEmpty ||
        interactiveSections.isNotEmpty) {
      return true;
    }
    if (normalizedType == 'undecryptable') return true;
    return !const {
      '',
      'unknown',
      'unsupported',
      'protocol',
      'system',
    }.contains(normalizedType);
  }

  String get unavailableDisplayText {
    if (normalizedType != 'undecryptable') return '';
    if (_asBool(media['viewOnce'])) {
      return 'Mensagem de visualização única indisponível';
    }
    if (_asBool(media['requestSent'])) {
      return 'Aguardando o WhatsApp recuperar esta mensagem';
    }
    return 'O WhatsApp não disponibilizou o conteúdo desta mensagem';
  }

  bool get isDeleted => deletedAt != null;

  bool get shouldHideDeletedContent => isDeleted && !revealDeletedContent;

  String get deletedDisplayText {
    final placeholder = deletedPlaceholder?.trim();
    if (placeholder != null && placeholder.isNotEmpty) return placeholder;
    return 'Mensagem apagada';
  }

  String get senderDisplayName {
    final name = senderName.trim();
    if (name.isNotEmpty) return name;
    final phone = senderPhoneDisplay;
    return phone.isNotEmpty ? phone : 'Participante';
  }

  String get senderPhoneDisplay {
    // Grupos BotAdmin usam identificadores internos, não números de telefone.
    // Exibir o sufixo numérico do JID (por exemplo, “2”) polui o cabeçalho do
    // balão e fazia o robô parecer um contato comum.
    final jid = senderJid?.trim().toLowerCase() ?? '';
    if (jid.startsWith('botadmin-user:') || jid.startsWith('botadmin-bot:')) {
      return '';
    }
    return _formatWhatsappPhone(senderJid);
  }

  ChatMessage copyWith({
    String? id,
    String? remoteId,
    String? clientMessageId,
    String? text,
    DateTime? timestamp,
    bool? fromMe,
    String? senderName,
    String? senderJid,
    String? senderAvatarUrl,
    String? mediaUrl,
    String? messageType,
    String? mediaFileName,
    String? mediaMimeType,
    String? mediaCaption,
    String? mediaTitle,
    int? mediaSizeBytes,
    String? mediaThumbnailUrl,
    int? mediaDurationSeconds,
    Map<String, dynamic>? media,
    bool? isAnimatedMedia,
    List<ChatPollOption>? pollOptions,
    List<ChatContactCard>? contacts,
    List<ChatInteractiveButton>? interactiveButtons,
    List<ChatInteractiveSection>? interactiveSections,
    String? interactiveFooter,
    ChatQuotedMessage? quoted,
    ChatReaction? reaction,
    List<ChatReaction>? reactions,
    DateTime? deletedAt,
    DateTime? editedAt,
    String? deletedByJid,
    String? deletedByName,
    String? deletedPlaceholder,
    bool? canRevealDeletedContent,
    bool? revealDeletedContent,
    MessageLocalStatus? localStatus,
    MessageDeliveryState? deliveryState,
    Map<String, int>? receiptSummary,
    List<MessageReceipt>? receipts,
    bool clearLocalStatus = false,
  }) {
    return ChatMessage(
      id: id ?? this.id,
      remoteId: remoteId ?? this.remoteId,
      clientMessageId: clientMessageId ?? this.clientMessageId,
      text: text ?? this.text,
      timestamp: timestamp ?? this.timestamp,
      fromMe: fromMe ?? this.fromMe,
      senderName: senderName ?? this.senderName,
      senderJid: senderJid ?? this.senderJid,
      senderAvatarUrl: senderAvatarUrl ?? this.senderAvatarUrl,
      mediaUrl: mediaUrl ?? this.mediaUrl,
      messageType: messageType ?? this.messageType,
      mediaFileName: mediaFileName ?? this.mediaFileName,
      mediaMimeType: mediaMimeType ?? this.mediaMimeType,
      mediaCaption: mediaCaption ?? this.mediaCaption,
      mediaTitle: mediaTitle ?? this.mediaTitle,
      mediaSizeBytes: mediaSizeBytes ?? this.mediaSizeBytes,
      mediaThumbnailUrl: mediaThumbnailUrl ?? this.mediaThumbnailUrl,
      mediaDurationSeconds: mediaDurationSeconds ?? this.mediaDurationSeconds,
      media: media ?? this.media,
      isAnimatedMedia: isAnimatedMedia ?? this.isAnimatedMedia,
      pollOptions: pollOptions ?? this.pollOptions,
      contacts: contacts ?? this.contacts,
      interactiveButtons: interactiveButtons ?? this.interactiveButtons,
      interactiveSections: interactiveSections ?? this.interactiveSections,
      interactiveFooter: interactiveFooter ?? this.interactiveFooter,
      quoted: quoted ?? this.quoted,
      reaction: reaction ?? this.reaction,
      reactions: reactions ?? this.reactions,
      deletedAt: deletedAt ?? this.deletedAt,
      editedAt: editedAt ?? this.editedAt,
      deletedByJid: deletedByJid ?? this.deletedByJid,
      deletedByName: deletedByName ?? this.deletedByName,
      deletedPlaceholder: deletedPlaceholder ?? this.deletedPlaceholder,
      canRevealDeletedContent:
          canRevealDeletedContent ?? this.canRevealDeletedContent,
      revealDeletedContent: revealDeletedContent ?? this.revealDeletedContent,
      localStatus: clearLocalStatus ? null : (localStatus ?? this.localStatus),
      deliveryState: deliveryState ?? this.deliveryState,
      receiptSummary: receiptSummary ?? this.receiptSummary,
      receipts: receipts ?? this.receipts,
    );
  }

  factory ChatMessage.fromJson(
    Map<String, dynamic> json, {
    required ConversationThread thread,
  }) {
    // Webhooks variam: alguns enviam os botões dentro de media/nativeFlow,
    // outros no nível raiz. Unificamos os dois formatos antes de interpretar
    // a mensagem para que o APK nunca descarte o menu interativo.
    final media = <String, dynamic>{
      ..._map(json['media']),
      if (json['buttons'] is List) 'buttons': json['buttons'],
      if (json['Buttons'] is List) 'Buttons': json['Buttons'],
      if (json['sections'] is List) 'sections': json['sections'],
      if (json['nativeFlow'] is Map) 'nativeFlow': json['nativeFlow'],
      if (json['nativeFlowMessage'] is Map)
        'nativeFlowMessage': json['nativeFlowMessage'],
    };
    final id = (json['id'] ?? json['messageId'] ?? json['key'] ?? '')
        .toString();
    final messageId = _firstString(json['messageId'], json['key'], id);
    final messageType =
        (json['messageType'] ?? json['type'] ?? media['mediaType'])?.toString();
    final mediaUrl = _resolveMediaUrl(
      thread,
      messageId,
      messageType,
      media,
      json,
    );
    final mediaCaption = _firstNullableString(
      json['caption'],
      media['caption'],
      media['Caption'],
      media['body'],
      media['Body'],
      media['text'],
      media['Text'],
      media['description'],
      media['Description'],
    );
    final text = _firstNullableString(
      json['text'],
      json['body'],
      mediaCaption,
      json['content'],
    );
    final fromMe =
        json['fromMe'] == true ||
        json['isFromMe'] == true ||
        json['direction']?.toString() == 'outbound';
    final senderJid = _firstNullableString(
      json['senderJid'],
      json['participant'],
      json['remoteJid'],
      media['participant'],
      media['senderJid'],
      media['sender'],
    );
    final senderName = _firstStringFromList([
      _cleanSenderName(json['senderName']),
      _cleanSenderName(json['pushName']),
      _cleanSenderName(json['participantName']),
      _cleanSenderName(json['sender']),
      _cleanSenderName(media['senderName']),
      _cleanSenderName(media['pushName']),
      fromMe ? 'Você' : _fallbackSenderName(senderJid, thread),
    ]);
    final reaction = _parseReaction(media, json, senderName, messageId);
    final reactions = _parseReactionsList(json, media, messageId);
    final pollOptions = _parsePollOptions(media);
    final contacts = _parseContacts(media);
    final interactiveSections = _parseInteractiveSections(media);
    final interactiveButtons = _parseInteractiveButtons(media);
    return ChatMessage(
      id: id,
      remoteId: messageId,
      clientMessageId: _firstNullableString(
        json['clientMessageId'],
        json['client_message_id'],
      ),
      text: text ?? '',
      timestamp: _asDate(
        json['timestamp'] ?? json['createdAt'] ?? json['messageTimestamp'],
      ),
      fromMe: fromMe,
      senderName: senderName,
      senderJid: senderJid,
      senderAvatarUrl: _firstNullableString(
        json['senderAvatarUrl'],
        json['senderProfilePicUrl'],
        json['senderProfilePictureUrl'],
        json['profilePicUrl'],
        media['senderAvatarUrl'],
        media['profilePicUrl'],
      ),
      mediaUrl: mediaUrl,
      messageType: messageType,
      mediaFileName: _firstNullableString(
        json['fileName'],
        media['filename'],
        media['fileName'],
        media['FileName'],
      ),
      mediaMimeType: _firstNullableString(
        json['mimeType'],
        media['mimeType'],
        media['MimeType'],
        media['mimetype'],
      ),
      mediaCaption: mediaCaption,
      mediaTitle: _firstNullableString(
        json['title'],
        json['mediaTitle'],
        media['title'],
        media['Title'],
        media['name'],
        media['Name'],
      ),
      mediaSizeBytes: _firstInt(
        json['size'],
        media['fileLength'],
        media['FileLength'],
        media['size'],
      ),
      mediaThumbnailUrl: _thumbnailUrl(media, json),
      mediaDurationSeconds: _firstInt(
        json['duration'],
        media['seconds'],
        media['Seconds'],
        media['duration'],
      ),
      media: Map<String, dynamic>.unmodifiable(media),
      isAnimatedMedia:
          _asBool(json['isAnimated'] ?? json['animated']) ||
          _asBool(media['isAnimated'] ?? media['animated']) ||
          _asBool(media['gifPlayback'] ?? media['GifPlayback']) ||
          (messageType ?? '').toLowerCase().contains('gif') ||
          (media['mimeType'] ?? media['mimetype'] ?? '')
              .toString()
              .toLowerCase()
              .contains('gif'),
      pollOptions: pollOptions,
      contacts: contacts,
      interactiveButtons: interactiveButtons,
      interactiveSections: interactiveSections,
      interactiveFooter: _firstNullableString(
        media['footer'],
        media['Footer'],
        media['footerText'],
        media['FooterText'],
      ),
      quoted: _parseQuoted(_map(media['quoted'] ?? media['reply'])),
      reaction: reaction,
      reactions: reactions,
      deletedAt: _asNullableDate(json['deletedAt'] ?? json['deleted_at']),
      editedAt: _asNullableDate(json['editedAt'] ?? json['edited_at']),
      deletedByJid: _firstNullableString(
        json['deletedByJid'],
        json['deleted_by_jid'],
      ),
      deletedByName: _firstNullableString(
        json['deletedByName'],
        json['deleted_by_name'],
      ),
      deletedPlaceholder: _firstNullableString(
        json['deletedPlaceholder'],
        json['deleted_placeholder'],
      ),
      canRevealDeletedContent: _asBool(
        json['canRevealDeletedContent'] ?? json['can_reveal_deleted_content'],
      ),
      revealDeletedContent: _asBool(
        json['revealDeletedContent'] ?? json['reveal_deleted_content'],
      ),
      localStatus: _parseLocalStatus(
        json['localStatus'] ?? json['local_status'],
      ),
      deliveryState: _parseDeliveryState(
        json['deliveryState'] ?? json['delivery_state'],
      ),
      receiptSummary: _parseReceiptSummary(
        json['receiptSummary'] ?? json['receipt_summary'],
      ),
      receipts: _parseReceipts(json['receipts']),
    );
  }
}

MessageLocalStatus? _parseLocalStatus(Object? value) {
  switch (value?.toString().trim().toLowerCase()) {
    case 'pending':
      return MessageLocalStatus.pending;
    case 'sent':
      return MessageLocalStatus.sent;
    case 'failed':
      return MessageLocalStatus.failed;
    default:
      return null;
  }
}

MessageDeliveryState? _parseDeliveryState(Object? value) {
  switch (value?.toString().trim().toLowerCase()) {
    case 'read':
      return MessageDeliveryState.read;
    case 'delivered':
      return MessageDeliveryState.delivered;
    case 'sent':
      return MessageDeliveryState.sent;
    default:
      return null;
  }
}

Map<String, int> _parseReceiptSummary(Object? value) {
  if (value is! Map) return const <String, int>{};
  int read(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
  return {
    'recipientCount': read(value['recipientCount'] ?? value['recipient_count']),
    'deliveredCount': read(value['deliveredCount'] ?? value['delivered_count']),
    'readCount': read(value['readCount'] ?? value['read_count']),
  };
}

List<MessageReceipt> _parseReceipts(Object? value) {
  if (value is! List) return const <MessageReceipt>[];
  return value
      .whereType<Map>()
      .map((raw) {
        final map = Map<String, dynamic>.from(raw);
        final state =
            _parseDeliveryState(map['state']) ?? MessageDeliveryState.delivered;
        return MessageReceipt(
          userId:
              '${map['userId'] ?? map['user_id'] ?? map['recipientJid'] ?? ''}',
          name: '${map['name'] ?? map['recipientName'] ?? 'Participante'}',
          avatarUrl: map['avatarUrl']?.toString(),
          state: state == MessageDeliveryState.sent
              ? MessageDeliveryState.delivered
              : state,
          deliveredAt: DateTime.tryParse(
            '${map['deliveredAt'] ?? map['delivered_at'] ?? ''}',
          ),
          readAt: DateTime.tryParse('${map['readAt'] ?? map['read_at'] ?? ''}'),
        );
      })
      .toList(growable: false);
}

class ChatQuotedMessage {
  const ChatQuotedMessage({
    this.id,
    this.participant,
    this.title,
    this.text,
    this.messageType,
  });

  final String? id;
  final String? participant;
  final String? title;
  final String? text;
  final String? messageType;

  bool get hasContent =>
      (title?.trim().isNotEmpty ?? false) ||
      (text?.trim().isNotEmpty ?? false) ||
      (messageType?.trim().isNotEmpty ?? false);
}

class ChatReaction {
  const ChatReaction({
    required this.emoji,
    this.targetMessageId,
    this.senderName,
    this.senderJid,
    this.timestamp,
    this.fromMe = false,
  });

  final String emoji;
  final String? targetMessageId;
  final String? senderName;
  final String? senderJid;
  final DateTime? timestamp;
  final bool fromMe;
}

class ChatPollOption {
  const ChatPollOption({
    required this.id,
    required this.title,
    this.voteCount = 0,
    this.voterNames = const [],
  });

  final String id;
  final String title;
  final int voteCount;
  final List<String> voterNames;
}

class ChatContactCard {
  const ChatContactCard({
    required this.displayName,
    required this.phoneNumber,
    required this.vcard,
  });

  final String displayName;
  final String phoneNumber;
  final String vcard;

  String get phoneDigits => phoneNumber.replaceAll(RegExp(r'\D+'), '');

  String get whatsappJid =>
      phoneDigits.isEmpty ? '' : '$phoneDigits@s.whatsapp.net';
}

class ChatInteractiveButton {
  const ChatInteractiveButton({
    required this.id,
    required this.title,
    this.description,
    this.type,
    this.url,
    this.phoneNumber,
    this.copyCode,
    this.responseType = 'button',
  });

  final String id;
  final String title;
  final String? description;
  final String? type;
  final String? url;
  final String? phoneNumber;
  final String? copyCode;
  final String responseType;
}

class ChatInteractiveSection {
  const ChatInteractiveSection({required this.title, required this.rows});

  final String title;
  final List<ChatInteractiveButton> rows;
}

String _firstString(
  Object? first,
  Object? second,
  Object? third, [
  Object? fourth,
  Object? fifth,
  Object? sixth,
]) {
  for (final value in [first, second, third, fourth, fifth, sixth]) {
    final text = value?.toString().trim() ?? '';
    if (text.isNotEmpty) return text;
  }
  return '';
}

String _firstStringFromList(Iterable<Object?> values) {
  for (final value in values) {
    final text = value?.toString().trim() ?? '';
    if (text.isNotEmpty) return text;
  }
  return '';
}

String? _firstNullableString(
  Object? first, [
  Object? second,
  Object? third,
  Object? fourth,
  Object? fifth,
  Object? sixth,
  Object? seventh,
  Object? eighth,
  Object? ninth,
]) {
  final found = _firstStringFromList([
    first,
    second,
    third,
    fourth,
    fifth,
    sixth,
    seventh,
    eighth,
    ninth,
  ]);
  return found.isEmpty ? null : found;
}

String _cleanSenderName(Object? value) {
  if (value is Map || value is Iterable) return '';
  final text = value?.toString().trim() ?? '';
  if (text.isEmpty || text.toLowerCase() == 'null') return '';
  final lowered = text.toLowerCase();
  if (lowered.contains('@s.whatsapp.net') ||
      lowered.contains('@c.us') ||
      lowered.contains('@g.us') ||
      lowered.contains('@newsletter')) {
    return '';
  }
  return text;
}

String _fallbackSenderName(String? senderJid, ConversationThread thread) {
  final phone = _formatWhatsappPhone(senderJid);
  if (phone.isNotEmpty) return phone;
  return thread.isGroup ? 'Participante' : thread.title;
}

String _formatWhatsappPhone(String? jid) {
  final raw = (jid ?? '').trim();
  if (raw.isEmpty) return '';
  final local = raw.contains('@') ? raw.split('@').first : raw;
  final digits = local.replaceAll(RegExp(r'\D+'), '');
  if (digits.isEmpty) return '';
  if (digits.length == 13 && digits.startsWith('55')) {
    return '+${digits.substring(0, 2)} ${digits.substring(2, 4)} ${digits.substring(4, 9)}-${digits.substring(9)}';
  }
  if (digits.length == 12 && digits.startsWith('55')) {
    return '+${digits.substring(0, 2)} ${digits.substring(2, 4)} ${digits.substring(4, 8)}-${digits.substring(8)}';
  }
  if (digits.length > 10) return '+$digits';
  return digits;
}

String? _buildMediaEndpoint(ConversationThread thread, String messageId) {
  final key = messageId.trim();
  if (key.isEmpty) return null;
  final chatJid = Uri.encodeComponent(thread.chatJid);
  final encodedMessageId = Uri.encodeComponent(key);
  return '/api/bot-instances/${thread.instanceId}/whatsapp-conversations/$chatJid/messages/$encodedMessageId/media';
}

String? _resolveMediaUrl(
  ConversationThread thread,
  String messageId,
  String? messageType,
  Map<String, dynamic> media,
  Map<String, dynamic> json,
) {
  final directUrl = _firstNullableString(
    json['mediaUrl'],
    json['downloadUrl'],
    media['publicUrl'],
    media['localUrl'],
    media['mediaUrl'],
    media['url'],
  );
  final pathUrl = _firstNullableString(
    json['path'],
    media['mediaUrl'],
    media['path'],
    media['filePath'],
  );
  final candidate = directUrl ?? pathUrl;
  final source = _firstNullableString(media['source'], media['provider']);
  if (candidate != null && source?.toLowerCase() == 'giphy') {
    return candidate;
  }
  final normalizedType = _normalizeType(messageType);
  final shouldUseRecoverableEndpoint = const {
    'image',
    'video',
    'audio',
    'sticker',
    'document',
  }.contains(normalizedType);
  if (shouldUseRecoverableEndpoint) {
    return _buildMediaEndpoint(thread, messageId) ?? candidate;
  }
  final hasWhatsappEncryptedSource =
      _hasResolvableMedia(messageType, media) &&
      (_hasMediaKey(media) ||
          _hasDirectPath(media) ||
          (candidate?.contains('mmg.whatsapp.net') ?? false) ||
          (candidate?.endsWith('.enc') ?? false));
  if (hasWhatsappEncryptedSource) {
    return _buildMediaEndpoint(thread, messageId) ?? candidate;
  }
  return candidate;
}

bool _hasDirectPath(Map<String, dynamic> media) =>
    _firstNullableString(media['directPath'], media['DirectPath']) != null;

bool _hasMediaKey(Map<String, dynamic> media) =>
    _firstNullableString(media['mediaKey'], media['MediaKey']) != null;

bool _hasResolvableMedia(String? type, Map<String, dynamic> media) {
  final normalizedType = _normalizeType(type);
  if (normalizedType.isNotEmpty &&
      !const {
        'image',
        'video',
        'audio',
        'sticker',
        'document',
      }.contains(normalizedType)) {
    return false;
  }
  const mediaKeys = [
    'directPath',
    'DirectPath',
    'mediaKey',
    'MediaKey',
    'url',
    'mediaUrl',
    'MediaUrl',
    'path',
    'filePath',
    'dataUrl',
  ];
  return mediaKeys.any((key) => media[key] != null);
}

ChatQuotedMessage? _parseQuoted(Map<String, dynamic> quoted) {
  if (quoted.isEmpty) return null;
  final item = ChatQuotedMessage(
    id: _firstNullableString(
      quoted['stanzaId'],
      quoted['id'],
      quoted['messageId'],
      quoted['quotedMessageId'],
    ),
    participant: _firstNullableString(
      quoted['participant'],
      quoted['senderJid'],
      quoted['remoteJid'],
    ),
    title: _firstNullableString(
      quoted['title'],
      quoted['senderName'],
      quoted['name'],
      quoted['pushName'],
    ),
    text: _firstNullableString(
      quoted['text'],
      quoted['caption'],
      quoted['body'],
      quoted['preview'],
    ),
    messageType: _firstNullableString(
      quoted['messageType'],
      quoted['type'],
      quoted['mediaType'],
    ),
  );
  return item.hasContent ? item : null;
}

ChatReaction? _parseReaction(
  Map<String, dynamic> media,
  Map<String, dynamic> json,
  String senderName,
  String messageId,
) {
  final normalizedType = _normalizeType(
    json['messageType']?.toString() ?? media['mediaType']?.toString(),
  );
  final isReaction =
      normalizedType == 'reaction' ||
      media['kind']?.toString().toLowerCase() == 'reaction';
  if (!isReaction) return null;
  final emoji = _firstNullableString(
    media['emoji'],
    media['reaction'],
    media['caption'],
    json['text'],
  );
  if (emoji == null) return null;
  return ChatReaction(
    emoji: emoji,
    targetMessageId: _firstNullableString(
      media['targetMessageId'],
      media['messageId'],
      _map(media['quoted'])['stanzaId'],
      _map(media['quoted'])['messageId'],
    ),
    senderName: senderName,
    senderJid: _firstNullableString(
      json['senderJid'],
      media['participant'],
      json['participant'],
    ),
    timestamp: _asDate(json['timestamp'] ?? json['createdAt']),
    fromMe:
        json['fromMe'] == true ||
        json['isFromMe'] == true ||
        json['direction']?.toString() == 'outbound',
  );
}

/// Lista de reações já agregadas no payload da mensagem (quando a API envia).
List<ChatReaction> _parseReactionsList(
  Map<String, dynamic> json,
  Map<String, dynamic> media,
  String messageId,
) {
  final raw = json['reactions'] ?? media['reactions'] ?? media['reactionList'];
  if (raw is! List) return const [];
  final out = <ChatReaction>[];
  for (final entry in raw) {
    if (entry is! Map) continue;
    final map = entry is Map<String, dynamic>
        ? entry
        : entry.cast<String, dynamic>();
    final emoji = _firstNullableString(
      map['emoji'],
      map['reaction'],
      map['text'],
    );
    if (emoji == null || emoji.trim().isEmpty) continue;
    out.add(
      ChatReaction(
        emoji: emoji.trim(),
        targetMessageId: _firstNullableString(
          map['targetMessageId'],
          map['messageId'],
          messageId,
        ),
        senderName: _firstNullableString(
          map['senderName'],
          map['pushName'],
          map['name'],
        ),
        senderJid: _firstNullableString(
          map['senderJid'],
          map['participant'],
          map['jid'],
        ),
        timestamp: _asNullableDate(map['timestamp'] ?? map['createdAt']),
        fromMe:
            map['fromMe'] == true ||
            map['isFromMe'] == true ||
            map['direction']?.toString() == 'outbound',
      ),
    );
  }
  return out;
}

String _normalizeType(String? value) {
  final type = (value ?? '').trim().toLowerCase().replaceAll(
    RegExp(r'message$'),
    '',
  );
  if (type.isEmpty) return 'text';
  if (type.contains('reaction')) return 'reaction';
  if (type.contains('sticker')) return 'sticker';
  if (type.contains('image')) return 'image';
  if (type.contains('video') || type.contains('ptv')) return 'video';
  if (type.contains('audio') || type.contains('ptt')) return 'audio';
  if (type.contains('document') || type.contains('file')) return 'document';
  if (type.contains('button') ||
      type.contains('interactive') ||
      type.contains('list')) {
    return 'interactive';
  }
  if (type.contains('poll')) return 'poll';
  if (type.contains('contact') || type.contains('vcard')) return 'contact';
  if (type.contains('location') || type.contains('live_location')) {
    return 'location';
  }
  if (type.contains('undecryptable') || type.contains('unavailable')) {
    return 'undecryptable';
  }
  return type;
}

int? _firstInt(Object? first, [Object? second, Object? third, Object? fourth]) {
  for (final value in [first, second, third, fourth]) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    final parsed = int.tryParse(value?.toString() ?? '');
    if (parsed != null) return parsed;
  }
  return null;
}

String? _thumbnailUrl(Map<String, dynamic> media, Map<String, dynamic> json) {
  final direct = _firstNullableString(
    json['thumbnailUrl'],
    json['previewUrl'],
    media['thumbnailUrl'],
    media['previewUrl'],
    media['thumbnail'],
    media['Thumbnail'],
  );
  if (direct == null) return null;
  if (direct.startsWith('data:') || direct.startsWith('http')) return direct;
  if (_looksLikeBase64(direct)) {
    final mime =
        _firstNullableString(
          media['thumbnailMimeType'],
          media['mimeType'],
          media['mimetype'],
        ) ??
        'image/jpeg';
    return 'data:$mime;base64,${direct.replaceAll(RegExp(r'\s+'), '')}';
  }
  return direct;
}

bool _looksLikeBase64(String value) {
  final cleaned = value.replaceAll(RegExp(r'\s+'), '');
  return cleaned.length > 80 && RegExp(r'^[A-Za-z0-9+/=]+$').hasMatch(cleaned);
}

List<Map<String, dynamic>> _recordList(Object? value) {
  if (value is List) {
    return value
        .whereType<Map>()
        .map((entry) => entry.cast<String, dynamic>())
        .toList();
  }
  if (value is Map) {
    final record = value.cast<String, dynamic>();
    for (final key in [
      'rows',
      'Rows',
      'options',
      'Options',
      'buttons',
      'Buttons',
    ]) {
      final nested = _recordList(record[key]);
      if (nested.isNotEmpty) return nested;
    }
  }
  return const [];
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value
        .map((entry) => entry?.toString().trim() ?? '')
        .where((entry) => entry.isNotEmpty)
        .toList();
  }
  return const [];
}

List<ChatPollOption> _parsePollOptions(Map<String, dynamic> media) {
  final poll = _map(media['poll']);
  final records = [
    ..._recordList(media['pollOptions']),
    ..._recordList(media['options']),
    ..._recordList(media['selectableOptions']),
    ..._recordList(poll['options']),
  ];
  final seen = <String>{};
  final result = <ChatPollOption>[];
  for (final record in records) {
    final title = _firstStringFromList([
      record['title'],
      record['name'],
      record['text'],
      record['optionName'],
      record['option'],
    ]);
    if (title.isEmpty) continue;
    final id = _firstStringFromList([
      record['id'],
      record['hash'],
      record['optionHash'],
      record['optionId'],
      title,
    ]);
    final key = id.isEmpty ? title : id;
    if (!seen.add(key)) continue;
    result.add(
      ChatPollOption(
        id: key,
        title: title,
        voteCount:
            _firstInt(record['voteCount'], record['votes'], record['count']) ??
            _stringList(record['voters']).length,
        voterNames: _stringList(record['voterNames'] ?? record['voters']),
      ),
    );
  }
  return result;
}

List<ChatContactCard> _parseContacts(Map<String, dynamic> media) {
  final records = <Map<String, dynamic>>[
    ..._recordList(media['contacts']),
    ..._recordList(media['contact']),
    ..._recordList(media['contactsArray']),
  ];
  if (records.isEmpty &&
      [
        media['displayName'],
        media['phoneNumber'],
        media['vcard'],
      ].any((value) => value?.toString().trim().isNotEmpty == true)) {
    records.add(media);
  }

  final seen = <String>{};
  final result = <ChatContactCard>[];
  for (final record in records) {
    final vcard =
        _firstNullableString(
          record['vcard'],
          record['vCard'],
          record['Vcard'],
          record['VCARD'],
        ) ??
        '';
    final phone =
        _firstNullableString(
          record['phoneNumber'],
          record['phone'],
          record['waId'],
          record['waid'],
          record['jid'],
        ) ??
        _phoneFromVcard(vcard) ??
        '';
    final name =
        _firstNullableString(
          record['displayName'],
          record['name'],
          record['fullName'],
        ) ??
        _nameFromVcard(vcard) ??
        (phone.isEmpty ? 'Contato' : _formatContactPhone(phone));
    final key = phone.replaceAll(RegExp(r'\D+'), '').isNotEmpty
        ? phone.replaceAll(RegExp(r'\D+'), '')
        : '$name\n$vcard';
    if (!seen.add(key)) continue;
    result.add(
      ChatContactCard(
        displayName: name,
        phoneNumber: _formatContactPhone(phone),
        vcard: vcard.isNotEmpty
            ? vcard
            : _buildVcard(displayName: name, phoneNumber: phone),
      ),
    );
  }
  return result;
}

String? _phoneFromVcard(String value) {
  if (value.trim().isEmpty) return null;
  final waid = RegExp(
    r'(?:^|;)waid=(\d+)',
    caseSensitive: false,
    multiLine: true,
  ).firstMatch(value);
  if (waid != null) return '+${waid.group(1)}';
  for (final line in value.split(RegExp(r'\r?\n'))) {
    if (!RegExp(
      r'^(?:item\d+\.)?tel(?:[;:])',
      caseSensitive: false,
    ).hasMatch(line.trim())) {
      continue;
    }
    final separator = line.indexOf(':');
    final raw = separator >= 0 ? line.substring(separator + 1) : line;
    final digits = raw.replaceAll(RegExp(r'\D+'), '');
    if (digits.isNotEmpty) return '+$digits';
  }
  return null;
}

String? _nameFromVcard(String value) {
  for (final line in value.split(RegExp(r'\r?\n'))) {
    final trimmed = line.trim();
    if (!trimmed.toUpperCase().startsWith('FN:')) continue;
    final name = trimmed.substring(3).trim();
    if (name.isNotEmpty) return name.replaceAll(r'\,', ',');
  }
  return null;
}

String _formatContactPhone(String value) {
  final digits = value.replaceAll(RegExp(r'\D+'), '');
  if (digits.isEmpty) return value.trim();
  return _formatWhatsappPhone(digits);
}

String _buildVcard({required String displayName, required String phoneNumber}) {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:${displayName.replaceAll(',', r'\,')}',
    if (phoneNumber.trim().isNotEmpty) 'TEL;TYPE=CELL:$phoneNumber',
    'END:VCARD',
  ].join('\n');
}

List<ChatInteractiveButton> _parseInteractiveButtons(
  Map<String, dynamic> media, {
  String responseType = 'button',
}) {
  final records = [
    ..._recordList(media['buttons']),
    ..._recordList(media['Buttons']),
    ..._recordList(_map(media['nativeFlow'])['buttons']),
    ..._recordList(_map(media['nativeFlowMessage'])['buttons']),
  ];
  final seen = <String>{};
  final result = <ChatInteractiveButton>[];
  for (final record in records) {
    final parsedParams = _parseJsonMap(
      record['buttonParamsJson'] ??
          record['buttonParamsJSON'] ??
          record['paramsJson'] ??
          record['paramsJSON'],
    );
    final params = <String, dynamic>{
      ...?parsedParams,
      ..._map(record['params'] ?? record['Params']),
    };
    final title = _localizeInteractiveText(
      _firstStringFromList([
        record['title'],
        record['text'],
        record['displayText'],
        record['buttonText'],
        record['flowCta'],
        record['flow_cta'],
        params['title'],
        params['text'],
        params['display_text'],
        params['flow_cta'],
        record['name'],
      ]),
    );
    final copyCode = _firstNullableString(
      record['copyCode'],
      record['copy_code'],
      record['clipboardText'],
      record['clipboard_text'],
    );
    final rawType = _firstNullableString(
      record['type'],
      record['Type'],
      record['name'],
      record['Name'],
      record['buttonType'],
      record['button_type'],
      params['type'],
    );
    final normalizedType = (rawType ?? '')
        .trim()
        .toLowerCase()
        .replaceAll('-', '_')
        .replaceAll(' ', '_');
    final isCta = const {
      'cta_url',
      'url',
      'link',
      'cta_copy',
      'copy',
      'copy_code',
      'phone',
      'call',
    }.contains(normalizedType);
    final flowId = _firstNullableString(
      record['flowId'],
      record['flow_id'],
      params['flowId'],
      params['flow_id'],
    );
    final isFlow =
        flowId != null ||
        normalizedType == 'galaxy_message' ||
        params['form_type'] == 'template';
    final isReply = !isCta && !isFlow;
    final type = isFlow ? 'flow' : (isReply ? 'reply' : rawType);
    if (title.isEmpty && copyCode == null) continue;
    final id = _firstStringFromList([
      record['id'],
      record['buttonId'],
      record['selectedId'],
      record['payload'],
      flowId,
      title,
      copyCode,
    ]);
    final key = id.isEmpty ? title : id;
    if (!seen.add('$responseType:$key')) continue;
    result.add(
      ChatInteractiveButton(
        id: key,
        title: title.isEmpty ? 'Copiar código' : title,
        description: _firstNullableString(
          record['description'],
          record['subtitle'],
        ),
        type: type,
        url: isReply
            ? null
            : _firstNullableString(
                record['url'],
                record['URL'],
                record['href'],
              ),
        phoneNumber: _firstNullableString(
          record['phoneNumber'],
          record['phone_number'],
          record['PhoneNumber'],
        ),
        copyCode: copyCode,
        responseType: responseType,
      ),
    );
  }
  return result;
}

Map<String, dynamic>? _parseJsonMap(Object? value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  final raw = value?.toString().trim();
  if (raw == null || raw.isEmpty || !raw.startsWith('{')) return null;
  try {
    final decoded = jsonDecode(raw);
    return decoded is Map ? Map<String, dynamic>.from(decoded) : null;
  } catch (_) {
    return null;
  }
}

String _localizeInteractiveText(String value) {
  switch (value.trim().toUpperCase()) {
    case '__LOCALIZE:FLOWS_COMPLETE_FORM_BUTTON_TITLE':
    case 'FLOWS_COMPLETE_FORM_BUTTON_TITLE':
      return 'Preencher formulário';
    case '__LOCALIZE:FLOWS_SUBMIT_BUTTON_TITLE':
    case 'FLOWS_SUBMIT_BUTTON_TITLE':
      return 'Enviar';
    default:
      return value.trim();
  }
}

List<ChatInteractiveSection> _parseInteractiveSections(
  Map<String, dynamic> media,
) {
  final sections = [
    ..._recordList(media['sections']),
    ..._recordList(media['Sections']),
    ..._recordList(_map(media['list'])['sections']),
  ];
  final result = <ChatInteractiveSection>[];
  for (final section in sections) {
    final rows = _recordList(section['rows'] ?? section['Rows'])
        .map((row) {
          final title = _firstStringFromList([
            row['title'],
            row['name'],
            row['text'],
            row['displayText'],
          ]);
          if (title.isEmpty) return null;
          final id = _firstStringFromList([
            row['id'],
            row['rowId'],
            row['selectedRowId'],
            row['payload'],
            title,
          ]);
          return ChatInteractiveButton(
            id: id.isEmpty ? title : id,
            title: title,
            description: _firstNullableString(
              row['description'],
              row['subtitle'],
            ),
            responseType: 'list',
          );
        })
        .whereType<ChatInteractiveButton>()
        .toList();
    if (rows.isEmpty) continue;
    result.add(
      ChatInteractiveSection(
        title: _firstStringFromList([
          section['title'],
          section['name'],
          section['label'],
        ]),
        rows: rows,
      ),
    );
  }
  return result;
}

bool _asBool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final normalized = value?.toString().trim().toLowerCase();
  return normalized == 'true' || normalized == '1' || normalized == 'yes';
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return const {};
}

DateTime _asDate(Object? value) {
  if (value is num) {
    final raw = value.toInt();
    return DateTime.fromMillisecondsSinceEpoch(
      raw < 10000000000 ? raw * 1000 : raw,
    );
  }
  return DateTime.tryParse(value?.toString() ?? '') ?? DateTime.now();
}

DateTime? _asNullableDate(Object? value) {
  if (value == null) return null;
  if (value is num) {
    final raw = value.toInt();
    if (raw <= 0) return null;
    return DateTime.fromMillisecondsSinceEpoch(
      raw < 10000000000 ? raw * 1000 : raw,
    );
  }
  final text = value.toString().trim();
  if (text.isEmpty || text.toLowerCase() == 'null') return null;
  return DateTime.tryParse(text);
}
