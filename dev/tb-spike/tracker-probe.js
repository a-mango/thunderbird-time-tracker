// Spike stage only: loaded after tracker.js in the staged ui/tracker.html. Publishes in
// document.title (readable from chrome) the first project row's box, whether menus.onClicked
// reached this page, and the dialog it opened (M3 risk: native context menu in our tab).
// M6: then saves a small file through an <a download> click (backup and CSV export).
import { createProject, openDB } from '../../db/index.js';
import { download } from '../../ui/data-commands.js';

/** @type {Record<string, unknown>} */
const state = { row: null, clicked: null, dialog: null, download: null };
const publish = () => {
  document.title = `TT-PROBE ${JSON.stringify(state)}`;
};

messenger.menus.onClicked.addListener((info) => {
  state.clicked = { menuItemId: info.menuItemId, targetElementId: info.targetElementId ?? null };
  publish();
});

while (!document.documentElement.hasAttribute('data-ready')) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
// M7: the tab's load timings in Thunderbird (navigation start → script start → first render).
const mark = (/** @type {string} */ name) => performance.getEntriesByName(name)[0]?.startTime;
state.timing = {
  scriptStart: mark('tt-start'),
  ready: mark('tt-ready'),
  domContentLoaded: /** @type {PerformanceNavigationTiming | undefined} */ (
    performance.getEntriesByType('navigation')[0]
  )?.domContentLoadedEventEnd,
};
const rowSelector = '#projects-tree [role="treeitem"]';
if (!document.querySelector(rowSelector)) {
  // Empty dev profile: one fictional project to right-click (a fixture name).
  const db = await openDB();
  try {
    await createProject(db, { name: 'Discovery', color: '#ae55f7', parentId: null });
  } finally {
    db.close();
  }
}
setInterval(() => {
  const row = document.querySelector(rowSelector);
  if (row) {
    const { x, y, width, height } = row.getBoundingClientRect();
    state.row = { x, y, width, height };
  }
  // Disabled header buttons rendered invisible in Thunderbird (M3): record why.
  state.header = [...document.querySelectorAll('.sidebar-header button')].map((button) => {
    const style = getComputedStyle(button);
    const { width, height } = button.getBoundingClientRect();
    return {
      ref: /** @type {HTMLElement} */ (button).dataset.ref,
      width,
      height,
      opacity: style.opacity,
      color: style.color,
      background: style.backgroundColor,
      visibility: style.visibility,
      display: style.display,
      appearance: style.appearance,
    };
  });
  const heading = document.querySelector('dialog[open] .dialog-title');
  if (heading && !state.dialog) {
    state.dialog = heading.textContent;
    /** @type {HTMLDialogElement} */ (heading.closest('dialog')).close();
    // M6: does an <a download> blob click save a file in Thunderbird (no downloads API)?
    setTimeout(() => {
      try {
        download('{"probe":true}\n', 'tt-probe.json', 'application/json');
        state.download = 'clicked';
      } catch (error) {
        state.download = `error: ${error}`;
      }
      publish();
    }, 500);
  }
  publish();
}, 100);
