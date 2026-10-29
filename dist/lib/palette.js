/** Non-colour emphasis, so a state survives a monochrome terminal. */

/**
 * JetBrains IDE file-status colours (Darcula): modified blue, untracked
 * red-brown, added green, deleted grey, renamed/copied blue, conflicts red,
 * ignored olive.
 */
const JETBRAINS = {
  modified: {
    color: "#6897BB"
  },
  untracked: {
    color: "#D1675A"
  },
  added: {
    color: "#629755"
  },
  deleted: {
    color: "#6C6C6C",
    strikethrough: true
  },
  renamed: {
    color: "#3A8CCB",
    italic: true
  },
  copied: {
    color: "#3A8CCB",
    italic: true
  },
  conflict: {
    color: "#D5756C",
    bold: true
  },
  ignored: {
    color: "#848504",
    dim: true
  }
};

/** VS Code git decoration colours (Dark+). */
const VSCODE = {
  modified: {
    color: "#E2C08D"
  },
  untracked: {
    color: "#73C991"
  },
  added: {
    color: "#81B88B"
  },
  deleted: {
    color: "#C74E39",
    strikethrough: true
  },
  renamed: {
    color: "#73C991",
    italic: true
  },
  copied: {
    color: "#73C991",
    italic: true
  },
  conflict: {
    color: "#E4676B",
    bold: true
  },
  ignored: {
    color: "#8C8C8C",
    dim: true
  }
};
const PALETTES = {
  jetbrains: JETBRAINS,
  vscode: VSCODE
};

/**
 * Style for a git status in the chosen palette, or undefined when the row has
 * no colour of its own (clean, or only the unpushed marker). A staged change is
 * bold; a rolled-up folder takes the colour without the file-only emphasis.
 */
export function paletteStyle(palette, entry) {
  if (!entry || entry.code === "unknown") return undefined;
  const base = (PALETTES[palette] ?? JETBRAINS)[entry.code];
  if (entry.aggregate) return {
    color: base.color,
    bold: entry.code === "conflict"
  };
  const staged = entry.staged === true && entry.unstaged !== true && entry.code !== "untracked";
  return {
    ...base,
    bold: base.bold || staged
  };
}
