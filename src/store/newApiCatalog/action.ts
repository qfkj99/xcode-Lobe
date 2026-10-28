import { useClientDataSWR } from '@/libs/swr';
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

  useFetchGroup = (provider?: string) =>
    this.#private.groups.useSync(provider ?? null, { enabled: !!provider });

  useFetchSelection = (selection: NewApiSelection | undefined, context: string) => {
    const userId = useUserStore(userProfileSelectors.userId);
    return useClientDataSWR(
      selection && userId
        ? newApiSWRKeys.selection(userId, context, selection.model, selection.provider)
        : null,
      async () => {
        const resolved = await aiProviderService.resolveNewApiSelection(selection!);
        await useAiInfraStore.getState().refreshAiProviderRuntimeState();
        return resolved;
      },
      { dedupingInterval: 1000, shouldRetryOnError: false, revalidateOnFocus: true },
    );
  };

  reset = () => {
    useNewApiCatalogStore.setState(initialState(), false, 'newApiCatalog/reset');
  };
}

export const newApiCatalogActions = new NewApiCatalogActions();
