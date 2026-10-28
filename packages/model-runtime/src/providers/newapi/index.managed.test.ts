// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { params } from './index';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('loads managed model catalogs without requesting public pricing', async () => {
  vi.stubEnv('NEW_API_CHAT_BRIDGE_SECRET', 'test-managed-deployment');
  const fetch = vi.fn(() => {
    throw new Error('Public pricing must not delay managed login');
  });
  vi.stubGlobal('fetch', fetch);
  const result = await params.models({
    client: {
      apiKey: 'test-key',
      baseURL: 'https://newapi.example/v1',
      models: { list: async () => ({ data: [{ id: 'allowed-model', owned_by: 'openai' }] }) },
    } as unknown as Parameters<typeof params.models>[0]['client'],
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(result.map((model) => model.id)).toEqual(['allowed-model']);
});
