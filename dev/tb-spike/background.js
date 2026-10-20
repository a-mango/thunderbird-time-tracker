// Spike stage only (scripts/tb-spike.mjs): the real background plus one menu item limited to
// our own pages, to test menus.overrideContext() in a tab. Never shipped.
import '../../background/main.js';

await messenger.menus.removeAll();
messenger.menus.create({
  id: 'tt-spike-item',
  title: 'Time Tracker spike item',
  contexts: ['all'],
  documentUrlPatterns: [`${location.origin}/*`],
});
