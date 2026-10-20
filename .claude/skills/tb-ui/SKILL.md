---
name: tb-ui
description: Thunderbird look-and-feel rules for this extension's UI. Use whenever creating or changing anything under src/ui/ or dev/gallery.html.
paths: ["src/ui/**", "dev/**"]
---

- The reference is Thunderbird's mail tab. Use `design/reference/three-pane-*.png` for the main layout, `docs/DESIGN.md` for component specs, and `src/ui/styles/tokens.css` for values (the names match Thunderbird's).
- Before inventing a style, look at how Thunderbird does it in `.ref/comm-central/mail/themes/shared/mail/` (`about3Pane.css` for the folder pane, `tree-listbox.css`/`threadPane.css` for lists, `list-container.css` for row states). Use a subagent for wide searches.
- No raw colours, no new radii (3px controls, 4px infobar, 8px panels), spacing in multiples of `--space-step` (3px), density through tokens only.
- Icons: Thunderbird SVGs from `src/ui/icons/` only. Need a new one? Add it to `ICONS.txt` and run `npm run icons`.
- Real `<button>`, `<input>`+`<label>`, ARIA tree/grid patterns, roving tabindex, visible `:focus-visible`. Every pointer action needs a keyboard path.
- DOM via templates and `createElement`/`textContent`. Never `innerHTML`.
- Check light, dark, compact, and relaxed before calling UI work done (`npm run shots`), then ask the `ui-reviewer` subagent.
