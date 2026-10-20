# S4 — Day timeline + Cards view (design B)

Goal: the alternative layout from `design/reference/cards-timeline-{dark,light}.png`, as a display option rather than a separate app.

Read: `docs/DESIGN.md` (List pane: Cards view), and open `design/reference/cards-timeline-dark.html` to see the structure.

## Deliver
1. Display options → **Cards / Table**, exactly like Thunderbird's message-list switch. Cards use `--tree-card-*` tokens:
   - line 1: name, star, total
   - line 2: week/last tracked, estimate bar
   - play/stop button at the right edge
2. Detail pane option: **Task details / Day timeline**.
   - Timeline: hour grid (configurable start/end), entry blocks tinted with the project colour, a now line, a running block with a dashed bottom edge, and "N min untracked" chips in gaps.
   - Day/Week/Month segmented control; ‹ Today › navigation.
3. Interactions: drag on empty grid to create an entry; drag block edges to resize; drag a block to move it; snap to 5 min; `Esc` cancels. Each operation can be undone.
4. Keyboard alternative for every pointer interaction (select a block, then arrows ±5 min; `Shift`+arrows resizes).
5. Optional (ask first): show calendar events as ghost blocks with "Track to…". This needs a calendar API that Thunderbird may not offer to extensions on our target version; research `.ref/webext-docs` first and report back before building anything.

## Verify
Playwright drag tests (pointer and keyboard); shots vs the B reference in dark and light; perf with 200 entries in a day.
