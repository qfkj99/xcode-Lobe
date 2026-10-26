import type {
  ModelRuntimeHooks,
  OpenAIChatMessage,
  UserMessageContentPart,
} from '@lobechat/model-runtime';
import { resolveMimeTypeFromBytes } from '@lobechat/utils';

import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { bridgeConfig } from './security';

const MAX_INLINE_MEDIA_BYTES = 20 * 1024 * 1024;

export const inlineBridgeMedia = async (
  db: LobeChatDatabase,
  userId: string,
  messages: OpenAIChatMessage[],
): Promise<OpenAIChatMessage[]> => {
  const fileModel = new FileModel(db, userId);
  let fileService: FileService | undefined;
  let bytesRead = 0;
  const cache = new Map<string, string>();
  const appOrigin = bridgeConfig().appURL.origin;
  const inline = async (source: string) => {
    const url = new URL(source, appOrigin);
    if (url.origin !== appOrigin || !url.pathname.startsWith('/f/')) return source;
    if (cache.has(url.pathname)) return cache.get(url.pathname)!;
    const match = /^\/f\/([^/]+)$/.exec(url.pathname);
    if (!match) throw new Error('Invalid private attachment URL');
    const file = await fileModel.findById(decodeURIComponent(match[1]));
    if (!file) throw new Error('Attachment is not accessible to this account');
    fileService ??= new FileService(db, userId);
    // S3 reads use S3_INTERNAL_ENDPOINT, so no browser URL or auth cookie leaves the server.
    const metadata = await fileService.getFileMetadata(file.url);
    if (
      !Number.isSafeInteger(metadata.contentLength) ||
      metadata.contentLength < 0 ||
      bytesRead + metadata.contentLength > MAX_INLINE_MEDIA_BYTES
    ) {
      throw new Error('Private media exceeds the 20 MiB request limit');
    }
    const bytes = await fileService.getFileByteArray(file.url);
    bytesRead += bytes.byteLength;
    if (bytesRead > MAX_INLINE_MEDIA_BYTES)
      throw new Error('Private media exceeds the 20 MiB request limit');
    const mimeType = await resolveMimeTypeFromBytes(file.fileType, bytes);
    const data = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    cache.set(url.pathname, data);
    return data;
  };
  const resolvePart = async (part: UserMessageContentPart): Promise<UserMessageContentPart> => {
    if (part.type === 'image_url')
      return { ...part, image_url: { ...part.image_url, url: await inline(part.image_url.url) } };
    if (part.type === 'audio_url')
      return { ...part, audio_url: { ...part.audio_url, url: await inline(part.audio_url.url) } };
    if (part.type === 'video_url')
      return { ...part, video_url: { ...part.video_url, url: await inline(part.video_url.url) } };
    return part;
  };
  const result: OpenAIChatMessage[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      result.push(message);
      continue;
    }
    const content: UserMessageContentPart[] = [];
    for (const part of message.content) content.push(await resolvePart(part));
    result.push({ ...message, content });
  }
  return result;
};

export const bridgeMediaHooks = (db: LobeChatDatabase, userId: string): ModelRuntimeHooks => ({
  beforeChat: async (payload) => {
    payload.messages = await inlineBridgeMedia(db, userId, payload.messages);
  },
});
