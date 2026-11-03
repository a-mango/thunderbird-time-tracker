// Page-wide appearance settings (docs/DESIGN.md, Themes, density, accent): `data-density` and
// `data-accent` on <html>, read by tokens.css. Used by every page that follows the settings.

/** @param {Pick<import('../lib/types.js').Settings, 'density' | 'accent'>} settings */
export function applySettings({ density, accent }) {
  const root = document.documentElement;
  if (density === 'default') delete root.dataset.density;
  else root.dataset.density = density;
  if (accent === 'system') delete root.dataset.accent;
  else root.dataset.accent = accent;
}
