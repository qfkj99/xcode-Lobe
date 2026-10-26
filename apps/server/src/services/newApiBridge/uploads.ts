import { createHash } from 'node:crypto';

import { bridgeEnabled } from './security';

export const scopeBridgeUploadPath = (userId: string, value: string): string => {
  if (!bridgeEnabled()) return value;
  if (
    !value ||
    value.length > 900 ||
    /[\\?#:%\x00-\x1f]/.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid private upload pathname');
  }
  const prefix = `newapi/${createHash('sha256').update(userId).digest('hex')}/`;
  if (value.startsWith('newapi/') && !value.startsWith(prefix)) {
    throw new Error('Upload pathname belongs to another account');
  }
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
};

export const scopeBridgeUploadHash = (userId: string, value: string): string => {
  if (!bridgeEnabled()) return value;
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('Invalid private upload hash');
  // Global deduplication must not reveal or grant another account's stored object.
  return createHash('sha256').update(`newapi:${userId}:${value.toLowerCase()}`).digest('hex');
};
