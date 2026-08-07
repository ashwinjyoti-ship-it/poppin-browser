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

See [POPPIN_MVP_ROADMAP.md](./POPPIN_MVP_ROADMAP.md) for the living product guide and phase gates.
