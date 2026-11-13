/**
 * Chromium 的 MediaRecorder 写出的 WebM 没有 Duration，播放器显示不了总时长、拖不了进度。
 * 录完后在 Segment 的 Info 里补一个 Duration（已有时原样返回）。
 */
const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;

function element(webm: Buffer, offset: number) {
  const idLength = 8 - Math.floor(Math.log2(webm[offset]!));
  const sizeAt = offset + idLength;
  const sizeLength = 8 - Math.floor(Math.log2(webm[sizeAt]!));
  const mask = 0xff >> sizeLength;
  const bytes = webm.subarray(sizeAt + 1, sizeAt + sizeLength);
  const unknown = (webm[sizeAt]! & mask) === mask && bytes.every((byte) => byte === 0xff);
  const size = bytes.reduce((value, byte) => value * 256 + byte, webm[sizeAt]! & mask);
  return {
    id: webm.readUIntBE(offset, idLength),
    idLength,
    dataStart: sizeAt + sizeLength,
    size: unknown ? Infinity : size,
  };
}

export function withDuration(webm: Buffer, durationMs: number): Buffer {
  try {
    return patched(webm, durationMs);
  } catch {
    // 空文件或被截断的文件读不出结构，保持原样。
    return webm;
  }
}

function patched(webm: Buffer, durationMs: number): Buffer {
  const header = element(webm, 0);
  if (header.id !== EBML) return webm;
  const segment = element(webm, header.dataStart + header.size);
  if (segment.id !== SEGMENT) return webm;
  for (let offset = segment.dataStart; offset < webm.length;) {
    const child = element(webm, offset);
    if (child.id === INFO) {
      const end = child.dataStart + child.size;
      let scale = 1_000_000;
      for (let at = child.dataStart; at < end;) {
        const field = element(webm, at);
        if (field.id === DURATION) return webm;
        if (field.id === TIMECODE_SCALE) scale = webm.readUIntBE(field.dataStart, field.size);
        at = field.dataStart + field.size;
      }
      const duration = Buffer.alloc(11);
      duration.writeUInt16BE(DURATION, 0);
      duration[2] = 0x88;
      duration.writeDoubleBE((durationMs * 1_000_000) / scale, 3);
      // 新尺寸统一写成 8 字节 VINT，不必关心原来占几个字节。
      const size = Buffer.alloc(8);
      size[0] = 0x01;
      size.writeUIntBE(child.size + duration.length, 2, 6);
      return Buffer.concat([
        webm.subarray(0, offset + child.idLength),
        size,
        webm.subarray(child.dataStart, end),
        duration,
        webm.subarray(end),
      ]);
    }
    if (child.size === Infinity) return webm;
    offset = child.dataStart + child.size;
  }
  return webm;
}
