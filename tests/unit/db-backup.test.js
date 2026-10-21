import { describe, expect, it } from 'vitest';
import { addEntry, softDeleteEntry, startEntry } from '../../src/db/entries.js';
import { createProject, listProjects } from '../../src/db/projects.js';
import { createTask, listTasks, markTaskDone } from '../../src/db/tasks.js';
import { LIMITS } from '../../src/db/validate.js';
import { parseBackup } from '../../src/lib/importer.js';
import { ValidationError } from '../../src/lib/errors.js';
import { MIN, T0, allEntries, freshDB, seed } from './db-helpers.js';

const long = (/** @type {number} */ n) => 'x'.repeat(n);

describe('repository limits match the importer', () => {
  it('stores records at the limits that re-import from a backup', async () => {
    const { db } = await freshDB();
    const { build } = await seed(db);
    const sub = await createProject(db, {
      name: long(LIMITS.name),
      parentId: build.id,
      color: '#AE55F7',
      order: 2.5,
    });
    const task = await createTask(db, {
      projectId: sub.id,
      name: long(LIMITS.name),
      estimateMin: LIMITS.estimateMin,
      tags: Array.from({ length: LIMITS.tags }, () => long(LIMITS.tag)),
      notes: long(LIMITS.text),
      order: -1.5,
    });
    await addEntry(db, { taskId: task.id, start: T0 - 60 * MIN, end: T0, note: long(LIMITS.text) });
    const gone = await addEntry(db, { taskId: task.id, start: 0, end: LIMITS.time });
    await softDeleteEntry(db, gone.id, { now: T0 });
    await markTaskDone(db, task.id, { now: T0 });
    const { checkout } = await seed(db);
    await startEntry(db, checkout.id, { now: T0 });

    const backup = {
      format: 'thunderbird-time-tracker',
      version: 1,
      exportedAt: T0,
      projects: await listProjects(db),
      tasks: await listTasks(db),
      entries: await allEntries(db),
    };
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.projects).toHaveLength(backup.projects.length);
    expect(parsed.tasks).toHaveLength(backup.tasks.length);
    expect(parsed.entries).toHaveLength(3);
    for (const entry of parsed.entries) expect(entry).toHaveProperty('deletedAt');
  });

  it('rejects values over the limits', async () => {
    const { db } = await freshDB();
    const { build, checkout } = await seed(db);
    const projects = [
      { name: long(LIMITS.name + 1) },
      { name: 'Build', color: 'red' },
      { name: 'Build', color: '#abc' },
      { name: 'Build', order: Number.POSITIVE_INFINITY },
      { name: 'Build', parentId: long(LIMITS.id + 1) },
    ];
    for (const input of projects) {
      await expect(createProject(db, /** @type {any} */ (input))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    const tasks = [
      { name: long(LIMITS.name + 1) },
      { name: 'Build', notes: long(LIMITS.text + 1) },
      { name: 'Build', tags: [''] },
      { name: 'Build', tags: [long(LIMITS.tag + 1)] },
      { name: 'Build', tags: Array.from({ length: LIMITS.tags + 1 }, () => 'Frontend') },
      { name: 'Build', estimateMin: LIMITS.estimateMin + 1 },
      { name: 'Build', order: Number.NaN },
    ];
    for (const input of tasks) {
      await expect(
        createTask(db, /** @type {any} */ ({ projectId: build.id, ...input })),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    const entries = [
      { start: -1, end: T0 },
      { start: T0, end: LIMITS.time + 1 },
      { start: T0 - MIN, end: T0, note: long(LIMITS.text + 1) },
    ];
    for (const input of entries) {
      await expect(addEntry(db, { taskId: checkout.id, ...input })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });
});
