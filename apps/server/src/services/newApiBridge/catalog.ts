import { createHash } from 'node:crypto';

import type { AiProviderModelListItem, ChatModelCard } from 'model-bank';

import { bridgeGroupProvider, type BridgeGroups } from './groups';
import { createBridgeRuntimeFromIdentity } from './runtime';
import type { BridgeIdentity } from './security';

// Display metadata only. Calls that decide a model selection bypass this cache;
// the New API relay remains the final authority on every billable request.
interface CatalogEntry {
  expiresAt: number;
  models?: ChatModelCard[];
  promise: Promise<ChatModelCard[]>;
}
const catalogs = new Map<string, CatalogEntry>();
const TTL = 30_000;
const MAX_CATALOGS = 256;
const keyFor = (identity: BridgeIdentity, group: string) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        process.env.NEW_API_INTERNAL_URL,
        process.env.NEW_API_CHAT_BRIDGE_SECRET,
        identity.userId,
        identity.sub,
        identity.credential,
        group,
      ]),
    )
    .digest('hex');

export const getBridgeGroupCatalog = (
  identity: BridgeIdentity,
  group: string,
  fresh = false,
): Promise<ChatModelCard[]> => {
  const key = keyFor(identity, group);
  const previous = catalogs.get(key);
  if (previous && previous.expiresAt > Date.now() && (!fresh || !previous.models))
    return previous.promise;
  const entry: CatalogEntry = {
    expiresAt: Math.min(Date.now() + TTL, identity.expires_at * 1000),
    promise: createBridgeRuntimeFromIdentity(identity, undefined, group)
      .models()
      .then((models) => {
        entry.models = (models ?? []).map((model) => ({ ...model, pricing: undefined }));
        return entry.models;
      }),
  };
  catalogs.delete(key);
  catalogs.set(key, entry);
  while (catalogs.size > MAX_CATALOGS) catalogs.delete(catalogs.keys().next().value!);
  // Failed lookups must be retryable and must never become an empty catalog.
  void entry.promise.catch(() => {
    if (catalogs.get(key) === entry) catalogs.delete(key);
  });
  return entry.promise;
};

export const getLoadedBridgeCatalogs = async (identity: BridgeIdentity, catalog: BridgeGroups) => {
  const result = new Map<string, ChatModelCard[]>();
  for (const group of Object.keys(catalog.groups)) {
    const entry = catalogs.get(keyFor(identity, group));
    // TTL controls refetching, not whether previously loaded capabilities exist.
    // Authorization is checked separately before selection and at the relay.
    if (entry?.models) result.set(group, entry.models);
  }
  return result;
};

export const bridgeStoredModels = (models: ChatModelCard[]): AiProviderModelListItem[] =>
  models.map((model) => ({
    ...model,
    abilities: {
      files: model.files,
      functionCall: model.functionCall,
      imageOutput: model.imageOutput,
      reasoning: model.reasoning,
      search: model.search,
      video: model.video,
      vision: model.vision,
    },
    enabled: true,
    pricing: undefined,
    source: 'remote',
    type: model.type || 'chat',
  }));

export const bridgeCatalogOrder = (catalog: BridgeGroups) =>
  Object.keys(catalog.groups).sort((a, b) =>
    a === catalog.default_group ? -1 : b === catalog.default_group ? 1 : a.localeCompare(b),
  );

export const bridgeChatSelection = (group: string, models: ChatModelCard[]) => {
  const model = models.find((item) => !item.type || item.type === 'chat');
  return model ? { model: model.id, provider: bridgeGroupProvider(group) } : undefined;
};
