import { describe, expect, it } from 'vitest';
import { UTF8_BOM } from '../../src/lib/csv.js';
import {
  MAX_RANGE_DAYS,
  REPORT_CSV_COLUMNS,
  buildReport,
  customRange,
  filterTasks,
  presetRange,
  rangeDays,
  reportCsv,
  shiftRange,
} from '../../src/lib/report.js';
import { dayKey } from '../../src/lib/time.js';
import { parseCsv } from './csv-parse.js';

// Tests run in Europe/Zurich: DST ends on Sun 25 Oct 2026 (a 25-hour day).
const MIN = 60_000;
const HOUR = 60 * MIN;
/** Mon 19 Oct 2026, local midnight. */
const MON = new Date(2026, 9, 19).getTime();
/** @param {number} day 0 = Monday @param {number} hour @param {number} [minute] */
const at = (day, hour, minute = 0) => new Date(2026, 9, 19 + day, hour, minute).getTime();
const WEEK = { start: MON, end: new Date(2026, 9, 26).getTime() };
const NOW = at(4, 17); // Fri 17:00
const ALL = { projectId: null, billableOnly: false, tags: [] };

/** @param {string} id @param {string} name @param {string | null} [parentId] @param {object} [extra] */
const project = (id, name, parentId = null, extra = {}) => ({
  id,
  name,
  parentId,
  color: '#2493ef',
  order: 0,
  archived: false,
  hourlyRate: null,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
/** @param {string} id @param {string} projectId @param {string} name @param {object} [extra] */
const task = (id, projectId, name, extra = {}) => ({
  id,
  projectId,
  name,
  status: /** @type {const} */ ('open'),
  starred: false,
  estimateMin: null,
  billable: true,
  tags: /** @type {string[]} */ ([]),
  notes: '',
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  doneAt: null,
  ...extra,
});
let nextId = 0;
/** @param {string} taskId @param {number} start @param {number | null} end @param {object} [extra] */
const entry = (taskId, start, end, extra = {}) => ({
  id: `e${++nextId}`,
  taskId,
  start,
  end,
  note: '',
  source: /** @type {const} */ ('manual'),
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  ...extra,
});

// Client work (95/h) › Harbor Coffee — website (120/h) › Build (inherits 120); Internal (no rate).
const projects = [
  project('client', 'Client work', null, { hourlyRate: 95 }),
  project('harbor', 'Harbor Coffee — website', 'client', { hourlyRate: 120 }),
  project('build', 'Build', 'harbor'),
  project('support', 'Support retainer', 'client', { order: 1 }),
  project('internal', 'Internal', null, { order: 1 }),
];
const tasks = [
  task('checkout', 'build', 'Checkout form validation', { tags: ['Frontend'] }),
  task('pipeline', 'build', 'Product image pipeline', { order: 1, tags: ['Implementation'] }),
  task('sync', 'support', 'Weekly client sync'),
  task('notes', 'build', 'Client call notes', { order: 2, billable: false }),
  task('books', 'internal', 'Bookkeeping', { billable: false }),
];

describe('ranges', () => {
  it('gives this week, last week, this month and last month', () => {
    expect(presetRange('week', { now: NOW, weekStart: 1 })).toEqual(WEEK);
    expect(presetRange('week', { now: NOW, weekStart: 0 }).start).toBe(at(-1, 0));
    expect(presetRange('last-week', { now: NOW, weekStart: 1 })).toEqual({
      start: at(-7, 0),
      end: MON,
    });
    expect(presetRange('month', { now: NOW, weekStart: 1 })).toEqual({
      start: new Date(2026, 9, 1).getTime(),
      end: new Date(2026, 10, 1).getTime(),
    });
    expect(presetRange('last-month', { now: NOW, weekStart: 1 })).toEqual({
      start: new Date(2026, 8, 1).getTime(),
      end: new Date(2026, 9, 1).getTime(),
    });
    // January: last month is December of the year before.
    const jan = new Date(2027, 0, 10).getTime();
    expect(presetRange('last-month', { now: jan, weekStart: 1 }).start).toBe(
      new Date(2026, 11, 1).getTime(),
    );
  });

  it('counts the 25-hour DST day once', () => {
    const days = rangeDays(WEEK);
    expect(days).toHaveLength(7);
    expect(days.map(dayKey)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });

  it('shifts weeks by 7 days, months by calendar month, custom ranges by their length', () => {
    expect(shiftRange(WEEK, 'week', 1)).toEqual({
      start: WEEK.end,
      end: new Date(2026, 10, 2).getTime(),
    });
    expect(shiftRange(WEEK, 'week', -1)).toEqual({ start: at(-7, 0), end: MON });
    const october = presetRange('month', { now: NOW, weekStart: 1 });
    expect(shiftRange(october, 'month', 1)).toEqual({
      start: new Date(2026, 10, 1).getTime(),
      end: new Date(2026, 11, 1).getTime(),
    });
    const three = { start: MON, end: at(3, 0) };
    expect(shiftRange(three, 'custom', 1)).toEqual({ start: at(3, 0), end: at(6, 0) });
  });

  it('builds custom ranges of up to 31 days, both days included', () => {
    expect(customRange(at(0, 15), at(2, 9))).toEqual({ start: MON, end: at(3, 0) });
    expect(customRange(at(0, 15), at(0, 9))).toEqual({ start: MON, end: at(1, 0) });
    expect(customRange(at(2, 0), at(0, 0))).toBeNull();
    expect(customRange(MON, at(MAX_RANGE_DAYS - 1, 0))).not.toBeNull();
    expect(customRange(MON, at(MAX_RANGE_DAYS, 0))).toBeNull();
  });
});

describe('filterTasks', () => {
  it('keeps a project subtree, billable tasks and tasks with any chosen tag', () => {
    const ids = (/** @type {object} */ filters) =>
      filterTasks({ projects, tasks }, { ...ALL, ...filters }).map((t) => t.id);
    expect(ids({})).toEqual(['checkout', 'pipeline', 'sync', 'notes', 'books']);
    expect(ids({ projectId: 'harbor' })).toEqual(['checkout', 'pipeline', 'notes']);
    expect(ids({ projectId: 'client', billableOnly: true })).toEqual([
      'checkout',
      'pipeline',
      'sync',
    ]);
    expect(ids({ tags: ['frontend', 'implementation'] })).toEqual(['checkout', 'pipeline']);
  });
});

describe('buildReport', () => {
  const entries = [
    entry('checkout', at(0, 9), at(0, 10, 7)), // Mon 1:07
    entry('checkout', at(0, 14), at(0, 14, 7)), // Mon 0:07
    entry('checkout', at(2, 9), at(2, 11)), // Wed 2:00
    entry('pipeline', at(1, 23), at(2, 1)), // Tue 1:00 + Wed 1:00 (crosses midnight)
    entry('sync', at(3, 10), at(3, 10, 30)), // Thu 0:30
    entry('notes', at(3, 11), at(3, 11, 20)), // Thu 0:20, non-billable
    entry('books', at(4, 16), null), // Fri, running since 16:00
    entry('checkout', at(1, 9), at(1, 10), { deletedAt: 1 }), // deleted
    entry('checkout', at(-1, 9), at(-1, 10)), // last week
    entry('sync', at(6, 23), at(7, 1)), // Sun 23:00 → Mon 01:00: only Sunday counts
  ];
  const data = { projects, tasks, entries };

  it('groups task rows by project in tree order, with day and grand totals', () => {
    const report = buildReport(data, { range: WEEK, now: NOW, filters: ALL });
    expect(report.days).toHaveLength(7);
    expect(report.groups.map((g) => [g.name, g.rows.map((r) => r.taskId)])).toEqual([
      ['Client work / Harbor Coffee — website / Build', ['checkout', 'pipeline', 'notes']],
      ['Client work / Support retainer', ['sync']],
      ['Internal', ['books']],
    ]);
    const checkout = report.groups[0].rows[0];
    expect(checkout.cells).toEqual([74 * MIN, 0, 2 * HOUR, 0, 0, 0, 0]);
    expect(checkout.total).toBe(194 * MIN);
    expect(report.groups[0].rows[1].cells).toEqual([0, HOUR, HOUR, 0, 0, 0, 0]);
    expect(report.groups[1].rows[0].cells).toEqual([0, 0, 0, 30 * MIN, 0, 0, HOUR]);
    const books = report.groups[2].rows[0];
    expect(books.cells[4]).toBe(HOUR);
    expect(books.running).toEqual([false, false, false, false, true, false, false]);
    expect(report.dayTotals).toEqual([74 * MIN, HOUR, 3 * HOUR, 50 * MIN, HOUR, 0, HOUR]);
    expect(report.total).toBe(report.dayTotals.reduce((a, b) => a + b, 0));
  });

  it('rounds per entry: every entry part of a day rounded up', () => {
    const rounding = /** @type {const} */ ({ minutes: 15, mode: 'entry' });
    const report = buildReport(data, { range: WEEK, now: NOW, filters: ALL, rounding });
    const checkout = report.groups[0].rows[0];
    // 1:07 → 1:15 and 0:07 → 0:15.
    expect(checkout.cells[0]).toBe(90 * MIN);
    expect(checkout.raw[0]).toBe(74 * MIN);
    expect(report.groups[1].rows[0].cells[3]).toBe(30 * MIN);
    expect(report.groups[0].rows[2].cells[3]).toBe(30 * MIN); // 0:20 → 0:30
  });

  it('rounds per day: each task day summed, then rounded up', () => {
    const rounding = /** @type {const} */ ({ minutes: 15, mode: 'day' });
    const report = buildReport(data, { range: WEEK, now: NOW, filters: ALL, rounding });
    expect(report.groups[0].rows[0].cells[0]).toBe(75 * MIN); // 1:14 → 1:15
  });

  it.each([
    [5, 'entry', 70 + 10],
    [5, 'day', 75],
    [6, 'entry', 72 + 12],
    [6, 'day', 78],
    [15, 'entry', 75 + 15],
    [15, 'day', 75],
    [0, 'entry', 74],
    [0, 'day', 74],
  ])('rounds Monday to a %i-minute step per %s as %i min', (minutes, mode, expected) => {
    const rounding = /** @type {any} */ ({ minutes, mode });
    const report = buildReport(data, { range: WEEK, now: NOW, filters: ALL, rounding });
    expect(report.groups[0].rows[0].cells[0]).toBe(expected * MIN);
    expect(report.dayTotals[0]).toBe(expected * MIN);
  });

  it('rounds the parts of an entry that crosses midnight separately', () => {
    const crossing = [entry('pipeline', at(1, 23, 50), at(2, 0, 10))];
    const rounding = /** @type {const} */ ({ minutes: 15, mode: 'entry' });
    const report = buildReport(
      { projects, tasks, entries: crossing },
      { range: WEEK, now: NOW, filters: ALL, rounding },
    );
    expect(report.groups[0].rows[0].cells.slice(1, 3)).toEqual([15 * MIN, 15 * MIN]);
  });

  it('counts the whole 25-hour DST Sunday', () => {
    const sunday = [entry('sync', at(6, 0), at(7, 0))];
    const report = buildReport(
      { projects, tasks, entries: sunday },
      { range: WEEK, now: at(8, 0), filters: ALL },
    );
    expect(report.groups[0].rows[0].cells[6]).toBe(25 * HOUR);
  });

  it('summarises per project with rolled-up billable time, inherited rates and amounts', () => {
    const report = buildReport(data, { range: WEEK, now: NOW, filters: ALL });
    expect(
      report.summary.map((row) => [
        row.name,
        row.depth,
        row.total / MIN,
        row.billable / MIN,
        row.rate,
      ]),
    ).toEqual([
      ['Client work', 0, 194 + 120 + 20 + 90, 194 + 120 + 90, 95],
      ['Harbor Coffee — website', 1, 334, 314, 120],
      ['Build', 2, 334, 314, 120],
      ['Support retainer', 1, 90, 90, 95],
      ['Internal', 0, 60, 0, null],
    ]);
    // Build: 314 min at 120/h = 628; Support: 90 min at 95/h (inherited) = 142.5.
    expect(report.summary[2].amount).toBeCloseTo(628);
    expect(report.summary[3].amount).toBeCloseTo(142.5);
    expect(report.summary[0].amount).toBeCloseTo(770.5);
    expect(report.summary[4].amount).toBeNull();
    expect(report.summary[4].nonBillable).toBe(HOUR);
    expect(report.totals).toEqual({
      total: report.total,
      billable: 404 * MIN,
      nonBillable: 80 * MIN,
      amount: expect.closeTo(770.5),
    });
  });

  it('bills the rounded time', () => {
    const rounding = /** @type {const} */ ({ minutes: 15, mode: 'day' });
    const report = buildReport(
      { projects, tasks, entries: [entry('sync', at(0, 9), at(0, 9, 1))] },
      { range: WEEK, now: NOW, filters: ALL, rounding },
    );
    expect(report.totals.billable).toBe(15 * MIN);
    expect(report.totals.amount).toBeCloseTo(95 / 4);
  });

  it('applies the filters to rows, totals and summary', () => {
    const report = buildReport(data, {
      range: WEEK,
      now: NOW,
      filters: { projectId: 'harbor', billableOnly: true, tags: [] },
    });
    expect(report.groups.flatMap((g) => g.rows.map((r) => r.taskId))).toEqual([
      'checkout',
      'pipeline',
    ]);
    expect(report.summary.map((row) => [row.name, row.depth])).toEqual([
      ['Harbor Coffee — website', 0],
      ['Build', 1],
    ]);
    expect(report.totals.nonBillable).toBe(0);
  });

  it('shows extra rows without time, and leaves out unknown or filtered ones', () => {
    const report = buildReport(
      { projects, tasks, entries: [] },
      {
        range: WEEK,
        now: NOW,
        filters: { ...ALL, billableOnly: true },
        extraTaskIds: ['sync', 'books', 'gone'],
      },
    );
    expect(report.groups.map((g) => g.rows.map((r) => [r.taskId, r.total]))).toEqual([
      [['sync', 0]],
    ]);
    expect(report.summary).toEqual([]);
    expect(report.totals.amount).toBeNull();
  });

  it('includes archived projects and orphans, and survives a stored parent cycle', () => {
    const odd = [
      ...projects,
      project('old', 'Old client', null, { archived: true, order: 2 }),
      project('orphan', 'Orphan', 'missing', { order: 3 }),
      project('a', 'Loop A', 'b'),
      project('b', 'Loop B', 'a'),
    ];
    const more = [
      task('t-old', 'old', 'Old task'),
      task('t-orphan', 'orphan', 'Orphan task'),
      task('t-a', 'a', 'Loop task'),
    ];
    const report = buildReport(
      {
        projects: odd,
        tasks: [...tasks, ...more],
        entries: more.map((t) => entry(t.id, at(0, 9), at(0, 10))),
      },
      { range: WEEK, now: NOW, filters: ALL },
    );
    expect(report.groups.map((g) => g.rows[0].taskId)).toEqual(['t-old', 't-orphan', 't-a']);
    expect(report.summary.find((row) => row.projectId === 'a')?.total).toBe(HOUR);
  });
});

describe('reportCsv', () => {
  it('writes one row per task and day with rounded minutes, hours, rate and amount', () => {
    const entries = [
      entry('checkout', at(0, 9), at(0, 9, 50)),
      entry('notes', at(0, 10), at(0, 10, 20)),
      entry('books', at(1, 9), at(1, 10)),
      entry('sync', at(1, 9), at(1, 9, 5)),
    ];
    const tagged = tasks.map((t) =>
      t.id === 'checkout' ? { ...t, tags: ['Frontend', '=SUM(A1)'] } : t,
    );
    const report = buildReport(
      { projects, tasks: tagged, entries },
      { range: WEEK, now: NOW, filters: ALL, rounding: { minutes: 15, mode: 'entry' } },
    );
    const headers = Object.fromEntries(REPORT_CSV_COLUMNS.map((c) => [c, c.toUpperCase()]));
    const text = reportCsv(report, {
      projects,
      tasks: tagged,
      headers: /** @type {any} */ (headers),
    });
    expect(text.startsWith(UTF8_BOM)).toBe(true);
    expect(parseCsv(text.slice(1))).toEqual([
      ['DATE', 'PROJECT', 'TASK', 'BILLABLE', 'TAGS', 'MINUTES', 'HOURS', 'RATE', 'AMOUNT'],
      [
        '2026-10-19',
        'Client work / Harbor Coffee — website / Build',
        'Checkout form validation',
        'true',
        'Frontend; =SUM(A1)',
        '60',
        '1.00',
        '120.00',
        '120.00',
      ],
      [
        '2026-10-19',
        'Client work / Harbor Coffee — website / Build',
        'Client call notes',
        'false',
        '',
        '30',
        '0.50',
        '120.00',
        '',
      ],
      [
        '2026-10-20',
        'Client work / Support retainer',
        'Weekly client sync',
        'true',
        '',
        '15',
        '0.25',
        '95.00',
        '23.75',
      ],
      ['2026-10-20', 'Internal', 'Bookkeeping', 'false', '', '60', '1.00', '', ''],
    ]);
  });
});
