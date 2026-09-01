(function () {
  const TARGET_SAMPLE_RATE = 16000;
  // The Flutter web app is served below /dashboard/user/. Resolve worklets
  // against the document base instead of the domain root so the bridge also
  // works behind the production sub-path and local preview builds.
  const CAPTURE_WORKLET_URL = "worklets/call-capture-processor.js";
  const PLAYBACK_WORKLET_URL = "worklets/call-playback-processor.js";
  const WORKLET_VERSION = "20260725-1";
  const CAPTURE_PROCESSOR = "botadmin-call-capture";
  const PLAYBACK_PROCESSOR = "botadmin-call-playback";
  const MAX_BUFFERED_BYTES = 128000;

  let currentBridge = null;
  let state = {
    status: "idle",
    callId: null,
    error: null,
    sentFrames: 0,
    receivedFrames: 0,
    micPeak: 0,
  };

  const cloneState = () => ({ ...state });

  const setState = (patch) => {
    state = { ...state, ...patch };
  };

  const workletUrl = (path) => {
    const resolved = new URL(path, document.baseURI);
    resolved.searchParams.set("v", WORKLET_VERSION);
    return resolved.toString();
  };

  const wsUrl = (instanceId, callId) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL("/ws/whatsapp-call-media", `${protocol}//${window.location.host}`);
    url.searchParams.set("instanceId", String(instanceId));
    url.searchParams.set("callId", callId);
    return url.toString();
  };

  const downsamplePcm = (input, inputRate, outputRate) => {
    if (inputRate === outputRate) return Float32Array.from(input);
    const ratio = inputRate / outputRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.min(input.length, Math.floor((index + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let cursor = start; cursor < end; cursor += 1) {
        sum += input[cursor] || 0;
        count += 1;
      }
      output[index] = count > 0 ? sum / count : 0;
    }
    return output;
  };

  const float32ToInt16Le = (pcm) => {
    const buffer = new ArrayBuffer(pcm.length * 2);
    const view = new DataView(buffer);
    for (let index = 0; index < pcm.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, pcm[index] || 0));
      view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return buffer;
  };

  const int16LeToFloat32 = (buffer) => {
    const view = new DataView(buffer);
    const output = new Float32Array(Math.floor(buffer.byteLength / 2));
    for (let index = 0; index < output.length; index += 1) {
      output[index] = view.getInt16(index * 2, true) / 0x8000;
    }
    return output;
  };

  const dataToArrayBuffer = async (payload) => {
    if (payload instanceof ArrayBuffer) return payload.slice(0);
    if (ArrayBuffer.isView(payload)) {
      const source = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
      const copy = new Uint8Array(source.byteLength);
      copy.set(source);
      return copy.buffer;
    }
    if (typeof Blob !== "undefined" && payload instanceof Blob) {
      return payload.arrayBuffer();
    }
    return null;
  };

  const cleanup = () => {
    const bridge = currentBridge;
    currentBridge = null;
    if (!bridge) {
      setState({ status: "idle", callId: null, error: null });
      return;
    }
    if (bridge.frameMonitorTimer !== null) {
      window.clearTimeout(bridge.frameMonitorTimer);
    }
    for (const node of bridge.audioNodes) {
      try {
        node.disconnect();
      } catch (_) {
        // ignored
      }
    }
    try {
      bridge.stream?.getTracks().forEach((track) => track.stop());
    } catch (_) {
      // ignored
    }
    try {
      bridge.socket?.close();
    } catch (_) {
      // ignored
    }
    void bridge.audioContext?.close().catch(() => undefined);
    setState({ status: "idle", callId: null, error: null });
  };

  const start = async (options) => {
    const instanceId = Number(options && options.instanceId);
    const callId = String((options && options.callId) || "").trim();
    if (!Number.isFinite(instanceId) || instanceId <= 0 || !callId) {
      throw new Error("Chamada invalida para audio.");
    }
    if (currentBridge && currentBridge.callId === callId && state.status === "connected") {
      return cloneState();
    }

    cleanup();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      throw new Error("Este navegador nao liberou acesso ao microfone.");
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Audio do navegador indisponivel.");
    }
    if (!("AudioWorkletNode" in window)) {
      throw new Error("Este navegador nao suporta audio de chamada em tempo real.");
    }
    if (!("WebSocket" in window)) {
      throw new Error("Este navegador nao suporta chamada em tempo real.");
    }

    setState({
      status: "connecting",
      callId,
      error: null,
      sentFrames: 0,
      receivedFrames: 0,
      micPeak: 0,
    });

    let stream = null;
    let audioContext = null;
    let sourceNode = null;
    let captureNode = null;
    let playbackNode = null;
    let fallbackCaptureNode = null;
    let socket = null;
    let frameMonitorTimer = null;
    let fallbackCaptureStarted = false;

    const failCleanup = () => {
      try {
        if (frameMonitorTimer !== null) window.clearTimeout(frameMonitorTimer);
      } catch (_) {
        // ignored
      }
      [playbackNode, fallbackCaptureNode, captureNode, sourceNode].forEach((node) => {
        try {
          node?.disconnect();
        } catch (_) {
          // ignored
        }
      });
      try {
        stream?.getTracks().forEach((track) => track.stop());
      } catch (_) {
        // ignored
      }
      try {
        socket?.close();
      } catch (_) {
        // ignored
      }
      void audioContext?.close().catch(() => undefined);
    };

    try {
      stream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      audioContext = new AudioContextCtor({ sampleRate: TARGET_SAMPLE_RATE });
      await audioContext.audioWorklet.addModule(workletUrl(CAPTURE_WORKLET_URL));
      await audioContext.audioWorklet.addModule(workletUrl(PLAYBACK_WORKLET_URL));
      await audioContext.resume().catch(() => undefined);

      sourceNode = audioContext.createMediaStreamSource(stream);
      socket = new WebSocket(wsUrl(instanceId, callId));
      socket.binaryType = "arraybuffer";

      captureNode = new AudioWorkletNode(audioContext, CAPTURE_PROCESSOR);
      playbackNode = new AudioWorkletNode(audioContext, PLAYBACK_PROCESSOR);

      const sendCapturedFrame = (frame) => {
        if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
        let peak = 0;
        for (let index = 0; index < frame.length; index += 1) {
          peak = Math.max(peak, Math.abs(frame[index] || 0));
        }
        setState({ micPeak: peak });
        socket.send(float32ToInt16Le(frame));
        setState({ sentFrames: state.sentFrames + 1 });
      };

      const startFallbackCapture = () => {
        if (!audioContext || !sourceNode || fallbackCaptureStarted) return;
        fallbackCaptureStarted = true;
        try {
          captureNode?.disconnect();
        } catch (_) {
          // ignored
        }
        fallbackCaptureNode = audioContext.createScriptProcessor(1024, 1, 1);
        fallbackCaptureNode.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          const output = event.outputBuffer.getChannelData(0);
          output.fill(0);
          sendCapturedFrame(downsamplePcm(input, audioContext.sampleRate || TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE));
        };
        sourceNode.connect(fallbackCaptureNode);
        fallbackCaptureNode.connect(audioContext.destination);
        if (currentBridge?.callId === callId) {
          currentBridge.audioNodes.push(fallbackCaptureNode);
        }
      };

      const armFrameMonitor = () => {
        if (frameMonitorTimer !== null) return;
        frameMonitorTimer = window.setTimeout(() => {
          if (currentBridge?.callId !== callId) return;
          if (state.sentFrames <= 0) {
            startFallbackCapture();
            window.setTimeout(() => {
              if (currentBridge?.callId !== callId) return;
              if (state.sentFrames <= 0) {
                setState({
                  status: "error",
                  error: "Audio conectado, mas o navegador nao esta enviando o microfone.",
                });
              }
            }, 1200);
            return;
          }
          if (state.micPeak < 0.0005) {
            setState({ error: "Audio conectado, mas o microfone esta sem sinal." });
          }
        }, 1200);
        if (currentBridge?.callId === callId) {
          currentBridge.frameMonitorTimer = frameMonitorTimer;
        }
      };

      captureNode.port.onmessage = (event) => sendCapturedFrame(event.data);
      sourceNode.connect(captureNode);
      captureNode.connect(audioContext.destination);
      playbackNode.connect(audioContext.destination);

      const readyPromise = new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Tempo esgotado ao conectar audio da chamada."));
        }, 12000);
        socket.onopen = () => undefined;
        socket.onmessage = (event) => {
          if (typeof event.data === "string") {
            try {
              const message = JSON.parse(event.data);
              if (message.type === "ready" || message.type === "hello") {
                window.clearTimeout(timeout);
                setState({ status: "connected", error: null });
                armFrameMonitor();
                resolve(cloneState());
                return;
              }
              if (message.type === "error") {
                window.clearTimeout(timeout);
                setState({ status: "error", error: message.message || "Audio da chamada indisponivel." });
                reject(new Error(state.error || "Audio da chamada indisponivel."));
                return;
              }
            } catch (_) {
              // ignored
            }
            return;
          }
          void dataToArrayBuffer(event.data)
            .then((buffer) => {
              if (!buffer || buffer.byteLength < 2) return;
              setState({ receivedFrames: state.receivedFrames + 1 });
              playbackNode?.port.postMessage(int16LeToFloat32(buffer));
            })
            .catch(() => undefined);
        };
        socket.onclose = () => {
          window.clearTimeout(timeout);
          if (currentBridge?.callId === callId) {
            setState({
              status: "error",
              error: "Audio do painel desconectado. A chamada continua ativa.",
            });
          }
        };
        socket.onerror = () => {
          window.clearTimeout(timeout);
          if (currentBridge?.callId === callId) {
            setState({ status: "error", error: "Nao foi possivel manter o audio da chamada." });
          }
          reject(new Error(state.error || "Nao foi possivel manter o audio da chamada."));
        };
      });

      currentBridge = {
        callId,
        socket,
        stream,
        audioContext,
        audioNodes: [playbackNode, captureNode, sourceNode].filter(Boolean),
        frameMonitorTimer,
      };

      return await readyPromise;
    } catch (error) {
      failCleanup();
      currentBridge = null;
      setState({
        status: "error",
        callId,
        error: error instanceof Error ? error.message : "Nao foi possivel abrir o audio da chamada.",
      });
      throw error;
    }
  };

  window.BotAdminCallAudioBridge = {
    start,
    stop: cleanup,
    current: cloneState,
  };
})();
