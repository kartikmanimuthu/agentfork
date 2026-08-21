/**
 * Tool Classifier — determines whether a tool call requires human approval.
 *
 * Ported verbatim from nucleus lib/agent/tool-classifier.ts.
 * Read-only tools run in yolo mode (no approval needed).
 * Mutative tools (anything that creates, modifies, deletes, or executes) require approval.
 */

// ─── Mutative verb prefixes / substrings ─────────────────────────────────────

const MUTATIVE_PATTERNS = [
  // CRUD verbs
  /\bcreate\b/i, /\bupdate\b/i, /\bdelete\b/i, /\bremove\b/i, /\bput\b/i,
  /\bpatch\b/i, /\bpost\b/i, /\bwrite\b/i, /\bset\b/i, /\binsert\b/i,
  // Infrastructure lifecycle
  /\bstart\b/i, /\bstop\b/i, /\bterminate\b/i, /\breboot\b/i, /\brestart\b/i,
  /\bdeploy\b/i, /\brollback\b/i, /\bscale\b/i, /\blaunch\b/i, /\bprovision\b/i,
  /\bdestroy\b/i, /\bapply\b/i, /\bmigrate\b/i,
  // Config / IAM mutations
  /\bconfigure\b/i, /\bmodify\b/i, /\bchange\b/i, /\benable\b/i, /\bdisable\b/i,
  /\battach\b/i, /\bdetach\b/i, /\bassociate\b/i, /\bdisassociate\b/i,
  /\bgrant\b/i, /\brevoke\b/i, /\brotate\b/i, /\bregister\b/i, /\bderegister\b/i,
  // Execution
  /\brun\b/i, /\bexecute\b/i, /\binvoke\b/i, /\btrigger\b/i, /\bsend\b/i,
  /\bpublish\b/i, /\bpush\b/i, /\bflush\b/i, /\bpurge\b/i, /\btruncate\b/i,
  // File / data mutations
  /\bwrite_file\b/i, /\bappend\b/i, /\boverwrite\b/i, /\bupload\b/i,
  // `edit` and `add` were absent from the ported list, leaving
  // edit_workspace_file and jira_add_comment ungated.
  /\bedit\b/i, /\badd\b/i,
  // `log` was also absent, leaving close_log_note (a real CRM note write) ungated.
  /\blog\b/i,
];

/**
 * Tool names here are snake_case (`gmail_send_message`), but the patterns above are
 * `\b`-bounded and `_` is a regex word character — so `\bsend\b` finds no boundary
 * between `gmail_` and `send` and never matches. Left alone, that silently
 * classified EVERY integration tool as read-only, so the mutative approval gate
 * never fired for sending mail, creating issues, or deleting events.
 *
 * Splitting separators into spaces before matching fixes snake_case while leaving
 * the hyphenated/spaced forms (`create-resource`, `aws ec2 terminate-instances`)
 * behaving exactly as before.
 */
function tokenizeName(name: string): string {
  return name.replace(/[_-]+/g, ' ');
}

// ─── Explicit mutative allowlist (override "no pattern matched") ─────────────
// Tool names that ARE mutative but that no pattern above catches, so they would
// otherwise fail open — classified read-only and never gated.
//
// The browser action tools are the motivating case: `tokenizeName` turns
// `browser_click` into "browser click", and MUTATIVE_PATTERNS has no `click`,
// `type`, `select`, or `open` entry. Widening the patterns instead would
// misfire across the integration suite — `\bselect\b` in particular would start
// gating read tools.
//
// Deliberately NOT listed: browser_snapshot, browser_get_text, browser_wait,
// browser_screenshot, browser_close. The approval boundary drawn here is
// "contact a new origin, or act on the page"; those five only read or wind down
// a page whose navigation was already approved. (OpenWorker gates all of its
// browser tools; gating reads here would produce a dozen prompts per browsing
// turn and train operators to approve reflexively, which is worse for safety
// than the narrower gate.)
const MUTATIVE_ALLOWLIST = new Set([
  'browser_open_url',
  'browser_click',
  'browser_type',
  'browser_select',
  'browser_upload_file',
]);

// ─── Explicit read-only allowlist (override mutative pattern matches) ─────────
// These tool names look mutative but are actually safe reads.

const READ_ONLY_ALLOWLIST = new Set([
  'get_aws_credentials',
  'list_aws_accounts',
  'describe_instances',
  'describe_services',
  'describe_clusters',
  'describe_tasks',
  'describe_task_definition',
  'describe_db_instances',
  'describe_db_clusters',
  'describe_auto_scaling_groups',
  'describe_load_balancers',
  'describe_target_groups',
  'describe_security_groups',
  'describe_vpcs',
  'describe_subnets',
  'describe_route_tables',
  'describe_internet_gateways',
  'describe_nat_gateways',
  'describe_key_pairs',
  'describe_images',
  'describe_snapshots',
  'describe_volumes',
  'describe_log_groups',
  'describe_log_streams',
  'get_log_events',
  'filter_log_events',
  'get_metric_statistics',
  'list_metrics',
  'get_dashboard',
  'list_dashboards',
  'get_function',
  'list_functions',
  'get_function_configuration',
  'list_aliases',
  'get_bucket_policy',
  'list_buckets',
  'list_objects',
  'get_object',
  'head_object',
  'get_parameter',
  'get_parameters',
  'describe_parameters',
  'get_secret_value',
  'list_secrets',
  'get_caller_identity',
  'list_roles',
  'list_policies',
  'get_role',
  'get_policy',
  'list_attached_role_policies',
  'list_role_policies',
  'get_role_policy',
  'list_users',
  'get_user',
  'list_groups',
  'get_group',
  'list_stacks',
  'describe_stacks',
  'describe_stack_events',
  'describe_stack_resources',
  'get_template',
  'list_change_sets',
  'describe_change_set',
  'list_repositories',
  'describe_repository',
  'list_images',
  'describe_image',
  'list_tags_for_resource',
  'get_tags',
  'describe_tags',
  'list_hosted_zones',
  'list_resource_record_sets',
  'get_hosted_zone',
  'describe_record',
  'list_distributions',
  'get_distribution',
  'describe_distribution',
  'list_certificates',
  'describe_certificate',
  'list_pipelines',
  'get_pipeline',
  'get_pipeline_state',
  'list_builds',
  'batch_get_builds',
  'list_projects',
  'batch_get_projects',
  'read_file',
  'list_files',
  'list_directory',
]);

// ─── Mutative bash command patterns ──────────────────────────────────────────

const MUTATIVE_BASH_PATTERNS = [
  /\baws\s+\S+\s+(create|update|delete|put|modify|start|stop|terminate|reboot|deploy|rollback|attach|detach|associate|disassociate|enable|disable|grant|revoke|register|deregister|run-instances|run-task|invoke|publish|flush|purge|rotate|apply|destroy|migrate|change|set|remove|rm|add|import|export)\b/i,
  /\b(kubectl\s+(apply|delete|create|patch|replace|scale|rollout|set|label|annotate|taint|cordon|uncordon|drain|exec|port-forward))\b/i,
  /\b(terraform\s+(apply|destroy|import|state\s+(mv|rm|push)))\b/i,
  /\b(git\s+(push|commit|merge|rebase|reset|checkout\s+-b|branch\s+-d|tag\s+-d|remote\s+add|remote\s+remove))\b/i,
  /\b(rm\s+-rf|rmdir|mv\s+|cp\s+.*\s+\/|chmod|chown|sudo|systemctl\s+(start|stop|restart|enable|disable))\b/i,
  /\b(pip\s+install|npm\s+install|yarn\s+add|apt-get\s+install|brew\s+install)\b/i,
  /\b(curl\s+.*(-X\s+(POST|PUT|PATCH|DELETE)|--data|--upload-file))\b/i,
];

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ToolClassification {
  isMutative: boolean;
  reason: string;
  /**
   * True when the classification came from an explicit rule (read-only
   * allowlist hit, bash-command inspection, or a mutative name-pattern hit).
   * False/absent only for the final fallback — i.e. an unknown-named tool
   * that matched no rule at all.
   */
  matchedRule?: boolean;
}

/**
 * Classify a tool call as mutative (needs approval) or read-only (yolo mode).
 */
export function classifyTool(toolName: string, toolArgs?: Record<string, unknown>): ToolClassification {
  const name = toolName.toLowerCase();

  // Explicit read-only allowlist takes priority
  if (READ_ONLY_ALLOWLIST.has(name)) {
    return { isMutative: false, reason: 'read-only allowlist', matchedRule: true };
  }

  if (MUTATIVE_ALLOWLIST.has(name)) {
    return { isMutative: true, reason: 'mutative allowlist', matchedRule: true };
  }

  // Special handling for bash/shell — inspect the command string
  if (name === 'bash' || name === 'shell' || name === 'run_command' || name === 'execute_command') {
    const cmd = String(toolArgs?.command || toolArgs?.cmd || toolArgs?.input || '');
    if (!cmd && toolArgs && Object.keys(toolArgs).length > 0) {
      // Bash-like tool call, but the command wasn't in any of the recognized
      // arg keys (e.g. { script: '...' }) — inspecting an empty string would
      // silently fail open as "read-only". Fail closed instead.
      return { isMutative: true, reason: 'bash-like tool with unrecognized args — needs adjudication', matchedRule: false };
    }
    for (const pattern of MUTATIVE_BASH_PATTERNS) {
      if (pattern.test(cmd)) {
        return { isMutative: true, reason: `mutative bash command: ${cmd.slice(0, 80)}`, matchedRule: true };
      }
    }
    return { isMutative: false, reason: 'read-only bash command', matchedRule: true };
  }

  // Check tool name against mutative patterns. Matched against the tokenized form
  // so snake_case names are seen — see tokenizeName.
  const tokenized = tokenizeName(name);
  for (const pattern of MUTATIVE_PATTERNS) {
    if (pattern.test(tokenized)) {
      return { isMutative: true, reason: `tool name matches mutative pattern: ${pattern}`, matchedRule: true };
    }
  }

  return { isMutative: false, reason: 'no mutative pattern matched', matchedRule: false };
}

/**
 * Given a list of pending tool calls from LangGraph state,
 * return only the ones that require approval.
 */
export function filterMutativeToolCalls(
  toolCalls: Array<{ name: string; args?: Record<string, unknown>; id?: string }>,
): Array<{ name: string; args?: Record<string, unknown>; id?: string; isMutative: boolean; reason: string; matchedRule?: boolean }> {
  return toolCalls
    .map((tc) => ({ ...tc, ...classifyTool(tc.name, tc.args) }))
    .filter((tc) => tc.isMutative);
}
