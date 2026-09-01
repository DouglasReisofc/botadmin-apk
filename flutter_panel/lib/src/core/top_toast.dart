import 'dart:async';

import 'package:flutter/material.dart';

OverlayEntry? _activeTopToast;
Timer? _activeTopToastTimer;

/// Verde padrão de sucesso (estilo WhatsApp / BotAdmin).
const Color kToastSuccessColor = Color(0xFF00A884);

/// Vermelho de erro / ação destrutiva.
const Color kToastErrorColor = Color(0xFFB42318);

/// Notificação centralizada no topo (sucesso, erro ou custom).
void showTopToast(
  BuildContext context, {
  required String message,
  IconData? icon,
  Color? color,
  bool error = false,
  Duration duration = const Duration(seconds: 3),
}) {
  final trimmed = message.trim();
  if (trimmed.isEmpty) return;

  _activeTopToastTimer?.cancel();
  _activeTopToast?.remove();
  _activeTopToast = null;

  final overlay = Overlay.maybeOf(context, rootOverlay: true);
  if (overlay == null) return;

  final isError = error || color == kToastErrorColor;
  final background = color ?? (isError ? kToastErrorColor : kToastSuccessColor);
  final resolvedIcon =
      icon ??
      (isError ? Icons.error_outline_rounded : Icons.check_circle_rounded);
  const foreground = Colors.white;

  final entry = OverlayEntry(
    builder: (context) {
      final topPad = MediaQuery.paddingOf(context).top;
      return Positioned(
        top: topPad + 12,
        left: 16,
        right: 16,
        child: IgnorePointer(
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            builder: (context, value, child) {
              return Opacity(
                opacity: value.clamp(0.0, 1.0),
                child: Transform.translate(
                  offset: Offset(0, (1 - value) * -12),
                  child: child,
                ),
              );
            },
            child: Material(
              color: Colors.transparent,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: background,
                      borderRadius: BorderRadius.circular(999),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x40000000),
                          blurRadius: 20,
                          offset: Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(resolvedIcon, color: foreground, size: 20),
                          const SizedBox(width: 10),
                          Flexible(
                            child: Text(
                              trimmed,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: foreground,
                                fontWeight: FontWeight.w800,
                                fontSize: 14.5,
                                height: 1.25,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  );

  _activeTopToast = entry;
  overlay.insert(entry);
  _activeTopToastTimer = Timer(duration, () {
    if (_activeTopToast == entry) {
      entry.remove();
      _activeTopToast = null;
    }
  });
}

/// Atalho de sucesso (verde, topo centralizado).
void showSuccessToast(
  BuildContext context,
  String message, {
  IconData icon = Icons.check_circle_rounded,
  Duration duration = const Duration(seconds: 3),
}) {
  showTopToast(
    context,
    message: message,
    icon: icon,
    color: kToastSuccessColor,
    duration: duration,
  );
}

/// Atalho de erro (vermelho, topo centralizado).
void showErrorToast(
  BuildContext context,
  Object message, {
  IconData icon = Icons.error_outline_rounded,
  Duration duration = const Duration(seconds: 3),
}) {
  showTopToast(
    context,
    message: friendlyErrorMessage(message),
    icon: icon,
    error: true,
    color: kToastErrorColor,
    duration: duration,
  );
}

/// Feedback de sucesso de ação com texto da API (se útil) ou fallback local.
void showActionToast(
  BuildContext context, {
  String? apiMessage,
  required String fallback,
  bool error = false,
}) {
  final text = resolveActionMessage(apiMessage, fallback);
  if (error) {
    showErrorToast(context, text);
  } else {
    showSuccessToast(context, text);
  }
}

/// Mensagens claras de fallback para ações de conversa.
String conversationActionSuccessMessage(String action) {
  return switch (action.trim().toLowerCase()) {
    'pin' || 'fixar' => 'Chat fixado.',
    'unpin' || 'desfixar' => 'Chat desfixado.',
    'archive' || 'arquivar' => 'Chat arquivado.',
    'unarchive' || 'desarquivar' => 'Chat desarquivado.',
    'clear' || 'limpar' => 'Mensagens limpas com sucesso.',
    'delete' || 'apagar' => 'Conversa apagada.',
    'leave' || 'sair' => 'Você saiu do grupo.',
    'read' || 'lida' => 'Conversa marcada como lida.',
    _ => 'Ação realizada com sucesso.',
  };
}

/// Mensagens de fallback para ações em mensagem.
String messageActionSuccessMessage(String action) {
  return switch (action.trim().toLowerCase()) {
    'delete' || 'apagar' => 'Mensagem apagada.',
    'pin' || 'fixar' => 'Mensagem fixada.',
    'unpin' || 'desfixar' => 'Mensagem desfixada.',
    'react' || 'reagir' => 'Reação enviada.',
    'interactive_reply' => 'Resposta enviada.',
    'edit' || 'editar' => 'Mensagem editada.',
    'poll_vote' => 'Voto enviado.',
    'reveal_deleted' => 'Mensagem revelada.',
    'hide_deleted' => 'Mensagem ocultada.',
    'star' || 'favorite' => 'Mensagem marcada como favorita.',
    _ => 'Ação realizada com sucesso.',
  };
}

/// Status do BotAdmin no grupo.
String botAdminStatusMessage(bool enabled) {
  return enabled
      ? 'BotAdmin ativado neste grupo.'
      : 'BotAdmin desativado neste grupo.';
}

/// Prefere mensagem da API quando for legível; senão usa o fallback.
String resolveActionMessage(String? apiMessage, String fallback) {
  final raw = (apiMessage ?? '').trim();
  if (raw.isEmpty) return fallback;
  final lower = raw.toLowerCase();
  if (lower == 'ok' ||
      lower == 'true' ||
      lower == 'success' ||
      lower == 'null' ||
      raw.startsWith('{') ||
      raw.startsWith('[')) {
    return fallback;
  }
  return raw;
}

/// Remove prefixos técnicos de exceptions para o toast de erro.
String friendlyErrorMessage(Object error) {
  var text = error.toString().trim();
  if (text.isEmpty) return 'Não foi possível concluir a ação.';
  const prefixes = <String>[
    'BotAdminApiException: ',
    'Exception: ',
    'Error: ',
    'DioException [bad response]: ',
    'DioException: ',
  ];
  for (final prefix in prefixes) {
    if (text.startsWith(prefix)) {
      text = text.substring(prefix.length).trim();
    }
  }
  if (text.isEmpty) return 'Não foi possível concluir a ação.';
  return text;
}
