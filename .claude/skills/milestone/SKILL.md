---
name: milestone
description: Run one milestone or stretch item of docs/PLAN.md end to end (brief, plan, implement, verify, PR).
disable-model-invocation: true
argument-hint: "[M0..M7 | S1..S5]"
---

Work on milestone **$0** of the Thunderbird time tracker.

1. Read `docs/prompts/$0-*.md` (the brief) and the `$0` section of `docs/PLAN.md`. Read only the `docs/SPEC.md` / `docs/DESIGN.md` sections the brief names.
2. Find the GitHub issue: `gh issue list --state open --search "$0 in:title"`. Read it with comments; comments override the brief.
3. If the working tree isn't clean, stop and tell me. Otherwise `git switch main && git pull`, then create branch `<lowercase $0>-<short-slug>`.
4. **Plan before editing**: list files to add or change, public interfaces, tests (names), spikes, risks, and the verification steps from the brief. Present it and wait for my approval.
5. Implement in small, conventional commits. Tests go alongside, or first where the brief says so.
6. Verify exactly as the brief says. Always finish with `/check`. For UI work, run `npm run shots` and delegate to the `ui-reviewer` subagent.
7. Delegate to the `spec-reviewer` subagent with the diff against `main` and the ✅ criteria for $0. Fix correctness and requirement gaps; list the rest as follow-ups.
8. Update `docs/PLAN.md` (spike outcomes, decisions) and `CLAUDE.md` (only new commands or gotchas, one line each).
9. Push and open the PR "$0: <title>". Body: `Closes #<issue>`, summary, evidence (command outputs, screenshot paths, perf numbers), manual Thunderbird checklist for me, follow-ups.
