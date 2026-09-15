#!/bin/bash
# Verifies the parts that must not silently break: attribution detection,
# markup conversion, and the two enforcement hooks.
#
#   ./test.sh
#
# Needs no credentials — nothing here touches the network.

set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
no()   { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ------------------------------------------------------------- syntax

head_ "Syntax"
for f in "$REPO"/bin/work.mjs "$REPO"/lib/*.mjs "$REPO"/lib/trackers/*.mjs "$REPO"/lib/forges/*.mjs; do
  node --check "$f" 2>/dev/null && ok "node --check $(basename "$f")" || no "node --check $(basename "$f")"
done
for f in "$REPO"/hooks/pretooluse-guard.sh "$REPO"/hooks/commit-msg "$REPO"/install.sh; do
  bash -n "$f" 2>/dev/null && ok "bash -n $(basename "$f")" || no "bash -n $(basename "$f")"
done

# --------------------------------------------- attribution + markup (node)

head_ "Attribution detection and markup"
cat > "$TMP/unit.mjs" <<EOF
import { findAttribution } from '$REPO/lib/scrub.mjs'
import { markdownToAdf, markdownToStorage } from '$REPO/lib/markup.mjs'

const cases = [
  ['Co-Authored-By: Claude <noreply@anthropic.com>', true],
  ['🤖 Generated with [Claude Code](https://claude.com/claude-code)', true],
  ['This was AI-generated', true],
  ['written by claude', true],
  ['Assisted-by: GPT-4', true],
  // Must NOT fire — these are legitimate.
  ['STR-3350 add claude commands to the workflow repo', false],
  ['STR-100 fix pagination on students list', false],
  ['Co-authored-by: Priya Nair <priya@acme.com>', false],
]
let bad = 0
for (const [text, expected] of cases) {
  const hit = findAttribution(text).length > 0
  if (hit !== expected) { bad++; console.log('MISMATCH:', JSON.stringify(text), 'expected', expected) }
}

const md = '## H\n\n**b** and \`c\` and [l](https://x.com)\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`\`\`ts\nconst x = 1\n\`\`\`\n'
try { JSON.stringify(markdownToAdf(md)) } catch (e) { bad++; console.log('ADF serialize failed:', e.message) }
const st = markdownToStorage(md)
if (!st.includes('ac:structured-macro')) { bad++; console.log('storage: code macro missing') }
if (!st.includes('<th>')) { bad++; console.log('storage: table header missing') }
if (!markdownToStorage('a < b & c').includes('&lt;')) { bad++; console.log('storage: escaping broken') }

process.exit(bad ? 1 : 0)
EOF
if node "$TMP/unit.mjs"; then ok "attribution cases + markup conversion"; else no "attribution cases + markup conversion"; fi

# ------------------------------------------- repo config, trackers, forges

head_ "Repo layer and dispatch"
cat > "$TMP/repo.mjs" <<EOF
import { readRepoFile, findRepos } from '$REPO/lib/repo.mjs'
import { getTracker, trackerNames } from '$REPO/lib/trackers/index.mjs'
import { FORGES } from '$REPO/lib/forges/index.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let bad = 0
const fail = (m) => { bad++; console.log('  ' + m) }

// Frontmatter: inline lists, dashed lists, booleans, numbers, quoted strings.
const dir = '$TMP/fm'
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, '.work.md'), \`---
profile: acme
tracker: clickup
project_keys: [ABC, DEF]
forge: github
base_branch: develop
dashed:
  - one
  - two
num: 42
yes_flag: true
quoted: "hello world"
---

# Body

Context here.
\`)

const { front, context } = readRepoFile(dir)
if (front.profile !== 'acme') fail('frontmatter: profile')
if (front.tracker !== 'clickup') fail('frontmatter: tracker')
if (JSON.stringify(front.project_keys) !== JSON.stringify(['ABC','DEF'])) fail('frontmatter: inline list -> ' + JSON.stringify(front.project_keys))
if (JSON.stringify(front.dashed) !== JSON.stringify(['one','two'])) fail('frontmatter: dashed list -> ' + JSON.stringify(front.dashed))
if (front.num !== 42) fail('frontmatter: number')
if (front.yes_flag !== true) fail('frontmatter: boolean')
if (front.quoted !== 'hello world') fail('frontmatter: quoted string')
if (!context.includes('Context here.')) fail('frontmatter: body not separated')

// A file with no frontmatter is all body, not a parse error.
const dir2 = '$TMP/fm2'
mkdirSync(dir2, { recursive: true })
writeFileSync(join(dir2, '.work.md'), '# Just a body\n')
if (readRepoFile(dir2).context !== '# Just a body') fail('bodyonly: not handled')

// Absent file must be inert, not throw.
if (readRepoFile('$TMP/nonexistent').file !== null) fail('missing .work.md: should report null')

// Tracker dispatch, including the required interface surface.
for (const name of trackerNames()) {
  const t = getTracker({ tracker: name })
  for (const fn of ['getIssue','search','addComment','getTransitions','transition','worklog','addLink','whoami','keyPattern']) {
    if (typeof t[fn] !== 'function') fail(\`tracker \${name}: missing \${fn}\`)
  }
}
if (getTracker({}).name !== 'jira') fail('tracker: default should be jira')
try { getTracker({ tracker: 'nope' }); fail('tracker: unknown should throw') } catch {}

// Forge adapters must expose the same three entry points.
for (const [name, f] of Object.entries(FORGES)) {
  for (const fn of ['createPullRequest','listPullRequests','whoami']) {
    if (typeof f[fn] !== 'function') fail(\`forge \${name}: missing \${fn}\`)
  }
}

// Repo discovery skips node_modules and stops at a repo root.
const ws = '$TMP/ws'
mkdirSync(join(ws, 'a', '.git'), { recursive: true })
mkdirSync(join(ws, 'b', '.git'), { recursive: true })
mkdirSync(join(ws, 'node_modules', 'c', '.git'), { recursive: true })
const found = findRepos(ws).map(r => r.name).sort()
if (JSON.stringify(found) !== JSON.stringify(['a','b'])) fail('findRepos -> ' + JSON.stringify(found))

process.exit(bad ? 1 : 0)
EOF
if node "$TMP/repo.mjs"; then ok "frontmatter, tracker/forge dispatch, repo discovery"; else no "frontmatter, tracker/forge dispatch, repo discovery"; fi

# ---------------------------------------------------- PreToolUse guard

head_ "PreToolUse guard"
guard() {
  local out; out="$(printf '%s' "$2" | bash "$REPO/hooks/pretooluse-guard.sh" 2>/dev/null)"
  local got="allow"
  [ -n "$out" ] && got="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "malformed"' 2>/dev/null)"
  [ "$got" = "$3" ] && ok "$1" || no "$1 (expected $3, got $got)"
}

guard "allows plain ls"                 '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' allow
guard "allows npm test"                 '{"tool_name":"Bash","tool_input":{"command":"npm run test"}}' allow
guard "allows a clean commit"           '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"STR-100 fix pagination\""},"cwd":"/tmp"}' allow
guard "allows commit naming claude"     '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"STR-3350 add claude commands\""},"cwd":"/tmp"}' allow
guard "denies Co-Authored-By trailer"   '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"fix\" -m \"Co-Authored-By: Claude <noreply@anthropic.com>\""},"cwd":"/tmp"}' deny
guard "denies Generated with"           '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"fix\n\n🤖 Generated with Claude Code\""},"cwd":"/tmp"}' deny
guard "denies gh pr AI-generated body"  '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title t --body \"This was AI-generated\""},"cwd":"/tmp"}' deny
guard "denies work comment with credit" '{"tool_name":"Bash","tool_input":{"command":"work comment STR-1 --body \"done with the help of Claude\""},"cwd":"/tmp"}' deny

# ------------------------------------------------------- commit-msg hook

head_ "commit-msg hook"
R="$TMP/repo"; mkdir -p "$R"; cd "$R"
git init -q; git config core.hooksPath "$REPO/hooks"
git config user.name t; git config user.email t@example.com
echo x > a && git add a

git commit -q -m "STR-1 clean subject" 2>/dev/null && ok "clean message commits" || no "clean message commits"

echo y >> a && git add a
printf 'STR-2 thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n' > "$TMP/m"
git commit -q -F "$TMP/m" 2>/dev/null && no "AI trailer rejected" || ok "AI trailer rejected"

git config user.email "x@technotribes.org"
git commit -q -m "STR-3 clean subject" 2>/dev/null && no "banned author domain rejected" || ok "banned author domain rejected"
git config user.email t@example.com

# Delegation: a repo's own hook must still run and still be able to block.
mkdir -p .git/hooks
printf '#!/bin/bash\nexit 1\n' > .git/hooks/commit-msg && chmod +x .git/hooks/commit-msg
before="$(git rev-parse HEAD)"
git commit -q -m "STR-4 blocked downstream" 2>/dev/null
[ "$before" = "$(git rev-parse HEAD)" ] && ok "delegates to repo-local hook" || no "delegates to repo-local hook"

printf '#!/bin/bash\nexit 0\n' > .git/hooks/commit-msg
echo z >> a && git add a
git commit -q -m "STR-5 passes both" 2>/dev/null && ok "passes when both hooks allow" || no "passes when both hooks allow"

# ------------------------------------------------------------------ result

printf '\n\033[1m%d passed, %d failed\033[0m\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
