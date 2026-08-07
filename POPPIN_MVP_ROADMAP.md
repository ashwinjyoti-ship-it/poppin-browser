# Poppin Browser MVP — Living Roadmap

## Purpose

Poppin Browser validates one workflow:

> Browse → Create Workspace → Select Context → Connect Local Project → Select UI → Send to Codex → Preview → Approve or Revise

This is a browser first—not an IDE and not another AI chat. Intelligence should disappear behind normal browsing until the user deliberately invokes it.

This roadmap is living guidance, not pre-authorization to implement every phase. Phase 1 must be used in daily work before Phase 2 is planned. Observed needs may revise, reorder, reduce, or replace every later phase.

## Permanent Product Invariants

- The centre browser is always the hero and can occupy the complete window.
- UI remains thin; reusable engines own browser, workspace, context, project, selection, task, provider, and preview behavior.
- Context is explicit and inspectable. Nothing hidden is sent to a provider.
- The MVP supports one workspace and one active task.
- The product is local first. SQLite stores structured metadata; large content remains on disk.
- Coding previews remain inside the browser.
- Provider actions require explicit review through approve or revise.
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

## Phase 7 — Visual Selection

**Provisional outcome:** Select an element in a localhost application as the task target.

Capture the selected element's HTML, relevant CSS, DOM context, screenshot, and bounding box. The resulting target is visible inside the context package before submission.

## Phase 8 — In-Browser Preview and Review

**Provisional outcome:** See Codex's project modification running inside the centre browser and approve or revise it.

Launch the configured preview process, open its URL in the centre browser, show the code diff in the right pane, and preserve the browser as the main review surface. Acceptance ends the workflow; revision sends a scoped follow-up against the same task.

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

Future decisions should be added here only after an approved phase boundary or meaningful user feedback.
