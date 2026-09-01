import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:app_links/app_links.dart';
import 'package:lottie/lottie.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core/app_ready.dart';
import 'core/api_client.dart';
import 'core/auth_redirect.dart';
import 'core/mobile_update_prompt.dart';
import 'core/theme_controller.dart';
import 'core/top_toast.dart';
import 'features/auth/auth_controller.dart';
import 'features/admin/admin_dashboard_shell.dart';
import 'features/dashboard/dashboard_controller.dart';
import 'features/dashboard/dashboard_shell.dart';
import 'features/dashboard/internal_groups_panel.dart';
import 'features/dashboard/migration_panels.dart';
import 'models/session_user.dart';

class BotAdminFlutterApp extends ConsumerWidget {
  const BotAdminFlutterApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeControllerProvider);
    final isDark = themeMode == AppThemeMode.dark;

    return MaterialApp(
      title: 'BotAdmin',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(Brightness.light),
      darkTheme: buildAppTheme(Brightness.dark),
      themeMode: isDark ? ThemeMode.dark : ThemeMode.light,
      builder: (context, child) {
        final bg = isDark ? const Color(0xFF0B141A) : const Color(0xFFF0F2F5);
        final systemBarColor = systemBarColorFor(isDark);
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: buildSystemUiOverlayStyle(isDark),
          child: MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: kIsWeb
                  ? MediaQuery.textScalerOf(context)
                  : const TextScaler.linear(.92),
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                ColoredBox(
                  color: bg,
                  child: _MobileDeepLinkBridge(
                    child: child ?? const SizedBox.shrink(),
                  ),
                ),
                if (!kIsWeb && MediaQuery.paddingOf(context).top > 0)
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    height: MediaQuery.paddingOf(context).top,
                    child: IgnorePointer(
                      child: ColoredBox(color: systemBarColor),
                    ),
                  ),
                if (!kIsWeb && MediaQuery.paddingOf(context).bottom > 0)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: MediaQuery.paddingOf(context).bottom,
                    child: IgnorePointer(
                      child: ColoredBox(color: systemBarColor),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
      home: const _SessionGate(),
    );
  }
}

Color systemBarColorFor(bool isDark) =>
    isDark ? const Color(0xFF111B21) : Colors.white;

SystemUiOverlayStyle buildSystemUiOverlayStyle(bool isDark) {
  final systemBarColor = systemBarColorFor(isDark);
  final iconBrightness = isDark ? Brightness.light : Brightness.dark;

  return SystemUiOverlayStyle(
    statusBarColor: systemBarColor,
    statusBarIconBrightness: iconBrightness,
    statusBarBrightness: isDark ? Brightness.dark : Brightness.light,
    systemStatusBarContrastEnforced: false,
    systemNavigationBarColor: systemBarColor,
    systemNavigationBarIconBrightness: iconBrightness,
    systemNavigationBarDividerColor: systemBarColor,
    systemNavigationBarContrastEnforced: false,
  );
}

class _MobileDeepLinkBridge extends ConsumerStatefulWidget {
  const _MobileDeepLinkBridge({required this.child});

  final Widget child;

  @override
  ConsumerState<_MobileDeepLinkBridge> createState() =>
      _MobileDeepLinkBridgeState();
}

class _MobileDeepLinkBridgeState extends ConsumerState<_MobileDeepLinkBridge> {
  StreamSubscription<Uri>? _sub;
  final Set<String> _handledTokens = <String>{};
  final Set<String> _previewingTokens = <String>{};
  String? _pendingGroupInviteToken;

  @override
  void initState() {
    super.initState();
    if (!kIsWeb) {
      unawaited(_restorePendingInvite());
      _initLinks();
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _initLinks() async {
    final appLinks = AppLinks();
    try {
      final initial = await appLinks.getInitialLink();
      if (initial != null) {
        unawaited(_handleUri(initial));
      }
    } catch (_) {}
    _sub = appLinks.uriLinkStream.listen(
      (uri) => unawaited(_handleUri(uri)),
      onError: (_) {},
    );
  }

  Future<void> _restorePendingInvite() async {
    final token = await ref.read(sessionStoreProvider).readPendingGroupInvite();
    if (!mounted || token == null || token.isEmpty) return;
    _pendingGroupInviteToken = token;
    await _showInternalGroupInvitePreview(token);
  }

  Future<void> _handleUri(Uri uri) async {
    if (!mounted) return;
    final isSiteLink =
        (uri.scheme == 'https' || uri.scheme == 'http') &&
        (uri.host == 'botadmin.shop' || uri.host == 'www.botadmin.shop');
    final isGroupInvite =
        isSiteLink &&
        uri.pathSegments.length >= 2 &&
        uri.pathSegments.first == 'g';
    if (isGroupInvite) {
      final token = uri.pathSegments[1].trim();
      if (token.isEmpty || _handledTokens.contains('group:$token')) return;
      _pendingGroupInviteToken = token;
      await ref.read(sessionStoreProvider).savePendingGroupInvite(token);
      await _showInternalGroupInvitePreview(token);
      final session = ref.read(authControllerProvider).value;
      if (session == null) {
        ref.invalidate(authControllerProvider);
        if (mounted) {
          showSuccessToast(
            context,
            'Entre ou crie sua conta para participar do grupo.',
          );
        }
        return;
      }
      return;
    }
    if (isSiteLink) {
      ref.invalidate(authControllerProvider);
      return;
    }

    final isAuthLink =
        uri.scheme == 'botadmin' &&
        (uri.host == 'auth' || uri.pathSegments.contains('auth'));
    if (!isAuthLink) return;

    final token = uri.queryParameters['token']?.trim() ?? '';
    if (token.isEmpty || _handledTokens.contains(token)) return;
    _handledTokens.add(token);

    try {
      final session = await ref
          .read(apiClientProvider)
          .consumeMobileAppAuthToken(token);
      if (!mounted) return;
      ref.read(authControllerProvider.notifier).setSession(session);
      ref.invalidate(dashboardSnapshotProvider);
      showSuccessToast(context, 'App conectado ao painel.');
    } catch (error) {
      if (!mounted) return;
      showErrorToast(context, 'Nao consegui entrar pelo link: $error');
    }
  }

  Future<void> _showInternalGroupInvitePreview(String token) async {
    if (!mounted || _previewingTokens.contains(token)) return;
    _previewingTokens.add(token);
    try {
      final preview = await ref
          .read(apiClientProvider)
          .loadInternalGroupInvitePreview(token);
      if (!mounted) return;
      final session = ref.read(authControllerProvider).value;
      final action = await showDialog<_InvitePreviewAction>(
        context: context,
        barrierDismissible: true,
        builder: (dialogContext) {
          final avatar = preview['avatarUrl']?.toString().trim() ?? '';
          final name = preview['name']?.toString().trim() ?? 'Grupo BotAdmin';
          final description = preview['description']?.toString().trim() ?? '';
          final memberCount =
              int.tryParse('${preview['memberCount'] ?? 0}') ?? 0;
          return AlertDialog(
            title: const Text('Convite privado BotAdmin'),
            content: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircleAvatar(
                    radius: 46,
                    backgroundColor: const Color(0xFFD9FDD3),
                    backgroundImage: avatar.isEmpty
                        ? null
                        : NetworkImage(avatar),
                    child: avatar.isEmpty
                        ? const Icon(
                            Icons.groups_rounded,
                            size: 42,
                            color: Color(0xFF008069),
                          )
                        : null,
                  ),
                  const SizedBox(height: 14),
                  Text(
                    name,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(description, textAlign: TextAlign.center),
                  ],
                  const SizedBox(height: 8),
                  Text('$memberCount membro${memberCount == 1 ? '' : 's'}'),
                  if (session == null) ...[
                    const SizedBox(height: 12),
                    const Text(
                      'Entre ou crie uma conta gratuita. O convite ficará salvo e a entrada será concluída automaticamente.',
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
              ),
            ),
            actions: session != null
                ? [
                    TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('Agora não'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(
                        dialogContext,
                        _InvitePreviewAction.join,
                      ),
                      child: const Text('Entrar no grupo'),
                    ),
                  ]
                : [
                    TextButton(
                      onPressed: () => Navigator.pop(
                        dialogContext,
                        _InvitePreviewAction.signIn,
                      ),
                      child: const Text('Entrar'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(
                        dialogContext,
                        _InvitePreviewAction.signUp,
                      ),
                      child: const Text('Criar conta grátis'),
                    ),
                  ],
          );
        },
      );
      if (!mounted) return;
      if (action == _InvitePreviewAction.join) {
        await _joinInternalGroup(token);
      } else if (action == _InvitePreviewAction.signIn) {
        _nativeAuthModeIntent.value = _NativeAuthMode.signIn;
      } else if (action == _InvitePreviewAction.signUp) {
        _nativeAuthModeIntent.value = _NativeAuthMode.signUp;
      }
    } on BotAdminApiException catch (error) {
      if (error.statusCode == 404) {
        _pendingGroupInviteToken = null;
        await ref.read(sessionStoreProvider).clearPendingGroupInvite();
      }
      if (mounted) {
        showErrorToast(context, error);
      }
    } catch (error) {
      if (mounted) {
        showErrorToast(context, 'Não consegui abrir o convite: $error');
      }
    } finally {
      _previewingTokens.remove(token);
    }
  }

  Future<void> _joinInternalGroup(String token) async {
    if (_handledTokens.contains('group:$token')) return;
    _handledTokens.add('group:$token');
    _pendingGroupInviteToken = null;
    try {
      final group = await ref.read(apiClientProvider).joinInternalGroup(token);
      if (!mounted) return;
      await ref.read(sessionStoreProvider).clearPendingGroupInvite();
      if (!mounted) return;
      ref.read(selectedInternalGroupIdProvider.notifier).select(group.id);
      ref
          .read(dashboardSectionProvider.notifier)
          .select(DashboardSection.internalGroups);
      showSuccessToast(context, 'Você entrou em ${group.name}.');
    } catch (error) {
      _handledTokens.remove('group:$token');
      if (error is BotAdminApiException &&
          (error.statusCode == 403 || error.statusCode == 404)) {
        _pendingGroupInviteToken = null;
        await ref.read(sessionStoreProvider).clearPendingGroupInvite();
      }
      if (!mounted) return;
      showErrorToast(context, 'Não consegui abrir o convite: $error');
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authControllerProvider, (_, next) {
      final pending = _pendingGroupInviteToken;
      if (pending != null && next.value != null) {
        unawaited(_joinInternalGroup(pending));
      }
    });
    return widget.child;
  }
}

enum _InvitePreviewAction { signIn, signUp, join }

ThemeData buildAppTheme(Brightness brightness) {
  const seed = Color(0xFF00A884);
  final isDark = brightness == Brightness.dark;

  final scheme = ColorScheme(
    brightness: brightness,
    primary: const Color(0xFF00A884),
    onPrimary: Colors.white,
    secondary: const Color(0xFF25D366),
    onSecondary: Colors.white,
    error: const Color(0xFFEA0038),
    onError: Colors.white,
    surface: isDark ? const Color(0xFF111B21) : Colors.white,
    onSurface: isDark ? const Color(0xFFE9EDEF) : const Color(0xFF111B21),
    surfaceContainerHighest: isDark
        ? const Color(0xFF202C33)
        : const Color(0xFFF0F2F5),
    onSurfaceVariant: isDark
        ? const Color(0xFF8696A0)
        : const Color(0xFF54656F),
    outline: isDark ? const Color(0xFF2A3942) : const Color(0xFFDADDE1),
    outlineVariant: isDark ? const Color(0xFF2A3942) : const Color(0xFFE9EDEF),
    primaryContainer: isDark
        ? const Color(0xFF0A332C)
        : const Color(0xFFD9FDD3),
    onPrimaryContainer: isDark
        ? const Color(0xFFD9FDD3)
        : const Color(0xFF008069),
  );

  final iconColor = isDark ? const Color(0xFFAEBAC1) : const Color(0xFF54656F);
  final textPrimary = isDark
      ? const Color(0xFFE9EDEF)
      : const Color(0xFF111B21);
  final textMuted = isDark ? const Color(0xFF8696A0) : const Color(0xFF667781);
  final panel = isDark ? const Color(0xFF111B21) : Colors.white;
  final menuBg = isDark ? const Color(0xFF233138) : Colors.white;
  final divider = isDark ? const Color(0xFF2A3942) : const Color(0xFFE9EDEF);
  final inputFill = isDark ? const Color(0xFF2A3942) : const Color(0xFFF7F9FA);
  final inputBorderColor = isDark
      ? const Color(0xFF3B4A54)
      : const Color(0xFFC8D1D8);
  final inputDisabledBorderColor = isDark
      ? const Color(0xFF24343D)
      : const Color(0xFFE1E6EA);
  final inputBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(16),
    borderSide: BorderSide(color: inputBorderColor, width: 1),
  );

  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: 'Roboto',
    brightness: brightness,
    scaffoldBackgroundColor: isDark
        ? const Color(0xFF0B141A)
        : const Color(0xFFEAE6DF),
    canvasColor: panel,
    cardColor: panel,
    dividerColor: divider,
    iconTheme: IconThemeData(color: iconColor, size: 24),
    primaryIconTheme: IconThemeData(color: iconColor),
    textTheme: TextTheme(
      bodyLarge: TextStyle(color: textPrimary),
      bodyMedium: TextStyle(color: textPrimary),
      bodySmall: TextStyle(color: textMuted),
      titleLarge: TextStyle(color: textPrimary, fontWeight: FontWeight.w700),
      titleMedium: TextStyle(color: textPrimary, fontWeight: FontWeight.w600),
      titleSmall: TextStyle(color: textPrimary, fontWeight: FontWeight.w600),
      labelLarge: TextStyle(color: textPrimary),
      labelMedium: TextStyle(color: textMuted),
      labelSmall: TextStyle(color: textMuted),
    ),
    navigationRailTheme: NavigationRailThemeData(
      minWidth: 64,
      groupAlignment: -0.92,
      backgroundColor: panel,
      selectedIconTheme: IconThemeData(color: textPrimary),
      unselectedIconTheme: IconThemeData(color: iconColor),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: panel,
      foregroundColor: textPrimary,
      systemOverlayStyle: buildSystemUiOverlayStyle(isDark),
      elevation: 0,
      iconTheme: IconThemeData(color: iconColor),
      actionsIconTheme: IconThemeData(color: iconColor),
      titleTextStyle: TextStyle(
        color: textPrimary,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        fontFamily: 'Roboto',
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: iconColor,
      textColor: textPrimary,
      subtitleTextStyle: TextStyle(color: textMuted, fontSize: 13.5),
      titleTextStyle: TextStyle(
        color: textPrimary,
        fontSize: 16,
        fontWeight: FontWeight.w600,
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: menuBg,
      surfaceTintColor: Colors.transparent,
      textStyle: TextStyle(color: textPrimary, fontSize: 14),
      iconColor: iconColor,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: panel,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        color: textPrimary,
        fontSize: 18,
        fontWeight: FontWeight.w700,
      ),
      contentTextStyle: TextStyle(color: textPrimary, fontSize: 14.5),
      iconColor: iconColor,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: isDark
          ? const Color(0xFF233138)
          : const Color(0xFF111B21),
      contentTextStyle: const TextStyle(color: Colors.white),
    ),
    dividerTheme: DividerThemeData(color: divider, thickness: 1, space: 1),
    inputDecorationTheme: InputDecorationTheme(
      border: inputBorder,
      enabledBorder: inputBorder,
      focusedBorder: inputBorder.copyWith(
        borderSide: const BorderSide(color: Color(0xFF00A884), width: 1.6),
      ),
      disabledBorder: inputBorder.copyWith(
        borderSide: BorderSide(color: inputDisabledBorderColor),
      ),
      errorBorder: inputBorder.copyWith(
        borderSide: BorderSide(color: scheme.error, width: 1.2),
      ),
      focusedErrorBorder: inputBorder.copyWith(
        borderSide: BorderSide(color: scheme.error, width: 1.6),
      ),
      filled: true,
      fillColor: inputFill,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      hintStyle: TextStyle(color: textMuted),
      labelStyle: TextStyle(color: textMuted),
      prefixIconColor: iconColor,
      suffixIconColor: iconColor,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: panel,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: iconColor),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: const Color(0xFF00A884),
      foregroundColor: Colors.white,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: Color(0xFF00A884),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: isDark
          ? const Color(0xFF202C33)
          : const Color(0xFFE9EDEF),
      selectedColor: isDark ? const Color(0xFF0A332C) : const Color(0xFFD9FDD3),
      labelStyle: TextStyle(color: textPrimary),
      secondaryLabelStyle: TextStyle(color: textPrimary),
      side: BorderSide(color: divider),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return Colors.white;
        return isDark ? const Color(0xFFAEBAC1) : const Color(0xFF54656F);
      }),
      trackColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const Color(0xFF00A884);
        }
        return isDark ? const Color(0xFF2A3942) : const Color(0xFFDADDE1);
      }),
    ),
  );

  // Keep seed for tonal helpers where needed
  return base.copyWith(
    colorScheme: scheme.copyWith(
      // keep seed-derived tertiary soft
      tertiary: seed,
    ),
  );
}

class _SessionGate extends ConsumerStatefulWidget {
  const _SessionGate();

  @override
  ConsumerState<_SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends ConsumerState<_SessionGate> {
  AuthSession? _lastKnownSession;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(authControllerProvider);
    final isDark = ref.watch(themeControllerProvider) == AppThemeMode.dark;
    return session.when(
      data: (value) {
        if (value == null) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            signalAppReady();
            if (kIsWeb) redirectToOfficialSignIn();
          });
          return kIsWeb
              ? _BridgeScreen(isDark: isDark)
              : _NativeLoginScreen(isDark: isDark);
        }
        _lastKnownSession = value;
        return _panelForSession(value);
      },
      error: (error, _) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          signalAppReady();
        });
        final cached = _lastKnownSession;
        if (cached != null) return _panelForSession(cached);
        return _SilentSessionReconnectScreen(isDark: isDark);
      },
      loading: () => kIsWeb
          ? _BridgeScreen(isDark: isDark)
          : _NativeSplashLoadingScreen(isDark: isDark),
    );
  }

  Widget _panelForSession(AuthSession value) {
    if (value.user.isAdmin) {
      return kIsWeb
          ? const AdminDashboardShell()
          : const _NativeDashboardBootGate(child: AdminDashboardShell());
    }
    if ((value.user.partnerRole ?? '').isNotEmpty) {
      final dashboard = _UserDashboardSessionShell(
        showAdminReturn: value.user.canReturnToAdmin,
        // A chave evita reaproveitar a árvore (e a seção/permissões) do Master
        // quando ele entra no painel de um revendedor, ou faz o caminho de
        // volta. Cada identidade autenticada ganha um shell limpo.
        child: PartnerDashboardShell(key: ValueKey(value.user.id)),
      );
      return kIsWeb ? dashboard : _NativeDashboardBootGate(child: dashboard);
    }
    // Parceiros entram no mesmo shell responsivo do usuário final. O papel é
    // lido da sessão para que o bundle web e o APK tenham exatamente a mesma
    // navegação e possam abrir diretamente o módulo de parceiros.
    final dashboard = _UserDashboardSessionShell(
      showAdminReturn: value.user.canReturnToAdmin,
      child: const DashboardShell(),
    );
    return kIsWeb ? dashboard : _NativeDashboardBootGate(child: dashboard);
  }
}

class _SilentSessionReconnectScreen extends ConsumerStatefulWidget {
  const _SilentSessionReconnectScreen({required this.isDark});

  final bool isDark;

  @override
  ConsumerState<_SilentSessionReconnectScreen> createState() =>
      _SilentSessionReconnectScreenState();
}

class _SilentSessionReconnectScreenState
    extends ConsumerState<_SilentSessionReconnectScreen> {
  Timer? _retryTimer;

  @override
  void initState() {
    super.initState();
    _retryTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (mounted) ref.invalidate(authControllerProvider);
    });
  }

  @override
  void dispose() {
    _retryTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final background = widget.isDark
        ? const Color(0xFF0B141A)
        : const Color(0xFFF0F2F5);
    return Scaffold(
      backgroundColor: background,
      body: Center(
        child: SizedBox(
          width: 72,
          height: 72,
          child: Image.asset('assets/brand/botadmin-logo.png'),
        ),
      ),
    );
  }
}

class _NativeSplashLoadingScreen extends StatefulWidget {
  const _NativeSplashLoadingScreen({required this.isDark});

  final bool isDark;

  @override
  State<_NativeSplashLoadingScreen> createState() =>
      _NativeSplashLoadingScreenState();
}

class _NativeSplashLoadingScreenState
    extends State<_NativeSplashLoadingScreen> {
  Timer? _timer;
  var _progress = 12;
  var _tick = 0;

  static const _messages = [
    'Preparando sistema...',
    'Conferindo sessão segura...',
    'Carregando configurações...',
    'Preparando conversas...',
    'Sincronizando mídias...',
  ];

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 140), (_) {
      if (!mounted) return;
      setState(() {
        _tick += 1;
        _progress = (_progress + 4).clamp(12, 94);
      });
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bg = widget.isDark
        ? const Color(0xFF0B141A)
        : const Color(0xFFF0F2F5);
    final message = _messages[(_tick ~/ 7) % _messages.length];
    return Scaffold(
      backgroundColor: bg,
      body: _NativeAuthLoadingContent(
        text: message,
        detail: '$_progress%',
        isDark: widget.isDark,
      ),
    );
  }
}

class _NativeDashboardBootGate extends ConsumerStatefulWidget {
  const _NativeDashboardBootGate({required this.child});

  final Widget child;

  @override
  ConsumerState<_NativeDashboardBootGate> createState() =>
      _NativeDashboardBootGateState();
}

class _NativeDashboardBootGateState
    extends ConsumerState<_NativeDashboardBootGate> {
  Timer? _timer;
  Timer? _handoffTimer;
  var _progress = 8;
  var _tick = 0;
  var _ready = false;
  var _finishing = false;

  static const _steps = [
    'Abrindo conexão segura...',
    'Carregando sua sessão...',
    'Buscando conversas recentes...',
    'Preparando fotos e prévias...',
    'Sincronizando atualizações...',
    'Montando painel...',
    'Finalizando experiência...',
  ];

  static const _waitingDetails = [
    'Organizando dados em segundo plano',
    'Conferindo perfis e grupos',
    'Preparando prévias de mídia',
    'Ajustando o painel para você',
  ];

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 110), (_) {
      if (!mounted || _ready) return;
      setState(() {
        _tick += 1;
        final boost = _progress < 55
            ? 6
            : _progress < 86
            ? 3
            : 1;
        _progress = (_progress + boost).clamp(8, _finishing ? 100 : 96);
      });
    });
    // The dashboard is already mounted underneath this gate. Do not hold it
    // behind an artificial splash: cached conversations should be interactive
    // as soon as the first snapshot is available.
    _handoffTimer = Timer(const Duration(milliseconds: 450), _finishNow);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _handoffTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Never block the dashboard behind a splash.  The dashboard provider now
    // restores its snapshot from disk first and refreshes in the background;
    // keeping this gate transparent makes cached conversations visible on the
    // very first frame, even when the network is offline.
    return widget.child;

    /*
    final session = ref.watch(authControllerProvider).value;
    final panelState = session?.user.isAdmin == true
        ? ref.watch(adminSupportThreadsProvider)
        : ref.watch(dashboardSnapshotProvider);
    final panelAnswered = panelState.hasValue || panelState.hasError;
    if (!_ready && panelAnswered) {
      _finishAfterNextFrame();
    }

    if (_ready) return widget.child;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? const Color(0xFF0B141A) : const Color(0xFFF0F2F5);
    final text = _steps[(_tick ~/ 8) % _steps.length];
    final detail = _progress >= 90 && !_finishing
        ? '$_progress% - ${_waitingDetails[(_tick ~/ 14) % _waitingDetails.length]}'
        : '$_progress%';
    return Stack(
      children: [
        Positioned.fill(child: widget.child),
        Positioned.fill(
          child: Scaffold(
            backgroundColor: bg,
            body: _NativeAuthLoadingContent(
              text: text,
              detail: detail,
              isDark: isDark,
            ),
          ),
        ),
      ],
    );
    */
  }

  void _finishAfterNextFrame() {
    if (_finishing || _ready) return;
    _finishing = true;
    _handoffTimer?.cancel();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Future<void>.delayed(const Duration(milliseconds: 220), () {
        _finishNow();
      });
    });
  }

  void _finishNow() {
    if (!mounted || _ready) return;
    _timer?.cancel();
    _handoffTimer?.cancel();
    setState(() {
      _progress = 100;
      _ready = true;
    });
    unawaited(maybeShowMobileUpdatePrompt(context, ref));
  }
}

class _UserDashboardSessionShell extends ConsumerStatefulWidget {
  const _UserDashboardSessionShell({
    required this.showAdminReturn,
    required this.child,
  });

  final bool showAdminReturn;
  final Widget child;

  @override
  ConsumerState<_UserDashboardSessionShell> createState() =>
      _UserDashboardSessionShellState();
}

class _UserDashboardSessionShellState
    extends ConsumerState<_UserDashboardSessionShell> {
  var _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Future<void>.delayed(const Duration(milliseconds: 900), () {
        if (!mounted) return;
        unawaited(maybeShowMobileUpdatePrompt(context, ref));
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.showAdminReturn) return widget.child;

    return Stack(
      children: [
        widget.child,
        Positioned(
          top: MediaQuery.paddingOf(context).top + 10,
          left: 0,
          right: 0,
          child: Center(
            child: Material(
              color: Colors.transparent,
              child: FilledButton.icon(
                onPressed: _busy ? null : _returnToAdmin,
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF00A884),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  elevation: 6,
                  shadowColor: Colors.black.withValues(alpha: 0.28),
                ),
                icon: _busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.swap_horiz_rounded),
                label: const Text('Voltar ao painel de origem'),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _returnToAdmin() async {
    setState(() => _busy = true);
    try {
      final session = await ref.read(apiClientProvider).revertImpersonation();
      ref.invalidate(resellerDashboardProvider);
      ref
          .read(partnerWorkspaceSectionProvider.notifier)
          .select(PartnerWorkspaceSection.overview);
      ref.read(authControllerProvider.notifier).setSession(session);
      if (mounted) {
        showSuccessToast(context, 'Painel administrativo restaurado.');
      }
      redirectToPath(
        session.user.isAdmin ? '/dashboard/admin' : '/dashboard/partner',
      );
    } catch (error) {
      if (mounted) showErrorToast(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _NativeLoginScreen extends ConsumerStatefulWidget {
  const _NativeLoginScreen({required this.isDark});

  final bool isDark;

  @override
  ConsumerState<_NativeLoginScreen> createState() => _NativeLoginScreenState();
}

class _NativeLoginScreenState extends ConsumerState<_NativeLoginScreen> {
  final _nameController = TextEditingController();
  final _identifierController = TextEditingController();
  final _whatsappController = TextEditingController();
  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  _NativeAuthMode _mode = _nativeAuthModeIntent.value;
  _NativeRecoveryChannel _recoveryChannel = _NativeRecoveryChannel.email;
  var _remember = true;
  var _obscure = true;
  var _busy = false;
  var _loadingStep = 0;
  Timer? _loadingTimer;
  Object? _error;
  String? _notice;
  Map<String, dynamic>? _pendingVerification;

  static const _loadingTexts = [
    'Validando acesso...',
    'Carregando configurações...',
    'Preparando painel...',
  ];

  String get _busyText {
    if (_mode == _NativeAuthMode.signIn) return _loadingTexts[_loadingStep];
    return _mode.busyLabel;
  }

  TextEditingController get _activeIdentifierController {
    if (_mode == _NativeAuthMode.recoverRequest &&
        _recoveryChannel == _NativeRecoveryChannel.whatsapp) {
      return _whatsappController;
    }
    return _identifierController;
  }

  String get _recoveryIdentifier =>
      _recoveryChannel == _NativeRecoveryChannel.email
      ? _identifierController.text.trim()
      : _whatsappController.text.trim();

  String get _recoveryDestinationLabel =>
      _recoveryChannel == _NativeRecoveryChannel.email ? 'E-mail' : 'WhatsApp';

  @override
  void initState() {
    super.initState();
    _nativeAuthModeIntent.addListener(_applyAuthModeIntent);
    WidgetsBinding.instance.addPostFrameCallback((_) => signalAppReady());
  }

  void _applyAuthModeIntent() {
    if (!mounted || _mode == _nativeAuthModeIntent.value) return;
    _switchMode(_nativeAuthModeIntent.value, publishIntent: false);
  }

  @override
  void dispose() {
    _nativeAuthModeIntent.removeListener(_applyAuthModeIntent);
    _loadingTimer?.cancel();
    _nameController.dispose();
    _identifierController.dispose();
    _whatsappController.dispose();
    _codeController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final busy = _busy || auth.isLoading;
    final bg = widget.isDark
        ? const Color(0xFF0B141A)
        : const Color(0xFFF0F2F5);
    final card = widget.isDark ? const Color(0xFF111B21) : Colors.white;
    final muted = widget.isDark
        ? const Color(0xFF8696A0)
        : const Color(0xFF667781);

    return Scaffold(
      backgroundColor: bg,
      body: Stack(
        children: [
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(22),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 430),
                  child: Material(
                    color: card,
                    borderRadius: BorderRadius.circular(22),
                    elevation: widget.isDark ? 0 : 12,
                    shadowColor: Colors.black.withValues(alpha: 0.12),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(22, 24, 22, 22),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Center(
                              child: Image.asset(
                                'assets/brand/botadmin-logo.png',
                                width: 78,
                                height: 78,
                                fit: BoxFit.contain,
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              _mode.title,
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.headlineSmall
                                  ?.copyWith(fontWeight: FontWeight.w800),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _mode.subtitle,
                              textAlign: TextAlign.center,
                              style: Theme.of(
                                context,
                              ).textTheme.bodyMedium?.copyWith(color: muted),
                            ),
                            const SizedBox(height: 22),
                            if (_mode == _NativeAuthMode.signUp) ...[
                              TextFormField(
                                controller: _nameController,
                                enabled: !busy,
                                textInputAction: TextInputAction.next,
                                autofillHints: const [AutofillHints.name],
                                decoration: const InputDecoration(
                                  labelText: 'Nome',
                                  prefixIcon: Icon(Icons.badge_outlined),
                                ),
                                validator: (value) =>
                                    _mode == _NativeAuthMode.signUp &&
                                        (value ?? '').trim().isEmpty
                                    ? 'Informe seu nome.'
                                    : null,
                              ),
                              const SizedBox(height: 14),
                            ],
                            if (_mode == _NativeAuthMode.recoverRequest) ...[
                              _NativeRecoveryChannelPicker(
                                value: _recoveryChannel,
                                enabled: !busy,
                                onChanged: (value) =>
                                    setState(() => _recoveryChannel = value),
                              ),
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _activeIdentifierController,
                                enabled: !busy,
                                keyboardType:
                                    _recoveryChannel ==
                                        _NativeRecoveryChannel.email
                                    ? TextInputType.emailAddress
                                    : TextInputType.phone,
                                textInputAction: TextInputAction.done,
                                autofillHints:
                                    _recoveryChannel ==
                                        _NativeRecoveryChannel.email
                                    ? const [AutofillHints.email]
                                    : const [AutofillHints.telephoneNumber],
                                onFieldSubmitted: (_) => _submit(),
                                decoration: InputDecoration(
                                  labelText:
                                      _recoveryChannel ==
                                          _NativeRecoveryChannel.email
                                      ? 'E-mail cadastrado'
                                      : 'WhatsApp cadastrado',
                                  prefixIcon: Icon(
                                    _recoveryChannel ==
                                            _NativeRecoveryChannel.email
                                        ? Icons.mail_outline
                                        : Icons.chat_outlined,
                                  ),
                                ),
                                validator: (value) {
                                  final clean = (value ?? '').trim();
                                  if (clean.isEmpty) {
                                    return _recoveryChannel ==
                                            _NativeRecoveryChannel.email
                                        ? 'Informe seu e-mail.'
                                        : 'Informe seu WhatsApp.';
                                  }
                                  if (_recoveryChannel ==
                                          _NativeRecoveryChannel.email &&
                                      !clean.contains('@')) {
                                    return 'Informe um e-mail válido.';
                                  }
                                  if (_recoveryChannel ==
                                          _NativeRecoveryChannel.whatsapp &&
                                      clean
                                              .replaceAll(RegExp(r'\D+'), '')
                                              .length <
                                          10) {
                                    return 'Informe um WhatsApp válido.';
                                  }
                                  return null;
                                },
                              ),
                            ] else if (_mode ==
                                _NativeAuthMode.recoverReset) ...[
                              _NativeRecoveryDestination(
                                channelLabel: _recoveryDestinationLabel,
                                value: _recoveryIdentifier,
                                enabled: !busy,
                                onChange: () =>
                                    _switchMode(_NativeAuthMode.recoverRequest),
                              ),
                            ] else ...[
                              TextFormField(
                                controller: _identifierController,
                                enabled: !busy,
                                keyboardType: TextInputType.emailAddress,
                                textInputAction: TextInputAction.next,
                                autofillHints: const [
                                  AutofillHints.email,
                                  AutofillHints.telephoneNumber,
                                  AutofillHints.username,
                                ],
                                decoration: InputDecoration(
                                  labelText: _mode == _NativeAuthMode.signUp
                                      ? 'E-mail'
                                      : 'E-mail ou WhatsApp',
                                  prefixIcon: const Icon(Icons.person_outline),
                                ),
                                validator: (value) {
                                  if ((value ?? '').trim().isEmpty) {
                                    return _mode == _NativeAuthMode.signUp
                                        ? 'Informe seu e-mail.'
                                        : 'Informe seu acesso.';
                                  }
                                  return null;
                                },
                              ),
                            ],
                            if (_mode == _NativeAuthMode.signUp) ...[
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _whatsappController,
                                enabled: !busy,
                                keyboardType: TextInputType.phone,
                                textInputAction: TextInputAction.next,
                                autofillHints: const [
                                  AutofillHints.telephoneNumber,
                                ],
                                decoration: const InputDecoration(
                                  labelText: 'WhatsApp',
                                  prefixIcon: Icon(Icons.chat_outlined),
                                ),
                                validator: (value) =>
                                    _mode == _NativeAuthMode.signUp &&
                                        (value ?? '')
                                                .replaceAll(RegExp(r'\D+'), '')
                                                .length <
                                            10
                                    ? 'Informe seu WhatsApp.'
                                    : null,
                              ),
                            ],
                            if (_mode != _NativeAuthMode.recoverRequest &&
                                _mode != _NativeAuthMode.recoverReset) ...[
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _passwordController,
                                enabled: !busy,
                                obscureText: _obscure,
                                textInputAction: TextInputAction.done,
                                autofillHints: const [AutofillHints.password],
                                onFieldSubmitted: (_) => _submit(),
                                decoration: InputDecoration(
                                  labelText:
                                      _mode == _NativeAuthMode.recoverReset
                                      ? 'Nova senha'
                                      : 'Senha',
                                  prefixIcon: const Icon(Icons.lock_outline),
                                  suffixIcon: IconButton(
                                    onPressed: busy
                                        ? null
                                        : () => setState(
                                            () => _obscure = !_obscure,
                                          ),
                                    icon: Icon(
                                      _obscure
                                          ? Icons.visibility_outlined
                                          : Icons.visibility_off_outlined,
                                    ),
                                  ),
                                ),
                                validator: (value) => (value ?? '').length < 6
                                    ? 'A senha precisa ter pelo menos 6 caracteres.'
                                    : null,
                              ),
                            ],
                            if (_mode == _NativeAuthMode.recoverReset) ...[
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _codeController,
                                enabled: !busy,
                                keyboardType: TextInputType.number,
                                textInputAction: TextInputAction.next,
                                decoration: const InputDecoration(
                                  labelText: 'Código recebido',
                                  prefixIcon: Icon(Icons.pin_outlined),
                                ),
                                validator: (value) =>
                                    (value ?? '')
                                            .replaceAll(RegExp(r'\D+'), '')
                                            .length <
                                        4
                                    ? 'Informe o código.'
                                    : null,
                              ),
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _passwordController,
                                enabled: !busy,
                                obscureText: _obscure,
                                textInputAction: TextInputAction.done,
                                autofillHints: const [
                                  AutofillHints.newPassword,
                                ],
                                onFieldSubmitted: (_) => _submit(),
                                decoration: InputDecoration(
                                  labelText: 'Nova senha',
                                  prefixIcon: const Icon(
                                    Icons.lock_reset_outlined,
                                  ),
                                  suffixIcon: IconButton(
                                    onPressed: busy
                                        ? null
                                        : () => setState(
                                            () => _obscure = !_obscure,
                                          ),
                                    icon: Icon(
                                      _obscure
                                          ? Icons.visibility_outlined
                                          : Icons.visibility_off_outlined,
                                    ),
                                  ),
                                ),
                                validator: (value) => (value ?? '').length < 6
                                    ? 'A senha precisa ter pelo menos 6 caracteres.'
                                    : null,
                              ),
                            ],
                            if (_mode == _NativeAuthMode.signIn) ...[
                              const SizedBox(height: 10),
                              SwitchListTile.adaptive(
                                contentPadding: EdgeInsets.zero,
                                title: const Text('Manter conectado'),
                                value: _remember,
                                onChanged: busy
                                    ? null
                                    : (value) =>
                                          setState(() => _remember = value),
                              ),
                            ],
                            if (_pendingVerification != null) ...[
                              const SizedBox(height: 14),
                              _WhatsappVerificationCard(
                                verification: _pendingVerification!,
                                onOpen: _openPendingWhatsapp,
                              ),
                            ],
                            if (_notice != null) ...[
                              const SizedBox(height: 10),
                              Text(
                                _notice!,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  color: Color(0xFF008069),
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                            if (_error != null) ...[
                              const SizedBox(height: 8),
                              Text(
                                _friendlyError(_error),
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                            const SizedBox(height: 18),
                            FilledButton.icon(
                              onPressed: busy ? null : _submit,
                              style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(52),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16),
                                ),
                              ),
                              icon: busy
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : Icon(_mode.actionIcon),
                              label: Text(
                                busy ? _mode.busyLabel : _mode.actionLabel,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Wrap(
                              alignment: WrapAlignment.center,
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                if (_mode != _NativeAuthMode.signIn)
                                  _NativeAuthLinkButton(
                                    label: 'Entrar',
                                    onPressed: busy
                                        ? null
                                        : () => _switchMode(
                                            _NativeAuthMode.signIn,
                                          ),
                                  ),
                                if (_mode != _NativeAuthMode.signUp)
                                  _NativeAuthLinkButton(
                                    label: 'Criar conta',
                                    onPressed: busy
                                        ? null
                                        : () => _switchMode(
                                            _NativeAuthMode.signUp,
                                          ),
                                  ),
                                if (_mode != _NativeAuthMode.recoverRequest &&
                                    _mode != _NativeAuthMode.recoverReset)
                                  _NativeAuthLinkButton(
                                    label: 'Recuperar acesso',
                                    onPressed: busy
                                        ? null
                                        : () => _switchMode(
                                            _NativeAuthMode.recoverRequest,
                                          ),
                                  ),
                              ],
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
          if (busy)
            _NativeAuthLoadingOverlay(text: _busyText, isDark: widget.isDark),
        ],
      ),
    );
  }

  void _switchMode(_NativeAuthMode mode, {bool publishIntent = true}) {
    if (publishIntent && _nativeAuthModeIntent.value != mode) {
      _nativeAuthModeIntent.value = mode;
    }
    setState(() {
      _mode = mode;
      _error = null;
      _notice = null;
      _pendingVerification = null;
      _loadingStep = 0;
    });
  }

  void _startBusy() {
    _loadingTimer?.cancel();
    setState(() {
      _busy = true;
      _loadingStep = 0;
      _error = null;
      _notice = null;
    });
    _loadingTimer = Timer.periodic(const Duration(milliseconds: 900), (_) {
      if (!mounted || !_busy) return;
      setState(() => _loadingStep = (_loadingStep + 1) % _loadingTexts.length);
    });
  }

  void _stopBusy() {
    _loadingTimer?.cancel();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _submit() async {
    if (_busy || !_formKey.currentState!.validate()) return;
    _startBusy();
    try {
      switch (_mode) {
        case _NativeAuthMode.signIn:
          await ref
              .read(authControllerProvider.notifier)
              .login(
                _identifierController.text.trim(),
                _passwordController.text,
                remember: _remember,
              );
          final auth = ref.read(authControllerProvider);
          if (auth.hasError) throw auth.error!;
          break;
        case _NativeAuthMode.signUp:
          final json = await ref
              .read(apiClientProvider)
              .registerAccount(
                name: _nameController.text.trim(),
                email: _identifierController.text.trim(),
                whatsappNumber: _whatsappController.text.trim(),
                password: _passwordController.text,
              );
          final verification = json['verification'];
          if (verification is Map) {
            setState(() {
              _pendingVerification = Map<String, dynamic>.from(verification);
              _notice =
                  json['message']?.toString() ??
                  'Confirme o cadastro pelo WhatsApp.';
            });
          } else {
            ref.invalidate(authControllerProvider);
          }
          break;
        case _NativeAuthMode.recoverRequest:
          final json = await ref
              .read(apiClientProvider)
              .requestPasswordRecovery(identifier: _recoveryIdentifier);
          setState(() {
            _mode = _NativeAuthMode.recoverReset;
            _notice =
                json['message']?.toString() ??
                'Enviamos o código para recuperar seu acesso.';
          });
          break;
        case _NativeAuthMode.recoverReset:
          final json = await ref
              .read(apiClientProvider)
              .resetPasswordWithCode(
                identifier: _recoveryIdentifier,
                code: _codeController.text.trim(),
                password: _passwordController.text,
              );
          setState(() {
            _mode = _NativeAuthMode.signIn;
            _passwordController.clear();
            _codeController.clear();
            _notice =
                json['message']?.toString() ??
                'Senha alterada. Entre com a nova senha.';
          });
          break;
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      _stopBusy();
    }
  }

  Future<void> _openPendingWhatsapp() async {
    final url = _pendingVerification?['whatsappUrl']?.toString();
    if (url == null || url.trim().isEmpty) return;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  String _friendlyError(Object? error) {
    final raw = error?.toString().trim() ?? '';
    if (raw.isEmpty) return 'Não foi possível concluir agora.';
    final lower = raw.toLowerCase();
    if (lower.contains('failed host lookup') ||
        lower.contains('socketexception') ||
        lower.contains('connection error')) {
      return 'Sem conexão com o BotAdmin agora. Verifique a internet e tente novamente.';
    }
    final cleaned = raw
        .replaceFirst(RegExp(r'^BotAdminApiException:\s*'), '')
        .replaceFirst(RegExp(r'^Exception:\s*'), '');
    return cleaned.length > 140 ? '${cleaned.substring(0, 137)}...' : cleaned;
  }
}

enum _NativeAuthMode {
  signIn,
  signUp,
  recoverRequest,
  recoverReset;

  String get title => switch (this) {
    _NativeAuthMode.signIn => 'Bot Admin',
    _NativeAuthMode.signUp => 'Criar conta',
    _NativeAuthMode.recoverRequest => 'Recuperar acesso',
    _NativeAuthMode.recoverReset => 'Nova senha',
  };

  String get subtitle => switch (this) {
    _NativeAuthMode.signIn => 'Entre para acessar seu painel.',
    _NativeAuthMode.signUp => 'Cadastre e confirme pelo WhatsApp.',
    _NativeAuthMode.recoverRequest => 'Receba o código por e-mail ou WhatsApp.',
    _NativeAuthMode.recoverReset => 'Informe o código e defina a nova senha.',
  };

  String get actionLabel => switch (this) {
    _NativeAuthMode.signIn => 'Entrar',
    _NativeAuthMode.signUp => 'Criar conta',
    _NativeAuthMode.recoverRequest => 'Enviar código',
    _NativeAuthMode.recoverReset => 'Alterar senha',
  };

  String get busyLabel => switch (this) {
    _NativeAuthMode.signIn => 'Entrando...',
    _NativeAuthMode.signUp => 'Criando conta...',
    _NativeAuthMode.recoverRequest => 'Enviando...',
    _NativeAuthMode.recoverReset => 'Salvando...',
  };

  IconData get actionIcon => switch (this) {
    _NativeAuthMode.signIn => Icons.login_outlined,
    _NativeAuthMode.signUp => Icons.person_add_alt_1_outlined,
    _NativeAuthMode.recoverRequest => Icons.mark_email_read_outlined,
    _NativeAuthMode.recoverReset => Icons.lock_reset_outlined,
  };
}

final ValueNotifier<_NativeAuthMode> _nativeAuthModeIntent =
    ValueNotifier<_NativeAuthMode>(_NativeAuthMode.signIn);

enum _NativeRecoveryChannel {
  email,
  whatsapp;

  String get label => switch (this) {
    _NativeRecoveryChannel.email => 'E-mail',
    _NativeRecoveryChannel.whatsapp => 'WhatsApp',
  };

  IconData get icon => switch (this) {
    _NativeRecoveryChannel.email => Icons.mail_outline,
    _NativeRecoveryChannel.whatsapp => Icons.chat_outlined,
  };
}

class _NativeRecoveryChannelPicker extends StatelessWidget {
  const _NativeRecoveryChannelPicker({
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final _NativeRecoveryChannel value;
  final bool enabled;
  final ValueChanged<_NativeRecoveryChannel> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<_NativeRecoveryChannel>(
      segments: _NativeRecoveryChannel.values
          .map(
            (channel) => ButtonSegment(
              value: channel,
              icon: Icon(channel.icon),
              label: Text(channel.label),
            ),
          )
          .toList(),
      selected: {value},
      onSelectionChanged: enabled
          ? (selected) => onChanged(selected.first)
          : null,
      style: ButtonStyle(
        visualDensity: VisualDensity.compact,
        padding: WidgetStateProperty.all(
          const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        ),
      ),
    );
  }
}

class _NativeRecoveryDestination extends StatelessWidget {
  const _NativeRecoveryDestination({
    required this.channelLabel,
    required this.value,
    required this.enabled,
    required this.onChange,
  });

  final String channelLabel;
  final String value;
  final bool enabled;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final muted = colors.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: const Color(0xFF00A884).withValues(alpha: 0.14),
            child: const Icon(
              Icons.mark_email_read_outlined,
              color: Color(0xFF008069),
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Código enviado por $channelLabel',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: muted),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: enabled ? onChange : null,
            child: const Text('Trocar'),
          ),
        ],
      ),
    );
  }
}

class _NativeAuthLinkButton extends StatelessWidget {
  const _NativeAuthLinkButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        minimumSize: const Size(132, 46),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
      ),
      child: Text(label),
    );
  }
}

class _NativeAuthLoadingOverlay extends StatelessWidget {
  const _NativeAuthLoadingOverlay({required this.text, required this.isDark});

  final String text;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final bg = isDark ? const Color(0xEE0B141A) : const Color(0xEEF7F9FA);

    return Positioned.fill(
      child: AbsorbPointer(
        child: DecoratedBox(
          decoration: BoxDecoration(color: bg),
          child: _NativeAuthLoadingContent(
            text: text,
            detail: 'Preparando uma sessão segura.',
            isDark: isDark,
          ),
        ),
      ),
    );
  }
}

class _NativeAuthLoadingContent extends StatelessWidget {
  const _NativeAuthLoadingContent({
    required this.text,
    required this.detail,
    required this.isDark,
  });

  final String text;
  final String detail;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final card = isDark ? const Color(0xFF111B21) : Colors.white;
    final textColor = isDark
        ? const Color(0xFFE9EDEF)
        : const Color(0xFF111B21);
    final muted = isDark ? const Color(0xFF8696A0) : const Color(0xFF667781);
    return Center(
      child: Container(
        width: 258,
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
        decoration: BoxDecoration(
          color: card,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.18),
              blurRadius: 26,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 116,
              height: 116,
              child: Lottie.asset(
                'assets/brand/botadmin-robot.json',
                repeat: true,
                animate: true,
                fit: BoxFit.contain,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              text,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: textColor,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: muted,
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WhatsappVerificationCard extends StatelessWidget {
  const _WhatsappVerificationCard({
    required this.verification,
    required this.onOpen,
  });

  final Map<String, dynamic> verification;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final code = verification['code']?.toString() ?? '';
    final target = verification['targetWhatsappNumber']?.toString() ?? '';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFE8F7F0),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFB8E7D4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.verified_outlined, color: Color(0xFF008069)),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Confirmar cadastro via WhatsApp',
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          if (target.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(target, textAlign: TextAlign.center),
          ],
          if (code.isNotEmpty) ...[
            const SizedBox(height: 12),
            SelectableText(
              code,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                color: const Color(0xFF111B21),
                fontWeight: FontWeight.w900,
                letterSpacing: 2,
              ),
            ),
          ],
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onOpen,
            icon: const Icon(Icons.open_in_new),
            label: const Text('Confirmar pelo WhatsApp'),
          ),
        ],
      ),
    );
  }
}

class _BridgeScreen extends StatelessWidget {
  const _BridgeScreen({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final bg = isDark ? const Color(0xFF0B141A) : const Color(0xFFF0F2F5);
    return Scaffold(
      backgroundColor: bg,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              'assets/brand/botadmin-logo.png',
              width: 72,
              height: 72,
              fit: BoxFit.contain,
            ),
            const SizedBox(height: 18),
            const SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
            const SizedBox(height: 14),
            Text(
              'Restaurando sua sessão...',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 5),
            Text(
              'Preparando o painel BotAdmin',
              style: TextStyle(fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}
