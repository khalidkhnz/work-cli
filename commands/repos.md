---
description: Survey every repo under a directory — branch, ticket, account, and anything misconfigured
argument-hint: "[directory]  (defaults to the current one)"
allowed-tools: Bash(work *), Bash(git *), Read
---

!`work repos ${1:-.} 2>&1`

Summarise what's actually going on across these repos:

- **Mid-flight work** — repos on a ticket branch, especially dirty ones. These are the things the user has open right now.
- **Identity mismatches** — any repo committing as an email that doesn't match its account profile. Call these out individually with the repo name and both addresses; this is how one client's email ends up in another client's history.
- **Unrouted repos** — those showing `—` for profile belong to no account. They'll fail loudly on any `work` command until routed, which is the intended behaviour, but the user may want to set them up.
- **Missing `.work.md`** — worth adding where the user actually works, not everywhere. Don't push for all of them.

Keep it short and grouped by what needs action. A wall of 60 repo names helps nobody.
