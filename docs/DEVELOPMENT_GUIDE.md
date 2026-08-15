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
| Workspace/context | One workspace; selected tabs, documents, and Tandem pages; exact frozen context preview; encrypted local Memory; optional localhost visual selection capture; connected project metadata. The compact Tandem picker keeps recent pages visible, collapses larger project/page lists, and leaves Tandem as the document/database source of truth. |
| Tasks | One active Work or Code conversation via the installed Codex app-server and the user’s existing account. Its dedicated task tab retains every request and reply in the current thread; transient thinking/progress disappears when a turn finishes. “New task” explicitly closes the completed thread. Work does not require Git; Code requires a connected clean Git project. |
| Controlled browsing | Browser-use Work tasks receive task-owned Agent Tabs in the existing persistent partition: a fresh exploration tab for browser-only work, or selected-context clones plus a fresh exploration tab for mixed work. Codex uses sanitized semantic snapshots and bounded batches, with pause/takeover, per-step logs, stale-ref rejection, and exact approval gates for critical actions. |
| Results and delivery | Trusted centre-browser result page, copy/save/export/revise/approve actions, localhost preview, code diff, and reviewed Git/GitHub preparation actions. |

## Deliberate product constraints

- One workspace and one active task.
- The prompt bar is the only task-entry surface; do not build a separate chat transcript.
- Context is explicit but optional: no hidden history, page metadata, or automatically collected inputs are sent to Codex. A browser-only request starts from a fresh Agent Tab without inspecting existing user tabs.
- The prompt bar remains the single conversation entry point. A follow-up resumes the current persisted Codex thread instead of silently starting a new one; the UI still does not become a chat transcript.
- Work and Code are capability sets, not rigid templates.
- Critical actions require a visible approval. This includes authentication boundaries, final form submission, sending, publishing, downloads/uploads, purchases, destructive actions, Git push/PR/merge, and destructive external writes. Ordinary selected-tab browsing, typing, and saving a reversible draft do not add another gate.
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
        ├── TaskEngine ── active task thread, turns, approvals, result/review/delivery state
        ├── TandemEngine ── provider-selected Tandem REST capability + World URL
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
| `src/main/browser/internal-pages.ts` | trusted `poppin://` pages (new tab, navigation error) |
| `src/main/browser/permissions.ts` | browser permission allowlist |
| `src/main/browser/browser-agent-engine.ts` | tab-scoped controlled browsing, approval gates, logs, pause/takeover/teardown |
| `src/main/workspace/workspace-engine.ts` | workspace, documents, captured tab context, project connection, and visual selection |
| `src/main/task/task-engine.ts` | Codex task lifecycle, requests, approvals, result/revision/review, and delivery flow |
| `src/main/codex/` | detection and JSON-RPC client for the locally installed Codex app-server |
| `src/main/project/` | Git, GitHub, and preview engine boundaries |
| `src/renderer/ui/App.tsx` | shell composition, pane state/layout, snapshot subscriptions, and command routing |
| `src/renderer/ui/TabStrip.tsx` | tab and group interaction UI |
| `src/renderer/ui/WorkspacePane.tsx` | left-pane workspace UI |
| `src/renderer/ui/TaskTabView.tsx` | task tab's live progress/approval, Work reply, and Code review UI |
| `src/renderer/ui/MailSection.tsx` | dedicated Mail hub: https inbox, skill generator, and inspectable mailbox policies |
| `src/renderer/ui/AgentDock.tsx` | blocking approvals on any non-task surface, plus running/browser controls while an Agent Tab is active |
| `src/renderer/ui/CommandBar.tsx` | bottom task-entry and preflight UI |
| `src/renderer/styles.css` | Poppin visual tokens, responsive browser chrome, pane and tab styling |

## State and persistence

| Data | Storage | Notes |
| --- | --- | --- |
| Browser tabs, groups, settings, active tab, window geometry | versioned JSON through `BrowserStateStore` | Current persisted format is version 2; task-owned tabs carry an optional task-space ID and integration surfaces carry a typed surface marker. |
| Active Agent Tabs ownership and lifecycle | versioned JSON through `BrowserAgentStateStore` | Version 2 records browser-only/mixed mode and context/exploration roles. Interrupted work restores paused and user-controlled; automation never resumes on launch. |
| Workspace, documents, selected context, project metadata, task state, mail inbox URL and mail skills | SQLite through `WorkspaceStore` and `TaskStore` | Stored under Electron user data. Mail skills are natural-language policies; they never store passwords. |
| Browser cookies and login session | Electron partition `persist:poppin-browser` | Do not import sessions from another browser/app. |
| Task exports | user-selected filesystem location | Never overwrite an attachment without explicit approval. |

## Security and approval model

These rules are non-negotiable:

- Never inspect, copy, reveal, export, store, or import passwords, passkeys, cookies, session tokens, Keychain content, Apple Passwords data, or browser authentication from another application.
- Authentication happens only in Poppin’s persistent browser partition and is performed by the user.
- Authentication popups open as sandboxed, task-independent overlay windows that preserve the website's opener relationship. Identity-provider consent may create a nested authentication window; Poppin keeps that HTTPS/known-provider chain in the same unprivileged browser session while denying unrelated popup requests. Poppin displays a Cancel control but receives no credential-field access.
- With “Follow website; preview other sites,” ordinary same-site links navigate normally while cross-site links open in an Arc-style Peek overlay. The user can close the preview or promote it to a full tab without losing the source page.
- Browser-use Work tasks open their isolated Agent Tabs in live view immediately. Poppin follows the active task-owned tab while the user is watching; selecting a normal tab leaves live view without pausing Codex, and “Agent Tabs” returns to the current live page. The task's dedicated tab (grouped with its Agent Tabs) shows live progress while the turn runs and switches to the reply/review once it completes. Agent Tabs and the reply/review tab dock in a separate cluster to the right of ordinary browsing tabs (`TabStrip.tsx`'s `.tab-strip-agent`), tinted amber (`.tab-agent`) as a distinct, always-visible zone rather than interleaving with ordinary tabs.
- Web content has no privileged Poppin API access.
- User-entered addresses are restricted to HTTP(S). Do not open arbitrary custom schemes from the address bar.
- Explicitly asking for browser use grants ordinary visible actions inside that task's Agent Tabs. Selected tabs, documents, or visual selections provide explicit grounding for mixed work; a browser-only task receives only a fresh exploration tab. Credential forms and critical actions pause for exact approval; reversible draft creation and saving do not.
- Task approvals must remain reachable regardless of which tab is active: a new blocking approval or question switches to the task's tab once, and a temporary dock remains available if the user returns to another tab. Passive running/completion status must not reserve viewport space on ordinary websites or Tandem World.

## Key interaction details and recent regressions

- Every task has a stable document identity independent of its replaceable Codex thread ID. Each follow-up appends a user/reply turn to the same dedicated task tab. Live thinking/progress appears only on the running turn; completed turns remain readable until the user chooses **New task**, which ends and clears that current task thread. Task output is not persisted as a cross-task document.
- The Reply/Review tab remains visible for the lifetime of the current task and carries an accessible running, attention, completed, failed, or cancelled state icon. The bottom agent dock is surface-aware: non-blocking status and Agent Tab cleanup controls appear only while an Agent Tab is active; terminal task state never shrinks a manual website or Tandem viewport.
- Tandem is reached through the narrow `TandemProvider` boundary. The current provider hosts the remote app in a sandboxed, closable `tandem-world` browser surface and supplies the REST capability used by the agent. Neither the renderer nor `BrowserEngine` constructs a Tandem URL, and remote Tandem code receives no Poppin privilege.
- Tandem address and API-key setup live in Poppin Settings. The workspace pane exposes only connection status, the World opener, and collapsible explicit-context lists; project execution settings are collapsed by default so they do not crowd out pages.
- Tandem's exact GFM renderer formats headings, links, emphasis, lists, code, and tables. Poppin sanitizes the generated HTML at the native renderer boundary; HTTP(S) links open in normal Poppin tabs.
- An ordinary Work result is complete when Codex finishes. Its Reply tab becomes available automatically, while the prompt bar immediately accepts a follow-up in the same conversation. Result approval remains a Code review gate, not a per-turn conversation gate.
- Assistant streaming is kept per Codex message item. A progress/preamble message can never be concatenated into the final document result.
- A blocking task or browser approval takes precedence over the user's current tab/section preference until it is resolved.
- A critical approval is a centered overlay in the task tab. Browser-use Work tasks start directly; do not reintroduce a generic browser-access confirmation.
- Poppin Mail is a dedicated chrome hub between the logo and Back. The user saves an https webmail URL and natural-language mail skills. Open inbox starts Agent Tabs on that webmail (sign-in stays in the persistent browser partition). Enabled skills are ingested automatically into the next command-bar Work turn; the user does not restate them. After sign-in, only Send, Delete, and authentication pause; folder/message clicks, search, compose, typing, and reversible drafts proceed. A new `startTask` auto-reuses only a live mail inbox session (Open Inbox continuity). Mailbox work may only clone tabs whose URL origin matches the saved inbox. Semantic snapshots expose named Outlook folder/message roles (`treeitem`, `row`, `gridcell`) as clickable refs. If mail policy or the router says the turn needs the browser, `POPPIN ENVIRONMENT.browser.mode` is `exploration` or `selected-tab`; provisioning failure uses `EXPLICIT_BROWSER_REQUEST_NOT_PROVISIONED` instead of a dishonest `context_only` block. Ask only in the command bar — do not add mail prompt chips.
- Codex receives browser operations as task-scoped dynamic tools. Page reads return sanitized AX/DOM semantic snapshots with generation-scoped refs; raw CDP and arbitrary page JavaScript are never exposed. Batches use a reviewed action vocabulary, stop at control/approval/staleness boundaries, and must end with read or assert verification.
- Every Work thread registers dormant browser dynamic tools so a later browser-required follow-up can reuse the same persisted Codex conversation. Because Codex currently accepts dynamic tools only on `thread/start`, a browser-required continuation after an app-server restart transparently starts a replacement tool-enabled thread and injects the resumed user/assistant message history before the new turn; stale historical Agent Tabs identifiers are removed. TaskEngine activates tools only after creating current task-owned Agent Tabs, persists the browser requirement and run state, and refuses to complete a browser-required turn until a meaningful browser action succeeds. A zero-action completion retries once with an explicit browser instruction; a second zero-action completion remains failed/incomplete with its task tabs retained.
- Mixed Agent Tabs contain URL-seeded copies of explicitly selected tabs plus one fresh exploration tab; browser-only Agent Tabs contain only the fresh exploration tab. The active task may create and close additional exploration tabs through the narrow task-space contract, capped at six. Source tabs are not moved or operated. Agent-controlled tabs are muted and repeatedly pause media starts; discovery work prefers sanitized structured metadata over opening candidates. Successful completion retains Agent Tabs so a follow-up can resume the same space; `finishTask` / Stop still close them unless the user chose Keep. A `continueTask` follow-up reuses any still-open Agent Tabs instead of calling `start()` again; a brand-new research `startTask` opens a fresh space. Native-page follow-ups do not inherit unrelated Agent Tabs. Watching any Agent Tab collapses workspace + Poppin Pad so the page gets a usable desktop viewport. Ordinary clicks are gated by the control’s own name, not form/href soup; leftover Sign-in chrome pauses only when the page URL is actually auth. Non-mail critical names (Send, Delete, Submit, Purchase/Buy/Pay, Publish, Download, Upload, Merge / Create PR) still pause. If an ordinary human tab is already past login for a site the agent needs, Poppin clones that URL into the task space and skips a second auth pause — Agent Tabs share `persist:poppin-browser`, so cookies are never copied or inspected. Stopped, failed, takeover, and explicitly kept collections remain inspectable.
- Settings is a trusted, non-modal child surface with its own narrow preload. It overlays native website/Tandem `WebContentsView` content without changing page bounds, closes on X, Escape, or focus loss, and never exposes Poppin APIs to the remote page below it.
- Link-opening settings are stored synchronously in the browser engine and enforced both for website-created windows and future page clicks. Changing the setting never fails because an already-loaded page rejects script execution; the active policy is applied when each page becomes ready.
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
| Packaged Electron smoke | `tests/smoke/browser.smoke.test.ts` | launch compiled Electron app; navigation, session restore, browser isolation, fullscreen, Settings stacking, and tab-group lifecycle |
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
5. Build the requested Apple Silicon and Intel DMGs using Node 22:

   ```bash
   npx --yes --package=node@22 --call='npm run make -- --arch=arm64'
   npx --yes --package=node@22 --call='npm run make -- --arch=x64'
   ```

6. Verify both packaged app bundles and DMGs before publication.
7. Push the branch, create a ready PR, verify it is mergeable with no failed/pending required checks, and merge only when the user explicitly requested merge.
8. After merge, atomically replace the stable local installers with `npm run update:dmg:all` (or `npm run update:dmg` for the host arch). That overwrites `DMG/Poppin-Browser-arm64.dmg` and `DMG/Poppin-Browser-x64.dmg` only — keep one installer per architecture and do not accumulate versioned duplicates.
9. Confirm the script's `hdiutil verify` + SHA-256 output for both stable installers.

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

Preserve these invariants: browser-first centre surface, explicit inspectable context, one workspace, one active task, visible task-scoped browser automation, exact approval before critical or irreversible actions, and the permanent credential boundary (never access passwords/passkeys/cookies/tokens/Keychain/Apple Passwords or import sessions from other browsers).

For each change, trace shared contract → preload → engine → renderer → tests. Run npm run lint, npm run typecheck, and npm test. For Electron/browser/visual changes also run the Node 22 packaged smoke command in the development guide. Do not push, merge, or replace the stable DMG unless explicitly asked.
```
