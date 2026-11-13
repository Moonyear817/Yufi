// 微软 365 的令牌：并发请求只刷新一次、轮换后的刷新令牌存回、登录失效给出能看懂的原因、回跳校验 state。
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
vi.mock('../../campus', () => ({ createCampusLoginWindow: vi.fn() }));
vi.mock('../../credentials', () => ({ saveMailCredentials: vi.fn() }));

import { net, type WebContents } from 'electron';
import { createCampusLoginWindow } from '../../campus';
import { saveMailCredentials } from '../../credentials';
import {
  MICROSOFT_REDIRECT,
  microsoftAccessToken,
  readRedirect,
  signInMicrosoft,
} from '../microsoft';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.mocked(net.fetch).mockReset();
  vi.mocked(saveMailCredentials).mockReset();
});

it('refreshes once for concurrent requests, keeps the rotated refresh token, and reuses the access token', async () => {
  vi.mocked(net.fetch).mockResolvedValue(
    json(200, { access_token: 'access-1', refresh_token: 'refresh-2', expires_in: 3600 }),
  );
  const credential = {
    address: 'student@wku.edu.cn',
    password: '',
    microsoft: { clientId: 'client', refreshToken: 'refresh-1' },
  };

  expect(
    await Promise.all([microsoftAccessToken(credential), microsoftAccessToken(credential)]),
  ).toEqual(['access-1', 'access-1']);
  expect(await microsoftAccessToken(credential)).toBe('access-1');

  expect(net.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = vi.mocked(net.fetch).mock.calls[0]!;
  expect(url).toBe('https://login.microsoftonline.com/wku.edu.cn/oauth2/v2.0/token');
  const body = new URLSearchParams(init!.body as string);
  expect([body.get('grant_type'), body.get('refresh_token'), body.get('client_id')]).toEqual([
    'refresh_token',
    'refresh-1',
    'client',
  ]);
  expect(saveMailCredentials).toHaveBeenCalledWith({
    ...credential,
    microsoft: { clientId: 'client', refreshToken: 'refresh-2' },
  });
});

it('asks for a new sign-in when Microsoft no longer accepts the refresh token', async () => {
  vi.mocked(net.fetch).mockResolvedValue(
    json(400, {
      error: 'invalid_grant',
      error_description: 'AADSTS700082: The refresh token has expired.\r\nTrace ID: 1',
    }),
  );
  await expect(
    microsoftAccessToken({
      address: 'other@wku.edu.cn',
      password: '',
      microsoft: { clientId: 'client', refreshToken: 'old' },
    }),
  ).rejects.toThrow(
    '学校邮箱登录已失效，请在设置里重新登录（AADSTS700082: The refresh token has expired.）',
  );
  expect(saveMailCredentials).not.toHaveBeenCalled();
});

it('takes the code from the sign-in redirect only when the state matches', () => {
  expect(readRedirect(`${MICROSOFT_REDIRECT}?code=abc&state=s1`, 's1')).toEqual({ code: 'abc' });
  expect(readRedirect(`${MICROSOFT_REDIRECT}?code=abc&state=forged`, 's1')).toEqual({
    error: '登录校验失败，请重试',
  });
  expect(
    readRedirect(
      `${MICROSOFT_REDIRECT}?error=access_denied&error_description=AADSTS65004%3A+User+declined+to+consent.%0D%0ATrace&state=s1`,
      's1',
    ),
  ).toEqual({ error: 'AADSTS65004: User declined to consent.' });
});

it('stops before the sign-in window when the school tenant id was pasted as the client id', async () => {
  const tenant = 'aa690af3-fbc2-4978-a1a2-9950b24d3cfb';
  vi.mocked(net.fetch).mockResolvedValue(
    json(200, { issuer: `https://login.microsoftonline.com/${tenant}/v2.0` }),
  );
  await expect(
    signInMicrosoft({} as WebContents, 'student@wku.edu.cn', tenant.toUpperCase()),
  ).rejects.toThrow('填成了学校的「目录（租户）ID」');
  expect(vi.mocked(net.fetch).mock.calls[0]![0]).toBe(
    'https://login.microsoftonline.com/wku.edu.cn/v2.0/.well-known/openid-configuration',
  );
  expect(createCampusLoginWindow).not.toHaveBeenCalled();
});

it('explains a client id the school directory does not know before opening the sign-in window', async () => {
  vi.mocked(net.fetch)
    .mockResolvedValueOnce(
      json(200, {
        issuer: 'https://login.microsoftonline.com/aa690af3-fbc2-4978-a1a2-9950b24d3cfb/v2.0',
      }),
    )
    .mockResolvedValueOnce(json(400, { error: 'unauthorized_client', error_codes: [700016] }));
  await expect(
    signInMicrosoft(
      {} as WebContents,
      'student@wku.edu.cn',
      'de03aefd-bc84-4297-a4cc-6f3fbf7c16d3',
    ),
  ).rejects.toThrow('学校目录里找不到这个应用 ID');
  const [url, init] = vi.mocked(net.fetch).mock.calls[1]!;
  expect(url).toBe('https://login.microsoftonline.com/wku.edu.cn/oauth2/v2.0/devicecode');
  expect(new URLSearchParams(init!.body as string).get('client_id')).toBe(
    'de03aefd-bc84-4297-a4cc-6f3fbf7c16d3',
  );
  expect(createCampusLoginWindow).not.toHaveBeenCalled();
});

it('explains an app registered for personal Microsoft accounts only', async () => {
  vi.mocked(net.fetch)
    .mockResolvedValueOnce(
      json(200, {
        issuer: 'https://login.microsoftonline.com/aa690af3-fbc2-4978-a1a2-9950b24d3cfb/v2.0',
      }),
    )
    .mockResolvedValueOnce(json(400, { error: 'invalid_request', error_codes: [9002346] }));
  await expect(
    signInMicrosoft(
      {} as WebContents,
      'student@wku.edu.cn',
      'cf20ad47-26c3-400f-8600-f292355455e1',
    ),
  ).rejects.toThrow('选成了「仅个人 Microsoft 帐户」');
  expect(createCampusLoginWindow).not.toHaveBeenCalled();
});
