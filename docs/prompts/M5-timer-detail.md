# M5 — Timer, detail pane, background

Goal: tracking time actually works everywhere, including across Thunderbird restarts.

Read: `docs/SPEC.md` (Architecture: Timer, Startup), `docs/DESIGN.md` (Detail pane, What we draw), `.ref/webext-docs/{action,alarms,commands,spaces}.rst`.

## Deliver
1. Detail pane for the selected task:
   - breadcrumb, title, tags
   - timer box (running: live `h:mm:ss`, Stop, Split; idle: Start, Resume last entry)
   - action row; stat strip (Today / This week / Total / Estimate)
2. Entries list: range picker (Today, This week, Last week, This month, All), grouped by local day with day totals, and a source icon per entry.
   - Click opens the entry dialog.
   - Context actions: Split here, Duplicate, Delete (undo).
3. Entry dialog: date, start, end or duration (either drives the other), note, task (move). Validation: start < end; overlap warning with "Save anyway"; a running entry can't be given an end in the future.
4. Split dialog: split the running entry at now or at a chosen time. The second part can move to another task.
5. Background (`src/background/`):
   - on `tt:changed` and on startup, read the running entry
   - running: set the action label (`h:mm · task`, truncated), action badge, and space `badgeText`, and create the alarm `tt-tick` (period 1 min); stopped: clear all three and the alarm
   - `commands`: `toggle-timer` stops if running, else starts the last task. It shows a notification only if no last task exists (add the `notifications` permission only if you use it, with a note in SPEC)
6. Pages tick locally every second only while `document.visibilityState === 'visible'`.

## Verify
- Unit: every `lib/timer.js` operation, and background handlers tested with the mock `messenger` (alarms created and cleared, labels set).
- Playwright: start from the list → detail shows the running time; split; edit an entry to overlap → warning; stop from the detail pane → list updates (`BroadcastChannel` across two pages).
- Manual in Thunderbird, written as a numbered checklist in the PR:
  1. Start a timer.
  2. Check that the badges and label appear in the mail space.
  3. Quit Thunderbird, wait 2 min, start it again: the timer is still running and the elapsed time is correct.
  4. `Alt+Shift+T` toggles the timer.
  5. Close the tab: the timer keeps running.

## Done when
PR "M5: timer + detail + background" is open with the checklist results, and CI is green.
