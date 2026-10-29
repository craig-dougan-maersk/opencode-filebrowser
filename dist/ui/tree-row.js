import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";
import { iconFor } from "../lib/icons.js";
import { badgeFor } from "../lib/git.js";
import { paletteStyle } from "../lib/palette.js";
const BOLD = TextAttributes.BOLD;
const ITALIC = TextAttributes.ITALIC;
const STRIKETHROUGH = TextAttributes.STRIKETHROUGH;
const DIM = TextAttributes.DIM;
/**
 * Maps git status to a palette colour plus a non-colour attribute, so the
 * state survives a monochrome terminal. Directories inherit the most severe
 * child status; the ↑ marker flags committed changes not yet pushed.
 */
export function rowStyleFor(tokens, status, options) {
  const showUnpushed = options.showUnpushed !== false;
  const visible = status && !showUnpushed && status.unpushed ? {
    ...status,
    unpushed: false
  } : status;
  let badge = options.showBadge ? badgeFor(visible) : "";
  if (!options.showBadge && showUnpushed && visible?.unpushed) badge = "↑";
  const style = paletteStyle(options.palette ?? "jetbrains", visible);
  if (!style) {
    return {
      fg: options.directory ? tokens.textPrimary : tokens.textBase,
      attributes: options.directory ? BOLD : TextAttributes.NONE,
      badge
    };
  }
  let attributes = options.directory ? BOLD : TextAttributes.NONE;
  if (style.bold) attributes |= BOLD;
  if (style.italic) attributes |= ITALIC;
  if (style.strikethrough) attributes |= STRIKETHROUGH;
  if (style.dim) attributes |= DIM;
  return {
    fg: style.color,
    attributes,
    badge
  };
}
/** One tree line: indent, icon, name, optional git badge. */
export function TreeRowView(props) {
  const style = () => rowStyleFor(props.tokens, props.status, {
    directory: props.row.entry.directory,
    showBadge: props.showBadges,
    palette: props.palette,
    showUnpushed: props.showUnpushed
  });
  const label = () => {
    const indent = "  ".repeat(props.row.depth);
    const icon = iconFor(props.icons, {
      name: props.row.entry.name,
      directory: props.row.entry.directory,
      symlink: props.row.entry.symlink,
      open: props.row.expanded,
      protected: props.protected
    });
    const link = props.row.entry.symlink ? " @" : "";
    return `${indent}${icon} ${props.row.entry.name}${link}`;
  };
  const background = () => props.selected ? props.tokens.backgroundRaisedHigh : props.alsoSelected ? props.tokens.backgroundRaised : undefined;
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$, "width", "100%");
    _$setProp(_el$, "onMouseDown", event => props.onMouseDown(event, props.row));
    _$setProp(_el$2, "flexGrow", 1);
    _$setProp(_el$2, "wrapMode", "none");
    _$setProp(_el$2, "truncate", true);
    _$insert(_el$2, label);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return style().badge;
      },
      get children() {
        var _el$3 = _$createElement("text");
        _$setProp(_el$3, "wrapMode", "none");
        _$setProp(_el$3, "truncate", true);
        _$insert(_el$3, () => ` ${style().badge}`);
        _$effect(_p$ => {
          var _v$ = style().fg,
            _v$2 = style().attributes;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "attributes", _v$2, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$3;
      }
    }), null);
    _$effect(_p$ => {
      var _v$3 = background(),
        _v$4 = style().fg,
        _v$5 = props.selected ? style().attributes | BOLD | TextAttributes.INVERSE : style().attributes;
      _v$3 !== _p$.e && (_p$.e = _$setProp(_el$, "backgroundColor", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$4, _p$.t));
      _v$5 !== _p$.a && (_p$.a = _$setProp(_el$2, "attributes", _v$5, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$;
  })();
}
