import 'package:web/web.dart' as web;

void redirectToOfficialSignIn() {
  final path = web.window.location.pathname;
  final search = web.window.location.search;
  final hash = web.window.location.hash;
  final next = [path, search, hash].join();
  final target =
      '/sign-in?next=${Uri.encodeComponent(next.isEmpty ? '/dashboard/user' : next)}';
  web.window.location.href = target;
}

void redirectToPath(String path) {
  final target = path.trim().isEmpty ? '/dashboard/user' : path.trim();
  web.window.location.href = target.startsWith('/') ? target : '/$target';
}
