/**
 * Built-in tools available to agents without an MCP server attachment.
 * Keep the names in sync with the registry in `libs/ai/src/tools/`.
 */
export interface BuiltInToolMeta {
  name: string;
  label: string;
  description: string;
}

export const BUILT_IN_TOOLS: BuiltInToolMeta[] = [
  {
    name: 'web_search',
    label: 'Web Search',
    description: 'Search the web for current information (requires a configured search provider).',
  },
  {
    name: 'web_fetch',
    label: 'Web Fetch',
    description: 'Fetch and read the visible text content of a web page by URL.',
  },
];

export const BUILT_IN_TOOL_NAMES = BUILT_IN_TOOLS.map((t) => t.name);
