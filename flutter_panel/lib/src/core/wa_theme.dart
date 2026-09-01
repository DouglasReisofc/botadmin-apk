import 'package:flutter/material.dart';

/// Opens a modal sheet while always keeping its interactive content above the
/// Android/iOS system navigation area.
///
/// Flutter's [showModalBottomSheet] deliberately ignores the bottom safe area,
/// even when `useSafeArea` is enabled. Keeping this wrapper in the shared theme
/// makes the native-safe behavior consistent across the whole application.
Future<T?> showBotAdminBottomSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  Color? backgroundColor,
  String? barrierLabel,
  double? elevation,
  ShapeBorder? shape,
  Clip? clipBehavior,
  BoxConstraints? constraints,
  Color? barrierColor,
  bool isScrollControlled = false,
  double scrollControlDisabledMaxHeightRatio = 9.0 / 16.0,
  bool useRootNavigator = false,
  bool isDismissible = true,
  bool enableDrag = true,
  bool? showDragHandle,
  bool useSafeArea = true,
  RouteSettings? routeSettings,
  AnimationController? transitionAnimationController,
  Offset? anchorPoint,
  AnimationStyle? sheetAnimationStyle,
  bool? requestFocus,
}) {
  return showModalBottomSheet<T>(
    context: context,
    backgroundColor: backgroundColor,
    barrierLabel: barrierLabel,
    elevation: elevation,
    shape: shape,
    clipBehavior: clipBehavior,
    constraints: constraints,
    barrierColor: barrierColor,
    isScrollControlled: isScrollControlled,
    scrollControlDisabledMaxHeightRatio: scrollControlDisabledMaxHeightRatio,
    useRootNavigator: useRootNavigator,
    isDismissible: isDismissible,
    enableDrag: enableDrag,
    showDragHandle: showDragHandle,
    useSafeArea: useSafeArea,
    routeSettings: routeSettings,
    transitionAnimationController: transitionAnimationController,
    anchorPoint: anchorPoint,
    sheetAnimationStyle: sheetAnimationStyle,
    requestFocus: requestFocus,
    builder: (sheetContext) => AnimatedPadding(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOutCubic,
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
      ),
      child: SafeArea(
        top: true,
        left: true,
        right: true,
        maintainBottomViewPadding: true,
        minimum: const EdgeInsets.only(bottom: 12),
        child: builder(sheetContext),
      ),
    ),
  );
}

/// Tokens de cor estilo WhatsApp (clean / dark) para o painel Flutter.
class WaTheme {
  const WaTheme._(this.isDark);

  factory WaTheme.of(BuildContext context) {
    return WaTheme._(Theme.of(context).brightness == Brightness.dark);
  }

  final bool isDark;

  Color get shellBg =>
      isDark ? const Color(0xFF0B141A) : const Color(0xFFD1D7DB);

  Color get panel => isDark ? const Color(0xFF111B21) : Colors.white;

  Color get panelElevated =>
      isDark ? const Color(0xFF1F2C33) : const Color(0xFFF7F8F8);

  Color get rail => isDark ? const Color(0xFF202C33) : const Color(0xFFF7F5F3);

  Color get border =>
      isDark ? const Color(0xFF2A3942) : const Color(0xFFDADDE1);

  Color get divider =>
      isDark ? const Color(0xFF2A3942) : const Color(0xFFE9EDEF);

  Color get textPrimary =>
      isDark ? const Color(0xFFE9EDEF) : const Color(0xFF111B21);

  Color get textSecondary =>
      isDark ? const Color(0xFF8696A0) : const Color(0xFF54656F);

  Color get textMuted =>
      isDark ? const Color(0xFF8696A0) : const Color(0xFF667781);

  Color get searchBg =>
      isDark ? const Color(0xFF202C33) : const Color(0xFFF0F2F5);

  Color get hover => isDark ? const Color(0xFF2A3942) : const Color(0xFFF5F6F6);

  Color get selectedRow =>
      isDark ? const Color(0xFF2A3942) : const Color(0xFFE9EDEF);

  Color get filterChip =>
      isDark ? const Color(0xFF202C33) : const Color(0xFFE9EDEF);

  Color get filterChipActive =>
      isDark ? const Color(0xFF0A332C) : const Color(0xFFD9FDD3);

  Color get filterChipText =>
      isDark ? const Color(0xFF8696A0) : const Color(0xFF54656F);

  Color get filterChipTextActive => const Color(0xFF00A884);

  Color get menuBg => isDark ? const Color(0xFF233138) : Colors.white;

  Color get accent => const Color(0xFF00A884);

  Color get accentSoft =>
      isDark ? const Color(0xFF0A332C) : const Color(0xFFD9FDD3);

  Color get unreadBadge => const Color(0xFF25D366);

  Color get icon => isDark ? const Color(0xFFAEBAC1) : const Color(0xFF54656F);

  Color get noticeBg =>
      isDark ? const Color(0xFF182229) : const Color(0xFFF0EDEA);

  Color get contentBg =>
      isDark ? const Color(0xFF0B141A) : const Color(0xFFFCFBFA);

  // ── Chat ──────────────────────────────────────────────────────────

  Color get chatBg =>
      isDark ? const Color(0xFF0B141A) : const Color(0xFFEAE6DF);

  Color get chatWallpaper =>
      isDark ? const Color(0xFF0B141A) : const Color(0xFFF5EFE7);

  Color get chatDoodle =>
      isDark ? const Color(0x14AEBAC1) : const Color(0x1AD6CBBE);

  Color get headerBg =>
      isDark ? const Color(0xFF202C33) : const Color(0xFFF0F2F5);

  Color get composerBg =>
      isDark ? const Color(0xFF202C33) : const Color(0xFFF0F2F5);

  Color get inputFill => isDark ? const Color(0xFF2A3942) : Colors.white;

  Color get bubbleOut =>
      isDark ? const Color(0xFF005C4B) : const Color(0xFFD9FDD3);

  Color get bubbleIn => isDark ? const Color(0xFF202C33) : Colors.white;

  Color get bubbleText =>
      isDark ? const Color(0xFFE9EDEF) : const Color(0xFF111B21);

  Color get bubbleMeta =>
      isDark ? const Color(0xFF8696A0) : const Color(0xFF667781);

  Color get avatarFallback =>
      isDark ? const Color(0xFF2A3942) : const Color(0xFFE9EDEF);

  Color get emptyPill =>
      isDark ? const Color(0xCC182229) : const Color(0xCCFFFFFF);
}
