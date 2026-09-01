import 'dart:js_interop';

import 'package:web/web.dart' as web;

bool _signaled = false;
bool _dispatchScheduled = false;

/// Avisa o preloader HTML que a UI útil já pode aparecer
/// (login ou dashboard com dados).
void signalAppReady() {
  if (_signaled || _dispatchScheduled) return;
  // O primeiro frame do Flutter só cria o canvas; a árvore da conversa é
  // pintada no frame seguinte. Esperar dois RAF evita remover o preloader
  // entre esses frames e expor o fundo cinza por alguns instantes.
  _dispatchScheduled = true;
  try {
    web.window.requestAnimationFrame(((num _) {
      web.window.requestAnimationFrame(((num _) {
        if (_signaled) return;
        _signaled = true;
        web.window.dispatchEvent(web.CustomEvent('botadmin-app-ready'));
      }).toJS);
    }).toJS);
  } catch (_) {
    try {
      _signaled = true;
      // Fallback para browsers mais antigos.
      final event = web.Event('botadmin-app-ready');
      web.window.dispatchEvent(event);
    } catch (__) {}
  }
}
