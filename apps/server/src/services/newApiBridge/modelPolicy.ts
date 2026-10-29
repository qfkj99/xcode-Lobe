import type { OpenAIChatMessage } from '@lobechat/model-runtime';

import { bridgeRequest, type BridgeIdentity } from './security';

export const enforceBridgeModelPolicy = async (
  identity: BridgeIdentity,
  group: string | undefined,
  model: string,
  messages: OpenAIChatMessage[],
) => {
  const models = await bridgeRequest<{ id: string; vision: boolean }[]>('/api/lobe/models', {
    credential: identity.credential,
    group,
  });
  if (!Array.isArray(models)) throw new Error('Invalid New API model capabilities');
  const capability = models.find((item) => item.id === model);
  if (!capability || typeof capability.vision !== 'boolean')
    throw new Error('New API model is unavailable');
  if (capability.vision) return messages;
  // Copy request content only. Persisted messages and attachments remain intact.
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const content = message.content.filter((part) => part.type !== 'image_url');
    return { ...message, content: content.length ? content : '' };
  });
};
