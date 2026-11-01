import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { generateFixtures } from '../../dev/fixtures.js';
import { databaseExists, deleteDatabase, seedDatabase, seedSettings } from '../../dev/seed.js';
import { getRunning, getSettings, listEntries, listProjects, openDB } from '../../src/db/index.js';
import './db-helpers.js';

const now = Date.UTC(2026, 9, 20, 12, 45);

describe('dev seeding', () => {
  it('replaces the database with validated fixtures and points at the running entry', async () => {
    const factory = new IDBFactory();
    expect(await databaseExists(factory)).toBe(false);
    const fixtures = generateFixtures({ now });
    await seedDatabase(fixtures, { factory, now });
    await seedDatabase(fixtures, { factory, now });
    expect(await databaseExists(factory)).toBe(true);
    const db = await openDB({ factory, notify: () => {} });
    expect(await listProjects(db)).toHaveLength(fixtures.projects.length);
    expect(await listEntries(db)).toHaveLength(fixtures.entries.length);
    expect((await getRunning(db))?.id).toBe(fixtures.entries.find((e) => e.end === null)?.id);
    db.close();
  });

  it('stores settings and deletes the database', async () => {
    const factory = new IDBFactory();
    await seedSettings({ density: 'compact' }, { factory });
    const db = await openDB({ factory, notify: () => {} });
    expect((await getSettings(db)).density).toBe('compact');
    db.close();
    await deleteDatabase(factory);
    expect(await databaseExists(factory)).toBe(false);
  });

  it('rejects fixtures the importer refuses', async () => {
    const fixtures = generateFixtures({ now });
    fixtures.projects[0].name = ' ';
    await expect(seedDatabase(fixtures, { factory: new IDBFactory(), now })).rejects.toThrow();
  });
});
