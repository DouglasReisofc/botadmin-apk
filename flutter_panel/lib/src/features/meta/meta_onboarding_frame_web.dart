import 'dart:ui_web' as ui_web;
import 'dart:js_interop';

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

class MetaOnboardingFrame extends StatefulWidget {
  const MetaOnboardingFrame({
    super.key,
    required this.url,
    this.onConnected,
    this.onPending,
  });

  final String url;
  final VoidCallback? onConnected;
  final VoidCallback? onPending;

  @override
  State<MetaOnboardingFrame> createState() => _MetaOnboardingFrameState();
}

class _MetaOnboardingFrameState extends State<MetaOnboardingFrame> {
  static int _nextId = 0;
  late final String _viewType;
  late final JSFunction _messageListener;
  web.HTMLIFrameElement? _iframe;

  @override
  void initState() {
    super.initState();
    _messageListener = ((web.Event event) {
      final message = event as web.MessageEvent;
      if (message.origin != Uri.parse(widget.url).origin ||
          message.source != _iframe?.contentWindow) {
        return;
      }
      final data = message.data.dartify();
      if (data is Map && data['type'] == 'BOTADMIN_META_ONBOARDING') {
        if (data['status'] == 'connected') widget.onConnected?.call();
        if (data['status'] == 'pending') widget.onPending?.call();
      }
    }).toJS;
    web.window.addEventListener('message', _messageListener);
    _viewType = 'botadmin-meta-onboarding-${_nextId++}';
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (int viewId) {
      final iframe = web.HTMLIFrameElement()
        ..src = widget.url
        ..title = 'Cadastro seguro do WhatsApp Business pela Meta'
        ..style.width = '100%'
        ..style.height = '100%'
        ..style.border = '0'
        ..style.backgroundColor = 'transparent';
      iframe.setAttribute('referrerpolicy', 'same-origin');
      iframe.setAttribute('loading', 'eager');
      _iframe = iframe;
      return iframe;
    });
  }

  @override
  void dispose() {
    web.window.removeEventListener('message', _messageListener);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HtmlElementView(viewType: _viewType);
}
