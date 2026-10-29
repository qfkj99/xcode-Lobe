import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(
  path.join(process.env.BRIDGE_TEST_DEPENDENCIES || root, 'package.json'),
);
const reactURL = pathToFileURL(require.resolve('react')).href;
const equalURL = pathToFileURL(require.resolve('fast-deep-equal')).href;
const state = { scope: 'account-a', groups: {}, calls: [], refreshes: 0 };
globalThis.catalogRegression = state;
const url = (file) => pathToFileURL(path.join(root, file)).href;
const mocks = new Map([
  ['@/libs/swr', 'export const useClientDataSWR=()=>{};'],
  [
    '@/libs/swr/useCacheScope',
    'export const getCacheScope=()=>globalThis.catalogRegression.scope;',
  ],
  ['@/services/aiProvider/swrKeys', 'export const newApiSWRKeys={};'],
  [
    '@/services/aiProvider',
    `export const aiProviderService={getNewApiGroupCatalog:provider=>new Promise((resolve,reject)=>globalThis.catalogRegression.calls.push({provider,scope:globalThis.catalogRegression.scope,resolve,reject}))};`,
  ],
  ['@/store/user', 'export const useUserStore=()=>{};'],
  ['@/store/user/selectors', 'export const userProfileSelectors={};'],
  [
    '@/store/aiInfra',
    'export const useAiInfraStore={getState:()=>({refreshAiProviderRuntimeState:async()=>{globalThis.catalogRegression.refreshes++;}})};',
  ],
  [
    './store',
    `export const initialState=()=>({groups:{},replica:globalThis.catalogRegression.emptyReplica()});export const useNewApiCatalogStore={getState:()=>globalThis.catalogRegression,setState:patch=>Object.assign(globalThis.catalogRegression,typeof patch==='function'?patch(globalThis.catalogRegression):patch)};`,
  ],
  [
    '@/libs/replica',
    `import {defineReplica as define} from '${url('packages/replica/src/core/defineReplica.ts')}';import {createReplicaState} from '${url('packages/replica/src/core/reducer.ts')}';import {createReplicaSlice as create,recordLens} from '${url('packages/replica/src/zustand/createReplicaSlice.ts')}';export {recordLens};globalThis.catalogRegression.emptyReplica=createReplicaState;globalThis.catalogRegression.replica=createReplicaState();export const defineReplica=options=>define({...options,storage:undefined,scope:{get:()=>globalThis.catalogRegression.scope,canPersist:()=>false}});export const createReplicaSlice=(resource,options)=>{const slice=create(resource,{...options,driver:{revalidate:async()=>{}}});globalThis.catalogRegression.slice=slice;return slice;};`,
  ],
]);
registerHooks({
  resolve(specifier, context, next) {
    if (mocks.has(specifier)) return { shortCircuit: true, url: `catalog-test:${specifier}` };
    if (specifier === 'react') return { shortCircuit: true, url: reactURL };
    if (specifier === 'fast-deep-equal') return { shortCircuit: true, url: equalURL };
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const target = new URL(specifier, context.parentURL);
      if (!path.extname(target.pathname)) return next(target.href + '.ts', context);
    }
    return next(specifier, context);
  },
  load(target, context, next) {
    if (target.startsWith('catalog-test:'))
      return { shortCircuit: true, format: 'module', source: mocks.get(target.slice(13)) };
    return next(target, context);
  },
});
const { newApiCatalogActions: actions } = await import(url('src/store/newApiCatalog/action.ts'));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const finish = (call) =>
  call.resolve({ models: [{ id: call.scope, type: 'chat' }], name: call.provider });

test(
  'preload limits concurrency, reuses cached groups and joins an existing group request on refresh',
  { timeout: 2000 },
  async () => {
    const a = 'newapi-group-a',
      b = 'newapi-group-b',
      c = 'newapi-group-c';
    const loading = actions.preload([a, b, c]);
    assert.equal(state.calls.length, 2);
    finish(state.calls[0]);
    await flush();
    assert.equal(state.calls.length, 3);
    finish(state.calls[1]);
    finish(state.calls[2]);
    await loading;
    const cached = actions.preload([a, b, c]);
    assert.equal(state.calls.length, 3, 'loaded catalogs must be reused');
    await cached;
    const selected = state.slice.fetch(a);
    const refresh = actions.preload([a], true);
    assert.equal(state.calls.length, 4, 'refresh must join the picker request');
    finish(state.calls[3]);
    await Promise.all([selected, refresh]);
  },
);

test(
  'switching account isolates in-flight catalogs and drops the previous account response',
  { timeout: 2000 },
  async () => {
    const id = 'newapi-group-a';
    const previous = actions.preload([id], true);
    const oldCall = state.calls.at(-1);
    state.scope = 'account-b';
    const current = actions.preload([id]);
    const newCall = state.calls.at(-1);
    assert.notEqual(newCall, oldCall);
    assert.deepEqual(state.groups, {}, 'previous account projection clears immediately');
    finish(newCall);
    await current;
    finish(oldCall);
    await previous;
    assert.equal(state.groups[id].children[0].id, 'account-b');
  },
);
