import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// New names avoid legacy unpartitioned cookies shadowing their CHIPS twins.
export const BRIDGE_COOKIE = 'newapi.bridge.v2';
export const FLOW_COOKIE = 'newapi.flow.v2';

export interface BridgeIdentity {
  credential: string;
  expires_at: number;
  sub: string;
  userId: string;
}

export const bridgeEnabled = () => Boolean(process.env.NEW_API_CHAT_BRIDGE_SECRET);

const parentOrigin = (value: string) => {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash ||
    url.hostname.includes('*') || url.origin === 'null'
  ) throw new Error('Invalid New API parent origin');
  return url.origin;
};

export const bridgeConfig = () => {
  const secret = process.env.NEW_API_CHAT_BRIDGE_SECRET;
  const authSecret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32 || !authSecret || authSecret.length < 32) {
    throw new Error('New API bridge secrets must each contain at least 32 characters');
  }
  const publicURL = new URL(process.env.NEW_API_PUBLIC_URL!);
  const internalURL = new URL(process.env.NEW_API_INTERNAL_URL!);
  const appURL = new URL(process.env.APP_URL!);
  for (const url of [publicURL, internalURL, appURL]) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Invalid New API bridge URL');
    }
  }
  const parentOrigins = [...new Set([
    parentOrigin(publicURL.href),
    ...(process.env.NEW_API_ADDITIONAL_PARENT_ORIGINS || '')
      .split(/[,\s]+/).filter(Boolean).map(parentOrigin),
  ])];
  const appOrigins = [...new Set([
    parentOrigin(appURL.href),
    ...(process.env.NEW_API_ADDITIONAL_APP_ORIGINS || '')
      .split(/[,\s]+/).filter(Boolean).map(parentOrigin),
  ])];
  return { appOrigins, appURL, authSecret, internalURL, parentOrigins, publicURL, secret };
};

export const isBridgeAppOrigin = (origin: string | null | undefined) =>
  typeof origin === 'string' && bridgeConfig().appOrigins.includes(origin);

const encryptionKey = () =>
  createHash('sha256').update(`newapi-bridge:v1:${bridgeConfig().authSecret}`).digest();

export const sealBridgeIdentity = (identity: BridgeIdentity) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(identity), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
};

export const openBridgeIdentity = (value?: string): BridgeIdentity | undefined => {
  if (!value || value.length > 4096) return;
  try {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const identity = JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
    ) as BridgeIdentity;
    if (
      typeof identity.sub !== 'string' ||
      !identity.sub ||
      typeof identity.userId !== 'string' ||
      !identity.userId ||
      typeof identity.credential !== 'string' ||
      !identity.credential.startsWith('lobe_') ||
      !Number.isSafeInteger(identity.expires_at) ||
      identity.expires_at * 1000 <= Date.now()
    )
      return;
    return identity;
  } catch {
    return;
  }
};

export const bridgeRequest = async <T>(path: string, body: unknown): Promise<T> => {
  const config = bridgeConfig();
  const response = await fetch(new URL(path, config.internalURL), {
    body: JSON.stringify(body),
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Lobe-Bridge-Secret': config.secret },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('New API session is unavailable');
  const payload = await response.json();
  if (payload.success !== true || !payload.data) throw new Error('Invalid New API bridge response');
  return payload.data as T;
};

export const assertBridgeIdentity = async (identity: BridgeIdentity) => {
  const result = await bridgeRequest<{ active: boolean; sub: string }>('/api/lobe/introspect', {
    credential: identity.credential,
  });
  if (result.active !== true || result.sub !== identity.sub)
    throw new Error('New API session expired');
};

// CHIPS isolates an embedded chat session by top-level website. Every auth
// cookie, including refresh and expiry writes, must use the same attributes.
export const bridgeAuthCookieAttributes = () => {
  if (!bridgeEnabled()) return {};
  if (bridgeConfig().appURL.protocol !== 'https:')
    return { httpOnly: true, sameSite: 'lax' as const, secure: false };
  return { httpOnly: true, sameSite: 'none' as const, secure: true, partitioned: true };
};

export const bridgeCookieOptions = (maxAge: number) => ({
  ...bridgeAuthCookieAttributes(),
  maxAge,
  path: '/',
});

export const subjectEmail = (sub: string) =>
  `${createHash('sha256').update(sub).digest('hex')}@new-api.invalid`;
