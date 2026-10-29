import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";
import type { ThemeTokens } from "../lib/theme";
import type { TabState } from "./state";

export function stopEvent(event: unknown): void {
  const candidate = event as { stopPropagation?: () => void } | undefined;
  try {
    candidate?.stopPropagation?.();
  } catch {
    // A host that does not implement stopPropagation needs no handling.
  }
}

export interface TabStripProps {
  tabs: readonly TabState[];
  activeIndex: number;
  tokens: ThemeTokens;
  /** Reports unsaved editor changes for a tab, marked with * in the strip. */
  isDirty?: (tabID: string) => boolean;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
}

/** Internal browser tab strip. Session tabs belong to the host and are not used here. */
export function TabStrip(props: TabStripProps): JSX.Element {
  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      <For each={props.tabs}>
        {(tab, index) => {
          const active = () => index() === props.activeIndex;
          const dirty = () =>
            props.isDirty ? props.isDirty(tab.id) : tab.editor !== undefined && tab.editor.content !== tab.editor.saved;
          return (
            <box flexDirection="row">
              <text
                fg={active() ? props.tokens.textPrimary : props.tokens.textMuted}
                attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                wrapMode="none"
                truncate
                onMouseDown={(event) => {
                  stopEvent(event);
                  props.onSelect(index());
                }}
              >
                {` ${dirty() ? "*" : ""}${tab.title} `}
              </text>
              <Show when={props.tabs.length > 1}>
                <text
                  fg={props.tokens.textFaint}
                  wrapMode="none"
                  truncate
                  onMouseDown={(event) => {
                    stopEvent(event);
                    props.onClose(index());
                  }}
                >
                  {"\u00d7"}
                </text>
              </Show>
            </box>
          );
        }}
      </For>
    </box>
  );
}

export interface BreadcrumbProps {
  path: string;
  tokens: ThemeTokens;
  branch?: string;
  /** Commits on HEAD not yet on the upstream. */
  ahead?: number;
  /** Commits on the upstream not yet on HEAD. */
  behind?: number;
  truncated?: boolean;
}

/** Current directory, shortened from the left when the sidebar is narrow. */
export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
  const label = () => {
    const parts = props.path.split("/").filter((part) => part !== "");
    if (parts.length <= 3) return props.path;
    return `…/${parts.slice(-3).join("/")}`;
  };
  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      <text fg={props.tokens.textMuted} wrapMode="none" truncate>
        {label()}
      </text>
      <Show when={props.branch}>
        <text fg={props.tokens.info} wrapMode="none" truncate>{`  \u2387 ${props.branch}${props.ahead ? ` \u2191${props.ahead}` : ""}${props.behind ? ` \u2193${props.behind}` : ""}`}</text>
      </Show>
      <Show when={props.truncated}>
        <text fg={props.tokens.warning} wrapMode="none" truncate>{"  truncated"}</text>
      </Show>
    </box>
  );
}

export interface FooterProps {
  tokens: ThemeTokens;
  message: string;
  hint: string;
}

export function Footer(props: FooterProps): JSX.Element {
  return (
    <box flexDirection="row" height={1} flexShrink={0} gap={1}>
      <text fg={props.tokens.textMuted} wrapMode="none" truncate>
        {props.message}
      </text>
      <text fg={props.tokens.textFaint} wrapMode="none" truncate>
        {props.hint}
      </text>
    </box>
  );
}
