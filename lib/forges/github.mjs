// GitHub adapter.
//
// Prefers a per-profile GITHUB_TOKEN over the `gh` CLI. That is the whole point
// in a multi-account setup: `gh` holds one active account per host, so relying
// on it would silently open a PR as whichever account you last switched to.
// `gh` remains the fallback for profiles that have no token.

import { execFileSync } from 'node:child_process'
import { api } from '../http.mjs'
import { assertClean } from '../scrub.mjs'

export const name = 'github'

const BASE = 'https://api.github.com'

function token(profile) {
  return profile?.GITHUB_TOKEN || null
}

function ghHeaders() {
  return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
}

function hasGh() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export async function createPullRequest(profile, { title, body, source, target, remote, cwd, draft = false }) {
  assertClean(title, 'Pull request title')
  assertClean(body, 'Pull request description')

  const tok = token(profile)
  const owner = profile?.GITHUB_OWNER || remote.workspace

  if (tok) {
    const existing = await api(
      `${BASE}/repos/${owner}/${remote.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${source}`)}`,
      { auth: `Bearer ${tok}`, headers: ghHeaders() }
    )
    if (existing?.length) return { url: existing[0].html_url, id: existing[0].number, forge: 'github', existing: true }

    const res = await api(`${BASE}/repos/${owner}/${remote.repo}/pulls`, {
      method: 'POST',
      auth: `Bearer ${tok}`,
      headers: ghHeaders(),
      body: { title, body, head: source, base: target, draft },
    })
    return { url: res.html_url, id: res.number, forge: 'github' }
  }

  if (!hasGh()) {
    throw new Error(
      'No GITHUB_TOKEN in this profile and `gh` is not installed.\n' +
        'Add GITHUB_TOKEN to the profile (a fine-grained PAT with Pull requests: write), or install gh.'
    )
  }

  const args = ['pr', 'create', '--title', title, '--body', body, '--base', target, '--head', source]
  if (draft) args.push('--draft')
  const outText = execFileSync('gh', args, { cwd, encoding: 'utf8' }).trim()
  return { url: outText.split('\n').find((l) => l.startsWith('http')) ?? outText, forge: 'github', via: 'gh' }
}

export async function listPullRequests(profile, { remote, cwd }) {
  const tok = token(profile)
  const owner = profile?.GITHUB_OWNER || remote.workspace

  if (tok) {
    const res = await api(`${BASE}/repos/${owner}/${remote.repo}/pulls?state=open&per_page=25`, {
      auth: `Bearer ${tok}`,
      headers: ghHeaders(),
    })
    return (res ?? []).map((p) => ({ id: p.number, title: p.title, url: p.html_url, branch: p.head?.ref, author: p.user?.login }))
  }

  if (!hasGh()) return []
  const outText = execFileSync('gh', ['pr', 'list', '--json', 'number,title,url,headRefName,author'], { cwd, encoding: 'utf8' })
  return JSON.parse(outText).map((p) => ({ id: p.number, title: p.title, url: p.url, branch: p.headRefName, author: p.author?.login }))
}

export async function whoami(profile) {
  const tok = token(profile)
  if (tok) {
    const me = await api(`${BASE}/user`, { auth: `Bearer ${tok}`, headers: ghHeaders() })
    return { name: me.name ?? me.login, login: me.login, via: 'token' }
  }
  if (!hasGh()) throw new Error('No GITHUB_TOKEN and no gh CLI.')
  const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim()
  return { name: login, login, via: 'gh CLI (shared across accounts — set GITHUB_TOKEN to pin this profile)' }
}
