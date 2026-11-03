import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_ID,
  TICK_ALARM,
  syncTimerStatus,
  toggleTimer,
} from '../../src/background/timer-status.js';
import { ensureSpace } from '../../src/background/space.js';
import { addEntry } from '../../src/db/entries.js';
import { updateTask } from '../../src/db/tasks.js';
import { start, stop } from '../../src/lib/timer.js';
import { createMessenger } from '../../dev/mock-messenger.js';
import { MIN, T0, freshDB, seed } from './db-helpers.js';

const messages = {
  spaceTitle: { message: 'Time Tracker' },
  extensionName: { message: 'Time Tracker' },
  notificationNoLastTask: { message: 'No task to start yet.' },
};

async function setup() {
  /** @type {any} */
  const api = createMessenger({ messages, baseUrl: 'moz-extension://test/' });
  const space = await ensureSpace(api);
  const { db } = await freshDB();
  const tasks = await seed(db);
  /** What Thunderbird shows: the label, badges (none) and the alarm. */
  const status = async () => ({
    label: await api.action.getLabel({}),
    badge: await api.action.getBadgeText({}),
    spaceBadge: api.spaces._props(space.id).button.badgeText,
    alarm: (await api.alarms.get(TICK_ALARM)) ?? null,
  });
  return { api, db, tasks, status, space };
}

describe('syncTimerStatus', () => {
  it('shows the label and a minute alarm while a timer runs, and no badges', async () => {
    const { api, db, tasks, status, space } = await setup();
    await start(db, tasks.checkout.id, { now: T0 });
    const now = T0 + 65 * MIN + 30_000;
    expect(await syncTimerStatus(db, { api, now })).toBe('running');
    expect(await status()).toEqual({
      label: '1:05 · Checkout form va…',
      badge: '',
      spaceBadge: undefined,
      alarm: { name: TICK_ALARM, scheduledTime: T0 + 66 * MIN, periodInMinutes: 1 },
    });
    // The space is left alone.
    expect(api.spaces._props(space.id)).toEqual({
      url: 'moz-extension://test/ui/tracker.html',
      button: { title: 'Time Tracker' },
    });
  });

  it('clears the label and the alarm when stopped', async () => {
    const { api, db, tasks, status } = await setup();
    await start(db, tasks.pipeline.id, { now: T0 });
    await syncTimerStatus(db, { api, now: T0 + MIN });
    await stop(db, { now: T0 + 2 * MIN });
    expect(await syncTimerStatus(db, { api, now: T0 + 2 * MIN })).toBe('stopped');
    expect(await status()).toEqual({ label: null, badge: '', spaceBadge: undefined, alarm: null });
  });

  it('follows a renamed running task', async () => {
    const { api, db, tasks } = await setup();
    await start(db, tasks.bookkeeping.id, { now: T0 });
    await updateTask(db, tasks.bookkeeping.id, { name: 'Taxes' });
    expect(await syncTimerStatus(db, { api, now: T0 + 9 * MIN })).toBe('running');
    expect(await api.action.getLabel({})).toBe('0:09 · Taxes');
  });

  it('restores the status from the database alone (restart)', async () => {
    const { db, tasks, status } = await setup();
    await start(db, tasks.checkout.id, { now: T0 });
    // A new background (fresh mock state) after Thunderbird was closed for 2 minutes.
    /** @type {any} */
    const restarted = createMessenger({ messages, baseUrl: 'moz-extension://test/' });
    await syncTimerStatus(db, { api: restarted, now: T0 + 2 * MIN + 1 });
    expect(await restarted.action.getLabel({})).toBe('0:02 · Checkout form va…');
    expect(await restarted.alarms.get(TICK_ALARM)).toMatchObject({ periodInMinutes: 1 });
    expect((await status()).label).toBeNull(); // the old instance was never synced
  });
});

describe('toggleTimer (Alt+Shift+K)', () => {
  it('stops the running timer, then starts the task tracked last', async () => {
    const { api, db, tasks, status } = await setup();
    await start(db, tasks.pipeline.id, { now: T0 });
    expect((await toggleTimer(db, { api, now: T0 + 10 * MIN })).action).toBe('stopped');
    expect((await status()).alarm).toBeNull();
    const started = await toggleTimer(db, { api, now: T0 + 20 * MIN });
    expect(started).toMatchObject({
      action: 'started',
      start: { entry: { taskId: tasks.pipeline.id } },
    });
    expect((await status()).label).toBe('0:00 · Product image pi…');
    expect(await api.notifications.getAll()).toEqual({});
  });

  it('notifies only when no task was ever tracked', async () => {
    const { api, db, tasks, status } = await setup();
    expect((await toggleTimer(db, { api, now: T0 })).action).toBe('none');
    expect(await api.notifications.getAll()).toEqual({
      [NOTIFICATION_ID]: { type: 'basic', title: 'Time Tracker', message: 'No task to start yet.' },
    });
    expect((await status()).label).toBeNull();
    await addEntry(db, { taskId: tasks.checkout.id, start: T0, end: T0 + MIN });
    expect((await toggleTimer(db, { api, now: T0 + 2 * MIN })).action).toBe('started');
  });
});
