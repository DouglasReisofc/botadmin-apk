import 'package:flutter/material.dart';

import 'browser_notifications.dart';

/// Fallback (mobile/desktop): botão Flutter normal.
class NotificationAllowButton extends StatefulWidget {
  const NotificationAllowButton({super.key, this.onResolved});

  final ValueChanged<BrowserNotificationStatus>? onResolved;

  @override
  State<NotificationAllowButton> createState() =>
      _NotificationAllowButtonState();
}

class _NotificationAllowButtonState extends State<NotificationAllowButton> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    if (_busy) {
      return const SizedBox(
        width: 96,
        height: 34,
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Color(0xFF008069),
            ),
          ),
        ),
      );
    }

    return SizedBox(
      width: 96,
      height: 34,
      child: TextButton(
        onPressed: _onPressed,
        style: TextButton.styleFrom(
          foregroundColor: const Color(0xFF008069),
          backgroundColor: const Color(0xFF008069).withValues(alpha: 0.12),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          minimumSize: const Size(0, 34),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        child: const Text(
          'Permitir',
          style: TextStyle(
            color: Color(0xFF008069),
            fontSize: 13.5,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }

  Future<void> _onPressed() async {
    if (_busy) return;
    setState(() => _busy = true);
    final next = await BrowserNotifications.requestPermission();
    if (!mounted) return;
    setState(() => _busy = false);
    widget.onResolved?.call(next);
  }
}
