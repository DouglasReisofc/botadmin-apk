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

  String? get resolvedUrl {
    final direct = mediaUrl?.trim();
    if (direct != null && direct.isNotEmpty) return direct;
    final id = mediaId?.trim();
    if (id == null || id.isEmpty) return null;
    return '/api/admin/support/media/${Uri.encodeComponent(id)}';
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
  });

  final int id;
  final String direction;
  final String messageType;
  final String timestamp;
  final String senderRole;
  final String? text;
  final int? senderUserId;
  final AdminSupportMedia? media;

  bool get isOutbound => direction == 'outbound' || senderRole == 'admin';

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
