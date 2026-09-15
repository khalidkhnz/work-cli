// Forge dispatch. The forge is normally detected from `origin`, so a repo that
// moves from Bitbucket to GitHub needs no config change; `.work.md` can pin it
// with `forge:` when the remote is a mirror or the detection is wrong.

import * as bitbucket from './bitbucket.mjs'
import * as github from './github.mjs'
import { parseRemote, remoteUrl } from '../git.mjs'

export const FORGES = { bitbucket, github }

export function detectRemote(cwd = process.cwd()) {
  const url = remoteUrl(cwd)
  if (!url) throw new Error(`No git remote "origin" in ${cwd} — cannot open a pull request.`)
  const parsed = parseRemote(url)
  if (!parsed) throw new Error(`Could not parse the origin URL: ${url}`)
  return parsed
}

export function getForge(cfg, cwd = process.cwd()) {
  const remote = detectRemote(cwd)
  const chosen = cfg?.forge ?? remote.forge

  const forge = FORGES[chosen]
  if (!forge) {
    throw new Error(
      `Unsupported git host "${remote.host}" (resolved to "${chosen}"). Supported: ${Object.keys(FORGES).join(', ')}.\n` +
        `Pin it in .work.md with  forge: github  if the remote is a mirror.`
    )
  }
  return { forge, remote }
}

export async function createPullRequest(cfg, opts) {
  const { forge, remote } = getForge(cfg, opts.cwd)
  return forge.createPullRequest(cfg.profile, { ...opts, remote })
}

export async function listPullRequests(cfg, opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const { forge, remote } = getForge(cfg, cwd)
  return forge.listPullRequests(cfg.profile, { ...opts, remote, cwd })
}

export async function whoami(cfg, cwd = process.cwd()) {
  const { forge } = getForge(cfg, cwd)
  return { forge: forge.name, ...(await forge.whoami(cfg.profile)) }
}
