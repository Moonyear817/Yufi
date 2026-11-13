import { useWorkspaceStore } from '../../../workspace/store';

/**
 * 连接 Canvas 并同步课程列表：弹出登录窗口、拉取课程并写入全局工作区状态。
 * 失败（包括用户关掉登录窗口）时抛出错误，调用方用 errorText 转文案；设置页与首启向导共用。
 */
export async function connectCanvas(): Promise<void> {
  const dela = window.dela;
  if (!dela) return;
  await dela.canvas.login();
  useWorkspaceStore.getState().setCanvas(await dela.canvas.syncCourses());
}
