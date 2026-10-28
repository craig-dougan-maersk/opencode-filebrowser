import { createSignal } from "solid-js";
import type { TreeRow } from "../lib/fs-tree";
import type { GitStatus } from "../lib/git";

export interface EditorTab {
  path: string;
  content: string;
  saved: string;
  providerId: string;
  /** Absolute module specifier of an external provider, absent for built-ins. */
  providerModule: string | undefined;
  /** Per-provider options from configuration. */
  providerOptions: Record<string, unknown> | undefined;
  readOnly: boolean;
  /** Set when the file exceeded `editor.maxInlineBytes`. */
  tooLarge: boolean;
}

export interface TabState {
  id: string;
  title: string;
  root: string;
  /** Directory the cursor is anchored in, used for "new file" and paste. */
  cursorDirectory: string;
  expanded: string[];
  selected: string | null;
  /** Additional paths selected with shift/ctrl click, excluding `selected`. */
  extraSelection: string[];
  rows: TreeRow[];
  git: GitStatus | undefined;
  loading: boolean;
  error: string | undefined;
  editor: EditorTab | undefined;
}

export interface TabsStore {
  tabs: () => TabState[];
  activeIndex: () => number;
  active: () => TabState | undefined;
  setActiveIndex: (index: number) => void;
  add: (tab: TabState) => void;
  close: (id: string) => void;
  update: (id: string, patch: (tab: TabState) => TabState) => void;
  move: (id: string, offset: number) => void;
}

let sequence = 0;

export function nextTabId(): string {
  sequence += 1;
  return `tab-${sequence}`;
}

/** Immutably replaces one tab by id, leaving the rest of the array untouched. */
export function replaceTab(tabs: readonly TabState[], id: string, patch: (tab: TabState) => TabState): TabState[] {
  return tabs.map((tab) => (tab.id === id ? patch(tab) : tab));
}

export function createTabsStore(initial: TabState): TabsStore {
  const [tabs, setTabs] = createSignal<TabState[]>([initial]);
  const [activeIndex, setActiveIndexRaw] = createSignal(0);

  const clampIndex = (index: number, length: number): number => (length === 0 ? 0 : Math.min(Math.max(index, 0), length - 1));

  return {
    tabs,
    activeIndex,
    active: () => tabs()[activeIndex()],
    setActiveIndex: (index: number) => setActiveIndexRaw((current) => {
      const next = clampIndex(index, tabs().length);
      return next === current ? current : next;
    }),
    add: (tab: TabState) => {
      setTabs((current) => [...current, tab]);
      setActiveIndexRaw(tabs().length - 1);
    },
    close: (id: string) => {
      const index = tabs().findIndex((tab) => tab.id === id);
      if (index === -1) return;
      const remaining = tabs().filter((tab) => tab.id !== id);
      setTabs(remaining);
      setActiveIndexRaw((current) => clampIndex(current > index ? current - 1 : current, remaining.length));
    },
    update: (id: string, patch: (tab: TabState) => TabState) => {
      setTabs((current) => replaceTab(current, id, patch));
    },
    move: (id: string, offset: number) => {
      const current = tabs();
      const index = current.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      const target = index + offset;
      if (target < 0 || target >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      setTabs(next);
      setActiveIndexRaw(target);
    },
  };
}

/** Paths currently selected in a tab, primary selection first. */
export function selectedPaths(tab: TabState): string[] {
  return tab.selected ? [tab.selected, ...tab.extraSelection] : [];
}

export function toggleSelection(tab: TabState, path: string): Pick<TabState, "selected" | "extraSelection"> {
  if (tab.selected === path) {
    const [first, ...rest] = tab.extraSelection;
    return { selected: first ?? null, extraSelection: rest };
  }
  if (tab.extraSelection.includes(path)) {
    return { selected: tab.selected, extraSelection: tab.extraSelection.filter((item) => item !== path) };
  }
  if (tab.selected === null) return { selected: path, extraSelection: tab.extraSelection };
  return { selected: tab.selected, extraSelection: [...tab.extraSelection, path] };
}
