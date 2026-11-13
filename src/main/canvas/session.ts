/**
 * Kean Canvas 的登录与请求：学校不给学生开 Access Token，所以由用户在登录窗口里自己登录，
 * 之后主进程用校园分区里的会话 Cookie 调 `/api/v1`（只发 GET，不需要 CSRF token）。
 * 会话过期时先用隐藏窗口走一次 SSO 静默续期，续不上再请用户重新登录。
 */
import { net, type IncomingMessage, type WebContents } from 'electron';
import { z } from 'zod';
import { getDatabase } from '../database';
import {
  clearCampusSession,
  flushCampusSession,
  getCampusSession,
  hiddenCampusLogin,
  openCampusLoginWindow,
} from '../campus';
import { CANVAS_ORIGIN } from '../../shared/canvas';

const ACCOUNT_KEY = 'canvas-account';
const LOGIN_URL = `${CANVAS_ORIGIN}/login`;
const LOGIN_EXPIRED = 'Canvas 登录已失效，请在「设置 › 连接」里重新登录 Canvas';
/** 静默续期失败后的冷却：期间直接报登录失效，避免每个请求都等一次隐藏窗口超时。 */
const RELOGIN_COOLDOWN_MS = 10 * 60 * 1000;

export interface CanvasAccount {
  id: number;
  name: string;
}

const accountSchema = z.object({ id: z.number().int().positive(), name: z.string() });

export class CanvasAuthError extends Error {}

export function loadCanvasAccount(): CanvasAccount | null {
  const row = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(ACCOUNT_KEY) as { value: string } | undefined;
  return row ? (accountSchema.safeParse(JSON.parse(row.value)).data ?? null) : null;
}

function saveCanvasAccount(account: CanvasAccount) {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(ACCOUNT_KEY, JSON.stringify(account));
}

/** 登录窗口落到 Canvas 自己的页面（不是 /login 系列、也不是 SSO 页）才算到达。 */
function reachedCanvas(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === CANVAS_ORIGIN && !parsed.pathname.startsWith('/login');
  } catch {
    return false;
  }
}

interface SendOptions {
  /** 下载要跟随到签名存储地址；API 请求遇到重定向一律当作登录失效。 */
  followRedirects: boolean;
  timeoutMs: number;
}

/** 用校园分区的会话发 GET，返回已确认 200 的响应流；401/403 与跳回登录页抛 CanvasAuthError。 */
function send(url: string, options: SendOptions): Promise<IncomingMessage> {
  return getCampusSession().then(
    (campus) =>
      new Promise<IncomingMessage>((resolve, reject) => {
        const request = net.request({
          url,
          method: 'GET',
          session: campus,
          useSessionCookies: true,
          redirect: 'manual',
        });
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
          request.abort();
        };
        const timer = setTimeout(
          () => fail(new Error('Canvas 请求超时，请稍后重试')),
          options.timeoutMs,
        );
        let redirects = 0;
        request.on('redirect', (_status, _method, location) => {
          const target = new URL(location, url);
          if (
            !options.followRedirects ||
            (target.origin === CANVAS_ORIGIN && target.pathname.startsWith('/login'))
          ) {
            fail(new CanvasAuthError(LOGIN_EXPIRED));
            return;
          }
          if (target.protocol !== 'https:' || ++redirects > 5) {
            fail(new Error('Canvas 下载重定向无效'));
            return;
          }
          request.followRedirect();
        });
        request.on('error', () => fail(new Error('无法连接 Canvas，请检查网络后重试')));
        request.on('response', (response) => {
          const status = response.statusCode;
          if (status === 401 || status === 403) {
            fail(new CanvasAuthError(LOGIN_EXPIRED));
            return;
          }
          if (status !== 200) {
            fail(new Error(`Canvas HTTP ${status}${status === 404 ? '：内容不可用' : ''}`));
            return;
          }
          if (settled) return;
          settled = true;
          // 响应体由调用方读完；超时只管到拿到响应头为止，下载另有调用方自己的节奏。
          clearTimeout(timer);
          resolve(response);
        });
        request.end();
      }),
  );
}

async function readBody(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of response as unknown as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function toResponse(message: IncomingMessage, body: Buffer): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers))
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  return new Response(new Uint8Array(body), { status: message.statusCode, headers });
}

async function getOnce(url: string): Promise<Response> {
  const message = await send(url, { followRedirects: false, timeoutMs: 30000 });
  return toResponse(message, await readBody(message));
}

async function fetchProfile(): Promise<CanvasAccount> {
  const response = await getOnce(`${CANVAS_ORIGIN}/api/v1/users/self/profile`);
  const profile = z
    .object({ id: z.number().int().positive(), name: z.string().optional() })
    .parse(await response.json());
  return { id: profile.id, name: profile.name ?? '' };
}

let relogin: Promise<void> | undefined;
let reloginFailedAt = 0;

/** 隐藏窗口里重走一次 SSO：身份提供方还记得用户时不用弹窗；同时失效的请求共用一次。 */
function silentRelogin(): Promise<void> {
  if (Date.now() - reloginFailedAt < RELOGIN_COOLDOWN_MS)
    return Promise.reject(new CanvasAuthError(LOGIN_EXPIRED));
  relogin ??= hiddenCampusLogin(LOGIN_URL, async () => {
    await fetchProfile();
  })
    .then(() => flushCampusSession())
    .catch(() => {
      reloginFailedAt = Date.now();
      throw new CanvasAuthError(LOGIN_EXPIRED);
    })
    .finally(() => {
      relogin = undefined;
    });
  return relogin;
}

async function withRelogin<T>(task: () => Promise<T>): Promise<T> {
  if (!loadCanvasAccount()) throw new Error('请先在「设置 › 连接」里登录 Canvas');
  try {
    return await task();
  } catch (error) {
    if (!(error instanceof CanvasAuthError)) throw error;
    await silentRelogin();
    return task();
  }
}

/** Canvas API GET，返回完整读入的 Response（分页靠 Link 头）。 */
export function canvasGet(url: string): Promise<Response> {
  return withRelogin(() => getOnce(url));
}

/** 文件下载：跟随 Canvas 到签名存储的重定向，返回未读的响应流。 */
export function canvasDownload(url: string): Promise<IncomingMessage> {
  return withRelogin(() => send(url, { followRedirects: true, timeoutMs: 60000 }));
}

/** 打开登录窗口让用户自己登录（密码、二次验证都在 SSO 页面里由用户完成）。 */
export async function loginCanvas(sender: WebContents): Promise<CanvasAccount> {
  let account: CanvasAccount | undefined;
  const result = await openCampusLoginWindow({
    sender,
    title: '登录 Kean Canvas',
    url: LOGIN_URL,
    reached: reachedCanvas,
    probe: async () => {
      account = await fetchProfile();
    },
    retryProbe: true,
  });
  if (!result.ok) throw new Error(result.error);
  if (!account) throw new Error('未完成登录');
  saveCanvasAccount(account);
  reloginFailedAt = 0;
  await flushCampusSession();
  return account;
}

/** 断开：忘掉账号并清空登录分区（Canvas 与 SSO 的 Cookie 一起清掉）。 */
export async function logoutCanvas(): Promise<void> {
  getDatabase().prepare('DELETE FROM workspace_settings WHERE key=?').run(ACCOUNT_KEY);
  await clearCampusSession();
}
