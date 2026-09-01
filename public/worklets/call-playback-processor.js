const BOTADMIN_CALL_RING_SIZE = 16000 * 2;

class BotAdminCallPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(BOTADMIN_CALL_RING_SIZE);
    this.read = 0;
    this.write = 0;
    this.available = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || !data.length) return;
      for (let index = 0; index < data.length; index += 1) {
        this.ring[this.write] = data[index];
        this.write = (this.write + 1) % BOTADMIN_CALL_RING_SIZE;
        if (this.available < BOTADMIN_CALL_RING_SIZE) {
          this.available += 1;
        } else {
          this.read = (this.read + 1) % BOTADMIN_CALL_RING_SIZE;
        }
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    for (let index = 0; index < output.length; index += 1) {
      if (this.available > 0) {
        output[index] = this.ring[this.read];
        this.read = (this.read + 1) % BOTADMIN_CALL_RING_SIZE;
        this.available -= 1;
      } else {
        output[index] = 0;
      }
    }
    return true;
  }
}

registerProcessor("botadmin-call-playback", BotAdminCallPlaybackProcessor);
