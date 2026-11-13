import { useState } from 'react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { connectCanvas } from '../../settings/connections/canvas-connect';
import { errorText } from '../../../workspace/store';
import { StepButton, type StepButtonState } from './step-controls';
import { StepGuide } from './step-guide';

/** 向导 · Canvas 步骤：Kean 不给学生发 Access Token，改为弹出登录窗口，登录后同步课程，按钮转为「下一步」。 */
export function CanvasStep({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="Canvas 登录状态与课程缓存不会暴露给浏览器。"
        title="Canvas 仅在 Dela 桌面端可用"
      />
    );
  }

  const login = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    try {
      await connectCanvas();
      setState('success');
    } catch (cause) {
      setError(errorText(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接 Canvas</h2>
        <p className="text-13 leading-relaxed text-ink-3">
          同步课程、课件与作业，登录状态加密保存在本机。
        </p>
      </header>
      <StepGuide
        steps={[
          {
            title: '登录 Kean Canvas',
            content: (
              <div className="grid gap-5">
                <ol className="list-decimal space-y-1.5 ps-4 text-13 leading-relaxed text-ink-3">
                  <li>点下面的按钮，会弹出 Canvas（kean.instructure.com）的登录窗口</li>
                  <li>用学校账号登录，密码和二次验证都在学校的登录页里完成</li>
                  <li>登录成功后窗口会自动关闭，并开始同步课程</li>
                </ol>
                {error && (
                  <p className="text-13 [overflow-wrap:anywhere] text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <StepButton
                  busyLabel="等待登录…"
                  idleLabel="登录 Canvas"
                  onClick={() => void login()}
                  state={state}
                  successLabel="连接成功，下一步"
                  type="button"
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
