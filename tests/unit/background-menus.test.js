import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { COLOR_ITEM_PREFIX, MENU, registerMenus } from '../../src/background/menus.js';
import { PALETTE } from '../../src/lib/palette.js';
import { createMessenger } from '../../dev/mock-messenger.js';

const messages = JSON.parse(
  await readFile(new URL('../../src/_locales/en/messages.json', import.meta.url), 'utf8'),
);
/** @returns {any} */
const mock = () => createMessenger({ messages, baseUrl: 'moz-extension://test/' });

describe('registerMenus', () => {
  it('creates hidden project items limited to the tracker tab, with localized titles', async () => {
    const api = mock();
    await registerMenus(api);
    const items = api.menus._items();
    const top = items.filter((/** @type {any} */ i) => !i.parentId);
    expect(top.map((/** @type {any} */ i) => i.id)).toEqual(Object.values(MENU));
    for (const item of top) {
      expect(item).toMatchObject({
        contexts: ['all'],
        documentUrlPatterns: ['moz-extension://test/ui/tracker.html*'],
        viewTypes: ['tab'],
        visible: false,
      });
      if (item.type !== 'separator') expect(item.title).toBeTruthy();
    }
  });

  it('adds one radio item per palette colour under Colour', async () => {
    const api = mock();
    await registerMenus(api);
    const colors = api.menus._items().filter((/** @type {any} */ i) => i.parentId === MENU.color);
    expect(colors.map((/** @type {any} */ i) => i.id)).toEqual(
      PALETTE.map((p) => `${COLOR_ITEM_PREFIX}${p.color}`),
    );
    expect(colors.every((/** @type {any} */ i) => i.type === 'radio' && i.title)).toBe(true);
  });

  it('can run again (every background start) without duplicate ids', async () => {
    const api = mock();
    await registerMenus(api);
    await registerMenus(api);
    expect(api.menus._items()).toHaveLength(Object.keys(MENU).length + PALETTE.length);
  });
});
