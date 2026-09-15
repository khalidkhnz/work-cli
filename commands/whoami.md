---
description: Show which account, Jira site, and git identity apply in this directory
allowed-tools: Bash(work *), Bash(git *)
---

!`work which 2>&1`

!`git config user.email 2>&1`

!`git remote -v 2>&1 | head -2`

Report which account this directory acts as, and flag any mismatch between the profile's git identity and what the repo is actually set to — that mismatch is how commits end up attributed to the wrong client.

If they differ, the fix is `git config user.email <profile email>`, or `work start <TICKET>` which sets it as a side effect.
