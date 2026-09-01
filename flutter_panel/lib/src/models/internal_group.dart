import 'chat_message.dart';
import 'conversation_thread.dart';

class InternalGroup {
  const InternalGroup({
    required this.id,
    required this.name,
    required this.role,
    required this.memberCount,
    required this.unreadCount,
    required this.canManage,
    this.botGroupId,
    this.botEnabled = false,
    this.botName = 'Robô BotAdmin',
    this.botAvatarUrl,
    this.adminsOnly = false,
    this.membersCanSend = true,
    this.membersCanAdd = true,
    this.approvalRequired = false,
    this.adminsCanEdit = true,
    this.membersCanStartPv = true,
    this.isActive = true,
    this.welcomeEnabled = false,
    this.welcomeMessage,
    this.pinned = false,
    this.archived = false,
    this.description,
    this.avatarUrl,
    this.wallpaperUrl,
    this.lastMessage,
    this.createdAt,
    this.updatedAt,
    this.inviteUrl,
    this.hasUnreadMention = false,
  });

  final int id;
  final String name;
  final String? description;
  final String? avatarUrl;
  final String? wallpaperUrl;
  final String role;
  final int memberCount;
  final int unreadCount;
  final bool canManage;
  final int? botGroupId;
  final bool botEnabled;
  final String botName;
  final String? botAvatarUrl;
  final bool adminsOnly;
  final bool membersCanSend;
  final bool membersCanAdd;
  final bool approvalRequired;
  final bool adminsCanEdit;
  final bool membersCanStartPv;
  final bool isActive;
  final bool welcomeEnabled;
  final String? welcomeMessage;
  final bool pinned;
  final bool archived;
  final InternalGroupMessage? lastMessage;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String? inviteUrl;
  final bool hasUnreadMention;

  bool get isOwner => role == 'owner';

  factory InternalGroup.fromJson(Map<String, dynamic> json) => InternalGroup(
    id: _asInt(json['id']),
    name: json['name']?.toString() ?? 'Grupo BotAdmin',
    description: _nullable(json['description']),
    avatarUrl: _nullable(json['avatarUrl']),
    wallpaperUrl: _nullable(json['wallpaperUrl']),
    role: json['role']?.toString() ?? 'member',
    memberCount: _asInt(json['memberCount']),
    unreadCount: _asInt(json['unreadCount']),
    canManage: json['canManage'] == true,
    botGroupId: _asNullableInt(json['botGroupId']),
    botEnabled: json['botEnabled'] == true,
    botName: json['botName']?.toString().trim().isNotEmpty == true
        ? json['botName'].toString().trim()
        : 'Robô BotAdmin',
    botAvatarUrl: _nullable(json['botAvatarUrl']),
    adminsOnly: json['adminsOnly'] == true,
    membersCanSend: json['membersCanSend'] != false,
    membersCanAdd: json['membersCanAdd'] != false,
    approvalRequired: json['approvalRequired'] == true,
    adminsCanEdit: json['adminsCanEdit'] != false,
    membersCanStartPv: json['membersCanStartPv'] != false,
    isActive: json['isActive'] != false,
    welcomeEnabled: json['welcomeEnabled'] == true,
    welcomeMessage: _nullable(json['welcomeMessage']),
    pinned: json['pinned'] == true,
    archived: json['archived'] == true,
    lastMessage: json['lastMessage'] is Map
        ? InternalGroupMessage.fromJson(
            Map<String, dynamic>.from(json['lastMessage'] as Map),
          )
        : null,
    createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? ''),
    updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? ''),
    inviteUrl: _nullable(json['inviteUrl']),
    hasUnreadMention: json['hasUnreadMention'] == true,
  );

  ConversationThread toConversationThread() => ConversationThread(
    instanceId: 0,
    chatJid: 'internal-group:$id',
    title: name,
    lastMessage: lastMessage?.text ?? _internalMediaPreview(lastMessage?.type),
    lastActivity:
        lastMessage?.createdAt ?? updatedAt ?? createdAt ?? DateTime(1970),
    unreadCount: unreadCount,
    lastMessageDirection: lastMessage?.isMine == true ? 'outbound' : 'inbound',
    lastMessageSenderName: lastMessage?.senderName,
    avatarUrl: avatarUrl,
    chatType: 'internal_group',
    groupDescription: description,
    participantsCount: memberCount,
    linkedGroupId: id,
    internalBotGroupId: botGroupId,
    internalBotEnabled: botEnabled,
    internalGroupRole: role,
    announceOnly: adminsOnly,
    canSendMessages: !adminsOnly || canManage,
    membersCanStartPv: membersCanStartPv,
    instanceIsAdmin: canManage,
    pinned: pinned,
    archived: archived,
    hasUnreadMention: hasUnreadMention,
  );
}

class InternalGroupMember {
  const InternalGroupMember({
    required this.userId,
    required this.name,
    required this.role,
    required this.isMe,
    this.avatarUrl,
    this.joinedAt,
    this.isBot = false,
  });

  final int userId;
  final String name;
  final String? avatarUrl;
  final String role;
  final bool isMe;
  final DateTime? joinedAt;
  final bool isBot;

  factory InternalGroupMember.fromJson(Map<String, dynamic> json) =>
      InternalGroupMember(
        userId: _asInt(json['userId']),
        name: json['name']?.toString() ?? 'Membro',
        avatarUrl: _nullable(json['avatarUrl']),
        role: json['role']?.toString() ?? 'member',
        isMe: json['isMe'] == true,
        joinedAt: DateTime.tryParse(json['joinedAt']?.toString() ?? ''),
        isBot: json['isBot'] == true || json['role']?.toString() == 'bot',
      );
}

class InternalGroupMessage {
  const InternalGroupMessage({
    required this.id,
    this.clientMessageId,
    required this.groupId,
    required this.senderId,
    required this.senderName,
    required this.type,
    required this.isMine,
    required this.deleted,
    this.senderAvatarUrl,
    this.text,
    this.mediaUrl,
    this.mediaSourceUrl,
    this.mediaMimeType,
    this.mediaFileName,
    this.mediaSize,
    this.replyTo,
    this.reactions = const [],
    this.createdAt,
    this.editedAt,
    this.isBot = false,
    this.pinned = false,
    this.buttons = const [],
    this.pollOptions = const [],
    this.canRevealDeleted = false,
    this.deletedByName,
    this.viewOnce = false,
    this.viewOnceOpened = false,
    this.mentionedUserIds = const [],
    this.mentionsMe = false,
    this.deliveryState,
    this.receiptSummary = const <String, int>{},
    this.receipts = const <MessageReceipt>[],
  });

  final int id;
  final String? clientMessageId;
  final int groupId;
  final int senderId;
  final String senderName;
  final String? senderAvatarUrl;
  final String type;
  final String? text;
  final String? mediaUrl;
  final String? mediaSourceUrl;
  final String? mediaMimeType;
  final String? mediaFileName;
  final int? mediaSize;
  final InternalGroupReply? replyTo;
  final List<ChatReaction> reactions;
  final bool isMine;
  final bool deleted;
  final DateTime? createdAt;
  final DateTime? editedAt;
  final bool isBot;
  final bool pinned;
  final List<InternalGroupButton> buttons;
  final List<ChatPollOption> pollOptions;
  final bool canRevealDeleted;
  final String? deletedByName;
  final bool viewOnce;
  final bool viewOnceOpened;
  final List<int> mentionedUserIds;
  final bool mentionsMe;
  final MessageDeliveryState? deliveryState;
  final Map<String, int> receiptSummary;
  final List<MessageReceipt> receipts;

  factory InternalGroupMessage.fromJson(Map<String, dynamic> json) =>
      InternalGroupMessage(
        id: _asInt(json['id']),
        clientMessageId: _nullable(json['clientMessageId']),
        groupId: _asInt(json['groupId']),
        senderId: _asInt(json['senderId']),
        senderName: json['senderName']?.toString() ?? 'Membro',
        senderAvatarUrl: _nullable(json['senderAvatarUrl']),
        type: json['type']?.toString() ?? 'text',
        text: _nullable(json['text']),
        mediaUrl: _nullable(json['mediaUrl']),
        mediaSourceUrl: _nullable(json['mediaSourceUrl']),
        mediaMimeType: _nullable(json['mediaMimeType']),
        mediaFileName: _nullable(json['mediaFileName']),
        mediaSize: json['mediaSize'] == null ? null : _asInt(json['mediaSize']),
        replyTo: json['replyTo'] is Map
            ? InternalGroupReply.fromJson(
                Map<String, dynamic>.from(json['replyTo'] as Map),
              )
            : null,
        reactions: (json['reactions'] as List? ?? const [])
            .whereType<Map>()
            .map((item) {
              final reaction = Map<String, dynamic>.from(item);
              return ChatReaction(
                emoji: reaction['emoji']?.toString() ?? '',
                targetMessageId: '${json['id']}',
                senderName: _nullable(reaction['senderName']),
                senderJid: _nullable(reaction['senderJid']),
                fromMe: reaction['fromMe'] == true,
                timestamp: DateTime.tryParse(
                  reaction['timestamp']?.toString() ?? '',
                ),
              );
            })
            .where((reaction) => reaction.emoji.isNotEmpty)
            .toList(growable: false),
        isMine: json['isMine'] == true,
        deleted: json['deleted'] == true,
        canRevealDeleted: json['canRevealDeleted'] == true,
        deletedByName: _nullable(json['deletedByName']),
        viewOnce: json['viewOnce'] == true,
        viewOnceOpened: json['viewOnceOpened'] == true,
        mentionedUserIds: (json['mentionedUserIds'] as List? ?? const [])
            .map(_asInt)
            .where((id) => id > 0)
            .toList(growable: false),
        mentionsMe: json['mentionsMe'] == true,
        deliveryState: _deliveryState(json['deliveryState']),
        receiptSummary: _receiptSummary(json['receiptSummary']),
        receipts: _receipts(json['receipts']),
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? ''),
        editedAt: DateTime.tryParse(json['editedAt']?.toString() ?? ''),
        isBot: json['isBot'] == true,
        pinned: json['pinned'] == true,
        buttons: (json['buttons'] as List? ?? const [])
            .whereType<Map>()
            .map(
              (item) =>
                  InternalGroupButton.fromJson(Map<String, dynamic>.from(item)),
            )
            .toList(growable: false),
        pollOptions: (json['pollOptions'] as List? ?? const [])
            .whereType<Map>()
            .map((item) {
              final option = Map<String, dynamic>.from(item);
              return ChatPollOption(
                id: option['id']?.toString() ?? '',
                title: option['title']?.toString() ?? '',
                voteCount: _asInt(option['voteCount'] ?? option['votes']),
                voterNames: (option['voterNames'] as List? ?? const [])
                    .map((name) => name.toString())
                    .where((name) => name.isNotEmpty)
                    .toList(growable: false),
              );
            })
            .where((option) => option.id.isNotEmpty && option.title.isNotEmpty)
            .toList(growable: false),
      );

  ChatMessage toChatMessage(ConversationThread thread) => ChatMessage(
    id: '$id',
    remoteId: '$id',
    clientMessageId: clientMessageId,
    text: text ?? '',
    timestamp: createdAt ?? DateTime(1970),
    editedAt: editedAt,
    fromMe: isMine,
    senderName: senderName,
    senderJid: isBot ? 'botadmin-bot:$groupId' : 'botadmin-user:$senderId',
    senderAvatarUrl: senderAvatarUrl,
    mediaUrl: mediaUrl,
    mediaThumbnailUrl: mediaSourceUrl,
    messageType: pollOptions.isNotEmpty
        ? 'poll'
        : buttons.isNotEmpty
        ? 'interactive'
        : type,
    mediaFileName: mediaFileName,
    mediaMimeType: mediaMimeType,
    mediaCaption: text,
    mediaSizeBytes: mediaSize,
    media: <String, dynamic>{
      if (mediaUrl != null && mediaUrl!.trim().isNotEmpty) ...{
        'mediaType': (mediaMimeType ?? '').toLowerCase().contains('video')
            ? 'video'
            : (mediaMimeType ?? '').toLowerCase().contains('audio')
            ? 'audio'
            : 'image',
        'url': mediaUrl,
        if (mediaSourceUrl != null && mediaSourceUrl!.trim().isNotEmpty)
          'fallbackUrl': mediaSourceUrl,
        'mimeType': mediaMimeType,
        'fileName': mediaFileName,
      },
      if (viewOnce) 'viewOnce': true,
      if (viewOnce) 'viewOnceOpened': viewOnceOpened,
      if (buttons.isNotEmpty)
        'buttons': buttons
            .map(
              (button) => <String, dynamic>{
                'id': button.id,
                'title': button.title,
                'type': button.id,
                'payload': button.payload,
              },
            )
            .toList(growable: false),
      if (pollOptions.isNotEmpty)
        'pollOptions': pollOptions
            .map(
              (option) => <String, dynamic>{
                'id': option.id,
                'title': option.title,
                'voteCount': option.voteCount,
                'voterNames': option.voterNames,
              },
            )
            .toList(growable: false),
    },
    pollOptions: pollOptions,
    interactiveButtons: buttons
        .map(
          (button) => ChatInteractiveButton(
            id: button.id,
            title: button.title,
            type: button.id,
            url:
                button.payload['url']?.toString() ??
                button.payload['link']?.toString(),
            phoneNumber:
                button.payload['phone']?.toString() ??
                button.payload['phoneNumber']?.toString(),
            copyCode:
                button.payload['copyCode']?.toString() ??
                button.payload['copy']?.toString(),
            responseType: button.id,
          ),
        )
        .toList(growable: false),
    reactions: reactions,
    quoted: replyTo == null
        ? null
        : ChatQuotedMessage(
            text: replyTo!.text,
            title: replyTo!.senderName,
            participant: replyTo!.senderName,
          ),
    deletedAt: deleted ? createdAt ?? DateTime.now() : null,
    deletedByName: deletedByName,
    deletedPlaceholder: deleted ? 'Mensagem apagada' : null,
    canRevealDeletedContent: canRevealDeleted,
    deliveryState: deliveryState,
    receiptSummary: receiptSummary,
    receipts: receipts,
  );
}

MessageDeliveryState? _deliveryState(Object? value) {
  switch (value?.toString().toLowerCase()) {
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

Map<String, int> _receiptSummary(Object? value) {
  if (value is! Map) return const <String, int>{};
  int n(Object? x) => x is num ? x.toInt() : int.tryParse('$x') ?? 0;
  return {
    'recipientCount': n(value['recipientCount']),
    'deliveredCount': n(value['deliveredCount']),
    'readCount': n(value['readCount']),
  };
}

List<MessageReceipt> _receipts(Object? value) {
  if (value is! List) return const <MessageReceipt>[];
  return value
      .whereType<Map>()
      .map((raw) {
        final map = Map<String, dynamic>.from(raw);
        final state =
            _deliveryState(map['state']) ?? MessageDeliveryState.delivered;
        return MessageReceipt(
          userId: '${map['userId'] ?? map['user_id'] ?? ''}',
          name: '${map['name'] ?? 'Participante'}',
          avatarUrl: map['avatarUrl']?.toString(),
          state: state == MessageDeliveryState.sent
              ? MessageDeliveryState.delivered
              : state,
          deliveredAt: DateTime.tryParse('${map['deliveredAt'] ?? ''}'),
          readAt: DateTime.tryParse('${map['readAt'] ?? ''}'),
        );
      })
      .toList(growable: false);
}

class InternalGroupButton {
  const InternalGroupButton({
    required this.id,
    required this.title,
    this.payload = const {},
  });
  final String id;
  final String title;
  final Map<String, dynamic> payload;

  factory InternalGroupButton.fromJson(Map<String, dynamic> json) =>
      InternalGroupButton(
        id: json['id']?.toString() ?? '',
        title: json['title']?.toString() ?? '',
        payload: json['payload'] is Map
            ? Map<String, dynamic>.from(json['payload'] as Map)
            : const {},
      );
}

class InternalGroupReply {
  const InternalGroupReply({required this.id, this.text, this.senderName});
  final int id;
  final String? text;
  final String? senderName;

  factory InternalGroupReply.fromJson(Map<String, dynamic> json) =>
      InternalGroupReply(
        id: _asInt(json['id']),
        text: _nullable(json['text']),
        senderName: _nullable(json['senderName']),
      );
}

class InternalGroupDetails {
  const InternalGroupDetails({required this.group, required this.members});
  final InternalGroup group;
  final List<InternalGroupMember> members;

  factory InternalGroupDetails.fromJson(Map<String, dynamic> json) =>
      InternalGroupDetails(
        group: InternalGroup.fromJson(
          Map<String, dynamic>.from(json['group'] as Map),
        ),
        members: (json['members'] as List? ?? const [])
            .whereType<Map>()
            .map(
              (item) =>
                  InternalGroupMember.fromJson(Map<String, dynamic>.from(item)),
            )
            .toList(),
      );
}

int _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

int? _asNullableInt(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value.toString());
}

String? _nullable(Object? value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

String _internalMediaPreview(String? type) => switch (type) {
  'image' => '📷 Foto',
  'video' => '🎬 Vídeo',
  'audio' => '🎤 Áudio',
  'sticker' => 'Figurinha',
  'document' => '📎 Documento',
  _ => '',
};
