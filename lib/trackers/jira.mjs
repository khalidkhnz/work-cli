// Jira adapter. Maps the Jira REST client onto the shared tracker interface
// so commands never branch on tracker type.
//
// All write operations accept ADF (Atlassian Document Format) as the primary format.
// Strings are auto-converted from Markdown for convenience.

import * as J from "../jira.mjs";

export const name = "jira";

export const keyPattern = (projectKeys = []) =>
  projectKeys.length
    ? `(${projectKeys.map((k) => k.toUpperCase()).join("|")})-\\d+`
    : "[A-Z][A-Z0-9]+-\\d+";

// ---------------------------------------------------------------- Core Operations

export const getIssue = (cfg, key) => J.getIssue(cfg.profile, key);

/**
 * Add a comment to an issue.
 * @param {object} cfg - Config with profile
 * @param {string} key - Issue key
 * @param {object|string} body - Comment body as ADF object or Markdown string
 */
export const addComment = (cfg, key, body) =>
  J.addComment(cfg.profile, key, body);

/**
 * Update an existing comment.
 * @param {object} cfg - Config with profile
 * @param {string} key - Issue key
 * @param {string} commentId - Comment ID
 * @param {object|string} body - New comment body as ADF or Markdown
 */
export const updateComment = (cfg, key, commentId, body) =>
  J.updateComment(cfg.profile, key, commentId, body);

/**
 * Delete a comment.
 */
export const deleteComment = (cfg, key, commentId) =>
  J.deleteComment(cfg.profile, key, commentId);

/**
 * Get all comments on an issue.
 */
export const getComments = (cfg, key, opts) =>
  J.getComments(cfg.profile, key, opts);

export const getTransitions = (cfg, key) => J.getTransitions(cfg.profile, key);

export const transition = (cfg, key, target) =>
  J.transition(cfg.profile, key, target);

/**
 * Add a worklog entry.
 * @param {object} cfg - Config with profile
 * @param {string} key - Issue key
 * @param {string} time - Time spent (e.g., "2h 30m")
 * @param {object|string} [comment] - Optional comment as ADF or Markdown
 */
export const worklog = (cfg, key, time, comment) =>
  J.addWorklog(cfg.profile, key, time, comment);

export const addLink = (cfg, key, link) =>
  J.addRemoteLink(cfg.profile, key, link);

export async function whoami(cfg) {
  const me = await J.myself(cfg.profile);
  return {
    name: me.displayName,
    email: me.emailAddress ?? null,
    id: me.accountId,
  };
}

export async function search(
  cfg,
  { limit = 25, status = null, jql = null } = {},
) {
  const clauses = ["assignee = currentUser()"];
  if (status) clauses.push(`status = "${status}"`);
  else clauses.push("statusCategory != Done");
  if (cfg.projectKeys?.length)
    clauses.push(`project in (${cfg.projectKeys.join(",")})`);

  const query = (jql ?? clauses.join(" AND ")) + " ORDER BY updated DESC";
  const result = await J.search(cfg.profile, query, { limit });
  return { query, issues: result.issues, total: result.total };
}

// ---------------------------------------------------------------- Issue CRUD

/**
 * Create a new issue.
 * @param {object} cfg - Config with profile
 * @param {object} opts - Issue options (project, type, summary, description, etc.)
 */
export const createIssue = (cfg, opts) => J.createIssue(cfg.profile, opts);

/**
 * Update an existing issue.
 * @param {object} cfg - Config with profile
 * @param {string} key - Issue key
 * @param {object} fields - Fields to update
 */
export const updateIssue = (cfg, key, fields) =>
  J.updateIssue(cfg.profile, key, fields);

/**
 * Delete an issue.
 * @param {object} cfg - Config with profile
 * @param {string} key - Issue key
 * @param {object} [opts] - Options (deleteSubtasks)
 */
export const deleteIssue = (cfg, key, opts) =>
  J.deleteIssue(cfg.profile, key, opts);

// ---------------------------------------------------------------- Assignment

export const assignIssue = (cfg, key, accountId) =>
  J.assignIssue(cfg.profile, key, accountId);

export const unassignIssue = (cfg, key) => J.unassignIssue(cfg.profile, key);

// ---------------------------------------------------------------- Watchers

export const getWatchers = (cfg, key) => J.getWatchers(cfg.profile, key);

export const addWatcher = (cfg, key, accountId) =>
  J.addWatcher(cfg.profile, key, accountId);

export const removeWatcher = (cfg, key, accountId) =>
  J.removeWatcher(cfg.profile, key, accountId);

// ---------------------------------------------------------------- Attachments

export const getAttachments = (cfg, key) => J.getAttachments(cfg.profile, key);

export const addAttachment = (cfg, key, file, filename, contentType) =>
  J.addAttachment(cfg.profile, key, file, filename, contentType);

export const deleteAttachment = (cfg, attachmentId) =>
  J.deleteAttachment(cfg.profile, attachmentId);

// ---------------------------------------------------------------- Users

export const searchUsers = (cfg, query, opts) =>
  J.searchUsers(cfg.profile, query, opts);

export const getAssignableUsers = (cfg, opts) =>
  J.getAssignableUsers(cfg.profile, opts);

// ---------------------------------------------------------------- Project & Meta

export const getProjects = (cfg, opts) => J.getProjects(cfg.profile, opts);

export const getIssueTypes = (cfg, projectKey) =>
  J.getIssueTypes(cfg.profile, projectKey);

export const getPriorities = (cfg) => J.getPriorities(cfg.profile);

export const getStatuses = (cfg, projectKey) =>
  J.getStatuses(cfg.profile, projectKey);

export const getComponents = (cfg, projectKey) =>
  J.getComponents(cfg.profile, projectKey);

export const getVersions = (cfg, projectKey) =>
  J.getVersions(cfg.profile, projectKey);

export const getFields = (cfg) => J.getFields(cfg.profile);

export const getCreateMeta = (cfg, projectKey, issueType) =>
  J.getCreateMeta(cfg.profile, projectKey, issueType);

// ---------------------------------------------------------------- Sprints & Boards (Agile)

export const getBoards = (cfg, opts) => J.getBoards(cfg.profile, opts);

export const getSprints = (cfg, boardId, opts) =>
  J.getSprints(cfg.profile, boardId, opts);

export const getSprintIssues = (cfg, sprintId, opts) =>
  J.getSprintIssues(cfg.profile, sprintId, opts);

export const getBoardBacklog = (cfg, boardId, opts) =>
  J.getBoardBacklog(cfg.profile, boardId, opts);

// ---------------------------------------------------------------- Issue Links

export const linkIssues = (cfg, inwardKey, outwardKey, linkType) =>
  J.linkIssues(cfg.profile, inwardKey, outwardKey, linkType);

export const deleteIssueLink = (cfg, linkId) =>
  J.deleteIssueLink(cfg.profile, linkId);

export const getLinkTypes = (cfg) => J.getLinkTypes(cfg.profile);

// ---------------------------------------------------------------- Remote Links

export const addRemoteLink = (cfg, key, link) =>
  J.addRemoteLink(cfg.profile, key, link);

export const getRemoteLinks = (cfg, key) => J.getRemoteLinks(cfg.profile, key);

export const deleteRemoteLink = (cfg, key, linkId) =>
  J.deleteRemoteLink(cfg.profile, key, linkId);

// ---------------------------------------------------------------- Bulk Operations

export const bulkTransition = (cfg, keys, target) =>
  J.bulkTransition(cfg.profile, keys, target);

export const bulkAddLabels = (cfg, keys, labels) =>
  J.bulkAddLabels(cfg.profile, keys, labels);

export const bulkAssign = (cfg, keys, accountId) =>
  J.bulkAssign(cfg.profile, keys, accountId);

// ---------------------------------------------------------------- Search with Custom JQL

export async function searchJql(cfg, jql, { limit = 25, startAt = 0 } = {}) {
  const result = await J.search(cfg.profile, jql, { limit, startAt });
  return { query: jql, issues: result.issues, total: result.total };
}
