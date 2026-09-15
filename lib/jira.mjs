import { api, basicAuth } from "./http.mjs";
import { markdownToAdf, adfToText } from "./markup.mjs";
import { need } from "./config.mjs";
import { assertClean } from "./scrub.mjs";
import { guard, atlassianVia, cloudId, MCP_PREFIX } from "./mcp.mjs";

function ctx(profile) {
  need(
    profile,
    ["ATLASSIAN_SITE", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN"],
    "Jira access",
  );
  const site = profile.ATLASSIAN_SITE.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  );
  return {
    base: `https://${site}/rest/api/3`,
    browse: (key) => `https://${site}/browse/${key}`,
    auth: basicAuth(profile.ATLASSIAN_EMAIL, profile.ATLASSIAN_API_TOKEN),
  };
}

export async function getIssue(profile, key) {
  guard(
    profile,
    "getJiraIssue",
    { issueIdOrKey: key, fields: ["*all"], responseContentFormat: "markdown" },
    `Reading ${key}`,
  );
  const { base, browse, auth } = ctx(profile);
  const fields = [
    "summary",
    "description",
    "status",
    "issuetype",
    "priority",
    "assignee",
    "reporter",
    "labels",
    "parent",
    "subtasks",
    "issuelinks",
    "created",
    "updated",
    "duedate",
    "fixVersions",
    "components",
    "comment",
  ].join(",");

  const issue = await api(
    `${base}/issue/${encodeURIComponent(key)}?fields=${fields}&expand=renderedFields`,
    { auth },
  );
  const f = issue.fields;

  return {
    key: issue.key,
    url: browse(issue.key),
    summary: f.summary,
    type: f.issuetype?.name,
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.name,
    priority: f.priority?.name,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    labels: f.labels ?? [],
    components: (f.components ?? []).map((c) => c.name),
    fixVersions: (f.fixVersions ?? []).map((v) => v.name),
    parent: f.parent
      ? { key: f.parent.key, summary: f.parent.fields?.summary }
      : null,
    subtasks: (f.subtasks ?? []).map((s) => ({
      key: s.key,
      summary: s.fields?.summary,
      status: s.fields?.status?.name,
    })),
    links: (f.issuelinks ?? [])
      .map((l) => ({
        type: l.type?.outward ?? l.type?.inward,
        key: (l.outwardIssue ?? l.inwardIssue)?.key,
        summary: (l.outwardIssue ?? l.inwardIssue)?.fields?.summary,
      }))
      .filter((l) => l.key),
    created: f.created,
    updated: f.updated,
    duedate: f.duedate,
    description: f.description ? adfToText(f.description).trim() : "",
    comments: (f.comment?.comments ?? []).slice(-10).map((c) => ({
      author: c.author?.displayName,
      created: c.created,
      body: c.body ? adfToText(c.body).trim() : "",
    })),
  };
}

export async function search(profile, jql, { limit = 25 } = {}) {
  guard(
    profile,
    "searchJiraIssuesUsingJql",
    { jql, maxResults: Math.max(50, limit) },
    "Searching Jira",
  );
  const { base, browse, auth } = ctx(profile);
  const res = await api(`${base}/search/jql`, {
    method: "POST",
    auth,
    body: {
      jql,
      maxResults: limit,
      fields: [
        "summary",
        "status",
        "issuetype",
        "priority",
        "updated",
        "assignee",
      ],
    },
  });
  return (res.issues ?? []).map((i) => ({
    key: i.key,
    url: browse(i.key),
    summary: i.fields.summary,
    status: i.fields.status?.name,
    type: i.fields.issuetype?.name,
    priority: i.fields.priority?.name,
    assignee: i.fields.assignee?.displayName ?? null,
    updated: i.fields.updated,
  }));
}

export async function addComment(profile, key, markdown) {
  assertClean(markdown, "Jira comment");
  guard(
    profile,
    "addCommentToJiraIssue",
    { issueIdOrKey: key, commentBody: markdown, contentFormat: "markdown" },
    `Commenting on ${key}`,
  );
  const { base, browse, auth } = ctx(profile);
  const res = await api(`${base}/issue/${encodeURIComponent(key)}/comment`, {
    method: "POST",
    auth,
    body: { body: markdownToAdf(markdown) },
  });
  return { id: res.id, url: `${browse(key)}?focusedCommentId=${res.id}` };
}

export async function getTransitions(profile, key) {
  guard(
    profile,
    "getTransitionsForJiraIssue",
    { issueIdOrKey: key },
    `Listing transitions for ${key}`,
  );
  const { base, auth } = ctx(profile);
  const res = await api(
    `${base}/issue/${encodeURIComponent(key)}/transitions`,
    { auth },
  );
  return (res.transitions ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    to: t.to?.name,
  }));
}

export async function transition(profile, key, target) {
  // Transitioning takes a transition id, not a status name, so over MCP this is
  // two calls: list first, then move. The second is not expressible until the
  // first has returned, so name it rather than pretending to emit it.
  guard(
    profile,
    "getTransitionsForJiraIssue",
    { issueIdOrKey: key },
    `Moving ${key} to "${target}"`,
    {
      then:
        `pick the transition whose name or target status matches "${target}", then call ` +
        `${MCP_PREFIX}transitionJiraIssue with ` +
        `{"cloudId":"<same>","issueIdOrKey":"${key}","transition":{"id":"<that id>"}}.`,
    },
  );
  const { base, auth } = ctx(profile);
  const options = await getTransitions(profile, key);
  const wanted = String(target).toLowerCase();
  const match =
    options.find((t) => t.name.toLowerCase() === wanted) ??
    options.find((t) => t.to?.toLowerCase() === wanted) ??
    options.find((t) => t.name.toLowerCase().includes(wanted)) ??
    options.find((t) => t.id === String(target));

  if (!match) {
    throw new Error(
      `No transition matching "${target}" on ${key}.\nAvailable: ${options.map((t) => `${t.name} -> ${t.to}`).join(", ") || "(none)"}`,
    );
  }

  await api(`${base}/issue/${encodeURIComponent(key)}/transitions`, {
    method: "POST",
    auth,
    body: { transition: { id: match.id } },
  });
  return match;
}

export async function addWorklog(profile, key, timeSpent, comment) {
  guard(
    profile,
    "addWorklogToJiraIssue",
    {
      issueIdOrKey: key,
      timeSpent,
      ...(comment ? { commentBody: comment, contentFormat: "markdown" } : {}),
    },
    `Logging ${timeSpent} against ${key}`,
  );
  const { base, auth } = ctx(profile);
  const body = { timeSpent };
  if (comment) {
    assertClean(comment, "Worklog comment");
    body.comment = markdownToAdf(comment);
  }
  return api(`${base}/issue/${encodeURIComponent(key)}/worklog`, {
    method: "POST",
    auth,
    body,
  });
}

export async function myself(profile) {
  guard(profile, "atlassianUserInfo", {}, "Identifying the Atlassian account", {
    scoped: false,
  });
  const { base, auth } = ctx(profile);
  return api(`${base}/myself`, { auth });
}

// ------------------------------------------------------------------ Create Issue
export async function createIssue(
  profile,
  { project, type, summary, description, priority, labels, parent, assignee },
) {
  guard(
    profile,
    "createJiraIssue",
    { projectKey: project, issueTypeName: type, summary },
    `Creating ${type} in ${project}`,
  );
  const { base, browse, auth } = ctx(profile);

  const fields = {
    project: { key: project },
    issuetype: { name: type },
    summary,
  };

  if (description) fields.description = markdownToAdf(description);
  if (priority) fields.priority = { name: priority };
  if (labels?.length) fields.labels = labels;
  if (parent) fields.parent = { key: parent };
  if (assignee) fields.assignee = { accountId: assignee };

  const res = await api(`${base}/issue`, {
    method: "POST",
    auth,
    body: { fields },
  });
  return { key: res.key, id: res.id, url: browse(res.key) };
}

// ------------------------------------------------------------------ Assign Issue
export async function assignIssue(profile, key, accountId) {
  guard(
    profile,
    "assignJiraIssue",
    { issueIdOrKey: key, accountId },
    `Assigning ${key}`,
  );
  const { base, auth } = ctx(profile);
  await api(`${base}/issue/${encodeURIComponent(key)}/assignee`, {
    method: "PUT",
    auth,
    body: { accountId },
  });
  return { key, assignee: accountId };
}

// ------------------------------------------------------------------ Update Issue
export async function updateIssue(profile, key, fields) {
  guard(
    profile,
    "updateJiraIssue",
    { issueIdOrKey: key, fields },
    `Updating ${key}`,
  );
  const { base, auth } = ctx(profile);

  const update = {};
  if (fields.summary) update.summary = [{ set: fields.summary }];
  if (fields.description)
    update.description = [{ set: markdownToAdf(fields.description) }];
  if (fields.priority) update.priority = [{ set: { name: fields.priority } }];
  if (fields.labels) update.labels = [{ set: fields.labels }];
  if (fields.addLabels)
    update.labels = fields.addLabels.map((l) => ({ add: l }));
  if (fields.removeLabels)
    update.labels = [
      ...(update.labels || []),
      ...fields.removeLabels.map((l) => ({ remove: l })),
    ];

  await api(`${base}/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    auth,
    body: { update },
  });
  return { key, updated: Object.keys(fields) };
}

// ------------------------------------------------------------------ Watchers
export async function getWatchers(profile, key) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/issue/${encodeURIComponent(key)}/watchers`, {
    auth,
  });
  return {
    count: res.watchCount,
    isWatching: res.isWatching,
    watchers: (res.watchers ?? []).map((w) => ({
      accountId: w.accountId,
      name: w.displayName,
    })),
  };
}

export async function addWatcher(profile, key, accountId) {
  const { base, auth } = ctx(profile);
  await api(`${base}/issue/${encodeURIComponent(key)}/watchers`, {
    method: "POST",
    auth,
    body: JSON.stringify(accountId), // Jira expects just the accountId string
    headers: { "Content-Type": "application/json" },
  });
  return { key, added: accountId };
}

export async function removeWatcher(profile, key, accountId) {
  const { base, auth } = ctx(profile);
  await api(
    `${base}/issue/${encodeURIComponent(key)}/watchers?accountId=${encodeURIComponent(accountId)}`,
    {
      method: "DELETE",
      auth,
    },
  );
  return { key, removed: accountId };
}

// ------------------------------------------------------------------ Users Search
export async function searchUsers(profile, query, { limit = 10 } = {}) {
  const { base, auth } = ctx(profile);
  const res = await api(
    `${base}/user/search?query=${encodeURIComponent(query)}&maxResults=${limit}`,
    { auth },
  );
  return (res ?? []).map((u) => ({
    accountId: u.accountId,
    name: u.displayName,
    email: u.emailAddress ?? null,
    active: u.active,
  }));
}

// ------------------------------------------------------------------ Project & Meta
export async function getProjects(profile) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/project/search?maxResults=100`, { auth });
  return (res.values ?? []).map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    lead: p.lead?.displayName,
  }));
}

export async function getIssueTypes(profile, projectKey) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/issue/createmeta/${projectKey}/issuetypes`, {
    auth,
  });
  return (res.issueTypes ?? res.values ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    subtask: t.subtask ?? false,
    description: t.description,
  }));
}

export async function getPriorities(profile) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/priority`, { auth });
  return (res ?? []).map((p) => ({ id: p.id, name: p.name }));
}

// ------------------------------------------------------------------ Sprints & Boards (Agile API)
export async function getBoards(profile, { projectKey, type } = {}) {
  const site = profile.ATLASSIAN_SITE.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  );
  const auth = basicAuth(profile.ATLASSIAN_EMAIL, profile.ATLASSIAN_API_TOKEN);
  let url = `https://${site}/rest/agile/1.0/board?maxResults=50`;
  if (projectKey) url += `&projectKeyOrId=${projectKey}`;
  if (type) url += `&type=${type}`; // scrum, kanban
  const res = await api(url, { auth });
  return (res.values ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    projectKey: b.location?.projectKey,
  }));
}

export async function getSprints(
  profile,
  boardId,
  { state = "active,future" } = {},
) {
  const site = profile.ATLASSIAN_SITE.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  );
  const auth = basicAuth(profile.ATLASSIAN_EMAIL, profile.ATLASSIAN_API_TOKEN);
  const res = await api(
    `https://${site}/rest/agile/1.0/board/${boardId}/sprint?state=${state}&maxResults=20`,
    { auth },
  );
  return (res.values ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    state: s.state,
    startDate: s.startDate,
    endDate: s.endDate,
    goal: s.goal,
  }));
}

export async function getSprintIssues(profile, sprintId, { limit = 50 } = {}) {
  const site = profile.ATLASSIAN_SITE.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  );
  const auth = basicAuth(profile.ATLASSIAN_EMAIL, profile.ATLASSIAN_API_TOKEN);
  const browse = (key) => `https://${site}/browse/${key}`;
  const res = await api(
    `https://${site}/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=${limit}`,
    { auth },
  );
  return (res.issues ?? []).map((i) => ({
    key: i.key,
    url: browse(i.key),
    summary: i.fields.summary,
    status: i.fields.status?.name,
    type: i.fields.issuetype?.name,
    priority: i.fields.priority?.name,
    assignee: i.fields.assignee?.displayName ?? null,
    storyPoints: i.fields.customfield_10016 ?? null, // Common story points field
  }));
}

export async function getBoardBacklog(profile, boardId, { limit = 50 } = {}) {
  const site = profile.ATLASSIAN_SITE.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  );
  const auth = basicAuth(profile.ATLASSIAN_EMAIL, profile.ATLASSIAN_API_TOKEN);
  const browse = (key) => `https://${site}/browse/${key}`;
  const res = await api(
    `https://${site}/rest/agile/1.0/board/${boardId}/backlog?maxResults=${limit}`,
    { auth },
  );
  return (res.issues ?? []).map((i) => ({
    key: i.key,
    url: browse(i.key),
    summary: i.fields.summary,
    status: i.fields.status?.name,
    type: i.fields.issuetype?.name,
    priority: i.fields.priority?.name,
    assignee: i.fields.assignee?.displayName ?? null,
  }));
}

// ------------------------------------------------------------------ Link Issues
export async function linkIssues(profile, inwardKey, outwardKey, linkType) {
  const { base, auth } = ctx(profile);
  await api(`${base}/issueLink`, {
    method: "POST",
    auth,
    body: {
      type: { name: linkType },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    },
  });
  return { inward: inwardKey, outward: outwardKey, type: linkType };
}

export async function getLinkTypes(profile) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/issueLinkType`, { auth });
  return (res.issueLinkTypes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    inward: t.inward,
    outward: t.outward,
  }));
}

// Jira renders a "remote link" as a first-class link on the issue, which is
// what makes a PR show up on the ticket without a Bitbucket/Jira app link.
export async function addRemoteLink(
  profile,
  key,
  { url, title, summary, icon },
) {
  // The Atlassian MCP server exposes no write for remote links — it can read
  // them (getJiraIssueRemoteIssueLinks) and it can link issue to issue
  // (createIssueLink), but attaching an arbitrary URL is REST-only. Say that,
  // and name the substitute, rather than emitting a handoff to a tool that
  // does not exist.
  if (atlassianVia(profile) === "mcp") {
    throw new Error(
      `Remote links are not writable through the Atlassian MCP server, so ${key} cannot be linked this way.\n` +
        `Post the URL as a comment instead:\n` +
        `  tool  ${MCP_PREFIX}addCommentToJiraIssue\n` +
        `  args  ${JSON.stringify({ cloudId: cloudId(profile), issueIdOrKey: key, commentBody: `${title ?? "Link"}: ${url}`, contentFormat: "markdown" })}`,
    );
  }
  const { base, auth } = ctx(profile);
  return api(`${base}/issue/${encodeURIComponent(key)}/remotelink`, {
    method: "POST",
    auth,
    body: {
      globalId: url,
      object: {
        url,
        title,
        summary,
        icon: icon ? { url16x16: icon } : undefined,
      },
    },
  });
}
