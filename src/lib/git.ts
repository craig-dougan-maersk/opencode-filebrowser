import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type GitStatusCode = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflict" | "unknown";

export interface GitStatusEntry {
  code: GitStatusCode;
  /** Raw two-column status code, e.g. `M `, `??`, `UU`; a blank column is a space. */
  raw: string;
  /** True when the index holds a change (the left column is set). */
  staged?: boolean;
  /** True when the working tree holds a change (the right column is set). */
  unstaged?: boolean;
  /** True when the entry was derived from its children rather than reported by git. */
  aggregate?: boolean;
  /** True when the file is changed by a commit that is not on the upstream yet. */
  unpushed?: boolean;
}

export interface GitStatus {
  /** Absolute repository root, or undefined when the directory is not in a repository. */
  root?: string;
  branch?: string;
  /** Upstream branch, e.g. `origin/main`, when one is configured. */
  upstream?: string;
  /** Commits on HEAD that are not on the upstream. */
  ahead?: number;
  /** Commits on the upstream that are not on HEAD. */
  behind?: number;
  /** Absolute file path to status. */
  entries: Map<string, GitStatusEntry>;
  /** Absolute paths changed by commits that are not on the upstream yet. */
  unpushed?: Set<string>;
  /** Directories reported as wholly ignored (porcelain lists them, not their files), with a trailing separator. */
  ignoredDirectories?: string[];
  /** Directories reported as wholly untracked, with a trailing separator. */
  untrackedDirectories?: string[];
  /** Directory status rolled up from the most severe child. */
  directories?: Map<string, GitStatusEntry>;
}

function classify(index: string, worktree: string): GitStatusCode {
  const pair = `${index}${worktree}`;
  if (pair === "??") return "untracked";
  if (pair === "!!") return "ignored";
  if (index === "U" || worktree === "U" || pair === "AA" || pair === "DD") return "conflict";
  if (pair.includes("R")) return "renamed";
  if (pair.includes("C")) return "copied";
  if (pair.includes("D")) return "deleted";
  if (pair.includes("A")) return "added";
  if (pair.includes("M") || pair.includes("T")) return "modified";
  return "unknown";
}

/**
 * Parses `git status --porcelain=v1 -z` output. Rename and copy records carry
 * the destination first and the source second, so a single record consumes two
 * NUL-delimited fields.
 */
export function parsePorcelainZ(output: string, repoRoot: string): Map<string, GitStatusEntry> {
  const entries = new Map<string, GitStatusEntry>();
  const fields = output.split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.length < 4) continue;
    const indexStatus = field[0];
    const worktreeStatus = field[1];
    const relative = field.slice(3);
    const code = classify(indexStatus, worktreeStatus);
    const absolute = path.resolve(repoRoot, relative);
    entries.set(absolute, { code, raw: `${indexStatus}${worktreeStatus}` });
    // Rename/copy records are followed by the original path in the next field.
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") index += 1;
  }
  return entries;
}

export interface PorcelainV2 {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  entries: Map<string, GitStatusEntry>;
  ignoredDirectories: string[];
  untrackedDirectories: string[];
}

function entryOf(xy: string): GitStatusEntry {
  const index = xy[0] === "." ? " " : xy[0];
  const worktree = xy[1] === "." ? " " : xy[1];
  return {
    code: classify(index, worktree),
    raw: `${index}${worktree}`,
    staged: index !== " ",
    unstaged: worktree !== " ",
  };
}

/** Returns the remainder of a record after skipping `count` space-separated fields. */
function afterFields(record: string, count: number): string {
  let position = 0;
  for (let skipped = 0; skipped < count; skipped += 1) {
    const next = record.indexOf(" ", position);
    if (next === -1) return "";
    position = next + 1;
  }
  return record.slice(position);
}

/**
 * Parses `git status --porcelain=v2 -z --branch` output. Branch headers give
 * the upstream and ahead/behind counts; ordinary, rename, unmerged, untracked
 * and ignored records give per-path status with staged and unstaged halves.
 * A rename record is followed by its original path in the next field.
 */
export function parsePorcelainV2(output: string, repoRoot: string): PorcelainV2 {
  const result: PorcelainV2 = { entries: new Map(), ignoredDirectories: [], untrackedDirectories: [] };
  const fields = output.split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (record.length < 2) continue;
    const kind = record[0];
    if (kind === "#") {
      const [, key, ...rest] = record.split(" ");
      const value = rest.join(" ");
      if (key === "branch.head") result.branch = value === "(detached)" ? "detached" : value;
      else if (key === "branch.upstream") result.upstream = value;
      else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          result.ahead = Number(match[1]);
          result.behind = Number(match[2]);
        }
      }
      continue;
    }
    if (kind === "?" || kind === "!") {
      const relative = record.slice(2);
      const absolute = path.resolve(repoRoot, relative);
      const code: GitStatusCode = kind === "?" ? "untracked" : "ignored";
      result.entries.set(absolute, { code, raw: kind === "?" ? "??" : "!!", staged: false, unstaged: true });
      if (relative.endsWith("/")) {
        (kind === "!" ? result.ignoredDirectories : result.untrackedDirectories).push(`${absolute}${path.sep}`);
      }
      continue;
    }
    const xy = record.slice(2, 4);
    if (kind === "1") {
      result.entries.set(path.resolve(repoRoot, afterFields(record, 8)), entryOf(xy));
    } else if (kind === "2") {
      result.entries.set(path.resolve(repoRoot, afterFields(record, 9)), entryOf(xy));
      index += 1;
    } else if (kind === "u") {
      result.entries.set(path.resolve(repoRoot, afterFields(record, 10)), {
        code: "conflict",
        raw: xy,
        staged: true,
        unstaged: true,
      });
    }
  }
  return result;
}

/** Folder roll-up weight: a directory shows the most severe status below it. */
const SEVERITY: Record<GitStatusCode, number> = {
  conflict: 7,
  modified: 6,
  deleted: 5,
  renamed: 5,
  copied: 4,
  added: 4,
  untracked: 3,
  unknown: 1,
  ignored: 0,
};

/**
 * Rolls every file status up to its ancestor directories, stopping at the
 * repository root. Ignored entries do not propagate. A directory also inherits
 * the unpushed flag of any file below it.
 */
export function aggregateDirectories(
  entries: ReadonlyMap<string, GitStatusEntry>,
  unpushed: ReadonlySet<string>,
  repoRoot: string,
): Map<string, GitStatusEntry> {
  const directories = new Map<string, GitStatusEntry>();
  const root = path.resolve(repoRoot);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const climb = (file: string, apply: (directory: string) => boolean) => {
    let directory = path.dirname(file);
    while ((directory === root || directory.startsWith(prefix)) && directory !== path.dirname(directory)) {
      if (!apply(directory)) return;
      if (directory === root) return;
      directory = path.dirname(directory);
    }
  };
  for (const [file, entry] of entries) {
    if (entry.code === "ignored") continue;
    climb(file, (directory) => {
      const current = directories.get(directory);
      // Ancestors of a directory already at this severity are at least as severe.
      if (current && SEVERITY[current.code] >= SEVERITY[entry.code]) return false;
      directories.set(directory, { code: entry.code, raw: "", aggregate: true, unpushed: current?.unpushed });
      return true;
    });
  }
  for (const file of unpushed) {
    climb(file, (directory) => {
      const current = directories.get(directory);
      if (current?.unpushed) return false;
      directories.set(directory, current ? { ...current, unpushed: true } : { code: "unknown", raw: "", aggregate: true, unpushed: true });
      return true;
    });
  }
  return directories;
}

/**
 * Resolves what a tree row should show: the file's own status, the rolled-up
 * status of a directory, an ignored ancestor, or the unpushed marker alone.
 */
export function statusFor(status: GitStatus | undefined, target: string, directory: boolean): GitStatusEntry | undefined {
  if (!status) return undefined;
  const own = status.entries.get(target);
  const unpushed = status.unpushed?.has(target) ?? false;
  if (own) return unpushed ? { ...own, unpushed } : own;
  if (directory) {
    const rolled = status.directories?.get(target);
    if (rolled) return rolled;
  }
  for (const untracked of status.untrackedDirectories ?? []) {
    if (target.startsWith(untracked)) return { code: "untracked", raw: "??", staged: false, unstaged: true };
  }
  for (const ignored of status.ignoredDirectories ?? []) {
    if (target.startsWith(ignored)) return { code: "ignored", raw: "!!" };
  }
  if (unpushed) return { code: "unknown", raw: "", unpushed: true };
  return undefined;
}

function run(cwd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export interface GitReadOptions {
  /** Also list the files changed by commits that are ahead of the upstream. */
  unpushed?: boolean;
}

/** Reads git status for a directory; a non-repository returns an empty result. */
export async function readGitStatus(directory: string, timeoutMs: number, options: GitReadOptions = {}): Promise<GitStatus> {
  const empty: GitStatus = { entries: new Map() };
  let root: string;
  try {
    root = (await run(directory, ["rev-parse", "--show-toplevel"], timeoutMs)).trim();
  } catch {
    return empty;
  }
  if (!root) return empty;
  // git reports the real path (/private/var on macOS); rows use the tab root as
  // given (/var). Map git's paths back onto the caller's spelling.
  const [realDirectory, realRoot] = await Promise.all([
    realpath(directory).catch(() => directory),
    realpath(root).catch(() => root),
  ]);
  const relativeToDirectory = path.relative(realDirectory, realRoot);
  root = path.resolve(directory, relativeToDirectory);
  let parsed: PorcelainV2;
  try {
    const porcelain = await run(
      directory,
      // "normal" reports a wholly untracked or ignored directory once as
      // `dir/` instead of listing every file below it (node_modules alone can
      // be tens of thousands of records); statusFor resolves files by prefix.
      ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=normal", "--ignored=traditional"],
      timeoutMs,
    );
    parsed = parsePorcelainV2(porcelain, root);
  } catch {
    return { root, entries: new Map() };
  }
  const unpushed = new Set<string>();
  if (options.unpushed && parsed.upstream && (parsed.ahead ?? 0) > 0) {
    try {
      const names = await run(directory, ["diff", "--name-only", "-z", `${parsed.upstream}...HEAD`], timeoutMs);
      for (const name of names.split("\0")) if (name) unpushed.add(path.resolve(root, name));
    } catch {
      // The upstream may have vanished; the marker is best-effort.
    }
  }
  return {
    root,
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    entries: parsed.entries,
    unpushed,
    ignoredDirectories: parsed.ignoredDirectories,
    untrackedDirectories: parsed.untrackedDirectories,
    directories: aggregateDirectories(parsed.entries, unpushed, root),
  };
}

/** Short badge text for the status column; staged changes keep their index letter. */
export function badgeFor(entry: GitStatusEntry | undefined): string {
  if (!entry || entry.aggregate) return entry?.unpushed ? "↑" : "";
  const arrow = entry.unpushed ? "↑" : "";
  if (entry.code === "untracked") return "??";
  if (entry.code === "ignored") return "";
  return `${entry.raw.replace(/ /g, "").slice(0, 2)}${arrow}`;
}

const SEVERITY_RANK = (entry: GitStatusEntry | undefined) => (entry ? SEVERITY[entry.code] : -1);

/**
 * Combines the status of several repositories shown in one tree: the one the
 * tree root sits in (if any) and repositories nested below it. A parent
 * repository reports a nested one as an untracked `dir/`; those records are
 * dropped so the nested repository's own state shows instead. Directory
 * roll-ups are recomputed up to the tree root, so a plain folder holding
 * repositories still takes the colour of the changes below it.
 */
export function mergeGitStatus(statuses: readonly GitStatus[], treeRoot: string): GitStatus {
  const repos = statuses.filter((status) => status.root !== undefined);
  if (repos.length === 0) return { entries: new Map() };
  const roots = repos.map((status) => status.root as string);
  const nestedUnder = (owner: string, target: string) =>
    roots.some((root) => root !== owner && root.startsWith(`${owner}${path.sep}`) && (target === root || target.startsWith(`${root}${path.sep}`)));
  const entries = new Map<string, GitStatusEntry>();
  const unpushed = new Set<string>();
  const ignoredDirectories: string[] = [];
  const untrackedDirectories: string[] = [];
  for (const status of repos) {
    const owner = status.root as string;
    for (const [file, entry] of status.entries) {
      if (nestedUnder(owner, file)) continue;
      if (SEVERITY_RANK(entry) > SEVERITY_RANK(entries.get(file))) entries.set(file, entry);
    }
    for (const file of status.unpushed ?? []) if (!nestedUnder(owner, file)) unpushed.add(file);
    for (const prefix of status.ignoredDirectories ?? []) if (!nestedUnder(owner, prefix.slice(0, -1))) ignoredDirectories.push(prefix);
    for (const prefix of status.untrackedDirectories ?? []) if (!nestedUnder(owner, prefix.slice(0, -1))) untrackedDirectories.push(prefix);
  }
  const primary = repos.find((status) => {
    const root = status.root as string;
    return treeRoot === root || treeRoot.startsWith(`${root}${path.sep}`);
  });
  const resolvedRoot = path.resolve(treeRoot);
  return {
    root: primary?.root,
    branch: primary?.branch,
    upstream: primary?.upstream,
    ahead: primary?.ahead,
    behind: primary?.behind,
    entries,
    unpushed,
    ignoredDirectories,
    untrackedDirectories,
    directories: aggregateDirectories(entries, unpushed, resolvedRoot),
  };
}

/**
 * Reads git status for a tree: the repository containing `treeRoot`, plus any
 * of `directories` (the tree's visible folders) that is itself the top of a
 * repository, so a workspace folder of checkouts is coloured too.
 */
export async function readTreeGitStatus(
  treeRoot: string,
  directories: readonly string[],
  timeoutMs: number,
  options: GitReadOptions = {},
): Promise<GitStatus> {
  const nested = await Promise.all(
    directories.map(async (directory) => ((await lstat(path.join(directory, ".git")).then(() => true, () => false)) ? directory : undefined)),
  );
  const candidates = [treeRoot, ...nested.filter((directory): directory is string => directory !== undefined && directory !== treeRoot)];
  const statuses = await Promise.all(candidates.map((directory) => readGitStatus(directory, timeoutMs, options)));
  const seen = new Set<string>();
  const unique = statuses.filter((status) => {
    if (!status.root || seen.has(status.root)) return false;
    seen.add(status.root);
    return true;
  });
  if (unique.length === 1 && unique[0]?.root && (treeRoot === unique[0].root || treeRoot.startsWith(`${unique[0].root}${path.sep}`))) {
    return unique[0];
  }
  return mergeGitStatus(unique, treeRoot);
}
