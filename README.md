# Roux
The .bechaml config tool and RetroFuturaGUI project setup

<!-- See [Plan.md](Plan.md) for the plan. -->

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
