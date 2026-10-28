import { and, eq, isNull } from 'drizzle-orm';

import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { bridgeSelectionRepair } from './selection';

export const repairBridgeAgentDefaults = async (
  db: LobeChatDatabase,
  userId: string,
  fallback: { model: string; provider: string },
) => {
  const scope = and(eq(agents.userId, userId), isNull(agents.workspaceId));
  const rows = await db
    .select({ id: agents.id, model: agents.model, provider: agents.provider })
    .from(agents)
    .where(scope);
  for (const row of rows) {
    const repair = bridgeSelectionRepair(row, fallback);
    if (!repair) continue;
    // Compare the observed selection so a concurrent manual change wins. Only
    // agent defaults are touched: topic selections and messages stay intact.
    await db
      .update(agents)
      .set(repair)
      .where(
        and(
          scope,
          eq(agents.id, row.id),
          row.model === null ? isNull(agents.model) : eq(agents.model, row.model),
          row.provider === null ? isNull(agents.provider) : eq(agents.provider, row.provider),
        ),
      );
  }
};
