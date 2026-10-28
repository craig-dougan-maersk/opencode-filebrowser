import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { looksBinary, extensionOf, isBinaryExtension, isTextExtension, SNIFF_BYTES } from "../dist/lib/binary.js";
import { isSafeName, planPaste, suggestName } from "../dist/lib/clipboard.js";
import { ancestorsOf, compileIgnore, flattenTree, isIgnored, isWithin, readDirectory, resolveRoot } from "../dist/lib/fs-tree.js";
import { badgeFor, parsePorcelainZ } from "../dist/lib/git.js";
import { iconFor, iconSet } from "../dist/lib/icons.js";
import { compileGlob, compileProtection, isProtected } from "../dist/lib/protect.js";
import { buildRegistry, compileMapping, resolveProvider } from "../dist/lib/providers.js";
import { DEFAULT_SETTINGS, describeSettings, expandHome, loadSettings, mergeSettings, saveSettings, settingsPath } from "../dist/lib/settings.js";
import { adaptTheme, syntaxStyleMap } from "../dist/lib/theme.js";

// ---------------------------------------------------------------- settings

test("mergeSettings returns defaults for non-object input", () => {
  assert.deepEqual(mergeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings("nope"), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings([1, 2]), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings(7), DEFAULT_SETTINGS);
});

test("mergeSettings applies valid overrides and keeps the rest", () => {
  const merged = mergeSettings({
    root: { mode: "path", path: "/tmp/work", allowAbove: false },
    icons: { style: "unicode", folders: false },
    git: { enabled: false, badges: false, timeoutMs: 250 },
    ignore: ["target/"],
    watch: { enabled: false, debounceMs: 50 },
    editor: {
      default: "vim",
      maxInlineBytes: 4096,
      map: [{ match: "*.md", provider: "markdown" }, { match: "", provider: "x" }],
      providers: { vim: { module: "/abs/vim.js", options: { tab: 2 } }, broken: "no" },
    },
    binaryViewer: { command: "custom.view", fallback: ["none", "bogus"] },
    protect: ["**/*.key"],
    confirmOverwrite: false,
    keybinds: { copy: "y", paste: "p", refresh: "g" },
  });
  assert.deepEqual(merged.root, { mode: "path", path: "/tmp/work", allowAbove: false });
  assert.deepEqual(merged.icons, { style: "unicode", folders: false });
  assert.deepEqual(merged.git, { enabled: false, badges: false, timeoutMs: 250 });
  assert.deepEqual(merged.ignore, ["target/"]);
  assert.deepEqual(merged.watch, { enabled: false, debounceMs: 50 });
  assert.equal(merged.editor.default, "vim");
  assert.equal(merged.editor.maxInlineBytes, 4096);
  assert.deepEqual(merged.editor.map, [{ match: "*.md", provider: "markdown" }]);
  assert.deepEqual(Object.keys(merged.editor.providers), ["vim"]);
  assert.deepEqual(merged.editor.providers.vim.options, { tab: 2 });
  assert.deepEqual(merged.binaryViewer, { command: "custom.view", fallback: ["none"] });
  assert.deepEqual(merged.protect, ["**/*.key"]);
  assert.equal(merged.confirmOverwrite, false);
  assert.deepEqual(merged.keybinds, { copy: "y", paste: "p", refresh: "g" });
});

test("mergeSettings rejects malformed fields one by one", () => {
  const merged = mergeSettings({
    root: { mode: "sideways", path: 42 },
    icons: { style: 7 },
    git: { timeoutMs: -5 },
    ignore: [1, "keep", null],
    editor: { map: "nope" },
    binaryViewer: { fallback: "system-open" },
    keybinds: null,
  });
  assert.equal(merged.root.mode, DEFAULT_SETTINGS.root.mode);
  assert.equal(merged.root.path, null);
  assert.equal(merged.icons.style, DEFAULT_SETTINGS.icons.style);
  assert.equal(merged.git.timeoutMs, DEFAULT_SETTINGS.git.timeoutMs);
  assert.deepEqual(merged.ignore, ["keep"]);
  assert.deepEqual(merged.editor.map, []);
  assert.deepEqual(merged.binaryViewer.fallback, DEFAULT_SETTINGS.binaryViewer.fallback);
  assert.deepEqual(merged.keybinds, DEFAULT_SETTINGS.keybinds);
});

test("mergeSettings does not share state with the defaults", () => {
  const merged = mergeSettings({});
  merged.ignore.push("mutated");
  assert.ok(!DEFAULT_SETTINGS.ignore.includes("mutated"));
});

test("settingsPath honours XDG_CONFIG_HOME and expandHome expands only a leading tilde", () => {
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/custom/config";
  try {
    assert.equal(settingsPath(), "/custom/config/opencode/filebrowser.json");
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
  assert.ok(expandHome("~/x").startsWith("/"));
  assert.equal(expandHome("/already/absolute"), "/already/absolute");
  assert.equal(expandHome("relative"), "relative");
});

test("saveSettings writes an atomic round-trip and loadSettings reads it back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-settings-"));
  try {
    const file = join(dir, "nested", "filebrowser.json");
    const settings = mergeSettings({ root: { mode: "path", path: "/tmp/work" }, icons: { style: "unicode" } });
    assert.equal(await saveSettings(settings, file), file);
    const read = await loadSettings(file);
    assert.deepEqual(read, settings);
    // The write leaves no temporary sibling behind.
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual(await readdir(join(dir, "nested")), ["filebrowser.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSettings falls back to defaults for a missing or malformed file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fb-settings-"));
  try {
    assert.deepEqual(await loadSettings(join(dir, "absent.json")), DEFAULT_SETTINGS);
    const broken = join(dir, "broken.json");
    await writeFile(broken, "{ not json");
    assert.deepEqual(await loadSettings(broken), DEFAULT_SETTINGS);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("describeSettings names the values the dialog can change", () => {
  const text = describeSettings(mergeSettings({ root: { mode: "path", path: "/tmp/work" }, git: { enabled: false } }));
  assert.match(text, /root path \(\/tmp\/work\)/);
  assert.match(text, /git off/);
  assert.match(text, /editor plaintext/);
});

// ---------------------------------------------------------------- git

test("parsePorcelainZ classifies the common porcelain codes", () => {
  const output = [" M src/mod.ts", "A  src/new.ts", "?? fresh.txt", " D gone.ts", "UU conflict.ts", ""].join("\0");
  const entries = parsePorcelainZ(output, "/repo");
  const at = (name) => entries.get(`/repo/${name}`)?.code;
  assert.equal(at("src/mod.ts"), "modified");
  assert.equal(at("src/new.ts"), "added");
  assert.equal(at("fresh.txt"), "untracked");
  assert.equal(at("gone.ts"), "deleted");
  assert.equal(at("conflict.ts"), "conflict");
});

test("parsePorcelainZ consumes the extra field of a rename record", () => {
  const output = ["R  dst.ts", "src/original.ts", " M other.ts", ""].join("\0");
  const entries = parsePorcelainZ(output, "/repo");
  assert.equal(entries.size, 2);
  assert.equal(entries.get("/repo/dst.ts")?.code, "renamed");
  assert.equal(entries.get("/repo/other.ts")?.code, "modified");
});

test("badgeFor renders a short status label", () => {
  assert.equal(badgeFor(undefined), "");
  assert.equal(badgeFor({ code: "untracked", raw: "??" }), "??");
  assert.equal(badgeFor({ code: "modified", raw: " M" }), "M");
  assert.equal(badgeFor({ code: "added", raw: "A " }), "A");
});

// ---------------------------------------------------------------- clipboard

test("planPaste always prompts when pasting into the source directory", async () => {
  const actions = await planPaste({
    sources: [{ path: "/a/report.txt", sourceDirectory: "/a", directory: false }],
    targetDirectory: "/a",
    exists: async () => false,
  });
  assert.deepEqual(actions, [
    { kind: "rename", source: "/a/report.txt", destination: "/a/report.txt", reason: "same-directory" },
  ]);
});

test("planPaste copies silently into a directory with no clash", async () => {
  const actions = await planPaste({
    sources: [{ path: "/a/report.txt", sourceDirectory: "/a", directory: false }],
    targetDirectory: "/b",
    exists: async () => false,
  });
  assert.deepEqual(actions, [{ kind: "copy", source: "/a/report.txt", destination: "/b/report.txt" }]);
});

test("planPaste prompts when the destination name is taken", async () => {
  const actions = await planPaste({
    sources: [{ path: "/a/report.txt", sourceDirectory: "/a", directory: false }],
    targetDirectory: "/b",
    exists: async (candidate) => candidate === "/b/report.txt",
  });
  assert.equal(actions[0].kind, "rename");
  assert.equal(actions[0].reason, "exists");
});

test("suggestName avoids collisions", () => {
  assert.equal(suggestName("report.txt", new Set()), "report copy.txt");
  assert.equal(suggestName("report.txt", new Set(["report copy.txt"])), "report copy 2.txt");
  assert.equal(suggestName("report.txt", new Set(["report copy.txt", "report copy 2.txt"])), "report copy 3.txt");
  assert.equal(suggestName("Makefile", new Set()), "Makefile copy");
  assert.equal(suggestName(".env", new Set()), ".env copy");
});

test("isSafeName rejects traversal and empty names", () => {
  assert.ok(isSafeName("report.txt"));
  assert.ok(!isSafeName(""));
  assert.ok(!isSafeName("."));
  assert.ok(!isSafeName(".."));
  assert.ok(!isSafeName("../escape.txt"));
  assert.ok(!isSafeName("nested/file.txt"));
  assert.ok(!isSafeName("windows\\path.txt"));
});

// ---------------------------------------------------------------- binary

test("extensionOf handles dots, dotfiles and extensionless names", () => {
  assert.equal(extensionOf("report.TXT"), "txt");
  assert.equal(extensionOf("/a/b/archive.tar.gz"), "gz");
  assert.equal(extensionOf(".gitignore"), "gitignore");
  assert.equal(extensionOf("Makefile"), "");
  assert.equal(extensionOf("trailing."), "");
});

test("looksBinary prefers the extension lists over a lone NUL byte", () => {
  assert.ok(looksBinary(Buffer.from([0x61, 0x00, 0x62]), "unknown.dat"));
  // A NUL byte is the strongest signal and wins even for a text extension.
  assert.ok(looksBinary(Buffer.from([0x00]), "notes.md"));
  assert.ok(looksBinary(Buffer.from("plain text"), "image.png"));
  assert.ok(!looksBinary(Buffer.from("plain text"), "notes.txt"));
  assert.ok(looksBinary(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "mystery"));
  assert.ok(!looksBinary(Buffer.alloc(0), "mystery"));
  assert.ok(isBinaryExtension("a.wasm"));
  assert.ok(isTextExtension("a.yaml"));
  assert.equal(SNIFF_BYTES, 8192);
});

// ---------------------------------------------------------------- icons

test("iconFor resolves name before extension, then falls back", () => {
  const set = iconSet("nerdfont");
  assert.equal(iconFor(set, { name: "src", directory: true, symlink: false }), set.folder);
  assert.equal(iconFor(set, { name: "src", directory: true, symlink: false, open: true }), set.folderOpen);
  assert.equal(iconFor(set, { name: "link", directory: false, symlink: true }), set.symlink);
  assert.equal(iconFor(set, { name: "a.ts", directory: false, symlink: false }), set.byExtension.ts);
  assert.equal(iconFor(set, { name: "package.json", directory: false, symlink: false }), set.byName["package.json"]);
  assert.equal(iconFor(set, { name: "unknown.zzz", directory: false, symlink: false }), set.file);
  assert.equal(iconFor(set, { name: "id_rsa", directory: false, symlink: false, protected: true }), set.protected);
});

test("iconSet switches between the nerd font and unicode palettes", () => {
  const unicode = iconSet("unicode");
  assert.notEqual(unicode.folder, iconSet("nerdfont").folder);
  assert.equal(iconFor(unicode, { name: "a.ts", directory: false, symlink: false }), unicode.file);
});

// ---------------------------------------------------------------- protect

test("compileGlob treats ** as spanning separators and * as not", () => {
  assert.ok(compileGlob("**/*.env")("config/app.env"));
  assert.ok(compileGlob("**/*.env")("app.env"));
  assert.ok(!compileGlob("**/*.env")("app.txt"));
  assert.ok(compileGlob("src/*.ts")("src/a.ts"));
  assert.ok(!compileGlob("src/*.ts")("src/nested/a.ts"));
  assert.ok(compileGlob("a?c")("abc"));
  assert.ok(!compileGlob("a?c")("a/c"));
});

test("isProtected matches the relative path and the basename", () => {
  const rules = compileProtection(["**/*.env", "**/id_rsa"]);
  assert.equal(isProtected("/root/config/app.env", "/root", rules)?.pattern, "**/*.env");
  assert.equal(isProtected("/elsewhere/id_rsa", "/root", rules)?.pattern, "**/id_rsa");
  assert.equal(isProtected("/root/readme.md", "/root", rules), undefined);
});

// ---------------------------------------------------------------- providers

test("compileMapping matches basenames case-insensitively", () => {
  assert.ok(compileMapping("*.md")("README.MD"));
  assert.ok(compileMapping("Makefile")("makefile"));
  assert.ok(!compileMapping("*.md")("readme.txt"));
});

test("resolveProvider prefers a mapping, then the default, and degrades safely", () => {
  const registry = buildRegistry(
    "plaintext",
    [{ match: "*.md", provider: "markdown" }, { match: "*.ts", provider: "missing" }],
    { markdown: { module: "/abs/markdown.js" } },
  );
  const mapped = resolveProvider(registry, "/a/readme.md");
  assert.equal(mapped.providerId, "markdown");
  assert.equal(mapped.module, "/abs/markdown.js");
  assert.equal(resolveProvider(registry, "/a/main.rs").providerId, "plaintext");
  assert.equal(resolveProvider(registry, "/a/main.ts").providerId, "plaintext");
  const readonly = buildRegistry("readonly", [], {});
  assert.equal(resolveProvider(readonly, "/a/anything").providerId, "readonly");
});

// ---------------------------------------------------------------- fs-tree

test("compileIgnore and isIgnored apply directory-only rules correctly", () => {
  const rules = compileIgnore(["node_modules/", "*.log"]);
  const dir = { name: "node_modules", path: "/a/node_modules", directory: true, symlink: false, size: 0, mtimeMs: 0 };
  const file = { ...dir, name: "node_modules", directory: false };
  const log = { ...dir, name: "debug.log", directory: false };
  assert.ok(isIgnored(dir, rules));
  assert.ok(!isIgnored(file, rules));
  assert.ok(isIgnored(log, rules));
});

test("isWithin and ancestorsOf describe containment", () => {
  assert.ok(isWithin("/root", "/root/a/b"));
  assert.ok(isWithin("/root", "/root"));
  assert.ok(!isWithin("/root", "/other"));
  assert.ok(!isWithin("/root", "/root/../other"));
  // The chain includes the root itself, so callers can drop it when they need to.
  assert.deepEqual(ancestorsOf("/root", "/root/a/b"), ["/root", "/root/a", "/root/a/b"]);
  assert.deepEqual(ancestorsOf("/root", "/root"), ["/root"]);
});

test("resolveRoot maps each mode onto a directory", () => {
  assert.equal(resolveRoot("session", null, "/sessions/one"), "/sessions/one");
  assert.equal(resolveRoot("path", "/configured", "/sessions/one"), "/configured");
  assert.equal(resolveRoot("path", null, "/sessions/one"), "/sessions/one");
  assert.equal(resolveRoot("unrestricted", "/explicit", "/sessions/one"), "/explicit");
  assert.equal(resolveRoot("unrestricted", null, "/sessions/one"), "/sessions/one");
});

test("readDirectory and flattenTree list directories first and expand on demand", async () => {
  const root = await mkdtemp(join(tmpdir(), "filebrowser-tree-"));
  try {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub/inner.txt"), "inner");
    await writeFile(join(root, "b.txt"), "b");
    await writeFile(join(root, "a.txt"), "a");
    await writeFile(join(root, "skip.log"), "log");

    const entries = await readDirectory(root);
    assert.deepEqual(entries.map((entry) => entry.name), ["sub", "a.txt", "b.txt", "skip.log"]);

    const collapsed = await flattenTree(root, new Set(), []);
    assert.deepEqual(collapsed.map((row) => [row.entry.name, row.depth, row.expanded]), [
      ["sub", 0, false],
      ["a.txt", 0, false],
      ["b.txt", 0, false],
      ["skip.log", 0, false],
    ]);

    const expanded = await flattenTree(root, new Set([join(root, "sub")]), compileIgnore(["*.log"]));
    assert.deepEqual(expanded.map((row) => [row.entry.name, row.depth, row.expanded]), [
      ["sub", 0, true],
      ["inner.txt", 1, false],
      ["a.txt", 0, false],
      ["b.txt", 0, false],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("flattenTree does not follow a symlink cycle twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "filebrowser-cycle-"));
  try {
    await mkdir(join(root, "child"));
    // A symlink pointing back at an ancestor is the case that would recurse forever.
    await symlink(root, join(root, "child/loop"));
    const expanded = new Set([root, join(root, "child"), join(root, "child/loop")]);
    const rows = await flattenTree(root, expanded, []);
    const loops = rows.filter((row) => row.entry.name === "loop");
    assert.equal(loops.length, 1);
    // The guard must stop the descent, so `child` appears once under the loop.
    assert.ok(rows.length < 20, `expected a bounded row count, got ${rows.length}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("flattenTree returns nothing for an unreadable directory", async () => {
  assert.deepEqual(await flattenTree("/definitely/not/here", new Set(), []), []);
});

// ---------------------------------------------------------------- theme

test("adaptTheme reads host tokens and fills missing ones with fallbacks", () => {
  const tokens = adaptTheme({
    text: { base: "#111", muted: "#222", feedback: { error: { base: "#f00" } } },
    background: { base: "transparent", raised: { base: "#333" } },
    syntax: { keyword: "#0f0" },
  });
  assert.equal(tokens.textBase, "#111");
  assert.equal(tokens.textMuted, "#222");
  assert.equal(tokens.error, "#f00");
  assert.equal(tokens.backgroundBase, "transparent");
  assert.equal(tokens.backgroundRaised, "#333");
  assert.equal(tokens.syntaxKeyword, "#0f0");
  assert.equal(typeof tokens.textFaint, "string");
  assert.equal(typeof tokens.syntaxPunctuation, "string");
});

test("adaptTheme tolerates a foreign or missing theme shape", () => {
  const tokens = adaptTheme(undefined);
  assert.equal(typeof tokens.textBase, "string");
  assert.equal(typeof tokens.backgroundRaisedHigh, "string");
  const rgba = { toInts: () => [1, 2, 3, 4] };
  assert.equal(adaptTheme({ text: { base: rgba } }).textBase, rgba);
  assert.equal(adaptTheme({ text: { base: 42 } }).textBase, tokens.textBase);
});

test("syntaxStyleMap exposes the tokens the editor highlights with", () => {
  const tokens = adaptTheme({});
  const map = syntaxStyleMap(tokens);
  assert.deepEqual(Object.keys(map).sort(), [
    "comment", "default", "function", "keyword", "number", "operator", "punctuation", "string", "type", "variable",
  ]);
  assert.equal(map.default.fg, tokens.textBase);
});
