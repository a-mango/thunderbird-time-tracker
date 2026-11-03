// The tracker page's view of the database: projects, tasks, settings and an incremental rollup,
// kept current from this page's own writes and from other pages (BroadcastChannel 'tt').
import {
  CHANNEL_NAME,
  getEntry,
  getRunning,
  getSettings,
  getTask,
  listEntries,
  listProjects,
  listTasks,
  notifyChanged,
  openDB,
} from '../db/index.js';
import { createRollup } from '../lib/rollup.js';

/**
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {import('../lib/types.js').Settings} Settings
 * @typedef {import('../db/changes.js').Change} Change
 * @typedef {import('../db/changes.js').ChangeType} ChangeType
 */

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

  /** Reads everything and rebuilds the rollup (opening, and after a restore or wipe). */
  async #load() {
    const [projects, tasks, entries, settings, running] = await Promise.all([
      listProjects(this.db),
      listTasks(this.db),
      listEntries(this.db),
      getSettings(this.db),
      getRunning(this.db),
    ]);
    this.projects = projects;
    this.tasks = new Map(tasks.map((task) => [task.id, task]));
    this.settings = settings;
    this.running = running;
    this.rollup = createRollup(
      { projects, tasks, entries },
      { now: this.now(), weekStart: settings.weekStart },
    );
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
      for (const id of pending.get('entries') ?? []) {
        const entry = await getEntry(db, id);
        if (entry) rollup.upsertEntry(entry);
        else rollup.removeEntry(id);
      }
      this.running = await getRunning(db);
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
