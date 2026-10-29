import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This standalone gate can use a small dependency installation without booting
// Next.js, Redis or the full monorepo. DATABASE calls use a real PGlite database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(
  path.join(process.env.BRIDGE_TEST_DEPENDENCIES || root, 'package.json'),
);
const moduleURL = (name) => pathToFileURL(require.resolve(name)).href;
const dependencyURLs = Object.fromEntries(
  ['p-map', 'drizzle-orm'].map((name) => [name, moduleURL(name)]),
);
const bridgeDir = path.join(root, 'apps/server/src/services/newApiBridge');
const state = {
  settings: {},
  updates: [],
  groups: {},
  models: {},
  pending: [],
  active: 0,
  peak: 0,
};
globalThis.bridgeRegression = state;
const mocks = new Map([
  [
    'model-bank',
    `export const LOBE_DEFAULT_MODEL_LIST=[];export const ModelProvider={NewAPI:'newapi'};`,
  ],
  ['url-join', `export default (...parts)=>parts.join('/');`],
  ['../../core/RouterRuntime', `export const createRouterRuntime=()=>class {};`],
  [
    '../../utils/modelParse',
    `export const detectModelProvider=()=> 'openai';export const processMultiProviderModelList=(models)=>models;`,
  ],
  ['../openai/modelId', `export const responsesAPIModels=[];`],
  ['../utils/resolveProviderRouteModels', `export const resolveProviderRouteModels=()=>[];`],
  [
    '@lobechat/const',
    `export const DEFAULT_SYSTEM_AGENT_CONFIG={topic:{model:'old',provider:'openai'}};`,
  ],
  [
    '@/database/models/user',
    `export class UserModel { static async findById(){return {isOnboarded:true};}
    async getUserSettings(){return globalThis.bridgeRegression.settings;}
    async updateSetting(value){globalThis.bridgeRegression.updates.push(value);globalThis.bridgeRegression.settings={...globalThis.bridgeRegression.settings,...value};}
    async updateUser(){}
  }`,
  ],
  [
    '@/database/models/aiProvider',
    `export class AiProviderModel {async toggleProviderEnabled(){} async update(){}}`,
  ],
  [
    '@/database/models/aiModel',
    `export class AiModelModel {async batchUpdateAiModels(){} async batchToggleAiModels(){}}`,
  ],
  [
    '@/database/schemas',
    `export const agents=globalThis.bridgeRegression.agents;export const topics=globalThis.bridgeRegression.topics;`,
  ],
  [
    '@trpc/server',
    `export class TRPCError extends Error {constructor(options){super(options.message||options.code);this.code=options.code;}}`,
  ],
  [
    '@/database/utils/softDelete',
    "import {sql} from 'drizzle-orm';export const notTrashed=column=>sql`${column} IS NOT TRUE`;",
  ],
  [
    '@/database/core/db-adaptor',
    `export const getServerDB=async()=>globalThis.bridgeRegression.db;`,
  ],
  [
    '@/business/server/aiProvider',
    `export const getHiddenBuiltinModelsForUser=async()=>[];export const getModelRedirects=async()=>({});`,
  ],
  [
    '@/utils/aiProvider',
    `export const filterEnabledProvidersByModelType=(p)=>p;export const filterHiddenBuiltinModels=x=>x;export const filterHiddenProviderModels=x=>x;`,
  ],
  [
    'bridge-runtime',
    `export const createBridgeRuntimeFromIdentity=(_identity,_db,group)=>({models:async()=>{
    const s=globalThis.bridgeRegression;s.active++;s.calls.push(group);s.peak=Math.max(s.peak,s.active);
    try{await new Promise(resolve=>s.pending.push(resolve));if(s.modelError)throw Error('Network timeout');return s.models[group]||[];}finally{s.active--;}
  }});
  export const getBridgeRuntimeIdentity=async()=>globalThis.bridgeRegression.identity;
  export const getBridgeModelIdsFromIdentity=async(_identity,group)=>{
    const s=globalThis.bridgeRegression;s.active++;s.peak=Math.max(s.peak,s.active);
    try{await new Promise(resolve=>s.pending.push(resolve));return new Set((s.models[group]||[]).map(m=>m.id));}finally{s.active--;}
  };
  export const getBridgeModelIds=async()=>new Set();`,
  ],
  [
    'bridge-security',
    `export const bridgeEnabled=()=>true;export const bridgeRequest=async(path,body)=>{const s=globalThis.bridgeRegression;if(s.groupError)throw Error('Group network timeout');return path==='/api/lobe/models'?(s.models[body.group||s.groups.default_group]||[]):s.groups;};`,
  ],
]);
registerHooks({
  resolve(specifier, context, next) {
    let key = specifier;
    if (
      specifier.endsWith('/newApiBridge/runtime') ||
      (specifier === './runtime' && context.parentURL?.includes('/newApiBridge/'))
    )
      key = 'bridge-runtime';
    if (
      specifier.endsWith('/newApiBridge/security') ||
      (specifier === './security' && context.parentURL?.includes('/newApiBridge/'))
    )
      key = 'bridge-security';
    if (mocks.has(key)) return { shortCircuit: true, url: `bridge-test:${key}` };
    if (dependencyURLs[specifier]) return { shortCircuit: true, url: dependencyURLs[specifier] };
    if (specifier.startsWith('@/server/services/'))
      return {
        shortCircuit: true,
        url: pathToFileURL(
          path.join(
            root,
            'apps/server/src/services',
            specifier.slice('@/server/services/'.length) + '.ts',
          ),
        ).href,
      };
    if (specifier === '@/utils/newApiModelPricing')
      return {
        shortCircuit: true,
        url: pathToFileURL(path.join(root, 'src/utils/newApiModelPricing.ts')).href,
      };
    if (
      specifier.startsWith('./') &&
      (context.parentURL?.includes('/newApiBridge/') ||
        context.parentURL?.includes('/providers/newapi/')) &&
      !path.extname(specifier)
    )
      return { shortCircuit: true, url: new URL(specifier + '.ts', context.parentURL).href };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('bridge-test:'))
      return {
        shortCircuit: true,
        format: 'module',
        source: mocks.get(url.slice('bridge-test:'.length)),
      };
    return next(url, context);
  },
});
const { PGlite } = await import(moduleURL('@electric-sql/pglite'));
const { drizzle } = await import(moduleURL('drizzle-orm/pglite'));
const { pgTable, text, jsonb, boolean, timestamp } = await import(moduleURL('drizzle-orm/pg-core'));
state.agents = pgTable('agents', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  workspaceId: text('workspace_id'),
  model: text('model'),
  provider: text('provider'),
});
state.topics = pgTable('topics', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  workspaceId: text('workspace_id'),
  model: text('model'),
  provider: text('provider'),
  metadata: jsonb('metadata'),
  isDeleted: boolean('is_deleted'),
  updatedAt: timestamp('updated_at'),
});
const pg = new PGlite();
after(async () => {
  await pg.close();
  delete globalThis.bridgeRegression;
});
state.db = drizzle(pg);
await pg.exec(
  'CREATE TABLE agents (id text PRIMARY KEY,user_id text,workspace_id text,model text,provider text); CREATE TABLE topics (id text PRIMARY KEY,model text,provider text,user_id text,workspace_id text,metadata jsonb,is_deleted boolean,updated_at timestamp);',
);
const { bootstrapBridgeUser } = await import(
  pathToFileURL(path.join(bridgeDir, 'bootstrap.ts')).href
);
const { bridgeGroupProvider } = await import(pathToFileURL(path.join(bridgeDir, 'groups.ts')).href);
const { repairBridgeAgentDefaults } = await import(
  pathToFileURL(path.join(bridgeDir, 'repairAgentDefaults.ts')).href
);
const { bridgeSelectionRepair } = await import(
  pathToFileURL(path.join(bridgeDir, 'selection.ts')).href
);
const { getUserScopedAiProviderRuntimeState } = await import(
  pathToFileURL(path.join(root, 'apps/server/src/services/aiProviderAccess.ts')).href
);
const { params: newApiParams } = await import(
  pathToFileURL(path.join(root, 'packages/model-runtime/src/providers/newapi/index.ts')).href
);
const fallback = { model: 'allowed', provider: bridgeGroupProvider('default') };

beforeEach(async () => {
  await pg.exec('DELETE FROM agents; DELETE FROM topics;');
  Object.assign(state, {
    settings: {},
    updates: [],
    groups: { default_group: 'default', groups: {} },
    models: {},
    pending: [],
    active: 0,
    peak: 0,
    calls: [],
    modelError: false,
    groupError: false,
    identity: {
      userId: 'user',
      sub: '42',
      credential: Math.random().toString(),
      expires_at: Math.floor(Date.now() / 1000) + 600,
    },
  });
});

async function settleCatalogs(promise) {
  let finished = false;
  promise
    .finally(() => {
      finished = true;
    })
    .catch(() => {});
  for (let i = 0; i < 200 && !finished; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    for (const resolve of state.pending.splice(0)) resolve();
  }
  return promise;
}

test('repairs foreign defaults without changing topics, valid groups, other users or workspaces', async () => {
  await state.db.insert(state.agents).values([
    { id: 'foreign', userId: 'user', model: 'gm5.2', provider: 'openai' },
    { id: 'valid', userId: 'user', model: 'keep', provider: bridgeGroupProvider('premium') },
    { id: 'legacy', userId: 'user', model: 'keep-legacy', provider: 'newapi' },
    { id: 'other', userId: 'other', model: 'other-model', provider: 'openai' },
    {
      id: 'workspace',
      userId: 'user',
      workspaceId: 'team',
      model: 'team-model',
      provider: 'openai',
    },
  ]);
  await pg.exec(
    "INSERT INTO topics (id,model,provider) VALUES ('existing','topic-model','topic-provider');",
  );
  await repairBridgeAgentDefaults(state.db, 'user', fallback);
  const rows = await state.db.select().from(state.agents);
  assert.deepEqual(
    rows.find((r) => r.id === 'foreign'),
    { id: 'foreign', userId: 'user', workspaceId: null, ...fallback },
  );
  assert.equal(rows.find((r) => r.id === 'valid').model, 'keep');
  assert.equal(rows.find((r) => r.id === 'legacy').model, 'keep-legacy');
  assert.equal(rows.find((r) => r.id === 'other').model, 'other-model');
  assert.equal(rows.find((r) => r.id === 'workspace').model, 'team-model');
  assert.deepEqual((await pg.query('SELECT id,model,provider FROM topics')).rows, [
    { id: 'existing', model: 'topic-model', provider: 'topic-provider' },
  ]);
});

test('does not repair a selection to an invalid fallback', () => {
  assert.equal(
    bridgeSelectionRepair(
      { provider: 'openai', model: 'gm5.2' },
      { provider: 'openai', model: 'old' },
    ),
    undefined,
  );
});

test('managed catalog loading skips public pricing while standalone New API retains enrichment', async () => {
  const previousFetch = globalThis.fetch;
  const previousSecret = process.env.NEW_API_CHAT_BRIDGE_SECRET;
  let pricingRequests = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/api/lobe/models')
      return Response.json({
        success: true,
        data: [{ id: 'allowed', type: 'chat', vision: true }],
      });
    pricingRequests++;
    return Response.json({ success: true, data: [{ model_name: 'public-only' }] });
  };
  const client = {
    apiKey: 'test',
    baseURL: 'https://newapi.example/v1',
    models: { list: async () => ({ data: [{ id: 'allowed' }] }) },
  };
  try {
    process.env.NEW_API_CHAT_BRIDGE_SECRET = 'managed-test';
    assert.deepEqual(
      (await newApiParams.models({ client })).map((m) => m.id),
      ['allowed'],
    );
    assert.equal(pricingRequests, 0);
    delete process.env.NEW_API_CHAT_BRIDGE_SECRET;
    assert.deepEqual(
      (await newApiParams.models({ client })).map((m) => m.id),
      ['allowed', 'public-only'],
    );
    assert.equal(pricingRequests, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.NEW_API_CHAT_BRIDGE_SECRET;
    else process.env.NEW_API_CHAT_BRIDGE_SECRET = previousSecret;
  }
});

test('an account with no authorized chat models is not assigned an invented fallback', async () => {
  await state.db
    .insert(state.agents)
    .values({ id: 'broken', userId: 'user', model: 'old', provider: 'openai' });
  await bootstrapBridgeUser(state.db, { userId: 'user' }, false);
  assert.equal(state.updates.length, 0);
  assert.equal((await state.db.select().from(state.agents))[0].provider, 'openai');
});

test('login does not query any model catalogs', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 }, premium: { desc: '', ratio: 1 } };
  await bootstrapBridgeUser(state.db, state.identity, false);
  assert.deepEqual(state.calls, []);
  assert.equal(state.updates.length, 0);
});

const { getBridgeGroupCatalog } = await import(
  pathToFileURL(path.join(bridgeDir, 'catalog.ts')).href
);
const { resolveBridgeSelection } = await import(
  pathToFileURL(path.join(bridgeDir, 'resolveSelection.ts')).href
);

test('first catalog read loads default group only and repeat reads avoid model requests and repair writes', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 }, premium: { desc: '', ratio: 1 } };
  state.models = {
    default: [{ id: 'allowed', type: 'chat' }],
    premium: [{ id: 'premium', type: 'chat' }],
  };
  await state.db
    .insert(state.agents)
    .values({ id: 'broken', userId: 'user', provider: 'zhipu', model: 'glm-5.2' });
  const first = await settleCatalogs(
    getUserScopedAiProviderRuntimeState('user', async () => {
      throw Error('Legacy database catalog must not load');
    }),
  );
  assert.deepEqual(state.calls, ['default']);
  assert.equal(first.enabledChatAiProviders.length, 3);
  assert.equal(
    first.enabledAiModels.some((m) => m.id === 'premium'),
    false,
  );
  assert.equal((await state.db.select().from(state.agents))[0].provider, fallback.provider);
  assert.equal(state.settings.defaultAgent.newApiDefaultsVersion, 1);
  const writes = state.updates.length;
  await settleCatalogs(
    getUserScopedAiProviderRuntimeState('user', async () => {
      throw Error('unexpected');
    }),
  );
  assert.deepEqual(state.calls, ['default']);
  assert.equal(state.updates.length, writes);
});

test('group browsing loads only that group and reuses its in-flight request', async () => {
  state.models = { premium: [{ id: 'premium', type: 'chat' }] };
  const one = getBridgeGroupCatalog(state.identity, 'premium');
  const two = getBridgeGroupCatalog(state.identity, 'premium');
  assert.equal(one, two);
  assert.equal((await settleCatalogs(one))[0].id, 'premium');
  assert.deepEqual(state.calls, ['premium']);
});

test('a valid topic group is checked directly without waiting for another group', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 }, premium: { desc: '', ratio: 1 } };
  state.models = { premium: [{ id: 'premium', type: 'chat' }] };
  const selected = { provider: bridgeGroupProvider('premium'), model: 'premium' };
  assert.deepEqual(await settleCatalogs(resolveBridgeSelection(state.identity, selected)), {
    ...selected,
    changed: false,
    groupName: 'premium',
    vision: false,
  });
  assert.deepEqual(state.calls, ['premium']);
});

test('removed model or revoked group falls back to default group', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 } };
  state.models = { default: [{ id: 'allowed', type: 'chat' }] };
  const result = await settleCatalogs(
    resolveBridgeSelection(state.identity, {
      model: 'removed',
      provider: bridgeGroupProvider('revoked'),
    }),
  );
  assert.deepEqual(result, { ...fallback, changed: true, groupName: 'default', vision: false });
});

test('empty default falls back deterministically to next authorized chat group', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 }, premium: { desc: '', ratio: 1 } };
  state.models = { default: [], premium: [{ id: 'premium', type: 'chat' }] };
  const result = await settleCatalogs(
    resolveBridgeSelection(state.identity, { model: 'removed', provider: 'newapi' }),
  );
  assert.equal(result.provider, bridgeGroupProvider('premium'));
  assert.deepEqual(state.calls, ['default', 'premium']);
});

test('a default group containing only non-chat models falls back to an authorized chat group', async () => {
  state.groups.groups = { default: {desc:'',ratio:1}, premium:{desc:'',ratio:1} };
  state.models = { default:[{id:'text-embedding-3-small',type:'embedding'},{id:'tts-1',type:'tts'}], premium:[{id:'chat',type:'chat'}] };
  const result = await settleCatalogs(resolveBridgeSelection(state.identity,{model:'old',provider:'newapi'},true));
  assert.equal(result.model,'chat');
  assert.equal(result.provider,bridgeGroupProvider('premium'));
});

test('new conversations use ordered authorized defaults while existing selections remain pinned', async () => {
  state.groups = {
    default_group: 'default',
    groups: { default: { desc: '', ratio: 1 }, premium: { desc: '', ratio: 1 } },
    default_candidates: [
      { group: 'forbidden', model: 'secret' },
      { group: 'premium', model: 'missing' },
      { group: 'premium', model: 'preferred' },
    ],
  };
  state.models = {
    default: [{ id: 'old', type: 'chat' }],
    premium: [{ id: 'preferred', type: 'chat', vision: true }],
  };
  const selected = { model: 'old', provider: bridgeGroupProvider('default') };
  const existing = await settleCatalogs(resolveBridgeSelection(state.identity, selected));
  assert.equal(existing.model, 'old');
  assert.equal(existing.changed, false);
  state.calls = [];
  const fresh = await settleCatalogs(resolveBridgeSelection(state.identity, selected, true));
  assert.equal(fresh.model, 'preferred');
  assert.equal(fresh.provider, bridgeGroupProvider('premium'));
  assert.equal(fresh.vision, true);
  assert.deepEqual(state.calls, ['premium']);
  state.groups.default_candidates = [{ group: 'default', model: 'old' }];
  assert.equal(
    (await settleCatalogs(resolveBridgeSelection(state.identity, fresh, true))).model,
    'old',
  );
});

const { enforceBridgeModelPolicy } = await import(
  pathToFileURL(path.join(bridgeDir, 'modelPolicy.ts')).href
);
test('send-time vision policy strips historical images without mutating stored messages', async () => {
  state.groups.default_group = 'default';
  state.models.default = [{ id: 'chat', vision: false }];
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'keep' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    },
    { role: 'assistant', content: 'history' },
  ];
  const snapshot = structuredClone(messages);
  const filtered = await enforceBridgeModelPolicy(state.identity, 'default', 'chat', messages);
  assert.deepEqual(messages, snapshot);
  assert.deepEqual(filtered[0].content, [{ type: 'text', text: 'keep' }]);
  state.models.default[0].vision = true;
  assert.deepEqual(
    await enforceBridgeModelPolicy(state.identity, 'default', 'chat', messages),
    snapshot,
  );
  state.models.default = [];
  await assert.rejects(
    enforceBridgeModelPolicy(state.identity, 'default', 'chat', messages),
    /unavailable/,
  );
});

test('network errors do not become unavailable selections and failed catalogs can retry', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 } };
  state.modelError = true;
  await assert.rejects(
    settleCatalogs(resolveBridgeSelection(state.identity, { model: 'old', provider: 'newapi' })),
    /Network timeout/,
  );
  assert.equal(state.updates.length, 0);
  state.modelError = false;
  state.models = { default: [{ id: 'old', type: 'chat' }] };
  const result = await settleCatalogs(
    resolveBridgeSelection(state.identity, { model: 'old', provider: 'newapi' }),
  );
  assert.equal(result.changed, false);
});

test('no available models rejects instead of inventing a selection', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 } };
  await assert.rejects(
    settleCatalogs(resolveBridgeSelection(state.identity, { model: 'old', provider: 'newapi' })),
    /No authorized/,
  );
});

test('display cache never grants selection authority after a model is revoked', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 } };
  state.models = { default: [{ id: 'old', type: 'chat' }] };
  await settleCatalogs(getBridgeGroupCatalog(state.identity, 'default'));
  state.models = { default: [{ id: 'allowed', type: 'chat' }] };
  const result = await settleCatalogs(
    resolveBridgeSelection(state.identity, { model: 'old', provider: 'newapi' }),
  );
  assert.equal(result.model, 'allowed');
  assert.equal(result.changed, true);
});

const { recoverBridgeTopic } = await import(
  pathToFileURL(path.join(bridgeDir, 'recoverTopic.ts')).href
);
const { getLoadedBridgeCatalogs } = await import(
  pathToFileURL(path.join(bridgeDir, 'catalog.ts')).href
);

test('expired display metadata does not remove current model capabilities', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 }, premium: { desc: '', ratio: 1 } };
  state.models = { premium: [{ id: 'premium', type: 'chat' }] };
  await settleCatalogs(getBridgeGroupCatalog(state.identity, 'premium'));
  const realNow = Date.now;
  Date.now = () => realNow() + 31_000;
  try {
    const loaded = await getLoadedBridgeCatalogs(state.identity, state.groups);
    assert.equal(loaded.get('premium')[0].id, 'premium');
  } finally {
    Date.now = realNow;
  }
});

test('topic fallback compares the old selection, removes obsolete reasoning and preserves unrelated metadata', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 } };
  state.models = { default: [{ id: 'allowed', type: 'chat' }] };
  await state.db.insert(state.topics).values({
    id: 'topic',
    userId: 'user',
    model: 'old',
    provider: 'newapi',
    metadata: { reasoningConfig: { old: true }, summary: 'Keep this' },
  });
  const result = await settleCatalogs(
    recoverBridgeTopic(state.db, state.identity, {
      topicId: 'topic',
      model: 'old',
      provider: 'newapi',
      expectedModel: 'old',
      expectedProvider: 'newapi',
    }),
  );
  assert.equal(result.topic.model, 'allowed');
  assert.deepEqual(result.topic.metadata, { summary: 'Keep this' });
  await assert.rejects(
    settleCatalogs(
      recoverBridgeTopic(state.db, state.identity, {
        topicId: 'topic',
        model: 'old',
        provider: 'newapi',
        expectedModel: 'old',
        expectedProvider: 'newapi',
      }),
    ),
    (error) => error.code === 'CONFLICT',
  );
  assert.equal((await state.db.select().from(state.topics))[0].model, 'allowed');
});

test('recovery cannot write another user or workspace topic', async () => {
  state.groups.groups = { default: { desc: '', ratio: 1 } };
  state.models = { default: [{ id: 'allowed', type: 'chat' }] };
  await state.db.insert(state.topics).values([
    { id: 'other', userId: 'other', model: 'old', provider: 'newapi' },
    { id: 'team', userId: 'user', workspaceId: 'team', model: 'old', provider: 'newapi' },
  ]);
  for (const topicId of ['other', 'team'])
    await assert.rejects(
      settleCatalogs(
        recoverBridgeTopic(state.db, state.identity, {
          topicId,
          model: 'old',
          provider: 'newapi',
          expectedModel: 'old',
          expectedProvider: 'newapi',
        }),
      ),
      (error) => error.code === 'NOT_FOUND',
    );
});
