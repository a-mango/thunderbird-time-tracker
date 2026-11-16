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
 * Red, green and blue of a CSS colour written as `#rgb`, `#rrggbb`, `rgb(r, g, b)` or
 * `rgba(r, g, b, a)`, or null for anything else.
 * @param {unknown} value
 * @returns {[number, number, number] | null}
 */
function channels(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(text);
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(text);
  const hex = long ?? short?.map((digit) => digit + digit);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  const rgb =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+%?\s*)?\)$/iu.exec(text);
  if (!rgb) return null;
  const values = /** @type {[number, number, number]} */ (rgb.slice(1, 4).map(Number));
  return values.every((n) => n <= 255) ? values : null;
}

/**
 * The palette colour closest to a colour from another app (RGB distance), so imported projects
 * paint through theme tokens like the others. Unreadable colours get the first (default) one.
 * @param {unknown} value
 * @returns {string} a `PALETTE` colour
 */
export function nearestPaletteColor(value) {
  const target = channels(value);
  if (!target) return PALETTE[0].color;
  let best = PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of PALETTE) {
    const rgb = /** @type {[number, number, number]} */ (channels(entry.color));
    const distance = rgb.reduce((sum, n, i) => sum + (n - target[i]) ** 2, 0);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best.color;
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
