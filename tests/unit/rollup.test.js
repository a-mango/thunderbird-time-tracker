import { describe, expect, it } from 'vitest';
import { computeRollup, createRollup, visibleProjects } from '../../src/lib/rollup.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Local time in Europe/Zurich (the vitest TZ). */
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const ZERO = { today: 0, week: 0, total: 0 };

/** @returns {import('../../src/lib/types.js').Project} */
function project(id, parentId = null, extra = {}) {
  return {
    id,
    parentId,
    name: `Project ${id}`,
    color: '#2493ef',
    order: 0,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

/** @returns {import('../../src/lib/types.js').Task} */
function task(id, projectId, extra = {}) {
  return {
    id,
    projectId,
    name: `Task ${id}`,
    status: 'open',
    starred: false,
    estimateMin: null,
    billable: true,
    tags: [],
    notes: '',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    doneAt: null,
    ...extra,
  };
}

/** @returns {import('../../src/lib/types.js').Entry} */
function entry(id, taskId, start, end, extra = {}) {
  return {
    id,
    taskId,
    start,
    end,
    note: '',
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...extra,
  };
}

// Tue 20 Oct 2026, 14:00. Monday-start week = 19-26 Oct, Sunday-start week = 18-25 Oct.
const NOW = at(2026, 10, 20, 14);

// Client work > Harbor Coffee > Build > Frontend (four levels), plus Internal.
const PROJECTS = [
  project('client', null, { name: 'Client work' }),
  project('harbor', 'client', { name: 'Harbor Coffee' }),
  project('build', 'harbor', { name: 'Build' }),
  project('frontend', 'build', { name: 'Frontend' }),
  project('internal', null, { name: 'Internal' }),
];
const TASKS = [
  task('checkout', 'frontend', { name: 'Checkout form validation' }),
  task('deploy', 'build', { name: 'Staging deploy script' }),
  task('sync', 'client', { name: 'Weekly client sync' }),
  task('books', 'internal', { name: 'Bookkeeping' }),
];

describe('computeRollup', () => {
  it('sums Today, Week and Total per task', () => {
    const entries = [
      entry('e1', 'checkout', at(2026, 10, 20, 9), at(2026, 10, 20, 10)), // today
      entry('e2', 'checkout', at(2026, 10, 19, 9), at(2026, 10, 19, 9, 30)), // Monday
      entry('e3', 'checkout', at(2026, 10, 12, 9), at(2026, 10, 12, 11)), // last week
    ];
    const { tasks } = computeRollup(
      { projects: PROJECTS, tasks: TASKS, entries },
      { now: NOW, weekStart: 1 },
    );
    expect(tasks.get('checkout')).toEqual({ today: HOUR, week: 1.5 * HOUR, total: 3.5 * HOUR });
    expect(tasks.get('books')).toEqual(ZERO);
  });

  it('includes descendants four levels deep in project totals', () => {
    const entries = [
      entry('e1', 'checkout', at(2026, 10, 20, 9), at(2026, 10, 20, 10)),
      entry('e2', 'deploy', at(2026, 10, 20, 11), at(2026, 10, 20, 11, 30)),
      entry('e3', 'sync', at(2026, 10, 20, 12), at(2026, 10, 20, 12, 15)),
      entry('e4', 'books', at(2026, 10, 20, 8), at(2026, 10, 20, 9)),
    ];
    const { projects } = computeRollup(
      { projects: PROJECTS, tasks: TASKS, entries },
      { now: NOW, weekStart: 1 },
    );
    const today = (id) => projects.get(id)?.today;
    expect(today('frontend')).toBe(60 * MINUTE);
    expect(today('build')).toBe(90 * MINUTE);
    expect(today('harbor')).toBe(90 * MINUTE);
    expect(today('client')).toBe(105 * MINUTE);
    expect(today('internal')).toBe(60 * MINUTE);
  });

  it('counts archived subprojects in ancestor totals', () => {
    const projects = PROJECTS.map((p) => (p.id === 'build' ? { ...p, archived: true } : p));
    const entries = [entry('e1', 'checkout', at(2026, 10, 20, 9), at(2026, 10, 20, 10))];
    const result = computeRollup({ projects, tasks: TASKS, entries }, { now: NOW, weekStart: 1 });
    expect(result.projects.get('client')?.total).toBe(HOUR);
    expect(result.projects.get('build')?.total).toBe(HOUR);
  });

  it('counts a running entry up to now', () => {
    const entries = [entry('e1', 'checkout', NOW - 25 * MINUTE, null)];
    const { tasks, projects } = computeRollup(
      { projects: PROJECTS, tasks: TASKS, entries },
      { now: NOW, weekStart: 1 },
    );
    expect(tasks.get('checkout')).toEqual({
      today: 25 * MINUTE,
      week: 25 * MINUTE,
      total: 25 * MINUTE,
    });
    expect(projects.get('client')?.total).toBe(25 * MINUTE);
  });

  it('ignores soft-deleted entries', () => {
    const entries = [
      entry('e1', 'checkout', at(2026, 10, 20, 9), at(2026, 10, 20, 10), { deletedAt: NOW }),
      entry('e2', 'checkout', NOW - HOUR, null, { deletedAt: NOW }),
    ];
    const { tasks, projects } = computeRollup(
      { projects: PROJECTS, tasks: TASKS, entries },
      { now: NOW, weekStart: 1 },
    );
    expect(tasks.get('checkout')).toEqual(ZERO);
    expect(projects.get('client')).toEqual(ZERO);
  });

  it("counts only today's part of a midnight-crossing entry in Today", () => {
    const entries = [entry('e1', 'checkout', at(2026, 10, 19, 23), at(2026, 10, 20, 1, 30))];
    const { tasks } = computeRollup(
      { projects: PROJECTS, tasks: TASKS, entries },
      { now: NOW, weekStart: 1 },
    );
    expect(tasks.get('checkout')).toEqual({
      today: 90 * MINUTE,
      week: 150 * MINUTE,
      total: 150 * MINUTE,
    });
  });

  it('respects the week start (Monday vs Sunday)', () => {
    const entries = [
      entry('sun', 'checkout', at(2026, 10, 18, 10), at(2026, 10, 18, 11)),
      entry('mon', 'checkout', at(2026, 10, 19, 10), at(2026, 10, 19, 12)),
      // Sunday 23:00 to Monday 01:00: one hour on each side of the Monday boundary.
      entry('night', 'checkout', at(2026, 10, 18, 23), at(2026, 10, 19, 1)),
    ];
    const data = { projects: PROJECTS, tasks: TASKS, entries };
    const monday = computeRollup(data, { now: NOW, weekStart: 1 }).tasks.get('checkout');
    const sunday = computeRollup(data, { now: NOW, weekStart: 0 }).tasks.get('checkout');
    expect(monday?.week).toBe(3 * HOUR);
    expect(sunday?.week).toBe(5 * HOUR);
  });

  it('measures Today and Week in local time on DST days', () => {
    const now = at(2026, 10, 25, 23, 30); // Sunday of the fall-back week
    const entries = [entry('e1', 'checkout', at(2026, 10, 25, 0), at(2026, 10, 25, 23))];
    const { tasks } = computeRollup(
      { projects: PROJECTS, tasks: TASKS, entries },
      { now, weekStart: 1 },
    );
    expect(tasks.get('checkout')?.today).toBe(24 * HOUR);
  });

  it('ignores dangling references and terminates on parent cycles', () => {
    const projects = [project('a', 'b'), project('b', 'a'), project('orphan', 'gone')];
    const tasks = [task('t1', 'a'), task('t2', 'orphan'), task('t3', 'gone')];
    const entries = [
      entry('e1', 't1', NOW - HOUR, NOW),
      entry('e2', 't2', NOW - HOUR, NOW),
      entry('e3', 't3', NOW - HOUR, NOW),
      entry('e4', 'nope', NOW - HOUR, NOW),
    ];
    const result = computeRollup({ projects, tasks, entries }, { now: NOW, weekStart: 1 });
    expect(result.projects.get('a')?.total).toBe(HOUR);
    expect(result.projects.get('b')?.total).toBe(HOUR);
    expect(result.projects.get('orphan')?.total).toBe(HOUR);
    expect(result.projects.has('gone')).toBe(false);
    expect(result.tasks.get('t3')?.total).toBe(HOUR);
    expect(result.tasks.has('nope')).toBe(false);
  });
});

describe('visibleProjects', () => {
  it('hides archived projects and their whole subtree', () => {
    const projects = PROJECTS.map((p) => (p.id === 'harbor' ? { ...p, archived: true } : p));
    expect(visibleProjects(projects).map((p) => p.id)).toEqual(['client', 'internal']);
  });

  it('keeps orphans and survives cycles', () => {
    const projects = [
      project('orphan', 'gone'),
      project('a', 'b'),
      project('b', 'a', { archived: true }),
    ];
    expect(visibleProjects(projects).map((p) => p.id)).toEqual(['orphan']);
  });
});

describe('createRollup', () => {
  it('reads totals and returns zeros for unknown ids', () => {
    const entries = [entry('e1', 'checkout', NOW - HOUR, NOW)];
    const rollup = createRollup(
      { projects: PROJECTS, tasks: TASKS, entries },
      { now: NOW, weekStart: 1 },
    );
    expect(rollup.task('checkout')).toEqual({ today: HOUR, week: HOUR, total: HOUR });
    expect(rollup.project('client')).toEqual({ today: HOUR, week: HOUR, total: HOUR });
    expect(rollup.task('nope')).toEqual(ZERO);
    expect(rollup.project('nope')).toEqual(ZERO);
  });

  it('returns copies that callers cannot use to corrupt the state', () => {
    const rollup = createRollup(
      { projects: PROJECTS, tasks: TASKS, entries: [entry('e1', 'checkout', NOW - HOUR, NOW)] },
      { now: NOW, weekStart: 1 },
    );
    rollup.task('checkout').total = 0;
    rollup.snapshot().projects.get('client').total = 0;
    expect(rollup.task('checkout').total).toBe(HOUR);
    expect(rollup.project('client').total).toBe(HOUR);
  });

  it('advances a running entry and rolls over at midnight', () => {
    const start = at(2026, 10, 20, 23);
    const rollup = createRollup(
      { projects: PROJECTS, tasks: TASKS, entries: [entry('e1', 'checkout', start, null)] },
      { now: start + 30 * MINUTE, weekStart: 1 },
    );
    expect(rollup.project('client').today).toBe(30 * MINUTE);
    rollup.setNow(at(2026, 10, 21, 0, 15));
    expect(rollup.task('checkout')).toEqual({
      today: 15 * MINUTE,
      week: 75 * MINUTE,
      total: 75 * MINUTE,
    });
    expect(rollup.project('client').today).toBe(15 * MINUTE);
  });

  it('moves totals when a task moves or a project is reparented', () => {
    const rollup = createRollup(
      { projects: PROJECTS, tasks: TASKS, entries: [entry('e1', 'checkout', NOW - HOUR, NOW)] },
      { now: NOW, weekStart: 1 },
    );
    rollup.upsertTask(task('checkout', 'internal'));
    expect(rollup.project('client').total).toBe(0);
    expect(rollup.project('internal').total).toBe(HOUR);
    rollup.upsertTask(task('checkout', 'frontend'));
    rollup.upsertProject(project('build', 'internal'));
    expect(rollup.project('harbor').total).toBe(0);
    expect(rollup.project('internal').total).toBe(HOUR);
    expect(rollup.project('frontend').total).toBe(HOUR);
  });
  it('recomputes on a week start change', () => {
    const data = {
      projects: PROJECTS,
      tasks: TASKS,
      entries: [entry('sun', 'checkout', at(2026, 10, 18, 10), at(2026, 10, 18, 11))],
    };
    const rollup = createRollup(data, { now: NOW, weekStart: 1 });
    expect(rollup.project('client').week).toBe(0);
    rollup.setWeekStart(0);
    expect(rollup.snapshot()).toEqual(computeRollup(data, { now: NOW, weekStart: 0 }));
    expect(rollup.project('client').week).toBe(HOUR);
  });

  it('stays equal to computeRollup when corrupt data forms a parent cycle', () => {
    const projects = new Map([
      ['a', project('a', null)],
      ['b', project('b', 'a')],
      ['c', project('c', 'b')],
    ]);
    const tasks = [task('t1', 'c'), task('t2', 'a')];
    const entries = [entry('e1', 't1', NOW - HOUR, NOW), entry('e2', 't2', NOW - 2 * HOUR, NOW)];
    const options = { now: NOW, weekStart: /** @type {const} */ (1) };
    const rollup = createRollup({ projects: [...projects.values()], tasks, entries }, options);
    const check = () =>
      expect(rollup.snapshot()).toEqual(
        computeRollup({ projects: [...projects.values()], tasks, entries }, options),
      );
    for (const p of [project('a', 'c'), project('b', null), project('b', 'c')]) {
      projects.set(p.id, p);
      rollup.upsertProject(p);
      check();
    }
    projects.delete('c');
    rollup.removeProject('c');
    check();
    rollup.removeProject('nope');
    rollup.removeTask('nope');
    rollup.removeEntry('nope');
    check();
  });
});

/**
 * Deterministic PRNG (mulberry32).
 * @param {number} seed
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('createRollup matches computeRollup after random updates', () => {
  const PROJECT_IDS = ['client', 'harbor', 'build', 'frontend', 'internal', 'p6', 'p7', 'p8'];
  const TASK_IDS = ['checkout', 'deploy', 'sync', 'books', 't5', 't6', 't7', 't8', 't9', 't10'];
  const ENTRY_IDS = Array.from({ length: 40 }, (_, i) => `e${i}`);

  it.each([
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 0],
  ])('seed %i, weekStart %i', (seed, weekStart) => {
    const random = mulberry32(seed);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const chance = (p) => random() < p;
    /** @type {0|1} */
    const ws = /** @type {0|1} */ (weekStart);

    let now = at(2026, 10, 20, 9); // crosses the 25 Oct DST night and both week starts
    const projects = new Map(PROJECTS.map((p) => [p.id, p]));
    const tasks = new Map(TASKS.map((t) => [t.id, t]));
    const entries = new Map();
    const rollup = createRollup(
      { projects: [...projects.values()], tasks: [...tasks.values()], entries: [] },
      { now, weekStart: ws },
    );

    /** True when making `parentId` the parent of `id` would close a cycle. */
    const closesCycle = (id, parentId) => {
      for (let cur = parentId, steps = 0; cur !== null && steps < 50; steps += 1) {
        if (cur === id) return true;
        cur = projects.get(cur)?.parentId ?? null;
      }
      return false;
    };

    const ops = {
      upsertEntry() {
        const start = now - Math.floor(random() * 10 * 24 * HOUR);
        const end = chance(0.15) ? null : start + Math.floor(random() * 30 * HOUR);
        const e = entry(pick(ENTRY_IDS), pick(TASK_IDS), start, end, {
          deletedAt: chance(0.15) ? now : null,
        });
        entries.set(e.id, e);
        rollup.upsertEntry(e);
      },
      removeEntry() {
        const id = pick(ENTRY_IDS);
        entries.delete(id);
        rollup.removeEntry(id);
      },
      upsertTask() {
        const t = task(pick(TASK_IDS), pick(PROJECT_IDS));
        tasks.set(t.id, t);
        rollup.upsertTask(t);
      },
      removeTask() {
        const id = pick(TASK_IDS);
        tasks.delete(id);
        rollup.removeTask(id);
      },
      upsertProject() {
        const id = pick(PROJECT_IDS);
        let parentId = chance(0.2) ? null : pick(PROJECT_IDS);
        if (closesCycle(id, parentId)) parentId = null;
        const p = project(id, parentId, { archived: chance(0.2) });
        projects.set(id, p);
        rollup.upsertProject(p);
      },
      removeProject() {
        const id = pick(PROJECT_IDS);
        projects.delete(id);
        rollup.removeProject(id);
      },
      setNow() {
        now += chance(0.1) ? -Math.floor(random() * 2 * HOUR) : Math.floor(random() * 20 * HOUR);
        rollup.setNow(now);
      },
    };
    const weighted = [
      ...Array(8).fill('upsertEntry'),
      ...Array(2).fill('removeEntry'),
      ...Array(3).fill('upsertTask'),
      'removeTask',
      ...Array(3).fill('upsertProject'),
      'removeProject',
      ...Array(3).fill('setNow'),
    ];

    for (let step = 0; step < 500; step += 1) {
      const op = pick(weighted);
      ops[op]();
      const expected = computeRollup(
        {
          projects: [...projects.values()],
          tasks: [...tasks.values()],
          entries: [...entries.values()],
        },
        { now, weekStart: ws },
      );
      const actual = rollup.snapshot();
      expect(actual, `step ${step} (${op})`).toEqual(expected);
      for (const id of TASK_IDS) {
        expect(rollup.task(id), `step ${step} task ${id}`).toEqual(expected.tasks.get(id) ?? ZERO);
      }
      for (const id of PROJECT_IDS) {
        expect(rollup.project(id), `step ${step} project ${id}`).toEqual(
          expected.projects.get(id) ?? ZERO,
        );
      }
    }
    // The run went through the fall-back night and past both week boundaries.
    expect(now).toBeGreaterThan(at(2026, 10, 26));
  });
});
