# Command Reference

Quick reference for all `work` CLI commands.

## Core Workflow

| Command                           | Description                                        |
| --------------------------------- | -------------------------------------------------- |
| `work ticket <KEY>`               | Read ticket: description, AC, comments, links      |
| `work start <KEY>`                | Create branch from ticket + set git identity       |
| `work pr-body <KEY>`              | Draft PR description from ticket + diff            |
| `work pr <KEY> [--yes]`           | Open PR linked to ticket (preview without `--yes`) |
| `work comment <KEY> --body "..."` | Post comment to ticket                             |
| `work move <KEY> "Status"`        | Transition ticket status                           |

## Documentation

| Command                                        | Description              |
| ---------------------------------------------- | ------------------------ |
| `work doc api-contract <KEY>`                  | Preview API contract doc |
| `work doc api-contract <KEY> --yes`            | Publish to Confluence    |
| `work doc change-summary <KEY> --yes`          | Publish change summary   |
| `work doc --file draft.md --title "..." --yes` | Publish custom doc       |

## Context & Identity

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `work which`       | Show current account, tracker, forge, ticket     |
| `work context`     | Print repo context from `.work.md`               |
| `work repos [dir]` | List repos: branch, ticket, account, dirty state |

## Setup & Configuration

| Command                  | Description                              |
| ------------------------ | ---------------------------------------- |
| `work setup`             | Create new account profile (interactive) |
| `work doctor`            | Verify all integrations working          |
| `work profiles`          | List configured profiles                 |
| `work route <profile>`   | Map current repo to profile              |
| `work default <profile>` | Set default profile                      |
| `work default --none`    | No default (recommended)                 |
| `work init`              | Scaffold `.work.md` in repo              |

## Slash Commands (Claude Code)

| Command         | Maps to                           |
| --------------- | --------------------------------- |
| `/ticket <KEY>` | `work ticket <KEY>`               |
| `/start <KEY>`  | `work start <KEY>`                |
| `/wrap <KEY>`   | Draft PR + update ticket          |
| `/doc <KEY>`    | `work doc api-contract <KEY>`     |
| `/standup`      | Generate standup from recent work |
| `/whoami`       | `work which`                      |
| `/context`      | `work context`                    |
| `/repos [dir]`  | `work repos [dir]`                |

## Flags

| Flag            | Commands    | Effect                               |
| --------------- | ----------- | ------------------------------------ |
| `--yes`         | `pr`, `doc` | Execute without preview confirmation |
| `--body "..."`  | `comment`   | Inline comment body                  |
| `--file <path>` | `doc`       | Use custom markdown file             |
| `--title "..."` | `doc`       | Override page title                  |

## Examples

```bash
# Full workflow for STR-1234
work ticket STR-1234           # Read the ticket
work start STR-1234            # Create feature/STR-1234-slug branch
# ... implement ...
work pr-body STR-1234          # Draft PR description
work pr STR-1234 --yes         # Open PR
work move STR-1234 "In Review"
work comment STR-1234 --body "Ready for review. Changes: ..."

# Check what you're working on across all repos
work repos ~/code

# API documentation
work doc api-contract STR-1234          # Preview
work doc api-contract STR-1234 --yes    # Publish

# Context switching
work which                     # What account am I?
cd ~/other-project
work which                     # Different account now
```

## Environment Variables

| Variable       | Purpose                                      |
| -------------- | -------------------------------------------- |
| `WORK_PROFILE` | Force specific profile (overrides detection) |
| `WORK_DEBUG`   | Enable debug logging                         |

## Profile Resolution Order

1. `WORK_PROFILE` environment variable
2. `.workprofile` file in repo or ancestor
3. `.work.md` frontmatter `profile:` field
4. Path route in `~/.claude/dev-workflow/config.json`
5. `defaultProfile` (if set)

---

See [INSTALL.md](./INSTALL.md) for setup instructions.
