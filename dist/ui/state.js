import { createSignal } from "solid-js";
let sequence = 0;
export function nextTabId() {
  sequence += 1;
  return `tab-${sequence}`;
}

/** Immutably replaces one tab by id, leaving the rest of the array untouched. */
export function replaceTab(tabs, id, patch) {
  return tabs.map(tab => tab.id === id ? patch(tab) : tab);
}
export function createTabsStore(initial) {
  const [tabs, setTabs] = createSignal([initial]);
  const [activeIndex, setActiveIndexRaw] = createSignal(0);
  const clampIndex = (index, length) => length === 0 ? 0 : Math.min(Math.max(index, 0), length - 1);
  return {
    tabs,
    activeIndex,
    active: () => tabs()[activeIndex()],
    setActiveIndex: index => setActiveIndexRaw(current => {
      const next = clampIndex(index, tabs().length);
      return next === current ? current : next;
    }),
    add: tab => {
      setTabs(current => [...current, tab]);
      setActiveIndexRaw(tabs().length - 1);
    },
    close: id => {
      const index = tabs().findIndex(tab => tab.id === id);
      if (index === -1) return;
      const remaining = tabs().filter(tab => tab.id !== id);
      setTabs(remaining);
      setActiveIndexRaw(current => clampIndex(current > index ? current - 1 : current, remaining.length));
    },
    update: (id, patch) => {
      setTabs(current => replaceTab(current, id, patch));
    },
    move: (id, offset) => {
      const current = tabs();
      const index = current.findIndex(tab => tab.id === id);
      if (index === -1) return;
      const target = index + offset;
      if (target < 0 || target >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      setTabs(next);
      setActiveIndexRaw(target);
    }
  };
}

/** Paths currently selected in a tab, primary selection first. */
export function selectedPaths(tab) {
  return tab.selected ? [tab.selected, ...tab.extraSelection] : [];
}
export function toggleSelection(tab, path) {
  if (tab.selected === path) {
    const [first, ...rest] = tab.extraSelection;
    return {
      selected: first ?? null,
      extraSelection: rest
    };
  }
  if (tab.extraSelection.includes(path)) {
    return {
      selected: tab.selected,
      extraSelection: tab.extraSelection.filter(item => item !== path)
    };
  }
  if (tab.selected === null) return {
    selected: path,
    extraSelection: tab.extraSelection
  };
  return {
    selected: tab.selected,
    extraSelection: [...tab.extraSelection, path]
  };
}
