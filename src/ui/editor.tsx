import { SyntaxStyle, type TextareaRenderable } from "@opentui/core";
import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { syntaxStyleMap, type ThemeTokens } from "../lib/theme";
import type { EditorTab } from "./state";

export interface EditorProps {
  tab: EditorTab;
  tokens: ThemeTokens;
  /** Native resource owner (the host scene) for the syntax style. */
  owner: unknown;
  /** Called whenever the buffer changes, so the tab can track dirtiness. */
  onChange: (content: string) => void;
  /** True while the overlay is asking a question; the textarea gives up focus. */
  suspended?: boolean;
}

const FILETYPES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  css: "css",
  html: "html",
  sql: "sql",
  diff: "diff",
};

/** Filetype hint passed to the code renderer's syntax highlighter. */
export function filetypeOf(file: string): string {
  const name = file.split("/").pop() ?? file;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  return FILETYPES[name.slice(dot + 1).toLowerCase()] ?? "text";
}

/**
 * Built-in plain-text editor body. The overlay around it owns the title, the
 * dirty marker and the key hints. A file that exceeded the inline size limit is
 * shown read-only in a code view, so a truncated buffer can never be saved back
 * over the original. `suspended` moves focus off the textarea while the overlay
 * asks a question, so the answer keys are not typed into the buffer.
 */
export function PlainTextEditor(props: EditorProps): JSX.Element {
  const [textarea, setTextarea] = createSignal<TextareaRenderable | undefined>(undefined);
  // SyntaxStyle is a native resource owned by the host scene; it is created
  // once with the component and destroyed when the editor unmounts.
  const syntax = SyntaxStyle.fromStyles(syntaxStyleMap(props.tokens), props.owner as never);
  onCleanup(() => {
    void syntax.destroy();
  });

  createEffect(() => {
    const target = textarea();
    if (!target || target.isDestroyed) return;
    if (props.suspended) target.blur();
    else target.focus();
  });

  return (
    <Show
      when={!props.tab.readOnly}
      fallback={
        <scrollbox width="100%" flexGrow={1}>
          <code content={props.tab.content} filetype={filetypeOf(props.tab.path)} syntaxStyle={syntax} />
        </scrollbox>
      }
    >
      <textarea
        ref={(value: TextareaRenderable) => setTextarea(value)}
        initialValue={props.tab.content}
        width="100%"
        flexGrow={1}
        textColor={props.tokens.textBase}
        backgroundColor={props.tokens.backgroundBase}
        focusedTextColor={props.tokens.textBase}
        focusedBackgroundColor={props.tokens.backgroundBase}
        onContentChange={() => props.onChange(textarea()?.plainText ?? props.tab.content)}
      />
    </Show>
  );
}
