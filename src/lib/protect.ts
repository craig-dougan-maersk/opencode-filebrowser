import path from "node:path";

/**
 * Compiles a `**`-aware glob into a matcher over a POSIX-style relative path.
 * `**` spans separators, `*` and `?` do not.
 */
export function compileGlob(pattern: string): (relativePath: string) => boolean {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const matcher = new RegExp(`^${source}$`);
  return (relativePath: string) => matcher.test(relativePath);
}

export interface ProtectionRule {
  pattern: string;
  matches: (relativePath: string) => boolean;
}

export function compileProtection(patterns: readonly string[]): ProtectionRule[] {
  return patterns.map((pattern) => ({ pattern, matches: compileGlob(pattern) }));
}

/**
 * Returns true when the target path matches a protection rule, matched both
 * against the path relative to the browsing root and against the basename so
 * a rule like `**\/*.env` also fires for files outside the root.
 */
export function isProtected(
  target: string,
  root: string,
  rules: readonly ProtectionRule[],
): ProtectionRule | undefined {
  const relative = path.relative(path.resolve(root), path.resolve(target)).split(path.sep).join("/");
  const basename = path.basename(target);
  return rules.find((rule) => rule.matches(relative) || rule.matches(basename));
}
