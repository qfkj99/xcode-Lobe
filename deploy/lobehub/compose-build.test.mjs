import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { syncComposeBuild } from './sync-compose-build.mjs'

test('committed Compose Dockerfile exactly matches the current full-build generator', () => {
  const generated = syncComposeBuild()
  assert.match(generated, /FROM node:24-slim@sha256:[a-f0-9]{64} AS base/)
  assert.match(generated, /FROM busybox@sha256:[a-f0-9]{64} AS app/)
  assert.doesNotMatch(generated, /FROM lobehub:newapi-|corepack@latest|pnpm i &&|pnpm add pg/)
  const copiedSource = generated.indexOf('COPY . .')
  const compile = generated.indexOf('RUN pnpm exec tsx scripts/dockerPrebuild.mts')
  assert.ok(copiedSource >= 0 && compile > copiedSource)
  assert.match(generated.slice(copiedSource, compile), /pnpm install --offline --frozen-lockfile --ignore-scripts/)
  assert.ok(generated.slice(copiedSource, compile).includes('node /tmp/verify-dependencies.cjs'))
  for (const match of generated.matchAll(/^COPY --from=integration (\S+) /gm)) {
    assert.ok(fs.existsSync(path.join(import.meta.dirname, match[1])), `Missing integration context input: ${match[1]}`)
  }
})

test('sync check rejects missing or drifted output without overwriting it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lobe-compose-sync-test-'))
  const target = path.join(directory, 'Dockerfile')
  try {
    assert.throws(() => syncComposeBuild({ target }), /missing or stale/)
    assert.equal(fs.existsSync(target), false)
    const expected = syncComposeBuild({ check: false, target })
    assert.equal(syncComposeBuild({ target }), expected)
    fs.appendFileSync(target, '\n# unreviewed drift\n')
    assert.throws(() => syncComposeBuild({ target }), /missing or stale/)
    assert.ok(fs.readFileSync(target, 'utf8').endsWith('# unreviewed drift\n'))
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('lobe-compose-sync-test-'))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
