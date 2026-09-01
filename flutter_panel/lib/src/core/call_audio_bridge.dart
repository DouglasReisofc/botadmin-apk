export 'call_audio_bridge_types.dart';

import 'call_audio_bridge_stub.dart'
    if (dart.library.io) 'call_audio_bridge_io.dart'
    if (dart.library.js_interop) 'call_audio_bridge_web.dart'
    as impl;
import 'call_audio_bridge_types.dart';

final CallAudioBridge callAudioBridge = impl.createCallAudioBridge();
