import { serverDB } from '@lobechat/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin } from 'better-auth/types';
import { z } from 'zod';

import { bootstrapBridgeUser } from '@/server/services/newApiBridge/bootstrap';
import { startBridgeTiming } from '@/server/services/newApiBridge/timing';
import {
  BRIDGE_COOKIE,
  FLOW_COOKIE,
  bridgeConfig,
  bridgeCookieOptions,
  bridgeRequest,
  sealBridgeIdentity,
  subjectEmail,
} from '@/server/services/newApiBridge/security';

export const newApiBridge = (): BetterAuthPlugin => ({
  id: 'newapi-bridge',
  endpoints: {
    completeNewApiBridge: createAuthEndpoint(
      '/newapi/complete',
      {
        body: z.object({ ticket: z.string().min(20).max(512) }),
        method: 'POST',
        requireHeaders: true,
      },
      async (ctx) => {
        const timing = startBridgeTiming();
        const config = bridgeConfig();
        if (ctx.headers?.get('origin') !== config.appURL.origin) {
          throw new APIError('FORBIDDEN', { message: 'Invalid bridge origin' });
        }
        const challenge = ctx.getCookie(FLOW_COOKIE);
        if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
          throw new APIError('UNAUTHORIZED', { message: 'Bridge flow expired' });
        }
        const launch = await bridgeRequest<{
          credential: string;
          expires_at: number;
          name: string;
          sub: string;
        }>('/api/lobe/exchange', { challenge, ticket: ctx.body.ticket });
        if (
          !launch.sub ||
          !launch.credential?.startsWith('lobe_') ||
          !Number.isSafeInteger(launch.expires_at) ||
          launch.expires_at * 1000 <= Date.now()
        ) {
          throw new APIError('UNAUTHORIZED', { message: 'Invalid bridge identity' });
        }
        const adapter = ctx.context.internalAdapter;
        timing.mark('ticketExchange');
        const email = subjectEmail(launch.sub);
        const providerId = 'newapi-bridge';
        const findBoundUser = async () => {
          const account = await adapter.findOAuthUser(email, launch.sub, providerId);
          // A matching email alone must never link a pre-existing account to a New API subject.
          return account?.linkedAccount ? account.user : undefined;
        };
        let user = await findBoundUser();
        const isNew = !user;
        if (!user) {
          try {
            user = (
              await adapter.createOAuthUser(
                { email, emailVerified: true, name: launch.name || launch.sub },
                { accountId: launch.sub, providerId },
              )
            ).user;
          } catch (error) {
            user = await findBoundUser();
            if (!user) throw error;
          }
        }
        if (!user || (user as { banned?: boolean }).banned)
          throw new APIError('FORBIDDEN', { message: 'Account unavailable' });
        const identity = { ...launch, userId: user.id };
        timing.mark('account');
        await bootstrapBridgeUser(serverDB, identity, isNew);
        timing.mark('bootstrap');
        const session = await adapter.createSession(
          user.id,
          false,
          {
            expiresAt: new Date(launch.expires_at * 1000),
          },
          true,
        );
        if (!session)
          throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Session creation failed' });
        await setSessionCookie(ctx, { session, user });
        ctx.setCookie(
          BRIDGE_COOKIE,
          sealBridgeIdentity(identity),
          bridgeCookieOptions(Math.max(0, launch.expires_at - Math.floor(Date.now() / 1000))),
        );
        ctx.setCookie(FLOW_COOKIE, '', bridgeCookieOptions(0));
        timing.mark('session');
        return ctx.json({ success: true, timing: timing.finish() });
      },
    ),
  },
});
