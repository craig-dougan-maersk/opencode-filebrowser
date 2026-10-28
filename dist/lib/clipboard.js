import path from "node:path";
/**
 * Decides what happens to each copied entry.
 *
 * - pasting into the directory the entry came from always asks for a new name;
 * - pasting elsewhere copies silently when the name is free;
 * - pasting elsewhere asks for a new name when the name is taken.
 */
export async function planPaste(input) {
  const actions = [];
  for (const source of input.sources) {
    const name = path.basename(source.path);
    const destination = path.join(input.targetDirectory, name);
    if (path.resolve(source.sourceDirectory) === path.resolve(input.targetDirectory)) {
      actions.push({
        kind: "rename",
        source: source.path,
        destination,
        reason: "same-directory"
      });
      continue;
    }
    if (await input.exists(destination)) {
      actions.push({
        kind: "rename",
        source: source.path,
        destination,
        reason: "exists"
      });
      continue;
    }
    actions.push({
      kind: "copy",
      source: source.path,
      destination
    });
  }
  return actions;
}

/**
 * Suggests a non-colliding name: `report.txt` becomes `report copy.txt`, then
 * `report copy 2.txt`, and so on.
 */
export function suggestName(name, taken) {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  let candidate = `${stem} copy${extension}`;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${stem} copy ${counter}${extension}`;
    counter += 1;
  }
  return candidate;
}

/** Rejects names that would escape the target directory or name nothing. */
export function isSafeName(name) {
  if (name === "" || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return path.basename(name) === name;
}
