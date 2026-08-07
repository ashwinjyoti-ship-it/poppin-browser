# Poppin Browser Architecture

## Product boundary

Poppin is a browser-first workspace, not an IDE or a general-purpose autonomous agent. It has one workspace and one active task. The centre browser remains the primary review surface; every provider action has an explicit, inspectable purpose.

## Phase 7 — Visual Selection and controlled browser use

**Status: planned only. Do not implement until the user explicitly approves Phases 7–8.**

Phase 7 starts with visual selection in a localhost preview and adds a controlled way for the active Codex task to use the page that is already open in Poppin. This is not unrestricted computer control.

### User-visible contract

- The user explicitly starts browser use for the active task and can pause or stop it at any time.
- The task can inspect and act only in the selected Poppin tab or a user-approved tab opened from it. It cannot silently switch to unrelated tabs, workspaces, profiles, or native applications.
- The browser surface stays visible while the task is operating. Poppin shows the current target tab, the requested action, and an append-only action log.
- Navigation, typing, clicking, scrolling, and reading rendered page text are allowed only for the active task's stated goal.
- Actions with material external effects—including sign-in, password or passkey prompts, payments, purchases, submissions, publishing, deletion, downloads, permission prompts, and sending messages—pause for explicit user approval.
- The user may take over the tab at any time. Taking over pauses browser use until the user explicitly resumes it.

### Credential and privacy boundary

- Browser use must never read, copy, scrape, export, or store passwords, passkeys, Keychain records, cookies, or authenticated-session tokens.
- It must not import authentication from another browser or native application.
- Login pages may be navigated to, but credential entry and passkey/biometric prompts remain user-operated and require an approval pause.
- Task context remains explicit: only user-selected page content, visual-selection artifacts, and approved action-log records can be sent to Codex.

### Engine shape

`BrowserAgentEngine` will be a reusable main-process engine behind a narrow IPC contract. It owns the task-scoped browser-use lifecycle, validates the target tab and allowed actions, records actions, and tears down access when the task ends. It must use the existing `BrowserEngine` tab model rather than creating a hidden browser, a second profile, or a second workspace.

The renderer will expose a small task control surface in the existing right pane: start, pause, resume, stop, current action, approval request, and action log. It must not become a chat surface or permit more than one task.

### Required verification before release

- Unit tests for tab scope, pause/stop behavior, approval gates, and credential-boundary rejection.
- Integration tests proving that browser use cannot access an unapproved tab or any privileged Electron/Node API.
- A localhost fixture covering visual selection, navigation, typing, click, explicit approval, user takeover, and task teardown.
- Hands-on testing with a benign local site before any general web browsing is enabled.

## Relationship to Phase 8

Phase 8 keeps the local project preview inside the centre browser for review. It may consume Phase 7's selected-element and browser-use records, but it does not expand browser use into unrestricted computer control.
