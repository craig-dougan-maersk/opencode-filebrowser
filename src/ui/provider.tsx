import { Show, createComponent, createResource, type JSX } from "solid-js";
import { createSignal } from "solid-js";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { TextAttributes } from "@opentui/core";
import type { ThemeTokens } from "../lib/theme";
import type { EditorTab } from "./state";

/**
 * Props an external editor provider receives. A provider is a Solid component
 * exported as the module's default export and rendered in place of the
 * built-in plain-text editor.
 */
export interface EditorProviderProps {
  /** Absolute path of the file being edited. */
  path: string;
  /** Current buffer contents. */
  content: string;
  /** True when the file must not be written back. */
  readOnly: boolean;
  /** Host theme tokens, already adapted. */
  tokens: ThemeTokens;
  /** Per-provider options from `editor.providers.<id>.options`. */
  options?: Record<string, unknown>;
  /** Reports an edited buffer so the tab can track dirtiness and save it. */
  onChange: (content: string) => void;
}

type ProviderComponent = (props: EditorProviderProps) => JSX.Element;

/**
 * Imports a provider module and takes its default export. An absolute path is
 * converted to a file URL; a bare specifier is left for the host's module
 * loader to resolve. A relative specifier is rejected because it would resolve
 * against the installed plugin, not the user's configuration. A module that
 * exports a component without `default` is accepted only when it is callable,
 * so a misdeclared provider fails loudly instead of rendering nothing.
 */
export async function loadEditorProvider(specifier: string): Promise<ProviderComponent> {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    throw new Error(`${specifier} must be an absolute path or a package name`);
  }
  const target = path.isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier;
  const loaded = (await import(target)) as { default?: unknown };
  const candidate = loaded.default ?? loaded;
  if (typeof candidate !== "function") {
    throw new Error(`${specifier} does not export an editor component`);
  }
  return candidate as ProviderComponent;
}

export interface ExternalEditorProps {
  tab: EditorTab;
  tokens: ThemeTokens;
  onChange: (content: string) => void;
}

/**
 * Renders an external editor provider, reporting the failure in place of the
 * buffer when the module cannot be imported. A broken provider never silently
 * discards the file: the message names the provider and the reason.
 */
export function ExternalEditor(props: ExternalEditorProps): JSX.Element {
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [component] = createResource(
    () => props.tab.providerModule,
    async (specifier: string | undefined) => {
      if (!specifier) return undefined;
      try {
        return await loadEditorProvider(specifier);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return undefined;
      }
    },
  );

  const fallback = (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={1}>
      <text fg={props.tokens.error} attributes={TextAttributes.BOLD}>
        {`editor provider unavailable: ${props.tab.providerId}`}
      </text>
      <text fg={props.tokens.textMuted}>{error() ?? "loading provider…"}</text>
      <text fg={props.tokens.textFaint}>check editor.providers in the filebrowser settings file</text>
    </box>
  );

  return (
    <Show when={component()} fallback={fallback}>
      {(Provider) =>
        createComponent(Provider(), {
          path: props.tab.path,
          content: props.tab.content,
          readOnly: props.tab.readOnly,
          tokens: props.tokens,
          options: props.tab.providerOptions,
          onChange: props.onChange,
        })
      }
    </Show>
  );
}
