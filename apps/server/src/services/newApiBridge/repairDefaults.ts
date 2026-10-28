import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { UserSettings } from '@lobechat/types';
import type { PartialDeep } from 'type-fest';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

import { repairBridgeAgentDefaults } from './repairAgentDefaults';
import { isManagedNewApiProvider } from '@/utils/newApiModelPricing';

export const repairBridgeDefaults = async (
  db: LobeChatDatabase,
  userId: string,
  availableModels: Map<string, Set<string>>,
  firstSelection?: { model: string; provider: string },
) => {
  const userModel = new UserModel(db, userId);
  const settings = (await userModel.getUserSettings()) as PartialDeep<UserSettings> | undefined;
  if (settings?.defaultAgent?.newApiDefaultsVersion === 1) return false;
  const isAvailable = (selection?: { model?: string; provider?: string }) =>
    !!selection?.provider &&
    !!selection.model &&
    availableModels.get(selection.provider)?.has(selection.model) === true;
  const needsDefaults = !isManagedNewApiProvider(settings?.defaultAgent?.config?.provider, true);
  if (firstSelection) {
    const needsSystemDefaults = Object.keys(DEFAULT_SYSTEM_AGENT_CONFIG).some(
      (key) =>
        !isManagedNewApiProvider(
          settings?.systemAgent?.[key as keyof typeof DEFAULT_SYSTEM_AGENT_CONFIG]?.provider,
          true,
        ),
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
                  isManagedNewApiProvider(current?.provider, true)
                    ? current
                    : { ...item, ...current, ...firstSelection },
                ];
              }),
            ),
          }
        : {}),
    };
    const preferred = settings?.defaultAgent?.config;
    await repairBridgeAgentDefaults(
      db,
      userId,
      isAvailable(preferred)
        ? { model: preferred!.model!, provider: preferred!.provider! }
        : firstSelection,
    );
    // Mark only after the data repair succeeds. Failed or model-less attempts
    // remain retryable; normal catalog refreshes no longer scan every agent.
    await userModel.updateSetting({
      ...defaults,
      defaultAgent: {
        ...(defaults.defaultAgent ?? settings?.defaultAgent),
        newApiDefaultsVersion: 1,
      },
    });
  }
  return needsDefaults;
};
