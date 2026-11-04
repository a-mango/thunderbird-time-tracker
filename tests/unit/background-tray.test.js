import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTray, resetTray, syncTray } from '../../src/background/tray.js';
import { updateSettings } from '../../src/db/settings.js';
import { start } from '../../src/lib/timer.js';
import { MIN, T0, freshDB, seed } from './db-helpers.js';

/** A fake helper connection: records what the add-on sends, lets the test answer or close. */
function fakePort() {
  /** @type {((message: any) => void)[]} */
  const onMessage = [];
  /** @type {((port: any) => void)[]} */
  const onDisconnect = [];
  const port = {
    name: 'time_tracker_tray',
    /** @type {{message: string} | undefined} */
    error: undefined,
    sent: /** @type {any[]} */ ([]),
    disconnected: false,
    postMessage: (/** @type {any} */ message) => port.sent.push(message),
    disconnect: () => {
      port.disconnected = true;
    },
    onMessage: { addListener: (/** @type {any} */ fn) => onMessage.push(fn) },
    onDisconnect: { addListener: (/** @type {any} */ fn) => onDisconnect.push(fn) },
    /** The helper sends a message. @param {any} message */
    receive: (message) => onMessage.forEach((fn) => fn(message, port)),
    /** The helper goes away (`error`: Thunderbird's reason). @param {string} [error] */
    close: (error) => {
      port.error = error ? { message: error } : undefined;
      onDisconnect.forEach((fn) => fn(port));
    },
  };
  return port;
}

/** @param {{granted?: boolean}} [options] */
function fakeApi({ granted = true } = {}) {
  /** @type {ReturnType<typeof fakePort>[]} */
  const ports = [];
  const api = {
    ports,
    permissions: { contains: vi.fn(async () => granted) },
    runtime: {
      connectNative: vi.fn((/** @type {string} */ _name) => {
        const port = fakePort();
        ports.push(port);
        return port;
      }),
    },
    i18n: { getMessage: (/** @type {string} */ name) => `<${name}>` },
  };
  return api;
}

async function setup(/** @type {{granted?: boolean}} */ options) {
  const { db } = await freshDB();
  const tasks = await seed(db);
  const api = fakeApi(options);
  const onCommand = vi.fn();
  const onMissing = vi.fn();
  const sync = (/** @type {number} */ now = T0) =>
    syncTray(db, { api: /** @type {any} */ (api), now, onCommand, onMissing });
  return { db, tasks, api, onCommand, onMissing, sync };
}

beforeEach(() => {
  resetTray();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  closeTray();
  vi.useRealTimers();
});

describe('syncTray', () => {
  it('stays off while the setting is off, or without the permission', async () => {
    const off = await setup();
    expect(await off.sync()).toBe('off');
    expect(off.api.runtime.connectNative).not.toHaveBeenCalled();

    const refused = await setup({ granted: false });
    await updateSettings(refused.db, { trayIcon: true });
    expect(await refused.sync()).toBe('off');
    expect(refused.api.runtime.connectNative).not.toHaveBeenCalled();
  });

  it('connects once and sends the status on every sync', async () => {
    const { db, tasks, api, sync } = await setup();
    await updateSettings(db, { trayIcon: true });
    expect(await sync()).toBe('on');
    expect(api.runtime.connectNative).toHaveBeenCalledWith('time_tracker_tray');
    const [port] = api.ports;
    expect(port.sent.at(-1)).toMatchObject({
      type: 'status',
      running: false,
      tooltip: { text: '<trayIdle>' },
    });

    await start(db, tasks.checkout.id, { now: T0 });
    await sync(T0 + 65 * MIN);
    expect(api.runtime.connectNative).toHaveBeenCalledTimes(1);
    expect(port.sent.at(-1)).toMatchObject({
      running: true,
      tooltip: { title: '<extensionName>', text: '1:05 · Checkout form validation' },
      menu: [{ id: 'toggle', label: '<trayStop>' }, { type: 'separator' }, { id: 'tracker' }],
    });
  });

  it('turning the setting off closes the helper', async () => {
    const { db, api, sync } = await setup();
    await updateSettings(db, { trayIcon: true });
    await sync();
    await updateSettings(db, { trayIcon: false });
    expect(await sync()).toBe('off');
    expect(api.ports[0].disconnected).toBe(true);
  });

  it('passes known commands from the helper on and ignores the rest', async () => {
    const { db, api, onCommand, sync } = await setup();
    await updateSettings(db, { trayIcon: true });
    await sync();
    api.ports[0].receive({ type: 'command', command: 'toggle' });
    api.ports[0].receive({ type: 'command', command: 'activate' });
    api.ports[0].receive({ type: 'command', command: 'format-disk' });
    api.ports[0].receive({ type: 'ready', version: 1 });
    expect(onCommand.mock.calls).toEqual([['toggle'], ['activate']]);
  });

  it('a missing helper calls onMissing', async () => {
    const { db, api, onMissing, sync } = await setup();
    await updateSettings(db, { trayIcon: true });
    await sync();
    api.ports[0].close('No such native application time_tracker_tray');
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it('a helper that quit is started again after a minute, not on every sync', async () => {
    const { db, api, onMissing, sync } = await setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await updateSettings(db, { trayIcon: true });
    await sync();
    api.ports[0].close('An unexpected error occurred');
    expect(onMissing).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    expect(await sync()).toBe('waiting');
    vi.setSystemTime(T0 + MIN + 1);
    expect(await sync()).toBe('on');
    expect(api.runtime.connectNative).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('treats a missing permissions API as no permission', async () => {
    const { db, api, sync } = await setup();
    await updateSettings(db, { trayIcon: true });
    /** @type {any} */ (api).permissions = undefined;
    expect(await sync()).toBe('off');
  });
});
