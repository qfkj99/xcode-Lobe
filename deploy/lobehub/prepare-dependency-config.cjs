const fs = require('node:fs');
const filename = process.argv[2] || '/app/pnpm-workspace.yaml';
let config = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
if (!/^lockfile: (false|true)$/m.test(config)) throw new Error('Upstream lockfile setting changed');
config = config.replace(/^lockfile: (false|true)$/m, 'lockfile: true');
fs.writeFileSync(filename, config);
