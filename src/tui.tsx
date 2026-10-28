import { watch } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin/tui";
import type { Context, PanelInput } from "@opencode/plugin/tui/context";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { ancestorsOf, compileIgnore, flattenTree, isWithin, resolveRoot, type TreeRow } from "./lib/fs-tree";
import { readGitStatus, type GitStatus } from "./lib/git";
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
import { DEFAULT_SETTINGS, loadSettings, type FilebrowserSettings } from "./lib/settings";
import { FilebrowserRpc } from "./rpc";
import { TreeRowView } from "./ui/tree-row";
import { Breadcrumb, Footer, TabStrip, stopEvent } from "./ui/chrome";
import { PlainTextEditor } from "./ui/editor";
import { ExternalEditor } from "./ui/provider";
import { createTabsStore, nextTabId, selectedPaths, toggleSelection, type TabState, type TabsStore } from "./ui/state";

const PANEL_NAME = "filebrowser.browser";
const COMMAND_PREFIX = "filebrowser.";
const EDITOR_MODE = "filebrowser-editor";
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
    const [editorMode, setEditorMode] = createSignal(false);
    const [keysEnabled, setKeysEnabled] = createSignal(true);
    const store = createTabsStore(initialTab(sessionDirectory));

    let releaseMode: (() => void) | undefined;
    let disposed = false;

    onCleanup(() => {
      disposed = true;
      releaseMode?.();
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
        const rows = await flattenTree(tab.root, new Set(tab.expanded), ignoreRules());
        const git: GitStatus | undefined = settings().git.enabled
          ? await readGitStatus(tab.root, settings().git.timeoutMs)
          : undefined;
        if (generations.get(tabID) !== generation) return;
        store.update(tabID, (current) => ({
          ...current,
          rows,
          git,
          loading: false,
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

    function openEditor(tabID: string, file: string): Promise<void> {
      return (async () => {
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

    function closeEditor(tabID: string): void {
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
      const editor = tab?.editor;
      const drop = () => {
        store.update(tabID, (current) => ({ ...current, editor: undefined }));
        releaseMode?.();
        releaseMode = undefined;
        setEditorMode(false);
      };
      if (editor && editor.content !== editor.saved) {
        void context.ui.dialog
          .confirm({ title: "Discard changes?", message: `${path.basename(editor.path)} has unsaved changes.` })
          .then((confirmed) => {
            if (confirmed) drop();
          });
        return;
      }
      drop();
    }

    async function saveEditor(tabID: string): Promise<void> {
      const tab = store.tabs().find((candidate) => candidate.id === tabID);
      const editor = tab?.editor;
      if (!editor || editor.readOnly) return;
      try {
        await writeTextFile(editor.path, editor.content);
        store.update(tabID, (current) => ({
          ...current,
          editor: current.editor ? { ...current.editor, saved: current.editor.content } : undefined,
        }));
        toast(`Saved ${path.basename(editor.path)}`, "success");
        await refresh(tabID);
      } catch (error) {
        toast(`Save failed: ${message(error)}`, "error");
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
            spawn(command, args, { detached: true, stdio: "ignore" }).unref();
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

    /** Expands the ancestor chain and selects a path, used by the reveal RPC. */
    async function reveal(target: string): Promise<void> {
      const active = store.active();
      if (!active) return;
      const configured = resolveRoot(settings().root.mode, settings().root.path, sessionDirectory);
      const base = isWithin(configured, target) ? configured : path.parse(target).root;
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
    }

    // Filesystem watching: one debounced watcher per tab root.
    const watchers = new Map<string, { close: () => void; root: string }>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    createEffect(() => {
      const enabled = settings().watch.enabled;
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
      for (const tab of store.tabs()) void refresh(tab.id);
    });
    onCleanup(unsubscribeFs);

    const navigationCommands = [
      { id: `${COMMAND_PREFIX}down`, title: "Move down", bind: "down", run: () => moveSelection(store.active()?.id ?? "", 1) },
      { id: `${COMMAND_PREFIX}up`, title: "Move up", bind: "up", run: () => moveSelection(store.active()?.id ?? "", -1) },
      {
        id: `${COMMAND_PREFIX}open`,
        title: "Expand directory or open file",
        bind: "right,return",
        run: () => {
          const tab = store.active();
          const row = tab?.rows.find((candidate) => candidate.entry.path === tab.selected);
          if (tab && row) void openEntry(tab.id, row);
        },
      },
      {
        id: `${COMMAND_PREFIX}collapse`,
        title: "Collapse directory or go up",
        bind: "left",
        run: () => {
          const tab = store.active();
          if (!tab) return;
          const row = tab.rows.find((candidate) => candidate.entry.path === tab.selected);
          if (row?.entry.directory && tab.expanded.includes(row.entry.path)) toggleExpand(tab.id, row.entry.path);
          else goUp(tab.id);
        },
      },
      { id: `${COMMAND_PREFIX}parent`, title: "Go to parent directory", bind: "backspace", run: () => goUp(store.active()?.id ?? "") },
      { id: `${COMMAND_PREFIX}refresh`, title: "Refresh tree", bind: "f5", run: () => void refreshAll() },
      { id: `${COMMAND_PREFIX}goto`, title: "Go to directory", bind: "ctrl+g", run: () => void goToPath(store.active()?.id ?? "") },
      { id: `${COMMAND_PREFIX}newfile`, title: "New file", bind: "ctrl+n", run: () => void createEntry(store.active()?.id ?? "") },
      { id: `${COMMAND_PREFIX}copy`, title: "Copy selection", bind: "ctrl+c", run: () => copySelection(store.active()?.id ?? "") },
      { id: `${COMMAND_PREFIX}paste`, title: "Paste into directory", bind: "ctrl+v", run: () => void pasteClipboard(store.active()?.id ?? "") },
      { id: `${COMMAND_PREFIX}newtab`, title: "New browser tab", bind: "ctrl+t", run: () => newTab() },
      {
        id: `${COMMAND_PREFIX}closetab`,
        title: "Close browser tab",
        bind: "ctrl+w",
        run: () => {
          const tab = store.active();
          if (tab && store.tabs().length > 1) store.close(tab.id);
        },
      },
      { id: `${COMMAND_PREFIX}nexttab`, title: "Next browser tab", bind: "ctrl+tab", run: () => store.setActiveIndex(store.activeIndex() + 1) },
      { id: `${COMMAND_PREFIX}previoustab`, title: "Previous browser tab", bind: "ctrl+shift+tab", run: () => store.setActiveIndex(store.activeIndex() - 1) },
      { id: `${COMMAND_PREFIX}togglepanel`, title: "Toggle browser panel", bind: "ctrl+o", run: () => togglePanel() },
    ];

    context.keymap.layer(() => ({
      mode: "base",
      priority: 50,
      enabled: () => keysEnabled() && !editorMode(),
      commands: navigationCommands,
    }));

    context.keymap.layer(() => ({
      mode: EDITOR_MODE,
      priority: 60,
      enabled: () => editorMode(),
      commands: [
        { id: `${COMMAND_PREFIX}save`, title: "Save file", bind: "ctrl+s", run: () => void saveEditor(store.active()?.id ?? "") },
        { id: `${COMMAND_PREFIX}closeeditor`, title: "Close editor", bind: "escape", run: () => closeEditor(store.active()?.id ?? "") },
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
          id: `${COMMAND_PREFIX}toggle`,
          title: "Toggle file browser keys",
          group: "File browser",
          description: "Enable or disable the browser's keyboard layer",
          run: () => {
            setKeysEnabled((value) => !value);
          },
        },
      ],
    }));

    const actions = {
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
      saveEditor: () => void saveEditor(store.active()?.id ?? ""),
      closeEditor: () => closeEditor(store.active()?.id ?? ""),
    };

    context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <Browser context={context} tokens={tokens} store={store} settings={settings} icons={icons} actions={actions} />
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
      await reveal(data.path);
      const active = store.active();
      if (!active) return;
      if (data.mode === "edit") await openEditor(active.id, data.path);
      else if (data.mode === "view") openBinary(data.path);
    });

    void refresh(store.active()?.id ?? "");

    return () => {
      unsubscribeRpc();
      releaseMode?.();
    };
  },
});

interface BrowserActions {
  openRow: (row: TreeRow) => void;
  selectRow: (row: TreeRow, modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean }) => void;
  saveEditor: () => void;
  closeEditor: () => void;
}

interface BrowserProps {
  context: Context;
  tokens: ThemeTokens;
  store: TabsStore;
  settings: () => FilebrowserSettings;
  icons: () => IconSet;
  actions: BrowserActions;
  panel?: PanelInput;
}

function Browser(props: BrowserProps): JSX.Element {
  const tab = () => props.store.active();
  let lastClick: { path: string; time: number } | undefined;

  /** Keeps the active tab's editor buffer in sync with an editor component. */
  const onEditorChange = (content: string) => {
    const current = props.store.active();
    if (!current) return;
    props.store.update(current.id, (state) => ({
      ...state,
      editor: state.editor ? { ...state.editor, content } : undefined,
    }));
  };

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

  const hint = createMemo(() =>
    tab()?.editor
      ? "ctrl+s save · esc close"
      : "\u2191\u2193 move · \u2192 open · \u2190 up · ctrl+c/v copy/paste · ctrl+o panel",
  );

  return (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={1} paddingRight={1}>
      <Show when={tab()} fallback={<text fg={props.tokens.textMuted}>no browser tab</text>}>
        {(current) => (
          <Show
            when={!current().editor}
            fallback={
              <box flexDirection="column" width="100%" height="100%">
                <Show
                  when={current().editor!.providerModule}
                  fallback={
                    <PlainTextEditor
                      tab={current().editor!}
                      tokens={props.tokens}
                      owner={props.context.renderer.nativeScene}
                      onChange={onEditorChange}
                    />
                  }
                >
                  <ExternalEditor tab={current().editor!} tokens={props.tokens} onChange={onEditorChange} />
                </Show>
                <box flexDirection="row" height={1} flexShrink={0} gap={1}>
                  <text fg={props.tokens.textMuted}>
                    {`${path.basename(current().editor!.path)} · ${
                      current().editor!.content === current().editor!.saved ? "saved" : "modified"
                    }`}
                  </text>
                  <text fg={props.tokens.textFaint}>
                    {current().editor!.readOnly ? "read-only" : current().editor!.providerId}
                  </text>
                </box>
              </box>
            }
          >
            <box flexDirection="column" width="100%" height="100%">
              <TabStrip
                tabs={props.store.tabs()}
                activeIndex={props.store.activeIndex()}
                tokens={props.tokens}
                onSelect={(index) => props.store.setActiveIndex(index)}
                onClose={(index) => props.store.close(props.store.tabs()[index]?.id ?? "")}
              />
              <Breadcrumb path={current().root} tokens={props.tokens} branch={current().git?.branch} />
              <scrollbox width="100%" flexGrow={1}>
                <For each={current().rows}>
                  {(row) => (
                    <TreeRowView
                      row={row}
                      tokens={props.tokens}
                      icons={props.icons()}
                      selected={current().selected === row.entry.path}
                      alsoSelected={current().extraSelection.includes(row.entry.path)}
                      status={current().git?.entries.get(row.entry.path)}
                      protected={isRowProtected(row, current().root)}
                      showBadges={props.settings().git.badges}
                      onMouseDown={onRowMouseDown}
                    />
                  )}
                </For>
                <Show when={current().rows.length === 0 && !current().loading}>
                  <text fg={props.tokens.textMuted}>empty directory</text>
                </Show>
                <Show when={current().loading}>
                  <text fg={props.tokens.textMuted}>loading…</text>
                </Show>
                <Show when={current().error}>
                  <text fg={props.tokens.error}>{current().error}</text>
                </Show>
              </scrollbox>
              <Footer
                tokens={props.tokens}
                message={`${current().rows.length} entries${
                  current().selected ? ` · ${path.basename(current().selected!)}` : ""
                }`}
                hint={hint()}
              />
            </box>
          </Show>
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
            {props.panel?.focused ? "focused · ctrl+o closes" : "click to focus"}
          </text>
        </box>
      </Show>
    </box>
  );
}
