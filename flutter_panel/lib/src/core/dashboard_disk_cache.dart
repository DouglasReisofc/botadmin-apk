// Small platform abstraction used by the dashboard cache.  The Android
// implementation stores JSON in the app support directory; the web build is
// intentionally a no-op because the browser already keeps its own HTTP/image
// caches and this file must remain compilable for web.
export 'dashboard_disk_cache_stub.dart'
    if (dart.library.io) 'dashboard_disk_cache_io.dart';
