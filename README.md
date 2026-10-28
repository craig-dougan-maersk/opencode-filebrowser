# OpenCode file browser

A TUI plugin for OpenCode: a tabbed file tree in the sidebar (or a side panel),
with copy/paste, an in-terminal plain-text editor and binary viewing.

## What it does

- **Tabbed trees.** Several browser tabs, each with its own root, expansion
  state and selection. `ctrl+t` opens one, `ctrl+w` closes it.
- **Sidebar or panel.** The browser renders in `sidebar.content` by default.
  `ctrl+o` (or the *Open file browser panel* palette command) moves it into a
  `session.panel` side panel — the split-window form.
- **Selection and copy/paste.** Click selects; shift/ctrl-click extends the
  selection. `ctrl+c` copies, `ctrl+v` pastes into the directory the selection
  is anchored in. Paths are also published over OSC 52 when the terminal
  supports it, so they can be pasted into other applications.
- **Paste rules.** Pasting into the *same* directory always prompts for a new
  name. Pasting elsewhere with no clash copies silently. Pasting elsewhere with
  a clash prompts.
- **Inline editor.** Double-clicking a text file opens it in a plain-text
  editor inside OpenCode — nothing is handed to an external program. `ctrl+s`
  saves, `esc` closes (with a confirmation when the buffer is dirty).
- **Binary files.** Double-clicking a binary dispatches a configurable keymap
  command, by default the `fileviewer.view` command from
  [`opencode-file-viewer`](https://github.com/eddy-lau/opencode-file-viewer).
  When that command is absent, the configured fallbacks apply.
- **Presentation.** Colours come from the active OpenCode theme; directories get
  folder icons and files get icons by name or extension; git status shows as
  colour and, optionally, a porcelain badge.

## Install

Add the plugin to the `plugins` array in `~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["github:craig-dougan-maersk/opencode-filebrowser"]
}
```

The package ships committed `dist/` JavaScript, so no build step runs on
install. It has no runtime dependency beyond the OpenCode host, which supplies
Solid, OpenTUI and the plugin API.

## Configuration

Settings live in `~/.config/opencode/filebrowser.json` (or
`$XDG_CONFIG_HOME/opencode/filebrowser.json`). The file is optional; a missing
or malformed field falls back to its default without discarding the rest.
[`schema/filebrowser.schema.json`](schema/filebrowser.schema.json) describes
every field and can be referenced from an editor for completion.

Run **File browser settings** from the command palette to change the root mode,
icon style, git colouring, default editor provider and binary viewer command.
Each change is written straight back to the file, atomically, and the browser
reloads the affected trees. The dialog edits a subset of the file; the rest is
hand-edited as JSON.

```json
{
  "$schema": "./filebrowser.schema.json",
  "root": { "mode": "session", "allowAbove": false },
  "icons": { "style": "nerdfont" },
  "ignore": ["node_modules/", "dist/"],
  "editor": {
    "default": "plaintext",
    "map": [{ "match": "*.md", "provider": "markdown" }],
    "providers": { "markdown": { "module": "opencode-editor-markdown" } }
  },
  "binaryViewer": { "command": "fileviewer.view", "fallback": ["system-open", "hex"] }
}
```

### Root containment

`root.mode` decides what the browser may show:

| Mode | Root |
| --- | --- |
| `session` | The active session's directory (default) |
| `path` | `root.path`, with a leading `~` expanded |
| `unrestricted` | `root.path` or the session directory, with no containment check |

With `root.allowAbove` set to `false`, navigation above the resolved root — and
`ctrl+g` destinations outside it — are refused.

### Editor providers

The editor is chosen per file: the first `editor.map` entry whose basename glob
matches wins, otherwise `editor.default` applies. A provider is either a
built-in (`plaintext`, `readonly`) or an entry under `editor.providers`, whose
`module` is an npm package name or an absolute path to a local module. External
providers are resolved at open time; an unresolved provider degrades to
`plaintext` rather than failing the open.

### Protection

`protect` holds `**`-aware globs for files that need confirmation before they
are opened — `.env` files, SSH material and private keys by default. The
relative path and the basename are both tested.

### Large directories

A single flatten is capped at 20,000 rows so an enormous directory cannot stall
the UI. When the cap is hit the breadcrumb shows `truncated` and the remaining
entries are simply not listed; collapse a directory or narrow `ignore` to see
the rest.

## Keybindings

The browser's keyboard layer is only active while the browser has focus, so its
keys do not shadow the rest of OpenCode.

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move the selection |
| `→` / `enter` | Expand a directory, or open a file |
| `←` | Collapse a directory, or go to the parent |
| `backspace` | Go to the parent directory |
| `ctrl+g` | Go to a directory by path |
| `ctrl+n` | New file in the current directory |
| `ctrl+c` / `ctrl+v` | Copy the selection / paste |
| `ctrl+t` / `ctrl+w` | New browser tab / close browser tab |
| `ctrl+tab` / `ctrl+shift+tab` | Next / previous browser tab |
| `ctrl+o` | Toggle the side panel |
| `f5` | Refresh the tree |
| `ctrl+s` | Save (editor) |
| `esc` | Close the editor |

Two palette commands are always available: **Focus the file browser** and
**File browser settings**.

## Agent tool

The server half registers a `filebrowser` tool, so the agent can ask the UI to
reveal or open a path:

```
filebrowser path=src/tui.tsx mode=reveal
```

`mode` is `reveal` (expand and select), `edit` (open in the editor) or `view`
(open with the binary viewer). The `/filebrowser <path>` slash command does the
same from the prompt.

## Build

Use Node 26 and npm with the committed lockfile:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run compile
npm test
npm run build:check
node --check dist/tui.js
npm pack --dry-run --json
```

Babel compiles every module under `src/` to Solid universal JavaScript under
`dist/`, preserving the directory layout. OpenCode, Solid and OpenTUI imports
stay external; this is not a React build and does not bundle a second renderer.
The build rewrites relative import specifiers to carry an explicit `.js`
extension, because the emitted files are loaded as native ES modules. Commit
`dist/` alongside source changes; `npm run build:check` fails on stale or
missing output.

The packaging tests do not execute the plugin inside OpenCode. Validate sidebar
rendering, mouse interaction, refresh and reload cleanup in the target host
before releasing.
