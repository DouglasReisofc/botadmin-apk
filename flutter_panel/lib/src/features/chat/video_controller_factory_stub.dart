import 'package:video_player/video_player.dart';

VideoPlayerController createVideoController({
  required String url,
  Map<String, String>? headers,
  bool isLocalFile = false,
}) {
  return VideoPlayerController.networkUrl(
    Uri.parse(url),
    httpHeaders: headers ?? const <String, String>{},
  );
}
