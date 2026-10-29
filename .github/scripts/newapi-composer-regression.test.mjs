import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(
  path.join(process.env.BRIDGE_TEST_DEPENDENCIES || root, 'package.json'),
);
const dep = (name) => pathToFileURL(require.resolve(name)).href;
const { Window } = await import(dep('happy-dom'));
const window = new Window();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver'])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? window : window[key],
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, renderHook, cleanup } = await import(dep('@testing-library/react'));
const react = dep('react');
const state = {
  input: {},
  sync: {},
  calls: [],
  notifications: [],
  topicLoaded: true,
  agentLoaded: true,
};
globalThis.newApiComposerTest = state;
const mocks = new Map([
  ['@lobechat/utils/object', `export const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);`],
  ['@/utils/trpcError', `export const isTrpcErrorCode=(error,code)=>error?.code===code;`],
  [
    '@/services/aiProvider',
    `export const aiProviderService={recoverNewApiTopic:async(input)=>{globalThis.newApiComposerTest.rpcInput=input;return globalThis.newApiComposerTest.rpcResult;}};`,
  ],
  [
    '@lobehub/ui',
    `export const toast={info:value=>globalThis.newApiComposerTest.notifications.push(value)};`,
  ],
  ['react-i18next', `export const useTranslation=()=>({t:()=> 'Switched'});`],
  [
    '@/store/newApiCatalog',
    `export const newApiCatalogActions={useFetchSelection:()=>globalThis.newApiComposerTest.sync,preload:async(ids)=>globalThis.newApiComposerTest.preloads.push(ids),refresh:async()=>{globalThis.newApiComposerTest.refreshes++;}};`,
  ],
  [
    '@/store/serverConfig',
    `export const useServerConfigStore=fn=>fn({serverConfig:{newApiChat:true}});`,
  ],
  [
    '@/store/agent',
    `export const useAgentStore=fn=>fn({agentMap:globalThis.newApiComposerTest.agentLoaded?{agent:{}}:{}});`,
  ],
  [
    '@/store/chat',
    `export const useChatStore=fn=>fn({});useChatStore.getState=()=>({internal_dispatchTopic:({value})=>Object.assign(globalThis.newApiComposerTest.topic,value)});`,
  ],
  [
    '@/store/chat/slices/topic/selectors',
    `export const topicSelectors={getTopicById:()=>()=>globalThis.newApiComposerTest.topicLoaded?(globalThis.newApiComposerTest.topic??{}):undefined,getTopicContainerKeyById:()=>()=> 'container'};`,
  ],
  [
    '@/utils/newApiTiming',
    `export const markNewApiComposer=ready=>globalThis.newApiComposerTest.timings.push(ready);`,
  ],
  ['../../hooks/useAgentId', `export const useAgentId=()=> 'agent';`],
  ['../../store', `export const useStoreApi=()=>globalThis.newApiComposerTest.input;`],
  [
    '@/store/aiInfra',
    `export const useAiInfraStore=fn=>fn({enabledAiProviders:globalThis.newApiComposerTest.providers});`,
  ],
  ['@/store/user', `export const useUserStore=fn=>fn({userId:'user'});`],
  ['@/store/user/selectors', `export const userProfileSelectors={userId:s=>s.userId};`],
]);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react') return { shortCircuit: true, url: react };
    if (mocks.has(specifier)) return { shortCircuit: true, url: `composer-test:${specifier}` };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('composer-test:'))
      return {
        shortCircuit: true,
        format: 'module',
        source: mocks.get(url.slice('composer-test:'.length)),
      };
    return next(url, context);
  },
});

const { recoverNewApiTopic } = await import(
  pathToFileURL(path.join(root, 'src/utils/recoverNewApiTopic.ts')).href
);
test('fallback response updates the topic projection and replaces stale reasoning metadata', async () => {
  state.topic = { model: 'old', provider: 'newapi', metadata: { reasoningConfig: { old: true } } };
  state.rpcResult = {
    selection: { model: 'new', provider: 'group', changed: true, groupName: 'default' },
    topic: { model: 'new', provider: 'group', metadata: { summary: 'Keep' } },
  };
  await recoverNewApiTopic('topic', { model: 'old', provider: 'newapi' }, state.topic);
  assert.equal(state.topic.model, 'new');
  assert.deepEqual(state.topic.metadata, { summary: 'Keep' });
  assert.equal(state.rpcInput.expectedModel, 'old');
});

test('late fallback response does not overwrite a newer local manual switch', async () => {
  state.topic = { model: 'manual', provider: 'group' };
  state.rpcResult = {
    selection: { model: 'new', provider: 'group', changed: true, groupName: 'default' },
    topic: { model: 'new', provider: 'group', metadata: {} },
  };
  await recoverNewApiTopic(
    'topic',
    { model: 'old', provider: 'newapi' },
    { model: 'old', provider: 'newapi' },
  );
  assert.equal(state.topic.model, 'manual');
});
const { useNewApiSelectionRecovery } = await import(
  pathToFileURL(
    path.join(root, 'src/features/ChatInput/ActionBar/Model/useNewApiSelectionRecovery.ts'),
  ).href
);
const selection = { model: 'old', provider: 'newapi' };
beforeEach(() => {
  cleanup();
  state.input = {
    state: {},
    listeners: new Set(),
    getState() {
      return this.state;
    },
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    setState(patch) {
      Object.assign(this.state, patch);
      for (const listener of this.listeners) listener();
    },
  };
  state.timings = [];
  state.sync = { data: undefined, error: undefined, mutate: async () => {} };
  state.notifications = [];
  state.topicLoaded = true;
  state.agentLoaded = true;
  state.providers = undefined;
  state.preloads = [];
  state.refreshes = 0;
});

test('composer stays blocked until the selected model has an authority result', () => {
  const { result, rerender } = renderHook(() =>
    useNewApiSelectionRecovery(selection, 'topic', true, async () => {}),
  );
  assert.equal(result.current.blocked, true);
  assert.equal(state.input.state.newApiModelUnavailable, true);
  state.sync.data = { ...selection, changed: false, groupName: 'default' };
  rerender();
  assert.equal(result.current.blocked, false);
});

test('ready timing waits for the editor and an enabled send path', () => {
  state.sync.data = { ...selection, changed: false, groupName: 'default' };
  renderHook(() => useNewApiSelectionRecovery(selection, 'topic', true, async () => {}));
  assert.deepEqual(state.timings, []);
  state.input.setState({ editor: {}, sendButtonProps: { disabled: true } });
  assert.equal(state.timings.includes(true), false);
  state.input.setState({
    sendButtonProps: { disabled: false },
    newApiModelSelectionPending: Symbol(),
  });
  assert.equal(state.timings.includes(true), false);
  state.input.setState({ newApiModelSelectionPending: undefined });
  assert.equal(state.timings.at(-1), true);
});

test('network error keeps the selection and offers retry', async () => {
  let applies = 0,
    retries = 0;
  state.sync.error = Error('timeout');
  state.sync.mutate = async () => {
    retries++;
  };
  const { result } = renderHook(() =>
    useNewApiSelectionRecovery(selection, 'topic', true, async () => {
      applies++;
    }),
  );
  assert.equal(result.current.blocked, true);
  assert.equal(applies, 0);
  await act(async () => {
    result.current.retry();
  });
  assert.equal(retries, 1);
});

test('automatic fallback remains blocked until persistence and the new selection agree', async () => {
  let finish;
  state.sync.data = { model: 'available', provider: 'group', changed: true, groupName: 'default' };
  const apply = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const { result, rerender } = renderHook(
    ({ current }) => useNewApiSelectionRecovery(current, 'topic', true, apply),
    { initialProps: { current: selection } },
  );
  assert.equal(result.current.blocked, true);
  await act(async () => {
    finish();
  });
  assert.equal(state.notifications.length, 1);
  assert.equal(result.current.blocked, true);
  state.sync.data = { model: 'available', provider: 'group', changed: false, groupName: 'default' };
  rerender({ current: { model: 'available', provider: 'group' } });
  assert.equal(result.current.blocked, false);
});

test('failed persistence remains blocked and can be retried', async () => {
  state.sync.data = { model: 'available', provider: 'group', changed: true, groupName: 'default' };
  let count = 0;
  const apply = async () => {
    count++;
    throw Error('save failed');
  };
  let hook;
  await act(async () => {
    hook = renderHook(() => useNewApiSelectionRecovery(selection, 'topic', true, apply));
  });
  assert.equal(hook.result.current.blocked, true);
  assert.ok(hook.result.current.error);
  assert.equal(state.notifications.length, 0);
  await act(async () => {
    hook.result.current.retry();
  });
  assert.equal(count, 2);
});

test('topic hydration never auto-switches the temporary agent default', () => {
  state.topicLoaded = false;
  let applies = 0;
  const { result } = renderHook(() =>
    useNewApiSelectionRecovery(selection, 'topic', true, async () => {
      applies++;
    }),
  );
  assert.equal(result.current.blocked, true);
  assert.equal(applies, 0);
});

const { useNewApiCatalogPreload } = await import(
  pathToFileURL(path.join(root, 'src/layout/GlobalProvider/useNewApiCatalogPreload.ts')).href
);
test('cold catalog initialization waits for providers and focus refreshes current authority', async () => {
  const hook = renderHook(() => useNewApiCatalogPreload(true));
  assert.deepEqual(state.preloads, []);
  state.providers = [{ id: 'newapi-group-a' }, { id: 'newapi-group-b' }];
  hook.rerender();
  assert.deepEqual(state.preloads, [['newapi-group-a', 'newapi-group-b']]);
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  assert.equal(state.refreshes, 1);
  hook.unmount();
  window.dispatchEvent(new window.Event('focus'));
  assert.equal(state.refreshes, 1);
});

const { getNewApiErrorMessage } = await import(pathToFileURL(path.join(root, 'src/features/Conversation/Error/newApiErrorMessage.ts')).href);
test('managed provider errors expose the actionable reason without stack or endpoint details', () => {
  const envelope = {body:{provider:'newapi-group-test',endpoint:'http://private',error:{message:'Image unsupported'}}};
  assert.equal(getNewApiErrorMessage(envelope),'Image unsupported');
  assert.equal(getNewApiErrorMessage({body:{stack:'Error: '+JSON.stringify(envelope)+'\n at internal'}}),'Image unsupported');
  assert.equal(getNewApiErrorMessage({body:{provider:'openai',error:{message:'Other provider'}}}),undefined);
  assert.equal(getNewApiErrorMessage({body:{stack:'Error: unstructured'}}),undefined);
});
