import { expect, it } from 'vitest';
import { withDuration } from '../webm';

// MediaRecorder 的典型结构：EBML 头、未知长度的 Segment、没有 Duration 的 Info、随后是音频簇。
const header = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const timecodeScale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
const muxingApp = [0x4d, 0x80, 0x86, ...Buffer.from('Chrome')];
const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | (timecodeScale.length + muxingApp.length)];
const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x84, 0xe7, 0x81, 0x00, 0xa3];
const recorded = Buffer.from([
  ...header,
  ...segment,
  ...info,
  ...timecodeScale,
  ...muxingApp,
  ...cluster,
]);

it('adds the recorded duration to the segment info and leaves the audio untouched', () => {
  const fixed = withDuration(recorded, 46_250);
  const infoAt = header.length + segment.length;
  expect(fixed.readUInt32BE(infoAt)).toBe(0x1549a966);
  expect(fixed[infoAt + 4]).toBe(0x01);
  expect(fixed.readUIntBE(infoAt + 6, 6)).toBe(timecodeScale.length + muxingApp.length + 11);
  const durationAt = fixed.indexOf(Buffer.from([0x44, 0x89, 0x88]));
  expect(fixed.readDoubleBE(durationAt + 3)).toBe(46_250);
  expect(fixed.subarray(fixed.length - cluster.length)).toEqual(Buffer.from(cluster));
});

it('does not add a second duration or touch files it does not understand', () => {
  const fixed = withDuration(recorded, 46_250);
  expect(withDuration(fixed, 99_000)).toBe(fixed);
  for (const unreadable of [
    Buffer.from('not a webm file'),
    Buffer.alloc(0),
    recorded.subarray(0, 15),
  ])
    expect(withDuration(unreadable, 1_000)).toBe(unreadable);
});
