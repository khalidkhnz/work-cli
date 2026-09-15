import { api, basicAuth } from './http.mjs'
import { markdownToStorage } from './markup.mjs'
import { need } from './config.mjs'
import { assertClean } from './scrub.mjs'
import { guard, MCP_PREFIX } from './mcp.mjs'

function ctx(profile) {
  need(profile, ['ATLASSIAN_SITE', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN'], 'Confluence access')
  const site = profile.ATLASSIAN_SITE.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return {
    v2: `https://${site}/wiki/api/v2`,
    v1: `https://${site}/wiki/rest/api`,
    site: `https://${site}`,
    auth: basicAuth(profile.ATLASSIAN_EMAIL, profile.ATLASSIAN_API_TOKEN),
  }
}

export async function listSpaces(profile) {
  guard(profile, 'getConfluenceSpaces', { limit: 100 }, 'Listing Confluence spaces')
  const { v2, auth } = ctx(profile)
  const res = await api(`${v2}/spaces?limit=100`, { auth })
  return (res.results ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name, type: s.type }))
}

async function spaceIdForKey(profile, key) {
  const { v2, auth } = ctx(profile)
  const res = await api(`${v2}/spaces?keys=${encodeURIComponent(key)}`, { auth })
  const space = res.results?.[0]
  if (!space) throw new Error(`Confluence space "${key}" not found or not visible to this account.`)
  return space.id
}

export async function findPageByTitle(profile, spaceKey, title) {
  const cql = `space="${spaceKey}" and title="${title.replace(/"/g, '\\"')}" and type=page`
  guard(profile, 'searchConfluenceUsingCql', { cql, limit: 1 }, `Looking for "${title}" in ${spaceKey}`)
  const { v1, auth } = ctx(profile)
  const res = await api(`${v1}/content/search?cql=${encodeURIComponent(cql)}&limit=1&expand=version`, { auth })
  const page = res.results?.[0]
  return page ? { id: page.id, title: page.title, version: page.version?.number ?? 1 } : null
}

export async function createPage(profile, { spaceKey, title, markdown, parentId }) {
  assertClean(markdown, 'Confluence page body')
  assertClean(title, 'Confluence page title')
  // The MCP tool takes markdown directly and resolves a space key to its
  // numeric id, so the handoff can carry the finished body as-is — no storage
  // format conversion, which is the one thing this CLI would have added.
  guard(
    profile,
    'createConfluencePage',
    { spaceId: spaceKey, title, body: markdown, contentFormat: 'markdown', ...(parentId ? { parentId: String(parentId) } : {}) },
    `Creating "${title}" in ${spaceKey}`
  )
  const { v2, site, auth } = ctx(profile)
  const spaceId = await spaceIdForKey(profile, spaceKey)

  const res = await api(`${v2}/pages`, {
    method: 'POST',
    auth,
    body: {
      spaceId,
      status: 'current',
      title,
      ...(parentId ? { parentId: String(parentId) } : {}),
      body: { representation: 'storage', value: markdownToStorage(markdown) },
    },
  })

  return { id: res.id, title: res.title, url: `${site}/wiki${res._links?.webui ?? ''}` }
}

export async function updatePage(profile, { id, title, markdown, version }) {
  assertClean(markdown, 'Confluence page body')
  // No version number in the MCP call — the server reads the current version
  // and increments it, which also removes this path's lost-update window.
  guard(
    profile,
    'updateConfluencePage',
    { pageId: String(id), title, body: markdown, contentFormat: 'markdown', versionMessage: 'Updated from the repo' },
    `Updating page ${id}`
  )
  const { v2, site, auth } = ctx(profile)

  const res = await api(`${v2}/pages/${id}`, {
    method: 'PUT',
    auth,
    body: {
      id: String(id),
      status: 'current',
      title,
      body: { representation: 'storage', value: markdownToStorage(markdown) },
      version: { number: version + 1, message: 'Updated from the repo' },
    },
  })

  return { id: res.id, title: res.title, url: `${site}/wiki${res._links?.webui ?? ''}` }
}

// Create-or-update by title, so re-running a doc command is idempotent instead
// of littering the space with duplicates.
export async function upsertPage(profile, { spaceKey, title, markdown, parentId }) {
  // `work doc` enters here, so this is the handoff that matters most. Describe
  // the whole create-or-update decision up front — an agent handed only the
  // search would have to rediscover what to do with the result.
  assertClean(markdown, 'Confluence page body')
  assertClean(title, 'Confluence page title')
  guard(
    profile,
    'searchConfluenceUsingCql',
    { cql: `space="${spaceKey}" and title="${title.replace(/"/g, '\\"')}" and type=page`, limit: 1 },
    `Publishing "${title}" to ${spaceKey}`,
    {
      then:
        `if it returns a page, call ${MCP_PREFIX}updateConfluencePage with that page's id ` +
        `({"pageId":"<id>","title":"${title}","body":<the markdown below>,"contentFormat":"markdown"}); ` +
        `if it returns nothing, call ${MCP_PREFIX}createConfluencePage with ` +
        `{"spaceId":"${spaceKey}","title":"${title}","body":<the markdown below>,"contentFormat":"markdown"` +
        `${parentId ? `,"parentId":"${parentId}"` : ''}}. ` +
        `Get the markdown by re-running this command without --yes, which prints the rendered body.`,
    }
  )
  const existing = await findPageByTitle(profile, spaceKey, title)
  if (existing) {
    const page = await updatePage(profile, { id: existing.id, title, markdown, version: existing.version })
    return { ...page, action: 'updated' }
  }
  const page = await createPage(profile, { spaceKey, title, markdown, parentId })
  return { ...page, action: 'created' }
}
