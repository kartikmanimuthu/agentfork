/**
 * agent-tools.ts — the tool inventory for a tenant, grouped by source.
 *
 * Shared by the Agent → Tools tab and the scheduled-task grant picker.
 *
 * Integration tool factories are pure construction (no network), so calling them to
 * read name/description is cheap. MCP is different: enumerating its tools means
 * connecting to every server, so MCP is reported by server name and status only.
 */

import type { StructuredTool } from '@langchain/core/tools';
import { createLogger, getPrismaClient } from '@chatbot/shared';
import {
  IntegrationConfigService, classifyTool,
  createEmailTools, createGithubTools, createGmailTools, createGoogleCalendarTools,
  createGoogleDriveTools, createHubspotTools, createNotionTools, createOutlookTools,
  emailDescriptor, githubDescriptor, gmailDescriptor, googleCalendarDescriptor,
  googleDriveDescriptor, hubspotDescriptor, notionDescriptor, outlookDescriptor,
  type IntegrationDescriptor,
} from '@chatbot/claw-studio';

const logger = createLogger('mission-control:agent-tools');

/**
 * The descriptor deliberately does NOT carry its tool factory (see the docstring on
 * IntegrationDescriptor), so the pairing lives here — mirroring the FACTORIES table
 * inside libs/claw-studio/src/integrations/index.ts.
 *
 * TODO(jira): add `{ descriptor: jiraDescriptor, build: createJiraTools }` once
 * origin/feature/claw-studio@a7fbb0a is merged, or the Jira tools will be invisible
 * here and ungrantable to scheduled tasks.
 */
const FACTORIES: Array<{
  descriptor: IntegrationDescriptor;
  build: (tenantId: string) => StructuredTool[];
}> = [
  { descriptor: githubDescriptor, build: createGithubTools },
  { descriptor: hubspotDescriptor, build: createHubspotTools },
  { descriptor: emailDescriptor, build: createEmailTools },
  { descriptor: notionDescriptor, build: createNotionTools },
  { descriptor: gmailDescriptor, build: createGmailTools },
  { descriptor: googleCalendarDescriptor, build: createGoogleCalendarTools },
  { descriptor: googleDriveDescriptor, build: createGoogleDriveTools },
  { descriptor: outlookDescriptor, build: createOutlookTools },
];

/** Tools Claw always has, independent of any integration. */
const BUILTIN_TOOLS = [
  { name: 'save_memory', description: 'Save a fact or preference to long-term memory.' },
  { name: 'search_memory', description: 'Semantic search over long-term memory.' },
  { name: 'load_skill', description: "Load a skill's full instructions mid-run." },
  { name: 'list_workspace_files', description: "List Claw's own workspace files." },
  { name: 'read_workspace_file', description: "Read one of Claw's workspace files." },
  { name: 'write_workspace_file', description: "Replace a workspace file's contents." },
  { name: 'edit_workspace_file', description: 'Replace one snippet in a workspace file.' },
];

export interface AgentToolGroup {
  source: string;
  displayName: string;
  tools: Array<{ name: string; description: string; mutative: boolean }>;
  note?: string;
}

export async function collectToolGroups(tenantId: string): Promise<AgentToolGroup[]> {
  const groups: AgentToolGroup[] = [
    {
      source: 'builtin',
      displayName: 'Built-in',
      tools: BUILTIN_TOOLS.map((tool) => ({
        ...tool,
        mutative: classifyTool(tool.name).isMutative,
      })),
    },
  ];

  for (const { descriptor, build } of FACTORIES) {
    try {
      const accounts = await new IntegrationConfigService(tenantId, descriptor).listAccounts();
      if (accounts.length === 0) continue;
      groups.push({
        source: descriptor.name,
        displayName: descriptor.displayName,
        tools: build(tenantId).map((tool) => ({
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description : '',
          mutative: classifyTool(tool.name).isMutative,
        })),
      });
    } catch (error) {
      // One misconfigured integration must not blank the whole inventory.
      logger.warn({ error, integration: descriptor.name }, 'Could not inspect integration tools');
    }
  }

  try {
    const mcpServers = await getPrismaClient().mcpServer.findMany({
      where: { tenantId },
      select: { name: true, status: true },
    });
    if (mcpServers.length > 0) {
      groups.push({
        source: 'mcp',
        displayName: 'MCP servers',
        tools: [],
        note: `${mcpServers.map((s) => `${s.name} (${s.status})`).join(', ')} — MCP tool lists are resolved per run, so they are not enumerated here.`,
      });
    }
  } catch (error) {
    logger.warn({ error, tenantId }, 'Could not list MCP servers');
  }

  return groups;
}
