import { TextAttributes } from "@opentui/core";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { iconFor, type IconSet } from "../lib/icons";
import { badgeFor, type GitStatusEntry } from "../lib/git";
import { paletteStyle, type GitPalette } from "../lib/palette";
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

export interface RowStyleOptions {
  directory: boolean;
  showBadge: boolean;
  /** Colour scheme for git states; defaults to JetBrains. */
  palette?: GitPalette;
  /** Show the ↑ marker on files changed by unpushed commits. */
  showUnpushed?: boolean;
}

/**
 * Maps git status to a palette colour plus a non-colour attribute, so the
 * state survives a monochrome terminal. Directories inherit the most severe
 * child status; the ↑ marker flags committed changes not yet pushed.
 */
export function rowStyleFor(tokens: ThemeTokens, status: GitStatusEntry | undefined, options: RowStyleOptions): RowStyle {
  const showUnpushed = options.showUnpushed !== false;
  const visible = status && !showUnpushed && status.unpushed ? { ...status, unpushed: false } : status;
  let badge = options.showBadge ? badgeFor(visible) : "";
  if (!options.showBadge && showUnpushed && visible?.unpushed) badge = "↑";
  const style = paletteStyle(options.palette ?? "jetbrains", visible);
  if (!style) {
    return {
      fg: options.directory ? tokens.textPrimary : tokens.textBase,
      attributes: options.directory ? BOLD : TextAttributes.NONE,
      badge,
    };
  }
  let attributes = options.directory ? BOLD : TextAttributes.NONE;
  if (style.bold) attributes |= BOLD;
  if (style.italic) attributes |= ITALIC;
  if (style.strikethrough) attributes |= STRIKETHROUGH;
  if (style.dim) attributes |= DIM;
  return { fg: style.color, attributes, badge };
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
  palette: GitPalette;
  showUnpushed: boolean;
  onMouseDown: (event: unknown, row: TreeRow) => void;
}

/** One tree line: indent, icon, name, optional git badge. */
export function TreeRowView(props: TreeRowProps): JSX.Element {
  const style = () =>
    rowStyleFor(props.tokens, props.status, {
      directory: props.row.entry.directory,
      showBadge: props.showBadges,
      palette: props.palette,
      showUnpushed: props.showUnpushed,
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
