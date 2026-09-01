import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_panel/src/features/chat/media_players.dart';

void main() {
  test('URLs relativas de mídia usam a origem HTTPS do painel no nativo', () {
    if (kIsWeb) return;
    expect(
      resolvePlaybackUrl('/api/playaudio/example'),
      startsWith('https://botadmin.shop/api/playaudio/example'),
    );
  });

  testWidgets('player MP3 compacto reserva e exibe todos os controles', (
    tester,
  ) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: Center(
              child: SizedBox(
                width: 300,
                height: 82,
                child: InlineAudioPlayer(
                  url: 'https://botadmin.shop/audio-de-layout.mp3',
                  mimeType: 'audio/mpeg',
                  title: 'Áudio MP3',
                  compact: true,
                  durationSeconds: 240,
                ),
              ),
            ),
          ),
        ),
      ),
    );

    // O carregamento da rede é assíncrono, mas a estrutura do player nunca
    // pode desaparecer e deixar apenas um retângulo cinza.
    expect(find.text('1x'), findsOneWidget);
    expect(find.byType(Slider), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
  });
}
