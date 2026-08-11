# Poppin Browser — Agent Operating Guide

Read [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) before changing this repository. Read [POPPIN_MVP_ROADMAP.md](POPPIN_MVP_ROADMAP.md) before proposing or expanding product scope; it is the product source of truth.

## Working rules

- Poppin is a **browser-first**, local-first macOS Electron application. Do not turn it into a generic chat or IDE.
- Keep remote page code unprivileged. It must never receive Node, Electron, or Poppin APIs.
- Preserve the credential boundary: never access, copy, inspect, import, or persist passwords, passkeys, cookies, tokens, Keychain data, or Apple Passwords data.
- Context is explicit and inspectable. Browser automation is visible, task-scoped, and approval-gated.
- Reuse the existing main-process engines and narrow IPC contracts. Do not add broad renderer-to-main access.
- One workspace and one active task are deliberate MVP constraints.
- Poppin decides the required environment before the agent starts. The user must never need a phrase like "use browser", and Poppin must never advertise a capability the selected harness cannot actually receive.
- Do not add product features beyond an approved roadmap phase or explicit user request.

## Change discipline

1. Inspect the affected engine, shared contract, renderer component, and existing tests before editing.
2. Prefer small, cohesive changes. Update `POPPIN_MVP_ROADMAP.md` only for meaningful approved decisions or user feedback.
3. Add or adjust tests at the appropriate level. Run `npm run lint`, `npm run typecheck`, and `npm test`.
4. For browser-shell, Electron, packaging, or visual behavior, also run the Node 22 packaged smoke flow documented in the development guide. Local DMG builds are documented in [docs/BUILD_DMG.md](docs/BUILD_DMG.md).
5. Do not push, open a PR, merge, or replace the stable DMG unless the user explicitly asks for release/deploy work. When they do ask to update local installers, use `npm run update:dmg` (host arch) or `npm run update:dmg:all` to overwrite `DMG/Poppin-Browser-*.dmg` — never commit those binaries.

## Fast orientation

- `src/main/` owns Electron, persistence, engines, permissions, and task lifecycle.
- `src/main/agent/` is the harness boundary (`AgentAdapter`). Codex app-server and ACP live behind it; nothing above it may assume a specific harness. See `docs/architecture/ACP_TANDEM_BROWSER_PLAN.md`.
- `src/main/tandem/` connects to the Tandem application over its REST API. Poppin hosts Tandem, it never re-implements or duplicates it.
- `src/shared/` owns typed IPC snapshots and command contracts.
- `src/preload/index.ts` exposes the narrow renderer bridge.
- `src/renderer/` owns the React shell only.
- `tests/` mirrors the architecture; `tests/smoke/` launches the packaged Electron app.
