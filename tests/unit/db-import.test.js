import { describe, expect, it } from 'vitest';
import { computeAggregates, getAggregates } from '../../src/db/aggregates.js';
import { softDeleteEntry, startEntry } from '../../src/db/entries.js';
import { importBatch, previewBatch } from '../../src/db/import.js';
import { listProjects } from '../../src/db/projects.js';
import { listTasks } from '../../src/db/tasks.js';
import { ValidationError } from '../../src/lib/errors.js';
import { parseSuperProductivity } from '../../src/lib/sp-import.js';
import { projectPathName } from '../../src/lib/sidebar.js';
import { splitByDay } from '../../src/lib/time.js';
import { allEntries, freshDB, runningPointer, seed } from './db-helpers.js';
import { SP_COUNTS, local, spBackup } from './sp-fixture.js';

const NAMES = { untitled: '(Untitled)', inbox: 'Inbox' };
const NOW = local(11, 1, 12);
const MIN = 60_000;

/** @param {unknown} backup */
const batchOf = (backup) => parseSuperProductivity(JSON.stringify(backup), NAMES).batch;

describe('importBatch with a Super Productivity backup', () => {
  it('adds the folders, projects, tasks and entries in an empty database', async () => {
    const { db, notify } = await freshDB();
    const plan = await importBatch(db, batchOf(spBackup()), { now: NOW });
    expect(plan.projects).toHaveLength(SP_COUNTS.folders + SP_COUNTS.projects);
    expect(plan.tasks).toHaveLength(SP_COUNTS.tasks);
    expect(plan.entries).toHaveLength(SP_COUNTS.entries);
    expect(plan).toMatchObject({ reused: { projects: 0, tasks: 0 }, skipped: 0, dropped: 0 });

    const projects = await listProjects(db);
    const paths = projects.map((p) => projectPathName(projects, p.id)).sort();
    expect(paths).toEqual([
      'Client work',
      'Client work / Atlas Bikes',
      'Client work / Harbor Coffee — website',
      'Inbox',
      'Side projects',
      'Side projects / Writing',
      'Side projects / Writing / Riding blog',
      'Spring campaign',
    ]);
    const tasks = await listTasks(db);
    expect(tasks.find((t) => t.id === 'sp-t-blank')?.name).toBe('(Untitled)');
    expect(notify).toHaveBeenLastCalledWith({ type: 'reset', ids: ['*'] });
    expect((await runningPointer(db)) ?? null).toBeNull();
  });

  it('places each day’s entries from the work start, end to end', async () => {
    const { db } = await freshDB();
    await importBatch(db, batchOf(spBackup()), { now: NOW });
    const entries = await allEntries(db);
    const tasks = await listTasks(db);
    const name = (/** @type {string} */ id) => tasks.find((t) => t.id === id)?.name;
    const day = entries
      .filter((e) => e.start >= local(10, 20, 0) && e.start < local(10, 21, 0))
      .sort((a, b) => a.start - b.start)
      .map((e) => [name(e.taskId), e.start, e.end]);
    expect(day).toEqual([
      ['Checkout form validation', local(10, 20, 8, 15), local(10, 20, 9, 45)],
      ['Product image pipeline › Resize originals', local(10, 20, 9, 45), local(10, 20, 10, 30)],
      [
        'Product image pipeline › Upload to the image host',
        local(10, 20, 10, 30),
        local(10, 20, 10, 45),
      ],
      ['Expense report', local(10, 20, 10, 45), local(10, 20, 10, 55)],
    ]);
    const late = entries.find((e) => e.id === 'sp-e-late-2026-10-18');
    expect([late?.start, late?.end]).toEqual([local(10, 18, 22), local(10, 19, 0)]);
    for (const entry of entries) {
      expect(entry).toMatchObject({ source: 'manual', note: '', deletedAt: null });
    }
  });

  it('keeps Super Productivity’s time per task and day', async () => {
    const backup = spBackup();
    const { db } = await freshDB();
    await importBatch(db, batchOf(backup), { now: NOW });
    /** @type {Map<string, number>} */
    const imported = new Map();
    for (const entry of await allEntries(db)) {
      for (const part of splitByDay(entry, { now: NOW })) {
        const key = `${entry.taskId} ${part.day}`;
        imported.set(key, (imported.get(key) ?? 0) + part.ms);
      }
    }
    const entities = /** @type {Record<string, any>} */ (backup.data.task.entities);
    expect(imported.get('sp-t-checkout 2026-10-20')).toBe(
      entities.checkout.timeSpentOnDay['2026-10-20'],
    );
    expect(imported.get('sp-t-resize 2026-10-19')).toBe(
      entities.resize.timeSpentOnDay['2026-10-19'],
    );
    // The parent's own time only, not its subtasks' again.
    expect(imported.get('sp-t-images 2026-10-19')).toBe(10 * MIN);
    expect(imported.has('sp-t-images 2026-10-20')).toBe(false);
    expect(imported.get('sp-t-late 2026-10-18')).toBe(entities.late.timeSpentOnDay['2026-10-18']);
  });

  it('keeps the aggregates in step', async () => {
    const { db } = await freshDB();
    await seed(db);
    // A stored cache, so touchTasks updates it instead of leaving it to the next reader.
    await getAggregates(db);
    await importBatch(db, batchOf(spBackup()), { now: NOW });
    const entries = await allEntries(db);
    expect((await getAggregates(db)).tasks).toEqual(computeAggregates(entries).tasks);
  });

  it('adds nothing when the same backup is imported again', async () => {
    const { db, notify } = await freshDB();
    await importBatch(db, batchOf(spBackup()), { now: NOW });
    notify.mockClear();
    const again = await importBatch(db, batchOf(spBackup()), { now: NOW + MIN });
    expect(again).toMatchObject({
      projects: [],
      tasks: [],
      entries: [],
      reused: { projects: SP_COUNTS.folders + SP_COUNTS.projects, tasks: SP_COUNTS.tasks },
      skipped: SP_COUNTS.entries,
    });
    expect(notify).not.toHaveBeenCalled();
    expect(await allEntries(db)).toHaveLength(SP_COUNTS.entries);
  });

  it('adds only the new days of a newer backup, after the day’s entries', async () => {
    const { db } = await freshDB();
    await importBatch(db, batchOf(spBackup()), { now: NOW });
    const newer = spBackup();
    const entities = /** @type {Record<string, any>} */ (newer.data.task.entities);
    entities.fitting.timeSpentOnDay['2026-10-20'] = 30 * MIN;
    entities.checkout.timeSpentOnDay['2026-10-20'] = 3 * 60 * MIN; // grew: kept as first imported
    const plan = await importBatch(db, batchOf(newer), { now: NOW });
    // The day that grew keeps its first import; the preview counts it.
    expect(plan.changed).toBe(1);
    expect(plan.entries).toEqual([
      expect.objectContaining({
        id: 'sp-e-fitting-2026-10-20',
        taskId: 'sp-t-fitting',
        start: local(10, 20, 10, 55),
        end: local(10, 20, 11, 25),
      }),
    ]);
  });

  it('imports again after an imported entry was deleted (the id stays taken until restart)', async () => {
    const { db } = await freshDB();
    await importBatch(db, batchOf(spBackup()), { now: NOW });
    await softDeleteEntry(db, 'sp-e-checkout-2026-10-20', { now: NOW });
    const plan = await importBatch(db, batchOf(spBackup()), { now: NOW });
    expect(plan.entries).toEqual([]);
    expect(plan.skipped).toBe(SP_COUNTS.entries);
  });

  it('reuses projects and tasks the user already has, by name, and changes nothing in them', async () => {
    const { db } = await freshDB();
    const { client, harbor } = await seed(db);
    const before = await listProjects(db);
    const plan = await importBatch(db, batchOf(spBackup()), { now: NOW });
    // "Client work" and its "Harbor Coffee — website" exist (seed): the backup's land in them.
    expect(plan.reused.projects).toBe(2);
    const projects = await listProjects(db);
    expect(projects.find((p) => p.id === 'sp-p-atlas')?.parentId).toBe(client.id);
    expect(projects.some((p) => p.id === 'sp-p-harbor')).toBe(false);
    const tasks = await listTasks(db);
    expect(tasks.find((t) => t.id === 'sp-t-checkout')?.projectId).toBe(harbor.id);
    expect(projects.filter((p) => before.some((b) => b.id === p.id))).toEqual(before);
  });

  it('leaves a running timer running', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry: running } = await startEntry(db, checkout.id, { now: NOW });
    await importBatch(db, batchOf(spBackup()), { now: NOW + MIN });
    expect(await runningPointer(db)).toBe(running.id);
  });

  it('writes nothing when a record fails the checks', async () => {
    const { db, notify } = await freshDB();
    const batch = batchOf(spBackup());
    batch.projects[3].color = 'red';
    await expect(importBatch(db, batch, { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    expect(await listProjects(db)).toEqual([]);
    expect(await listTasks(db)).toEqual([]);
    expect(await allEntries(db)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('checks every field of tasks and entries', async () => {
    const cases = [
      (/** @type {any} */ b) => (b.tasks[0].tags = ['']),
      (/** @type {any} */ b) => (b.tasks[0].estimateMin = 0),
      (/** @type {any} */ b) => (b.tasks[0].billable = 'yes'),
      (/** @type {any} */ b) => (b.tasks[0].notes = 5),
      (/** @type {any} */ b) => Object.assign(b.tasks[0], { status: 'done', doneAt: -1 }),
      (/** @type {any} */ b) => (b.entries[0].note = null),
      (/** @type {any} */ b) => (b.projects[0].archived = 'no'),
    ];
    for (const breakIt of cases) {
      const { db } = await freshDB();
      const batch = batchOf(spBackup());
      breakIt(batch);
      await expect(importBatch(db, batch, { now: NOW })).rejects.toThrow();
      expect(await allEntries(db)).toEqual([]);
    }
  });
});

describe('previewBatch', () => {
  it('tells what importBatch adds without writing anything', async () => {
    const { db, notify } = await freshDB();
    await seed(db);
    const batch = batchOf(spBackup());
    const preview = await previewBatch(db, batch, { now: NOW });
    expect(await allEntries(db)).toEqual([]);
    expect(notify).not.toHaveBeenCalledWith({ type: 'reset', ids: ['*'] });
    const plan = await importBatch(db, batch, { now: NOW });
    expect(preview.projects.map((p) => p.name)).toEqual(plan.projects.map((p) => p.name));
    expect(preview.tasks.map((t) => t.id)).toEqual(plan.tasks.map((t) => t.id));
    expect(preview.entries).toEqual(plan.entries);
    expect(preview.reused).toEqual(plan.reused);
  });
});
