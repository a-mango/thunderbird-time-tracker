// Button menus (the project pane's More and Projects buttons): a popover `.tt-menu` panel, since
// native menus only open from a contextmenu event. Same keyboard model as the column picker.
import { el, setAttrs } from './render.js';

/**
 * @typedef {{label: string, value: string, disabled?: boolean} | 'separator'} MenuItem
 */

/**
 * Opens a menu under `anchor` (aligned to its inline end) and resolves with the chosen value, or
 * null when it is dismissed (Escape, Tab, a click outside). Focus returns to the anchor.
 * Keyboard: Up/Down (wrapping), Home/End, Enter/Space activate.
 * @param {HTMLElement} anchor a button with aria-haspopup="menu"
 * @param {MenuItem[]} items
 * @returns {Promise<string | null>}
 */
export function showMenu(anchor, items) {
  const menu = el('div', {
    class: 'tt-menu',
    id: `tt-menu-${crypto.randomUUID()}`,
    attrs: { role: 'menu', popover: 'auto' },
  });
  if (!anchor.id) anchor.id = `${menu.id}-button`;
  setAttrs(menu, { 'aria-labelledby': anchor.id });
  /** @type {string | null} */
  let chosen = null;
  for (const item of items) {
    if (item === 'separator') {
      menu.append(el('hr', { class: 'menu-separator', attrs: { role: 'separator' } }));
      continue;
    }
    menu.append(
      el('button', {
        type: 'button',
        class: 'menu-item',
        tabIndex: -1,
        text: item.label,
        dataset: { value: item.value },
        attrs: { role: 'menuitem', 'aria-disabled': item.disabled ? 'true' : null },
        on: {
          click: () => {
            if (item.disabled) return;
            chosen = item.value;
            menu.hidePopover();
          },
        },
      }),
    );
  }
  const buttons = /** @type {HTMLElement[]} */ ([...menu.querySelectorAll('.menu-item')]);
  menu.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    /** @type {number | undefined} */
    let target;
    if (event.key === 'ArrowDown') target = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') target = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = buttons.length - 1;
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      menu.hidePopover();
      return;
    } else return;
    event.preventDefault();
    buttons[target]?.focus();
  });

  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.insetBlockStart = `${rect.bottom}px`;
  if (getComputedStyle(anchor).direction === 'rtl') menu.style.insetInlineEnd = `${rect.left}px`;
  else menu.style.insetInlineEnd = `${document.documentElement.clientWidth - rect.right}px`;
  anchor.setAttribute('aria-controls', menu.id);
  anchor.setAttribute('aria-expanded', 'true');
  menu.showPopover();
  buttons.find((button) => button.getAttribute('aria-disabled') !== 'true')?.focus();

  return new Promise((resolve) => {
    menu.addEventListener('toggle', (event) => {
      if (/** @type {ToggleEvent} */ (event).newState !== 'closed') return;
      anchor.setAttribute('aria-expanded', 'false');
      anchor.removeAttribute('aria-controls');
      menu.remove();
      anchor.focus();
      resolve(chosen);
    });
  });
}
