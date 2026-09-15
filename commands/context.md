---
description: Load this repo's context — what it is, how it's laid out, and what bites you
allowed-tools: Bash(work *), Read, Glob, Grep
---

!`work context 2>&1`

!`work which 2>&1`

If there is no `.work.md`, say so and offer to create one with `work init` — but first check whether the repo already has `AGENTS.md`, `CLAUDE.md`, or a `docs/` tree, and read that instead. A repo with good docs needs `.work.md` for machine config and a pointer, not a second copy of its conventions.

If the context file points at other documents, read those now. The point of this command is to be oriented before touching anything, and a pointer you didn't follow is worse than no pointer.

Then tell the user, briefly: what this repo is, which account and tracker it belongs to, and anything in the gotchas that bears on what they're about to do.
