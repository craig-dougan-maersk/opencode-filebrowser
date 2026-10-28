import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** Compiled form of a settings `ignore` entry. */

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
export function compileIgnore(patterns) {
  return patterns.map(pattern => {
    const directoryOnly = pattern.endsWith("/");
    const body = directoryOnly ? pattern.slice(0, -1) : pattern;
    const matcher = globToRegExp(body);
    return {
      directoryOnly,
      matches: name => matcher.test(name)
    };
  });
}
export function isIgnored(entry, rules) {
  return rules.some(rule => (rule.directoryOnly ? entry.directory : true) && rule.matches(entry.name));
}

/** Reads one directory, sorted directories-first then case-insensitively by name. */
export async function readDirectory(directory) {
  const dirents = await readdir(directory, {
    withFileTypes: true
  });
  const entries = [];
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
    entries.push({
      name: dirent.name,
      path: full,
      directory: directoryFlag,
      symlink,
      size,
      mtimeMs
    });
  }
  entries.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, {
      sensitivity: "base"
    });
  });
  return entries;
}

/**
 * Flattens the expanded part of a tree into the rows a list renders. Collapsed
 * directories contribute exactly one row; expanded ones contribute their
 * children in order, recursively.
 */

export async function flattenTree(root, expanded, rules, depth = 0, seen) {
  const rows = [];
  let entries;
  try {
    entries = await readDirectory(root);
  } catch {
    return rows;
  }
  // Seed the cycle guard with the starting directory so a symlink pointing back
  // at an ancestor (not only at a sibling) is recognised as a cycle.
  let guard;
  if (seen) {
    guard = seen;
  } else {
    const seed = new Set();
    try {
      seed.add(await realpath(root));
    } catch {
      // Unresolvable root: fall back to the literal path for cycle detection.
    }
    guard = seed;
  }
  for (const entry of entries) {
    if (isIgnored(entry, rules)) continue;
    const isExpanded = entry.directory && expanded.has(entry.path);
    rows.push({
      entry,
      depth,
      expanded: isExpanded
    });
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
      rows.push(...(await flattenTree(entry.path, expanded, rules, depth + 1, nextSeen)));
    }
  }
  return rows;
}

/** Ancestor chain from the root down to (and including) the target. */
export function ancestorsOf(root, target) {
  const chain = [];
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
export function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Resolves the browsing root from settings, falling back to the session directory. */
export function resolveRoot(mode, configured, sessionDir) {
  if (mode === "unrestricted") return configured ?? sessionDir ?? process.cwd();
  if (mode === "path" && configured) return path.resolve(configured);
  return path.resolve(sessionDir ?? process.cwd());
}
