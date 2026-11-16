import { describe, expect, it } from 'vitest';
import { resolveBatch } from '../../src/lib/import-batch.js';

/**
 * @typedef {import('../../src/lib/types.js').Project} Project
 * @typedef {import('../../src/lib/types.js').Task} Task
 * @typedef {import('../../src/lib/types.js').Entry} Entry
 * @typedef {import('../../src/lib/import-batch.js').ImportBatch} ImportBatch
 * @typedef {import('../../src/lib/import-batch.js').BatchProject} BatchProject
 * @typedef {import('../../src/lib/import-batch.js').BatchTask} BatchTask
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date(2026, 9, 20, 14, 45).getTime();
/** Local time (the tests run in Europe/Berlin). */
const at = (/** @type {number} */ m, /** @type {number} */ d, h = 0, min = 0) =>
  new Date(2026, m - 1, d, h, min).getTime();

/** @param {Partial<Project> & {id: string, name: string}} fields @returns {Project} */
const storedProject = (fields) => ({
  parentId: null,
  color: '#2493ef',
  order: 0,
  archived: false,
  hourlyRate: null,
  createdAt: 0,
  updatedAt: 0,
  ...fields,
});

/** @param {Partial<Task> & {id: string, projectId: string, name: string}} fields @returns {Task} */
const storedTask = (fields) => ({
  status: 'open',
  starred: false,
  estimateMin: null,
  billable: false,
  tags: [],
  notes: '',
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  doneAt: null,
  ...fields,
});

/** @param {Partial<Entry> & {id: string, taskId: string, start: number}} fields @returns {Entry} */
const storedEntry = (fields) => ({
  end: fields.start + HOUR,
  note: '',
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  ...fields,
});

/** @param {Partial<BatchProject> & {key: string, name: string}} fields @returns {BatchProject} */
const project = (fields) => ({
  id: fields.key,
  parentKey: null,
  color: '#25a6a0',
  archived: false,
  ...fields,
});

/** @param {Partial<BatchTask> & {key: string, projectKey: string, name: string}} fields @returns {BatchTask} */
const task = (fields) => ({
  id: fields.key,
  status: 'open',
  doneAt: null,
  estimateMin: null,
  notes: '',
  tags: [],
  billable: false,
  ...fields,
});

/** @param {Partial<ImportBatch>} batch @returns {ImportBatch} */
const batchOf = (batch) => ({ projects: [], tasks: [], entries: [], ...batch });

/** @param {ImportBatch} batch @param {Partial<{projects: Project[], tasks: Task[], entries: Entry[]}>} [stored] */
function resolve(batch, stored = {}) {
  let n = 0;
  return resolveBatch(
    batch,
    { projects: [], tasks: [], entries: [], ...stored },
    { now: NOW, newId: () => `new-${++n}` },
  );
}

describe('resolveBatch: projects', () => {
  it('creates new projects parents first, appended after the stored siblings', () => {
    const plan = resolve(
      batchOf({
        projects: [
          project({ key: 'child', name: 'Website', parentKey: 'parent' }),
          project({ key: 'parent', name: 'Harbor Coffee', archived: true }),
        ],
      }),
      { projects: [storedProject({ id: 'p1', name: 'Internal', order: 4 })] },
    );
    expect(plan.projects).toEqual([
      {
        id: 'parent',
        parentId: null,
        name: 'Harbor Coffee',
        color: '#25a6a0',
        order: 5,
        archived: true,
        hourlyRate: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      expect.objectContaining({ id: 'child', parentId: 'parent', order: 0, archived: false }),
    ]);
    expect(plan.reused.projects).toBe(0);
  });

  it('finds a project again by id, even after it was renamed and moved', () => {
    const stored = [
      storedProject({ id: 'p1', name: 'Clients' }),
      storedProject({ id: 'sp-p-1', name: 'Renamed', parentId: 'p1' }),
    ];
    const plan = resolve(
      batchOf({
        projects: [project({ key: 'sp-p-1', name: 'Original' })],
        tasks: [task({ key: 't', projectKey: 'sp-p-1', name: 'Task' })],
      }),
      { projects: stored },
    );
    expect(plan.projects).toEqual([]);
    expect(plan.reused.projects).toBe(1);
    expect(plan.tasks[0].projectId).toBe('sp-p-1');
  });

  it('matches a sibling by name, ignoring case, spaces and composition, archived ones too', () => {
    const stored = [
      storedProject({ id: 'a', name: 'Café', archived: true, order: 2 }),
      storedProject({ id: 'b', name: 'café', order: 1 }),
      storedProject({ id: 'c', name: 'Client / Harbor', order: 3 }),
      storedProject({ id: 'd', name: 'two  words', order: 4 }),
    ];
    const plan = resolve(
      batchOf({
        projects: [
          project({ key: 'x', id: null, name: '  CAFÉ ' }),
          project({ key: 'y', name: 'client / harbor' }),
          project({ key: 'z', name: 'Two words' }),
        ],
      }),
      { projects: stored },
    );
    expect(plan.projects).toEqual([]);
    expect(plan.reused.projects).toBe(3);
  });

  it('matches by name only under the same parent', () => {
    const stored = [
      storedProject({ id: 'p1', name: 'Clients' }),
      storedProject({ id: 'p2', name: 'Website', parentId: 'p1' }),
    ];
    const plan = resolve(batchOf({ projects: [project({ key: 'w', name: 'Website' })] }), {
      projects: stored,
    });
    expect(plan.projects.map((p) => [p.name, p.parentId])).toEqual([['Website', null]]);
  });

  it('merges same-name projects of one batch without counting them as reused', () => {
    const plan = resolve(
      batchOf({
        projects: [
          project({ key: 'a', name: 'Writing' }),
          project({ key: 'b', name: 'writing' }),
          project({ key: 'a', name: 'Duplicate key' }),
        ],
      }),
    );
    expect(plan.projects.map((p) => p.name)).toEqual(['Writing']);
    expect(plan.reused.projects).toBe(0);
  });

  it('drops blank names, treats unknown parents and parent cycles as top level', () => {
    const plan = resolve(
      batchOf({
        projects: [
          project({ key: 'blank', name: ' \n ' }),
          project({ key: 'lost', name: 'Lost', parentKey: 'nowhere' }),
          project({ key: 'c1', name: 'C1', parentKey: 'c2' }),
          project({ key: 'c2', name: 'C2', parentKey: 'c1' }),
        ],
        tasks: [task({ key: 't', projectKey: 'blank', name: 'Orphan' })],
      }),
    );
    expect(plan.projects.map((p) => [p.name, p.parentId])).toEqual([
      ['Lost', null],
      ['C2', null],
      ['C1', 'c2'],
    ]);
    expect(plan.dropped).toBe(2);
    expect(plan.tasks).toEqual([]);
  });
});

describe('resolveBatch: tasks', () => {
  const projects = [storedProject({ id: 'p', name: 'Harbor' })];

  it('creates tasks with their fields, appended after the stored ones', () => {
    const plan = resolve(
      batchOf({
        projects: [project({ key: 'p', name: 'Harbor' })],
        tasks: [
          task({
            key: 't',
            projectKey: 'p',
            name: 'Checkout',
            status: 'done',
            doneAt: at(10, 19, 17),
            estimateMin: 90,
            notes: 'Notes',
            tags: ['design'],
            billable: true,
          }),
          task({ key: 'u', projectKey: 'p', name: 'Upload', doneAt: at(10, 19, 17) }),
        ],
      }),
      { projects, tasks: [storedTask({ id: 's', projectId: 'p', name: 'Stored', order: 7 })] },
    );
    expect(plan.tasks).toEqual([
      {
        id: 't',
        projectId: 'p',
        name: 'Checkout',
        status: 'done',
        starred: false,
        estimateMin: 90,
        billable: true,
        tags: ['design'],
        notes: 'Notes',
        order: 8,
        createdAt: NOW,
        updatedAt: NOW,
        doneAt: at(10, 19, 17),
      },
      expect.objectContaining({ id: 'u', status: 'open', order: 9, doneAt: null }),
    ]);
  });

  it('finds a task by id, else by name in its project, open ones first', () => {
    const tasks = [
      storedTask({ id: 'done', projectId: 'p', name: 'Review', status: 'done' }),
      storedTask({ id: 'open', projectId: 'p', name: 'review', order: 3 }),
      storedTask({ id: 'sp-t-1', projectId: 'p', name: 'Moved here' }),
    ];
    const plan = resolve(
      batchOf({
        projects: [project({ key: 'p', name: 'Harbor' })],
        tasks: [
          task({ key: 'a', projectKey: 'p', name: 'Review' }),
          task({ key: 'sp-t-1', projectKey: 'elsewhere', name: 'Old name' }),
        ],
        entries: [
          { id: 'e1', taskKey: 'a', note: '', start: at(10, 19, 9), end: at(10, 19, 10) },
          { id: 'e2', taskKey: 'sp-t-1', note: '', start: at(10, 19, 9), end: at(10, 19, 10) },
        ],
      }),
      { projects, tasks },
    );
    expect(plan.tasks).toEqual([]);
    expect(plan.reused.tasks).toBe(2);
    expect(plan.entries.map((e) => e.taskId)).toEqual(['open', 'sp-t-1']);
  });

  it('merges same-name tasks of one batch (recurring tasks)', () => {
    const plan = resolve(
      batchOf({
        projects: [project({ key: 'p', name: 'Harbor' })],
        tasks: [
          task({ key: 'a', projectKey: 'p', name: 'Standup' }),
          task({ key: 'b', projectKey: 'p', name: 'Standup' }),
        ],
        entries: [
          { id: 'ea', taskKey: 'a', note: '', day: '2026-10-19', ms: 15 * MIN, from: NaN },
          { id: 'eb', taskKey: 'b', note: '', day: '2026-10-20', ms: 15 * MIN, from: NaN },
        ],
      }),
    );
    expect(plan.tasks.map((t) => t.id)).toEqual(['a']);
    expect(plan.entries.map((e) => e.taskId)).toEqual(['a', 'a']);
  });

  it('drops tasks with a blank name or an unknown project, and their entries', () => {
    const plan = resolve(
      batchOf({
        projects: [project({ key: 'p', name: 'Harbor' })],
        tasks: [
          task({ key: 'a', projectKey: 'p', name: '   ' }),
          task({ key: 'b', projectKey: 'missing', name: 'Lost' }),
        ],
        entries: [
          { id: null, taskKey: 'a', note: '', start: at(10, 19, 9), end: at(10, 19, 10) },
          { id: null, taskKey: 'unknown', note: '', start: at(10, 19, 9), end: at(10, 19, 10) },
        ],
      }),
    );
    expect(plan.tasks).toEqual([]);
    expect(plan.entries).toEqual([]);
    expect(plan.dropped).toBe(4);
  });
});

describe('resolveBatch: entries', () => {
  const projects = [storedProject({ id: 'p', name: 'Harbor' })];
  const tasks = [storedTask({ id: 't', projectId: 'p', name: 'Checkout' })];
  const base = {
    projects: [project({ key: 'p', name: 'Harbor' })],
    tasks: [task({ key: 't', projectKey: 'p', name: 'Checkout' })],
  };

  it('skips ids that are stored, soft-deleted ones included, and ids repeated in the batch', () => {
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          { id: 'live', taskKey: 't', note: '', start: at(10, 19, 9), end: at(10, 19, 10) },
          { id: 'gone', taskKey: 't', note: '', start: at(10, 19, 9), end: at(10, 19, 10) },
          { id: 'new', taskKey: 't', note: 'n', start: at(10, 19, 11), end: at(10, 19, 12) },
          { id: 'new', taskKey: 't', note: '', day: '2026-10-19', ms: HOUR, from: NaN },
        ],
      }),
      {
        projects,
        tasks,
        entries: [
          storedEntry({ id: 'live', taskId: 't', start: at(10, 1, 9) }),
          storedEntry({ id: 'gone', taskId: 't', start: at(10, 1, 9), deletedAt: at(10, 2) }),
        ],
      },
    );
    expect(plan.entries).toEqual([
      {
        id: 'new',
        taskId: 't',
        start: at(10, 19, 11),
        end: at(10, 19, 12),
        note: 'n',
        source: 'manual',
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ]);
    expect(plan.skipped).toBe(3);
  });

  it('skips timed entries without an id that match a live entry to the minute', () => {
    const start = at(10, 19, 9) + 40_000;
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          { id: null, taskKey: 't', note: '', start: at(10, 19, 9), end: at(10, 19, 10) },
          { id: null, taskKey: 't', note: '', start: at(10, 19, 11), end: at(10, 19, 12) },
          { id: null, taskKey: 't', note: '', start: at(10, 19, 11), end: at(10, 19, 12) },
        ],
      }),
      {
        projects,
        tasks,
        entries: [
          storedEntry({ id: 'a', taskId: 't', start, end: at(10, 19, 10) + 20_000 }),
          storedEntry({
            id: 'b',
            taskId: 't',
            start: at(10, 19, 11),
            end: at(10, 19, 12),
            deletedAt: 1,
          }),
        ],
      },
    );
    // The deleted one doesn't count; duplicates inside the file are kept.
    expect(plan.entries.map((e) => [e.id, e.start])).toEqual([
      ['new-1', at(10, 19, 11)],
      ['new-2', at(10, 19, 11)],
    ]);
    expect(plan.skipped).toBe(1);
  });

  it('drops timed entries with bad times', () => {
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          { id: null, taskKey: 't', note: '', start: at(10, 19, 10), end: at(10, 19, 10) },
          { id: null, taskKey: 't', note: '', start: -1, end: at(10, 19, 10) },
          { id: null, taskKey: 't', note: '', start: 0.5, end: at(10, 19, 10) },
          { id: null, taskKey: 't', note: '', day: '2026-02-30', ms: HOUR, from: NaN },
          { id: null, taskKey: 't', note: '', day: '2026-10-19', ms: 0, from: NaN },
        ],
      }),
    );
    expect(plan.entries).toEqual([]);
    expect(plan.dropped).toBe(5);
  });
});

describe('resolveBatch: placing day totals', () => {
  const base = {
    projects: [project({ key: 'p', name: 'Harbor' })],
    tasks: [
      task({ key: 'a', projectKey: 'p', name: 'A' }),
      task({ key: 'b', projectKey: 'p', name: 'B' }),
    ],
  };
  /** @param {string} id @param {string} taskKey @param {string} day @param {number} ms @param {number} from */
  const total = (id, taskKey, day, ms, from) => ({ id, taskKey, note: '', day, ms, from });
  /** @param {import('../../src/lib/import-batch.js').ImportPlan} plan */
  const times = (plan) => plan.entries.map((e) => [e.id, e.start, e.end]);

  it('lays a day end to end from when work started, in batch order', () => {
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          total('a1', 'a', '2026-10-20', 90 * MIN, at(10, 20, 8, 15)),
          total('b1', 'b', '2026-10-20', 45 * MIN, at(10, 20, 8, 15)),
          total('a0', 'a', '2026-10-19', HOUR, at(10, 19, 9, 30)),
        ],
      }),
    );
    expect(times(plan)).toEqual([
      ['a0', at(10, 19, 9, 30), at(10, 19, 10, 30)],
      ['a1', at(10, 20, 8, 15), at(10, 20, 9, 45)],
      ['b1', at(10, 20, 9, 45), at(10, 20, 10, 30)],
    ]);
  });

  it('starts at 09:00 when the start is unknown or on another day', () => {
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          total('x', 'a', '2026-10-19', HOUR, NaN),
          total('y', 'a', '2026-10-20', HOUR, at(10, 19, 8)),
        ],
      }),
    );
    expect(times(plan)).toEqual([
      ['x', at(10, 19, 9), at(10, 19, 10)],
      ['y', at(10, 20, 9), at(10, 20, 10)],
    ]);
  });

  it('starts after the day’s latest stored or imported entry, crossing midnight included', () => {
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          { id: 'timed', taskKey: 'b', note: '', start: at(10, 19, 13), end: at(10, 19, 14) },
          total('d', 'a', '2026-10-19', HOUR, at(10, 19, 8)),
          total('e', 'a', '2026-10-18', HOUR, at(10, 18, 8)),
        ],
      }),
      {
        projects: [storedProject({ id: 'p', name: 'Harbor' })],
        entries: [
          storedEntry({ id: 's1', taskId: 'other', start: at(10, 19, 9), end: at(10, 19, 11) }),
          storedEntry({
            id: 's2',
            taskId: 'other',
            start: at(10, 19, 15),
            end: at(10, 19, 22),
            deletedAt: 1,
          }),
          // A timer left running overnight: it counts on both days.
          storedEntry({ id: 's3', taskId: 'other', start: at(10, 18, 7), end: at(10, 19, 16) }),
        ],
      },
    );
    expect(times(plan)).toEqual([
      ['timed', at(10, 19, 13), at(10, 19, 14)],
      // 23:00–24:00: the 18th is full until midnight, so the block moves back from it.
      ['e', at(10, 18, 23), at(10, 19, 0)],
      ['d', at(10, 19, 16), at(10, 19, 17)],
    ]);
  });

  it('counts the running entry up to now and never places today’s block after now', () => {
    const running = storedEntry({ id: 'run', taskId: 'other', start: at(10, 20, 10, 30) });
    running.end = null;
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          total('a', 'a', '2026-10-20', 30 * MIN, at(10, 20, 8)),
          total('b', 'b', '2026-10-21', HOUR, at(10, 21, 8)),
        ],
      }),
      { projects: [storedProject({ id: 'p', name: 'Harbor' })], entries: [running] },
    );
    // NOW is 14:45 on the 20th: after the running entry would be in the future.
    expect(times(plan)).toEqual([
      ['a', at(10, 20, 14, 15), at(10, 20, 14, 45)],
      ['b', at(10, 21, 8), at(10, 21, 9)],
    ]);
  });

  it('counts day totals that differ from their stored entry, and keeps the stored one', () => {
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          total('grew', 'a', '2026-10-19', 2 * HOUR, NaN),
          total('same', 'a', '2026-10-18', HOUR + 400, NaN),
          total('gone', 'a', '2026-10-17', 2 * HOUR, NaN),
          { id: 'timed', taskKey: 'a', note: '', start: at(10, 16, 9), end: at(10, 16, 12) },
        ],
      }),
      {
        projects: [storedProject({ id: 'p', name: 'Harbor' })],
        tasks: [storedTask({ id: 'a', projectId: 'p', name: 'A' })],
        entries: [
          storedEntry({ id: 'grew', taskId: 'a', start: at(10, 19, 9) }),
          storedEntry({ id: 'same', taskId: 'a', start: at(10, 18, 9) }),
          storedEntry({ id: 'gone', taskId: 'a', start: at(10, 17, 9), deletedAt: 1 }),
          storedEntry({ id: 'timed', taskId: 'a', start: at(10, 16, 9) }),
        ],
      },
    );
    expect(plan.entries).toEqual([]);
    expect(plan).toMatchObject({ skipped: 4, changed: 1 });
  });

  it('moves a block that would run past midnight earlier', () => {
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          total('a', 'a', '2026-10-18', HOUR, at(10, 18, 23)),
          total('b', 'b', '2026-10-18', HOUR, at(10, 18, 23)),
        ],
      }),
    );
    expect(times(plan)).toEqual([
      ['a', at(10, 18, 22), at(10, 18, 23)],
      ['b', at(10, 18, 23), at(10, 19, 0)],
    ]);
  });

  it('starts at midnight when the day’s total is longer than the day (spring forward)', () => {
    const plan = resolve(
      batchOf({
        ...base,
        entries: [
          total('a', 'a', '2026-03-29', 20 * HOUR, at(3, 29, 9)),
          total('b', 'b', '2026-03-29', 4 * HOUR, at(3, 29, 9)),
        ],
      }),
    );
    // The day has 23 hours: the last hour lands on the next day.
    expect(times(plan)).toEqual([
      ['a', at(3, 29, 0), at(3, 29, 21)],
      ['b', at(3, 29, 21), at(3, 30, 1)],
    ]);
  });

  it('keeps wall-clock times on the fall-back day', () => {
    const plan = resolve(batchOf({ ...base, entries: [total('a', 'a', '2026-10-25', HOUR, NaN)] }));
    expect(times(plan)).toEqual([['a', at(10, 25, 9), at(10, 25, 10)]]);
  });
});
