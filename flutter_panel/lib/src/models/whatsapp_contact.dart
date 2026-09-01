class WhatsAppContact {
  const WhatsAppContact({
    required this.jid,
    required this.phone,
    required this.name,
    this.shortName,
    this.pushName,
    this.avatarUrl,
  });

  final String jid;
  final String phone;
  final String name;
  final String? shortName;
  final String? pushName;
  final String? avatarUrl;

  String get displayName {
    final candidates = [name, shortName, pushName, formattedPhone];
    for (final candidate in candidates) {
      final value = candidate?.trim();
      if (value != null && value.isNotEmpty) return value;
    }
    return 'Contato';
  }

  String get formattedPhone {
    final digits = phone.replaceAll(RegExp(r'\D+'), '');
    if (digits.isEmpty) return phone;
    return '+$digits';
  }

  factory WhatsAppContact.fromJson(Map<String, dynamic> json) {
    final jid = (json['jid'] ?? json['JID'] ?? json['id'] ?? '').toString();
    final phone = (json['phone'] ?? json['Phone'] ?? '').toString();
    return WhatsAppContact(
      jid: jid.trim(),
      phone: phone.trim().isEmpty ? _phoneFromJid(jid) : phone.trim(),
      name: (json['name'] ?? json['Name'] ?? '').toString(),
      shortName: _nullable(json['shortName'] ?? json['ShortName']),
      pushName: _nullable(json['pushName'] ?? json['PushName']),
      avatarUrl: _nullable(
        json['avatarUrl'] ?? json['profilePicUrl'] ?? json['pictureUrl'],
      ),
    );
  }
}

String _phoneFromJid(String value) {
  return value.split('@').first.replaceAll(RegExp(r'\D+'), '');
}

String? _nullable(Object? value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}
