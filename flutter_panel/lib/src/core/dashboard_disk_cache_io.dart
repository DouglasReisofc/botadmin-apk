import 'dart:io';

import 'package:path_provider/path_provider.dart';

Future<File> _cacheFile(String prefix, String key) async {
  final directory = await getApplicationSupportDirectory();
  final safeKey = key.replaceAll(RegExp(r'[^a-zA-Z0-9_.-]'), '_');
  return File('${directory.path}/${prefix}_$safeKey.json');
}

Future<String?> readDashboardDiskCache(String key) async {
  try {
    final file = await _cacheFile('dashboard', key);
    if (!await file.exists()) return null;
    final value = await file.readAsString();
    return value.trim().isEmpty ? null : value;
  } catch (_) {
    return null;
  }
}

Future<String?> readBotAdminDiskCache(String key) async {
  try {
    final file = await _cacheFile('botadmin', key);
    if (!await file.exists()) return null;
    final value = await file.readAsString();
    return value.trim().isEmpty ? null : value;
  } catch (_) {
    return null;
  }
}

Future<String?> readPartnerDiskCache(String key) async {
  try {
    final file = await _cacheFile('partner', key);
    if (!await file.exists()) return null;
    final value = await file.readAsString();
    return value.trim().isEmpty ? null : value;
  } catch (_) {
    return null;
  }
}

Future<void> writeDashboardDiskCache(String key, String value) async {
  try {
    final file = await _cacheFile('dashboard', key);
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(value, flush: true);
    await temporary.rename(file.path);
  } catch (_) {
    // Cache is an optimisation; never block the dashboard on disk I/O.
  }
}

Future<void> writeBotAdminDiskCache(String key, String value) async {
  try {
    final file = await _cacheFile('botadmin', key);
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(value, flush: true);
    await temporary.rename(file.path);
  } catch (_) {}
}

Future<void> writePartnerDiskCache(String key, String value) async {
  try {
    final file = await _cacheFile('partner', key);
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(value, flush: true);
    await temporary.rename(file.path);
  } catch (_) {
    // Cache is best effort and must never delay the partner workspace.
  }
}

Future<void> clearDashboardDiskCache(String key) async {
  try {
    final file = await _cacheFile('dashboard', key);
    if (await file.exists()) await file.delete();
  } catch (_) {}
}

Future<void> clearBotAdminDiskCache(String key) async {
  try {
    final file = await _cacheFile('botadmin', key);
    if (await file.exists()) await file.delete();
  } catch (_) {}
}

Future<void> clearPartnerDiskCache(String key) async {
  try {
    final file = await _cacheFile('partner', key);
    if (await file.exists()) await file.delete();
  } catch (_) {}
}
