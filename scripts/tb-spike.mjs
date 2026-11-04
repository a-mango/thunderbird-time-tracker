// M1 spike inside Thunderbird, driven through Marionette (built into Thunderbird; Node built-ins only).
// Builds a stage (.tb-stage/ = src/ + the gallery + dev/tb-spike/, manifest with the menus
// permissions), starts it with web-ext on .tb-profile/ and --marionette, then:
//   - measures the mail tab (about:3pane) and our gallery tab: font, row heights, AccentColor;
//   - screenshots both tabs into artifacts/tb/;
//   - right-clicks the gallery (project tree → menus.overrideContext(); table → default menu)
//     and records which menu items open;
//   - M3: right-clicks a project row in the real tracker page, activates "Rename Project…" and
//     records whether menus.onClicked reached the page and opened the dialog;
//   - M6: whether an <a download> blob link in the tracker page saves a file;
//   - S3: whether window.print() in the tracker page opens Thunderbird's print dialog.
// Writes artifacts/tb/spike.json. Nothing in src/ or the shipped manifest changes.
// Usage: node scripts/tb-spike.mjs [--keep-open]
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, profile, webExt, webExtArgs } from './tb.mjs';

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
  const tracker = await readFile(join(root, 'src', 'ui', 'tracker.html'), 'utf8');
  await writeFile(
    join(stage, 'ui', 'tracker.html'),
    tracker.replace(
      '<script type="module" src="tracker.js"></script>',
      '<script type="module" src="tracker.js"></script>\n    <script type="module" src="../dev/tb-spike/tracker-probe.js"></script>',
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
  const stopChild = () => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  };
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.once(signal, () => {
      stopChild();
      process.exit(130);
    });
  }
  /** Rejects if web-ext exits before we are done, so the script fails fast. */
  const childExited = new Promise((_, reject) =>
    child.once('exit', (code) => reject(new Error(`web-ext exited early (code ${code})`))),
  );
  childExited.catch(() => {});
  /** @type {Marionette | null} */
  let m = null;
  try {
    m = await Promise.race([Marionette.connect(PORT, 90_000), childExited]);
    const client = /** @type {Marionette} */ (m);
    await client.send('WebDriver:NewSession', { capabilities: {} });
    await client.send('Marionette:SetContext', { value: 'chrome' });
    // Safety: only ever drive the instance running on .tb-profile/. Anything else on the port
    // (e.g. a Thunderbird started by hand with --marionette) is left untouched.
    const profileDir = await client.run(`return Services.dirsvc.get('ProfD', Ci.nsIFile).path;`);
    if (resolve(String(profileDir)) !== resolve(profile)) {
      m = null;
      client.close();
      throw new Error(
        `Marionette on port ${PORT} belongs to profile ${profileDir}, not .tb-profile/`,
      );
    }

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
      /** label of a menu item to activate after listing */
      /** @type {string | undefined} */ activate = undefined,
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
      if (activate) {
        await client.run(
          `const item = [...document.querySelectorAll('menupopup')]
             .filter((p) => p.state === 'open')
             .flatMap((p) => [...p.children])
             .find((c) => c.getAttribute('label') === arguments[0]);
           item?.closest('menupopup').activateItem(item);`,
          [activate],
        );
      }
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

    // M6: save downloads without asking, into artifacts/tb/downloads/ (only inside .tb-profile/),
    // so the probe's <a download> click either lands there or provably goes nowhere.
    const downloadDir = join(outDir, 'downloads');
    await rm(downloadDir, { recursive: true, force: true });
    await mkdir(downloadDir, { recursive: true });
    await client.run(
      `Services.prefs.setBoolPref('browser.download.useDownloadDir', true);
       Services.prefs.setIntPref('browser.download.folderList', 2);
       Services.prefs.setStringPref('browser.download.dir', arguments[0]);`,
      [downloadDir],
    );

    // M3: the real tracker page and its native context menu.
    const trackerUrl = await client.run(
      `return WebExtensionPolicy.getByID(arguments[0]).getURL('ui/tracker.html');`,
      [id],
    );
    await client.run(
      `document.getElementById('tabmail').openTab('contentTab', { url: arguments[0], background: false });`,
      [trackerUrl],
    );
    const readProbe = () =>
      client.run(`
        const title = document.getElementById('tabmail').currentTabInfo.browser?.contentTitle ?? '';
        return title.startsWith('TT-PROBE ') ? JSON.parse(title.slice(9)) : null;
      `);
    const probe = /** @type {Record<string, any>} */ (
      await waitFor(async () => {
        const value = await readProbe();
        return value?.row ? value : null;
      }, 'a project row in the tracker')
    );
    await sleep(500);
    const trackerMenu = await rightClick(
      { x: probe.row.x + 40, y: probe.row.y + probe.row.height / 2 },
      'tracker-context.png',
      'Rename Project…',
    );
    await sleep(1000);
    const clicked = /** @type {Record<string, any>} */ (await readProbe());
    const trackerShot = await client.screenshot(join(outDir, 'tracker-tab.png'));

    // M6: the probe clicked an <a download> link after the dialog closed. Did Thunderbird save
    // the file, or open a dialog asking where to?
    const downloadResult = await waitFor(
      () =>
        client.run(`return (async () => {
          const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
          const list = await Downloads.getList(Downloads.ALL);
          const all = await list.getAll();
          const found = all.filter((d) => d.target.path?.includes('tt-probe') || d.source.url.startsWith('blob:moz-extension'));
          const windows = [];
          for (const win of Services.wm.getEnumerator(null)) {
            windows.push(win.document.documentElement.getAttribute('windowtype') || win.location.href);
          }
          if (found.length === 0 && !windows.some((w) => /unknownContentType|filepicker/i.test(w))) return null;
          return {
            downloads: found.map((d) => ({ succeeded: d.succeeded, error: d.error?.message ?? null, path: d.target.path, source: d.source.url.slice(0, 20) })),
            windows,
          };
        })();`),
      'the probe download',
      20_000,
    ).catch(async (error) => ({
      error: String(error),
      probe: (await readProbe())?.download ?? null,
      all: await client.run(`return (async () => {
        const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
        const list = await Downloads.getList(Downloads.ALL);
        return (await list.getAll()).map((d) => d.source.url.slice(0, 40));
      })();`),
      prefs: await client.run(`return {
        useDownloadDir: Services.prefs.getBoolPref('browser.download.useDownloadDir', null),
        folderList: Services.prefs.getIntPref('browser.download.folderList', -1),
        dir: Services.prefs.getStringPref('browser.download.dir', ''),
      };`),
    }));
    await client.screenshot(join(outDir, 'tracker-download.png'));

    // S3: the probe calls window.print(). Thunderbird shows printing as a tab-modal dialog over
    // the content tab (printUtils.js TabDialogBox); record whether one opened, then close it.
    const printResult = await waitFor(
      () =>
        client.run(`
          const browser = document.getElementById('tabmail').currentTabInfo.browser;
          const manager = browser?.tabDialogBox?._tabDialogManager;
          const dialogs = manager?._dialogs ?? [];
          const windows = [];
          for (const win of Services.wm.getEnumerator(null)) {
            windows.push(win.document.documentElement.getAttribute('windowtype') || win.location.href);
          }
          const printWindow = windows.find((w) => /print/i.test(w)) ?? null;
          if (dialogs.length === 0 && !printWindow) return null;
          return {
            tabDialogs: dialogs.map((d) => d._frame?.contentDocument?.documentURI ?? d._openedURL ?? '?'),
            printWindow,
          };
        `),
      'the print dialog',
      20_000,
    ).catch(async (error) => ({
      error: String(error),
      probe: (await readProbe())?.print ?? null,
    }));
    await sleep(1500);
    await client.screenshot(join(outDir, 'tracker-print.png'));
    await client.run(`
      document.getElementById('tabmail').currentTabInfo.browser?.tabDialogBox?.abortAllDialogs?.();
    `);

    const result = {
      thunderbird: tb.version,
      mail,
      gallery: { ...page, overrides: after?.overrides ?? page.overrides },
      contextMenu: { overrideOnProjectTree: overrideMenu, defaultOnTable: defaultMenu },
      tracker: {
        menuOnProjectRow: trackerMenu,
        onClickedInPage: clicked?.clicked ?? null,
        dialogOpened: clicked?.dialog ?? null,
        header: clicked?.header ?? null,
        timing: probe.timing ?? null,
      },
      download: { ...downloadResult, saved: await readdir(downloadDir) },
      print: printResult,
      shots: [
        mailShot,
        galleryShot,
        join(outDir, 'context-override.png'),
        join(outDir, 'context-default.png'),
        join(outDir, 'tracker-context.png'),
        trackerShot,
        join(outDir, 'tracker-print.png'),
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
      stopChild();
    } else m?.close();
  }
}

await main();
