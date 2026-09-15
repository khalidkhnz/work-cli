import { execFileSync } from 'node:child_process'

export function git(args, { cwd = process.cwd(), allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    if (allowFail) return null
    const stderr = (e.stderr ?? '').toString().trim()
    throw new Error(`git ${args.join(' ')} failed: ${stderr || e.message}`)
  }
}

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd, allowFail: true })
}

export function currentBranch(cwd = process.cwd()) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, allowFail: true })
}

export function isDirty(cwd = process.cwd()) {
  return Boolean(git(['status', '--porcelain'], { cwd, allowFail: true }))
}

export function remoteUrl(cwd = process.cwd()) {
  return git(['remote', 'get-url', 'origin'], { cwd, allowFail: true })
}

// Parse origin into {host, workspace, repo}. Handles https, ssh, and the
// https://user@bitbucket.org/... form git writes after a browser clone.
export function parseRemote(url) {
  if (!url) return null
  const cleaned = url.replace(/\.git$/, '')

  let m = cleaned.match(/^git@([^:]+):(.+)$/)
  if (m) return split(m[1], m[2])

  m = cleaned.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/)
  if (m) return split(m[1], m[2])

  m = cleaned.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/)
  if (m) return split(m[1], m[2])

  return null

  function split(host, path) {
    const parts = path.split('/').filter(Boolean)
    const repo = parts.pop()
    return { host, workspace: parts.join('/'), repo, forge: host.includes('bitbucket') ? 'bitbucket' : host.includes('github') ? 'github' : 'unknown' }
  }
}

export function defaultBaseBranch(cwd = process.cwd(), fallback = 'main') {
  const head = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd, allowFail: true })
  if (head) return head.split('/').pop()
  for (const b of ['main', 'master', 'develop']) {
    if (git(['rev-parse', '--verify', `origin/${b}`], { cwd, allowFail: true })) return b
  }
  return fallback
}

export function slug(text, max = 48) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
}

// Map a Jira issue type onto the branch prefix the team already uses.
export function branchPrefix(issueType, statusHint = '') {
  const t = `${issueType ?? ''} ${statusHint}`.toLowerCase()
  if (/bug|defect|hotfix/.test(t)) return 'fix'
  if (/spike|research|investigat/.test(t)) return 'spike'
  if (/chore|task|tech debt|refactor/.test(t)) return 'chore'
  return 'feature'
}

export function commitsSince(base, cwd = process.cwd()) {
  const out = git(['log', `${base}..HEAD`, '--pretty=format:%h%x09%s'], { cwd, allowFail: true })
  if (!out) return []
  return out.split('\n').map((l) => {
    const [sha, ...rest] = l.split('\t')
    return { sha, subject: rest.join('\t') }
  })
}

export function diffStat(base, cwd = process.cwd()) {
  return git(['diff', '--stat', `${base}...HEAD`], { cwd, allowFail: true }) ?? ''
}

export function changedFiles(base, cwd = process.cwd()) {
  const out = git(['diff', '--name-status', `${base}...HEAD`], { cwd, allowFail: true })
  return out ? out.split('\n').filter(Boolean) : []
}

// Pull the ticket key out of a branch name like feature/STR-3350-i18n-messages.
export function keyFromBranch(branch, projectKeys = []) {
  if (!branch) return null
  const keys = projectKeys.filter(Boolean).map((k) => k.toUpperCase())
  const pattern = keys.length ? `(${keys.join('|')})-\\d+` : '[A-Z][A-Z0-9]+-\\d+'
  const m = branch.toUpperCase().match(new RegExp(pattern))
  return m ? m[0] : null
}
