import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
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
 * Built-in plain-text editor. A textarea captures input while the exclusive
 * editor keymap mode is active. A file that exceeded the inline size limit is
 * shown read-only in a code view, so a truncated buffer can never be saved back
 * over the original.
 */
export function PlainTextEditor(props) {
  const [textarea, setTextarea] = createSignal(undefined);
  // SyntaxStyle is a native resource owned by the host scene; it is created
  // once with the component and destroyed when the editor unmounts.
  const syntax = SyntaxStyle.fromStyles(syntaxStyleMap(props.tokens), props.owner);
  onCleanup(() => {
    void syntax.destroy();
  });

  // The textarea is the only focusable element here, so focus it once mounted.
  createEffect(() => {
    textarea()?.focus();
  });
  const label = () => props.tab.path.split("/").pop() ?? props.tab.path;
  const state = () => props.tab.readOnly ? "read-only" : props.tab.content === props.tab.saved ? "saved" : "modified";
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("box"),
      _el$3 = _$createElement("text"),
      _el$4 = _$createElement("text"),
      _el$6 = _$createElement("box"),
      _el$7 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$6);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "width", "100%");
    _$setProp(_el$, "height", "100%");
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$4);
    _$setProp(_el$2, "flexDirection", "row");
    _$setProp(_el$2, "height", 1);
    _$setProp(_el$2, "flexShrink", 0);
    _$setProp(_el$2, "gap", 1);
    _$insert(_el$3, label);
    _$insert(_el$4, state);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return !props.tab.readOnly;
      },
      get fallback() {
        return (() => {
          var _el$8 = _$createElement("scrollbox"),
            _el$9 = _$createElement("code");
          _$insertNode(_el$8, _el$9);
          _$setProp(_el$8, "width", "100%");
          _$setProp(_el$8, "flexGrow", 1);
          _$setProp(_el$9, "syntaxStyle", syntax);
          _$effect(_p$ => {
            var _v$9 = props.tab.content,
              _v$0 = filetypeOf(props.tab.path);
            _v$9 !== _p$.e && (_p$.e = _$setProp(_el$9, "content", _v$9, _p$.e));
            _v$0 !== _p$.t && (_p$.t = _$setProp(_el$9, "filetype", _v$0, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$8;
        })();
      },
      get children() {
        var _el$5 = _$createElement("textarea");
        _$use(value => setTextarea(value), _el$5);
        _$setProp(_el$5, "width", "100%");
        _$setProp(_el$5, "flexGrow", 1);
        _$setProp(_el$5, "onContentChange", () => props.onChange(textarea()?.plainText ?? props.tab.content));
        _$effect(_p$ => {
          var _v$ = props.tab.content,
            _v$2 = props.tokens.textBase,
            _v$3 = props.tokens.backgroundBase,
            _v$4 = props.tokens.textBase,
            _v$5 = props.tokens.backgroundRaised;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$5, "initialValue", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "textColor", _v$2, _p$.t));
          _v$3 !== _p$.a && (_p$.a = _$setProp(_el$5, "backgroundColor", _v$3, _p$.a));
          _v$4 !== _p$.o && (_p$.o = _$setProp(_el$5, "focusedTextColor", _v$4, _p$.o));
          _v$5 !== _p$.i && (_p$.i = _$setProp(_el$5, "focusedBackgroundColor", _v$5, _p$.i));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined
        });
        return _el$5;
      }
    }), _el$6);
    _$insertNode(_el$6, _el$7);
    _$setProp(_el$6, "flexDirection", "row");
    _$setProp(_el$6, "height", 1);
    _$setProp(_el$6, "flexShrink", 0);
    _$insert(_el$7, () => props.tab.tooLarge ? "file exceeds the inline size limit; read-only" : "ctrl+s save · esc close");
    _$effect(_p$ => {
      var _v$6 = props.tokens.textBase,
        _v$7 = props.tab.readOnly ? props.tokens.warning : props.tokens.textFaint,
        _v$8 = props.tokens.textFaint;
      _v$6 !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$6, _p$.e));
      _v$7 !== _p$.t && (_p$.t = _$setProp(_el$4, "fg", _v$7, _p$.t));
      _v$8 !== _p$.a && (_p$.a = _$setProp(_el$7, "fg", _v$8, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$;
  })();
}
