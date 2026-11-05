// Installs the system tray helper (S6, native/tray/) for the current user on Linux:
//   - copies the helper and its icons to $XDG_DATA_HOME/thunderbird-time-tracker/tray/
//     (default ~/.local/share/...);
//   - writes the native messaging manifest Thunderbird reads,
//     ~/.mozilla/native-messaging-hosts/time_tracker_tray.json (Thunderbird 157 shares this folder
//     with Firefox: its XREUserNativeManifests directory, checked in the S6 spike).
// Then turn on Settings › Show the timer in the system tray.
// Usage: npm run tray:install | npm run tray:uninstall
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'time_tracker_tray';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = join(root, 'native', 'tray');
// The XDG spec says to ignore a relative XDG_DATA_HOME (Thunderbird rejects a relative path too).
const xdgData = process.env.XDG_DATA_HOME;
const dataHome = xdgData && isAbsolute(xdgData) ? xdgData : join(homedir(), '.local', 'share');
/** The interpreter the helper's shebang names: check that one, not whatever python3 is first. */
const PYTHON = '/usr/bin/python3';
const target = join(dataHome, 'thunderbird-time-tracker', 'tray');
const manifestDir = join(homedir(), '.mozilla', 'native-messaging-hosts');
const manifestFile = join(manifestDir, `${HOST}.json`);

if (platform() !== 'linux') {
  console.error('The tray helper supports Linux only for now (docs/PLAN.md, S6).');
  process.exit(1);
}

if (process.argv.includes('--uninstall')) {
  await rm(manifestFile, { force: true });
  await rm(join(dataHome, 'thunderbird-time-tracker'), { recursive: true, force: true });
  console.log(`Removed ${manifestFile}\nRemoved ${join(dataHome, 'thunderbird-time-tracker')}`);
  process.exit(0);
}

const check = spawnSync(
  PYTHON,
  ['-c', "import gi; gi.require_version('Gio', '2.0'); from gi.repository import Gio"],
  { encoding: 'utf8' },
);
if (check.status !== 0) {
  console.error(
    `The helper needs ${PYTHON} with PyGObject (Fedora: sudo dnf install python3-gobject).\n` +
      (check.stderr || check.error?.message || ''),
  );
  process.exit(1);
}

const addon = JSON.parse(await readFile(join(root, 'src', 'manifest.json'), 'utf8'));
await mkdir(join(target, 'icons'), { recursive: true });
const program = join(target, 'time_tracker_tray.py');
await copyFile(join(source, 'time_tracker_tray.py'), program);
await chmod(program, 0o755);
for (const icon of await readdir(join(source, 'icons'))) {
  await copyFile(join(source, 'icons', icon), join(target, 'icons', icon));
}
await mkdir(manifestDir, { recursive: true });
await writeFile(
  manifestFile,
  `${JSON.stringify(
    {
      name: HOST,
      description: 'Time Tracker for Thunderbird: system tray icon',
      path: program,
      type: 'stdio',
      allowed_extensions: [addon.browser_specific_settings.gecko.id],
    },
    null,
    2,
  )}\n`,
);
console.log(`Installed ${program}\nWrote ${manifestFile}`);
console.log('In Time Tracker: More options › Settings… › Show the timer in the system tray.');
