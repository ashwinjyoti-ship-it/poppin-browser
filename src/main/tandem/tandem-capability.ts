import type { AgentToolSpec } from '../agent/agent-adapter';
import type { TandemProvider } from './tandem-provider';

/**
 * The agent-facing Tandem capability.
 *
 * It is deliberately transport-independent: today TaskEngine exposes it as a
 * capability tool on the Codex app-server session; the same object is what an
 * MCP server would call when ACP agents are wired up. Nothing above this file
 * knows about Tandem HTTP details.
 *
 * Agents use this instead of clicking around Tandem World.
 */

export const TANDEM_TOOL_NAME = 'tandem';

export interface TandemCapabilityContext {
  provider: () => TandemProvider | null;
  workspaceId: () => string | null;
  writable: () => boolean;
  /** Opens a page in Tandem World for the human, after the agent wrote it. */
  openInWorld: (pageId: string) => void;
}

export const TANDEM_CAPABILITY_TOOL: AgentToolSpec = {
  name: TANDEM_TOOL_NAME,
  description: [
    'Read and write the user\'s Tandem workspace through the Tandem API.',
    'Use this instead of browsing or automating the Tandem user interface.',
    'Writes preserve existing content: prefer append or edit_section over write_markdown.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        enum: [
          'list_pages', 'search', 'read_page', 'create_page', 'write_markdown',
          'append', 'edit_section', 'list_comments', 'add_comment',
          'list_agent_comments', 'apply_agent_comment', 'import_url', 'open_in_world',
        ],
      },
      pageId: { type: 'string', description: 'Target Tandem page id.' },
      title: { type: 'string', description: 'Title for create_page.' },
      parentId: { type: 'string', description: 'Optional parent folder id.' },
      query: { type: 'string', description: 'Search text.' },
      markdown: { type: 'string', description: 'Markdown for write_markdown or append.' },
      oldText: { type: 'string', description: 'Exact existing text for edit_section.' },
      newText: { type: 'string', description: 'Replacement text for edit_section or apply_agent_comment.' },
      commentId: { type: 'string', description: 'Comment id for apply_agent_comment.' },
      content: { type: 'string', description: 'Comment body for add_comment.' },
      url: { type: 'string', description: 'Source URL for import_url.' },
    },
  },
};

export interface TandemCapabilityResult {
  ok: boolean;
  text: string;
}

export async function executeTandemCapability(
  context: TandemCapabilityContext,
  rawArguments: unknown,
): Promise<TandemCapabilityResult> {
  const provider = context.provider();
  if (!provider) return { ok: false, text: 'Tandem is not connected in Poppin.' };
  const args = parseArguments(rawArguments);
  if (!args) return { ok: false, text: 'The Tandem action arguments were invalid.' };
  const action = stringArg(args, 'action');
  const workspaceId = context.workspaceId();

  const needsWrite = ['create_page', 'write_markdown', 'append', 'edit_section', 'add_comment', 'apply_agent_comment', 'import_url'];
  if (needsWrite.includes(action) && !context.writable()) {
    return { ok: false, text: 'Poppin has read-only Tandem access for this task.' };
  }

  try {
    switch (action) {
      case 'list_pages': {
        if (!workspaceId) return { ok: false, text: 'No Tandem workspace is selected.' };
        const pages = await provider.listPages(workspaceId);
        return { ok: true, text: JSON.stringify(pages.slice(0, 300)) };
      }
      case 'search': {
        const query = stringArg(args, 'query');
        if (!query) return { ok: false, text: 'query is required for search.' };
        return { ok: true, text: JSON.stringify(await provider.search(query)) };
      }
      case 'read_page': {
        const pageId = stringArg(args, 'pageId');
        if (!pageId) return { ok: false, text: 'pageId is required for read_page.' };
        return { ok: true, text: JSON.stringify(await provider.readMarkdown(pageId)) };
      }
      case 'create_page': {
        if (!workspaceId) return { ok: false, text: 'No Tandem workspace is selected.' };
        const title = stringArg(args, 'title');
        if (!title) return { ok: false, text: 'title is required for create_page.' };
        const page = await provider.createPage(workspaceId, title, stringArg(args, 'parentId') || null);
        const markdown = stringArg(args, 'markdown');
        if (markdown) await provider.writeMarkdown(page.id, markdown);
        return { ok: true, text: JSON.stringify(page) };
      }
      case 'write_markdown': {
        const pageId = stringArg(args, 'pageId');
        if (!pageId) return { ok: false, text: 'pageId is required for write_markdown.' };
        await provider.writeMarkdown(pageId, stringArg(args, 'markdown'));
        return { ok: true, text: `Replaced the content of Tandem page ${pageId}.` };
      }
      case 'append': {
        const pageId = stringArg(args, 'pageId');
        const markdown = stringArg(args, 'markdown');
        if (!pageId || !markdown) return { ok: false, text: 'pageId and markdown are required for append.' };
        await provider.appendMarkdown(pageId, markdown);
        return { ok: true, text: `Appended to Tandem page ${pageId} without changing existing content.` };
      }
      case 'edit_section': {
        const pageId = stringArg(args, 'pageId');
        const oldText = stringArg(args, 'oldText');
        if (!pageId || !oldText) return { ok: false, text: 'pageId and oldText are required for edit_section.' };
        await provider.editSection(pageId, oldText, stringArg(args, 'newText'));
        return { ok: true, text: `Replaced the anchored section on Tandem page ${pageId}.` };
      }
      case 'list_comments': {
        const pageId = stringArg(args, 'pageId');
        if (!pageId) return { ok: false, text: 'pageId is required for list_comments.' };
        return { ok: true, text: JSON.stringify(await provider.listComments(pageId)) };
      }
      case 'add_comment': {
        const pageId = stringArg(args, 'pageId');
        const content = stringArg(args, 'content');
        if (!pageId || !content) return { ok: false, text: 'pageId and content are required for add_comment.' };
        await provider.addComment(pageId, content);
        return { ok: true, text: `Added a comment to Tandem page ${pageId}.` };
      }
      case 'list_agent_comments': {
        const pageId = stringArg(args, 'pageId');
        if (!pageId) return { ok: false, text: 'pageId is required for list_agent_comments.' };
        return { ok: true, text: JSON.stringify(await provider.listAgentComments(pageId)) };
      }
      case 'apply_agent_comment': {
        const commentId = stringArg(args, 'commentId');
        if (!commentId) return { ok: false, text: 'commentId is required for apply_agent_comment.' };
        await provider.applyAgentComment(commentId, stringArg(args, 'newText'));
        return { ok: true, text: `Applied and resolved Tandem instruction ${commentId}.` };
      }
      case 'import_url': {
        if (!workspaceId) return { ok: false, text: 'No Tandem workspace is selected.' };
        const url = stringArg(args, 'url');
        if (!url) return { ok: false, text: 'url is required for import_url.' };
        const page = await provider.importUrl(workspaceId, url, stringArg(args, 'parentId') || null);
        return { ok: true, text: page ? JSON.stringify(page) : 'Tandem imported the URL.' };
      }
      case 'open_in_world': {
        const pageId = stringArg(args, 'pageId');
        if (!pageId) return { ok: false, text: 'pageId is required for open_in_world.' };
        context.openInWorld(pageId);
        return { ok: true, text: `Opened Tandem page ${pageId} in Tandem World.` };
      }
      default:
        return { ok: false, text: `Unsupported Tandem action: ${action || '(missing)'}.` };
    }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : 'The Tandem action failed.' };
  }
}

function parseArguments(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? args[key] : '';
}
