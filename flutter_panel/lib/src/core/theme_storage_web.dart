import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:web/web.dart' as web;

@JS('window')
external JSObject get _window;

String? readThemeStorage(String key) {
  try {
    return web.window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

void writeThemeStorage(String key, String value) {
  try {
    web.window.localStorage.setItem(key, value);
  } catch (_) {
    // ignore
  }
  if (key != 'botadmin-theme') return;
  try {
    final theme = value == 'clean' ? 'clean' : 'dark';
    final bs = theme == 'dark' ? 'dark' : 'light';
    final isDark = theme == 'dark';
    final root = web.document.documentElement;
    if (root == null) return;

    root.setAttribute('data-theme', theme);
    root.setAttribute('data-bs-theme', bs);

    // Atualiza props sem apagar o style inteiro (isso zerava --ba-* e
    // o card do preloader virava branco no fim do load).
    final htmlRoot = root as web.HTMLElement;
    final css = htmlRoot.style;
    css.setProperty('color-scheme', isDark ? 'dark' : 'light');
    if (isDark) {
      css.setProperty('--ba-bg', '#0b141a');
      css.setProperty('--ba-bg-soft', '#111b21');
      css.setProperty('--ba-card', '#111b21');
      css.setProperty('--ba-text', '#e9edef');
      css.setProperty('--ba-muted', '#8696a0');
      css.setProperty('--ba-track', '#2a3942');
      css.setProperty('--ba-border', '#2a3942');
      css.setProperty('--ba-preload-bg', '#0b141a');
      css.setProperty('--ba-logo-bg', '#202c33');
    } else {
      css.setProperty('--ba-bg', '#ffffff');
      css.setProperty('--ba-bg-soft', '#ffffff');
      css.setProperty('--ba-card', '#ffffff');
      css.setProperty('--ba-text', '#111b21');
      css.setProperty('--ba-muted', '#667781');
      css.setProperty('--ba-track', '#e9edef');
      css.setProperty('--ba-border', '#e9edef');
      css.setProperty('--ba-preload-bg', '#ffffff');
      css.setProperty('--ba-logo-bg', '#ffffff');
    }
  } catch (_) {
    // ignore
  }
  try {
    _window['__botadminTheme'] = value.toJS;
  } catch (_) {}
}
