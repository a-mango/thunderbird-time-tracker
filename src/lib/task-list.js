// The task list's data (docs/DESIGN.md, List pane): which tasks a project or view shows, the
// quick filter, and sorting. DOM-free; ui/task-list.js renders the result.

/**
 * @typedef {import('./types.js').Task} Task
 * @typedef {import('./rollup.js').Totals} Totals
 * @typedef {{type: 'project', id: string} | {type: 'view', id: 'today' | 'week' | 'starred'}}
 *   TaskScope
 * @typedef {object} TaskFilter Quick filter state; every active part must match (AND).
 * @property {boolean} open hide done tasks (the "Open" pill, on by default)
 * @property {boolean} starred
 * @property {boolean} billable
 * @property {string[] | null} tags null: the Tags pill is off; `[]`: tasks with any tag;
 *   otherwise tasks with at least one of these tags
 * @property {string} text matches name, tags and notes (case-insensitive)
 */

/** @param {boolean} showDone the "show done tasks" setting */
export function defaultFilter(showDone = false) {
  /** @type {TaskFilter} */
  const filter = { open: !showDone, starred: false, billable: false, tags: null, text: '' };
  return filter;
}

/**
 * Restores a stored filter (layout-store values are untrusted), falling back to `fallback`.
 * @param {unknown} value
 * @param {TaskFilter} fallback
 * @returns {TaskFilter}
 */
export function readFilter(value, fallback) {
  if (typeof value !== 'object' || value === null) return fallback;
  const v = /** @type {Record<string, unknown>} */ (value);
  const bool = (/** @type {string} */ key, /** @type {boolean} */ def) =>
    typeof v[key] === 'boolean' ? /** @type {boolean} */ (v[key]) : def;
  return {
    open: bool('open', fallback.open),
    starred: bool('starred', fallback.starred),
    billable: bool('billable', fallback.billable),
    tags: Array.isArray(v.tags)
      ? v.tags.filter((tag) => typeof tag === 'string').slice(0, 50)
      : fallback.tags,
    text: typeof v.text === 'string' ? v.text.slice(0, 500) : fallback.text,
  };
}

/**
 * Tasks a project (its own, not its subprojects', like a mail folder) or a view shows, before
 * filtering. Today and This Week list tasks with time in that range (the running one included);
 * Starred lists starred tasks.
 * @param {Iterable<Task>} tasks
 * @param {TaskScope} scope
 * @param {(id: string) => Totals} totalsOf
 * @param {string | null} runningTaskId
 */
export function scopeTasks(tasks, scope, totalsOf, runningTaskId) {
  /** @type {Task[]} */
  const result = [];
  for (const task of tasks) {
    let shown;
    if (scope.type === 'project') shown = task.projectId === scope.id;
    else if (scope.id === 'starred') shown = task.starred;
    else {
      const totals = totalsOf(task.id);
      shown = task.id === runningTaskId || (scope.id === 'today' ? totals.today : totals.week) > 0;
    }
    if (shown) result.push(task);
  }
  return result;
}

/**
 * Applies the quick filter. `doneHidden` counts the done tasks that only the Open pill hides
 * (the footer's "N done tasks hidden").
 * @param {Task[]} tasks
 * @param {TaskFilter} filter
 * @returns {{tasks: Task[], doneHidden: number}}
 */
export function filterTasks(tasks, filter) {
  const text = filter.text.trim().toLocaleLowerCase();
  const wanted = filter.tags?.map((tag) => tag.toLocaleLowerCase());
  /** @type {Task[]} */
  const shown = [];
  let doneHidden = 0;
  for (const task of tasks) {
    if (filter.starred && !task.starred) continue;
    if (filter.billable && !task.billable) continue;
    if (wanted) {
      const tags = task.tags.map((tag) => tag.toLocaleLowerCase());
      if (wanted.length === 0 ? tags.length === 0 : !tags.some((tag) => wanted.includes(tag)))
        continue;
    }
    if (text && !matchesText(task, text)) continue;
    if (filter.open && task.status === 'done') {
      doneHidden += 1;
      continue;
    }
    shown.push(task);
  }
  return { tasks: shown, doneHidden };
}

/** @param {Task} task @param {string} text lower-cased */
function matchesText(task, text) {
  return (
    task.name.toLocaleLowerCase().includes(text) ||
    task.notes.toLocaleLowerCase().includes(text) ||
    task.tags.some((tag) => tag.toLocaleLowerCase().includes(text))
  );
}

/** Whether anything beyond the Open pill narrows the list. @param {TaskFilter} filter */
export function isFiltering(filter) {
  return filter.starred || filter.billable || filter.tags !== null || filter.text.trim() !== '';
}

/**
 * Distinct tags (case-insensitive, first spelling wins), sorted for `locale`.
 * @param {Iterable<Task>} tasks
 * @param {string} [locale]
 */
export function tagsOf(tasks, locale) {
  /** @type {Map<string, string>} */
  const tags = new Map();
  for (const task of tasks) {
    for (const tag of task.tags) {
      const key = tag.toLocaleLowerCase();
      if (!tags.has(key)) tags.set(key, tag);
    }
  }
  return [...tags.values()].sort((a, b) => a.localeCompare(b, locale));
}
