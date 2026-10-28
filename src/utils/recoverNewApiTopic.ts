import { aiProviderService } from '@/services/aiProvider';
import type { NewApiSelection } from '@/types/newApiBridge';

export const recoverNewApiTopic = async (
  topicId: string,
  current: NewApiSelection,
  expected: { model?: string | null; provider?: string | null },
) => {
  const result = await aiProviderService.recoverNewApiTopic({
    topicId,
    ...current,
    expectedModel: expected.model ?? null,
    expectedProvider: expected.provider ?? null,
  });
  const [{ useChatStore }, { topicSelectors }] = await Promise.all([
    import('@/store/chat'),
    import('@/store/chat/slices/topic/selectors'),
  ]);
  const store = useChatStore.getState();
  const row = topicSelectors.getTopicById(topicId)(store);
  // Do not overwrite a newer local manual switch with this older response.
  if (
    (row?.model ?? null) === (expected.model ?? null) &&
    (row?.provider ?? null) === (expected.provider ?? null)
  ) {
    store.internal_dispatchTopic({
      containerKey: topicSelectors.getTopicContainerKeyById(topicId)(store),
      id: topicId,
      type: 'updateTopic',
      value: {
        model: result.topic.model,
        provider: result.topic.provider,
        metadata: result.topic.metadata,
      },
    });
  }
  return result.selection;
};
