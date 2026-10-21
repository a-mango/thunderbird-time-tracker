// Strict validation of an untrusted JSON backup (schema v1). Rejects anything outside the
// schema with an ImportError whose `code` says why and `details.path` says where. The result
// is built field by field into fresh objects, so nothing from the input's prototype chain or
// unknown keys survives.
import { ImportError, ValidationError } from './errors.js';
import { COLOR, LIMITS } from './limits.js';
import { DEFAULT_SETTINGS, validateSettings } from './settings.js';

/** @typedef {import('./types.js').Backup} Backup */
/** @typedef {import('./types.js').Project} Project */
/** @typedef {import('./types.js').Task} Task */
/** @typedef {import('./types.js').Entry} Entry */
/** @typedef {(value: unknown, path: string) => unknown} Check */

/** Largest backup accepted, in UTF-8 bytes. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export const BACKUP_FORMAT = 'thunderbird-time-tracker';
export const BACKUP_VERSION = 1;

const MAX_ID = LIMITS.id;
const MAX_NAME = LIMITS.name;
const MAX_TEXT = LIMITS.text;
const MAX_TAG = LIMITS.tag;
const MAX_TAGS = LIMITS.tags;
const MAX_ESTIMATE_MIN = LIMITS.estimateMin;
const MAX_TIME = LIMITS.time;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * @param {string} code
 * @param {string} path
 * @param {string} [reason]
 * @returns {never}
 */
function fail(code, path, reason = code) {
  throw new ImportError(code, path ? `${reason} at ${path}` : reason, { path });
}

/** @type {Check} */
const id = (v, path) =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_ID ? v : fail('type', path, 'bad id');

/**
 * @param {number} min
 * @param {number} max
 * @returns {Check}
 */
const string = (min, max) => (v, path) =>
  typeof v === 'string' && v.length >= min && v.length <= max ? v : fail('type', path, 'bad text');

/** @type {Check} */
const boolean = (v, path) => (typeof v === 'boolean' ? v : fail('type', path, 'not a boolean'));

/** @type {Check} */
const finite = (v, path) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail('type', path, 'not a finite number');

/** @type {Check} */
const time = (v, path) =>
  Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0 && /** @type {number} */ (v) <= MAX_TIME
    ? v
    : fail('type', path, 'bad time');

/** @type {Check} */
const color = (v, path) =>
  typeof v === 'string' && COLOR.test(v) ? v : fail('type', path, 'bad colour');

/** @type {Check} */
const estimate = (v, path) => {
  const n = /** @type {number} */ (finite(v, path));
  return n >= 0 && n <= MAX_ESTIMATE_MIN ? n : fail('type', path, 'bad estimate');
};

/**
 * @param {unknown[]} values
 * @returns {Check}
 */
const oneOf =
  (...values) =>
  (v, path) =>
    values.includes(v) ? v : fail('type', path, 'unexpected value');

/**
 * @param {Check} check
 * @returns {Check}
 */
const nullable = (check) => (v, path) => (v === null ? null : check(v, path));

/** @type {Check} */
const tags = (v, path) => {
  if (!Array.isArray(v)) fail('shape', path, 'not an array');
  if (v.length > MAX_TAGS) fail('type', path, 'too many tags');
  return v.map((tag, i) => string(1, MAX_TAG)(tag, `${path}[${i}]`));
};

/** Top-level keys of a backup. */
const TOP_LEVEL = {
  format: true,
  version: true,
  exportedAt: true,
  projects: true,
  tasks: true,
  entries: true,
  settings: true,
};

/** @type {Record<keyof Project, Check>} */
const PROJECT = {
  id,
  parentId: nullable(id),
  name: string(1, MAX_NAME),
  color,
  order: finite,
  archived: boolean,
  createdAt: time,
  updatedAt: time,
};

/** @type {Record<keyof Task, Check>} */
const TASK = {
  id,
  projectId: id,
  name: string(1, MAX_NAME),
  status: oneOf('open', 'done'),
  starred: boolean,
  estimateMin: nullable(estimate),
  billable: boolean,
  tags,
  notes: string(0, MAX_TEXT),
  order: finite,
  createdAt: time,
  updatedAt: time,
  doneAt: nullable(time),
};

/** @type {Record<keyof Entry, Check>} */
const ENTRY = {
  id,
  taskId: id,
  start: time,
  end: nullable(time),
  note: string(0, MAX_TEXT),
  source: oneOf('timer', 'manual', 'split', 'idle'),
  createdAt: time,
  updatedAt: time,
  deletedAt: nullable(time),
};

/**
 * Asserts a plain JSON object and returns it as a record; rejects forbidden keys first.
 * @param {unknown} value
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function object(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('shape', path, 'not an object');
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) fail('forbidden-key', join(path, key));
  }
  return record;
}

/**
 * @param {string} path
 * @param {string} key
 */
const join = (path, key) => (path ? `${path}.${key}` : key);

/**
 * @param {Record<string, unknown>} record
 * @param {object} known
 * @param {string} path
 */
function rejectUnknown(record, known, path) {
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(known, key)) fail('unknown-field', join(path, key));
  }
}

/**
 * Validates one record against `schema` and copies its fields into a fresh object.
 * @template T
 * @param {unknown} value
 * @param {Record<string, Check>} schema
 * @param {string} path
 * @returns {T}
 */
function record(value, schema, path) {
  const input = object(value, path);
  rejectUnknown(input, schema, path);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, check] of Object.entries(schema)) {
    const fieldPath = join(path, key);
    if (!Object.hasOwn(input, key)) fail('type', fieldPath, 'missing field');
    out[key] = check(input[key], fieldPath);
  }
  return /** @type {T} */ (out);
}

/**
 * @template T
 * @param {unknown} value
 * @param {Record<string, Check>} schema
 * @param {string} name
 * @returns {T[]}
 */
function collection(value, schema, name) {
  if (!Array.isArray(value)) fail('shape', name, 'not an array');
  return value.map((item, i) => record(item, schema, `${name}[${i}]`));
}

/**
 * @param {unknown} value
 * @returns {Partial<import('./types.js').Settings>}
 */
function settings(value) {
  const input = object(value, 'settings');
  rejectUnknown(input, DEFAULT_SETTINGS, 'settings');
  try {
    return validateSettings(input);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return fail('type', join('settings', String(error.details.key ?? '')), 'bad setting');
  }
}

/**
 * Size check in UTF-8 bytes without encoding when the length alone decides.
 * @param {string} text
 * @param {number} maxBytes
 */
function checkSize(text, maxBytes) {
  // Every UTF-16 code unit takes 1 to 3 UTF-8 bytes.
  if (text.length > maxBytes) fail('too-large', '', 'backup too large');
  if (text.length * 3 <= maxBytes) return;
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    fail('too-large', '', 'backup too large');
  }
}

/**
 * Ids are unique per collection.
 * @param {{id: string}[]} items
 * @param {string} name
 */
function checkUnique(items, name) {
  const seen = new Set();
  items.forEach((item, i) => {
    if (seen.has(item.id)) fail('duplicate-id', `${name}[${i}].id`);
    seen.add(item.id);
  });
  return seen;
}

/**
 * No project is its own ancestor. Each project is walked once (white/grey/black marking).
 * @param {Project[]} projects
 */
function checkNoCycle(projects) {
  const parentOf = new Map(projects.map((p) => [p.id, p.parentId]));
  /** @type {Map<string, 'walking' | 'done'>} */
  const state = new Map();
  projects.forEach((project, i) => {
    /** @type {string[]} */
    const walked = [];
    for (let cur = /** @type {string | null} */ (project.id); cur !== null;) {
      const mark = state.get(cur);
      if (mark === 'done') break;
      if (mark === 'walking') fail('cycle', `projects[${i}].parentId`, 'parent cycle');
      state.set(cur, 'walking');
      walked.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    for (const walkedId of walked) state.set(walkedId, 'done');
  });
}

/**
 * Parses and validates a backup file's text.
 * @param {string} text
 * @param {{maxBytes?: number}} [options]
 * @returns {Backup}
 * @throws {ImportError} code `too-large`, `json`, `shape`, `format`, `version`, `type`,
 *   `unknown-field`, `forbidden-key`, `duplicate-id`, `dangling-ref`, `cycle`,
 *   `multiple-running` or `time-order`
 */
export function parseBackup(text, { maxBytes = MAX_IMPORT_BYTES } = {}) {
  if (typeof text !== 'string') fail('shape', '', 'not text');
  checkSize(text, maxBytes);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('json', '', 'malformed JSON');
  }
  const root = object(parsed, '');
  if (root.format !== BACKUP_FORMAT) fail('format', 'format', 'not a time tracker backup');
  if (root.version !== BACKUP_VERSION) fail('version', 'version', 'unsupported version');
  rejectUnknown(root, TOP_LEVEL, '');
  const exportedAt = /** @type {number} */ (time(root.exportedAt, 'exportedAt'));

  /** @type {Project[]} */
  const projects = collection(root.projects, PROJECT, 'projects');
  /** @type {Task[]} */
  const tasks = collection(root.tasks, TASK, 'tasks');
  /** @type {Entry[]} */
  const entries = collection(root.entries, ENTRY, 'entries');
  const settingsPatch = Object.hasOwn(root, 'settings') ? settings(root.settings) : undefined;

  const projectIds = checkUnique(projects, 'projects');
  const taskIds = checkUnique(tasks, 'tasks');
  checkUnique(entries, 'entries');
  projects.forEach((p, i) => {
    if (p.parentId !== null && !projectIds.has(p.parentId)) {
      fail('dangling-ref', `projects[${i}].parentId`);
    }
  });
  tasks.forEach((t, i) => {
    if (!projectIds.has(t.projectId)) fail('dangling-ref', `tasks[${i}].projectId`);
  });
  entries.forEach((e, i) => {
    if (!taskIds.has(e.taskId)) fail('dangling-ref', `entries[${i}].taskId`);
  });
  checkNoCycle(projects);
  let running = 0;
  entries.forEach((e, i) => {
    if (e.end !== null && e.start >= e.end) fail('time-order', `entries[${i}].end`);
    if (e.end === null && e.deletedAt === null && ++running > 1) {
      fail('multiple-running', `entries[${i}].end`);
    }
  });

  /** @type {Backup} */
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    projects,
    tasks,
    entries,
  };
  if (settingsPatch) backup.settings = settingsPatch;
  return backup;
}
