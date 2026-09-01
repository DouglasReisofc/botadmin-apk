const BOTADMIN_CALL_TARGET_SAMPLE_RATE = 16000;
const BOTADMIN_CALL_FRAME_SIZE = 960;

class BotAdminCallCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(BOTADMIN_CALL_FRAME_SIZE);
    this.framePos = 0;
    this.inputBuffer = new Float32Array(0);
    this.inputOffset = 0;
    this.inputRatio = sampleRate / BOTADMIN_CALL_TARGET_SAMPLE_RATE;
  }

  appendInput(channel) {
    if (!channel || !channel.length) return;
    const combined = new Float32Array(this.inputBuffer.length + channel.length);
    combined.set(this.inputBuffer, 0);
    combined.set(channel, this.inputBuffer.length);
    this.inputBuffer = combined;
  }

  pushSample(sample) {
    this.frame[this.framePos] = Math.max(-1, Math.min(1, sample || 0));
    this.framePos += 1;
    if (this.framePos < BOTADMIN_CALL_FRAME_SIZE) return;
    this.port.postMessage(this.frame.slice(0));
    this.framePos = 0;
  }

  resampleAvailableInput() {
    if (this.inputBuffer.length < 2) return;
    while (this.inputOffset + 1 < this.inputBuffer.length) {
      const index = Math.floor(this.inputOffset);
      const frac = this.inputOffset - index;
      const current = this.inputBuffer[index] || 0;
      const next = this.inputBuffer[index + 1] || current;
      this.pushSample(current + (next - current) * frac);
      this.inputOffset += this.inputRatio;
    }

    const consumed = Math.floor(this.inputOffset);
    if (consumed > 0) {
      this.inputBuffer = this.inputBuffer.slice(consumed);
      this.inputOffset -= consumed;
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    this.appendInput(channel);
    this.resampleAvailableInput();
    return true;
  }
}

registerProcessor("botadmin-call-capture", BotAdminCallCaptureProcessor);
