import {
  BrowserWindow,
  dialog,
  ipcMain,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { createWriteStream, type WriteStream } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import { withDuration } from './webm';
import {
  createCourse,
  createLectureFolder,
  lectureDirectory,
  lectureOf,
  linkCourseFolder,
  listCourses,
  removeCourse,
} from './api';
import {
  cancelSpeechModelInstallation,
  installSpeechModel,
  LiveTranscriber,
  onSpeechModelState,
  SAMPLE_RATE,
  speechModelState,
} from './speech';
import {
  formatTranscript,
  LECTURE_AUDIO,
  LECTURE_TRANSCRIPT,
  parseTranscript,
  type LiveTranscript,
} from '../../shared/lectures';

interface Recording {
  sender: WebContents;
  directory: string;
  title: string;
  transcriber: LiveTranscriber;
  audio: WriteStream;
  saving: Promise<void>;
}

const recordings = new Map<string, Recording>();
const keyOf = (projectId: unknown, lectureId: unknown) => `${projectId}\n${lectureId}`;

/** 每定稿一句就整份重写文字稿：录到一半应用退出，已识别的内容也还在。 */
function saveTranscript(recording: Recording) {
  const text = formatTranscript(
    recording.title,
    (recording.transcriber.samples / SAMPLE_RATE) * 1000,
    recording.transcriber.transcript,
  );
  recording.saving = recording.saving
    .then(() => writeFile(join(recording.directory, LECTURE_TRANSCRIPT), text))
    .catch((error: unknown) => console.error('Transcript save failed', error));
}

async function start(event: IpcMainInvokeEvent, projectId: unknown) {
  if (
    process.platform === 'darwin' &&
    systemPreferences.getMediaAccessStatus('microphone') !== 'granted' &&
    !(await systemPreferences.askForMediaAccess('microphone'))
  )
    throw new Error('没有麦克风权限，请在「系统设置 › 隐私与安全性 › 麦克风」里允许 Dela');
  const course = listCourses().find((item) => item.projectId === projectId);
  if (!course) throw new Error('课程不存在');
  const lecture = createLectureFolder(course.projectId);
  const sender = event.sender;
  const key = keyOf(lecture.projectId, lecture.id);
  let transcriber: LiveTranscriber;
  try {
    transcriber = await LiveTranscriber.create((line) => {
      const recording = recordings.get(key);
      if (recording && line.final && line.text) saveTranscript(recording);
      if (!sender.isDestroyed())
        sender.send('lectures:live', {
          projectId: lecture.projectId,
          lectureId: lecture.id,
          ...line,
        } satisfies LiveTranscript);
    });
  } catch (error) {
    await rm(lecture.path, { recursive: true, force: true });
    throw error;
  }
  recordings.set(key, {
    sender,
    directory: lecture.path,
    title: `${course.name} · ${lecture.id}`,
    transcriber,
    audio: createWriteStream(join(lecture.path, LECTURE_AUDIO), { flags: 'a' }),
    saving: Promise.resolve(),
  });
  // 窗口在录音中途关掉时照常收尾，录音与文字稿不会半截丢失。
  sender.once('destroyed', () => void stop(lecture.projectId, lecture.id).catch(() => {}));
  return lecture;
}

async function stop(projectId: unknown, lectureId: unknown) {
  const key = keyOf(projectId, lectureId);
  const recording = recordings.get(key);
  if (!recording) return lectureOf(z.string().parse(projectId), z.string().parse(lectureId));
  recordings.delete(key);
  await recording.transcriber.finish();
  await new Promise<void>((resolve) => recording.audio.end(resolve));
  // 一点声音都没收到（比如麦克风没打开）的课次不留空文件夹。
  if (recording.transcriber.samples === 0) {
    await rm(recording.directory, { recursive: true, force: true });
    return null;
  }
  const audio = join(recording.directory, LECTURE_AUDIO);
  const durationMs = (recording.transcriber.samples / SAMPLE_RATE) * 1000;
  await writeFile(`${audio}.tmp`, withDuration(await readFile(audio), durationMs));
  await rename(`${audio}.tmp`, audio);
  saveTranscript(recording);
  await recording.saving;
  return lectureOf(z.string().parse(projectId), z.string().parse(lectureId));
}

function recordingFor(event: IpcMainEvent, projectId: unknown, lectureId: unknown) {
  const recording = recordings.get(keyOf(projectId, lectureId));
  return recording?.sender === event.sender ? recording : undefined;
}

export function registerLecturesIpc() {
  const handle = (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    ipcMain.handle(`lectures:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(event, ...args);
    });
  handle('list', () => listCourses());
  handle('create-course', (_event, name, canvasCourseId) => createCourse(name, canvasCourseId));
  handle('link-course-folder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = { title: '选择课程文件夹', properties: ['openDirectory' as const] };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return canceled || !filePaths[0] ? null : linkCourseFolder(filePaths[0]);
  });
  handle('remove-course', (_event, projectId) => removeCourse(projectId));
  handle('speech-model', () => speechModelState());
  handle('install-speech-model', () => installSpeechModel());
  handle('cancel-speech-model', () => cancelSpeechModelInstallation());
  handle('start', start);
  handle('stop', (_event, projectId, lectureId) => stop(projectId, lectureId));
  handle('transcript', async (_event, projectId, lectureId) => {
    const path = join(lectureDirectory(projectId, lectureId), LECTURE_TRANSCRIPT);
    return parseTranscript(await readFile(path, 'utf8').catch(() => '')).segments;
  });
  ipcMain.on('lectures:audio', (event, projectId, lectureId, pcm) => {
    if (pcm instanceof Float32Array)
      recordingFor(event, projectId, lectureId)?.transcriber.push(pcm);
  });
  ipcMain.on('lectures:recording', (event, projectId, lectureId, chunk) => {
    if (chunk instanceof Uint8Array)
      recordingFor(event, projectId, lectureId)?.audio.write(Buffer.from(chunk));
  });
  onSpeechModelState((state) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send('lectures:speech-model', state);
  });
}
