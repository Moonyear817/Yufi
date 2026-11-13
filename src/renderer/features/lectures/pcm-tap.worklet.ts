// AudioWorklet 作用域里的全局对象，DOM 类型库里没有。
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

/** 100 ms 一包（AudioContext 已按 16 kHz 运行），整包转给主线程，再经 IPC 送去识别。 */
const CHUNK = 1600;

class PcmTap extends AudioWorkletProcessor {
  private buffer = new Float32Array(CHUNK);
  private length = 0;

  process(inputs: Float32Array[][]): boolean {
    for (const sample of inputs[0]?.[0] ?? []) {
      this.buffer[this.length++] = sample;
      if (this.length === CHUNK) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(CHUNK);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-tap', PcmTap);

export {};
