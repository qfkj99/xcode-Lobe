import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// Exercise the real executor up to the context boundary. The completion body
// is irrelevant here: a reused placeholder must identify the selected model
// before any streaming request starts.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './callLlmFinalizer')
      return { shortCircuit: true, url: 'selection-test:finalizer' };
    if (specifier === '../utils/runtimeRetry')
      return next(new URL('../utils/runtimeRetry.ts', context.parentURL).href, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'selection-test:finalizer')
      return {
        shortCircuit: true,
        format: 'module',
        source:
          'export const finalizeCallLlmTurn=()=>{}; export const persistInterruptedCallLlmResult=()=>{};',
      };
    return next(url, context);
  },
});
const { callLlm } = await import('../../packages/agent-runtime/src/executors/callLlm.ts');

test('reused assistant placeholder records the topic model before context and streaming', async () => {
  const row = { model: 'default-model', provider: 'default-group', metadata: {} };
  const boundary = new Error('context boundary reached');
  const host = {
    operation: { operationId: 'op', stepIndex: 0 },
    transports: {
      llm: {
        runAttempt: async () => {
          throw Error('must not stream before context');
        },
        retryPolicy: {},
      },
      messages: {
        update: async (_id, patch) => Object.assign(row, patch),
        findById: async () => row,
      },
      stream: { publishEvent: async () => {}, publishError: async () => {} },
      context: {
        build: async () => {
          assert.equal(row.model, 'premium-model');
          assert.equal(row.provider, 'premium-group');
          throw boundary;
        },
      },
    },
  };
  await assert.rejects(
    callLlm(host)(
      {
        type: 'call_llm',
        payload: {
          assistantMessageId: 'placeholder',
          model: 'premium-model',
          provider: 'premium-group',
        },
      },
      {},
    ),
    (error) => error === boundary,
  );
});
