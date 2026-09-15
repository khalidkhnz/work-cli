// Tracker dispatch. Every command talks to this shape and never to a vendor
// directly, so adding Linear or GitHub Issues means one new file here plus a
// line in TRACKERS — not a change to any command.
//
// The contract an adapter must satisfy:
//
//   keyPattern(projectKeys) -> string      regex source for finding keys in branches
//   getIssue(cfg, key)      -> Issue
//   search(cfg, opts)       -> { query, issues }
//   addComment(cfg, key, md)-> { url }
//   getTransitions(cfg,key) -> [{ name, to }]
//   transition(cfg,key,to)  -> { name, to }
//   worklog(cfg,key,t,note) -> any
//   addLink(cfg,key,link)   -> any
//   whoami(cfg)             -> { name, email, id }

import * as jira from './jira.mjs'
import * as clickup from './clickup.mjs'

export const TRACKERS = { jira, clickup }

export function getTracker(cfg) {
  const name = String(cfg?.tracker ?? 'jira').toLowerCase()
  const tracker = TRACKERS[name]
  if (!tracker) {
    throw new Error(
      `Unknown tracker "${name}". Supported: ${Object.keys(TRACKERS).join(', ')}.\n` +
        `Set it in the repo's .work.md frontmatter (tracker: clickup) or as TRACKER= in the profile.`
    )
  }
  return tracker
}

export function trackerNames() {
  return Object.keys(TRACKERS)
}
