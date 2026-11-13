/**
 * 本机语音识别：Silero VAD 断句，SenseVoice 边说边出临时结果，整句说完交给 Qwen3-ASR 定稿
 * （实测中英混说更准，标点与大小写更自然）。
 * 模型文件首次使用时从 Hugging Face 下载（不通时走 hf-mirror），逐个校验 SHA256。
 */
import { app, net } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, open, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OfflineRecognizer, Vad } from 'sherpa-onnx-node';
import type { SkillDependency } from '../../shared/capabilities';
import type { LiveLine, TranscriptSegment } from '../../shared/lectures';

export const SAMPLE_RATE = 16000;
/** 写进 ready 的清单版本：模型组合变了就递增，已校验过的文件在重新安装时复用。 */
const MANIFEST = '2';
const HOSTS = ['https://huggingface.co', 'https://hf-mirror.com'];
const SENSE_VOICE = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const QWEN3_ASR = 'csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25';

const FILES: { name: string; repo: string; path: string; sha256: string; size: number }[] = [
  // 实测 v5 在讲话中会漏掉约一成内容，这一版几乎不漏。
  {
    name: 'silero_vad.onnx',
    repo: 'csukuangfj/vad',
    path: 'silero_vad.onnx',
    sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
    size: 1807522,
  },
  {
    name: 'sense-voice/model.int8.onnx',
    repo: SENSE_VOICE,
    path: 'model.int8.onnx',
    sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
    size: 239233841,
  },
  {
    name: 'sense-voice/tokens.txt',
    repo: SENSE_VOICE,
    path: 'tokens.txt',
    sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
    size: 315894,
  },
  ...(
    [
      [
        'conv_frontend.onnx',
        'd22dc4423e0940e49884e903d2ea2f7e5567c14fc1aed97e4e26d6b8f208ef9e',
        44148281,
      ],
      [
        'encoder.int8.onnx',
        '60748d3e6744a57c9c91e1b17424a6c2990567e8adceb0783940c03ed98fa9d9',
        182491662,
      ],
      [
        'decoder.int8.onnx',
        '4f6885be5959ae26af3089d38ee7972c5fafbeeb1cf8d5e76eab6d8b61ca5771',
        755914231,
      ],
      [
        'tokenizer/merges.txt',
        '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5',
        1671853,
      ],
      [
        'tokenizer/tokenizer_config.json',
        '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c',
        12487,
      ],
      [
        'tokenizer/vocab.json',
        'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910',
        2776833,
      ],
    ] as const
  ).map(([path, sha256, size]) => ({
    name: `qwen3-asr/${path}`,
    repo: QWEN3_ASR,
    path,
    sha256,
    size,
  })),
];

const senseVoice = (dir: string) => ({
  senseVoice: {
    model: join(dir, 'sense-voice', 'model.int8.onnx'),
    language: '',
    useInverseTextNormalization: 1,
  },
  tokens: join(dir, 'sense-voice', 'tokens.txt'),
});
const qwen3Asr = (dir: string) => ({
  qwen3Asr: {
    convFrontend: join(dir, 'qwen3-asr', 'conv_frontend.onnx'),
    encoder: join(dir, 'qwen3-asr', 'encoder.int8.onnx'),
    decoder: join(dir, 'qwen3-asr', 'decoder.int8.onnx'),
    tokenizer: join(dir, 'qwen3-asr', 'tokenizer'),
    hotwords: '',
  },
  tokens: '',
});

function modelDirectory(): string {
  return join(app.getPath('userData'), 'components', 'speech', '1');
}

let installation: Promise<void> | undefined;
let controller: AbortController | undefined;
let state: SkillDependency = { status: 'missing' };
let listener: (state: SkillDependency) => void = () => {};

export function onSpeechModelState(callback: (state: SkillDependency) => void) {
  listener = callback;
}

function update(next: SkillDependency) {
  state = next;
  listener({ ...state });
}

export function speechModelState(): SkillDependency {
  if (installation) return { ...state };
  try {
    if (readFileSync(join(modelDirectory(), 'ready'), 'utf8') === MANIFEST)
      return { status: 'ready' };
  } catch {
    // 只有下载并校验完成的目录才算可用。
  }
  return state.status === 'error' ? { ...state } : { status: 'missing' };
}

async function verified(path: string, file: (typeof FILES)[number]): Promise<boolean> {
  if ((await stat(path).catch(() => null))?.size !== file.size) return false;
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex') === file.sha256;
}

async function download(
  file: (typeof FILES)[number],
  target: string,
  progress: (bytes: number) => void,
  signal: AbortSignal,
) {
  let failure: unknown;
  for (const host of HOSTS) {
    try {
      const response = await net.fetch(`${host}/${file.repo}/resolve/main/${file.path}`, {
        signal,
      });
      if (!response.ok || !response.body)
        throw new Error(`模型下载失败（HTTP ${response.status}）`);
      await mkdir(dirname(target), { recursive: true });
      const handle = await open(`${target}.part`, 'w');
      const digest = createHash('sha256');
      try {
        for await (const chunk of response.body) {
          await handle.writeFile(chunk);
          digest.update(chunk);
          progress(chunk.length);
        }
      } finally {
        await handle.close();
      }
      if (digest.digest('hex') !== file.sha256) throw new Error('模型校验失败，请重试');
      await rename(`${target}.part`, target);
      return;
    } catch (error) {
      if (signal.aborted) throw error;
      failure = error;
    }
  }
  throw failure;
}

export function cancelSpeechModelInstallation() {
  controller?.abort();
}

export function installSpeechModel(): Promise<void> {
  if (installation) return installation;
  if (speechModelState().status === 'ready') return Promise.resolve();
  controller = new AbortController();
  const signal = controller.signal;
  const root = modelDirectory();
  const total = FILES.reduce((sum, file) => sum + file.size, 0);
  let received = 0;
  update({ status: 'installing', phase: '下载语音识别模型', received, total });
  installation = (async () => {
    const progress = (bytes: number) => {
      received += bytes;
      update({ status: 'installing', phase: '下载语音识别模型', received, total });
    };
    for (const file of FILES) {
      const target = join(root, file.name);
      if (await verified(target, file)) progress(file.size);
      else await download(file, target, progress, signal);
    }
    await writeFile(join(root, 'ready'), MANIFEST);
    update({ status: 'ready' });
  })()
    .catch((error: unknown) => {
      update(
        signal.aborted
          ? { status: 'missing' }
          : { status: 'error', error: error instanceof Error ? error.message : '模型下载失败' },
      );
      throw error;
    })
    .finally(() => {
      installation = undefined;
      controller = undefined;
    });
  return installation;
}

type Sherpa = typeof import('sherpa-onnx-node');
interface Engine {
  sherpa: Sherpa;
  preview: OfflineRecognizer;
  final: OfflineRecognizer;
}

let engine: Promise<Engine> | undefined;

function loadEngine(): Promise<Engine> {
  if (speechModelState().status !== 'ready') throw new Error('请先下载语音识别模型');
  engine ??= (async () => {
    const loaded = await import('sherpa-onnx-node');
    // Node 的 ESM 加载器认不出 sherpa-onnx 的 CJS 具名导出（module.exports = { A: x.A }），只给 default。
    const sherpa = (loaded as { default?: Sherpa }).default ?? loaded;
    const dir = modelDirectory();
    const create = (model: object) =>
      sherpa.OfflineRecognizer.createAsync({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: { ...model, numThreads: 4, provider: 'cpu', debug: 0 },
      });
    const [preview, final] = await Promise.all([create(senseVoice(dir)), create(qwen3Asr(dir))]);
    return { sherpa, preview, final };
  })().catch((error: unknown) => {
    engine = undefined;
    throw error;
  });
  return engine;
}

async function decode(recognizer: OfflineRecognizer, samples: Float32Array): Promise<string> {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  await recognizer.decodeAsync(stream);
  return recognizer.getResult(stream).text.trim();
}

const PREVIEW_EVERY = 0.6 * SAMPLE_RATE;
/** 不足一秒的语音 SenseVoice 容易乱猜语种（实测会冒出日文），先不预览。 */
const PREVIEW_AFTER = SAMPLE_RATE;

function concat(parts: Float32Array[]): Float32Array {
  const audio = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    audio.set(part, offset);
    offset += part.length;
  }
  return audio;
}

/**
 * 一次录音的转写：音频按到达顺序进 VAD，每句话一行。正在说的那句每 0.6 秒用 SenseVoice
 * 预览一次；整句结束后先给出整句预览，再交给 Qwen3-ASR 定稿替换。预览与定稿各自排队，
 * 定稿慢也不会卡住实时预览；预览忙时跳过，不会越积越多。
 */
export class LiveTranscriber {
  private readonly segments: TranscriptSegment[] = [];
  private speech: Float32Array[] = [];
  private speechSamples = 0;
  private sincePreview = 0;
  private previewing = false;
  private utterance = 0;
  private previews: Promise<void> = Promise.resolve();
  private finals: Promise<void> = Promise.resolve();
  samples = 0;

  private constructor(
    private readonly engine: Engine,
    private readonly vad: Vad,
    private readonly emit: (line: LiveLine) => void,
  ) {}

  static async create(emit: (line: LiveLine) => void) {
    const engine = await loadEngine();
    const vad = new engine.sherpa.Vad(
      {
        sileroVad: {
          model: join(modelDirectory(), 'silero_vad.onnx'),
          threshold: 0.5,
          minSpeechDuration: 0.25,
          minSilenceDuration: 0.5,
          maxSpeechDuration: 15,
          windowSize: 512,
        },
        sampleRate: SAMPLE_RATE,
        debug: false,
        numThreads: 1,
      },
      60,
    );
    return new LiveTranscriber(engine, vad, emit);
  }

  push(pcm: Float32Array) {
    this.samples += pcm.length;
    this.vad.acceptWaveform(pcm);
    if (this.vad.isDetected()) {
      this.speech.push(pcm);
      this.speechSamples += pcm.length;
      this.sincePreview += pcm.length;
      if (
        this.speechSamples >= PREVIEW_AFTER &&
        this.sincePreview >= PREVIEW_EVERY &&
        !this.previewing
      ) {
        this.sincePreview = 0;
        this.previewing = true;
        const startMs = ((this.samples - this.speechSamples) / SAMPLE_RATE) * 1000;
        void this.preview(this.utterance, startMs, concat(this.speech)).finally(() => {
          this.previewing = false;
        });
      }
    }
    this.drain();
  }

  private preview(utterance: number, startMs: number, audio: Float32Array): Promise<void> {
    this.previews = this.previews
      .then(async () => {
        const text = await decode(this.engine.preview, audio);
        if (text) this.emit({ utterance, startMs: Math.round(startMs), text, final: false });
      })
      .catch((error: unknown) => console.error('Speech preview failed', error));
    return this.previews;
  }

  private drain() {
    while (!this.vad.isEmpty()) {
      const { start, samples } = this.vad.front(false);
      this.vad.pop();
      const utterance = this.utterance++;
      const startMs = Math.round((start / SAMPLE_RATE) * 1000);
      const endMs = Math.round(((start + samples.length) / SAMPLE_RATE) * 1000);
      this.speech = [];
      this.speechSamples = 0;
      this.sincePreview = 0;
      void this.preview(utterance, startMs, samples);
      this.finals = this.finals
        .then(async () => {
          const text = await decode(this.engine.final, samples);
          if (text) this.segments.push({ startMs, endMs, text });
          this.emit({ utterance, startMs, text, final: true });
        })
        .catch((error: unknown) => console.error('Speech decode failed', error));
    }
  }

  async finish(): Promise<TranscriptSegment[]> {
    this.vad.flush();
    this.drain();
    await Promise.all([this.previews, this.finals]);
    return this.segments;
  }

  get transcript(): TranscriptSegment[] {
    return this.segments;
  }
}
