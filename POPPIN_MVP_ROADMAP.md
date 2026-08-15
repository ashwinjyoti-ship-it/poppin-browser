# Poppin Browser MVP — Living Roadmap

## Purpose

Poppin Browser validates one workflow:

> Browse → Select Context → Ask → Watch Controlled Work → Review in Browser → Approve, Revise, or Deliver

This is a browser first—not an IDE and not another AI chat. Intelligence should disappear behind normal browsing until the user deliberately invokes it.

This roadmap is living guidance, not pre-authorization to implement every phase. Phase 1 must be used in daily work before Phase 2 is planned. Observed needs may revise, reorder, reduce, or replace every later phase.

## Permanent Product Invariants

- The centre browser is always the hero and can occupy the complete window.
- Poppin remains browser-first and must not become a general chat application. The existing prompt box is the single entry point for arbitrary Work and Code requests.
- UI remains thin; reusable engines own browser, workspace, context, project, selection, task, provider, and preview behavior.
- Context is explicit and inspectable. Nothing hidden is sent to a provider.
- The MVP supports one workspace and one active task.
- Browser actions stay visible, provider actions stay reviewable, and task-scoped permissions end with the task.
- Work tasks do not require a Git project. Code tasks retain the clean-Git, connected-project, review, and one-task safeguards.
- The product is local first. SQLite stores structured metadata; large content remains on disk.
- Coding previews remain inside the browser.
- Substantial task results and generated-artifact previews belong in trusted, sandboxed centre-browser tabs.
- Provider actions require explicit review through approve or revise.
- Poppin never accesses, scrapes, copies, reveals, exports, or stores passwords, passkeys, cookies, authenticated-session tokens, Apple Passwords data, or Keychain credentials, and never imports authentication from another browser or application.
- A feature that does not improve the core workflow does not belong in the MVP.
- The current v0.1 brief overrides older architecture notes where they conflict, including the earlier five-workspace and archive concepts.

## Phase 1 — Persistent Browser Foundation

**Status:** Completed and approved through hands-on browsing, YouTube playback, and Google sign-in on 2026-08-06.

**Outcome:** Browse normally in a calm Poppin shell.

- Real Chromium tabs with new, activate, and close behavior.
- Address/search bar using DuckDuckGo for plain-text searches.
- Back, forward, and refresh.
- Persistent cookies, logins, tabs, active tab, and window state.
- Sandboxed remote pages with no Node or privileged Poppin APIs.
- No workspace, context, project, Codex, task, selection, preview, or command-bar features.

Verification includes unit/component coverage, a packaged application build, a live Chromium smoke flow, relaunch restoration, renderer-isolation checks, and visual screenshots in `docs/screenshots/`.

**Gate:** Use the browser in real work. Record friction, missing browser fundamentals, and any assumptions that proved wrong before designing Phase 2.

## Phase 2 — One Workspace

**Status:** Completed in Checkpoint A on 2026-08-06.

**Provisional outcome:** Create and use exactly one workspace that groups browser content.

The workspace contains tabs, documents, a project connection, and tasks. It has no archive flow, workspace limit, switching system, collaboration, or cloud sync. Workspace behavior must be an engine surfaced through a collapsible left pane without diminishing full-focus browsing.

## Phase 3 — Explicit Context

**Status:** Completed in Checkpoint A on 2026-08-06.

**Provisional outcome:** Check workspace tabs and documents and see the exact context package that would be sent.

Every eligible item has an explicit checkbox. The right pane mirrors the serialized selection with no implicit page, history, hidden metadata, or automatic expansion.

## Phase 4 — Local Project Connection

**Status:** Completed in Checkpoint A on 2026-08-06.

**Provisional outcome:** Attach the one workspace to a usable local Git project.

Support connecting an existing directory, cloning a repository, or creating a new project. Store repository path, remote, branch, install command, development command, and preview URL. Git behavior lives behind a reusable engine and uses the Git CLI.

## Phase 5 — Codex Command Bar

**Status:** Implemented in Checkpoint B; awaiting hands-on approval.

**Provisional outcome:** Submit one explicit prompt with visible provider settings and selected context.

The collapsible bottom bar exposes Codex as the only provider plus explicit model, reasoning, prompt, and send controls. It does not become a chat surface and does not route models automatically.

## Phase 6 — One Task

**Status:** Implemented in Checkpoint B; awaiting hands-on approval.

**Provisional outcome:** Follow and control one provider task from submission through review.

Supported states are Running, Needs Approval, Completed, Failed, Cancelled, and Discarded. The right pane shows progress, approvals, result, and diff. Revision continues the active workflow rather than creating a parallel chat history.

## Phase 7 — Unified Work, Visual Selection, and Controlled Browser Use

**Status:** Implemented and release-verified on 2026-08-07. Do not expand beyond this scope.

**Outcome:** The existing prompt box accepts arbitrary work. Poppin determines required capabilities without forcing the user through a workflow wizard, while keeping context and permissions explicit.

### Unified tasks and preflight

Poppin supports two internal task capability sets through the same prompt:

- A **Work task** does not require a Git project. It uses selected tabs and attached documents to create summaries, research, comparisons, structured notes, tables, checklists, drafts, reports, Markdown, and generated files. It may use controlled browser interaction only when explicitly granted.
- A **Code task** uses the connected local project and preserves the clean-Git and one-task safeguards. It can inspect localhost UI, modify code, run checks, launch a preview, show a diff, revise, and prepare GitHub delivery.

These are capability sets, not hard-coded workflow templates. Requests such as summarizing a selected YouTube video, comparing two selected documents, researching with approved tabs, turning a transcript into notes, drafting a sourced report, and fixing a connected-project UI for a pull request are acceptance scenarios.

Before execution, Poppin shows a concise preflight only when useful, such as before a Code task that can modify a local project. Explicitly requested browser-use Work tasks start directly with their selected tabs; Poppin defers any approval until an exact critical action is attempted. Benign tasks remain simple and do not gain unnecessary confirmations.

### Visual selection

The user can select an element in a localhost application. Poppin captures its HTML, relevant CSS, DOM context, screenshot, and bounding box and shows the captured target in the explicit context package before submission.

### Controlled browser use

Controlled browser use is visible task-scoped page operation, not unrestricted computer control.

Selecting a tab as context and explicitly requesting browser use grants ordinary navigation, reading, clicking, typing, waiting, scrolling, searching, and reversible draft saving within that task. These actions do not each require another confirmation. Codex receives them through Poppin-owned dynamic tools, must use selectors returned by the current visible page read, and must verify page state before reporting completion.

- Codex may navigate, click, type, scroll, search, and read rendered content only within the selected Poppin tab or additional user-approved tabs.
- `BrowserAgentEngine` uses the existing `BrowserEngine` tab model. It must not create a hidden browser, second profile, second workspace, or parallel task.
- The centre browser stays visible. Poppin shows the current action and an append-only action log.
- Start, Pause, Resume, Stop, and Take Over controls remain available. Take Over immediately pauses Codex; only explicit Resume restarts it.
- Tab access is revoked when the task ends. Poppin never silently switches to an unrelated tab.
- Web content receives no privileged Electron, Node, or Poppin API access.

Poppin pauses before sign-in/authentication, password/passkey/biometric/credential prompts, final form submission, sending messages or email, publishing, downloads, uploads, purchases/payments, deletion, permission prompts, destructive external writes, pushing branches, creating or merging pull requests, or another critical or irreversible action. Creating and saving a reversible unsent draft is not gated. Login pages may be opened, but the user performs credential entry. Codex does not inspect credential fields, cookies, session tokens, Apple Passwords, or Keychain. Authentication stays inside Poppin's persistent browser partition.

### YouTube transcript-summary acceptance flow

For a request such as “Give me a five-point summary”, the user selects a YouTube tab, reviews Poppin's request to use that tab and read its transcript, and grants access. Codex visibly opens or reads captions/transcript exposed by the approved page and creates a timestamped summary in the native task document. No Git project is required. The user may revise, copy, save, or export it. Poppin must not silently download or transcribe protected media.

### Architecture and verification

`BrowserAgentEngine` is a reusable main-process engine behind a narrow IPC contract. It owns lifecycle, tab scope, action validation, approval gates, logging, and teardown. Verification includes unit coverage for tab scope, pause/stop/takeover, approval gates, and credential-boundary rejection; integration coverage proving that unapproved tabs and privileged APIs are inaccessible; and a localhost fixture covering visual selection, navigation, typing, click, approval, takeover, and teardown. Hands-on local-site testing precedes general web use.

## Phase 8 — Native Tandem Results, Preview, Review, and Delivery

**Status:** Implemented and release-verified on 2026-08-07. Do not expand beyond this scope.

**Outcome:** Substantial Work and Code output is reviewed in a native Tandem Page, with compact controls and metadata in the right pane. Browser preview remains available for localhost Code work.

### Persistent task documents

- Append each completed turn to one native Page keyed by a stable task-document identity, not by a replaceable Codex thread ID.
- Revisions and follow-ups update the same conversation document instead of creating duplicates, and the result persists in `poppin.sqlite`.
- Render GFM through Tandem's exact Markdown implementation, sanitize the HTML, and open source links as additional Poppin tabs.
- Supported presentations include timestamped video summaries, research briefs with source links, document summaries, comparisons, structured tables, checklists and action items, drafts and reports, Markdown, generated-document previews, test reports, localhost previews, and pull-request summaries.
- Actions include Approve, Revise in the same active task, Copy, Save, Export, Open Sources, and Open Generated Files. Never overwrite an original attachment without explicit approval; prefer a new previewable output artifact.

### Coding preview and review

Launch the configured local preview in the centre browser and show code diff and task controls in the right pane. The browser remains the primary work and review surface. Approval or revision continues the same task; acceptance may proceed to separately reviewed commit, push, and pull-request preparation.

### Automatic task and approval attention

Whenever Codex needs approval, a decision, clarification, permission, or recovery action, Poppin automatically expands the right pane if collapsed, switches it to the relevant Task/Approval section, scrolls the pending card into view, identifies what is blocking progress, and shows the exact action, target, scope, consequence, and Approve/Reject/alternative controls. Badges and task status update immediately. The centre tab and page state are preserved, task state advances automatically after resolution, and the pane is not automatically collapsed afterward.

This applies to critical browser actions, filesystem/network permission, artifact overwrite, push/PR/merge, blocking clarification, and task failure requiring recovery. The single active task exposes only its one currently required approval.

### GitHub pull-request delivery

- A completed Code task may prepare a branch and commits after showing the final diff and test results.
- An explicit Create Pull Request action shows repository, remote, branch, commits, and target base branch before delivery.
- Pushing and creating a pull request are distinct external actions and each requires approval.
- A reusable engine uses argument-safe Git and the authenticated GitHub CLI without reading or displaying tokens.
- If GitHub CLI authentication is unavailable, open the GitHub compare/PR page in Poppin for manual completion.
- After creation, open the PR URL in a new Poppin tab and show PR number, URL, base/head branches, and current checks. Read-only checks and review monitoring are allowed.

### Separately approved merge

Merge is never implied by code approval or PR creation. A separate Merge action displays repository, PR number, base branch, checks, review status, and allowed merge strategy. Poppin supports merge, squash, or rebase only when repository policy permits, respects protection and required checks/reviews, and requires final confirmation immediately before merging. If merge is unavailable, open the PR for manual completion. After a successful merge, a separate Update local folder action checks out the PR base branch and fast-forwards it from the remote; that local update also requires its own explicit approval and refuses a dirty working tree.

### Surface responsibilities

The right pane owns exact Context; Task/Approval state, current browser action, append-only log, controls, and pending approval; compact Result metadata, sources, and artifact actions; and Code diff/review controls. It is not a chat transcript.

The centre browser owns browsing, controlled browser operation, localhost preview, visual selection, rich task results, generated-artifact previews, GitHub PR pages, and source pages.

### Fullscreen-aware logo and compact layout

When macOS traffic lights are absent, place the Poppin logo near the top-left. In an ordinary window retain only the minimum safe traffic-light inset. Preserve the draggable titlebar, compact responsive chrome, and maximum practical viewport on a 13-inch MacBook Air. Add visual or integration coverage for windowed and fullscreen positioning.

### Delivery verification

Keep changes modular and the app runnable after each coherent increment. Add unit, component, integration, packaged-smoke, and hands-on coverage proportional to each capability. Preserve all completed browser, pane, session, favicon, fullscreen, default-browser, workspace, context, project, Codex, approval, progress, result, revision, and diff behavior.

The final Apple Silicon build uses Node 22 where required. Rebuild and `hdiutil`-verify the single stable `Poppin-Browser-arm64.dmg`, replacing the existing installer without accumulating duplicates.

## Phase 9 — Browser Fundamentals and Tab Organization

**Status:** Implemented and release-verified on 2026-08-07.

**Outcome:** Daily browsing receives the missing native editing, organization, and preference controls without diminishing the centre browser.

- The tab strip uses roughly 40% less vertical space and narrower tab containers while preserving readable labels, favicons, pinned-tab targets, and full-title tooltips. Roomy, compact, and dense layouts return 22–29 pixels of height to the page viewport.
- Favicons retain the last valid icon during same-site loading, cache valid candidates per origin, try site-provided alternatives before falling back, and use consistent globe and page-failure states rather than a broken-image placeholder.
- Native context menus cover editable fields, selected text, links, general page navigation, tabs, and tab groups. Standard undo, redo, cut, copy, paste, paste-and-match-style, delete, and select-all keyboard commands remain available in remote pages and Poppin inputs.
- Tabs support drag reordering, pinning, duplication, recently closed recovery, and bulk close actions. Named/color-coded groups normalize their tabs into contiguous runs, share a visible color tint and underline, show a persistent name and tab count when collapsed, expose direct rename and collapse controls, and offer persistent color choices from the group menu. Version-one sessions migrate automatically to the version-two tab/group/settings state.
- A top-bar Settings panel controls website link disposition, new-tab focus and placement, startup restoration, multiple-tab close warnings, and DuckDuckGo or Google address-bar search.
- The temporary Google sign-in helper is removed; authentication remains entirely within Poppin's persistent browser session and under the permanent credential boundary.

## Phase 10 — Task-Owned Agent Tabs

**Status:** Implemented and dual-architecture release-verified on 2026-08-08; awaiting hands-on approval.

**Outcome:** Work tasks support three explicit execution topologies. Context-only work uses its frozen selected context without browser tools. Browser-only work receives one fresh task-owned exploration tab and never inspects existing user tabs. Mixed work receives URL-seeded clones of explicitly selected tabs plus one fresh exploration tab, while selected documents and visual selections stay in the frozen context package. Source tabs are never moved, closed, navigated, or operated. Agent Tabs reuse `persist:poppin-browser` without inspecting or copying cookies or credentials, remain out of the normal tab strip unless the user chooses Watch, and support only the single active task.

The task space records its task, owner, status, mode, context/exploration tab roles, active tab, and timestamps. Agent control, waiting for approval, user control, pause, completion, and failure/stopped states are explicit. Take Over is a hard stop: queued work cannot continue and only an explicit Resume agent action returns control. Login, captcha, credential, and unusual manual interactions require takeover. A restored task space is always paused and user-controlled; it never resumes automation on launch.

The right Task pane exposes Watch, Pause, Resume agent, Take over, Stop, Keep tabs, and Close task tabs as applicable. Completion defaults to closing task tabs; keeping them is an explicit user choice. Keeping preserves the visible Agent Tabs collection without converting it into ordinary context or granting a future task access.

**Acceptance:** browser-only work can research with no selected tab; mixed work keeps context clones separate from its fresh exploration tab; context-only work receives no browser tools; all substantial output still reaches the trusted Result page; user tabs remain unchanged; every action is rejected outside the active task-space ID and its tab IDs; takeover prevents the next queued action; resume is explicit; cleanup is predictable; restore cannot auto-run; one workspace and one active task remain unchanged.

## Phase 11 — Semantic Snapshot V2

**Status:** Implemented and packaged-smoke-verified on 2026-08-07; awaiting hands-on approval.

**Outcome:** `BrowserAgentEngine` exposes a compact semantic snapshot built through a Poppin-owned CDP boundary using the accessibility tree and safe DOM geometry where Chromium provides it. Snapshot nodes contain a short ref, role, accessible name, safe state/actionability, frame identity, optional bounds, and conservative locator hints. Password and credential values, cookies, tokens, hidden secrets, arbitrary DOM, and raw CDP never cross the boundary.

References are bound to task space, tab, document/navigation generation, and snapshot ID. Any new navigation or snapshot invalidates earlier references, and a mutation-sensitive action requires a fresh read before further ref-based work. Cross-frame nodes are included only when Chromium safely exposes them.

**Acceptance:** common controls receive usable refs; credential fields are identified only to request takeover; stale/cross-task refs fail safely; dynamic pages can be re-read reliably; remote-page isolation is unchanged.

## Phase 12 — Safe Batched Browser Actions

**Status:** Implemented and packaged-smoke-verified on 2026-08-07; awaiting hands-on approval.

**Outcome:** Codex receives one bounded declarative batch tool supporting reviewed click, fill, wait, read, and assert steps. Each step validates task space, ownership, tab, snapshot, and ref; is logged individually; and stops on navigation, mutation/staleness, pause, takeover, approval, failure, or assertion failure. No arbitrary JavaScript, eval, raw CDP, upload/download, or unrestricted script surface is exposed.

Critical steps stop exactly before execution and use the existing sticky approval. Approval resumes only that continuation; rejection guarantees the step is not executed. Reversible unsent draft saving remains ordinary work. Completion still requires a page-state verification read or assertion.

**Acceptance:** a draft workflow can act and verify with fewer tool rounds; Send pauses at the final click; rejection prevents Send; partial batches are interruptible; every executed and skipped step is inspectable.

## Phase 13 — Transparent Site Recipes

**Status:** Implemented for explicit save-from-success (user-requested 2026-08-11). Recipes remain inspectable, disableable, and deletable; creation always asks first; credential-looking steps are never stored.

**Outcome:** Successful verified workflows may be offered as local, visible, parameterized recipes. Creation always asks first. Recipes are inspectable, editable, disableable, and deletable; fail closed when stale; and retain the same semantic validation and critical-action approvals. They never store credentials, authentication state, cookies, tokens, private message values, or private templates unless the user explicitly asks to save that template.

Initial candidates are an unsent Gmail draft, a timestamped YouTube transcript summary, and approved-source research. No parallel tasks or multi-agent spaces are added.

## Phase 14 — Profile Login & Partial Continuity

**Status:** Implemented (2026-08-11). Local profile + passphrase-sealed continuity packages. Does not authorize always-on cloud sync or a Poppin auth server.

**Outcome:** A shared DMG stays independently usable on each Mac. The same person can move tabs, workspace selections, recipes, and browser settings between office and home without moving site logins or live agent state.

### Locked decisions

**Sync substrate — encrypted continuity packages (export/import), not always-on sync.**
- Continuity is an explicit **Export continuity** / **Import continuity** flow that writes or reads a passphrase-sealed `.poppin-continuity` file.
- The user may keep that file in iCloud Drive, AirDrop it, or copy it manually. Poppin does not run a sync daemon, CloudKit client, or custom sync backend in this phase.
- Import is confirm-gated and last-write-wins for the imported subset; it never merges cookies or credentials.
- Sharing a DMG with another person remains independent by default: each install keeps its own Electron `userData`. Their blank install cannot open someone else's package without that person's passphrase.

**Identity — local profile + passphrase, not email/password, magic link, or Apple ID.**
- Single-machine use needs no profile (current behavior unchanged).
- Continuity export/import requires a **local Poppin profile** (display name) and a **passphrase** that seals and opens packages. This is user separation and package binding, not security theater against a determined attacker with disk access.
- No Poppin account server, OAuth, magic link, or Sign in with Apple in this phase.
- Settings exposes profile create/switch/rename and Export/Import continuity. Switching profile scopes local state directories; it does not create a second workspace or parallel active task inside one profile.

**Partial payload — what follows vs what stays local.**

Included in a continuity package (versioned JSON inside the sealed file):

| Source | Fields |
| --- | --- |
| `browser-state.json` | Ordinary tabs: `url`, `pinned`, `groupId` (new ids on import). Groups: `name`, `color`, `collapsed`. `activeTabId` remapped after import. All `BrowserSettings` (`linkOpening`, `focusNewTabs`, `startup`, `newTabPosition`, `warnBeforeClosingMultipleTabs`, `searchEngine`). |
| Workspace SQLite | `workspace.name`. Context packs (`name`, `tabRefs` url/title, `documentIds`, `tandemPageIds`, `includeMemory`). Named browser sessions (`name`, tabs url/title/pinned). Recipes (`name`, `startUrl`, sanitized `steps`, `enabled`). Tab-context selection refs by url/title (not ephemeral tab ids). Tandem context page ids/titles only (not connection secrets). `memorySelected` boolean only. |

Excluded from every package (permanent credential / machine / live-work boundary):

- Chromium `persist:poppin-browser` cookies, cache, and site sessions
- Passwords, passkeys, tokens, Keychain, Apple Passwords, or any other browser's auth
- Sealed Tandem API key and Codex/GitHub credentials
- Encrypted Memory page bodies (`safeStorage`)
- Local Git `project.repositoryPath` and other machine paths
- Window geometry (monitor-specific)
- Agent Tabs / `browser-agent-state.json`, active task rows, visual selections, automation filmstrips
- Task-owned tabs (`taskSpaceId` set) and in-flight approvals — never auto-resume on import

Honest product copy on import: *Your work and settings follow. Website logins stay on each Mac.*

### Acceptance (when implemented)

- A second Mac can import a package and restore ordinary tabs, groups, settings, workspace name, packs, sessions, and recipes without receiving cookies or credentials.
- A different person installing the same DMG starts empty and cannot decrypt another user's package without the passphrase.
- Import never resumes Agent Tabs or an active task.
- One workspace and one active task per profile remain unchanged.
- Remote pages stay sandboxed; continuity APIs stay on the main-process / preload boundary only.

### Implementation notes

Main-process continuity engine + sealed `.poppin-continuity` format; profile-scoped data directories under `userData/profiles/<id>/`; Settings → Profile and continuity; shared typed IPC via the Settings overlay; unit tests cover payload allow/deny lists and seal/open. The Chromium `persist:poppin-browser` partition is never packaged.

## Decision Log

- **2026-08-10:** Hands-on video-research feedback makes Agent Tabs metadata-first and media-quarantined. Discovery tasks read sanitized listing/page metadata before opening candidates; finding a video never implies playing it. While the agent controls task-owned tabs, audio is muted and media starts are paused. Successful completion now closes task tabs automatically unless the user opts to keep them before completion; stopped, failed, takeover, and explicitly kept collections remain inspectable. The active task may create and close additional task-owned exploration tabs through the narrow browser contract, capped at six exploration tabs, without adding parallel tasks or agent spaces.
- **2026-08-10:** Browser viewport feedback makes Settings a true transient overlay. Opening the top-bar panel no longer adds a right layout inset or resizes the active website/Tandem surface; a dedicated trusted child surface stacks above the unchanged remote `WebContentsView` and closes on its X, Escape, or focus loss.
- **2026-08-10:** Manual-browser viewport feedback makes passive task state tab-scoped instead of global. The Reply/Review tab remains persistently visible with an accessible lifecycle indicator; completed/failed/cancelled task pills no longer reserve bottom space on websites or Tandem World. Running and cleanup controls are confined to active Agent Tabs, while genuinely blocking approvals remain temporarily reachable from other surfaces.
- **2026-08-10:** Tandem and task-thread UX feedback is approved and implemented within the existing one-workspace/one-task scope. Tandem connection details move to Poppin Settings; the workspace picker becomes compact and collapsible; Tandem World is one closable, typed browser surface backed by a real `TandemProvider` boundary rather than a renderer URL shortcut. A task tab now retains all follow-up turns, shows thinking only while the current turn runs, and uses an explicit **New task** action to end and clear the completed thread. Project execution settings collapse by default to preserve context-list space.
- **2026-08-09:** Tandem is the document and database source of truth. The visible native Pages tree and its Page/Database creation and spreadsheet-import controls are removed; encrypted local Memory remains as a dedicated workspace action. Tandem World gains labeled entry points in both the tab strip and Tandem workspace section, each opening or focusing the centre Tandem surface.
- **2026-08-06:** Phase 1 begins from the supplied v0.1 brief and design assets.
- **2026-08-06:** Later phases are explicitly provisional pending daily Phase 1 use.
- **2026-08-06:** Phase 1 uses DuckDuckGo for address-bar searches and restores cookies, tabs, active tab, and window state.
- **2026-08-06:** Phase 1 stays at the strict browser core; downloads UI, permissions UI, bookmarks, history UI, password management, and profiles are deferred.
- **2026-08-06:** Daily-use testing approves Phase 1 after successful YouTube playback and Google sign-in; a false redirect warning is fixed separately.
- **2026-08-06:** Remaining work is grouped into three manual checkpoints: A (Phases 2–4), B (Phases 5–6), and C (Phases 7–8), while each capability retains small commits.
- **2026-08-06:** Checkpoint A freezes selected tab and document content so the right pane is the exact bounded context payload; Git operations use argument-safe Git CLI execution without a shell.
- **2026-08-07:** Checkpoint B uses the locally installed Codex app-server and its existing account rather than embedding an API key. Tasks require a clean Git baseline, run inside the connected project with workspace-write sandboxing, surface approvals, and finish at an explicit approve-or-revise gate.
- **2026-08-07:** Apple Passwords remains outside the credential boundary. Electron cannot load Apple's arbitrary browser extension, and direct Keychain password access is rejected. Signed, device-bound Touch ID WebAuthn is documented as a separate future browser capability.
- **2026-08-07:** Hands-on testing adds persistent resizing for both workspace panes and a Google Accounts sign-in fallback. Poppin never imports authenticated sessions from other browsers or applications; it helps the user choose Google's alternate method and then preserves the successful login in its own browser session.
- **2026-08-07:** Laptop testing makes browser chrome responsive to usable window dimensions. Roomy, compact, and dense modes keep the native page viewport aligned while reducing logo, toolbar, and tab height on constrained screens.
- **2026-08-07:** Browser feedback adds website fullscreen support, compact tabs at every window size, and standard `http`/`https` registration so the user can choose Poppin as the macOS default browser.
- **2026-08-07:** Future Phase 7 records controlled browser use for the one active task: explicit start/pause/stop, tab-scoped actions, visible logs, user takeover, approval gates for consequential actions, and a permanent credential boundary. The roadmap is the sole source of truth for this planned work.
- **2026-08-07:** Phases 7–8 are approved for implementation. The single prompt now routes arbitrary Work and Code capabilities; Work no longer requires Git. Approved scope adds preflight, visible task-scoped browser use, localhost visual selection, trusted centre-browser results, automatic approval attention, preview/review, and separately approved GitHub delivery and merge. No work beyond Phase 8 is authorized.
- **2026-08-07:** Phases 7–8 are implemented through reusable capability boundaries and release-verified. Verification covers typecheck, zero-warning lint, 66 passing unit/component/integration tests with one expected live-Codex skip, repeated packaged browser smoke checks, a Node 22 arm64 package/DMG build, and `hdiutil` validation of the single stable installer.
- **2026-08-07:** Hands-on browser feedback approves Phase 9 fundamentals: a substantially smaller tab strip, stable favicon fallbacks, native copy/paste and page/tab context menus, reorderable pinned and grouped tabs, closed-tab recovery, and persistent top-bar browser settings. Link behavior defaults to respecting the website; close warnings remain opt-in.
- **2026-08-07:** Codex integration feedback hardens Phase 8: trusted task-result URLs are accepted only when Poppin creates or restores a tab, while address-bar entry remains restricted to HTTP(S). Blocking task and browser approvals now derive the visible right-pane state directly, guaranteeing that the pane expands on Task without depending on subscription timing.
- **2026-08-07:** Hands-on browser-use feedback narrows approval gates to exact critical actions. Selecting tabs and requesting browser use grants ordinary visible navigation/click/type and reversible draft saving; Work tasks no longer show a generic browser-use preflight. Codex browser actions are connected through task-scoped dynamic tools, critical prompts are sticky at the top of Task, and completion must be verified from page state.
- **2026-08-07:** Hands-on grouping feedback replaces ambiguous and sometimes blank group pills with explicit named/countable controls, colored contiguous tab runs, discoverable renaming, persistent group colors, and ordering normalization that prevents tabs from splitting a group.
- **2026-08-07:** Poppin-native ego-lite learnings are approved as Phases 10–13: task-owned Agent Tabs, generation-scoped semantic snapshots, bounded interruptible batches, and later transparent recipes. The implementation must use Poppin's existing Electron/Codex architecture, persistent partition, one-task rule, and credential boundary; it must not add ego-lite, arbitrary JavaScript/CDP tools, another profile, or parallel agent spaces.
- **2026-08-07:** Phases 10–12 are implemented behind the existing typed browser-agent boundary. Verification covers 80 passing unit/component/integration tests with one expected live-Codex skip plus the Node 22 arm64 packaged Electron smoke flow. Phase 13 recipes were gated on hands-on reliability feedback until the 2026-08-11 user-requested ship.
- **2026-08-08:** Browser-use Work tasks gain browser-only and mixed topologies. Browser-only starts with one fresh exploration Agent Tab and no user-tab context; mixed combines explicit frozen context and cloned context tabs with a separate fresh exploration tab; context-only remains unchanged. Every topology completes through the same trusted centre-browser Result workflow. Verification covers 82 passing unit/component/integration tests with one expected live-Codex skip, the packaged arm64 Electron smoke flow, and integrity-checked ad-hoc-signed arm64 and x64 DMG candidates.
- **2026-08-08:** Authentication and conversation feedback replaces detached OAuth tabs with a sandboxed overlay window that preserves `window.opener`, shares only Poppin's own persistent partition, and exposes a visible Cancel control. Link settings persist independently of the best-effort live refresh applied to loaded pages. Completed Work output immediately permits a bottom-bar follow-up on the same persisted Codex thread; only exact consequential operations and Code result delivery remain approval-gated.
- **2026-08-08:** “Follow website” adopts Arc-style Peek behavior: same-site links remain in context, while a clicked cross-site link opens in a compact overlay with Close and Open in Tab actions. OAuth uses the same visual layer but retains a distinct protected sign-in state and credential boundary.
- **2026-08-08:** Browser-use Work tasks enter Agent Tabs live view automatically and follow the agent's active task-owned tab. Choosing a normal tab moves the agent into background work without stopping it; Agent Tabs returns to live view, and the persistent native Tandem task document opens only when work completes. Product-comparison and price-research prompts explicitly trigger browser use.
- **2026-08-08:** Plain-language search, lookup, live price/stock, and “where can I buy” requests explicitly start browser-only Agent Tabs. Browser intent must not depend on the user adding “the web,” “website,” or a generic product noun.
- **2026-08-08:** A completed browser-enabled Work turn preserves browser capability for its Codex conversation. A terse follow-up such as “continue” creates a fresh task-owned browser space before the same thread resumes, unless the user explicitly kept the old tabs.
- **2026-08-08:** Browser-required Work persists its task-space and browser-run state and cannot become a completed Result without a successful meaningful browser action. A zero-action Codex completion retries once in the active conversation with an explicit Agent Tabs instruction; if the retry also performs no action, Poppin surfaces an incomplete failure and retains the task and tabs instead of showing a generic answer as completed. Since Codex dynamic tools are currently registered only at thread start, a browser-required continuation after app-server restart transparently rehydrates the resumed user/assistant history into a replacement tool-enabled thread while keeping one visible Poppin conversation.
- **2026-08-11:** Seven product surfaces ship (user-requested): Diff/Compare board (structured matrix from result tables); quiet automation filmstrip (optional action frames + refs); delivery story strip (commit→push→PR→merge→local); Phase 13 recipes from success (explicit save, sanitized steps, no credentials); sticky split / peek-compare; local search across open tabs; Tandem beside live page. One workspace and one active task remain unchanged. Remote pages stay sandboxed.
- **2026-08-11:** Core-loop ship (user-requested, implemented): named context packs (save/reuse checkbox sets); Memory as an opt-in working brief (Use as context + Update Memory / `saveResultToMemory`); provenance-linked Work claims → source URLs; calm Agent/You ownership chrome on Agent Tabs; Result next-action chips (Continue research / Compare / Draft / Save to Memory / Add to Tandem); single Add to Tandem on Reply for all result types; Downloads as a settings-adjacent icon+popover (no viewport shelf); named browser Sessions save/restore from the workspace pane and tab ⋯. Packs, Memory selection, and sessions persist in the workspace SQLite store; applying a pack reselects only what still exists. Core loop: packs + Memory brief → Ask → provenance Result → next action / Tandem. One workspace and one active task are unchanged.
- **2026-08-11:** Phase 14 approved as product direction, then implementation-gated and shipped: local profile + passphrase-sealed continuity packages for office↔home transfer of tabs, workspace selections, recipes, and browser settings. Explicit export/import — no always-on sync server, CloudKit, or Poppin auth backend. Credential partition, Memory bodies, Tandem API keys, project paths, window geometry, and Agent Tabs / active task state stay machine-local. Shared DMG installs remain independent via per-machine `userData`; packages will not open without the owner's passphrase.

- **2026-08-13:** User-requested Poppin Mail ships: a Mail icon between the logo and Back opens a dedicated hub for an https webmail inbox and user-defined natural-language mail skills. Login stays in `persist:poppin-browser`; skills never store credentials. Mailbox Work auto-provisions Agent Tabs for every harness; send/delete still require the existing approval overlay. The command bar remains the only task entry — no mail prompt chips.
- **2026-08-14:** Mail Open inbox starts (or reuses) Agent Tabs on the saved webmail instead of an ordinary tab. Enabled mail skills are ingested automatically into the next command-bar Work turn on that session. Sign-in remains user-performed in the persistent partition; send/delete stay approval-gated.
- **2026-08-15:** Outlook/Mail Work reuses the same task-owned inbox Agent Tab across follow-ups, including after successful completion. After sign-in, only Send, Delete, and authentication pause. Named Outlook folder/message AX roles become clickable refs, and watching a mail Agent Tab collapses workspace + Pad for a usable OWA viewport. Recognized browser intent that fails to provision Agent Tabs reports `EXPLICIT_BROWSER_REQUEST_NOT_PROVISIONED` instead of a dishonest `context_only` environment.
- **2026-08-15:** The mail Agent Tab workflow applies to all browser-use Work. Successful completion retains task-owned tabs; follow-ups resume the same space; New task / Stop still close unless Keep. Watching any Agent Tab widens the page. Ordinary actions use the control’s own name; leftover Sign-in chrome pauses only on a real auth URL. Mail stays Send/Delete/auth; other sites keep Phase 7 name gates (Submit, Purchase/Buy/Pay, Publish, Download, Upload, Merge / Create PR). A new research `startTask` still opens a fresh space; only mail Open Inbox auto-reuses on start.
- **2026-08-15:** If a site is already signed in in an ordinary human tab, Agent Tabs that need the same site reuse that session. Poppin clones the human tab’s URL (same `persist:poppin-browser` partition) and does not pause for another login. Cookies and credentials are never copied or inspected. Unrelated open tabs stay out of a new research task.

Future decisions should be added here only after an approved phase boundary or meaningful user feedback.
