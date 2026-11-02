import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateFixtures } from '../../dev/fixtures.js';
import { parseBackup } from '../../src/lib/importer.js';

const now = Date.UTC(2026, 9, 20, 12, 0);

describe('dev fixtures', () => {
  it('are deterministic for a seed', () => {
    expect(generateFixtures({ seed: 7, now })).toEqual(generateFixtures({ seed: 7, now }));
    expect(generateFixtures({ seed: 7, now })).not.toEqual(generateFixtures({ seed: 8, now }));
  });

  it('form a valid tree with valid references', () => {
    const { projects, tasks, entries } = generateFixtures({ now });
    const projectIds = new Set(projects.map((p) => p.id));
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const p of projects) if (p.parentId !== null) expect(projectIds).toContain(p.parentId);
    for (const t of tasks) expect(projectIds).toContain(t.projectId);
    for (const e of entries) expect(taskIds).toContain(e.taskId);
  });

  it('respect the entry invariants: start < end, at most one running', () => {
    const { entries } = generateFixtures({ now });
    expect(entries.filter((e) => e.end === null)).toHaveLength(1);
    for (const e of entries) if (e.end !== null) expect(e.start).toBeLessThan(e.end);
    expect(generateFixtures({ now, running: false }).entries.every((e) => e.end !== null)).toBe(
      true,
    );
  });

  it('use only names that appear in the design references', async () => {
    const html = (
      await Promise.all(
        ['three-pane-light', 'cards-timeline-light'].map((name) =>
          readFile(new URL(`../../design/reference/${name}.html`, import.meta.url), 'utf8'),
        ),
      )
    )
      .join('\n')
      .replaceAll('&amp;', '&');
    const { projects, tasks, entries } = generateFixtures({ now });
    const names = [...projects, ...tasks].map((x) => x.name);
    const notes = entries.map((e) => e.note).filter(Boolean);
    for (const name of [...names, ...notes]) expect(html, name).toContain(name);
  });

  it('pass the backup importer, with one archived project', () => {
    const fixtures = generateFixtures({ now });
    const backup = { format: 'thunderbird-time-tracker', version: 1, exportedAt: now, ...fixtures };
    expect(parseBackup(JSON.stringify(backup)).projects).toHaveLength(fixtures.projects.length);
    expect(fixtures.projects.filter((p) => p.archived).map((p) => p.name)).toEqual(['Discovery']);
  });

  it('add bulk tasks for the performance fixture, valid for the importer', () => {
    const fixtures = generateFixtures({ now }, { bulkTasks: 50 });
    const support = fixtures.projects.find((p) => p.name === 'Support retainer');
    const bulk = fixtures.tasks.filter((t) => t.id.startsWith('bulk'));
    expect(bulk).toHaveLength(50);
    expect(bulk.every((t) => t.projectId === support?.id)).toBe(true);
    const backup = { format: 'thunderbird-time-tracker', version: 1, exportedAt: now, ...fixtures };
    expect(parseBackup(JSON.stringify(backup)).tasks).toHaveLength(fixtures.tasks.length);
  });
});
