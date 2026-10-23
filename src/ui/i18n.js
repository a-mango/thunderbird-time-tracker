/** @param {string} name @param {...string} substitutions */
export const t = (name, ...substitutions) => messenger.i18n.getMessage(name, substitutions);

/**
 * Fills every `[data-i18n]` element's text and every `[data-i18n-label]` element's accessible
 * name (and tooltip, on buttons) from `_locales`.
 * @param {ParentNode} root
 */
export function localize(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(/** @type {HTMLElement} */ (el).dataset.i18n ?? '');
  }
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    const label = t(/** @type {HTMLElement} */ (el).dataset.i18nLabel ?? '');
    el.setAttribute('aria-label', label);
    if (el instanceof HTMLButtonElement) el.title = label;
  }
  document.title = t('extensionName');
  document.documentElement.lang = messenger.i18n.getUILanguage();
  document.documentElement.dir = t('@@bidi_dir') || 'ltr';
}
