import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type IconStyle = "nerdfont" | "unicode";
export type RootMode = "session" | "path" | "unrestricted";
export type BinaryFallback = "system-open" | "hex" | "none";

export interface RootSettings {
  mode: RootMode;
  path: string | null;
  allowAbove: boolean;
}

export interface IconSettings {
  style: IconStyle;
  folders: boolean;
}

export interface GitSettings {
  enabled: boolean;
  badges: boolean;
  timeoutMs: number;
}

export interface WatchSettings {
  enabled: boolean;
  debounceMs: number;
}

export interface EditorMapping {
  match: string;
  provider: string;
}

export interface EditorProviderSettings {
  module: string;
  options?: Record<string, unknown>;
}

export interface EditorSettings {
  default: string;
  maxInlineBytes: number;
  map: EditorMapping[];
  providers: Record<string, EditorProviderSettings>;
}

export interface BinaryViewerSettings {
  command: string;
  fallback: BinaryFallback[];
}

export interface KeybindSettings {
  copy: string;
  paste: string;
  refresh: string;
}

export interface FilebrowserSettings {
  root: RootSettings;
  icons: IconSettings;
  git: GitSettings;
  ignore: string[];
  watch: WatchSettings;
  editor: EditorSettings;
  binaryViewer: BinaryViewerSettings;
  protect: string[];
  confirmOverwrite: boolean;
  keybinds: KeybindSettings;
}

export const DEFAULT_SETTINGS: FilebrowserSettings = {
  root: { mode: "session", path: null, allowAbove: true },
  icons: { style: "nerdfont", folders: true },
  git: { enabled: true, badges: true, timeoutMs: 4000 },
  ignore: ["node_modules/", ".git/", "dist/", ".DS_Store"],
  watch: { enabled: true, debounceMs: 300 },
  editor: {
    default: "plaintext",
    maxInlineBytes: 2 * 1024 * 1024,
    map: [],
    providers: {},
  },
  binaryViewer: { command: "fileviewer.view", fallback: ["system-open", "hex"] },
  protect: ["**/*.env", "**/.ssh/**", "**/secrets/**", "**/*.pem", "**/id_rsa"],
  confirmOverwrite: true,
  keybinds: { copy: "ctrl+c", paste: "ctrl+v", refresh: "r" },
};

/** Absolute path of the settings file, honouring XDG_CONFIG_HOME. */
export function settingsPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "opencode", "filebrowser.json");
}

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickNumber(value: unknown, fallback: number, minimum = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function pickOneOf<Value extends string>(value: unknown, allowed: readonly Value[], fallback: Value): Value {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as Value) : fallback;
}

function pickStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Merges user configuration over the defaults, rejecting malformed values
 * field by field so one bad entry never discards the rest of the file.
 */
export function mergeSettings(raw: unknown): FilebrowserSettings {
  if (!isRecord(raw)) return structuredClone(DEFAULT_SETTINGS);
  const base = structuredClone(DEFAULT_SETTINGS);

  const root = isRecord(raw.root) ? raw.root : {};
  base.root = {
    mode: pickOneOf(root.mode, ["session", "path", "unrestricted"] as const, base.root.mode),
    path: typeof root.path === "string" ? root.path : null,
    allowAbove: pickBoolean(root.allowAbove, base.root.allowAbove),
  };

  const icons = isRecord(raw.icons) ? raw.icons : {};
  base.icons = {
    style: pickOneOf(icons.style, ["nerdfont", "unicode"] as const, base.icons.style),
    folders: pickBoolean(icons.folders, base.icons.folders),
  };

  const git = isRecord(raw.git) ? raw.git : {};
  base.git = {
    enabled: pickBoolean(git.enabled, base.git.enabled),
    badges: pickBoolean(git.badges, base.git.badges),
    timeoutMs: pickNumber(git.timeoutMs, base.git.timeoutMs, 100),
  };

  base.ignore = pickStringArray(raw.ignore, base.ignore);

  const watch = isRecord(raw.watch) ? raw.watch : {};
  base.watch = {
    enabled: pickBoolean(watch.enabled, base.watch.enabled),
    debounceMs: pickNumber(watch.debounceMs, base.watch.debounceMs, 0),
  };

  const editor = isRecord(raw.editor) ? raw.editor : {};
  const map = Array.isArray(editor.map)
    ? editor.map
        .filter(isRecord)
        .map((entry) => ({ match: pickString(entry.match, ""), provider: pickString(entry.provider, "") }))
        .filter((entry) => entry.match !== "" && entry.provider !== "")
    : base.editor.map;
  const providers: Record<string, EditorProviderSettings> = {};
  if (isRecord(editor.providers)) {
    for (const [id, value] of Object.entries(editor.providers)) {
      if (!isRecord(value)) continue;
      providers[id] = {
        module: pickString(value.module, ""),
        options: isRecord(value.options) ? value.options : undefined,
      };
    }
  }
  base.editor = {
    default: pickString(editor.default, base.editor.default),
    maxInlineBytes: pickNumber(editor.maxInlineBytes, base.editor.maxInlineBytes, 0),
    map,
    providers,
  };

  const viewer = isRecord(raw.binaryViewer) ? raw.binaryViewer : {};
  base.binaryViewer = {
    command: pickString(viewer.command, base.binaryViewer.command),
    fallback: pickStringArray(viewer.fallback, base.binaryViewer.fallback).filter((item): item is BinaryFallback =>
      (["system-open", "hex", "none"] as const).includes(item as BinaryFallback),
    ),
  };

  base.protect = pickStringArray(raw.protect, base.protect);
  base.confirmOverwrite = pickBoolean(raw.confirmOverwrite, base.confirmOverwrite);

  const keybinds = isRecord(raw.keybinds) ? raw.keybinds : {};
  base.keybinds = {
    copy: pickString(keybinds.copy, base.keybinds.copy),
    paste: pickString(keybinds.paste, base.keybinds.paste),
    refresh: pickString(keybinds.refresh, base.keybinds.refresh),
  };

  return base;
}

/** Reads and merges the settings file; a missing or unreadable file yields defaults. */
export async function loadSettings(file: string = settingsPath()): Promise<FilebrowserSettings> {
  try {
    return mergeSettings(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}
