import '../../models/admin_support.dart';
import '../../models/conversation_thread.dart';

/// A channel keeps its original identity and sender even when its contact is
/// displayed in the same inbox row as another channel.
class AdminInboxChannel {
  const AdminInboxChannel.support(AdminSupportThreadEntry entry)
    : support = entry,
      whatsapp = null,
      label = 'Suporte';

  const AdminInboxChannel.whatsapp(ConversationThread thread, this.label)
    : whatsapp = thread,
      support = null;

  final AdminSupportThreadEntry? support;
  final ConversationThread? whatsapp;
  final String label;

  String get key => support != null
      ? 'support:${support!.key}'
      : 'whatsapp:${whatsapp!.instanceId}:${whatsapp!.chatJid}';

  DateTime get lastActivity =>
      whatsapp?.lastActivity ??
      DateTime.tryParse(support!.thread.lastMessageAt ?? '') ??
      DateTime.fromMillisecondsSinceEpoch(0);

  String get contactKey {
    if (whatsapp != null) return _contactKey(whatsapp!.chatJid);
    final entry = support!;
    final jid = entry.thread.whatsappId.trim();
    if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
      return _contactKey(jid);
    }
    if (RegExp(r'^\+?\d{8,15}$').hasMatch(jid)) {
      return 'phone:${jid.replaceAll(RegExp(r'\D'), '')}';
    }
    // The internal support thread has no WhatsApp JID. Match only a phone
    // explicitly attached to this user, never names or partial phone numbers.
    if (entry.thread.isAdminThread || jid == '__admin__') {
      final phone = (entry.user.whatsappNumber ?? '').replaceAll(
        RegExp(r'\D'),
        '',
      );
      if (phone.length >= 8) return 'phone:$phone';
    }
    return 'support:${entry.key}';
  }

  static String _contactKey(String jid) {
    final value = jid.trim().toLowerCase();
    if (value.endsWith('@s.whatsapp.net') || value.endsWith('@c.us')) {
      return 'phone:${value.split('@').first.split(':').first}';
    }
    return 'jid:$value';
  }
}

class AdminInboxConversation {
  AdminInboxConversation(this.key, List<AdminInboxChannel> channels)
    : channels = List.unmodifiable(
        channels..sort((a, b) => b.lastActivity.compareTo(a.lastActivity)),
      );

  final String key;
  final List<AdminInboxChannel> channels;
  AdminInboxChannel get latest => channels.first;
  DateTime get lastActivity => latest.lastActivity;
  bool get pinned =>
      channels.any((channel) => channel.whatsapp?.pinned == true);
  bool get hasSupport => channels.any((channel) => channel.support != null);
  int get unreadCount {
    // Meta and Bot can mirror the same unread WhatsApp message. Keep the
    // largest WhatsApp count and add independent support threads once each.
    var whatsappCount = 0;
    var supportCount = 0;
    for (final channel in channels) {
      if (channel.support != null) {
        supportCount += channel.support!.thread.unreadCount;
      } else if (channel.whatsapp!.unreadCount > whatsappCount) {
        whatsappCount = channel.whatsapp!.unreadCount;
      }
    }
    return whatsappCount + supportCount;
  }

  String get labels =>
      channels.map((channel) => channel.label).toSet().join(' · ');

  bool matches({
    required String query,
    required String filter,
    String? source,
  }) {
    final scoped = source == null
        ? channels
        : channels
              .where(
                (channel) => channel.support != null
                    ? source == 'support'
                    : source == 'instance:${channel.whatsapp!.instanceId}',
              )
              .toList();
    if (scoped.isEmpty) return false;
    final support = scoped
        .where((channel) => channel.support != null)
        .map((channel) => channel.support!);
    final whatsapp = scoped
        .where((channel) => channel.whatsapp != null)
        .map((channel) => channel.whatsapp!);
    final matchesFilter = switch (filter) {
      'unread' => scoped.any(
        (channel) =>
            (channel.support?.thread.unreadCount ??
                channel.whatsapp?.unreadCount ??
                0) >
            0,
      ),
      'groups' => whatsapp.any((thread) => thread.isGroup),
      'private' =>
        support.isNotEmpty || whatsapp.any((thread) => thread.isContact),
      'pinned' => whatsapp.any((thread) => thread.pinned),
      'archived' => whatsapp.any((thread) => thread.archived),
      'subscription_active' => support.any(
        (entry) => entry.user.hasActiveSubscription,
      ),
      'subscription_inactive' => support.any(
        (entry) => !entry.user.hasActiveSubscription,
      ),
      'account_active' => support.any((entry) => entry.user.isActive),
      'account_blocked' => support.any((entry) => !entry.user.isActive),
      'open' => support.any((entry) => entry.thread.isOpen),
      'closed' => support.any((entry) => !entry.thread.isOpen),
      'human' => support.any((entry) => entry.thread.isHuman),
      'bot' => support.any((entry) => !entry.thread.isHuman),
      _ => true,
    };
    if (!matchesFilter) return false;
    final normalized = query.trim().toLowerCase();
    if (normalized.isEmpty) return true;
    return scoped.any((channel) {
      final entry = channel.support;
      final thread = channel.whatsapp;
      final fields = entry == null
          ? [thread!.title, thread.phone, thread.chatJid, thread.lastMessage]
          : [
              entry.displayName,
              entry.user.name,
              entry.user.email,
              entry.user.whatsappNumber,
              entry.thread.displayWhatsappId,
              entry.thread.whatsappId,
              entry.thread.customerName,
              entry.thread.profileName,
              entry.subtitle,
            ];
      return fields.whereType<String>().any(
        (field) => field.toLowerCase().contains(normalized),
      );
    });
  }
}

List<AdminInboxConversation> buildAdminConversationInbox(
  Iterable<AdminInboxChannel> channels,
) {
  final grouped = <String, Map<String, AdminInboxChannel>>{};
  for (final channel in channels) {
    if (channel.whatsapp?.isSafeConversationListItem == false) continue;
    grouped.putIfAbsent(channel.contactKey, () => {})[channel.key] = channel;
  }
  return grouped.entries
      .map(
        (entry) =>
            AdminInboxConversation(entry.key, entry.value.values.toList()),
      )
      .toList()
    ..sort(
      (a, b) => a.pinned != b.pinned
          ? (a.pinned ? -1 : 1)
          : b.lastActivity.compareTo(a.lastActivity),
    );
}
