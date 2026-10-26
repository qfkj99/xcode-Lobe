const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = '/app';
const store = path.join(root, 'node_modules/.pnpm');
const peer = path.join(root, '.integration-peers/node_modules/zod-openapi');
const peerManifest = JSON.parse(fs.readFileSync(path.join(peer, 'package.json'), 'utf8'));
if (peerManifest.version !== '4.2.4') throw new Error('Unexpected converter peer version');
let linked = 0;
for (const entry of fs.readdirSync(store)) {
  if (!entry.startsWith('@standard-community+standard-openapi@0.2.11_')) continue;
  const nodeModules = path.join(store, entry, 'node_modules');
  const destination = path.join(nodeModules, 'zod-openapi');
  if (!fs.existsSync(destination)) fs.symlinkSync(path.relative(nodeModules, peer), destination, 'dir');
  const converterRequire = createRequire(path.join(nodeModules, '@standard-community/standard-openapi/package.json'));
  converterRequire('zod-openapi');
  linked += 1;
}
if (!linked) throw new Error('Expected standard-openapi converter was not installed');
const requirePeer = createRequire(path.join(peer, 'package.json'));
const { z } = requirePeer('zod');
const { createSchema } = requirePeer('zod-openapi');
if (createSchema(z.object({ id: z.string() })).schema.type !== 'object') throw new Error('Converter smoke test failed');
console.log(`Verified pinned zod-openapi v4 converter for ${linked} standard-openapi package instance(s)`);
