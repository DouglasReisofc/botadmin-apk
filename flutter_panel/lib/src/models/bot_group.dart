class BotGroup {
  const BotGroup({
    required this.id,
    required this.name,
    required this.remoteJid,
    required this.botEnabled,
    this.instanceId,
    this.inviteLink,
    this.description,
    this.avatarUrl,
  });

  final int id;
  final String name;
  final String remoteJid;
  final bool botEnabled;
  final int? instanceId;
  final String? inviteLink;
  final String? description;
  final String? avatarUrl;

  bool get isInternalGroup => remoteJid.startsWith('botadmin-internal:');
  int? get internalGroupId => isInternalGroup
      ? int.tryParse(remoteJid.substring('botadmin-internal:'.length))
      : null;

  factory BotGroup.fromJson(Map<String, dynamic> json) {
    return BotGroup(
      id: _asInt(json['id']),
      name: (json['name'] ?? json['groupName'] ?? 'Grupo').toString(),
      remoteJid:
          (json['remoteJid'] ??
                  json['remoteId'] ??
                  json['remote_id'] ??
                  json['groupRemoteJid'] ??
                  json['jid'] ??
                  '')
              .toString(),
      botEnabled: _asBool(
        json['botEnabled'] ??
            json['bot_enabled'] ??
            json['active'] ??
            json['isActive'] ??
            json['is_active'] ??
            json['status'],
      ),
      instanceId: _asIntOrNull(json['instanceId'] ?? json['instance_id']),
      inviteLink: _nullableString(json['inviteLink'] ?? json['invite_link']),
      description: _nullableString(json['description']),
      avatarUrl:
          (json['imageUrl'] ??
                  json['avatarUrl'] ??
                  json['pictureUrl'] ??
                  json['profilePicUrl'])
              ?.toString(),
    );
  }
}

int? _asIntOrNull(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '');
}

String? _nullableString(Object? value) {
  final normalized = value?.toString().trim() ?? '';
  return normalized.isEmpty ? null : normalized;
}

int _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

bool _asBool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final normalized = value?.toString().trim().toLowerCase();
  return normalized == 'true' ||
      normalized == '1' ||
      normalized == 'yes' ||
      normalized == 'sim' ||
      normalized == 'on' ||
      normalized == 'active' ||
      normalized == 'ativo';
}
