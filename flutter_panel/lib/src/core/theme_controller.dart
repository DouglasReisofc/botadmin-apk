import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'theme_storage.dart';

enum AppThemeMode { dark, clean }

const themeStorageKey = 'botadmin-theme';

AppThemeMode themeFromStorage(String? value) {
  if (value == 'dark') return AppThemeMode.dark;
  return AppThemeMode.clean;
}

String themeToStorage(AppThemeMode mode) =>
    mode == AppThemeMode.clean ? 'clean' : 'dark';

class ThemeController extends Notifier<AppThemeMode> {
  @override
  AppThemeMode build() {
    final stored = readThemeStorage(themeStorageKey);
    final mode = themeFromStorage(stored);
    // Garante atributo no DOM (web) e preferência persistida.
    writeThemeStorage(themeStorageKey, themeToStorage(mode));
    return mode;
  }

  void setTheme(AppThemeMode mode) {
    state = mode;
    writeThemeStorage(themeStorageKey, themeToStorage(mode));
  }

  void toggle() {
    setTheme(
      state == AppThemeMode.dark ? AppThemeMode.clean : AppThemeMode.dark,
    );
  }

  bool get isDark => state == AppThemeMode.dark;
}

final themeControllerProvider = NotifierProvider<ThemeController, AppThemeMode>(
  ThemeController.new,
);

Brightness brightnessFor(AppThemeMode mode) =>
    mode == AppThemeMode.dark ? Brightness.dark : Brightness.light;
