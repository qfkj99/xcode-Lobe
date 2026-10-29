import { isRecord } from '@lobechat/utils/object';

// Older runtime envelopes persisted only Error.stack. Recover the structured
// provider message without exposing the stack, endpoint or serialized request.
export const getNewApiErrorMessage = (error: unknown): string | undefined => {
  const read = (value: unknown, depth: number): string | undefined => {
    if (depth > 4 || !isRecord(value)) return;
    const body = isRecord(value.body) ? value.body : value;
    const provider = body.provider;
    if (
      typeof provider === 'string' &&
      (provider === 'newapi' || provider.startsWith('newapi-group-'))
    ) {
      const upstream = isRecord(body.error) ? body.error.message : body.message;
      if (typeof upstream === 'string' && upstream.trim()) return upstream.trim().slice(0, 2000);
    }
    for (const candidate of [value.message, value.stack, body.message, body.stack]) {
      if (typeof candidate !== 'string') continue;
      const firstLine = candidate.split('\n')[0].replace(/^Error: /, '');
      if (!firstLine.startsWith('{')) continue;
      try {
        const message = read(JSON.parse(firstLine), depth + 1);
        if (message) return message;
      } catch {
        /* Non-JSON errors use the ordinary error renderer. */
      }
    }
  };
  return read(error, 0);
};
