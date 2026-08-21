/**
 * skill-tool.ts — progressive disclosure of skills as a tool, ported from
 * nucleus lib/agent/skill-tool.ts. The system prompt carries only the skill
 * catalog (name + description); the agent calls load_skill(skill_id) at the
 * moment a task phase needs those instructions. Tenant-scoped and
 * enabled-only: getSkillContent() returns null for disabled/unknown slugs,
 * so a disabled skill (veto) can never be loaded mid-run.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { getSkillContent, getSkillSummaries } from './skill-service';

const logger = createLogger('claw-studio:skill-tool');

export function createLoadSkillTool(tenantId: string) {
  return tool(
    async ({ skill_id }: { skill_id: string }) => {
      const slug = skill_id.trim();
      const content = await getSkillContent(tenantId, slug);
      if (!content) {
        const catalog = await getSkillSummaries(tenantId).catch(() => 'No specialized skills available.');
        return `Error: skill "${slug}" not found or not enabled for this tenant.\n\n${catalog}`;
      }
      logger.info({ tenantId, slug }, '[load_skill] loaded skill into context');
      return `=== SKILL LOADED: ${slug.toUpperCase()} ===\n${content}\n=== END SKILL ===\n\nFollow these instructions — they define your privileges, safety constraints, and workflow — for all work within this skill's scope.`;
    },
    {
      name: 'load_skill',
      description:
        'Load the full instructions of a specialized skill by its id. The available skills are listed in your system prompt under "Available Skills". Call this BEFORE starting work that a skill\'s description covers — the loaded instructions define privileges, safety rules, and workflow for that scope. You may load multiple skills over the course of one task as different phases require them. Do not call it for skills already loaded in this conversation.',
      schema: z.object({
        skill_id: z.string().describe('The skill id (slug) exactly as listed in the Available Skills catalog'),
      }),
    },
  );
}
