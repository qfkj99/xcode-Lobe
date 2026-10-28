import { auth } from '@/auth';
import { bridgeEnabled } from '@/server/services/newApiBridge/security';

export const POST = async (request: Request) => {
  const started = performance.now();
  if (!bridgeEnabled()) return new Response(null, { status: 404 });
  const target = new URL('/api/auth/newapi/complete', request.url);
  const response = await auth.handler(new Request(target, request));
  response.headers.set(
    'Server-Timing',
    `bridgeLogin;dur=${(performance.now() - started).toFixed(1)}`,
  );
  return response;
};
