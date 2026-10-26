import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

for (const reuse of [false, true]) {
  test(`generated ${reuse ? 'cached' : 'full'} build restores frozen dependencies after source copy`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lobe-build-test-'))
    try {
      const source = path.join(root, 'source')
      const runtime = path.join(root, 'runtime')
      fs.mkdirSync(source)
      fs.mkdirSync(runtime)
      fs.writeFileSync(path.join(runtime, 'ownership-manifest.json'), '{}')
      fs.writeFileSync(path.join(source, 'Dockerfile'), [
        'FROM node:${NODEJS_VERSION}-slim AS base',
        '# @neondatabase/serverless is required',
        'RUN npm i -g corepack@latest && pnpm i && true',
        '', 'COPY . .', '',
        'RUN pnpm exec tsx scripts/dockerPrebuild.mts',
        'FROM busybox:latest AS app', '',
      ].join('\n'))
      const args = [path.join(import.meta.dirname, 'prepare-build.mjs'), source, runtime, '0.36.0']
      if (reuse) args.push('--reuse-dependencies')
      const result = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }))
      const generated = fs.readFileSync(path.join(runtime, 'Dockerfile.lobehub'), 'utf8')
      assert.equal(result.reuseDependencies, reuse)
      const copiedSource = generated.indexOf('COPY . .')
      const compile = generated.indexOf('RUN pnpm exec tsx')
      assert.ok(copiedSource >= 0 && compile > copiedSource)
      const preparation = generated.slice(copiedSource, compile)
      assert.ok(preparation.includes('COPY --from=integration dependencies/pnpm-lock.yaml /app/pnpm-lock.yaml'))
      assert.ok(preparation.includes('node /tmp/prepare-dependency-config.cjs'))
      assert.ok(preparation.includes('node /tmp/freeze-workspace.cjs'))
      assert.match(preparation, /pnpm install --offline --frozen-lockfile --ignore-scripts/)
      assert.ok(preparation.includes('test "$(pnpm --version)" = "12.4.1"'))
      assert.ok(preparation.includes('PNPM_CONFIG_PM_ON_FAIL=ignore PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=error'))
      assert.ok(preparation.includes('node /tmp/verify-dependencies.cjs'))
      assert.ok(preparation.includes('node /tmp/link-converter-peer.cjs'))
      assert.doesNotMatch(generated, /corepack@latest|pnpm i &&|pnpm add pg/)
      if (reuse) assert.match(generated, /^FROM lobehub:newapi-v2.2.20-dependencies-locked-d7c2 AS base/)
      else assert.match(generated, /pnpm i --frozen-lockfile &&/)
    } finally {
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
      assert.ok(path.basename(root).startsWith('lobe-build-test-'))
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}
