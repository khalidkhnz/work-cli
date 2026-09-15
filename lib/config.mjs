// Profile resolution: which account do we act as, given a working directory?
//
// Precedence (first hit wins):
//   1. WORK_PROFILE env var
//   2. .workprofile file in the repo root (or any ancestor dir)
//   3. longest-prefix route match in config.json
//   4. defaultProfile in config.json

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'

export const CONFIG_DIR = process.env.WORK_CONFIG_DIR || join(homedir(), '.claude', 'dev-workflow')
export const PROFILE_DIR = join(CONFIG_DIR, 'profiles')
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export function readConfig() {
  if (!existsSync(CONFIG_FILE)) return { defaultProfile: null, routes: [] }
  try {
    const c = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    return { defaultProfile: c.defaultProfile ?? null, routes: c.routes ?? [] }
  } catch (e) {
    throw new Error(`config.json is not valid JSON (${CONFIG_FILE}): ${e.message}`)
  }
}

export function writeConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
}

export function listProfiles() {
  if (!existsSync(PROFILE_DIR)) return []
  return readdirSync(PROFILE_DIR)
    .filter((f) => f.endsWith('.env'))
    .map((f) => f.replace(/\.env$/, ''))
    .sort()
}

// Minimal .env parser. Deliberately does NOT support `;` comments — only `#` —
// because a `;` mid-value is legitimate in tokens and URLs.
function parseEnv(text) {
  const out = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
      (val.startsWith("'") && val.endsWith("'") && val.length > 1)
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

// Walk up from `dir` looking for a marker file, stopping at the filesystem root.
function findUp(dir, name) {
  let cur = resolve(dir)
  for (;;) {
    const candidate = join(cur, name)
    if (existsSync(candidate)) return candidate
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

export function resolveProfileName(cwd = process.cwd()) {
  if (process.env.WORK_PROFILE) {
    return { name: process.env.WORK_PROFILE, via: 'WORK_PROFILE env var' }
  }

  const marker = findUp(cwd, '.workprofile')
  if (marker) {
    const name = readFileSync(marker, 'utf8').trim()
    if (name) return { name, via: marker }
  }

  const cfg = readConfig()
  const here = resolve(cwd)
  let best = null
  for (const route of cfg.routes) {
    if (!route?.match || !route?.profile) continue
    const prefix = resolve(route.match.replace(/^~/, homedir()))
    if (here === prefix || here.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) {
      if (!best || prefix.length > best.prefix.length) {
        best = { prefix, profile: route.profile }
      }
    }
  }
  if (best) return { name: best.profile, via: `route ${best.prefix}` }

  if (cfg.defaultProfile) return { name: cfg.defaultProfile, via: 'defaultProfile' }
  return { name: null, via: 'no match' }
}

export function loadProfile(cwd = process.cwd(), { required = true } = {}) {
  const { name, via } = resolveProfileName(cwd)
  if (!name) {
    if (!required) return null
    throw new Error(
      `No profile applies to ${cwd}.\n` +
        `Run:  work setup            (create your first profile)\n` +
        `  or: work route <profile>  (map this directory to an existing one)\n` +
        `Existing profiles: ${listProfiles().join(', ') || '(none)'}`
    )
  }
  const file = join(PROFILE_DIR, `${name}.env`)
  if (!existsSync(file)) {
    if (!required) return null
    throw new Error(
      `Profile "${name}" (selected via ${via}) has no file at ${file}.\n` +
        `Existing profiles: ${listProfiles().join(', ') || '(none)'}`
    )
  }
  const vars = parseEnv(readFileSync(file, 'utf8'))
  return { name, via, file, ...vars }
}

// Fail loudly and specifically when a profile is missing a field a command needs.
export function need(profile, keys, forWhat) {
  const missing = keys.filter((k) => !profile[k])
  if (missing.length) {
    throw new Error(
      `Profile "${profile.name}" is missing ${missing.join(', ')} — required for ${forWhat}.\n` +
        `Edit ${profile.file} or run: work setup --profile ${profile.name}`
    )
  }
}
