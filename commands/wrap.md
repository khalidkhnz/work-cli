---
description: Wrap up a ticket — commit, open the PR, comment on the ticket, move it to review
argument-hint: "[TICKET-KEY]  (omit to use the key in the current branch)"
allowed-tools: Bash(work *), Bash(git *), Read, Glob, Grep
---

Close out the work on `$ARGUMENTS`. Work through this in order and stop at anything that looks wrong.

## 1. Survey what actually changed

!`git status --short 2>&1`

!`git diff --stat 2>&1 | tail -20`

Read the diff. If something in it does not belong to this ticket, say so before going further.

## 2. Commit

Group the changes into commits that each stand on their own. For the message:

- Subject line: `<TICKET-KEY> <what changed, imperative mood>`
- Body: why, only when the why isn't obvious from the diff.
- **No trailers naming any tool, and no co-authors.** The user is the sole author of everything committed from this machine. A guard hook will reject the commit if you forget, but do not rely on it.

**Ask before committing.** Show the message and wait for a yes — this is a standing rule for this user, not a formality.

## 3. Push and open the PR

Draft the description first and show it:

!`work pr-body $ARGUMENTS 2>&1`

Fill in the empty "How to verify" and "Notes for review" sections from what you actually know about the change — those two are the reason a reviewer reads the PR at all, so an empty bullet is worse than no section.

Then push, show the user the final body, and once they approve:

```
work pr $ARGUMENTS --yes
```

Without `--yes` it prints a preview and creates nothing, which is the right first step. `work pr` also attaches the PR link back to the ticket.

## 4. Comment on the ticket

Post what a teammate would need to know tomorrow — not a changelog of the diff:

```
work comment $ARGUMENTS --body "..."
```

Cover: what was implemented, anything deliberately left out and why, and what the reviewer should look at hardest. Plain first person, the way the user writes. No mention of how the work was produced.

## 5. Move the ticket

!`work transitions $ARGUMENTS 2>&1`

Move it to review with `work move`. If the project's workflow has no obvious review state, ask.

## 6. Report

Tell the user, in a few lines: the branch, the PR URL, the ticket's new status, and anything still outstanding. If any step failed, say which and why — a partial wrap reported as a clean one is the worst outcome here.
