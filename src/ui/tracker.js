import { localize } from './i18n.js';

/** @typedef {import('../background/messages.js').Summary} Summary */

/** @param {Summary} summary */
function renderSummary(summary) {
  const counts = /** @type {HTMLElement} */ (document.querySelector('[data-summary-counts]'));
  const list = /** @type {HTMLElement} */ (document.querySelector('[data-project-list]'));
  if (summary.projects.length === 0) {
    counts.textContent = messenger.i18n.getMessage('trackerEmpty');
    list.replaceChildren();
    return;
  }
  counts.textContent = messenger.i18n.getMessage('trackerSummary', [
    String(summary.projects.length),
    String(summary.taskCount),
    String(summary.entryCount),
  ]);
  list.replaceChildren(
    ...summary.projects.map((project) => {
      const item = document.createElement('li');
      item.textContent = project.name;
      item.style.setProperty('--depth', String(project.depth));
      return item;
    }),
  );
}

localize();
/** @type {Summary} */
const summary = await messenger.runtime.sendMessage({ type: 'tt:summary' });
renderSummary(summary);
