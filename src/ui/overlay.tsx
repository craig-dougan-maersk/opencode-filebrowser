import path from "node:path";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { Show, type JSX } from "solid-js";
import type { ThemeTokens } from "../lib/theme";
import { stopEvent } from "./chrome";
import { PlainTextEditor } from "./editor";
import { ExternalEditor } from "./provider";
import type { EditorTab } from "./state";

/** Rows the host dialog frame and the overlay's own header and footer use. */
const FRAME_ROWS = 8;
const MIN_BODY_ROWS = 5;

export interface EditorOverlayProps {
  editor: () => EditorTab | undefined;
  /** Root of the tab the file was opened from, used to shorten the title. */
  root: () => string;
  tokens: ThemeTokens;
  owner: unknown;
  onChange: (content: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/**
 * Full-width editor shown in the host's dialog layer, over the session. The
 * header names the file and marks unsaved changes with ●; the footer lists the
 * keys and doubles as clickable buttons for mouse users.
 */
export function EditorOverlay(props: EditorOverlayProps): JSX.Element {
  const dimensions = useTerminalDimensions();
  const bodyRows = () => Math.max(MIN_BODY_ROWS, dimensions().height - FRAME_ROWS);
  const dirty = () => {
    const editor = props.editor();
    return editor !== undefined && editor.content !== editor.saved;
  };
  const title = () => {
    const editor = props.editor();
    if (!editor) return "";
    const relative = path.relative(props.root(), editor.path);
    return relative && !relative.startsWith("..") ? relative : editor.path;
  };

  return (
    <Show when={props.editor()}>
      {(editor) => (
        <box flexDirection="column" width="100%" paddingLeft={2} paddingRight={2}>
          <box flexDirection="row" height={1} flexShrink={0} gap={1}>
            <text fg={props.tokens.textBase} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexGrow={1}>
              {title()}
            </text>
            <Show when={dirty()}>
              <text fg={props.tokens.warning}>{"\u25cf"}</text>
            </Show>
            <text fg={props.tokens.textFaint} wrapMode="none">
              {editor().readOnly ? (editor().tooLarge ? "read-only · too large" : "read-only") : editor().providerId}
            </text>
          </box>
          <box flexDirection="column" width="100%" height={bodyRows()} marginTop={1} marginBottom={1}>
            <Show
              when={editor().providerModule}
              fallback={<PlainTextEditor tab={editor()} tokens={props.tokens} owner={props.owner} onChange={props.onChange} />}
            >
              <ExternalEditor tab={editor()} tokens={props.tokens} onChange={props.onChange} />
            </Show>
          </box>
          <box flexDirection="row" height={1} flexShrink={0} gap={2}>
            <Show when={!editor().readOnly}>
              <text
                fg={dirty() ? props.tokens.textPrimary : props.tokens.textMuted}
                onMouseDown={(event) => {
                  stopEvent(event);
                  props.onSave();
                }}
              >
                Ctrl+S save
              </text>
            </Show>
            <text
              fg={props.tokens.textMuted}
              onMouseDown={(event) => {
                stopEvent(event);
                props.onClose();
              }}
            >
              Esc close
            </text>
          </box>
        </box>
      )}
    </Show>
  );
}
