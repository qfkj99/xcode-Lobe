import { topicService } from '@/services/topic';
import { getServerConfigStoreState } from '@/store/serverConfig';

interface ModelSelection {
  model: string;
  provider?: string;
}

export const resolveNewApiTopicModel = async <T extends ModelSelection>(
  topicId: string | null | undefined,
  fallback: T,
): Promise<T> => {
  if (!getServerConfigStoreState()?.serverConfig.newApiChat || !topicId) return fallback;
  const topic = await topicService.getTopicDetail(topicId);
  if (!topic) throw new Error('New API topic is unavailable');
  return topic.model && topic.provider
    ? { ...fallback, model: topic.model, provider: topic.provider }
    : fallback;
};
