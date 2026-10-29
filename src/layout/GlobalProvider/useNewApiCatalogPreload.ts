import { useEffect } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';
import { newApiCatalogActions } from '@/store/newApiCatalog';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export const useNewApiCatalogPreload = (isLogin: boolean) => {
  const enabled = useServerConfigStore((state) => !!state.serverConfig.newApiChat);
  const userId = useUserStore(userProfileSelectors.userId);
  const providerIds = useAiInfraStore((state) =>
    (state.enabledAiProviders ?? [])
      .map((provider) => provider.id)
      .sort()
      .join(','),
  );
  useEffect(() => {
    if (!enabled || !isLogin || !userId || !providerIds) return;
    const preload = (fresh = false) => {
      void newApiCatalogActions
        .preload(providerIds.split(','), fresh)
        .catch((error) => console.error('[newApiCatalog] Refresh failed:', error));
    };
    preload();
    const focus = () => {
      void newApiCatalogActions
        .refresh()
        .catch((error) => console.error('[newApiCatalog] Focus refresh failed:', error));
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [enabled, isLogin, providerIds, userId]);
};
