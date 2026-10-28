import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { For, Show } from "solid-js";
export function stopEvent(event) {
  const candidate = event;
  try {
    candidate?.stopPropagation?.();
  } catch {
    // A host that does not implement stopPropagation needs no handling.
  }
}
/** Internal browser tab strip. Session tabs belong to the host and are not used here. */
export function TabStrip(props) {
  return (() => {
    var _el$ = _$createElement("box");
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$, "height", 1);
    _$setProp(_el$, "flexShrink", 0);
    _$insert(_el$, _$createComponent(For, {
      get each() {
        return props.tabs;
      },
      children: (tab, index) => {
        const active = () => index() === props.activeIndex;
        const dirty = () => tab.editor !== undefined && tab.editor.content !== tab.editor.saved;
        return (() => {
          var _el$2 = _$createElement("box"),
            _el$3 = _$createElement("text");
          _$insertNode(_el$2, _el$3);
          _$setProp(_el$2, "flexDirection", "row");
          _$setProp(_el$3, "wrapMode", "none");
          _$setProp(_el$3, "truncate", true);
          _$setProp(_el$3, "onMouseDown", event => {
            stopEvent(event);
            props.onSelect(index());
          });
          _$insert(_el$3, () => ` ${dirty() ? "*" : ""}${tab.title} `);
          _$insert(_el$2, _$createComponent(Show, {
            get when() {
              return props.tabs.length > 1;
            },
            get children() {
              var _el$4 = _$createElement("text");
              _$insertNode(_el$4, _$createTextNode(`×`));
              _$setProp(_el$4, "wrapMode", "none");
              _$setProp(_el$4, "truncate", true);
              _$setProp(_el$4, "onMouseDown", event => {
                stopEvent(event);
                props.onClose(index());
              });
              _$effect(_$p => _$setProp(_el$4, "fg", props.tokens.textFaint, _$p));
              return _el$4;
            }
          }), null);
          _$effect(_p$ => {
            var _v$ = active() ? props.tokens.textPrimary : props.tokens.textMuted,
              _v$2 = active() ? TextAttributes.BOLD : TextAttributes.NONE;
            _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "attributes", _v$2, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$2;
        })();
      }
    }));
    return _el$;
  })();
}
/** Current directory, shortened from the left when the sidebar is narrow. */
export function Breadcrumb(props) {
  const label = () => {
    const parts = props.path.split("/").filter(part => part !== "");
    if (parts.length <= 3) return props.path;
    return `…/${parts.slice(-3).join("/")}`;
  };
  return (() => {
    var _el$6 = _$createElement("box"),
      _el$7 = _$createElement("text");
    _$insertNode(_el$6, _el$7);
    _$setProp(_el$6, "flexDirection", "row");
    _$setProp(_el$6, "height", 1);
    _$setProp(_el$6, "flexShrink", 0);
    _$setProp(_el$7, "wrapMode", "none");
    _$setProp(_el$7, "truncate", true);
    _$insert(_el$7, label);
    _$insert(_el$6, _$createComponent(Show, {
      get when() {
        return props.branch;
      },
      get children() {
        var _el$8 = _$createElement("text");
        _$setProp(_el$8, "wrapMode", "none");
        _$setProp(_el$8, "truncate", true);
        _$insert(_el$8, () => `  \u2387 ${props.branch}`);
        _$effect(_$p => _$setProp(_el$8, "fg", props.tokens.info, _$p));
        return _el$8;
      }
    }), null);
    _$insert(_el$6, _$createComponent(Show, {
      get when() {
        return props.truncated;
      },
      get children() {
        var _el$9 = _$createElement("text");
        _$insertNode(_el$9, _$createTextNode(`  truncated`));
        _$setProp(_el$9, "wrapMode", "none");
        _$setProp(_el$9, "truncate", true);
        _$effect(_$p => _$setProp(_el$9, "fg", props.tokens.warning, _$p));
        return _el$9;
      }
    }), null);
    _$effect(_$p => _$setProp(_el$7, "fg", props.tokens.textMuted, _$p));
    return _el$6;
  })();
}
export function Footer(props) {
  return (() => {
    var _el$1 = _$createElement("box"),
      _el$10 = _$createElement("text"),
      _el$11 = _$createElement("text");
    _$insertNode(_el$1, _el$10);
    _$insertNode(_el$1, _el$11);
    _$setProp(_el$1, "flexDirection", "row");
    _$setProp(_el$1, "height", 1);
    _$setProp(_el$1, "flexShrink", 0);
    _$setProp(_el$1, "gap", 1);
    _$setProp(_el$10, "wrapMode", "none");
    _$setProp(_el$10, "truncate", true);
    _$insert(_el$10, () => props.message);
    _$setProp(_el$11, "wrapMode", "none");
    _$setProp(_el$11, "truncate", true);
    _$insert(_el$11, () => props.hint);
    _$effect(_p$ => {
      var _v$3 = props.tokens.textMuted,
        _v$4 = props.tokens.textFaint;
      _v$3 !== _p$.e && (_p$.e = _$setProp(_el$10, "fg", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp(_el$11, "fg", _v$4, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$1;
  })();
}
