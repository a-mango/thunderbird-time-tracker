// Time entries and the running timer (docs/SPEC.md, Data model).
//
// The running timer is the entry with `end === null`. IndexedDB doesn't index `null`, so
// `meta.running` points to it, and every write that starts, stops or removes the running entry
// updates that pointer in the same readwrite transaction over `entries` + `meta`. IndexedDB runs
// readwrite transactions with overlapping scopes one after the other, even across connections, so
// two pages starting timers at once still leave exactly one running entry.
//
// Soft delete: `deletedAt` hides an entry from every query until `restoreEntry`, or until
// `purgeDeleted` (called on Thunderbird start) removes it for good.
import { InvariantError, NotFoundError, TaskDoneError, ValidationError } from '../lib/errors.js';
import { emit, req, tx } from './idb.js';
import { touchTasks } from './aggregates.js';
import { INDEXES, META, STORES } from './schema.js';
import { checkFields, checkId, checkString, checkTime, newId } from './validate.js';

/**
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {import('../lib/types.js').EntrySource} EntrySource
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {{now?: number}} WriteOptions `now` defaults to `Date.now()`
 * @typedef {{entry: Entry, discarded: boolean}} TimerStop
 *   The stopped entry. `discarded` when it was stopped at or before its start and removed instead
 *   (a zero-length entry would break `start < end`).
 * @typedef {{entry: Entry, previous: TimerStop | null}} StartResult
 * @typedef {{stopped: Entry, entry: Entry}} SplitResult
 * @typedef {{entries: IDBObjectStore, meta: IDBObjectStore}} RunningStores
 */

/** @type {readonly EntrySource[]} */
const SOURCES = ['timer', 'manual', 'split', 'idle'];

/** @param {Entry | undefined} entry */
const isLive = (entry) => entry !== undefined && entry.deletedAt === null;

/** @param {Entry[]} entries */
const byStart = (entries) => entries.sort((a, b) => a.start - b.start);

/**
 * @param {unknown} value
 * @param {readonly EntrySource[]} allowed
 * @returns {EntrySource}
 */
function checkSource(value, allowed) {
  if (!allowed.includes(/** @type {EntrySource} */ (value))) {
    throw new ValidationError('source', `source must be one of ${allowed.join(', ')}`);
  }
  return /** @type {EntrySource} */ (value);
}

/**
 * @param {number} start
 * @param {number} end
 */
function checkOrder(start, end) {
  if (!(start < end)) {
    throw new InvariantError('start-end', 'an entry must start before it ends', { start, end });
  }
}

/**
 * Reads the task or throws.
 * @param {IDBObjectStore} tasks
 * @param {string} taskId
 * @returns {Promise<Task>}
 */
async function requireTask(tasks, taskId) {
  const task = await req(tasks.get(taskId));
  if (!task) throw new NotFoundError('task', 'task not found', { id: taskId });
  return task;
}

// Every write below that adds, changes or removes entries calls `touchTasks` (db/aggregates.js)
// for the tasks it touched, inside its own transaction, so `meta.aggregates` stays current.

// ---- Running pointer helpers. Only call them inside a readwrite tx over entries + meta. ----

/**
 * The running entry, or `null`. A stale pointer (entry gone, stopped or deleted) counts as none.
 * @param {RunningStores} stores
 * @returns {Promise<Entry | null>}
 */
export async function readRunning({ entries, meta }) {
  const id = await req(meta.get(META.running));
  if (typeof id !== 'string') return null;
  /** @type {Entry | undefined} */
  const entry = await req(entries.get(id));
  return isLive(entry) && entry?.end === null ? entry : null;
}

/**
 * Stops `entry` (the running one) at `now`, or removes it when `now <= entry.start`, and clears
 * the pointer.
 * @param {RunningStores} stores
 * @param {Entry} entry
 * @param {number} now
 * @returns {Promise<TimerStop>}
 */
export async function stopRunningIn({ entries, meta }, entry, now) {
  await req(meta.put(null, META.running));
  if (now > entry.start) {
    const stopped = { ...entry, end: now, updatedAt: now };
    await req(entries.put(stopped));
    await touchTasks({ entries, meta }, [entry.taskId]);
    return { entry: stopped, discarded: false };
  }
  await req(entries.delete(entry.id));
  await touchTasks({ entries, meta }, [entry.taskId]);
  return { entry, discarded: true };
}

/**
 * Removes every entry (soft-deleted ones too) of the given tasks, clearing the pointer if the
 * running entry is among them. For cascades inside the caller's transaction.
 * @param {RunningStores} stores
 * @param {string[]} taskIds
 * @returns {Promise<string[]>} removed entry ids
 */
export async function removeEntriesOfTasks(stores, taskIds) {
  const running = await req(stores.meta.get(META.running));
  /** @type {string[]} */
  const removed = [];
  for (const taskId of taskIds) {
    const keys = await req(stores.entries.index(INDEXES.entryTask).getAllKeys(taskId));
    for (const key of keys) {
      await req(stores.entries.delete(key));
      removed.push(String(key));
    }
  }
  if (typeof running === 'string' && removed.includes(running)) {
    await req(stores.meta.put(null, META.running));
  }
  await touchTasks(stores, taskIds);
  return removed;
}

// ---- Manual entries ----

/**
 * Adds a stopped entry (manual, or from the idle prompt). Done tasks accept entries too.
 * @param {IDBDatabase} db
 * @param {{taskId: string, start: number, end: number, note?: string, source?: EntrySource}} input
 * @param {WriteOptions} [options]
 * @returns {Promise<Entry>}
 * @throws {ValidationError} bad input, or `end` missing/`null` (a running entry needs startEntry)
 * @throws {InvariantError} `start-end`
 * @throws {NotFoundError} `task`
 */
export async function addEntry(db, input, { now = Date.now() } = {}) {
  const fields = checkFields(input, ['taskId', 'start', 'end', 'note', 'source']);
  const taskId = checkId(fields.taskId, 'taskId');
  const start = checkTime(fields.start, 'start');
  if (fields.end === null || fields.end === undefined) {
    throw new ValidationError('end', 'a manual entry needs an end; start a timer instead');
  }
  const end = checkTime(fields.end, 'end');
  checkOrder(start, end);
  const note = fields.note === undefined ? '' : checkString(fields.note, 'note');
  const source = fields.source === undefined ? 'manual' : checkSource(fields.source, SOURCES);

  /** @type {Entry} */
  const entry = {
    id: newId(),
    taskId,
    start,
    end,
    note,
    source,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async ({ tasks, entries, meta }) => {
      await requireTask(tasks, taskId);
      await req(entries.add(entry));
      await touchTasks({ entries, meta }, [taskId]);
    },
  );
  emit(db, { type: 'entries', ids: [entry.id] });
  return entry;
}

/**
 * Edits an entry. The running entry keeps `end === null` (stop it to end it) and its `start`
 * must stay before `now`; a stopped entry can't become running.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {{start?: number, end?: number, note?: string, taskId?: string}} patch
 * @param {WriteOptions} [options]
 * @returns {Promise<Entry>}
 * @throws {NotFoundError} `entry` (missing or soft-deleted), `task`
 * @throws {InvariantError} `start-end`, `running`
 * @throws {TaskDoneError} moving the running entry to a done task
 */
export async function updateEntry(db, id, patch, { now = Date.now() } = {}) {
  const fields = checkFields(patch, ['start', 'end', 'note', 'taskId']);
  // Only defined keys count, so `{note: undefined}` from a form leaves the note alone.
  /** @type {{start?: number, end?: number|null, note?: string, taskId?: string}} */
  const clean = {};
  if (fields.start !== undefined) clean.start = checkTime(fields.start, 'start');
  if (fields.end !== undefined)
    clean.end = fields.end === null ? null : checkTime(fields.end, 'end');
  if (fields.note !== undefined) clean.note = checkString(fields.note, 'note');
  if (fields.taskId !== undefined) clean.taskId = checkId(fields.taskId, 'taskId');

  const updated = await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async ({ tasks, entries, meta }) => {
      /** @type {Entry | undefined} */
      const entry = await req(entries.get(id));
      if (!entry || !isLive(entry)) throw new NotFoundError('entry', 'entry not found', { id });
      const running = entry.end === null;
      if (running && clean.end !== undefined) {
        throw new InvariantError('running', 'stop the running entry to end it', { id });
      }
      if (!running && clean.end === null) {
        throw new InvariantError('running', 'a stopped entry cannot become running', { id });
      }
      const next = /** @type {Entry} */ ({ ...entry, ...clean, updatedAt: now });
      if (running) {
        if (next.start >= now) throw new ValidationError('start', 'start must be before now');
      } else {
        checkOrder(next.start, /** @type {number} */ (next.end));
      }
      if (next.taskId !== entry.taskId) {
        const task = await requireTask(tasks, next.taskId);
        if (running && task.status === 'done') {
          throw new TaskDoneError('task-done', 'the task is done', { id: task.id });
        }
      }
      await req(entries.put(next));
      await touchTasks({ entries, meta }, [entry.taskId, next.taskId]);
      return next;
    },
  );
  emit(db, { type: 'entries', ids: [id] });
  return updated;
}

/**
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {{includeDeleted?: boolean}} [options]
 * @returns {Promise<Entry | null>} `null` when missing or soft-deleted (unless `includeDeleted`)
 */
export async function getEntry(db, id, { includeDeleted = false } = {}) {
  /** @type {Entry | undefined} */
  const entry = await tx(db, STORES.entries, 'readonly', ({ entries }) => req(entries.get(id)));
  if (!entry) return null;
  return includeDeleted || isLive(entry) ? entry : null;
}

/**
 * Live entries of a task, by start time.
 * @param {IDBDatabase} db
 * @param {string} taskId
 * @returns {Promise<Entry[]>}
 */
export async function listEntriesByTask(db, taskId) {
  /** @type {Entry[]} */
  const all = await tx(db, STORES.entries, 'readonly', ({ entries }) =>
    req(entries.index(INDEXES.entryTask).getAll(taskId)),
  );
  return byStart(all.filter(isLive));
}

/**
 * Every live entry, the running one included, by start time (rollups need all of them).
 * @param {IDBDatabase} db
 * @returns {Promise<Entry[]>}
 */
export async function listEntries(db) {
  /** @type {Entry[]} */
  const all = await tx(db, STORES.entries, 'readonly', ({ entries }) => req(entries.getAll()));
  return byStart(all.filter(isLive));
}

/**
 * Live entries overlapping `[from, to)`: stopped entries with `start < to && end > from`, plus the
 * running entry if it started before `to`. By start time.
 * @param {IDBDatabase} db
 * @param {number} from
 * @param {number} to
 * @returns {Promise<Entry[]>}
 */
export async function listEntriesInRange(db, from, to) {
  checkTime(from, 'from');
  checkTime(to, 'to');
  if (!(from < to)) throw new ValidationError('range', 'from must be before to');
  return tx(db, [STORES.entries, STORES.meta], 'readonly', async (stores) => {
    /** @type {Entry[]} */
    const ended = await req(
      stores.entries.index(INDEXES.entryEnd).getAll(IDBKeyRange.lowerBound(from, true)),
    );
    const found = ended.filter((entry) => isLive(entry) && entry.start < to);
    const running = await readRunning(stores);
    if (running && running.start < to) found.push(running);
    return byStart(found);
  });
}

/**
 * Number of live entries.
 * @param {IDBDatabase} db
 * @returns {Promise<number>}
 */
export function countEntries(db) {
  return tx(db, STORES.entries, 'readonly', async ({ entries }) => {
    const all = await req(entries.count());
    const deleted = await req(entries.index(INDEXES.entryDeleted).count());
    return all - deleted;
  });
}

/**
 * Soft-deletes an entry. A running entry is stopped at `now` first, so a restored entry is never
 * running; if that would leave it zero-length, it is removed outright (nothing to restore).
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {WriteOptions} [options]
 * @returns {Promise<Entry>} the entry with `deletedAt` set
 * @throws {NotFoundError} `entry`
 */
export async function softDeleteEntry(db, id, { now = Date.now() } = {}) {
  const deleted = await tx(db, [STORES.entries, STORES.meta], 'readwrite', async (stores) => {
    /** @type {Entry | undefined} */
    const entry = await req(stores.entries.get(id));
    if (!entry || !isLive(entry)) throw new NotFoundError('entry', 'entry not found', { id });
    let target = entry;
    if (entry.end === null) {
      if ((await req(stores.meta.get(META.running))) === id) {
        await req(stores.meta.put(null, META.running));
      }
      if (now <= entry.start) {
        await req(stores.entries.delete(id));
        await touchTasks(stores, [entry.taskId]);
        return { ...entry, deletedAt: now };
      }
      target = { ...entry, end: now, updatedAt: now };
    }
    const marked = { ...target, deletedAt: now };
    await req(stores.entries.put(marked));
    await touchTasks(stores, [entry.taskId]);
    return marked;
  });
  emit(db, { type: 'entries', ids: [id] });
  return deleted;
}

/**
 * Brings back a soft-deleted entry (until the next Thunderbird start purges it).
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {WriteOptions} [options]
 * @returns {Promise<Entry>}
 * @throws {NotFoundError} `entry` when missing or not deleted
 * @throws {InvariantError} `running` when the stored entry has no end (corrupt data)
 */
export async function restoreEntry(db, id, { now = Date.now() } = {}) {
  const restored = await tx(db, [STORES.entries, STORES.meta], 'readwrite', async (stores) => {
    const { entries } = stores;
    /** @type {Entry | undefined} */
    const entry = await req(entries.get(id));
    if (!entry || entry.deletedAt === null) {
      throw new NotFoundError('entry', 'no deleted entry with this id', { id });
    }
    // Soft delete stops a running entry first, so only corrupt data gets here; restoring it
    // would add a running entry the pointer doesn't know about.
    if (entry.end === null) {
      throw new InvariantError('running', 'a deleted entry cannot be running', { id });
    }
    const next = { ...entry, deletedAt: null, updatedAt: now };
    await req(entries.put(next));
    await touchTasks(stores, [entry.taskId]);
    return next;
  });
  emit(db, { type: 'entries', ids: [id] });
  return restored;
}

/**
 * Removes every soft-deleted entry for good. Called on `runtime.onStartup` only, which ends the
 * undo window ("until the next session").
 * @param {IDBDatabase} db
 * @returns {Promise<string[]>} purged ids
 */
export async function purgeDeleted(db) {
  const ids = await tx(db, [STORES.entries, STORES.meta], 'readwrite', async (stores) => {
    /** @type {Entry[]} */
    const deleted = await req(stores.entries.index(INDEXES.entryDeleted).getAll());
    for (const entry of deleted) await req(stores.entries.delete(entry.id));
    await touchTasks(
      stores,
      deleted.map((entry) => entry.taskId),
    );
    return deleted.map((entry) => entry.id);
  });
  emit(db, { type: 'entries', ids });
  return ids;
}

// ---- Timer primitives (see lib/timer.js for the high-level API) ----

/**
 * The running entry, or `null`.
 * @param {IDBDatabase} db
 * @returns {Promise<Entry | null>}
 */
export function getRunning(db) {
  return tx(db, [STORES.entries, STORES.meta], 'readonly', (stores) => readRunning(stores));
}

/**
 * Starts a timer on a task in one transaction: checks the task is open, stops the running entry
 * at `now` (same instant as the new start; removed if that would be zero-length), adds the new
 * running entry and moves the pointer. Starting the task that is already running is a no-op.
 * @param {IDBDatabase} db
 * @param {string} taskId
 * @param {WriteOptions & {source?: 'timer'|'idle', note?: string}} [options]
 * @returns {Promise<StartResult>}
 * @throws {NotFoundError} `task`
 * @throws {TaskDoneError} `task-done`
 */
export async function startEntry(
  db,
  taskId,
  { now = Date.now(), source = 'timer', note = '' } = {},
) {
  checkId(taskId, 'taskId');
  checkTime(now, 'now');
  checkSource(source, ['timer', 'idle']);
  checkString(note, 'note');

  const result = await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async ({ tasks, entries, meta }) => {
      const task = await requireTask(tasks, taskId);
      if (task.status === 'done') {
        throw new TaskDoneError('task-done', 'reopen the task to start it', { id: taskId });
      }
      const running = await readRunning({ entries, meta });
      if (running?.taskId === taskId) return { entry: running, previous: null, changed: false };
      const previous = running ? await stopRunningIn({ entries, meta }, running, now) : null;
      /** @type {Entry} */
      const entry = {
        id: newId(),
        taskId,
        start: now,
        end: null,
        note,
        source,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await req(entries.add(entry));
      await req(meta.put(entry.id, META.running));
      await touchTasks({ entries, meta }, [taskId]);
      return { entry, previous, changed: true };
    },
  );
  if (result.changed) {
    const ids = result.previous ? [result.previous.entry.id, result.entry.id] : [result.entry.id];
    emit(db, { type: 'entries', ids });
  }
  return { entry: result.entry, previous: result.previous };
}

/**
 * Stops the running entry at `now`, or at an earlier `at` ("I stopped working at 17:30").
 * Without `at`, an entry that would be zero-length is discarded; an explicit `at` must be in
 * `(running.start, now]`, so a running entry never gets an end in the future.
 * @param {IDBDatabase} db
 * With `id`, only that entry is stopped: a dialog opened on it must not stop another one that
 * started meanwhile.
 * @param {WriteOptions & {at?: number, id?: string}} [options]
 * @returns {Promise<TimerStop | null>} `null` when nothing was running
 * @throws {ValidationError} `end` when `at` is outside `(running.start, now]`
 * @throws {NotFoundError} `running` when `id` is given and isn't the running entry
 */
export async function stopRunning(db, { now = Date.now(), at, id } = {}) {
  if (at !== undefined) checkTime(at, 'end');
  const stop = await tx(db, [STORES.entries, STORES.meta], 'readwrite', async (stores) => {
    const running = await readRunning(stores);
    if (id !== undefined && running?.id !== id) {
      throw new NotFoundError('running', 'that entry is no longer running', { id });
    }
    if (!running) return null;
    if (at === undefined) return stopRunningIn(stores, running, now);
    if (at <= running.start || at > now) {
      throw new ValidationError('end', 'the end must be after the start and not later than now', { at }); // prettier-ignore
    }
    await req(stores.meta.put(null, META.running));
    const stopped = { ...running, end: at, updatedAt: now };
    await req(stores.entries.put(stopped));
    await touchTasks(stores, [running.taskId]);
    return { entry: stopped, discarded: false };
  });
  if (stop) emit(db, { type: 'entries', ids: [stop.entry.id] });
  return stop;
}

/**
 * Ends the running entry at `at` and starts a new running entry (source `split`) at `at`, for
 * the same task or for `taskId` (which must be open).
 * @param {IDBDatabase} db
 * @param {number} at must be in `(running.start, now]`
 * @param {WriteOptions & {taskId?: string, id?: string}} [options] with `id`, only if that entry
 *   is still the running one
 * @returns {Promise<SplitResult>}
 * @throws {NotFoundError} `running`, `task`
 * @throws {ValidationError} `split-at`
 * @throws {TaskDoneError} `task-done` when `taskId` is done
 */
export async function splitRunning(db, at, { now = Date.now(), taskId, id } = {}) {
  checkTime(at, 'split-at');
  if (taskId !== undefined) checkId(taskId, 'taskId');
  const result = await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async (stores) => {
      const running = await readRunning(stores);
      if (!running || (id !== undefined && running.id !== id)) {
        throw new NotFoundError('running', 'no timer is running', { id });
      }
      if (at <= running.start || at > now) {
        throw new ValidationError('split-at', 'split point must be after the start and not later than now', { at }); // prettier-ignore
      }
      const target = taskId ?? running.taskId;
      if (target !== running.taskId) {
        const task = await requireTask(stores.tasks, target);
        if (task.status === 'done') {
          throw new TaskDoneError('task-done', 'reopen the task to track it', { id: target });
        }
      }
      const stopped = { ...running, end: at, updatedAt: now };
      /** @type {Entry} */
      const entry = {
        id: newId(),
        taskId: target,
        start: at,
        end: null,
        note: '',
        source: 'split',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await req(stores.entries.put(stopped));
      await req(stores.entries.add(entry));
      await req(stores.meta.put(entry.id, META.running));
      await touchTasks(stores, [running.taskId, target]);
      return { stopped, entry };
    },
  );
  emit(db, { type: 'entries', ids: [result.stopped.id, result.entry.id] });
  return result;
}

/**
 * Splits a stopped entry at `at`: it keeps its id and ends at `at`; a new entry (source `split`,
 * same note) covers `[at, end)`, for the same task or for `taskId`. Done tasks accept it, like
 * manual entries.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {number} at must be in `(entry.start, entry.end)`
 * @param {WriteOptions & {taskId?: string}} [options]
 * @returns {Promise<SplitResult>}
 * @throws {NotFoundError} `entry`, `task`
 * @throws {InvariantError} `running` for the running entry (use `splitRunning`)
 * @throws {ValidationError} `split-at`
 */
export async function splitEntry(db, id, at, { now = Date.now(), taskId } = {}) {
  checkTime(at, 'split-at');
  if (taskId !== undefined) checkId(taskId, 'taskId');
  const result = await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async ({ tasks, entries, meta }) => {
      /** @type {Entry | undefined} */
      const entry = await req(entries.get(id));
      if (!entry || !isLive(entry)) throw new NotFoundError('entry', 'entry not found', { id });
      if (entry.end === null) {
        throw new InvariantError('running', 'split the running entry with splitRunning', { id });
      }
      if (at <= entry.start || at >= entry.end) {
        throw new ValidationError('split-at', 'split point must be inside the entry', { at });
      }
      const target = taskId ?? entry.taskId;
      if (target !== entry.taskId) await requireTask(tasks, target);
      const stopped = { ...entry, end: at, updatedAt: now };
      /** @type {Entry} */
      const second = {
        id: newId(),
        taskId: target,
        start: at,
        end: entry.end,
        note: entry.note,
        source: 'split',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await req(entries.put(stopped));
      await req(entries.add(second));
      await touchTasks({ entries, meta }, [entry.taskId, target]);
      return { stopped, entry: second };
    },
  );
  emit(db, { type: 'entries', ids: [result.stopped.id, result.entry.id] });
  return result;
}

/**
 * The open task with the most recently ended live entry (what `toggle-timer` starts), or `null`.
 * @param {IDBDatabase} db
 * @returns {Promise<Task | null>}
 */
export async function lastTrackedTask(db) {
  const [task] = await recentTasks(db, { limit: 1 });
  return task ?? null;
}

/**
 * Tasks by their most recently ended live entry, newest first (the popup's recent list). Walks
 * the `end` index backwards and stops after `limit` accepted tasks.
 * @param {IDBDatabase} db
 * @param {{limit: number, accept?: (task: Task) => boolean}} options `accept` defaults to open
 *   tasks
 * @returns {Promise<Task[]>}
 */
export function recentTasks(db, { limit, accept = (task) => task.status === 'open' }) {
  return tx(db, [STORES.tasks, STORES.entries], 'readonly', ({ tasks, entries }) => {
    const seen = new Set();
    /** @type {Task[]} */
    const found = [];
    return new Promise((resolve, reject) => {
      if (limit <= 0) return resolve(found);
      const cursorRequest = entries.index(INDEXES.entryEnd).openCursor(null, 'prev');
      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = async () => {
        const cursor = cursorRequest.result;
        if (!cursor) return resolve(found);
        /** @type {Entry} */
        const entry = cursor.value;
        if (isLive(entry) && !seen.has(entry.taskId)) {
          seen.add(entry.taskId);
          try {
            /** @type {Task | undefined} */
            const task = await req(tasks.get(entry.taskId));
            if (task && accept(task)) {
              found.push(task);
              if (found.length >= limit) return resolve(found);
            }
          } catch (error) {
            return reject(error);
          }
        }
        cursor.continue();
      };
    });
  });
}

/**
 * Throws the running entry away (hard delete; there is nothing to restore).
 * @param {IDBDatabase} db
 * @returns {Promise<Entry | null>} the removed entry, `null` when nothing was running
 */
export async function discardRunning(db) {
  const removed = await tx(db, [STORES.entries, STORES.meta], 'readwrite', async (stores) => {
    const running = await readRunning(stores);
    if (!running) return null;
    await req(stores.entries.delete(running.id));
    await req(stores.meta.put(null, META.running));
    await touchTasks(stores, [running.taskId]);
    return running;
  });
  if (removed) emit(db, { type: 'entries', ids: [removed.id] });
  return removed;
}

/**
 * Moves the start of the running entry.
 * @param {IDBDatabase} db
 * @param {number} start must be before `now`
 * @param {WriteOptions} [options]
 * @returns {Promise<Entry>}
 * @throws {ValidationError} `start`
 * @throws {NotFoundError} `running`
 */
export async function adjustRunningStart(db, start, { now = Date.now() } = {}) {
  checkTime(start, 'start');
  if (start >= now) throw new ValidationError('start', 'start must be before now', { start });
  const updated = await tx(db, [STORES.entries, STORES.meta], 'readwrite', async (stores) => {
    const running = await readRunning(stores);
    if (!running) throw new NotFoundError('running', 'no timer is running');
    const next = { ...running, start, updatedAt: now };
    await req(stores.entries.put(next));
    return next;
  });
  emit(db, { type: 'entries', ids: [updated.id] });
  return updated;
}
