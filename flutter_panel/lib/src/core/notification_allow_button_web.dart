import 'dart:js_interop';
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

import 'browser_notifications.dart';

/// Botão HTML nativo no Flutter Web.
///
/// Precisa ser um `<button>` real do DOM para o Chrome aceitar
/// `Notification.requestPermission()` com gesto válido — inclusive
/// solicitando de novo depois de uma recusa anterior.
class NotificationAllowButton extends StatefulWidget {
  const NotificationAllowButton({super.key, this.onResolved});

  final ValueChanged<BrowserNotificationStatus>? onResolved;

  @override
  State<NotificationAllowButton> createState() =>
      _NotificationAllowButtonState();
}

class _NotificationAllowButtonState extends State<NotificationAllowButton> {
  static int _seq = 0;
  late final String _viewType;

  @override
  void initState() {
    super.initState();
    _viewType = 'botadmin-allow-notifications-${_seq++}';

    ui_web.platformViewRegistry.registerViewFactory(_viewType, (int viewId) {
      final root = web.HTMLDivElement()
        ..style.width = '100%'
        ..style.height = '100%'
        ..style.display = 'flex'
        ..style.alignItems = 'center'
        ..style.justifyContent = 'center';

      final button = web.HTMLButtonElement()
        ..type = 'button'
        ..textContent = 'Permitir'
        ..style.cssText = [
          'width:100%',
          'height:34px',
          'margin:0',
          'padding:0 12px',
          'border:0',
          'border-radius:8px',
          'background:rgba(0,128,105,0.12)',
          'color:#008069',
          'font-weight:800',
          'font-size:13.5px',
          'font-family:Roboto,Arial,sans-serif',
          'cursor:pointer',
          'line-height:34px',
        ].join(';');

      button.addEventListener(
        'click',
        (web.Event event) {
          event.preventDefault();
          BrowserNotifications.requestPermission().then((status) {
            try {
              web.window.dispatchEvent(
                web.CustomEvent('botadmin-notification-permission'),
              );
            } catch (_) {}
            final cb = widget.onResolved;
            if (cb != null) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                cb(status);
              });
            }
          });
        }.toJS,
      );

      root.append(button);
      return root;
    });
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 96,
      height: 34,
      child: HtmlElementView(viewType: _viewType),
    );
  }
}
