/**
 * Fills every `[data-i18n]` element's text from `_locales`.
 * @param {ParentNode} root
 */
export function localize(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = messenger.i18n.getMessage(/** @type {HTMLElement} */ (el).dataset.i18n ?? '');
  }
  document.title = messenger.i18n.getMessage('extensionName');
}
