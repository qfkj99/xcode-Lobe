import { isManagedNewApiProvider } from '@/utils/newApiModelPricing';

interface Selection {
  model?: string | null;
  provider?: string | null;
}

// Repair only foreign provider defaults. Existing New API selections and topic
// overrides retain their meaning, including when their model becomes unavailable.
export const bridgeSelectionRepair = (current: Selection, fallback: Selection) => {
  if (isManagedNewApiProvider(current.provider ?? undefined, true)) return;
  if (!fallback.model || !isManagedNewApiProvider(fallback.provider ?? undefined, true)) return;
  return { model: fallback.model, provider: fallback.provider! };
};
