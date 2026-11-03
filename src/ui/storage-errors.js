// Storage failures as user messages with a recovery hint (M7 robustness).
import { storageErrorKind } from '../lib/errors.js';
import { t } from './i18n.js';

/**
 * @param {unknown} error
 * @param {'open' | 'write'} phase opening the database, or saving a change
 * @returns {{message: string, reload: boolean}} `reload`: offer to reload the page
 */
export function storageMessage(error, phase) {
  switch (storageErrorKind(error)) {
    case 'blocked':
      return { message: t('errorBlocked'), reload: true };
    case 'version':
      return { message: t('errorNewerVersion'), reload: false };
    case 'quota':
      return { message: t('errorQuota'), reload: false };
    default:
      return phase === 'open'
        ? { message: t('trackerLoadError'), reload: true }
        : { message: t('errorSave'), reload: false };
  }
}
