import type { LecturesApi } from '../shared/lectures';
import type { SkillDependency } from '../shared/capabilities';
import type { LiveTranscript } from '../shared/lectures';
import { invoke, on, send } from './lib';

export const lectures = {
  list: () => invoke('lectures:list'),
  createCourse: (name: string, canvasCourseId: number | null) =>
    invoke('lectures:create-course', name, canvasCourseId),
  linkCourseFolder: () => invoke('lectures:link-course-folder'),
  removeCourse: (projectId: string) => invoke('lectures:remove-course', projectId),
  speechModel: () => invoke('lectures:speech-model'),
  installSpeechModel: () => invoke('lectures:install-speech-model'),
  cancelSpeechModel: () => invoke('lectures:cancel-speech-model'),
  start: (projectId: string) => invoke('lectures:start', projectId),
  pushAudio: (projectId: string, lectureId: string, pcm: Float32Array) =>
    send('lectures:audio', projectId, lectureId, pcm),
  pushRecording: (projectId: string, lectureId: string, chunk: Uint8Array) =>
    send('lectures:recording', projectId, lectureId, chunk),
  stop: (projectId: string, lectureId: string) => invoke('lectures:stop', projectId, lectureId),
  transcript: (projectId: string, lectureId: string) =>
    invoke('lectures:transcript', projectId, lectureId),
  audioUrl: (projectId: string, lectureId: string) =>
    `dela-resource://lecture-audio/${encodeURIComponent(projectId)}/${encodeURIComponent(lectureId)}`,
  onLive: (listener: (update: LiveTranscript) => void) =>
    on<LiveTranscript>('lectures:live', listener),
  onSpeechModel: (listener: (state: SkillDependency) => void) =>
    on<SkillDependency>('lectures:speech-model', listener),
} satisfies LecturesApi;
