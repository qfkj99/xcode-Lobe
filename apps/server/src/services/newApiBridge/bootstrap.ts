import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { UserSettings } from '@lobechat/types';
import type { AiProviderModelListItem, ChatModelCard } from 'model-bank';
import type { PartialDeep } from 'type-fest';

import { AiModelModel } from '@/database/models/aiModel';
import { AiProviderModel } from '@/database/models/aiProvider';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

import { createBridgeRuntimeFromIdentity } from './runtime';
import { bridgeGroupProvider, getBridgeGroups } from './groups';
import type { BridgeIdentity } from './security';

export const bootstrapBridgeUser = async (
  db: LobeChatDatabase,
  identity: BridgeIdentity,
  isNew: boolean,
) => {
  const { userId } = identity;
  const providerModel = new AiProviderModel(db, userId);
  const catalog = await getBridgeGroups(identity);
  const names = Object.keys(catalog.groups).sort((a, b) =>
    a === catalog.default_group ? -1 : b === catalog.default_group ? 1 : a.localeCompare(b),
  );
  const modelStore = new AiModelModel(db, userId);
  const availableModels = new Map<string, Set<string>>();
  let firstSelection: { model: string; provider: string } | undefined;
  for (const group of names) {
    const provider = bridgeGroupProvider(group);
    const runtime = createBridgeRuntimeFromIdentity(identity, undefined, group);
    const models: ChatModelCard[] = (await runtime.models()) || [];
    await providerModel.toggleProviderEnabled(provider, true);
    await providerModel.update(provider, {
      name: group,
      description: catalog.groups[group].desc,
      fetchOnClient: false,
      keyVaults: '{}',
      settings: { sdkType: 'openai' },
    });
    const storedModels = models.map<AiProviderModelListItem>((model) => ({
      ...model,
      // Runtime cards expose flags at the top level; persisted models use abilities.
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
      // Public base prices do not include the user's group billing policy.
      pricing: undefined,
      source: 'remote' as const,
      type: model.type || 'chat',
    }));
    await modelStore.batchUpdateAiModels(provider, storedModels);
    await modelStore.batchToggleAiModels(
      provider,
      models.map((model) => model.id),
      true,
    );
    const firstModel = models.find((model) => !model.type || model.type === 'chat')?.id;
    const chatModels = new Set(
      models.filter((model) => !model.type || model.type === 'chat').map((model) => model.id),
    );
    availableModels.set(provider, chatModels);
    if (!firstSelection && firstModel) firstSelection = { model: firstModel, provider };
    if (group === catalog.default_group) {
      availableModels.set('newapi', chatModels);
      await providerModel.toggleProviderEnabled('newapi', true);
      await providerModel.update('newapi', { name: group, fetchOnClient: false, keyVaults: '{}' });
      await modelStore.batchUpdateAiModels('newapi', storedModels);
    }
  }
  const userModel = new UserModel(db, userId);
  const settings = (await userModel.getUserSettings()) as PartialDeep<UserSettings> | undefined;
  const isAvailable = (selection?: { model?: string; provider?: string }) =>
    !!selection?.provider &&
    !!selection.model &&
    availableModels.get(selection.provider)?.has(selection.model) === true;
  const needsDefaults = !isAvailable(settings?.defaultAgent?.config);
  if (firstSelection) {
    const needsSystemDefaults = Object.keys(DEFAULT_SYSTEM_AGENT_CONFIG).some(
      (key) =>
        !isAvailable(settings?.systemAgent?.[key as keyof typeof DEFAULT_SYSTEM_AGENT_CONFIG]),
    );
    const defaults = {
      ...(needsDefaults
        ? {
            defaultAgent: {
              ...settings?.defaultAgent,
              config: { ...settings?.defaultAgent?.config, ...firstSelection },
            },
          }
        : {}),
      ...(needsSystemDefaults
        ? {
            systemAgent: Object.fromEntries(
              Object.entries(DEFAULT_SYSTEM_AGENT_CONFIG).map(([key, item]) => {
                const current =
                  settings?.systemAgent?.[key as keyof typeof DEFAULT_SYSTEM_AGENT_CONFIG];
                return [
                  key,
                  isAvailable(current) ? current : { ...item, ...current, ...firstSelection },
                ];
              }),
            ),
          }
        : {}),
    };
    if (Object.keys(defaults).length > 0) await userModel.updateSetting(defaults);
  }
  // Account creation may have succeeded before a previous model fetch failed.
  // Repair provisioning from persisted settings on every successful retry.
  await userModel.updateUser({
    isOnboarded: true,
    ...(isNew || needsDefaults
      ? { onboarding: { finishedAt: new Date().toISOString(), version: 1 } }
      : {}),
  });
};
