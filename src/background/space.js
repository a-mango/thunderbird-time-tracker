export const SPACE_NAME = 'time_tracker';
export const TRACKER_PATH = 'ui/tracker.html';

/**
 * Make sure our space exists. Thunderbird keeps extension spaces in memory and removes them
 * when the add-on shuts down (disable, reload), so this runs on every background start.
 * With `repair`, an existing space is also pointed at the current URL and title (after
 * install or update); without it, an existing space is left alone.
 * @param {typeof messenger} [api]
 * @param {{repair?: boolean}} [options]
 * @returns {Promise<messenger.spaces.Space>}
 */
export async function ensureSpace(api = messenger, { repair = false } = {}) {
  const url = api.runtime.getURL(TRACKER_PATH);
  const buttonProperties = { title: api.i18n.getMessage('spaceTitle') };
  const [existing] = await api.spaces.query({ isSelfOwned: true, name: SPACE_NAME });
  if (existing) {
    if (repair) await api.spaces.update(existing.id, { url }, buttonProperties);
    return existing;
  }
  return api.spaces.create(SPACE_NAME, { url }, buttonProperties);
}
