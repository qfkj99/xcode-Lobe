import { topicService } from '@/services/topic';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { aiProviderService } from '@/services/aiProvider';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';
import { recoverNewApiTopic } from './recoverNewApiTopic';

interface ModelSelection {
  model?: string;
  provider?: string;
}

export const resolveNewApiTopicModel = async <T extends ModelSelection>(
  topicId: string | null | undefined,
  fallback: T,
): Promise<T> => {
  if (!getServerConfigStoreState()?.serverConfig.newApiChat) return fallback;
  const topic = topicId ? await topicService.getTopicDetail(topicId) : undefined;
  if (topicId && !topic) throw new Error('New API topic is unavailable');
  const current =
    topic?.model && topic.provider
      ? { ...fallback, model: topic.model, provider: topic.provider }
      : fallback;
  if (!current?.model) throw new Error('New API model is unavailable');
  // A fresh authority read: transport failures must never switch billed models.
  let resolved = await aiProviderService.resolveNewApiSelection({
    model: current.model,
    provider: current.provider || '',
  });
  if (resolved.changed) {
    if (topicId)
      resolved = await recoverNewApiTopic(
        topicId,
        { model: current.model, provider: current.provider || '' },
        topic!,
      );
    if (resolved.changed)
      toast.info(
        t('ModelSwitchPanel.newApiAutoSwitched', {
          ns: 'components',
          model: resolved.model,
          group: resolved.groupName,
        }),
      );
  }
  return { ...fallback, model: resolved.model, provider: resolved.provider };
};
