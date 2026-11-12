'use strict';
const path = require('path');
const electron = require(path.resolve(__dirname, '../backend/node_modules/electron'));
const { spawnSync } = require('child_process');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const script = `
const s = require('node:sqlite');
console.log('ELECTRON_HAS_SQLITE:', Boolean(s && s.DatabaseSync));
process.exit(0);
`;

const res = spawnSync(electron, ['-e', script], { env });
console.log('STDOUT:', res.stdout.toString());
console.log('STDERR:', res.stderr.toString());
