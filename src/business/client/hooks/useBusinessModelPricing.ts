import type { Pricing } from 'model-bank';
import { useCallback } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';
import { isManagedNewApiProvider } from '@/utils/newApiModelPricing';

export interface BusinessModelPricingParams {
  model?: string;
  pricing?: Pricing;
  provider?: string;
}

export const applyBusinessModelPricing = (
  { pricing, provider }: BusinessModelPricingParams,
  managed = false,
) => (isManagedNewApiProvider(provider, managed) ? undefined : pricing);

export const useBusinessModelPricing = () => {
  const managed = useServerConfigStore((s) => s.serverConfig.newApiChat);
  // Also reject stale inline prices from client caches before rendering rows or details.
  return useCallback(
    (params: BusinessModelPricingParams) => applyBusinessModelPricing(params, managed),
    [managed],
  );
};

export const useBusinessModelPricingPrefetch = () => {};
