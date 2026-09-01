class BotAdminCallPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = (event) => {
      const frame = event.data;
      if (frame && frame.length) this.queue.push(Float32Array.from(frame));
      // Keep latency bounded when the browser is resumed after being hidden.
      if (this.queue.length > 24) {
        this.queue.splice(0, this.queue.length - 24);
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    for (const channel of output) channel.fill(0);
    const channel = output && output[0];
    if (!channel) return true;

    let written = 0;
    while (written < channel.length && this.queue.length > 0) {
      const frame = this.queue[0];
      const available = frame.length - this.offset;
      const count = Math.min(available, channel.length - written);
      for (let index = 0; index < count; index += 1) {
        channel[written + index] = frame[this.offset + index];
      }
      written += count;
      this.offset += count;
      if (this.offset >= frame.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    for (let outputChannel = 1; outputChannel < output.length; outputChannel += 1) {
      output[outputChannel].set(channel);
    }
    return true;
  }
}

registerProcessor("botadmin-call-playback", BotAdminCallPlaybackProcessor);
