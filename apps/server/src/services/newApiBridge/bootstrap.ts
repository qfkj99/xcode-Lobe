import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

import type { BridgeIdentity } from './security';

export const bootstrapBridgeUser = async (
  db: LobeChatDatabase,
  identity: BridgeIdentity,
  isNew: boolean,
) => {
  // Authentication must not wait for model catalogs or rewrite them on every
  // entry. A failed first provisioning can finish on the next authenticated read.
  const user = await UserModel.findById(db, identity.userId);
  if (isNew || !user?.isOnboarded)
    await new UserModel(db, identity.userId).updateUser({
      isOnboarded: true,
      onboarding: { finishedAt: new Date().toISOString(), version: 1 },
    });
};
