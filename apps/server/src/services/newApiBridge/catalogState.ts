import type { AiProviderRuntimeState } from 'model-bank';

import type { LobeChatDatabase } from '@/database/type';

import {
  bridgeCatalogOrder,
  bridgeChatSelection,
  bridgeStoredModels,
  getBridgeGroupCatalog,
  getLoadedBridgeCatalogs,
} from './catalog';
import { bridgeGroupProvider, getBridgeGroups } from './groups';
import { repairBridgeDefaults } from './repairDefaults';
import type { BridgeIdentity } from './security';

export const getBridgeCatalogState = async (
  db: LobeChatDatabase,
  identity: BridgeIdentity,
): Promise<AiProviderRuntimeState> => {
  const catalog = await getBridgeGroups(identity);
  const groups = bridgeCatalogOrder(catalog);
  let fallback: { model: string; provider: string } | undefined;
  const existing = await getLoadedBridgeCatalogs(identity, catalog);
  for (const group of groups) {
    const cards = existing.get(group);
    if (cards) fallback = bridgeChatSelection(group, await getBridgeGroupCatalog(identity, group));
    if (fallback) break;
  }
  // Normally one lookup. Only an empty default group requires trying another.
  for (const group of groups) {
    if (fallback) break;
    fallback = bridgeChatSelection(group, await getBridgeGroupCatalog(identity, group));
    if (fallback) break;
  }
  const loaded = await getLoadedBridgeCatalogs(identity, catalog);
  const available = new Map<string, Set<string>>();
  const providers = groups.map((group) => ({
    id: bridgeGroupProvider(group),
    name: group,
    source: 'custom' as const,
  }));
  const models = [...loaded].flatMap(([group, cards]) => {
    const providerId = bridgeGroupProvider(group);
    available.set(
      providerId,
      new Set(cards.filter((m) => !m.type || m.type === 'chat').map((m) => m.id)),
    );
    return bridgeStoredModels(cards).map((model) => ({
      ...model,
      abilities: model.abilities || {},
      providerId,
      type: model.type || 'chat',
    }));
  });
  const defaultModels = models.filter(
    (model) => model.providerId === bridgeGroupProvider(catalog.default_group),
  );
  // Preserve old topic pins without showing the alias as a second group.
  available.set('newapi', available.get(bridgeGroupProvider(catalog.default_group)) ?? new Set());
  const allModels = [
    ...models,
    ...defaultModels.map((model) => ({ ...model, providerId: 'newapi' })),
  ];
  const allProviders = [
    ...providers,
    { id: 'newapi', name: catalog.default_group, source: 'custom' as const },
  ];
  await repairBridgeDefaults(db, identity.userId, available, fallback);
  return {
    enabledAiModels: allModels,
    enabledAiProviders: allProviders,
    // All authorized groups must be browseable, including ones not loaded yet.
    enabledChatAiProviders: allProviders,
    enabledImageAiProviders: allProviders.filter((p) =>
      allModels.some((m) => m.providerId === p.id && m.type === 'image'),
    ),
    enabledVideoAiProviders: allProviders.filter((p) =>
      allModels.some((m) => m.providerId === p.id && m.type === 'video'),
    ),
    runtimeConfig: Object.fromEntries(
      allProviders.map(({ id }) => [
        id,
        {
          config: {},
          fetchOnClient: false,
          keyVaults: {},
          settings: { sdkType: 'openai' },
        },
      ]),
    ),
  };
};
