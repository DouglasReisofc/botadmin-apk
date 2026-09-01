class BotAdminCallCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const channel = input && input[0];

    // Keep the node alive without routing the microphone back to the speakers.
    if (output) {
      for (const outputChannel of output) outputChannel.fill(0);
    }
    if (channel && channel.length > 0) {
      this.port.postMessage(Float32Array.from(channel));
    }
    return true;
  }
}

registerProcessor("botadmin-call-capture", BotAdminCallCaptureProcessor);
