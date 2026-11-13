import workletUrl from './pcm-tap.worklet.ts?worker&url';

const SAMPLE_RATE = 16000;

/**
 * 麦克风的两路输出：16 kHz PCM 送去实时识别，MediaRecorder 的 opus 分片存成录音文件。
 * 暂停时两路一起停，录音文件与文字稿的时间轴始终对得上。
 */
export class LectureRecorder {
  private chunks: Promise<void> = Promise.resolve();

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly recorder: MediaRecorder,
  ) {}

  static async start(
    onPcm: (pcm: Float32Array) => void,
    onChunk: (chunk: Uint8Array) => void,
  ): Promise<LectureRecorder> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true },
    });
    try {
      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      await context.audioWorklet.addModule(workletUrl);
      const tap = new AudioWorkletNode(context, 'pcm-tap');
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => onPcm(event.data);
      // 接到静音的 destination 上，Chromium 才会持续驱动这条音频图。
      const mute = context.createGain();
      mute.gain.value = 0;
      context
        .createMediaStreamSource(stream)
        .connect(tap)
        .connect(mute)
        .connect(context.destination);
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 32000,
      });
      const instance = new LectureRecorder(stream, context, recorder);
      recorder.ondataavailable = (event) => {
        instance.chunks = instance.chunks.then(async () =>
          onChunk(new Uint8Array(await event.data.arrayBuffer())),
        );
      };
      recorder.start(5000);
      return instance;
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
  }

  get paused(): boolean {
    return this.recorder.state === 'paused';
  }

  pause() {
    this.recorder.pause();
    void this.context.suspend();
  }

  resume() {
    this.recorder.resume();
    void this.context.resume();
  }

  /** 等最后一个录音分片送出后才返回，调用方随后再通知主进程收尾。 */
  async stop(): Promise<void> {
    const stopped = new Promise<void>((resolve) => {
      this.recorder.onstop = () => resolve();
    });
    this.recorder.stop();
    await stopped;
    await this.chunks;
    for (const track of this.stream.getTracks()) track.stop();
    await this.context.close();
  }
}
