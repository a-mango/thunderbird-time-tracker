// The tracker page's view of the database: projects, tasks, settings and an incremental rollup,
// kept current from this page's own writes and from other pages (BroadcastChannel 'tt').
import { loadRollupState, readEntryChanges } from '../db/aggregates.js';
import {
  CHANNEL_NAME,
  getSettings,
  getTask,
  listProjects,
  listTasks,
  notifyChanged,
  openDB,
} from '../db/index.js';
import { createRollup } from '../lib/rollup.js';
import { startOfDay } from '../lib/time.js';

/**
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {import('../lib/types.js').Settings} Settings
 * @typedef {import('../db/changes.js').Change} Change
 * @typedef {import('../db/changes.js').ChangeType} ChangeType
 */

/**
 * Lower bound of the entry window: entries that ended before it can't count toward today or this
 * week for any week start (7 days back from today's midnight), so `meta.aggregates` covers them.
 * @param {number} now
 */
export const windowStart = (now) => startOfDay(now, -7);

/**
 * Fires `change` (detail: {types: Set<ChangeType | 'time'>}) after the state changed, and
 * `closed` when another page upgraded or deleted the database (this connection closed itself).
 */
export class TrackerData extends EventTarget {
  /** @type {Project[]} in tree order, archived ones included */
  projects = [];
  /** @type {Map<string, Task>} */
  tasks = new Map();
  /** @type {Entry | null} */
  running = null;
  /** @type {Settings} */
  settings;
  /** @type {import('../lib/rollup.js').Rollup} */
  rollup;
  /** @type {IDBDatabase} */
  db;

  /** Changes waiting for the next refresh, by type. */
  /** @type {Map<ChangeType, Set<string>>} */
  #pending = new Map();
  /** @type {Promise<void>} */
  #refreshing = Promise.resolve();
  #scheduled = false;
  /** @type {BroadcastChannel | null} */
  #channel = null;
  /** Window lower bound (`windowStart` at the last load). */
  #since = 0;
  /** Ids of the entries in the rollup. */
  /** @type {Set<string>} */
  #windowIds = new Set();

  /**
   * Opens the database and loads everything the sidebar needs.
   * @param {{now?: () => number}} [options]
   */
  static async open({ now = Date.now } = {}) {
    const data = new TrackerData(now);
    data.db = await openDB({
      // Own writes: apply here (BroadcastChannel never echoes to the sender), then tell the rest.
      notify: (change) => {
        data.#queue(change);
        return notifyChanged(change);
      },
      onVersionChange: () => data.dispatchEvent(new Event('closed')),
    });
    await data.#load();
    if (typeof BroadcastChannel === 'function') {
      data.#channel = new BroadcastChannel(CHANNEL_NAME);
      data.#channel.onmessage = (event) => data.#queue(event.data);
    }
    return data;
  }

  /** @param {() => number} now */
  constructor(now) {
    super();
    this.now = now;
    // Assigned by open() before anyone reads them.
    this.settings = /** @type {Settings} */ ({});
    this.rollup = /** @type {any} */ (null);
    this.db = /** @type {any} */ (null);
  }

  /**
   * Reads projects, tasks, settings, the aggregates and the recent entries, and rebuilds the
   * rollup (opening, after a restore or wipe, and when the aggregates stopped matching).
   */
  async #load() {
    const now = this.now();
    this.#since = windowStart(now);
    const [projects, tasks, settings, state] = await Promise.all([
      listProjects(this.db),
      listTasks(this.db),
      getSettings(this.db),
      loadRollupState(this.db, this.#since),
    ]);
    this.projects = projects;
    this.tasks = new Map(tasks.map((task) => [task.id, task]));
    this.settings = settings;
    this.running = state.running;
    this.#windowIds = new Set(state.recent.map((entry) => entry.id));
    this.rollup = createRollup(
      { projects, tasks, entries: state.recent, aggregates: state.aggregates.tasks },
      { now, weekStart: settings.weekStart },
    );
  }

  /**
   * Whether an entry belongs in the rollup's window.
   * @param {Entry} entry
   */
  #inWindow(entry) {
    return entry.end === null || entry.end > this.#since;
  }

  /** @param {string} id */
  project(id) {
    return this.projects.find((project) => project.id === id);
  }

  /** Project id of the running entry's task, or null. */
  get runningProjectId() {
    return this.running ? (this.tasks.get(this.running.taskId)?.projectId ?? null) : null;
  }

  /** Advances running time (and rolls over day and week) in the badges. */
  tick() {
    this.rollup.setNow(this.now());
    this.#emit(new Set(['time']));
  }

  /** Resolves once queued changes are applied (tests and callers that need fresh state). */
  async settled() {
    while (this.#scheduled || this.#pending.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await this.#refreshing;
    }
    await this.#refreshing;
  }

  close() {
    this.#channel?.close();
    this.db.close();
  }

  /** @param {unknown} message a Change from db/ (own write or another page) */
  #queue(message) {
    const change = /** @type {Change} */ (message);
    if (!change || !Array.isArray(change.ids)) return;
    const ids = this.#pending.get(change.type) ?? new Set();
    for (const id of change.ids) ids.add(id);
    this.#pending.set(change.type, ids);
    if (this.#scheduled) return;
    this.#scheduled = true;
    // One refresh for a burst (a cascade delete posts three changes).
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#refreshing = this.#refreshing.then(() => this.#refresh()).catch(logRefreshError);
    });
  }

  async #refresh() {
    const pending = this.#pending;
    this.#pending = new Map();
    if (pending.size === 0) return;
    if (pending.has('reset')) {
      await this.#load();
      this.#emit(new Set(['reset', 'projects', 'tasks', 'entries', 'settings']));
      return;
    }
    const { db, rollup } = this;
    if (pending.has('settings')) {
      const settings = await getSettings(db);
      if (settings.weekStart !== this.settings.weekStart) rollup.setWeekStart(settings.weekStart);
      this.settings = settings;
    }
    if (pending.has('projects')) {
      const projects = await listProjects(db);
      const kept = new Set(projects.map((project) => project.id));
      for (const project of this.projects)
        if (!kept.has(project.id)) rollup.removeProject(project.id);
      for (const project of projects) rollup.upsertProject(project);
      this.projects = projects;
    }
    for (const id of pending.get('tasks') ?? []) {
      const task = await getTask(db, id);
      if (task) {
        this.tasks.set(id, task);
        rollup.upsertTask(task);
      } else {
        this.tasks.delete(id);
        rollup.removeTask(id);
      }
    }
    if (pending.has('entries')) {
      const changes = await readEntryChanges(db, pending.get('entries') ?? []);
      if (!changes.aggregates) {
        // Written behind the cache's back: reload, which rebuilds it.
        await this.#load();
        this.#emit(new Set(pending.keys()));
        return;
      }
      for (const [id, entry] of changes.entries) {
        if (entry && this.#inWindow(entry)) {
          rollup.upsertEntry(entry);
          this.#windowIds.add(id);
        } else if (this.#windowIds.delete(id)) {
          rollup.removeEntry(id);
        }
      }
      rollup.setAggregates(changes.aggregates.tasks);
      this.running = changes.running;
    }
    rollup.setNow(this.now());
    this.#emit(new Set(pending.keys()));
  }

  /** @param {Set<ChangeType | 'time'>} types */
  #emit(types) {
    this.dispatchEvent(new CustomEvent('change', { detail: { types } }));
  }
}

/** @param {unknown} error */
function logRefreshError(error) {
  console.error('time tracker: refreshing after a change failed', error);
}
