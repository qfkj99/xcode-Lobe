import { ModelRuntime } from '@lobechat/model-runtime';
import { headers } from 'next/headers';
import { parse } from 'cookie';

import type { LobeChatDatabase } from '@/database/type';

import { bridgeMediaHooks } from './media';
import { bridgeGroupHeaders, getBridgeGroups, resolveBridgeGroup } from './groups';

import { BRIDGE_COOKIE, bridgeConfig, openBridgeIdentity, type BridgeIdentity } from './security';

export const getBridgeRuntimeIdentity = async (_db: LobeChatDatabase, userId: string) => {
  let requestCookie: string | undefined;
  try {
    requestCookie = parse((await headers()).get('cookie') || '')[BRIDGE_COOKIE];
  } catch {
    // Offline jobs must never borrow another browser session's grant.
  }
  const identity = openBridgeIdentity(requestCookie);
  if (!identity || identity.userId !== userId) throw new Error('New API login required');
  // The request proxy validates the exact parent session. Groups/models/relay
  // also validate this grant at New API; do not add another introspect roundtrip.
  return identity;
};

export const createBridgeRuntime = async (
  db: LobeChatDatabase,
  userId: string,
  provider: string,
  workspaceId?: string,
) => {
  if ((provider !== 'newapi' && !/^newapi-group-[a-f0-9]{40}$/.test(provider)) || workspaceId) {
    throw new Error('This deployment only supports personal New API models');
  }
  const identity = await getBridgeRuntimeIdentity(db, userId);
  const group = resolveBridgeGroup(provider, await getBridgeGroups(identity));
  return createBridgeRuntimeFromIdentity(identity, db, group);
};

export const createBridgeRuntimeFromIdentity = (
  identity: BridgeIdentity,
  db?: LobeChatDatabase,
  group?: string,
) => {
  const config = bridgeConfig();
  return ModelRuntime.initializeWithProvider(
    'newapi',
    {
      apiKey: identity.credential,
      baseURL: new URL('/v1', config.internalURL).toString(),
      defaultHeaders: { 'X-Lobe-Bridge-Secret': config.secret, ...bridgeGroupHeaders(group) },
      userId: identity.userId,
    },
    db ? bridgeMediaHooks(db, identity.userId) : undefined,
  );
};

export const getBridgeModelIds = async (
  db: LobeChatDatabase,
  userId: string,
  provider = 'newapi',
) => {
  const identity = await getBridgeRuntimeIdentity(db, userId);
  const group = resolveBridgeGroup(provider, await getBridgeGroups(identity));
  return getBridgeModelIdsFromIdentity(identity, group);
};

export const getBridgeModelIdsFromIdentity = async (identity: BridgeIdentity, group?: string) => {
  const config = bridgeConfig();
  const response = await fetch(new URL('/v1/models', config.internalURL), {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${identity.credential}`,
      'X-Lobe-Bridge-Secret': config.secret,
      ...bridgeGroupHeaders(group),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Unable to load New API models');
  const payload = await response.json();
  if (!Array.isArray(payload.data)) throw new Error('Invalid New API models response');
  return new Set<string>(
    payload.data.flatMap((model: { id?: unknown }) =>
      typeof model.id === 'string' && model.id ? [model.id] : [],
    ),
  );
};
