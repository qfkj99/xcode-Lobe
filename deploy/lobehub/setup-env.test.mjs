import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setupEnv } from './setup-env.mjs'

const secretKeys = ['NEW_API_CHAT_BRIDGE_SECRET', 'POSTGRES_PASSWORD', 'AUTH_SECRET', 'S3_SECRET_ACCESS_KEY', 'KEY_VAULTS_SECRET']
const readConfig = (target) => Object.fromEntries(fs.readFileSync(target, 'utf8').trim().split('\n').map((line) => {
  const at = line.indexOf('=')
  return [line.slice(0, at), line.slice(at + 1)]
}))
const withDirectory = (run) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lobe-setup-env-test-'))
  try {
    return run(directory)
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('lobe-setup-env-test-'))
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('creates the complete private configuration with independent random secrets', () => withDirectory((directory) => {
  const target = path.join(directory, '.env')
  assert.equal(setupEnv(target), target)
  const config = readConfig(target)
  assert.deepEqual(Object.keys(config).sort(), [
    'COMPOSE_PROJECT_NAME', 'LOBE_IMAGE', 'LOBE_PUBLIC_URL', 'NEW_API_PUBLIC_URL', 'S3_ENDPOINT',
    'S3_ACCESS_KEY_ID', ...secretKeys,
  ].sort())
  assert.equal(config.COMPOSE_PROJECT_NAME, 'xcode-lobe')
  assert.equal(config.LOBE_IMAGE, 'xcode-lobe:local')
  assert.equal(config.LOBE_PUBLIC_URL, 'https://chat.example.com')
  assert.equal(config.NEW_API_PUBLIC_URL, 'https://api.example.com')
  assert.equal(config.S3_ENDPOINT, 'https://files.example.com')
  assert.equal(config.S3_ACCESS_KEY_ID, 'lobehub')
  for (const key of secretKeys.filter((key) => key !== 'KEY_VAULTS_SECRET')) {
    assert.ok(/^[a-f0-9]{64}$/.test(config[key]), `${key} must encode 32 random bytes as hex`)
  }
  assert.ok(/^[A-Za-z0-9+/]{43}=$/.test(config.KEY_VAULTS_SECRET))
  assert.equal(Buffer.from(config.KEY_VAULTS_SECRET, 'base64').length, 32)
  const bytes = secretKeys.map((key) => Buffer.from(config[key], key === 'KEY_VAULTS_SECRET' ? 'base64' : 'hex').toString('hex'))
  assert.equal(new Set(bytes).size, secretKeys.length)
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600)
}))

test('refuses an existing file without changing bytes', () => withDirectory((directory) => {
  const target = path.join(directory, '.env')
  setupEnv(target)
  const before = fs.readFileSync(target)
  assert.throws(() => setupEnv(target), /already exists/)
  assert.ok(before.equals(fs.readFileSync(target)))
}))

test('separate files receive different secrets', () => withDirectory((directory) => {
  const first = path.join(directory, 'first.env')
  const second = path.join(directory, 'second.env')
  setupEnv(first)
  setupEnv(second)
  const a = readConfig(first)
  const b = readConfig(second)
  for (const key of secretKeys) assert.ok(a[key] !== b[key], `${key} must differ between files`)
}))

test('refuses existing and dangling symlinks without writing their targets', (context) => withDirectory((directory) => {
  const existing = path.join(directory, 'existing')
  const missing = path.join(directory, 'missing')
  fs.writeFileSync(existing, 'unchanged')
  const links = [path.join(directory, 'existing.env'), path.join(directory, 'dangling.env')]
  try {
    fs.symlinkSync(existing, links[0], 'file')
    fs.symlinkSync(missing, links[1], 'file')
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      context.skip('Windows file-symlink privilege unavailable; run this test in the Node 24 Linux container')
      return
    }
    throw error
  }
  for (const link of links) {
    assert.throws(() => setupEnv(link), /already exists/)
    assert.ok(fs.lstatSync(link).isSymbolicLink())
  }
  assert.equal(fs.readFileSync(existing, 'utf8'), 'unchanged')
  assert.equal(fs.existsSync(missing), false)
}))

test('requires an existing parent and creates no directory tree', () => withDirectory((directory) => {
  const missing = path.join(directory, 'missing')
  assert.throws(() => setupEnv(path.join(missing, 'nested', '.env')), /Parent directory must already exist/)
  assert.equal(fs.existsSync(missing), false)
}))

test('CLI prints only the target and instructions, never secret values', () => withDirectory((directory) => {
  const target = path.join(directory, '.env')
  const command = spawnSync(process.execPath, [path.join(import.meta.dirname, 'setup-env.mjs'), target], { encoding: 'utf8' })
  assert.equal(command.status, 0)
  assert.ok(command.stdout.includes(target))
  assert.equal(command.stderr, '')
  const config = readConfig(target)
  for (const key of secretKeys) assert.ok(!command.stdout.includes(config[key]), `${key} must not be printed`)
  const duplicate = spawnSync(process.execPath, [path.join(import.meta.dirname, 'setup-env.mjs'), target], { encoding: 'utf8' })
  assert.notEqual(duplicate.status, 0)
  for (const key of secretKeys) assert.ok(!(duplicate.stdout + duplicate.stderr).includes(config[key]), `${key} must not be printed on failure`)
}))
