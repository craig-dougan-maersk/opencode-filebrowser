import { execFile } from "node:child_process";
import path from "node:path";
function classify(index, worktree) {
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
export function parsePorcelainZ(output, repoRoot) {
  const entries = new Map();
  const fields = output.split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.length < 4) continue;
    const indexStatus = field[0];
    const worktreeStatus = field[1];
    const relative = field.slice(3);
    const code = classify(indexStatus, worktreeStatus);
    const absolute = path.resolve(repoRoot, relative);
    entries.set(absolute, {
      code,
      raw: `${indexStatus}${worktreeStatus}`
    });
    // Rename/copy records are followed by the original path in the next field.
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") index += 1;
  }
  return entries;
}
function run(cwd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024
    }, (error, stdout) => {
      if (error) reject(error);else resolve(stdout);
    });
  });
}

/** Reads git status for a directory; a non-repository returns an empty result. */
export async function readGitStatus(directory, timeoutMs) {
  const empty = {
    entries: new Map()
  };
  let root;
  try {
    root = (await run(directory, ["rev-parse", "--show-toplevel"], timeoutMs)).trim();
  } catch {
    return empty;
  }
  if (!root) return empty;
  let branch;
  try {
    branch = (await run(directory, ["rev-parse", "--abbrev-ref", "HEAD"], timeoutMs)).trim() || undefined;
    if (branch === "HEAD") branch = "detached";
  } catch {
    branch = undefined;
  }
  try {
    const porcelain = await run(directory, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], timeoutMs);
    return {
      root,
      branch,
      entries: parsePorcelainZ(porcelain, root)
    };
  } catch {
    return {
      root,
      branch,
      entries: new Map()
    };
  }
}

/** Short badge text for the status column. */
export function badgeFor(entry) {
  if (!entry) return "";
  if (entry.code === "untracked") return "??";
  return entry.raw.replace(/ /g, "").slice(0, 2) || "";
}
