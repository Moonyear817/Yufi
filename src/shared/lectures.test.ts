import { describe, expect, it } from 'vitest';
import { formatTranscript, parseTranscript } from './lectures';

describe('lecture transcripts', () => {
  it('reads back the timeline it writes, with each line ending where the next begins', () => {
    const markdown = formatTranscript('ACCT 2200 · 2026-10-30 14.05', 3_731_400, [
      { startMs: 3_000, endMs: 9_000, text: 'Today we start with accruals.' },
      { startMs: 3_725_000, endMs: 3_730_000, text: '这一部分期末会考。' },
    ]);
    expect(markdown).toContain('[01:02:05] 这一部分期末会考。');
    expect(parseTranscript(markdown)).toEqual({
      durationMs: 3_731_000,
      segments: [
        { startMs: 3_000, endMs: 3_725_000, text: 'Today we start with accruals.' },
        { startMs: 3_725_000, endMs: 3_731_000, text: '这一部分期末会考。' },
      ],
    });
  });

  it('keeps reading a transcript after the user edits it by hand', () => {
    expect(
      parseTranscript('# 笔记\n\n[00:00:05] 第一句\n这行是用户补充的说明\n\n[00:00:20] 第二句\n'),
    ).toEqual({
      durationMs: null,
      segments: [
        { startMs: 5_000, endMs: 20_000, text: '第一句' },
        { startMs: 20_000, endMs: 20_000, text: '第二句' },
      ],
    });
  });
});
