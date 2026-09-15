---
description: Pull a Jira ticket into context — description, acceptance criteria, comments, links
argument-hint: "[TICKET-KEY]  (omit to use the key in the current branch)"
allowed-tools: Bash(work *), Read, Glob, Grep
---

Load ticket `$ARGUMENTS` and orient yourself in the code before doing anything else.

## 1. Fetch it

!`work ticket $ARGUMENTS 2>&1`

If that failed because no profile applies here, say so and stop — the fix is `work setup` or `work route <profile>`, and it is the user's call which.

## 2. Read it properly

Summarise for the user, in this order:

- **What is being asked** — one or two sentences in your own words, not a restatement of the summary field.
- **Acceptance criteria** — pull them out of the description even when they are not labelled as such. If there are none, say that plainly; a ticket without AC is a risk worth naming.
- **What is unclear** — anything you would have to guess at. Be specific about what you'd guess and what it would change.
- **Recent comments** — only the ones that change the scope or approach. Skip status chatter.

## 3. Find the code

Locate the files this ticket touches. Use the ticket's nouns as search terms, and check the linked/parent tickets' branch names for prior art. Report the files as `path:line` so they're clickable.

Do not start editing. This command ends with the user knowing what the ticket wants and where the work lands.
