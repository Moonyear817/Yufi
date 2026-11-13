declare module '*?raw' {
  const content: string;
  export default content;
}

// sherpa-onnx-node 不带类型声明，这里只声明课堂录音用到的部分。
declare module 'sherpa-onnx-node' {
  export interface OfflineStream {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  }
  export class OfflineRecognizer {
    static createAsync(config: object): Promise<OfflineRecognizer>;
    createStream(): OfflineStream;
    decodeAsync(stream: OfflineStream): Promise<void>;
    getResult(stream: OfflineStream): { text: string };
  }
  export class Vad {
    constructor(config: object, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    front(enableExternalBuffer?: boolean): { start: number; samples: Float32Array };
    pop(): void;
    flush(): void;
  }
}
