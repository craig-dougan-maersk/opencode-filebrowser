import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export const DEFAULT_SETTINGS = {
  root: {
    mode: "session",
    path: null,
    allowAbove: true
  },
  icons: {
    style: "nerdfont",
    folders: true
  },
  git: {
    enabled: true,
    badges: true,
    timeoutMs: 4000
  },
  ignore: ["node_modules/", ".git/", "dist/", ".DS_Store"],
  watch: {
    enabled: true,
    debounceMs: 300
  },
  editor: {
    default: "plaintext",
    maxInlineBytes: 2 * 1024 * 1024,
    map: [],
    providers: {}
  },
  binaryViewer: {
    command: "fileviewer.view",
    fallback: ["system-open", "hex"]
  },
  protect: ["**/*.env", "**/.ssh/**", "**/secrets/**", "**/*.pem", "**/id_rsa"],
  confirmOverwrite: true,
  keybinds: {
    copy: "ctrl+c",
    paste: "ctrl+v",
    refresh: "r"
  }
};

/** Absolute path of the settings file, honouring XDG_CONFIG_HOME. */
export function settingsPath() {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "opencode", "filebrowser.json");
}
export function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pickBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function pickNumber(value, fallback, minimum = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : fallback;
}
function pickString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}
function pickOneOf(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function pickStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.filter(item => typeof item === "string");
}

/**
 * Merges user configuration over the defaults, rejecting malformed values
 * field by field so one bad entry never discards the rest of the file.
 */
export function mergeSettings(raw) {
  if (!isRecord(raw)) return structuredClone(DEFAULT_SETTINGS);
  const base = structuredClone(DEFAULT_SETTINGS);
  const root = isRecord(raw.root) ? raw.root : {};
  base.root = {
    mode: pickOneOf(root.mode, ["session", "path", "unrestricted"], base.root.mode),
    path: typeof root.path === "string" ? root.path : null,
    allowAbove: pickBoolean(root.allowAbove, base.root.allowAbove)
  };
  const icons = isRecord(raw.icons) ? raw.icons : {};
  base.icons = {
    style: pickOneOf(icons.style, ["nerdfont", "unicode"], base.icons.style),
    folders: pickBoolean(icons.folders, base.icons.folders)
  };
  const git = isRecord(raw.git) ? raw.git : {};
  base.git = {
    enabled: pickBoolean(git.enabled, base.git.enabled),
    badges: pickBoolean(git.badges, base.git.badges),
    timeoutMs: pickNumber(git.timeoutMs, base.git.timeoutMs, 100)
  };
  base.ignore = pickStringArray(raw.ignore, base.ignore);
  const watch = isRecord(raw.watch) ? raw.watch : {};
  base.watch = {
    enabled: pickBoolean(watch.enabled, base.watch.enabled),
    debounceMs: pickNumber(watch.debounceMs, base.watch.debounceMs, 0)
  };
  const editor = isRecord(raw.editor) ? raw.editor : {};
  const map = Array.isArray(editor.map) ? editor.map.filter(isRecord).map(entry => ({
    match: pickString(entry.match, ""),
    provider: pickString(entry.provider, "")
  })).filter(entry => entry.match !== "" && entry.provider !== "") : base.editor.map;
  const providers = {};
  if (isRecord(editor.providers)) {
    for (const [id, value] of Object.entries(editor.providers)) {
      if (!isRecord(value)) continue;
      providers[id] = {
        module: pickString(value.module, ""),
        options: isRecord(value.options) ? value.options : undefined
      };
    }
  }
  base.editor = {
    default: pickString(editor.default, base.editor.default),
    maxInlineBytes: pickNumber(editor.maxInlineBytes, base.editor.maxInlineBytes, 0),
    map,
    providers
  };
  const viewer = isRecord(raw.binaryViewer) ? raw.binaryViewer : {};
  base.binaryViewer = {
    command: pickString(viewer.command, base.binaryViewer.command),
    fallback: pickStringArray(viewer.fallback, base.binaryViewer.fallback).filter(item => ["system-open", "hex", "none"].includes(item))
  };
  base.protect = pickStringArray(raw.protect, base.protect);
  base.confirmOverwrite = pickBoolean(raw.confirmOverwrite, base.confirmOverwrite);
  const keybinds = isRecord(raw.keybinds) ? raw.keybinds : {};
  base.keybinds = {
    copy: pickString(keybinds.copy, base.keybinds.copy),
    paste: pickString(keybinds.paste, base.keybinds.paste),
    refresh: pickString(keybinds.refresh, base.keybinds.refresh)
  };
  return base;
}

/** Reads and merges the settings file; a missing or unreadable file yields defaults. */
export async function loadSettings(file = settingsPath()) {
  try {
    return mergeSettings(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/**
 * Writes settings atomically: a temporary file in the same directory is
 * renamed over the target so a crash mid-write cannot truncate the file the
 * next session reads. Returns the path written.
 */
export async function saveSettings(settings, file = settingsPath()) {
  await mkdir(path.dirname(file), {
    recursive: true
  });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return file;
}

/** One-line summary of the values the settings dialog can change. */
export function describeSettings(settings) {
  return [`root ${settings.root.mode}${settings.root.path ? ` (${settings.root.path})` : ""}`, `icons ${settings.icons.style}`, `git ${settings.git.enabled ? "on" : "off"}`, `editor ${settings.editor.default}`, `viewer ${settings.binaryViewer.command}`].join(" · ");
}
