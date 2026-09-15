// Bitbucket Cloud adapter. Basic auth with email + API token — app passwords
// were removed in July 2026, and username-based Basic auth went with them.

import { api, basicAuth } from '../http.mjs'
import { need } from '../config.mjs'
import { assertClean } from '../scrub.mjs'

export const name = 'bitbucket'

const BASE = 'https://api.bitbucket.org/2.0'

function ctx(profile) {
  need(profile, ['BITBUCKET_EMAIL', 'BITBUCKET_TOKEN'], 'Bitbucket access')
  return { auth: basicAuth(profile.BITBUCKET_EMAIL, profile.BITBUCKET_TOKEN) }
}

export async function createPullRequest(profile, { title, body, source, target, remote, close = true }) {
  assertClean(title, 'Pull request title')
  assertClean(body, 'Pull request description')

  const { auth } = ctx(profile)
  const workspace = profile.BITBUCKET_WORKSPACE || remote.workspace

  const existing = await api(
    `${BASE}/repositories/${workspace}/${remote.repo}/pullrequests?q=${encodeURIComponent(`source.branch.name="${source}" AND state="OPEN"`)}`,
    { auth }
  )
  if (existing.values?.length) {
    const pr = existing.values[0]
    return { url: pr.links?.html?.href, id: pr.id, forge: 'bitbucket', existing: true }
  }

  const res = await api(`${BASE}/repositories/${workspace}/${remote.repo}/pullrequests`, {
    method: 'POST',
    auth,
    body: {
      title,
      description: body,
      source: { branch: { name: source } },
      destination: { branch: { name: target } },
      close_source_branch: close,
    },
  })

  return { url: res.links?.html?.href, id: res.id, forge: 'bitbucket' }
}

export async function listPullRequests(profile, { remote, state = 'OPEN' }) {
  const { auth } = ctx(profile)
  const workspace = profile.BITBUCKET_WORKSPACE || remote.workspace
  const res = await api(`${BASE}/repositories/${workspace}/${remote.repo}/pullrequests?state=${state}&pagelen=25`, { auth })
  return (res.values ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    url: p.links?.html?.href,
    branch: p.source?.branch?.name,
    author: p.author?.display_name,
  }))
}

export async function whoami(profile) {
  const { auth } = ctx(profile)
  const me = await api(`${BASE}/user`, { auth })
  return { name: me.display_name, login: me.username ?? me.nickname, via: 'token' }
}
