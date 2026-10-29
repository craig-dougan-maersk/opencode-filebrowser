import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { SyntaxStyle } from "@opentui/core";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { syntaxStyleMap } from "../lib/theme.js";
const FILETYPES = {
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
  diff: "diff"
};

/** Filetype hint passed to the code renderer's syntax highlighter. */
export function filetypeOf(file) {
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
export function PlainTextEditor(props) {
  const [textarea, setTextarea] = createSignal(undefined);
  // SyntaxStyle is a native resource owned by the host scene; it is created
  // once with the component and destroyed when the editor unmounts.
  const syntax = SyntaxStyle.fromStyles(syntaxStyleMap(props.tokens), props.owner);
  onCleanup(() => {
    void syntax.destroy();
  });
  createEffect(() => {
    const target = textarea();
    if (!target || target.isDestroyed) return;
    if (props.suspended) target.blur();else target.focus();
  });
  return _$createComponent(Show, {
    get when() {
      return !props.tab.readOnly;
    },
    get fallback() {
      return (() => {
        var _el$2 = _$createElement("scrollbox"),
          _el$3 = _$createElement("code");
        _$insertNode(_el$2, _el$3);
        _$setProp(_el$2, "width", "100%");
        _$setProp(_el$2, "flexGrow", 1);
        _$setProp(_el$3, "syntaxStyle", syntax);
        _$effect(_p$ => {
          var _v$6 = props.tab.content,
            _v$7 = filetypeOf(props.tab.path);
          _v$6 !== _p$.e && (_p$.e = _$setProp(_el$3, "content", _v$6, _p$.e));
          _v$7 !== _p$.t && (_p$.t = _$setProp(_el$3, "filetype", _v$7, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$2;
      })();
    },
    get children() {
      var _el$ = _$createElement("textarea");
      _$use(value => setTextarea(value), _el$);
      _$setProp(_el$, "width", "100%");
      _$setProp(_el$, "flexGrow", 1);
      _$setProp(_el$, "onContentChange", () => props.onChange(textarea()?.plainText ?? props.tab.content));
      _$effect(_p$ => {
        var _v$ = props.tab.content,
          _v$2 = props.tokens.textBase,
          _v$3 = props.tokens.backgroundBase,
          _v$4 = props.tokens.textBase,
          _v$5 = props.tokens.backgroundBase;
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "initialValue", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$, "textColor", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$, "backgroundColor", _v$3, _p$.a));
        _v$4 !== _p$.o && (_p$.o = _$setProp(_el$, "focusedTextColor", _v$4, _p$.o));
        _v$5 !== _p$.i && (_p$.i = _$setProp(_el$, "focusedBackgroundColor", _v$5, _p$.i));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined
      });
      return _el$;
    }
  });
}
