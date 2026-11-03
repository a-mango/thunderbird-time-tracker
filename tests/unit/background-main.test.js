import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessenger } from '../../dev/mock-messenger.js';
import { syncTimerStatus, toggleTimer } from '../../src/background/timer-status.js';
import { freshDB, seed, T0 } from './db-helpers.js';
import { start } from '../../src/lib/timer.js';

const messages = {
  spaceTitle: { message: 'Time Tracker' },
  extensionName: { message: 'Time Tracker' },
  notificationNoLastTask: { message: 'No task to start yet.' },
};

/** A messenger without the APIs that need `alarms`, `menus` and `notifications`. */
function withoutPermissions() {
  /** @type {any} */
  const api = createMessenger({ messages, baseUrl: 'moz-extension://test/' });
  delete api.alarms;
  delete api.menus;
  delete api.notifications;
  return api;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('background without optional APIs', () => {
  it('loads and still registers its other listeners', async () => {
    const api = withoutPermissions();
    vi.stubGlobal('messenger', api);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    await import('../../src/background/main.js');
    expect(api.runtime.onMessage.dispatch).toBeTypeOf('function');
    // onMessage and onCommand listeners exist: dispatching reaches them without throwing.
    expect(() => api.runtime.onMessage.dispatch({ type: 'tt:changed' })).not.toThrow();
    expect(() => api.commands.onCommand.dispatch('toggle-timer')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The menu setup failure is logged, not thrown.
    expect(errors.mock.calls.some(([text]) => String(text).includes('menu setup'))).toBe(true);
  });

  it('sets the label without alarms, and toggles without notifications', async () => {
    const api = withoutPermissions();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = await freshDB();
    const tasks = await seed(db);
    expect(await toggleTimer(db, { api, now: T0 })).toMatchObject({ action: 'none' });
    await start(db, tasks.checkout.id, { now: T0 });
    expect(await syncTimerStatus(db, { api, now: T0 + 61_000 })).toBe('running');
    expect(await api.action.getLabel({})).toMatch(/0:01/);
  });

  it('keeps setting the label when the alarm call fails', async () => {
    /** @type {any} */
    const api = createMessenger({ messages, baseUrl: 'moz-extension://test/' });
    api.alarms.create = () => Promise.reject(new Error('denied'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = await freshDB();
    const tasks = await seed(db);
    await start(db, tasks.checkout.id, { now: T0 });
    await syncTimerStatus(db, { api, now: T0 + 61_000 });
    expect(await api.action.getLabel({})).toMatch(/0:01/);
    expect(errors).toHaveBeenCalledWith('time tracker: timer status failed', expect.any(Error));
  });
});
