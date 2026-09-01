import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_panel/src/features/dashboard/status_visual_editor.dart';

void main() {
  testWidgets(
    'editor de status ocupa a tela e mantém ferramentas responsivas',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        const MaterialApp(home: StatusVisualEditorDialog(initialText: 'Oi')),
      );
      await tester.pump();

      expect(find.byIcon(Icons.close_rounded), findsOneWidget);
      expect(find.text('Oi'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.edit_rounded));
      await tester.pump();

      expect(find.byIcon(Icons.format_bold_rounded), findsOneWidget);
      expect(find.byIcon(Icons.format_italic_rounded), findsOneWidget);
      expect(find.byIcon(Icons.format_color_fill_rounded), findsOneWidget);
      final carousel = find.byKey(const Key('status-editor-top-tools'));
      expect(carousel, findsOneWidget);
      expect(tester.getTopLeft(carousel).dy, lessThan(150));

      final center = tester.getCenter(find.text('Oi'));
      final firstFinger = await tester.startGesture(
        center + const Offset(-60, 0),
        pointer: 1,
      );
      final secondFinger = await tester.startGesture(
        center + const Offset(60, 0),
        pointer: 2,
      );
      await tester.pump();
      await firstFinger.moveTo(center + const Offset(0, -80));
      await secondFinger.moveTo(center + const Offset(0, 80));
      await tester.pump();
      await firstFinger.up();
      await secondFinger.up();
      final rotatedText = tester.widget<Transform>(
        find.byKey(const Key('status-editor-text-rotation')),
      );
      expect(rotatedText.transform.storage[1].abs(), greaterThan(.5));
      final resizedText = tester.widget<Text>(find.text('Oi'));
      expect(resizedText.style?.fontSize, greaterThan(40));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('restaura documento visual e mantém legenda na base', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      const MaterialApp(
        home: StatusVisualEditorDialog(
          initialText: 'texto antigo',
          initialCaption: 'Legenda inferior',
          initialDocument: {
            'text': 'Oferta restaurada',
            'backgroundColor': '#123456',
            'textColor': '#FEDCBA',
            'textAlignment': {'x': .25, 'y': -.2},
            'fontSize': 44,
            'textRotation': .75,
            'bold': false,
            'italic': true,
            'underline': true,
            'sourceMedia': false,
          },
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Oferta restaurada'), findsOneWidget);
    expect(find.text('texto antigo'), findsNothing);
    final caption = find.text('Legenda inferior');
    expect(caption, findsOneWidget);
    expect(tester.getBottomLeft(caption).dy, greaterThan(700));
    final rotation = tester.widget<Transform>(
      find.byKey(const Key('status-editor-text-rotation')),
    );
    expect(rotation.transform.storage[1].abs(), greaterThan(.5));
    expect(tester.takeException(), isNull);
  });

  testWidgets('mantém várias mídias como camadas removíveis', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final pixel = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: StatusVisualEditorDialog(
          initialText: 'Montagem',
          initialMediaLayers: [
            StatusVisualMediaLayer(
              bytes: pixel,
              fileName: 'foto-1.png',
              mimeType: 'image/png',
              isVideo: false,
              alignment: const Alignment(-.25, -.2),
              scale: 1,
              rotation: 0,
            ),
            StatusVisualMediaLayer(
              bytes: pixel,
              fileName: 'foto-2.png',
              mimeType: 'image/png',
              isVideo: false,
              alignment: const Alignment(.25, .2),
              scale: .8,
              rotation: .2,
            ),
          ],
        ),
      ),
    );
    await tester.pump();

    expect(find.textContaining('2 camada(s)'), findsOneWidget);
    final remove = find.byKey(const Key('status-editor-remove-selected-media'));
    expect(remove, findsOneWidget);
    await tester.tap(remove);
    await tester.pump();
    expect(find.textContaining('1 camada(s)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
