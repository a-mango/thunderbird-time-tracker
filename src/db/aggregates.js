// Per-task entry aggregates cached in `meta.aggregates`, so a page can open without reading every
// entry (docs/PLAN.md, M7 decisions). Every write that adds, changes or removes entries calls
// `touchTasks` in its own transaction, which recomputes the touched tasks from the `taskId` index.
//
// Mismatch: `count` covers every stored entry (soft-deleted and running ones too), so the sum of
// the counts must equal `entries.count()`. Readers check that and the format; when either is off
// (or the cache is missing), they rebuild it with one full scan and store it.
import { storageErrorKind } from '../lib/errors.js';
import { req, tx } from './idb.js';
import { INDEXES, META, STORES } from './schema.js';

/**
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {{count: number, ms: number, last: number | null}} TaskAggregate
 *   `count`: stored entries of the task (all of them). `ms`: summed duration of its live, stopped
 *   entries. `last`: the latest `end` among those, or null.
 * @typedef {{format: number, tasks: Record<string, TaskAggregate>}} Aggregates
 * @typedef {{entries: IDBObjectStore, meta: IDBObjectStore}} AggregateStores
 */

/** Bump when the shape or meaning of `Aggregates` changes: stored ones are then rebuilt. */
export const AGGREGATES_FORMAT = 1;

/** @returns {Aggregates} */
const empty = () => ({ format: AGGREGATES_FORMAT, tasks: Object.create(null) });

/**
 * Adds one entry to an aggregate.
 * @param {TaskAggregate} aggregate
 * @param {Entry} entry
 */
function add(aggregate, entry) {
  aggregate.count += 1;
  if (entry.deletedAt !== null || entry.end === null) return;
  aggregate.ms += Math.max(0, entry.end - entry.start);
  if (aggregate.last === null || entry.end > aggregate.last) aggregate.last = entry.end;
}

/**
 * Aggregates of a set of entries (all stored entries, or one task's).
 * @param {Iterable<Entry>} entries
 * @returns {Aggregates}
 */
export function computeAggregates(entries) {
  const result = empty();
  for (const entry of entries) {
    const aggregate = (result.tasks[entry.taskId] ??= { count: 0, ms: 0, last: null });
    add(aggregate, entry);
  }
  return result;
}

/**
 * Sum of the counts when `value` is a well-formed cache of this format, else -1.
 * @param {unknown} value
 */
function countedEntries(value) {
  if (value === null || typeof value !== 'object') return -1;
  const { format, tasks } = /** @type {Partial<Aggregates>} */ (value);
  if (format !== AGGREGATES_FORMAT || tasks === null || typeof tasks !== 'object') return -1;
  let sum = 0;
  for (const aggregate of Object.values(tasks)) {
    if (
      aggregate === null ||
      typeof aggregate !== 'object' ||
      !Number.isInteger(aggregate.count) ||
      aggregate.count <= 0 ||
      !Number.isFinite(aggregate.ms) ||
      !(aggregate.last === null || Number.isFinite(aggregate.last))
    ) {
      return -1;
    }
    sum += aggregate.count;
  }
  return sum;
}

/**
 * True when `value` is a stored cache of this format whose counts add up to `entryCount`.
 * @param {unknown} value
 * @param {number} entryCount
 * @returns {value is Aggregates}
 */
export function aggregatesMatch(value, entryCount) {
  return entryCount >= 0 && countedEntries(value) === entryCount;
}

/**
 * Recomputes the aggregates of `taskIds` inside the caller's readwrite transaction over
 * `entries` + `meta`. A missing or stale cache is left alone: the next reader rebuilds it.
 * @param {AggregateStores} stores
 * @param {Iterable<string>} taskIds
 */
export async function touchTasks({ entries, meta }, taskIds) {
  /** @type {unknown} */
  const stored = await req(meta.get(META.aggregates));
  if (stored === undefined || stored === null) return;
  const cache = /** @type {Aggregates} */ (stored);
  if (cache.format !== AGGREGATES_FORMAT) return;
  // No prototype: task ids are any strings (`__proto__`, `toString` from an imported backup).
  /** @type {Record<string, TaskAggregate>} */
  const tasks = Object.assign(Object.create(null), cache.tasks);
  for (const taskId of new Set(taskIds)) {
    /** @type {Entry[]} */
    const rows = await req(entries.index(INDEXES.entryTask).getAll(taskId));
    const aggregate = computeAggregates(rows).tasks[taskId];
    if (aggregate) tasks[taskId] = aggregate;
    else delete tasks[taskId];
  }
  await req(meta.put({ format: AGGREGATES_FORMAT, tasks }, META.aggregates));
}

/**
 * Stores aggregates computed from `entries` (restore, wipe, seeding): the caller just wrote them.
 * @param {AggregateStores} stores
 * @param {Iterable<Entry>} entries
 */
export function storeAggregates({ meta }, entries) {
  return req(meta.put(computeAggregates(entries), META.aggregates));
}

/**
 * @typedef {object} RollupState
 * @property {Aggregates} aggregates
 * @property {Entry[]} recent live entries that ended after `since`, plus the running entry
 * @property {Entry | null} running
 * @property {boolean} rebuilt the cache was missing or stale and has been rebuilt
 * @property {boolean} [unsaved] rebuilt in memory only: storing it failed (e.g. a full disk)
 */

/**
 * What a page needs for its badges without reading every entry: the aggregates (rebuilt on a
 * mismatch) and the entries that can count toward today or this week. One snapshot: both come
 * from the same transaction. If storing a rebuilt cache fails (a full disk), the data is still
 * readable: the cache is then computed in memory for this page and rebuilt again next time.
 * @param {IDBDatabase} db
 * @param {number} since lower bound for `end` (exclusive)
 * @returns {Promise<RollupState>}
 */
export async function loadRollupState(db, since) {
  /** @param {'check' | 'store' | 'memory'} rebuild */
  const read = (rebuild) =>
    tx(
      db,
      [STORES.entries, STORES.meta],
      rebuild === 'store' ? 'readwrite' : 'readonly',
      async ({ entries, meta }) => {
        const [stored, count, ended, runningId] = await Promise.all([
          req(meta.get(META.aggregates)),
          req(entries.count()),
          req(entries.index(INDEXES.entryEnd).getAll(IDBKeyRange.lowerBound(since, true))),
          req(meta.get(META.running)),
        ]);
        /** @type {Entry | undefined} */
        const pointed =
          typeof runningId === 'string' ? await req(entries.get(runningId)) : undefined;
        const running =
          pointed && pointed.deletedAt === null && pointed.end === null ? pointed : null;
        let aggregates = aggregatesMatch(stored, count) ? stored : null;
        let rebuilt = false;
        if (!aggregates && rebuild !== 'check') {
          aggregates = computeAggregates(/** @type {Entry[]} */ (await req(entries.getAll())));
          if (rebuild === 'store') await req(meta.put(aggregates, META.aggregates));
          rebuilt = true;
        }
        /** @type {Entry[]} */
        const recent = /** @type {Entry[]} */ (ended).filter((entry) => entry.deletedAt === null);
        if (running) recent.push(running);
        return { aggregates, recent, running, rebuilt, unsaved: rebuild === 'memory' };
      },
    );
  const first = await read('check');
  if (first.aggregates) return /** @type {RollupState} */ (first);
  try {
    return /** @type {RollupState} */ (await read('store'));
  } catch (error) {
    if (storageErrorKind(error) !== 'quota') throw error;
    return /** @type {RollupState} */ (await read('memory'));
  }
}

/**
 * Aggregates as stored (rebuilt on a mismatch).
 * @param {IDBDatabase} db
 * @returns {Promise<Aggregates>}
 */
export async function getAggregates(db) {
  return (await loadRollupState(db, Number.MAX_SAFE_INTEGER)).aggregates;
}

/**
 * @typedef {object} EntryChanges
 * @property {Map<string, Entry | null>} entries the changed entries (`null`: gone or deleted)
 * @property {Aggregates | null} aggregates `null` when the cache doesn't match (reload instead)
 * @property {Entry | null} running
 */

/**
 * After an `entries` change: the changed entries, the aggregates and the running entry, from one
 * snapshot, so a page's window and its aggregates never disagree. Checks the cache's shape but
 * not its count (`entries.count()` costs ~20 ms at 50k entries); opening checks that.
 * @param {IDBDatabase} db
 * @param {Iterable<string>} ids
 * @returns {Promise<EntryChanges>}
 */
export function readEntryChanges(db, ids) {
  return tx(db, [STORES.entries, STORES.meta], 'readonly', async ({ entries, meta }) => {
    /** @type {Map<string, Entry | null>} */
    const changed = new Map();
    for (const id of ids) {
      /** @type {Entry | undefined} */
      const entry = await req(entries.get(id));
      changed.set(id, entry && entry.deletedAt === null ? entry : null);
    }
    const [stored, runningId] = await Promise.all([
      req(meta.get(META.aggregates)),
      req(meta.get(META.running)),
    ]);
    /** @type {Entry | undefined} */
    const pointed = typeof runningId === 'string' ? await req(entries.get(runningId)) : undefined;
    return {
      entries: changed,
      aggregates: countedEntries(stored) >= 0 ? /** @type {Aggregates} */ (stored) : null,
      running: pointed && pointed.deletedAt === null && pointed.end === null ? pointed : null,
    };
  });
}
