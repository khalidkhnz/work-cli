# Installation Guide

Complete guide to installing the `work` CLI and integrating it with Claude Code and OpenCode.

## Prerequisites

- **Node.js** >= 18
- **jq** (for JSON manipulation)
- **git**
- **gh** (GitHub CLI) — only if you use GitHub as a forge

## Quick Install

```bash
git clone https://github.com/khalidkhnz/work-cli.git ~/dev-workflow
cd ~/dev-workflow
./install.sh
```

The installer:

1. Symlinks `work` CLI to `~/.local/bin/work`
2. Installs slash commands to `~/.claude/commands/`
3. Installs skills to `~/.claude/skills/`
4. Sets up config directory at `~/.claude/dev-workflow/`
5. Configures global git hooks for attribution enforcement
6. Updates Claude Code settings (disables AI attribution, registers guard hook)

> **Note:** Symlinks are used instead of copies, so `git pull` updates everything instantly.

## Post-Install Setup

### 1. Add to PATH

If `~/.local/bin` isn't on your PATH, add to your shell config:

```bash
# ~/.zshrc or ~/.bashrc
export PATH="$HOME/.local/bin:$PATH"
```

### 2. Create Your First Profile

```bash
work setup
```

This walks you through setting up credentials for your first account (Jira/ClickUp, Bitbucket/GitHub, git identity).

### 3. Verify Installation

```bash
work doctor
```

Confirms Jira, Confluence, Bitbucket/GitHub, and git identity are all working.

---

## Claude Code Integration

The `install.sh` script automatically configures Claude Code. Here's what it sets up:

### Slash Commands

Installed to `~/.claude/commands/`:

| Command         | Description                       |
| --------------- | --------------------------------- |
| `/ticket <KEY>` | Read ticket details               |
| `/start <KEY>`  | Create branch + set git identity  |
| `/wrap <KEY>`   | Draft PR and update ticket        |
| `/doc <KEY>`    | Generate API documentation        |
| `/standup`      | Generate standup summary          |
| `/whoami`       | Show current account context      |
| `/context`      | Show repo context from `.work.md` |
| `/repos [dir]`  | List repos with status            |

### Skills

Installed to `~/.claude/skills/`:

| Skill              | Auto-loads when                                  |
| ------------------ | ------------------------------------------------ |
| `ticket-workflow`  | Working with ticket keys, branches, commits, PRs |
| `api-contract-doc` | Documenting APIs or writing Confluence pages     |

### Settings

`~/.claude/settings.json` is updated to:

- Disable AI attribution in commits and PRs
- Register the PreToolUse guard hook

### Manual Verification

After installation, in Claude Code:

```
/hooks          # Verify hooks are loaded
/whoami         # Check current account
work which      # Same, via CLI
```

---

## OpenCode Integration

OpenCode uses a similar skill and command system. To integrate:

### 1. Install Skills

Create symlinks in the OpenCode skills directory:

```bash
# OpenCode skills directory (adjust path if different)
OPENCODE_SKILLS="$HOME/.agents/skills"

mkdir -p "$OPENCODE_SKILLS"
ln -sfn ~/dev-workflow/skills/ticket-workflow "$OPENCODE_SKILLS/ticket-workflow"
ln -sfn ~/dev-workflow/skills/api-contract-doc "$OPENCODE_SKILLS/api-contract-doc"
```

### 2. Verify Skills

The skills should now appear in OpenCode's available skills list. They auto-load when:

- You mention a ticket key (e.g., `STR-1234`)
- You work on commits, PRs, or branches
- You ask about API documentation

### 3. Using the CLI in OpenCode

OpenCode can run the `work` CLI directly via its Bash tool:

```bash
work which              # Check current account
work ticket STR-1234    # Read ticket
work start STR-1234     # Create branch
work pr STR-1234 --yes  # Open PR
```

---

## Per-Repo Configuration

Each repo can have a `.work.md` file with config and context:

```markdown
---
profile: acme # Account profile to use
tracker: jira # jira | clickup
project_keys: [ABC] # Ticket prefixes
forge: github # github | bitbucket (or auto-detect)
base_branch: main # Default branch for PRs
doc_space: DOCS # Confluence space key
---

# Project Name

## What this is

Brief description...

## Gotchas

Things that have cost time before...
```

Initialize with:

```bash
work init
```

---

## Profile Management

### Create Profile

```bash
work setup
```

### List Profiles

```bash
work profiles
```

### Route Repo to Profile

```bash
work route <profile-name>
```

### Check Current Context

```bash
work which
```

### Set No Default (Recommended)

```bash
work default --none
```

This makes unconfigured repos fail loudly instead of silently using the wrong account.

---

## Troubleshooting

### "work: command not found"

Add `~/.local/bin` to your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### "No profile for this directory"

Either:

- Run `work route <profile>` to map the repo
- Or create a `.work.md` with `profile: <name>` in frontmatter

### Hooks not loading in Claude Code

Run `/hooks` once in a new session, or restart Claude Code.

### Git identity mismatch

Run `work start <KEY>` — it sets the identity as a side effect.
Or manually:

```bash
work which   # See expected identity
git config user.email "correct@email.com"
git config user.name "Correct Name"
```

### Attribution hook blocking commits

The hook enforces no AI attribution. Remove any:

- `Co-Authored-By: Claude` or similar trailers
- "Generated by", "AI-assisted", etc. in messages
- Robot emoji in commit messages

---

## Uninstall

```bash
# Remove symlinks
rm ~/.local/bin/work
rm -rf ~/.claude/commands/*.md  # Only work CLI commands
rm -rf ~/.claude/skills/ticket-workflow
rm -rf ~/.claude/skills/api-contract-doc

# Remove config (WARNING: deletes profiles/credentials)
rm -rf ~/.claude/dev-workflow

# Reset git hooks
git config --global --unset core.hooksPath

# Restore Claude settings manually if needed
# Edit ~/.claude/settings.json
```
