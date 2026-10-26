import isEqual from 'fast-deep-equal';

import { useAiInfraStore } from '@/store/aiInfra';
import { useServerConfigStore } from '@/store/serverConfig';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

export const useEnabledChatModels = (): EnabledProviderWithModels[] => {
  const enabledChatModelList = useAiInfraStore((s) => s.enabledChatModelList, isEqual);
  const managed = useServerConfigStore((s) => s.serverConfig.newApiChat);

  return managed
    ? (enabledChatModelList || []).filter((provider) => provider.id !== 'newapi')
    : enabledChatModelList || [];
};
