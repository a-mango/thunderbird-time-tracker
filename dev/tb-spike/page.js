// Spike stage only: loaded after gallery.js in the staged gallery.html. Measures what the
// Thunderbird spike compares and publishes it in document.title (readable from chrome).
// Right-clicking the project tree calls menus.overrideContext(); elsewhere the default menu opens.

/** @type {Record<string, unknown>} */
const result = { overrides: [] };

/** Resolves a colour expression to rgb() through a probe element. @param {string} value */
function resolveColor(value) {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** @param {string} selector */
function box(selector) {
  const node = document.querySelector(selector);
  if (!node) return null;
  const { x, y, width, height } = node.getBoundingClientRect();
  return { x, y, width, height };
}

function publish() {
  document.title = `TT-SPIKE ${JSON.stringify(result)}`;
}

while (!document.documentElement.hasAttribute('data-ready')) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const root = getComputedStyle(document.documentElement);
Object.assign(result, {
  url: location.href,
  fontFamily: root.fontFamily,
  fontSize: root.fontSize,
  fontWeight: root.fontWeight,
  accentColor: resolveColor('AccentColor'),
  accentColorText: resolveColor('AccentColorText'),
  selectedItemColor: resolveColor('var(--selected-item-color)'),
  dark: matchMedia('(prefers-color-scheme: dark)').matches,
  // Does Thunderbird's chrome-only -moz-pref() media query parse and match in an extension page?
  mozPref: Object.fromEntries(
    [
      '-moz-pref("mail.appearance.accentColor", "accent-color")',
      '-moz-pref("mail.appearance.accentColor", "purple")',
      '-moz-pref("mail.uidensity", 1)',
      '-moz-pref("mail.uidensity", "1")',
      '-moz-pref("mail.uidensity", 0)',
    ].map((query) => {
      const list = matchMedia(query);
      return [query, { media: list.media, matches: list.matches }];
    }),
  ),
  devicePixelRatio,
  treeRow: box('#projects-tree [role="treeitem"]'),
  tableHeader: box('#tasks-table thead th'),
  tableRow: box('#tasks-table tbody tr'),
  modeName: getComputedStyle(/** @type {Element} */ (document.querySelector('.mode-name')))
    .fontSize,
  tableArea: box('#tasks-table tbody'),
});

document.addEventListener('contextmenu', (event) => {
  const target = /** @type {Element} */ (event.target);
  if (!target.closest('#projects-tree')) return;
  try {
    messenger.menus.overrideContext({ showDefaults: false });
    /** @type {unknown[]} */ (result.overrides).push('ok');
  } catch (error) {
    /** @type {unknown[]} */ (result.overrides).push(String(error));
  }
  publish();
});

publish();

export {};
