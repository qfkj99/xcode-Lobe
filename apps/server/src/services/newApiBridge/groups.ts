import { createHash } from 'node:crypto';

import { bridgeRequest, type BridgeIdentity } from './security';

export interface BridgeGroups {
  default_group: string;
  groups: Record<string, { desc: string; ratio: number | 'auto' }>;
}

export const bridgeGroupProvider = (group: string) =>
  `newapi-group-${createHash('sha256').update(group).digest('hex').slice(0, 40)}`;

export const getBridgeGroups = async (identity: BridgeIdentity): Promise<BridgeGroups> => {
  const result = await bridgeRequest<BridgeGroups>('/api/lobe/groups', {
    credential: identity.credential,
  });
  if (typeof result.default_group !== 'string' || !result.groups || Array.isArray(result.groups))
    throw new Error('Invalid New API group response');
  for (const [group, details] of Object.entries(result.groups)) {
    if (
      !group ||
      Buffer.byteLength(group, 'utf8') > 256 ||
      !details ||
      (details.ratio !== 'auto' &&
        (typeof details.ratio !== 'number' || !Number.isFinite(details.ratio) || details.ratio < 0))
    )
      throw new Error('Invalid New API group response');
  }
  return result;
};

export const resolveBridgeGroup = (provider: string, catalog: BridgeGroups): string | undefined => {
  // Legacy topics follow the account group, just as they did before group selection.
  if (provider === 'newapi') return undefined;
  const group = Object.keys(catalog.groups).find((name) => bridgeGroupProvider(name) === provider);
  if (group === undefined) throw new Error('New API group is unavailable');
  return group;
};

export const bridgeGroupHeaders = (group?: string): Record<string, string> =>
  group === undefined ? {} : { 'X-Lobe-Group': Buffer.from(group, 'utf8').toString('base64url') };
