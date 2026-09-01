class SweepstakeParticipant {
  const SweepstakeParticipant({
    required this.jid,
    this.displayName,
    this.joinedAt,
  });

  final String jid;
  final String? displayName;
  final DateTime? joinedAt;

  factory SweepstakeParticipant.fromJson(Map<String, dynamic> json) =>
      SweepstakeParticipant(
        jid: '${json['jid'] ?? json['userId'] ?? ''}',
        displayName: json['displayName']?.toString(),
        joinedAt: DateTime.tryParse('${json['joinedAt'] ?? ''}'),
      );
}

class SweepstakeSummary {
  const SweepstakeSummary({
    required this.id,
    required this.question,
    required this.status,
    required this.winnersCount,
    required this.participants,
    this.maxParticipants,
    this.expiresAt,
    this.winners = const [],
    this.pollMessageId,
  });

  final int id;
  final String question;
  final String status;
  final int winnersCount;
  final int? maxParticipants;
  final DateTime? expiresAt;
  final List<SweepstakeParticipant> participants;
  final List<SweepstakeParticipant> winners;
  final String? pollMessageId;

  bool get isActive => status == 'active';

  factory SweepstakeSummary.fromJson(Map<String, dynamic> json) {
    List<SweepstakeParticipant> people(Object? value) => value is List
        ? value
              .whereType<Map>()
              .map(
                (item) => SweepstakeParticipant.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
        : const [];
    return SweepstakeSummary(
      id: int.tryParse('${json['id'] ?? 0}') ?? 0,
      question: '${json['question'] ?? json['title'] ?? 'Sorteio'}',
      status: '${json['status'] ?? 'active'}',
      winnersCount:
          int.tryParse(
            '${json['winnersCount'] ?? json['winners_count'] ?? 1}',
          ) ??
          1,
      maxParticipants: int.tryParse(
        '${json['maxParticipants'] ?? json['max_participants'] ?? ''}',
      ),
      expiresAt: DateTime.tryParse(
        '${json['expiresAt'] ?? json['expires_at'] ?? ''}',
      ),
      participants: people(json['participants']),
      winners: people(json['winners']),
      pollMessageId: json['pollMessageId']?.toString(),
    );
  }
}

class SweepstakeGroupSnapshot {
  const SweepstakeGroupSnapshot({
    required this.active,
    required this.history,
    this.requiresSync = false,
  });

  final List<SweepstakeSummary> active;
  final List<SweepstakeSummary> history;
  final bool requiresSync;

  factory SweepstakeGroupSnapshot.fromJson(Map<String, dynamic> json) =>
      SweepstakeGroupSnapshot(
        active: _sweepstakeList(json['active']),
        history: _sweepstakeList(json['history']),
        requiresSync: json['requiresSync'] == true,
      );
}

List<SweepstakeSummary> _sweepstakeList(Object? value) => value is List
    ? value
          .whereType<Map>()
          .map(
            (item) =>
                SweepstakeSummary.fromJson(Map<String, dynamic>.from(item)),
          )
          .toList(growable: false)
    : const [];
