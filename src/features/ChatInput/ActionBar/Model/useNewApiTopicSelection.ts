import { useEffect, useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getFileStoreState } from '@/store/file/store';
import { useServerConfigStore } from '@/store/serverConfig';

import { saveDraft } from '../../draftStorage';
import { useAgentId } from '../../hooks/useAgentId';
import { useStoreApi } from '../../store';
import { createNewApiTopicSelection, preserveNewApiComposer } from './newApiTopicSelection';

export const useNewApiTopicSelection = (topicId: string | null) => {
  const enabled = useServerConfigStore((s) => !!s.serverConfig.newApiChat);
  const agentId = useAgentId();
  const input = useStoreApi();
  const controller = useMemo(() => {
    const token = Symbol('newapi-model-selection');
    return createNewApiTopicSelection({
      topicId,
      onPending: (pending) => {
        if (pending) input.setState({ newApiModelSelectionPending: token });
        else if (input.getState().newApiModelSelectionPending === token) {
          input.setState({ newApiModelSelectionPending: undefined });
        }
      },
      isCurrent: () => {
        const current = useChatStore.getState();
        return current.activeAgentId === agentId && current.activeTopicId === topicId;
      },
      create: (selection) =>
        useChatStore.getState().internal_createTopic({
          ...selection,
          messages: [],
          agentId,
          title: '',
        }),
      update: (id, selection) => useChatStore.getState().updateTopicModel(id, selection),
      activate: async (id) => {
        const editor = input.getState();
        const nextKey = messageMapKey({ agentId, topicId: id });
        preserveNewApiComposer(
          editor,
          nextKey,
          saveDraft,
          getFileStoreState().moveChatContextSelections,
        );
        await useChatStore.getState().switchTopic(id, {
          onlyIfActiveAgentId: agentId,
          onlyIfActiveTopicIn: [null],
        });
      },
    });
  }, [agentId, input, topicId]);
  useEffect(() => {
    controller.resume();
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (
        state.activeAgentId !== previous.activeAgentId ||
        state.activeTopicId !== previous.activeTopicId
      ) {
        controller.invalidate();
      }
    });
    return () => {
      controller.invalidate();
      unsubscribe();
    };
  }, [controller]);

  return { enabled, select: controller.select };
};
