// Today/Week/Total per task and per project (all descendants, archived ones included), as a
// one-shot computation and as an incrementally updated rollup for the views.
import { dayRange, overlapMs, weekRange } from './time.js';

/** @typedef {import('./time.js').WeekStart} WeekStart */
/** @typedef {import('./time.js').Range} Range */
/** @typedef {{today: number, week: number, total: number}} Totals durations in ms */
/** @typedef {{id: string, parentId: string | null, archived?: boolean}} RollupProject */
/** @typedef {{id: string, projectId: string}} RollupTask */
/**
 * @typedef {{id: string, taskId: string, start: number, end: number | null,
 *            deletedAt?: number | null}} RollupEntry
 */
/**
 * @typedef {{ms: number, last: number | null}} TaskAggregate all-time sum of a task's live,
 *   stopped entries and their latest end (db/aggregates.js)
 * @typedef {{projects: RollupProject[], tasks: RollupTask[], entries: RollupEntry[],
 *            aggregates?: Record<string, TaskAggregate>}} RollupData
 *   Full records (`Project`, `Task`, `Entry`) fit; only these fields are read. With `aggregates`,
 *   `entries` may be a recent window only (every entry that can count toward today or this week):
 *   older entries reach `total` and `last` through the aggregates.
 * @typedef {{now: number, weekStart: WeekStart}} RollupOptions
 * @typedef {{tasks: Map<string, Totals>, projects: Map<string, Totals>}} RollupResult
 * @typedef {{now: number, day: Range, week: Range}} Ranges
 */

/** @returns {Totals} */
const zero = () => ({ today: 0, week: 0, total: 0 });

/**
 * @param {Totals} target
 * @param {Totals} delta
 * @param {1 | -1} sign
 */
function addTo(target, delta, sign) {
  target.today += sign * delta.today;
  target.week += sign * delta.week;
  target.total += sign * delta.total;
}

/**
 * @param {number} now
 * @param {WeekStart} weekStart
 * @returns {Ranges}
 */
function rangesFor(now, weekStart) {
  return { now, day: dayRange(now), week: weekRange(now, weekStart) };
}

/**
 * What one entry adds to its task. Soft-deleted entries add nothing; running ones run to `now`.
 * @param {RollupEntry} entry
 * @param {Ranges} ranges
 * @returns {Totals}
 */
function entryTotals(entry, ranges) {
  if (entry.deletedAt !== null && entry.deletedAt !== undefined) return zero();
  const end = entry.end ?? ranges.now;
  return {
    today: overlapMs(entry.start, end, ranges.day.start, ranges.day.end),
    week: overlapMs(entry.start, end, ranges.week.start, ranges.week.end),
    total: Math.max(0, end - entry.start),
  };
}

/**
 * Known project ids from `projectId` up to its root. Stops at a missing parent (the orphan is
 * then a root) and at the first repeated id, so a parent cycle can't loop forever.
 * @param {string | null} projectId
 * @param {Map<string, RollupProject>} projects
 */
function* ancestors(projectId, projects) {
  const seen = new Set();
  let id = projectId;
  while (id !== null && !seen.has(id)) {
    const project = projects.get(id);
    if (!project) return;
    seen.add(id);
    yield id;
    id = project.parentId ?? null;
  }
}

/**
 * Totals for every known task and project. Entries of unknown tasks and tasks of unknown
 * projects are left out of project totals; unknown ids get no row.
 * @param {RollupData} data
 * @param {RollupOptions} options
 * @returns {RollupResult}
 */
export function computeRollup({ projects, tasks, entries }, { now, weekStart }) {
  const ranges = rangesFor(now, weekStart);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  /** @type {Map<string, Totals>} */
  const taskTotals = new Map(tasks.map((t) => [t.id, zero()]));
  for (const entry of entries) {
    const totals = taskTotals.get(entry.taskId);
    if (totals) addTo(totals, entryTotals(entry, ranges), 1);
  }
  /** @type {Map<string, Totals>} */
  const projectTotals = new Map(projects.map((p) => [p.id, zero()]));
  for (const task of taskById.values()) {
    const totals = /** @type {Totals} */ (taskTotals.get(task.id));
    for (const id of ancestors(task.projectId, projectById)) {
      addTo(/** @type {Totals} */ (projectTotals.get(id)), totals, 1);
    }
  }
  return { tasks: taskTotals, projects: projectTotals };
}

/**
 * Projects to show in views: not archived and without an archived ancestor. Keeps the order.
 * @template {RollupProject} P
 * @param {P[]} projects
 * @returns {P[]}
 */
export function visibleProjects(projects) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return projects.filter((project) => {
    for (const id of ancestors(project.id, byId)) {
      if (byId.get(id)?.archived) return false;
    }
    return true;
  });
}

/**
 * @typedef {object} Rollup
 * @property {(id: string) => Totals} task totals of a task (zeros if unknown)
 * @property {(id: string) => Totals} project totals of a project and all its descendants
 * @property {() => RollupResult} snapshot same shape as `computeRollup`
 * @property {(id: string) => number | null} last when the task was last tracked: the latest end
 *   of its live entries (`now` while one runs), or null if it has none
 * @property {(entry: RollupEntry) => void} upsertEntry
 * @property {(id: string) => void} removeEntry
 * @property {(task: RollupTask) => void} upsertTask also moves a task between projects
 * @property {(id: string) => void} removeTask
 * @property {(project: RollupProject) => void} upsertProject also reparents
 * @property {(id: string) => void} removeProject
 * @property {(now: number) => void} setNow advances running entries; rolls over day and week
 * @property {(weekStart: WeekStart) => void} setWeekStart
 * @property {(aggregates: Record<string, TaskAggregate>) => void} setAggregates new all-time
 *   aggregates (after a change); entries in the window must be current first
 */

/**
 * Incremental rollup. An entry change touches its task and that task's ancestor chain; a
 * reparent moves the subtree's totals between two chains. Adding or removing a project, or a
 * day rollover in `setNow`, recomputes from cached data. Always equal to `computeRollup`.
 * @param {RollupData} data
 * @param {RollupOptions} options
 * @returns {Rollup}
 */
export function createRollup(data, { now, weekStart }) {
  let ranges = rangesFor(now, weekStart);
  let currentWeekStart = weekStart;
  /** @type {Map<string, RollupProject>} */
  const projects = new Map();
  /** @type {Map<string, RollupTask>} */
  const tasks = new Map();
  /** @type {Map<string, RollupEntry>} */
  const entries = new Map();
  /** Ids of running, not deleted entries: the only ones whose totals depend on `now`. */
  const running = new Set();
  /** Entry ids by task id, for `last`. */
  /** @type {Map<string, Set<string>>} */
  const byTask = new Map();
  /** Entry sums by task id, including tasks not (yet) known. */
  /** @type {Map<string, Totals>} */
  let sums = new Map();
  /** @type {Map<string, Totals>} */
  let projectTotals = new Map();
  /** Per task: the part of the aggregates outside the window (older entries). */
  /** @type {Map<string, TaskAggregate>} */
  const base = new Map();

  /** @param {string} taskId */
  const sumOf = (taskId) => sums.get(taskId) ?? zero();

  /**
   * Summed duration of the task's live, stopped entries in the window.
   * @param {string} taskId
   */
  function windowMs(taskId) {
    let ms = 0;
    for (const entryId of byTask.get(taskId) ?? []) {
      const entry = /** @type {RollupEntry} */ (entries.get(entryId));
      if (entry.end !== null && (entry.deletedAt === null || entry.deletedAt === undefined)) {
        ms += Math.max(0, entry.end - entry.start);
      }
    }
    return ms;
  }

  /**
   * Sets a task's older part from its all-time aggregate, adjusting its totals and chain.
   * @param {string} taskId
   * @param {TaskAggregate | undefined} aggregate
   */
  function applyAggregate(taskId, aggregate) {
    const old = base.get(taskId) ?? { ms: 0, last: null };
    const next = aggregate
      ? { ms: Math.max(0, aggregate.ms - windowMs(taskId)), last: aggregate.last }
      : { ms: 0, last: null };
    if (next.ms === 0 && next.last === null) base.delete(taskId);
    else base.set(taskId, next);
    const delta = next.ms - old.ms;
    if (delta === 0) return;
    let totals = sums.get(taskId);
    if (!totals) sums.set(taskId, (totals = zero()));
    totals.total += delta;
    const task = tasks.get(taskId);
    if (task) applyToChain(task.projectId, { today: 0, week: 0, total: delta }, 1);
  }

  /**
   * @param {string | null} projectId
   * @param {Totals} delta
   * @param {1 | -1} sign
   */
  function applyToChain(projectId, delta, sign) {
    for (const id of ancestors(projectId, projects)) {
      addTo(/** @type {Totals} */ (projectTotals.get(id)), delta, sign);
    }
  }

  /**
   * @param {RollupEntry} entry
   * @param {1 | -1} sign
   */
  function applyEntry(entry, sign) {
    const delta = entryTotals(entry, ranges);
    let totals = sums.get(entry.taskId);
    if (!totals) sums.set(entry.taskId, (totals = zero()));
    addTo(totals, delta, sign);
    const task = tasks.get(entry.taskId);
    if (task) applyToChain(task.projectId, delta, sign);
  }

  function rebuildSums() {
    sums = new Map([...base].map(([id, older]) => [id, { today: 0, week: 0, total: older.ms }]));
    for (const entry of entries.values()) {
      let totals = sums.get(entry.taskId);
      if (!totals) sums.set(entry.taskId, (totals = zero()));
      addTo(totals, entryTotals(entry, ranges), 1);
    }
  }

  function rebuildProjects() {
    projectTotals = new Map([...projects.keys()].map((id) => [id, zero()]));
    for (const task of tasks.values()) applyToChain(task.projectId, sumOf(task.id), 1);
  }

  /**
   * True when `id` is its own ancestor (only possible with corrupt data).
   * @param {string} id
   * @param {string | null} parentId
   */
  function closesCycle(id, parentId) {
    for (const ancestor of ancestors(parentId, projects)) if (ancestor === id) return true;
    return false;
  }

  /** @param {RollupEntry} entry */
  function storeEntry(entry) {
    const { id, taskId, start, end, deletedAt = null } = entry;
    const old = entries.get(id);
    if (old && old.taskId !== taskId) byTask.get(old.taskId)?.delete(id);
    let ids = byTask.get(taskId);
    if (!ids) byTask.set(taskId, (ids = new Set()));
    ids.add(id);
    entries.set(id, { id, taskId, start, end, deletedAt });
    if (end === null && deletedAt === null) running.add(id);
    else running.delete(id);
  }

  for (const { id, parentId, archived } of data.projects) {
    projects.set(id, { id, parentId, archived });
  }
  for (const { id, projectId } of data.tasks) tasks.set(id, { id, projectId });
  for (const entry of data.entries) storeEntry(entry);
  for (const [taskId, aggregate] of Object.entries(data.aggregates ?? {})) {
    const older = { ms: Math.max(0, aggregate.ms - windowMs(taskId)), last: aggregate.last };
    if (older.ms !== 0 || older.last !== null) base.set(taskId, older);
  }
  rebuildSums();
  rebuildProjects();

  return {
    task: (id) => (tasks.has(id) ? { ...sumOf(id) } : zero()),
    project: (id) => ({ ...(projectTotals.get(id) ?? zero()) }),
    last(id) {
      let latest = base.get(id)?.last ?? null;
      for (const entryId of byTask.get(id) ?? []) {
        const entry = /** @type {RollupEntry} */ (entries.get(entryId));
        if (entry.deletedAt !== null && entry.deletedAt !== undefined) continue;
        const end = entry.end ?? ranges.now;
        if (latest === null || end > latest) latest = end;
      }
      return latest;
    },
    snapshot() {
      return {
        tasks: new Map([...tasks.keys()].map((id) => [id, { ...sumOf(id) }])),
        projects: new Map([...projectTotals].map(([id, totals]) => [id, { ...totals }])),
      };
    },

    upsertEntry(entry) {
      const old = entries.get(entry.id);
      if (old) applyEntry(old, -1);
      storeEntry(entry);
      applyEntry(/** @type {RollupEntry} */ (entries.get(entry.id)), 1);
    },
    removeEntry(id) {
      const old = entries.get(id);
      if (!old) return;
      applyEntry(old, -1);
      entries.delete(id);
      running.delete(id);
      byTask.get(old.taskId)?.delete(id);
    },

    upsertTask({ id, projectId }) {
      const old = tasks.get(id);
      if (old) applyToChain(old.projectId, sumOf(id), -1);
      tasks.set(id, { id, projectId });
      applyToChain(projectId, sumOf(id), 1);
    },
    removeTask(id) {
      const old = tasks.get(id);
      if (!old) return;
      applyToChain(old.projectId, sumOf(id), -1);
      tasks.delete(id);
    },

    upsertProject({ id, parentId, archived }) {
      const old = projects.get(id);
      const next = { id, parentId: parentId ?? null, archived };
      if (old && old.parentId === next.parentId) {
        projects.set(id, next);
        return;
      }
      if (!old || closesCycle(id, old.parentId) || closesCycle(id, next.parentId)) {
        // New projects adopt orphaned children and tasks; cycles need the careful walk.
        projects.set(id, next);
        rebuildProjects();
        return;
      }
      const subtree = { .../** @type {Totals} */ (projectTotals.get(id)) };
      applyToChain(old.parentId, subtree, -1);
      projects.set(id, next);
      applyToChain(next.parentId, subtree, 1);
    },
    removeProject(id) {
      const old = projects.get(id);
      if (!old) return;
      if (closesCycle(id, old.parentId)) {
        projects.delete(id);
        rebuildProjects();
        return;
      }
      // Children become roots and keep their own totals.
      applyToChain(old.parentId, /** @type {Totals} */ (projectTotals.get(id)), -1);
      projects.delete(id);
      projectTotals.delete(id);
    },

    setNow(next) {
      const nextRanges = rangesFor(next, currentWeekStart);
      if (nextRanges.day.start !== ranges.day.start) {
        ranges = nextRanges;
        rebuildSums();
        rebuildProjects();
        return;
      }
      const live = [...running].map((id) => /** @type {RollupEntry} */ (entries.get(id)));
      for (const entry of live) applyEntry(entry, -1);
      ranges = nextRanges;
      for (const entry of live) applyEntry(entry, 1);
    },
    setWeekStart(next) {
      currentWeekStart = next;
      ranges = rangesFor(ranges.now, next);
      rebuildSums();
      rebuildProjects();
    },
    setAggregates(aggregates) {
      for (const taskId of new Set([...base.keys(), ...Object.keys(aggregates)])) {
        // Own keys only: an id like `toString` must not read Object.prototype.
        applyAggregate(taskId, Object.hasOwn(aggregates, taskId) ? aggregates[taskId] : undefined);
      }
    },
  };
}
