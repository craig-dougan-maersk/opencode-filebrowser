import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface DirEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
  size: number;
  mtimeMs: number;
}

export interface IgnoreRule {
  /** Directory name or basename glob to ignore, e.g. `node_modules/` or `*.log`. */
  pattern: string;
}

/** Compiled form of a settings `ignore` entry. */
export interface CompiledIgnore {
  directoryOnly: boolean;
  matches: (name: string) => boolean;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

export function compileIgnore(patterns: readonly string[]): CompiledIgnore[] {
  return patterns.map((pattern) => {
    const directoryOnly = pattern.endsWith("/");
    const body = directoryOnly ? pattern.slice(0, -1) : pattern;
    const matcher = globToRegExp(body);
    return { directoryOnly, matches: (name: string) => matcher.test(name) };
  });
}

export function isIgnored(entry: DirEntry, rules: readonly CompiledIgnore[]): boolean {
  return rules.some((rule) => (rule.directoryOnly ? entry.directory : true) && rule.matches(entry.name));
}

/** Reads one directory, sorted directories-first then case-insensitively by name. */
export async function readDirectory(directory: string): Promise<DirEntry[]> {
  const dirents = await readdir(directory, { withFileTypes: true });
  const entries: DirEntry[] = [];
  for (const dirent of dirents) {
    const full = path.join(directory, dirent.name);
    let directoryFlag = dirent.isDirectory();
    const symlink = dirent.isSymbolicLink();
    let size = 0;
    let mtimeMs = 0;
    try {
      const info = await stat(full);
      if (symlink) directoryFlag = info.isDirectory();
      size = info.size;
      mtimeMs = info.mtimeMs;
    } catch {
      // Broken symlink or a race with deletion: keep the entry, unknown size.
    }
    entries.push({ name: dirent.name, path: full, directory: directoryFlag, symlink, size, mtimeMs });
  }
  entries.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}

/**
 * Flattens the expanded part of a tree into the rows a list renders. Collapsed
 * directories contribute exactly one row; expanded ones contribute their
 * children in order, recursively.
 */
export interface TreeRow {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
}

/**
 * Rows a single flatten may produce before it stops descending. A directory
 * with hundreds of thousands of entries would otherwise allocate one row per
 * entry and stall the UI thread on every refresh.
 */
export const MAX_TREE_ROWS = 20_000;

/** Mutable budget shared across one flatten so the cap is global, not per directory. */
export interface FlattenBudget {
  remaining: number;
  truncated: boolean;
}

export function createBudget(limit: number = MAX_TREE_ROWS): FlattenBudget {
  return { remaining: Math.max(0, limit), truncated: false };
}

export async function flattenTree(
  root: string,
  expanded: ReadonlySet<string>,
  rules: readonly CompiledIgnore[],
  depth = 0,
  seen?: ReadonlySet<string>,
  budget: FlattenBudget = createBudget(),
): Promise<TreeRow[]> {
  const rows: TreeRow[] = [];
  if (budget.remaining <= 0) {
    budget.truncated = true;
    return rows;
  }
  let entries: DirEntry[];
  try {
    entries = await readDirectory(root);
  } catch {
    return rows;
  }
  // Seed the cycle guard with the starting directory so a symlink pointing back
  // at an ancestor (not only at a sibling) is recognised as a cycle.
  let guard: ReadonlySet<string>;
  if (seen) {
    guard = seen;
  } else {
    const seed = new Set<string>();
    try {
      seed.add(await realpath(root));
    } catch {
      // Unresolvable root: fall back to the literal path for cycle detection.
    }
    guard = seed;
  }
  for (const entry of entries) {
    if (isIgnored(entry, rules)) continue;
    if (budget.remaining <= 0) {
      budget.truncated = true;
      break;
    }
    budget.remaining -= 1;
    const isExpanded = entry.directory && expanded.has(entry.path);
    rows.push({ entry, depth, expanded: isExpanded });
    if (isExpanded) {
      // Guard against symlink cycles by tracking resolved directories.
      let key = entry.path;
      try {
        key = await realpath(entry.path);
      } catch {
        // Unresolvable path: fall back to the literal path for cycle detection.
      }
      if (guard.has(key)) continue;
      const nextSeen = new Set(guard);
      nextSeen.add(key);
      rows.push(...(await flattenTree(entry.path, expanded, rules, depth + 1, nextSeen, budget)));
    }
  }
  return rows;
}

/** Ancestor chain from the root down to (and including) the target. */
export function ancestorsOf(root: string, target: string): string[] {
  const chain: string[] = [];
  let current = target;
  const stop = path.resolve(root);
  while (true) {
    chain.unshift(current);
    const parent = path.dirname(current);
    if (current === stop || parent === current) break;
    current = parent;
  }
  return chain;
}

export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolves the browsing root from settings, falling back to the session directory. */
export function resolveRoot(mode: "session" | "path" | "unrestricted", configured: string | null, sessionDir: string | undefined): string {
  if (mode === "unrestricted") return configured ?? sessionDir ?? process.cwd();
  if (mode === "path" && configured) return path.resolve(configured);
  return path.resolve(sessionDir ?? process.cwd());
}
