const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = process.argv[2] || '/app';
const requireRoot = createRequire(path.join(root, 'package.json'));
const yaml = requireRoot('yaml');
const lock = yaml.parse(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
const errors = [];
let checked = 0;
let checkedPackages = 0;
for (const [importer, definitions] of Object.entries(lock.importers)) {
  for (const category of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, expected] of Object.entries(definitions[category] || {})) {
      if (expected.version.startsWith('link:')) continue;
      const manifest = path.join(root, importer, 'node_modules', name, 'package.json');
      if (!fs.existsSync(manifest)) {
        if (category !== 'optionalDependencies') errors.push(`${importer}: missing ${name}`);
        continue;
      }
      const actual = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      const version = actual.version.replace(/^v/, '');
      const lockedVersion = expected.version.startsWith(`${actual.name}@`)
        ? expected.version.slice(actual.name.length + 1) : expected.version;
      if (!lockedVersion.startsWith(`${version}(`) && lockedVersion !== version && !lockedVersion.startsWith('https:')) {
        errors.push(`${importer}: ${name} installed ${actual.version}, lock ${expected.version}`);
      }
      checked += 1;
    }
  }
}
for (const entry of fs.readdirSync(path.join(root, 'node_modules/.pnpm'))) {
  const boundary = entry.indexOf('@', 1);
  if (boundary < 0) continue;
  const name = entry.slice(0, boundary).replace('+', '/');
  const manifest = path.join(root, 'node_modules/.pnpm', entry, 'node_modules', name, 'package.json');
  if (!fs.existsSync(manifest)) continue;
  const actual = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const version = actual.version.replace(/^v/, '');
  if (!lock.packages[`${actual.name}@${version}`] && !Object.keys(lock.packages).some((key) => key.startsWith(`${actual.name}@https:`))) {
    errors.push(`Package absent from lock: ${actual.name}@${version}`);
  }
  checkedPackages += 1;
}
console.log(JSON.stringify({ checkedInstalledWorkspaceDependencies: checked, checkedInstalledPackages: checkedPackages, errors }, null, 2));
if (errors.length) process.exit(1);
