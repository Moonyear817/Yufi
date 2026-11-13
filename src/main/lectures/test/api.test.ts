// 课程登记与课次目录：课次 id 来自渲染进程，只能落在已登记课程的「课堂录音」下。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'dela-lectures-'));
let database: DatabaseSync;
vi.mock('../../database', () => ({ getDatabase: () => database }));
vi.mock('../../workspace/api', () => ({
  createWorkspaceEntry: () => ({ id: 'acct' }),
  linkProjectFolder: () => ({ id: 'acct' }),
  projectDirectory: () => root,
  getWorkspaceState: () => ({
    entries: [{ id: 'acct', kind: 'project', name: 'ACCT 2200', path: root, remoteId: null }],
  }),
}));

import { createCourse, createLectureFolder, lectureDirectory, listCourses } from '../api';

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
});

it('only resolves lecture folders inside a registered course', () => {
  expect(() => lectureDirectory('acct', '2026-10-30 14.05')).toThrow('课程不存在');
  createCourse('ACCT 2200', 12345);
  expect(lectureDirectory('acct', '2026-10-30 14.05')).toBe(
    join(root, '课堂录音', '2026-10-30 14.05'),
  );
  for (const id of ['..', '../other', 'a/b', 'a\\b', ''])
    expect(() => lectureDirectory('acct', id)).toThrow();
});

it('names lectures by start time and lists them newest first with what each one has', () => {
  createCourse('ACCT 2200', null);
  const first = createLectureFolder('acct', new Date(2026, 9, 30, 14, 5));
  const second = createLectureFolder('acct', new Date(2026, 9, 30, 14, 5));
  expect([first.id, second.id]).toEqual(['2026-10-30 14.05', '2026-10-30 14.05 (2)']);
  mkdirSync(join(root, '课堂录音', '2026-11-02 09.00'));
  writeFileSync(
    join(root, '课堂录音', '2026-11-02 09.00', '文字稿.md'),
    '# t\n\n时长 01:30:00 · x\n',
  );
  writeFileSync(join(root, '课堂录音', '2026-11-02 09.00', '笔记.md'), '# 笔记');
  const [course] = listCourses();
  expect(course?.canvasCourseId).toBeNull();
  expect(
    course?.lectures.map(({ id, hasNotes, hasTranscript, durationMs }) => ({
      id,
      hasNotes,
      hasTranscript,
      durationMs,
    })),
  ).toEqual([
    { id: '2026-11-02 09.00', hasNotes: true, hasTranscript: true, durationMs: 5_400_000 },
    { id: '2026-10-30 14.05 (2)', hasNotes: false, hasTranscript: false, durationMs: null },
    { id: '2026-10-30 14.05', hasNotes: false, hasTranscript: false, durationMs: null },
  ]);
});
