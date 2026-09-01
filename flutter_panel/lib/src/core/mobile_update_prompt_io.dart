import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:flutter/services.dart';

import 'app_config.dart';
import 'top_toast.dart';

bool _updatePromptShown = false;
const _nativeUpdateChannel = MethodChannel('botadmin/native');

class _GithubMobileUpdate {
  const _GithubMobileUpdate({
    required this.versionName,
    required this.versionCode,
    required this.downloadUrl,
  });

  final String versionName;
  final int versionCode;
  final String? downloadUrl;
}

Future<void> maybeShowMobileUpdatePrompt(
  BuildContext context,
  WidgetRef _,
) async {
  if (_updatePromptShown || !Platform.isAndroid) return;

  try {
    final info = await PackageInfo.fromPlatform();
    final currentCode = int.tryParse(info.buildNumber.trim()) ?? 0;
    final update = await _loadMobileUpdate(currentCode);
    if (update == null ||
        update.versionCode <= currentCode ||
        _isSameOrOlderVersion(update.versionName, info.version)) {
      return;
    }
    if (!context.mounted) return;

    _updatePromptShown = true;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => _MobileUpdateDialog(
        versionName: update.versionName,
        versionCode: update.versionCode,
        currentCode: currentCode,
        downloadUrl: update.downloadUrl,
      ),
    );
  } catch (error) {
    // A checagem é automática e não deve interromper o usuário nem expor
    // detalhes internos do Dio quando a rede/GitHub oscilar. Uma nova
    // tentativa acontecerá na próxima inicialização.
    debugPrint('[mobile-update] verificação indisponível: $error');
  }
}

bool _isSameOrOlderVersion(String candidate, String current) {
  List<int> parts(String value) => RegExp(
    r'\d+',
  ).allMatches(value).map((match) => int.parse(match.group(0)!)).toList();

  final next = parts(candidate);
  final installed = parts(current);
  if (next.isEmpty || installed.isEmpty) return false;
  final length = next.length > installed.length
      ? next.length
      : installed.length;
  for (var index = 0; index < length; index++) {
    final left = index < next.length ? next[index] : 0;
    final right = index < installed.length ? installed[index] : 0;
    if (left != right) return left < right;
  }
  return true;
}

Future<_GithubMobileUpdate?> _loadMobileUpdate(int currentCode) async {
  final dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 18),
      sendTimeout: const Duration(seconds: 12),
    ),
  );

  // O servidor do BotAdmin consulta e normaliza a release do GitHub. Isso
  // evita rate limit/403 do GitHub diretamente no aparelho e mantém um único
  // endpoint confiável para todos os APKs.
  try {
    final base = Uri.parse(AppConfig.apiBaseUrl);
    final endpoint = base
        .resolve('/api/mobile/update')
        .replace(queryParameters: {'currentVersionCode': '$currentCode'});
    final response = await dio.get<Object?>(
      endpoint.toString(),
      options: Options(
        responseType: ResponseType.json,
        followRedirects: true,
        validateStatus: (status) =>
            status != null && status >= 200 && status < 300,
        headers: const {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      ),
    );
    final update = _parseBotAdminUpdate(response.data);
    if (update != null) return update;
  } catch (error) {
    debugPrint('[mobile-update] endpoint BotAdmin indisponível: $error');
  }

  // Compatibilidade de contingência para instalações antigas/ambientes em
  // que o endpoint próprio ainda não esteja publicado.
  try {
    return await _loadGithubMobileUpdate(dio);
  } catch (error) {
    debugPrint('[mobile-update] fallback GitHub indisponível: $error');
    return null;
  }
}

_GithubMobileUpdate? _parseBotAdminUpdate(Object? raw) {
  final payload = raw is Map ? Map<String, dynamic>.from(raw) : null;
  final androidRaw = payload?['android'];
  final android = androidRaw is Map
      ? Map<String, dynamic>.from(androidRaw)
      : null;
  final latestRaw = android?['latest'];
  final latest = latestRaw is Map ? Map<String, dynamic>.from(latestRaw) : null;
  if (latest == null) return null;

  final rawCode = latest['versionCode'];
  final versionCode = rawCode is num
      ? rawCode.toInt()
      : int.tryParse(rawCode?.toString() ?? '') ?? 0;
  if (versionCode <= 0) return null;

  final downloadUrl =
      latest['downloadUrl']?.toString().trim() ??
      latest['url']?.toString().trim();
  if (downloadUrl == null || downloadUrl.isEmpty) return null;

  return _GithubMobileUpdate(
    versionName: latest['versionName']?.toString().trim() ?? '',
    versionCode: versionCode,
    downloadUrl: downloadUrl,
  );
}

Future<_GithubMobileUpdate?> _loadGithubMobileUpdate(Dio dio) async {
  final response = await dio.get<Object?>(
    AppConfig.mobileUpdateGithubLatestUrl,
    options: Options(
      responseType: ResponseType.json,
      followRedirects: true,
      validateStatus: (status) =>
          status != null && status >= 200 && status < 300,
      headers: const {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'BotAdminFlutterUpdate/1.0',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    ),
  );

  final payload = response.data;
  final release = payload is Map
      ? Map<String, dynamic>.from(payload)
      : payload is String
      ? Map<String, dynamic>.from(jsonDecode(payload) as Map)
      : null;
  if (release == null ||
      release['draft'] == true ||
      release['prerelease'] == true) {
    return null;
  }

  final assets = release['assets'] is List
      ? (release['assets'] as List)
            .whereType<Map>()
            .map((asset) => Map<String, dynamic>.from(asset))
            .where((asset) => _isApkAsset(asset))
            .toList()
      : <Map<String, dynamic>>[];
  assets.sort((left, right) {
    final leftBotAdmin = _assetName(left).toLowerCase().contains('botadmin')
        ? 1
        : 0;
    final rightBotAdmin = _assetName(right).toLowerCase().contains('botadmin')
        ? 1
        : 0;
    return rightBotAdmin.compareTo(leftBotAdmin);
  });
  final asset = assets.firstOrNull;
  if (asset == null) return null;

  final body = release['body']?.toString() ?? '';
  final versionCode =
      _releaseNumber(body, const [
        'versionCode',
        'version_code',
        'codigo',
        'código',
      ]) ??
      _versionCodeFromText(_assetName(asset)) ??
      _versionCodeFromText(release['tag_name']) ??
      0;
  if (versionCode <= 0) return null;

  final versionName =
      _releaseString(body, const [
        'versionName',
        'version',
        'versao',
        'versão',
      ]) ??
      _versionNameFromTag(release['tag_name']) ??
      '';

  return _GithubMobileUpdate(
    versionName: versionName,
    versionCode: versionCode,
    downloadUrl: asset['browser_download_url']?.toString(),
  );
}

bool _isApkAsset(Map<String, dynamic> asset) {
  final name = _assetName(asset).toLowerCase();
  final url = asset['browser_download_url']?.toString().toLowerCase() ?? '';
  return (name.endsWith('.apk') || url.endsWith('.apk')) &&
      (asset['browser_download_url']?.toString().trim().isNotEmpty ?? false);
}

String _assetName(Map<String, dynamic> asset) =>
    asset['name']?.toString() ?? '';

String? _releaseString(String body, List<String> keys) {
  for (final key in keys) {
    final pattern = RegExp(
      '^\\s*${RegExp.escape(key)}\\s*[:=]\\s*(.+?)\\s*\\\$',
      multiLine: true,
      caseSensitive: false,
    );
    final value = pattern
        .firstMatch(body)
        ?.group(1)
        ?.trim()
        .replaceAll(RegExp(r'''^["']|["']$'''), '');
    if (value != null && value.isNotEmpty) return value;
  }
  return null;
}

int? _releaseNumber(String body, List<String> keys) {
  final value = _releaseString(body, keys);
  final parsed = int.tryParse(value ?? '');
  return parsed != null && parsed > 0 ? parsed : null;
}

int? _versionCodeFromText(Object? value) {
  final text = value?.toString() ?? '';
  final match = RegExp(
    r'(?:versionCode|version_code|code|codigo|código)[\s._-]*(\d+)|\+(\d+)(?:\D|$)',
    caseSensitive: false,
  ).firstMatch(text);
  final parsed = int.tryParse(match?.group(1) ?? match?.group(2) ?? '');
  return parsed != null && parsed > 0 ? parsed : null;
}

String? _versionNameFromTag(Object? value) {
  final tag = value?.toString().trim() ?? '';
  if (tag.isEmpty) return null;
  final clean = tag.replaceFirst(RegExp(r'^v', caseSensitive: false), '');
  return clean
      .replaceFirst(RegExp(r'-?code\d+$', caseSensitive: false), '')
      .trim();
}

class _MobileUpdateDialog extends StatefulWidget {
  const _MobileUpdateDialog({
    required this.versionName,
    required this.versionCode,
    required this.currentCode,
    required this.downloadUrl,
  });

  final String versionName;
  final int versionCode;
  final int currentCode;
  final String? downloadUrl;

  @override
  State<_MobileUpdateDialog> createState() => _MobileUpdateDialogState();
}

class _NativeUpdateDownload {
  const _NativeUpdateDownload({
    required this.status,
    required this.receivedBytes,
    required this.totalBytes,
    required this.canInstall,
  });

  final String status;
  final int receivedBytes;
  final int totalBytes;
  final bool canInstall;

  bool get downloading =>
      status == 'pending' || status == 'running' || status == 'paused';

  double get progress =>
      totalBytes > 0 ? (receivedBytes / totalBytes).clamp(0.0, 1.0) : 0;

  factory _NativeUpdateDownload.from(Object? raw) {
    final map = raw is Map ? Map<Object?, Object?>.from(raw) : const {};
    return _NativeUpdateDownload(
      status: map['status']?.toString() ?? 'not_found',
      receivedBytes: (map['receivedBytes'] as num?)?.toInt() ?? 0,
      totalBytes: (map['totalBytes'] as num?)?.toInt() ?? 0,
      canInstall: map['canInstall'] == true,
    );
  }
}

class _MobileUpdateDialogState extends State<_MobileUpdateDialog>
    with WidgetsBindingObserver {
  Timer? _statusTimer;
  var _status = 'not_found';
  var _progress = 0.0;

  bool get _downloading =>
      _status == 'pending' || _status == 'running' || _status == 'paused';
  bool get _readyToInstall => _status == 'successful';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refreshDownloadStatus());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_refreshDownloadStatus());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _statusTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return PopScope(
      canPop: false,
      child: AlertDialog(
        icon: Icon(Icons.system_update_rounded, color: scheme.primary),
        title: const Text('Atualização disponível'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Versão ${widget.versionName.isEmpty ? widget.versionCode : widget.versionName} pronta para instalar.',
            ),
            const SizedBox(height: 14),
            if (_downloading) ...[
              LinearProgressIndicator(value: _progress <= 0 ? null : _progress),
              const SizedBox(height: 8),
              Text(
                _progress <= 0
                    ? 'Baixando pacote...'
                    : '${(_progress * 100).clamp(0, 100).toStringAsFixed(0)}%',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              const Text(
                'Você pode deixar o BotAdmin em segundo plano. O Android continuará o download e, ao voltar, será necessário apenas instalar.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12.5),
              ),
            ] else if (_readyToInstall) ...[
              const Icon(Icons.download_done_rounded, size: 42),
              const SizedBox(height: 8),
              const Text(
                'Download concluído. O APK já está no aparelho e não será baixado novamente.',
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
        actions: [
          FilledButton.icon(
            onPressed: _downloading
                ? null
                : (_readyToInstall ? _installDownloaded : _startDownload),
            icon: Icon(
              _readyToInstall
                  ? Icons.install_mobile_rounded
                  : Icons.download_rounded,
            ),
            label: Text(
              _readyToInstall ? 'Instalar atualização' : 'Baixar atualização',
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _startDownload() async {
    final uri = _resolveDownloadUri(widget.downloadUrl);
    if (uri == null) {
      if (!mounted) return;
      showErrorToast(context, 'Link do APK invalido.');
      return;
    }

    setState(() => _status = 'pending');

    try {
      final raw = await _nativeUpdateChannel
          .invokeMethod<Object?>('startUpdateDownload', {
            'url': uri.toString(),
            'fileName': 'botadmin-${widget.versionCode}.apk',
            'versionCode': widget.versionCode,
          });
      if (!mounted) return;
      _applyDownload(_NativeUpdateDownload.from(raw));
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = 'failed');
      showErrorToast(context, 'Falha ao iniciar atualização: $error');
    }
  }

  Future<void> _refreshDownloadStatus() async {
    try {
      final raw = await _nativeUpdateChannel.invokeMethod<Object?>(
        'getUpdateDownloadStatus',
        {'versionCode': widget.versionCode},
      );
      if (!mounted) return;
      _applyDownload(_NativeUpdateDownload.from(raw));
    } catch (_) {
      // Uma versão anterior do APK ainda pode não expor o canal nativo.
    }
  }

  void _applyDownload(_NativeUpdateDownload download) {
    if (!mounted) return;
    setState(() {
      _status = download.status;
      _progress = download.progress;
    });
    _statusTimer?.cancel();
    if (download.downloading) {
      _statusTimer = Timer(
        const Duration(seconds: 1),
        () => unawaited(_refreshDownloadStatus()),
      );
    }
  }

  Future<void> _installDownloaded() async {
    try {
      final opened = await _nativeUpdateChannel.invokeMethod<bool>(
        'installDownloadedUpdate',
        {'versionCode': widget.versionCode},
      );
      if (!mounted) return;
      if (opened != true) {
        setState(() => _status = 'not_found');
        showErrorToast(
          context,
          'O arquivo não está mais disponível. Inicie o download novamente.',
        );
      }
    } catch (error) {
      if (!mounted) return;
      showErrorToast(context, 'Não foi possível abrir o instalador: $error');
    }
  }
}

Uri? _resolveDownloadUri(String? value) {
  final raw = value?.trim();
  if (raw == null || raw.isEmpty) return null;
  final parsed = Uri.tryParse(raw);
  if (parsed == null) return null;
  return parsed.hasScheme ? parsed : null;
}
