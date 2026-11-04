// Demo data for trying the add-on in Thunderbird: writes a backup of the dev harness's fictional
// fixtures (dev/fixtures.js), dated around now, to artifacts/demo-backup.json. Load it with
// Settings… › Data › Restore… (Replace). Validated like any restore before it is written.
// Usage: npm run demo [-- --seed=N] [-- --running]
import { mkdir, writeFile } from 'node:fs/promises';
import { generateFixtures } from '../dev/fixtures.js';
import { BACKUP_FORMAT, BACKUP_VERSION, parseBackup } from '../src/lib/importer.js';

const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.slice('--seed='.length)) : 42;
const now = Date.now();
// No running timer by default: a restored timer would have run since the file was written.
const fixtures = generateFixtures({ seed, now, running: process.argv.includes('--running') });
const text = JSON.stringify({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: now,
  ...fixtures,
});
const backup = parseBackup(text);
const out = new URL('../artifacts/demo-backup.json', import.meta.url);
await mkdir(new URL('.', out), { recursive: true });
await writeFile(out, `${text}\n`);
console.log(
  `${out.pathname}: ${backup.projects.length} projects, ${backup.tasks.length} tasks, ` +
    `${backup.entries.length} entries (seed ${seed}, fictional).`,
);
console.log('Load it in Thunderbird: More options (⋯) › Settings… › Data › Restore… › Replace.');
