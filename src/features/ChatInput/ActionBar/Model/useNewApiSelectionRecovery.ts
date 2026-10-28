import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { newApiCatalogActions } from '@/store/newApiCatalog';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import type { NewApiSelection, NewApiSelectionResolution } from '@/types/newApiBridge';
import { markNewApiComposer } from '@/utils/newApiTiming';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { useAgentId } from '../../hooks/useAgentId';
import { useStoreApi } from '../../store';

export const useNewApiSelectionRecovery = (
  selection: NewApiSelection,
  topicId: string | null,
  canSelect: boolean,
  apply: (selection: NewApiSelection) => Promise<NewApiSelectionResolution | void>,
) => {
  const enabled = useServerConfigStore((s) => !!s.serverConfig.newApiChat);
  const agentId = useAgentId();
  const input = useStoreApi();
  const { t } = useTranslation('components');
  const [failure, setFailure] = useState<{ key: string; error: unknown }>();
  const context = `${agentId}:${topicId ?? ''}`;
  const agentLoaded = useAgentStore((s) => !!s.agentMap[agentId]);
  const topicLoaded = useChatStore((s) => !topicId || !!topicSelectors.getTopicById(topicId)(s));
  const ready = agentLoaded && topicLoaded;
  const sync = newApiCatalogActions.useFetchSelection(
    enabled && canSelect && agentId && ready ? selection : undefined,
    context,
  );
  const applying = useRef<string | undefined>(undefined);
  const result = sync.data;
  const needsSwitch =
    result?.changed && (result.model !== selection.model || result.provider !== selection.provider);
  const selectionKey = `${context}:${selection.provider}:${selection.model}`;
  const currentKey = useRef(selectionKey);
  currentKey.current = selectionKey;
  const saveError = failure?.key === selectionKey ? failure.error : undefined;
  const blocked =
    enabled && canSelect && (!ready || !result || !!sync.error || !!saveError || !!needsSwitch);

  // Gate text, keyboard and voice paths until authority and the
  // persisted topic pin agree. Cleanup belongs to this composer only.
  useLayoutEffect(() => {
    input.setState({ newApiModelUnavailable: blocked });
    return () => {
      input.setState({ newApiModelUnavailable: false });
    };
  }, [blocked, enabled, input]);

  useEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const state = input.getState();
      if (!state.editor) return;
      markNewApiComposer(false);
      if (
        !blocked &&
        !state.newApiModelUnavailable &&
        !state.newApiModelSelectionPending &&
        !state.sendButtonProps?.disabled
      )
        markNewApiComposer(true);
    };
    measure();
    return input.subscribe(measure);
  }, [blocked, enabled, input]);

  useEffect(() => {
    if (!enabled || !needsSwitch || !result) return;
    const key = `${context}:${selection.provider}:${selection.model}:${result.provider}:${result.model}`;
    if (applying.current === key) return;
    applying.current = key;
    void apply({ model: result.model, provider: result.provider })
      .then(async (applied) => {
        if (applied?.changed === false) {
          await sync.mutate();
          return;
        }
        toast.info(
          t('ModelSwitchPanel.newApiAutoSwitched', {
            model: applied?.model ?? result.model,
            group: applied?.groupName ?? result.groupName,
          }),
        );
      })
      .catch((error) => {
        console.error('[newApiSelection] Failed to persist fallback:', error);
        if (currentKey.current === selectionKey) setFailure({ key: selectionKey, error });
      });
  }, [
    apply,
    context,
    enabled,
    needsSwitch,
    result,
    selection.model,
    selection.provider,
    selectionKey,
    t,
  ]);

  return {
    blocked,
    noModels: isTrpcErrorCode(sync.error, 'PRECONDITION_FAILED'),
    error: sync.error || saveError,
    retry: () => {
      applying.current = undefined;
      setFailure(undefined);
      void sync.mutate();
    },
  };
};
