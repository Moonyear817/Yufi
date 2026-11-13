import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import {
  FileText,
  FolderOpen,
  Loader2,
  Mic,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { showToast } from '../../app/toasts';
import { cn } from '../../lib/utils';
import { useNavigationStore } from '../../navigation/view';
import { useSessions } from '../../sessions/store';
import { errorText, useWorkspaceStore } from '../../workspace/store';
import { latestTermOf } from '../../../shared/canvas';
import {
  LECTURE_NOTES,
  LECTURE_TRANSCRIPT,
  LECTURES_FOLDER,
  type Lecture,
  type LectureCourse,
  type TranscriptSegment,
} from '../../../shared/lectures';
import { useLectures } from './store';

/** Kean 的课程名形如「2026FAW*ACCT*2200*W05 (Principles of Accounting I)」，作项目名时取「ACCT 2200 Principles of Accounting I」。 */
function courseTitle(name: string): string {
  const match = /^\d{4}[A-Z]+\*([A-Z]+)\*(\w+)\*\S+\s*\((.+)\)$/.exec(name);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : name;
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return (parts[0] ? parts : parts.slice(1))
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function LecturesView() {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="录音与语音识别都在本机进行。"
        title="课堂笔记仅在 Dela 桌面端可用"
      />
    );
  }
  return <DesktopLecturesView />;
}

function DesktopLecturesView() {
  const init = useLectures((state) => state.init);
  const loading = useLectures((state) => state.loading);
  const model = useLectures((state) => state.model);
  const courses = useLectures((state) => state.courses);
  const selected = useLectures((state) => state.selected);
  const recording = useLectures((state) => state.recording);

  useEffect(() => {
    void init();
  }, [init]);

  const course = courses.find((item) => item.projectId === selected?.projectId);
  const lecture = course?.lectures.find((item) => item.id === selected?.lectureId);
  const recordingHere = recording && recording.lectureId === selected?.lectureId;

  return (
    <div className="flex h-full min-h-0 bg-surface max-md:flex-col">
      <aside
        aria-label="课程"
        className="flex min-h-0 shrink-0 flex-col bg-inset md:w-64 max-md:max-h-56"
      >
        <div className="flex h-10 shrink-0 items-center gap-1 px-3">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-2">课堂笔记</span>
          <NewCourseMenu />
        </div>
        <CourseList />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {loading ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="size-5 animate-spin text-ink-3" />
          </div>
        ) : model.status !== 'ready' && !recording ? (
          <ModelCard />
        ) : recordingHere ? (
          <RecordingPanel />
        ) : course && lecture ? (
          <LecturePanel
            course={course}
            key={`${course.projectId}/${lecture.id}`}
            lecture={lecture}
          />
        ) : course ? (
          <CoursePanel course={course} />
        ) : (
          <Placeholder icon={NotebookPen} text="新建一门课程，开始录第一节课" />
        )}
      </section>
    </div>
  );
}

function Placeholder({ icon: Icon, text }: { icon: typeof Mic; text: string }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex flex-col items-center gap-2 text-13 text-ink-3">
        <Icon aria-hidden className="size-7 opacity-45" />
        <p>{text}</p>
      </div>
    </div>
  );
}

function CourseList() {
  const courses = useLectures((state) => state.courses);
  const selected = useLectures((state) => state.selected);
  const recording = useLectures((state) => state.recording);
  const select = useLectures((state) => state.select);

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {courses.map((course) => {
        const open = course.projectId === selected?.projectId;
        return (
          <div className="mb-0.5" key={course.projectId}>
            <button
              className={cn(
                'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-13 text-ink-2 hover:bg-hover-2',
                open && !selected?.lectureId && 'bg-hover-2 text-ink',
              )}
              onClick={() => select(course.projectId, null)}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">{course.name}</span>
              {recording?.projectId === course.projectId && (
                <span aria-label="录音中" className="size-1.5 rounded-full bg-red" />
              )}
              <span className="text-2xs tabular-nums text-ink-3">{course.lectures.length}</span>
            </button>
            {open &&
              course.lectures.map((lecture) => (
                <button
                  className={cn(
                    'flex w-full items-center gap-2 rounded-control py-1 pl-5 pr-2 text-left text-xs text-ink-3 hover:bg-hover-2',
                    selected?.lectureId === lecture.id && 'bg-hover-2 text-ink',
                  )}
                  key={lecture.id}
                  onClick={() => select(course.projectId, lecture.id)}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate tabular-nums">{lecture.id}</span>
                  {recording?.lectureId === lecture.id ? (
                    <span
                      aria-label="录音中"
                      className="size-1.5 animate-pulse rounded-full bg-red"
                    />
                  ) : (
                    <>
                      {lecture.hasNotes && <NotebookPen aria-label="已有笔记" className="size-3" />}
                      {lecture.durationMs !== null && (
                        <span className="tabular-nums">{clock(lecture.durationMs)}</span>
                      )}
                    </>
                  )}
                </button>
              ))}
          </div>
        );
      })}
    </nav>
  );
}

function NewCourseMenu() {
  const linkCourseFolder = useLectures((state) => state.linkCourseFolder);
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="添加课程" className="hover:bg-hover-2" size="icon-xs" variant="ghost">
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog(true)}>
            <Plus />
            新建课程
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void linkCourseFolder().catch((cause: unknown) =>
                showToast({ variant: 'error', title: '添加失败', description: errorText(cause) }),
              )
            }
          >
            <FolderOpen />
            使用已有文件夹
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewCourseDialog onOpenChange={setDialog} open={dialog} />
    </>
  );
}

function NewCourseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createCourse = useLectures((state) => state.createCourse);
  const canvasCourses = useWorkspaceStore((state) => state.canvas.courses);
  const term = latestTermOf(canvasCourses);
  const options = canvasCourses.filter((course) => course.term === term && !course.archived);
  const [name, setName] = useState('');
  const [canvasId, setCanvasId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createCourse(name, canvasId);
      setName('');
      setCanvasId(null);
      onOpenChange(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={(value) => !busy && onOpenChange(value)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-w-md')}>
          <Dialog.Title className="text-base font-semibold">新建课程</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs text-ink-3">
            每门课是一个项目，录音、文字稿和笔记都存在项目文件夹里。
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {options.length > 0 && (
              <label className="grid gap-2 text-13">
                对应的 Canvas 课程
                <Select
                  onValueChange={(value) => {
                    const course = options.find((item) => String(item.id) === value);
                    setCanvasId(course?.id ?? null);
                    if (course) setName(courseTitle(course.name));
                  }}
                  value={canvasId === null ? undefined : String(canvasId)}
                >
                  <SelectTrigger aria-label="对应的 Canvas 课程">
                    <SelectValue placeholder="不关联" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((course) => (
                      <SelectItem key={course.id} value={String(course.id)}>
                        {courseTitle(course.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <label className="grid gap-2 text-13">
              名称
              <Input
                autoFocus
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            {error && (
              <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                disabled={busy}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="ghost"
              >
                取消
              </Button>
              <Button disabled={busy || !name.trim()} type="submit">
                创建
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ModelCard() {
  const model = useLectures((state) => state.model);
  const installModel = useLectures((state) => state.installModel);
  const installing = model.status === 'installing';
  const percent =
    installing && model.total ? Math.round(((model.received ?? 0) / model.total) * 100) : 0;
  return (
    <div className="grid flex-1 place-items-center p-6">
      <section className="grid w-full max-w-[30rem] justify-items-start gap-3 rounded-card border border-line bg-surface p-6 shadow-hairline">
        <div className="grid size-10 place-items-center rounded-card bg-hover-2">
          <Mic className="size-5" />
        </div>
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold tracking-tight">下载语音识别模型</h2>
          <p className="text-13 leading-relaxed text-ink-3">
            约 1.2 GB，只需下载一次。录音和识别都在这台电脑上完成，不会上传。
          </p>
        </div>
        {installing && (
          <div className="grid w-full gap-1.5">
            <div className="h-1 w-full overflow-hidden rounded-full bg-hover-2">
              <div className="h-full bg-ink transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-xs tabular-nums text-ink-3">{percent}%</p>
          </div>
        )}
        {model.status === 'error' && (
          <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
            {model.error}
          </p>
        )}
        {installing ? (
          <Button onClick={() => void window.dela!.lectures.cancelSpeechModel()} variant="ghost">
            <X className="size-4" />
            取消
          </Button>
        ) : (
          <Button onClick={() => void installModel()}>下载</Button>
        )}
      </section>
    </div>
  );
}

function CoursePanel({ course }: { course: LectureCourse }) {
  const recording = useLectures((state) => state.recording);
  const start = useLectures((state) => state.start);
  const removeCourse = useLectures((state) => state.removeCourse);
  const [starting, setStarting] = useState(false);
  return (
    <div className="relative grid flex-1 place-items-center p-6">
      <div className="absolute right-3 top-3">
        <Button
          className="text-ink-3"
          onClick={() => void removeCourse(course.projectId)}
          size="sm"
          title="项目和录音文件都会保留"
          variant="ghost"
        >
          移出课堂笔记
        </Button>
      </div>
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-lg font-semibold tracking-tight">{course.name}</h2>
        <Button
          disabled={starting || recording !== null}
          onClick={() => {
            setStarting(true);
            void start(course.projectId).finally(() => setStarting(false));
          }}
          size="lg"
        >
          {starting ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
          开始录音
        </Button>
        {recording && <p className="text-xs text-ink-3">另一节课正在录音</p>}
      </div>
    </div>
  );
}

function RecordingPanel() {
  const recording = useLectures((state) => state.recording)!;
  const togglePause = useLectures((state) => state.togglePause);
  const stop = useLectures((state) => state.stop);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [recording.lines]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <span
          aria-hidden
          className={cn('size-2 rounded-full bg-red', !recording.paused && 'animate-pulse')}
        />
        <span className="text-13 font-medium tabular-nums">{clock(recording.elapsedMs)}</span>
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-full bg-hover-2">
          <div
            className="h-full bg-ink-3 transition-[width] duration-100"
            style={{ width: `${Math.round(recording.level * 100)}%` }}
          />
        </div>
        <div className="flex-1" />
        <Button
          aria-label={recording.paused ? '继续录音' : '暂停录音'}
          disabled={recording.stopping}
          onClick={togglePause}
          size="icon-sm"
          variant="ghost"
        >
          {recording.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </Button>
        <Button
          disabled={recording.stopping}
          onClick={() => void stop()}
          size="sm"
          variant="outline"
        >
          {recording.stopping ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Square className="size-3.5" />
          )}
          结束
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto grid max-w-3xl gap-3">
          {recording.lines.map((line) => (
            <TranscriptLine key={line.utterance} pending={!line.final} segment={line} />
          ))}
          {recording.lines.length === 0 && (
            <p className="py-10 text-center text-13 text-ink-3">
              {recording.paused ? '已暂停' : '正在听…'}
            </p>
          )}
          <div ref={bottom} />
        </div>
      </div>
    </>
  );
}

function TranscriptLine({
  segment,
  active,
  pending,
  onSeek,
}: {
  segment: { startMs: number; text: string };
  active?: boolean;
  pending?: boolean;
  onSeek?: () => void;
}) {
  return (
    <div
      className={cn('grid grid-cols-[3.5rem_1fr] gap-3 rounded-control', active && 'bg-hover-2')}
    >
      <button
        className="pt-0.5 text-left text-xs tabular-nums text-ink-3 enabled:hover:text-ink disabled:cursor-default"
        disabled={!onSeek}
        onClick={onSeek}
        type="button"
      >
        {clock(segment.startMs)}
      </button>
      <p className={cn('text-15 leading-relaxed', pending ? 'text-ink-3' : 'text-ink')}>
        {segment.text}
      </p>
    </div>
  );
}

function LecturePanel({ course, lecture }: { course: LectureCourse; lecture: Lecture }) {
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [time, setTime] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let disposed = false;
    void window
      .dela!.lectures.transcript(course.projectId, lecture.id)
      .then((value) => !disposed && setSegments(value))
      .catch(() => !disposed && setSegments([]));
    return () => {
      disposed = true;
    };
  }, [course.projectId, lecture.id]);

  const folder = `${LECTURES_FOLDER}/${lecture.id}`;
  const openInProject = (file: string) => {
    const navigation = useNavigationStore.getState();
    if (navigation.openProject(course.projectId))
      navigation.openDocument(`${lecture.path}/${file}`, { keep: true });
  };
  const organize = async () => {
    const sessionId = await useNavigationStore.getState().newChat(course.projectId);
    if (!sessionId) return;
    try {
      const chat = await window.dela!.session.ask(sessionId, {
        text: [
          `请把「${folder}/${LECTURE_TRANSCRIPT}」整理成这节课的笔记，写入「${folder}/${LECTURE_NOTES}」。`,
          '文字稿由本机语音识别生成，可能有错字或断句不准，请结合上下文理解。笔记包括：',
          '1. 本节概要（三五句话）',
          '2. 知识点：按讲课顺序分节，专业术语保留英文并附中文解释',
          '3. 老师强调的内容与可能的考点',
          '4. 作业、截止时间与课堂通知',
          '5. 没听清或需要课后确认的地方',
          '引用原话时标注文字稿里的时间，如 [00:12:30]。',
        ].join('\n'),
        attachments: [],
        context: [],
        comments: [],
      });
      if (chat.sessionId) useSessions.getState().putChat(chat.sessionId, chat);
    } catch (cause) {
      showToast({ variant: 'error', title: 'AI 整理失败', description: errorText(cause) });
    }
  };

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight">{lecture.id}</h2>
          <p className="truncate text-xs text-ink-3">
            {course.name}
            {lecture.durationMs !== null && ` · ${clock(lecture.durationMs)}`}
          </p>
        </div>
        {lecture.hasTranscript && (
          <Button onClick={() => openInProject(LECTURE_TRANSCRIPT)} size="sm" variant="ghost">
            <FileText className="size-3.5" />
            文字稿
          </Button>
        )}
        {lecture.hasNotes && (
          <Button onClick={() => openInProject(LECTURE_NOTES)} size="sm" variant="outline">
            <NotebookPen className="size-3.5" />
            笔记
          </Button>
        )}
        {lecture.hasTranscript && (
          <Button
            onClick={() => void organize()}
            size="sm"
            variant={lecture.hasNotes ? 'ghost' : 'default'}
          >
            <Sparkles className="size-3.5" />
            {lecture.hasNotes ? '重新整理' : 'AI 整理笔记'}
          </Button>
        )}
      </header>
      {lecture.hasAudio && (
        <div className="shrink-0 px-4 pb-3">
          <audio
            className="w-full"
            controls
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime * 1000)}
            preload="metadata"
            ref={audio}
            src={window.dela!.lectures.audioUrl(course.projectId, lecture.id)}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto grid max-w-3xl gap-3">
          {segments === null ? (
            <Loader2 className="mx-auto mt-10 size-5 animate-spin text-ink-3" />
          ) : segments.length === 0 ? (
            <p className="py-10 text-center text-13 text-ink-3">这节课没有识别出文字</p>
          ) : (
            segments.map((segment, index) => (
              <TranscriptLine
                active={lecture.hasAudio && time >= segment.startMs && time < segment.endMs}
                key={`${segment.startMs}-${index}`}
                onSeek={
                  lecture.hasAudio
                    ? () => {
                        if (!audio.current) return;
                        audio.current.currentTime = segment.startMs / 1000;
                        void audio.current.play();
                      }
                    : undefined
                }
                segment={segment}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
