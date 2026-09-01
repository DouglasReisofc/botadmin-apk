class BotServer {
  const BotServer({
    required this.id,
    required this.name,
    this.sessionLimit = 0,
  });

  final int id;
  final String name;
  final int sessionLimit;

  factory BotServer.fromJson(Map<String, dynamic> json) {
    return BotServer(
      id: _asInt(json['id']),
      name: (json['name'] ?? 'Servidor').toString(),
      sessionLimit: _asInt(json['sessionLimit'] ?? json['session_limit']),
    );
  }
}

class BotInstance {
  const BotInstance({
    required this.id,
    required this.name,
    required this.sessionStatus,
    this.phoneNumber,
    this.serverId,
    this.serverName,
    this.purpose,
    this.expiresAt,
    this.planId,
    this.profileId,
    this.avatarUrl,
  });

  final int id;
  final String name;
  final String sessionStatus;
  final String? phoneNumber;
  final int? serverId;
  final String? serverName;
  final String? purpose;
  final DateTime? expiresAt;
  final int? planId;
  final int? profileId;
  final String? avatarUrl;

  bool get isConnected {
    final s = sessionStatus.toLowerCase();
    return s.contains('conect') && !s.contains('desconect');
  }

  bool get isAwaitingPair {
    final s = sessionStatus.toLowerCase();
    return s.contains('qr') ||
        s.contains('pareamento') ||
        s.contains('pairing') ||
        s.contains('inicializ');
  }

  bool get isDisconnected => !isConnected && !isAwaitingPair;

  String get statusLabel {
    final s = sessionStatus.trim();
    if (s.isEmpty) return 'Desconhecido';
    // Backend already returns PT labels often; normalize common codes.
    switch (s.toLowerCase()) {
      case 'conectado':
        return 'Conectado';
      case 'desconectado':
        return 'Desconectado';
      case 'aguardando_qr':
        return 'Aguardando QR';
      case 'aguardando_pareamento':
        return 'Aguardando pareamento';
      case 'inicializando':
        return 'Inicializando';
      default:
        return s;
    }
  }

  factory BotInstance.fromJson(Map<String, dynamic> json) {
    return BotInstance(
      id: _asInt(json['id']),
      name:
          (json['name'] ?? json['displayName'] ?? 'Perfil ${json['id'] ?? ''}')
              .toString(),
      sessionStatus: (json['sessionStatus'] ?? json['status'] ?? '').toString(),
      phoneNumber: (json['phone'] ?? json['phoneNumber'] ?? json['number'])
          ?.toString(),
      serverId: _asIntOrNull(json['serverId'] ?? json['server_id']),
      serverName: (json['serverName'] ?? json['server_name'])?.toString(),
      purpose: (json['purpose'])?.toString(),
      expiresAt: _asDate(json['expiresAt'] ?? json['expires_at']),
      planId: _asIntOrNull(json['planId'] ?? json['plan_id']),
      profileId: _asIntOrNull(json['profileId'] ?? json['profile_id']),
      avatarUrl:
          (json['avatarUrl'] ??
                  json['avatar_url'] ??
                  json['profilePicUrl'] ??
                  json['pictureUrl'])
              ?.toString(),
    );
  }

  BotInstance copyWith({
    String? name,
    String? sessionStatus,
    String? phoneNumber,
  }) {
    return BotInstance(
      id: id,
      name: name ?? this.name,
      sessionStatus: sessionStatus ?? this.sessionStatus,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      serverId: serverId,
      serverName: serverName,
      purpose: purpose,
      expiresAt: expiresAt,
      planId: planId,
      profileId: profileId,
      avatarUrl: avatarUrl,
    );
  }
}

class CreateInstanceResult {
  const CreateInstanceResult({
    required this.instance,
    required this.requiresProfilePayment,
    this.message,
  });

  final BotInstance instance;
  final bool requiresProfilePayment;
  final String? message;

  factory CreateInstanceResult.fromJson(Map<String, dynamic> json) {
    final raw = json['instance'];
    if (raw is! Map) {
      throw const FormatException('Perfil criado sem dados de retorno.');
    }
    return CreateInstanceResult(
      instance: BotInstance.fromJson(Map<String, dynamic>.from(raw)),
      requiresProfilePayment:
          json['requiresProfilePayment'] == true ||
          json['requires_profile_payment'] == true ||
          json['requiresInstanceAddonPayment'] == true ||
          json['requires_instance_addon_payment'] == true,
      message: json['message']?.toString(),
    );
  }
}

class BotInstanceProfile {
  const BotInstanceProfile({
    required this.displayName,
    required this.sessionStatus,
    this.pushName,
    this.statusText,
    this.jid,
    this.avatarUrl,
  });

  final String displayName;
  final String sessionStatus;
  final String? pushName;
  final String? statusText;
  final String? jid;
  final String? avatarUrl;

  factory BotInstanceProfile.fromJson(Map<String, dynamic> json) {
    return BotInstanceProfile(
      displayName: (json['displayName'] ?? json['display_name'] ?? '')
          .toString(),
      sessionStatus: (json['sessionStatus'] ?? json['session_status'] ?? '')
          .toString(),
      pushName: json['pushName']?.toString(),
      statusText: json['statusText']?.toString(),
      jid: json['jid']?.toString(),
      avatarUrl:
          (json['avatarUrl'] ??
                  json['avatar_url'] ??
                  json['profilePicUrl'] ??
                  json['pictureUrl'])
              ?.toString(),
    );
  }
}

class PairingPayload {
  const PairingPayload({
    this.qrCode,
    this.linkingCode,
    this.alreadyConnected = false,
    this.message,
  });

  final String? qrCode;
  final String? linkingCode;
  final bool alreadyConnected;
  final String? message;

  factory PairingPayload.fromJson(Map<String, dynamic> json) {
    final data = json['data'] is Map
        ? Map<String, dynamic>.from(json['data'] as Map)
        : json;
    return PairingPayload(
      qrCode: (data['qrCode'] ?? data['qr_code'])?.toString(),
      linkingCode: (data['linkingCode'] ?? data['linking_code'] ?? data['code'])
          ?.toString(),
      alreadyConnected:
          data['alreadyConnected'] == true || data['already_connected'] == true,
      message: json['message']?.toString(),
    );
  }
}

class InstanceProxyConfig {
  const InstanceProxyConfig({
    required this.enabled,
    required this.protocol,
    this.host,
    this.port,
    this.hasUsername = false,
    this.hasPassword = false,
    this.source = 'customer',
    this.resolvedIp,
    this.countryCode,
    this.countryName,
    this.regionName,
    this.cityName,
    this.timezoneName,
    this.ispName,
    this.latencyMs,
    this.checkedAt,
    this.appliedAt,
    this.lastError,
  });

  final bool enabled;
  final String protocol;
  final String? host;
  final int? port;
  final bool hasUsername;
  final bool hasPassword;
  final String source;
  final String? resolvedIp;
  final String? countryCode;
  final String? countryName;
  final String? regionName;
  final String? cityName;
  final String? timezoneName;
  final String? ispName;
  final int? latencyMs;
  final DateTime? checkedAt;
  final DateTime? appliedAt;
  final String? lastError;

  factory InstanceProxyConfig.fromJson(Map<String, dynamic> json) => InstanceProxyConfig(
    enabled: json['enabled'] == true,
    protocol: (json['protocol'] ?? 'socks5').toString(),
    host: json['host']?.toString(),
    port: _asIntOrNull(json['port']),
    hasUsername: json['hasUsername'] == true || json['has_username'] == true,
    hasPassword: json['hasPassword'] == true || json['has_password'] == true,
    source: (json['source'] ?? 'customer').toString(),
    resolvedIp: json['resolvedIp']?.toString() ?? json['resolved_ip']?.toString(),
    countryCode: json['countryCode']?.toString() ?? json['country_code']?.toString(),
    countryName: json['countryName']?.toString() ?? json['country_name']?.toString(),
    regionName: json['regionName']?.toString() ?? json['region_name']?.toString(),
    cityName: json['cityName']?.toString() ?? json['city_name']?.toString(),
    timezoneName: json['timezoneName']?.toString() ?? json['timezone_name']?.toString(),
    ispName: json['ispName']?.toString() ?? json['isp_name']?.toString(),
    latencyMs: _asIntOrNull(json['latencyMs'] ?? json['latency_ms']),
    checkedAt: _asDate(json['checkedAt'] ?? json['checked_at']),
    appliedAt: _asDate(json['appliedAt'] ?? json['applied_at']),
    lastError: json['lastError']?.toString() ?? json['last_error']?.toString(),
  );
}

class InstanceProxyPolicy {
  const InstanceProxyPolicy({
    this.mode = 'manual',
    this.monthlyPrice = 0,
    this.allowCustomerProxy = true,
    this.instructions,
    this.sellerName,
  });

  final String mode;
  final double monthlyPrice;
  final bool allowCustomerProxy;
  final String? instructions;
  final String? sellerName;

  factory InstanceProxyPolicy.fromJson(Map<String, dynamic> json) => InstanceProxyPolicy(
    mode: (json['mode'] ?? 'manual').toString(),
    monthlyPrice: double.tryParse((json['monthlyPrice'] ?? json['monthly_price'] ?? 0).toString()) ?? 0,
    allowCustomerProxy: json['allowCustomerProxy'] != false && json['allow_customer_proxy'] != false,
    instructions: json['instructions']?.toString(),
    sellerName: json['sellerName']?.toString(),
  );
}

class InstanceProxyBundle {
  const InstanceProxyBundle({required this.proxy, required this.policy, this.connected = false});
  final InstanceProxyConfig proxy;
  final InstanceProxyPolicy policy;
  final bool connected;

  factory InstanceProxyBundle.fromJson(Map<String, dynamic> json) {
    final rawProxy = json['proxy'] is Map ? Map<String, dynamic>.from(json['proxy'] as Map) : <String, dynamic>{};
    final rawPolicy = json['policy'] is Map ? Map<String, dynamic>.from(json['policy'] as Map) : <String, dynamic>{};
    return InstanceProxyBundle(
      proxy: InstanceProxyConfig.fromJson(rawProxy),
      policy: InstanceProxyPolicy.fromJson(rawPolicy),
      connected: json['connected'] == true,
    );
  }
}

int _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

int? _asIntOrNull(Object? value) {
  if (value == null) return null;
  final n = _asInt(value);
  return n == 0 && value.toString().trim() != '0' ? null : n;
}

DateTime? _asDate(Object? value) {
  if (value == null) return null;
  if (value is DateTime) return value;
  return DateTime.tryParse(value.toString());
}
