import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import path from "node:path";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { Show } from "solid-js";
import { stopEvent } from "./chrome.js";
import { PlainTextEditor } from "./editor.js";
import { ExternalEditor } from "./provider.js";
/** Rows the host dialog frame and the overlay's own header and footer use. */
const FRAME_ROWS = 8;
const MIN_BODY_ROWS = 5;
/**
 * Full-width editor shown in the host's dialog layer, over the session. The
 * header names the file and marks unsaved changes with ●; the footer lists the
 * keys and doubles as clickable buttons for mouse users.
 */
export function EditorOverlay(props) {
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
  return _$createComponent(Show, {
    get when() {
      return props.editor();
    },
    children: editor => (() => {
      var _el$ = _$createElement("box"),
        _el$2 = _$createElement("box"),
        _el$3 = _$createElement("text"),
        _el$6 = _$createElement("text"),
        _el$7 = _$createElement("box"),
        _el$8 = _$createElement("box"),
        _el$1 = _$createElement("text");
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$7);
      _$insertNode(_el$, _el$8);
      _$setProp(_el$, "flexDirection", "column");
      _$setProp(_el$, "width", "100%");
      _$setProp(_el$, "paddingLeft", 2);
      _$setProp(_el$, "paddingRight", 2);
      _$insertNode(_el$2, _el$3);
      _$insertNode(_el$2, _el$6);
      _$setProp(_el$2, "flexDirection", "row");
      _$setProp(_el$2, "height", 1);
      _$setProp(_el$2, "flexShrink", 0);
      _$setProp(_el$2, "gap", 1);
      _$setProp(_el$3, "wrapMode", "none");
      _$setProp(_el$3, "truncate", true);
      _$setProp(_el$3, "flexGrow", 1);
      _$insert(_el$3, title);
      _$insert(_el$2, _$createComponent(Show, {
        get when() {
          return dirty();
        },
        get children() {
          var _el$4 = _$createElement("text");
          _$insertNode(_el$4, _$createTextNode(`●`));
          _$effect(_$p => _$setProp(_el$4, "fg", props.tokens.warning, _$p));
          return _el$4;
        }
      }), _el$6);
      _$setProp(_el$6, "wrapMode", "none");
      _$insert(_el$6, (() => {
        var _c$ = _$memo(() => !!editor().readOnly);
        return () => _c$() ? editor().tooLarge ? "read-only · too large" : "read-only" : editor().providerId;
      })());
      _$setProp(_el$7, "flexDirection", "column");
      _$setProp(_el$7, "width", "100%");
      _$setProp(_el$7, "marginTop", 1);
      _$setProp(_el$7, "marginBottom", 1);
      _$insert(_el$7, _$createComponent(Show, {
        get when() {
          return editor().providerModule;
        },
        get fallback() {
          return _$createComponent(PlainTextEditor, {
            get tab() {
              return editor();
            },
            get tokens() {
              return props.tokens;
            },
            get owner() {
              return props.owner;
            },
            get onChange() {
              return props.onChange;
            }
          });
        },
        get children() {
          return _$createComponent(ExternalEditor, {
            get tab() {
              return editor();
            },
            get tokens() {
              return props.tokens;
            },
            get onChange() {
              return props.onChange;
            }
          });
        }
      }));
      _$insertNode(_el$8, _el$1);
      _$setProp(_el$8, "flexDirection", "row");
      _$setProp(_el$8, "height", 1);
      _$setProp(_el$8, "flexShrink", 0);
      _$setProp(_el$8, "gap", 2);
      _$insert(_el$8, _$createComponent(Show, {
        get when() {
          return !editor().readOnly;
        },
        get children() {
          var _el$9 = _$createElement("text");
          _$insertNode(_el$9, _$createTextNode(`Ctrl+S save`));
          _$setProp(_el$9, "onMouseDown", event => {
            stopEvent(event);
            props.onSave();
          });
          _$effect(_$p => _$setProp(_el$9, "fg", dirty() ? props.tokens.textPrimary : props.tokens.textMuted, _$p));
          return _el$9;
        }
      }), _el$1);
      _$insertNode(_el$1, _$createTextNode(`Esc close`));
      _$setProp(_el$1, "onMouseDown", event => {
        stopEvent(event);
        props.onClose();
      });
      _$effect(_p$ => {
        var _v$ = props.tokens.textBase,
          _v$2 = TextAttributes.BOLD,
          _v$3 = props.tokens.textFaint,
          _v$4 = bodyRows(),
          _v$5 = props.tokens.textMuted;
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "attributes", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$6, "fg", _v$3, _p$.a));
        _v$4 !== _p$.o && (_p$.o = _$setProp(_el$7, "height", _v$4, _p$.o));
        _v$5 !== _p$.i && (_p$.i = _$setProp(_el$1, "fg", _v$5, _p$.i));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined
      });
      return _el$;
    })()
  });
}
