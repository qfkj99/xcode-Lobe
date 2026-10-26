import { parse } from 'cookie';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import {
  assertBridgeIdentity,
  BRIDGE_COOKIE,
  bridgeConfig,
  bridgeEnabled,
  openBridgeIdentity,
} from '@/server/services/newApiBridge/security';

const publicPaths = new Set(['/newapi/bridge', '/newapi/bridge/complete']);
const authPaths = new Set(['/api/auth/get-session', '/api/auth/sign-out']);

export const guardNewApiBridge = async (request: NextRequest): Promise<Response | undefined> => {
  if (!bridgeEnabled()) return;
  let path: string;
  try {
    path = decodeURIComponent(request.nextUrl.pathname);
  } catch {
    return NextResponse.json({ error: 'Invalid route' }, { status: 400 });
  }
  if (publicPaths.has(path)) return;
  if (path.startsWith('/api/auth/') && !authPaths.has(path)) {
    return NextResponse.json({ error: 'Login through New API' }, { status: 403 });
  }
  // Sharing, external clients and workspace credentials are outside this personal billing boundary.
  if (
    path.startsWith('/share') ||
    path.startsWith('/oidc') ||
    path.startsWith('/oauth') ||
    /^\/api\/(agent|workflows|webhooks|dev)(\/|$)/.test(path) ||
    /^\/webapi\/(tts|create-image)(\/|$)/.test(path) ||
    /^\/trpc\/.+(?:\/|,)comfyui\./.test(path) ||
    /^\/trpc\/.+(?:\/|,)agentSkills\.importFromZip(?:,|$)/.test(path) ||
    request.headers.has('X-Workspace-Id') ||
    request.headers.has('X-API-Key') ||
    request.headers.has('Oidc-Auth')
  ) {
    return NextResponse.json({ error: 'Unavailable in this deployment' }, { status: 403 });
  }
  try {
    const identity = openBridgeIdentity(parse(request.headers.get('cookie') || '')[BRIDGE_COOKIE]);
    if (!identity) throw new Error('Missing bridge identity');
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || session.user.id !== identity.userId) throw new Error('Session mismatch');
    await assertBridgeIdentity(identity);
    // Never allow client relay execution or provider credential modifications.
    if (
      request.headers.has('x-lobe-llm-relay-channel') ||
      /aiProvider\.(createAiProvider|updateAiProvider|removeAiProvider|toggleProviderEnabled)/.test(
        path,
      ) ||
      /aiModel\.(createAiModel|updateAiModel|removeAiModel|batchUpdateAiModels|clearModelsByProvider|clearRemoteModels)/.test(
        path,
      )
    ) {
      return NextResponse.json({ error: 'Models are managed by New API' }, { status: 403 });
    }
  } catch {
    return NextResponse.json(
      { error: 'New API login required' },
      {
        headers: { 'Cache-Control': 'no-store' },
        status: 401,
      },
    );
  }
};

export const frameNewApiResponse = (response: Response) => {
  if (bridgeEnabled()) {
    response.headers.delete('X-Frame-Options');
    response.headers.set(
      'Content-Security-Policy',
      `frame-ancestors ${bridgeConfig().publicURL.origin}`,
    );
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Cache-Control', 'no-store');
  }
  return response;
};
