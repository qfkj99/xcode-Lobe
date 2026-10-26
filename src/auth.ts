import { authEnv } from '@/envs/auth';
import { defineConfig } from '@/libs/better-auth/define-config';
import { newApiBridge } from '@/libs/better-auth/plugins/newApiBridge';
import { bridgeEnabled } from '@/server/services/newApiBridge/security';

export const auth = defineConfig({
  ...(authEnv.AUTH_COOKIE_PREFIX && { cookiePrefix: authEnv.AUTH_COOKIE_PREFIX }),
  plugins: bridgeEnabled() ? [newApiBridge()] : [],
});
