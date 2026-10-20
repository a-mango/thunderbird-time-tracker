/** @typedef {{projects: {id: string, name: string, depth: number}[], taskCount: number, entryCount: number}} Summary */

/**
 * Handles runtime messages from extension pages.
 * M0 has no data layer: the summary is always empty. M2 answers from `db/`.
 * @param {any} message
 * @returns {Promise<Summary> | undefined}
 */
export function handleMessage(message) {
  if (message?.type === 'tt:summary') {
    return Promise.resolve({ projects: [], taskCount: 0, entryCount: 0 });
  }
  return undefined;
}
