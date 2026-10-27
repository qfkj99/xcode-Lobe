import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')
const settings = {
  COMPOSE_PROJECT_NAME: 'xcode-lobe-contract-test',
  LOBE_IMAGE: 'xcode-lobe:contract-test',
  LOBE_PUBLIC_URL: 'https://chat.example.com',
  NEW_API_PUBLIC_URL: 'https://api.example.com',
  NEW_API_INTERNAL_URL: '',
  S3_ENDPOINT: 'https://files.example.com',
  NEW_API_CHAT_BRIDGE_SECRET: 'a'.repeat(64),
  POSTGRES_PASSWORD: 'b'.repeat(64),
  AUTH_SECRET: 'c'.repeat(64),
  KEY_VAULTS_SECRET: Buffer.alloc(32, 1).toString('base64'),
  S3_ACCESS_KEY_ID: 'lobehub',
  S3_SECRET_ACCESS_KEY: 'd'.repeat(64),
}
const env = { ...process.env, ...settings }

const config = (file, overrides = {}) => JSON.parse(execFileSync('docker', [
  'compose', '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null',
  '-f', file, 'config', '--format', 'json',
], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' }))

test('root Compose builds the frozen recipe and preserves standalone runtime contracts', () => {
  const actual = config('compose.yml')
  const previous = config('deploy/lobehub/compose.yml')
  assert.equal(actual.name, env.COMPOSE_PROJECT_NAME)
  assert.deepEqual(Object.keys(actual.services).sort(), Object.keys(previous.services).sort())
  const { build, pull_policy, ...lobe } = actual.services.lobe
  assert.equal(path.resolve(build.context), root)
  assert.equal(build.dockerfile, 'deploy/lobehub/Dockerfile')
  assert.equal(path.resolve(build.additional_contexts.integration), import.meta.dirname)
  assert.equal(pull_policy, 'build')
  assert.deepEqual(lobe, previous.services.lobe)
  for (const service of ['postgresql', 'redis', 'storage', 'storage-init']) {
    assert.deepEqual(actual.services[service], previous.services[service])
  }
  assert.deepEqual(actual.volumes, previous.volumes)
  assert.deepEqual(actual.networks, previous.networks)
  assert.equal(actual.services.lobe.environment.NEW_API_INTERNAL_URL, env.NEW_API_PUBLIC_URL)
  const initMount = actual.services['storage-init'].volumes[0]
  assert.equal(path.resolve(initMount.source), path.join(import.meta.dirname, 'init-storage.sh'))
  assert.equal(initMount.read_only, true)
  assert.equal(actual.services.lobe.ports[0].host_ip, '127.0.0.1')
  assert.equal(actual.services.storage.ports[0].host_ip, '127.0.0.1')
  assert.equal(actual.services.postgresql.ports, undefined)
  assert.equal(actual.services.redis.ports, undefined)
})

test('an explicit internal gateway address is preserved', () => {
  const actual = config('compose.yml', { NEW_API_INTERNAL_URL: 'http://gateway.internal:3000' })
  assert.equal(actual.services.lobe.environment.NEW_API_INTERNAL_URL, 'http://gateway.internal:3000')
})

test('root .env is loaded by include without exporting configuration in the shell', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lobe-compose-env-'))
  try {
    const deployment = path.join(temporary, 'deploy/lobehub')
    fs.mkdirSync(deployment, { recursive: true })
    fs.copyFileSync(path.join(root, 'compose.yml'), path.join(temporary, 'compose.yml'))
    for (const filename of ['compose.yml', 'compose.build.yml', 'init-storage.sh']) {
      fs.copyFileSync(path.join(import.meta.dirname, filename), path.join(deployment, filename))
    }
    const keys = Object.keys(settings).filter((key) => key !== 'NEW_API_INTERNAL_URL')
    fs.writeFileSync(path.join(temporary, '.env'), keys.map((key) => `${key}=${env[key]}`).join('\n'))
    const isolated = { ...process.env }
    for (const key of Object.keys(isolated)) {
      if (keys.includes(key) || key === 'NEW_API_INTERNAL_URL' || key.startsWith('COMPOSE_')) delete isolated[key]
    }
    const actual = JSON.parse(execFileSync('docker', ['compose', 'config', '--format', 'json'], {
      cwd: temporary, env: isolated, encoding: 'utf8',
    }))
    assert.equal(actual.name, env.COMPOSE_PROJECT_NAME)
    assert.equal(actual.services.lobe.environment.NEW_API_INTERNAL_URL, env.NEW_API_PUBLIC_URL)
    assert.equal(actual.services.lobe.environment.NEW_API_CHAT_BRIDGE_SECRET, env.NEW_API_CHAT_BRIDGE_SECRET)
    assert.equal(actual.services.postgresql.environment.POSTGRES_PASSWORD, env.POSTGRES_PASSWORD)
    assert.equal(path.resolve(actual.services.lobe.build.context), temporary)
    assert.equal(path.resolve(actual.services['storage-init'].volumes[0].source), path.join(deployment, 'init-storage.sh'))
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temporary).startsWith('lobe-compose-env-'))
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('setup Compose needs no application credentials and mounts only its checkout', () => {
  const isolated = { ...process.env }
  for (const key of Object.keys(isolated)) {
    if (key in settings || key.startsWith('COMPOSE_')) delete isolated[key]
  }
  const actual = JSON.parse(execFileSync('docker', [
    'compose', '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null',
    '-f', 'deploy/lobehub/compose.setup.yml', 'config', '--format', 'json',
  ], { cwd: root, env: isolated, encoding: 'utf8' }))
  assert.deepEqual(Object.keys(actual.services), ['setup'])
  const setup = actual.services.setup
  assert.match(setup.image, /^node:24-slim@sha256:[a-f0-9]{64}$/)
  assert.deepEqual(setup.command, ['node', 'deploy/lobehub/setup-env.mjs', '/workspace/.env'])
  assert.equal(setup.network_mode, 'none')
  assert.equal(setup.volumes.length, 1)
  assert.equal(path.resolve(setup.volumes[0].source), root)
  assert.equal(setup.volumes[0].target, '/workspace')
  assert.equal(setup.ports, undefined)
})

test('private environment files cannot enter the application build context', () => {
  const ignored = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split(/\r?\n/)
  for (const entry of ['**/.env', '**/.env.*', '**/*.env']) assert.ok(ignored.includes(entry))
  assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).includes('.env'))
})
