# M1 — Design system + primitives

Goal: reusable, Thunderbird-faithful building blocks, proven in a gallery page.

Read: `docs/DESIGN.md` (all), `design/tokens.css`, look at `design/reference/three-pane-light.png` and `three-pane-dark.png`.
Use a subagent to dig through `.ref/comm-central/mail/themes/shared/mail/` (`tree-listbox.css`, `list-container.css`, `about3Pane.css`, `threadPane.css`, `pane-splitter.css`, `infobar.css`) so that reading doesn't fill this session's context.

## Deliver
1. Token audit: diff `design/tokens.css` against `.ref` (we target Thunderbird 157; if `.ref` is newer, note any divergent values). Then update `src/ui/styles/tokens.css`.
2. `src/ui/styles/base.css`: `font: message-box`, `tabular-nums` helpers, focus ring, scrollbars, `color-scheme`. Density and accent come from `data-*` attributes.
3. `scripts/import-icons.mjs` + `src/ui/icons/ICONS.txt` (folder, clock, calendar, calendar-today, star, tag, add, more, kebab, search, filter, display-options, check, pencil, trash, mail, export, settings, nav-left, nav-right).
   - Rewrite `context-fill`/`context-stroke` to `currentColor` and keep the MPL header.
   - Write `THIRD_PARTY.md`.
4. CSS components: button, primary, icon button, field/search, pill toggle, count badge (total/new/outlined), chip.
5. Custom elements, each with JSDoc and keyboard support:
   - `tt-splitter` (drag + keyboard, persists size)
   - `tt-tree` (ARIA tree: arrows, Home/End, type-ahead, expand/collapse, roving tabindex)
   - `tt-table` (ARIA grid: sort, column picker, resizable columns, keyboard row selection)
   - `tt-dialog` (wraps `<dialog>`)
   - `tt-notification-bar`
   - shared render helper (template cloning, keyed lists)
6. `dev/gallery.html` shows every primitive, plus a sidebar and list built from fixtures, matching reference A.
7. Spikes inside Thunderbird (`npm run tb`; add a temporary dev menu entry to open `gallery.html` if needed):
   - Compare a screenshot of the gallery with the mail tab: font family and size, row heights, and whether `AccentColor` matches Thunderbird's accent.
   - Can `menus.overrideContext()` show native context menus in our tab?

   Record the outcomes in `docs/DESIGN.md`.

## Verify
- Unit tests for the render helper.
- Playwright: keyboard tests for tree and table; axe with 0 violations.
- Run `npm run shots` with the gallery in light/dark × compact/default/relaxed (6 PNGs). Then have the `ui-reviewer` subagent compare them with `design/reference/three-pane-*.png` and fix what it flags as clear mismatches.

## Done when
PR "M1: design system" is open with the shots listed in the body, the spike notes are written down, and CI is green.
