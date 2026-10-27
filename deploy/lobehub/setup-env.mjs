#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function setupEnv(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new Error('A new environment file path is required')
  }
  const target = path.resolve(targetPath)
  if (!fs.statSync(path.dirname(target), { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Parent directory must already exist')
  }
  const hex = () => crypto.randomBytes(32).toString('hex')
  const settings = {
    COMPOSE_PROJECT_NAME: 'xcode-lobe',
    LOBE_IMAGE: 'xcode-lobe:local',
    LOBE_PUBLIC_URL: 'https://chat.example.com',
    NEW_API_PUBLIC_URL: 'https://api.example.com',
    S3_ENDPOINT: 'https://files.example.com',
    NEW_API_CHAT_BRIDGE_SECRET: hex(),
    POSTGRES_PASSWORD: hex(),
    AUTH_SECRET: hex(),
    KEY_VAULTS_SECRET: crypto.randomBytes(32).toString('base64'),
    S3_ACCESS_KEY_ID: 'lobehub',
    S3_SECRET_ACCESS_KEY: hex(),
  }
  const content = Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
  try {
    // Exclusive creation also refuses existing and dangling symbolic links.
    fs.writeFileSync(target, content, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Environment file already exists; refusing to overwrite it')
    throw new Error('Unable to create the environment file; check the path and directory permissions')
  }
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node setup-env.mjs <target-new-.env-file>')
  const target = setupEnv(process.argv[2])
  console.log(`Created private environment file: ${target}`)
  console.log('Edit LOBE_PUBLIC_URL, NEW_API_PUBLIC_URL and S3_ENDPOINT. Keep the generated secrets private and preserve them on upgrades.')
}
