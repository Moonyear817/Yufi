import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getDatabase } from '../database';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  linkProjectFolder,
  projectDirectory,
} from '../workspace/api';
import {
  LECTURE_AUDIO,
  LECTURE_NOTES,
  LECTURE_TRANSCRIPT,
  LECTURES_FOLDER,
  parseTranscript,
  type Lecture,
  type LectureCourse,
} from '../../shared/lectures';

const KEY = 'lecture-courses';
const registrySchema = z.array(
  z.object({ projectId: z.string(), canvasCourseId: z.number().int().positive().nullable() }),
);
const lectureIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((id) => !/[\\/]/.test(id) && id !== '.' && id !== '..', '无效的课次');

function registry(): z.infer<typeof registrySchema> {
  const row = getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(KEY) as
    { value: string } | undefined;
  return row ? registrySchema.parse(JSON.parse(row.value)) : [];
}

function saveRegistry(courses: z.infer<typeof registrySchema>) {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(KEY, JSON.stringify(courses));
}

function readLecture(projectId: string, root: string, id: string): Lecture {
  const path = join(root, LECTURES_FOLDER, id);
  const transcript = join(path, LECTURE_TRANSCRIPT);
  const hasTranscript = existsSync(transcript);
  return {
    id,
    projectId,
    path,
    hasAudio: existsSync(join(path, LECTURE_AUDIO)),
    hasTranscript,
    hasNotes: existsSync(join(path, LECTURE_NOTES)),
    durationMs: hasTranscript ? parseTranscript(readFileSync(transcript, 'utf8')).durationMs : null,
  };
}

export function listCourses(): LectureCourse[] {
  const projects = new Map(
    getWorkspaceState()
      .entries.filter((entry) => entry.kind === 'project' && !entry.remoteId && entry.path)
      .map((entry) => [entry.id, entry]),
  );
  return registry().flatMap(({ projectId, canvasCourseId }) => {
    const project = projects.get(projectId);
    if (!project?.path) return [];
    const folder = join(project.path, LECTURES_FOLDER);
    const lectures = existsSync(folder)
      ? readdirSync(folder, { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .map((item) => readLecture(projectId, project.path!, item.name))
          .sort((a, b) => b.id.localeCompare(a.id))
      : [];
    return [{ projectId, name: project.name, path: project.path, canvasCourseId, lectures }];
  });
}

function register(projectId: string, canvasCourseId: number | null): LectureCourse[] {
  const courses = registry().filter((course) => course.projectId !== projectId);
  saveRegistry([...courses, { projectId, canvasCourseId }]);
  return listCourses();
}

export function createCourse(name: unknown, canvasCourseId: unknown): LectureCourse[] {
  const project = createWorkspaceEntry({
    parentId: null,
    name: z.string().trim().min(1).max(120).parse(name),
    kind: 'project',
  });
  return register(project.id, z.number().int().positive().nullable().parse(canvasCourseId));
}

export function linkCourseFolder(path: string): LectureCourse[] {
  return register(linkProjectFolder(path).id, null);
}

export function removeCourse(projectId: unknown): LectureCourse[] {
  const id = z.string().parse(projectId);
  saveRegistry(registry().filter((course) => course.projectId !== id));
  return listCourses();
}

/** 只放行已登记课程里「课堂录音」下的课次目录，渲染进程给的 id 不能借此读写别处。 */
export function lectureDirectory(projectId: unknown, lectureId: unknown): string {
  const id = z.string().parse(projectId);
  if (!registry().some((course) => course.projectId === id)) throw new Error('课程不存在');
  return join(projectDirectory(id), LECTURES_FOLDER, lectureIdSchema.parse(lectureId));
}

export function lectureOf(projectId: string, lectureId: string): Lecture {
  return readLecture(projectId, projectDirectory(projectId), lectureId);
}

export function createLectureFolder(projectId: unknown, now = new Date()): Lecture {
  const id = z.string().parse(projectId);
  const pad = (value: number) => String(value).padStart(2, '0');
  const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  let name = base;
  for (let n = 2; existsSync(lectureDirectory(id, name)); n++) name = `${base} (${n})`;
  mkdirSync(lectureDirectory(id, name), { recursive: true });
  return lectureOf(id, name);
}
