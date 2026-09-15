// Jira REST API v3 client.
//
// All write operations accept ADF (Atlassian Document Format) as the primary format.
// Strings are auto-converted from Markdown for convenience, but ADF is preferred.
//
// ADF helpers are available in ./markup.mjs:
//   - toAdf(input)         — normalize string or ADF to valid ADF
//   - validateAdf(adf)     — throw if ADF structure is invalid
//   - adfText(str)         — create simple text paragraph
//   - adfCodeBlock(code, lang) — create code block
//   - adfBulletList(items) — create bullet list
//   - adfTable(rows)       — create table
//   - adfPanel(type, text) — create info/warning/error panel
//   - adfMention(id, name) — create @mention
//   - etc.

import { api, basicAuth, uploadFile } from "./http.mjs";
import { toAdf, adfToText, isAdf } from "./markup.mjs";
import { need } from "./config.mjs";
import { assertClean } from "./scrub.mjs";
import { guard, atlassianVia, cloudId, MCP_PREFIX } from "./mcp.mjs";

// ---------------------------------------------------------------- Context helper

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
    agile: `https://${site}/rest/agile/1.0`,
    browse: (key) => `https://${site}/browse/${key}`,
    auth: basicAuth(profile.ATLASSIAN_EMAIL, profile.ATLASSIAN_API_TOKEN),
    site,
  };
}

// ---------------------------------------------------------------- Read Operations

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
    "attachment",
  ].join(",");

  const issue = await api(
    `${base}/issue/${encodeURIComponent(key)}?fields=${fields}&expand=renderedFields`,
    { auth },
  );
  const f = issue.fields;

  return {
    key: issue.key,
    id: issue.id,
    url: browse(issue.key),
    summary: f.summary,
    type: f.issuetype?.name,
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.name,
    priority: f.priority?.name,
    assignee: f.assignee?.displayName ?? null,
    assigneeId: f.assignee?.accountId ?? null,
    reporter: f.reporter?.displayName ?? null,
    reporterId: f.reporter?.accountId ?? null,
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
        id: l.id,
        type: l.type?.outward ?? l.type?.inward,
        key: (l.outwardIssue ?? l.inwardIssue)?.key,
        summary: (l.outwardIssue ?? l.inwardIssue)?.fields?.summary,
      }))
      .filter((l) => l.key),
    attachments: (f.attachment ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      mimeType: a.mimeType,
      created: a.created,
      author: a.author?.displayName,
      url: a.content,
    })),
    created: f.created,
    updated: f.updated,
    duedate: f.duedate,
    description: f.description ? adfToText(f.description).trim() : "",
    descriptionAdf: f.description, // Raw ADF for advanced use
    comments: (f.comment?.comments ?? []).slice(-10).map((c) => ({
      id: c.id,
      author: c.author?.displayName,
      authorId: c.author?.accountId,
      created: c.created,
      updated: c.updated,
      body: c.body ? adfToText(c.body).trim() : "",
      bodyAdf: c.body, // Raw ADF
    })),
  };
}

export async function search(profile, jql, { limit = 25, startAt = 0 } = {}) {
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
      startAt,
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
  return {
    total: res.total,
    startAt: res.startAt,
    maxResults: res.maxResults,
    issues: (res.issues ?? []).map((i) => ({
      key: i.key,
      id: i.id,
      url: browse(i.key),
      summary: i.fields.summary,
      status: i.fields.status?.name,
      type: i.fields.issuetype?.name,
      priority: i.fields.priority?.name,
      assignee: i.fields.assignee?.displayName ?? null,
      updated: i.fields.updated,
    })),
  };
}

// ---------------------------------------------------------------- Comments

/**
 * Add a comment to an issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {object|string} body - Comment body as ADF object or Markdown string
 * @returns {Promise<{id: string, url: string}>}
 */
export async function addComment(profile, key, body) {
  const adf = toAdf(body, { context: "comment body" });
  const text = typeof body === "string" ? body : adfToText(adf);
  assertClean(text, "Jira comment");

  guard(
    profile,
    "addCommentToJiraIssue",
    { issueIdOrKey: key, commentBody: text, contentFormat: "markdown" },
    `Commenting on ${key}`,
  );
  const { base, browse, auth } = ctx(profile);
  const res = await api(`${base}/issue/${encodeURIComponent(key)}/comment`, {
    method: "POST",
    auth,
    body: { body: adf },
  });
  return { id: res.id, url: `${browse(key)}?focusedCommentId=${res.id}` };
}

/**
 * Update an existing comment.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {string} commentId - Comment ID
 * @param {object|string} body - New comment body as ADF object or Markdown string
 * @returns {Promise<{id: string, url: string}>}
 */
export async function updateComment(profile, key, commentId, body) {
  const adf = toAdf(body, { context: "comment body" });
  const text = typeof body === "string" ? body : adfToText(adf);
  assertClean(text, "Jira comment");

  guard(
    profile,
    "updateCommentOnJiraIssue",
    {
      issueIdOrKey: key,
      commentId,
      commentBody: text,
      contentFormat: "markdown",
    },
    `Updating comment ${commentId} on ${key}`,
  );
  const { base, browse, auth } = ctx(profile);
  const res = await api(
    `${base}/issue/${encodeURIComponent(key)}/comment/${commentId}`,
    {
      method: "PUT",
      auth,
      body: { body: adf },
    },
  );
  return { id: res.id, url: `${browse(key)}?focusedCommentId=${res.id}` };
}

/**
 * Delete a comment.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {string} commentId - Comment ID
 * @returns {Promise<void>}
 */
export async function deleteComment(profile, key, commentId) {
  guard(
    profile,
    "deleteCommentOnJiraIssue",
    { issueIdOrKey: key, commentId },
    `Deleting comment ${commentId} on ${key}`,
  );
  const { base, auth } = ctx(profile);
  await api(`${base}/issue/${encodeURIComponent(key)}/comment/${commentId}`, {
    method: "DELETE",
    auth,
  });
}

/**
 * Get all comments on an issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {object} [options] - Options
 * @param {number} [options.limit=50] - Max comments to return
 * @param {number} [options.startAt=0] - Pagination offset
 * @returns {Promise<{total: number, comments: Array}>}
 */
export async function getComments(
  profile,
  key,
  { limit = 50, startAt = 0 } = {},
) {
  const { base, auth } = ctx(profile);
  const res = await api(
    `${base}/issue/${encodeURIComponent(key)}/comment?maxResults=${limit}&startAt=${startAt}`,
    { auth },
  );
  return {
    total: res.total,
    startAt: res.startAt,
    maxResults: res.maxResults,
    comments: (res.comments ?? []).map((c) => ({
      id: c.id,
      author: c.author?.displayName,
      authorId: c.author?.accountId,
      created: c.created,
      updated: c.updated,
      body: c.body ? adfToText(c.body).trim() : "",
      bodyAdf: c.body,
    })),
  };
}

// ---------------------------------------------------------------- Transitions

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
    toId: t.to?.id,
  }));
}

export async function transition(profile, key, target) {
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

// ---------------------------------------------------------------- Worklogs

/**
 * Add a worklog entry to an issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {string} timeSpent - Time spent (e.g., "2h 30m", "1d")
 * @param {object|string} [comment] - Optional worklog comment as ADF or Markdown
 * @returns {Promise<object>}
 */
export async function addWorklog(profile, key, timeSpent, comment) {
  guard(
    profile,
    "addWorklogToJiraIssue",
    {
      issueIdOrKey: key,
      timeSpent,
      ...(comment
        ? {
            commentBody:
              typeof comment === "string" ? comment : adfToText(comment),
            contentFormat: "markdown",
          }
        : {}),
    },
    `Logging ${timeSpent} against ${key}`,
  );
  const { base, auth } = ctx(profile);
  const body = { timeSpent };
  if (comment) {
    const text = typeof comment === "string" ? comment : adfToText(comment);
    assertClean(text, "Worklog comment");
    body.comment = toAdf(comment, { context: "worklog comment" });
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

// ---------------------------------------------------------------- Create Issue

/**
 * Create a new issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {object} options - Issue options
 * @param {string} options.project - Project key
 * @param {string} options.type - Issue type name
 * @param {string} options.summary - Issue summary
 * @param {object|string} [options.description] - Description as ADF or Markdown
 * @param {string} [options.priority] - Priority name
 * @param {string[]} [options.labels] - Labels
 * @param {string} [options.parent] - Parent issue key (for subtasks)
 * @param {string} [options.assignee] - Assignee account ID
 * @param {string} [options.duedate] - Due date (YYYY-MM-DD)
 * @param {string[]} [options.components] - Component names
 * @param {object} [options.customFields] - Custom field values (key -> value)
 * @returns {Promise<{key: string, id: string, url: string}>}
 */
export async function createIssue(
  profile,
  {
    project,
    type,
    summary,
    description,
    priority,
    labels,
    parent,
    assignee,
    duedate,
    components,
    customFields,
  },
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

  if (description)
    fields.description = toAdf(description, { context: "issue description" });
  if (priority) fields.priority = { name: priority };
  if (labels?.length) fields.labels = labels;
  if (parent) fields.parent = { key: parent };
  if (assignee) fields.assignee = { accountId: assignee };
  if (duedate) fields.duedate = duedate;
  if (components?.length)
    fields.components = components.map((name) => ({ name }));

  // Add custom fields
  if (customFields) {
    for (const [key, value] of Object.entries(customFields)) {
      fields[key] = value;
    }
  }

  const res = await api(`${base}/issue`, {
    method: "POST",
    auth,
    body: { fields },
  });
  return { key: res.key, id: res.id, url: browse(res.key) };
}

// ---------------------------------------------------------------- Update Issue

/**
 * Update an existing issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {object} fields - Fields to update
 * @param {string} [fields.summary] - New summary
 * @param {object|string} [fields.description] - New description as ADF or Markdown
 * @param {string} [fields.priority] - New priority name
 * @param {string[]} [fields.labels] - Replace labels
 * @param {string[]} [fields.addLabels] - Add labels
 * @param {string[]} [fields.removeLabels] - Remove labels
 * @param {string} [fields.duedate] - New due date (YYYY-MM-DD)
 * @param {string[]} [fields.components] - Replace components
 * @param {object} [fields.customFields] - Custom field values
 * @returns {Promise<{key: string, updated: string[]}>}
 */
export async function updateIssue(profile, key, fields) {
  guard(
    profile,
    "updateJiraIssue",
    { issueIdOrKey: key, fields },
    `Updating ${key}`,
  );
  const { base, auth } = ctx(profile);

  const update = {};
  const set = {};

  if (fields.summary) update.summary = [{ set: fields.summary }];
  if (fields.description) {
    update.description = [
      { set: toAdf(fields.description, { context: "issue description" }) },
    ];
  }
  if (fields.priority) update.priority = [{ set: { name: fields.priority } }];
  if (fields.duedate) set.duedate = fields.duedate;

  // Labels: can set, add, or remove
  if (fields.labels) {
    update.labels = [{ set: fields.labels }];
  } else if (fields.addLabels || fields.removeLabels) {
    update.labels = [];
    if (fields.addLabels) {
      update.labels.push(...fields.addLabels.map((l) => ({ add: l })));
    }
    if (fields.removeLabels) {
      update.labels.push(...fields.removeLabels.map((l) => ({ remove: l })));
    }
  }

  // Components
  if (fields.components) {
    update.components = [{ set: fields.components.map((name) => ({ name })) }];
  }

  // Custom fields
  if (fields.customFields) {
    for (const [key, value] of Object.entries(fields.customFields)) {
      update[key] = [{ set: value }];
    }
  }

  const body = {};
  if (Object.keys(update).length) body.update = update;
  if (Object.keys(set).length) body.fields = set;

  await api(`${base}/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    auth,
    body,
  });
  return { key, updated: Object.keys(fields) };
}

// ---------------------------------------------------------------- Delete Issue

/**
 * Delete an issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {object} [options] - Options
 * @param {boolean} [options.deleteSubtasks=false] - Also delete subtasks
 * @returns {Promise<void>}
 */
export async function deleteIssue(
  profile,
  key,
  { deleteSubtasks = false } = {},
) {
  guard(profile, "deleteJiraIssue", { issueIdOrKey: key }, `Deleting ${key}`);
  const { base, auth } = ctx(profile);
  await api(
    `${base}/issue/${encodeURIComponent(key)}?deleteSubtasks=${deleteSubtasks}`,
    {
      method: "DELETE",
      auth,
    },
  );
}

// ---------------------------------------------------------------- Assign Issue

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

/**
 * Unassign an issue (set assignee to null).
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @returns {Promise<{key: string}>}
 */
export async function unassignIssue(profile, key) {
  const { base, auth } = ctx(profile);
  await api(`${base}/issue/${encodeURIComponent(key)}/assignee`, {
    method: "PUT",
    auth,
    body: { accountId: null },
  });
  return { key };
}

// ---------------------------------------------------------------- Watchers

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
    body: JSON.stringify(accountId),
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

// ---------------------------------------------------------------- Attachments

/**
 * Get attachments for an issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @returns {Promise<Array>}
 */
export async function getAttachments(profile, key) {
  const issue = await getIssue(profile, key);
  return issue.attachments;
}

/**
 * Add an attachment to an issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {Buffer|Uint8Array} file - File content
 * @param {string} filename - Filename
 * @param {string} [contentType] - MIME type
 * @returns {Promise<Array>} Array of created attachments
 */
export async function addAttachment(profile, key, file, filename, contentType) {
  const { base, auth } = ctx(profile);
  return uploadFile(`${base}/issue/${encodeURIComponent(key)}/attachments`, {
    auth,
    file,
    filename,
    contentType,
  });
}

/**
 * Delete an attachment.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} attachmentId - Attachment ID
 * @returns {Promise<void>}
 */
export async function deleteAttachment(profile, attachmentId) {
  const { base, auth } = ctx(profile);
  await api(`${base}/attachment/${attachmentId}`, {
    method: "DELETE",
    auth,
  });
}

// ---------------------------------------------------------------- Users Search

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
    avatarUrl: u.avatarUrls?.["48x48"],
  }));
}

/**
 * Get assignable users for a project or issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {object} options - Options
 * @param {string} [options.project] - Project key
 * @param {string} [options.issueKey] - Issue key
 * @param {string} [options.query] - Search query
 * @param {number} [options.limit=50] - Max results
 * @returns {Promise<Array>}
 */
export async function getAssignableUsers(
  profile,
  { project, issueKey, query = "", limit = 50 } = {},
) {
  const { base, auth } = ctx(profile);
  let url = `${base}/user/assignable/search?maxResults=${limit}`;
  if (project) url += `&project=${encodeURIComponent(project)}`;
  if (issueKey) url += `&issueKey=${encodeURIComponent(issueKey)}`;
  if (query) url += `&query=${encodeURIComponent(query)}`;

  const res = await api(url, { auth });
  return (res ?? []).map((u) => ({
    accountId: u.accountId,
    name: u.displayName,
    email: u.emailAddress ?? null,
    active: u.active,
  }));
}

// ---------------------------------------------------------------- Project & Meta

export async function getProjects(profile, { limit = 100, startAt = 0 } = {}) {
  const { base, auth } = ctx(profile);
  const res = await api(
    `${base}/project/search?maxResults=${limit}&startAt=${startAt}`,
    { auth },
  );
  return {
    total: res.total,
    values: (res.values ?? []).map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      lead: p.lead?.displayName,
      projectTypeKey: p.projectTypeKey,
    })),
  };
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

/**
 * Get available statuses for a project.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} projectKey - Project key
 * @returns {Promise<Array>}
 */
export async function getStatuses(profile, projectKey) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/project/${projectKey}/statuses`, { auth });
  return (res ?? []).flatMap((issueType) =>
    (issueType.statuses ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.statusCategory?.name,
      issueType: issueType.name,
    })),
  );
}

/**
 * Get components for a project.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} projectKey - Project key
 * @returns {Promise<Array>}
 */
export async function getComponents(profile, projectKey) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/project/${projectKey}/components`, { auth });
  return (res ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    lead: c.lead?.displayName,
  }));
}

/**
 * Get versions for a project.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} projectKey - Project key
 * @returns {Promise<Array>}
 */
export async function getVersions(profile, projectKey) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/project/${projectKey}/versions`, { auth });
  return (res ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    released: v.released,
    releaseDate: v.releaseDate,
    archived: v.archived,
  }));
}

// ---------------------------------------------------------------- Sprints & Boards (Agile API)

export async function getBoards(
  profile,
  { projectKey, type, limit = 50 } = {},
) {
  const { agile, auth } = ctx(profile);
  let url = `${agile}/board?maxResults=${limit}`;
  if (projectKey) url += `&projectKeyOrId=${projectKey}`;
  if (type) url += `&type=${type}`;
  const res = await api(url, { auth });
  return {
    total: res.total,
    values: (res.values ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      projectKey: b.location?.projectKey,
    })),
  };
}

export async function getSprints(
  profile,
  boardId,
  { state = "active,future", limit = 20 } = {},
) {
  const { agile, auth } = ctx(profile);
  const res = await api(
    `${agile}/board/${boardId}/sprint?state=${state}&maxResults=${limit}`,
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

export async function getSprintIssues(
  profile,
  sprintId,
  { limit = 50, startAt = 0 } = {},
) {
  const { agile, auth, browse } = ctx(profile);
  const res = await api(
    `${agile}/sprint/${sprintId}/issue?maxResults=${limit}&startAt=${startAt}`,
    { auth },
  );
  return {
    total: res.total,
    issues: (res.issues ?? []).map((i) => ({
      key: i.key,
      url: browse(i.key),
      summary: i.fields.summary,
      status: i.fields.status?.name,
      type: i.fields.issuetype?.name,
      priority: i.fields.priority?.name,
      assignee: i.fields.assignee?.displayName ?? null,
      storyPoints: i.fields.customfield_10016 ?? null,
    })),
  };
}

export async function getBoardBacklog(
  profile,
  boardId,
  { limit = 50, startAt = 0 } = {},
) {
  const { agile, auth, browse } = ctx(profile);
  const res = await api(
    `${agile}/board/${boardId}/backlog?maxResults=${limit}&startAt=${startAt}`,
    { auth },
  );
  return {
    total: res.total,
    issues: (res.issues ?? []).map((i) => ({
      key: i.key,
      url: browse(i.key),
      summary: i.fields.summary,
      status: i.fields.status?.name,
      type: i.fields.issuetype?.name,
      priority: i.fields.priority?.name,
      assignee: i.fields.assignee?.displayName ?? null,
    })),
  };
}

// ---------------------------------------------------------------- Issue Links

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

/**
 * Remove an issue link.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} linkId - Link ID
 * @returns {Promise<void>}
 */
export async function deleteIssueLink(profile, linkId) {
  const { base, auth } = ctx(profile);
  await api(`${base}/issueLink/${linkId}`, {
    method: "DELETE",
    auth,
  });
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

// ---------------------------------------------------------------- Remote Links

export async function addRemoteLink(
  profile,
  key,
  { url, title, summary, icon },
) {
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

/**
 * Get remote links for an issue.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @returns {Promise<Array>}
 */
export async function getRemoteLinks(profile, key) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/issue/${encodeURIComponent(key)}/remotelink`, {
    auth,
  });
  return (res ?? []).map((l) => ({
    id: l.id,
    globalId: l.globalId,
    url: l.object?.url,
    title: l.object?.title,
    summary: l.object?.summary,
  }));
}

/**
 * Delete a remote link.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} key - Issue key
 * @param {string} linkId - Remote link ID
 * @returns {Promise<void>}
 */
export async function deleteRemoteLink(profile, key, linkId) {
  const { base, auth } = ctx(profile);
  await api(`${base}/issue/${encodeURIComponent(key)}/remotelink/${linkId}`, {
    method: "DELETE",
    auth,
  });
}

// ---------------------------------------------------------------- Bulk Operations

/**
 * Bulk transition multiple issues.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string[]} keys - Issue keys
 * @param {string} target - Target status name
 * @returns {Promise<{success: Array, failed: Array}>}
 */
export async function bulkTransition(profile, keys, target) {
  const success = [];
  const failed = [];

  for (const key of keys) {
    try {
      await transition(profile, key, target);
      success.push(key);
    } catch (err) {
      failed.push({ key, error: err.message });
    }
  }

  return { success, failed };
}

/**
 * Bulk add labels to multiple issues.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string[]} keys - Issue keys
 * @param {string[]} labels - Labels to add
 * @returns {Promise<{success: Array, failed: Array}>}
 */
export async function bulkAddLabels(profile, keys, labels) {
  const success = [];
  const failed = [];

  for (const key of keys) {
    try {
      await updateIssue(profile, key, { addLabels: labels });
      success.push(key);
    } catch (err) {
      failed.push({ key, error: err.message });
    }
  }

  return { success, failed };
}

/**
 * Bulk assign issues to a user.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string[]} keys - Issue keys
 * @param {string} accountId - Assignee account ID
 * @returns {Promise<{success: Array, failed: Array}>}
 */
export async function bulkAssign(profile, keys, accountId) {
  const success = [];
  const failed = [];

  for (const key of keys) {
    try {
      await assignIssue(profile, key, accountId);
      success.push(key);
    } catch (err) {
      failed.push({ key, error: err.message });
    }
  }

  return { success, failed };
}

// ---------------------------------------------------------------- Field Metadata

/**
 * Get all fields available in Jira.
 * @param {object} profile - Profile with Atlassian credentials
 * @returns {Promise<Array>}
 */
export async function getFields(profile) {
  const { base, auth } = ctx(profile);
  const res = await api(`${base}/field`, { auth });
  return (res ?? []).map((f) => ({
    id: f.id,
    key: f.key,
    name: f.name,
    custom: f.custom,
    schema: f.schema,
  }));
}

/**
 * Get field metadata for creating issues in a project.
 * @param {object} profile - Profile with Atlassian credentials
 * @param {string} projectKey - Project key
 * @param {string} issueType - Issue type name
 * @returns {Promise<object>}
 */
export async function getCreateMeta(profile, projectKey, issueType) {
  const { base, auth } = ctx(profile);
  const res = await api(
    `${base}/issue/createmeta/${projectKey}/issuetypes/${issueType}?expand=projects.issuetypes.fields`,
    { auth },
  );
  return res;
}
