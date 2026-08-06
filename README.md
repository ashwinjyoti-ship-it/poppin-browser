# Poppin Browser

Poppin Browser is a calm, macOS-first browser shell for a future local-first Codex workflow. Phase 1 is intentionally only a browser: tabs, navigation, an address/search bar, and restored sessions.

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

The browser shell is React. Remote pages run in sandboxed `WebContentsView` instances with Node integration disabled and a shared persistent Electron session. Browser structure is saved under Electron's application data directory; no project or workspace data exists in Phase 1.

See [POPPIN_MVP_ROADMAP.md](./POPPIN_MVP_ROADMAP.md) for the living product guide and phase gates.

