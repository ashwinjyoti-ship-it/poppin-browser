# Connecting another ACP-compatible agent

Acceptance test **J**: prove the architecture is portable without fully
implementing a second provider.

No Browser, Tandem, Context or Task engine changes when the selected agent
changes. Everything harness-specific lives below `AgentAdapter`.

## What a new harness actually costs

To add Claude Code, Cursor Agent, Gemini CLI, OpenCode, or any other ACP agent:

1. **Descriptor** — one entry in `src/main/agent/agent-registry.ts`:

   ```ts
   export const CLAUDE_CODE_DESCRIPTOR: AgentHarnessDescriptor = {
     id: 'claude-code',
     name: 'Claude Code',
     transport: 'acp',
     availability: 'preview',
     summary: 'Claude Code over the Agent Client Protocol.',
   };
   ```

   Add the id to `AgentHarnessId` in `src/shared/agent.ts` and push the
   descriptor into `AGENT_HARNESSES`.

2. **Locator** — a function returning `{ executable, args }` for that agent's
   ACP entry point, in `src/main/acp/acp-locator.ts` (wired through
   `locateAcpHarness`).

3. **Wire it up** — `createAgentAdapter` already returns `AcpAgentAdapter` for
   every `transport: 'acp'` harness, including MCP bridge hooks.

Installed binary names Poppin looks for today:

| Harness | Binary / command |
|---|---|
| Codex ACP | `codex-acp` (`@agentclientprotocol/codex-acp`) |
| Claude Code | `claude-agent-acp` (`@agentclientprotocol/claude-agent-acp`) |
| Cursor Agent | `agent acp` (Cursor Agent CLI) |

Overrides: `POPPIN_ACP_AGENT_COMMAND`, `POPPIN_CLAUDE_ACP_COMMAND`,
`POPPIN_CURSOR_ACP_COMMAND` (plus matching `*_ARGS`).

## What the adapter negotiates for you

`AcpAgentAdapter` already handles the parts that differ between agents:

- `initialize` capability exchange, and honouring "omitted means unsupported".
- Agents **without** `loadSession`: Poppin creates a fresh session and replays
  its own conversation record as a preamble.
- Agents **without** model or reasoning selection: `AgentControlSupport` reports
  `{ model: false, reasoning: false }` and the Command Bar hides both pickers
  instead of inventing options.
- Agents that expose different `PermissionOption` sets: Poppin maps its
  accept/decline/cancel decision onto the option **kinds** the agent offered
  (`allow_once`, `allow_always`, `reject_once`, `reject_always`), never onto a
  hard-coded option id.
- Stop reasons (`end_turn`, `cancelled`, `refusal`, `max_tokens`,
  `max_turn_requests`) map onto Poppin's task outcomes.

## Capability tools over ACP (MCP bridge)

ACP has no client-defined tool mechanism. Poppin's Browser Use, Tandem and
native-page capabilities are exposed to Codex through the app server's dynamic
tools; the standards-compatible route for ACP agents is Poppin's **MCP stdio
server** listed in `session/new`'s `mcpServers`:

1. Electron main starts `CapabilityBridge` (Unix socket + session token).
2. `scripts/poppin-mcp-server.mjs` is registered as the `poppin` MCP server.
3. The MCP process forwards `tools/list` / `tools/call` to the bridge.
4. TaskEngine executes the same Work capability tools Codex receives.

When the MCP entry is resolvable, `AcpAgentAdapter` reports
`capabilities.clientTools: true`. When it is not, Poppin refuses
browser-required tasks on that harness rather than starting a task the agent
cannot complete.

Overrides for the MCP launch: `POPPIN_MCP_SERVER_COMMAND`,
`POPPIN_MCP_SERVER_ARGS`, `POPPIN_MCP_SERVER_SCRIPT`, `POPPIN_NODE_PATH`.
