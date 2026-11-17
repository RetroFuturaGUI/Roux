# Roux
The .bechaml config tool and RetroFuturaGUI project setup

<!-- See [Plan.md](Plan.md) for the plan. -->

## Installing Roux in VS Code

Roux isn't on the Marketplace (yet). Each version is a `.vsix` file attached to a release of this repository.

1. Download `roux-vscode-<version>.vsix` from the repository's [Releases](https://github.com/RetroFuturaGUI/Roux/releases)
2. In VS Code, open the Extensions view, click its "…" menu, choose ***Install from VSIX…*** and pick the file. Or, in a
   terminal: `code --install-extension roux-vscode-<version>.vsix`
3. Open your project's folder. ***Roux*** in the status bar, or the flame icon at the end of the editor tabs, opens the
   panel in a tab.

Since VS Code doesn't update it by itself, install a newer release the same way. VS Code 1.105 or newer is required.

## Using Roux in a web browser

Without VS Code, Roux runs as a small local server that only your computer can reach and opens in your browser. It requires [Node](https://nodejs.org) 22 or newer.

The scripts below lie in Roux's folder. Given a folder, they open that project; without one, they open the project Roux
lies in, as when Roux is a project's submodule. The first start installs and builds Roux, which takes a minute

- **Windows:** drag the project's folder onto `Roux.cmd`, or double-click it. The browser opens by itself; the window
  that stays open is Roux, and closing it stops Roux
<!-- - **macOS:** double-click `Roux.command`, which opens in Terminal, or run `./Roux.command <project folder>`. Closing that window stops Roux. -->
- **Linux:** run `./Roux.sh <project folder>`. File managers that run scripts, such as Dolphin, start it with a double-click too. GNOME Files doesn't by default
- **Anywhere:** in a terminal, `npm install` once in the `Roux` folder, then `npm run serve -- --project <project folder>`

The page's address carries a key that unlocks it, so open Roux through the started window or the printed address, not a bookmark

## Working on Roux

Needs Node 22 or newer.

```
npm install
npm run serve         builds, then opens Roux in the browser (roux serve)
npm run check -- ..   builds, then reports the errors in the .bechaml files under .. (roux check)
npm test              builds, then runs every package's tests
npm run lint
npm run watch         rebuilds on every change
```

`roux serve --no-open --port 47831` keeps the browser closed and picks the port. The address it prints carries the token
that unlocks the page. `--project <folder>` picks the project; without it, Roux opens the nearest folder up with a
`Project.bechaml`, else the nearest with a `CMakeLists.txt` (from `Roux/`, that's the project Roux is a submodule of).

Inside VS Code, until the extension exists: `npm run serve -- --vscode`, then Ctrl+Shift+P, "Simple Browser: Show", and
paste the printed address. `--vscode` lets VS Code's pages frame Roux and gives it a cookie that a frame keeps. Without
it, Simple Browser shows a refused page.

| Folder | What it is |
|---|---|
| `packages/protocol` | The JSON-RPC messages, methods and events between the UI and the core |
| `packages/core` | The core: the JSON-RPC server, the Setup checks, the .bechaml parser in `src/bechaml`, the build runner in `src/build` and the generator in `src/generate` (Project.cmake and the CMakeLists.txt regions so far) |
| `packages/ui/src` | The webview UI, plain HTML, CSS and JavaScript. It talks to the core only through `HostBridge` (`bridge.js`). Opened as a file, it is the mockup with fake data |
| `cli` | `roux check \| generate \| build \| run \| serve`; `check`, `generate` and `serve` exist so far |
| `hosts/vscode` | The VS Code extension. `npm run package` there writes the `.vsix` for a release; raise its `version` first |