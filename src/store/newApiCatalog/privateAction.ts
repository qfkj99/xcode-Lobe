import { createReplicaSlice, defineReplica, recordLens } from '@/libs/replica';
import { aiProviderService } from '@/services/aiProvider';
import { useAiInfraStore } from '@/store/aiInfra';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { type NewApiCatalogState, useNewApiCatalogStore } from './store';

const resource = defineReplica<string, EnabledProviderWithModels>({
  fetcher: async (provider) => {
    const catalog = await aiProviderService.getNewApiGroupCatalog(provider);
    const children = catalog.models
      .filter((m) => m.type === 'chat')
      .map((m) => ({
        ...m,
        abilities: m.abilities || {},
        displayName: m.displayName || m.id,
      }));
    // Reuse the session's fetched metadata in the global capability projection.
    // Its replica owns the write and keeps account/scope reset guards intact.
    await useAiInfraStore.getState().refreshAiProviderRuntimeState();
    return { children, id: provider, name: catalog.name, source: 'custom' as const };
  },
  key: (provider) => provider,
  name: 'newApiGroupCatalog',
  storage: 'memory',
  version: 1,
});

export class NewApiCatalogPrivateAction {
  readonly groups = createReplicaSlice(resource, {
    actionPrefix: 'newApiCatalog',
    get: useNewApiCatalogStore.getState,
    set: useNewApiCatalogStore.setState,
    stateKey: 'replica',
    view: recordLens<NewApiCatalogState, EnabledProviderWithModels>('groups'),
  });
}
