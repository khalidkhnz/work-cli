#!/usr/bin/env node
// work — ticket -> branch -> PR -> comment -> doc, across however many accounts,
// trackers, forges, and repos you hold. Credentials come from the directory you
// stand in; per-repo overrides and context come from .work.md. See README.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  loadProfile,
  listProfiles,
  readConfig,
  writeConfig,
  resolveProfileName,
  PROFILE_DIR,
  CONFIG_DIR,
} from "../lib/config.mjs";
import {
  resolveRepo,
  findRepos,
  describeRepo,
  readRepoFile,
  ensureLocalExclude,
  REPO_FILE,
  REPO_TEMPLATE,
  WORK_ARTIFACTS,
} from "../lib/repo.mjs";
import { getTracker, trackerNames } from "../lib/trackers/index.mjs";
import * as forges from "../lib/forges/index.mjs";
import * as confluence from "../lib/confluence.mjs";
import { atlassianVia, cloudId as mcpCloudId } from "../lib/mcp.mjs";
import * as G from "../lib/git.mjs";
import {
  scrub,
  findAttribution,
  BANNED_AUTHOR_DOMAINS,
} from "../lib/scrub.mjs";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));

// ------------------------------------------------------------------ arg parse

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith("--"))
        flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const cmd = positional[0];
const JSON_OUT = Boolean(flags.json);
const flag = (name) =>
  flags[name] && flags[name] !== true ? String(flags[name]) : null;

// --------------------------------------------------------------------- output

const c =
  process.stdout.isTTY && !JSON_OUT
    ? {
        dim: (s) => `\x1b[2m${s}\x1b[0m`,
        b: (s) => `\x1b[1m${s}\x1b[0m`,
        g: (s) => `\x1b[32m${s}\x1b[0m`,
        y: (s) => `\x1b[33m${s}\x1b[0m`,
        r: (s) => `\x1b[31m${s}\x1b[0m`,
        c: (s) => `\x1b[36m${s}\x1b[0m`,
      }
    : {
        dim: (s) => s,
        b: (s) => s,
        g: (s) => s,
        y: (s) => s,
        r: (s) => s,
        c: (s) => s,
      };

const out = (...a) => console.log(...a);
function emit(obj, render) {
  if (JSON_OUT) out(JSON.stringify(obj, null, 2));
  else render(obj);
}

function bodyFromFlags(what) {
  if (flags.file)
    return readFileSync(
      flags.file === true ? "/dev/stdin" : String(flags.file),
      "utf8",
    );
  if (flag("body")) return flag("body");
  if (flags.stdin) return readFileSync(0, "utf8");
  throw new Error(
    `No ${what} supplied. Use --body "..." or --file <path> or --stdin.`,
  );
}

async function ask(question, fallback = "") {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (
    await rl.question(
      fallback ? `${question} [${fallback}]: ` : `${question}: `,
    )
  ).trim();
  rl.close();
  return answer || fallback;
}

// The merged repo+profile view every command works from.
function repo() {
  return resolveRepo(process.cwd());
}

function resolveKey(cfg, explicit) {
  if (explicit && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(explicit))
    return explicit.toUpperCase();
  if (cfg.ticketKey) return cfg.ticketKey;
  throw new Error(
    `No ticket key given, and none found in branch "${cfg.branch}".\n` +
      `Pass one explicitly, e.g. work ${cmd} ${cfg.projectKeys[0] ?? "ABC"}-123` +
      (cfg.projectKeys.length
        ? ""
        : `\nThis repo has no project keys configured — set project_keys in ${REPO_FILE} or JIRA_PROJECT_KEYS in the profile.`),
  );
}

// ------------------------------------------------------------------- commands

const commands = {};

commands.help = () => {
  out(`${c.b("work")} — ticket -> branch -> PR -> comment -> doc, across accounts, trackers, and repos

${c.b("Accounts and repos")}
  work setup                       Create or edit an account profile
  work profiles                    List profiles and routes
  work which                       What applies here: account, tracker, forge, context
  work route <profile> [--path P]  Map a directory tree to a profile
  work init                        Scaffold ${REPO_FILE} in this repo
  work adopt [dir]                 Onboard every repo under a directory at once
  work context                     Print this repo's context for the agent
  work repos [dir]                 Every repo under a directory, with its state
  work doctor                      Verify credentials and config end to end

${c.b("Tickets")}   ${c.dim(`trackers: ${trackerNames().join(", ")}`)}
  work ticket [KEY]                Show a ticket, its AC, and recent comments
  work mine [--status S]           Your open tickets
  work start <KEY> [--base BR]     Branch for a ticket, and set the git identity
  work branch <KEY>                Print the branch name a ticket would get
  work comment [KEY] --body "..."  Post a comment (also --file, --stdin)
  work move [KEY] <status>         Move the ticket
  work transitions [KEY]           What it can move to from here
  work worklog [KEY] <time>        Log time, e.g. work worklog 2h
  work create <project> --type T   Create a ticket (--summary, --description, --priority)
  work assign [KEY] <user>         Assign ticket to user (email, name, or accountId)
  work update [KEY] --summary ".." Update ticket fields (--labels, --priority, --description)
  work link-ticket KEY1 KEY2       Link two tickets (--type "blocks|relates to|...")

${c.b("Discovery")}
  work users <query>               Search users by name or email
  work projects                    List Jira projects you can access
  work boards [--project P]        List Jira boards
  work sprints <boardId>           Sprints on a board (--state active,future,closed)
  work sprint-issues <sprintId>    Issues in a sprint
  work backlog <boardId>           Backlog issues on a board
  work issue-types [project]       Issue types for a project
  work priorities                  List priority levels
  work watchers [KEY]              Who is watching a ticket
  work watch [KEY]                 Start watching a ticket
  work unwatch [KEY]               Stop watching a ticket

${c.b("Code review")}
  work pr-body [KEY]               Draft a PR description from ticket + diff
  work pr [KEY] --yes              Open the PR (without --yes, prints a preview)
  work prs                         Open pull requests on this repo
  work link [KEY] --url U          Attach a link to the ticket

${c.b("Docs")}
  work spaces                      Confluence spaces visible to this account
  work doc <template> [KEY] --yes  Create or update a Confluence page
                                   --ticket-json F  use a ticket you already fetched
                                   templates: ${templateNames().join(", ") || "(none)"}

${c.b("Misc")}
  work scrub <file> [--write]      Strip AI-attribution lines
  work check <file|->              Exit 1 if text carries AI attribution

${c.dim("Global flags: --json  --profile <name>  --cwd <path>")}
${c.dim(`Config: ${CONFIG_DIR}    Per-repo: ${REPO_FILE}`)}`);
};

commands.setup = async () => {
  out(c.b("\nNew or updated account profile\n"));
  out(
    c.dim(
      "A profile is one account: its site, its tokens, its git identity.\n",
    ),
  );

  const name =
    flag("profile") ?? (await ask("Profile name (short, e.g. sentry)"));
  if (!name) throw new Error("A profile name is required.");

  const file = join(PROFILE_DIR, `${name}.env`);
  const prior = existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
          .map((l) => {
            const i = l.indexOf("=");
            return [
              l.slice(0, i).trim(),
              l
                .slice(i + 1)
                .trim()
                .replace(/^["']|["']$/g, ""),
            ];
          }),
      )
    : {};
  if (existsSync(file))
    out(c.y("Editing an existing profile — press Enter to keep a value.\n"));

  const label = await ask(
    "Label (human name for this account)",
    prior.PROFILE_LABEL ?? name,
  );

  const tracker = (
    await ask(
      `Tracker (${trackerNames().join(" | ")})`,
      prior.TRACKER ?? "jira",
    )
  ).toLowerCase();
  if (!trackerNames().includes(tracker))
    throw new Error(
      `Unknown tracker "${tracker}". Supported: ${trackerNames().join(", ")}`,
    );

  let site = prior.ATLASSIAN_SITE ?? "";
  let email = prior.ATLASSIAN_EMAIL ?? "";
  let token = prior.ATLASSIAN_API_TOKEN ?? "";
  let keys = prior.JIRA_PROJECT_KEYS ?? "";
  let clickupToken = prior.CLICKUP_TOKEN ?? "";
  let clickupTeam = prior.CLICKUP_TEAM_ID ?? "";

  if (tracker === "jira") {
    site = await ask("Atlassian site host (e.g. acme.atlassian.net)", site);
    email = await ask("Atlassian account email", email);
    if (!token) {
      out(
        c.dim(
          "\n  Token: https://id.atlassian.com/manage-profile/security/api-tokens",
        ),
      );
      out(c.dim("  The same token covers Jira, Confluence, and Bitbucket.\n"));
    }
    token = await ask("Atlassian API token", token);
    out(
      c.dim(
        "  Project KEYS, not names — the short prefix in ticket ids (STR in STR-3350).",
      ),
    );
    keys = await ask("Jira project keys (comma separated)", keys);
  } else if (tracker === "clickup") {
    out(
      c.dim(
        "\n  Token: ClickUp -> Settings -> Apps -> API Token (starts pk_)\n",
      ),
    );
    clickupToken = await ask("ClickUp personal API token", clickupToken);
    clickupTeam = await ask(
      "ClickUp workspace (team) id — blank to auto-detect",
      clickupTeam,
    );
    out(
      c.dim("  Prefixes of your ClickUp custom task ids, e.g. ABC in ABC-123."),
    );
    keys = await ask("Task id prefixes (comma separated)", keys);
    out(
      c.dim(
        "\n  Confluence is still available for docs if this account has Atlassian access.",
      ),
    );
    site = await ask("Atlassian site for docs (optional)", site);
    if (site) {
      email = await ask("Atlassian account email", email);
      token = await ask("Atlassian API token", token);
    }
  }

  const space = await ask(
    "Default Confluence space key (optional)",
    prior.CONFLUENCE_SPACE ?? "",
  );
  const parent = await ask(
    "Default Confluence parent page id (optional)",
    prior.CONFLUENCE_PARENT_ID ?? "",
  );

  out("");
  const gitName = await ask(
    "git user.name for this account",
    prior.GIT_NAME ?? "",
  );
  const gitEmail = await ask(
    "git user.email for this account",
    prior.GIT_EMAIL ?? email,
  );
  for (const re of BANNED_AUTHOR_DOMAINS) {
    if (re.test(gitEmail))
      throw new Error(
        `Refusing to store ${gitEmail} as a git identity — that domain is on your never-use list.`,
      );
  }

  out("");
  const forge = (
    await ask(
      "Forge (bitbucket | github | blank to detect per repo)",
      prior.FORGE ?? "",
    )
  ).toLowerCase();

  let bbWorkspace = prior.BITBUCKET_WORKSPACE ?? "";
  let bbEmail = prior.BITBUCKET_EMAIL ?? "";
  let bbToken = prior.BITBUCKET_TOKEN ?? "";
  let ghToken = prior.GITHUB_TOKEN ?? "";
  let ghOwner = prior.GITHUB_OWNER ?? "";

  if (forge !== "github") {
    bbWorkspace = await ask(
      "Bitbucket workspace (blank if unused)",
      bbWorkspace,
    );
    if (bbWorkspace) {
      bbEmail = await ask("Bitbucket account email", bbEmail || email);
      // Reusing the Jira token only works if it was minted with Bitbucket
      // scopes, and scopes cannot be added later — so this needs saying.
      out(
        c.dim(
          "  Needs a token created WITH Bitbucket scopes (repository + pull request).",
        ),
      );
      out(
        c.dim(
          '  A Jira-only token fails here with "no Bitbucket scopes", and cannot be re-scoped.',
        ),
      );
      bbToken = await ask("Bitbucket API token", bbToken);
    }
  }
  if (forge !== "bitbucket") {
    out(
      c.dim(
        "  A per-profile GitHub token keeps this account separate from whatever `gh` is signed into.",
      ),
    );
    ghToken = await ask(
      "GitHub token (blank to fall back to the gh CLI)",
      ghToken,
    );
    if (ghToken)
      ghOwner = await ask(
        "GitHub owner/org (blank to take it from origin)",
        ghOwner,
      );
  }

  const base = await ask(
    "Default base branch",
    prior.DEFAULT_BASE_BRANCH ?? "main",
  );

  const content = `# ${label}
# Written by \`work setup\`. Comments use #, never ; — a semicolon is legal
# inside a token and would silently truncate it.
PROFILE_LABEL="${label}"
TRACKER=${tracker}

ATLASSIAN_SITE=${site}
ATLASSIAN_EMAIL=${email}
ATLASSIAN_API_TOKEN=${token}

CLICKUP_TOKEN=${clickupToken}
CLICKUP_TEAM_ID=${clickupTeam}

# Key/id PREFIXES, e.g. STR for STR-3350
JIRA_PROJECT_KEYS=${keys}
CONFLUENCE_SPACE=${space}
CONFLUENCE_PARENT_ID=${parent}

GIT_NAME="${gitName}"
GIT_EMAIL=${gitEmail}

FORGE=${forge}
BITBUCKET_WORKSPACE=${bbWorkspace}
BITBUCKET_EMAIL=${bbEmail}
BITBUCKET_TOKEN=${bbToken}
GITHUB_TOKEN=${ghToken}
GITHUB_OWNER=${ghOwner}

DEFAULT_BASE_BRANCH=${base}
`;

  mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
  out(c.g(`\n✓ Wrote ${file}`));

  const root = G.repoRoot();
  if (root) {
    const link = await ask(
      `\nRoute ${root} and everything under it to "${name}"? y/n`,
      "y",
    );
    if (/^y/i.test(link)) {
      const cfg = readConfig();
      cfg.routes = (cfg.routes ?? []).filter((r) => r.match !== root);
      cfg.routes.push({ match: root, profile: name });
      writeConfig(cfg);
      out(c.g(`✓ Routed ${root} -> ${name}`));
    }
  }

  out(c.dim("\nNext: work doctor"));
};

commands.profiles = () => {
  const names = listProfiles();
  const cfg = readConfig();
  emit(
    { profiles: names, default: cfg.defaultProfile, routes: cfg.routes },
    () => {
      if (!names.length) return out(c.y("No profiles yet. Run: work setup"));
      out(c.b("\nProfiles"));
      for (const n of names)
        out(`  ${n}${cfg.defaultProfile === n ? c.g("  (default)") : ""}`);
      if (cfg.routes?.length) {
        out(c.b("\nRoutes"));
        for (const r of [...cfg.routes].sort((a, b) =>
          a.match.localeCompare(b.match),
        )) {
          out(
            `  ${r.match.replace(process.env.HOME, "~")}\n      -> ${r.profile}`,
          );
        }
      }
      if (cfg.defaultProfile) {
        out(
          c.y(
            `\n  Note: unrouted directories fall back to "${cfg.defaultProfile}".`,
          ),
        );
        out(
          c.dim(
            "  With repos spread across several accounts, prefer explicit routes and",
          ),
        );
        out(
          c.dim(
            "  no default, so an unconfigured repo fails loudly instead of acting as",
          ),
        );
        out(c.dim("  the wrong account. Clear it with: work default --none"));
      }
      out("");
    },
  );
};

commands.default = () => {
  const cfg = readConfig();
  if (flags.none) {
    cfg.defaultProfile = null;
    writeConfig(cfg);
    return out(
      c.g("✓ Default profile cleared — unrouted directories now fail loudly."),
    );
  }
  const name = positional[1];
  if (!name)
    throw new Error("Usage: work default <profile>   |   work default --none");
  if (!listProfiles().includes(name))
    throw new Error(`No such profile "${name}".`);
  cfg.defaultProfile = name;
  writeConfig(cfg);
  out(c.g(`✓ Default profile: ${name}`));
};

commands.which = () => {
  const cfg = resolveRepo(process.cwd(), { required: false });
  const { via } = resolveProfileName(process.cwd());
  const gitEmail = cfg.root
    ? G.git(["config", "user.email"], { allowFail: true })
    : null;

  emit(
    {
      profile: cfg.profile?.name ?? null,
      via,
      label: cfg.profile?.PROFILE_LABEL ?? null,
      repo: cfg.name,
      root: cfg.root,
      branch: cfg.branch,
      ticketKey: cfg.ticketKey,
      tracker: cfg.tracker,
      forge: cfg.forge,
      projectKeys: cfg.projectKeys,
      baseBranch: cfg.baseBranch,
      contextFile: cfg.contextFile,
      gitEmail: cfg.profile?.GIT_EMAIL ?? null,
      repoGitEmail: gitEmail,
      identityMismatch: Boolean(
        cfg.profile?.GIT_EMAIL &&
        gitEmail &&
        cfg.profile.GIT_EMAIL !== gitEmail,
      ),
      atlassian: cfg.profile ? atlassianVia(cfg.profile) : null,
    },
    (o) => {
      if (!o.profile) {
        out(c.y(`No profile applies to ${process.cwd()}`));
        out(c.dim("  work setup            create one"));
        out(
          c.dim(
            "  work route <profile>  map this directory to an existing one",
          ),
        );
        return;
      }
      out(`\n${c.b(o.profile)} ${c.dim(`(${o.label ?? ""})`)}`);
      out(`  ${"selected via".padEnd(14)}${o.via}`);
      out(`  ${"repo".padEnd(14)}${o.repo ?? c.dim("not a git repo")}`);
      out(`  ${"branch".padEnd(14)}${o.branch ?? c.dim("—")}`);
      out(
        `  ${"ticket".padEnd(14)}${o.ticketKey ?? c.dim("none in branch name")}`,
      );
      out(`  ${"tracker".padEnd(14)}${o.tracker}`);
      out(`  ${"forge".padEnd(14)}${o.forge ?? c.dim("detect from origin")}`);
      out(
        `  ${"keys".padEnd(14)}${o.projectKeys.join(", ") || c.dim("none configured")}`,
      );
      out(`  ${"base branch".padEnd(14)}${o.baseBranch ?? c.dim("detect")}`);
      out(
        `  ${"atlassian".padEnd(14)}${
          o.atlassian === "mcp"
            ? `${c.c("MCP")} ${c.dim("(no API token stored — commands hand off to the Atlassian MCP tools)")}`
            : o.atlassian === "token"
              ? `${"REST"} ${c.dim("(API token in profile)")}`
              : c.y("not configured")
        }`,
      );
      out(
        `  ${"context".padEnd(14)}${o.contextFile ? c.g(REPO_FILE) : c.y(`no ${REPO_FILE} — run: work init`)}`,
      );
      out(`  ${"git identity".padEnd(14)}${o.repoGitEmail ?? c.dim("unset")}`);
      if (o.identityMismatch) {
        out(
          c.r(
            `\n  ! This repo commits as ${o.repoGitEmail} but the profile expects ${o.gitEmail}.`,
          ),
        );
        out(c.dim(`    Fix: git config user.email ${o.gitEmail}`));
      }
      out("");
    },
  );
};

commands.route = () => {
  const name = positional[1];
  if (!name) throw new Error("Usage: work route <profile> [--path <dir>]");
  if (!listProfiles().includes(name))
    throw new Error(
      `No such profile "${name}". Have: ${listProfiles().join(", ") || "(none)"}`,
    );
  const path = flag("path") ?? G.repoRoot() ?? process.cwd();
  const cfg = readConfig();
  cfg.routes = (cfg.routes ?? []).filter((r) => r.match !== path);
  cfg.routes.push({ match: path, profile: name });
  writeConfig(cfg);
  out(c.g(`✓ ${path}  ->  ${name}`));
};

commands.init = async () => {
  const root = G.repoRoot();
  if (!root) throw new Error("Not inside a git repository.");
  const file = join(root, REPO_FILE);
  if (existsSync(file) && !flags.force)
    throw new Error(`${file} already exists. Pass --force to overwrite.`);

  const cfg = resolveRepo(process.cwd(), { required: false });
  const remote = (() => {
    try {
      return forges.detectRemote(root);
    } catch {
      return null;
    }
  })();

  const body = REPO_TEMPLATE.replaceAll("{{PROFILE}}", cfg.profile?.name ?? "")
    .replaceAll("{{TRACKER}}", cfg.tracker ?? "jira")
    .replaceAll("{{KEYS}}", cfg.projectKeys.join(", "))
    .replaceAll(
      "{{FORGE}}",
      remote?.forge && remote.forge !== "unknown" ? remote.forge : "",
    )
    .replaceAll("{{BASE}}", cfg.baseBranch ?? G.defaultBaseBranch(root))
    .replaceAll("{{NAME}}", basename(root));

  writeFileSync(file, body);
  out(c.g(`✓ Wrote ${file}`));

  const ex = ensureLocalExclude(root);
  if (ex.ok && ex.added.length)
    out(
      c.g(
        `✓ Excluded ${ex.added.join(", ")} via ${ex.file.replace(process.env.HOME, "~")}`,
      ),
    );

  out(
    c.dim(
      "\n  Fill in the body — it is what an agent reads before touching this repo.",
    ),
  );
  out(
    c.dim(
      "  It stays local: excluded per-clone, so it can never ride along in a commit.",
    ),
  );
};

// Onboard a whole tree at once. The unit of work in this setup is not a repo,
// it is an account holding dozens of them, and cloning a new one should not
// mean remembering a checklist.
commands.adopt = async () => {
  const dir = flag("path") ?? positional[1] ?? process.cwd();
  const found = findRepos(dir, { maxDepth: Number(flags.depth) || 3 });
  if (!found.length) throw new Error(`No git repositories under ${dir}`);

  const results = [];
  for (const { path } of found) {
    const r = {
      repo: basename(path),
      path,
      excluded: [],
      wrote: null,
      identity: "ok",
      signing: "ok",
    };
    const cfg = resolveRepo(path, { required: false });
    r.profile = cfg.profile?.name ?? null;

    if (!cfg.profile) {
      r.identity = "no profile";
      results.push(r);
      continue;
    }

    const ex = ensureLocalExclude(path);
    r.excluded = ex.added ?? [];

    if (!existsSync(join(path, REPO_FILE))) {
      const remote = (() => {
        try {
          return forges.detectRemote(path);
        } catch {
          return null;
        }
      })();
      const body = REPO_TEMPLATE.replaceAll("{{PROFILE}}", cfg.profile.name)
        .replaceAll("{{TRACKER}}", cfg.tracker ?? "jira")
        .replaceAll("{{KEYS}}", cfg.projectKeys.join(", "))
        .replaceAll(
          "{{FORGE}}",
          remote?.forge && remote.forge !== "unknown" ? remote.forge : "",
        )
        // Per repo, not per account: sibling repos in one org routinely disagree
        // about main vs master, and guessing wrong branches off the wrong base.
        .replaceAll("{{BASE}}", G.defaultBaseBranch(path))
        .replaceAll("{{NAME}}", basename(path));
      writeFileSync(join(path, REPO_FILE), body);
      r.wrote = REPO_FILE;
    }

    const email = G.git(["config", "user.email"], {
      cwd: path,
      allowFail: true,
    });
    if (cfg.profile.GIT_EMAIL && email !== cfg.profile.GIT_EMAIL)
      r.identity = `${email ?? "unset"} != ${cfg.profile.GIT_EMAIL}`;
    if (cfg.profile.GIT_SIGNING_KEY || cfg.profile.GIT_SIGN === "true") {
      if (
        G.git(["config", "commit.gpgsign"], { cwd: path, allowFail: true }) !==
        "true"
      )
        r.signing = "off";
    }
    results.push(r);
  }

  emit({ dir, repos: results }, () => {
    out(
      `\n${c.b(`${results.length} repo(s)`)} ${c.dim(`under ${dir.replace(process.env.HOME, "~")}`)}\n`,
    );
    const w = Math.min(34, Math.max(...results.map((r) => r.repo.length)) + 2);
    for (const r of results) {
      const notes = [
        r.wrote ? c.g(`wrote ${r.wrote}`) : c.dim(`${REPO_FILE} exists`),
        r.excluded.length
          ? c.g(`excluded ${r.excluded.length}`)
          : c.dim("already excluded"),
        r.identity === "ok" ? "" : c.r(`identity ${r.identity}`),
        r.signing === "ok" ? "" : c.r("unsigned"),
      ].filter(Boolean);
      out(
        `  ${c.b(r.repo.padEnd(w))}${c.dim((r.profile ?? "—").padEnd(10))}${notes.join(c.dim(" · "))}`,
      );
    }
    const broken = results.filter(
      (r) => r.identity !== "ok" || r.signing !== "ok",
    );
    out("");
    if (broken.length) {
      out(
        c.r(
          `  ${broken.length} repo(s) would commit as the wrong author or without a signature.`,
        ),
      );
      out(
        c.dim(
          "  These are git-level settings; adopt reports them but will not rewrite your git config.",
        ),
      );
      out(
        c.dim(
          "  The durable fix is one includeIf in ~/.gitconfig covering this whole tree.",
        ),
      );
    } else {
      out(c.g("  Every repo commits as the right author, signed."));
    }
    out("");
  });
};

commands.context = () => {
  const root = G.repoRoot();
  if (!root) throw new Error("Not inside a git repository.");
  const { file, front, context } = readRepoFile(root);

  emit({ file, config: front, context }, () => {
    if (!file) {
      out(c.y(`No ${REPO_FILE} in ${root}`));
      out(c.dim("  Create one with: work init"));
      return;
    }
    if (!context) {
      out(c.y(`${REPO_FILE} has config but no context body yet.`));
      return;
    }
    out(context);
  });
};

commands.repos = () => {
  const dir = positional[1] ?? process.cwd();
  const found = findRepos(dir, { maxDepth: Number(flags.depth) || 3 });
  const rows = found.map((r) => describeRepo(r.path));

  emit({ dir, repos: rows }, () => {
    if (!rows.length) return out(c.y(`\nNo git repositories under ${dir}\n`));
    out(
      `\n${c.b(`${rows.length} repo(s)`)} ${c.dim(`under ${dir.replace(process.env.HOME, "~")}`)}\n`,
    );

    const w = Math.min(34, Math.max(...rows.map((r) => r.name.length)) + 2);
    for (const r of rows) {
      const marks = [
        r.dirty ? c.y("dirty") : "",
        r.identityMismatch ? c.r("identity!") : "",
        r.configured ? "" : c.dim("no .work.md"),
      ]
        .filter(Boolean)
        .join(" ");

      out(
        `  ${c.b(r.name.padEnd(w))}${c.dim((r.profile ?? "—").padEnd(12))}${(r.ticketKey ?? "").padEnd(12)}${r.branch ?? ""}` +
          (marks ? `\n  ${" ".repeat(w)}${marks}` : ""),
      );
    }

    const unconfigured = rows.filter((r) => !r.configured).length;
    const mismatched = rows.filter((r) => r.identityMismatch).length;
    out("");
    if (mismatched)
      out(
        c.r(
          `  ${mismatched} repo(s) commit as an email that doesn't match their profile.`,
        ),
      );
    if (unconfigured)
      out(
        c.dim(
          `  ${unconfigured} repo(s) have no ${REPO_FILE} — run \`work init\` in each.`,
        ),
      );
    out("");
  });
};

commands.doctor = async () => {
  const cfg = repo();
  const p = cfg.profile;
  out(
    `${c.b("Profile")}  ${p.name} ${c.dim(`(${p.PROFILE_LABEL ?? ""}, via ${p.via})`)}`,
  );
  out(
    `${c.b("Repo")}     ${cfg.name ?? "—"}  ${c.dim(`tracker=${cfg.tracker} forge=${cfg.forge ?? "auto"}`)}`,
  );
  let failures = 0;

  const step = async (label, fn) => {
    process.stdout.write(`  ${label.padEnd(22)}`);
    try {
      out(c.g("✓ ") + (await fn()));
    } catch (e) {
      failures++;
      // Show the whole message — the actionable part of an auth failure is
      // almost always on the second line, and truncating it wastes the check.
      const [first, ...rest] = String(e.message).split("\n");
      out(c.r("✗ ") + first);
      for (const line of rest) out(c.dim("      " + line.replace(/^\s+/, "")));
    }
  };

  // In MCP mode there is nothing here to authenticate: the credentials belong
  // to the agent's MCP session, not to this process. Checking config is the
  // most this command can honestly do, so it says so rather than reporting a
  // green tick it did not earn.
  const via = atlassianVia(p);
  if (via === "mcp") {
    await step("atlassian", async () => {
      const id = mcpCloudId(p);
      return `${c.c("via MCP")} ${c.dim(`cloudId=${id}`)}\n      ${c.dim("not reachable from this process — verify with the Atlassian MCP tools")}`;
    });
  } else {
    await step(cfg.tracker, async () => {
      const me = await getTracker(cfg).whoami(cfg);
      return `${me.name}${me.email ? ` <${me.email}>` : ""}`;
    });
    if (p.ATLASSIAN_SITE) {
      await step(
        "Confluence",
        async () =>
          `${(await confluence.listSpaces(p)).length} space(s) visible`,
      );
    }
  }

  await step("forge", async () => {
    const me = await forges.whoami(cfg);
    // A shared `gh` session is the failure mode this whole profile system
    // exists to prevent: it is global state, so the account that opens the PR
    // is whichever one was switched to last, not the one this repo belongs to.
    if (me.via?.startsWith("gh CLI") && p.GITHUB_OWNER) {
      throw new Error(
        `falling back to the gh CLI, signed in as ${me.login} — PRs for ${p.GITHUB_OWNER} would be opened by that account.\n` +
          `Set GITHUB_TOKEN in ${p.file} to a PAT on the account that owns this work.`,
      );
    }
    return `${me.forge}: ${me.name}${me.via ? c.dim(` (${me.via})`) : ""}`;
  });

  await step("git identity", async () => {
    if (!p.GIT_EMAIL) throw new Error("GIT_EMAIL not set in profile");
    if (!cfg.root) return `${p.GIT_NAME} <${p.GIT_EMAIL}> (not in a repo)`;
    const actual = G.git(["config", "user.email"], { allowFail: true });
    if (actual && actual !== p.GIT_EMAIL)
      throw new Error(`repo commits as ${actual}, profile says ${p.GIT_EMAIL}`);
    return `${p.GIT_NAME} <${p.GIT_EMAIL}>`;
  });

  if (p.GIT_SIGNING_KEY || p.GIT_SIGN === "true") {
    await step("commit signing", async () => {
      if (!cfg.root) throw new Error("not in a repo");
      const on = G.git(["config", "commit.gpgsign"], { allowFail: true });
      const key = G.git(["config", "user.signingkey"], { allowFail: true });
      const fmt = G.git(["config", "gpg.format"], { allowFail: true });
      if (on !== "true")
        throw new Error(
          "commit.gpgsign is not true here — commits would land unverified",
        );
      if (!key)
        throw new Error("commit.gpgsign is on but user.signingkey is unset");
      if (p.GIT_SIGNING_KEY && key !== p.GIT_SIGNING_KEY) {
        throw new Error(
          `signing with ${key}, profile expects ${p.GIT_SIGNING_KEY}`,
        );
      }
      return `${fmt ?? "gpg"} ${c.dim(key)}`;
    });
  }

  // The profile's own footprint must never reach a commit. This is a promise
  // the tool makes about itself, so it is worth a check rather than a comment.
  await step("never committed", async () => {
    if (!cfg.root) throw new Error("not in a repo");
    // check-ignore exits 0 and echoes the path when ignored; git() returns null
    // on the non-zero exit that means "this file is fair game for a commit".
    const exposed = WORK_ARTIFACTS.filter(
      (f) =>
        G.git(["check-ignore", f], { allowFail: true, cwd: cfg.root }) === null,
    );
    if (exposed.length) {
      throw new Error(
        `${exposed.join(", ")} could be committed from this repo.\n` +
          `Fix it without touching the tracked .gitignore:  work adopt --path ${cfg.root}`,
      );
    }
    return `${WORK_ARTIFACTS.join(", ")} are ignored locally`;
  });

  await step("project keys", async () => {
    if (!cfg.projectKeys.length)
      throw new Error(
        `none set — key detection from branch names will not work`,
      );
    return cfg.projectKeys.join(", ");
  });

  await step("repo context", async () => {
    if (!cfg.contextFile) throw new Error(`no ${REPO_FILE} — run: work init`);
    return `${REPO_FILE} (${cfg.context.split("\n").length} lines)`;
  });

  await step("attribution guard", async () => {
    if (!existsSync(join(HERE, "hooks", "pretooluse-guard.sh")))
      throw new Error("guard script missing");
    const settings = join(process.env.HOME, ".claude", "settings.json");
    const s = existsSync(settings) ? readFileSync(settings, "utf8") : "";
    if (!s.includes("pretooluse-guard"))
      throw new Error(
        "not wired into ~/.claude/settings.json — run install.sh",
      );
    return "wired into Claude Code";
  });

  out(
    failures
      ? c.r(`\n${failures} check(s) failed.`)
      : c.g("\nAll checks passed."),
  );
  process.exitCode = failures ? 1 : 0;
};

commands.ticket = async () => {
  const cfg = repo();
  const t = await getTracker(cfg).getIssue(cfg, resolveKey(cfg, positional[1]));

  emit(t, () => {
    out(`\n${c.b(t.key)}  ${t.summary}`);
    out(c.dim(t.url));
    out("");
    out(`  ${"type".padEnd(11)}${t.type}`);
    out(`  ${"status".padEnd(11)}${c.c(t.status)}`);
    if (t.priority) out(`  ${"priority".padEnd(11)}${t.priority}`);
    if (t.assignee) out(`  ${"assignee".padEnd(11)}${t.assignee}`);
    if (t.parent)
      out(
        `  ${"parent".padEnd(11)}${t.parent.key}${t.parent.summary ? ` — ${t.parent.summary}` : ""}`,
      );
    if (t.labels?.length) out(`  ${"labels".padEnd(11)}${t.labels.join(", ")}`);
    if (t.components?.length)
      out(`  ${"components".padEnd(11)}${t.components.join(", ")}`);
    if (t.links?.length)
      out(
        `  ${"links".padEnd(11)}${t.links.map((l) => `${l.type} ${l.key}`).join(", ")}`,
      );

    if (t.description) {
      out(`\n${c.b("Description")}`);
      out(
        t.description
          .split("\n")
          .map((l) => "  " + l)
          .join("\n"),
      );
    }
    if (t.subtasks?.length) {
      out(`\n${c.b("Subtasks")}`);
      for (const s of t.subtasks)
        out(
          `  ${String(s.key).padEnd(12)} ${c.dim(`[${s.status}]`)} ${s.summary}`,
        );
    }
    if (t.comments?.length) {
      out(`\n${c.b("Comments")} ${c.dim(`(last ${t.comments.length})`)}`);
      for (const cm of t.comments) {
        out(
          `\n  ${c.c(cm.author ?? "unknown")} ${c.dim(cm.created ? new Date(cm.created).toLocaleString() : "")}`,
        );
        out(
          cm.body
            .split("\n")
            .map((l) => "    " + l)
            .join("\n"),
        );
      }
    }
    out("");
  });
};

commands.mine = async () => {
  const cfg = repo();
  const { query, issues } = await getTracker(cfg).search(cfg, {
    limit: Number(flags.limit) || 25,
    status: flag("status"),
    jql: flag("jql"),
  });

  emit({ query, issues }, () => {
    if (!issues.length) return out(c.y("\nNothing assigned to you matches.\n"));
    out(`\n${c.b(`${issues.length} ticket(s)`)} ${c.dim(query)}\n`);
    for (const i of issues)
      out(
        `  ${c.c(String(i.key).padEnd(12))} ${c.dim(`[${i.status}]`.padEnd(16))} ${i.summary}`,
      );
    out("");
  });
};

function branchNameFor(cfg, ticket) {
  return cfg.branchTemplate
    .replace("{type}", G.branchPrefix(ticket.type))
    .replace("{key}", ticket.key)
    .replace("{slug}", G.slug(ticket.summary));
}

commands.branch = async () => {
  const cfg = repo();
  const t = await getTracker(cfg).getIssue(cfg, resolveKey(cfg, positional[1]));
  emit({ branch: branchNameFor(cfg, t), key: t.key }, (o) => out(o.branch));
};

commands.start = async () => {
  const cfg = repo();
  const p = cfg.profile;
  const t = await getTracker(cfg).getIssue(cfg, resolveKey(cfg, positional[1]));
  const branch = branchNameFor(cfg, t);
  if (!cfg.root) throw new Error("Not inside a git repository.");

  const base = flag("base") ?? cfg.baseBranch ?? G.defaultBaseBranch();

  if (G.isDirty() && !flags.force) {
    throw new Error(
      `Working tree is dirty. Commit or stash first, or pass --force.\n\n${G.git(["status", "--short"])}`,
    );
  }

  // Identity before branch: every commit on it must carry this account's author,
  // and this is the cheapest moment to guarantee that.
  if (p.GIT_NAME) G.git(["config", "user.name", p.GIT_NAME]);
  if (p.GIT_EMAIL) G.git(["config", "user.email", p.GIT_EMAIL]);

  if (G.git(["rev-parse", "--verify", branch], { allowFail: true })) {
    G.git(["checkout", branch]);
    out(c.y(`Branch already existed — checked out ${c.b(branch)}`));
  } else {
    G.git(["fetch", "origin", base], { allowFail: true });
    const startPoint = G.git(["rev-parse", "--verify", `origin/${base}`], {
      allowFail: true,
    })
      ? `origin/${base}`
      : base;
    G.git(["checkout", "-b", branch, startPoint]);
    out(c.g(`✓ Created ${c.b(branch)} from ${startPoint}`));
  }

  out(`  ${c.dim("ticket")}    ${t.key} — ${t.summary}`);
  out(`  ${c.dim("status")}    ${t.status}`);
  out(`  ${c.dim("identity")}  ${p.GIT_NAME} <${p.GIT_EMAIL}>`);
  out(c.dim(`\n  ${t.url}`));
};

commands.comment = async () => {
  const cfg = repo();
  const key = resolveKey(cfg, positional[1]);
  const res = await getTracker(cfg).addComment(
    cfg,
    key,
    bodyFromFlags("comment body"),
  );
  emit({ key, ...res }, (o) =>
    out(c.g(`✓ Commented on ${key}`) + `\n  ${c.dim(o.url ?? "")}`),
  );
};

commands.transitions = async () => {
  const cfg = repo();
  const key = resolveKey(cfg, positional[1]);
  const list = await getTracker(cfg).getTransitions(cfg, key);
  emit({ key, transitions: list }, () => {
    out(`\n${c.b(key)} can move to:`);
    for (const t of list)
      out(`  ${t.name}${t.to && t.to !== t.name ? c.dim(`  -> ${t.to}`) : ""}`);
    out("");
  });
};

commands.move = async () => {
  const cfg = repo();
  const looksLikeKey = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(positional[1] ?? "");
  const key = resolveKey(cfg, looksLikeKey ? positional[1] : undefined);
  const target = (
    looksLikeKey ? positional.slice(2) : positional.slice(1)
  ).join(" ");
  if (!target) throw new Error("Usage: work move [KEY] <status>");

  const t = await getTracker(cfg).transition(cfg, key, target);
  emit({ key, transition: t }, () => out(c.g(`✓ ${key} -> ${t.to}`)));
};

commands.worklog = async () => {
  const cfg = repo();
  const looksLikeKey = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(positional[1] ?? "");
  const key = resolveKey(cfg, looksLikeKey ? positional[1] : undefined);
  const time = looksLikeKey ? positional[2] : positional[1];
  if (!time)
    throw new Error("Usage: work worklog [KEY] <time>   e.g. work worklog 2h");
  await getTracker(cfg).worklog(cfg, key, time, flag("body") ?? undefined);
  out(c.g(`✓ Logged ${time} on ${key}`));
};

commands.create = async () => {
  const cfg = repo();
  const project = positional[1];
  if (!project)
    throw new Error(
      'Usage: work create <project> --type <type> --summary "..."',
    );

  const type = flag("type") ?? "Task";
  const summary = flag("summary");
  if (!summary) throw new Error("--summary is required");

  const opts = { project, type, summary };
  if (flag("description")) opts.description = flag("description");
  if (flag("priority")) opts.priority = flag("priority");
  if (flag("labels"))
    opts.labels = flag("labels")
      .split(",")
      .map((l) => l.trim());
  if (flag("parent")) opts.parent = flag("parent");
  if (flag("assignee")) opts.assignee = flag("assignee");

  const res = await getTracker(cfg).createIssue(cfg, opts);
  emit(res, (o) => {
    out(c.g(`✓ Created ${c.b(o.key)}`));
    out(`  ${c.dim(o.url)}`);
  });
};

commands.assign = async () => {
  const cfg = repo();
  const looksLikeKey = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(positional[1] ?? "");
  const key = resolveKey(cfg, looksLikeKey ? positional[1] : undefined);
  const userQuery = looksLikeKey ? positional[2] : positional[1];

  if (!userQuery)
    throw new Error(
      "Usage: work assign [KEY] <user>   (email, name, or accountId)",
    );

  // If it looks like an accountId, use directly; otherwise search
  let accountId = userQuery;
  if (!userQuery.includes(":")) {
    const users = await getTracker(cfg).searchUsers(cfg, userQuery, {
      limit: 5,
    });
    if (!users.length)
      throw new Error(`No users found matching "${userQuery}"`);
    if (users.length === 1) {
      accountId = users[0].accountId;
      out(c.dim(`  Found: ${users[0].name} <${users[0].email ?? "no email"}>`));
    } else {
      out(c.y(`Multiple users match "${userQuery}":`));
      for (const u of users)
        out(`  ${c.c(u.accountId)}  ${u.name}  ${c.dim(u.email ?? "")}`);
      throw new Error(
        "Specify the accountId directly, or use a more specific query.",
      );
    }
  }

  await getTracker(cfg).assignIssue(cfg, key, accountId);
  out(c.g(`✓ Assigned ${key}`));
};

commands.update = async () => {
  const cfg = repo();
  const key = resolveKey(cfg, positional[1]);

  const fields = {};
  if (flag("summary")) fields.summary = flag("summary");
  if (flag("description")) fields.description = flag("description");
  if (flag("priority")) fields.priority = flag("priority");
  if (flag("labels"))
    fields.labels = flag("labels")
      .split(",")
      .map((l) => l.trim());
  if (flag("add-labels"))
    fields.addLabels = flag("add-labels")
      .split(",")
      .map((l) => l.trim());
  if (flag("remove-labels"))
    fields.removeLabels = flag("remove-labels")
      .split(",")
      .map((l) => l.trim());

  if (!Object.keys(fields).length) {
    throw new Error(
      'Usage: work update [KEY] --summary "..." [--description, --priority, --labels, --add-labels, --remove-labels]',
    );
  }

  const res = await getTracker(cfg).updateIssue(cfg, key, fields);
  emit(res, (o) => out(c.g(`✓ Updated ${key}: ${o.updated.join(", ")}`)));
};

commands["link-ticket"] = async () => {
  const cfg = repo();
  const key1 = positional[1];
  const key2 = positional[2];
  if (!key1 || !key2)
    throw new Error('Usage: work link-ticket <KEY1> <KEY2> [--type "blocks"]');

  const linkType = flag("type") ?? "Relates";

  // Show available link types if requested
  if (flags["list-types"]) {
    const types = await getTracker(cfg).getLinkTypes(cfg);
    emit({ types }, () => {
      out(c.b("\nAvailable link types:"));
      for (const t of types)
        out(
          `  ${c.c(t.name.padEnd(20))} ${c.dim(`inward: "${t.inward}", outward: "${t.outward}"`)}`,
        );
      out("");
    });
    return;
  }

  await getTracker(cfg).linkIssues(cfg, key1, key2, linkType);
  out(c.g(`✓ Linked ${key1} ${c.dim(`--[${linkType}]-->`)} ${key2}`));
};

commands.users = async () => {
  const cfg = repo();
  const query = positional[1];
  if (!query)
    throw new Error("Usage: work users <query>   (search by name or email)");

  const users = await getTracker(cfg).searchUsers(cfg, query, {
    limit: Number(flags.limit) || 20,
  });
  emit({ query, users }, () => {
    if (!users.length) return out(c.y(`\nNo users matching "${query}"\n`));
    out(`\n${c.b(`${users.length} user(s)`)} matching "${query}"\n`);
    for (const u of users) {
      const status = u.active ? "" : c.r(" (inactive)");
      out(`  ${c.c(u.accountId)}`);
      out(`    ${u.name}${status}  ${c.dim(u.email ?? "")}`);
    }
    out("");
  });
};

commands.projects = async () => {
  const cfg = repo();
  const projects = await getTracker(cfg).getProjects(cfg);
  emit({ projects }, () => {
    if (!projects.length) return out(c.y("\nNo projects visible.\n"));
    out(`\n${c.b(`${projects.length} project(s)`)}\n`);
    for (const p of projects) {
      out(
        `  ${c.c(p.key.padEnd(10))} ${p.name}  ${c.dim(`lead: ${p.lead ?? "—"}`)}`,
      );
    }
    out("");
  });
};

commands.boards = async () => {
  const cfg = repo();
  const opts = {};
  if (flag("project")) opts.projectKey = flag("project");
  if (flag("type")) opts.type = flag("type");

  const boards = await getTracker(cfg).getBoards(cfg, opts);
  emit({ boards }, () => {
    if (!boards.length) return out(c.y("\nNo boards found.\n"));
    out(`\n${c.b(`${boards.length} board(s)`)}\n`);
    for (const b of boards) {
      out(
        `  ${c.c(String(b.id).padEnd(8))} ${b.name}  ${c.dim(`type=${b.type} project=${b.projectKey ?? "—"}`)}`,
      );
    }
    out("");
  });
};

commands.sprints = async () => {
  const cfg = repo();
  const boardId = positional[1];
  if (!boardId)
    throw new Error(
      "Usage: work sprints <boardId> [--state active,future,closed]",
    );

  const opts = {};
  if (flag("state")) opts.state = flag("state");

  const sprints = await getTracker(cfg).getSprints(cfg, boardId, opts);
  emit({ boardId, sprints }, () => {
    if (!sprints.length) return out(c.y(`\nNo sprints on board ${boardId}.\n`));
    out(`\n${c.b(`${sprints.length} sprint(s)`)} on board ${boardId}\n`);
    for (const s of sprints) {
      const dates = s.startDate
        ? `${s.startDate.slice(0, 10)} → ${s.endDate?.slice(0, 10) ?? "?"}`
        : "";
      out(
        `  ${c.c(String(s.id).padEnd(8))} ${c.dim(`[${s.state}]`.padEnd(10))} ${s.name}  ${c.dim(dates)}`,
      );
      if (s.goal) out(`    ${c.dim("goal:")} ${s.goal}`);
    }
    out("");
  });
};

commands.backlog = async () => {
  const cfg = repo();
  const boardId = positional[1];
  if (!boardId) throw new Error("Usage: work backlog <boardId> [--limit 50]");

  const issues = await getTracker(cfg).getBoardBacklog(cfg, boardId, {
    limit: Number(flags.limit) || 50,
  });
  emit({ boardId, issues }, () => {
    if (!issues.length)
      return out(c.y(`\nNo backlog items on board ${boardId}.\n`));
    out(`\n${c.b(`${issues.length} backlog item(s)`)} on board ${boardId}\n`);
    for (const i of issues) {
      out(
        `  ${c.c(i.key.padEnd(12))} ${c.dim(`[${i.status}]`.padEnd(16))} ${i.summary}`,
      );
    }
    out("");
  });
};

commands["sprint-issues"] = async () => {
  const cfg = repo();
  const sprintId = positional[1];
  if (!sprintId)
    throw new Error("Usage: work sprint-issues <sprintId> [--limit 50]");

  const issues = await getTracker(cfg).getSprintIssues(cfg, sprintId, {
    limit: Number(flags.limit) || 50,
  });
  emit({ sprintId, issues }, () => {
    if (!issues.length) return out(c.y(`\nNo issues in sprint ${sprintId}.\n`));
    out(`\n${c.b(`${issues.length} issue(s)`)} in sprint ${sprintId}\n`);
    for (const i of issues) {
      const points = i.storyPoints ? c.dim(` [${i.storyPoints}pt]`) : "";
      out(
        `  ${c.c(i.key.padEnd(12))} ${c.dim(`[${i.status}]`.padEnd(16))} ${i.summary}${points}`,
      );
    }
    out("");
  });
};

commands["issue-types"] = async () => {
  const cfg = repo();
  const project = positional[1] ?? cfg.projectKeys[0];
  if (!project)
    throw new Error(
      "Usage: work issue-types <project>   (or configure project_keys)",
    );

  const types = await getTracker(cfg).getIssueTypes(cfg, project);
  emit({ project, types }, () => {
    out(`\n${c.b("Issue types")} for ${project}\n`);
    for (const t of types) {
      const sub = t.subtask ? c.dim(" (subtask)") : "";
      out(`  ${c.c(t.name.padEnd(20))}${sub}  ${c.dim(t.description ?? "")}`);
    }
    out("");
  });
};

commands.priorities = async () => {
  const cfg = repo();
  const priorities = await getTracker(cfg).getPriorities(cfg);
  emit({ priorities }, () => {
    out(`\n${c.b("Priorities")}\n`);
    for (const p of priorities) out(`  ${c.c(p.name)}`);
    out("");
  });
};

commands.watchers = async () => {
  const cfg = repo();
  const key = resolveKey(cfg, positional[1]);
  const res = await getTracker(cfg).getWatchers(cfg, key);
  emit({ key, ...res }, () => {
    out(
      `\n${c.b(key)} — ${res.count} watcher(s)${res.isWatching ? c.g(" (you are watching)") : ""}\n`,
    );
    for (const w of res.watchers) out(`  ${w.name}  ${c.dim(w.accountId)}`);
    out("");
  });
};

commands.watch = async () => {
  const cfg = repo();
  const key = resolveKey(cfg, positional[1]);
  const me = await getTracker(cfg).whoami(cfg);
  await getTracker(cfg).addWatcher(cfg, key, me.id);
  out(c.g(`✓ Now watching ${key}`));
};

commands.unwatch = async () => {
  const cfg = repo();
  const key = resolveKey(cfg, positional[1]);
  const me = await getTracker(cfg).whoami(cfg);
  await getTracker(cfg).removeWatcher(cfg, key, me.id);
  out(c.g(`✓ Stopped watching ${key}`));
};

// Scaffold a PR description from the ticket and the branch diff. "How to verify"
// and "Notes for review" are left empty on purpose — a reviewer opens the PR for
// those two, and only the author can fill them.
async function buildPrBody(cfg, key) {
  const ticket = await getTracker(cfg).getIssue(cfg, key);
  const base = flag("base") ?? cfg.baseBranch ?? G.defaultBaseBranch();
  const ref = G.git(["rev-parse", "--verify", `origin/${base}`], {
    allowFail: true,
  })
    ? `origin/${base}`
    : base;

  const commits = G.commitsSince(ref);
  const stat = G.diffStat(ref).trim();

  const lines = [];
  lines.push(`## ${ticket.key} — ${ticket.summary}`, "");
  if (ticket.url) lines.push(ticket.url, "");
  if (ticket.description)
    lines.push("## Context", "", ticket.description.trim(), "");
  if (commits.length) {
    lines.push("## What changed", "");
    for (const cm of commits) lines.push(`- ${cm.subject}`);
    lines.push("");
  }
  if (stat) lines.push("## Files", "", "```", stat, "```", "");
  lines.push("## How to verify", "", "## Notes for review", "");

  return { markdown: scrub(lines.join("\n")), ticket, base };
}

commands["pr-body"] = async () => {
  const cfg = repo();
  const { markdown } = await buildPrBody(cfg, resolveKey(cfg, positional[1]));
  if (JSON_OUT) out(JSON.stringify({ body: markdown }, null, 2));
  else out(markdown);
};

commands.pr = async () => {
  const cfg = repo();
  const key = resolveKey(cfg, positional[1]);
  const branch = G.currentBranch();
  const { markdown, ticket, base } = await buildPrBody(cfg, key);

  const title = flag("title") ?? `${ticket.key} ${ticket.summary}`;
  const body =
    flags.file || flags.body || flags.stdin
      ? bodyFromFlags("PR description")
      : markdown;

  if (!flags.yes) {
    out(
      `\n${c.y("Preview only.")} Re-run with ${c.b("--yes")} to open the pull request.\n`,
    );
    out(`  ${c.dim("forge")}   ${cfg.forge ?? forges.detectRemote().forge}`);
    out(`  ${c.dim("source")}  ${branch}`);
    out(`  ${c.dim("target")}  ${base}`);
    out(`  ${c.dim("title")}   ${title}\n`);
    out(body);
    return;
  }

  if (
    G.git(["rev-list", "--count", `origin/${branch}..${branch}`], {
      allowFail: true,
    }) === null
  ) {
    out(
      c.y(
        `Note: ${branch} has no upstream yet — push it before reviewers can see the PR.`,
      ),
    );
  }

  const res = await forges.createPullRequest(cfg, {
    title,
    body,
    source: branch,
    target: base,
    cwd: process.cwd(),
  });
  out(
    res.existing
      ? c.y(`PR already open: ${res.url}`)
      : c.g(`✓ Opened ${res.url}`),
  );

  if (!flags["no-link"]) {
    try {
      await getTracker(cfg).addLink(cfg, ticket.key, {
        url: res.url,
        title,
        summary: `Pull request on ${branch}`,
      });
      out(c.g(`✓ Linked to ${ticket.key}`));
    } catch (e) {
      out(
        c.y(
          `Could not attach the link to ${ticket.key}: ${e.message.split("\n")[0]}`,
        ),
      );
    }
  }
};

commands.prs = async () => {
  const cfg = repo();
  const list = await forges.listPullRequests(cfg, { cwd: process.cwd() });
  emit({ pullRequests: list }, () => {
    if (!list.length) return out(c.y("\nNo open pull requests.\n"));
    out("");
    for (const pr of list)
      out(
        `  ${c.c(`#${pr.id}`.padEnd(7))} ${pr.title}\n           ${c.dim(pr.branch ?? "")}  ${c.dim(pr.url)}`,
      );
    out("");
  });
};

commands.link = async () => {
  const cfg = repo();
  const key = resolveKey(cfg, positional[1]);
  const url = flag("url");
  if (!url)
    throw new Error('Usage: work link [KEY] --url <url> [--title "..."]');
  await getTracker(cfg).addLink(cfg, key, { url, title: flag("title") ?? url });
  out(c.g(`✓ Linked ${url} to ${key}`));
};

commands.spaces = async () => {
  const cfg = repo();
  const list = await confluence.listSpaces(cfg.profile);
  emit({ spaces: list }, () => {
    out("");
    for (const s of list)
      out(`  ${c.c(s.key.padEnd(14))} ${s.name}  ${c.dim(`id=${s.id}`)}`);
    out("");
  });
};

function templateNames() {
  try {
    return readdirSync(join(HERE, "templates"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

commands.doc = async () => {
  const cfg = repo();
  const templateName = positional[1];
  if (!templateName)
    throw new Error(
      `Usage: work doc <template> [KEY] --yes\nTemplates: ${templateNames().join(", ")}`,
    );

  const templateFile = join(HERE, "templates", `${templateName}.md`);
  let markdown;
  if (flag("file")) markdown = readFileSync(flag("file"), "utf8");
  else if (existsSync(templateFile))
    markdown = readFileSync(templateFile, "utf8");
  else
    throw new Error(
      `No template "${templateName}" and no --file given.\nTemplates: ${templateNames().join(", ")}`,
    );

  const key = positional[2] ?? cfg.ticketKey;
  let ticket = null;
  if (key) {
    // In MCP mode this process cannot fetch the ticket, but rendering the
    // template is the part that actually needs this CLI — so accept the ticket
    // the caller already has rather than dead-ending. The agent fetches it
    // once via the MCP tool and pipes it straight back in.
    const fed = flag("ticket-json");
    if (fed) {
      const raw =
        fed === "-" ? readFileSync(0, "utf8") : readFileSync(fed, "utf8");
      const t = JSON.parse(raw);
      // Accept either this CLI's shape or a raw Jira issue as the MCP tool
      // returns it, so the agent never has to reshape anything by hand.
      const f = t.fields ?? {};
      ticket = {
        key: t.key ?? key,
        summary: t.summary ?? f.summary ?? "",
        url:
          t.url ??
          t.webUrl ??
          `https://${(cfg.profile.ATLASSIAN_SITE ?? "").replace(/^https?:\/\//, "")}/browse/${t.key ?? key}`,
        status: t.status ?? f.status?.name ?? "",
        description:
          t.description ??
          (typeof f.description === "string" ? f.description : ""),
      };
    } else {
      ticket = await getTracker(cfg).getIssue(cfg, key);
    }
    markdown = markdown
      .replaceAll("{{KEY}}", ticket.key)
      .replaceAll("{{SUMMARY}}", ticket.summary)
      .replaceAll("{{URL}}", ticket.url)
      .replaceAll("{{STATUS}}", ticket.status ?? "")
      .replaceAll("{{DESCRIPTION}}", ticket.description ?? "");
  }
  markdown = markdown
    .replaceAll("{{BRANCH}}", cfg.branch ?? "")
    .replaceAll("{{REPO}}", cfg.name ?? "");

  // Confluence shows the title separately, so an H1 in the body duplicates it.
  const h1 = markdown.match(/^#\s+(.+)$/m);
  const title = flag("title") ?? (h1 ? h1[1] : String(key ?? templateName));
  if (h1) markdown = markdown.replace(/^#\s+.+$/m, "").trimStart();

  const spaceKey = flag("space") ?? cfg.docSpace;
  if (!spaceKey)
    throw new Error(
      `No Confluence space. Pass --space KEY, set doc_space in ${REPO_FILE}, or CONFLUENCE_SPACE in the profile.`,
    );
  const parentId = flag("parent") ?? cfg.docParent ?? null;

  if (!flags.yes) {
    out(`\n${c.y("Preview only.")} Re-run with ${c.b("--yes")} to publish.\n`);
    out(`  ${c.dim("space")}   ${spaceKey}`);
    out(`  ${c.dim("parent")}  ${parentId || "(space root)"}`);
    out(`  ${c.dim("title")}   ${title}\n`);
    out(markdown);
    return;
  }

  const page = await confluence.upsertPage(cfg.profile, {
    spaceKey,
    title,
    markdown,
    parentId,
  });
  out(
    c.g(`✓ ${page.action === "created" ? "Created" : "Updated"} ${page.url}`),
  );

  if (ticket && !flags["no-link"]) {
    try {
      await getTracker(cfg).addLink(cfg, ticket.key, {
        url: page.url,
        title: page.title,
        summary: "Documentation",
      });
      out(c.g(`✓ Linked to ${ticket.key}`));
    } catch (e) {
      out(
        c.y(
          `Could not attach the link to ${ticket.key}: ${e.message.split("\n")[0]}`,
        ),
      );
    }
  }
};

commands.scrub = () => {
  const file = positional[1];
  const text =
    file && file !== "-" ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  const cleaned = scrub(text);
  if (file && file !== "-" && flags.write) {
    writeFileSync(file, cleaned);
    out(c.g(`✓ Scrubbed ${file}`));
  } else process.stdout.write(cleaned);
};

commands.check = () => {
  const file = positional[1];
  const text =
    file && file !== "-" ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  const hits = findAttribution(text);
  if (!hits.length) {
    out(JSON_OUT ? JSON.stringify({ clean: true, hits: [] }) : c.g("✓ clean"));
    return;
  }
  if (JSON_OUT) out(JSON.stringify({ clean: false, hits }, null, 2));
  else for (const h of hits) out(c.r(`✗ ${h.why}: ${h.match}`));
  process.exitCode = 1;
};

commands.t = commands.ticket;
commands.co = commands.start;
commands.status = commands.which;
commands.profile = commands.profiles;
commands.new = commands.create;
commands.search = commands.users;
commands.types = commands["issue-types"];
commands["--help"] = commands.help;
commands["-h"] = commands.help;

// ----------------------------------------------------------------------- main

async function main() {
  if (flag("cwd")) process.chdir(flag("cwd"));
  if (flag("profile") && cmd !== "setup")
    process.env.WORK_PROFILE = flag("profile");

  if (!cmd) return commands.help();
  const fn = commands[cmd];
  if (!fn) {
    console.error(c.r(`Unknown command "${cmd}".`));
    commands.help();
    process.exitCode = 1;
    return;
  }
  await fn();
}

main().catch((e) => {
  // An MCP handoff is not an error — it is the answer, for a profile that
  // deliberately holds no Atlassian token. Exit 2 so a caller can tell it apart
  // from a genuine failure, and give --json consumers the structured form.
  if (e.name === "McpHandoff") {
    if (JSON_OUT) out(JSON.stringify(e.handoff, null, 2));
    else console.error(c.y("\nvia MCP: ") + e.message + "\n");
    process.exitCode = 2;
    return;
  }
  console.error(c.r("\nerror: ") + e.message + "\n");
  process.exitCode = 1;
});
