#!/bin/bash
# Claude Code PreToolUse hook (matcher: Bash).
#
# Two jobs, both of which must be enforced by code rather than by instruction,
# because an instruction 200k tokens back is a suggestion and this is a rule:
#
#   1. No AI attribution reaches a commit, tag, PR, ticket, or doc.
#   2. Commits carry the git identity that belongs to this repo's account.
#
# Exits 0 and stays silent for anything that cannot publish text, so the common
# case (ls, cat, npm test) costs a few milliseconds.

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS="$HOOK_DIR/attribution-patterns.txt"

deny() {
  # PreToolUse denial: Claude sees the reason and gets a chance to redo the call.
  jq -nc --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
command_text="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"

# A shell command is no longer the only way text leaves this machine. A profile
# in MCP mode publishes Confluence pages and Jira comments through the Atlassian
# MCP tools, which never touch Bash — so scanning only .tool_input.command would
# leave the house rule enforced on exactly the paths that stopped being used.
# For those tools the payload is the whole argument object.
if [ -z "$command_text" ]; then
  case "$tool_name" in
    *Atlassian__createConfluencePage | *Atlassian__updateConfluencePage \
      | *Atlassian__createConfluenceFooterComment | *Atlassian__createConfluenceInlineComment \
      | *Atlassian__addCommentToJiraIssue | *Atlassian__createJiraIssue | *Atlassian__editJiraIssue \
      | *Atlassian__addWorklogToJiraIssue)
      command_text="$(printf '%s' "$input" | jq -r '.tool_input | tostring' 2>/dev/null)"
      ;;
    *) exit 0 ;;
  esac
  [ -z "$command_text" ] && exit 0
else
  # Fast path: only commands that can publish text are worth inspecting.
  if ! printf '%s' "$command_text" | grep -Eqi '(^|[;&|[:space:]])(git|gh|glab|work|curl|jira)([[:space:]]|$)'; then
    exit 0
  fi
fi

# ---------------------------------------------------------------- attribution

if [ -f "$PATTERNS" ]; then
  hit="$(printf '%s' "$command_text" | grep -Eio -f <(grep -v '^#' "$PATTERNS" | grep -v '^[[:space:]]*$') 2>/dev/null | head -3 | tr '\n' ';')"
  if [ -n "$hit" ]; then
    deny "Blocked: this command carries AI attribution ($hit).

House rule: nothing published from this machine — commit messages, tags, PR titles or bodies, ticket comments, Confluence pages — may credit an AI tool, name one as co-author, or say it was generated or assisted.

Remove the trailer or phrase entirely and run the command again. Do not reword it to hint at the same thing."
  fi
fi

# ------------------------------------------------------------- git identity

# Only for commands that actually write a commit.
if printf '%s' "$command_text" | grep -Eqi '(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(commit|tag|revert|cherry-pick|am)([[:space:]]|$)'; then
  cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
  [ -z "$cwd" ] && cwd="$PWD"

  actual_email="$(git -C "$cwd" config user.email 2>/dev/null || true)"

  # Standing rule: this domain is never a valid author or committer.
  if printf '%s' "$actual_email" | grep -Eqi '@technotribes\.org$'; then
    deny "Blocked: this repo's git user.email is $actual_email, and @technotribes.org addresses must never author or commit anything.

Set the right identity first:  work start <TICKET>   (sets it from the account profile)
or manually:                   git -C \"$cwd\" config user.email <correct address>"
  fi

  # Compare against the profile that owns this directory, when one is configured.
  if command -v work >/dev/null 2>&1; then
    expected_email="$(cd "$cwd" 2>/dev/null && work which --json 2>/dev/null | jq -r '.gitEmail // empty' 2>/dev/null)"
    if [ -n "$expected_email" ] && [ -n "$actual_email" ] && [ "$expected_email" != "$actual_email" ]; then
      profile_name="$(cd "$cwd" 2>/dev/null && work which --json 2>/dev/null | jq -r '.profile // "?"' 2>/dev/null)"
      deny "Blocked: wrong git identity for this repo.

  repo is committing as   $actual_email
  profile \"$profile_name\" expects  $expected_email

Committing as the wrong account across projects is hard to unpick later. Fix it with:
  git -C \"$cwd\" config user.email $expected_email
then run the commit again. If the profile is what's wrong, run: work setup --profile $profile_name"
    fi
  fi
fi

exit 0
