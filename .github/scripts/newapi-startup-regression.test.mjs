import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(
  path.join(process.env.BRIDGE_TEST_DEPENDENCIES || root, 'package.json'),
);
const moduleURL = (name) => pathToFileURL(require.resolve(name)).href;
const sdkURLs = Object.fromEntries(
  ['@upstash/qstash', '@upstash/workflow'].map((name) => [name, moduleURL(name)]),
);
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      '@lobechat/observability-otel/modules/upstash-workflow':
        'export const recordUpstashWorkflowEvent=()=>{};',
      '@lobechat/utils': 'export const errorNameFrom=e=>e?.name;',
      debug: 'export default ()=>()=>{};',
    };
    if (specifier in mocks)
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`,
      };
    if (
      (specifier === '@upstash/qstash' || specifier === '@upstash/workflow') &&
      context.parentURL?.includes('/src/libs/qstash/')
    )
      return next(sdkURLs[specifier], context);
    if (specifier === './deduplicationId' && context.parentURL?.includes('/qstash/index.ts'))
      return next(new URL('./deduplicationId.ts', context.parentURL).href, context);
    return next(specifier, context);
  },
});

test('New API startup skips the blocked bot gateway while other deployments retain startup', async () => {
  const source = await readFile(path.join(root, 'scripts/serverLauncher/startServer.js'), 'utf8');
  for (const newApi of [true, false]) {
    const requests = [];
    const commands = [];
    const modules = {
      'node:child_process': {
        spawn: (...args) => {
          commands.push(args);
          const child = new EventEmitter();
          queueMicrotask(() => child.emit('close', 0));
          return child;
        },
      },
      'node:dns': { promises: { getServers: () => [] } },
      'node:fs': { existsSync: () => true },
      'node:fs/promises': {},
      'node:path': path,
    };
    await vm.runInNewContext(source, {
      __dirname: '/app',
      console: { log() {}, warn() {}, error() {} },
      process: {
        env: {
          KEY_VAULTS_SECRET: 'test-only',
          ...(newApi && { NEW_API_CHAT_BRIDGE_SECRET: 'test-bridge' }),
        },
      },
      fetch: async (url) => {
        requests.push(url);
        return { ok: true };
      },
      require: (name) => modules[name] ?? { checkDeprecatedAuth() {}, checkGatewayConfig() {} },
    });
    assert.equal(requests.length, newApi ? 0 : 1);
    if (!newApi) assert.equal(requests[0], 'http://localhost:3210/api/agent/gateway/start');
    assert.equal(commands.length, 1);
  }
});

test('optional QStash imports are quiet, missing configuration fails on use, configured clients publish', async () => {
  const saved = { token: process.env.QSTASH_TOKEN, url: process.env.QSTASH_URL };
  const warnings = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ authorization: req.headers.authorization, url: req.url, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messageId: 'test-message', deduplicated: false }));
  });
  try {
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_URL;
    const capture = (...args) => {
      if (String(args[0]).includes('[MODULE_TYPELESS_PACKAGE_JSON]')) return;
      warnings.push(args);
    };
    console.warn = capture;
    console.error = capture;
    const { qstashClient, workflowClient, verifyQStashSignature } = await import(
      pathToFileURL(path.join(root, 'src/libs/qstash/index.ts')).href
    );
    assert.deepEqual(warnings, [], 'importing optional workflows must not initialize Upstash SDKs');
    assert.equal(await verifyQStashSignature(new Request('http://localhost'), '{}'), false);
    assert.throws(
      () => qstashClient.publishJSON({ url: 'http://example.test', body: {} }),
      /QSTASH_TOKEN/,
    );
    assert.throws(
      () => workflowClient.trigger({ url: 'http://example.test', body: {} }),
      /QSTASH_TOKEN/,
    );

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.QSTASH_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.QSTASH_TOKEN = 'test-configured-token';
    assert.equal(
      (await qstashClient.publishJSON({ url: 'https://example.test/callback', body: { ok: true } }))
        .messageId,
      'test-message',
    );
    assert.equal(
      typeof (await workflowClient.trigger({ url: 'https://example.test/workflow', body: {} }))
        .workflowRunId,
      'string',
    );
    assert.equal(requests.length, 2);
    assert.ok(
      requests.every((request) => request.authorization === 'Bearer test-configured-token'),
    );
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    for (const [key, value] of Object.entries({
      QSTASH_TOKEN: saved.token,
      QSTASH_URL: saved.url,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
