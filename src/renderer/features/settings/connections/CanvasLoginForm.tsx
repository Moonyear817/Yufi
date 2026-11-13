import { useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { connectCanvas } from './canvas-connect';
import { errorText } from '../../../workspace/store';

type CanvasLoginFormProps = {
  /** 登录成功（已写入全局 Canvas 状态）后的回调。 */
  onSuccess: () => void;
  /** 登录按钮左侧的额外动作（如设置页对话框的「断开」「取消」）。 */
  actions?: ReactNode;
};

/** Canvas 登录：弹出登录窗口，用户用学校账号登录后拉取课程列表并写入全局工作区状态。设置页对话框使用。 */
export function CanvasLoginForm({ onSuccess, actions }: CanvasLoginFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectCanvas();
      onSuccess();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      {error && (
        <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {actions}
        <Button disabled={busy} onClick={() => void login()} type="button">
          {busy ? '等待登录…' : '登录 Kean Canvas'}
        </Button>
      </div>
    </div>
  );
}
