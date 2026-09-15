# work-cli

Ticket → branch → PR → comment → doc, driven by an agent, across several client accounts with different emails, different trackers, different forges, and dozens of repos.

## Documentation

- **[Installation Guide](docs/INSTALL.md)** — Setup for CLI, Claude Code, and OpenCode
- **[Command Reference](docs/COMMANDS.md)** — All commands and flags

Five layers, each doing the job it is actually suited to:

| Layer                    | What                                                                       | Solves                                                              |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Credentials**          | `work` CLI + per-account profiles, selected by directory                   | Multiple accounts under different emails                            |
| **Repo**                 | `.work.md` per repo — config + context                                     | Many repos per account, each with its own tracker, keys, and quirks |
| **Adapters**             | Tracker (Jira, ClickUp) and forge (Bitbucket, GitHub) behind one interface | Commands don't care which vendor a repo uses                        |
| **Enforcement**          | Claude Code hook + global git `commit-msg` hook                            | Nothing published ever credits an AI; right git identity per repo   |
| **Knowledge + triggers** | Auto-loading skills, slash commands                                        | The loop itself                                                     |

## Quick Install

```bash
git clone https://github.com/khalidkhnz/work-cli.git ~/dev-workflow
cd ~/dev-workflow
./install.sh
work setup      # create first account profile
work doctor     # verify it
```

`install.sh` symlinks rather than copies, so editing this repo takes effect immediately and a `git pull` updates every project at once. Re-running it is safe.

Requires: Node.js ≥ 18, jq, git. `gh` CLI only if you use GitHub.

See **[docs/INSTALL.md](docs/INSTALL.md)** for Claude Code and OpenCode integration.

## Why a CLI and not more MCP servers

MCP OAuth binds one identity per connector, re-authenticates through a browser, and is unavailable in headless or cron runs. Adding a fourth client would mean a fourth connector and a fourth auth dance.

A profile is a file. The directory you're standing in picks it. The same commands work in Claude Code, another agent, a cron job, or your own shell.

## Profiles

Each account gets `~/.claude/dev-workflow/profiles/<name>.env` (mode 0600) holding its Atlassian site, email, API token, Jira project keys, Confluence space, git identity, and Bitbucket credentials.

Resolution order, first hit wins:

1. `WORK_PROFILE` environment variable
2. `.workprofile` file in the repo root or any ancestor
3. longest matching path route in `~/.claude/dev-workflow/config.json`
4. `defaultProfile`

```bash
work which                  # which account am I, and why
work route sentry           # map this repo to a profile
work profiles               # what's configured
work default --none         # no fallback: unrouted repos fail loudly
```

Prefer explicit routes and **no default profile**. With repos spread across several clients, a default means an unconfigured repo silently acts as — and commits as — the wrong account.

Atlassian API tokens: https://id.atlassian.com/manage-profile/security/api-tokens. Tokens are **scoped at creation and cannot be re-scoped**, so a Jira token fails against Bitbucket with `no Bitbucket scopes`; mint a second one with the Bitbucket scopes. App passwords were removed in July 2026 — Basic auth there now needs **email + API token**, not username.

For GitHub, set `GITHUB_TOKEN` per profile rather than relying on `gh`: the CLI holds one active account per host, so a shared `gh` login would open PRs as whichever account you last switched to.

## Repos: `.work.md`

An account has many repos, and they don't all agree. `.work.md` in a repo root carries both halves of what that repo needs — YAML frontmatter for machine config, markdown body for agent context:

```markdown
---
profile: acme
tracker: clickup # jira | clickup
project_keys: [ABC]
forge: github # omit to detect from origin
base_branch: develop
---

# service-name

## Where the real docs are

## Layout / How to run / Gotchas
```

Frontmatter overrides the account profile, which is how two repos side by side in one folder can belong to different accounts, trackers, or forges.

```bash
work init        # scaffold it
work context     # print the body (what an agent reads)
work repos ~/code  # every repo under a tree: branch, ticket, account, mismatches
```

**It does not replace `AGENTS.md` or `CLAUDE.md`.** Where a repo documents itself, `.work.md` should hold the config and a pointer. Duplicated guidance drifts, and then the copies disagree.

## Trackers and forges

Commands are vendor-agnostic — `work ticket`, `work move`, `work comment` behave the same on Jira or ClickUp.

|         | Supported             | Notes                                                                                        |
| ------- | --------------------- | -------------------------------------------------------------------------------------------- |
| Tracker | `jira`, `clickup`     | ClickUp custom ids (`ABC-123`) need `CLICKUP_TEAM_ID` when the token sees several workspaces |
| Forge   | `bitbucket`, `github` | GitHub prefers `GITHUB_TOKEN`, falls back to `gh`                                            |

Adding Linear or GitLab is one file in `lib/trackers/` or `lib/forges/` plus a line in the dispatch map — no command changes. The interface each adapter must satisfy is documented at the top of `lib/trackers/index.mjs`.

## The loop

```bash
work ticket STR-3350            # read it: description, AC, comments, links
work start STR-3350             # branch + git identity, from the ticket
    # ...implement...
work pr-body STR-3350           # draft a PR description from ticket + diff
work pr STR-3350 --yes          # open it, linked back to the ticket
work comment STR-3350 --body …  # tell the team
work move STR-3350 "In Review"
work doc api-contract STR-3350 --yes
```

From Claude Code, the same loop as slash commands: `/ticket`, `/start`, `/wrap`, `/doc`, `/standup`, `/whoami`.

`work pr` and `work doc` print a preview and change nothing without `--yes`. They are outward-facing and awkward to undo, so the flag is the confirmation.

## No AI attribution, enforced three ways

Nothing published from this machine names an AI as author, co-author, or assistant — not commits, tags, PRs, ticket comments, or Confluence pages.

1. **`~/.claude/settings.json`** — `attribution.commit` and `attribution.pr` set to empty, `includeCoAuthoredBy: false`. Nothing is generated to begin with.
2. **PreToolUse hook** — inspects every `git`/`gh`/`work`/`curl` command before it runs and denies it if the payload carries attribution, with an explanation the agent can act on.
3. **Global git `commit-msg` hook** — catches commits made outside any agent: your terminal, an IDE, a different tool.

The patterns target _attribution_, not mentions. `STR-3350 add claude commands` commits fine; `Co-Authored-By: Claude` never does. Both cases are covered by tests.

The commit-msg hook delegates to a repo's own `.git/hooks/commit-msg` when one exists, so pointing `core.hooksPath` here adds a check rather than removing what a project already had.

## Identity guard

The same hooks refuse a commit when the repo's `user.email` doesn't match the profile that owns the directory, and refuse `@technotribes.org` outright. Cross-contaminated author history between clients is tedious to unpick; this is cheaper.

`work start` sets the identity as a side effect, so the common path never trips the guard.

## Layout

```
bin/work.mjs           CLI entry
lib/                   config, repo, http, confluence, git, markup, scrub
lib/trackers/          jira, clickup, index (dispatch + interface contract)
lib/forges/            bitbucket, github, index
hooks/                 pretooluse-guard.sh, commit-msg, attribution-patterns.txt
commands/              slash commands  -> ~/.claude/commands/
skills/                auto-loading skills -> ~/.claude/skills/
templates/             api-contract, change-summary, tech-design
test.sh                no credentials needed, no network
```

Secrets live in `~/.claude/dev-workflow/`, never in this repo.

## Adding an account

```bash
work setup            # answer the prompts
work doctor           # confirm Jira, Confluence, Bitbucket, and identity
```

That's the whole cost of a new client.
