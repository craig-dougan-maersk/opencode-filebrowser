import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Show, createComponent, createResource } from "solid-js";
import { createSignal } from "solid-js";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { TextAttributes } from "@opentui/core";

/**
 * Props an external editor provider receives. A provider is a Solid component
 * exported as the module's default export and rendered in place of the
 * built-in plain-text editor.
 */

/**
 * Imports a provider module and takes its default export. An absolute path is
 * converted to a file URL; a bare specifier is left for the host's module
 * loader to resolve. A relative specifier is rejected because it would resolve
 * against the installed plugin, not the user's configuration. A module that
 * exports a component without `default` is accepted only when it is callable,
 * so a misdeclared provider fails loudly instead of rendering nothing.
 */
export async function loadEditorProvider(specifier) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    throw new Error(`${specifier} must be an absolute path or a package name`);
  }
  const target = path.isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier;
  const loaded = await import(target);
  const candidate = loaded.default ?? loaded;
  if (typeof candidate !== "function") {
    throw new Error(`${specifier} does not export an editor component`);
  }
  return candidate;
}
/**
 * Renders an external editor provider, reporting the failure in place of the
 * buffer when the module cannot be imported. A broken provider never silently
 * discards the file: the message names the provider and the reason.
 */
export function ExternalEditor(props) {
  const [error, setError] = createSignal(undefined);
  const [component] = createResource(() => props.tab.providerModule, async specifier => {
    if (!specifier) return undefined;
    try {
      return await loadEditorProvider(specifier);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  });
  const fallback = (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$3 = _$createElement("text"),
      _el$4 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
    _$insertNode(_el$, _el$4);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "width", "100%");
    _$setProp(_el$, "height", "100%");
    _$setProp(_el$, "paddingLeft", 1);
    _$insert(_el$2, () => `editor provider unavailable: ${props.tab.providerId}`);
    _$insert(_el$3, () => error() ?? "loading provider…");
    _$insertNode(_el$4, _$createTextNode(`check editor.providers in the filebrowser settings file`));
    _$effect(_p$ => {
      var _v$ = props.tokens.error,
        _v$2 = TextAttributes.BOLD,
        _v$3 = props.tokens.textMuted,
        _v$4 = props.tokens.textFaint;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "attributes", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$3, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$4, "fg", _v$4, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
  return _$createComponent(Show, {
    get when() {
      return component();
    },
    fallback: fallback,
    children: Provider => createComponent(Provider(), {
      path: props.tab.path,
      content: props.tab.content,
      readOnly: props.tab.readOnly,
      tokens: props.tokens,
      options: props.tab.providerOptions,
      onChange: props.onChange
    })
  });
}
