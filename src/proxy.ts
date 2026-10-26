import { defineConfig } from '@/libs/next/proxy/define-config';
import { frameNewApiResponse, guardNewApiBridge } from '@/libs/next/proxy/newApiBridge';
import { type NextRequest, NextResponse } from 'next/server';

const { middleware } = defineConfig();

// required to be literal
export const config = {
  matcher: [
    '/api/:path*',
    '/trpc/:path*',
    '/webapi/:path*',
    '/newapi/:path*',
    '/f/:path*',
    '/market/:path*',
    // Backend paths are matched so the New API integration can validate its
    // parent session before every protected request. The proxy below skips
    // page rewriting for them; standalone mode keeps auth in route handlers
    // and returns JSON errors instead of redirecting API clients to sign-in.
    // include the /
    '/',
    '/acceptance',
    '/acceptance(.*)',
    '/apps',
    '/apps(.*)',
    '/community',
    '/community(.*)',
    '/dashboard',
    '/dashboard(.*)',
    '/labs',
    '/eval',
    '/eval(.*)',
    /** Shared-agent pages need the same SPA rewrite as the other client routes. */
    '/a',
    '/a/(.*)',
    '/agent',
    '/agent(.*)',
    '/group',
    '/group(.*)',
    '/changelog(.*)',
    '/settings(.*)',
    '/image',
    '/video',
    '/resource',
    '/resource(.*)',
    '/profile(.*)',
    '/projects',
    '/project',
    '/project/(.*)',
    '/page',
    '/page(.*)',
    '/tasks',
    '/tasks(.*)',
    '/task',
    '/task(.*)',
    '/goals',
    '/goals(.*)',
    '/goal',
    '/goal(.*)',
    '/me',
    '/me(.*)',
    '/share(.*)',

    '/onboarding',
    '/onboarding(.*)',

    '/signup(.*)',
    '/signin(.*)',
    '/verify-email(.*)',
    '/verify-im(.*)',
    // Retired report links: the Workbench redirects them into Acceptance.
    '/verify',
    '/verify/(.*)',
    '/reset-password(.*)',
    '/auth-error(.*)',
    '/oauth(.*)',
    '/oidc(.*)',
    '/market-auth-callback(.*)',
  ],
};

export default async function proxy(request: NextRequest) {
  const denied = await guardNewApiBridge(request);
  if (denied) return frameNewApiResponse(denied);
  if (/^\/(api|trpc|webapi|newapi|f|market)(\/|$)/.test(request.nextUrl.pathname)) {
    return frameNewApiResponse(NextResponse.next());
  }
  return frameNewApiResponse(await middleware(request));
}
