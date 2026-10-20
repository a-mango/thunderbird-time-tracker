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
- Time badges reuse the folder count badge: pill, radius 1000px, `0.85em` bold, `tabular-nums`, padding 1px 4px, margin-inline-end 6px. The total style is `--folderpane-total-count-*`. The **running project** uses the "new mail" badge (`--selected-item-color` fill, bold name in accent colour), and a collapsed parent of a running project gets the outlined badge.
- Archive is a collapsed, muted root at the bottom.

**List pane (= message list)**
- Header: project name (bold), muted "N open tasks · total", a **Quick Filter** toggle button and a display-options icon button.
- Quick filter bar: toggle pills **Open** (on by default), **Starred**, **Billable**, **Tags**, then a filter field with the hint `Ctrl+Shift+K`, the same shortcut as Thunderbird's quick filter.
- Table view (default): columns ★ · timer · Task · Week · Total · Estimate · Last tracked. Right-align time columns with `tabular-nums`. Header height is `--tree-header-table-height`, cells are separated by 1px `--layout-border-0`, and there's a column picker like Thunderbird's.
- Selected focused row: background `--selected-item-color`, text `--selected-item-text-color`. Unfocused selection uses the Thunderbird `listbox-selected-bg` mix.
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
- **Context menus**: first try native menus via `menus.overrideContext()` with `documentUrlPatterns` scoped to our page (spike in M3). Fallback is a panel with radius `--panel-border-radius`, background `--panel-background-color`, and border `--panel-border-color`.
- **Dialogs**: native `<dialog>`, styled like Thunderbird's in-content dialogs (panel tokens, buttons right-aligned, primary last).
- **Notification bar** (idle prompt, errors): Thunderbird infobar style. Radius 4px, background `light-dark(--layout-background-0, --layout-background-2)`, 16px icon, ghost buttons. Place it at the top of the list pane.

## Typography, icons, formatting

- Font: start with `font: message-box` (the Gecko system UI font), then compare a screenshot against the mail tab on the same machine (M1 spike). Use `tabular-nums` for every duration and time.
- Icons: Thunderbird's own SVGs from `mail/themes/shared/mail/icons/new/{compact,normal}` (MPL-2.0). `scripts/import-icons.mjs` copies the ones listed in `src/ui/icons/ICONS.txt`, rewrites `context-fill`/`context-stroke` to `currentColor` (fill at 15–20% opacity), and keeps the MPL header. Add to the list; don't hand-draw.
- Durations: `1h 05m`, `25m`, `0m`. Running time is `1:05:12`. Use `–` for no data.
- Relative dates follow the message list: `Today 10:25`, `Mon 17:30`, `16 Oct`, then `16/10/2025` for another year (use `Intl.DateTimeFormat` with the Thunderbird UI locale from `messenger.i18n.getUILanguage()`).

## Themes, density, accent, a11y

- Light and dark come from `prefers-color-scheme` through `light-dark()`. `color-scheme: light dark` is set in `tokens.css`.
- Density setting Compact / Default / Relaxed → `data-density` on `<html>`. Extensions can't read Thunderbird's density pref, so we keep our own setting.
- Accent setting System (default) / Thunderbird / Purple / Orange / Pink / Ink / Teal → `data-accent`, mirroring Thunderbird's appearance settings.
- `prefers-contrast` and forced colours: system colours only (see the end of `tokens.css`).
- Use real buttons, labels, ARIA tree/grid patterns, full keyboard operation, and announce timer start and stop through a polite live region. Test with axe in Playwright and by hand with Orca on Fedora.
