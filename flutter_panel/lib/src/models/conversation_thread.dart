class ConversationThread {
  const ConversationThread({
    required this.instanceId,
    required this.chatJid,
    required this.title,
    required this.lastMessage,
    required this.lastActivity,
    required this.unreadCount,
    this.lastMessageDirection,
    this.lastMessageSenderName,
    this.phone,
    this.avatarUrl,
    this.chatType,
    this.groupDescription,
    this.participantsCount,
    this.linkedGroupId,
    this.internalBotGroupId,
    this.internalBotEnabled,
    this.internalGroupRole,
    this.inviteLink,
    this.announceOnly,
    this.instanceIsAdmin,
    this.mentionable,
    this.canSendMessages,
    this.membersCanStartPv,
    this.readOnlyReason,
    this.channelRole,
    this.supportRole,
    this.archived = false,
    this.pinned = false,
    this.muted = false,
    this.hasUnreadMention = false,
  });

  final int instanceId;
  final String chatJid;
  final String title;
  final String lastMessage;
  final DateTime lastActivity;
  final int unreadCount;
  final String? lastMessageDirection;
  final String? lastMessageSenderName;
  final String? phone;
  final String? avatarUrl;
  final String? chatType;
  final String? groupDescription;
  final int? participantsCount;
  final int? linkedGroupId;
  final int? internalBotGroupId;
  final bool? internalBotEnabled;
  final String? internalGroupRole;
  final String? inviteLink;
  final bool? announceOnly;
  final bool? instanceIsAdmin;
  final bool? mentionable;
  final bool? canSendMessages;
  final bool? membersCanStartPv;
  final String? readOnlyReason;
  final String? channelRole;
  final String? supportRole;
  final bool archived;
  final bool pinned;
  final bool muted;
  final bool hasUnreadMention;

  bool get isLikelyGroupId => _looksLikeGroupId(chatJid);
  bool get isCommunity => chatType == 'community';
  bool get isInternalGroup => chatType == 'internal_group';
  bool get isSupport => chatType == 'support' || chatJid == '__admin__';
  bool get isGroup =>
      !isChannel &&
      (isInternalGroup ||
          chatJid.endsWith('@g.us') ||
          chatType == 'group' ||
          isCommunity ||
          isLikelyGroupId);
  bool get isContact =>
      !isLikelyGroupId &&
      (chatType == 'contact' ||
          chatJid.endsWith('@s.whatsapp.net') ||
          chatJid.endsWith('@c.us'));
  bool get isChannel =>
      chatType == 'channel' || chatJid.endsWith('@newsletter');
  bool get isBroadcast =>
      chatType == 'broadcast' ||
      chatJid == 'status@broadcast' ||
      chatJid.endsWith('@broadcast');
  bool get isSafeConversationListItem => !isBroadcast;
  bool get isOutboundLastMessage => lastMessageDirection == 'outbound';
  bool get canCompose {
    if (canSendMessages != null) return canSendMessages!;
    if (isChannel) return false;
    if (isGroup && announceOnly == true) return instanceIsAdmin == true;
    return true;
  }

  String get conversationTypeLabel {
    if (isInternalGroup) return 'BOTADMIN';
    if (isSupport) return 'Suporte';
    if (isChannel) return 'Canal';
    if (isCommunity) return 'Comunidade';
    if (isGroup) return 'Grupo';
    return 'PV';
  }

  String get previewText {
    final preview = _compactPreviewText(lastMessage);
    if (preview.isEmpty) return '';
    if (isOutboundLastMessage) return _prefixPreview('Você', preview);
    if (isGroup) {
      final sender = lastMessageSenderName?.trim();
      if (sender != null && sender.isNotEmpty) {
        return _prefixPreview(sender, preview);
      }
    }
    return preview;
  }

  factory ConversationThread.fromJson(
    Map<String, dynamic> json, {
    required int fallbackInstanceId,
  }) {
    final chatJid = (json['chatJid'] ?? json['jid'] ?? json['remoteJid'] ?? '')
        .toString()
        .trim();
    final rawChatType = json['chatType']?.toString().trim().toLowerCase();
    final chatType =
        _nullableBool(
              json['isCommunity'] ??
                  json['community'] ??
                  json['isParentCommunity'] ??
                  json['isParent'],
            ) ==
            true
        ? 'community'
        : rawChatType;
    return ConversationThread(
      instanceId: _asInt(json['instanceId']) == 0
          ? fallbackInstanceId
          : _asInt(json['instanceId']),
      chatJid: chatJid,
      title: _displayTitleFromJson(json, chatJid: chatJid, chatType: chatType),
      lastMessage: _firstText([
        json['lastMessagePreview'],
        json['lastMessage'],
        json['preview'],
        json['lastText'],
      ]),
      lastActivity: _asDate(
        json['lastActivityAt'] ?? json['lastMessageAt'] ?? json['updatedAt'],
      ),
      unreadCount: _asInt(json['unreadCount']),
      lastMessageDirection: _nullableString(
        json['lastMessageDirection'],
      )?.toLowerCase(),
      lastMessageSenderName: _nullableString(json['lastMessageSenderName']),
      phone: _nullableString(json['phone'] ?? json['number']),
      avatarUrl:
          (json['avatarUrl'] ??
                  json['profilePicUrl'] ??
                  json['profilePictureUrl'] ??
                  json['pictureUrl'] ??
                  json['photoUrl'] ??
                  json['imageUrl'])
              ?.toString(),
      chatType: chatType,
      groupDescription: _nullableString(
        json['groupDescription'] ?? json['description'],
      ),
      participantsCount: _asNullableInt(
        json['participantsCount'] ??
            json['participantCount'] ??
            json['membersCount'] ??
            json['memberCount'],
      ),
      linkedGroupId: _asNullableInt(json['linkedGroupId'] ?? json['groupId']),
      internalBotGroupId: _asNullableInt(json['internalBotGroupId']),
      internalBotEnabled: _nullableBool(json['internalBotEnabled']),
      internalGroupRole: chatType == 'internal_group'
          ? _nullableString(json['internalGroupRole'] ?? json['role'])
          : null,
      inviteLink: _nullableString(
        json['inviteLink'] ?? json['groupInviteLink'],
      ),
      announceOnly: _nullableBool(json['announceOnly'] ?? json['adminsOnly']),
      instanceIsAdmin: _nullableBool(json['instanceIsAdmin']),
      mentionable: _nullableBool(json['mentionable']),
      canSendMessages: _nullableBool(json['canSendMessages']),
      membersCanStartPv: _nullableBool(json['membersCanStartPv']),
      readOnlyReason: _nullableString(json['readOnlyReason']),
      channelRole: _nullableString(json['channelRole'])?.toLowerCase(),
      supportRole: _nullableString(json['supportRole']),
      archived: _asBool(json['archived']),
      pinned: _asBool(json['pinned']),
      muted: _asBool(json['muted']),
      hasUnreadMention: _asBool(
        json['hasUnreadMention'] ?? json['has_unread_mention'],
      ),
    );
  }

  ConversationThread copyWith({
    String? title,
    String? avatarUrl,
    String? phone,
    String? lastMessage,
    DateTime? lastActivity,
    int? unreadCount,
    String? lastMessageDirection,
    String? lastMessageSenderName,
    String? groupDescription,
    int? participantsCount,
    int? linkedGroupId,
    int? internalBotGroupId,
    bool? internalBotEnabled,
    String? internalGroupRole,
    String? inviteLink,
    bool? announceOnly,
    bool? instanceIsAdmin,
    bool? mentionable,
    bool? canSendMessages,
    bool? membersCanStartPv,
    String? readOnlyReason,
    String? channelRole,
    String? supportRole,
    bool? archived,
    bool? pinned,
    bool? muted,
    bool? hasUnreadMention,
  }) {
    return ConversationThread(
      instanceId: instanceId,
      chatJid: chatJid,
      title: title ?? this.title,
      lastMessage: lastMessage ?? this.lastMessage,
      lastActivity: lastActivity ?? this.lastActivity,
      unreadCount: unreadCount ?? this.unreadCount,
      lastMessageDirection: lastMessageDirection ?? this.lastMessageDirection,
      lastMessageSenderName:
          lastMessageSenderName ?? this.lastMessageSenderName,
      phone: phone ?? this.phone,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      chatType: chatType,
      groupDescription: groupDescription ?? this.groupDescription,
      participantsCount: participantsCount ?? this.participantsCount,
      linkedGroupId: linkedGroupId ?? this.linkedGroupId,
      internalBotGroupId: internalBotGroupId ?? this.internalBotGroupId,
      internalBotEnabled: internalBotEnabled ?? this.internalBotEnabled,
      internalGroupRole: internalGroupRole ?? this.internalGroupRole,
      inviteLink: inviteLink ?? this.inviteLink,
      announceOnly: announceOnly ?? this.announceOnly,
      instanceIsAdmin: instanceIsAdmin ?? this.instanceIsAdmin,
      mentionable: mentionable ?? this.mentionable,
      canSendMessages: canSendMessages ?? this.canSendMessages,
      membersCanStartPv: membersCanStartPv ?? this.membersCanStartPv,
      readOnlyReason: readOnlyReason ?? this.readOnlyReason,
      channelRole: channelRole ?? this.channelRole,
      supportRole: supportRole ?? this.supportRole,
      archived: archived ?? this.archived,
      pinned: pinned ?? this.pinned,
      muted: muted ?? this.muted,
      hasUnreadMention: hasUnreadMention ?? this.hasUnreadMention,
    );
  }
}

String _displayTitleFromJson(
  Map<String, dynamic> json, {
  required String chatJid,
  required String? chatType,
}) {
  final candidates = <Object?>[
    json['title'],
    json['name'],
    json['contactName'],
    json['chatName'],
    json['profileName'],
    json['pushName'],
    json['shortName'],
    json['notifyName'],
    json['displayName'],
    json['verifiedName'],
    json['phone'],
    json['number'],
  ];

  for (final candidate in candidates) {
    final value = candidate?.toString().trim();
    if (value == null || value.isEmpty) continue;
    if (_isGenericConversationTitle(value)) continue;
    if ((chatJid.endsWith('@g.us') ||
            chatType == 'group' ||
            chatType == 'community' ||
            _looksLikeGroupId(chatJid)) &&
        _isGroupTechnicalTitle(value, chatJid)) {
      continue;
    }
    return value;
  }

  if (chatType == 'community') {
    return 'Comunidade';
  }

  if (chatJid.endsWith('@g.us') ||
      chatType == 'group' ||
      _looksLikeGroupId(chatJid)) {
    return 'Grupo';
  }

  if (chatType == 'channel' || chatJid.endsWith('@newsletter')) {
    return 'Canal';
  }

  final jidTitle = _titleFromWhatsappJid(chatJid);
  if (jidTitle != null) return jidTitle;

  return 'Contato sem nome';
}

bool _isGenericConversationTitle(String value) {
  final normalized = value.trim().toLowerCase();
  return normalized == 'conversa' ||
      normalized == 'grupo' ||
      normalized == 'group' ||
      normalized == 'comunidade' ||
      normalized == 'community' ||
      normalized == 'canal' ||
      normalized == 'channel' ||
      normalized == 'sem nome' ||
      normalized == 'unknown' ||
      normalized == 'desconhecido';
}

bool _isGroupTechnicalTitle(String value, String chatJid) {
  final normalized = value.trim().toLowerCase();
  final normalizedJid = chatJid.trim().toLowerCase();
  if (normalized == normalizedJid) return true;
  if (normalized.endsWith('@g.us')) return true;
  final digits = normalized.replaceAll(RegExp(r'\D+'), '');
  if (_looksLikeGroupDigits(digits)) return true;
  if (digits.length < 12) return false;
  final jidDigits = normalizedJid
      .split('@')
      .first
      .replaceAll(RegExp(r'\D+'), '');
  return digits == jidDigits || digits.startsWith('120363');
}

String? _titleFromWhatsappJid(String chatJid) {
  final trimmed = chatJid.trim();
  if (trimmed.isEmpty) return null;
  final localPart = trimmed.split('@').first.trim();
  if (localPart.isEmpty || localPart == trimmed) return null;

  final digits = localPart.replaceAll(RegExp(r'\D+'), '');
  if (_looksLikeGroupDigits(digits)) return null;
  if (digits.length >= 8) return '+$digits';

  return null;
}

bool _looksLikeGroupId(String value) {
  final digits = value.split('@').first.replaceAll(RegExp(r'\D+'), '');
  return _looksLikeGroupDigits(digits);
}

bool _looksLikeGroupDigits(String value) =>
    RegExp(r'^120363\d{6,}$').hasMatch(value);

String _firstText(List<Object?> values) {
  for (final value in values) {
    final text = value?.toString().trim();
    if (text != null && text.isNotEmpty) return text;
  }
  return '';
}

String? _nullableString(Object? value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}

final _whitespaceCollapseRe = RegExp(r'\s+');

String _compactPreviewText(String value) {
  return value.trim().replaceAll(_whitespaceCollapseRe, ' ');
}

String _prefixPreview(String prefix, String preview) {
  final cleanPrefix = prefix.trim();
  if (cleanPrefix.isEmpty) return preview;
  final normalizedPreview = preview.trim().toLowerCase();
  final normalizedPrefix = cleanPrefix.toLowerCase();
  if (normalizedPreview.startsWith('$normalizedPrefix:')) return preview;
  return '$cleanPrefix: $preview';
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
  final parsed = int.tryParse(value.toString());
  return parsed == null || parsed <= 0 ? null : parsed;
}

DateTime _asDate(Object? value) {
  if (value is num) return DateTime.fromMillisecondsSinceEpoch(value.toInt());
  return DateTime.tryParse(value?.toString() ?? '') ??
      DateTime.fromMillisecondsSinceEpoch(0);
}

bool _asBool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final normalized = value?.toString().trim().toLowerCase();
  return normalized == 'true' ||
      normalized == '1' ||
      normalized == 'yes' ||
      normalized == 'sim';
}

bool? _nullableBool(Object? value) {
  if (value == null) return null;
  if (value is bool) return value;
  if (value is num) return value != 0;
  final normalized = value.toString().trim().toLowerCase();
  if (['true', '1', 'yes', 'sim', 'on', 'ativo'].contains(normalized)) {
    return true;
  }
  if ([
    'false',
    '0',
    'no',
    'nao',
    'não',
    'off',
    'inativo',
  ].contains(normalized)) {
    return false;
  }
  return null;
}
