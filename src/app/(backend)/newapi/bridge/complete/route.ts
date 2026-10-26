import { auth } from '@/auth';
import { bridgeEnabled } from '@/server/services/newApiBridge/security';

export const POST = async (request: Request) => {
  if (!bridgeEnabled()) return new Response(null, { status: 404 });
  const target = new URL('/api/auth/newapi/complete', request.url);
  return auth.handler(new Request(target, request));
};
