---
name: check
description: Run the project's full local verification (lint, types, unit tests, web-ext lint) and report evidence. Use before every commit and PR.
allowed-tools: Bash(npm run *) Bash(npm test *)
---

1. Run `npm run check`. If the change touched `src/ui/` or `dev/`, also run `npm run test:ui`.
2. On failure, fix the root cause. Don't skip or weaken tests or lint rules. Re-run until green.
3. Report the commands run and the tail of each output (pass counts, coverage summary if produced). Don't just say "all good".
