# Connecting another ACP-compatible agent

Acceptance test **J**: prove the architecture is portable without fully
implementing a second provider.

No Browser, Tandem, Context or Task engine changes when the selected agent
changes. Everything harness-specific lives below `AgentAdapter`.

## What a new harness actually costs

To add Claude Code, Gemini CLI, OpenCode, or any other ACP agent:

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

   Add `'claude-code'` to `AgentHarnessId` in `src/shared/agent.ts` and push the
   descriptor into `AGENT_HARNESSES`.

2. **Locator** — a function returning `{ executable, args }` for that agent's
   ACP entry point, in the shape of `src/main/acp/acp-locator.ts`.

3. **Wire it up** — in `createAgentAdapter`, return
   `new AcpAgentAdapter({ descriptor, locate, workspaceRoot })`.

That is the whole integration. No new protocol code, no second orchestration
path, no changes to `TaskEngine`, `BrowserAgentEngine`, the capability model, or
the Tandem adapter.

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

## What is not portable yet, and why

ACP has no client-defined tool mechanism. Poppin's Browser Use, Tandem and
native-page capabilities are exposed to Codex through the app server's dynamic
tools; the standards-compatible route for ACP agents is an **MCP server** listed
in `session/new`'s `mcpServers`.

Until that MCP bridge exists, `AcpAgentAdapter` reports
`capabilities.clientTools: false`, and Poppin refuses to start a browser-required
task on an ACP harness with an explicit message rather than starting a task the
agent cannot complete. This is the "truthful environment" rule: the agent must
know what it can actually read and control before planning.

Adding the bridge is a single new component (a Poppin-owned MCP stdio server
proxying to the existing capability layer) and flips one flag — it does not
change any harness-specific code.
