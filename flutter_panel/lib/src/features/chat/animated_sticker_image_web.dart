import 'dart:ui_web' as ui_web;

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

final Set<String> _registeredAnimatedStickerViews = <String>{};

class AnimatedStickerImage extends StatelessWidget {
  const AnimatedStickerImage({
    super.key,
    required this.url,
    this.width = 164,
    this.height = 164,
  });

  final String url;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final viewType = 'botadmin-animated-sticker-${url.hashCode}';
    if (_registeredAnimatedStickerViews.add(viewType)) {
      ui_web.platformViewRegistry.registerViewFactory(viewType, (int viewId) {
        return web.HTMLImageElement()
          ..src = url
          ..alt = 'Figurinha animada'
          ..draggable = false
          ..setAttribute('data-botadmin-animated-sticker', 'true')
          ..style.width = '100%'
          ..style.height = '100%'
          ..style.objectFit = 'contain'
          ..style.pointerEvents = 'none'
          ..style.border = '0'
          ..style.background = 'transparent';
      });
    }

    return SizedBox(
      width: width,
      height: height,
      child: HtmlElementView(viewType: viewType),
    );
  }
}
