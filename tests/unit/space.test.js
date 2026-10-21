import { describe, expect, it } from 'vitest';
import { SPACE_NAME, TRACKER_PATH, ensureSpace } from '../../src/background/space.js';
import { createMessenger } from '../../dev/mock-messenger.js';

const messages = { spaceTitle: { message: 'Time Tracker' } };
/** @returns {any} */
const mock = () => createMessenger({ messages, baseUrl: 'moz-extension://test/' });

describe('ensureSpace', () => {
  it('creates the space when it is missing', async () => {
    const api = mock();
    const space = await ensureSpace(api);
    expect(space).toMatchObject({ name: SPACE_NAME, isSelfOwned: true, isBuiltIn: false });
    expect(api.spaces._props(space.id)).toEqual({
      url: `moz-extension://test/${TRACKER_PATH}`,
      button: { title: 'Time Tracker' },
    });
  });

  it('does not create a duplicate when called again (install, then startup)', async () => {
    const api = mock();
    const first = await ensureSpace(api);
    const second = await ensureSpace(api);
    expect(second.id).toBe(first.id);
    expect(await api.spaces.query({ isSelfOwned: true })).toHaveLength(1);
  });

  it('leaves an existing space alone by default', async () => {
    const api = mock();
    const stale = await api.spaces.create(SPACE_NAME, 'moz-extension://test/old.html');
    await ensureSpace(api);
    expect(api.spaces._props(stale.id).url).toBe('moz-extension://test/old.html');
  });

  it('repairs the tab URL and title of an existing space on request', async () => {
    const api = mock();
    const stale = await api.spaces.create(SPACE_NAME, 'moz-extension://test/old.html');
    await ensureSpace(api, { repair: true });
    expect(api.spaces._props(stale.id)).toEqual({
      url: `moz-extension://test/${TRACKER_PATH}`,
      button: { title: 'Time Tracker' },
    });
  });

  it('re-creates the space after Thunderbird removed it (add-on disabled, then enabled)', async () => {
    const api = mock();
    const first = await ensureSpace(api);
    await api.spaces.remove(first.id);
    const second = await ensureSpace(api);
    expect(second.id).not.toBe(first.id);
    expect(await api.spaces.query({ isSelfOwned: true, name: SPACE_NAME })).toHaveLength(1);
  });

  it('ignores built-in spaces with other names', async () => {
    const api = mock();
    await ensureSpace(api);
    expect((await api.spaces.query({ isBuiltIn: true })).map((s) => s.name)).toContain('mail');
  });
});
