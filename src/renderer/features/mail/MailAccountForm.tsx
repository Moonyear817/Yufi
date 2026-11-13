import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { MailConfigureInput } from '../../../shared/mail';
import { SegmentedControl } from '../../components/ui/beautifului/atoms/SegmentedControl';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';

const modes = ['学校邮箱', '第三方 IMAP'] as const;
const clientIdKey = 'dela.mail.microsoftClientId';

/**
 * 向导页与邮箱空态共用的连接表单：学校邮箱（微软 365）填 Entra 应用 ID 后弹出学校登录窗口授权，
 * 不收密码；第三方 IMAP 自填服务器参数。
 */
export function MailAccountForm({
  error,
  onSubmit,
  submit,
  variant = 'app',
}: {
  error: string | null;
  onSubmit: (input: MailConfigureInput) => void;
  /** 提交按钮由调用方传入：向导要带成功态的 StepButton，应用内用 Button。 */
  submit: ReactNode;
  /** wizard：向导画布上的 40px 控件；app：应用内的 32px 控件。 */
  variant?: 'app' | 'wizard';
}) {
  const [mode, setMode] = useState<(typeof modes)[number]>('学校邮箱');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState(() => {
    try {
      return localStorage.getItem(clientIdKey) ?? '';
    } catch {
      return '';
    }
  });
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const custom = mode === '第三方 IMAP';
  const wizard = variant === 'wizard';
  const field = wizard ? 'h-10 rounded-card' : '';
  const label = wizard ? 'text-13 font-medium text-ink-2' : 'text-xs font-medium text-ink-3';

  return (
    <form
      className={wizard ? 'grid gap-5' : 'grid gap-4'}
      onSubmit={(event) => {
        event.preventDefault();
        if (!custom) {
          // 授权被拒或中途关窗后重试时不用再粘贴一遍 ID。
          try {
            localStorage.setItem(clientIdKey, clientId.trim());
          } catch {
            /* 只影响下次是否预填。 */
          }
          onSubmit({ address: address.trim(), password: '', microsoftClientId: clientId.trim() });
          return;
        }
        onSubmit({
          address: address.trim(),
          password,
          ...(custom
            ? {
                server: {
                  imapHost: imapHost.trim(),
                  imapPort: Number(imapPort),
                  smtpHost: smtpHost.trim(),
                  smtpPort: Number(smtpPort),
                },
              }
            : {}),
        });
      }}
    >
      <SegmentedControl className="w-full" onChange={setMode} options={modes} value={mode} />
      <label className="grid gap-2">
        <span className={label}>邮箱地址</span>
        <Input
          autoComplete="off"
          className={field}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={custom ? 'name@example.com' : 'name@wku.edu.cn'}
          required
          type="email"
          value={address}
        />
      </label>
      {custom ? (
        <label className="grid gap-2">
          <span className={label}>密码</span>
          <Input
            autoComplete="current-password"
            className={field}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="邮箱密码或授权码"
            required
            type="password"
            value={password}
          />
        </label>
      ) : (
        <label className="grid gap-2">
          <span className={label}>应用程序（客户端）ID</span>
          <Input
            autoComplete="off"
            className={field}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            required
            spellCheck={false}
            value={clientId}
          />
          <span className="text-xs leading-relaxed text-ink-3">
            在学校 Entra 里注册的 Yufi 应用的
            ID。提交后会弹出学校登录窗口，登录并同意授权即可，不需要邮箱密码。
          </span>
        </label>
      )}
      <AnimatePresence initial={false}>
        {custom && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key="custom-server"
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className="grid gap-4">
              <ServerRow
                field={field}
                host={imapHost}
                label={label}
                name="IMAP 服务器"
                onHost={setImapHost}
                onPort={setImapPort}
                placeholder="imap.example.com"
                port={imapPort}
              />
              <ServerRow
                field={field}
                host={smtpHost}
                label={label}
                name="SMTP 服务器"
                onHost={setSmtpHost}
                onPort={setSmtpPort}
                placeholder="smtp.example.com"
                port={smtpPort}
              />
              <p className="text-xs leading-relaxed text-ink-3">
                固定使用 SSL/TLS 加密；用户名即邮箱地址。发信走 SMTP，收信走 IMAP。
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && (
        <p
          className={wizard ? 'text-13 [overflow-wrap:anywhere] text-red-600' : 'text-13 text-red'}
          role="alert"
        >
          {error}
        </p>
      )}
      {submit}
    </form>
  );
}

/** 服务器地址 + 端口一行：端口固定窄列，地址占满剩余宽度。 */
function ServerRow({
  field,
  host,
  label,
  name,
  onHost,
  onPort,
  placeholder,
  port,
}: {
  field: string;
  host: string;
  label: string;
  name: string;
  onHost: (value: string) => void;
  onPort: (value: string) => void;
  placeholder: string;
  port: string;
}) {
  return (
    <div className="grid gap-2">
      <span className={label}>{name}</span>
      <div className="flex gap-2">
        <Input
          aria-label={`${name}地址`}
          autoComplete="off"
          className={cn('flex-1', field)}
          onChange={(event) => onHost(event.target.value)}
          placeholder={placeholder}
          required
          value={host}
        />
        <Input
          aria-label={`${name}端口`}
          className={cn('w-20', field)}
          inputMode="numeric"
          max={65535}
          min={1}
          onChange={(event) => onPort(event.target.value)}
          required
          type="number"
          value={port}
        />
      </div>
    </div>
  );
}
