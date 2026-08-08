# Tandem + Memory Integration Roadmap

**Status**: ready to start — build all sections below as one continuous push, not gated one at a time
**Date**: 2026-08-08
**This repo is the target** — all file paths below are relative to `poppin-browser`, right here.
**Naming note**: this is a separate track from `POPPIN_MVP_ROADMAP.md`'s own Phase 1–13 (the browser/
workspace/Codex/Agent-Tabs work already shipped there). Deliberately not numbered "Phase 1" to avoid
colliding with that document's numbering — if the two ever need reconciling into one document, that's a
separate decision, not implied by this file existing.
**Companion design docs** (in `ashwinjyoti-ship-it/personal-ai-assistant`, `docs/`): `successor-app-design.md`, `cloudflare-compute-integration.md`

This is the execution plan for the direction agreed across several planning sessions: **Poppin is the
trunk.** Tandem's document/database engine and Karna's memory get built *into* Poppin as native
features — not connected to as a separate app, not loaded in a webview. Track B (Google/Gmail, digests,
Telegram/voice capture, the approval-taxonomy merge, and any multi-device sync) is explicitly **not** in
this document. Don't let it creep in here.

---

## 0. Scope lock — decisions already made, don't re-litigate these

- **Trunk = Poppin** (Electron, local-first), not Tandem. Reverses the earlier assumption in
  `successor-app-design.md`.
- **Local-only for this track.** No Cloudflare sync, no multi-device access. `poppin.sqlite` is the only
  store. Revisit if that assumption changes — don't design around it happening.
- **Memory moves up from Track B into this track** — it uses the exact substrate this build already creates.
- **No new UI framework, no new local DB engine.** Everything here extends patterns Poppin already has.
- **Pages and Databases are native tab kinds**, rendered directly in Poppin's renderer — never a webview
  pointed at a hosted URL.

---

## 1. What already exists — read this before writing anything

Poppin's own local persistence and IPC pattern is more built-out than it looks. Everything in this
roadmap follows it, not Tandem's.

| Piece | File | Pattern to copy |
|---|---|---|
| Local DB | `src/main/index.ts:191-192` | `node:sqlite`'s `DatabaseSync`, one file: `poppin.sqlite` in `app.getPath('userData')` |
| Store convention | `src/main/workspace/workspace-store.ts` | Constructor runs `CREATE TABLE IF NOT EXISTS` inline — **no separate migrations folder**. Typed `*Row` interfaces map to snapshot types. Follow this exactly for new stores; don't introduce a numbered-migration-file style. |
| IPC pattern | `src/shared/workspace.ts` (`WORKSPACE_CHANNELS`), `src/main/workspace/workspace-engine.ts` | `command` in, `snapshot` pushed back out on every mutation via `emitSnapshot()` |
| Left pane | `src/renderer/ui/WorkspacePane.tsx` | Tabs/Documents/Project checkboxes — `setTabSelected`, `setDocumentSelected`, `chooseDocuments()` |
| Right pane | `src/renderer/ui/ContextPane.tsx` | `ContextView` / `TaskView` / `ResultView`, `PaneSection` union |
| Document capture | `workspace-engine.ts:238` `captureDocument()`, `TEXT_DOCUMENT_EXTENSIONS` | Extension allowlist gate — this is where the Excel fix goes |
| Task/approval flow | `ContextPane.tsx` `TaskView`, `src/shared/task.ts` | `TaskCommand`, `pendingApproval`, approve/decline — reuse for comment-resolution, don't build a second approval UI |
| Repo connect | `src/renderer/ui/ProjectSection.tsx`, `src/main/workspace/workspace-engine.ts` `cloneRepository()` | Already works, untouched by this roadmap |
| Test framework | `package.json` | Vitest. New stores/engines need `*.test.ts` siblings, matching `tests/browser-agent-engine.test.ts` etc. |

Tandem (`ashwinjyoti-ship-it/unified-doc-management`) source to port **content and behavior** from, not
architecture — Tandem is Workers/D1, we're translating to local SQLite here:

| Tandem piece | File | What to take |
|---|---|---|
| Schema | `worker/migrations/0001_initial.sql` | `pages`, `blocks`, `comments` table shapes — D1 is SQLite, ports close to verbatim |
| Database views | `worker/migrations/0003_database_views.sql` | Table/board/calendar view schema |
| Editor | `web/src/components/PageView.tsx` and siblings | TipTap-based block editor — React, portable |
| PDF export | `web/src/lib/pageExport.ts` | `markdownToPdfHtml`, `downloadHtmlAsPdf` — already client-side, minimal changes needed |
| Comment loop | `docs/CODING_AGENTS.md` | The `agent-comments?status=open` → surgical apply → resolve shape — reimplement locally, don't call the hosted API |

---

## 2. New data layer

New store classes in `src/main/pages/`, following `workspace-store.ts`'s exact convention:

- `PagesStore` — `pages` table (id, title, parent_id, kind: `'page' | 'database'`, created_at, updated_at)
- `BlocksStore` — `blocks` table (id, page_id, type, content, position)
- `CommentsStore` — `comments` table (id, page_id, block_id, selection_quote, instruction, status: `'open' | 'resolved'`)
- `DatabaseRowsStore` — rows + column schema for `kind: 'database'` pages

New IPC channel set `PAGES_CHANNELS` in `src/shared/pages.ts`, mirroring `WORKSPACE_CHANNELS` exactly
(`pages:command`, `pages:get-snapshot`, `pages:snapshot`).

**Done when**: a Vitest suite can create a page, add blocks, add a comment, mark it resolved, and read
it all back — with zero UI involved.

---

## 3. New tab kinds

- Extend whatever tab-kind union `App.tsx`/tab-strip code currently assumes is browser-only, to
  `'browser' | 'page' | 'database'`.
- `PageView` component (ported TipTap editor from Tandem's `web/src/components/PageView.tsx`) — adapted
  to read/write through `PAGES_CHANNELS` instead of Tandem's REST API.
- `DatabaseView` component (ported table view) — same adaptation.
- Tab strip: distinct icon per kind, no other special-casing.

**Done when**: you can open a Page tab and a Database tab side by side with a Browser tab, all in the
same strip, all persisting across app restart.

---

## 4. Left pane — Pages section

- `WorkspacePane.tsx`: new "Pages" group, same visual weight as Tabs/Documents/Project.
- Tree rendering (parent_id hierarchy), "New page" / "New database" actions.
- Opening an item from this list opens (or focuses) its tab.

---

## 5. Context integration — the part that has to stay honest

- **Pages** selected here behave exactly like Documents do today: flatten to markdown, same
  `MAX_DOCUMENT_BYTES` budget, same context-card UI in `ContextPane.tsx`'s `ContextView`.
- **Databases** do **not** get flattened wholesale — past a few dozen rows that's neither cheap nor
  useful. Add a new agent tool, `database_query(databaseId, filter)`, scoped so it only works on a
  database that's actually checked in the left pane — same "only what's checked" boundary Poppin already
  guarantees for tabs and documents, enforced as a tool-call precondition instead of a paste.
- Small databases (roughly under a page of rows) can still take the cheap flatten-to-CSV path — don't
  force the query tool where a flatten is genuinely fine.

**Open decision, don't guess on this while coding — confirm first**: does `database_query` take a real
filter DSL (column = value, basic comparisons) or just "give me first N rows + schema"? Start with the
latter; it's a few hours of work and covers most of what "study/analyse a sheet" actually needs.

---

## 6. Comment-resolve loop (Tandem's actual mechanism, ported)

This is the highest-value single feature in this phase — it's the thing that makes a Page tab feel
different from a text file.

- UI: highlight text in `PageView`, attach an instruction (small inline composer, not a modal).
- Writes a `CommentsStore` row, `status: 'open'`.
- Feeds into the **existing** `TaskCommand` flow in `ContextPane.tsx` — an open comment becomes a task
  the same way a command-bar prompt does today. Do not build a second task/approval UI for this.
- Resolution is surgical: `old_text` (the `selection_quote`) → `new_text`, applied to the specific block,
  comment flipped to `status: 'resolved'`.

**Done when**: highlight a sentence, type an instruction, watch it change in place, see it marked
resolved — no full-page rewrite, no chat transcript anywhere in the flow.

---

## 7. Excel handling — two tiers, ship them separately

**Tier 1 — fix the actual bug.** `workspace-engine.ts:18-19`'s `TEXT_DOCUMENT_EXTENSIONS` set has `.csv`
but not `.xlsx`/`.xls`, so `captureDocument()` (line 238-239) returns `{ text: null }` for any Excel file
today — the agent sees a filename and nothing else. Add an `.xlsx`/`.xls` branch using a pure-JS parser
(`xlsx` / SheetJS — no Python, no container, fits the local-desktop model), convert each sheet to
CSV-ish text within the existing `MAX_DOCUMENT_BYTES` budget.

**Tier 2 — "Open as Database."** An action on an Excel Document entry that imports the parsed sheet into
`DatabaseRowsStore` and opens it as a native Database tab — turning "the agent can read this" into "the
agent can propose edits to this," through the same comment/task flow as everything else.

Ship Tier 1 first — it's a contained change to one function and is useful standalone, independent of
whether Database tabs exist yet.

---

## 8. Memory, folded in

- Port the useful half of Karna's (`ashwinjyoti-ship-it/personal-ai-assistant`) `src/services/memory.ts`
  — the compaction/decay logic — stripped of anything Cloudflare-specific.
- Represent memory as a **reserved Page** (or a small set of them) in `PagesStore`, not a separate table
  or panel. Editing memory is editing a page.

**Open decision — flag this, don't silently drop it**: Karna's memory uses Cloudflare Vectorize for
semantic recall. There's no local equivalent bundled yet. Options, cheapest first:
1. Skip semantic search for v1 — keyword search only, via SQLite's FTS5 extension (bundled with
   `node:sqlite`, zero new dependencies).
2. Bundle a local vector index (e.g. `sqlite-vec`) plus a small local embedding model.
3. Defer semantic recall entirely to whenever Track B's sync question gets revisited.

**Recommendation: start with (1).** Don't build (2) speculatively — FTS5 keyword search covers most
"did I already write this down" recall, and semantic search is a discrete upgrade you can bolt on later
without touching the page-as-memory model.

---

## 9. At-rest protection

Checked: Poppin currently has **zero** encryption or auth anywhere in `src/main` — `poppin.sqlite` is a
plain file, and Codex's stored account tokens are plaintext too. This didn't matter much when the file
only held browser-tab scratch context; it matters once Memory is in there.

- Use Electron's `safeStorage` API (OS-keychain-backed, no login UI needed) to encrypt the Memory page's
  content at rest. While touching this, encrypt the existing Codex account token storage the same way —
  it's the same gap, already present, not a scope add.
- **Do not** build a PIN/login screen for this track — that's real multi-account separation, and it's only
  worth the cost once this app is shared across people or devices, neither of which is true yet.

---

## 10. Real export

- **PDF**: port `web/src/lib/pageExport.ts` (Tandem) close to verbatim — it's already client-side
  HTML→PDF, no server dependency to remove.
- **Word**: bundle the `docx` npm package (pure JS) for Page → `.docx`. No pandoc, no container — desktop
  has a real filesystem, use it directly.
- **Excel**: bundle `exceljs` for Database tab → `.xlsx`. Same library can likely serve both the Tier-1
  read path and this write path — check before adding a second dependency for one direction.

---

## 11. Explicitly out of scope here (Track B)

Google/Gmail OAuth + MCP wrapping, digests-as-living-pages, Telegram/voice capture, the
`toolTiers.ts`/Poppin approval-taxonomy merge, Workers Cron for anything, and any multi-device sync or
real per-user accounts. If work in this phase starts pulling in any of these, stop and check whether it's
actually required for the item above it — it probably isn't.

---

## 12. Build order

Sequencing only, not a gate — build straight through §2–§10 in one push rather than pausing for
hands-on approval between steps. That gated, one-phase-at-a-time discipline is `POPPIN_MVP_ROADMAP.md`'s
process for its own numbered phases; this track is explicitly being run differently, end to end.

1. **Data layer.** §2 only. Provable with Vitest, no UI.
2. **Page tab, read/write.** §3 (page half only) + §4. You can write and reopen a note.
3. **Excel Tier 1 + Database tab + Tier 2.** §7, then §3 (database half).
4. **Context integration.** §5 — pages and databases become selectable, `database_query` tool wired up.
5. **Comment-resolve loop.** §6 — the actual "highlight, instruct, resolves" feature.
6. **Memory.** §8, immediately followed by §9 (encrypt it the same day it starts holding anything real).
7. **Export.** §10.

---

## 13. Definition of done for this track

- [ ] Pages and Databases are native tabs, backed by `poppin.sqlite`, survive app restart
- [ ] Left pane shows a Pages tree alongside the existing Tabs/Documents/Project sections
- [ ] Checking a Page or Database feeds the right pane's Context view; Databases use `database_query`,
      not a raw dump
- [ ] Highlighting text in a Page and giving an instruction resolves it in place through the existing
      Task/approval UI — no second approval surface
- [ ] Adding an `.xlsx` document produces real captured content, not "file metadata only"
- [ ] An added Excel file can be opened as an editable native Database tab
- [ ] Memory is a page you can open and edit directly, encrypted at rest via `safeStorage`
- [ ] A Page exports to real `.pdf` and `.docx`; a Database exports to real `.xlsx`
- [ ] Nothing from §11 leaked in

---

## 14. Open questions to resolve while coding, not before

These are real but shouldn't block starting §1–§2:

1. Exact shape of `database_query`'s filter DSL (§5) — start minimal, extend once a real task needs more.
2. Whether Tandem's TipTap editor components port with light adaptation or need a rewrite against
   Poppin's IPC instead of Tandem's REST client — find out by starting the port, not by predicting it.
3. FTS5 vs. a real vector index for memory recall (§8) — revisit only if keyword search proves
   insufficient in actual use, not preemptively.
