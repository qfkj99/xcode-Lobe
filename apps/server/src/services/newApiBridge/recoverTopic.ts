import { and, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';

import { resolveBridgeSelection } from './resolveSelection';
import type { BridgeIdentity } from './security';

export const recoverBridgeTopic = async (
  db: LobeChatDatabase,
  identity: BridgeIdentity,
  input: {
    topicId: string;
    expectedModel: string | null;
    expectedProvider: string | null;
    model: string;
    provider: string;
  },
) => {
  const selected = await resolveBridgeSelection(identity, {
    model: input.model,
    provider: input.provider,
  });
  return db.transaction(async (tx) => {
    const scope = and(
      eq(topics.id, input.topicId),
      eq(topics.userId, identity.userId),
      isNull(topics.workspaceId),
      notTrashed(topics.isDeleted),
    );
    const [topic] = await tx.select().from(topics).where(scope).for('update');
    if (!topic) throw new TRPCError({ code: 'NOT_FOUND' });
    if (topic.model !== input.expectedModel || topic.provider !== input.expectedProvider)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The topic model changed. Retry with its latest selection.',
      });
    if (!selected.changed) return { selection: selected, topic };
    // A fallback invalidates the old model-scoped reasoning parameters.
    const { reasoningConfig: _old, ...metadata } = topic.metadata ?? {};
    const [updated] = await tx
      .update(topics)
      .set({ model: selected.model, provider: selected.provider, metadata, updatedAt: new Date() })
      .where(scope)
      .returning();
    return { selection: selected, topic: updated };
  });
};
