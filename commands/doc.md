---
description: Write a Confluence page from the code — API contract, change summary, or tech design
argument-hint: "<api-contract|change-summary|tech-design> [TICKET-KEY]"
allowed-tools: Bash(work *), Bash(git *), Read, Glob, Grep
---

Produce a Confluence page for `$ARGUMENTS`.

## 1. Know what you're documenting

!`work ticket 2>&1 | head -40`

!`git diff --stat $(git merge-base HEAD origin/HEAD 2>/dev/null || echo HEAD~1)...HEAD 2>&1 | tail -20`

## 2. Read the actual code

This is the step that separates a useful page from a plausible one. Do not write a single endpoint, field, or type from memory or from the ticket description — open the route handlers, DTOs, validators, and response types and read them.

For an API contract specifically, every one of these comes from the code, not from inference:
- method + path, including the router prefix it's mounted under
- auth: which guard/middleware, which permission or role
- request: path params, query params, body schema, which fields are optional, validation rules
- responses: success shape and status, plus the error cases that are actually thrown
- anything version- or feature-flag-gated

Where the code is genuinely ambiguous, write what it does and flag the ambiguity in the page. Do not smooth over it.

## 3. Draft it

Start from the template and fill it in:

```
work doc $ARGUMENTS
```

That prints a preview and publishes nothing. Read the preview, then rewrite the content properly — the template is a skeleton, not a deliverable. Show the user the finished markdown.

Write it as the user would: direct, no throat-clearing, no "this document describes...". No mention anywhere of how it was produced.

## 4. Publish

Once the user approves:

```
work doc $ARGUMENTS --yes
```

Publishing is idempotent — same title, same space means the existing page is updated rather than duplicated. The page is linked back to the ticket automatically.

To publish something you drafted in a file instead of from a template:

```
work doc api-contract --file <path> --title "..." --yes
```
