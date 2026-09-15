// Atlassian without a PAT.
//
// A profile reaches Atlassian one of two ways: a REST API token, or — when the
// caller is an agent that already has the Atlassian MCP server connected — the
// tools that server exposes. MCP mode is not a transport this process can
// drive. Those tools live in the agent's session, not here, and no amount of
// config would let `work ticket` make the call itself.
//
// So in MCP mode every Atlassian call stops and hands the caller the exact tool
// invocation to make instead. The handoff IS the feature. "Use the MCP" would
// cost the agent a round trip to work out the tool name and the argument shape;
// naming both, with the cloudId already filled in, means it can act on the
// first read. For a human at a terminal the same text reads as an explanation
// of why nothing happened and what will happen next.

export const MCP_PREFIX = 'mcp__claude_ai_Atlassian__'

export class McpHandoff extends Error {
  constructor({ tool, args, why, site, then = null }) {
    const rendered =
      `${why}\n\n` +
      `Make this call instead:\n\n` +
      `  tool  ${MCP_PREFIX}${tool}\n` +
      `  args  ${JSON.stringify(args)}\n\n` +
      (then ? `Then: ${then}\n\n` : '') +
      `Site ${site}. This is not a failure — the profile is configured for MCP\n` +
      `access on purpose, so that no Atlassian API token has to be stored on disk.`
    super(rendered)
    this.name = 'McpHandoff'
    this.handoff = { via: 'mcp', tool: `${MCP_PREFIX}${tool}`, args, site, then }
  }
}

// 'token' — REST, credentials in the profile
// 'mcp'   — the agent's Atlassian MCP server
// 'none'  — no route configured; the caller should say so plainly
export function atlassianVia(profile) {
  const declared = String(profile?.ATLASSIAN_VIA ?? '').trim().toLowerCase()
  if (declared === 'mcp') return 'mcp'
  if (profile?.ATLASSIAN_API_TOKEN) return 'token'
  if (declared === 'token') return 'token'
  return 'none'
}

// The cloudId is what every Atlassian MCP tool takes as its first argument.
// A profile in MCP mode without one is misconfigured in a way that would
// otherwise only surface as a confusing tool error several steps later.
export function cloudId(profile) {
  const id = profile?.ATLASSIAN_CLOUD_ID?.trim()
  if (id) return id
  const site = profile?.ATLASSIAN_SITE?.replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (site) return site // the MCP tools accept a site hostname in place of the UUID
  throw new Error(
    `Profile "${profile?.name}" is in MCP mode but sets neither ATLASSIAN_CLOUD_ID nor ATLASSIAN_SITE.\n` +
      `Every Atlassian MCP tool needs one of them. Add it to ${profile?.file}.`
  )
}

export function siteUrl(profile) {
  const site = profile?.ATLASSIAN_SITE?.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return site ? `https://${site}` : '(no ATLASSIAN_SITE set)'
}

// Called at the top of every Atlassian operation. In token mode it returns and
// the REST path runs; in MCP mode it throws the handoff and the REST path is
// never reached.
export function guard(profile, tool, args, what, { scoped = true, then = null } = {}) {
  if (atlassianVia(profile) !== 'mcp') return
  throw new McpHandoff({
    tool,
    // A few tools (atlassianUserInfo) are account-scoped rather than site-scoped
    // and reject an unexpected cloudId outright.
    args: scoped ? { cloudId: cloudId(profile), ...args } : { ...args },
    why: `${what} over REST is not available to this profile: it reaches Atlassian through the Claude Atlassian MCP server, and holds no API token.`,
    site: siteUrl(profile),
    then,
  })
}
