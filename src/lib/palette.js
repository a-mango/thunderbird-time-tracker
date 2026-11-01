// Project colours. The database stores #rrggbb (db/validate.js); each palette colour is the light
// value of a Thunderbird token, so rows paint known colours through the token and follow the
// theme. tests/unit/palette.test.js checks the values against src/ui/styles/tokens.css.

/**
 * @typedef {{color: string, token: string, label: string}} PaletteColor
 *   `label` is the _locales message name of the colour's name.
 */

/** @type {readonly PaletteColor[]} */
export const PALETTE = Object.freeze([
  { color: '#2493ef', token: '--color-blue-50', label: 'colorBlue' },
  { color: '#1373d9', token: '--folder-color-inbox', label: 'colorDarkBlue' },
  { color: '#25a6a0', token: '--color-accent-teal', label: 'colorTeal' },
  { color: '#1d783b', token: '--folder-color-sent', label: 'colorGreen' },
  { color: '#eabd08', token: '--folder-color-folder', label: 'colorYellow' },
  { color: '#ea7308', token: '--color-accent-orange', label: 'colorOrange' },
  { color: '#e247c4', token: '--color-accent-pink', label: 'colorPink' },
  { color: '#ae55f7', token: '--folder-color-draft', label: 'colorPurple' },
  { color: '#6e6f9b', token: '--color-accent-ink', label: 'colorInk' },
]);

/**
 * The palette entry of a stored colour (case-insensitive), or undefined for any other colour.
 * @param {string} color
 */
export function paletteColor(color) {
  const lower = color.toLowerCase();
  return PALETTE.find((entry) => entry.color === lower);
}

/**
 * CSS value to paint a stored colour with: the token for palette colours, the colour itself for
 * others (imported data may hold any #rrggbb).
 * @param {string} color
 */
export function colorValue(color) {
  const entry = paletteColor(color);
  return entry ? `var(${entry.token})` : color;
}
