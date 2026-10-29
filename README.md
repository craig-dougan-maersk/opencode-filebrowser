# OpenCode file browser

A TUI plugin for OpenCode: a tabbed file tree in the sidebar (or a side panel),
with copy/paste, an in-terminal plain-text editor and binary viewing.

## What it does

- **Collapsible sidebar section.** The browser sits in a bordered box in
  `sidebar.content`. Click the `▼ Files` header to collapse it to one line, as
  with the host's own sidebar groups; the state is remembered across restarts.
  While collapsed, filesystem watching and git refreshes pause.
- **Tabbed trees.** Several browser tabs, each with its own root, expansion
  state and selection. `alt+t` opens one, `alt+w` closes it.
- **Sidebar or panel.** `alt+p` (or the *Open file browser panel* palette
  command) also opens the browser in a `session.panel` side panel — the
  split-window form.
- **Selection and copy/paste.** Click selects; shift/ctrl-click extends the
  selection. `alt+c` copies, `alt+v` pastes into the directory the selection
  is anchored in. Paths are also published over OSC 52 when the terminal
  supports it, so they can be pasted into other applications.
- **Paste rules.** Pasting into the *same* directory always prompts for a new
  name. Pasting elsewhere with no clash copies silently. Pasting elsewhere with
  a clash prompts. A folder is never pasted into itself or its own subfolder.
- **Editor overlay.** Double-clicking a text file opens it in a full-width
  overlay over the session, not in the sidebar. The header shows the path and a
  `●` while there are unsaved changes. `ctrl+s` saves; `esc` closes, and asks
  *Save and close / Discard changes / Keep editing* when the buffer is dirty.
  Closing the overlay any other way (clicking outside it) keeps a dirty buffer,
  and opening the file again brings it back.
- **Binary files.** Double-clicking a binary dispatches a configurable keymap
  command, by default the `fileviewer.view` command from
  [`opencode-file-viewer`](https://github.com/eddy-lau/opencode-file-viewer).
  When that command is absent, the configured fallbacks apply.
- **Git colours.** File names are coloured by git state in the JetBrains style
  by default (modified blue, untracked red-brown, added green, deleted grey and
  struck through, conflicts red, ignored olive); set `git.palette` to `vscode`
  for VS Code's colours (modified amber, untracked and added green). Staged-only
  changes are bold. Folders take the most severe state of anything below them.
  Files changed by commits that are not pushed yet are marked `↑`, and the
  header shows the branch with its ahead/behind counts.
- **Presentation.** Other colours come from the active OpenCode theme;
  directories get folder icons and files get icons by name or extension.

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
icon style, git colouring and palette, the unpushed marker, whether the sidebar
section starts collapsed, the default editor provider and the binary viewer
command.
Each change is written straight back to the file, atomically, and the browser
reloads the affected trees. The dialog edits a subset of the file; the rest is
hand-edited as JSON.

```json
{
  "$schema": "./filebrowser.schema.json",
  "root": { "mode": "session", "allowAbove": false },
  "icons": { "style": "nerdfont" },
  "git": { "palette": "jetbrains", "showUnpushed": true },
  "sidebar": { "collapsedByDefault": false, "maxRows": 20 },
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
`alt+g` destinations and agent reveals outside it — are refused.

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

The browser never binds plain keys, so `enter`, `backspace`, the arrows and
letters always reach the prompt. Its shortcuts are `alt` chords that OpenCode
leaves unbound, and they only exist while focus is inside the browser: click
the tree (or run **Focus the file browser**) to use them, click the prompt to
leave. On macOS the terminal must send Option as Meta/Alt (iTerm2: *Profiles →
Keys → Left Option key: Esc+*; Terminal.app: *Use Option as Meta key*; kitty and
WezTerm do this by default).

| Key | Action |
| --- | --- |
| `alt+j` / `alt+k` | Move the selection down / up |
| `alt+l` / `alt+o` | Expand a directory, or open a file |
| `alt+h` | Collapse a directory, or go to the parent |
| `alt+u` | Go to the parent directory |
| `alt+g` | Go to a directory by path |
| `alt+n` | New file in the current directory |
| `alt+c` / `alt+v` | Copy the selection / paste |
| `alt+t` / `alt+w` | New browser tab / close browser tab |
| `alt+]` / `alt+[` | Next / previous browser tab |
| `alt+p` | Toggle the side panel |
| `alt+r` | Refresh the tree |

In the editor overlay:

| Key | Action |
| --- | --- |
| `ctrl+s` | Save |
| `esc` | Close (asks first when there are unsaved changes) |

Palette commands are always available: **Open file browser panel**, **Focus the
file browser**, **Collapse or expand the file browser** and **File browser
settings**.

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
