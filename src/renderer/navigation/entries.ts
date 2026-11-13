// 功能入口的单一真源：侧栏、折叠后标题栏图标与设置 › 通用 的显示开关都读这里。
// 功能开启 > 入口显示：隐藏只影响导航，能力仍在；功能关闭（目前只有水源）时入口消失。首页固定显示，不在此列表。
import { FolderOpen, Mail, NotebookPen } from 'lucide-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ShuiyuanIcon } from '../components/ui/shuiyuan-icon';
import { useExperimentEnabled } from '../features/settings/experimental';

export type NavEntryId = 'sources' | 'lectures' | 'mail' | 'timetable' | 'classroom' | 'shuiyuan';

export const navEntries: Array<{
  id: NavEntryId;
  label: string;
  icon: typeof Mail | typeof ShuiyuanIcon;
}> = [
  { id: 'sources', label: '资料', icon: FolderOpen },
  { id: 'lectures', label: '课堂笔记', icon: NotebookPen },
  { id: 'mail', label: '邮箱', icon: Mail },
  // Kean 版不提供交大的课表（教学信息服务网）、课堂视频与水源入口。
];

export const useNavEntryPrefs = create<{
  hidden: NavEntryId[];
  setVisible: (id: NavEntryId, visible: boolean) => void;
}>()(
  persist(
    (set) => ({
      hidden: [],
      setVisible: (id, visible) =>
        set((state) => ({
          hidden: visible
            ? state.hidden.filter((item) => item !== id)
            : [...new Set([...state.hidden, id])],
        })),
    }),
    { name: 'dela.nav-entries', partialize: (state) => ({ hidden: state.hidden }) },
  ),
);

/** 功能本身是否开启（关闭时入口不可显示、设置里的显示开关置灰）。 */
export function useNavEntryAvailable(): (id: NavEntryId) => boolean {
  const shuiyuan = useExperimentEnabled('shuiyuan');
  return (id) => id !== 'shuiyuan' || shuiyuan;
}

export function useVisibleNavEntries() {
  const hidden = useNavEntryPrefs((state) => state.hidden);
  const available = useNavEntryAvailable();
  return navEntries.filter((entry) => available(entry.id) && !hidden.includes(entry.id));
}
