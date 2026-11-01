import { describe, expect, it } from 'vitest';
import { createMessenger, formatMessage } from '../../dev/mock-messenger.js';

describe('mock messenger', () => {
  it('formats messages with named placeholders and positional substitutions', () => {
    const messages = {
      summary: {
        message: '$A$ of $B$ ($$)',
        placeholders: { a: { content: '$1' }, b: { content: '$2' } },
      },
    };
    expect(formatMessage(messages, 'summary', ['1', '2'])).toBe('1 of 2 ($)');
    expect(formatMessage(messages, 'missing')).toBe('');
  });

  it('rejects sendMessage when nobody listens, like the real API', async () => {
    await expect(createMessenger().runtime.sendMessage({})).rejects.toThrow(/Receiving end/);
  });

  it('rejects duplicate and invalid space names, and updates of unknown spaces', async () => {
    const api = createMessenger();
    await api.spaces.create('one', 'about:blank');
    await expect(api.spaces.create('one', 'about:blank')).rejects.toThrow();
    await expect(api.spaces.create('bad name', 'about:blank')).rejects.toThrow();
    await expect(api.spaces.update(999, { url: 'x' })).rejects.toThrow();
    await expect(api.spaces.update(1, { url: 'x' })).rejects.toThrow(); // built-in "mail"
  });

  it('fires storage.onChanged with old and new values', async () => {
    const api = createMessenger();
    /** @type {any[]} */
    const seen = [];
    api.storage.onChanged.addListener((changes, area) => seen.push([changes, area]));
    await api.storage.local.set({ a: 1 });
    await api.storage.local.set({ a: 2 });
    expect(seen.at(-1)).toEqual([{ a: { oldValue: 1, newValue: 2 } }, 'local']);
    expect(await api.storage.local.get({ a: 0, b: 5 })).toEqual({ a: 2, b: 5 });
  });

  it('rejects duplicate menu ids and unknown parents like the real API', () => {
    const api = createMessenger();
    api.menus.create({ id: 'a', title: 'A' });
    expect(() => api.menus.create({ id: 'a', title: 'A' })).toThrow(/already exists/);
    expect(() => api.menus.create({ id: 'b', parentId: 'missing' })).toThrow(/Could not find/);
  });

  it('remembers contextmenu targets for getTargetElement while they are connected', () => {
    const api = createMessenger();
    const target = /** @type {any} */ ({ isConnected: true });
    const id = api.menus._contextMenu(target);
    expect(api.menus.getTargetElement(id)).toBe(target);
    expect(api.menus.getTargetElement(id + 1)).toBeNull();
    api.menus.overrideContext({ showDefaults: false });
    expect(api.menus._state()).toEqual({ overridden: { showDefaults: false }, lastTarget: id });
    target.isConnected = false;
    expect(api.menus.getTargetElement(id)).toBeNull();
  });
});
