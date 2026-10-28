import { createTextNode as _$createTextNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin/tui";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { ancestorsOf, compileIgnore, createBudget, flattenTree, isWithin, resolveRoot } from "./lib/fs-tree.js";
import { readGitStatus } from "./lib/git.js";
import { compileProtection, isProtected } from "./lib/protect.js";
import { buildRegistry, resolveProvider } from "./lib/providers.js";
import { copyEntry, createFile, pathExists, pathIsDirectory, readTextFile, sniffBinary, systemOpenCommand, writeTextFile } from "./lib/files.js";
import { isSafeName, planPaste, suggestName } from "./lib/clipboard.js";
import { iconSet } from "./lib/icons.js";
import { adaptTheme } from "./lib/theme.js";
import { DEFAULT_SETTINGS, describeSettings, expandHome, loadSettings, saveSettings, settingsPath } from "./lib/settings.js";
import { FilebrowserRpc } from "./rpc.js";
import { TreeRowView } from "./ui/tree-row.js";
import { Breadcrumb, Footer, TabStrip, stopEvent } from "./ui/chrome.js";
import { PlainTextEditor } from "./ui/editor.js";
import { ExternalEditor } from "./ui/provider.js";
import { createTabsStore, nextTabId, selectedPaths, toggleSelection } from "./ui/state.js";
const PANEL_NAME = "filebrowser.browser";
const COMMAND_PREFIX = "filebrowser.";
const EDITOR_MODE = "filebrowser-editor";
const DOUBLE_CLICK_MS = 400;
const MAX_TABS = 8;
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
function initialTab(root) {
  return {
    id: nextTabId(),
    title: path.basename(root) || root,
    root,
    cursorDirectory: root,
    expanded: [],
    selected: null,
    extraSelection: [],
    rows: [],
    git: undefined,
    loading: true,
    error: undefined,
    truncated: false,
    editor: undefined
  };
}

/** Directory a row's children, new files and pastes belong to. */
function directoryOf(row) {
  return row.entry.directory ? row.entry.path : path.dirname(row.entry.path);
}

/** The directory new files and pastes land in: the selected entry's directory. */
function cursorDirectoryOf(rows, selected, root) {
  if (!selected) return root;
  const row = rows.find(candidate => candidate.entry.path === selected);
  return row ? directoryOf(row) : root;
}
export default Plugin.define({
  id: "opencode.filebrowser.tui",
  setup(context) {
    const tokens = adaptTheme(context.theme);
    const sessionDirectory = context.location?.directory ?? process.cwd();
    const [settings, setSettings] = createSignal(structuredClone(DEFAULT_SETTINGS));
    const [clipboard, setClipboard] = createSignal([]);
    const [editorMode, setEditorMode] = createSignal(false);

    /**
     * The focused container of whichever browser instance is on screen. The
     * navigation layer is scoped to it so the browser never captures keys —
     * Return and Backspace above all — while the prompt or another surface
     * holds focus.
     */
    let browserRenderable;
    const ownsFocus = target => target !== undefined && !target.isDestroyed && (target.focused || target.hasFocusedDescendant);
    const store = createTabsStore(initialTab(sessionDirectory));
    let releaseMode;
    let disposed = false;
    onCleanup(() => {
      disposed = true;
      releaseMode?.();
    });
    const ignoreRules = createMemo(() => compileIgnore(settings().ignore));
    const protectionRules = createMemo(() => compileProtection(settings().protect));
    const registry = createMemo(() => buildRegistry(settings().editor.default, settings().editor.map, settings().editor.providers));
    const icons = createMemo(() => iconSet(settings().icons.style));

    /** Per-tab refresh tokens so a slow load cannot overwrite a newer one. */
    const generations = new Map();
    function toast(text, variant = "info") {
      context.ui.toast.show({
        title: "File browser",
        message: text,
        variant
      });
    }
    async function refresh(tabID) {
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      if (!tab) return;
      const generation = (generations.get(tabID) ?? 0) + 1;
      generations.set(tabID, generation);
      store.update(tabID, current => ({
        ...current,
        loading: true,
        error: undefined
      }));
      try {
        const budget = createBudget();
        const rows = await flattenTree(tab.root, new Set(tab.expanded), ignoreRules(), 0, undefined, budget);
        const git = settings().git.enabled ? await readGitStatus(tab.root, settings().git.timeoutMs) : undefined;
        if (generations.get(tabID) !== generation) return;
        store.update(tabID, current => ({
          ...current,
          rows,
          git,
          loading: false,
          truncated: budget.truncated,
          cursorDirectory: cursorDirectoryOf(rows, current.selected, current.root)
        }));
      } catch (error) {
        if (generations.get(tabID) !== generation) return;
        store.update(tabID, current => ({
          ...current,
          loading: false,
          error: message(error)
        }));
      }
    }
    async function refreshAll() {
      await Promise.all(store.tabs().map(tab => refresh(tab.id)));
    }
    function setRoot(tabID, root) {
      store.update(tabID, tab => ({
        ...tab,
        root,
        title: path.basename(root) || root,
        expanded: [],
        selected: null,
        extraSelection: [],
        cursorDirectory: root
      }));
      void refresh(tabID);
    }
    function toggleExpand(tabID, target) {
      store.update(tabID, tab => {
        const expanded = tab.expanded.includes(target) ? tab.expanded.filter(item => item !== target) : [...tab.expanded, target];
        return {
          ...tab,
          expanded
        };
      });
      void refresh(tabID);
    }
    function moveSelection(tabID, offset) {
      store.update(tabID, tab => {
        if (tab.rows.length === 0) return tab;
        const current = tab.rows.findIndex(row => row.entry.path === tab.selected);
        const next = Math.min(Math.max((current === -1 ? 0 : current) + offset, 0), tab.rows.length - 1);
        const row = tab.rows[next];
        return {
          ...tab,
          selected: row.entry.path,
          extraSelection: [],
          cursorDirectory: directoryOf(row)
        };
      });
    }
    function goUp(tabID) {
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      if (!tab) return;
      const parent = path.dirname(tab.root);
      if (parent === tab.root) return;
      const configured = resolveRoot(settings().root.mode, settings().root.path, sessionDirectory);
      if (!settings().root.allowAbove && !isWithin(configured, parent)) {
        toast("Navigation above the configured root is disabled", "warning");
        return;
      }
      setRoot(tabID, parent);
    }
    function openEditor(tabID, file) {
      return (async () => {
        const provider = resolveProvider(registry(), file);
        try {
          const loaded = await readTextFile(file, settings().editor.maxInlineBytes);
          const readOnly = loaded.tooLarge || provider.providerId === "readonly";
          store.update(tabID, tab => ({
            ...tab,
            editor: {
              path: file,
              content: loaded.content,
              saved: loaded.content,
              providerId: provider.providerId,
              providerModule: provider.module,
              providerOptions: provider.options,
              readOnly,
              tooLarge: loaded.tooLarge
            }
          }));
          if (!readOnly) {
            releaseMode?.();
            releaseMode = context.keymap.mode.push(EDITOR_MODE);
            setEditorMode(true);
          }
        } catch (error) {
          toast(`Cannot open ${path.basename(file)}: ${message(error)}`, "error");
        }
      })();
    }
    function closeEditor(tabID) {
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      const editor = tab?.editor;
      const drop = () => {
        store.update(tabID, current => ({
          ...current,
          editor: undefined
        }));
        releaseMode?.();
        releaseMode = undefined;
        setEditorMode(false);
      };
      if (editor && editor.content !== editor.saved) {
        void context.ui.dialog.confirm({
          title: "Discard changes?",
          message: `${path.basename(editor.path)} has unsaved changes.`
        }).then(confirmed => {
          if (confirmed) drop();
        });
        return;
      }
      drop();
    }
    async function saveEditor(tabID) {
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      const editor = tab?.editor;
      if (!editor || editor.readOnly) return;
      try {
        await writeTextFile(editor.path, editor.content);
        store.update(tabID, current => ({
          ...current,
          editor: current.editor ? {
            ...current.editor,
            saved: current.editor.content
          } : undefined
        }));
        toast(`Saved ${path.basename(editor.path)}`, "success");
        await refresh(tabID);
      } catch (error) {
        toast(`Save failed: ${message(error)}`, "error");
      }
    }

    /** True when another plugin currently owns the configured viewer command. */
    function viewerCommandAvailable() {
      const id = settings().binaryViewer.command;
      if (!id) return false;
      try {
        return context.keymap.commands().some(command => command.id === id);
      } catch {
        return false;
      }
    }
    function openBinary(file) {
      if (viewerCommandAvailable()) {
        context.keymap.dispatch(settings().binaryViewer.command, file);
        return;
      }
      for (const fallback of settings().binaryViewer.fallback) {
        if (fallback === "system-open") {
          const [command, args] = systemOpenCommand(file);
          try {
            spawn(command, args, {
              detached: true,
              stdio: "ignore"
            }).unref();
            toast(`Opened ${path.basename(file)} externally`, "info");
          } catch (error) {
            toast(`Cannot open ${path.basename(file)}: ${message(error)}`, "error");
          }
          return;
        }
        if (fallback === "hex") {
          toast(`${path.basename(file)} is binary; configure a binary viewer for inline display`, "warning");
          return;
        }
      }
      toast(`${path.basename(file)} is binary and no viewer is configured`, "warning");
    }
    async function openEntry(tabID, row) {
      if (row.entry.directory) {
        toggleExpand(tabID, row.entry.path);
        return;
      }
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      if (!tab) return;
      const rule = isProtected(row.entry.path, tab.root, protectionRules());
      if (rule) {
        const confirmed = await context.ui.dialog.confirm({
          title: "Protected file",
          message: `${row.entry.name} matches the protection rule "${rule.pattern}". Open it anyway?`
        });
        if (!confirmed) return;
      }
      const binary = await sniffBinary(row.entry.path).catch(() => false);
      if (binary) {
        openBinary(row.entry.path);
        return;
      }
      await openEditor(tabID, row.entry.path);
    }
    function copySelection(tabID) {
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      if (!tab) return;
      const paths = selectedPaths(tab);
      if (paths.length === 0) {
        toast("Nothing selected to copy", "warning");
        return;
      }
      setClipboard(paths.map(target => {
        const row = tab.rows.find(candidate => candidate.entry.path === target);
        return {
          path: target,
          sourceDirectory: path.dirname(target),
          directory: row?.entry.directory ?? false
        };
      }));
      const renderer = context.renderer;
      if (renderer.isOsc52Supported()) renderer.copyToClipboardOSC52(paths.join("\n"));
      toast(`${paths.length} item${paths.length === 1 ? "" : "s"} copied`, "success");
    }
    async function siblingNames(directory) {
      try {
        const rows = await flattenTree(directory, new Set(), []);
        return new Set(rows.map(row => row.entry.name));
      } catch {
        return new Set();
      }
    }
    async function pasteClipboard(tabID) {
      const sources = clipboard();
      if (sources.length === 0) {
        toast("Clipboard is empty", "warning");
        return;
      }
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      if (!tab) return;
      const targetDirectory = tab.cursorDirectory;
      const actions = await planPaste({
        sources,
        targetDirectory,
        exists: pathExists
      });
      let pasted = 0;
      let skipped = 0;
      for (const action of actions) {
        let destination = action.destination;
        if (action.kind === "rename") {
          const original = path.basename(action.source);
          const answer = await context.ui.dialog.prompt({
            title: action.reason === "same-directory" ? "Copy into the same folder" : "A file with that name exists",
            description: `${original} → ${targetDirectory}`,
            value: suggestName(original, await siblingNames(targetDirectory))
          });
          if (answer === undefined) {
            skipped += 1;
            continue;
          }
          if (!isSafeName(answer)) {
            toast(`"${answer}" is not a valid file name`, "error");
            skipped += 1;
            continue;
          }
          destination = path.join(targetDirectory, answer);
          if ((await pathExists(destination)) && settings().confirmOverwrite) {
            const overwrite = await context.ui.dialog.confirm({
              title: "Overwrite?",
              message: `${destination} already exists.`
            });
            if (!overwrite) {
              skipped += 1;
              continue;
            }
          }
        }
        try {
          await copyEntry(action.source, destination);
          pasted += 1;
        } catch (error) {
          toast(`Copy failed: ${message(error)}`, "error");
          skipped += 1;
        }
      }
      toast(skipped > 0 ? `${pasted} pasted, ${skipped} skipped` : `${pasted} pasted`, skipped > 0 ? "warning" : "success");
      await refresh(tabID);
    }
    async function createEntry(tabID) {
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      if (!tab) return;
      const name = await context.ui.dialog.prompt({
        title: "New file",
        description: `In ${tab.cursorDirectory}`,
        placeholder: "name.txt"
      });
      if (name === undefined || name === "") return;
      if (!isSafeName(name)) {
        toast(`"${name}" is not a valid file name`, "error");
        return;
      }
      const destination = path.join(tab.cursorDirectory, name);
      try {
        await createFile(destination);
        toast(`Created ${name}`, "success");
        store.update(tabID, current => ({
          ...current,
          selected: destination
        }));
        await refresh(tabID);
      } catch (error) {
        toast(`Cannot create ${name}: ${message(error)}`, "error");
      }
    }
    async function goToPath(tabID) {
      const answer = await context.ui.dialog.prompt({
        title: "Go to directory",
        description: "Absolute path, ~ or a path relative to the current root",
        placeholder: "~/projects"
      });
      if (answer === undefined || answer === "") return;
      const expanded = answer === "~" ? os.homedir() : answer.startsWith("~/") ? path.join(os.homedir(), answer.slice(2)) : answer;
      const tab = store.tabs().find(candidate => candidate.id === tabID);
      const candidate = path.resolve(tab?.root ?? sessionDirectory, expanded);
      if (!(await pathIsDirectory(candidate))) {
        toast(`${candidate} is not a directory`, "error");
        return;
      }
      const configured = resolveRoot(settings().root.mode, settings().root.path, sessionDirectory);
      if (!settings().root.allowAbove && !isWithin(configured, candidate)) {
        toast("Navigation above the configured root is disabled", "warning");
        return;
      }
      setRoot(tabID, candidate);
    }
    function newTab() {
      if (store.tabs().length >= MAX_TABS) {
        toast(`At most ${MAX_TABS} browser tabs`, "warning");
        return;
      }
      const tab = initialTab(store.active()?.root ?? sessionDirectory);
      store.add(tab);
      void refresh(tab.id);
    }
    function openPanel() {
      if (!context.ui.panel.open(PANEL_NAME, {
        presentation: "panel"
      })) {
        toast("Open a session first — the browser panel is session-scoped", "warning");
      }
    }
    function togglePanel() {
      if (context.ui.panel.current()?.name === PANEL_NAME) context.ui.panel.close();else openPanel();
    }

    /** Rewrites settings and re-reads the file so the file stays authoritative. */
    async function persistSettings(mutate) {
      const file = settingsPath();
      const current = await loadSettings(file);
      const next = mutate(current);
      try {
        await saveSettings(next, file);
      } catch (error) {
        toast(`Cannot write ${file}: ${message(error)}`, "error");
        return;
      }
      setSettings(next);
      const before = resolveRoot(current.root.mode, current.root.path, sessionDirectory);
      const after = resolveRoot(next.root.mode, next.root.path, sessionDirectory);
      // Only a root change invalidates a tree; every other setting is picked up
      // by a plain refresh, which keeps the user's selection and expansion.
      if (before !== after) for (const tab of store.tabs()) setRoot(tab.id, after);else await refreshAll();
      toast(`Saved ${path.basename(file)}`, "success");
    }

    /** A small menu over the settings file; every change is written immediately. */
    async function openSettings() {
      const file = settingsPath();
      while (true) {
        const current = settings();
        const choice = await context.ui.dialog.select({
          title: "File browser settings",
          placeholder: file,
          options: [{
            title: "Root",
            value: "root",
            description: describeSettings(current),
            footer: current.root.mode
          }, {
            title: "Icons",
            value: "icons",
            description: "Directory and file glyphs",
            footer: current.icons.style
          }, {
            title: "Git status",
            value: "git",
            description: "Colour rows by working-tree state",
            footer: current.git.enabled ? "on" : "off"
          }, {
            title: "Editor provider",
            value: "editor",
            description: "Default editor for text files",
            footer: current.editor.default
          }, {
            title: "Binary viewer",
            value: "viewer",
            description: "Command used for non-text files",
            footer: current.binaryViewer.command
          }, {
            title: "Show settings file path",
            value: "path",
            description: file
          }]
        });
        if (choice === undefined) return;
        if (choice === "root") {
          const mode = await context.ui.dialog.select({
            title: "Root",
            options: [{
              title: "Session directory",
              value: "session",
              description: "Start at the directory of the current session"
            }, {
              title: "Fixed path",
              value: "path",
              description: "Always start at a path you choose"
            }, {
              title: "Unrestricted",
              value: "unrestricted",
              description: "Start at the session directory, navigate anywhere"
            }],
            current: current.root.mode
          });
          if (mode === undefined) continue;
          let fixed = current.root.path;
          if (mode === "path") {
            const answer = await context.ui.dialog.prompt({
              title: "Root path",
              description: "Absolute path, or ~ for your home directory",
              value: current.root.path ?? ""
            });
            if (answer === undefined) continue;
            fixed = answer === "" ? null : expandHome(answer);
          }
          await persistSettings(settings => ({
            ...settings,
            root: {
              ...settings.root,
              mode,
              path: fixed
            }
          }));
          continue;
        }
        if (choice === "icons") {
          const style = await context.ui.dialog.select({
            title: "Icon style",
            options: [{
              title: "Nerd Font",
              value: "nerdfont",
              description: "Requires a patched font"
            }, {
              title: "Unicode",
              value: "unicode",
              description: "Works with any font"
            }],
            current: current.icons.style
          });
          if (style === undefined) continue;
          await persistSettings(settings => ({
            ...settings,
            icons: {
              ...settings.icons,
              style
            }
          }));
          continue;
        }
        if (choice === "git") {
          await persistSettings(settings => ({
            ...settings,
            git: {
              ...settings.git,
              enabled: !settings.git.enabled
            }
          }));
          continue;
        }
        if (choice === "editor") {
          const answer = await context.ui.dialog.prompt({
            title: "Default editor provider",
            description: "A built-in id (plaintext, readonly) or a provider id from editor.providers",
            value: current.editor.default
          });
          if (answer === undefined || answer === "") continue;
          await persistSettings(settings => ({
            ...settings,
            editor: {
              ...settings.editor,
              default: answer
            }
          }));
          continue;
        }
        if (choice === "viewer") {
          const answer = await context.ui.dialog.prompt({
            title: "Binary viewer command",
            description: "OpenCode command used to view non-text files",
            value: current.binaryViewer.command
          });
          if (answer === undefined || answer === "") continue;
          await persistSettings(settings => ({
            ...settings,
            binaryViewer: {
              ...settings.binaryViewer,
              command: answer
            }
          }));
          continue;
        }
        await context.ui.dialog.alert({
          title: "Settings file",
          message: file
        });
      }
    }

    /** Expands the ancestor chain and selects a path, used by the reveal RPC. */
    async function reveal(target) {
      const active = store.active();
      if (!active) return;
      const configured = resolveRoot(settings().root.mode, settings().root.path, sessionDirectory);
      const base = isWithin(configured, target) ? configured : path.parse(target).root;
      const directory = (await pathIsDirectory(target)) ? target : path.dirname(target);
      const chain = ancestorsOf(base, directory).filter(item => item !== base);
      store.update(active.id, tab => ({
        ...tab,
        root: base,
        title: path.basename(base) || base,
        expanded: [...new Set([...tab.expanded, ...chain])],
        selected: target,
        extraSelection: [],
        cursorDirectory: directory
      }));
      await refresh(active.id);
    }

    // Filesystem watching: one debounced watcher per tab root.
    const watchers = new Map();
    const timers = new Map();
    createEffect(() => {
      const enabled = settings().watch.enabled;
      const debounceMs = settings().watch.debounceMs;
      const wanted = new Map();
      if (enabled) for (const tab of store.tabs()) wanted.set(tab.id, tab.root);
      for (const [id, entry] of watchers) {
        if (wanted.get(id) !== entry.root) {
          entry.close();
          watchers.delete(id);
        }
      }
      if (!enabled) return;
      for (const [id, root] of wanted) {
        if (watchers.has(id)) continue;
        try {
          const handle = watch(root, {
            recursive: true
          }, () => {
            const pending = timers.get(id);
            if (pending) clearTimeout(pending);
            const timer = setTimeout(() => {
              timers.delete(id);
              void refresh(id);
            }, debounceMs);
            timer.unref?.();
            timers.set(id, timer);
          });
          handle.on("error", () => {
            handle.close();
            watchers.delete(id);
          });
          handle.unref?.();
          watchers.set(id, {
            close: () => handle.close(),
            root
          });
        } catch {
          // Watching is best-effort; a failure leaves manual refresh available.
        }
      }
    });
    onCleanup(() => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const entry of watchers.values()) entry.close();
      watchers.clear();
    });

    // Host-reported filesystem changes refresh every tab.
    const unsubscribeFs = context.data.on("filesystem.changed", () => {
      for (const tab of store.tabs()) void refresh(tab.id);
    });
    onCleanup(unsubscribeFs);
    const navigationCommands = [{
      id: `${COMMAND_PREFIX}down`,
      title: "Move down",
      bind: "down",
      run: () => moveSelection(store.active()?.id ?? "", 1)
    }, {
      id: `${COMMAND_PREFIX}up`,
      title: "Move up",
      bind: "up",
      run: () => moveSelection(store.active()?.id ?? "", -1)
    }, {
      id: `${COMMAND_PREFIX}open`,
      title: "Expand directory or open file",
      bind: "right,return",
      run: () => {
        const tab = store.active();
        const row = tab?.rows.find(candidate => candidate.entry.path === tab.selected);
        if (tab && row) void openEntry(tab.id, row);
      }
    }, {
      id: `${COMMAND_PREFIX}collapse`,
      title: "Collapse directory or go up",
      bind: "left",
      run: () => {
        const tab = store.active();
        if (!tab) return;
        const row = tab.rows.find(candidate => candidate.entry.path === tab.selected);
        if (row?.entry.directory && tab.expanded.includes(row.entry.path)) toggleExpand(tab.id, row.entry.path);else goUp(tab.id);
      }
    }, {
      id: `${COMMAND_PREFIX}parent`,
      title: "Go to parent directory",
      bind: "backspace",
      run: () => goUp(store.active()?.id ?? "")
    }, {
      id: `${COMMAND_PREFIX}refresh`,
      title: "Refresh tree",
      bind: "f5",
      run: () => void refreshAll()
    }, {
      id: `${COMMAND_PREFIX}goto`,
      title: "Go to directory",
      bind: "ctrl+g",
      run: () => void goToPath(store.active()?.id ?? "")
    }, {
      id: `${COMMAND_PREFIX}newfile`,
      title: "New file",
      bind: "ctrl+n",
      run: () => void createEntry(store.active()?.id ?? "")
    }, {
      id: `${COMMAND_PREFIX}copy`,
      title: "Copy selection",
      bind: "ctrl+c",
      run: () => copySelection(store.active()?.id ?? "")
    }, {
      id: `${COMMAND_PREFIX}paste`,
      title: "Paste into directory",
      bind: "ctrl+v",
      run: () => void pasteClipboard(store.active()?.id ?? "")
    }, {
      id: `${COMMAND_PREFIX}newtab`,
      title: "New browser tab",
      bind: "ctrl+t",
      run: () => newTab()
    }, {
      id: `${COMMAND_PREFIX}closetab`,
      title: "Close browser tab",
      bind: "ctrl+w",
      run: () => {
        const tab = store.active();
        if (tab && store.tabs().length > 1) store.close(tab.id);
      }
    }, {
      id: `${COMMAND_PREFIX}nexttab`,
      title: "Next browser tab",
      bind: "ctrl+tab",
      run: () => store.setActiveIndex(store.activeIndex() + 1)
    }, {
      id: `${COMMAND_PREFIX}previoustab`,
      title: "Previous browser tab",
      bind: "ctrl+shift+tab",
      run: () => store.setActiveIndex(store.activeIndex() - 1)
    }, {
      id: `${COMMAND_PREFIX}togglepanel`,
      title: "Toggle browser panel",
      bind: "ctrl+o",
      run: () => togglePanel()
    }];
    context.keymap.layer(() => ({
      mode: "base",
      priority: 50,
      // Scoped to the browser so prompt/global keys are untouched, and enabled
      // only while it actually owns focus. A target that resolves to nothing
      // would make the layer globally active, so `enabled` guards it too.
      target: () => browserRenderable,
      enabled: () => ownsFocus(browserRenderable) && !editorMode(),
      commands: navigationCommands
    }));
    context.keymap.layer(() => ({
      mode: EDITOR_MODE,
      priority: 60,
      enabled: () => editorMode(),
      commands: [{
        id: `${COMMAND_PREFIX}save`,
        title: "Save file",
        bind: "ctrl+s",
        run: () => void saveEditor(store.active()?.id ?? "")
      }, {
        id: `${COMMAND_PREFIX}closeeditor`,
        title: "Close editor",
        bind: "escape",
        run: () => closeEditor(store.active()?.id ?? "")
      }]
    }));
    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [{
        id: `${COMMAND_PREFIX}panel`,
        title: "Open file browser panel",
        group: "File browser",
        description: "Open the file browser in a side panel",
        palette: true,
        run: () => openPanel()
      }, {
        id: `${COMMAND_PREFIX}reveal`,
        title: "Reveal a path in the file browser",
        group: "File browser",
        description: "Expand and select a file or directory in the browser",
        slash: {
          name: "filebrowser",
          arguments: true
        },
        run: async input => {
          const raw = input?.trim();
          if (!raw) return;
          const target = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : path.resolve(sessionDirectory, raw);
          await reveal(target);
        }
      }, {
        id: `${COMMAND_PREFIX}focus`,
        title: "Focus the file browser",
        group: "File browser",
        description: "Move keyboard focus to the file browser so its shortcuts apply",
        palette: true,
        run: () => {
          const target = browserRenderable;
          if (!target || target.isDestroyed) return;
          if (!target.focused) target.focus();
        }
      }, {
        id: `${COMMAND_PREFIX}settings`,
        title: "File browser settings",
        group: "File browser",
        description: "Change the browser's settings and write them to filebrowser.json",
        palette: true,
        run: () => void openSettings()
      }]
    }));
    const actions = {
      openRow: row => {
        const tab = store.active();
        if (tab) void openEntry(tab.id, row);
      },
      selectRow: (row, modifiers) => {
        const tab = store.active();
        if (!tab) return;
        if (modifiers.shift || modifiers.ctrl || modifiers.meta) {
          store.update(tab.id, state => ({
            ...state,
            ...toggleSelection(state, row.entry.path)
          }));
          return;
        }
        store.update(tab.id, state => ({
          ...state,
          selected: row.entry.path,
          extraSelection: [],
          cursorDirectory: directoryOf(row)
        }));
      },
      saveEditor: () => void saveEditor(store.active()?.id ?? ""),
      closeEditor: () => closeEditor(store.active()?.id ?? ""),
      register: target => {
        browserRenderable = target;
      },
      unregister: target => {
        if (browserRenderable === target) browserRenderable = undefined;
      }
    };
    context.ui.slot({
      append: "sidebar.content",
      render: () => _$createComponent(Browser, {
        context: context,
        tokens: tokens,
        store: store,
        settings: settings,
        icons: icons,
        actions: actions
      })
    });
    context.ui.slot({
      append: "session.panel",
      render: panel => _$createComponent(Show, {
        get when() {
          return panel.name === PANEL_NAME;
        },
        get children() {
          return _$createComponent(Browser, {
            context: context,
            tokens: tokens,
            store: store,
            settings: settings,
            icons: icons,
            actions: actions,
            panel: panel
          });
        }
      })
    });
    void loadSettings().then(loaded => {
      if (disposed) return;
      setSettings(loaded);
      const root = resolveRoot(loaded.root.mode, loaded.root.path, sessionDirectory);
      const active = store.active();
      if (active && active.root === sessionDirectory) setRoot(active.id, root);
    });
    const rpc = context.client.rpc(FilebrowserRpc);
    const unsubscribeRpc = rpc.events.on("open", async event => {
      const here = context.location?.directory;
      if (here && event.location?.directory && event.location.directory !== here) return;
      const data = event.data;
      await reveal(data.path);
      const active = store.active();
      if (!active) return;
      if (data.mode === "edit") await openEditor(active.id, data.path);else if (data.mode === "view") openBinary(data.path);
    });
    void refresh(store.active()?.id ?? "");
    return () => {
      unsubscribeRpc();
      releaseMode?.();
    };
  }
});
function Browser(props) {
  const tab = () => props.store.active();
  let lastClick;
  /** This instance's focusable container, published as the keymap layer target. */
  let container;

  // The host focuses the panel's own container on open, which is outside this
  // subtree, so the scoped layer would stay inactive. Move focus inside the
  // browser. Runs after the host's mount effect, so it wins. The sidebar is
  // deliberately left alone: focusing it would steal the prompt's focus.
  onMount(() => {
    if (!props.panel) return;
    props.panel.focus();
    if (container && !container.isDestroyed) container.focus();
  });

  /** Keeps the active tab's editor buffer in sync with an editor component. */
  const onEditorChange = content => {
    const current = props.store.active();
    if (!current) return;
    props.store.update(current.id, state => ({
      ...state,
      editor: state.editor ? {
        ...state.editor,
        content
      } : undefined
    }));
  };
  const onRowMouseDown = (event, row) => {
    stopEvent(event);
    const now = Date.now();
    const double = lastClick !== undefined && lastClick.path === row.entry.path && now - lastClick.time < DOUBLE_CLICK_MS;
    lastClick = {
      path: row.entry.path,
      time: now
    };
    if (double) {
      lastClick = undefined;
      props.actions.openRow(row);
      return;
    }
    const modifiers = event?.modifiers ?? {};
    props.actions.selectRow(row, modifiers);
  };
  const protectedRows = createMemo(() => compileProtection(props.settings().protect));
  const isRowProtected = (row, root) => isProtected(row.entry.path, root, protectedRows()) !== undefined;
  const hint = createMemo(() => tab()?.editor ? "ctrl+s save · esc close" : "\u2191\u2193 move · \u2192 open · \u2190 up · ctrl+c/v copy/paste · ctrl+o panel");
  return (() => {
    var _el$ = _$createElement("box");
    _$use(target => {
      container = target;
      props.actions.register(target);
      onCleanup(() => {
        container = undefined;
        props.actions.unregister(target);
      });
    }, _el$);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "width", "100%");
    _$setProp(_el$, "height", "100%");
    _$setProp(_el$, "paddingLeft", 1);
    _$setProp(_el$, "paddingRight", 1);
    _$setProp(_el$, "focusable", true);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return tab();
      },
      get fallback() {
        return (() => {
          var _el$4 = _$createElement("text");
          _$insertNode(_el$4, _$createTextNode(`no browser tab`));
          _$effect(_$p => _$setProp(_el$4, "fg", props.tokens.textMuted, _$p));
          return _el$4;
        })();
      },
      children: current => _$createComponent(Show, {
        get when() {
          return !current().editor;
        },
        get fallback() {
          return (() => {
            var _el$11 = _$createElement("box"),
              _el$12 = _$createElement("box"),
              _el$13 = _$createElement("text"),
              _el$14 = _$createElement("text");
            _$insertNode(_el$11, _el$12);
            _$setProp(_el$11, "flexDirection", "column");
            _$setProp(_el$11, "width", "100%");
            _$setProp(_el$11, "height", "100%");
            _$insert(_el$11, _$createComponent(Show, {
              get when() {
                return current().editor.providerModule;
              },
              get fallback() {
                return _$createComponent(PlainTextEditor, {
                  get tab() {
                    return current().editor;
                  },
                  get tokens() {
                    return props.tokens;
                  },
                  get owner() {
                    return props.context.renderer.nativeScene;
                  },
                  onChange: onEditorChange
                });
              },
              get children() {
                return _$createComponent(ExternalEditor, {
                  get tab() {
                    return current().editor;
                  },
                  get tokens() {
                    return props.tokens;
                  },
                  onChange: onEditorChange
                });
              }
            }), _el$12);
            _$insertNode(_el$12, _el$13);
            _$insertNode(_el$12, _el$14);
            _$setProp(_el$12, "flexDirection", "row");
            _$setProp(_el$12, "height", 1);
            _$setProp(_el$12, "flexShrink", 0);
            _$setProp(_el$12, "gap", 1);
            _$insert(_el$13, () => `${path.basename(current().editor.path)} · ${current().editor.content === current().editor.saved ? "saved" : "modified"}`);
            _$insert(_el$14, (() => {
              var _c$ = _$memo(() => !!current().editor.readOnly);
              return () => _c$() ? "read-only" : current().editor.providerId;
            })());
            _$effect(_p$ => {
              var _v$ = props.tokens.textMuted,
                _v$2 = props.tokens.textFaint;
              _v$ !== _p$.e && (_p$.e = _$setProp(_el$13, "fg", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp(_el$14, "fg", _v$2, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$11;
          })();
        },
        get children() {
          var _el$6 = _$createElement("box"),
            _el$7 = _$createElement("scrollbox");
          _$insertNode(_el$6, _el$7);
          _$setProp(_el$6, "flexDirection", "column");
          _$setProp(_el$6, "width", "100%");
          _$setProp(_el$6, "height", "100%");
          _$insert(_el$6, _$createComponent(TabStrip, {
            get tabs() {
              return props.store.tabs();
            },
            get activeIndex() {
              return props.store.activeIndex();
            },
            get tokens() {
              return props.tokens;
            },
            onSelect: index => props.store.setActiveIndex(index),
            onClose: index => props.store.close(props.store.tabs()[index]?.id ?? "")
          }), _el$7);
          _$insert(_el$6, _$createComponent(Breadcrumb, {
            get path() {
              return current().root;
            },
            get tokens() {
              return props.tokens;
            },
            get branch() {
              return current().git?.branch;
            },
            get truncated() {
              return current().truncated;
            }
          }), _el$7);
          _$setProp(_el$7, "width", "100%");
          _$setProp(_el$7, "flexGrow", 1);
          _$insert(_el$7, _$createComponent(For, {
            get each() {
              return current().rows;
            },
            children: row => _$createComponent(TreeRowView, {
              row: row,
              get tokens() {
                return props.tokens;
              },
              get icons() {
                return props.icons();
              },
              get selected() {
                return current().selected === row.entry.path;
              },
              get alsoSelected() {
                return current().extraSelection.includes(row.entry.path);
              },
              get status() {
                return current().git?.entries.get(row.entry.path);
              },
              get ["protected"]() {
                return isRowProtected(row, current().root);
              },
              get showBadges() {
                return props.settings().git.badges;
              },
              onMouseDown: onRowMouseDown
            })
          }), null);
          _$insert(_el$7, _$createComponent(Show, {
            get when() {
              return _$memo(() => current().rows.length === 0)() && !current().loading;
            },
            get children() {
              var _el$8 = _$createElement("text");
              _$insertNode(_el$8, _$createTextNode(`empty directory`));
              _$effect(_$p => _$setProp(_el$8, "fg", props.tokens.textMuted, _$p));
              return _el$8;
            }
          }), null);
          _$insert(_el$7, _$createComponent(Show, {
            get when() {
              return current().loading;
            },
            get children() {
              var _el$0 = _$createElement("text");
              _$insertNode(_el$0, _$createTextNode(`loading…`));
              _$effect(_$p => _$setProp(_el$0, "fg", props.tokens.textMuted, _$p));
              return _el$0;
            }
          }), null);
          _$insert(_el$7, _$createComponent(Show, {
            get when() {
              return current().error;
            },
            get children() {
              var _el$10 = _$createElement("text");
              _$insert(_el$10, () => current().error);
              _$effect(_$p => _$setProp(_el$10, "fg", props.tokens.error, _$p));
              return _el$10;
            }
          }), null);
          _$insert(_el$6, _$createComponent(Footer, {
            get tokens() {
              return props.tokens;
            },
            get message() {
              return `${current().rows.length} entries${current().selected ? ` · ${path.basename(current().selected)}` : ""}`;
            },
            get hint() {
              return hint();
            }
          }), null);
          return _el$6;
        }
      })
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return props.panel;
      },
      get children() {
        var _el$2 = _$createElement("box"),
          _el$3 = _$createElement("text");
        _$insertNode(_el$2, _el$3);
        _$setProp(_el$2, "flexDirection", "row");
        _$setProp(_el$2, "height", 1);
        _$setProp(_el$2, "flexShrink", 0);
        _$setProp(_el$3, "onMouseDown", event => {
          stopEvent(event);
          props.panel?.focus();
        });
        _$insert(_el$3, () => props.panel?.focused ? "focused · ctrl+o closes" : "click to focus");
        _$effect(_$p => _$setProp(_el$3, "fg", props.panel?.focused ? props.tokens.textMuted : props.tokens.textFaint, _$p));
        return _el$2;
      }
    }), null);
    return _el$;
  })();
}
