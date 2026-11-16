// A fictional Super Productivity backup (crossModelVersion 4.5 shape) for the S7 import tests,
// unit and UI. Times are local (the tests run in Europe/Berlin) around Tue 2026-10-20.

const HOUR = 3_600_000;
const MIN = 60_000;
/** Local time. @param {number} m @param {number} d @param {number} h @param {number} [min] */
export const local = (m, d, h, min = 0) => new Date(2026, m - 1, d, h, min).getTime();

/** @param {Record<string, object>} entities */
const state = (entities) => ({ ids: Object.keys(entities), entities });

/**
 * A task record with Super Productivity's fields and defaults.
 * @param {string} id
 * @param {Record<string, unknown>} fields
 */
const task = (id, fields) => ({
  id,
  title: id,
  subTaskIds: [],
  timeSpentOnDay: {},
  timeSpent: 0,
  timeEstimate: 0,
  isDone: false,
  tagIds: [],
  created: local(10, 1, 9),
  attachments: [],
  ...fields,
});

/**
 * @param {string} id
 * @param {string} title
 * @param {string} primary
 * @param {string[]} taskIds
 * @param {boolean} [isArchived]
 */
const project = (id, title, primary, taskIds, isArchived = false) => ({
  id,
  title,
  isArchived,
  isHiddenFromMenu: false,
  theme: { primary, isAutoContrast: true },
  taskIds,
  backlogTaskIds: [],
  noteIds: [],
});

/** The backup as an object; `JSON.stringify` it for a file. */
export function spBackup() {
  return {
    timestamp: local(10, 20, 18),
    lastUpdate: local(10, 20, 18),
    crossModelVersion: 4.5,
    data: {
      task: {
        ...state({
          checkout: task('checkout', {
            title: 'Checkout form validation',
            projectId: 'harbor',
            tagIds: ['TODAY', 'tag-design'],
            notes: 'Check the postcode rules.',
            timeEstimate: 2 * HOUR,
            timeSpentOnDay: { '2026-10-19': HOUR, '2026-10-20': 1.5 * HOUR },
          }),
          images: task('images', {
            title: 'Product image pipeline',
            projectId: 'harbor',
            subTaskIds: ['resize', 'upload'],
            // Super Productivity adds subtask time to the parent: 10 min of its own on the 19th.
            timeSpentOnDay: { '2026-10-19': 40 * MIN, '2026-10-20': HOUR },
          }),
          resize: task('resize', {
            title: 'Resize originals',
            projectId: 'harbor',
            parentId: 'images',
            timeSpentOnDay: { '2026-10-19': 30 * MIN, '2026-10-20': 45 * MIN },
          }),
          upload: task('upload', {
            title: 'Upload to the image host',
            projectId: 'harbor',
            parentId: 'images',
            timeSpentOnDay: { '2026-10-20': 15 * MIN },
          }),
          blank: task('blank', { title: '   ', projectId: 'harbor' }),
          bad: task('bad', {
            title: 'Bad values',
            projectId: 'harbor',
            timeSpentOnDay: {
              '2026-13-01': MIN,
              '2026-10-20': -5,
              '2026-10-17': 25 * HOUR,
              '2026-10-15': 'an hour',
              '2026-10-14': 0,
              '2026-10-13': 500,
            },
          }),
          fitting: task('fitting', {
            title: 'Frame size guide',
            projectId: 'atlas',
            isDone: true,
            doneOn: local(10, 16, 17),
            timeSpentOnDay: { '2026-10-16': 2 * HOUR },
          }),
          draft: task('draft', {
            title: 'Draft: winter riding',
            projectId: 'blog',
            tagIds: ['tag-client', 'missing-tag'],
            timeSpentOnDay: { '2026-10-25': HOUR, '2026-03-29': 30 * MIN },
          }),
          late: task('late', {
            title: 'Late call notes',
            projectId: 'INBOX_PROJECT',
            timeSpentOnDay: { '2026-10-18': 2 * HOUR },
          }),
          orphan: task('orphan', {
            title: 'Expense report',
            projectId: 'deleted-project',
            timeSpentOnDay: { '2026-10-20': 10 * MIN },
          }),
        }),
        currentTaskId: null,
        isDataLoaded: true,
      },
      project: state({
        INBOX_PROJECT: project('INBOX_PROJECT', 'Inbox', '#2493ef', ['late']),
        harbor: project('harbor', 'Harbor Coffee — website', '#25a6a0', [
          'checkout',
          'images',
          'blank',
          'bad',
        ]),
        atlas: project('atlas', 'Atlas Bikes', 'rgb(30, 120, 60)', ['fitting']),
        blog: project('blog', 'Riding blog', '#d040b0', ['draft']),
        old: project('old', 'Spring campaign', 'rgb(234, 115, 8)', [], true),
      }),
      tag: state({
        TODAY: { id: 'TODAY', title: 'Today', taskIds: [], created: 0 },
        'tag-design': { id: 'tag-design', title: 'design', taskIds: [], created: 0 },
        'tag-client': { id: 'tag-client', title: ' client ', taskIds: [], created: 0 },
      }),
      menuTree: {
        projectTree: [
          {
            k: 'f',
            id: 'f-client',
            name: 'Client work',
            isExpanded: true,
            children: [
              { k: 'p', id: 'harbor' },
              { k: 'p', id: 'atlas' },
            ],
          },
          {
            k: 'f',
            id: 'f-side',
            name: 'Side projects',
            children: [
              { k: 'f', id: 'f-writing', name: 'Writing', children: [{ k: 'p', id: 'blog' }] },
            ],
          },
        ],
        tagTree: [],
      },
      timeTracking: {
        tag: {
          TODAY: {
            '2026-10-20': { s: local(10, 20, 8, 15), e: local(10, 20, 17), b: 0, bt: 0 },
            '2026-10-19': { s: local(10, 19, 9, 30), e: local(10, 19, 12), b: 0, bt: 0 },
            '2026-10-18': { s: local(10, 18, 23), e: local(10, 18, 23, 59), b: 0, bt: 0 },
          },
        },
        project: {
          harbor: { '2026-10-16': { s: local(10, 16, 10), e: local(10, 16, 11) } },
          atlas: { '2026-10-16': { s: local(10, 16, 13), e: local(10, 16, 15) } },
        },
      },
      archiveYoung: {
        task: state({
          shipped: task('shipped', {
            title: 'Launch checklist',
            projectId: 'harbor',
            isDone: true,
            timeSpentOnDay: { '2026-10-12': HOUR },
          }),
        }),
        timeTracking: {
          tag: {},
          project: {
            harbor: { '2026-10-12': { s: local(10, 12, 8, 30), e: local(10, 12, 9, 30) } },
          },
        },
        lastTimeTrackingFlush: local(10, 13, 0),
      },
      archiveOld: {
        task: { ids: [], entities: {} },
        timeTracking: { tag: {}, project: {} },
        lastTimeTrackingFlush: local(10, 13, 0),
      },
      globalConfig: { misc: { startOfNextDay: 0 } },
      note: { ids: [], entities: {}, todayOrder: [] },
      simpleCounter: { ids: [], entities: {} },
    },
  };
}

/** What the fixture adds to an empty database. */
export const SP_COUNTS = { folders: 3, projects: 5, tasks: 11, entries: 12, skipped: 4 };
