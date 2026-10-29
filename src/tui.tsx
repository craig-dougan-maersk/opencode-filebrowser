import { watch } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin/tui";
import type { Context, PanelInput } from "@opencode/plugin/tui/context";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { TextAttributes, type Renderable } from "@opentui/core";
import { ancestorsOf, compileIgnore, createBudget, flattenTree, isWithin, resolveRoot, type TreeRow } from "./lib/fs-tree";
import { readGitStatus, statusFor, type GitStatus } from "./lib/git";
import { compileProtection, isProtected } from "./lib/protect";
import { buildRegistry, resolveProvider } from "./lib/providers";
import {
  copyEntry,
  createFile,
  pathExists,
  pathIsDirectory,
  readTextFile,
  sniffBinary,
  systemOpenCommand,
  writeTextFile,
} from "./lib/files";
import { isSafeName, planPaste, suggestName, type PasteSource } from "./lib/clipboard";
import { iconSet, type IconSet } from "./lib/icons";
import { adaptTheme, type ThemeTokens } from "./lib/theme";
import { DEFAULT_SETTINGS, describeSettings, expandHome, loadSettings, saveSettings, settingsPath, type FilebrowserSettings } from "./lib/settings";
import { FilebrowserRpc } from "./rpc";
import { TreeRowView } from "./ui/tree-row";
import { Breadcrumb, Footer, TabStrip, stopEvent } from "./ui/chrome";
import { EditorOverlay } from "./ui/overlay";
import { createTabsStore, nextTabId, selectedPaths, toggleSelection, type TabState, type TabsStore } from "./ui/state";

const PANEL_NAME = "filebrowser.browser";
const COMMAND_PREFIX = "filebrowser.";
/**
 * Input mode pushed only while a browser container holds focus. Every browser
 * shortcut lives in this mode, so nothing is bound while the prompt is focused.
 */
const BROWSER_MODE = "filebrowser";
const SIDEBAR_STATE_KEY = "filebrowser.sidebar";
const DOUBLE_CLICK_MS = 400;
const MAX_TABS = 8;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialTab(root: string): TabState {
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
    editor: undefined,
  };
}

/** Directory a row's children, new files and pastes belong to. */
function directoryOf(row: TreeRow): string {
  return row.entry.directory ? row.entry.path : path.dirname(row.entry.path);
}

/** The directory new files and pastes land in: the selected entry's directory. */
function cursorDirectoryOf(rows: readonly TreeRow[], selected: string | null, root: string): string {
  if (!selected) return root;
  const row = rows.find((candidate) => candidate.entry.path === selected);
  return row ? directoryOf(row) : root;
}

export default Plugin.define({
  id: "opencode.filebrowser.tui",
  setup(context: Context) {
    const tokens: ThemeTokens = adaptTheme(context.theme);
    const sessionDirectory = context.location?.directory ?? process.cwd();

    const [settings, setSettings] = createSignal<FilebrowserSettings>(structuredClone(DEFAULT_SETTINGS));
    const [clipboard, setClipboard] = createSignal<PasteSource[]>([]);
    /** Tab whose file is open in the editor overlay, if any. */
    const [overlayTab, setOverlayTab] = createSignal<string | undefined>(undefined);
    const overlayOpen = () => overlayTab() !== undefined;
    let overlaySeq = 0;

    const [sidebarState, setSidebarState] = context.storage.store<{ collapsed: boolean | null }>(SIDEBAR_STATE_KEY, {
      initial: { collapsed: null },
    });
    const optionCollapsed = typeof context.options?.collapsedByDefault === "boolean" ? context.options.collapsedByDefault : undefined;
    const sidebarCollapsed = () => sidebarState.collapsed ?? optionCollapsed ?? settings().sidebar.collapsedByDefault;
    const toggleSidebar = () => {
      const next = !sidebarCollapsed();
      void Promise.resolve(
        setSidebarState((draft) => {
          draft.collapsed = next;
        }),
      ).catch((error: unknown) => toast(`Cannot save sidebar state: ${message(error)}`, "warning"));
    };
    const panelOpen = () => context.ui.panel.current()?.name === PANEL_NAME;
    /** Watchers and git only run while some browser is actually visible. */
    const visible = () => !sidebarCollapsed() || panelOpen();

    /**
     * Focusable containers of the browser instances on screen. While focus is
     * on one of them (or inside one) the browser mode is pushed; otherwise no
     * browser shortcut is reachable and the prompt keeps every key.
     */
    const containers = new Set<Renderable>();
    let browserRenderable: Renderable | undefined;
    let releaseBrowserMode: (() => void) | undefined;
    const [focusedContainer, setFocusedContainer] = createSignal<Renderable | undefined>(undefined);

    const insideBrowser = (target: Renderable | null | undefined): Renderable | undefined => {
      for (let node: Renderable | null | undefined = target; node; node = node.parent as Renderable | null) {
        if (containers.has(node)) return node;
      }
      return undefined;
    };
    const syncBrowserMode = (focused: Renderable | null | undefined) => {
      const owner = overlayOpen() ? undefined : insideBrowser(focused);
      setFocusedContainer(owner);
      if (owner) {
        browserRenderable = owner;
        if (!releaseBrowserMode) releaseBrowserMode = context.keymap.mode.push(BROWSER_MODE);
        return;
      }
      releaseBrowserMode?.();
      releaseBrowserMode = undefined;
    };
    const onFocusChange = (focused: Renderable | null) => syncBrowserMode(focused);
    context.renderer.on("focused_renderable", onFocusChange);

    // The overlay suspends the browser mode; restore it once the overlay is gone.
    createEffect(() => {
      overlayOpen();
      syncBrowserMode(context.renderer.currentFocusedRenderable);
    });

    const store = createTabsStore(initialTab(sessionDirectory));

    let disposed = false;

    onCleanup(() => {
      disposed = true;
      context.renderer.off("focused_renderable", onFocusChange);
      releaseBrowserMode?.();
      releaseBrowserMode = undefined;
    });

    const ignoreRules = createMemo(() => compileIgnore(settings().ignore));
    const protectionRules = createMemo(() => compileProtection(settings().protect));
    const registry = createMemo(() =>
      buildRegistry(settings().editor.default, settings().editor.map, settings().editor.providers),
    );
    const icons = createMemo(() => iconSet(settings().icons.style));

    /** Per-tab refresh tokens so a slow load cannot overwrite a newer one. */
    const generations = new Map<string, number>();

    function toast(text: string, variant: "info" | "success" | "warning" | "error" = "info"): void {
      context.ui.toast.show({ title: "File browser", message: text, variant });
    }

    async function refresh(tabID: string): Promise<void> {
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
      if (!tab) return;
      const generation = (generations.get(tabID) ?? 0) + 1;
      generations.set(tabID, generation);
      store.update(tabID, (current) => ({ ...current, loading: true, error: undefined }));
      try {
        const budget = createBudget();
        const rows = await flattenTree(tab.root, new Set(tab.expanded), ignoreRules(), 0, undefined, budget);
        const git: GitStatus | undefined =
          settings().git.enabled && visible()
            ? await readGitStatus(tab.root, settings().git.timeoutMs, { unpushed: settings().git.showUnpushed })
            : tab.git;
        if (generations.get(tabID) !== generation) return;
        store.update(tabID, (current) => ({
          ...current,
          rows,
          git,
          loading: false,
          truncated: budget.truncated,
          cursorDirectory: cursorDirectoryOf(rows, current.selected, current.root),
        }));
      } catch (error) {
        if (generations.get(tabID) !== generation) return;
        store.update(tabID, (current) => ({ ...current, loading: false, error: message(error) }));
      }
    }

    async function refreshAll(): Promise<void> {
      await Promise.all(store.tabs().map((tab) => refresh(tab.id)));
    }

    function setRoot(tabID: string, root: string): void {
      store.update(tabID, (tab) => ({
        ...tab,
        root,
        title: path.basename(root) || root,
        expanded: [],
        selected: null,
        extraSelection: [],
        cursorDirectory: root,
      }));
      void refresh(tabID);
    }

    function toggleExpand(tabID: string, target: string): void {
      store.update(tabID, (tab) => {
        const expanded = tab.expanded.includes(target)
          ? tab.expanded.filter((item) => item !== target)
          : [...tab.expanded, target];
        return { ...tab, expanded };
      });
      void refresh(tabID);
    }

    function moveSelection(tabID: string, offset: number): void {
      store.update(tabID, (tab) => {
        if (tab.rows.length === 0) return tab;
        const current = tab.rows.findIndex((row) => row.entry.path === tab.selected);
        const next = Math.min(Math.max((current === -1 ? 0 : current) + offset, 0), tab.rows.length - 1);
        const row = tab.rows[next];
        return { ...tab, selected: row.entry.path, extraSelection: [], cursorDirectory: directoryOf(row) };
      });
    }

    function goUp(tabID: string): void {
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
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

    function editorOf(tabID: string | undefined) {
      return store.tabs().find((candidate) => candidate.id === tabID)?.editor;
    }

    const isDirty = (tabID: string | undefined): boolean => {
      const editor = editorOf(tabID);
      return editor !== undefined && !editor.readOnly && editor.content !== editor.saved;
    };

    function dropEditor(tabID: string): void {
      store.update(tabID, (current) => ({ ...current, editor: undefined }));
      if (overlayTab() === tabID) setOverlayTab(undefined);
    }

    function updateEditorContent(tabID: string, content: string): void {
      store.update(tabID, (state) => ({
        ...state,
        editor: state.editor ? { ...state.editor, content } : undefined,
      }));
    }

    /**
     * Shows the editor in the host dialog layer, over the session. `show`
     * replaces the whole dialog stack, so a nested question closes the overlay
     * and the overlay is re-shown afterwards; the buffer lives in the tab, so
     * nothing typed is lost.
     */
    function showOverlay(tabID: string): void {
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
      if (!tab?.editor) return;
      // show() runs the previous dialog's onClose; the token lets that stale
      // onClose see it has been superseded, even when it is the same tab.
      const seq = ++overlaySeq;
      setOverlayTab(tabID);
      syncBrowserMode(null);
      context.ui.dialog.show(
        () => (
          <EditorOverlay
            editor={() => editorOf(tabID)}
            root={() => store.tabs().find((candidate) => candidate.id === tabID)?.root ?? tab.root}
            tokens={tokens}
            owner={context.renderer.nativeScene}
            onChange={(content) => updateEditorContent(tabID, content)}
            onSave={() => void saveEditor(tabID)}
            onClose={() => requestCloseEditor(tabID)}
          />
        ),
        () => {
          // The host closed the dialog: Esc, Ctrl+C, a backdrop click, or
          // another dialog replacing it. A dirty buffer is kept in the tab and
          // offered again on the next open; a clean one is dropped.
          if (seq !== overlaySeq || overlayTab() !== tabID) return;
          setOverlayTab(undefined);
          if (isDirty(tabID)) {
            const editor = editorOf(tabID);
            toast(`${path.basename(editor?.path ?? "")} has unsaved changes; open it again to save or discard`, "warning");
            return;
          }
          store.update(tabID, (current) => ({ ...current, editor: undefined }));
        },
      );
      context.ui.dialog.set({ size: "xlarge" });
    }

    async function openEditor(tabID: string, file: string): Promise<void> {
      const existing = editorOf(tabID);
      if (existing && (existing.path === file || isDirty(tabID))) {
        // Never replace a buffer with unsaved changes; bring it back instead.
        if (existing.path !== file) toast(`${path.basename(existing.path)} has unsaved changes`, "warning");
        showOverlay(tabID);
        return;
      }
      const provider = resolveProvider(registry(), file);
      try {
        const loaded = await readTextFile(file, settings().editor.maxInlineBytes);
        const readOnly = loaded.tooLarge || provider.providerId === "readonly";
        store.update(tabID, (tab) => ({
          ...tab,
          editor: {
            path: file,
            content: loaded.content,
            saved: loaded.content,
            providerId: provider.providerId,
            providerModule: provider.module,
            providerOptions: provider.options,
            readOnly,
            tooLarge: loaded.tooLarge,
          },
        }));
        showOverlay(tabID);
      } catch (error) {
        toast(`Cannot open ${path.basename(file)}: ${message(error)}`, "error");
      }
    }

    /** Closes the overlay, asking first when the buffer has unsaved changes. */
    function requestCloseEditor(tabID: string): void {
      const editor = editorOf(tabID);
      if (!editor || !isDirty(tabID)) {
        dropEditor(tabID);
        context.ui.dialog.clear();
        return;
      }
      // The question replaces the overlay; clearing the marker first stops the
      // overlay's onClose from treating the replacement as a close.
      setOverlayTab(undefined);
      void context.ui.dialog
        .select<"save" | "discard" | "keep">({
          title: `${path.basename(editor.path)} has unsaved changes`,
          options: [
            { title: "Save and close", value: "save" },
            { title: "Discard changes", value: "discard" },
            { title: "Keep editing", value: "keep" },
          ],
          current: "save",
        })
        .then(async (choice) => {
          if (choice === "save") {
            if (await saveEditor(tabID)) {
              dropEditor(tabID);
              context.ui.dialog.clear();
            } else showOverlay(tabID);
            return;
          }
          if (choice === "discard") {
            dropEditor(tabID);
            context.ui.dialog.clear();
            return;
          }
          showOverlay(tabID);
        });
    }

    /** Closes a browser tab without silently dropping an unsaved buffer. */
    function closeTab(tabID: string): void {
      if (!store.tabs().some((candidate) => candidate.id === tabID)) return;
      const finish = () => {
        const owned = overlayTab() === tabID;
        dropEditor(tabID);
        if (owned) context.ui.dialog.clear();
        store.close(tabID);
      };
      const editor = editorOf(tabID);
      if (!editor || !isDirty(tabID)) {
        finish();
        return;
      }
      const owned = overlayTab() === tabID;
      if (owned) setOverlayTab(undefined);
      void context.ui.dialog
        .select<"save" | "discard" | "cancel">({
          title: `${path.basename(editor.path)} has unsaved changes`,
          options: [
            { title: "Save and close tab", value: "save" },
            { title: "Discard changes and close tab", value: "discard" },
            { title: "Cancel", value: "cancel" },
          ],
          current: "save",
        })
        .then(async (choice) => {
          if (choice === "save" && !(await saveEditor(tabID))) choice = "cancel";
          if (choice === "save" || choice === "discard") {
            finish();
            context.ui.dialog.clear();
            return;
          }
          if (owned) showOverlay(tabID);
        });
    }

    async function saveEditor(tabID: string): Promise<boolean> {
      const editor = editorOf(tabID);
      if (!editor || editor.readOnly) return false;
      try {
        await writeTextFile(editor.path, editor.content);
        store.update(tabID, (current) => ({
          ...current,
          editor: current.editor ? { ...current.editor, saved: editor.content } : undefined,
        }));
        toast(`Saved ${path.basename(editor.path)}`, "success");
        void refresh(tabID);
        return true;
      } catch (error) {
        toast(`Save failed: ${message(error)}`, "error");
        return false;
      }
    }

    /** True when another plugin currently owns the configured viewer command. */
    function viewerCommandAvailable(): boolean {
      const id = settings().binaryViewer.command;
      if (!id) return false;
      try {
        return context.keymap.commands().some((command) => command.id === id);
      } catch {
        return false;
      }
    }

    function openBinary(file: string): void {
      if (viewerCommandAvailable()) {
        context.keymap.dispatch(settings().binaryViewer.command, file);
        return;
      }
      for (const fallback of settings().binaryViewer.fallback) {
        if (fallback === "system-open") {
          const [command, args] = systemOpenCommand(file);
          try {
            // A missing opener surfaces as an async "error" event, not a throw;
            // without a listener it would crash the TUI.
            const child = spawn(command, args, { detached: true, stdio: "ignore" });
            child.on("error", (error) => toast(`Cannot open ${path.basename(file)}: ${message(error)}`, "error"));
            child.unref();
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

    async function openEntry(tabID: string, row: TreeRow): Promise<void> {
      if (row.entry.directory) {
        toggleExpand(tabID, row.entry.path);
        return;
      }
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
      if (!tab) return;
      const rule = isProtected(row.entry.path, tab.root, protectionRules());
      if (rule) {
        const confirmed = await context.ui.dialog.confirm({
          title: "Protected file",
          message: `${row.entry.name} matches the protection rule "${rule.pattern}". Open it anyway?`,
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

    function copySelection(tabID: string): void {
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
      if (!tab) return;
      const paths = selectedPaths(tab);
      if (paths.length === 0) {
        toast("Nothing selected to copy", "warning");
        return;
      }
      setClipboard(
        paths.map((target) => {
          const row = tab.rows.find((candidate) => candidate.entry.path === target);
          return { path: target, sourceDirectory: path.dirname(target), directory: row?.entry.directory ?? false };
        }),
      );
      const renderer = context.renderer;
      if (renderer.isOsc52Supported()) renderer.copyToClipboardOSC52(paths.join("\n"));
      toast(`${paths.length} item${paths.length === 1 ? "" : "s"} copied`, "success");
    }

    async function siblingNames(directory: string): Promise<Set<string>> {
      try {
        const rows = await flattenTree(directory, new Set(), []);
        return new Set(rows.map((row) => row.entry.name));
      } catch {
        return new Set();
      }
    }

    async function pasteClipboard(tabID: string): Promise<void> {
      const sources = clipboard();
      if (sources.length === 0) {
        toast("Clipboard is empty", "warning");
        return;
      }
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
      if (!tab) return;
      const targetDirectory = tab.cursorDirectory;
      const actions = await planPaste({ sources, targetDirectory, exists: pathExists });
      let pasted = 0;
      let skipped = 0;
      for (const action of actions) {
        let destination = action.destination;
        if (action.kind === "skip") {
          toast(`${path.basename(action.source)} cannot be pasted into itself`, "warning");
          skipped += 1;
          continue;
        }
        if (action.kind === "rename") {
          const original = path.basename(action.source);
          const answer = await context.ui.dialog.prompt({
            title: action.reason === "same-directory" ? "Copy into the same folder" : "A file with that name exists",
            description: `${original} → ${targetDirectory}`,
            value: suggestName(original, await siblingNames(targetDirectory)),
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
              message: `${destination} already exists.`,
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
      toast(
        skipped > 0 ? `${pasted} pasted, ${skipped} skipped` : `${pasted} pasted`,
        skipped > 0 ? "warning" : "success",
      );
      await refresh(tabID);
    }

    async function createEntry(tabID: string): Promise<void> {
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
      if (!tab) return;
      const name = await context.ui.dialog.prompt({
        title: "New file",
        description: `In ${tab.cursorDirectory}`,
        placeholder: "name.txt",
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
        store.update(tabID, (current) => ({ ...current, selected: destination }));
        await refresh(tabID);
      } catch (error) {
        toast(`Cannot create ${name}: ${message(error)}`, "error");
      }
    }

    async function goToPath(tabID: string): Promise<void> {
      const answer = await context.ui.dialog.prompt({
        title: "Go to directory",
        description: "Absolute path, ~ or a path relative to the current root",
        placeholder: "~/projects",
      });
      if (answer === undefined || answer === "") return;
      const expanded =
        answer === "~" ? os.homedir() : answer.startsWith("~/") ? path.join(os.homedir(), answer.slice(2)) : answer;
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
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

    function newTab(): void {
      if (store.tabs().length >= MAX_TABS) {
        toast(`At most ${MAX_TABS} browser tabs`, "warning");
        return;
      }
      const tab = initialTab(store.active()?.root ?? sessionDirectory);
      store.add(tab);
      void refresh(tab.id);
    }

    function openPanel(): void {
      if (!context.ui.panel.open(PANEL_NAME, { presentation: "panel" })) {
        toast("Open a session first — the browser panel is session-scoped", "warning");
      }
    }

    function togglePanel(): void {
      if (context.ui.panel.current()?.name === PANEL_NAME) context.ui.panel.close();
      else openPanel();
    }

    /** Rewrites settings and re-reads the file so the file stays authoritative. */
    async function persistSettings(mutate: (current: FilebrowserSettings) => FilebrowserSettings): Promise<void> {
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
      if (before !== after) for (const tab of store.tabs()) setRoot(tab.id, after);
      else await refreshAll();
      toast(`Saved ${path.basename(file)}`, "success");
    }

    /** A small menu over the settings file; every change is written immediately. */
    async function openSettings(): Promise<void> {
      const file = settingsPath();
      while (true) {
        const current = settings();
        const choice = await context.ui.dialog.select<string>({
          title: "File browser settings",
          placeholder: file,
          options: [
            { title: "Root", value: "root", description: describeSettings(current), footer: current.root.mode },
            { title: "Icons", value: "icons", description: "Directory and file glyphs", footer: current.icons.style },
            {
              title: "Git status",
              value: "git",
              description: "Colour rows by working-tree state",
              footer: current.git.enabled ? "on" : "off",
            },
            {
              title: "Git colours",
              value: "palette",
              description: "JetBrains (modified blue) or VS Code (modified amber)",
              footer: current.git.palette,
            },
            {
              title: "Unpushed marker",
              value: "unpushed",
              description: "Show \u2191 on files changed by commits not yet pushed",
              footer: current.git.showUnpushed ? "on" : "off",
            },
            {
              title: "Sidebar starts collapsed",
              value: "collapsed",
              description: "Default state of the sidebar section; later toggles are remembered",
              footer: current.sidebar.collapsedByDefault ? "yes" : "no",
            },
            { title: "Editor provider", value: "editor", description: "Default editor for text files", footer: current.editor.default },
            {
              title: "Binary viewer",
              value: "viewer",
              description: "Command used for non-text files",
              footer: current.binaryViewer.command,
            },
            { title: "Show settings file path", value: "path", description: file },
          ],
        });
        if (choice === undefined) return;

        if (choice === "root") {
          const mode = await context.ui.dialog.select<FilebrowserSettings["root"]["mode"]>({
            title: "Root",
            options: [
              { title: "Session directory", value: "session", description: "Start at the directory of the current session" },
              { title: "Fixed path", value: "path", description: "Always start at a path you choose" },
              { title: "Unrestricted", value: "unrestricted", description: "Start at the session directory, navigate anywhere" },
            ],
            current: current.root.mode,
          });
          if (mode === undefined) continue;
          let fixed = current.root.path;
          if (mode === "path") {
            const answer = await context.ui.dialog.prompt({
              title: "Root path",
              description: "Absolute path, or ~ for your home directory",
              value: current.root.path ?? "",
            });
            if (answer === undefined) continue;
            fixed = answer === "" ? null : expandHome(answer);
          }
          await persistSettings((settings) => ({ ...settings, root: { ...settings.root, mode, path: fixed } }));
          continue;
        }

        if (choice === "icons") {
          const style = await context.ui.dialog.select<FilebrowserSettings["icons"]["style"]>({
            title: "Icon style",
            options: [
              { title: "Nerd Font", value: "nerdfont", description: "Requires a patched font" },
              { title: "Unicode", value: "unicode", description: "Works with any font" },
            ],
            current: current.icons.style,
          });
          if (style === undefined) continue;
          await persistSettings((settings) => ({ ...settings, icons: { ...settings.icons, style } }));
          continue;
        }

        if (choice === "git") {
          await persistSettings((settings) => ({ ...settings, git: { ...settings.git, enabled: !settings.git.enabled } }));
          continue;
        }

        if (choice === "palette") {
          const palette = await context.ui.dialog.select<FilebrowserSettings["git"]["palette"]>({
            title: "Git colours",
            options: [
              { title: "JetBrains", value: "jetbrains", description: "Modified blue, untracked red-brown, added green" },
              { title: "VS Code", value: "vscode", description: "Modified amber, untracked and added green" },
            ],
            current: current.git.palette,
          });
          if (palette === undefined) continue;
          await persistSettings((settings) => ({ ...settings, git: { ...settings.git, palette } }));
          continue;
        }

        if (choice === "unpushed") {
          await persistSettings((settings) => ({
            ...settings,
            git: { ...settings.git, showUnpushed: !settings.git.showUnpushed },
          }));
          continue;
        }

        if (choice === "collapsed") {
          await persistSettings((settings) => ({
            ...settings,
            sidebar: { ...settings.sidebar, collapsedByDefault: !settings.sidebar.collapsedByDefault },
          }));
          continue;
        }

        if (choice === "editor") {
          const answer = await context.ui.dialog.prompt({
            title: "Default editor provider",
            description: "A built-in id (plaintext, readonly) or a provider id from editor.providers",
            value: current.editor.default,
          });
          if (answer === undefined || answer === "") continue;
          await persistSettings((settings) => ({ ...settings, editor: { ...settings.editor, default: answer } }));
          continue;
        }

        if (choice === "viewer") {
          const answer = await context.ui.dialog.prompt({
            title: "Binary viewer command",
            description: "OpenCode command used to view non-text files",
            value: current.binaryViewer.command,
          });
          if (answer === undefined || answer === "") continue;
          await persistSettings((settings) => ({ ...settings, binaryViewer: { ...settings.binaryViewer, command: answer } }));
          continue;
        }

        await context.ui.dialog.alert({ title: "Settings file", message: file });
      }
    }

    /** Expands the ancestor chain and selects a path, used by the reveal RPC. */
    async function reveal(target: string): Promise<boolean> {
      const active = store.active();
      if (!active) return false;
      const configured = resolveRoot(settings().root.mode, settings().root.path, sessionDirectory);
      const inside = isWithin(configured, target);
      if (!inside && !settings().root.allowAbove && settings().root.mode !== "unrestricted") {
        toast(`${target} is outside the browser root`, "warning");
        return false;
      }
      if (!(await pathExists(target))) {
        toast(`${target} does not exist`, "error");
        return false;
      }
      const base = inside ? configured : path.parse(target).root;
      const directory = (await pathIsDirectory(target)) ? target : path.dirname(target);
      const chain = ancestorsOf(base, directory).filter((item) => item !== base);
      store.update(active.id, (tab) => ({
        ...tab,
        root: base,
        title: path.basename(base) || base,
        expanded: [...new Set([...tab.expanded, ...chain])],
        selected: target,
        extraSelection: [],
        cursorDirectory: directory,
      }));
      await refresh(active.id);
      return true;
    }

    // Filesystem watching: one debounced watcher per tab root.
    const watchers = new Map<string, { close: () => void; root: string }>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    createEffect(() => {
      const enabled = settings().watch.enabled && visible();
      const debounceMs = settings().watch.debounceMs;
      const wanted = new Map<string, string>();
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
          const handle = watch(root, { recursive: true }, () => {
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
          watchers.set(id, { close: () => handle.close(), root });
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
      if (!visible()) return;
      for (const tab of store.tabs()) void refresh(tab.id);
    });
    // Catch up once when the browser becomes visible again.
    let wasVisible = visible();
    createEffect(() => {
      const now = visible();
      if (now && !wasVisible) void refreshAll();
      wasVisible = now;
    });
    onCleanup(unsubscribeFs);

    const activeID = () => store.active()?.id ?? "";
    const selectedRow = () => {
      const tab = store.active();
      return tab?.rows.find((candidate) => candidate.entry.path === tab.selected);
    };

    /**
     * Browser shortcuts. Every bind is an alt chord OpenCode itself leaves
     * unbound, and the layer lives in BROWSER_MODE, which is pushed only while
     * focus is inside a browser container. Plain keys (Return, Backspace,
     * arrows, letters) are never bound, so the prompt keeps all of them.
     */
    const browserCommands = [
      { id: `${COMMAND_PREFIX}down`, title: "Move down", bind: "alt+j", run: () => moveSelection(activeID(), 1) },
      { id: `${COMMAND_PREFIX}up`, title: "Move up", bind: "alt+k", run: () => moveSelection(activeID(), -1) },
      {
        id: `${COMMAND_PREFIX}open`,
        title: "Expand directory or open file",
        bind: "alt+l,alt+o",
        run: () => {
          const row = selectedRow();
          if (row) void openEntry(activeID(), row);
        },
      },
      {
        id: `${COMMAND_PREFIX}collapse`,
        title: "Collapse directory or go up",
        bind: "alt+h",
        run: () => {
          const tab = store.active();
          if (!tab) return;
          const row = selectedRow();
          if (row?.entry.directory && tab.expanded.includes(row.entry.path)) toggleExpand(tab.id, row.entry.path);
          else goUp(tab.id);
        },
      },
      { id: `${COMMAND_PREFIX}parent`, title: "Go to parent directory", bind: "alt+u", run: () => goUp(activeID()) },
      { id: `${COMMAND_PREFIX}refresh`, title: "Refresh tree", bind: "alt+r", run: () => void refreshAll() },
      { id: `${COMMAND_PREFIX}goto`, title: "Go to directory", bind: "alt+g", run: () => void goToPath(activeID()) },
      { id: `${COMMAND_PREFIX}newfile`, title: "New file", bind: "alt+n", run: () => void createEntry(activeID()) },
      { id: `${COMMAND_PREFIX}copy`, title: "Copy selection", bind: "alt+c", run: () => copySelection(activeID()) },
      { id: `${COMMAND_PREFIX}paste`, title: "Paste into directory", bind: "alt+v", run: () => void pasteClipboard(activeID()) },
      { id: `${COMMAND_PREFIX}newtab`, title: "New browser tab", bind: "alt+t", run: () => newTab() },
      {
        id: `${COMMAND_PREFIX}closetab`,
        title: "Close browser tab",
        bind: "alt+w",
        run: () => {
          const tab = store.active();
          if (tab && store.tabs().length > 1) closeTab(tab.id);
        },
      },
      { id: `${COMMAND_PREFIX}nexttab`, title: "Next browser tab", bind: "alt+]", run: () => store.setActiveIndex(store.activeIndex() + 1) },
      { id: `${COMMAND_PREFIX}previoustab`, title: "Previous browser tab", bind: "alt+[", run: () => store.setActiveIndex(store.activeIndex() - 1) },
      { id: `${COMMAND_PREFIX}togglepanel`, title: "Toggle browser panel", bind: "alt+p", run: () => togglePanel() },
    ];

    context.keymap.layer(() => ({
      mode: BROWSER_MODE,
      priority: 50,
      commands: browserCommands,
    }));

    // Editor keys. The overlay runs in the host's modal mode, which also owns
    // Esc ("Close dialog"); this layer outranks it so Esc can ask about unsaved
    // changes first. It is enabled only while the overlay is open.
    context.keymap.layer(() => ({
      mode: "modal",
      priority: 60,
      enabled: () => overlayOpen(),
      commands: [
        {
          id: `${COMMAND_PREFIX}save`,
          title: "Save file",
          bind: "ctrl+s",
          run: () => {
            const id = overlayTab();
            if (id) void saveEditor(id);
          },
        },
        {
          // The host's modal Ctrl+C empties the focused textarea before it
          // closes a dialog, which would wipe the buffer. Swallow it here unless
          // there is a selection for the host to clear.
          id: `${COMMAND_PREFIX}editorguard`,
          title: "Keep editor buffer",
          bind: "ctrl+c",
          run: () => {
            if (context.renderer.getSelection()) return false;
            if (context.renderer.currentFocusedEditor?.hasSelection?.()) return false;
          },
        },
        {
          id: `${COMMAND_PREFIX}closeeditor`,
          title: "Close editor",
          bind: "escape",
          run: () => {
            const id = overlayTab();
            if (!id) return false;
            requestCloseEditor(id);
          },
        },
      ],
    }));

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: `${COMMAND_PREFIX}panel`,
          title: "Open file browser panel",
          group: "File browser",
          description: "Open the file browser in a side panel",
          palette: true,
          run: () => openPanel(),
        },
        {
          id: `${COMMAND_PREFIX}reveal`,
          title: "Reveal a path in the file browser",
          group: "File browser",
          description: "Expand and select a file or directory in the browser",
          slash: { name: "filebrowser", arguments: true },
          run: async (input) => {
            const raw = input?.trim();
            if (!raw) return;
            const target = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : path.resolve(sessionDirectory, raw);
            await reveal(target);
          },
        },
        {
          id: `${COMMAND_PREFIX}focus`,
          title: "Focus the file browser",
          group: "File browser",
          description: "Move keyboard focus to the file browser so its shortcuts apply",
          palette: true,
          run: () => {
            const target = browserRenderable && !browserRenderable.isDestroyed ? browserRenderable : [...containers][0];
            if (!target || target.isDestroyed) return;
            if (sidebarCollapsed() && !panelOpen()) toggleSidebar();
            if (!target.focused) target.focus();
          },
        },
        {
          id: `${COMMAND_PREFIX}togglesidebar`,
          title: "Collapse or expand the file browser",
          group: "File browser",
          description: "Toggle the file browser section in the sidebar",
          palette: true,
          run: () => toggleSidebar(),
        },
        {
          id: `${COMMAND_PREFIX}settings`,
          title: "File browser settings",
          group: "File browser",
          description: "Change the browser's settings and write them to filebrowser.json",
          palette: true,
          run: () => void openSettings(),
        },
      ],
    }));

    const actions: BrowserActions = {
      openRow: (row: TreeRow) => {
        const tab = store.active();
        if (tab) void openEntry(tab.id, row);
      },
      selectRow: (row: TreeRow, modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean }) => {
        const tab = store.active();
        if (!tab) return;
        if (modifiers.shift || modifiers.ctrl || modifiers.meta) {
          store.update(tab.id, (state) => ({ ...state, ...toggleSelection(state, row.entry.path) }));
          return;
        }
        store.update(tab.id, (state) => ({
          ...state,
          selected: row.entry.path,
          extraSelection: [],
          cursorDirectory: directoryOf(row),
        }));
      },
      isDirty: (tabID: string) => isDirty(tabID),
      closeTab: (tabID: string) => closeTab(tabID),
      hasFocus: (target: Renderable | undefined) => target !== undefined && focusedContainer() === target,
      register: (target: Renderable) => {
        containers.add(target);
        syncBrowserMode(context.renderer.currentFocusedRenderable);
      },
      unregister: (target: Renderable) => {
        containers.delete(target);
        if (browserRenderable === target) browserRenderable = undefined;
        syncBrowserMode(context.renderer.currentFocusedRenderable);
      },
    };

    context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <SidebarSection
          tokens={tokens}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          title={() => store.active()?.title ?? "Files"}
          git={() => store.active()?.git}
        >
          <Browser
            context={context}
            tokens={tokens}
            store={store}
            settings={settings}
            icons={icons}
            actions={actions}
            maxRows={() => settings().sidebar.maxRows}
          />
        </SidebarSection>
      ),
    });

    context.ui.slot({
      append: "session.panel",
      render: (panel: PanelInput) => (
        <Show when={panel.name === PANEL_NAME}>
          <Browser
            context={context}
            tokens={tokens}
            store={store}
            settings={settings}
            icons={icons}
            actions={actions}
            panel={panel}
          />
        </Show>
      ),
    });

    void loadSettings().then((loaded) => {
      if (disposed) return;
      setSettings(loaded);
      const root = resolveRoot(loaded.root.mode, loaded.root.path, sessionDirectory);
      const active = store.active();
      if (active && active.root === sessionDirectory) setRoot(active.id, root);
    });

    const rpc = context.client.rpc(FilebrowserRpc);
    const unsubscribeRpc = rpc.events.on("open", async (event) => {
      const here = context.location?.directory;
      if (here && event.location?.directory && event.location.directory !== here) return;
      const data = event.data as { path: string; mode: "reveal" | "edit" | "view" };
      if (!(await reveal(data.path))) return;
      const active = store.active();
      if (!active) return;
      const row = active.rows.find((candidate) => candidate.entry.path === data.path);
      // Opening goes through openEntry so protection rules and the binary sniff
      // apply exactly as they do for a double-click.
      if (row && data.mode !== "reveal") await openEntry(active.id, row);
    });

    void refresh(store.active()?.id ?? "");

    return () => {
      unsubscribeRpc();
      context.renderer.off("focused_renderable", onFocusChange);
      releaseBrowserMode?.();
      releaseBrowserMode = undefined;
    };
  },
});

interface BrowserActions {
  openRow: (row: TreeRow) => void;
  selectRow: (row: TreeRow, modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean }) => void;
  /** True when the tab holds an editor buffer with unsaved changes. */
  isDirty: (tabID: string) => boolean;
  /** Closes a tab, asking first when its editor buffer has unsaved changes. */
  closeTab: (tabID: string) => void;
  /** Reactive: true while focus is inside the given container, so its shortcuts apply. */
  hasFocus: (target: Renderable | undefined) => boolean;
  /** Registers this instance's focusable container so focus inside it enables the browser keys. */
  register: (target: Renderable) => void;
  unregister: (target: Renderable) => void;
}

interface SidebarSectionProps {
  tokens: ThemeTokens;
  collapsed: () => boolean;
  onToggle: () => void;
  title: () => string;
  git: () => GitStatus | undefined;
  children: JSX.Element;
}

/**
 * Bordered, collapsible sidebar section in the style of the host's own
 * sidebar groups: a ▶/▼ header that toggles on click, with the body hidden
 * (and its watchers paused) while collapsed.
 */
function SidebarSection(props: SidebarSectionProps): JSX.Element {
  const summary = () => {
    const git = props.git();
    if (!git?.branch) return "";
    const ahead = git.ahead ? ` \u2191${git.ahead}` : "";
    const behind = git.behind ? ` \u2193${git.behind}` : "";
    return `${git.branch}${ahead}${behind}`;
  };
  return (
    <box flexDirection="column" width="100%" borderStyle="rounded" borderColor={props.tokens.textFaint} paddingLeft={1} paddingRight={1}>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        gap={1}
        onMouseDown={(event: unknown) => {
          stopEvent(event);
          (event as { preventDefault?: () => void } | undefined)?.preventDefault?.();
          props.onToggle();
        }}
      >
        <text fg={props.tokens.textMuted}>{props.collapsed() ? "\u25b6" : "\u25bc"}</text>
        <text fg={props.tokens.textBase} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
          Files
        </text>
        <text fg={props.tokens.textMuted} wrapMode="none" truncate flexGrow={1}>
          {props.title()}
        </text>
        <Show when={summary()}>
          <text fg={props.tokens.info} wrapMode="none" truncate>
            {summary()}
          </text>
        </Show>
      </box>
      <Show when={!props.collapsed()}>{props.children}</Show>
    </box>
  );
}

interface BrowserProps {
  context: Context;
  tokens: ThemeTokens;
  store: TabsStore;
  settings: () => FilebrowserSettings;
  icons: () => IconSet;
  actions: BrowserActions;
  panel?: PanelInput;
  /** Tree rows shown before scrolling; unset fills the available height. */
  maxRows?: () => number;
}

function Browser(props: BrowserProps): JSX.Element {
  const tab = () => props.store.active();
  let lastClick: { path: string; time: number } | undefined;
  let container: Renderable | undefined;
  const [self, setSelf] = createSignal<Renderable | undefined>(undefined);

  // The host focuses the panel's own container on open, which is outside this
  // subtree. Move focus inside the browser so its shortcuts apply. The sidebar
  // is deliberately left alone: focusing it would steal the prompt's focus.
  onMount(() => {
    if (!props.panel) return;
    props.panel.focus();
    if (container && !container.isDestroyed) container.focus();
  });

  const onRowMouseDown = (event: unknown, row: TreeRow) => {
    stopEvent(event);
    const now = Date.now();
    const double = lastClick !== undefined && lastClick.path === row.entry.path && now - lastClick.time < DOUBLE_CLICK_MS;
    lastClick = { path: row.entry.path, time: now };
    if (double) {
      lastClick = undefined;
      props.actions.openRow(row);
      return;
    }
    const modifiers =
      (event as { modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean } } | undefined)?.modifiers ?? {};
    props.actions.selectRow(row, modifiers);
  };

  const protectedRows = createMemo(() => compileProtection(props.settings().protect));
  const isRowProtected = (row: TreeRow, root: string) =>
    isProtected(row.entry.path, root, protectedRows()) !== undefined;

  const focused = () => props.actions.hasFocus(self());
  const hint = () =>
    focused()
      ? "alt+j/k move · alt+l open · alt+h up · alt+c/v copy/paste · alt+p panel"
      : "click to focus · double-click opens";

  const treeHeight = () => {
    const limit = props.maxRows?.();
    if (limit === undefined) return undefined;
    const rows = tab()?.rows.length ?? 0;
    return Math.max(1, Math.min(limit, rows === 0 ? 1 : rows));
  };

  return (
    <box
      flexDirection="column"
      width="100%"
      height={props.panel ? "100%" : undefined}
      paddingLeft={props.panel ? 1 : 0}
      paddingRight={props.panel ? 1 : 0}
      focusable
      ref={(target: Renderable) => {
        container = target;
        setSelf(target);
        props.actions.register(target);
        onCleanup(() => {
          container = undefined;
          setSelf(undefined);
          props.actions.unregister(target);
        });
      }}
    >
      <Show when={tab()} fallback={<text fg={props.tokens.textMuted}>no browser tab</text>}>
        {(current) => (
          <box flexDirection="column" width="100%" height={props.panel ? "100%" : undefined}>
            <TabStrip
              tabs={props.store.tabs()}
              activeIndex={props.store.activeIndex()}
              tokens={props.tokens}
              isDirty={props.actions.isDirty}
              onSelect={(index) => props.store.setActiveIndex(index)}
              onClose={(index) => props.actions.closeTab(props.store.tabs()[index]?.id ?? "")}
            />
            <Breadcrumb
              path={current().root}
              tokens={props.tokens}
              branch={current().git?.branch}
              ahead={current().git?.ahead}
              behind={current().git?.behind}
              truncated={current().truncated}
            />
            <scrollbox width="100%" flexGrow={props.panel ? 1 : 0} height={treeHeight()}>
              <For each={current().rows}>
                {(row) => (
                  <TreeRowView
                    row={row}
                    tokens={props.tokens}
                    icons={props.icons()}
                    selected={current().selected === row.entry.path}
                    alsoSelected={current().extraSelection.includes(row.entry.path)}
                    status={statusFor(current().git, row.entry.path, row.entry.directory)}
                    protected={isRowProtected(row, current().root)}
                    showBadges={props.settings().git.badges}
                    palette={props.settings().git.palette}
                    showUnpushed={props.settings().git.showUnpushed}
                    onMouseDown={onRowMouseDown}
                  />
                )}
              </For>
              <Show when={current().rows.length === 0 && !current().loading}>
                <text fg={props.tokens.textMuted}>empty directory</text>
              </Show>
              <Show when={current().loading && current().rows.length === 0}>
                <text fg={props.tokens.textMuted}>loading…</text>
              </Show>
              <Show when={current().error}>
                <text fg={props.tokens.error}>{current().error}</text>
              </Show>
            </scrollbox>
            <Footer
              tokens={props.tokens}
              message={`${current().rows.length} entries${current().selected ? ` · ${path.basename(current().selected!)}` : ""}`}
              hint={hint()}
            />
          </box>
        )}
      </Show>
      <Show when={props.panel}>
        <box flexDirection="row" height={1} flexShrink={0}>
          <text
            fg={props.panel?.focused ? props.tokens.textMuted : props.tokens.textFaint}
            onMouseDown={(event) => {
              stopEvent(event);
              props.panel?.focus();
            }}
          >
            {props.panel?.focused ? "focused · alt+p closes" : "click to focus"}
          </text>
        </box>
      </Show>
    </box>
  );
}
