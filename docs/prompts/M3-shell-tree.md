# M3 — Shell + project tree

Goal: the tracker tab with the three-pane layout and a fully working project sidebar.

Read: `docs/DESIGN.md` (What we draw, Layout A: Sidebar, Components), `docs/SPEC.md` (Keyboard), and look at `design/reference/three-pane-light.png`.

## Deliver
1. `ui/tracker.html` layout: the grid from DESIGN with two `tt-splitter`s and widths persisted in settings. List and detail panes are placeholders.
2. Sidebar header: New Task (disabled until M4), Add entry (disabled until M5), More menu with New Project, Settings (placeholder), Export (placeholder).
3. Views mode: Today, This Week, Starred, with live badges from `lib/rollup.js`.
4. Projects mode, using `tt-tree` over `db/` data:
   - nested projects, colour icon, bold top-level rows, rollup badges
   - running-project styling (fake a running entry via fixtures for now)
   - collapsed state persisted
5. Project dialog (`tt-dialog`): name, colour (palette from the `--folder-color-*` and accent tokens), parent. It handles both create and edit.
6. Move: drag and drop to reorder or reparent, with Thunderbird-style drop indicators. Keyboard alternative: "Move to…" dialog. Block cycles.
7. Archive/unarchive (Archive root, muted) and delete with explicit cascade confirmation.
8. Context menu: native via `menus.overrideContext` if M1's spike worked, otherwise the panel fallback. Items: New subproject, Rename, Colour, Move to…, Archive, Delete.
9. Live updates: changes from another tab/popup (`BroadcastChannel`) refresh the tree without losing selection or scroll.

## Verify
- Playwright:
  - create, rename, recolour, and nest 3 levels
  - drag reparent, and keyboard Move to…
  - archive, delete with cascade
  - keyboard-only navigation of the whole tree
  - axe check
- `npm run shots` (sidebar light/dark/compact), then the `ui-reviewer` subagent against `three-pane-*.png`. The sidebar must match the reference.
- Manual in Thunderbird: open the space, create a nested project, restart, and confirm it's still there. Write the steps in the PR so I can repeat them.

## Done when
PR "M3: shell + project tree" is open with shots and CI is green.
