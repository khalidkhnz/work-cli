// ClickUp adapter (API v2).
//
// Two structural differences from Jira shape the code here:
//
//   1. Tasks have a native id (`86abc123`) and an optional human "custom id"
//      (`ABC-123`). Only the custom id survives in a branch name, and using it
//      requires custom_task_ids=true plus team_id on every call.
//   2. There is no transition graph. A task's legal statuses are simply the
//      statuses of the list it sits in, and you set one by PUTting `status`.

import { api } from '../http.mjs'
import { need } from '../config.mjs'
import { assertClean } from '../scrub.mjs'

export const name = 'clickup'

const BASE = 'https://api.clickup.com/api/v2'

// Custom ids look like Jira keys; native ids are lowercase alphanumeric.
const isCustomId = (key) => /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key)

export const keyPattern = (projectKeys = []) =>
  projectKeys.length ? `(${projectKeys.map((k) => k.toUpperCase()).join('|')})-\\d+` : '[A-Z][A-Z0-9]+-\\d+'

function ctx(cfg) {
  const p = cfg.profile
  need(p, ['CLICKUP_TOKEN'], 'ClickUp access')
  // Personal tokens go in Authorization verbatim — no "Bearer" prefix.
  return { auth: p.CLICKUP_TOKEN, teamId: p.CLICKUP_TEAM_ID ?? null }
}

async function teamId(cfg) {
  const { auth, teamId: configured } = ctx(cfg)
  if (configured) return String(configured)
  const res = await api(`${BASE}/team`, { auth })
  const team = res.teams?.[0]
  if (!team) throw new Error('No ClickUp workspace visible to this token. Set CLICKUP_TEAM_ID in the profile.')
  if ((res.teams ?? []).length > 1) {
    // Ambiguity here silently targets the wrong workspace, so make it loud.
    throw new Error(
      `This token can see ${res.teams.length} ClickUp workspaces. Set CLICKUP_TEAM_ID in the profile to pick one:\n` +
        res.teams.map((t) => `  ${t.id}  ${t.name}`).join('\n')
    )
  }
  return String(team.id)
}

// Every task-scoped call needs the same id-mode suffix.
async function taskQuery(cfg, key, extra = {}) {
  const params = new URLSearchParams(extra)
  if (isCustomId(key)) {
    params.set('custom_task_ids', 'true')
    params.set('team_id', await teamId(cfg))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function normalizeStatus(s) {
  return String(s ?? '').trim().toLowerCase()
}

function mapTask(task) {
  const tags = (task.tags ?? []).map((t) => t.name)
  // ClickUp has no issue type; tags are what teams actually use for it, and the
  // branch prefix is the only thing downstream cares about.
  const type = tags.some((t) => /bug|defect|hotfix/i.test(t))
    ? 'Bug'
    : tags.some((t) => /spike|research/i.test(t))
      ? 'Spike'
      : tags.some((t) => /chore|refactor|debt/i.test(t))
        ? 'Chore'
        : 'Task'

  return {
    key: task.custom_id || task.id,
    id: task.id,
    url: task.url,
    summary: task.name,
    type,
    status: task.status?.status ?? null,
    statusCategory: task.status?.type ?? null,
    priority: task.priority?.priority ?? null,
    assignee: task.assignees?.[0]?.username ?? null,
    reporter: task.creator?.username ?? null,
    labels: tags,
    components: [],
    fixVersions: [],
    parent: task.parent ? { key: task.parent, summary: null } : null,
    subtasks: (task.subtasks ?? []).map((s) => ({ key: s.custom_id || s.id, summary: s.name, status: s.status?.status })),
    links: (task.linked_tasks ?? []).map((l) => ({ type: 'relates to', key: l.task_id, summary: null })),
    created: task.date_created ? new Date(Number(task.date_created)).toISOString() : null,
    updated: task.date_updated ? new Date(Number(task.date_updated)).toISOString() : null,
    duedate: task.due_date ? new Date(Number(task.due_date)).toISOString().slice(0, 10) : null,
    description: (task.markdown_description || task.description || '').trim(),
    listId: task.list?.id ?? null,
    comments: [],
  }
}

export async function getIssue(cfg, key) {
  const { auth } = ctx(cfg)
  const qs = await taskQuery(cfg, key, { include_subtasks: 'true', include_markdown_description: 'true' })
  const task = await api(`${BASE}/task/${encodeURIComponent(key)}${qs}`, { auth })
  const issue = mapTask(task)

  try {
    const cs = await api(`${BASE}/task/${encodeURIComponent(key)}/comment${await taskQuery(cfg, key)}`, { auth })
    issue.comments = (cs.comments ?? []).slice(-10).map((c) => ({
      author: c.user?.username ?? null,
      created: c.date ? new Date(Number(c.date)).toISOString() : null,
      body: (c.comment_text ?? '').trim(),
    }))
  } catch {
    // Comments are supplementary; a task that reads fine without them still reads fine.
  }

  return issue
}

export async function addComment(cfg, key, markdown) {
  assertClean(markdown, 'ClickUp comment')
  const { auth } = ctx(cfg)
  const qs = await taskQuery(cfg, key)
  const res = await api(`${BASE}/task/${encodeURIComponent(key)}/comment${qs}`, {
    method: 'POST',
    auth,
    body: { comment_text: markdown, notify_all: false },
  })
  const task = await getIssue(cfg, key)
  return { id: res.id, url: task.url }
}

export async function getTransitions(cfg, key) {
  const { auth } = ctx(cfg)
  const task = await getIssue(cfg, key)
  if (!task.listId) return []
  const list = await api(`${BASE}/list/${task.listId}`, { auth })
  return (list.statuses ?? []).map((s) => ({ id: s.id ?? s.status, name: s.status, to: s.status }))
}

export async function transition(cfg, key, target) {
  const { auth } = ctx(cfg)
  const options = await getTransitions(cfg, key)
  const wanted = normalizeStatus(target)

  const match =
    options.find((o) => normalizeStatus(o.name) === wanted) ??
    options.find((o) => normalizeStatus(o.name).includes(wanted))

  if (!match) {
    throw new Error(
      `No status matching "${target}" on ${key}.\nAvailable: ${options.map((o) => o.name).join(', ') || '(none — check the token can read the list)'}`
    )
  }

  const qs = await taskQuery(cfg, key)
  await api(`${BASE}/task/${encodeURIComponent(key)}${qs}`, { method: 'PUT', auth, body: { status: match.name } })
  return { name: match.name, to: match.name }
}

export async function worklog(cfg, key, time, comment) {
  const { auth } = ctx(cfg)
  const team = await teamId(cfg)
  const task = await getIssue(cfg, key)

  const ms = parseDuration(time)
  if (!ms) throw new Error(`Could not read "${time}" as a duration. Use forms like 90m, 2h, 1h30m, 1d.`)
  if (comment) assertClean(comment, 'Worklog comment')

  return api(`${BASE}/team/${team}/time_entries`, {
    method: 'POST',
    auth,
    body: { tid: task.id, duration: ms, description: comment ?? '', start: Date.now() - ms },
  })
}

function parseDuration(text) {
  const m = String(text).match(/^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/i)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  const [, d, h, min] = m
  return ((Number(d ?? 0) * 8 + Number(h ?? 0)) * 60 + Number(min ?? 0)) * 60 * 1000
}

// ClickUp has no remote-link concept, so a link becomes a comment. Saying so
// beats silently doing nothing on a command the user expects to link something.
export async function addLink(cfg, key, { url, title }) {
  return addComment(cfg, key, `${title ?? 'Link'}: ${url}`)
}

export async function whoami(cfg) {
  const { auth } = ctx(cfg)
  const res = await api(`${BASE}/user`, { auth })
  return { name: res.user?.username ?? null, email: res.user?.email ?? null, id: res.user?.id ?? null }
}

export async function search(cfg, { limit = 25, status = null } = {}) {
  const { auth } = ctx(cfg)
  const team = await teamId(cfg)
  const me = await whoami(cfg)

  const params = new URLSearchParams({ page: '0', subtasks: 'true', include_closed: 'false' })
  if (me.id) params.append('assignees[]', String(me.id))
  if (status) params.append('statuses[]', status)

  const res = await api(`${BASE}/team/${team}/task?${params}`, { auth })
  const issues = (res.tasks ?? []).slice(0, limit).map((t) => {
    const i = mapTask(t)
    return { key: i.key, url: i.url, summary: i.summary, status: i.status, type: i.type, priority: i.priority, assignee: i.assignee, updated: i.updated }
  })

  return { query: `assignee=${me.name}${status ? ` status=${status}` : ' (open)'}`, issues }
}
