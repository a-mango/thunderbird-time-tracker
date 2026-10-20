# S2 — Idle detection

Goal: never silently count time you weren't working.

Read: `.ref/webext-docs/{idle,notifications}.rst`, `docs/DESIGN.md` (Notification bar).

## Deliver
1. Settings: idle threshold (off / 5 / 10 / 15 / 30 min; default 10).
2. Background: while a timer runs, `idle.setDetectionInterval(threshold)`. On `idle`/`locked`, record `idleSince` in `meta`. On `active`, if the timer is still running, raise the prompt.
3. Prompt: a notification bar in the tracker tab and popup, plus a system notification if the tab isn't open. It reads "You were away 23 min (14:02–14:25)". Options:
   - **Keep**
   - **Discard** (trim the entry to `idleSince` and restart at now)
   - **Stop at 14:02**
   - **Assign to…** (split; the idle part goes to another task)
4. Edge cases: suspend/resume, Thunderbird quit while idle, idle crossing midnight.

## Verify
Unit tests for each resolution with fake clocks; background tests with the mock `idle` events; manual check with a short threshold.
