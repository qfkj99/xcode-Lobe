import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, test } from 'node:test';
import vm from 'node:vm';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server') return { shortCircuit: true, url: 'test:next' };
    if (specifier === './security' && context.parentURL?.includes('/newApiBridge/'))
      return { shortCircuit: true, url: new URL('./security.ts', context.parentURL).href };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:next') return { shortCircuit: true, format: 'module', source: `
      export class NextResponse extends Response {
        cookies = {set: (name,value,options)=>{this.cookieWrites ??= [];this.cookieWrites.push({name,value,options});}};
      }` };
    return next(url, context);
  },
});
const security = await import('../../apps/server/src/services/newApiBridge/security.ts');
const { bridgePage } = await import('../../apps/server/src/services/newApiBridge/bridgePage.ts');
const original = { ...process.env };
beforeEach(() => {
  process.env.NEW_API_CHAT_BRIDGE_SECRET = 'b'.repeat(40);
  process.env.AUTH_SECRET = 'a'.repeat(40);
  process.env.NEW_API_PUBLIC_URL = 'https://old.example';
  process.env.NEW_API_INTERNAL_URL = 'http://gateway:3000';
  process.env.APP_URL = 'https://chat.old.example';
  process.env.NEW_API_ADDITIONAL_PARENT_ORIGINS = 'https://new.example';
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});

test('configured parent origins are canonical, deduplicated and exact', () => {
  process.env.NEW_API_ADDITIONAL_PARENT_ORIGINS = 'https://NEW.example/,https://new.example\nhttps://dev.example:8443';
  assert.deepEqual(security.bridgeConfig().parentOrigins, ['https://old.example', 'https://new.example', 'https://dev.example:8443']);
});

test('unsafe parent configuration fails closed', () => {
  for (const origin of ['*', 'https://*.example', 'https://user:pass@new.example', 'https://new.example/path', 'https://new.example?x=1', 'https://new.example#x', 'null', 'javascript:alert(1)']) {
    process.env.NEW_API_ADDITIONAL_PARENT_ORIGINS = origin;
    assert.throws(() => security.bridgeConfig(), undefined, origin);
  }
});

test('HTTPS bridge cookies work cross-site and remain partitioned and httpOnly', () => {
  assert.notEqual(security.BRIDGE_COOKIE, 'newapi.bridge');
  assert.notEqual(security.FLOW_COOKIE, 'newapi.flow');
  const cookie = security.bridgeCookieOptions(120);
  assert.equal(cookie.sameSite, 'none');
  assert.equal(cookie.secure, true);
  assert.equal(cookie.partitioned, true);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.maxAge, 120);
  assert.equal(security.bridgeCookieOptions(0).partitioned, true);
  assert.deepEqual(security.bridgeAuthCookieAttributes(), { httpOnly: true, sameSite: 'none', secure: true, partitioned: true });
});

test('HTTP development and ordinary deployments retain their cookie behavior', () => {
  process.env.APP_URL = 'http://localhost:3210';
  assert.equal(security.bridgeCookieOptions(120).sameSite, 'lax');
  assert.equal(security.bridgeCookieOptions(120).secure, false);
  assert.equal(security.bridgeCookieOptions(120).partitioned, undefined);
  delete process.env.NEW_API_CHAT_BRIDGE_SECRET;
  assert.deepEqual(security.bridgeAuthCookieAttributes(), {});
});

async function browserHarness() {
  const response = bridgePage();
  const html = await response.text();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const messages = [], requests = [], navigations = [];
  const parent = { postMessage: (message, origin) => messages.push({ message, origin }) };
  let handler;
  vm.runInNewContext(script, {
    parent,
    addEventListener: (type, callback) => { if (type === 'message') handler = callback; },
    performance: { now: () => 1, timeOrigin: 1, measure() {} },
    sessionStorage: { setItem() {} },
    location: { replace: (url) => navigations.push(url) },
    fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({ success: true }) }; },
  });
  return { response, messages, requests, navigations, parent, send: (origin, source = parent) => handler({ origin, source, data: { type: 'newapi:launch', ticket: 'test-ticket' } }) };
}

test('both configured parents can complete the real generated handshake script', async () => {
  for (const origin of ['https://old.example', 'https://new.example']) {
    const b = await browserHarness();
    assert.equal(b.response.headers.get('content-security-policy').split('frame-ancestors ')[1], 'https://old.example https://new.example');
    assert.deepEqual(b.messages.map((m) => m.origin).sort(), ['https://new.example', 'https://old.example']);
    assert.ok(b.messages.every((m) => m.message.type === 'newapi:ready' && m.origin !== '*'));
    await b.send(origin);
    assert.equal(b.requests.length, 1);
    assert.equal(b.requests[0].url, '/newapi/bridge/complete');
    assert.equal(b.messages.at(-1).origin, origin);
    assert.equal(b.messages.at(-1).message.type, 'newapi:authenticated');
    assert.deepEqual(b.navigations, ['/agent/inbox']);
    await b.send(origin);
    assert.equal(b.requests.length, 1, 'duplicate launch cannot exchange twice');
  }
});

test('untrusted origins, suffix tricks and sibling frames cannot launch', async () => {
  const b = await browserHarness();
  for (const origin of ['https://attacker.example', 'https://new.example.attacker.test', 'http://new.example', 'null']) await b.send(origin);
  await b.send('https://new.example', {});
  assert.equal(b.requests.length, 0);
  assert.equal(b.navigations.length, 0);
});

test('removing the old primary does not change account identity encryption', () => {
  const identity = { sub: '42', userId: 'existing-user', credential: 'lobe_test', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const sealed = security.sealBridgeIdentity(identity);
  process.env.NEW_API_PUBLIC_URL = 'https://new.example';
  process.env.NEW_API_ADDITIONAL_PARENT_ORIGINS = '';
  assert.deepEqual(security.openBridgeIdentity(sealed), identity);
  assert.deepEqual(security.bridgeConfig().parentOrigins, ['https://new.example']);
});
