---
name: issue
description: Fix a GitHub issue (usually a bug found while testing in Thunderbird) on its own branch with a regression test.
disable-model-invocation: true
argument-hint: "[issue-number]"
---

Fix GitHub issue #$0.

1. `gh issue view $0 --comments`. Restate the expected vs. actual behaviour in two lines.
2. Branch `fix-$0-<slug>` from an up-to-date `main`.
3. Reproduce with a failing test first (unit if logic, Playwright if UI). If it can only be reproduced in Thunderbird, write the manual steps and say why it can't be automated.
4. Fix the root cause, then `/check`.
5. Push and open a PR with `Fixes #$0`, the failing-then-passing test, and the evidence.
