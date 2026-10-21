import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportError } from '../../src/lib/errors.js';
import { MAX_IMPORT_BYTES, parseBackup } from '../../src/lib/importer.js';

const T0 = new Date(2026, 9, 20, 9, 0).getTime();
const MINUTE = 60_000;

function validBackup() {
  return {
    format: 'thunderbird-time-tracker',
    version: 1,
    exportedAt: T0 + 600 * MINUTE,
    projects: [
      {
        id: 'p1',
        parentId: null,
        name: 'Client work',
        color: '#2493ef',
        order: 0,
        archived: false,
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: 'p2',
        parentId: 'p1',
        name: 'Harbor Coffee — website',
        color: '#AE55F7',
        order: 1.5,
        archived: true,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    tasks: [
      {
        id: 't1',
        projectId: 'p2',
        name: 'Checkout form validation',
        status: 'open',
        starred: true,
        estimateMin: 600,
        billable: true,
        tags: ['Frontend', 'Implementation'],
        notes: 'Inline errors for card fields',
        order: 0,
        createdAt: T0,
        updatedAt: T0,
        doneAt: null,
      },
      {
        id: 't2',
        projectId: 'p1',
        name: 'Weekly client sync',
        status: 'done',
        starred: false,
        estimateMin: null,
        billable: false,
        tags: [],
        notes: '',
        order: 1,
        createdAt: T0,
        updatedAt: T0,
        doneAt: T0 + 60 * MINUTE,
      },
    ],
    entries: [
      {
        id: 'e1',
        taskId: 't1',
        start: T0,
        end: T0 + 45 * MINUTE,
        note: '',
        source: 'timer',
        createdAt: T0,
        updatedAt: T0,
        deletedAt: null,
      },
      {
        id: 'e2',
        taskId: 't2',
        start: T0 + 60 * MINUTE,
        end: null,
        note: 'Re: agenda',
        source: 'manual',
        createdAt: T0,
        updatedAt: T0,
        deletedAt: null,
      },
      {
        id: 'e3',
        taskId: 't1',
        start: T0 + 120 * MINUTE,
        end: null,
        note: '',
        source: 'split',
        createdAt: T0,
        updatedAt: T0,
        deletedAt: T0 + 130 * MINUTE,
      },
    ],
    settings: { weekStart: 0, durationFormat: 'decimal' },
  };
}

/**
 * Runs `fn` and returns the ImportError it throws.
 * @param {() => unknown} fn
 * @returns {ImportError}
 */
function importError(fn) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return /** @type {ImportError} */ (error);
  }
  throw new Error('expected an ImportError');
}

/**
 * Parses a modified valid backup and expects a rejection.
 * @param {(backup: any) => void} change
 */
function rejectChange(change) {
  const backup = validBackup();
  change(backup);
  return importError(() => parseBackup(JSON.stringify(backup)));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseBackup accepts', () => {
  it('a valid backup as fresh, deep-equal plain objects', () => {
    const backup = validBackup();
    const result = parseBackup(JSON.stringify(backup));
    expect(result).toEqual(backup);
    expect(Object.getPrototypeOf(result.projects[0])).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.settings)).toBe(Object.prototype);
  });

  it('a backup without settings or records', () => {
    const backup = { ...validBackup(), projects: [], tasks: [], entries: [] };
    delete backup.settings;
    const result = parseBackup(JSON.stringify(backup));
    expect(result).toEqual(backup);
    expect(Object.hasOwn(result, 'settings')).toBe(false);
  });
});

describe('parseBackup size limit', () => {
  it('is 10 MB', () => {
    expect(MAX_IMPORT_BYTES).toBe(10 * 1024 * 1024);
  });

  it('rejects a 10 MB + 1 byte payload before parsing it', () => {
    const parse = vi.spyOn(JSON, 'parse');
    const text = `"${'a'.repeat(MAX_IMPORT_BYTES - 1)}"`;
    expect(text.length).toBe(MAX_IMPORT_BYTES + 1);
    const error = importError(() => parseBackup(text));
    expect(error.code).toBe('too-large');
    expect(parse).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes, not characters', () => {
    const backup = validBackup();
    const text = JSON.stringify(backup); // contains a 3-byte "—"
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(bytes).toBeGreaterThan(text.length);
    expect(parseBackup(text, { maxBytes: bytes })).toEqual(backup);
    expect(importError(() => parseBackup(text, { maxBytes: bytes - 1 })).code).toBe('too-large');
    expect(importError(() => parseBackup('€€€€', { maxBytes: 10 })).code).toBe('too-large');
    // Short enough to skip measuring; then rejected as JSON.
    expect(importError(() => parseBackup('€€€', { maxBytes: 9 })).code).toBe('json');
  });
});

describe('parseBackup rejects', () => {
  it.each([['{'], [''], ['undefined'], ["{'format': 1}"], ['{"a":1,}']])(
    'malformed JSON %j',
    (text) => {
      expect(importError(() => parseBackup(text)).code).toBe('json');
    },
  );

  it.each([['[]'], ['null'], ['42'], ['"backup"'], ['true']])('a %s root', (text) => {
    expect(importError(() => parseBackup(text)).code).toBe('shape');
  });

  it('a non-string input', () => {
    expect(importError(() => parseBackup(/** @type {any} */ ({}))).code).toBe('shape');
  });

  it.each([
    ['another format', (b) => (b.format = 'other-tracker')],
    ['a missing format', (b) => delete b.format],
  ])('%s', (_name, change) => {
    const error = rejectChange(change);
    expect(error.code).toBe('format');
    expect(error.details.path).toBe('format');
  });

  it.each([[2], ['1'], [null], [1.5]])('version %j', (version) => {
    expect(rejectChange((b) => (b.version = version)).code).toBe('version');
  });

  it.each([
    ['projects', (b) => (b.projects = {}), 'projects'],
    ['missing tasks', (b) => delete b.tasks, 'tasks'],
    ['a record', (b) => (b.entries[1] = []), 'entries[1]'],
    ['a null record', (b) => (b.tasks[0] = null), 'tasks[0]'],
    ['tags', (b) => (b.tasks[1].tags = 'Frontend'), 'tasks[1].tags'],
    ['settings', (b) => (b.settings = ['weekStart']), 'settings'],
  ])('a wrong container for %s', (_name, change, path) => {
    const error = rejectChange(change);
    expect(error.code).toBe('shape');
    expect(error.details.path).toBe(path);
  });

  it.each([
    ['exportedAt as a string', (b) => (b.exportedAt = '2026-10-20'), 'exportedAt'],
    ['a numeric name', (b) => (b.projects[0].name = 5), 'projects[0].name'],
    ['an empty name', (b) => (b.projects[0].name = ''), 'projects[0].name'],
    ['an overlong name', (b) => (b.projects[1].name = 'x'.repeat(501)), 'projects[1].name'],
    ['a string boolean', (b) => (b.projects[0].archived = 'yes'), 'projects[0].archived'],
    ['a CSS url() colour', (b) => (b.projects[0].color = 'url(x.png)'), 'projects[0].color'],
    ['an empty id', (b) => (b.projects[0].id = ''), 'projects[0].id'],
    ['an overlong id', (b) => (b.tasks[0].id = 'x'.repeat(101)), 'tasks[0].id'],
    ['a numeric parent id', (b) => (b.projects[1].parentId = 1), 'projects[1].parentId'],
    ['an unknown status', (b) => (b.tasks[0].status = 'closed'), 'tasks[0].status'],
    ['a negative estimate', (b) => (b.tasks[0].estimateMin = -1), 'tasks[0].estimateMin'],
    ['a numeric tag', (b) => (b.tasks[0].tags = ['ok', 7]), 'tasks[0].tags[1]'],
    ['an overlong tag', (b) => (b.tasks[0].tags = ['x'.repeat(101)]), 'tasks[0].tags[0]'],
    ['too many tags', (b) => (b.tasks[0].tags = Array(51).fill('a')), 'tasks[0].tags'],
    ['overlong notes', (b) => (b.tasks[0].notes = 'x'.repeat(100_001)), 'tasks[0].notes'],
    ['a missing field', (b) => delete b.tasks[1].billable, 'tasks[1].billable'],
    ['a fractional time', (b) => (b.entries[0].start = T0 + 0.5), 'entries[0].start'],
    ['a negative time', (b) => (b.entries[0].createdAt = -1), 'entries[0].createdAt'],
    ['a string end', (b) => (b.entries[0].end = '10:00'), 'entries[0].end'],
    ['an unknown source', (b) => (b.entries[0].source = 'robot'), 'entries[0].source'],
    ['a missing deletedAt', (b) => delete b.entries[2].deletedAt, 'entries[2].deletedAt'],
    ['a bad setting', (b) => (b.settings.weekStart = 2), 'settings.weekStart'],
    ['a bad setting type', (b) => (b.settings.durationFormat = 1), 'settings.durationFormat'],
  ])('%s', (_name, change, path) => {
    const error = rejectChange(change);
    expect(error.code).toBe('type');
    expect(error.details.path).toBe(path);
  });

  it('a non-finite number (1e400 parses to Infinity)', () => {
    const text = JSON.stringify(validBackup()).replace('"order":1.5', '"order":1e400');
    const error = importError(() => parseBackup(text));
    expect(error.code).toBe('type');
    expect(error.details.path).toBe('projects[1].order');
  });

  it.each([
    ['at the top level', (b) => (b.extra = true), 'extra'],
    ['in a project', (b) => (b.projects[0].owner = 'x'), 'projects[0].owner'],
    ['in an entry', (b) => (b.entries[2].billable = true), 'entries[2].billable'],
    ['in settings', (b) => (b.settings.theme = 'dark'), 'settings.theme'],
  ])('an unknown field %s', (_name, change, path) => {
    const error = rejectChange(change);
    expect(error.code).toBe('unknown-field');
    expect(error.details.path).toBe(path);
  });

  describe('prototype pollution', () => {
    const text = JSON.stringify(validBackup());
    it.each([
      [
        '__proto__ at the top level',
        text.replace('{', '{"__proto__":{"polluted":1},'),
        '__proto__',
      ],
      [
        '__proto__ in a project',
        text.replace('{"id":"p1"', '{"__proto__":{"polluted":1},"id":"p1"'),
        'projects[0].__proto__',
      ],
      [
        'constructor in a task',
        text.replace('{"id":"t2"', '{"constructor":{"prototype":{"polluted":1}},"id":"t2"'),
        'tasks[1].constructor',
      ],
      [
        'prototype in an entry',
        text.replace('{"id":"e3"', '{"prototype":{"polluted":1},"id":"e3"'),
        'entries[2].prototype',
      ],
      [
        '__proto__ in settings',
        text.replace('"settings":{', '"settings":{"__proto__":{"polluted":1},'),
        'settings.__proto__',
      ],
    ])('rejects %s', (_name, payload, path) => {
      expect(payload).not.toBe(text);
      const error = importError(() => parseBackup(payload));
      expect(error.code).toBe('forbidden-key');
      expect(error.details.path).toBe(path);
      expect(/** @type {any} */ ({}).polluted).toBeUndefined();
      expect(/** @type {any} */ (Object.prototype).polluted).toBeUndefined();
    });
  });

  it.each([
    ['projects', (b) => (b.projects[1].id = 'p1'), 'projects[1].id'],
    ['tasks', (b) => (b.tasks[1].id = 't1'), 'tasks[1].id'],
    ['entries', (b) => (b.entries[2].id = 'e1'), 'entries[2].id'],
  ])('duplicate ids in %s', (_name, change, path) => {
    const error = rejectChange(change);
    expect(error.code).toBe('duplicate-id');
    expect(error.details.path).toBe(path);
  });

  it.each([
    ['a missing parent project', (b) => (b.projects[1].parentId = 'gone'), 'projects[1].parentId'],
    ['a missing project', (b) => (b.tasks[0].projectId = 'gone'), 'tasks[0].projectId'],
    ['a missing task', (b) => (b.entries[1].taskId = 'gone'), 'entries[1].taskId'],
  ])('a reference to %s', (_name, change, path) => {
    const error = rejectChange(change);
    expect(error.code).toBe('dangling-ref');
    expect(error.details.path).toBe(path);
  });

  it.each([
    ['a two-project cycle', (b) => (b.projects[0].parentId = 'p2')],
    ['a self-parent', (b) => (b.projects[0].parentId = 'p1')],
  ])('%s', (_name, change) => {
    expect(rejectChange(change).code).toBe('cycle');
  });

  it('two running entries', () => {
    const error = rejectChange((b) => (b.entries[0].end = null));
    expect(error.code).toBe('multiple-running');
  });

  it.each([
    ['start == end', (b) => (b.entries[0].end = b.entries[0].start)],
    ['start > end', (b) => (b.entries[0].end = b.entries[0].start - 1)],
    [
      'start > end on a deleted entry',
      (b) => {
        b.entries[2].end = b.entries[2].start - MINUTE;
      },
    ],
  ])('%s', (_name, change) => {
    expect(rejectChange(change).code).toBe('time-order');
  });

  it('reports errors as ImportError with a message', () => {
    const error = rejectChange((b) => (b.tasks[0].status = 'closed'));
    expect(error.name).toBe('ImportError');
    expect(error.message).toContain('tasks[0].status');
  });
});
