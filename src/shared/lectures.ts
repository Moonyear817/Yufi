import type { SkillDependency } from './capabilities';

/** 录音文件夹在课程项目里的位置：每节课一个子文件夹。 */
export const LECTURES_FOLDER = '课堂录音';
export const LECTURE_AUDIO = '录音.webm';
export const LECTURE_TRANSCRIPT = '文字稿.md';
export const LECTURE_NOTES = '笔记.md';

/** 课程就是一个工作区项目：录音、文字稿与笔记都落在项目目录里，编辑器、搜索与 Agent 直接可用。 */
export interface LectureCourse {
  projectId: string;
  name: string;
  path: string;
  canvasCourseId: number | null;
  lectures: Lecture[];
}

export interface Lecture {
  /** 「课堂录音」下的文件夹名，如「2026-10-30 14.05」。 */
  id: string;
  projectId: string;
  path: string;
  hasAudio: boolean;
  hasTranscript: boolean;
  hasNotes: boolean;
  durationMs: number | null;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/** 实时转写的一行（一句话）：先推 SenseVoice 的预览，定稿后同一行换成 Qwen3-ASR 的结果。 */
export interface LiveLine {
  utterance: number;
  startMs: number;
  /** 定稿后为空表示这句没识别出文字，界面应移除这一行。 */
  text: string;
  final: boolean;
}

export interface LiveTranscript extends LiveLine {
  projectId: string;
  lectureId: string;
}

export interface LecturesApi {
  list(): Promise<LectureCourse[]>;
  createCourse(name: string, canvasCourseId: number | null): Promise<LectureCourse[]>;
  /** 把电脑上已有的课程文件夹登记为课程；用户取消选择时返回 null。 */
  linkCourseFolder(): Promise<LectureCourse[] | null>;
  /** 只取消课程登记，项目与录音文件都保留。 */
  removeCourse(projectId: string): Promise<LectureCourse[]>;
  speechModel(): Promise<SkillDependency>;
  installSpeechModel(): Promise<void>;
  cancelSpeechModel(): Promise<void>;
  start(projectId: string): Promise<Lecture>;
  /** 16 kHz 单声道 PCM，录音期间持续推送。 */
  pushAudio(projectId: string, lectureId: string, pcm: Float32Array): void;
  /** MediaRecorder 产出的 webm 分片，按顺序追加到录音文件。 */
  pushRecording(projectId: string, lectureId: string, chunk: Uint8Array): void;
  /** 一点声音都没录到时不保留这节课，返回 null。 */
  stop(projectId: string, lectureId: string): Promise<Lecture | null>;
  transcript(projectId: string, lectureId: string): Promise<TranscriptSegment[]>;
  audioUrl(projectId: string, lectureId: string): string;
  onLive(listener: (update: LiveTranscript) => void): () => void;
  onSpeechModel(listener: (state: SkillDependency) => void): () => void;
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

/** 文字稿是给人读、也给 Agent 读的 Markdown：每句一行，行首是录音里的时间。 */
export function formatTranscript(
  title: string,
  durationMs: number,
  segments: TranscriptSegment[],
): string {
  return `# ${title}\n\n时长 ${clock(durationMs)} · 本机语音识别生成，可能有误\n\n${segments
    .map(({ startMs, text }) => `[${clock(startMs)}] ${text}`)
    .join('\n\n')}\n`;
}

export function parseTranscript(markdown: string): {
  durationMs: number | null;
  segments: TranscriptSegment[];
} {
  const toMs = (h: string, m: string, s: string) => ((+h * 60 + +m) * 60 + +s) * 1000;
  const duration = /^时长 (\d{2}):(\d{2}):(\d{2})/m.exec(markdown);
  const durationMs = duration ? toMs(duration[1]!, duration[2]!, duration[3]!) : null;
  const starts = [...markdown.matchAll(/^\[(\d{2}):(\d{2}):(\d{2})\] (.+)$/gm)].map((match) => ({
    startMs: toMs(match[1]!, match[2]!, match[3]!),
    text: match[4]!,
  }));
  return {
    durationMs,
    segments: starts.map((segment, index) => ({
      ...segment,
      endMs: starts[index + 1]?.startMs ?? durationMs ?? segment.startMs,
    })),
  };
}
