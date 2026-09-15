---
description: Draft a standup or EOD update from real git and Jira activity
argument-hint: "[--since yesterday] [--days 1]"
allowed-tools: Bash(work *), Bash(git *), Read
---

Build a status update from what actually happened, not from what you remember happening.

## 1. Gather evidence

Commits, across every branch, authored by this account:

!`git log --all --author="$(git config user.email)" --since="${1:-yesterday}" --pretty=format:'%h %ad %s' --date=short 2>&1 | head -40`

Open tickets:

!`work mine 2>&1`

Open pull requests:

!`work prs 2>&1`

## 2. Write the update

Three sections, in the user's voice — first person, plain, no filler:

- **Done** — what landed. Reference tickets by key. One line each.
- **In progress** — what's mid-flight, and honestly how far along.
- **Blocked / needs input** — anything waiting on someone else. Name what you need and from whom. This section earns the update its value; do not pad it, but do not omit a real blocker to look productive.

Rules:
- Every claim traces to a commit, a PR, or a ticket you saw above. If the evidence is thin for something, leave it out rather than inflating it.
- No mention of tooling or how the work was produced.
- Short. A standup update nobody reads is worse than three bullets.

## 3. Offer, don't post

Show it as plain text the user can paste into Slack. If they want it on a ticket instead, `work comment <KEY> --body "..."` — but ask first, don't assume.
