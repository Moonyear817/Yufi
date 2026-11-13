/**
 * 学校微软 365 邮箱的 OAuth。登录窗口里走授权码 + PKCE（公共客户端，没有密钥），截下回跳到
 * nativeclient 地址的授权码换令牌；之后按需用刷新令牌换 IMAP/SMTP 的访问令牌，轮换后的刷新令牌存回本机。
 * 应用由学生自己在学校 Entra 里注册（单租户），所以授权地址按邮箱域名指向学校租户。
 */
import { net, type WebContents } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createCampusLoginWindow } from '../campus';
import { saveMailCredentials, type MailCredential } from '../credentials';

export const MICROSOFT_REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPES =
  'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send';

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});
type Token = z.infer<typeof tokenSchema>;

const tenantOf = (address: string) => address.slice(address.lastIndexOf('@') + 1);

async function requestToken(address: string, body: Record<string, string>): Promise<Token> {
  const response = await net.fetch(
    `https://login.microsoftonline.com/${tenantOf(address)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, scope: SCOPES }).toString(),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as { error_description?: string };
  if (!response.ok)
    throw new Error(
      payload.error_description?.split('\r\n')[0] ?? `微软登录失败（HTTP ${response.status}）`,
    );
  return tokenSchema.parse(payload);
}

const cached = new Map<string, { token: string; expiresAt: number }>();
const refreshing = new Map<string, Promise<string>>();

function remember(address: string, token: Token): string {
  // 提前五分钟视为过期，避免长连接刚建好令牌就失效。
  cached.set(address, {
    token: token.access_token,
    expiresAt: Date.now() + (token.expires_in - 300) * 1000,
  });
  return token.access_token;
}

/** 解析回跳地址：拿到授权码，或给出微软返回的拒绝原因。 */
export function readRedirect(url: string, state: string): { code: string } | { error: string } {
  const params = new URL(url).searchParams;
  const code = params.get('code');
  if (params.get('state') !== state) return { error: '登录校验失败，请重试' };
  if (code) return { code };
  return { error: params.get('error_description')?.split('\r\n')[0] ?? '微软拒绝了授权' };
}

/** 学校租户的 ID（公开信息）；查不到时返回 null，不挡登录。 */
async function tenantId(address: string): Promise<string | null> {
  try {
    const response = await net.fetch(
      `https://login.microsoftonline.com/${tenantOf(address)}/v2.0/.well-known/openid-configuration`,
    );
    const { issuer } = (await response.json()) as { issuer?: string };
    return issuer?.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** 设备码接口不用登录就会指出应用注册的两类错误，提前用中文说明怎么改；其余情况（含网络失败）照常登录。 */
const REGISTRATION_PROBLEMS: Record<number, string> = {
  700016:
    '学校目录里找不到这个应用 ID。请确认复制的是 Yufi 概述页上的「应用程序（客户端）ID」而不是「对象 ID」，并且概述页的「目录（租户）ID」是温州肯恩大学的（aa690af3 开头）',
  9002346:
    'Yufi 应用的「受支持的帐户类型」选成了「仅个人 Microsoft 帐户」，学校账号登录不了。请在 Entra 里打开 Yufi 的「身份验证」页，改成「仅此组织目录中的帐户」并保存；改不了就删掉重新注册，注册时选这一项',
};

async function registrationProblem(address: string, clientId: string): Promise<string | null> {
  try {
    const response = await net.fetch(
      `https://login.microsoftonline.com/${tenantOf(address)}/oauth2/v2.0/devicecode`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, scope: SCOPES }).toString(),
      },
    );
    const { error_codes: codes = [] } = (await response.json()) as { error_codes?: number[] };
    return codes.map((code) => REGISTRATION_PROBLEMS[code]).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

/** 打开登录窗口让用户登录学校账号并同意授权，返回刷新令牌。 */
export async function signInMicrosoft(
  sender: WebContents,
  address: string,
  clientId: string,
): Promise<string> {
  // Entra 概述页上「目录（租户）ID」紧挨着「应用程序（客户端）ID」，很容易复制错。
  if ((await tenantId(address)) === clientId.toLowerCase())
    throw new Error(
      '填成了学校的「目录（租户）ID」。请到 Entra 里 Yufi 应用的概述页，复制上一行的「应用程序（客户端）ID」',
    );
  const problem = await registrationProblem(address, clientId);
  if (problem) throw new Error(problem);
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorize = new URL(
    `https://login.microsoftonline.com/${tenantOf(address)}/oauth2/v2.0/authorize`,
  );
  authorize.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: MICROSOFT_REDIRECT,
    scope: SCOPES,
    state,
    login_hint: address,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  const code = await new Promise<string>((resolve, reject) => {
    const window = createCampusLoginWindow(sender, '登录学校邮箱');
    let settled = false;
    const settle = (result: { code: string } | { error: string }) => {
      if (settled) return;
      settled = true;
      if ('code' in result) resolve(result.code);
      else reject(new Error(result.error));
      if (!window.isDestroyed()) window.close();
    };
    const intercept = (event: { preventDefault: () => void }, target: string) => {
      if (!target.startsWith(MICROSOFT_REDIRECT)) return;
      event.preventDefault();
      settle(readRedirect(target, state));
    };
    window.webContents.on('will-redirect', intercept);
    window.webContents.on('will-navigate', intercept);
    window.on('closed', () =>
      settle({
        error: '没有完成登录。如果窗口里提示「需要管理员批准」，说明学校没有开放邮箱授权',
      }),
    );
    window.loadURL(authorize.href).catch((error: unknown) => {
      if (!settled) settle({ error: error instanceof Error ? error.message : String(error) });
    });
  });
  const token = await requestToken(address, {
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: MICROSOFT_REDIRECT,
    code_verifier: verifier,
  });
  remember(address, token);
  return token.refresh_token;
}

/** IMAP 与 SMTP 共用：访问令牌没过期就直接用；同时到期的多个请求只刷新一次。 */
export function microsoftAccessToken(credential: MailCredential): Promise<string> {
  const microsoft = credential.microsoft;
  if (!microsoft) throw new Error('不是微软 365 邮箱账号');
  const hit = cached.get(credential.address);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.token);
  let pending = refreshing.get(credential.address);
  if (!pending) {
    pending = requestToken(credential.address, {
      client_id: microsoft.clientId,
      grant_type: 'refresh_token',
      refresh_token: microsoft.refreshToken,
    })
      .then((token) => {
        saveMailCredentials({
          ...credential,
          microsoft: { ...microsoft, refreshToken: token.refresh_token },
        });
        return remember(credential.address, token);
      })
      .catch((error: unknown) => {
        throw new Error(
          `学校邮箱登录已失效，请在设置里重新登录（${error instanceof Error ? error.message : String(error)}）`,
        );
      })
      .finally(() => refreshing.delete(credential.address));
    refreshing.set(credential.address, pending);
  }
  return pending;
}
