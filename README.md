# Poppin Browser

Poppin Browser is a calm, macOS-first browser shell for a local-first Codex workflow. It combines normal browsing—including persistent, reorderable, pinned and grouped tabs, native context menus, stable favicons, and browser preferences—with one workspace, explicit context, controlled browser use, and reviewed Work or Code tasks.

## Run locally

```bash
npm install
npm run dev
```

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run package
```

The browser shell is React. Remote pages run in sandboxed `WebContentsView` instances with Node integration disabled and a shared persistent Electron session. Browser structure is saved as versioned JSON; workspace, document-context, and project metadata are stored in SQLite under Electron's application data directory. Local documents and repositories remain on disk.

## Documentation

- [Development guide](./docs/DEVELOPMENT_GUIDE.md) — architecture, implemented features, security boundaries, test strategy, release workflow, and a ready-to-paste Cursor/Codex handoff.
- [Agent operating guide](./AGENTS.md) — concise repository rules for a fresh Codex session.
- [Poppin Browser Cursor rule](./.cursor/rules/poppin-browser.mdc) — automatically applied project context for Cursor.
- [Living product roadmap](./POPPIN_MVP_ROADMAP.md) — approved product phases and decision log; this is the source of truth for scope.
