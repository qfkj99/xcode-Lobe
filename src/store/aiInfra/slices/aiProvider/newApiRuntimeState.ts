import { aiProviderService } from '@/services/aiProvider';

import type { AiProviderRuntimeStateView } from './projection';

export const fetchNewApiRuntimeState = async (): Promise<AiProviderRuntimeStateView> => {
  // Managed metadata is supplied by the authority. Do not load the entire
  // bundled model bank before starting the user's catalog request.
  const data = await aiProviderService.getAiProviderRuntimeState();
  const toList = (type: string) =>
    data.enabledAiProviders.map((provider) => ({
      ...provider,
      name: provider.name || provider.id,
      children: data.enabledAiModels
        .filter((model) => model.providerId === provider.id && model.type === type)
        .map((model) => ({
          ...model,
          abilities: model.abilities || {},
          displayName: model.displayName || model.id,
        })),
    }));
  return {
    ...data,
    builtinAiModelList: [],
    enabledChatModelList: toList('chat'),
    enabledImageModelList: toList('image'),
    enabledVideoModelList: toList('video'),
    enabledEmbeddingModelList: toList('embedding'),
    enabledAsrModelList: toList('asr'),
  };
};
