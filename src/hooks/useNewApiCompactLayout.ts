import { useResponsive } from '@lobehub/ui';
import { create } from 'zustand';

import { useServerConfigStore } from '@/store/serverConfig';

const useNavigation = create<{ open: boolean }>(() => ({ open: false }));

export const useNewApiNavigationOpen = () => useNavigation((state) => state.open);
export const setNewApiNavigationOpen = (open: boolean) => useNavigation.setState({ open });

export const useNewApiCompactLayout = () => {
  const enabled = useServerConfigStore((state) => state.serverConfig.newApiChat);
  const { lg = true } = useResponsive();
  return !!enabled && !lg && typeof window !== 'undefined' && window.parent !== window;
};
