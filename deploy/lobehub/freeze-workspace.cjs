const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function freezeWorkspace(root, yaml) {
  const filename = path.join(root, 'pnpm-workspace.yaml');
  const config = yaml.parse(fs.readFileSync(filename, 'utf8'));
  const lock = yaml.parse(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
  const importers = Object.keys(lock.importers || {});
  if (!importers.includes('.')) throw new Error('Reviewed root importer is missing');
  for (const importer of importers) {
    const resolved = path.resolve(root, importer);
    if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) {
      throw new Error('Importer escapes workspace');
    }
    if (!fs.existsSync(path.join(resolved, 'package.json'))) throw new Error(`Missing importer manifest: ${importer}`);
  }
  // Match the upstream production dependency stage without excluding application sources.
  config.packages = importers.sort();
  config.lockfile = true;
  fs.writeFileSync(filename, yaml.stringify(config));
  console.log(JSON.stringify({ frozenWorkspaceImporters: importers.length, applicationSourcesPreserved: true }));
}

module.exports = { freezeWorkspace };
if (require.main === module) {
  const root = process.argv[2] || '/app';
  freezeWorkspace(root, createRequire(path.join(root, 'package.json'))('yaml'));
}
