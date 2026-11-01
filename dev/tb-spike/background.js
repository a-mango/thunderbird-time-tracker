// Spike stage only (scripts/tb-spike.mjs): the real background (its menus included) plus one item
// limited to our own pages, to test menus.overrideContext() in the gallery tab. Never shipped.
import '../../background/main.js';

// After main.js has recreated its items (registerMenus starts with removeAll).
await new Promise((resolve) => setTimeout(resolve, 1000));
messenger.menus.create({
  id: 'tt-spike-item',
  title: 'Time Tracker spike item',
  contexts: ['all'],
  documentUrlPatterns: [`${location.origin}/dev/*`],
});
