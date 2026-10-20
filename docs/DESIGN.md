# Design

Goal: the tracker tab should feel like Thunderbird's mail tab, not like a web app inside Thunderbird. When in doubt, copy what the mail tab's folder pane or message list does.

- References: `design/reference/three-pane-{light,dark}.png|html` (A, primary) and `cards-timeline-{dark,light}.png|html` (B, stretch).
- Tokens: `design/tokens.css`. Values and names come from Thunderbird's own theme CSS, so reuse the names.
- Upstream source for anything missing: `.ref/comm-central/mail/themes/shared/mail/` (see M1).

## What we draw vs. what Thunderbird draws

The mockups show the whole window. Only the **content of our tab** is ours.

| Mockup element | Implemented as |
|---|---|
| Spaces toolbar button (clock, green dot) | `spaces.create()` button; `badgeText` while a timer runs |
| Tab "Time Tracker" | the space's tab (Thunderbird chrome) |
| Running-timer pill in the toolbar | `action` button, `allowed_spaces: []` (all spaces), label via `action.setLabel()`, popup on click |
| Unified toolbar search (B) | not possible in Thunderbird's chrome; in-tab search field instead |
| Status bar | Thunderbird chrome; we draw nothing there |
| Three panes | our extension page `ui/tracker.html` |

## Layout A: three panes (MVP)

`grid-template-columns: [sidebar] minmax(100px, 18em) [splitter] 1px [list] minmax(320px, 1fr) [splitter] 1px [detail] minmax(320px, 470px)`, splitters draggable and widths persisted. Thunderbird's folder pane defaults to `18em`.

**Sidebar (= folder pane)**
- Header bar: primary **New Task** button that fills the row (like *New Message*), an icon button *Add time entry*, and an icon button *More* (kebab). Padding 9px (6px compact).
- Mode sections like folder modes: **Views** (Today, This Week, Starred) and **Projects**. Each mode header is weight 600, `1.1rem`, padding-inline-start 12px, `--folder-mode-name-padding` block, and has a top border `--sidebar-border` except the first, plus a kebab at the end.
- Tree rows (`role="tree"`/`treeitem`): min-height `--list-item-min-height`, `margin-inline: 3px`, 1px transparent border, radius 3px. Then a twisty box `--list-item-buttons-size`, a 16px folder icon tinted with the project colour (fill = colour at 20%, stroke = colour), and the name (margin-inline 7px, ellipsis). Indent is `16px × depth`.
- Root rows (top-level groups) are bold like account rows.
- Row states come from `list-container.css`: hover (`--list-container-*-hover`), selected, selected+focused, and selected+current+focused (accent border, accent 15% fill).
- Time badges reuse the folder count badge: pill, radius 1000px, `0.85em`, `tabular-nums`, padding 1px 4px, margin-inline-end 6px. The total style is `--folderpane-total-count-*` (normal weight). The **running project** uses the "new mail" style like upstream: badge `--folderpane-unread-new-count-background` (bold), name bold in `--new-folder-color`. A collapsed parent of a running project gets the outlined badge in `--new-folder-color`.
- Archive is a collapsed, muted root at the bottom.

**List pane (= message list)**
- Header: project name (bold), muted "N open tasks · total", a **Quick Filter** toggle button and a display-options icon button.
- Quick filter bar: toggle pills **Open** (on by default), **Starred**, **Billable**, **Tags**, then a filter field with the hint `Ctrl+Shift+K`, the same shortcut as Thunderbird's quick filter.
- Table view (default): columns ★ · timer · Task · Week · Total · Estimate · Last tracked. Right-align time columns with `tabular-nums`. Header height is `--tree-header-table-height`, cells are separated by 1px `--layout-border-0`, and there's a column picker like Thunderbird's.
- Selected focused row: background `--listbox-focused-selected-bg` (= `--selected-item-color`), text `--selected-item-text-color`. Unfocused selection is the flat `--listbox-selected-bg` = `light-dark(gray-30, gray-70)` (157 only mixes colours under forced colours).
- The running row shows a stop button and bold text, and its "Last tracked" reads *Running*.
- Estimate cell: a 4px bar plus the label; over-estimate turns the bar and label `--tt-over-estimate`.
- Footer line: "N done tasks hidden · Show".
- Cards view (stretch, from design B): the same data on two-line cards using `--tree-card-*` tokens, switched from display options exactly like Thunderbird's Cards/Table switch.

**Detail pane (= message pane)**
- Breadcrumb (muted, 13px), task title (19px/600), tag chips.
- Timer box with accent tint at 8% and accent border at 35%: big elapsed time `h:mm:ss` (28px/600, tabular), "Running since 13:40 · note", then **Stop** (primary) and **Split**. When idle it shows **Start** (primary) and **Resume last entry**.
- Action row (small buttons): Add Entry, Mark Done, Edit, More.
- Stat strip with 4 equal cells: Today, This week, Total, Estimate (with bar).
- Time entries: a range dropdown, day group headers (bold 13px with the day total, faint background), and rows with the source icon (clock = timer, pencil = manual), time range, note, and duration right-aligned.
- Linked messages (S1): mail icon, subject link (opens the message in Thunderbird), date.

## Popup (action button)

360px wide, 3–4 blocks. The running task shows elapsed time, Stop, and Split. Then a "Switch to…" search field with the 5 most recent tasks (Enter = start), then "Open Time Tracker". Use the same tokens and no new visual language.

## Components

- **Buttons**: min-height `--button-min-height`, radius 3px, 1px `--button-border-color`, background `--button-background-color`, horizontal padding 12px. Primary uses the accent tokens. Icon buttons are 28–32px square and transparent, with `--toolbar-button-hover-background-color` on hover.
- **Focus**: `:focus-visible` gets `--focus-outline` with offset 2px; inside trees and tables use the row-state tokens instead.
- **Fields**: 28px high, 1px `--search-bar-border-color`, background `--layout-background-0`, radius 3px.
- **Splitter**: 1px visible, 5px hit area (`--splitter-*`).
- **Context menus**: native menus via `menus.overrideContext()` with `documentUrlPatterns` scoped to our page (works, see the M1 spike outcomes). The panel fallback (radius `--panel-border-radius`, `--panel-background-color`, `--panel-border-color`) is `.tt-menu`, used for the column picker.
- **Dialogs**: native `<dialog>`, styled like Thunderbird's in-content dialogs (panel tokens, buttons right-aligned, primary last).
- **Notification bar** (idle prompt, errors): Thunderbird infobar style. Radius 4px, background `light-dark(--layout-background-0, --layout-background-2)`, 16px icon, ghost buttons. Place it at the top of the list pane.

## Typography, icons, formatting

- Font: `font: message-box` (the Gecko system UI font), set in `base.css`. The M1 spike confirmed it computes to the same family and size as the mail tab. Use `tabular-nums` for every duration and time (`.num`, or `numeric`/`align: 'end'` on `tt-table` columns).
- Icons: Thunderbird's own SVGs from `mail/themes/shared/mail/icons/new/` (MPL-2.0, see `THIRD_PARTY.md`). `npm run icons` (`scripts/import-icons.mjs`) copies the ones listed in `src/ui/icons/ICONS.txt`, rewrites `context-stroke` to `currentColor` and `context-fill` to `currentColor` at `var(--icon-fill-opacity, 0.2)`, and keeps the MPL header. Draw them with `icon(name)` from `src/ui/render.js` (`<svg><use href=…#i>`): an `<img>` can't inherit `color`. Tint with `color` or `--icon-color` (tree rows); fill solid with `--icon-fill-opacity: 1` (starred). Add to the list; don't hand-draw. The new icon set has no play/stop glyph; M4 picks the timer column icons.
- Durations: `1h 05m`, `25m`, `0m`. Running time is `1:05:12`. Use `–` for no data.
- Relative dates follow the message list: `Today 10:25`, `Mon 17:30`, `16 Oct`, then `16/10/2025` for another year (use `Intl.DateTimeFormat` with the Thunderbird UI locale from `messenger.i18n.getUILanguage()`).

## Themes, density, accent, a11y

- Light and dark come from `prefers-color-scheme` through `light-dark()`. `color-scheme: light dark` is set in `tokens.css`.
- Density setting Compact / Default / Relaxed → `data-density` on `<html>`. Extensions can't read Thunderbird's density pref (the M1 spike checked `-moz-pref()`: it doesn't match in extension pages), so we keep our own setting.
- Accent setting System (default) / Thunderbird / Purple / Orange / Pink / Ink / Teal → `data-accent`, mirroring Thunderbird's appearance settings.
- `prefers-contrast` and forced colours: system colours only (see the end of `tokens.css`).
- Use real buttons, labels, ARIA tree/grid patterns, full keyboard operation, and announce timer start and stop through a polite live region. Test with axe in Playwright and by hand with Orca on Fedora.

## Divergences from Thunderbird 157

`src/ui/styles/tokens.css` takes its values from tag `THUNDERBIRD_157_0_RELEASE`. `design/tokens.css` (copied from 160.0a1) is kept as a historical copy. The M1 audit found:

- 118 of 140 tokens match 157 exactly, and 8 more match through indirection.
- The 12 Bolt semantic colours (`--color-surface-*`, `--color-text-*` base/secondary/muted/critical/success) take the 157 values. Dark surfaces are slate (`#1a202c`, `#262d3b`), not zinc; they only reach panels and dialogs, and the layout grays are unchanged.
- Renamed: `--folder-color-filter` → `--folder-color-folder-filter` (upstream name). `--folder-indent-step` → `--tt-indent-step`: upstream hard-codes `16px * --depth`.
- Accent overrides apply only under `not (prefers-contrast)`, like upstream, so high contrast keeps `SelectedItem`. The `thunderbird` accent's dark text is `#1a202c`.
- Thread row height is set in JS upstream (`about3Pane.js` `densityChange()`: `ceil(1.4 × font size)` + 0/7/13px). It's `--tree-row-height` here.
- Changed for WCAG AA, because the upstream values fail it on our backgrounds:
  - `--new-folder-color` and `--link-color`: light is blue-70 (upstream blue-60 is 4.49:1 on `--layout-background-1`).
  - `--folderpane-unread-new-count-background`: dark is blue-60 (upstream blue-50 with white text is 3.3:1).
  - Success infobar: `#1d783b` with white text in light, green-50 with black in dark (upstream green-60 with white is 3.3:1).
  - `--tt-text-muted` (gray-50 / gray-40) for muted text. `--layout-color-3` is gray-50 in both schemes and fails in dark.
  - `--tt-over-estimate`: red-70 / red-40.
- Upstream's `-moz-Dialog`/`-moz-DialogText` (high contrast) are chrome-only, so we use `Canvas`/`CanvasText`.
- Quick filter toggles follow reference A (accent fill when pressed). 157's quick filter bar uses `check-button` with a small indicator bar; switch to that if the fill looks foreign next to the mail tab.

## M1 spike outcomes

Run with `npm run tb:spike` (Marionette, `.tb-profile/`). Measured on Thunderbird **158.0** (the RPM installed here; we target 157), dark theme, default density and font size, accent pref `accent-color` (System), HiDPI (devicePixelRatio 2). Raw data is in `artifacts/tb/spike.json`; screenshots are `artifacts/tb/{mail-tab,gallery-tab}.png`.

| What | Mail tab (about:3pane) | Our page (moz-extension) |
|---|---|---|
| `font: message-box` family and size | GTK system font, 14.6667px (11pt) | same family, 14.6667px |
| `AccentColor` / `--selected-item-color` | `rgb(53, 132, 228)` / same | `rgb(53, 132, 228)` / same |
| Folder tree row | 28px | 28px (26px min-height is content-box like upstream, +2px border; was 26px before the fix) |
| Thread table row | 28px (`ROW_HEIGHT`) | 28px (`--tree-row-height`) |
| Mode header font size | 16.1333px | 16.1333px |

- **Font size setting**: Thunderbird's own font-size setting (`UIFontSize`) only registers chrome windows (`about3Pane.js`, `tabmail.js`), not extension tabs. If a user changes it, our tab keeps the system size. Not handled in M1: consider a size setting or `browser.*` zoom later.
- **Accent**: with the System accent, `AccentColor` in our page equals Thunderbird's. Thunderbird's accent setting (Settings > Appearance) uses `@media -moz-pref("mail.appearance.accentColor", …)`. That query parses in an extension page but never matches (tested with the true value), so a non-System Thunderbird accent can't be followed automatically. Hence the `data-accent` setting (M6).
- **Density**: `-moz-pref("mail.uidensity", …)` also never matches, so we keep our own density setting.
- **`menus.overrideContext()`** works in our tab, with permissions `menus` and `menus.overrideContext` (added only in the spike stage) and an item with `documentUrlPatterns: [moz-extension://<uuid>/*]`:
  - Right-click with `overrideContext({showDefaults: false})`: Thunderbird's `browserContext` popup shows only our item.
  - Without the override: "Select All" plus our item (`contexts: ['all']`).
  - M3 can use native context menus; the permissions go into the manifest then (SPEC table).

