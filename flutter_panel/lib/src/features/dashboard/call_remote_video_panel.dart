import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../../core/api_client.dart';
import '../../models/bot_instance.dart';

Future<void> showCallRemoteVideoPanel(
  BuildContext context, {
  required BotInstance instance,
  required String callId,
}) => showDialog<void>(
  context: context,
  builder: (_) => CallRemoteVideoPanel(instance: instance, callId: callId),
);

class CallRemoteVideoPanel extends ConsumerStatefulWidget {
  const CallRemoteVideoPanel({
    super.key,
    required this.instance,
    required this.callId,
  });
  final BotInstance instance;
  final String callId;
  @override
  ConsumerState<CallRemoteVideoPanel> createState() => _RemoteVideoState();
}

class _RemoteVideoState extends ConsumerState<CallRemoteVideoPanel> {
  http.Client? _client;
  StreamSubscription<Uint8List>? _subscription;
  Timer? _timer;
  Uint8List? _frame;
  DateTime? _receivedAt;
  Map<String, dynamic> _status = {};
  String? _error;
  bool _polling = false;
  bool _streamEnded = false;
  int _generation = 0;
  @override
  void initState() {
    super.initState();
    _connect();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
  }

  void _connect() {
    final generation = ++_generation;
    _subscription?.cancel();
    _client?.close();
    _client = http.Client();
    _frame = null;
    _receivedAt = null;
    _error = null;
    _streamEnded = false;
    _subscription = ref
        .read(apiClientProvider)
        .callRemoteVideoFrames(widget.instance, widget.callId, _client!)
        .listen(
          (frame) {
            if (!mounted || generation != _generation) return;
            setState(() {
              _frame = frame;
              _receivedAt = DateTime.now();
              _error = null;
            });
          },
          onError: (Object error) {
            if (mounted && generation == _generation) {
              setState(() {
                _error = '$error';
                _streamEnded = true;
              });
            }
          },
          onDone: () {
            if (mounted && generation == _generation) {
              setState(() => _streamEnded = true);
            }
          },
        );
    unawaited(_poll());
  }

  Future<void> _poll() async {
    if (_polling) return;
    _polling = true;
    try {
      final s = await ref
          .read(apiClientProvider)
          .callRemoteVideoStatus(widget.instance, widget.callId);
      if (mounted) setState(() => _status = s);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      _polling = false;
    }
  }

  @override
  void dispose() {
    _generation++;
    _timer?.cancel();
    _subscription?.cancel();
    _client?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final stale =
        _receivedAt != null &&
        DateTime.now().difference(_receivedAt!) > const Duration(seconds: 3);
    final state = '${_status['state'] ?? 'waiting'}';
    final label = state == 'ended'
        ? 'Chamada encerrada'
        : _streamEnded
        ? 'Visualização desconectada'
        : _frame == null
        ? 'Aguardando vídeo do outro aparelho'
        : stale
        ? 'Sem novos quadros'
        : 'Vídeo remoto recebido';
    String number(String key) =>
        (_status[key] as num?)?.toStringAsFixed(1) ?? '—';
    return AlertDialog(
      title: const Text('Vídeo do outro aparelho'),
      content: SizedBox(
        width: 760,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AspectRatio(
                aspectRatio: 16 / 9,
                child: ColoredBox(
                  color: Colors.black,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (_frame != null)
                        Image.memory(
                          _frame!,
                          gaplessPlayback: true,
                          fit: BoxFit.contain,
                          errorBuilder: (_, _, _) => const Center(
                            child: Text(
                              'Quadro inválido',
                              style: TextStyle(color: Colors.white),
                            ),
                          ),
                        ),
                      if (_frame == null)
                        const Center(
                          child: Icon(
                            Icons.videocam_outlined,
                            color: Colors.white54,
                            size: 52,
                          ),
                        ),
                      if (stale || _frame == null || _streamEnded)
                        Align(
                          alignment: Alignment.bottomCenter,
                          child: Container(
                            color: Colors.black87,
                            padding: const EdgeInsets.all(12),
                            child: Text(
                              label,
                              style: const TextStyle(color: Colors.white),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(label, key: const ValueKey('remote-video-state')),
              const SizedBox(height: 8),
              Text(
                'Origem: ${number('sourceFps')} FPS · Prévia: ${number('decodedFps')} FPS · Quadros: ${_status['framesReceived'] ?? 0}',
              ),
              Text(
                'Lacunas RTP: ${_status['packetsLost'] ?? 0} · Quadros descartados: ${_status['framesDropped'] ?? 0}',
              ),
              const SizedBox(height: 8),
              const Text(
                'A câmera ou o compartilhamento de tela precisa estar ativo no outro aparelho. A prévia é limitada a 10 FPS.',
                style: TextStyle(fontSize: 12),
              ),
              if (_error != null)
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              if (_status['error'] is String &&
                  '${_status['error']}'.isNotEmpty)
                Text(
                  '${_status['error']}',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => setState(_connect),
          child: const Text('Reconectar'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Fechar'),
        ),
      ],
    );
  }
}
