import { bridgeCatalogOrder, bridgeChatSelection, getBridgeGroupCatalog } from './catalog';
import { getBridgeGroups, resolveBridgeGroup } from './groups';
import type { BridgeIdentity } from './security';
import { TRPCError } from '@trpc/server';

export const resolveBridgeSelection = async (
  identity: BridgeIdentity,
  selection: { model: string; provider: string },
) => {
  const catalog = await getBridgeGroups(identity);
  const checked = new Map<string, Awaited<ReturnType<typeof getBridgeGroupCatalog>>>();
  let group: string | undefined;
  try {
    group =
      selection.provider === 'newapi'
        ? catalog.default_group
        : resolveBridgeGroup(selection.provider, catalog);
  } catch {
    // A provider missing from a successfully fetched authority response is
    // unavailable. Transport/auth failures above propagate without switching.
  }
  if (group && catalog.groups[group]) {
    const models = await getBridgeGroupCatalog(identity, group, true);
    checked.set(group, models);
    if (
      models.some((model) => model.id === selection.model && (!model.type || model.type === 'chat'))
    )
      return { ...selection, changed: false, groupName: group };
  }
  for (const candidate of bridgeCatalogOrder(catalog)) {
    const models =
      checked.get(candidate) ?? (await getBridgeGroupCatalog(identity, candidate, true));
    const fallback = bridgeChatSelection(candidate, models);
    if (fallback) return { ...fallback, changed: true, groupName: candidate };
  }
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: 'No authorized New API chat models are available',
  });
};
