import { describe, expect, it } from 'vitest';
import { ImportError } from '../../src/lib/errors.js';
import { LIMITS } from '../../src/lib/limits.js';
import { parseSuperProductivity } from '../../src/lib/sp-import.js';
import { SP_COUNTS, local, spBackup } from './sp-fixture.js';

const NAMES = { untitled: '(Untitled)', inbox: 'Inbox' };
const HOUR = 3_600_000;
const MIN = 60_000;

/** @param {unknown} backup @param {Partial<Parameters<typeof parseSuperProductivity>[1]>} [options] */
const parse = (backup, options = {}) =>
  parseSuperProductivity(JSON.stringify(backup), { ...NAMES, ...options });

/** @param {() => unknown} fn @param {string} code */
function expectImportError(fn, code) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    expect(/** @type {ImportError} */ (error).code).toBe(code);
    return;
  }
  throw new Error(`expected ImportError ${code}`);
}

describe('parseSuperProductivity: the fixture', () => {
  const { batch, summary, skipped } = parse(spBackup());
  const project = (/** @type {string} */ key) => batch.projects.find((p) => p.key === key);
  const task = (/** @type {string} */ name) => batch.tasks.find((t) => t.name === name);
  const entriesOf = (/** @type {string} */ name) =>
    batch.entries.filter((e) => e.taskKey === task(name)?.key);

  it('summarises the backup', () => {
    expect(summary).toEqual({
      exportedAt: local(10, 20, 18),
      folders: SP_COUNTS.folders,
      projects: SP_COUNTS.projects,
      tasks: SP_COUNTS.tasks,
      entries: SP_COUNTS.entries,
      range: { from: local(3, 29, 0), to: local(10, 25, 0) },
    });
    expect(skipped).toBe(SP_COUNTS.skipped);
  });

  it('turns menu folders into parent projects, in menu order', () => {
    expect(batch.projects.map((p) => [p.key, p.parentKey, p.name])).toEqual([
      ['sp-f-f-client', null, 'Client work'],
      ['sp-f-f-side', null, 'Side projects'],
      ['sp-f-f-writing', 'sp-f-f-side', 'Writing'],
      ['sp-p-harbor', 'sp-f-f-client', 'Harbor Coffee — website'],
      ['sp-p-atlas', 'sp-f-f-client', 'Atlas Bikes'],
      ['sp-p-blog', 'sp-f-f-writing', 'Riding blog'],
      ['sp-p-INBOX_PROJECT', null, 'Inbox'],
      ['sp-p-old', null, 'Spring campaign'],
    ]);
    for (const p of batch.projects) expect(p.id).toBe(p.key);
  });

  it('keeps the archive state and picks the nearest palette colour', () => {
    expect(project('sp-p-old')).toMatchObject({ archived: true, color: '#ea7308' });
    expect(project('sp-p-harbor')).toMatchObject({ archived: false, color: '#25a6a0' });
    expect(project('sp-p-atlas')?.color).toBe('#1d783b');
    expect(project('sp-p-blog')?.color).toBe('#e247c4');
    expect(project('sp-f-f-client')?.color).toBe('#2493ef');
  });

  it('maps task fields', () => {
    expect(task('Checkout form validation')).toEqual({
      key: 'sp-t-checkout',
      id: 'sp-t-checkout',
      projectKey: 'sp-p-harbor',
      name: 'Checkout form validation',
      status: 'open',
      doneAt: null,
      estimateMin: 120,
      notes: 'Check the postcode rules.',
      tags: ['design'],
      billable: false,
    });
    expect(task('Frame size guide')).toMatchObject({ status: 'done', doneAt: local(10, 16, 17) });
    expect(task('Draft: winter riding')?.tags).toEqual(['client']);
  });

  it('imports archived tasks as done, after the listed ones', () => {
    expect(task('Launch checklist')).toMatchObject({ status: 'done', doneAt: null });
    const harbor = batch.tasks.filter((t) => t.projectKey === 'sp-p-harbor').map((t) => t.name);
    expect(harbor).toEqual([
      'Checkout form validation',
      'Product image pipeline',
      'Product image pipeline › Resize originals',
      'Product image pipeline › Upload to the image host',
      '(Untitled)',
      'Bad values',
      'Launch checklist',
    ]);
  });

  it('names subtasks after their parent and keeps only the parent’s own time', () => {
    expect(entriesOf('Product image pipeline')).toEqual([
      expect.objectContaining({ day: '2026-10-19', ms: 10 * MIN }),
    ]);
    expect(entriesOf('Product image pipeline › Resize originals').map((e) => e.ms)).toEqual([
      30 * MIN,
      45 * MIN,
    ]);
  });

  it('puts tasks without a known project in the Inbox', () => {
    expect(task('Expense report')?.projectKey).toBe('sp-p-INBOX_PROJECT');
  });

  it('derives entry ids and work starts', () => {
    expect(entriesOf('Checkout form validation')).toEqual([
      {
        id: 'sp-e-checkout-2026-10-19',
        taskKey: 'sp-t-checkout',
        note: '',
        day: '2026-10-19',
        ms: HOUR,
        from: local(10, 19, 9, 30),
      },
      {
        id: 'sp-e-checkout-2026-10-20',
        taskKey: 'sp-t-checkout',
        note: '',
        day: '2026-10-20',
        ms: 1.5 * HOUR,
        from: local(10, 20, 8, 15),
      },
    ]);
    // No Today tag that day: the earliest project start.
    expect(entriesOf('Frame size guide')[0].from).toBe(local(10, 16, 10));
    // Flushed to the archive.
    expect(entriesOf('Launch checklist')[0].from).toBe(local(10, 12, 8, 30));
    // Nothing known: 09:00.
    expect(entriesOf('Draft: winter riding').map((e) => e.from)).toEqual([
      local(3, 29, 9),
      local(10, 25, 9),
    ]);
  });

  it('leaves out bad and empty day values', () => {
    expect(entriesOf('Bad values')).toEqual([]);
    expect(entriesOf('(Untitled)')).toEqual([]);
  });
});

describe('parseSuperProductivity: file shapes', () => {
  it('accepts bare data without the wrapper', () => {
    const { batch, summary } = parse(spBackup().data);
    expect(summary.exportedAt).toBeNull();
    expect(batch.tasks).toHaveLength(SP_COUNTS.tasks);
  });

  it('works without a menu tree, time tracking, tags or archives', () => {
    const backup = spBackup();
    const data = /** @type {Record<string, unknown>} */ (backup.data);
    for (const key of ['menuTree', 'timeTracking', 'tag', 'archiveYoung', 'archiveOld']) {
      delete data[key];
    }
    const { batch, summary } = parse(backup);
    expect(summary.folders).toBe(0);
    expect(batch.projects.every((p) => p.parentKey === null)).toBe(true);
    expect(batch.tasks.every((t) => t.tags.length === 0)).toBe(true);
    expect(batch.tasks.some((t) => t.name === 'Launch checklist')).toBe(false);
    const checkout = batch.entries.find((e) => e.id === 'sp-e-checkout-2026-10-20');
    expect(checkout?.from).toBe(local(10, 20, 9));
  });

  it('adds an Inbox when the backup has none and a task needs one', () => {
    const backup = spBackup();
    const projects = backup.data.project;
    delete (/** @type {Record<string, unknown>} */ (projects.entities).INBOX_PROJECT);
    projects.ids = projects.ids.filter((id) => id !== 'INBOX_PROJECT');
    const { batch } = parse(backup, { inbox: 'Boîte de réception' });
    expect(batch.projects.at(-1)).toMatchObject({
      key: 'sp-p-INBOX_PROJECT',
      name: 'Boîte de réception',
      parentKey: null,
    });
    expect(batch.tasks.find((t) => t.name === 'Late call notes')?.projectKey).toBe(
      'sp-p-INBOX_PROJECT',
    );
  });

  it('rejects files that aren’t Super Productivity backups', () => {
    expectImportError(() => parseSuperProductivity('{', NAMES), 'json');
    expectImportError(() => parse([]), 'format');
    expectImportError(() => parse({ data: {} }), 'format');
    expectImportError(() => parse({ task: { entities: {} } }), 'format');
    expectImportError(
      () => parse({ format: 'thunderbird-time-tracker', version: 1, projects: [] }),
      'time-tracker-backup',
    );
    expectImportError(() => parseSuperProductivity(/** @type {any} */ (null), NAMES), 'format');
  });

  it('refuses a file over the size limit, counted in UTF-8 bytes', () => {
    const text = JSON.stringify(spBackup());
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(bytes).toBeGreaterThan(text.length);
    expectImportError(
      () => parseSuperProductivity(text, { ...NAMES, maxBytes: bytes - 1 }),
      'too-large',
    );
    expect(() => parseSuperProductivity(text, { ...NAMES, maxBytes: bytes })).not.toThrow();
  });
});

describe('parseSuperProductivity: hostile and odd values', () => {
  it('reads __proto__ keys as plain data', () => {
    const text = JSON.stringify(spBackup()).replace(
      '"checkout":{',
      '"__proto__":{"id":"__proto__","title":"Proto","projectId":"harbor","tagIds":["__proto__"],' +
        '"timeSpentOnDay":{"__proto__":5,"2026-10-21":600000}},"checkout":{',
    );
    const { batch } = parseSuperProductivity(text, NAMES);
    expect(batch.tasks.find((t) => t.key === 'sp-t-__proto__')).toMatchObject({
      name: 'Proto',
      tags: [],
    });
    expect(batch.entries.find((e) => e.id === 'sp-e-__proto__-2026-10-21')?.ms).toBe(10 * MIN);
    expect(/** @type {any} */ ({}).title).toBeUndefined();
  });

  it('cuts long text, collapses whitespace and names blank records', () => {
    const backup = spBackup();
    const entities = /** @type {Record<string, any>} */ (backup.data.task.entities);
    entities.checkout.title = `  Two\nlines\t${'x'.repeat(LIMITS.name)}`;
    entities.checkout.notes = 'n'.repeat(LIMITS.text + 10);
    entities.images.title = '';
    /** @type {any} */ (backup.data.menuTree.projectTree[0]).name = ' ';
    const { batch } = parse(backup);
    const checkout = batch.tasks.find((t) => t.key === 'sp-t-checkout');
    expect(checkout?.name).toHaveLength(LIMITS.name);
    expect(checkout?.name.startsWith('Two lines x')).toBe(true);
    expect(checkout?.notes).toHaveLength(LIMITS.text);
    expect(batch.tasks.find((t) => t.key === 'sp-t-resize')?.name).toBe(
      '(Untitled) › Resize originals',
    );
    expect(batch.projects[0].name).toBe('(Untitled)');
  });

  it('keeps at most LIMITS.tags distinct tags', () => {
    const backup = spBackup();
    const tags = /** @type {Record<string, any>} */ (backup.data.tag.entities);
    const ids = Array.from({ length: LIMITS.tags + 5 }, (_, i) => `t${i}`);
    for (const id of ids) tags[id] = { id, title: `tag ${id}` };
    backup.data.tag.ids.push(...ids);
    /** @type {any} */ (backup.data.task.entities.checkout).tagIds = [...ids, 't0'];
    const { batch } = parse(backup);
    expect(batch.tasks.find((t) => t.key === 'sp-t-checkout')?.tags).toHaveLength(LIMITS.tags);
  });

  it('counts records without a usable id', () => {
    const backup = spBackup();
    const entities = /** @type {Record<string, any>} */ (backup.data.task.entities);
    entities[''] = { title: 'No id' };
    entities['y'.repeat(81)] = { id: 'y'.repeat(81), title: 'Long id' };
    backup.data.task.ids.push('', 'y'.repeat(81));
    const { batch, skipped } = parse(backup);
    expect(skipped).toBe(SP_COUNTS.skipped + 2);
    expect(batch.tasks).toHaveLength(SP_COUNTS.tasks);
  });

  it('treats a subtask of a subtask as a top-level task, and ignores self-parents', () => {
    const backup = spBackup();
    const entities = /** @type {Record<string, any>} */ (backup.data.task.entities);
    entities.deep = { id: 'deep', title: 'Deep', projectId: 'harbor', parentId: 'resize' };
    entities.self = { id: 'self', title: 'Self', projectId: 'harbor', parentId: 'self' };
    backup.data.task.ids.push('deep', 'self');
    const { batch } = parse(backup);
    expect(batch.tasks.find((t) => t.key === 'sp-t-deep')?.name).toBe('Deep');
    expect(batch.tasks.find((t) => t.key === 'sp-t-self')?.name).toBe('Self');
  });

  it('keeps a subtask under a parent whose own parent id dangles (no double count)', () => {
    const backup = spBackup();
    /** @type {any} */ (backup.data.task.entities.images).parentId = 'deleted-task';
    const { batch } = parse(backup);
    const names = batch.tasks.map((t) => t.name);
    expect(names).toContain('Product image pipeline › Resize originals');
    expect(names).not.toContain('Resize originals');
    const parent = batch.entries.filter((e) => e.taskKey === 'sp-t-images');
    expect(parent.map((e) => e.ms)).toEqual([10 * MIN]);
  });

  it('cuts a long parent title so its subtasks keep distinct names', () => {
    const backup = spBackup();
    /** @type {any} */ (backup.data.task.entities.images).title = 'p'.repeat(LIMITS.name);
    const { batch } = parse(backup);
    const subs = batch.tasks.filter((t) => t.key === 'sp-t-resize' || t.key === 'sp-t-upload');
    expect(subs.map((t) => t.name.length)).toEqual([LIMITS.name, LIMITS.name]);
    expect(subs[0].name.endsWith(' › Resize originals')).toBe(true);
    expect(subs[1].name.endsWith(' › Upload to the image host')).toBe(true);
  });

  it('counts a day key that starts before the epoch (east of UTC) as unreadable', () => {
    const backup = spBackup();
    /** @type {any} */ (backup.data.task.entities.checkout).timeSpentOnDay['1970-01-01'] = HOUR;
    const { batch, skipped } = parse(backup);
    expect(skipped).toBe(SP_COUNTS.skipped + 1);
    expect(batch.entries.some((e) => e.day === '1970-01-01')).toBe(false);
  });

  it('ignores a work start on another day and malformed menu nodes', () => {
    const backup = spBackup();
    const today = /** @type {Record<string, any>} */ (backup.data.timeTracking.tag.TODAY);
    today['2026-10-20'].s = local(10, 19, 8);
    backup.data.menuTree.projectTree.push(
      /** @type {any} */ (null),
      /** @type {any} */ ({ k: 'p', id: 'unknown' }),
      /** @type {any} */ ({ k: 'f', id: 'f-client', name: 'Again', children: [] }),
    );
    const { batch, summary } = parse(backup);
    expect(batch.entries.find((e) => e.id === 'sp-e-checkout-2026-10-20')?.from).toBe(
      local(10, 20, 9),
    );
    expect(summary.folders).toBe(SP_COUNTS.folders);
  });
});
