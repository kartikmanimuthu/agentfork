/**
 * Human-readable phrasing for a tool call — `jira_search_issues` becomes
 * "Searching Jira".
 *
 * This used to be a sanitiser: Chat showed ONLY this phrasing and hid the tool
 * name, arguments and output entirely. It also carried a PHASE_BY_NODE map
 * keyed on the hand-written graph's node names (planner/evaluator/reflect/…),
 * which the DeepAgents migration deleted — so every lookup missed and every
 * step rendered as the fallback "Working on it". That map is gone.
 *
 * What remains is the phrasing alone, now used as a SUBTITLE beside the real
 * tool name in `agent-steps.tsx` rather than as a replacement for it.
 */

/** Verb → gerund, so a tool name becomes something a person would say. */
const VERBS: Record<string, string> = {
  search: 'Searching', find: 'Searching', query: 'Searching', list: 'Looking through',
  get: 'Reading', read: 'Reading', fetch: 'Reading', view: 'Reading',
  send: 'Sending', create: 'Creating', add: 'Adding', update: 'Updating',
  edit: 'Updating', write: 'Writing', delete: 'Removing', remove: 'Removing',
  export: 'Exporting', upload: 'Uploading', download: 'Downloading',
};

/** Service slug → how it's written in prose. */
const SERVICES: Record<string, string> = {
  jira: 'Jira', confluence: 'Confluence', gmail: 'Gmail', google: 'Google',
  outlook: 'Outlook', slack: 'Slack', notion: 'Notion', github: 'GitHub',
  gitlab: 'GitLab', linear: 'Linear', asana: 'Asana', clickup: 'ClickUp',
  hubspot: 'HubSpot', stripe: 'Stripe', canva: 'Canva', figma: 'Figma',
  dropbox: 'Dropbox', box: 'Box', zendesk: 'Zendesk', telegram: 'Telegram',
  whatsapp: 'WhatsApp', drive: 'Google Drive', calendar: 'your calendar',
};

/** Checked before SERVICES so the more specific name wins. */
const COMPOUND_SERVICES: Record<string, string> = {
  google_drive: 'Google Drive',
  google_calendar: 'your calendar',
  google_sheets: 'Google Sheets',
  google_docs: 'Google Docs',
};

/** Products where "Sending <product>" would read wrong. */
const MAIL_SERVICES = new Set(['gmail', 'outlook', 'email']);

/**
 * Claw's own internal tools, phrased as things it does rather than as tools.
 * These would otherwise surface as `search_memory` / `write_workspace_file`.
 */
const INTERNAL_TOOLS: Record<string, string> = {
  search_memory: 'Checking what I remember',
  save_memory: 'Saving what I learned',
  read_workspace_file: 'Reviewing my notes',
  write_workspace_file: 'Updating my notes',
  edit_workspace_file: 'Updating my notes',
  list_workspace_files: 'Reviewing my notes',
  load_skill: 'Recalling how to do this',

  // deepagents installs these itself (FilesystemMiddleware, SubAgentMiddleware,
  // todoListMiddleware). Without entries here they fell through to verb
  // matching and read as nonsense — `write_todos` became "Writing something",
  // `ls` and `task` became "Looking something up".
  write_todos: 'Planning the work',
  task: 'Delegating a sub-task',
  ls: 'Listing files',
  read_file: 'Reading a file',
  write_file: 'Writing a file',
  edit_file: 'Editing a file',
  glob: 'Finding files',
  grep: 'Searching in files',
  execute: 'Running a command',

  // Web + browsing.
  web_search: 'Searching the web',
  web_fetch: 'Reading a web page',
  browser_open_url: 'Opening a page',
  browser_snapshot: 'Looking at the page',
  browser_get_text: 'Reading the page',
  browser_click: 'Clicking something',
  browser_type: 'Typing into the page',
  browser_select: 'Choosing an option',
  browser_upload_file: 'Uploading a file',
  browser_wait: 'Waiting for the page',
  browser_screenshot: 'Taking a screenshot',
  browser_close: 'Closing the browser',
};

/**
 * A friendly phrase for a tool call — never the tool name itself, never args.
 * `jira_search_issues` → "Searching Jira". Unrecognized shapes fall back to
 * something honest and generic rather than exposing the raw name.
 */
export function describeTool(toolName: string | null): string {
  if (!toolName) return 'Looking something up';
  const name = toolName.toLowerCase();

  if (INTERNAL_TOOLS[name]) return INTERNAL_TOOLS[name];

  const parts = name.split(/[_-]/).filter(Boolean);
  const verb = parts.find((p) => VERBS[p]);

  // Two-word services must win over their first word alone, or
  // `google_drive_list_files` reads as "Looking through Google".
  const compound = parts.length > 1 ? `${parts[0]}_${parts[1]}` : '';
  const service = COMPOUND_SERVICES[compound] ?? SERVICES[parts.find((p) => SERVICES[p]) ?? ''];

  // Mail verbs read badly against a product name ("Sending Gmail").
  if (verb === 'send' && MAIL_SERVICES.has(parts[0])) return 'Sending an email';
  if (service && verb) return `${VERBS[verb]} ${service}`;
  if (service) return `Working with ${service}`;
  if (verb) return `${VERBS[verb]} something`;
  return 'Looking something up';
}
