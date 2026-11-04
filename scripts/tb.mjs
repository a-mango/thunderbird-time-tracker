// Start Thunderbird on the isolated dev profile .tb-profile/ with the unpacked extension loaded.
// Never touches the real profile (~/.thunderbird or the Flatpak one).
//
//   npm run tb                 web-ext run: temporary add-on, auto-reload on changes (default)
//   npm run tb -- --manual     open Thunderbird on .tb-profile/ and print about:debugging steps
//   TB_BIN=/path/to/thunderbird npm run tb    use a specific binary
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const profile = join(root, '.tb-profile');
const source = join(root, 'src');
export const webExt = join(root, 'node_modules', '.bin', 'web-ext');

// Fresh-profile prefs: no account wizard, no default-client prompt, no start page or telemetry.
export const PREFS = {
  'mail.provider.suppress_dialog_on_startup': true,
  'mail.shell.checkDefaultClient': false,
  'mailnews.start_page.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'app.update.auto': false,
  'browser.shell.checkDefaultBrowser': false,
  // web-ext uninstalls the temporary add-on on quit; keep its moz-extension:// UUID and IndexedDB
  // so data survives a restart (M3 manual check).
  'extensions.webextensions.keepStorageOnUninstall': true,
  'extensions.webextensions.keepUuidOnUninstall': true,
};

/**
 * Finds Thunderbird: TB_BIN, then the RPM/tarball binary, then Flatpak.
 * Calls the real binary, not the /usr/bin wrapper, so -profile/-no-remote reach it directly.
 * @returns {{kind: 'env' | 'rpm' | 'flatpak', bin: string, version: string}}
 */
export function detect() {
  if (process.env.TB_BIN)
    return { kind: 'env', bin: process.env.TB_BIN, version: version(process.env.TB_BIN) };
  for (const bin of ['/usr/lib64/thunderbird/thunderbird', '/usr/lib/thunderbird/thunderbird']) {
    if (existsSync(bin)) return { kind: 'rpm', bin, version: version(bin) };
  }
  const flatpak = spawnSync('flatpak', ['info', 'org.mozilla.Thunderbird'], { encoding: 'utf8' });
  if (flatpak.status === 0) {
    const match = flatpak.stdout.match(/Version:\s*(\S+)/);
    return { kind: 'flatpak', bin: 'flatpak:org.mozilla.Thunderbird', version: match?.[1] ?? '?' };
  }
  console.error(
    'Thunderbird not found. Install it (dnf or Flatpak) or set TB_BIN=/path/to/thunderbird.',
  );
  process.exit(1);
}

/** @param {string} bin */
function version(bin) {
  const out = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  return (out.stdout.match(/Thunderbird ([\d.]+\S*)/) ?? [])[1] ?? '?';
}

/**
 * Exits when .tb-profile/ was last opened by a newer Thunderbird than `tb`. Thunderbird refuses
 * such a profile (downgrade protection) and, started this way, falls back to creating a new
 * profile in the real ~/.thunderbird: never start it on a newer dev profile.
 * @param {{version: string}} tb
 */
export function refuseNewerProfile(tb) {
  /** @type {string} */
  let ini;
  try {
    ini = readFileSync(join(profile, 'compatibility.ini'), 'utf8');
  } catch {
    return; // a new profile
  }
  const last = ini.match(/^LastVersion=([\d.]+)/mu)?.[1];
  if (!last || tb.version === '?') return;
  const parts = (/** @type {string} */ v) => v.split('.').map(Number);
  const [a, b] = [parts(last), parts(tb.version)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff < 0) return;
    if (diff > 0) {
      console.error(
        `.tb-profile/ was last opened by Thunderbird ${last}, newer than ${tb.version}.\n` +
          'Thunderbird would refuse it and create a new profile in ~/.thunderbird instead.\n' +
          'Move .tb-profile/ aside (e.g. mv .tb-profile .tb-profile-' +
          `${last}) for a fresh dev profile, or set TB_BIN to Thunderbird ${last}.`,
      );
      process.exit(1);
    }
  }
}

/**
 * Arguments for `web-ext run` on .tb-profile/.
 * @param {{kind: string, bin: string}} tb
 * @param {string} [sourceDir]
 */
export function webExtArgs(tb, sourceDir = source) {
  return [
    'run',
    '--source-dir',
    sourceDir,
    '--firefox',
    tb.bin,
    '--firefox-profile',
    profile,
    '--profile-create-if-missing',
    '--keep-profile-changes',
    ...Object.entries(PREFS).map(([key, value]) => `--pref=${key}=${value}`),
  ];
}

/** @param {{kind: string, bin: string}} tb */
function runWebExt(tb) {
  const args = webExtArgs(tb);
  console.log(`web-ext ${args.join(' ')}\n`);
  const child = spawn(webExt, args, {
    stdio: 'inherit',
    env: { ...process.env, MOZ_ENABLE_WAYLAND: process.env.MOZ_ENABLE_WAYLAND ?? '1' },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/** @param {{kind: string, bin: string}} tb */
function runManual(tb) {
  mkdirSync(profile, { recursive: true });
  const [command, args] =
    tb.kind === 'flatpak'
      ? [
          'flatpak',
          [
            'run',
            `--filesystem=${root}`,
            'org.mozilla.Thunderbird',
            '-profile',
            profile,
            '-no-remote',
          ],
        ]
      : [tb.bin, ['-profile', profile, '-no-remote']];
  console.log(`${command} ${args.join(' ')}\n`);
  console.log('Then load the extension by hand:');
  console.log(
    '  1. Menu ≡ → Add-ons and Themes → gear icon → Debug Add-ons (about:debugging#/runtime/this-firefox)',
  );
  console.log('  2. Load Temporary Add-on… → select');
  console.log(`     ${join(source, 'manifest.json')}`);
  console.log('  3. After code changes, press Reload on the add-on card.\n');
  const child = spawn(command, args, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tb = detect();
  console.log(`Thunderbird ${tb.version} (${tb.kind}: ${tb.bin})`);
  console.log(`Profile: ${profile}`);
  refuseNewerProfile(tb);
  if (process.argv.includes('--manual')) runManual(tb);
  else runWebExt(tb);
}
