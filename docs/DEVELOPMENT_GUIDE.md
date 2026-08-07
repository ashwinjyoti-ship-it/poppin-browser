# Poppin Browser Development Guide

This guide is the technical and feature handoff for contributors, Cursor, and new Codex sessions. It explains the current implementation; [POPPIN_MVP_ROADMAP.md](../POPPIN_MVP_ROADMAP.md) remains the source of truth for product scope and future decisions.

## Product in one sentence

Poppin Browser is a calm, macOS-first browser that keeps browsing central while letting a user explicitly select context, run one reviewed Work or Code task through the local Codex app-server, inspect results in the browser, and approve consequential actions.

The intended flow is:

> Browse → Select Context → Ask → Watch Controlled Work → Review in Browser → Approve, Revise, or Deliver

It is not a general chat app or IDE. The centre browser is always the primary surface.

## What exists today

| Area | Current behavior |
| --- | --- |
| Normal browsing | Sandboxed Chromium `WebContentsView` tabs, address/search, back/forward/reload, persistent session, native edit/page/tab menus, default-browser protocol registration, fullscreen, and stable favicons. |
| Tab organization | Reorder, pin, duplicate, reopen closed tabs, named and color-coded groups, persistent settings, contiguous group ordering, colored group underlines, named/countable collapsed groups, direct rename, and group color selection. |
| Workspace/context | One workspace; selected tabs and documents; exact frozen context preview; optional localhost visual selection capture; connected project metadata. |
| Tasks | One active Work or Code task via the installed Codex app-server and the user’s existing account. Work does not require Git; Code requires a connected clean Git project. |
| Controlled browsing | Visible, task-scoped navigation/read/click/type/scroll/search/transcript capture in approved tabs only, with pause, takeover, action logs, and approval gates. |
| Results and delivery | Trusted centre-browser result page, copy/save/export/revise/approve actions, localhost preview, code diff, and reviewed Git/GitHub preparation actions. |

## Deliberate product constraints

- One workspace and one active task.
- The prompt bar is the only task-entry surface; do not build a separate chat transcript.
- Context is explicit: no hidden history, page metadata, or automatically collected inputs are sent to Codex.
- Work and Code are capability sets, not rigid templates.
- Consequential actions require a visible approval. This includes authentication boundaries, external form submission, downloads/uploads, external writes, Git push/PR/merge, and destructive actions.
- Poppin is local-first. Structured workspace/task metadata is local; user files and repositories stay in their original locations.
- Do not implement future ideas merely because they appear useful. Get explicit approval or a roadmap update first.

## Architecture

```text
React renderer (src/renderer)
        │ narrow, typed contextBridge APIs
        ▼
Preload bridge (src/preload/index.ts)
        │ typed IPC commands and snapshots in src/shared
        ▼
Electron main process (src/main/index.ts)
        ├── BrowserEngine ── sandboxed WebContentsView tabs + JSON browser state
        ├── WorkspaceEngine ── SQLite workspace/context/project metadata
        ├── TaskEngine ── active task, approvals, result/review/delivery state
        ├── BrowserAgentEngine ── visible, task-scoped browser actions
        ├── CodexAppServer ── local installed Codex app-server JSON-RPC process
        ├── GitEngine / GitHubEngine ── argument-safe local Git and reviewed delivery
        └── PreviewEngine ── local project preview lifecycle
```

### Process boundaries

- `src/renderer/` is React UI only. It reads snapshots and sends typed commands; it does not gain filesystem, shell, Node, or Electron access.
- `src/preload/index.ts` is the only renderer bridge. It exposes `window.poppinBrowser`, `window.poppinWorkspace`, `window.poppinTask`, and `window.poppinBrowserAgent`.
- `src/shared/` defines all IPC channels, snapshots, and command unions. Change this layer first when adding a cross-process capability.
- `src/main/index.ts` wires engines, validates that IPC comes from the trusted shell `WebContents`, installs permission handlers, registers the internal `poppin://` scheme, and owns application lifecycle.
- Normal websites run in sandboxed `WebContentsView` instances with Node integration disabled and no privileged bridge. Never weaken this boundary.

### Ownership map

| Path | Owns |
| --- | --- |
| `src/main/browser/browser-engine.ts` | tab lifecycle, navigation, tab grouping/order, browser settings, view layout, favicon state, and persistence scheduling |
| `src/main/browser/internal-pages.ts` | trusted `poppin://` pages, including the current task result page |
| `src/main/browser/permissions.ts` | browser permission allowlist |
| `src/main/browser/browser-agent-engine.ts` | tab-scoped controlled browsing, approval gates, logs, pause/takeover/teardown |
| `src/main/workspace/workspace-engine.ts` | workspace, documents, captured tab context, project connection, and visual selection |
| `src/main/task/task-engine.ts` | Codex task lifecycle, requests, approvals, result/revision/review, and delivery flow |
| `src/main/codex/` | detection and JSON-RPC client for the locally installed Codex app-server |
| `src/main/project/` | Git, GitHub, and preview engine boundaries |
| `src/renderer/ui/App.tsx` | shell composition, pane state/layout, snapshot subscriptions, and command routing |
| `src/renderer/ui/TabStrip.tsx` | tab and group interaction UI |
| `src/renderer/ui/WorkspacePane.tsx` | left-pane workspace UI |
| `src/renderer/ui/ContextPane.tsx` | right-pane Context, Task/Approval, and Result UI |
| `src/renderer/ui/CommandBar.tsx` | bottom task-entry and preflight UI |
| `src/renderer/styles.css` | Poppin visual tokens, responsive browser chrome, pane and tab styling |

## State and persistence

| Data | Storage | Notes |
| --- | --- | --- |
| Browser tabs, groups, settings, active tab, window geometry | versioned JSON through `BrowserStateStore` | Current persisted format is version 2; migrations must preserve tabs safely. |
| Workspace, documents, selected context, project metadata, task state | SQLite through `WorkspaceStore` and `TaskStore` | Stored under Electron user data. |
| Browser cookies and login session | Electron partition `persist:poppin-browser` | Do not import sessions from another browser/app. |
| Task exports | user-selected filesystem location | Never overwrite an attachment without explicit approval. |

## Security and approval model

These rules are non-negotiable:

- Never inspect, copy, reveal, export, store, or import passwords, passkeys, cookies, session tokens, Keychain content, Apple Passwords data, or browser authentication from another application.
- Authentication happens only in Poppin’s persistent browser partition and is performed by the user.
- Web content has no privileged Poppin API access.
- User-entered addresses are restricted to HTTP(S). Trusted internal result pages are allowlisted only for Poppin-created/restored tabs; do not open arbitrary custom schemes from the address bar.
- Browser-agent actions remain visible and allowed only in the user-approved tabs for the active task. Credential forms and consequential actions pause for approval.
- Task approvals must automatically make the right Task pane visible. Preserve the browser page and tab state while doing so.

## Key interaction details and recent regressions

- A result tab uses `poppin://task/current/result`. It must render the result; it must never fall back to an ordinary New Tab.
- A blocking task or browser approval takes precedence over the user’s collapsed/right-pane-section preference until it is resolved.
- The Settings panel belongs above a collapsed right-pane rail. It needs a stacking layer above panes when open.
- A tab group is a contiguous run. Normalizing only pinned tabs is insufficient: new tabs, drag/drop, restore, duplication, pinning, and group moves must not split a group.
- A collapsed group must retain name, count, color, expand affordance, and rename affordance. Never rely on `currentColor` for a foreground/background combination that can collapse to an invisible state.

## Development setup

Prerequisites: macOS, Node/npm, Electron-compatible system dependencies, and an installed/logged-in Codex app when testing task flows.

```bash
npm install
npm run dev
```

Useful scripts:

```bash
npm run lint
npm run typecheck
npm test
npm run package
npm run make -- --arch=arm64
npm run test:codex-live
```

The normal unit/component suite excludes `tests/smoke/**`. The live-Codex test is intentionally opt-in and can be skipped when its environment is unavailable.

## Test strategy

| Level | Location | Purpose |
| --- | --- | --- |
| Unit/model/engine | `tests/*.test.ts` | persistence, URL safety, engine behavior, permissions, task requirements, Git/GitHub, preview, visual selection |
| React component | `tests/components.test.tsx` | shell controls, panes, tabs, accessibility, and interaction states |
| Packaged Electron smoke | `tests/smoke/browser.smoke.test.ts` | launch compiled Electron app; navigation, session restore, browser isolation, fullscreen, Settings stacking, trusted result tab, and tab-group lifecycle |
| Live Codex | `tests/codex-live.test.ts` | optional installed-app-server integration |

Before handoff, run:

```bash
npm run lint
npm run typecheck
npm test
```

For browser-shell, Electron, packaging, or visual changes, use Node 22 for the packaged smoke flow:

```bash
npx --yes --package=node@22 --call='npm run package -- --arch=arm64 && ./node_modules/.bin/vitest run --config vitest.smoke.config.mts'
```

## Release workflow

Only do this when the user explicitly asks for deployment/release work.

1. Start from current `origin/main` on an `agent/<description>` branch.
2. Inspect `git status` and stage only the intended files.
3. Commit the coherent change.
4. Run the checks above.
5. Build the Apple Silicon DMG using Node 22:

   ```bash
   npx --yes --package=node@22 --call='npm run make -- --arch=arm64'
   ```

6. Replace the one stable `Poppin-Browser-arm64.dmg` in the local outputs folder atomically; do not accumulate duplicate installers.
7. Run `hdiutil verify` and record the SHA-256.
8. Push the branch, create a ready PR, verify it is mergeable with no failed/pending required checks, and merge only when the user explicitly requested merge.

## How to work on a change

1. Read `AGENTS.md`, this guide, and the relevant roadmap phase.
2. Trace the complete path: shared contract → preload → main engine → renderer → tests. Do not patch only the renderer if the behavior belongs in an engine.
3. Preserve user changes. Avoid destructive Git commands.
4. Keep changes modular and add regression coverage for reported behavior.
5. Test visually when layout, density, layering, or interaction state changes.
6. Report what was changed, what was verified, and whether anything remains local or was published.

## Paste this into a new Cursor or Codex session

```text
You are working on Poppin Browser, a macOS-first Electron + React browser for explicit-context Codex Work and Code tasks.

Before changing anything, read AGENTS.md, docs/DEVELOPMENT_GUIDE.md, and POPPIN_MVP_ROADMAP.md. The roadmap is the product source of truth; do not add scope beyond an approved phase or explicit user request.

Architecture: src/main owns Electron and reusable engines; src/shared owns typed IPC contracts; src/preload/index.ts is the only contextBridge; src/renderer is React shell only. Remote websites run in sandboxed WebContentsViews with no Node or Poppin APIs.

Preserve these invariants: browser-first centre surface, explicit inspectable context, one workspace, one active task, visible task-scoped browser automation, approval before consequential actions, and the permanent credential boundary (never access passwords/passkeys/cookies/tokens/Keychain/Apple Passwords or import sessions from other browsers).

For each change, trace shared contract → preload → engine → renderer → tests. Run npm run lint, npm run typecheck, and npm test. For Electron/browser/visual changes also run the Node 22 packaged smoke command in the development guide. Do not push, merge, or replace the stable DMG unless explicitly asked.
```
