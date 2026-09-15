---
name: ticket-workflow
description: How this user works tickets across their several client accounts, trackers (Jira, ClickUp), forges (Bitbucket, GitHub), and ~60 repos — branch naming, commit and PR conventions, per-repo context in .work.md, and the absolute rule that nothing published ever credits an AI tool. Load whenever the work involves a ticket key (STR-1234, ST-13065, ABC-99), a git branch tied to a ticket, writing a commit message or PR description, commenting on or transitioning a ticket, or any use of the `work` CLI. Also load before committing or opening a pull request in any repository.
---

# Ticket workflow

This user works across several client accounts and roughly sixty repos. Each account has its own site, tracker, forge, git identity, and ticket key prefixes. The `work` CLI picks the right one from the directory you are in. You almost never need to think about which account — but you do need to never assume.

## Orient before you act

In an unfamiliar repo, run `work which` first. It reports the account, tracker, forge, ticket key from the branch, and whether the repo has context. One command, and you stop guessing.

If `work` says no profile applies, that is a setup gap for the user to fix (`work setup` or `work route`) — not something to work around. There is deliberately no default account, so an unconfigured repo fails loudly instead of quietly acting as the wrong client.

## The one rule that is not negotiable

**Nothing published from this machine credits an AI, names one as an author, or says it was generated or assisted.**

That covers commit messages and trailers, tags, branch names, PR titles and descriptions, Jira comments and descriptions, Confluence pages, and Slack updates drafted here. No `Co-Authored-By`, no "Generated with", no 🤖, no "AI-assisted", and no rewording that gestures at the same thing. The user is the sole author of their work.

A hook enforces this and will reject the command. Do not treat the hook as the rule — it is the backstop. Write it clean the first time.

## The loop

```
work ticket <KEY>          read the ticket
work start <KEY>           branch + git identity + ready to work
    ... implement ...
work pr-body <KEY>         draft the PR description
work pr <KEY> --yes        open it, linked to the ticket
work comment <KEY> --body  tell the team what landed
work move <KEY> "In Review"
work doc api-contract <KEY> --yes    when the change has an API surface
```

`work which` answers "which account am I acting as right now, and why".

The commands are tracker-agnostic. `work ticket`, `work move`, `work comment` behave the same whether the repo is on Jira or ClickUp — the adapter is chosen from config, so never reach for a vendor API directly.

## Comment management

Beyond adding comments, you can now edit and delete them:

```
work comment <KEY> --body "..."           add a new comment
work comments <KEY>                       list all comments with their IDs
work edit-comment <KEY> --id <id> --body  update an existing comment
work delete-comment <KEY> --id <id> --yes delete a comment (requires --yes)
```

**Editing comments** is useful when you need to correct information or add updates without cluttering the ticket with new comments.

**Deleting comments** requires explicit `--yes` confirmation because it's irreversible. The CLI will show a warning and require you to re-run with `--yes`. Use this sparingly — usually editing is better than deleting.

## ADF (Atlassian Document Format)

All Jira write operations (comments, descriptions, worklogs) now accept either:

- **ADF objects** (preferred for full control over formatting)
- **Markdown strings** (auto-converted to ADF)

The `work` CLI handles the conversion automatically, but if you need advanced formatting (panels, @mentions, status lozenges), you can construct ADF directly using the helpers in `lib/markup.mjs`:

```javascript
import {
  adfDoc,
  adfHeading,
  adfBulletList,
  adfPanel,
  adfMention,
} from "./lib/markup.mjs";

// Complex comment with formatting
const body = adfDoc([
  adfHeading(3, "PR Ready"),
  adfBulletList(["All tests passing", "Documentation updated"]),
  adfPanel("info", "Ready for review"),
]);
```

## Per-repo context: `.work.md`

A repo root may hold `.work.md`: YAML frontmatter (account, tracker, key prefixes, forge, base branch) plus a markdown body describing the codebase. `work context` prints the body; `work init` scaffolds the file.

**Read it before touching an unfamiliar repo.** The gotchas section exists because something there has already cost the user an hour.

Its frontmatter overrides the account profile, which is what lets two repos sitting side by side in one folder belong to different accounts, trackers, or forges.

**It does not replace `AGENTS.md` or `CLAUDE.md`.** Where a repo already documents itself, `.work.md` should carry the machine config and a pointer to the real docs — and you should follow that pointer. Duplicated guidance drifts and the copies start contradicting each other. If you're asked to write a `.work.md` for a repo that already has good docs, keep the body to a map.

## Working across many repos

`work repos [dir]` lists every repo under a directory with its branch, ticket, account, dirty state, and whether its git identity matches its profile. Use it to answer "what am I in the middle of" across clients, and to spot a repo committing under the wrong address before it becomes history.

## Commands that publish need a `--yes`

`work pr` and `work doc` print a preview and change nothing without `--yes`. That is deliberate: they are outward-facing and awkward to undo. Always show the user the preview and get a real yes before adding the flag.

`work comment` and `work move` act immediately. They are cheap and reversible — but they are still visible to the user's team, so say what you're about to post before you post it.

## Conventions

**Branches** — `work start` generates them: `<type>/<KEY>-<slug>`, where type is `feature`, `fix`, `chore`, or `spike` derived from the Jira issue type. Don't hand-roll branch names; the generated one is what the tooling looks for later when it needs to find the ticket key.

**Commits** — subject is `<KEY> <imperative description>`. Body only when the _why_ isn't visible in the diff. One logical change per commit.

**Ask before committing or pushing.** This is a standing instruction from the user, with no expiry. Show the message, wait for a yes. Approval on one commit is not approval for the next.

**Git identity** — `work start` sets `user.name`/`user.email` from the account profile. If you find yourself committing in a repo you didn't `work start` in, run `work which` and check the identity matches before the commit, not after. Cross-contaminated author history between clients is genuinely painful to fix.

**PR descriptions** — `work pr-body` scaffolds from the ticket and the diff, but leaves "How to verify" and "Notes for review" empty on purpose. Fill them from what you actually know. Those two sections are why a reviewer opens the PR.

**Ticket comments** — write what a teammate needs tomorrow: what was implemented, what was deliberately left out, where the risk is. Not a restatement of the diff. First person, plain, the way the user writes.

## When something doesn't fit

If `work` reports no profile for a directory, that's a setup gap, not an error to work around — tell the user and let them run `work setup` or `work route`. Don't fall back to raw `curl` against an API, and don't guess at credentials.

If a ticket has no acceptance criteria, or the criteria contradict the code, say so before implementing. Building the wrong thing efficiently is the failure mode worth avoiding here.
