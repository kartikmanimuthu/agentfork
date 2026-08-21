import { describe, it, expect } from 'vitest';
import { classifyTool, filterMutativeToolCalls } from './tool-classifier';

describe('classifyTool', () => {
  it('treats explicit read-only allowlist entries as safe', () => {
    expect(classifyTool('describe_instances').isMutative).toBe(false);
    expect(classifyTool('list_buckets').isMutative).toBe(false);
    expect(classifyTool('read_file').isMutative).toBe(false);
  });

  it('falls through unknown, non-pattern-matching tool names as non-mutative with matchedRule:false', () => {
    // Not in the AWS-specific allowlist and no verb pattern matches these —
    // exactly how nucleus classifies them (no dedicated allowlist entries
    // exist for these since they never collide with a mutative pattern).
    expect(classifyTool('search_memory')).toEqual({ isMutative: false, reason: 'no mutative pattern matched', matchedRule: false });
    expect(classifyTool('ask_user')).toEqual({ isMutative: false, reason: 'no mutative pattern matched', matchedRule: false });
    expect(classifyTool('load_skill')).toEqual({ isMutative: false, reason: 'no mutative pattern matched', matchedRule: false });
  });

  it('flags generic mutative verb patterns in snake_case, hyphenated and spaced names', () => {
    // Names are matched against a tokenized form (`_`/`-` → space) because the
    // patterns are \b-bounded and `_` is a regex word character. Previously
    // "create_resource" did NOT match \bcreate\b, which silently left every
    // snake_case integration tool ungated — see tokenizeName in tool-classifier.ts.
    expect(classifyTool('create_resource').isMutative).toBe(true);
    expect(classifyTool('create-resource').isMutative).toBe(true);
    expect(classifyTool('delete-record').isMutative).toBe(true);
    expect(classifyTool('deploy-service').isMutative).toBe(true);
    // "save_memory" contains no mutative verb at all ("save" isn't a pattern).
    expect(classifyTool('save_memory').isMutative).toBe(false);
  });

  it('gates the real mutative integration tools', () => {
    for (const name of [
      'gmail_send_message',
      'outlook_send_message',
      'email_send_message',
      'google_calendar_create_event',
      'google_calendar_update_event',
      'google_calendar_delete_event',
      'google_drive_create_file',
      'notion_create_page',
      'github_create_issue',
      'github_create_comment',
      'hubspot_create_note',
      'hubspot_update_contact',
      'jira_create_issue',
      'jira_add_comment',
      'write_workspace_file',
      'edit_workspace_file',
      'create_scheduled_task',
      'linear_create_issue',
      'gitlab_create_issue',
      'confluence_create_page',
      'zendesk_create_ticket',
      'clickup_create_task',
      'clickup_update_task',
      'clickup_add_comment',
      'asana_create_task',
      'attio_create_note',
      'close_create_lead',
      'close_update_opportunity',
      'close_log_note',
      'docusign_send_from_template',
      'whatsapp_send_message',
      'whatsapp_send_template',
      'figma_post_comment',
    ]) {
      expect(classifyTool(name).isMutative, `${name} must require approval`).toBe(true);
    }
  });

  it('leaves the real read-only integration tools ungated', () => {
    for (const name of [
      'gmail_search_messages',
      'gmail_get_message',
      'outlook_search_messages',
      'outlook_list_events',
      'email_search_messages',
      'email_read_message',
      'google_calendar_list_events',
      'google_calendar_check_availability',
      'google_drive_list_files',
      'google_drive_search_files',
      'google_drive_read_file',
      'notion_search_pages',
      'notion_get_page',
      'github_list_issues',
      'github_get_issue',
      'github_search_repos',
      'hubspot_search_contacts',
      'hubspot_get_contact',
      'jira_search_issues',
      'jira_get_issue',
      'jira_list_projects',
      'list_workspace_files',
      'read_workspace_file',
      'search_memory',
      'load_skill',
      'linear_search_issues',
      'linear_get_issue',
      'linear_list_teams',
      'gitlab_search',
      'gitlab_get_issue',
      'gitlab_get_merge_request',
      'confluence_search',
      'confluence_get_page',
      'zendesk_search',
      'zendesk_get_ticket',
      'clickup_list_teams',
      'clickup_list_spaces',
      'clickup_list_lists',
      'clickup_list_tasks',
      'clickup_get_task',
      'asana_list_workspaces',
      'asana_search_tasks',
      'asana_get_task',
      'attio_list_objects',
      'attio_query_records',
      'attio_get_record',
      'apollo_enrich_person',
      'apollo_enrich_company',
      'apollo_search_people',
      'hunter_domain_search',
      'hunter_find_email',
      'hunter_verify_email',
      'close_search_leads',
      'close_get_lead',
      'close_list_opportunities',
      'stripe_search_customers',
      'stripe_list_charges',
      'stripe_list_invoices',
      'quickbooks_query',
      'quickbooks_list_customers',
      'quickbooks_list_invoices',
      'quickbooks_get_report',
      'dropbox_search',
      'dropbox_list_folder',
      'dropbox_read_file',
      'box_search',
      'box_list_folder',
      'box_read_file',
      'posthog_query',
      'posthog_list_insights',
      'mixpanel_segmentation',
      'mixpanel_top_events',
      'amplitude_active_users',
      'amplitude_event_totals',
      'figma_get_file',
      'figma_get_comments',
      'figma_export_images',
      'canva_list_designs',
      'canva_get_design',
      'canva_export_design',
      'canva_get_export',
      'docusign_list_envelopes',
      'docusign_get_envelope',
      'docusign_list_templates',
    ]) {
      expect(classifyTool(name).isMutative, `${name} must NOT require approval`).toBe(false);
    }
  });

  it('inspects command content for a tool literally named "bash", same as shell/run_command/execute_command', () => {
    expect(classifyTool('bash', { command: 'ls -la' }).isMutative).toBe(false);
    expect(classifyTool('bash', { command: 'rm -rf /tmp/x' }).isMutative).toBe(true);
  });

  it('inspects command content for the OTHER shell-like names (shell/run_command/execute_command), which are not allowlisted', () => {
    expect(classifyTool('shell', { command: 'ls -la' }).isMutative).toBe(false);
    expect(classifyTool('shell', { command: 'rm -rf /tmp/x' }).isMutative).toBe(true);
    expect(classifyTool('run_command', { command: 'git push origin main' }).isMutative).toBe(true);
    expect(classifyTool('execute_command', { command: 'curl -X POST https://x' }).isMutative).toBe(true);
    expect(classifyTool('shell', { command: 'aws ec2 describe-instances' }).isMutative).toBe(false);
    expect(classifyTool('shell', { command: 'aws ec2 terminate-instances --instance-ids i-123' }).isMutative).toBe(true);
  });

  it('fails closed for shell-like calls with no recognized arg key', () => {
    const result = classifyTool('shell', { weirdKey: 'rm -rf /' });
    expect(result.matchedRule).toBe(false);
    expect(result.isMutative).toBe(true);
  });

  it('filters a mixed batch down to only the mutative calls', () => {
    const calls = [
      { name: 'describe_instances', args: {} },
      { name: 'delete-record', args: {} },
      { name: 'search_memory', args: {} },
    ];
    const mutative = filterMutativeToolCalls(calls);
    expect(mutative.map((c) => c.name)).toEqual(['delete-record']);
  });
});

describe('browser tool classification', () => {
  // Without an explicit allowlist these four fail OPEN: tokenizeName turns
  // `browser_click` into "browser click", and MUTATIVE_PATTERNS has no click /
  // type / select / open entry, so the approval gate never fires for an agent
  // acting on a page.
  it.each(['browser_open_url', 'browser_click', 'browser_type', 'browser_select', 'browser_upload_file'])(
    'gates %s',
    (name) => {
      expect(classifyTool(name).isMutative).toBe(true);
    },
  );

  it.each(['browser_snapshot', 'browser_get_text', 'browser_wait', 'browser_screenshot', 'browser_close'])(
    'does not gate %s',
    (name) => {
      expect(classifyTool(name).isMutative).toBe(false);
    },
  );

  it('reports the allowlist as an explicit rule match, not a pattern guess', () => {
    const result = classifyTool('browser_click');
    expect(result.matchedRule).toBe(true);
    expect(result.reason).toMatch(/allowlist/i);
  });
});
