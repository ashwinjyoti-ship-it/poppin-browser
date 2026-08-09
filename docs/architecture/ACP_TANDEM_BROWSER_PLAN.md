# Poppin as Agent Client — implementation plan

> Poppin = Agent Client + Browser Runtime + Working Environment.
> The selected harness reasons and acts. Poppin provisions and governs the environment.

This plan was written after inspecting the actual code in
`ashwinjyoti-ship-it/poppin-browser` and `ashwinjyoti-ship-it/unified-doc-management`,
and after reading the current Agent Client Protocol specification and the
published ACP schema. It records what exists, what changed, and what is
deliberately deferred.

---

## 1. What ACP actually gives us

Checked against the published ACP JSON schema (`@agentclientprotocol/sdk`,
`schema/schema.json`) and <https://agentclientprotocol.com>.

ACP is line-delimited **JSON-RPC 2.0 over stdio**. Protocol version is a single
integer (currently `1`).

| Need | ACP mechanism | Notes |
|---|---|---|
| Capability negotiation | `initialize` → `clientCapabilities` / `agentCapabilities` | Anything omitted **MUST** be treated as unsupported. |
| Session creation | `session/new` (`cwd`, `mcpServers`) | Baseline; every agent must support it. |
| Session resume | `session/load` | Only when `agentCapabilities.loadSession` is true. |
| Prompting | `session/prompt` | Resolves **once, at end of turn**, with a `stopReason`. |
| Streaming output | `session/update` notifications | `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `current_mode_update`, `usage_update`. |
| Approvals | `session/request_permission` | Client picks one of the agent's `PermissionOption`s by `optionId`/`kind`. |
| Cancellation | `session/cancel` notification | Agent must answer the in-flight prompt with `stopReason: "cancelled"`. |
| Filesystem | `fs/read_text_file`, `fs/write_text_file` | Client-provided; gated by `clientCapabilities.fs`. |
| Terminal | `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release` | Gated by `clientCapabilities.terminal`. |
| Extra tools | **MCP servers passed to `session/new`** | ACP has *no* client-defined tool mechanism. |
| Model / reasoning pickers | **Not standardised** | Session *modes* and *config options* exist but are unstable. |

Two consequences that shaped the design:

1. **ACP does not turn arbitrary Poppin capabilities into agent-callable tools.**
   Browser Use and Tandem must reach an ACP agent through **MCP**, not through
   invented ACP methods. Poppin therefore reports `clientTools: false` for the
   ACP path today rather than pretending the browser is available.
2. **Model and reasoning selection are harness-specific.** Poppin negotiates
   them (`AgentControlSupport`) instead of assuming every agent has both.

Codex's own ACP adapter is `@agentclientprotocol/codex-acp` — a stdio ACP server
that drives the Codex app server underneath. Poppin locates it, it never
installs it.

---

## 2. Seams found in the existing code

| Area | File | Seam quality before | Action |
|---|---|---|---|
| Codex transport | `src/main/codex/codex-app-server.ts` | Clean JSON-RPC client, already isolated. | Kept as-is; wrapped by an adapter. |
| Codex semantics | `src/main/task/task-engine.ts` | **Fused**: thread/turn ids, notification parsing, approval shapes, dynamic-tool specs all inline. | Extracted behind `AgentAdapter`. |
| Browser Use | `src/main/browser/browser-agent-engine.ts`, `src/shared/browser-agent.ts` | Good. Task spaces, semantic snapshots, approvals, takeover already transport-independent. | Untouched; only its *exposure* changes. |
| Capability inference | `src/shared/task-requirements.ts` | Keyword-only regex; browser-use inferred per prompt. | To evolve into the Capability Router (Phase 2/3). |
| Product task | `src/main/task/task-store.ts`, `src/shared/task.ts` | Sound. Holds context snapshot, browser run, delivery, history. | Kept. A Poppin Task ≠ an agent session. |
| Native pages | `src/main/pages/*` | Internal encrypted Memory storage and legacy native document/database support. | The visible Page/Database UI is removed now that Tandem is the source of truth; the engine remains for Memory and compatibility. |
| Tandem API | `unified-doc-management/worker/src/routes/*`, `docs/AGENT_API.md` | Complete REST surface incl. `GET /api/agent/catalog`, markdown read/write, `edit-section`, agent comments. | Used directly. No endpoint mirroring. |

### Migration risks

- **Regression risk in TaskEngine.** Mitigated by keeping the Codex translation
  byte-for-byte equivalent inside `CodexAppServerAdapter` and by the existing
  584-line `tests/task-engine.test.ts`, which drives the engine with raw Codex
  notifications and still passes unchanged.
- **Capability dishonesty.** An agent that cannot receive the browser must not be
  handed a browser-required task. `AgentHarnessCapabilities.clientTools` is
  checked before a browser task starts.
- **Turn semantics differ.** Codex has explicit turn ids; ACP has one long-lived
  `session/prompt` call. The adapter synthesises a turn id so the product layer
  keeps a single model.

---

## 3. Architecture after Phase 1

```text
             TaskEngine (product-level Poppin Task)
                          │  harness-agnostic
        ┌─────────────────┴─────────────────┐
        │           AgentAdapter            │
        └─────────────────┬─────────────────┘
          ┌───────────────┴───────────────┐
CodexAppServerAdapter              AcpAgentAdapter
  (codex app-server JSON-RPC)        (Agent Client Protocol)
          │                                │
     CodexAppServer                   AcpConnection
```

New files:

| File | Role |
|---|---|
| `src/shared/agent.ts` | Harness descriptors, model options, control support. No Codex. |
| `src/main/agent/agent-adapter.ts` | The boundary: sessions, prompts, normalized events and requests. |
| `src/main/agent/agent-errors.ts` | `AgentNotInstalledError`, `AgentSignedOutError`. |
| `src/main/agent/codex-app-server-adapter.ts` | Codex dialect → normalized events. |
| `src/main/agent/acp-agent-adapter.ts` | ACP → normalized events; serves `fs/*`; answers `session/request_permission`. |
| `src/main/agent/agent-registry.ts` | Selectable harnesses and adapter construction. |
| `src/main/acp/acp-protocol.ts` | ACP wire types, transcribed from the published schema. |
| `src/main/acp/acp-connection.ts` | Dependency-free JSON-RPC 2.0 stdio client. |
| `src/main/acp/acp-locator.ts` | Finds the installed ACP adapter binary. |

The Electron main bundle stays dependency-free: the official TypeScript SDK is
ESM-only and pulls in `zod`, which would change the webpack/packaging profile for
no protocol benefit. The schema is the source of truth either way.

---

## 4. Poppin Task vs agent session

They stay separate, as required.

```text
Poppin Task (persisted in SQLite)
├── kind, prompt, model, reasoning
├── frozen context snapshot
├── Browser Task Space + evidence + sources
├── approvals and delivery (branch/commit/PR)
├── result document + history
└── agent session id  ← the only agent-owned field
```

Switching harness switches the session, not the task.

---

## 5. Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | AgentAdapter boundary + ACP proof of concept | **Done** |
| 2 | Capability/environment model | **Done** |
| 3 | Automatic Browser Use provisioning; reason codes | **Done**; persistent browsing-context identity still open (below) |
| 4 | Tandem capability adapter | **Done** |
| 5 | Tandem World hosting + theme | **Done** |
| 6 | Tandem as context | **Done** |
| 7 | Cross-capability workflows | **Wired**: browser → Tandem and context → Tandem run through one task with both capabilities provisioned up front |
| 8 | ACP parity evaluation vs direct Codex | Open — needs a live Codex ACP run on a Mac |
| 9 | Remove superseded Tandem code | Deferred until 4–7 are proven in daily use |
| 10 | Architecture/tests/docs cleanup | Ongoing |

### Known gaps, stated plainly

- **Poppin capability tools over ACP.** ACP has no client-defined tool
  mechanism, so Browser Use and Tandem are not yet reachable by an ACP agent.
  The route is an MCP stdio server listed in `session/new`. Until it exists the
  ACP adapter reports `clientTools: false` and Poppin refuses browser-required
  tasks on that harness instead of starting one it cannot serve.
- **`SOURCE_TAB_STATE_NOT_TRANSFERRED`.** The reason code exists and is part of
  the shared vocabulary, but Poppin does not yet detect the mismatch: context
  tabs are still URL-seeded clones (`createTaskSpaceTabs`). Real detection needs
  clone↔source pairing carried into `BrowserAgentEngine` and a comparison at
  first read. Until then Poppin does not claim the clone reproduces the source
  tab's live state.
- **Persistent browsing-context identity** (SPA route, dialog, scroll, focus,
  frame hierarchy) beyond URL reconstruction is not implemented.
- **ACP `elicitation/create`** is not advertised, so blocking questions from an
  ACP agent are refused rather than surfaced.
- **Tandem cleanup (Part V)** has started at the UI boundary: native Page and
  Database creation are hidden while the engine remains for encrypted Memory.
  Removing the engine before Tandem World and the Tandem
  capability have been exercised in daily use would break working behaviour.

Poppin stays runnable at every phase, and the working Codex path is never
removed while the ACP path is being proved.

See [`AGENT_PORTABILITY.md`](./AGENT_PORTABILITY.md) for exactly what connecting
another ACP-compatible agent requires.
