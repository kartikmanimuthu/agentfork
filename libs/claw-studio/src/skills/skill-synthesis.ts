/**
 * skill-synthesis.ts — domain-level autonomous skill synthesis, ported from
 * nucleus lib/agent/memory/skill-synthesis.ts. Replaces per-rule promotion:
 * when a procedural domain accumulates enough MATURED rules, a distiller
 * authors a narrative playbook and code appends a deterministic ledger of
 * every matured rule (knowledge can never be lost to distiller omission).
 * One system skill per domain (`sys-<domain>`), content re-synthesized as
 * rules mature. Tier is LOCKED 'read-only'. Disabled system skill = veto
 * (stamp, don't touch). User-owned slugs are inviolable. At most one domain
 * per run. Never throws.
 *
 * Bridge: `agent_memories` -> `claw_memories`, and the query is scoped by
 * `(tenantId, userId)` — nucleus scopes by tenantId only, since its Skill/
 * memory model has no per-agent identity; Claw's memories already carry
 * `userId = claw.id` (Plan C2 convention), so this port filters by it too to
 * stay exactly scoped to the Claw whose memories are being examined.
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { extractTextContent } from '../agent/agent-shared';
import { getMemoryService } from '../memory/memory-service';

const logger = createLogger('claw-studio:skill-synthesis');

export function autoSkillCreationEnabled(): boolean {
  const v = process.env.AUTO_SKILL_CREATION_ENABLED?.toLowerCase();
  return !(v === 'false' || v === '0');
}

export function autoSkillMaturityThreshold(): number {
  const n = Number(process.env.AUTO_SKILL_MATURITY_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function skillSynthesisMinRules(): number {
  const n = Number(process.env.SKILL_SYNTHESIS_MIN_RULES);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

const MAX_EPISODES = 3;

interface RuleRow {
  id: string;
  key: string;
  value: Record<string, unknown>;
  sourceThreadId: string | null;
  accessCount: number;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const DISTILLER_SYSTEM = new SystemMessage(
  `You author an operational skill document for an AI teammate, distilled from
rules the agent learned across real sessions (with episode evidence where available).
Return ONLY a JSON object: {"name": "...", "description": "...", "narrative": "..."}
- name: concise Title Case skill name (max 6 words) for the domain.
- description: one sentence saying when to use this skill.
- narrative: markdown with exactly these sections: "## Purpose", "## When to use",
  "## Workflow guidance", "## Safety notes". Ground every claim in the provided rules and
  episodes — never invent capabilities. Do NOT include a rules list; it is appended separately.`,
);

export async function synthesizeDomainSkills(params: {
  tenantId: string;
  userId: string;
  threadId?: string;
  distillerModel: BaseChatModel;
}): Promise<number> {
  if (!autoSkillCreationEnabled()) return 0;
  try {
    const prisma = getPrismaClient();
    const threshold = autoSkillMaturityThreshold();
    const minRules = skillSynthesisMinRules();

    // 1. Best candidate domain (tenant+claw bound; bare "procedures" namespaces excluded).
    const candidates = await prisma.$queryRaw<Array<{ domain: string; matured: number; pending: number }>>`
      SELECT split_part("namespace", '/', 2) AS domain,
             COUNT(*)::int AS matured,
             (COUNT(*) FILTER (WHERE ("value"->>'synthesizedIntoSkill') IS NULL))::int AS pending
      FROM claw_memories
      WHERE "tenantId" = ${params.tenantId}
        AND "userId" = ${params.userId}
        AND "kind" = 'PROCEDURAL'
        AND "supersededById" IS NULL
        AND "accessCount" >= ${threshold}
        AND split_part("namespace", '/', 2) <> ''
      GROUP BY 1
      HAVING COUNT(*) >= ${minRules}
         AND COUNT(*) FILTER (WHERE ("value"->>'synthesizedIntoSkill') IS NULL) >= 1
      ORDER BY 3 DESC
      LIMIT 1
    `;
    if (!candidates.length) return 0;
    const { domain, matured, pending } = candidates[0];
    const slug = `sys-${domain}`;
    logger.info({ tenantId: params.tenantId, userId: params.userId, domain, matured, pending, slug }, '[skill-synthesis] candidate domain found');

    // 2. Ownership / veto guard.
    const svc = getMemoryService();
    const existing = await prisma.clawSkill.findFirst({ where: { tenantId: params.tenantId, slug } });
    if (existing && existing.source !== 'system') {
      logger.warn({ tenantId: params.tenantId, slug, domain }, '[skill-synthesis] slug is user-owned — skipped');
      return 0;
    }

    // 3. Gather ALL matured rules for the domain (re-synthesis is total).
    const rules = await prisma.$queryRaw<RuleRow[]>`
      SELECT "id","key","value","sourceThreadId","accessCount"
      FROM claw_memories
      WHERE "tenantId" = ${params.tenantId}
        AND "userId" = ${params.userId}
        AND "kind" = 'PROCEDURAL'
        AND "supersededById" IS NULL
        AND "accessCount" >= ${threshold}
        AND split_part("namespace", '/', 2) = ${domain}
      ORDER BY "accessCount" DESC, "key" ASC
    `;
    if (!rules.length) return 0;
    const pendingRules = rules.filter((r) => !(r.value as Record<string, unknown>).synthesizedIntoSkill);
    const stampAll = async () => {
      for (const r of pendingRules) {
        try {
          await svc.update(params.tenantId, r.id, { ...r.value, synthesizedIntoSkill: slug });
        } catch (err) {
          logger.warn({ err, tenantId: params.tenantId, key: r.key }, '[skill-synthesis] failed to stamp rule (non-fatal)');
        }
      }
    };

    // Disabled system skill = standing veto: acknowledge the rules, touch nothing.
    if (existing && !existing.isEnabled) {
      logger.info({ tenantId: params.tenantId, slug, pending: pendingRules.length }, '[skill-synthesis] skill disabled (user veto) — stamping only');
      await stampAll();
      return 0;
    }

    // 4. Episode evidence via provenance join (the runs that taught these rules).
    const threadKeys = Array.from(new Set(
      rules.map((r) => r.sourceThreadId).filter((t): t is string => !!t).map((t) => `thread-${t}`),
    ));
    let episodes: Array<{ key: string; value: Record<string, unknown> }> = [];
    if (threadKeys.length) {
      try {
        episodes = await prisma.$queryRaw<Array<{ key: string; value: Record<string, unknown> }>>`
          SELECT DISTINCT "key","value"
          FROM claw_memories
          WHERE "tenantId" = ${params.tenantId}
            AND "userId" = ${params.userId}
            AND "kind" = 'EPISODIC'
            AND "supersededById" IS NULL
            AND "key" = ANY(${threadKeys}::text[])
          LIMIT ${MAX_EPISODES}
        `;
      } catch {
        // evidence is optional
      }
    }

    // 5. Distill the narrative. Rules missing trigger/instruction (only possible on
    // manually-mutated/legacy rows — the save-time validator forbids them) are excluded
    // from all rendered content so 'undefined' never reaches a prompt or skill body.
    const renderableRules = rules.filter((r) => {
      const v = r.value as { instruction?: string; trigger?: string };
      return !!v?.instruction && !!v?.trigger;
    });
    if (!renderableRules.length) {
      logger.warn({ tenantId: params.tenantId, domain }, '[skill-synthesis] no renderable rules — skipped');
      return 0;
    }
    const rulesText = renderableRules.map((r) => {
      const v = r.value as { instruction?: string; trigger?: string; evidence?: string };
      return `- [${r.key}] When ${v.trigger}: ${v.instruction} (evidence: ${v.evidence || 'n/a'}; reinforced ${r.accessCount}x)`;
    }).join('\n');
    const episodesText = episodes.map((e) => {
      const v = e.value as { context?: string; outcome?: string };
      return `- ${v.context ?? '(context n/a)'} → ${v.outcome ?? '(outcome n/a)'}`;
    }).join('\n') || '(none)';
    const input = new HumanMessage(
      `**Domain:** ${domain}\n\n**Matured rules:**\n${rulesText}\n\n` +
      `**Episode evidence:**\n${episodesText}\n\n` +
      `**Existing skill content:**\n${existing?.content ? existing.content.slice(0, 6000) : '(none — new skill)'}\n\n` +
      `Author the skill document now.`,
    );

    const resp = await params.distillerModel.invoke([DISTILLER_SYSTEM, input]);
    const content = extractTextContent(resp.content);
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn({ tenantId: params.tenantId, domain }, '[skill-synthesis] distiller returned no JSON — will retry next run');
      return 0;
    }
    const parsed = JSON.parse(match[0]) as { name?: string; description?: string; narrative?: string };
    if (!isNonEmptyString(parsed.name) || !isNonEmptyString(parsed.description) || !isNonEmptyString(parsed.narrative)) {
      logger.warn({ tenantId: params.tenantId, domain }, '[skill-synthesis] distiller output invalid — will retry next run');
      return 0;
    }

    // 6. Assemble: narrative + code-guaranteed rule ledger.
    const ledger = renderableRules.map((r) => {
      const v = r.value as { instruction?: string; trigger?: string; evidence?: string };
      return `- When ${v.trigger}: ${v.instruction} — evidence: ${v.evidence || '(not recorded)'}`;
    }).join('\n');
    const skillContent =
      `${parsed.narrative.trim()}\n\n` +
      `## Learned rules & gotchas\n${ledger}\n\n` +
      `_Synthesized by Claw from ${renderableRules.length} matured procedural rules. ` +
      `Managed automatically — content refreshes as new rules mature; disable this skill to stop updates._`;

    // 7. Create or update.
    if (!existing) {
      try {
        await prisma.clawSkill.create({
          data: {
            tenantId: params.tenantId, slug, name: parsed.name.trim(), description: parsed.description.trim(),
            tier: 'read-only', content: skillContent, source: 'system', isEnabled: true,
            createdBy: null, sourceRunId: params.threadId ?? null,
          },
        });
        logger.info({ tenantId: params.tenantId, domain, slug, rules: rules.length }, '[skill-synthesis] created skill');
      } catch (err) {
        if ((err as { code?: string })?.code !== 'P2002') throw err;
        const winner = await prisma.clawSkill.findFirst({ where: { tenantId: params.tenantId, slug } });
        if (!winner || winner.source !== 'system') {
          logger.warn({ tenantId: params.tenantId, slug }, '[skill-synthesis] created concurrently by another owner — skipped');
          return 0;
        }
        await prisma.clawSkill.update({ where: { id: winner.id }, data: { content: skillContent, description: parsed.description.trim() } });
        logger.info({ tenantId: params.tenantId, slug }, '[skill-synthesis] refreshed after create race');
      }
    } else {
      await prisma.clawSkill.update({ where: { id: existing.id }, data: { content: skillContent, description: parsed.description.trim() } });
      logger.info({ tenantId: params.tenantId, domain, slug, rules: rules.length }, '[skill-synthesis] refreshed skill content');
    }

    // 8. Acknowledge incorporation.
    await stampAll();
    return 1;
  } catch (err) {
    logger.warn({ err, tenantId: params.tenantId }, '[skill-synthesis] synthesis failed (non-fatal)');
    return 0;
  }
}
