// Seeded generator of fictional projects, tasks and time entries for the dev harness.
// Every name comes from design/reference/*.html. Never add real names here.
// Shapes follow the schema v1 typedefs in docs/SPEC.md (Data model).

/**
 * @typedef {{id:string, parentId:string|null, name:string, color:string, order:number,
 *            archived:boolean, createdAt:number, updatedAt:number}} Project
 * @typedef {{id:string, projectId:string, name:string, status:'open'|'done', starred:boolean,
 *            estimateMin:number|null, billable:boolean, tags:string[], notes:string,
 *            order:number, createdAt:number, updatedAt:number, doneAt:number|null}} Task
 * @typedef {{id:string, taskId:string, start:number, end:number|null, note:string,
 *            source:'timer'|'manual'|'split'|'idle', createdAt:number, updatedAt:number}} Entry
 * @typedef {{projects: Project[], tasks: Task[], entries: Entry[]}} Fixtures
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Project tree: [key, parentKey, name, colour]. */
/** @type {[string, string | null, string, string][]} */
const PROJECTS = [
  ['client', null, 'Client work', '#2493ef'],
  ['harbor', 'client', 'Harbor Coffee — website', '#ae55f7'],
  ['discovery', 'harbor', 'Discovery', '#ae55f7'],
  ['build', 'harbor', 'Build', '#ae55f7'],
  ['content', 'harbor', 'Content', '#ae55f7'],
  ['fern', 'client', 'Fern & Co — branding', '#ea7308'],
  ['support', 'client', 'Support retainer', '#25a6a0'],
  ['internal', null, 'Internal', '#2493ef'],
  ['bookkeeping', 'internal', 'Bookkeeping', '#e247c4'],
  ['training', 'internal', 'Training', '#2493ef'],
];

/** Tasks: [projectKey, name, status, starred, estimateMin, tags, entryCount]. */
/** @type {[string, string, 'open'|'done', boolean, number|null, string[], number][]} */
const TASKS = [
  ['build', 'Checkout form validation', 'open', true, 600, ['Frontend', 'Implementation'], 9],
  ['build', 'Product image pipeline', 'open', false, 480, ['Implementation'], 6],
  ['build', 'Fix mobile nav overflow', 'open', true, 120, ['Frontend'], 3],
  ['build', 'Performance pass', 'open', false, 240, ['Frontend'], 4],
  ['build', 'Staging deploy script', 'open', false, null, ['Implementation'], 3],
  ['build', 'Client call notes', 'open', false, null, [], 2],
  ['build', 'Accessibility fixes', 'open', false, 180, ['Frontend'], 0],
  ['build', 'Form state refactor', 'done', false, 240, ['Frontend'], 5],
  ['build', 'Field components skeleton', 'done', false, 180, ['Frontend'], 4],
  ['build', 'Server-side validation rules', 'done', false, 120, ['Implementation'], 3],
  ['discovery', 'Competitor site audit', 'open', false, 240, [], 4],
  ['discovery', 'Payment provider API docs', 'done', false, 60, [], 2],
  ['content', 'Payment provider test account', 'open', false, 30, [], 1],
  ['fern', 'Brand review call', 'open', false, 60, [], 2],
  ['support', 'Weekly client sync', 'open', false, null, [], 5],
];

const NOTES = ['', '', '', 'Inline errors for card fields', 'Re: Checkout flow — client feedback'];

/**
 * Deterministic PRNG (mulberry32).
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{seed?: number, now?: number, running?: boolean}} [options]
 *   `running` adds one open entry (end === null) on the first task, like the reference.
 * @returns {Fixtures}
 */
export function generateFixtures({ seed = 42, now = Date.now(), running = true } = {}) {
  const random = createRandom(seed);
  const pick = (/** @type {number} */ min, /** @type {number} */ max) =>
    min + Math.floor(random() * (max - min + 1));
  const created = now - 30 * DAY;

  /** @type {Map<string, string>} */
  const projectIds = new Map();
  /** @type {Project[]} */
  const projects = PROJECTS.map(([key, parentKey, name, color], index) => {
    const id = `p${index + 1}`;
    projectIds.set(key, id);
    const parentId = parentKey === null ? null : (projectIds.get(parentKey) ?? null);
    const order = PROJECTS.slice(0, index).filter(([, p]) => p === parentKey).length;
    return {
      id,
      parentId,
      name,
      color,
      order,
      archived: false,
      createdAt: created,
      updatedAt: created,
    };
  });

  /** @type {Task[]} */
  const tasks = [];
  /** @type {Entry[]} */
  const entries = [];
  // Day starts at local midnight; entries land between 08:00 and 18:00 local time.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  TASKS.forEach(([projectKey, name, status, starred, estimateMin, tags, entryCount], index) => {
    const id = `t${index + 1}`;
    const projectId = /** @type {string} */ (projectIds.get(projectKey));
    const order = TASKS.slice(0, index).filter(([p]) => p === projectKey).length;
    const doneAt = status === 'done' ? now - pick(3, 10) * DAY : null;
    tasks.push({
      id,
      projectId,
      name,
      status,
      starred,
      estimateMin,
      billable: projectKey !== 'bookkeeping' && projectKey !== 'training',
      tags: [...tags],
      notes: '',
      order,
      createdAt: created,
      updatedAt: doneAt ?? created,
      doneAt,
    });
    for (let n = 0; n < entryCount; n += 1) {
      const dayStart = today.getTime() - pick(1, 13) * DAY;
      const start = dayStart + pick(8 * 60, 15 * 60) * MINUTE;
      const end = start + pick(15, 150) * MINUTE;
      entries.push({
        id: `e${entries.length + 1}`,
        taskId: id,
        start,
        end,
        note: NOTES[pick(0, NOTES.length - 1)],
        source: random() < 0.8 ? 'timer' : 'manual',
        createdAt: end,
        updatedAt: end,
      });
    }
  });

  if (running) {
    const start = now - 85 * MINUTE;
    entries.push({
      id: `e${entries.length + 1}`,
      taskId: tasks[0].id,
      start,
      end: null,
      note: 'Inline errors for card fields',
      source: 'timer',
      createdAt: start,
      updatedAt: start,
    });
  }

  entries.sort((a, b) => a.start - b.start);
  return { projects, tasks, entries };
}

/**
 * The `tt:summary` answer the background will give once M2 exists.
 * @param {Fixtures} fixtures
 * @returns {import('../src/background/messages.js').Summary}
 */
export function summarize({ projects, tasks, entries }) {
  /** @type {Map<string | null, Project[]>} */
  const children = new Map();
  for (const project of projects) {
    const siblings = children.get(project.parentId) ?? [];
    siblings.push(project);
    children.set(project.parentId, siblings);
  }
  /** @type {import('../src/background/messages.js').Summary['projects']} */
  const flat = [];
  /** @param {string | null} parentId @param {number} depth */
  const walk = (parentId, depth) => {
    for (const project of (children.get(parentId) ?? []).sort((a, b) => a.order - b.order)) {
      flat.push({ id: project.id, name: project.name, depth });
      walk(project.id, depth + 1);
    }
  };
  walk(null, 0);
  return { projects: flat, taskCount: tasks.length, entryCount: entries.length };
}
