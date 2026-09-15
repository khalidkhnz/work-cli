// Per-repo layer.
//
// A profile is an account. A repo is one codebase inside it — and a single
// directory tree can hold dozens of repos on different branches, some on a
// different tracker or forge than their siblings. `.work.md` in a repo root
// carries both halves of what that repo needs:
//
//   - YAML frontmatter: machine config (tracker, keys, forge, base branch)
//   - markdown body:    context for the agent — what this codebase is, how it's
//                       laid out, how to run it, what bites you
//
// One file, because a repo's config and its explanation drift apart when they
// live in two.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { loadProfile } from './config.mjs'
import { repoRoot, currentBranch, keyFromBranch, isDirty, git } from './git.mjs'

export const REPO_FILE = '.work.md'

// Everything this tool may leave inside someone else's repository. All of it is
// local scaffolding — an account profile, a base branch, notes to an agent —
// and none of it is the repo's business. It gets excluded, never .gitignored:
// .gitignore is a tracked file, so editing it to hide this tool would itself be
// a commit about this tool.
export const WORK_ARTIFACTS = [REPO_FILE, '.workprofile', '.work.env']

const EXCLUDE_HEADER = '# work CLI — local scaffolding, deliberately never committed'

// .git/info/exclude is per-clone and untracked, which is exactly the property
// wanted here. Returns what it did so callers can report honestly.
export function ensureLocalExclude(root) {
  const gitDir = git(['rev-parse', '--absolute-git-dir'], { cwd: root, allowFail: true })
  if (!gitDir) return { ok: false, reason: 'not a git repository' }

  const file = join(gitDir, 'info', 'exclude')
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const lines = existing.split('\n').map((l) => l.trim())
  const missing = WORK_ARTIFACTS.filter((a) => !lines.includes(a))
  if (!missing.length) return { ok: true, added: [], file }

  mkdirSync(dirname(file), { recursive: true })
  const block = (existing && !existing.endsWith('\n') ? '\n' : '') + `\n${EXCLUDE_HEADER}\n${missing.join('\n')}\n`
  writeFileSync(file, existing + block)
  return { ok: true, added: missing, file }
}

// Minimal YAML: scalars, inline lists [a, b], dashed lists, booleans, numbers.
// Deliberately not a YAML implementation — the frontmatter here is a dozen
// flat keys, and a real parser would be a dependency for no gain.
function parseFrontmatter(text) {
  const out = {}
  const lines = text.split('\n')
  let currentKey = null

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue

    const dashed = raw.match(/^\s*-\s+(.*)$/)
    if (dashed && currentKey) {
      if (!Array.isArray(out[currentKey])) out[currentKey] = []
      out[currentKey].push(coerce(dashed[1]))
      continue
    }

    const kv = raw.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    const [, key, rawVal] = kv
    currentKey = key
    const val = rawVal.trim()

    if (val === '') {
      out[key] = []
      continue
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val.slice(1, -1).split(',').map((s) => coerce(s.trim())).filter((s) => s !== '')
      continue
    }
    out[key] = coerce(val)
  }
  return out

  function coerce(v) {
    let s = String(v).trim()
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
    // Strip a trailing comment. The template this file is generated from puts
    // the legal values in one ("tracker: jira   # jira | clickup"), and without
    // this the comment becomes part of the value — which surfaces much later as
    // an unsupported-forge error naming a string with a "#" in it.
    // Whitespace before the "#" is required, so a "#" inside a value survives.
    s = s.replace(/\s+#.*$/, '').trim()
    if (s === 'true') return true
    if (s === 'false') return false
    if (s === 'null' || s === '~') return null
    if (/^-?\d+$/.test(s)) return Number(s)
    return s
  }
}

export function readRepoFile(root) {
  const file = join(root, REPO_FILE)
  if (!existsSync(file)) return { file: null, front: {}, context: '' }

  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { file, front: {}, context: text.trim() }
  return { file, front: parseFrontmatter(m[1]), context: m[2].trim() }
}

// The merged view every command works against: repo overrides profile, profile
// overrides built-in default.
export function resolveRepo(cwd = process.cwd(), { required = true } = {}) {
  const root = repoRoot(cwd)
  const { file, front, context } = root ? readRepoFile(root) : { file: null, front: {}, context: '' }

  // A repo may name its own profile, which is how two repos side by side in the
  // same folder can belong to different accounts.
  const hadEnv = Boolean(process.env.WORK_PROFILE)
  if (front.profile && !hadEnv) process.env.WORK_PROFILE = String(front.profile)
  const profile = loadProfile(cwd, { required })
  if (front.profile && !hadEnv) {
    delete process.env.WORK_PROFILE
    // Report the real source, not the env var this function set a line ago.
    if (profile) profile.via = REPO_FILE
  }

  const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/).filter(Boolean) : [])

  const merged = {
    root,
    branch: root ? currentBranch(cwd) : null,
    contextFile: file,
    context,
    name: front.name ?? (root ? basename(root) : null),
    profile,

    tracker: String(front.tracker ?? profile?.TRACKER ?? 'jira').toLowerCase(),
    projectKeys: list(front.project_keys ?? front.projectKeys).length
      ? list(front.project_keys ?? front.projectKeys)
      : list(profile?.JIRA_PROJECT_KEYS),

    forge: front.forge ? String(front.forge).toLowerCase() : null, // null = detect from remote
    baseBranch: front.base_branch ?? front.baseBranch ?? profile?.DEFAULT_BASE_BRANCH ?? null,
    branchTemplate: front.branch_template ?? front.branchTemplate ?? profile?.BRANCH_TEMPLATE ?? '{type}/{key}-{slug}',

    docSpace: front.doc_space ?? front.docSpace ?? profile?.CONFLUENCE_SPACE ?? null,
    docParent: front.doc_parent ?? front.docParent ?? profile?.CONFLUENCE_PARENT_ID ?? null,

    // ClickUp scopes tasks to a list; a repo usually maps to exactly one.
    clickupList: front.clickup_list ?? front.clickupList ?? profile?.CLICKUP_LIST_ID ?? null,
  }

  merged.ticketKey = merged.branch ? keyFromBranch(merged.branch, merged.projectKeys) : null
  return merged
}

// ------------------------------------------------------------ workspace scan

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'target', '.turbo', 'Pods'])

export function findRepos(dir, { maxDepth = 3 } = {}) {
  const found = []
  walk(resolve(dir), 0)
  return found.sort((a, b) => a.path.localeCompare(b.path))

  function walk(current, depth) {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }

    if (entries.some((e) => e.name === '.git')) {
      found.push({ path: current, name: basename(current) })
      return // a repo's submodules are not separate work items here
    }

    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      walk(join(current, e.name), depth + 1)
    }
  }
}

// One row per repo for `work repos` — deliberately local-only and fast, so it
// stays usable across 60 repos without hitting any API.
export function describeRepo(path) {
  const { front, file } = readRepoFile(path)
  let profileName = null
  let gitEmail = null
  let mismatch = false

  try {
    const r = resolveRepo(path, { required: false })
    profileName = r.profile?.name ?? null
    gitEmail = git(['config', 'user.email'], { cwd: path, allowFail: true })
    mismatch = Boolean(r.profile?.GIT_EMAIL && gitEmail && r.profile.GIT_EMAIL !== gitEmail)
    return {
      path,
      name: basename(path),
      branch: currentBranch(path),
      dirty: isDirty(path),
      profile: profileName,
      tracker: r.tracker,
      ticketKey: r.ticketKey,
      configured: Boolean(file),
      gitEmail,
      identityMismatch: mismatch,
    }
  } catch {
    return {
      path,
      name: basename(path),
      branch: currentBranch(path),
      dirty: isDirty(path),
      profile: null,
      tracker: front.tracker ?? null,
      ticketKey: null,
      configured: Boolean(file),
      gitEmail: git(['config', 'user.email'], { cwd: path, allowFail: true }),
      identityMismatch: false,
    }
  }
}

export const REPO_TEMPLATE = `---
# Machine config — overrides the account profile for this repo only.
profile: {{PROFILE}}
tracker: {{TRACKER}}          # jira | clickup
project_keys: [{{KEYS}}]
forge: {{FORGE}}              # bitbucket | github (omit to detect from origin)
base_branch: {{BASE}}
doc_space:                    # Confluence space key for \`work doc\`
---

# {{NAME}}

## What this is

_One paragraph. What it does and who consumes it._

## Where the real docs are

_If this repo already has AGENTS.md, CLAUDE.md, or a docs/ tree, link them here and
stop. Duplicated guidance rots at different rates and the copies start
contradicting each other — a map is worth more than a second copy._

## Layout

_The three or four paths worth knowing before touching anything._

## How to run

\`\`\`bash
\`\`\`

## Ticket and branch conventions

_Anything this repo does differently from the account default._

## Gotchas

_What has cost you an hour before. This section is the reason the file exists._
`
