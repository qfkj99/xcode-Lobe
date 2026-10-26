#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

if (process.argv.length !== 3) throw new Error('Usage: node init-runtime.mjs <new-runtime-directory>')
const runtime = path.resolve(process.argv[2])
if (fs.existsSync(runtime)) throw new Error('Runtime path already exists; choose a new directory. Existing manifests are never overwritten.')
if (!fs.existsSync(path.dirname(runtime))) throw new Error('Parent directory must already exist')
fs.mkdirSync(runtime, { mode: 0o700 })
const manifest = {
  task: `lobehub-deployment-${crypto.randomBytes(6).toString('hex')}`,
  createdBy: 'init-runtime.mjs',
  root: runtime,
  rootPreviouslyExisted: false,
  parentPreviouslyExisted: true,
  resources: [
    { path: 'ownership-manifest.json', kind: 'file', classification: 'persistent-handoff', purpose: 'Resource ownership record' },
    { path: 'Dockerfile.dependencies', kind: 'file', classification: 'persistent-handoff', purpose: 'Generated pinned dependency Dockerfile' },
    { path: 'Dockerfile.lobehub', kind: 'file', classification: 'persistent-handoff', purpose: 'Generated pinned application Dockerfile' },
  ],
  existingResourcesToPreserve: [],
  createdDockerResources: [],
  ownedAppCandidates: [],
}
fs.writeFileSync(path.join(runtime, 'ownership-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ runtime, manifestCreated: true, existingResourcesChanged: false }, null, 2))
