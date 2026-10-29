import type { ChatModelCard } from 'model-bank';

import { processMultiProviderModelList } from '../../utils/modelParse';

export const fetchManagedNewApiModels = async (
  baseURL: string,
  credential: string,
  headers: Record<string, string>,
): Promise<ChatModelCard[]> => {
  const group = headers['X-Lobe-Group'];
  const response = await fetch(new URL('/api/lobe/models', baseURL), {
    body: JSON.stringify({
      credential,
      group: group ? Buffer.from(group, 'base64url').toString('utf8') : undefined,
    }),
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Lobe-Bridge-Secret': headers['X-Lobe-Bridge-Secret'],
    },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Unable to load New API model capabilities');
  const body = await response.json();
  if (body.success !== true || !Array.isArray(body.data))
    throw new Error('Invalid New API model capabilities');
  const models: { id: string; type: 'chat'; vision: boolean }[] = body.data;
  if (
    models.some(
      (model) =>
        !model ||
        typeof model.id !== 'string' ||
        !model.id ||
        model.type !== 'chat' ||
        typeof model.vision !== 'boolean',
    )
  )
    throw new Error('Invalid New API model capabilities');
  const parsed = await processMultiProviderModelList(
    models.map(({ id }) => ({ id })),
    'newapi',
  );
  const capabilities = new Map(models.map((model) => [model.id, model]));
  return parsed
    .filter((model) => !model.type || model.type === 'chat')
    .map((model) => ({ ...model, vision: capabilities.get(model.id)!.vision, pricing: undefined }));
};
