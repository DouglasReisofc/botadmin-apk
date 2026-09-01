import 'bot_instance.dart';

class BotStatusSnapshot {
  const BotStatusSnapshot({
    required this.posts,
    required this.receivedStatuses,
    required this.campaigns,
  });

  final List<StatusPost> posts;
  final List<ReceivedStatus> receivedStatuses;
  final List<StatusCampaign> campaigns;

  factory BotStatusSnapshot.fromJson(Map<String, dynamic> json) {
    return BotStatusSnapshot(
      posts: _list(json['posts']).map(StatusPost.fromJson).toList(),
      receivedStatuses: _list(
        json['receivedStatuses'],
      ).map(ReceivedStatus.fromJson).toList(),
      campaigns: _list(json['campaigns']).map(StatusCampaign.fromJson).toList(),
    );
  }
}

class BotAdCampaignSummary {
  const BotAdCampaignSummary({
    required this.id,
    required this.name,
    required this.status,
    required this.scheduleKind,
    required this.contentCount,
    required this.targetCount,
    required this.contentTypes,
    required this.targetTypes,
    required this.createdAt,
    required this.updatedAt,
    this.numericId,
    this.description,
    this.nextRunAt,
    this.lastRunAt,
    this.endAt,
    this.schedule = const <String, dynamic>{},
    this.options = const <String, dynamic>{},
    this.contents = const <Map<String, dynamic>>[],
    this.targets = const <Map<String, dynamic>>[],
  });

  final String id;
  final int? numericId;
  final String name;
  final String? description;
  final String status;
  final String scheduleKind;
  final int contentCount;
  final int targetCount;
  final List<String> contentTypes;
  final List<String> targetTypes;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? nextRunAt;
  final DateTime? lastRunAt;
  final DateTime? endAt;
  final Map<String, dynamic> schedule;
  final Map<String, dynamic> options;
  final List<Map<String, dynamic>> contents;
  final List<Map<String, dynamic>> targets;

  bool get active {
    final normalized = status.toLowerCase();
    return normalized == 'scheduled' || normalized == 'running';
  }

  bool get isStatusCampaign {
    return contentTypes.any(_isStatusType) ||
        targetTypes.any(_isStatusType) ||
        name.toLowerCase().contains('status');
  }

  factory BotAdCampaignSummary.fromJson(Map<String, dynamic> json) {
    final schedule = _map(json['schedule']);
    final contents = _list(json['contents']);
    final targets = _list(json['targets']);
    return BotAdCampaignSummary(
      id: (json['id'] ?? json['campaignId'] ?? '').toString(),
      numericId: _intOrNull(json['numericId'] ?? json['numeric_id']),
      name: (json['name'] ?? 'Campanha').toString(),
      description: _nullable(json['description']),
      status: (json['status'] ?? 'draft').toString(),
      scheduleKind: (schedule['kind'] ?? json['scheduleKind'] ?? 'manual')
          .toString(),
      contentCount: contents.length,
      targetCount: targets.length,
      contentTypes: contents
          .map(_campaignTypeLabel)
          .where((value) => value.isNotEmpty)
          .toSet()
          .toList(growable: false),
      targetTypes: targets
          .map(_campaignTypeLabel)
          .where((value) => value.isNotEmpty)
          .toSet()
          .toList(growable: false),
      createdAt: _date(json['createdAt'] ?? json['created_at']),
      updatedAt: _date(json['updatedAt'] ?? json['updated_at']),
      nextRunAt: _nullableDate([json['nextRunAt'], json['next_run_at']]),
      lastRunAt: _nullableDate([json['lastRunAt'], json['last_run_at']]),
      endAt: _nullableDate([json['endAt'], json['end_at']]),
      schedule: schedule,
      options: _map(json['options']),
      contents: contents,
      targets: targets,
    );
  }
}

class BotAdCampaignsSnapshot {
  const BotAdCampaignsSnapshot({required this.campaigns});

  final List<BotAdCampaignSummary> campaigns;

  int get activeCount => campaigns.where((campaign) => campaign.active).length;

  int get totalContents =>
      campaigns.fold(0, (total, campaign) => total + campaign.contentCount);

  int get totalTargets =>
      campaigns.fold(0, (total, campaign) => total + campaign.targetCount);
}

class PublicGroupCategory {
  const PublicGroupCategory({required this.name, required this.slug});

  final String name;
  final String slug;

  factory PublicGroupCategory.fromJson(Map<String, dynamic> json) =>
      PublicGroupCategory(
        name: (json['name'] ?? 'Categoria').toString(),
        slug: (json['slug'] ?? '').toString(),
      );
}

class PublicGroupCandidate {
  const PublicGroupCandidate({
    required this.id,
    required this.title,
    required this.inviteProtected,
    this.description,
    this.category,
    this.detailUrl,
    this.inviteLink,
    this.imageUrl,
  });

  final String id;
  final String title;
  final String? description;
  final String? category;
  final String? detailUrl;
  final String? inviteLink;
  final String? imageUrl;
  final bool inviteProtected;

  bool get hasInvite => inviteLink?.trim().isNotEmpty == true;

  factory PublicGroupCandidate.fromJson(Map<String, dynamic> json) {
    final image = _map(json['image']);
    return PublicGroupCandidate(
      id: (json['id'] ?? json['detailUrl'] ?? '').toString(),
      title: (json['title'] ?? 'Grupo do WhatsApp').toString(),
      description: _nullable(json['description']),
      category: _nullable(json['category']),
      detailUrl: _nullable(json['detailUrl']),
      inviteLink: _nullable(json['whatsappUrl'] ?? json['inviteLink']),
      imageUrl: _nullable(image['url'] ?? json['imageUrl']),
      inviteProtected: json['inviteProtected'] != false,
    );
  }
}

class PublicGroupDiscoverySnapshot {
  const PublicGroupDiscoverySnapshot({
    required this.categories,
    required this.groups,
    required this.inviteResolution,
  });

  final List<PublicGroupCategory> categories;
  final List<PublicGroupCandidate> groups;
  final String inviteResolution;

  factory PublicGroupDiscoverySnapshot.fromJson(Map<String, dynamic> json) =>
      PublicGroupDiscoverySnapshot(
        categories: _list(
          json['categories'],
        ).map(PublicGroupCategory.fromJson).toList(growable: false),
        groups: _list(
          json['groups'],
        ).map(PublicGroupCandidate.fromJson).toList(growable: false),
        inviteResolution: (json['inviteResolution'] ?? 'protected').toString(),
      );
}

class PublicGroupInviteInspection {
  const PublicGroupInviteInspection({
    required this.inviteLink,
    required this.adminsOnly,
    required this.locked,
    required this.joinApprovalRequired,
    this.groupJid,
    this.groupName,
    this.memberCount,
  });

  final String inviteLink;
  final String? groupJid;
  final String? groupName;
  final bool adminsOnly;
  final bool locked;
  final bool joinApprovalRequired;
  final int? memberCount;

  bool get canPublish =>
      groupJid?.trim().isNotEmpty == true &&
      !adminsOnly &&
      !joinApprovalRequired;

  factory PublicGroupInviteInspection.fromJson(Map<String, dynamic> json) =>
      PublicGroupInviteInspection(
        inviteLink: (json['inviteLink'] ?? '').toString(),
        groupJid: _nullable(json['groupJid']),
        groupName: _nullable(json['groupName']),
        adminsOnly: json['adminsOnly'] == true,
        locked: json['locked'] == true,
        joinApprovalRequired: json['joinApprovalRequired'] == true,
        memberCount: _intOrNull(json['memberCount']),
      );
}

class ApiRestKeySnapshot {
  const ApiRestKeySnapshot({
    required this.apiKey,
    required this.dailyQuota,
    required this.requestsUsed,
    required this.remaining,
    this.resetAt,
    this.rotationLockedUntil,
    this.updatedAt,
  });

  final String apiKey;
  final int dailyQuota;
  final int requestsUsed;
  final int remaining;
  final DateTime? resetAt;
  final DateTime? rotationLockedUntil;
  final DateTime? updatedAt;

  factory ApiRestKeySnapshot.fromJson(Map<String, dynamic> json) {
    return ApiRestKeySnapshot(
      apiKey: (json['apiKey'] ?? json['api_key'] ?? '').toString(),
      dailyQuota: _int(json['dailyQuota'] ?? json['daily_quota']),
      requestsUsed: _int(json['requestsUsed'] ?? json['requests_used']),
      remaining: _int(json['remaining']),
      resetAt: _nullableDate([json['resetAt'], json['reset_at']]),
      rotationLockedUntil: _nullableDate([
        json['rotationLockedUntil'],
        json['rotation_locked_until'],
      ]),
      updatedAt: _nullableDate([json['updatedAt'], json['updated_at']]),
    );
  }
}

class MetaWebhookSettings {
  const MetaWebhookSettings({
    required this.verifyToken,
    this.id,
    this.appId,
    this.businessAccountId,
    this.phoneNumberId,
    this.accessTokenPresent = false,
    this.accessTokenPreview,
    this.updatedAt,
    this.lastEventAt,
  });

  final String? id;
  final String verifyToken;
  final String? appId;
  final String? businessAccountId;
  final String? phoneNumberId;
  final bool accessTokenPresent;
  final String? accessTokenPreview;
  final DateTime? updatedAt;
  final DateTime? lastEventAt;

  factory MetaWebhookSettings.fromJson(Map<String, dynamic> json) {
    return MetaWebhookSettings(
      id: _nullable(json['id']),
      verifyToken: (json['verifyToken'] ?? json['verify_token'] ?? '')
          .toString(),
      appId: _nullable(json['appId'] ?? json['app_id']),
      businessAccountId: _nullable(
        json['businessAccountId'] ?? json['business_account_id'],
      ),
      phoneNumberId: _nullable(
        json['phoneNumberId'] ?? json['phone_number_id'],
      ),
      accessTokenPresent: _bool(
        json['accessTokenPresent'] ?? json['access_token_present'],
      ),
      accessTokenPreview: _nullable(
        json['accessTokenPreview'] ?? json['access_token_preview'],
      ),
      updatedAt: _nullableDate([json['updatedAt'], json['updated_at']]),
      lastEventAt: _nullableDate([json['lastEventAt'], json['last_event_at']]),
    );
  }
}

class StatusPost {
  const StatusPost({
    required this.id,
    required this.campaignName,
    required this.instanceName,
    required this.createdAt,
    required this.instanceId,
    this.messageId,
    this.errorMessage,
    this.contentText,
    this.contentType,
    this.mediaUrl,
    this.temporaryMedia = false,
  });

  final String id;
  final String campaignName;
  final String instanceName;
  final DateTime createdAt;
  final int instanceId;
  final String? messageId;
  final String? errorMessage;
  final String? contentText;
  final String? contentType;
  final String? mediaUrl;
  final bool temporaryMedia;

  bool get hasError => errorMessage != null && errorMessage!.trim().isNotEmpty;

  factory StatusPost.fromJson(Map<String, dynamic> json) {
    final content = _map(json['content']);
    final text = _safeStatusDisplayText(
      _firstText([content['text'], content['caption']]),
      mediaUrl: _nullable(content['mediaUrl']),
    );
    return StatusPost(
      id: (json['id'] ?? json['numericId'] ?? '').toString(),
      campaignName: (json['campaignName'] ?? 'Status').toString(),
      instanceName: (json['instanceName'] ?? 'Instancia').toString(),
      createdAt: _date(json['createdAt']),
      instanceId: int.tryParse((json['instanceId'] ?? '').toString()) ?? 0,
      messageId: _nullable(json['messageId']),
      errorMessage: _nullable(json['errorMessage']),
      contentText: text,
      contentType: (content['type'] ?? content['statusType'])?.toString(),
      mediaUrl: _nullable(content['mediaUrl']),
    );
  }
}

class ReceivedStatus {
  const ReceivedStatus({
    required this.id,
    required this.authorKey,
    required this.senderName,
    required this.instanceName,
    required this.createdAt,
    this.preview,
    this.avatarUrl,
    this.mediaUrl,
    this.mimeType,
    this.statusType,
    this.text,
    this.caption,
    this.backgroundColor,
    this.textColor,
    this.fontStyle,
    this.allowReshare,
  });

  final String id;
  final String authorKey;
  final String senderName;
  final String instanceName;
  final DateTime createdAt;
  final String? preview;
  final String? avatarUrl;
  final String? mediaUrl;
  final String? mimeType;
  final String? statusType;
  final String? text;
  final String? caption;
  final String? backgroundColor;
  final String? textColor;
  final String? fontStyle;
  final bool? allowReshare;

  String? get bodyText => _safeStatusDisplayText(
    _firstText([caption, text, preview]),
    mediaUrl: mediaUrl,
  );

  bool get isImage {
    final normalizedMime = (mimeType ?? '').toLowerCase();
    final normalizedType = (statusType ?? '').toLowerCase();
    final normalizedUrl = (mediaUrl ?? '').toLowerCase();
    return normalizedMime.startsWith('image/') ||
        normalizedType.contains('image') ||
        RegExp(r'\.(png|jpe?g|webp|gif)(\?|$)').hasMatch(normalizedUrl);
  }

  bool get isVideo {
    final normalizedMime = (mimeType ?? '').toLowerCase();
    final normalizedType = (statusType ?? '').toLowerCase();
    final normalizedUrl = (mediaUrl ?? '').toLowerCase();
    return normalizedMime.startsWith('video/') ||
        normalizedType.contains('video') ||
        RegExp(r'\.(mp4|mov|webm|mkv)(\?|$)').hasMatch(normalizedUrl);
  }

  factory ReceivedStatus.fromJson(Map<String, dynamic> json) {
    final authorKey = _firstText([
      json['authorJid'],
      json['senderJid'],
      json['from'],
      json['authorName'],
      json['senderName'],
      json['id'],
    ]);
    final text = _nullable(json['text']);
    final caption = _nullable(json['caption']);
    final mediaUrl = _nullable(json['mediaUrl'] ?? _map(json['media'])['url']);
    return ReceivedStatus(
      id: (json['id'] ?? json['messageId'] ?? '').toString(),
      authorKey: authorKey ?? '',
      senderName:
          (json['senderName'] ??
                  json['authorName'] ??
                  json['pushName'] ??
                  json['name'] ??
                  json['senderJid'] ??
                  json['authorJid'] ??
                  'Contato')
              .toString(),
      instanceName: (json['instanceName'] ?? json['instance'] ?? 'Instancia')
          .toString(),
      createdAt: _date(
        json['createdAt'] ?? json['timestamp'] ?? json['messageTimestamp'],
      ),
      preview: _safeStatusDisplayText(
        _firstText([text, caption, json['preview']]),
        mediaUrl: mediaUrl,
      ),
      avatarUrl: _nullable(json['avatarUrl'] ?? json['authorAvatarUrl']),
      mediaUrl: mediaUrl,
      mimeType: _nullable(json['mimeType'] ?? json['mime_type']),
      statusType: _nullable(json['type'] ?? json['statusType']),
      text: text,
      caption: caption,
      backgroundColor: _nullable(
        json['backgroundColor'] ?? json['backgroundArgb'],
      ),
      textColor: _nullable(json['textColor'] ?? json['textArgb']),
      fontStyle: _nullable(json['fontStyle'] ?? json['font']),
      allowReshare: _optionalBool(
        json['allowReshare'] ?? json['allow_reshare'],
      ),
    );
  }
}

class StatusCampaign {
  const StatusCampaign({
    required this.id,
    required this.name,
    required this.status,
    required this.scheduleKind,
    required this.contentCount,
  });

  final String id;
  final String name;
  final String status;
  final String scheduleKind;
  final int contentCount;

  factory StatusCampaign.fromJson(Map<String, dynamic> json) {
    return StatusCampaign(
      id: (json['id'] ?? json['numericId'] ?? '').toString(),
      name: (json['name'] ?? 'Campanha').toString(),
      status: (json['status'] ?? '').toString(),
      scheduleKind: (json['scheduleKind'] ?? '').toString(),
      contentCount: _int(json['contentCount']),
    );
  }
}

class BotFlowSummary {
  const BotFlowSummary({
    required this.id,
    required this.name,
    required this.command,
    required this.triggerType,
    required this.matchMode,
    required this.scope,
    required this.enabled,
    required this.description,
    required this.nodeCount,
    required this.updatedAt,
    required this.revision,
    required this.nodes,
    required this.edges,
  });

  final int id;
  final String name;
  final String command;
  final String triggerType;
  final String matchMode;
  final String scope;
  final bool enabled;
  final String? description;
  final int nodeCount;
  final DateTime updatedAt;
  final int revision;
  final List<Map<String, dynamic>> nodes;
  final List<Map<String, dynamic>> edges;

  factory BotFlowSummary.fromJson(Map<String, dynamic> json) {
    final nodes = _list(json['nodes']);
    return BotFlowSummary(
      id: _int(json['id']),
      name: (json['name'] ?? 'Fluxo').toString(),
      command: (json['command'] ?? '').toString(),
      triggerType: (json['triggerType'] ?? json['trigger_type'] ?? '')
          .toString(),
      matchMode: (json['matchMode'] ?? json['match_mode'] ?? '').toString(),
      scope: (json['scope'] ?? '').toString(),
      enabled: _bool(json['enabled']),
      description: _nullable(json['description']),
      nodeCount: nodes.length,
      updatedAt: _date(json['updatedAt'] ?? json['updated_at']),
      revision: _int(json['revision'] ?? json['editRevision']),
      nodes: nodes,
      edges: _list(json['edges']),
    );
  }

  BotFlowSummary copyForEnabled(bool nextEnabled) {
    return copyWith(enabled: nextEnabled);
  }

  BotFlowSummary copyWith({
    int? id,
    String? name,
    String? command,
    String? triggerType,
    String? matchMode,
    String? scope,
    bool? enabled,
    String? description,
    int? nodeCount,
    DateTime? updatedAt,
    int? revision,
    List<Map<String, dynamic>>? nodes,
    List<Map<String, dynamic>>? edges,
  }) {
    final nextNodes = nodes ?? this.nodes;
    return BotFlowSummary(
      id: id ?? this.id,
      name: name ?? this.name,
      command: command ?? this.command,
      triggerType: triggerType ?? this.triggerType,
      matchMode: matchMode ?? this.matchMode,
      scope: scope ?? this.scope,
      enabled: enabled ?? this.enabled,
      description: description ?? this.description,
      nodeCount: nodeCount ?? nextNodes.length,
      updatedAt: updatedAt ?? this.updatedAt,
      revision: revision ?? this.revision,
      nodes: nextNodes,
      edges: edges ?? this.edges,
    );
  }

  Map<String, Object?> toUpdatePayload({bool? enabled}) {
    return {
      'revision': revision,
      'name': name,
      'command': command,
      'triggerType': triggerType.isEmpty ? 'command' : triggerType,
      'matchMode': matchMode.isEmpty ? 'exact' : matchMode,
      'scope': scope.isEmpty ? 'group' : scope,
      'enabled': enabled ?? this.enabled,
      'description': description,
      'nodes': nodes,
      'edges': edges,
    };
  }

  String get triggerLabel {
    final type = triggerType.trim().isEmpty ? 'command' : triggerType.trim();
    final value = command.trim().isNotEmpty
        ? command.trim()
        : (nodes.isNotEmpty
              ? (nodes.first['triggerValue']?.toString() ?? '')
              : '');
    if (value.isEmpty) return type;
    return '$type · $value';
  }
}

class WhatsappCallRecord {
  const WhatsappCallRecord({
    required this.id,
    required this.chatJid,
    required this.direction,
    required this.status,
    required this.isVideo,
    required this.raw,
    this.callCreatorJid,
    this.displayName,
    this.phone,
    this.avatarUrl,
    this.timestamp,
  });

  final String id;
  final String chatJid;
  final String direction;
  final String status;
  final bool isVideo;
  final String? callCreatorJid;
  final String? displayName;
  final String? phone;
  final String? avatarUrl;
  final DateTime? timestamp;
  final Map<String, dynamic> raw;

  String get key {
    final creator = callCreatorJid?.trim() ?? '';
    return '$id|$chatJid|$creator';
  }

  bool get isIncoming {
    final source =
        '$direction $status ${raw['action'] ?? ''} ${raw['type'] ?? ''}'
            .toLowerCase();
    return source.contains('incoming') ||
        source.contains('received') ||
        source.contains('ringing') ||
        source.contains('offer') ||
        source.contains('notice');
  }

  bool get isConnected {
    final source =
        '$direction $status ${raw['action'] ?? ''} ${raw['type'] ?? ''}'
            .toLowerCase();
    return source.contains('accept') ||
        source.contains('active') ||
        source.contains('connect') ||
        source.contains('ongoing');
  }

  bool get isTerminal {
    final source =
        '$direction $status ${raw['action'] ?? ''} ${raw['type'] ?? ''}'
            .toLowerCase();
    return source.contains('end') ||
        source.contains('reject') ||
        source.contains('close') ||
        source.contains('terminate') ||
        source.contains('miss') ||
        source.contains('timeout') ||
        source.contains('cancel') ||
        source.contains('complete') ||
        source.contains('finish') ||
        source.contains('disconnect') ||
        source.contains('declin') ||
        source.contains('fail') ||
        source.contains('busy') ||
        source.contains('unavailable') ||
        source.contains('hangup');
  }

  /// Tocando / oferta recebida (ainda não atendida).
  bool get isRinging => isIncoming && !isConnected && !isTerminal;

  /// Saída ainda não atendida/conectada.
  bool get isOutgoingPending => !isIncoming && !isConnected && !isTerminal;

  /// Qualquer chamada que ainda não terminou.
  bool get isLive => !isTerminal;

  String get statusLabel {
    if (isTerminal) {
      final source =
          '$direction $status ${raw['action'] ?? ''} ${raw['type'] ?? ''}'
              .toLowerCase();
      if (source.contains('miss') || source.contains('timeout')) {
        return 'Perdida';
      }
      if (source.contains('reject') || source.contains('declin')) {
        return 'Recusada';
      }
      if (source.contains('cancel')) return 'Cancelada';
      if (source.contains('fail') || source.contains('unavailable')) {
        return 'Não concluída';
      }
      return 'Finalizada';
    }
    if (isConnected) return 'Em andamento';
    if (isRinging) return 'Recebendo…';
    if (isOutgoingPending) return 'Chamando…';
    if (status.trim().isNotEmpty) return status.trim();
    return 'Chamada';
  }

  factory WhatsappCallRecord.fromJson(Map<String, dynamic> json) {
    return WhatsappCallRecord(
      id:
          _firstText([
            json['callId'],
            json['CallID'],
            json['id'],
            json['ID'],
          ]) ??
          '',
      chatJid:
          _firstText([
            json['chatJid'],
            json['chat_jid'],
            json['remoteJid'],
            json['remote_jid'],
            json['callerJid'],
            json['caller_jid'],
            json['caller'],
            json['Caller'],
            json['from'],
            json['From'],
            json['to'],
            json['To'],
            json['creator'],
            json['Creator'],
            json['callCreator'],
            json['CallCreator'],
            json['participant'],
            json['Participant'],
          ]) ??
          '',
      direction:
          _firstText([json['direction'], json['Direction'], json['kind']]) ??
          '',
      status: _firstText([json['status'], json['Status'], json['state']]) ?? '',
      isVideo: _bool(json['video'] ?? json['Video'] ?? json['isVideo']),
      callCreatorJid: _firstText([
        json['callCreator'],
        json['CallCreator'],
        json['creator'],
        json['Creator'],
        json['participant'],
        json['Participant'],
      ]),
      displayName: _firstUsefulCallName([
        json['displayName'],
        json['display_name'],
        json['pushName'],
        json['push_name'],
        json['callerName'],
        json['caller_name'],
        json['name'],
        json['Name'],
        _map(json['caller'])['name'],
        _map(json['contact'])['name'],
      ]),
      phone: _firstText([
        json['phone'],
        json['Phone'],
        json['callerPhone'],
        json['caller_phone'],
        _map(json['caller'])['phone'],
        _map(json['contact'])['phone'],
      ]),
      avatarUrl: _firstText([
        json['avatarUrl'],
        json['avatar_url'],
        _map(json['resolvedConversation'])['avatarUrl'],
        _map(json['resolvedConversation'])['avatar_url'],
        _map(json['caller'])['avatarUrl'],
        _map(json['contact'])['avatarUrl'],
      ]),
      timestamp: _nullableDate([
        json['timestamp'],
        json['Timestamp'],
        json['createdAt'],
        json['created_at'],
        json['startedAt'],
        json['started_at'],
      ]),
      raw: json,
    );
  }
}

String? _firstUsefulCallName(List<Object?> values) {
  for (final value in values) {
    final text = value?.toString().trim() ?? '';
    if (text.isEmpty) continue;
    if (_looksLikeTechnicalCallId(text)) continue;
    if (text.contains('@') && RegExp(r'^\d+@').hasMatch(text)) continue;
    return text;
  }
  return null;
}

bool _looksLikeTechnicalCallId(String value) {
  final text = value.trim();
  if (text.length < 16) return false;
  if (RegExp(r'^[A-Fa-f0-9:_-]+$').hasMatch(text)) return true;
  final letters = RegExp(r'[A-Za-z]').allMatches(text).length;
  final digits = RegExp(r'\d').allMatches(text).length;
  return text.length >= 22 && digits > 0 && letters > 8;
}

class InstanceCallsSnapshot {
  const InstanceCallsSnapshot({required this.instance, required this.calls});

  final BotInstance instance;
  final List<WhatsappCallRecord> calls;
}

class InstanceSettingsBundle {
  const InstanceSettingsBundle({required this.settings, required this.storage});

  final InstanceSettings settings;
  final StorageSummary storage;

  factory InstanceSettingsBundle.fromJson(Map<String, dynamic> json) {
    return InstanceSettingsBundle(
      settings: InstanceSettings.fromJson(_map(json['settings'])),
      storage: StorageSummary.fromJson(_map(json['storage'])),
    );
  }
}

class InstanceSettings {
  const InstanceSettings({
    required this.commandToggles,
    required this.autoResponsesCount,
  });

  final Map<String, dynamic> commandToggles;
  final int autoResponsesCount;

  bool enabled(String key) => _bool(commandToggles[key]);

  factory InstanceSettings.fromJson(Map<String, dynamic> json) {
    return InstanceSettings(
      commandToggles: _map(json['commandToggles'] ?? json['command_toggles']),
      autoResponsesCount: _list(
        json['autoResponses'] ?? json['auto_responses'],
      ).length,
    );
  }
}

class StorageSummary {
  const StorageSummary({
    required this.hasActivePlan,
    required this.quotaBytes,
    required this.usedBytes,
    required this.remainingBytes,
  });

  final bool hasActivePlan;
  final int quotaBytes;
  final int usedBytes;
  final int remainingBytes;

  double get usageRatio {
    if (quotaBytes <= 0) return 0;
    return (usedBytes / quotaBytes).clamp(0, 1);
  }

  factory StorageSummary.fromJson(Map<String, dynamic> json) {
    return StorageSummary(
      hasActivePlan: _bool(json['hasActivePlan'] ?? json['active']),
      quotaBytes: _int(json['quotaBytes'] ?? json['quota_bytes']),
      usedBytes: _int(json['usedBytes'] ?? json['used_bytes']),
      remainingBytes: _int(json['remainingBytes'] ?? json['remaining_bytes']),
    );
  }
}

class MediaStorageSnapshot {
  const MediaStorageSnapshot({
    required this.storage,
    required this.plans,
    required this.adminExempt,
  });

  final StorageSummary storage;
  final List<MediaStoragePlan> plans;
  final bool adminExempt;

  factory MediaStorageSnapshot.fromJson(Map<String, dynamic> json) {
    return MediaStorageSnapshot(
      storage: StorageSummary.fromJson(_map(json['storage'])),
      plans: _list(json['plans']).map(MediaStoragePlan.fromJson).toList(),
      adminExempt: _bool(json['adminExempt']),
    );
  }
}

class MediaStoragePlan {
  const MediaStoragePlan({
    required this.id,
    required this.name,
    required this.price,
    required this.quotaGb,
  });

  final int id;
  final String name;
  final double price;
  final double quotaGb;

  factory MediaStoragePlan.fromJson(Map<String, dynamic> json) {
    return MediaStoragePlan(
      id: _int(json['id']),
      name: (json['name'] ?? json['title'] ?? 'Storage').toString(),
      price: _double(json['price'] ?? json['amount']),
      quotaGb: _double(
        json['quotaGb'] ?? json['quota_gb'] ?? json['storageQuotaGb'],
      ),
    );
  }
}

class PlanSnapshot {
  const PlanSnapshot({
    required this.planName,
    required this.status,
    required this.profileUnlimited,
    required this.balance,
    required this.instanceLimit,
    required this.plans,
    required this.paymentMethods,
    required this.profileSlotTotal,
    required this.profileSlotUsed,
    required this.profileSlotAvailable,
    required this.manualProfileSlotTotal,
    required this.manualProfileSlotAvailable,
    this.currentPlanId,
    this.daysRemaining,
    this.currentPeriodEnd,
    this.profileSlotExpiresAt,
    this.nextProfileSlotExpiresAt,
    this.manualProfileSlotExpiresAt,
  });

  final String planName;
  final String status;
  final bool profileUnlimited;
  final double balance;
  final int instanceLimit;
  final List<SubscriptionPlanSummary> plans;
  final List<PaymentMethodSummary> paymentMethods;
  final int profileSlotTotal;
  final int profileSlotUsed;
  final int profileSlotAvailable;
  final int manualProfileSlotTotal;
  final int manualProfileSlotAvailable;
  final int? currentPlanId;
  final int? daysRemaining;
  final DateTime? currentPeriodEnd;
  final DateTime? profileSlotExpiresAt;
  final DateTime? nextProfileSlotExpiresAt;
  final DateTime? manualProfileSlotExpiresAt;

  factory PlanSnapshot.fromJson(Map<String, dynamic> json) {
    final statusJson = _map(json['status']);
    final planJson = _map(statusJson['plan']);
    final limits = _map(json['limits']);
    final profileSlots = _map(json['profileSlots'] ?? json['profile_slots']);
    final currentPlanId = _int(statusJson['planId'] ?? statusJson['plan_id']);
    return PlanSnapshot(
      planName: (planJson['name'] ?? 'Sem plano ativo').toString(),
      status: (statusJson['status'] ?? '').toString(),
      profileUnlimited: _bool(statusJson['profileUnlimited']),
      balance: _double(json['balance']),
      instanceLimit: _int(limits['instanceLimit'] ?? limits['instance_limit']),
      plans: _list(
        json['plans'],
      ).map(SubscriptionPlanSummary.fromJson).toList(),
      paymentMethods: _list(
        json['paymentMethods'],
      ).map(PaymentMethodSummary.fromJson).toList(),
      profileSlotTotal: _int(profileSlots['total']),
      profileSlotUsed: _int(profileSlots['used']),
      profileSlotAvailable: _int(profileSlots['available']),
      manualProfileSlotTotal: _int(
        profileSlots['manualTotal'] ?? profileSlots['manual_total'],
      ),
      manualProfileSlotAvailable: _int(
        profileSlots['manualAvailable'] ?? profileSlots['manual_available'],
      ),
      currentPlanId: currentPlanId <= 0 ? null : currentPlanId,
      daysRemaining: _intOrNull(
        statusJson['daysRemaining'] ?? statusJson['days_remaining'],
      ),
      currentPeriodEnd: _nullableDate([
        statusJson['currentPeriodEnd'],
        statusJson['current_period_end'],
      ]),
      profileSlotExpiresAt: _nullableDate([
        profileSlots['expiresAt'],
        profileSlots['expires_at'],
      ]),
      nextProfileSlotExpiresAt: _nullableDate([
        profileSlots['nextAvailableExpiresAt'],
        profileSlots['next_available_expires_at'],
      ]),
      manualProfileSlotExpiresAt: _nullableDate([
        profileSlots['manualExpiresAt'],
        profileSlots['manual_expires_at'],
      ]),
    );
  }
}

class SubscriptionPlanSummary {
  const SubscriptionPlanSummary({
    required this.id,
    required this.name,
    required this.price,
    required this.instanceLimit,
    required this.groupLimit,
    required this.durationDays,
    required this.allowFlows,
    required this.storageQuotaGb,
    required this.active,
    this.description,
    this.creditCost,
    this.commissionAmount,
  });

  final int id;
  final String name;
  final String? description;
  final double price;
  final int instanceLimit;
  final int groupLimit;
  final int durationDays;
  final bool allowFlows;
  final double storageQuotaGb;
  final bool active;
  final int? creditCost;
  final double? commissionAmount;

  bool get profileUnlimited => groupLimit <= 0;

  factory SubscriptionPlanSummary.fromJson(Map<String, dynamic> json) {
    return SubscriptionPlanSummary(
      id: _int(json['id']),
      name: (json['name'] ?? 'Plano').toString(),
      description: _nullable(json['description']),
      price: _double(json['price']),
      instanceLimit: _int(json['instanceLimit'] ?? json['instance_limit']),
      groupLimit: _int(json['groupLimit'] ?? json['group_limit']),
      durationDays: _int(json['durationDays'] ?? json['duration_days']),
      allowFlows: _bool(json['allowFlows'] ?? json['allow_flows']),
      storageQuotaGb: _double(
        json['storageQuotaGb'] ?? json['storage_quota_gb'],
      ),
      active: _bool(json['isActive'] ?? json['is_active'] ?? true),
      creditCost: json['creditCost'] == null && json['credit_cost'] == null
          ? null
          : _int(json['creditCost'] ?? json['credit_cost']),
      commissionAmount: json['commissionAmount'] == null && json['commission_amount'] == null
          ? null
          : _double(json['commissionAmount'] ?? json['commission_amount']),
    );
  }
}

class PaymentMethodSummary {
  const PaymentMethodSummary({
    required this.provider,
    required this.configured,
    required this.active,
  });

  final String provider;
  final bool configured;
  final bool active;

  bool get available => configured && active;

  factory PaymentMethodSummary.fromJson(Map<String, dynamic> json) {
    return PaymentMethodSummary(
      provider: (json['provider'] ?? '').toString(),
      configured: _bool(json['isConfigured'] ?? json['configured']),
      active: _bool(json['isActive'] ?? json['active']),
    );
  }
}

class PlanCheckout {
  const PlanCheckout({
    required this.paymentId,
    required this.providerPaymentId,
    required this.provider,
    required this.amount,
    this.ticketUrl,
    this.qrCode,
    this.qrCodeBase64,
    this.expiresAt,
  });

  final String paymentId;
  final String providerPaymentId;
  final String provider;
  final double amount;
  final String? ticketUrl;
  final String? qrCode;
  final String? qrCodeBase64;
  final DateTime? expiresAt;

  factory PlanCheckout.fromJson(Map<String, dynamic> json) {
    return PlanCheckout(
      paymentId: (json['paymentId'] ?? '').toString(),
      providerPaymentId: (json['providerPaymentId'] ?? '').toString(),
      provider: (json['provider'] ?? '').toString(),
      amount: _double(json['amount']),
      ticketUrl: _nullable(json['ticketUrl']),
      qrCode: _nullable(json['qrCode']),
      qrCodeBase64: _nullable(json['qrCodeBase64']),
      expiresAt: _nullableDate([json['expiresAt'], json['expires_at']]),
    );
  }
}

class MobileUpdateSnapshot {
  const MobileUpdateSnapshot({
    required this.versionName,
    required this.versionCode,
    required this.required,
    required this.updateAvailable,
    this.downloadUrl,
  });

  final String versionName;
  final int versionCode;
  final bool required;
  final bool updateAvailable;
  final String? downloadUrl;

  factory MobileUpdateSnapshot.fromJson(Map<String, dynamic> json) {
    final android = _map(json['android']);
    final latest = _map(android['latest']);
    return MobileUpdateSnapshot(
      versionName: (latest['versionName'] ?? '').toString(),
      versionCode: _int(latest['versionCode']),
      required: _bool(android['required']),
      updateAvailable: _bool(android['updateAvailable']),
      downloadUrl: _nullable(latest['downloadUrl'] ?? latest['url']),
    );
  }
}

class UserRaffleGroupTarget {
  const UserRaffleGroupTarget({
    required this.groupId,
    required this.remoteId,
    this.name,
    this.instanceId,
  });

  final int groupId;
  final String remoteId;
  final String? name;
  final int? instanceId;

  factory UserRaffleGroupTarget.fromJson(Map<String, dynamic> json) {
    final instanceId = _int(json['instanceId'] ?? json['instance_id']);
    return UserRaffleGroupTarget(
      groupId: _int(json['groupId'] ?? json['group_id']),
      remoteId: (json['remoteId'] ?? json['remote_id'] ?? '').toString(),
      name: _nullable(json['name']),
      instanceId: instanceId <= 0 ? null : instanceId,
    );
  }
}

class UserRaffleAnnouncementMedia {
  const UserRaffleAnnouncementMedia({
    required this.path,
    required this.url,
    required this.mediaType,
    this.mimeType,
    this.fileName,
  });

  final String path;
  final String url;
  final String mediaType;
  final String? mimeType;
  final String? fileName;

  factory UserRaffleAnnouncementMedia.fromJson(Map<String, dynamic> json) =>
      UserRaffleAnnouncementMedia(
        path: (json['path'] ?? '').toString(),
        url: (json['url'] ?? '').toString(),
        mediaType: (json['mediaType'] ?? 'image').toString(),
        mimeType: _nullable(json['mimeType']),
        fileName: _nullable(json['fileName']),
      );

  Map<String, Object?> toJson() => {
    'path': path,
    'url': url,
    'mediaType': mediaType,
    'mimeType': mimeType,
    'fileName': fileName,
  };
}

class UserRaffleAnnouncementButton {
  const UserRaffleAnnouncementButton({
    required this.id,
    required this.text,
    required this.type,
    required this.value,
  });

  final String id;
  final String text;
  final String type;
  final String value;

  factory UserRaffleAnnouncementButton.fromJson(Map<String, dynamic> json) =>
      UserRaffleAnnouncementButton(
        id: (json['id'] ?? '').toString(),
        text: (json['text'] ?? 'Comprar rifa').toString(),
        type: (json['type'] ?? 'quick_reply').toString(),
        value: (json['value'] ?? json['command'] ?? json['url'] ?? '')
            .toString(),
      );

  Map<String, Object?> toJson() => {
    'id': id,
    'text': text,
    'type': type,
    'value': value,
  };
}

class UserRaffleAnnouncementSettings {
  const UserRaffleAnnouncementSettings({
    required this.message,
    required this.mentionAll,
    required this.buttons,
    this.media,
  });

  final String message;
  final bool mentionAll;
  final UserRaffleAnnouncementMedia? media;
  final List<UserRaffleAnnouncementButton> buttons;

  factory UserRaffleAnnouncementSettings.fromJson(Map<String, dynamic> json) {
    final media = json['media'];
    return UserRaffleAnnouncementSettings(
      message: (json['message'] ?? '').toString(),
      mentionAll: _bool(json['mentionAll']),
      media: media is Map
          ? UserRaffleAnnouncementMedia.fromJson(
              Map<String, dynamic>.from(media),
            )
          : null,
      buttons: _list(
        json['buttons'],
      ).map(UserRaffleAnnouncementButton.fromJson).toList(),
    );
  }
}

class UserRaffleFinalizationSettings {
  const UserRaffleFinalizationSettings({required this.message});

  final String message;

  factory UserRaffleFinalizationSettings.fromJson(Map<String, dynamic> json) =>
      UserRaffleFinalizationSettings(
        message: (json['message'] ?? '').toString(),
      );
}

class UserRafflePurchaseMenuSettings {
  const UserRafflePurchaseMenuSettings({
    required this.title,
    required this.description,
    required this.buttonText,
    required this.footerText,
    required this.cardTitleTemplate,
    required this.rowTitleTemplate,
    required this.rowDescriptionTemplate,
  });

  final String title;
  final String description;
  final String buttonText;
  final String footerText;
  final String cardTitleTemplate;
  final String rowTitleTemplate;
  final String rowDescriptionTemplate;

  factory UserRafflePurchaseMenuSettings.fromJson(
    Map<String, dynamic> json,
  ) => UserRafflePurchaseMenuSettings(
    title: (json['title'] ?? 'Comprar números').toString(),
    description:
        (json['description'] ??
                'Escolha quantos números deseja reservar. O valor total aparece em cada opção.')
            .toString(),
    buttonText: (json['buttonText'] ?? 'Escolher quantidade').toString(),
    footerText: (json['footerText'] ?? '{{title}} · {{price}} por número')
        .toString(),
    cardTitleTemplate:
        (json['cardTitleTemplate'] ?? '{{from}} a {{to}} números').toString(),
    rowTitleTemplate:
        (json['rowTitleTemplate'] ?? '{{quantity}} número(s) · {{total}}')
            .toString(),
    rowDescriptionTemplate:
        (json['rowDescriptionTemplate'] ?? '{{quantity}} × {{price}}')
            .toString(),
  );

  Map<String, Object?> toJson() => {
    'title': title,
    'description': description,
    'buttonText': buttonText,
    'footerText': footerText,
    'cardTitleTemplate': cardTitleTemplate,
    'rowTitleTemplate': rowTitleTemplate,
    'rowDescriptionTemplate': rowDescriptionTemplate,
  };
}

class RafflePaymentSettings {
  const RafflePaymentSettings({
    required this.configured,
    required this.activeProvider,
    required this.mercadoPagoConfigured,
    required this.poloPagConfigured,
    required this.mercadoPagoExpirationMinutes,
    required this.poloPagExpirationMinutes,
    required this.mercadoPagoCredentialsUrl,
    this.mercadoPagoCredentialMask,
    this.poloPagCredentialMask,
  });

  final bool configured;
  final String? activeProvider;
  final bool mercadoPagoConfigured;
  final bool poloPagConfigured;
  final String? mercadoPagoCredentialMask;
  final String? poloPagCredentialMask;
  final int mercadoPagoExpirationMinutes;
  final int poloPagExpirationMinutes;
  final String mercadoPagoCredentialsUrl;

  factory RafflePaymentSettings.fromJson(Map<String, dynamic> json) {
    final mercadoPago = json['mercadoPago'] is Map
        ? Map<String, dynamic>.from(json['mercadoPago'] as Map)
        : const <String, dynamic>{};
    final poloPag = json['poloPag'] is Map
        ? Map<String, dynamic>.from(json['poloPag'] as Map)
        : const <String, dynamic>{};
    final links = json['links'] is Map
        ? Map<String, dynamic>.from(json['links'] as Map)
        : const <String, dynamic>{};
    return RafflePaymentSettings(
      configured: _bool(json['configured']),
      activeProvider: _nullable(json['activeProvider']),
      mercadoPagoConfigured: _bool(mercadoPago['isConfigured']),
      poloPagConfigured: _bool(poloPag['isConfigured']),
      mercadoPagoCredentialMask: _nullable(mercadoPago['credentialMask']),
      poloPagCredentialMask: _nullable(poloPag['credentialMask']),
      mercadoPagoExpirationMinutes: _int(
        mercadoPago['pixExpirationMinutes'] ?? 30,
      ),
      poloPagExpirationMinutes: _int(poloPag['pixExpirationMinutes'] ?? 30),
      mercadoPagoCredentialsUrl:
          (links['mercadoPagoCredentials'] ??
                  'https://www.mercadopago.com.br/developers/panel/app')
              .toString(),
    );
  }
}

class UserRaffleSummary {
  const UserRaffleSummary({
    required this.id,
    required this.title,
    required this.price,
    required this.numbersTotal,
    required this.winnersCount,
    required this.status,
    required this.reservedCount,
    required this.soldCount,
    required this.availableCount,
    required this.groups,
    required this.announcement,
    required this.finalization,
    required this.purchaseMenu,
    required this.winnersCountDrawn,
    required this.createdAt,
    required this.updatedAt,
    this.description,
    this.drawnAt,
  });

  final int id;
  final String title;
  final String? description;
  final double price;
  final int numbersTotal;
  final int winnersCount;
  final String status;
  final int reservedCount;
  final int soldCount;
  final int availableCount;
  final List<UserRaffleGroupTarget> groups;
  final UserRaffleAnnouncementSettings announcement;
  final UserRaffleFinalizationSettings finalization;
  final UserRafflePurchaseMenuSettings purchaseMenu;
  final int winnersCountDrawn;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? drawnAt;

  int get occupiedCount => reservedCount + soldCount;

  double get soldRatio {
    if (numbersTotal <= 0) return 0;
    return (occupiedCount / numbersTotal).clamp(0, 1);
  }

  double get revenue => soldCount * price;

  bool get active {
    final normalized = status.toLowerCase();
    return normalized == 'active' ||
        normalized == 'selling' ||
        normalized == 'sold_out';
  }

  String get groupLabel {
    final names = groups
        .map((group) => group.name ?? group.remoteId)
        .where((value) => value.trim().isNotEmpty)
        .take(3)
        .toList();
    if (names.isEmpty) return 'Sem grupos vinculados';
    final suffix = groups.length > names.length
        ? ' +${groups.length - names.length}'
        : '';
    return '${names.join(', ')}$suffix';
  }

  factory UserRaffleSummary.fromJson(Map<String, dynamic> json) {
    final drawnAt = DateTime.tryParse(json['drawnAt']?.toString() ?? '');
    return UserRaffleSummary(
      id: _int(json['id']),
      title: (json['title'] ?? 'Rifa').toString(),
      description: _nullable(json['description']),
      price: _double(json['price']),
      numbersTotal: _int(json['numbersTotal'] ?? json['numbers_total']),
      winnersCount: _int(json['winnersCount'] ?? json['winners_count']),
      status: (json['status'] ?? '').toString(),
      reservedCount: _int(json['reservedCount'] ?? json['reserved_count']),
      soldCount: _int(json['soldCount'] ?? json['sold_count']),
      availableCount: _int(json['availableCount'] ?? json['available_count']),
      groups: _list(
        json['groups'],
      ).map(UserRaffleGroupTarget.fromJson).toList(),
      announcement: UserRaffleAnnouncementSettings.fromJson(
        json['announcement'] is Map
            ? Map<String, dynamic>.from(json['announcement'] as Map)
            : const <String, dynamic>{},
      ),
      finalization: UserRaffleFinalizationSettings.fromJson(
        json['finalization'] is Map
            ? Map<String, dynamic>.from(json['finalization'] as Map)
            : const <String, dynamic>{},
      ),
      purchaseMenu: UserRafflePurchaseMenuSettings.fromJson(
        json['purchaseMenu'] is Map
            ? Map<String, dynamic>.from(json['purchaseMenu'] as Map)
            : const <String, dynamic>{},
      ),
      winnersCountDrawn: _list(json['winners']).length,
      createdAt: _date(json['createdAt'] ?? json['created_at']),
      updatedAt: _date(json['updatedAt'] ?? json['updated_at']),
      drawnAt: drawnAt,
    );
  }
}

class AffiliateProviderSummary {
  const AffiliateProviderSummary({
    required this.provider,
    required this.label,
    required this.description,
    required this.enabled,
    required this.implemented,
    required this.connected,
    required this.status,
    required this.accountCount,
    this.accountName,
    this.lastError,
    this.updatedAt,
    this.logoUrl,
  });

  final String provider;
  final String label;
  final String description;
  final bool enabled;
  final bool implemented;
  final bool connected;
  final String status;
  final int accountCount;
  final String? accountName;
  final String? lastError;
  final DateTime? updatedAt;
  final String? logoUrl;

  bool get active => implemented && enabled && connected;

  factory AffiliateProviderSummary.fromJson(Map<String, dynamic> json) {
    final updatedAt = DateTime.tryParse(json['updatedAt']?.toString() ?? '');
    return AffiliateProviderSummary(
      provider: (json['provider'] ?? '').toString(),
      label: (json['label'] ?? json['provider'] ?? 'Afiliado').toString(),
      description: (json['description'] ?? '').toString(),
      enabled: _bool(json['enabled']),
      implemented: _bool(json['implemented']),
      connected: _bool(json['connected']),
      status: (json['status'] ?? '').toString(),
      accountCount: _list(json['accounts']).length,
      accountName: _nullable(json['accountName'] ?? json['account_name']),
      lastError: _nullable(json['lastError'] ?? json['last_error']),
      updatedAt: updatedAt,
      logoUrl: _nullable(json['logoUrl'] ?? json['logo_url']),
    );
  }
}

class AffiliateProductLink {
  const AffiliateProductLink({
    required this.provider,
    required this.id,
    required this.itemId,
    required this.affiliateUrl,
    required this.isActive,
    required this.clickCount,
    required this.updatedAt,
    this.title,
    this.productUrl,
    this.imageUrl,
    this.priceAmount,
    this.priceFormatted,
    this.categoryId,
    this.note,
    this.available,
  });

  final String provider;
  final int id;
  final String itemId;
  final String affiliateUrl;
  final String? title;
  final String? productUrl;
  final String? imageUrl;
  final double? priceAmount;
  final String? priceFormatted;
  final String? categoryId;
  final String? note;
  final bool? available;
  final bool isActive;
  final int clickCount;
  final DateTime updatedAt;

  String get displayTitle {
    final titleText = title?.trim();
    if (titleText != null && titleText.isNotEmpty) return titleText;
    final noteText = note?.trim();
    if (noteText != null && noteText.isNotEmpty) return noteText;
    return itemId.isEmpty ? affiliateUrl : itemId;
  }

  String get providerLabel =>
      provider == 'mercadolivre' ? 'Mercado Livre' : 'Shopee';

  bool get active => isActive && available != false;

  factory AffiliateProductLink.fromJson(
    String provider,
    Map<String, dynamic> json,
  ) {
    final amountRaw = json['priceAmount'] ?? json['price_amount'];
    final amount = amountRaw == null ? null : _double(amountRaw);
    final availableRaw = json['available'] ?? json['is_available'];
    return AffiliateProductLink(
      provider: provider,
      id: _int(json['id']),
      itemId: (json['itemId'] ?? json['item_id'] ?? '').toString(),
      affiliateUrl: (json['affiliateUrl'] ?? json['affiliate_url'] ?? '')
          .toString(),
      title: _nullable(json['title']),
      productUrl: _nullable(json['productUrl'] ?? json['product_url']),
      imageUrl: _nullable(json['imageUrl'] ?? json['image_url']),
      priceAmount: amount,
      priceFormatted: _nullable(
        json['priceFormatted'] ?? json['price_formatted'],
      ),
      categoryId: _nullable(json['categoryId'] ?? json['category_id']),
      note: _nullable(json['note']),
      available: availableRaw == null ? null : _bool(availableRaw),
      isActive: _bool(json['isActive'] ?? json['is_active'] ?? true),
      clickCount: _int(json['clickCount'] ?? json['click_count']),
      updatedAt: _date(json['updatedAt'] ?? json['updated_at']),
    );
  }
}

class AffiliateLinksSnapshot {
  const AffiliateLinksSnapshot({
    required this.shopeeLinks,
    required this.mercadoLivreLinks,
  });

  final List<AffiliateProductLink> shopeeLinks;
  final List<AffiliateProductLink> mercadoLivreLinks;

  List<AffiliateProductLink> get allLinks {
    final links = [...shopeeLinks, ...mercadoLivreLinks];
    links.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return links;
  }

  int get totalLinks => shopeeLinks.length + mercadoLivreLinks.length;

  int get activeLinks => allLinks.where((link) => link.active).length;
}

class ResellerWalletSummary {
  const ResellerWalletSummary({
    required this.resellerUserId,
    required this.creditBalance,
    required this.reservedCredits,
    required this.commissionBalance,
  });

  final int resellerUserId;
  final int creditBalance;
  final int reservedCredits;
  final double commissionBalance;

  int get availableCredits =>
      (creditBalance - reservedCredits).clamp(0, 1 << 31).toInt();

  factory ResellerWalletSummary.fromJson(Map<String, dynamic> json) {
    return ResellerWalletSummary(
      resellerUserId: _int(json['resellerUserId'] ?? json['reseller_user_id']),
      creditBalance: _int(json['creditBalance'] ?? json['credit_balance']),
      reservedCredits: _int(
        json['reservedCredits'] ?? json['reserved_credits'],
      ),
      commissionBalance: _double(
        json['commissionBalance'] ?? json['commission_balance'],
      ),
    );
  }
}

class ResellerCustomerSummary {
  const ResellerCustomerSummary({
    required this.userId,
    required this.name,
    required this.email,
    required this.status,
    this.whatsappNumber,
    this.planId,
    this.planName,
    this.createdAt,
  });

  final int userId;
  final String name;
  final String email;
  final String status;
  final String? whatsappNumber;
  final int? planId;
  final String? planName;
  final DateTime? createdAt;

  bool get active => status == 'active';

  factory ResellerCustomerSummary.fromJson(Map<String, dynamic> json) {
    final id = _int(
      json['userId'] ??
          json['customerId'] ??
          json['customerUserId'] ??
          json['customer_user_id'] ??
          json['id'],
    );
    final createdRaw = json['createdAt'] ?? json['created_at'];
    return ResellerCustomerSummary(
      userId: id,
      name: (json['name'] ?? json['customerName'] ?? 'Cliente').toString(),
      email: (json['email'] ?? json['customerEmail'] ?? '').toString(),
      status: (json['status'] ?? 'active').toString(),
      whatsappNumber: _nullable(
        json['whatsappNumber'] ?? json['whatsapp_number'],
      ),
      planId: _intOrNull(json['planId'] ?? json['plan_id']),
      planName: _nullable(json['planName'] ?? json['plan_name']),
      createdAt: createdRaw == null
          ? null
          : DateTime.tryParse(createdRaw.toString()),
    );
  }
}

class PartnerMemberSummary {
  const PartnerMemberSummary({
    required this.userId,
    required this.name,
    required this.email,
    required this.role,
    required this.status,
    required this.creditBalance,
    required this.commissionBalance,
    required this.commissionRate,
    this.permissions = const <String, dynamic>{},
    this.whatsappNumber,
    this.parentUserId,
  });

  final int userId;
  final String name;
  final String email;
  final String role;
  final String status;
  final int creditBalance;
  final double commissionBalance;
  final double commissionRate;
  final Map<String, dynamic> permissions;
  final String? whatsappNumber;
  final int? parentUserId;

  factory PartnerMemberSummary.fromJson(Map<String, dynamic> json) {
    final rawPermissions = json['permissions'];
    return PartnerMemberSummary(
      userId: _int(json['userId'] ?? json['user_id']),
      name: (json['name'] ?? 'Parceiro').toString(),
      email: (json['email'] ?? '').toString(),
      role: (json['role'] ?? 'reseller').toString(),
      status: (json['status'] ?? 'active').toString(),
      creditBalance: _int(json['creditBalance'] ?? json['credit_balance']),
      commissionBalance: _double(
        json['commissionBalance'] ?? json['commission_balance'],
      ),
      commissionRate: _double(
        json['commissionRate'] ?? json['commission_rate'] ?? 20,
      ),
      permissions: rawPermissions is Map
          ? Map<String, dynamic>.from(rawPermissions)
          : const <String, dynamic>{},
      whatsappNumber: _nullable(
        json['whatsappNumber'] ?? json['whatsapp_number'],
      ),
      parentUserId: _intOrNull(json['parentUserId'] ?? json['parent_user_id']),
    );
  }
}

class ResellerDashboardSnapshot {
  const ResellerDashboardSnapshot({
    required this.enabled,
    required this.role,
    required this.permissions,
    required this.wallet,
    required this.customers,
    this.partners = const <PartnerMemberSummary>[],
    required this.plans,
    this.financialSettings = const <String, dynamic>{},
    this.planCosts = const <Map<String, dynamic>>[],
  });

  final bool enabled;
  final String role;
  final Map<String, dynamic> permissions;
  final ResellerWalletSummary wallet;
  final List<ResellerCustomerSummary> customers;
  final List<PartnerMemberSummary> partners;
  final List<SubscriptionPlanSummary> plans;
  final Map<String, dynamic> financialSettings;
  final List<Map<String, dynamic>> planCosts;

  factory ResellerDashboardSnapshot.fromJson(Map<String, dynamic> json) {
    return ResellerDashboardSnapshot(
      enabled: _bool(json['enabled']),
      role: (json['role'] ?? 'reseller').toString(),
      permissions: json['permissions'] is Map
          ? Map<String, dynamic>.from(json['permissions'] as Map)
          : const <String, dynamic>{},
      wallet: ResellerWalletSummary.fromJson(
        json['wallet'] is Map
            ? Map<String, dynamic>.from(json['wallet'] as Map)
            : const <String, dynamic>{},
      ),
      customers: _list(
        json['customers'],
      ).map(ResellerCustomerSummary.fromJson).toList(growable: false),
      partners: _list(
        json['partners'],
      ).map(PartnerMemberSummary.fromJson).toList(growable: false),
      plans: _list(
        json['plans'],
      ).map(SubscriptionPlanSummary.fromJson).toList(growable: false),
      financialSettings: json['financialSettings'] is Map
          ? Map<String, dynamic>.from(json['financialSettings'] as Map)
          : const <String, dynamic>{},
      planCosts: _list(json['planCosts']),
    );
  }
}

class CommerceHistorySnapshot {
  const CommerceHistorySnapshot({
    required this.purchases,
    required this.charges,
  });

  final List<PurchaseHistorySummary> purchases;
  final List<PaymentChargeSummary> charges;

  bool get isEmpty => purchases.isEmpty && charges.isEmpty;

  double get purchaseTotal =>
      purchases.fold(0, (sum, item) => sum + item.amount);

  double get approvedChargeTotal => charges
      .where((item) => item.approved)
      .fold(0, (sum, item) => sum + item.amount);
}

class PurchaseHistorySummary {
  const PurchaseHistorySummary({
    required this.id,
    required this.categoryName,
    required this.amount,
    required this.currency,
    required this.customerName,
    required this.customerWhatsapp,
    required this.description,
    required this.productDetails,
    required this.productFilePath,
    required this.purchasedAt,
    required this.metadata,
  });

  final int id;
  final String categoryName;
  final double amount;
  final String currency;
  final String? customerName;
  final String? customerWhatsapp;
  final String? description;
  final String productDetails;
  final String? productFilePath;
  final DateTime purchasedAt;
  final Map<String, dynamic> metadata;

  String get customerLabel {
    final name = customerName?.trim();
    if (name != null && name.isNotEmpty) return name;
    final phone = customerWhatsapp?.trim();
    if (phone != null && phone.isNotEmpty) return phone;
    return 'Cliente do bot';
  }

  String get note => _nullable(metadata['adminNote']) ?? '';

  factory PurchaseHistorySummary.fromJson(Map<String, dynamic> json) {
    return PurchaseHistorySummary(
      id: _int(json['id']),
      categoryName:
          _nullable(json['categoryName'] ?? json['category_name']) ?? 'Compra',
      amount: _double(json['categoryPrice'] ?? json['category_price']),
      currency: _nullable(json['currency']) ?? 'BRL',
      customerName: _nullable(json['customerName'] ?? json['customer_name']),
      customerWhatsapp: _nullable(
        json['customerWhatsapp'] ?? json['customer_whatsapp'],
      ),
      description: _nullable(
        json['categoryDescription'] ?? json['category_description'],
      ),
      productDetails:
          _nullable(json['productDetails'] ?? json['product_details']) ?? '',
      productFilePath: _nullable(
        json['productFilePath'] ?? json['product_file_path'],
      ),
      purchasedAt: _date(json['purchasedAt'] ?? json['purchased_at']),
      metadata: _map(json['metadata']),
    );
  }
}

class PaymentChargeSummary {
  const PaymentChargeSummary({
    required this.id,
    required this.publicId,
    required this.provider,
    required this.status,
    required this.amount,
    required this.currency,
    required this.customerName,
    required this.customerWhatsapp,
    required this.ticketUrl,
    required this.createdAt,
    required this.updatedAt,
    required this.metadata,
  });

  final int id;
  final String publicId;
  final String provider;
  final String status;
  final double amount;
  final String currency;
  final String? customerName;
  final String? customerWhatsapp;
  final String? ticketUrl;
  final DateTime createdAt;
  final DateTime updatedAt;
  final Map<String, dynamic> metadata;

  bool get approved {
    final normalized = status.toLowerCase();
    return normalized == 'approved' || normalized == 'accredited';
  }

  bool get pending => status.toLowerCase() == 'pending';

  String get customerLabel {
    final name = customerName?.trim();
    if (name != null && name.isNotEmpty) return name;
    final phone = customerWhatsapp?.trim();
    if (phone != null && phone.isNotEmpty) return phone;
    return 'Cliente';
  }

  String get note => _nullable(metadata['adminNote']) ?? '';

  factory PaymentChargeSummary.fromJson(Map<String, dynamic> json) {
    return PaymentChargeSummary(
      id: _int(json['id']),
      publicId: _nullable(json['publicId'] ?? json['public_id']) ?? '',
      provider: _nullable(json['provider']) ?? 'pagamento',
      status: _nullable(json['status']) ?? '',
      amount: _double(json['amount']),
      currency: _nullable(json['currency']) ?? 'BRL',
      customerName: _nullable(json['customerName'] ?? json['customer_name']),
      customerWhatsapp: _nullable(
        json['customerWhatsapp'] ?? json['customer_whatsapp'],
      ),
      ticketUrl: _nullable(json['ticketUrl'] ?? json['ticket_url']),
      createdAt: _date(json['createdAt'] ?? json['created_at']),
      updatedAt: _date(json['updatedAt'] ?? json['updated_at']),
      metadata: _map(json['metadata']),
    );
  }
}

class BotStoreSnapshot {
  const BotStoreSnapshot({
    required this.store,
    required this.categories,
    required this.products,
    required this.inventory,
    required this.orders,
    required this.customers,
    required this.wwPanel,
    required this.wwPanelOffers,
    required this.wwPanelClients,
    required this.smm,
    required this.smmServices,
    required this.smmOrders,
    required this.smmCatalogCount,
    required this.centralCategories,
    required this.centralPackages,
    this.centralCartError,
  });

  final BotStoreSettings store;
  final List<BotStoreCategory> categories;
  final List<BotStoreProduct> products;
  final List<BotStoreInventoryItem> inventory;
  final List<BotStoreOrder> orders;
  final List<BotStoreCustomer> customers;
  final BotStoreWwPanelSettings wwPanel;
  final List<BotStoreWwPanelOffer> wwPanelOffers;
  final List<BotStoreWwPanelClient> wwPanelClients;
  final BotStoreSmmSettings smm;
  final List<BotStoreSmmService> smmServices;
  final List<BotStoreSmmOrder> smmOrders;
  final int smmCatalogCount;
  final List<Map<String, dynamic>> centralCategories;
  final List<Map<String, dynamic>> centralPackages;
  final String? centralCartError;

  factory BotStoreSnapshot.fromJson(Map<String, dynamic> json) {
    final central = _map(json['centralCatalog']);
    return BotStoreSnapshot(
      store: BotStoreSettings.fromJson(_map(json['store'])),
      categories: _list(
        json['categories'],
      ).map(BotStoreCategory.fromJson).toList(growable: false),
      products: _list(
        json['products'],
      ).map(BotStoreProduct.fromJson).toList(growable: false),
      inventory: _list(
        json['inventory'],
      ).map(BotStoreInventoryItem.fromJson).toList(growable: false),
      orders: _list(
        json['orders'],
      ).map(BotStoreOrder.fromJson).toList(growable: false),
      customers: _list(
        json['customers'],
      ).map(BotStoreCustomer.fromJson).toList(growable: false),
      wwPanel: BotStoreWwPanelSettings.fromJson(_map(json['wwPanel'])),
      wwPanelOffers: _list(
        json['wwPanelOffers'],
      ).map(BotStoreWwPanelOffer.fromJson).toList(growable: false),
      wwPanelClients: _list(
        json['wwPanelClients'],
      ).map(BotStoreWwPanelClient.fromJson).toList(growable: false),
      smm: BotStoreSmmSettings.fromJson(_map(json['smm'])),
      smmServices: _list(
        json['smmServices'],
      ).map(BotStoreSmmService.fromJson).toList(growable: false),
      smmOrders: _list(
        json['smmOrders'],
      ).map(BotStoreSmmOrder.fromJson).toList(growable: false),
      smmCatalogCount: _int(json['smmCatalogCount']),
      centralCategories: _list(
        central['allCategories'] ?? central['categories'],
      ),
      centralPackages: _list(central['packages']),
      centralCartError: _nullable(json['centralCartError']),
    );
  }
}

class BotStoreSmmSettings {
  const BotStoreSmmSettings({
    required this.connected,
    required this.enabled,
    required this.providerCurrency,
    required this.fxMode,
    required this.usdBrlRate,
    required this.markupPercent,
    required this.fixedMarkupCents,
    required this.minimumProfitCents,
    this.apiKeyHint,
    this.apiBase,
    this.providerBalance,
    this.lastFxAt,
    this.lastCatalogSyncAt,
    this.lastVerifiedAt,
  });

  final bool connected;
  final bool enabled;
  final String? apiKeyHint;
  final String? apiBase;
  final double? providerBalance;
  final String providerCurrency;
  final String fxMode;
  final double usdBrlRate;
  final double markupPercent;
  final int fixedMarkupCents;
  final int minimumProfitCents;
  final DateTime? lastFxAt;
  final DateTime? lastCatalogSyncAt;
  final DateTime? lastVerifiedAt;

  factory BotStoreSmmSettings.fromJson(Map<String, dynamic> json) {
    return BotStoreSmmSettings(
      connected: _bool(json['connected']),
      enabled: _bool(json['enabled']),
      apiKeyHint: _nullable(json['apiKeyHint'] ?? json['api_key_hint']),
      apiBase: _nullable(json['apiBase'] ?? json['api_base']),
      providerBalance: json['providerBalance'] == null
          ? null
          : double.tryParse(json['providerBalance'].toString()),
      providerCurrency: _nullable(json['providerCurrency']) ?? 'USD',
      fxMode: _nullable(json['fxMode']) ?? 'auto',
      usdBrlRate: double.tryParse(json['usdBrlRate']?.toString() ?? '') ?? 5.5,
      markupPercent:
          double.tryParse(json['markupPercent']?.toString() ?? '') ?? 40,
      fixedMarkupCents: _int(json['fixedMarkupCents']),
      minimumProfitCents: _int(json['minimumProfitCents']),
      lastFxAt: _nullableDate([json['lastFxAt']]),
      lastCatalogSyncAt: _nullableDate([json['lastCatalogSyncAt']]),
      lastVerifiedAt: _nullableDate([json['lastVerifiedAt']]),
    );
  }
}

class BotStoreSmmService {
  const BotStoreSmmService({
    required this.id,
    required this.providerServiceId,
    required this.name,
    required this.category,
    required this.description,
    required this.providerName,
    required this.providerCategory,
    required this.serviceType,
    required this.providerRate,
    required this.min,
    required this.max,
    required this.providerMin,
    required this.providerMax,
    required this.refill,
    required this.cancel,
    required this.dripfeed,
    required this.imported,
    required this.enabled,
    required this.position,
    this.customSaleRateCents,
    this.estimatedSaleCents,
  });

  final int id;
  final int providerServiceId;
  final String name;
  final String category;
  final String? description;
  final String providerName;
  final String providerCategory;
  final String serviceType;
  final double providerRate;
  final int min;
  final int max;
  final int providerMin;
  final int providerMax;
  final bool refill;
  final bool cancel;
  final bool dripfeed;
  final bool imported;
  final bool enabled;
  final int position;
  final int? customSaleRateCents;
  final int? estimatedSaleCents;

  factory BotStoreSmmService.fromJson(Map<String, dynamic> json) {
    return BotStoreSmmService(
      id: _int(json['id']),
      providerServiceId: _int(json['providerServiceId']),
      name: _nullable(json['name']) ?? 'Serviço SMM',
      category: _nullable(json['category']) ?? 'Outros',
      description: _nullable(json['description']),
      providerName:
          _nullable(json['providerName'] ?? json['name']) ?? 'Serviço SMM',
      providerCategory:
          _nullable(json['providerCategory'] ?? json['category']) ?? 'Outros',
      serviceType: _nullable(json['serviceType']) ?? 'Default',
      providerRate:
          double.tryParse(json['providerRate']?.toString() ?? '') ?? 0,
      min: _int(json['min']),
      max: _int(json['max']),
      providerMin: _int(json['providerMin'] ?? json['min']),
      providerMax: _int(json['providerMax'] ?? json['max']),
      refill: _bool(json['refill']),
      cancel: _bool(json['cancel']),
      dripfeed: _bool(json['dripfeed']),
      imported: json.containsKey('imported') ? _bool(json['imported']) : true,
      enabled: _bool(json['enabled']),
      position: _int(json['position']),
      customSaleRateCents: _intOrNull(json['customSaleRateCents']),
      estimatedSaleCents: _intOrNull(json['estimatedSaleCents']),
    );
  }
}

class BotStoreSmmOrder {
  const BotStoreSmmOrder({
    required this.id,
    required this.orderId,
    required this.serviceId,
    required this.customerJid,
    required this.target,
    required this.quantity,
    required this.saleTotalCents,
    required this.status,
    required this.serviceName,
    required this.serviceCategory,
    required this.serviceType,
    required this.createdAt,
    this.providerOrderId,
    this.startCount,
    this.remains,
    this.refillId,
    this.refillStatus,
  });

  final int id;
  final int orderId;
  final int serviceId;
  final String? providerOrderId;
  final String customerJid;
  final String target;
  final int quantity;
  final int saleTotalCents;
  final String status;
  final String? startCount;
  final String? remains;
  final String? refillId;
  final String? refillStatus;
  final String serviceName;
  final String serviceCategory;
  final String serviceType;
  final DateTime createdAt;

  factory BotStoreSmmOrder.fromJson(Map<String, dynamic> json) {
    return BotStoreSmmOrder(
      id: _int(json['id']),
      orderId: _int(json['orderId']),
      serviceId: _int(json['serviceId']),
      providerOrderId: _nullable(json['providerOrderId']),
      customerJid: _nullable(json['customerJid']) ?? '',
      target: _nullable(json['target']) ?? '',
      quantity: _int(json['quantity']),
      saleTotalCents: _int(json['saleTotalCents']),
      status: _nullable(json['status']) ?? 'pending_payment',
      startCount: _nullable(json['startCount']),
      remains: _nullable(json['remains']),
      refillId: _nullable(json['refillId']),
      refillStatus: _nullable(json['refillStatus']),
      serviceName: _nullable(json['serviceName']) ?? 'Serviço SMM',
      serviceCategory: _nullable(json['serviceCategory']) ?? 'SMM',
      serviceType: _nullable(json['serviceType']) ?? 'Default',
      createdAt: _date(json['createdAt']),
    );
  }
}

class BotStoreWwPanelSettings {
  const BotStoreWwPanelSettings({
    required this.connected,
    required this.enabled,
    required this.account,
    required this.plans,
    required this.addons,
    required this.iptvPackages,
    required this.p2pPackages,
    required this.apps,
    required this.appTypes,
    this.apiKeyHint,
    this.apiBase,
    this.lastVerifiedAt,
  });

  final bool connected;
  final bool enabled;
  final String? apiKeyHint;
  final String? apiBase;
  final DateTime? lastVerifiedAt;
  final Map<String, dynamic> account;
  final List<Map<String, dynamic>> plans;
  final List<Map<String, dynamic>> addons;
  final List<Map<String, dynamic>> iptvPackages;
  final List<Map<String, dynamic>> p2pPackages;
  final List<String> apps;
  final Map<String, String> appTypes;

  String get accountName =>
      _nullable(account['username'] ?? account['name']) ?? 'Conta WWPanel';

  factory BotStoreWwPanelSettings.fromJson(Map<String, dynamic> json) {
    final catalog = _map(json['catalog']);
    return BotStoreWwPanelSettings(
      connected: _bool(json['connected']),
      enabled: _bool(json['enabled']),
      apiKeyHint: _nullable(json['apiKeyHint'] ?? json['api_key_hint']),
      apiBase: _nullable(json['apiBase'] ?? json['api_base']),
      lastVerifiedAt: _nullableDate([
        json['lastVerifiedAt'],
        json['last_verified_at'],
      ]),
      account: _map(json['account']),
      plans: _list(catalog['plans']),
      addons: _list(catalog['addons']),
      iptvPackages: _list(catalog['iptvPackages']),
      p2pPackages: _list(catalog['p2pPackages']),
      apps: catalog['apps'] is List
          ? (catalog['apps'] as List)
                .map((item) => item.toString().trim())
                .where((item) => item.isNotEmpty)
                .toList(growable: false)
          : const <String>[],
      appTypes: _map(
        catalog['appTypes'],
      ).map((key, value) => MapEntry(key, value.toString().trim())),
    );
  }
}

class BotStoreWwPanelOffer {
  const BotStoreWwPanelOffer({
    required this.id,
    required this.name,
    required this.priceCents,
    required this.enabled,
    required this.position,
    required this.isTrial,
    required this.planId,
    required this.packageP2p,
    required this.packageIptv,
    required this.accessIptv,
    required this.accessNexus,
    required this.addons,
    required this.country,
    this.description,
    this.imagePath,
    this.imageUrl,
    this.days,
    this.months,
  });

  final int id;
  final String name;
  final String? description;
  final int priceCents;
  final String? imagePath;
  final String? imageUrl;
  final bool enabled;
  final int position;
  final bool isTrial;
  final int? days;
  final int? months;
  final int planId;
  final String packageP2p;
  final int packageIptv;
  final int accessIptv;
  final int accessNexus;
  final List<int> addons;
  final String country;

  double get price => priceCents / 100;
  String get validityLabel => months != null && months! > 0
      ? '$months ${months == 1 ? 'mês' : 'meses'}'
      : '${days ?? 1} ${(days ?? 1) == 1 ? 'dia' : 'dias'}';

  factory BotStoreWwPanelOffer.fromJson(Map<String, dynamic> json) {
    return BotStoreWwPanelOffer(
      id: _int(json['id']),
      name: _nullable(json['name']) ?? 'Plano IPTV',
      description: _nullable(json['description']),
      priceCents: _int(json['priceCents'] ?? json['price_cents']),
      imagePath: _nullable(json['imagePath'] ?? json['image_path']),
      imageUrl: _nullable(json['imageUrl'] ?? json['image_url']),
      enabled: _bool(json['enabled']),
      position: _int(json['position']),
      isTrial: _bool(json['isTrial'] ?? json['is_trial']),
      days: _intOrNull(json['days']),
      months: _intOrNull(json['months']),
      planId: _int(json['planId'] ?? json['plan_id']),
      packageP2p: _nullable(json['packageP2p'] ?? json['package_p2p']) ?? '',
      packageIptv: _int(json['packageIptv'] ?? json['package_iptv']),
      accessIptv: _int(json['accessIptv'] ?? json['access_iptv']),
      accessNexus: _int(json['accessNexus'] ?? json['access_nexus']),
      addons: json['addons'] is List
          ? (json['addons'] as List)
                .map(_int)
                .where((item) => item > 0)
                .toList(growable: false)
          : const <int>[],
      country: _nullable(json['country']) ?? 'Brasil',
    );
  }
}

class BotStoreWwPanelClient {
  const BotStoreWwPanelClient({
    required this.id,
    required this.externalId,
    required this.username,
    required this.status,
    required this.isTrial,
    required this.createdAt,
    required this.updatedAt,
    this.offerId,
    this.orderId,
    this.customerJid,
    this.customerName,
    this.customerPhone,
    this.passwordHint,
    this.expiresAt,
  });

  final int id;
  final int? offerId;
  final int? orderId;
  final String? customerJid;
  final String? customerName;
  final String? customerPhone;
  final String externalId;
  final String username;
  final String? passwordHint;
  final DateTime? expiresAt;
  final String status;
  final bool isTrial;
  final DateTime createdAt;
  final DateTime updatedAt;

  String get customerLabel =>
      _nullable(customerName) ?? _nullable(customerPhone) ?? 'Cliente';

  factory BotStoreWwPanelClient.fromJson(Map<String, dynamic> json) {
    return BotStoreWwPanelClient(
      id: _int(json['id']),
      offerId: _intOrNull(json['offerId'] ?? json['offer_id']),
      orderId: _intOrNull(json['orderId'] ?? json['order_id']),
      customerJid: _nullable(json['customerJid'] ?? json['customer_jid']),
      customerName: _nullable(json['customerName'] ?? json['customer_name']),
      customerPhone: _nullable(json['customerPhone'] ?? json['customer_phone']),
      externalId: _nullable(json['externalId'] ?? json['external_id']) ?? '',
      username: _nullable(json['username']) ?? '',
      passwordHint: _nullable(json['passwordHint'] ?? json['password_hint']),
      expiresAt: _nullableDate([json['expiresAt'], json['expires_at']]),
      status: _nullable(json['status']) ?? 'active',
      isTrial: _bool(json['isTrial'] ?? json['is_trial']),
      createdAt: _date(json['createdAt'] ?? json['created_at']),
      updatedAt: _date(json['updatedAt'] ?? json['updated_at']),
    );
  }
}

class BotStoreSettings {
  const BotStoreSettings({
    required this.id,
    required this.instanceId,
    required this.enabled,
    required this.autoOpenPrivate,
    required this.name,
    required this.commands,
    required this.centralCartConnected,
    required this.centralCartMode,
    required this.centralCartGateway,
    required this.rootMenu,
    required this.categoryMenu,
    required this.productMenu,
    required this.iptvMenu,
    required this.smmMenu,
    required this.deliveryMenu,
    this.description,
    this.imagePath,
    this.imageUrl,
    this.paymentProvider,
    this.centralCartApiKeyHint,
    this.centralCartAppName,
    this.centralCartLastSyncAt,
  });

  final int id;
  final int instanceId;
  final bool enabled;
  final bool autoOpenPrivate;
  final String name;
  final String? description;
  final String? imagePath;
  final String? imageUrl;
  final List<String> commands;
  final String? paymentProvider;
  final bool centralCartConnected;
  final String centralCartMode;
  final String centralCartGateway;
  final BotStoreMenuTemplate rootMenu;
  final BotStoreMenuTemplate categoryMenu;
  final BotStoreMenuTemplate productMenu;
  final BotStoreMenuTemplate iptvMenu;
  final BotStoreMenuTemplate smmMenu;
  final BotStoreMenuTemplate deliveryMenu;
  final String? centralCartApiKeyHint;
  final String? centralCartAppName;
  final DateTime? centralCartLastSyncAt;

  factory BotStoreSettings.fromJson(Map<String, dynamic> json) {
    final central = _map(json['centralCart']);
    final app = _map(central['app']);
    final menus = _map(json['menuConfig'] ?? json['menu_config']);
    final commands = json['commands'] is List
        ? (json['commands'] as List)
              .map((item) => item.toString().trim())
              .where((item) => item.isNotEmpty)
              .toList(growable: false)
        : const <String>[];
    return BotStoreSettings(
      id: _int(json['id']),
      instanceId: _int(json['instanceId'] ?? json['instance_id']),
      enabled: _bool(json['enabled']),
      autoOpenPrivate:
          json['autoOpenPrivate'] == null && json['auto_open_private'] == null
          ? true
          : _bool(json['autoOpenPrivate'] ?? json['auto_open_private']),
      name: _nullable(json['name']) ?? 'Minha loja',
      description: _nullable(json['description']),
      imagePath: _nullable(json['imagePath'] ?? json['image_path']),
      imageUrl: _nullable(json['imageUrl'] ?? json['image_url']),
      commands: commands,
      paymentProvider: _nullable(
        json['paymentProvider'] ?? json['payment_provider'],
      ),
      centralCartConnected: _bool(central['connected']),
      centralCartMode: _nullable(central['mode']) ?? 'live',
      centralCartGateway:
          _nullable(central['checkoutGateway'] ?? central['gateway']) ??
          'OTHER',
      rootMenu: BotStoreMenuTemplate.fromJson(
        _map(menus['root']),
        kind: 'root',
      ),
      categoryMenu: BotStoreMenuTemplate.fromJson(
        _map(menus['category']),
        kind: 'category',
      ),
      productMenu: BotStoreMenuTemplate.fromJson(
        _map(menus['product']),
        kind: 'product',
      ),
      iptvMenu: BotStoreMenuTemplate.fromJson(
        _map(menus['iptv']),
        kind: 'iptv',
      ),
      smmMenu: BotStoreMenuTemplate.fromJson(_map(menus['smm']), kind: 'smm'),
      deliveryMenu: BotStoreMenuTemplate.fromJson(
        _map(menus['delivery']),
        kind: 'delivery',
      ),
      centralCartApiKeyHint: _nullable(central['apiKeyHint']),
      centralCartAppName: _nullable(app['name']),
      centralCartLastSyncAt: _nullableDate([central['lastSyncAt']]),
    );
  }
}

class BotStoreMenuTemplate {
  const BotStoreMenuTemplate({
    required this.title,
    required this.body,
    required this.footer,
    required this.listButton,
    this.imagePath,
    this.imageUrl,
    this.buyButton,
    this.backButton,
    this.categoryRow,
    this.productRow,
    this.trialUsedBody,
    this.trialUsedButton,
    this.macPromptBody,
    this.macAccessBody,
    this.macAccessButton,
    this.macAppBody,
    this.macAppButton,
    this.appActivatedBody,
    this.linkPromptBody,
    this.quantityPromptBody,
    this.detailsPromptBody,
    this.orderSummaryBody,
    this.orderCreatedBody,
    this.statusBody,
  });

  final String title;
  final String body;
  final String footer;
  final String listButton;
  final String? imagePath;
  final String? imageUrl;
  final String? buyButton;
  final String? backButton;
  final String? categoryRow;
  final String? productRow;
  final String? trialUsedBody;
  final String? trialUsedButton;
  final String? macPromptBody;
  final String? macAccessBody;
  final String? macAccessButton;
  final String? macAppBody;
  final String? macAppButton;
  final String? appActivatedBody;
  final String? linkPromptBody;
  final String? quantityPromptBody;
  final String? detailsPromptBody;
  final String? orderSummaryBody;
  final String? orderCreatedBody;
  final String? statusBody;

  factory BotStoreMenuTemplate.fromJson(
    Map<String, dynamic> json, {
    required String kind,
  }) {
    final isProduct = kind == 'product';
    final isIptv = kind == 'iptv';
    final isSmm = kind == 'smm';
    final isRoot = kind == 'root';
    final isDelivery = kind == 'delivery';
    return BotStoreMenuTemplate(
      title:
          _nullable(json['title']) ??
          (isDelivery
              ? ''
              : isIptv
              ? 'Planos IPTV'
              : isSmm
              ? 'Painel SMM'
              : isProduct
              ? '{{product}}'
              : kind == 'category'
              ? '{{category}}'
              : '{{store}}'),
      body:
          _nullable(json['body']) ??
          (isDelivery
              ? '🔰 COMPRA EFETUADA COM SUCESSO 🔰\n'
                    '🧰 Serviço: {{produto}}\n'
                    '💸 Valor: {{valor}}\n'
                    '📅 Data Da Compra:\n'
                    '{{data_compra}}\n\n'
                    'ℹ️ DADOS:\n'
                    '{{dados}}'
              : isIptv
              ? 'Escolha um plano, crie seu teste ou gerencie seus acessos.'
              : isSmm
              ? 'Impulsione suas redes com entrega automática.\n\n'
                    'Escolha uma categoria para continuar.'
              : isProduct
              ? '💰 {{price}}\n{{stock}}\n\n{{description}}'
              : kind == 'category'
              ? '{{description}}'
              : 'Olá {{pushname}},\n\n'
                    'É um prazer atendê-lo pelo nosso canal oficial {{store}}.\n\n'
                    'Saldo disponível: {{saldo_cliente}}\n'
                    'Número do WhatsApp: {{numero_cliente}}\n\n'
                    'Escolha uma das opções abaixo para continuar e aproveitar '
                    'nossas ofertas digitais.'),
      footer:
          _nullable(json['footer']) ??
          (isDelivery
              ? ''
              : isIptv
              ? '{{store}}'
              : isSmm
              ? '{{store}} · preços em reais'
              : isRoot
              ? 'Selecione uma das opções para continuar seu atendimento.'
              : kind == 'category'
              ? 'Escolha o serviço que melhor atende o que você precisa.'
              : '{{store}}'),
      listButton:
          _nullable(json['listButton'] ?? json['list_button']) ??
          (isDelivery || isProduct
              ? ''
              : isIptv
              ? 'Abrir IPTV 📺'
              : isSmm
              ? 'Abrir serviços 🚀'
              : kind == 'category'
              ? 'Ver serviços'
              : 'Ver categorias'),
      imagePath: _nullable(json['imagePath'] ?? json['image_path']),
      imageUrl: _nullable(json['imageUrl'] ?? json['image_url']),
      buyButton:
          _nullable(json['buyButton'] ?? json['buy_button']) ??
          (isProduct || isIptv || isSmm ? 'Comprar agora 🛒' : null),
      backButton:
          _nullable(json['backButton'] ?? json['back_button']) ??
          (isProduct || isIptv || isSmm ? 'Voltar à loja ↩️' : null),
      categoryRow:
          _nullable(json['categoryRow'] ?? json['category_row']) ??
          (isRoot ? '{{count}} {{countLabel}} · {{description}}' : null),
      productRow:
          _nullable(json['productRow'] ?? json['product_row']) ??
          (isIptv
              ? '{{price}} · {{validity}} · {{screens}}'
              : !isProduct
              ? '{{price}} · {{stock}}'
              : null),
      trialUsedBody:
          _nullable(json['trialUsedBody'] ?? json['trial_used_body']) ??
          (isIptv
              ? 'Este número já utilizou o teste gratuito.\n'
                    'Escolha um plano para continuar assistindo.'
              : null),
      trialUsedButton:
          _nullable(json['trialUsedButton'] ?? json['trial_used_button']) ??
          (isIptv ? 'Voltar aos planos ↩️' : null),
      macPromptBody:
          _nullable(json['macPromptBody'] ?? json['mac_prompt_body']) ??
          (isIptv
              ? '📺 *Ativar {{app}}*\n\n'
                    'Envie agora o *MAC* ou identificador exibido no '
                    'aplicativo.\nPara sair, envie *cancelar*.'
              : null),
      macAccessBody:
          _nullable(json['macAccessBody'] ?? json['mac_access_body']) ??
          (isIptv
              ? 'Encontrei o MAC *{{mac}}*.\n'
                    'Escolha o acesso IPTV que deseja ativar.'
              : null),
      macAccessButton:
          _nullable(json['macAccessButton'] ?? json['mac_access_button']) ??
          (isIptv ? 'Escolher acesso 👤' : null),
      macAppBody:
          _nullable(json['macAppBody'] ?? json['mac_app_body']) ??
          (isIptv
              ? 'Acesso *{{usuario}}* selecionado.\n'
                    'Agora escolha o aplicativo que deseja ativar.'
              : null),
      macAppButton:
          _nullable(json['macAppButton'] ?? json['mac_app_button']) ??
          (isIptv ? 'Escolher aplicativo 📺' : null),
      appActivatedBody:
          _nullable(json['appActivatedBody'] ?? json['app_activated_body']) ??
          (isIptv
              ? '✅ *Aplicativo ativado*\n'
                    '📺 {{app}}\n👤 {{usuario}}\n🔗 {{mac}}'
              : null),
      linkPromptBody:
          _nullable(json['linkPromptBody'] ?? json['link_prompt_body']) ??
          (isSmm
              ? '🔗 *{{service}}*\n\nEnvie o link, perfil ou página que '
                    'receberá o serviço.'
              : null),
      quantityPromptBody:
          _nullable(
            json['quantityPromptBody'] ?? json['quantity_prompt_body'],
          ) ??
          (isSmm
              ? '🔢 *{{service}}*\n\nEnvie a quantidade entre '
                    '*{{min}}* e *{{max}}*.'
              : null),
      detailsPromptBody:
          _nullable(json['detailsPromptBody'] ?? json['details_prompt_body']) ??
          (isSmm ? '📝 *{{service}}*\n\n{{instructions}}' : null),
      orderSummaryBody:
          _nullable(json['orderSummaryBody'] ?? json['order_summary_body']) ??
          (isSmm
              ? '🚀 *{{service}}*\n\n🔗 {{target}}\n📦 Quantidade: '
                    '{{quantity}}\n💰 Total: {{price}}'
              : null),
      orderCreatedBody:
          _nullable(json['orderCreatedBody'] ?? json['order_created_body']) ??
          (isSmm
              ? '✅ *Pedido SMM recebido*\n\n🆔 {{pedido}}\n🚀 '
                    '{{service}}\n📦 {{quantity}}\n💰 {{price}}\n'
                    '📊 Status: {{status}}'
              : null),
      statusBody:
          _nullable(json['statusBody'] ?? json['status_body']) ??
          (isSmm
              ? '📊 *Status do pedido*\n\n🆔 {{pedido}}\n🚀 '
                    '{{service}}\n📦 Restante: {{remains}}\n⚙️ {{status}}'
              : null),
    );
  }
}

class BotStoreCategory {
  const BotStoreCategory({
    required this.id,
    required this.name,
    required this.position,
    required this.enabled,
    this.description,
    this.imagePath,
    this.imageUrl,
  });

  final int id;
  final String name;
  final String? description;
  final String? imagePath;
  final String? imageUrl;
  final int position;
  final bool enabled;

  factory BotStoreCategory.fromJson(Map<String, dynamic> json) {
    return BotStoreCategory(
      id: _int(json['id']),
      name: _nullable(json['name']) ?? 'Categoria',
      description: _nullable(json['description']),
      imagePath: _nullable(json['imagePath'] ?? json['image_path']),
      imageUrl: _nullable(json['imageUrl'] ?? json['image_url']),
      position: _int(json['position']),
      enabled: json['enabled'] != false && !_isFalseValue(json['enabled']),
    );
  }
}

class BotStoreProduct {
  const BotStoreProduct({
    required this.id,
    required this.name,
    required this.priceCents,
    required this.inventoryAvailable,
    required this.inventoryReserved,
    required this.inventoryDelivered,
    required this.inventoryDisabled,
    required this.enabled,
    required this.position,
    this.categoryId,
    this.sku,
    this.description,
    this.imagePath,
    this.imageUrl,
  });

  final int id;
  final int? categoryId;
  final String name;
  final String? sku;
  final String? description;
  final int priceCents;
  final String? imagePath;
  final String? imageUrl;
  final int inventoryAvailable;
  final int inventoryReserved;
  final int inventoryDelivered;
  final int inventoryDisabled;
  final bool enabled;
  final int position;

  double get price => priceCents / 100;
  int get inventoryTotal =>
      inventoryAvailable +
      inventoryReserved +
      inventoryDelivered +
      inventoryDisabled;

  factory BotStoreProduct.fromJson(Map<String, dynamic> json) {
    return BotStoreProduct(
      id: _int(json['id']),
      categoryId: _intOrNull(json['categoryId'] ?? json['category_id']),
      name: _nullable(json['name']) ?? 'Produto',
      sku: _nullable(json['sku']),
      description: _nullable(json['description']),
      priceCents: _int(json['priceCents'] ?? json['price_cents']),
      imagePath: _nullable(json['imagePath'] ?? json['image_path']),
      imageUrl: _nullable(json['imageUrl'] ?? json['image_url']),
      inventoryAvailable: _int(_map(json['inventory'])['available']),
      inventoryReserved: _int(_map(json['inventory'])['reserved']),
      inventoryDelivered: _int(_map(json['inventory'])['delivered']),
      inventoryDisabled: _int(_map(json['inventory'])['disabled']),
      enabled: json['enabled'] != false && !_isFalseValue(json['enabled']),
      position: _int(json['position']),
    );
  }
}

class BotStoreInventoryItem {
  const BotStoreInventoryItem({
    required this.id,
    required this.productId,
    required this.itemType,
    required this.status,
    required this.maxUses,
    required this.usedCount,
    required this.reservedUses,
    required this.remainingUses,
    required this.createdAt,
    required this.updatedAt,
    this.label,
    this.deliveryValue,
    this.deliveryFilePath,
    this.deliveryFileUrl,
    this.deliveryFileName,
    this.deliveryMimeType,
    this.orderId,
    this.reservedUntil,
    this.deliveredAt,
  });

  final int id;
  final int productId;
  final String itemType;
  final String? label;
  final String? deliveryValue;
  final String? deliveryFilePath;
  final String? deliveryFileUrl;
  final String? deliveryFileName;
  final String? deliveryMimeType;
  final String status;
  final int maxUses;
  final int usedCount;
  final int reservedUses;
  final int remainingUses;
  final int? orderId;
  final DateTime? reservedUntil;
  final DateTime? deliveredAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get available => status == 'available';
  bool get delivered => status == 'delivered';

  String get contentLabel {
    final custom = label?.trim();
    if (custom != null && custom.isNotEmpty) return custom;
    final file = deliveryFileName?.trim();
    if (file != null && file.isNotEmpty) return file;
    final value = deliveryValue?.trim();
    if (value != null && value.isNotEmpty) {
      return value.length > 72 ? '${value.substring(0, 72)}...' : value;
    }
    return 'Item #$id';
  }

  factory BotStoreInventoryItem.fromJson(Map<String, dynamic> json) {
    final parsedMaxUses = _int(json['maxUses'] ?? json['max_uses']);
    final maxUses = parsedMaxUses <= 0 ? 1 : parsedMaxUses.clamp(1, 100000);
    final usedCount = _int(json['usedCount'] ?? json['used_count']);
    final reservedUses = _int(json['reservedUses'] ?? json['reserved_uses']);
    final remainingValue = json['remainingUses'] ?? json['remaining_uses'];
    return BotStoreInventoryItem(
      id: _int(json['id']),
      productId: _int(json['productId'] ?? json['product_id']),
      itemType: _nullable(json['itemType'] ?? json['item_type']) ?? 'code',
      label: _nullable(json['label']),
      deliveryValue: _nullable(json['deliveryValue'] ?? json['delivery_value']),
      deliveryFilePath: _nullable(
        json['deliveryFilePath'] ?? json['delivery_file_path'],
      ),
      deliveryFileUrl: _nullable(
        json['deliveryFileUrl'] ?? json['delivery_file_url'],
      ),
      deliveryFileName: _nullable(
        json['deliveryFileName'] ?? json['delivery_file_name'],
      ),
      deliveryMimeType: _nullable(
        json['deliveryMimeType'] ?? json['delivery_mime_type'],
      ),
      status: _nullable(json['status']) ?? 'available',
      maxUses: maxUses,
      usedCount: usedCount,
      reservedUses: reservedUses,
      remainingUses: remainingValue == null
          ? (maxUses - usedCount - reservedUses).clamp(0, maxUses)
          : _int(remainingValue),
      orderId: _intOrNull(json['orderId'] ?? json['order_id']),
      reservedUntil: _nullableDate([
        json['reservedUntil'],
        json['reserved_until'],
      ]),
      deliveredAt: _nullableDate([json['deliveredAt'], json['delivered_at']]),
      createdAt: _date(json['createdAt'] ?? json['created_at']),
      updatedAt: _date(json['updatedAt'] ?? json['updated_at']),
    );
  }
}

class BotStoreOrder {
  const BotStoreOrder({
    required this.id,
    required this.publicId,
    required this.provider,
    required this.quantity,
    required this.totalCents,
    required this.status,
    required this.createdAt,
    this.productId,
    this.customerJid,
    this.customerName,
    this.customerPhone,
    this.checkoutUrl,
    this.deliveredAt,
  });

  final int id;
  final String publicId;
  final int? productId;
  final String provider;
  final String? customerJid;
  final String? customerName;
  final String? customerPhone;
  final int quantity;
  final int totalCents;
  final String status;
  final String? checkoutUrl;
  final DateTime? deliveredAt;
  final DateTime createdAt;

  String get customerLabel => customerName?.trim().isNotEmpty == true
      ? customerName!.trim()
      : customerPhone?.trim().isNotEmpty == true
      ? customerPhone!.trim()
      : 'Cliente';

  factory BotStoreOrder.fromJson(Map<String, dynamic> json) {
    return BotStoreOrder(
      id: _int(json['id']),
      publicId: _nullable(json['publicId'] ?? json['public_id']) ?? '',
      productId: _intOrNull(json['productId'] ?? json['product_id']),
      provider: _nullable(json['provider']) ?? 'local',
      customerJid: _nullable(json['customerJid'] ?? json['customer_jid']),
      customerName: _nullable(json['customerName'] ?? json['customer_name']),
      customerPhone: _nullable(json['customerPhone'] ?? json['customer_phone']),
      quantity: _int(json['quantity']),
      totalCents: _int(json['totalCents'] ?? json['total_cents']),
      status: _nullable(json['status']) ?? 'pending',
      checkoutUrl: _nullable(json['checkoutUrl'] ?? json['checkout_url']),
      deliveredAt: _nullableDate([json['deliveredAt'], json['delivered_at']]),
      createdAt: _date(json['createdAt'] ?? json['created_at']),
    );
  }
}

class BotStoreCustomer {
  const BotStoreCustomer({
    required this.id,
    required this.customerJid,
    required this.balanceCents,
    required this.blocked,
    required this.ordersCount,
    required this.paidOrdersCount,
    required this.totalSpentCents,
    required this.createdAt,
    required this.updatedAt,
    this.customerName,
    this.customerPhone,
    this.avatarUrl,
    this.notes,
    this.lastOrderAt,
  });

  final int id;
  final String customerJid;
  final String? customerName;
  final String? customerPhone;
  final String? avatarUrl;
  final int balanceCents;
  final String? notes;
  final bool blocked;
  final int ordersCount;
  final int paidOrdersCount;
  final int totalSpentCents;
  final DateTime? lastOrderAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  double get balance => balanceCents / 100;
  double get totalSpent => totalSpentCents / 100;
  String get displayName => customerName?.trim().isNotEmpty == true
      ? customerName!.trim()
      : customerPhone?.trim().isNotEmpty == true
      ? customerPhone!.trim()
      : customerJid;

  factory BotStoreCustomer.fromJson(Map<String, dynamic> json) {
    return BotStoreCustomer(
      id: _int(json['id']),
      customerJid: _nullable(json['customerJid'] ?? json['customer_jid']) ?? '',
      customerName: _nullable(json['customerName'] ?? json['customer_name']),
      customerPhone: _nullable(json['customerPhone'] ?? json['customer_phone']),
      avatarUrl: _nullable(json['avatarUrl'] ?? json['avatar_url']),
      balanceCents: _int(json['balanceCents'] ?? json['balance_cents']),
      notes: _nullable(json['notes']),
      blocked: _bool(json['blocked']),
      ordersCount: _int(json['ordersCount'] ?? json['orders_count']),
      paidOrdersCount: _int(
        json['paidOrdersCount'] ?? json['paid_orders_count'],
      ),
      totalSpentCents: _int(
        json['totalSpentCents'] ?? json['total_spent_cents'],
      ),
      lastOrderAt: _nullableDate([json['lastOrderAt'], json['last_order_at']]),
      createdAt: _date(json['createdAt'] ?? json['created_at']),
      updatedAt: _date(json['updatedAt'] ?? json['updated_at']),
    );
  }
}

List<Map<String, dynamic>> _list(Object? value) {
  if (value is List) {
    return value
        .whereType<Object>()
        .map(_map)
        .where((entry) => entry.isNotEmpty)
        .toList();
  }
  return const [];
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return const {};
}

String _campaignTypeLabel(Map<String, dynamic> item) {
  return (item['type'] ??
          item['kind'] ??
          item['contentType'] ??
          item['content_type'] ??
          item['targetType'] ??
          item['target_type'] ??
          '')
      .toString()
      .trim()
      .toLowerCase();
}

bool _isStatusType(String value) {
  final normalized = value.toLowerCase();
  return normalized == 'status' ||
      normalized == 'whatsapp_status' ||
      normalized == 'story' ||
      normalized == 'stories';
}

String? _firstText(List<Object?> values) {
  for (final value in values) {
    final text = value?.toString().trim() ?? '';
    if (text.isNotEmpty) return text;
  }
  return null;
}

String? _safeStatusDisplayText(String? value, {String? mediaUrl}) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) return null;
  final normalizedMedia = mediaUrl?.trim() ?? '';
  if (normalizedMedia.isNotEmpty && text == normalizedMedia) return null;
  final lowered = text.toLowerCase();
  if (lowered.startsWith('/api/bot-instance') ||
      lowered.startsWith('blob:') ||
      RegExp(r'^https?://[^\s]+/api/bot-instance').hasMatch(lowered)) {
    return null;
  }
  return text;
}

bool? _optionalBool(Object? value) {
  if (value == null) return null;
  if (value is bool) return value;
  if (value is num) return value != 0;
  final text = value.toString().trim().toLowerCase();
  if (text == 'true' || text == '1' || text == 'on' || text == 'sim') {
    return true;
  }
  if (text == 'false' || text == '0' || text == 'off' || text == 'nao') {
    return false;
  }
  return null;
}

String? _nullable(Object? value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

bool _bool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final text = value?.toString().trim().toLowerCase() ?? '';
  return text == 'true' || text == '1' || text == 'on' || text == 'sim';
}

bool _isFalseValue(Object? value) {
  if (value is bool) return !value;
  if (value is num) return value == 0;
  final text = value?.toString().trim().toLowerCase() ?? '';
  return text == 'false' || text == '0' || text == 'off' || text == 'nao';
}

int _int(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

int? _intOrNull(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  final text = value.toString().trim();
  if (text.isEmpty || text.toLowerCase() == 'null') return null;
  return int.tryParse(text);
}

double _double(Object? value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

DateTime _date(Object? value) {
  if (value is num) {
    final raw = value.toInt();
    return DateTime.fromMillisecondsSinceEpoch(
      raw < 10000000000 ? raw * 1000 : raw,
    );
  }
  return DateTime.tryParse(value?.toString() ?? '') ??
      DateTime.fromMillisecondsSinceEpoch(0);
}

DateTime? _nullableDate(List<Object?> values) {
  for (final value in values) {
    if (value == null) continue;
    final date = _date(value);
    if (date.millisecondsSinceEpoch > 0) return date;
  }
  return null;
}
