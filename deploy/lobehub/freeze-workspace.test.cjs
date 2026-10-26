const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('yaml');
const { freezeWorkspace } = require('./freeze-workspace.cjs');

test('freezes dependency importers without changing reviewed lock or source manifests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lobe-workspace-test-'));
  try {
    for (const dir of ['.', 'packages/a', 'apps/server', 'apps/auth', 'e2e']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, 'package.json'), '{}');
    }
    const config = { lockfile: false, packages: ['packages/**', '.', 'apps/server', 'apps/auth', 'e2e'], overrides: { react: '19.2.7' } };
    const lock = yaml.stringify({ importers: { '.': {}, 'packages/a': {} } });
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), yaml.stringify(config));
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), lock);
    freezeWorkspace(root, yaml);
    const actual = yaml.parse(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'));
    assert.deepEqual(actual.packages, ['.', 'packages/a']);
    assert.equal(actual.lockfile, true);
    assert.deepEqual(actual.overrides, config.overrides);
    assert.equal(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'), lock);
    for (const dir of ['apps/server', 'apps/auth', 'e2e']) assert.ok(fs.existsSync(path.join(root, dir, 'package.json')));
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('lobe-workspace-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
