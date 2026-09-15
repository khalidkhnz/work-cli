#!/bin/bash
# Installs the dev-workflow stack by symlinking into ~/.claude and ~/.local/bin.
# Symlinks rather than copies, so editing this repo takes effect immediately and
# `git pull` updates every project at once.
#
# Safe to re-run.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
BIN_DIR="$HOME/.local/bin"
CONFIG_DIR="$CLAUDE_DIR/dev-workflow"
SETTINGS="$CLAUDE_DIR/settings.json"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
bold() { printf '\033[1m%s\033[0m\n' "$1"; }

bold "Installing dev-workflow from $REPO"

# ------------------------------------------------------------------ 1. the CLI

mkdir -p "$BIN_DIR"
chmod +x "$REPO/bin/work.mjs" "$REPO/hooks/pretooluse-guard.sh" "$REPO/hooks/commit-msg"
ln -sfn "$REPO/bin/work.mjs" "$BIN_DIR/work"
green "✓ work -> $BIN_DIR/work"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) yellow "  ! $BIN_DIR is not on your PATH — add it to ~/.zshrc:"
     yellow "      export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

# --------------------------------------------------- 2. commands and skills

mkdir -p "$CLAUDE_DIR/commands" "$CLAUDE_DIR/skills"

for f in "$REPO"/commands/*.md; do
  [ -e "$f" ] || continue
  ln -sfn "$f" "$CLAUDE_DIR/commands/$(basename "$f")"
done
green "✓ slash commands -> $CLAUDE_DIR/commands/  ($(ls -1 "$REPO"/commands/*.md 2>/dev/null | wc -l | tr -d ' ') installed)"

for d in "$REPO"/skills/*/; do
  [ -d "$d" ] || continue
  ln -sfn "${d%/}" "$CLAUDE_DIR/skills/$(basename "$d")"
done
green "✓ skills -> $CLAUDE_DIR/skills/  ($(ls -1d "$REPO"/skills/*/ 2>/dev/null | wc -l | tr -d ' ') installed)"

# ------------------------------------------------------------- 3. config dir

mkdir -p "$CONFIG_DIR/profiles"
chmod 700 "$CONFIG_DIR" "$CONFIG_DIR/profiles"
[ -f "$CONFIG_DIR/config.json" ] || echo '{"defaultProfile":null,"routes":[]}' > "$CONFIG_DIR/config.json"
green "✓ config dir $CONFIG_DIR (0700)"

# ------------------------------------------------------ 4. git commit-msg hook

CURRENT_HOOKS="$(git config --global core.hooksPath || true)"
if [ -z "$CURRENT_HOOKS" ]; then
  git config --global core.hooksPath "$REPO/hooks"
  green "✓ global git hooks -> $REPO/hooks"
elif [ "$CURRENT_HOOKS" = "$REPO/hooks" ]; then
  green "✓ global git hooks already pointed here"
else
  yellow "! core.hooksPath is already set to: $CURRENT_HOOKS"
  yellow "  Not overwriting. To use this one instead:"
  yellow "      git config --global core.hooksPath \"$REPO/hooks\""
fi

# --------------------------------------------------- 5. Claude Code settings

if ! command -v jq >/dev/null 2>&1; then
  yellow "! jq not found — skipping settings.json. Install jq and re-run."
  exit 0
fi

mkdir -p "$CLAUDE_DIR"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

if ! jq empty "$SETTINGS" 2>/dev/null; then
  yellow "! $SETTINGS is not valid JSON. Fix it and re-run; leaving it untouched."
  exit 1
fi

cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"

GUARD="$REPO/hooks/pretooluse-guard.sh"

# Merge, never replace: existing hooks on other matchers are preserved, and the
# guard is only appended if it isn't already registered.
jq --arg guard "$GUARD" '
  # Attribution is disabled at the source as well as by the hook.
  .attribution = ((.attribution // {}) | .commit = "" | .pr = "")
  | .includeCoAuthoredBy = false

  | .hooks = (.hooks // {})
  | .hooks.PreToolUse = (.hooks.PreToolUse // [])
  | if any(.hooks.PreToolUse[]?; .hooks[]?.command? == $guard)
    then .
    else .hooks.PreToolUse += [{
      matcher: "Bash",
      hooks: [{ type: "command", command: $guard, timeout: 10 }]
    }]
    end
' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

green "✓ ~/.claude/settings.json — attribution disabled, guard hook registered"

echo ""
bold "Installed."
echo ""
echo "  Next:  work setup      create your first account profile"
echo "         work doctor     verify it end to end"
echo ""
echo "  Open a new Claude Code session (or run /hooks once) so the hook loads."
echo ""
