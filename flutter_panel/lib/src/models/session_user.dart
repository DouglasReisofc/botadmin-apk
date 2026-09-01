class AuthSession {
  const AuthSession({required this.user});

  final SessionUser user;
}

class SessionUser {
  const SessionUser({
    required this.id,
    required this.name,
    required this.role,
    this.email,
    this.whatsappNumber,
    this.avatarUrl,
    this.partnerRole,
    this.impersonatorUserId,
    this.canReturnToAdmin = false,
  });

  final int id;
  final String name;
  final String role;
  final String? email;
  final String? whatsappNumber;
  final String? avatarUrl;

  /// Papel no painel de parceiros (master, reseller, support). Mantemos o
  /// campo separado do role de autenticação para que o mesmo shell Flutter
  /// possa ser usado no painel do usuário e no painel de parceiros.
  final String? partnerRole;
  final int? impersonatorUserId;
  final bool canReturnToAdmin;

  bool get isAdmin => role == 'admin';

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'role': role,
    if (email != null) 'email': email,
    if (whatsappNumber != null) 'whatsappNumber': whatsappNumber,
    if (avatarUrl != null) 'avatarUrl': avatarUrl,
    if (partnerRole != null) 'partnerRole': partnerRole,
    if (impersonatorUserId != null) 'impersonatorUserId': impersonatorUserId,
    'canReturnToAdmin': canReturnToAdmin,
  };

  factory SessionUser.fromJson(Map<String, dynamic> json) {
    return SessionUser(
      id: _asInt(json['id']),
      name: json['name']?.toString() ?? '',
      role: json['role']?.toString() ?? 'user',
      email: json['email']?.toString(),
      whatsappNumber: json['whatsappNumber']?.toString(),
      avatarUrl: json['avatarUrl']?.toString(),
      partnerRole: json['partnerRole']?.toString(),
      impersonatorUserId: _asIntOrNull(json['impersonatorUserId']),
      canReturnToAdmin: _asBool(json['canReturnToAdmin']),
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
  if (value is int) return value;
  if (value is num) return value.toInt();
  final text = value.toString().trim();
  if (text.isEmpty || text.toLowerCase() == 'null') return null;
  return int.tryParse(text);
}

bool _asBool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final text = value?.toString().trim().toLowerCase() ?? '';
  return text == 'true' || text == '1' || text == 'sim' || text == 'on';
}
