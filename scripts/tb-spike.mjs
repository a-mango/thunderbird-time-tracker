// M1 spike inside Thunderbird, driven through Marionette (built into Thunderbird; Node built-ins only).
// Builds a stage (.tb-stage/ = src/ + the gallery + dev/tb-spike/, manifest with the menus
// permissions), starts it with web-ext on .tb-profile/ and --marionette, then:
//   - measures the mail tab (about:3pane) and our gallery tab: font, row heights, AccentColor;
//   - screenshots both tabs into artifacts/tb/;
//   - right-clicks the gallery (project tree → menus.overrideContext(); table → default menu)
//     and records which menu items open.
// Writes artifacts/tb/spike.json. Nothing in src/ or the shipped manifest changes.
// Usage: node scripts/tb-spike.mjs [--keep-open]
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, webExt, webExtArgs } from './tb.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stage = join(root, '.tb-stage');
const outDir = join(root, 'artifacts', 'tb');
const PORT = 2828;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

async function buildStage() {
  await rm(stage, { recursive: true, force: true });
  await cp(join(root, 'src'), stage, {
    recursive: true,
    filter: (path) => !path.startsWith(join(root, 'src', 'types')),
  });
  await mkdir(join(stage, 'dev'), { recursive: true });
  for (const file of ['gallery.css', 'gallery.js', 'fixtures.js']) {
    await cp(join(root, 'dev', file), join(stage, 'dev', file));
  }
  await cp(join(root, 'dev', 'tb-spike'), join(stage, 'dev', 'tb-spike'), { recursive: true });
  const html = await readFile(join(root, 'dev', 'gallery.html'), 'utf8');
  await writeFile(
    join(stage, 'dev', 'gallery.html'),
    html.replace(
      '<script type="module" src="gallery.js"></script>',
      '<script type="module" src="gallery.js"></script>\n    <script type="module" src="tb-spike/page.js"></script>',
    ),
  );
  const manifest = JSON.parse(await readFile(join(root, 'src', 'manifest.json'), 'utf8'));
  manifest.permissions = [...(manifest.permissions ?? []), 'menus', 'menus.overrideContext'];
  manifest.background.scripts = ['dev/tb-spike/background.js'];
  await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest.browser_specific_settings.gecko.id;
}

/** Minimal Marionette client: `len:json` frames, commands `[0, id, name, params]`. */
class Marionette {
  /** @type {import('node:net').Socket} */
  #socket;
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  /** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
  #pending = new Map();
  /** @type {((value: unknown) => void) | null} */
  #onHello = null;

  /** @param {import('node:net').Socket} socket */
  constructor(socket) {
    this.#socket = socket;
    socket.on('data', (chunk) => this.#onData(chunk));
  }

  /** @param {number} port @param {number} timeoutMs */
  static async connect(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const socket = await new Promise((resolveSocket, reject) => {
          const s = connect(port, '127.0.0.1', () => resolveSocket(s));
          s.once('error', reject);
        });
        const client = new Marionette(/** @type {import('node:net').Socket} */ (socket));
        await new Promise((r) => {
          client.#onHello = r;
        });
        return client;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await sleep(500);
      }
    }
  }

  /** @param {Buffer} chunk */
  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const colon = this.#buffer.indexOf(':');
      if (colon < 0) return;
      const length = Number(this.#buffer.subarray(0, colon).toString());
      if (this.#buffer.length < colon + 1 + length) return;
      const message = JSON.parse(this.#buffer.subarray(colon + 1, colon + 1 + length).toString());
      this.#buffer = this.#buffer.subarray(colon + 1 + length);
      if (!Array.isArray(message)) {
        this.#onHello?.(message);
        continue;
      }
      const [, id, error, result] = message;
      const pending = this.#pending.get(id);
      this.#pending.delete(id);
      if (error) pending?.reject(new Error(`${error.error}: ${error.message}`));
      else pending?.resolve(result);
    }
  }

  /** @param {string} name @param {Record<string, unknown>} [params] */
  send(name, params = {}) {
    const id = this.#nextId++;
    const json = JSON.stringify([0, id, name, params]);
    this.#socket.write(`${Buffer.byteLength(json)}:${json}`);
    return new Promise((resolveSend, reject) =>
      this.#pending.set(id, { resolve: resolveSend, reject }),
    );
  }

  /** Runs a function body in the main window's chrome scope. @param {string} script @param {unknown[]} [args] */
  async run(script, args = []) {
    const { value } = await this.send('WebDriver:ExecuteScript', { script, args });
    return value;
  }

  /** @param {string} file */
  async screenshot(file) {
    const { value } = await this.send('WebDriver:TakeScreenshot', { full: false });
    await writeFile(file, Buffer.from(value, 'base64'));
    return file;
  }

  close() {
    this.#socket.destroy();
  }
}

/** @param {() => Promise<unknown>} check @param {string} what @param {number} [timeoutMs] */
async function waitFor(check, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

// Chrome-scope snippets (run inside Thunderbird's main window).
const MEASURE_MAIL_TAB = `
  const tabmail = document.getElementById('tabmail');
  tabmail.switchToTab(0);
  const win = tabmail.currentAbout3Pane;
  const doc = win.document;
  const row = doc.querySelector('#folderTree li > .container');
  if (!row) return null;
  const color = (value) => {
    const probe = doc.createElement('span');
    probe.style.color = value;
    doc.body.append(probe);
    const c = win.getComputedStyle(probe).color;
    probe.remove();
    return c;
  };
  const rect = (el) => el && (({ x, y, width, height }) => ({ x, y, width, height }))(el.getBoundingClientRect());
  const rootStyle = win.getComputedStyle(doc.documentElement);
  const { UIFontSize } = ChromeUtils.importESModule('resource:///modules/UIFontSize.sys.mjs');
  const pref = (name) => {
    const type = Services.prefs.getPrefType(name);
    if (type === Services.prefs.PREF_STRING) return Services.prefs.getStringPref(name);
    if (type === Services.prefs.PREF_INT) return Services.prefs.getIntPref(name);
    if (type === Services.prefs.PREF_BOOL) return Services.prefs.getBoolPref(name);
    return null;
  };
  return {
    fontFamily: rootStyle.fontFamily,
    fontSize: rootStyle.fontSize,
    fontWeight: rootStyle.fontWeight,
    uiFontSize: UIFontSize.size,
    uiFontSizeIsDefault: UIFontSize.isDefault,
    accentColor: color('AccentColor'),
    accentColorText: color('AccentColorText'),
    selectedItemColor: color('var(--selected-item-color)'),
    prefs: {
      'mail.uidensity': pref('mail.uidensity'),
      'mail.appearance.accentColor': pref('mail.appearance.accentColor'),
      'mail.uifontsize': pref('mail.uifontsize'),
    },
    folderRow: rect(row),
    folderRowFont: win.getComputedStyle(row).fontSize,
    modeName: (doc.querySelector('.mode-name') && win.getComputedStyle(doc.querySelector('.mode-name')).fontSize) || null,
    threadRowHeight: win.customElements.get('thread-row')?.ROW_HEIGHT ?? null,
    threadHeader: rect(doc.querySelector('#threadTree thead th')),
    dark: win.matchMedia('(prefers-color-scheme: dark)').matches,
  };
`;

async function main() {
  const tb = detect();
  console.log(`Thunderbird ${tb.version} (${tb.kind}: ${tb.bin})`);
  const id = await buildStage();
  await mkdir(outDir, { recursive: true });
  const args = [
    ...webExtArgs(tb, stage),
    '--arg=--marionette',
    '--arg=-remote-allow-system-access',
    `--pref=marionette.port=${PORT}`,
    '--no-reload',
  ];
  console.log(`web-ext ${args.join(' ')}\n`);
  const child = spawn(webExt, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    // Own process group, so stopping it also stops the Thunderbird that web-ext started.
    detached: true,
    env: { ...process.env, MOZ_ENABLE_WAYLAND: process.env.MOZ_ENABLE_WAYLAND ?? '1' },
  });
  /** @type {Marionette | null} */
  let m = null;
  try {
    m = await Marionette.connect(PORT, 90_000);
    const client = m;
    await client.send('WebDriver:NewSession', { capabilities: {} });
    await client.send('Marionette:SetContext', { value: 'chrome' });

    const galleryUrl = /** @type {string} */ (
      await waitFor(
        () =>
          client.run(
            `return globalThis.WebExtensionPolicy?.getByID(arguments[0])?.getURL('dev/gallery.html') ?? null;`,
            [id],
          ),
        'the extension to load',
      )
    );
    console.log(`gallery: ${galleryUrl}`);

    // A Local Folders account so the folder pane has rows (only inside .tb-profile/).
    await client.run(`
      let server = null;
      try {
        server = MailServices.accounts.localFoldersServer;
      } catch {}
      if (!server) MailServices.accounts.createLocalMailAccount();
    `);
    const mail = await waitFor(() => client.run(MEASURE_MAIL_TAB), 'folder pane rows');
    await sleep(500);
    const mailShot = await client.screenshot(join(outDir, 'mail-tab.png'));

    await client.run(
      `document.getElementById('tabmail').openTab('contentTab', { url: arguments[0], background: false });`,
      [galleryUrl],
    );
    const readPage = () =>
      client.run(`
        const tabmail = document.getElementById('tabmail');
        const title = tabmail.currentTabInfo.browser?.contentTitle ?? '';
        return title.startsWith('TT-SPIKE ') ? JSON.parse(title.slice(9)) : null;
      `);
    const page = /** @type {Record<string, any>} */ (await waitFor(readPage, 'gallery metrics'));
    await sleep(500);
    const galleryShot = await client.screenshot(join(outDir, 'gallery-tab.png'));

    /** Right-clicks a point of the gallery (page CSS px) and lists the open menu items. */
    const rightClick = async (
      /** @type {{x: number, y: number}} */ point,
      /** @type {string} */ shot,
    ) => {
      // Chrome-window CSS px of the point, then a real right-click through WebDriver actions.
      const at = /** @type {{x: number, y: number}} */ (
        await client.run(
          `const r = document.getElementById('tabmail').currentTabInfo.browser.getBoundingClientRect();
           return { x: Math.round(r.left + arguments[0]), y: Math.round(r.top + arguments[1]) };`,
          [point.x, point.y],
        )
      );
      await client.send('WebDriver:PerformActions', {
        actions: [
          {
            type: 'pointer',
            id: 'mouse',
            parameters: { pointerType: 'mouse' },
            actions: [
              { type: 'pointerMove', x: at.x, y: at.y, origin: 'viewport' },
              { type: 'pointerDown', button: 2 },
              { type: 'pointerUp', button: 2 },
            ],
          },
        ],
      });
      await client.send('WebDriver:ReleaseActions').catch(() => {});
      await sleep(1000);
      const menus = await client.run(`
        return [...document.querySelectorAll('menupopup')]
          .filter((p) => p.state === 'open' || p.state === 'showing')
          .map((p) => ({
            id: p.id,
            items: [...p.children]
              .filter((c) => !c.hidden && !c.collapsed && c.localName !== 'menuseparator')
              .map((c) => c.getAttribute('label'))
              .filter(Boolean),
          }));
      `);
      await client.screenshot(join(outDir, shot));
      await client.run(`
        for (const p of document.querySelectorAll('menupopup')) if (p.state === 'open') p.hidePopup();
      `);
      await sleep(300);
      return menus;
    };
    const tree = page.treeRow;
    const table = page.tableArea;
    const overrideMenu = await rightClick(
      { x: tree.x + 20, y: tree.y + tree.height / 2 },
      'context-override.png',
    );
    const defaultMenu = await rightClick(
      { x: table.x + table.width / 2, y: table.y + 10 },
      'context-default.png',
    );
    const after = /** @type {Record<string, any>} */ (await readPage());

    const result = {
      thunderbird: tb.version,
      mail,
      gallery: { ...page, overrides: after?.overrides ?? page.overrides },
      contextMenu: { overrideOnProjectTree: overrideMenu, defaultOnTable: defaultMenu },
      shots: [
        mailShot,
        galleryShot,
        join(outDir, 'context-override.png'),
        join(outDir, 'context-default.png'),
      ],
    };
    await writeFile(join(outDir, 'spike.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (!process.argv.includes('--keep-open')) {
      await Promise.race([
        m?.send('Marionette:Quit', { flags: ['eForceQuit'] }).catch(() => {}),
        sleep(5000),
      ]);
      m?.close();
      await sleep(2000);
      try {
        process.kill(-(child.pid ?? 0), 'SIGTERM');
      } catch {
        // Already gone.
      }
    } else m?.close();
  }
}

await main();
