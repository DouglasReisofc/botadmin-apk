import 'chat_message.dart';

class AdminSupportUser {
  const AdminSupportUser({
    required this.id,
    required this.name,
    this.email,
    this.whatsappNumber,
    this.avatarUrl,
    this.isActive = true,
    this.hasActiveSubscription = false,
  });

  final int id;
  final String name;
  final String? email;
  final String? whatsappNumber;
  final String? avatarUrl;
  final bool isActive;
  final bool hasActiveSubscription;

  factory AdminSupportUser.fromJson(Map<String, dynamic> json) {
    return AdminSupportUser(
      id: _asInt(json['id']),
      name: json['name']?.toString() ?? '',
      email: json['email']?.toString(),
      whatsappNumber: json['whatsappNumber']?.toString(),
      avatarUrl: json['avatarUrl']?.toString(),
      isActive: json['isActive'] != false,
      hasActiveSubscription: json['hasActiveSubscription'] == true,
    );
  }
}

class AdminSupportThreadSummary {
  const AdminSupportThreadSummary({
    required this.whatsappId,
    required this.status,
    required this.handlingMode,
    required this.within24h,
    required this.minutesLeft24h,
    this.customerName,
    this.profileName,
    this.lastMessagePreview,
    this.lastMessageAt,
    this.displayWhatsappId,
    this.isAdminThread = false,
    this.unreadCount = 0,
    this.supportName,
    this.supportAvatarUrl,
    this.supportRole,
    this.lastMessageSenderRole,
  });

  final String whatsappId;
  final String status;
  final String handlingMode;
  final bool within24h;
  final int minutesLeft24h;
  final String? customerName;
  final String? profileName;
  final String? lastMessagePreview;
  final String? lastMessageAt;
  final String? displayWhatsappId;
  final bool isAdminThread;
  final int unreadCount;
  final String? supportName;
  final String? supportAvatarUrl;
  final String? supportRole;
  final String? lastMessageSenderRole;

  bool get isOpen => status == 'open';
  bool get isHuman => handlingMode == 'human';

  factory AdminSupportThreadSummary.fromJson(Map<String, dynamic> json) {
    return AdminSupportThreadSummary(
      whatsappId: json['whatsappId']?.toString() ?? '',
      status: json['status']?.toString() ?? 'open',
      handlingMode: json['handlingMode']?.toString() ?? 'bot',
      within24h: json['within24h'] == true,
      minutesLeft24h: _asInt(json['minutesLeft24h']),
      customerName: json['customerName']?.toString(),
      profileName: json['profileName']?.toString(),
      lastMessagePreview: json['lastMessagePreview']?.toString(),
      lastMessageAt: json['lastMessageAt']?.toString(),
      displayWhatsappId: json['displayWhatsappId']?.toString(),
      isAdminThread: json['isAdminThread'] == true,
      unreadCount: _asInt(json['unreadCount']),
      supportName: json['supportName']?.toString(),
      supportAvatarUrl: json['supportAvatarUrl']?.toString(),
      supportRole: json['supportRole']?.toString(),
      lastMessageSenderRole: json['lastMessageSenderRole']?.toString(),
    );
  }
}

class AdminSupportThreadEntry {
  const AdminSupportThreadEntry({required this.user, required this.thread});

  final AdminSupportUser user;
  final AdminSupportThreadSummary thread;

  String get key => '${user.id}:${thread.whatsappId}';

  String get displayName {
    final candidates = [
      user.name,
      thread.customerName,
      thread.profileName,
      user.email,
      user.whatsappNumber,
      thread.displayWhatsappId,
      thread.whatsappId,
    ];
    for (final candidate in candidates) {
      final value = candidate?.trim();
      if (value != null && value.isNotEmpty) return value;
    }
    return 'Cliente';
  }

  String get subtitle {
    final preview = thread.lastMessagePreview?.trim();
    if (preview != null && preview.isNotEmpty) return preview;
    final phone =
        user.whatsappNumber?.trim() ?? thread.displayWhatsappId?.trim();
    if (phone != null && phone.isNotEmpty) return phone;
    return thread.isHuman ? 'Atendimento humano' : 'Atendimento no bot';
  }

  factory AdminSupportThreadEntry.fromJson(Map<String, dynamic> json) {
    return AdminSupportThreadEntry(
      user: AdminSupportUser.fromJson(_map(json['user'])),
      thread: AdminSupportThreadSummary.fromJson(_map(json['thread'])),
    );
  }
}

class AdminSupportMedia {
  const AdminSupportMedia({
    required this.mediaType,
    this.mediaId,
    this.mediaUrl,
    this.mimeType,
    this.filename,
    this.caption,
  });

  final String mediaType;
  final String? mediaId;
  final String? mediaUrl;
  final String? mimeType;
  final String? filename;
  final String? caption;

  String? get resolvedUrl => resolvedUrlFor();

  String? resolvedUrlFor({int? userId, bool forAdmin = true}) {
    final direct = mediaUrl?.trim();
    if (direct != null && direct.isNotEmpty) return direct;
    final id = mediaId?.trim();
    if (id == null || id.isEmpty) return null;
    final path = '/api/${forAdmin ? 'admin/' : ''}support/media/${Uri.encodeComponent(id)}';
    if (!forAdmin || userId == null || userId <= 0) return path;
    return Uri(path: path, queryParameters: {'userId': '$userId'}).toString();
  }

  factory AdminSupportMedia.fromJson(Map<String, dynamic> json) {
    return AdminSupportMedia(
      mediaType: json['mediaType']?.toString() ?? 'document',
      mediaId: json['mediaId']?.toString(),
      mediaUrl: json['mediaUrl']?.toString(),
      mimeType: json['mimeType']?.toString(),
      filename: json['filename']?.toString(),
      caption: json['caption']?.toString(),
    );
  }
}

class AdminSupportMessage {
  const AdminSupportMessage({
    required this.id,
    required this.direction,
    required this.messageType,
    required this.timestamp,
    required this.senderRole,
    this.text,
    this.senderUserId,
    this.media,
    this.deliveryState = MessageDeliveryState.sent,
    this.isDeleted = false,
    this.editedAt,
    this.reactions = const [],
  });

  final int id;
  final String direction;
  final String messageType;
  final String timestamp;
  final String senderRole;
  final String? text;
  final int? senderUserId;
  final AdminSupportMedia? media;
  final MessageDeliveryState deliveryState;
  final bool isDeleted;
  final DateTime? editedAt;
  final List<ChatReaction> reactions;

  ChatMessage toChatMessage({
    required bool forAdmin,
    required bool isAdminThread,
    required String incomingName,
    int? supportUserId,
  }) {
    final own = forAdmin
        ? isOutboundForAdmin(isAdminThread: isAdminThread)
        : senderRole == 'user';
    final attachment = media;
    final url = attachment?.resolvedUrlFor(
      userId: supportUserId,
      forAdmin: forAdmin,
    );
    return ChatMessage(
      id: 'support-$id',
      remoteId: 'support-$id',
      text: text ?? '',
      timestamp:
          DateTime.tryParse(timestamp) ??
          DateTime.fromMillisecondsSinceEpoch(0),
      fromMe: own,
      senderName: own ? 'Você' : incomingName,
      messageType: attachment?.mediaType ?? messageType,
      mediaUrl: url,
      mediaMimeType: attachment?.mimeType,
      mediaFileName: attachment?.filename,
      mediaCaption: attachment?.caption,
      isAnimatedMedia: attachment?.mimeType == 'image/gif',
      deletedAt: isDeleted ? DateTime.tryParse(timestamp) : null,
      editedAt: editedAt,
      deletedByName: isDeleted
          ? (senderRole == 'admin' ? 'Administrador' : incomingName)
          : null,
      reactions: reactions,
      deliveryState: own ? deliveryState : null,
    );
  }

  /// `direction` is stored from the account owner's perspective. In the
  /// internal admin thread a user's message is also `outbound`.
  bool isOutboundForAdmin({required bool isAdminThread}) => isAdminThread
      ? senderRole == 'admin' || senderRole == 'system'
      : senderRole == 'admin' ||
            senderRole == 'system' ||
            (senderRole == 'user' && direction == 'outbound');

  factory AdminSupportMessage.fromJson(Map<String, dynamic> json) {
    final mediaJson = json['media'];
    return AdminSupportMessage(
      id: _asInt(json['id']),
      direction: json['direction']?.toString() ?? 'inbound',
      messageType: json['messageType']?.toString() ?? 'text',
      text: json['text']?.toString(),
      timestamp: json['timestamp']?.toString() ?? '',
      senderUserId: json['senderUserId'] == null
          ? null
          : _asInt(json['senderUserId']),
      senderRole: json['senderRole']?.toString() ?? 'contact',
      deliveryState: switch (json['deliveryState']) {
        'read' => MessageDeliveryState.read,
        'delivered' => MessageDeliveryState.delivered,
        _ => MessageDeliveryState.sent,
      },
      isDeleted: json['isDeleted'] == true,
      editedAt: DateTime.tryParse(json['editedAt']?.toString() ?? ''),
      reactions:
          (json['reactions'] is List ? (json['reactions'] as List) : const [])
              .whereType<Map>()
              .map(
                (item) => ChatReaction(
                  emoji: item['emoji']?.toString() ?? '',
                  targetMessageId: 'support-${_asInt(json['id'])}',
                  senderName: item['senderRole']?.toString() == 'admin'
                      ? 'Administrador'
                      : null,
                  senderJid: item['senderUserId']?.toString(),
                  fromMe: item['senderRole']?.toString() == 'admin',
                  timestamp: DateTime.tryParse(
                    item['timestamp']?.toString() ?? '',
                  ),
                ),
              )
              .where((reaction) => reaction.emoji.trim().isNotEmpty)
              .toList(growable: false),
      media: mediaJson is Map
          ? AdminSupportMedia.fromJson(mediaJson.cast<String, dynamic>())
          : null,
    );
  }
}

class AdminSupportConversation {
  const AdminSupportConversation({
    required this.thread,
    required this.messages,
    this.user,
  });

  final AdminSupportUser? user;
  final AdminSupportThreadSummary thread;
  final List<AdminSupportMessage> messages;

  factory AdminSupportConversation.fromJson(Map<String, dynamic> json) {
    return AdminSupportConversation(
      user: json['user'] is Map
          ? AdminSupportUser.fromJson(
              (json['user'] as Map).cast<String, dynamic>(),
            )
          : null,
      thread: AdminSupportThreadSummary.fromJson(_map(json['thread'])),
      messages: _list(
        json['messages'],
      ).map(AdminSupportMessage.fromJson).toList(),
    );
  }
}

int _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return const {};
}

List<Map<String, dynamic>> _list(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((item) => item.cast<String, dynamic>())
      .toList();
}
