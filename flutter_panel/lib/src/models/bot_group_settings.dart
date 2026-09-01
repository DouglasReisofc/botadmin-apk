class BotGroupSettingsBundle {
  const BotGroupSettingsBundle({
    required this.settings,
    required this.nativeButtonsEnabled,
    required this.menuPreview,
  });

  final BotGroupSettings settings;
  final bool nativeButtonsEnabled;
  final GroupMenuCarouselConfig menuPreview;

  factory BotGroupSettingsBundle.fromJson(Map<String, dynamic> json) {
    final settingsJson = json['settings'];
    final metaJson = json['meta'];
    final settings = BotGroupSettings.fromJson(
      settingsJson is Map<String, dynamic> ? settingsJson : const {},
    );
    return BotGroupSettingsBundle(
      settings: settings,
      nativeButtonsEnabled:
          metaJson is Map && _asBool(metaJson['nativeButtonsEnabled']),
      menuPreview: GroupMenuCarouselConfig.fromJson(
        metaJson is Map
            ? _map(metaJson['menuPreview'] ?? metaJson['menu_preview'])
            : const {},
        fallback: settings.menuCarousel,
      ),
    );
  }
}

class BotGroupSettings {
  const BotGroupSettings({
    required this.commandToggles,
    required this.featureFlags,
    required this.welcomeConfig,
    required this.farewellConfig,
    required this.scheduleConfig,
    required this.horapgConfig,
    required this.allowedLinks,
    required this.moderationActions,
    required this.bannedWords,
    required this.blacklist,
    required this.aiProvider,
    required this.groqKeys,
    required this.openAiApiKey,
    required this.aiPrompt,
    required this.aiModel,
    required this.autoResponses,
    required this.ads,
    required this.commandPrefixes,
    required this.allowCommandsWithoutPrefix,
    required this.menuCarousel,
    required this.antipalavrasMaxInfractions,
    required this.maxInfractions,
    required this.updatedAt,
  });

  final Map<String, bool> commandToggles;
  final Map<String, bool> featureFlags;
  final GroupMessageConfig welcomeConfig;
  final GroupMessageConfig farewellConfig;
  final GroupScheduleConfig scheduleConfig;
  final GroupHorapgConfig horapgConfig;
  final List<String> allowedLinks;
  final Map<String, ModerationActionConfig> moderationActions;
  final List<String> bannedWords;
  final List<String> blacklist;
  final String aiProvider;
  final List<String> groqKeys;
  final String? openAiApiKey;
  final String aiPrompt;
  final String? aiModel;
  final List<GroupAutoResponseConfig> autoResponses;
  final List<GroupScheduledAdConfig> ads;
  final List<String> commandPrefixes;
  final bool allowCommandsWithoutPrefix;
  final GroupMenuCarouselConfig menuCarousel;
  final int antipalavrasMaxInfractions;
  final int maxInfractions;
  final String updatedAt;

  bool isEnabled(String key) => commandToggles[key] ?? false;

  ModerationActionConfig moderationActionFor(String key) =>
      moderationActions[key] ?? ModerationActionConfig.defaultFor(key);

  factory BotGroupSettings.fromJson(Map<String, dynamic> json) {
    return BotGroupSettings(
      commandToggles: _boolMap(
        json['commandToggles'] ?? json['command_toggles'],
      ),
      featureFlags: _boolMap(json['featureFlags'] ?? json['feature_flags']),
      welcomeConfig: GroupMessageConfig.fromJson(
        _map(json['welcomeConfig'] ?? json['welcome_config']),
      ),
      farewellConfig: GroupMessageConfig.fromJson(
        _map(json['farewellConfig'] ?? json['farewell_config']),
      ),
      scheduleConfig: GroupScheduleConfig.fromJson(
        _map(json['scheduleConfig'] ?? json['schedule_config']),
      ),
      horapgConfig: GroupHorapgConfig.fromJson(
        _map(json['horapgConfig'] ?? json['horapg_config']),
      ),
      allowedLinks: _stringList(json['allowedLinks'] ?? json['allowed_links']),
      moderationActions: _moderationActionsMap(
        json['moderationActions'] ?? json['moderation_actions'],
      ),
      bannedWords: _stringList(json['bannedWords'] ?? json['banned_words']),
      blacklist: _stringList(
        json['blacklist'] ??
            json['blacklistMembers'] ??
            json['blacklist_members'],
      ),
      aiProvider: (json['aiProvider'] ?? json['ai_provider'] ?? 'groq')
          .toString(),
      groqKeys: _stringList(json['groqKeys'] ?? json['groq_keys']),
      openAiApiKey: (json['openAiApiKey'] ?? json['openai_api_key'])
          ?.toString(),
      aiPrompt: (json['aiPrompt'] ?? json['ai_prompt'] ?? '').toString(),
      aiModel: (json['aiModel'] ?? json['ai_model'])?.toString(),
      autoResponses: _list(json['autoResponses'] ?? json['auto_responses'])
          .map((entry) => GroupAutoResponseConfig.fromJson(_map(entry)))
          .toList(),
      ads: _list(json['ads'] ?? json['adsConfig'] ?? json['ads_config'])
          .map((entry) => GroupScheduledAdConfig.fromJson(_map(entry)))
          .toList(),
      commandPrefixes: _stringList(
        json['commandPrefixes'] ?? json['command_prefixes'],
      ),
      allowCommandsWithoutPrefix: _asBool(
        json['allowCommandsWithoutPrefix'] ??
            json['allow_commands_without_prefix'],
      ),
      menuCarousel: GroupMenuCarouselConfig.fromJson(
        _map(json['menuCarousel'] ?? json['menu_carousel']),
      ),
      antipalavrasMaxInfractions: _asInt(
        json['antipalavrasMaxInfractions'] ??
            json['antipalavras_max_infractions'],
        fallback: 5,
      ),
      maxInfractions: _asInt(
        json['maxInfractions'] ?? json['max_infractions'],
        fallback: 5,
      ),
      updatedAt: (json['updatedAt'] ?? json['updated_at'] ?? '').toString(),
    );
  }
}

class GroupMenuCarouselConfig {
  const GroupMenuCarouselConfig({required this.cards});

  final List<GroupMenuCardConfig> cards;

  factory GroupMenuCarouselConfig.fromJson(
    Map<String, dynamic> json, {
    GroupMenuCarouselConfig? fallback,
  }) {
    final parsed = _list(json['cards'])
        .map((entry) => GroupMenuCardConfig.fromJson(_map(entry)))
        .where((card) => GroupMenuCardConfig.kinds.contains(card.kind))
        .toList();
    final byKind = {for (final card in parsed) card.kind: card};
    final fallbackByKind = {
      for (final card in fallback?.cards ?? const <GroupMenuCardConfig>[])
        card.kind: card,
    };
    return GroupMenuCarouselConfig(
      cards: GroupMenuCardConfig.kinds
          .map(
            (kind) =>
                byKind[kind] ??
                fallbackByKind[kind] ??
                GroupMenuCardConfig.defaults(kind),
          )
          .toList(),
    );
  }

  Map<String, Object?> toJson() => {
    'cards': cards.map((card) => card.toJson()).toList(),
  };
}

class GroupMenuCardConfig {
  const GroupMenuCardConfig({
    required this.id,
    required this.kind,
    required this.title,
    required this.description,
    required this.footerText,
    required this.listButtonText,
    required this.imageUrl,
    required this.imagePath,
    required this.sections,
    required this.buttons,
    this.effectiveImageRef,
  });

  static const kinds = ['main', 'admin', 'downloads', 'fun'];

  final String id;
  final String kind;
  final String? title;
  final String? description;
  final String? footerText;
  final String? listButtonText;
  final String? imageUrl;
  final String? imagePath;
  final List<GroupMenuListSectionConfig>? sections;
  final List<GroupMenuButtonConfig>? buttons;
  final String? effectiveImageRef;

  String get label => switch (kind) {
    'admin' => 'Admin',
    'downloads' => 'Downloads',
    'fun' => 'Diversão',
    _ => 'Geral',
  };

  String get previewTitle =>
      title ??
      switch (kind) {
        'admin' => 'BotAdmin · Admin',
        'downloads' => 'BotAdmin · Downloads',
        'fun' => 'BotAdmin · Diversão',
        _ => 'BotAdmin · Geral',
      };

  String get previewDescription =>
      description ??
      switch (kind) {
        'admin' => 'Moderação, proteções e configurações do grupo.',
        'downloads' => 'Vídeos, músicas, figurinhas e ferramentas.',
        'fun' => 'Jogos, ranking, frases e criação.',
        _ => 'Plano, grupo e comandos principais.',
      };

  String get previewFooter => footerText ?? 'BotAdmin · $label';

  String get previewListButton =>
      listButtonText ??
      switch (kind) {
        'admin' => 'Admin',
        'downloads' => 'Downloads',
        'fun' => 'Ver opções',
        _ => 'Geral',
      };

  String? get displayMediaRef => imageUrl ?? imagePath ?? effectiveImageRef;

  factory GroupMenuCardConfig.defaults(String kind) {
    return GroupMenuCardConfig(
      id: kind,
      kind: kind,
      title: null,
      description: null,
      footerText: null,
      listButtonText: null,
      imageUrl: null,
      imagePath: null,
      sections: null,
      buttons: null,
    );
  }

  factory GroupMenuCardConfig.fromJson(Map<String, dynamic> json) {
    final kind = (json['kind'] ?? json['id'] ?? 'main')
        .toString()
        .trim()
        .toLowerCase();
    return GroupMenuCardConfig(
      id: (json['id'] ?? kind).toString(),
      kind: kind,
      title: _nullableString(json['title']),
      description: _nullableString(json['description']),
      footerText: _nullableString(json['footerText'] ?? json['footer_text']),
      listButtonText: _nullableString(
        json['listButtonText'] ?? json['list_button_text'],
      ),
      imageUrl: _nullableString(json['imageUrl'] ?? json['image_url']),
      imagePath: _nullableString(json['imagePath'] ?? json['image_path']),
      sections: json.containsKey('sections') && json['sections'] != null
          ? _list(json['sections'])
                .map(
                  (entry) => GroupMenuListSectionConfig.fromJson(_map(entry)),
                )
                .where((section) => section.rows.isNotEmpty)
                .toList()
          : null,
      buttons: json.containsKey('buttons') && json['buttons'] != null
          ? _list(json['buttons'])
                .map((entry) => GroupMenuButtonConfig.fromJson(_map(entry)))
                .where((button) => button.label.isNotEmpty)
                .toList()
          : null,
      effectiveImageRef: _nullableString(
        json['effectiveImageRef'] ?? json['effective_image_ref'],
      ),
    );
  }

  GroupMenuCardConfig copyWith({
    String? title,
    bool clearTitle = false,
    String? description,
    bool clearDescription = false,
    String? footerText,
    bool clearFooterText = false,
    String? listButtonText,
    bool clearListButtonText = false,
    String? imageUrl,
    bool clearImageUrl = false,
    String? imagePath,
    bool clearImagePath = false,
    List<GroupMenuListSectionConfig>? sections,
    bool clearSections = false,
    List<GroupMenuButtonConfig>? buttons,
    bool clearButtons = false,
    String? effectiveImageRef,
  }) {
    return GroupMenuCardConfig(
      id: id,
      kind: kind,
      title: clearTitle ? null : title ?? this.title,
      description: clearDescription ? null : description ?? this.description,
      footerText: clearFooterText ? null : footerText ?? this.footerText,
      listButtonText: clearListButtonText
          ? null
          : listButtonText ?? this.listButtonText,
      imageUrl: clearImageUrl ? null : imageUrl ?? this.imageUrl,
      imagePath: clearImagePath ? null : imagePath ?? this.imagePath,
      sections: clearSections ? null : sections ?? this.sections,
      buttons: clearButtons ? null : buttons ?? this.buttons,
      effectiveImageRef: effectiveImageRef ?? this.effectiveImageRef,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind,
    'title': title,
    'description': description,
    'footerText': footerText,
    'listButtonText': listButtonText,
    'imageUrl': imageUrl,
    'imagePath': imagePath,
    'sections': sections?.map((section) => section.toJson()).toList(),
    'buttons': buttons?.map((button) => button.toJson()).toList(),
  };
}

class GroupMenuListSectionConfig {
  const GroupMenuListSectionConfig({
    required this.id,
    required this.title,
    required this.rows,
  });

  final String id;
  final String title;
  final List<GroupMenuListRowConfig> rows;

  factory GroupMenuListSectionConfig.fromJson(Map<String, dynamic> json) {
    return GroupMenuListSectionConfig(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString().trim(),
      rows: _list(json['rows'])
          .map((entry) => GroupMenuListRowConfig.fromJson(_map(entry)))
          .where((row) => row.title.isNotEmpty && row.command.isNotEmpty)
          .toList(),
    );
  }

  GroupMenuListSectionConfig copyWith({
    String? title,
    List<GroupMenuListRowConfig>? rows,
  }) => GroupMenuListSectionConfig(
    id: id,
    title: title ?? this.title,
    rows: rows ?? this.rows,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'rows': rows.map((row) => row.toJson()).toList(),
  };
}

class GroupMenuListRowConfig {
  const GroupMenuListRowConfig({
    required this.id,
    required this.title,
    required this.description,
    required this.command,
  });

  final String id;
  final String title;
  final String? description;
  final String command;

  factory GroupMenuListRowConfig.fromJson(Map<String, dynamic> json) {
    return GroupMenuListRowConfig(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString().trim(),
      description: _nullableString(json['description']),
      command: (json['command'] ?? json['rowId'] ?? json['row_id'] ?? '')
          .toString()
          .trim(),
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'description': description,
    'command': command,
  };
}

class GroupMenuButtonConfig {
  const GroupMenuButtonConfig({
    required this.id,
    required this.type,
    required this.label,
    required this.value,
  });

  final String id;
  final String type;
  final String label;
  final String value;

  factory GroupMenuButtonConfig.fromJson(Map<String, dynamic> json) {
    final rawType = (json['type'] ?? 'reply').toString().toLowerCase();
    return GroupMenuButtonConfig(
      id: (json['id'] ?? '').toString(),
      type: switch (rawType) {
        'cta_url' => 'url',
        'cta_copy' => 'copy',
        'quick_reply' => 'reply',
        'url' || 'copy' => rawType,
        _ => 'reply',
      },
      label: (json['label'] ?? json['text'] ?? '').toString().trim(),
      value:
          (json['value'] ??
                  json['url'] ??
                  json['copyCode'] ??
                  json['copy_code'] ??
                  json['command'] ??
                  '')
              .toString()
              .trim(),
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'type': type,
    'label': label,
    'value': value,
  };
}

class ModerationActionConfig {
  const ModerationActionConfig({
    required this.deleteMessage,
    required this.registerInfraction,
    required this.banUser,
    this.maxInfractions,
  });

  final bool deleteMessage;
  final bool registerInfraction;
  final bool banUser;
  final int? maxInfractions;

  Map<String, Object?> toJson() {
    return {
      'deleteMessage': deleteMessage,
      'registerInfraction': registerInfraction,
      'banUser': banUser,
      'maxInfractions': maxInfractions,
    };
  }

  factory ModerationActionConfig.defaultFor(String key) {
    return ModerationActionConfig(
      deleteMessage: true,
      registerInfraction: true,
      banUser: key == 'banextremo' || key == 'bangringos',
      maxInfractions: key == 'banextremo' || key == 'bangringos' ? 1 : null,
    );
  }

  factory ModerationActionConfig.fromJson(
    Map<String, dynamic> json, {
    required String key,
  }) {
    final fallback = ModerationActionConfig.defaultFor(key);
    return ModerationActionConfig(
      deleteMessage: _asBoolOr(
        json['deleteMessage'] ?? json['delete_message'] ?? json['delete'],
        fallback.deleteMessage,
      ),
      registerInfraction: _asBoolOr(
        json['registerInfraction'] ??
            json['register_infraction'] ??
            json['infraction'],
        fallback.registerInfraction,
      ),
      banUser: _asBoolOr(
        json['banUser'] ?? json['ban_user'] ?? json['ban'],
        fallback.banUser,
      ),
      maxInfractions: _asNullablePositiveInt(
        json['maxInfractions'] ??
            json['max_infractions'] ??
            json['infractionLimit'] ??
            json['infraction_limit'] ??
            json['limit'],
        fallback: fallback.maxInfractions,
      ),
    );
  }
}

class GroupAutoResponseConfig {
  const GroupAutoResponseConfig({
    required this.raw,
    required this.id,
    required this.triggers,
    required this.responseText,
    required this.matchMode,
    required this.matchAnyMessage,
  });

  final Map<String, dynamic> raw;
  final String id;
  final List<String> triggers;
  final String responseText;
  final String matchMode;
  final bool matchAnyMessage;

  Map<String, dynamic> toJson() {
    return {
      ...raw,
      'id': id,
      'triggers': triggers,
      'responseText': responseText,
      'matchMode': matchMode,
      'matchAnyMessage': matchAnyMessage,
    };
  }

  factory GroupAutoResponseConfig.fromJson(Map<String, dynamic> json) {
    final triggers = _stringList(json['triggers']);
    final id =
        _nullableString(json['id']) ??
        'auto_${DateTime.now().microsecondsSinceEpoch}';
    final mode = (json['matchMode'] ?? json['match_mode'] ?? 'equals')
        .toString()
        .trim()
        .toLowerCase();
    return GroupAutoResponseConfig(
      raw: {...json},
      id: id,
      triggers: triggers,
      responseText: (json['responseText'] ?? json['response_text'] ?? '')
          .toString(),
      matchMode: mode == 'contains' ? 'contains' : 'equals',
      matchAnyMessage: _asBool(
        json['matchAnyMessage'] ?? json['match_any_message'],
      ),
    );
  }

  factory GroupAutoResponseConfig.newDraft() {
    final now = DateTime.now().toIso8601String();
    return GroupAutoResponseConfig(
      raw: {'createdAt': now, 'updatedAt': now},
      id: 'auto_${DateTime.now().microsecondsSinceEpoch}',
      triggers: const [],
      responseText: '',
      matchMode: 'equals',
      matchAnyMessage: false,
    );
  }

  GroupAutoResponseConfig copyWith({
    String? id,
    List<String>? triggers,
    String? responseText,
    String? matchMode,
    bool? matchAnyMessage,
  }) {
    return GroupAutoResponseConfig(
      raw: {...raw, 'updatedAt': DateTime.now().toIso8601String()},
      id: id ?? this.id,
      triggers: triggers ?? this.triggers,
      responseText: responseText ?? this.responseText,
      matchMode: matchMode ?? this.matchMode,
      matchAnyMessage: matchAnyMessage ?? this.matchAnyMessage,
    );
  }
}

class GroupMessageConfig {
  const GroupMessageConfig({
    required this.enabled,
    required this.caption,
    required this.mediaUrl,
    required this.mediaPath,
    required this.useParticipantProfilePhoto,
    required this.asSticker,
    required this.replyButtons,
  });

  final bool enabled;
  final String caption;
  final String? mediaUrl;
  final String? mediaPath;
  final bool useParticipantProfilePhoto;
  final bool asSticker;
  final GroupReplyButtonsConfig? replyButtons;

  factory GroupMessageConfig.fromJson(Map<String, dynamic> json) {
    return GroupMessageConfig(
      enabled: _asBool(json['enabled']),
      caption: (json['caption'] ?? '').toString(),
      mediaUrl: _nullableString(json['mediaUrl'] ?? json['media_url']),
      mediaPath: _nullableString(json['mediaPath'] ?? json['media_path']),
      useParticipantProfilePhoto: _asBool(
        json['useParticipantProfilePhoto'] ??
            json['use_participant_profile_photo'] ??
            json['useMemberProfilePhoto'] ??
            json['use_member_profile_photo'],
      ),
      asSticker: _asBool(json['asSticker'] ?? json['as_sticker']),
      replyButtons: GroupReplyButtonsConfig.fromJsonOrNull(
        json['replyButtons'] ?? json['reply_buttons'],
      ),
    );
  }
}

class GroupReplyButtonsConfig {
  const GroupReplyButtonsConfig({
    required this.enabled,
    required this.position,
    required this.body,
    required this.footer,
    required this.buttons,
  });

  final bool enabled;
  final String position;
  final String body;
  final String? footer;
  final List<GroupReplyButton> buttons;

  bool get hasButtons => enabled && buttons.isNotEmpty;

  Map<String, Object?> toJson() {
    return {
      'enabled': enabled,
      'position': position,
      'body': body,
      'footer': footer,
      'buttons': buttons.map((button) => button.toJson()).toList(),
      'updatedAt': DateTime.now().toIso8601String(),
    };
  }

  factory GroupReplyButtonsConfig.empty() {
    return GroupReplyButtonsConfig(
      enabled: false,
      position: 'before_attachments',
      body: '',
      footer: null,
      buttons: const [],
    );
  }

  static GroupReplyButtonsConfig? fromJsonOrNull(Object? value) {
    final map = _map(value);
    if (map.isEmpty) return null;
    final buttons = _list(map['buttons'])
        .map((entry) => GroupReplyButton.fromJson(_map(entry)))
        .where((button) => button.label.trim().isNotEmpty)
        .toList();
    return GroupReplyButtonsConfig(
      enabled: _asBool(map['enabled']),
      position: (map['position'] ?? 'before_attachments').toString(),
      body: (map['body'] ?? '').toString(),
      footer: _nullableString(map['footer']),
      buttons: buttons,
    );
  }
}

class GroupReplyButton {
  const GroupReplyButton({
    required this.id,
    required this.label,
    required this.type,
    this.command,
    this.args,
    this.url,
    this.phoneNumber,
    this.copyCode,
  });

  final String id;
  final String label;
  final String type;
  final String? command;
  final String? args;
  final String? url;
  final String? phoneNumber;
  final String? copyCode;

  Map<String, Object?> toJson() {
    return {
      'id': id,
      'label': label,
      'type': type,
      'command': command,
      'args': args,
      'url': url,
      'phoneNumber': phoneNumber,
      'copyCode': copyCode,
    };
  }

  GroupReplyButton copyWith({
    String? id,
    String? label,
    String? type,
    String? command,
    String? args,
    String? url,
    String? phoneNumber,
    String? copyCode,
  }) {
    return GroupReplyButton(
      id: id ?? this.id,
      label: label ?? this.label,
      type: type ?? this.type,
      command: command ?? this.command,
      args: args ?? this.args,
      url: url ?? this.url,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      copyCode: copyCode ?? this.copyCode,
    );
  }

  factory GroupReplyButton.newDraft(int index) {
    return GroupReplyButton(
      id: 'btn_${DateTime.now().microsecondsSinceEpoch}_$index',
      label: index == 0 ? 'Abrir menu' : '',
      type: 'quick_reply',
      command: index == 0 ? 'menu' : '',
      args: '',
      url: '',
      phoneNumber: '',
      copyCode: '',
    );
  }

  factory GroupReplyButton.fromJson(Map<String, dynamic> json) {
    return GroupReplyButton(
      id: (json['id'] ?? '').toString(),
      label: (json['label'] ?? '').toString(),
      type: (json['type'] ?? 'quick_reply').toString(),
      command: _nullableString(json['command']),
      args: _nullableString(json['args']),
      url: _nullableString(json['url']),
      phoneNumber: _nullableString(json['phoneNumber'] ?? json['phone_number']),
      copyCode: _nullableString(json['copyCode'] ?? json['copy_code']),
    );
  }
}

class GroupScheduledAdMedia {
  const GroupScheduledAdMedia({
    required this.path,
    required this.url,
    required this.fileName,
    required this.mimeType,
    required this.mediaType,
    required this.caption,
  });

  final String? path;
  final String? url;
  final String? fileName;
  final String? mimeType;
  final String mediaType;
  final String? caption;

  String? get displayRef => url ?? path;

  factory GroupScheduledAdMedia.fromJson(Map<String, dynamic> json) {
    return GroupScheduledAdMedia(
      path: _nullableString(json['path']),
      url: _nullableString(json['url']),
      fileName: _nullableString(json['fileName'] ?? json['file_name']),
      mimeType: _nullableString(json['mimeType'] ?? json['mime_type']),
      mediaType: (json['mediaType'] ?? json['media_type'] ?? 'image')
          .toString()
          .trim()
          .toLowerCase(),
      caption: _nullableString(json['caption']),
    );
  }

  Map<String, Object?> toJson() => {
    'path': path,
    'url': url,
    'fileName': fileName,
    'mimeType': mimeType,
    'mediaType': mediaType,
    'caption': caption,
  };
}

class GroupScheduledAdConfig {
  const GroupScheduledAdConfig({
    required this.id,
    required this.enabled,
    required this.caption,
    required this.mentionAll,
    required this.scheduleType,
    required this.frequency,
    required this.times,
    required this.media,
    required this.buttons,
    required this.lastSentAt,
  });

  final String id;
  final bool enabled;
  final String caption;
  final bool mentionAll;
  final String scheduleType;
  final String? frequency;
  final List<String> times;
  final GroupScheduledAdMedia? media;
  final List<GroupReplyButton> buttons;
  final String? lastSentAt;

  factory GroupScheduledAdConfig.fromJson(Map<String, dynamic> json) {
    final responseButtons = _map(
      json['responseButtons'] ?? json['response_buttons'],
    );
    final responseType = (responseButtons['type'] ?? 'button_reply')
        .toString()
        .trim()
        .toLowerCase();
    final rawButtons = _list(
      json['interactiveButtons'] ??
          json['interactive_buttons'] ??
          responseButtons['buttons'],
    );
    final buttons = <GroupReplyButton>[];
    for (var index = 0; index < rawButtons.length; index++) {
      final raw = _map(rawButtons[index]);
      final rawType = (raw['type'] ?? '').toString().trim().toLowerCase();
      final type = rawType.isNotEmpty
          ? rawType
          : responseType == 'button_cta'
          ? (raw['url'] != null
                ? 'cta_url'
                : raw['copyCode'] != null || raw['copy_code'] != null
                ? 'cta_copy'
                : raw['phoneNumber'] != null || raw['phone_number'] != null
                ? 'cta_call'
                : 'cta_url')
          : 'quick_reply';
      final id = (raw['id'] ?? 'ad_button_${index + 1}').toString();
      buttons.add(
        GroupReplyButton(
          id: id,
          label: (raw['label'] ?? raw['text'] ?? 'Botão ${index + 1}')
              .toString(),
          type: type,
          command:
              _nullableString(raw['command']) ??
              (type == 'quick_reply' ? id : null),
          args: _nullableString(raw['args']),
          url: _nullableString(raw['url']),
          phoneNumber: _nullableString(
            raw['phoneNumber'] ?? raw['phone_number'],
          ),
          copyCode: _nullableString(raw['copyCode'] ?? raw['copy_code']),
        ),
      );
    }
    final mediaJson = _map(json['media']);
    return GroupScheduledAdConfig(
      id: (json['id'] ?? '').toString(),
      enabled: !json.containsKey('enabled') || _asBool(json['enabled']),
      caption: (json['caption'] ?? '').toString(),
      mentionAll: _asBool(json['mentionAll'] ?? json['mention_all']),
      scheduleType:
          (json['scheduleType'] ?? json['schedule_type'] ?? 'frequency')
              .toString(),
      frequency: _nullableString(json['frequency']),
      times: _stringList(json['times'] ?? json['horarios']),
      media: mediaJson.isEmpty
          ? null
          : GroupScheduledAdMedia.fromJson(mediaJson),
      buttons: buttons.take(3).toList(),
      lastSentAt: _nullableString(json['lastSentAt'] ?? json['last_sent_at']),
    );
  }

  factory GroupScheduledAdConfig.newDraft() {
    return GroupScheduledAdConfig(
      id: '',
      enabled: true,
      caption: '',
      mentionAll: false,
      scheduleType: 'frequency',
      frequency: '1h',
      times: const [],
      media: null,
      buttons: const [],
      lastSentAt: null,
    );
  }
}

class GroupScheduleConfig {
  const GroupScheduleConfig({
    required this.closeEnabled,
    required this.openEnabled,
    required this.closeTimes,
    required this.openTimes,
    required this.closeMessage,
    required this.openMessage,
    required this.timezone,
  });

  final bool closeEnabled;
  final bool openEnabled;
  final List<String> closeTimes;
  final List<String> openTimes;
  final String? closeMessage;
  final String? openMessage;
  final String? timezone;

  factory GroupScheduleConfig.fromJson(Map<String, dynamic> json) {
    return GroupScheduleConfig(
      closeEnabled: _asBool(json['closeEnabled'] ?? json['close_enabled']),
      openEnabled: _asBool(json['openEnabled'] ?? json['open_enabled']),
      closeTimes: _stringList(json['closeTimes'] ?? json['close_times']),
      openTimes: _stringList(json['openTimes'] ?? json['open_times']),
      closeMessage: _nullableString(
        json['closeMessage'] ?? json['close_message'],
      ),
      openMessage: _nullableString(json['openMessage'] ?? json['open_message']),
      timezone: _nullableString(json['timezone']),
    );
  }
}

class GroupHorapgConfig {
  const GroupHorapgConfig({
    required this.enabled,
    required this.times,
    required this.imageUrl,
    required this.imagePath,
    required this.mentionAll,
    required this.timezone,
  });

  final bool enabled;
  final List<String> times;
  final String? imageUrl;
  final String? imagePath;
  final bool mentionAll;
  final String? timezone;

  factory GroupHorapgConfig.fromJson(Map<String, dynamic> json) {
    return GroupHorapgConfig(
      enabled: _asBool(json['enabled']),
      times: _stringList(json['times']),
      imageUrl: _nullableString(json['imageUrl'] ?? json['image_url']),
      imagePath: _nullableString(json['imagePath'] ?? json['image_path']),
      mentionAll: _asBool(json['mentionAll'] ?? json['mention_all']),
      timezone: _nullableString(json['timezone']),
    );
  }
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return const {};
}

Map<String, bool> _boolMap(Object? value) {
  final source = _map(value);
  return source.map((key, raw) => MapEntry(key, _asBool(raw)));
}

Map<String, ModerationActionConfig> _moderationActionsMap(Object? value) {
  final source = _map(value);
  final result = <String, ModerationActionConfig>{};
  for (final entry in source.entries) {
    final raw = entry.value;
    if (raw is Map<String, dynamic>) {
      result[entry.key] = ModerationActionConfig.fromJson(raw, key: entry.key);
    } else if (raw is Map) {
      result[entry.key] = ModerationActionConfig.fromJson(
        raw.cast<String, dynamic>(),
        key: entry.key,
      );
    }
  }
  return result;
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value
        .map((entry) => entry.toString().trim())
        .where((entry) => entry.isNotEmpty)
        .toList();
  }
  if (value is String) {
    return value
        .split(RegExp(r'[\n,;,]+'))
        .map((entry) => entry.trim())
        .where((entry) => entry.isNotEmpty)
        .toList();
  }
  return const [];
}

List<Object?> _list(Object? value) {
  if (value is List) return value;
  return const [];
}

String? _nullableString(Object? value) {
  if (value == null) return null;
  final text = value.toString().trim();
  return text.isEmpty ? null : text;
}

bool _asBool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final text = value?.toString().trim().toLowerCase() ?? '';
  return text == 'true' ||
      text == '1' ||
      text == 'yes' ||
      text == 'sim' ||
      text == 'on';
}

bool _asBoolOr(Object? value, bool fallback) {
  if (value == null) return fallback;
  if (value is bool) return value;
  if (value is num) return value != 0;
  final text = value.toString().trim().toLowerCase();
  if (text.isEmpty) return fallback;
  if (['true', '1', 'yes', 'sim', 'on'].contains(text)) return true;
  if (['false', '0', 'no', 'nao', 'não', 'off'].contains(text)) return false;
  return fallback;
}

int _asInt(Object? value, {required int fallback}) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

int? _asNullablePositiveInt(Object? value, {int? fallback}) {
  if (value == null) return fallback;
  if (value is String && value.trim().isEmpty) return fallback;
  final parsed = value is num
      ? value.toInt()
      : int.tryParse(value.toString().replaceAll(RegExp(r'[^0-9]'), ''));
  if (parsed == null || parsed <= 0) return fallback;
  return parsed.clamp(1, 20).toInt();
}
