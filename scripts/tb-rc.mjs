// Release-candidate check (M7): a fresh profile per Thunderbird version under .tb-rc/, with the
// built XPI installed like a user would have it (not a temporary add-on), then Thunderbird.
// Never touches the real profile.
//
//   npm run build && npm run tb:rc                     installed Thunderbird
//   TB_BIN=~/apps/thunderbird/thunderbird npm run tb:rc  another one (e.g. a Release tarball)
//   npm run tb:rc -- --keep                            reuse the profile (restart check)
//   npm run tb:rc -- --headless                        no window (install check only)
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREFS, detect } from './tb.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8'));
const xpi = join(root, 'dist', `time-tracker-${manifest.version}.xpi`);
if (!existsSync(xpi)) {
  console.error(`${xpi} is missing: run npm run build first.`);
  process.exit(1);
}

const tb = detect();
if (tb.kind === 'flatpak') {
  console.error('Flatpak: install the XPI by hand (Add-ons Manager → Install Add-on From File).');
  process.exit(1);
}
const profile = join(root, '.tb-rc', tb.version);
if (!process.argv.includes('--keep')) rmSync(profile, { recursive: true, force: true });
mkdirSync(join(profile, 'extensions'), { recursive: true });
// Profile-scope add-ons are installed without the sideload prompt when autoDisableScopes is 0.
const prefs = { ...PREFS, 'extensions.autoDisableScopes': 0 };
writeFileSync(
  join(profile, 'user.js'),
  Object.entries(prefs)
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join('\n') + '\n',
);
copyFileSync(
  xpi,
  join(profile, 'extensions', `${manifest.browser_specific_settings.gecko.id}.xpi`),
);

console.log(`Thunderbird ${tb.version} (${tb.bin})`);
console.log(`Profile: ${profile}`);
console.log(`Add-on: ${xpi}`);
// Other arguments go to Thunderbird (e.g. --headless for a scripted install check).
const extra = process.argv.slice(2).filter((arg) => arg !== '--keep');
const child = spawn(tb.bin, ['-profile', profile, '-no-remote', ...extra], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
