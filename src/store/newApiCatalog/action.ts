import { useClientDataSWR } from '@/libs/swr';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { newApiSWRKeys } from '@/services/aiProvider/swrKeys';
import { aiProviderService } from '@/services/aiProvider';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import type { NewApiSelection } from '@/types/newApiBridge';

import { NewApiCatalogPrivateAction } from './privateAction';
import { initialState, useNewApiCatalogStore } from './store';

class NewApiCatalogActions {
  readonly #private = new NewApiCatalogPrivateAction();
  #preload?: { scope: string; promise: Promise<void> };

  preload = (providers: string[], fresh = false): Promise<void> => {
    const scope = getCacheScope();
    if (this.#preload?.scope === scope) return this.#preload.promise;
    this.#private.groups.ensureScope(scope);
    const pending = [...new Set(providers)].filter(
      (id) =>
        id.startsWith('newapi-group-') && (fresh || !useNewApiCatalogStore.getState().groups[id]),
    );
    const worker = async () => {
      while (pending.length && getCacheScope() === scope) {
        const id = pending.shift()!;
        try {
          await this.#private.groups.fetch(id);
        } catch (error) {
          console.error('[newApiCatalog] Group preload failed:', error);
        }
      }
    };
    const entry = { scope, promise: Promise.resolve() };
    entry.promise = Promise.all([worker(), worker()])
      .then(async () => {
        if (getCacheScope() === scope)
          await useAiInfraStore.getState().refreshAiProviderRuntimeState();
      })
      .finally(() => {
        if (this.#preload === entry) this.#preload = undefined;
      });
    this.#preload = entry;
    return entry.promise;
  };

  useFetchGroup = (provider?: string) =>
    this.#private.groups.useSync(provider ?? null, { enabled: !!provider });

  useFetchSelection = (
    selection: NewApiSelection | undefined,
    context: string,
    useDefault = false,
  ) => {
    const revision = useNewApiCatalogStore((state) => state.revision);
    const userId = useUserStore(userProfileSelectors.userId);
    return useClientDataSWR(
      selection && userId
        ? newApiSWRKeys.selection(
            userId,
            `${context}:${useDefault}:${revision}`,
            selection.model,
            selection.provider,
          )
        : null,
      async () => {
        const resolved = await aiProviderService.resolveNewApiSelection({
          ...selection!,
          useDefault,
        });
        await useAiInfraStore.getState().refreshAiProviderRuntimeState();
        return resolved;
      },
      { dedupingInterval: 1000, shouldRetryOnError: false, revalidateOnFocus: true },
    );
  };

  refresh = () => {
    useNewApiCatalogStore.setState(
      (state) => ({ revision: state.revision + 1 }),
      false,
      'newApiCatalog/refresh',
    );
    return this.preload(
      (useAiInfraStore.getState().enabledAiProviders ?? []).map((provider) => provider.id),
      true,
    );
  };

  reset = () => {
    useNewApiCatalogStore.setState(initialState(), false, 'newApiCatalog/reset');
  };
}

export const newApiCatalogActions = new NewApiCatalogActions();
