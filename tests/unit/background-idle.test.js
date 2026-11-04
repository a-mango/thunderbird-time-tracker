import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessenger } from '../../dev/mock-messenger.js';
import {
  IDLE_NOTIFICATION_ID,
  armIdle,
  checkIdleOnStartup,
  checkSleep,
  onIdleState,
  syncIdleNotification,
} from '../../src/background/idle.js';
import { syncTimerStatus } from '../../src/background/timer-status.js';
import { handleMessage } from '../../src/background/messages.js';
import { getIdle, recordIdle, resolveIdle } from '../../src/db/idle.js';
import { openDB } from '../../src/db/idb.js';
import { updateSettings } from '../../src/db/settings.js';
import { start, stop } from '../../src/lib/timer.js';
import { MIN, T0, freshDB, seed } from './db-helpers.js';

const messages = {
  spaceTitle: { message: 'Time Tracker' },
  extensionName: { message: 'Time Tracker' },
  idleAway: {
    message: 'You were away $DURATION$ ($RANGE$).',
    placeholders: { duration: { content: '$1' }, range: { content: '$2' } },
  },
  idleNotificationHint: { message: 'Open Time Tracker to keep or remove this time.' },
};

/** A running timer since T0 (09:00) and no page open. */
async function setup() {
  /** @type {any} */
  const api = createMessenger({ messages, baseUrl: 'moz-extension://test/', locale: 'en-GB' });
  api.runtime._contexts = [];
  const { db } = await freshDB();
  const tasks = await seed(db);
  await start(db, tasks.checkout.id, { now: T0 });
  const notification = async () => (await api.notifications.getAll())[IDLE_NOTIFICATION_ID];
  return { api, db, tasks, notification };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('idle events', () => {
  it('idle dates back by the threshold; active raises a notification', async () => {
    const { api, db, notification } = await setup();
    // Default threshold 10 min: the event at 09:50 means away since 09:40.
    expect(await onIdleState(db, 'idle', { api, now: T0 + 50 * MIN })).toBeNull();
    expect(await getIdle(db)).toMatchObject({ since: T0 + 40 * MIN, until: null });
    expect(await notification()).toBeUndefined();
    const pending = await onIdleState(db, 'active', { api, now: T0 + 63 * MIN });
    expect(pending).toMatchObject({ since: T0 + 40 * MIN, until: T0 + 63 * MIN });
    expect(await notification()).toEqual({
      type: 'basic',
      title: 'Time Tracker',
      message: 'You were away 23m (09:40 – 10:03). Open Time Tracker to keep or remove this time.',
    });
  });

  it('treats locked like idle', async () => {
    const { api, db } = await setup();
    await onIdleState(db, 'locked', { api, now: T0 + 50 * MIN });
    expect(await getIdle(db)).not.toBeNull();
  });

  it('shows no notification when the tracker tab or the popup is open', async () => {
    for (const path of ['ui/tracker.html', 'ui/popup.html']) {
      const { api, db, notification } = await setup();
      api.runtime._contexts = [
        {
          contextType: path.includes('popup') ? 'POPUP' : 'TAB',
          documentUrl: `moz-extension://test/${path}?x=1`,
          tabId: 1,
          windowId: 1,
        },
      ];
      await onIdleState(db, 'idle', { api, now: T0 + 50 * MIN });
      expect(await onIdleState(db, 'active', { api, now: T0 + 60 * MIN })).not.toBeNull();
      expect(await notification()).toBeUndefined();
    }
  });

  it('does nothing when off or without a timer', async () => {
    const { api, db, notification } = await setup();
    await updateSettings(db, { idleThresholdMin: 0 });
    await onIdleState(db, 'idle', { api, now: T0 + 50 * MIN });
    expect(await onIdleState(db, 'active', { api, now: T0 + 60 * MIN })).toBeNull();
    await updateSettings(db, { idleThresholdMin: 10 });
    await stop(db, { now: T0 + 61 * MIN });
    await onIdleState(db, 'idle', { api, now: T0 + 80 * MIN });
    expect(await onIdleState(db, 'active', { api, now: T0 + 90 * MIN })).toBeNull();
    expect(await notification()).toBeUndefined();
  });

  it('works without the notifications API and with a mocked idle event source', async () => {
    const { api, db } = await setup();
    delete api.notifications;
    delete api.runtime.getContexts;
    await onIdleState(db, 'idle', { api, now: T0 + 50 * MIN });
    expect(await onIdleState(db, 'active', { api, now: T0 + 60 * MIN })).not.toBeNull();
  });
});

describe('detection interval', () => {
  it('follows the setting while a timer runs', async () => {
    const { api, db } = await setup();
    await syncTimerStatus(db, { api, now: T0 + MIN });
    expect(api.idle._interval).toBe(600);
    await updateSettings(db, { idleThresholdMin: 15 });
    await armIdle(db, { api });
    expect(api.idle._interval).toBe(900);
  });

  it('leaves the interval alone when off or without the permission', async () => {
    const { api, db } = await setup();
    await updateSettings(db, { idleThresholdMin: 0 });
    await armIdle(db, { api });
    expect(api.idle._interval).toBe(60);
    delete api.idle;
    await expect(armIdle(db, { api })).resolves.toBeUndefined();
  });
});

describe('suspend and restart', () => {
  it('a late tick records the gap and asks', async () => {
    const { api, db, notification } = await setup();
    const alarm = { name: 'tt-tick', scheduledTime: T0 + 30 * MIN, periodInMinutes: 1 };
    expect(await checkSleep(db, alarm, { api, now: T0 + 30 * MIN + 5_000 })).toBeNull();
    const pending = await checkSleep(db, alarm, { api, now: T0 + 150 * MIN });
    expect(pending).toMatchObject({ since: T0 + 29 * MIN, until: T0 + 150 * MIN });
    expect((await notification())?.message).toContain('2h 01m');
  });

  it('an idle event before the suspend keeps its earlier start', async () => {
    const { api, db } = await setup();
    await onIdleState(db, 'idle', { api, now: T0 + 40 * MIN }); // since 09:30
    const alarm = { name: 'tt-tick', scheduledTime: T0 + 41 * MIN, periodInMinutes: 1 };
    const pending = await checkSleep(db, alarm, { api, now: T0 + 200 * MIN });
    expect(pending).toMatchObject({ since: T0 + 30 * MIN, until: T0 + 200 * MIN });
  });

  it('Thunderbird quit while away: the absence ends at startup', async () => {
    const { api, db, notification } = await setup();
    await onIdleState(db, 'idle', { api, now: T0 + 50 * MIN });
    // ... Thunderbird quits; the next start is the following morning.
    const nextDay = T0 + 24 * 60 * MIN;
    const pending = await checkIdleOnStartup(db, { api, now: nextDay });
    expect(pending).toMatchObject({ since: T0 + 40 * MIN, until: nextDay });
    expect((await notification())?.message).toContain('Tue\u00a009:40 – Wed\u00a009:00');
  });

  it('a prompt left unanswered is raised again at startup', async () => {
    const { api, db, notification } = await setup();
    await recordIdle(db, { since: T0 + 40 * MIN, until: T0 + 60 * MIN });
    expect(await checkIdleOnStartup(db, { api, now: T0 + 120 * MIN })).toMatchObject({
      until: T0 + 60 * MIN,
    });
    expect(await notification()).toBeDefined();
  });

  it('nothing to do at startup without a record', async () => {
    const { api, db } = await setup();
    expect(await checkIdleOnStartup(db, { api, now: T0 + 120 * MIN })).toBeNull();
  });
});

describe('notification follows the prompt', () => {
  it('is cleared once the prompt is answered', async () => {
    const { api, db, notification } = await setup();
    await onIdleState(db, 'idle', { api, now: T0 + 50 * MIN });
    await onIdleState(db, 'active', { api, now: T0 + 60 * MIN });
    await syncIdleNotification(db, { api });
    expect(await notification()).toBeDefined();
    await resolveIdle(db, 'keep', { now: T0 + 61 * MIN });
    await syncIdleNotification(db, { api });
    expect(await notification()).toBeUndefined();
  });

  it('page changes reach the idle sync', () => {
    const syncStatus = vi.fn();
    const syncIdle = vi.fn();
    for (const type of ['idle', 'entries', 'reset', 'settings']) {
      handleMessage({ type: 'tt:changed', change: { type, ids: ['x'] } }, { syncStatus, syncIdle });
    }
    expect(syncIdle).toHaveBeenCalledTimes(3);
    expect(syncStatus).toHaveBeenCalledTimes(3);
  });
});

describe('background wiring', () => {
  it('idle events and the notification click reach the handlers', async () => {
    /** @type {any} */
    const api = createMessenger({ messages, baseUrl: 'moz-extension://test/' });
    api.runtime._contexts = [];
    vi.stubGlobal('messenger', api);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = await openDB();
    // The global fake-indexeddb is shared by main.js: start from an empty timer.
    await stop(db);
    const tasks = await seed(db);
    await start(db, tasks.checkout.id, { now: Date.now() - 60 * MIN });
    vi.resetModules();
    await import('../../src/background/main.js');
    api.idle._setState('idle');
    api.idle._setState('active');
    await vi.waitFor(async () => {
      expect((await api.notifications.getAll())[IDLE_NOTIFICATION_ID]).toBeDefined();
    });
    const open = vi.spyOn(api.spaces, 'open');
    api.notifications.onClicked.dispatch(IDLE_NOTIFICATION_ID);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    // The shortcut stops the timer: the notification goes with the stale prompt.
    api.commands.onCommand.dispatch('toggle-timer');
    await vi.waitFor(async () => {
      expect((await api.notifications.getAll())[IDLE_NOTIFICATION_ID]).toBeUndefined();
    });
    db.close();
  });
});
