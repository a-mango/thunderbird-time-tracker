export const SPACE_NAME = 'time_tracker';
export const TRACKER_PATH = 'ui/tracker.html';

/**
 * Make sure our space exists and points at the tracker page.
 * Idempotent: updates the existing space instead of creating a duplicate.
 * @param {typeof messenger} [api]
 * @returns {Promise<messenger.spaces.Space>}
 */
export async function ensureSpace(api = messenger) {
  const url = api.runtime.getURL(TRACKER_PATH);
  const buttonProperties = { title: api.i18n.getMessage('spaceTitle') };
  const [existing] = await api.spaces.query({ isSelfOwned: true, name: SPACE_NAME });
  if (existing) {
    await api.spaces.update(existing.id, { url }, buttonProperties);
    return existing;
  }
  return api.spaces.create(SPACE_NAME, { url }, buttonProperties);
}
