import 'package:flutter/widgets.dart';

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
    return Image.network(
      url,
      width: width,
      height: height,
      fit: BoxFit.contain,
      gaplessPlayback: true,
    );
  }
}
