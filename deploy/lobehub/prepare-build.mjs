#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const [sourceArg, runtimeArg, corepackVersion] = process.argv.slice(2)
if (!sourceArg || !runtimeArg || !/^\d+\.\d+\.\d+$/.test(corepackVersion || '')) throw new Error('Usage: node prepare-build.mjs <lobehub-checkout> <runtime-directory> <corepack-version>')
const source = path.resolve(sourceArg)
const runtime = path.resolve(runtimeArg)
if (!fs.existsSync(path.join(runtime, 'ownership-manifest.json'))) throw new Error('Runtime ownership manifest required')
const nodeImage = 'node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205'
const busyboxImage = 'busybox@sha256:fd7dc98638c8e305f4dc34e979f1c0fdfdcaeb0fbf8fcff77ae834b6da3d7e6e'
let dockerfile = fs.readFileSync(path.join(source, 'Dockerfile'), 'utf8').replaceAll('\r\n', '\n')
dockerfile = dockerfile.replace('FROM node:${NODEJS_VERSION}-slim AS base', `FROM ${nodeImage} AS base`)
dockerfile = dockerfile.replace('npm i -g corepack@latest', `npm i -g corepack@${corepackVersion}`)
dockerfile = dockerfile.replace('FROM busybox:latest AS app', `FROM ${busyboxImage} AS app`)
const lockDirectory = path.join(import.meta.dirname, 'dependencies')
const locked = fs.existsSync(path.join(lockDirectory, 'pnpm-lock.yaml'))
if (!locked) throw new Error('Committed dependency lockfiles required')
const pins = JSON.parse(fs.readFileSync(path.join(lockDirectory, 'build-pins.json'), 'utf8'))
if (corepackVersion !== pins.corepack) throw new Error('Corepack version differs from reviewed build pins')
for (const [filename, expected] of Object.entries(pins.hashes)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(lockDirectory, filename), 'utf8').replaceAll('\r\n', '\n')).digest('hex')
  if (actual !== expected) throw new Error(`Dependency file checksum changed: ${filename}`)
}
if (locked) {
  const insertion = '# @neondatabase/serverless is required'
  if (!dockerfile.includes(insertion)) throw new Error('Upstream dependency marker changed')
  dockerfile = dockerfile.replace(insertion, [
    'COPY --from=integration dependencies/pnpm-lock.yaml /app/pnpm-lock.yaml',
    'COPY --from=integration dependencies/runtime-package.json /deps/package.json',
    'COPY --from=integration dependencies/runtime-pnpm-lock.yaml /deps/pnpm-lock.yaml',
    'COPY --from=integration prepare-dependency-config.cjs /tmp/prepare-dependency-config.cjs',
    'ENV PNPM_CONFIG_PM_ON_FAIL=ignore',
    'RUN node /tmp/prepare-dependency-config.cjs',
    '', insertion,
  ].join('\n'))
  dockerfile = dockerfile.replace(/corepack use \$\(sed -n .*?package\.json\)/, 'corepack install')
  dockerfile = dockerfile.replace('pnpm i &&', `test "$(pnpm --version)" = "${pins.rootPnpm}" && pnpm i --frozen-lockfile &&`)
  dockerfile = dockerfile.replace("    echo '{\"name\":\"deps\",\"private\":true}' > package.json && \\\n    pnpm add pg drizzle-orm @neondatabase/serverless", '    corepack install && \\\n    pnpm i --frozen-lockfile')
  if (dockerfile.includes('pnpm add pg') || dockerfile.includes('corepack use')) throw new Error('Unpinned install remained after Dockerfile transformation')
}
const split = dockerfile.indexOf('\nCOPY . .\n')
if (split < 0 || !dockerfile.includes(locked ? 'pnpm i --frozen-lockfile &&' : 'pnpm i &&')) throw new Error('Upstream Dockerfile layout changed; review before building')
const converter = [
  '',
  'COPY --from=integration dependencies/converter-package.json /app/.integration-peers/package.json',
  'COPY --from=integration dependencies/converter-package-lock.json /app/.integration-peers/package-lock.json',
  'COPY --from=integration link-converter-peer.cjs /tmp/link-converter-peer.cjs',
  'RUN npm --prefix /app/.integration-peers ci --ignore-scripts --no-audit --no-fund && node /tmp/link-converter-peer.cjs',
  '',
].join('\n')
const dependencies = dockerfile.slice(0, split) + converter
const dependencyImage = 'lobehub:newapi-v2.2.20-dependencies-locked-d7c2'
const reuse = process.argv.includes('--reuse-dependencies')
const frozenSource = [
  'COPY . .',
  'ENV PNPM_CONFIG_PM_ON_FAIL=ignore PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=error',
  'COPY --from=integration dependencies/pnpm-lock.yaml /app/pnpm-lock.yaml',
  'COPY --from=integration prepare-dependency-config.cjs /tmp/prepare-dependency-config.cjs',
  'COPY --from=integration verify-dependencies.cjs /tmp/verify-dependencies.cjs',
  'COPY --from=integration freeze-workspace.cjs /tmp/freeze-workspace.cjs',
  `RUN node /tmp/prepare-dependency-config.cjs && node /tmp/freeze-workspace.cjs && test "$(pnpm --version)" = "${pins.rootPnpm}" && CI=true pnpm install --offline --frozen-lockfile --ignore-scripts && node /tmp/verify-dependencies.cjs && node /tmp/link-converter-peer.cjs`,
].join('\n')
const applicationStages = dockerfile.slice(split).replace('COPY . .', frozenSource)
const appDockerfile = reuse
  ? `FROM ${dependencyImage} AS base\nFROM ${dependencyImage} AS builder\nWORKDIR /app\n` + converter + applicationStages
  : dependencies + applicationStages
fs.writeFileSync(path.join(runtime, 'Dockerfile.dependencies'), dependencies)
fs.writeFileSync(path.join(runtime, 'Dockerfile.lobehub'), appDockerfile)
console.log(JSON.stringify({ source, runtime, dependencyImage, nodeImage, busyboxImage, corepackVersion, lockedDependencies: locked, reuseDependencies: reuse, integrationBuildContext: import.meta.dirname }, null, 2))
