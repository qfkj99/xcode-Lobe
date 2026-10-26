import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import { useChatInputNotices } from './useChatInputNotice';

const groupProvider = `newapi-group-${'a'.repeat(40)}`;
const model = 'gpt-6-astra';

const state = vi.hoisted(() => ({
  agent: { loading: false, model: '', provider: '' },
  aiInfra: {
    builtinAiModelList: [] as { id: string; providerId: string; type: 'chat' }[],
    enabledAiProviders: [] as { id: string }[],
    enabledChatModelList: [] as { children: { id: string }[]; id: string }[],
    modelRedirects: {},
    ready: true,
    toggleProviderEnabled: vi.fn(async () => {}),
    toggleProviderModelEnabled: vi.fn(async () => {}),
  },
  chat: {
    activeTopicId: undefined as string | undefined,
    topics: {} as Record<string, { model?: string; provider?: string }>,
    updateTopicModel: vi.fn(async () => {}),
  },
  composerTopicId: null as string | null,
  managed: true,
  selectModel: vi.fn(async () => {}),
}));

vi.mock('@lobehub/ui', () => ({ toast: { error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({ useAgentId: () => 'agent' }));
vi.mock('@/features/ChatInput/hooks/useTopicId', () => ({
  useTopicId: () => state.composerTopicId,
}));
vi.mock('@/features/ChatInput/hooks/useAgentModelSelection', () => ({
  useAgentModelSelection: () => ({
    canSelectModel: true,
    isPreferenceLoading: false,
    model: state.agent.model,
    provider: state.agent.provider,
    selectModel: state.selectModel,
    selectionPolicy: 'fixed',
  }),
}));
vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canUseResource: true, isGroupContext: false }),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (store: typeof state.agent) => unknown) => selector(state.agent),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    isAgentConfigLoadingById: () => (store: typeof state.agent) => store.loading,
    isAgentHeterogeneousById: () => () => false,
  },
}));
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: (store: typeof state.aiInfra) => store.ready,
  },
  useAiInfraStore: (selector: (store: typeof state.aiInfra) => unknown) => selector(state.aiInfra),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (store: typeof state.chat) => unknown) => selector(state.chat),
}));
vi.mock('@/store/chat/slices/topic/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (store: typeof state.chat) => store.topics[id],
    getTopicModelById: (id: string) => (store: typeof state.chat) => store.topics[id],
  },
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (store: { serverConfig: { newApiChat: boolean } }) => unknown) =>
    selector({ serverConfig: { newApiChat: state.managed } }),
}));

describe('managed New API input notices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.managed = true;
    state.agent = { loading: false, model, provider: 'newapi' };
    state.aiInfra.ready = true;
    state.aiInfra.builtinAiModelList = [{ id: model, providerId: 'openai', type: 'chat' }];
    state.aiInfra.enabledAiProviders = [{ id: 'newapi' }, { id: groupProvider }];
    state.aiInfra.enabledChatModelList = [
      { children: [{ id: model }], id: 'newapi' },
      { children: [{ id: model }], id: groupProvider },
    ];
    state.composerTopicId = null;
    state.chat.activeTopicId = undefined;
    state.chat.topics = {};
  });

  it.each(['newapi', groupProvider])(
    'accepts the authorized %s model without changing the menu',
    (provider) => {
      state.agent.provider = provider;
      const { result } = renderHook(() => ({
        menu: useEnabledChatModels(),
        notices: useChatInputNotices(),
      }));

      expect(result.current.notices).toEqual([]);
      expect(result.current.menu.map((item) => item.id)).toEqual([groupProvider]);
      expect(state.selectModel).not.toHaveBeenCalled();
    },
  );

  it('keeps the composer topic ahead of the agent and unrelated global topic', () => {
    state.agent.model = 'missing-agent-model';
    state.composerTopicId = 'own-topic';
    state.chat.activeTopicId = 'other-topic';
    state.chat.topics = {
      'other-topic': { model: 'unavailable', provider: groupProvider },
      'own-topic': { model, provider: 'newapi' },
    };
    const { result } = renderHook(() => useChatInputNotices());
    expect(result.current).toEqual([]);
    expect(state.chat.updateTopicModel).not.toHaveBeenCalled();
  });

  it.each(['newapi', groupProvider, 'openai'])(
    'does not offer to enable a missing %s pair via the builtin bank',
    async (provider) => {
      state.agent.provider = provider;
      state.aiInfra.enabledChatModelList = state.aiInfra.enabledChatModelList.filter(
        (item) => item.id !== provider,
      );
      const { result } = renderHook(() => useChatInputNotices());
      expect(result.current).toEqual([{ key: 'input.modelUnavailable', type: 'warning' }]);
      await act(async () => result.current[0]?.onAction?.());
      expect(state.aiInfra.toggleProviderEnabled).not.toHaveBeenCalled();
      expect(state.aiInfra.toggleProviderModelEnabled).not.toHaveBeenCalled();
      expect(state.selectModel).not.toHaveBeenCalled();
      expect(state.chat.updateTopicModel).not.toHaveBeenCalled();
    },
  );

  it('marks a revoked topic model unavailable without switching to the authorized agent model', () => {
    state.agent.provider = groupProvider;
    state.composerTopicId = 'topic';
    state.chat.topics.topic = { model, provider: 'newapi' };
    const { result, rerender } = renderHook(() => useChatInputNotices());
    expect(result.current).toEqual([]);

    state.aiInfra.enabledChatModelList = [{ children: [{ id: model }], id: groupProvider }];
    rerender();
    expect(result.current).toEqual([{ key: 'input.modelUnavailable', type: 'warning' }]);
    expect(state.chat.updateTopicModel).not.toHaveBeenCalled();
  });

  it('does not borrow a same-named model from another authorized group', () => {
    state.agent.provider = groupProvider;
    state.aiInfra.enabledChatModelList = [
      { children: [{ id: model }], id: 'newapi' },
      { children: [{ id: 'different-model' }], id: groupProvider },
    ];
    const { result } = renderHook(() => useChatInputNotices());
    expect(result.current).toEqual([{ key: 'input.modelUnavailable', type: 'warning' }]);
    expect(state.selectModel).not.toHaveBeenCalled();
  });

  it('requires an exact authorized model ID instead of a case-insensitive builtin match', () => {
    state.agent.model = 'gpt-6-Astra';
    const { result, rerender } = renderHook(() => useChatInputNotices());
    expect(result.current).toEqual([{ key: 'input.modelUnavailable', type: 'warning' }]);

    state.aiInfra.enabledChatModelList = [{ children: [{ id: 'gpt-6-Astra' }], id: 'newapi' }];
    rerender();
    expect(result.current).toEqual([]);
  });

  it.each(['runtime', 'agent', 'topic'])(
    'waits for the %s before showing unavailable',
    (pending) => {
      state.aiInfra.enabledChatModelList = [];
      if (pending === 'runtime') state.aiInfra.ready = false;
      if (pending === 'agent') state.agent.loading = true;
      if (pending === 'topic') {
        state.composerTopicId = 'pending-topic';
        state.chat.activeTopicId = 'pending-topic';
      }
      const { result, rerender } = renderHook(() => useChatInputNotices());
      expect(result.current).toEqual([]);

      state.aiInfra.ready = true;
      state.agent.loading = false;
      state.chat.topics['pending-topic'] = { model, provider: 'newapi' };
      rerender();
      expect(result.current).toEqual([{ key: 'input.modelUnavailable', type: 'warning' }]);
    },
  );

  it('preserves standalone enable behavior', async () => {
    state.managed = false;
    state.agent.provider = 'openai';
    state.aiInfra.enabledChatModelList = [];
    const { result } = renderHook(() => useChatInputNotices());
    expect(result.current[0]).toMatchObject({ action: 'enableModel', key: 'input.modelDisabled' });
    await act(async () => result.current[0]?.onAction?.());
    expect(state.aiInfra.toggleProviderEnabled).toHaveBeenCalledWith('openai', true);
    expect(state.aiInfra.toggleProviderModelEnabled).toHaveBeenCalledWith({
      enabled: true,
      id: model,
      providerId: 'openai',
      type: 'chat',
    });
  });
});
