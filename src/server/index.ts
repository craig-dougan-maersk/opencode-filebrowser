import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import { Plugin } from "@opencode/plugin";
import { FilebrowserRpc, type FilebrowserOpenMode } from "../rpc";

function expandPath(raw: string, base: string | undefined): string {
  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.resolve(base ?? process.cwd(), expanded);
}

function modeOf(input: unknown): FilebrowserOpenMode {
  return input === "edit" || input === "view" ? input : "reveal";
}

/**
 * Server half of the file browser: exposes a `filebrowser` tool to the agent
 * and relays open requests to the TUI over plugin RPC. The UI lives in
 * ./tui.tsx.
 */
export default Plugin.define({
  id: "opencode.filebrowser",
  async setup(ctx) {
    const registration = await ctx.rpc.register(FilebrowserRpc, {});

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "filebrowser",
        description:
          "Reveal or open a file in the user's sidebar file browser. " +
          "Use when the user asks to show, reveal, open or edit a file in the browser.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the file (absolute, ~/…, or relative to the workspace)" },
            mode: {
              type: "string",
              enum: ["reveal", "edit", "view"],
              description: "reveal selects the file in the tree, edit opens the editor, view opens the binary viewer",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const value = input as { path?: unknown; mode?: unknown };
          const requested = typeof value.path === "string" ? value.path : "";
          if (!requested) return { content: "Error: no path given." };

          const file = expandPath(requested, ctx.location?.directory);
          try {
            await stat(file);
          } catch {
            return { content: `Error: ${requested} does not exist.` };
          }

          await registration.events.emit("open", { path: file, mode: modeOf(value.mode) });
          return { content: `Opened ${path.basename(file)} in the file browser.` };
        },
      });
    });

    return () => registration.dispose();
  },
});
