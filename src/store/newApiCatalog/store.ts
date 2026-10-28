import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { EnabledProviderWithModels } from '@/types/aiProvider';
import { createDevtools } from '@/store/middleware/createDevtools';

export interface NewApiCatalogState {
  groups: Record<string, EnabledProviderWithModels>;
  replica: ReplicaState<EnabledProviderWithModels>;
}

export const initialState = (): NewApiCatalogState => ({
  groups: {},
  replica: createReplicaState(),
});
export const useNewApiCatalogStore = createWithEqualityFn<NewApiCatalogState>()(
  createDevtools('newApiCatalog')(initialState),
  shallow,
);
