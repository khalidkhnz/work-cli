// Thin fetch wrapper with Atlassian-style Basic auth and useful error messages.
// Atlassian Cloud (Jira, Confluence, and Bitbucket since the 2025 app-password
// deprecation) all authenticate as base64(email:api_token).

export function basicAuth(email, token) {
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
}

export async function api(url, { method = 'GET', auth, body, headers = {}, raw = false } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(formatError(res, url, method, text))
  }
  if (raw) return text
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function formatError(res, url, method, text) {
  let detail = text.slice(0, 800)
  try {
    const j = JSON.parse(text)
    const msgs = j.errorMessages ?? j.errors ?? j.message ?? j.error?.message ?? j.error
    if (msgs) detail = typeof msgs === 'string' ? msgs : JSON.stringify(msgs)
  } catch {
    /* keep raw body */
  }

  // Atlassian API tokens are scoped at creation time, and a Jira-scoped token
  // fails against Bitbucket with a message that reads like bad credentials.
  const noScopes = /no Bitbucket scopes/i.test(text)

  const hint = noScopes
    ? '\nHint: this token works for Jira/Confluence but was created without Bitbucket scopes.' +
      '\n      Mint a second token at https://id.atlassian.com/manage-profile/security/api-tokens' +
      '\n      selecting the Bitbucket scopes (read/write repository and pull requests), then set' +
      '\n      BITBUCKET_TOKEN to it — a token cannot be re-scoped after creation.'
    : res.status === 401
      ? '\nHint: token rejected. Atlassian and Bitbucket both need email + API token (app passwords stopped working in 2026).'
      : res.status === 403
        ? '\nHint: authenticated but not permitted. Check the token scopes for this site.'
        : res.status === 404
          ? '\nHint: not found. Wrong site, key, or the account lacks visibility on it.'
          : ''

  return `${method} ${url}\n${res.status} ${res.statusText}: ${detail}${hint}`
}
