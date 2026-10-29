import { bridgeCatalogOrder, bridgeChatSelection, getBridgeGroupCatalog } from './catalog';
import { bridgeGroupProvider, getBridgeGroups, resolveBridgeGroup } from './groups';
import type { BridgeIdentity } from './security';
import { TRPCError } from '@trpc/server';

export const resolveBridgeSelection = async (
  identity: BridgeIdentity,
  selection: { model: string; provider: string },
  useDefault = false,
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
  if (!useDefault && group && catalog.groups[group]) {
    const models = await getBridgeGroupCatalog(identity, group, true);
    checked.set(group, models);
    if (
      models.some((model) => model.id === selection.model && (!model.type || model.type === 'chat'))
    )
      return {
        ...selection,
        changed: false,
        groupName: group,
        vision: models.find((model) => model.id === selection.model)?.vision === true,
      };
  }
  for (const candidate of catalog.default_candidates ?? []) {
    if (!catalog.groups[candidate.group]) continue;
    const models =
      checked.get(candidate.group) ??
      (await getBridgeGroupCatalog(identity, candidate.group, true));
    checked.set(candidate.group, models);
    const model = models.find(
      (item) => item.id === candidate.model && (!item.type || item.type === 'chat'),
    );
    if (model)
      return {
        model: model.id,
        provider: bridgeGroupProvider(candidate.group),
        changed: true,
        groupName: candidate.group,
        vision: model.vision === true,
      };
  }
  for (const candidate of bridgeCatalogOrder(catalog)) {
    const models =
      checked.get(candidate) ?? (await getBridgeGroupCatalog(identity, candidate, true));
    const fallback = bridgeChatSelection(candidate, models);
    if (fallback)
      return {
        ...fallback,
        changed: true,
        groupName: candidate,
        vision: models.find((model) => model.id === fallback.model)?.vision === true,
      };
  }
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: 'No authorized New API chat models are available',
  });
};
