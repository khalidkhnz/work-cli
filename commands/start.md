---
description: Start work on a ticket — branch off, set the right git identity, move it to In Progress
argument-hint: "<TICKET-KEY> [--base branch]"
allowed-tools: Bash(work *), Bash(git status*), Bash(git log*), Read, Glob, Grep
---

Begin work on `$ARGUMENTS`.

## 1. Check the tree is clean

!`git status --short 2>&1 | head -20`

If there are uncommitted changes, stop and ask what to do with them. Never stash or discard someone's work to make room for a branch.

## 2. Branch and identity

!`work start $ARGUMENTS 2>&1`

`work start` creates the branch from the ticket type and summary, and sets `user.name`/`user.email` from the account profile that owns this directory. That identity step is the point: it is what keeps one client's email out of another client's history.

## 3. Move the ticket

Transition it to whatever this project calls "in progress":

!`work transitions 2>&1`

Pick the matching transition and run `work move <status>`. If nothing obviously matches, show the user the options and ask rather than guessing.

## 4. Plan the work

Now read the ticket and the code, and lay out how you'll implement it. Keep it short — the files you'll touch, the approach, anything you'd want confirmed before writing code.

Do not write code yet unless the user has already told you to.
