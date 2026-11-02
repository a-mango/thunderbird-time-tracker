import { describe, expect, it } from 'vitest';
import {
  defaultFilter,
  filterTasks,
  isFiltering,
  readFilter,
  scopeTasks,
  tagsOf,
} from '../../src/lib/task-list.js';

/** @returns {import('../../src/lib/types.js').Task} */
function task(id, extra = {}) {
  return {
    id,
    projectId: 'build',
    name: `Task ${id}`,
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
    ...extra,
  };
}

const TASKS = [
  task('checkout', {
    name: 'Checkout form validation',
    starred: true,
    billable: true,
    tags: ['Frontend', 'Implementation'],
  }),
  task('pipeline', { name: 'Product image pipeline', billable: true, tags: ['Implementation'] }),
  task('nav', { name: 'Fix mobile nav overflow', starred: true, tags: ['frontend'] }),
  task('refactor', { name: 'Form state refactor', status: 'done', tags: ['Frontend'] }),
  task('notes', { name: 'Client call notes', notes: 'Re: Checkout flow — client feedback' }),
  task('sync', { projectId: 'support', name: 'Weekly client sync', starred: true }),
];
const ids = (/** @type {{id: string}[]} */ list) => list.map((t) => t.id);

describe('scopeTasks', () => {
  const totals = /** @type {Record<string, {today: number, week: number, total: number}>} */ ({
    checkout: { today: 5, week: 10, total: 20 },
    nav: { today: 0, week: 3, total: 3 },
  });
  const totalsOf = (/** @type {string} */ id) => totals[id] ?? { today: 0, week: 0, total: 0 };

  it('shows a project’s own tasks', () => {
    expect(ids(scopeTasks(TASKS, { type: 'project', id: 'support' }, totalsOf, null))).toEqual([
      'sync',
    ]);
  });

  it('shows tasks with time today or this week, and the running task', () => {
    const today = { type: 'view', id: 'today' };
    const week = { type: 'view', id: 'week' };
    expect(ids(scopeTasks(TASKS, /** @type {any} */ (today), totalsOf, null))).toEqual([
      'checkout',
    ]);
    expect(ids(scopeTasks(TASKS, /** @type {any} */ (today), totalsOf, 'notes'))).toEqual([
      'checkout',
      'notes',
    ]);
    expect(ids(scopeTasks(TASKS, /** @type {any} */ (week), totalsOf, null))).toEqual([
      'checkout',
      'nav',
    ]);
  });

  it('shows starred tasks across projects', () => {
    expect(ids(scopeTasks(TASKS, { type: 'view', id: 'starred' }, totalsOf, null))).toEqual([
      'checkout',
      'nav',
      'sync',
    ]);
  });
});

describe('filterTasks', () => {
  const build = TASKS.filter((t) => t.projectId === 'build');

  it('hides done tasks by default and counts them', () => {
    const { tasks, doneHidden } = filterTasks(build, defaultFilter());
    expect(ids(tasks)).toEqual(['checkout', 'pipeline', 'nav', 'notes']);
    expect(doneHidden).toBe(1);
    expect(filterTasks(build, defaultFilter(true))).toEqual({ tasks: build, doneHidden: 0 });
  });

  it('combines pills with AND', () => {
    const filter = { ...defaultFilter(), starred: true, billable: true };
    expect(ids(filterTasks(build, filter).tasks)).toEqual(['checkout']);
  });

  it('filters by tags case-insensitively; an empty tag list means any tag', () => {
    expect(ids(filterTasks(build, { ...defaultFilter(), tags: ['FRONTEND'] }).tasks)).toEqual([
      'checkout',
      'nav',
    ]);
    expect(ids(filterTasks(build, { ...defaultFilter(), tags: [] }).tasks)).toEqual([
      'checkout',
      'pipeline',
      'nav',
    ]);
  });

  it('matches text in names, tags and notes; done tasks it hides are counted', () => {
    expect(ids(filterTasks(build, { ...defaultFilter(), text: ' checkout ' }).tasks)).toEqual([
      'checkout',
      'notes',
    ]);
    expect(ids(filterTasks(build, { ...defaultFilter(), text: 'implement' }).tasks)).toEqual([
      'checkout',
      'pipeline',
    ]);
    expect(filterTasks(build, { ...defaultFilter(), text: 'form' })).toMatchObject({
      doneHidden: 1,
    });
  });
});

describe('filter helpers', () => {
  it('knows when the list is filtered beyond the Open pill', () => {
    expect(isFiltering(defaultFilter())).toBe(false);
    expect(isFiltering({ ...defaultFilter(), open: false })).toBe(false);
    expect(isFiltering({ ...defaultFilter(), text: '  ' })).toBe(false);
    expect(isFiltering({ ...defaultFilter(), text: 'x' })).toBe(true);
    expect(isFiltering({ ...defaultFilter(), tags: [] })).toBe(true);
  });

  it('reads stored filters defensively', () => {
    const fallback = defaultFilter();
    expect(readFilter(null, fallback)).toBe(fallback);
    expect(readFilter('x', fallback)).toBe(fallback);
    expect(
      readFilter({ open: false, starred: 'yes', tags: ['Frontend', 3], text: 7 }, fallback),
    ).toEqual({ open: false, starred: false, billable: false, tags: ['Frontend'], text: '' });
  });

  it('lists distinct tags, first spelling wins, sorted', () => {
    expect(tagsOf(TASKS, 'en')).toEqual(['Frontend', 'Implementation']);
  });
});
