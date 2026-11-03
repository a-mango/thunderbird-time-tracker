import { describe, expect, it } from 'vitest';
import { UTF8_BOM } from '../../src/lib/csv.js';
import { CSV_COLUMNS, backupSummary, entriesCsv, exportFileName } from '../../src/lib/export.js';
import { projectPathName } from '../../src/lib/sidebar.js';
import { parseCsv } from './csv-parse.js';

const MIN = 60_000;
/** Tue 20 Oct 2026, 09:00 local (tests run in Europe/Zurich). */
const DAY = new Date(2026, 9, 20, 9, 0).getTime();

const project = (/** @type {string} */ id, /** @type {string} */ name, parentId = null) => ({
  id,
  name,
  parentId,
  color: '#2493ef',
  order: 0,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
});
const task = (
  /** @type {string} */ id,
  /** @type {string} */ projectId,
  /** @type {string} */ name,
  billable = false,
) => ({
  id,
  projectId,
  name,
  status: /** @type {const} */ ('open'),
  starred: false,
  estimateMin: null,
  billable,
  tags: [],
  notes: '',
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  doneAt: null,
});
const entry = (
  /** @type {string} */ id,
  /** @type {string} */ taskId,
  /** @type {number} */ start,
  /** @type {number | null} */ end,
  note = '',
  deletedAt = /** @type {number | null} */ (null),
) => ({
  id,
  taskId,
  start,
  end,
  note,
  source: /** @type {const} */ ('timer'),
  createdAt: 0,
  updatedAt: 0,
  deletedAt,
});

const data = {
  projects: [
    project('client', 'Client work'),
    project('harbor', 'Harbor Coffee — website', 'client'),
    project('build', 'Build', 'harbor'),
    project('internal', 'Internal'),
  ],
  tasks: [
    task('checkout', 'build', 'Checkout form validation', true),
    task('books', 'internal', 'Monthly bookkeeping'),
  ],
  entries: [
    entry('e2', 'books', DAY + 60 * MIN, DAY + 90 * MIN, 'Receipts, "Q3"\nand invoices'),
    entry('e1', 'checkout', DAY, DAY + 65 * MIN + 29_000, '=SUM(A1)'),
    // Crosses midnight: listed on its start day.
    entry('e3', 'checkout', DAY + 14 * 60 * MIN, DAY + 16 * 60 * MIN, 'Late fix'),
    entry('deleted', 'checkout', DAY + 5 * MIN, DAY + 6 * MIN, '', DAY),
    entry('running', 'books', DAY + 3 * 60 * MIN, null),
    entry('before', 'checkout', DAY - 24 * 60 * MIN, DAY - 23 * 60 * MIN),
  ],
};

/** @type {Record<(typeof CSV_COLUMNS)[number], string>} */
const headers = {
  date: 'Date',
  start: 'Start',
  end: 'End',
  minutes: 'Minutes',
  project: 'Project',
  task: 'Task',
  note: 'Note',
  billable: 'Billable',
};

const range = { from: new Date(2026, 9, 20).getTime(), to: new Date(2026, 9, 22).getTime() };

describe('entriesCsv', () => {
  it('writes one strict RFC 4180 row per stopped entry in range, with a BOM', () => {
    const csv = entriesCsv(data, { ...range, projectId: null, headers });
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    const rows = parseCsv(csv.slice(1));
    expect(rows).toEqual([
      ['Date', 'Start', 'End', 'Minutes', 'Project', 'Task', 'Note', 'Billable'],
      [
        '2026-10-20',
        '09:00',
        '10:05',
        '65',
        'Client work / Harbor Coffee — website / Build',
        'Checkout form validation',
        "'=SUM(A1)",
        'true',
      ],
      [
        '2026-10-20',
        '10:00',
        '10:30',
        '30',
        'Internal',
        'Monthly bookkeeping',
        'Receipts, "Q3"\nand invoices',
        'false',
      ],
      [
        '2026-10-20',
        '23:00',
        '01:00',
        '120',
        'Client work / Harbor Coffee — website / Build',
        'Checkout form validation',
        'Late fix',
        'true',
      ],
    ]);
    expect(rows.every((row) => row.length === CSV_COLUMNS.length)).toBe(true);
  });

  it('keeps only the subtree of the chosen project', () => {
    const rows = parseCsv(entriesCsv(data, { ...range, projectId: 'harbor', headers }).slice(1));
    expect(rows.slice(1).map((row) => row[5])).toEqual([
      'Checkout form validation',
      'Checkout form validation',
    ]);
    const none = parseCsv(entriesCsv(data, { ...range, projectId: 'unknown', headers }).slice(1));
    expect(none).toHaveLength(1);
  });

  it('includes the start and excludes the end of the range', () => {
    const rows = parseCsv(
      entriesCsv(data, { from: DAY, to: DAY + 60 * MIN, projectId: null, headers }).slice(1),
    );
    expect(rows.slice(1).map((row) => row[1])).toEqual(['09:00']);
  });
});

describe('helpers', () => {
  it('names a project path from the root', () => {
    expect(projectPathName(data.projects, 'build')).toBe(
      'Client work / Harbor Coffee — website / Build',
    );
  });

  it('summarises a backup for the restore preview', () => {
    const backup = /** @type {any} */ ({ ...data, exportedAt: DAY });
    expect(backupSummary(backup)).toEqual({
      projects: 4,
      tasks: 2,
      entries: 5,
      exportedAt: DAY,
      range: { from: DAY - 24 * 60 * MIN, to: DAY + 16 * 60 * MIN },
    });
    expect(backupSummary(/** @type {any} */ ({ ...backup, entries: [] })).range).toBeNull();
  });

  it('dates the file name in local time', () => {
    expect(exportFileName(new Date(2026, 9, 20, 23, 30).getTime(), 'csv')).toBe(
      'time-tracker-2026-10-20.csv',
    );
  });
});
