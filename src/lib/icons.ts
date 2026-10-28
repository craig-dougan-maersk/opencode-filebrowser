import type { IconStyle } from "./settings";

export interface IconSet {
  folder: string;
  folderOpen: string;
  file: string;
  symlink: string;
  protected: string;
  byExtension: Record<string, string>;
  byName: Record<string, string>;
}

/**
 * Nerd Font glyphs (private-use area). Correct rendering depends on a patched
 * font; the unicode set below is the fallback.
 */
const NERD: IconSet = {
  folder: "\u{f07b}",
  folderOpen: "\u{f07c}",
  file: "\u{f15b}",
  symlink: "\u{f481}",
  protected: "\u{f023}",
  byName: {
    ".gitignore": "\u{e702}",
    ".gitattributes": "\u{e702}",
    ".gitmodules": "\u{e702}",
    "dockerfile": "\u{f308}",
    "makefile": "\u{e673}",
    "license": "\u{f718}",
    "readme.md": "\u{f48a}",
    "package.json": "\u{e718}",
    "package-lock.json": "\u{e718}",
    "tsconfig.json": "\u{e628}",
  },
  byExtension: {
    ts: "\u{e628}",
    tsx: "\u{e7ba}",
    mts: "\u{e628}",
    cts: "\u{e628}",
    js: "\u{e74e}",
    jsx: "\u{e7ba}",
    mjs: "\u{e74e}",
    cjs: "\u{e74e}",
    json: "\u{e60b}",
    jsonc: "\u{e60b}",
    yaml: "\u{e60b}",
    yml: "\u{e60b}",
    toml: "\u{e6b2}",
    md: "\u{e73e}",
    markdown: "\u{e73e}",
    txt: "\u{f15c}",
    py: "\u{e73c}",
    rb: "\u{e739}",
    go: "\u{e627}",
    rs: "\u{e7a8}",
    java: "\u{e738}",
    kt: "\u{e634}",
    c: "\u{e61e}",
    h: "\u{f0fd}",
    cpp: "\u{e61d}",
    cc: "\u{e61d}",
    hpp: "\u{f0fd}",
    cs: "\u{f81a}",
    php: "\u{e73d}",
    swift: "\u{e755}",
    sh: "\u{f489}",
    bash: "\u{f489}",
    zsh: "\u{f489}",
    fish: "\u{f489}",
    sql: "\u{f1c0}",
    html: "\u{e736}",
    css: "\u{e749}",
    scss: "\u{e749}",
    sass: "\u{e74b}",
    less: "\u{e758}",
    vue: "\u{e6a0}",
    svelte: "\u{e697}",
    lua: "\u{e620}",
    vim: "\u{e62b}",
    tf: "\u{e69a}",
    tfvars: "\u{e69a}",
    hcl: "\u{e69a}",
    lock: "\u{f023}",
    png: "\u{f1c5}",
    jpg: "\u{f1c5}",
    jpeg: "\u{f1c5}",
    gif: "\u{f1c5}",
    webp: "\u{f1c5}",
    svg: "\u{f1c5}",
    ico: "\u{f1c5}",
    pdf: "\u{f1c1}",
    zip: "\u{f1c6}",
    gz: "\u{f1c6}",
    tar: "\u{f1c6}",
    xz: "\u{f1c6}",
    mp3: "\u{f1c7}",
    wav: "\u{f1c7}",
    mp4: "\u{f1c8}",
    mov: "\u{f1c8}",
    env: "\u{f023}",
    pem: "\u{f023}",
    key: "\u{f023}",
    crt: "\u{f023}",
  },
};

/** Single-width Unicode symbols, safe in any terminal. */
const UNICODE: IconSet = {
  folder: "\u{1F4C1}",
  folderOpen: "\u{1F4C2}",
  file: "\u{1F4C4}",
  symlink: "\u{1F517}",
  protected: "\u{1F512}",
  byName: {},
  byExtension: {},
};

export function iconSet(style: IconStyle): IconSet {
  return style === "unicode" ? UNICODE : NERD;
}

/**
 * Resolves the icon for a directory entry. Name matches win over extension
 * matches, which mirrors editor behaviour for things like `package.json`.
 */
export function iconFor(
  set: IconSet,
  entry: { name: string; directory: boolean; symlink: boolean; open?: boolean; protected?: boolean },
): string {
  if (entry.protected) return set.protected;
  if (entry.directory) return entry.open ? set.folderOpen : set.folder;
  if (entry.symlink) return set.symlink;
  const lower = entry.name.toLowerCase();
  const byName = set.byName[lower];
  if (byName) return byName;
  const dot = lower.lastIndexOf(".");
  if (dot > 0 && dot < lower.length - 1) {
    const byExtension = set.byExtension[lower.slice(dot + 1)];
    if (byExtension) return byExtension;
  }
  return set.file;
}
