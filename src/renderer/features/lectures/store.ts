// 课堂笔记页状态：课程与课次列表、语音模型安装进度、正在进行的录音。
// 录音对象放在模块里而不是组件里：录音途中切去聊天或别的页面，录音照常继续。
import { create } from 'zustand';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import type { SkillDependency } from '../../../shared/capabilities';
import type { LectureCourse, LiveLine } from '../../../shared/lectures';
import { LectureRecorder } from './recorder';

export interface LiveRecording {
  projectId: string;
  lectureId: string;
  /** 每句一行：未定稿的是 SenseVoice 预览，定稿后换成 Qwen3-ASR 的结果。 */
  lines: LiveLine[];
  /** 已录时长（不含暂停），按收到的音频采样累计。 */
  elapsedMs: number;
  level: number;
  paused: boolean;
  stopping: boolean;
}

interface LecturesState {
  courses: LectureCourse[];
  loading: boolean;
  model: SkillDependency;
  selected: { projectId: string; lectureId: string | null } | null;
  recording: LiveRecording | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (projectId: string, lectureId: string | null) => void;
  createCourse: (name: string, canvasCourseId: number | null) => Promise<void>;
  linkCourseFolder: () => Promise<void>;
  removeCourse: (projectId: string) => Promise<void>;
  installModel: () => Promise<void>;
  start: (projectId: string) => Promise<void>;
  togglePause: () => void;
  stop: () => Promise<void>;
}

let recorder: LectureRecorder | null = null;
let subscribed = false;

export const useLectures = create<LecturesState>((set, get) => ({
  courses: [],
  loading: true,
  model: { status: 'missing' },
  selected: null,
  recording: null,

  init: async () => {
    const api = window.dela!.lectures;
    if (!subscribed) {
      subscribed = true;
      api.onSpeechModel((model) => set({ model }));
      api.onLive(({ lectureId, utterance, startMs, text, final }) => {
        const recording = get().recording;
        if (recording?.lectureId !== lectureId) return;
        // 预览比定稿快，迟到的预览不能盖掉已经定稿的那一行。
        if (recording.lines.some((line) => line.utterance === utterance && line.final)) return;
        const others = recording.lines.filter((line) => line.utterance !== utterance);
        set({
          recording: {
            ...recording,
            lines:
              final && !text
                ? others
                : [...others, { utterance, startMs, text, final }].sort(
                    (a, b) => a.utterance - b.utterance,
                  ),
          },
        });
      });
    }
    const [model] = await Promise.all([api.speechModel(), get().refresh()]);
    set({ model });
  },

  refresh: async () => {
    try {
      const courses = await window.dela!.lectures.list();
      const selected = get().selected;
      set({
        courses,
        loading: false,
        selected:
          selected && courses.some((course) => course.projectId === selected.projectId)
            ? selected
            : courses[0]
              ? { projectId: courses[0].projectId, lectureId: null }
              : null,
      });
    } catch (cause) {
      set({ loading: false });
      showToast({ variant: 'error', title: '读取课程失败', description: errorText(cause) });
    }
  },

  select: (projectId, lectureId) => set({ selected: { projectId, lectureId } }),

  createCourse: async (name, canvasCourseId) => {
    const courses = await window.dela!.lectures.createCourse(name, canvasCourseId);
    const created = courses.at(-1);
    set({ courses, selected: created ? { projectId: created.projectId, lectureId: null } : null });
  },

  linkCourseFolder: async () => {
    const courses = await window.dela!.lectures.linkCourseFolder();
    if (!courses) return;
    const linked = courses.at(-1);
    set({ courses, selected: linked ? { projectId: linked.projectId, lectureId: null } : null });
  },

  removeCourse: async (projectId) => {
    set({ courses: await window.dela!.lectures.removeCourse(projectId), selected: null });
    await get().refresh();
  },

  installModel: async () => {
    try {
      await window.dela!.lectures.installSpeechModel();
    } catch (cause) {
      if (get().model.status !== 'missing')
        showToast({ variant: 'error', title: '模型下载失败', description: errorText(cause) });
    }
  },

  start: async (projectId) => {
    if (get().recording) return;
    const api = window.dela!.lectures;
    try {
      const lecture = await api.start(projectId);
      set({
        selected: { projectId, lectureId: lecture.id },
        recording: {
          projectId,
          lectureId: lecture.id,
          lines: [],
          elapsedMs: 0,
          level: 0,
          paused: false,
          stopping: false,
        },
      });
      try {
        recorder = await LectureRecorder.start(
          (pcm) => {
            api.pushAudio(projectId, lecture.id, pcm);
            const current = get().recording;
            if (!current) return;
            let sum = 0;
            for (const sample of pcm) sum += sample * sample;
            set({
              recording: {
                ...current,
                elapsedMs: current.elapsedMs + pcm.length / 16,
                level: Math.min(1, Math.sqrt(sum / pcm.length) * 8),
              },
            });
          },
          (chunk) => api.pushRecording(projectId, lecture.id, chunk),
        );
      } catch (cause) {
        await api.stop(projectId, lecture.id);
        throw cause;
      }
      await get().refresh();
    } catch (cause) {
      set({ recording: null });
      showToast({ variant: 'error', title: '无法开始录音', description: errorText(cause) });
    }
  },

  togglePause: () => {
    const current = get().recording;
    if (!recorder || !current) return;
    if (recorder.paused) recorder.resume();
    else recorder.pause();
    set({ recording: { ...current, paused: recorder.paused, level: 0 } });
  },

  stop: async () => {
    const current = get().recording;
    if (!current || current.stopping) return;
    set({ recording: { ...current, stopping: true } });
    try {
      await recorder?.stop();
      await window.dela!.lectures.stop(current.projectId, current.lectureId);
    } catch (cause) {
      showToast({ variant: 'error', title: '录音收尾失败', description: errorText(cause) });
    } finally {
      recorder = null;
      set({ recording: null });
      await get().refresh();
    }
  },
}));
