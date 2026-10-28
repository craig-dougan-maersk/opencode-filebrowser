import { TextAttributes } from "@opentui/core";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { iconFor, type IconSet } from "../lib/icons";
import { badgeFor, type GitStatusEntry } from "../lib/git";
import type { TreeRow } from "../lib/fs-tree";
import type { ThemeColor, ThemeTokens } from "../lib/theme";

export interface RowStyle {
  fg: ThemeColor;
  attributes: number;
  badge: string;
}

const BOLD = TextAttributes.BOLD;
const ITALIC = TextAttributes.ITALIC;
const STRIKETHROUGH = TextAttributes.STRIKETHROUGH;
const DIM = TextAttributes.DIM;

/**
 * Maps git status to colour plus a non-colour attribute, so the state survives
 * a monochrome terminal. Untracked and added are bold, modified italic, deleted
 * struck through, conflicted bold and struck through.
 */
export function rowStyleFor(
  tokens: ThemeTokens,
  status: GitStatusEntry | undefined,
  options: { directory: boolean; showBadge: boolean },
): RowStyle {
  const badge = options.showBadge ? badgeFor(status) : "";
  if (!status) {
    return {
      fg: options.directory ? tokens.textPrimary : tokens.textBase,
      attributes: options.directory ? BOLD : TextAttributes.NONE,
      badge,
    };
  }
  switch (status.code) {
    case "untracked":
    case "added":
      return { fg: tokens.success, attributes: BOLD, badge };
    case "modified":
      return { fg: tokens.warning, attributes: ITALIC, badge };
    case "deleted":
      return { fg: tokens.error, attributes: STRIKETHROUGH, badge };
    case "conflict":
      return { fg: tokens.error, attributes: BOLD | STRIKETHROUGH, badge };
    case "renamed":
    case "copied":
      return { fg: tokens.info, attributes: ITALIC, badge };
    case "ignored":
      return { fg: tokens.textFaint, attributes: DIM, badge };
    default:
      return { fg: tokens.textBase, attributes: TextAttributes.NONE, badge };
  }
}

export interface TreeRowProps {
  row: TreeRow;
  tokens: ThemeTokens;
  icons: IconSet;
  /** True when the row is the primary selection. */
  selected: boolean;
  /** True when the row is part of the multi-selection. */
  alsoSelected: boolean;
  status: GitStatusEntry | undefined;
  protected: boolean;
  showBadges: boolean;
  onMouseDown: (event: unknown, row: TreeRow) => void;
}

/** One tree line: indent, icon, name, optional git badge. */
export function TreeRowView(props: TreeRowProps): JSX.Element {
  const style = () =>
    rowStyleFor(props.tokens, props.status, {
      directory: props.row.entry.directory,
      showBadge: props.showBadges,
    });

  const label = () => {
    const indent = "  ".repeat(props.row.depth);
    const icon = iconFor(props.icons, {
      name: props.row.entry.name,
      directory: props.row.entry.directory,
      symlink: props.row.entry.symlink,
      open: props.row.expanded,
      protected: props.protected,
    });
    const link = props.row.entry.symlink ? " @" : "";
    return `${indent}${icon} ${props.row.entry.name}${link}`;
  };

  const background = () =>
    props.selected ? props.tokens.backgroundRaisedHigh : props.alsoSelected ? props.tokens.backgroundRaised : undefined;

  return (
    <box flexDirection="row" width="100%" backgroundColor={background()} onMouseDown={(event) => props.onMouseDown(event, props.row)}>
      <text
        fg={style().fg}
        attributes={props.selected ? style().attributes | BOLD | TextAttributes.INVERSE : style().attributes}
        flexGrow={1}
        wrapMode="none"
        truncate
      >
        {label()}
      </text>
      <Show when={style().badge}>
        <text fg={style().fg} attributes={style().attributes} wrapMode="none" truncate>
          {` ${style().badge}`}
        </text>
      </Show>
    </box>
  );
}
