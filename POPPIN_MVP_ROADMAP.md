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

For a request such as “Give me a five-point summary”, the user selects a YouTube tab, reviews Poppin's request to use that tab and read its transcript, and grants access. Codex visibly opens or reads captions/transcript exposed by the approved page and creates a timestamped summary in the centre result tab. No Git project is required. The user may approve, revise, copy, save, or export it. Poppin must not silently download or transcribe protected media.

### Architecture and verification

`BrowserAgentEngine` is a reusable main-process engine behind a narrow IPC contract. It owns lifecycle, tab scope, action validation, approval gates, logging, and teardown. Verification includes unit coverage for tab scope, pause/stop/takeover, approval gates, and credential-boundary rejection; integration coverage proving that unapproved tabs and privileged APIs are inaccessible; and a localhost fixture covering visual selection, navigation, typing, click, approval, takeover, and teardown. Hands-on local-site testing precedes general web use.

## Phase 8 — Centre-Browser Results, Preview, Review, and Delivery

**Status:** Implemented and release-verified on 2026-08-07. Do not expand beyond this scope.

**Outcome:** Substantial Work and Code output is reviewed in the centre browser, with compact controls and metadata in the right pane.

### Trusted result tabs

- Open a trusted, sandboxed internal result page such as `poppin://task/current/result` as a normal Poppin tab.
- Revisions update the same result tab instead of creating duplicates, and the result persists with the current task where appropriate.
- Result content receives no Node or privileged Poppin APIs. Source links may open as additional Poppin tabs.
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

Merge is never implied by code approval or PR creation. A separate Merge action displays repository, PR number, base branch, checks, review status, and allowed merge strategy. Poppin supports merge, squash, or rebase only when repository policy permits, respects protection and required checks/reviews, and requires final confirmation immediately before merging. If merge is unavailable, open the PR for manual completion. Any later local-branch update that may be destructive requires separate explicit approval.

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

## Decision Log

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

Future decisions should be added here only after an approved phase boundary or meaningful user feedback.
