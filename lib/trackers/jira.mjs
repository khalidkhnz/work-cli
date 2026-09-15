// Jira adapter. Thin — the REST client lives in ../jira.mjs; this only maps it
// onto the shared tracker interface so commands never branch on tracker type.

import * as J from "../jira.mjs";

export const name = "jira";

export const keyPattern = (projectKeys = []) =>
  projectKeys.length
    ? `(${projectKeys.map((k) => k.toUpperCase()).join("|")})-\\d+`
    : "[A-Z][A-Z0-9]+-\\d+";

export const getIssue = (cfg, key) => J.getIssue(cfg.profile, key);

export const addComment = (cfg, key, markdown) =>
  J.addComment(cfg.profile, key, markdown);

export const getTransitions = (cfg, key) => J.getTransitions(cfg.profile, key);

export const transition = (cfg, key, target) =>
  J.transition(cfg.profile, key, target);

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
  const issues = await J.search(cfg.profile, query, { limit });
  return { query, issues };
}

// ------------------------------------------------------------------ New Functions

export const createIssue = (cfg, opts) => J.createIssue(cfg.profile, opts);

export const assignIssue = (cfg, key, accountId) =>
  J.assignIssue(cfg.profile, key, accountId);

export const updateIssue = (cfg, key, fields) =>
  J.updateIssue(cfg.profile, key, fields);

export const getWatchers = (cfg, key) => J.getWatchers(cfg.profile, key);

export const addWatcher = (cfg, key, accountId) =>
  J.addWatcher(cfg.profile, key, accountId);

export const removeWatcher = (cfg, key, accountId) =>
  J.removeWatcher(cfg.profile, key, accountId);

export const searchUsers = (cfg, query, opts) =>
  J.searchUsers(cfg.profile, query, opts);

export const getProjects = (cfg) => J.getProjects(cfg.profile);

export const getIssueTypes = (cfg, projectKey) =>
  J.getIssueTypes(cfg.profile, projectKey);

export const getPriorities = (cfg) => J.getPriorities(cfg.profile);

export const getBoards = (cfg, opts) => J.getBoards(cfg.profile, opts);

export const getSprints = (cfg, boardId, opts) =>
  J.getSprints(cfg.profile, boardId, opts);

export const getSprintIssues = (cfg, sprintId, opts) =>
  J.getSprintIssues(cfg.profile, sprintId, opts);

export const getBoardBacklog = (cfg, boardId, opts) =>
  J.getBoardBacklog(cfg.profile, boardId, opts);

export const linkIssues = (cfg, inwardKey, outwardKey, linkType) =>
  J.linkIssues(cfg.profile, inwardKey, outwardKey, linkType);

export const getLinkTypes = (cfg) => J.getLinkTypes(cfg.profile);

// Search with custom JQL
export async function searchJql(cfg, jql, { limit = 25 } = {}) {
  const issues = await J.search(cfg.profile, jql, { limit });
  return { query: jql, issues };
}
