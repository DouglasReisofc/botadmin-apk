import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_panel/src/core/api_client.dart';
import 'package:flutter_panel/src/features/dashboard/call_video_panel.dart';
import 'package:flutter_panel/src/models/bot_instance.dart';

class _VideoApi extends Fake implements BotAdminApiClient {
  final stale = Completer<Map<String, dynamic>?>();
  int polls = 0;
  bool ended = false;
  Map<String, dynamic> player(String state) => {
    'state': state, 'name': 'Teste.mp4', 'positionSec': 10,
    'durationSec': 60, 'hasAudio': true, 'audioMode': 'media',
  };
  @override
  Future<List<Map<String, dynamic>>> callVideoLibrary(BotInstance i) async => [];
  @override
  Future<Map<String, dynamic>?> callVideoAction(BotInstance i, {
    required String action, required String callId, String? mediaId,
    bool loop = false, String audio = 'media', String quality = 'medium',
    bool replace = false,
  }) async {
    if (action == 'pause_video') return player('paused');
    if (ended) throw BotAdminApiException('no such call', statusCode: 410);
    polls++;
    if (polls == 1) return player('playing');
    return stale.future;
  }
}
Future<void> openPanel(WidgetTester tester, _VideoApi api) async {
  tester.view.physicalSize = const Size(1100, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(api)],
    child: MaterialApp(home: Builder(builder: (context) => Scaffold(
      body: TextButton(onPressed: () => showCallVideoPanel(context,
        instance: const BotInstance(id: 266, name: 'Alluka', sessionStatus: 'conectado'),
        callId: 'video-1'), child: const Text('Abrir')),
    ))),
  ));
  await tester.tap(find.text('Abrir'));
  await tester.pumpAndSettle();
  expect(find.text('Transmitindo'), findsOneWidget);
}
void main() {
  testWidgets('poll antigo não desfaz a pausa confirmada', (tester) async {
    final api = _VideoApi();
    await openPanel(tester, api);
    await tester.pump(const Duration(seconds: 2));
    expect(api.polls, 2);
    await tester.tap(find.text('Pausar'));
    await tester.pumpAndSettle();
    expect(find.text('Pausado'), findsOneWidget);
    api.stale.complete(api.player('playing'));
    await tester.pumpAndSettle();
    expect(find.text('Pausado'), findsOneWidget);
    expect(find.text('Retomar'), findsOneWidget);
    await tester.tap(find.text('Fechar'));
    await tester.pumpAndSettle();
  });
  testWidgets('chamada encerrada remove transmissão antiga', (tester) async {
    final api = _VideoApi();
    await openPanel(tester, api);
    api.ended = true;
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.text('A ligação foi encerrada.'), findsOneWidget);
    expect(find.text('Transmitindo'), findsNothing);
    expect(find.text('Pausar'), findsNothing);
    await tester.tap(find.text('Fechar'));
    await tester.pumpAndSettle();
  });
}
