// 实时转写的排队规则：预览与定稿属于同一行；定稿只认准确模型；没识别出文字的句子以空定稿通知移除。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { LiveLine } from '../../../shared/lectures';

const { userData } = vi.hoisted(() => ({
  userData: require('node:fs').mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'dela-speech-'),
  ) as string,
}));
vi.mock('electron', () => ({ app: { getPath: () => userData }, net: {} }));

// 假 VAD：首个采样为 1 的分片算说话，随后的静音分片结束一句。
// 假识别器：输出「模型:秒数」，定稿模型对不足半秒的句子识别不出文字。
// 与 Electron 里真实加载的形状一致：CJS 包经 ESM 加载只有 default 导出。
vi.mock('sherpa-onnx-node', () => {
  const concat = (parts: Float32Array[]) =>
    Float32Array.from(parts.flatMap((part) => Array.from(part)));
  class Vad {
    private speech: Float32Array[] = [];
    private ready: { start: number; samples: Float32Array }[] = [];
    private position = 0;
    private start = 0;
    acceptWaveform(samples: Float32Array) {
      if (samples[0] === 1) {
        if (!this.speech.length) this.start = this.position;
        this.speech.push(samples);
      } else this.flush();
      this.position += samples.length;
    }
    isDetected() {
      return this.speech.length > 0;
    }
    isEmpty() {
      return this.ready.length === 0;
    }
    front() {
      return this.ready[0]!;
    }
    pop() {
      this.ready.shift();
    }
    flush() {
      if (this.speech.length) this.ready.push({ start: this.start, samples: concat(this.speech) });
      this.speech = [];
    }
  }
  class OfflineRecognizer {
    constructor(private readonly model: string) {}
    static async createAsync(config: { modelConfig: object }) {
      return new OfflineRecognizer('senseVoice' in config.modelConfig ? 'preview' : 'final');
    }
    createStream() {
      return {
        samples: new Float32Array() as Float32Array,
        acceptWaveform(input: { samples: Float32Array }) {
          this.samples = input.samples;
        },
      };
    }
    async decodeAsync() {}
    getResult(stream: { samples: Float32Array }) {
      const seconds = stream.samples.length / 16000;
      return { text: this.model === 'final' && seconds < 0.5 ? '' : `${this.model}:${seconds}` };
    }
  }
  return { default: { Vad, OfflineRecognizer } };
});

const speech = () => new Float32Array(1600).fill(1);
const silence = () => new Float32Array(1600);

it('turns each sentence into one line that is previewed first and finalized by the accurate model', async () => {
  const dir = join(userData, 'components', 'speech', '1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ready'), '2');
  const { LiveTranscriber } = await import('../speech');
  const lines: LiveLine[] = [];
  const live = await LiveTranscriber.create((line) => lines.push(line));

  for (const chunk of [
    silence(),
    ...Array.from({ length: 12 }, speech),
    silence(),
    speech(),
    speech(),
  ])
    live.push(chunk);
  const segments = await live.finish();

  expect(segments).toEqual([{ startMs: 100, endMs: 1300, text: 'final:1.2' }]);
  // 预览与定稿分两条队列，收尾预览可能晚于定稿到达（界面丢弃定稿后的预览），这里不约束先后。
  const lineOf = (utterance: number) => lines.filter((line) => line.utterance === utterance);
  expect(lineOf(0)).toHaveLength(3);
  expect(lineOf(0)).toEqual(
    expect.arrayContaining([
      { utterance: 0, startMs: 100, text: 'preview:1', final: false },
      { utterance: 0, startMs: 100, text: 'preview:1.2', final: false },
      { utterance: 0, startMs: 100, text: 'final:1.2', final: true },
    ]),
  );
  // 不足一秒的第二句没有中途预览，只有收尾预览与空定稿。
  expect(lineOf(1)).toHaveLength(2);
  expect(lineOf(1)).toEqual(
    expect.arrayContaining([
      { utterance: 1, startMs: 1400, text: 'preview:0.2', final: false },
      { utterance: 1, startMs: 1400, text: '', final: true },
    ]),
  );
  expect(live.samples).toBe(16 * 1600);
});
