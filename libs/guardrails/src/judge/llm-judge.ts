import { tool, jsonSchema } from 'ai';
import { createLLMProvider } from '@chatbot/ai';
import type { TenantLLMConfig } from '@chatbot/ai';
import { TenantConfigService, createLogger } from '@chatbot/shared';
import { judgeSystemPrompt, judgeUserPrompt } from './prompts';
import type { GuardrailsConfig } from '../config/schema';

const logger = createLogger('guardrail:judge');

export interface JudgeVerdict {
  violated: boolean;
  category?: string;
  confidence: number;
  degraded?: boolean;
}

export interface JudgeContext {
  config: GuardrailsConfig;
  tenantId: string;
  agentId: string;
  agentVersionId?: string;
}

const JUDGE_TIMEOUT_MS = 5000;

async function resolveJudgeModelConfig(ctx: JudgeContext): Promise<TenantLLMConfig | null> {
  const tenantConfig = new TenantConfigService(ctx.tenantId);
  const llmConfig = await tenantConfig.get<TenantLLMConfig>('llmConfig');
  if (!llmConfig) return null;
  // Default to a small/cheap classifier unless the agent overrides the judge model.
  return { ...llmConfig, chatModel: ctx.config.judge.model ?? llmConfig.chatModel };
}

export async function judgeText(args: {
  text: string;
  categories: string[];
  ctx: JudgeContext;
}): Promise<JudgeVerdict> {
  const { text, categories, ctx } = args;
  if (!ctx.config.judge.enabled) return { violated: false, confidence: 0 };

  try {
    const judgeConfig = await resolveJudgeModelConfig(ctx);
    if (!judgeConfig) {
      logger.warn({ tenantId: ctx.tenantId }, 'No judge model config — failing open');
      return { violated: false, confidence: 0, degraded: true };
    }
    const provider = createLLMProvider(judgeConfig);

    const providerPromise = provider.generateText({
      messages: [{ role: 'user', content: judgeUserPrompt(text) } as any],
      system: judgeSystemPrompt(categories),
      tools: {
        submit_verdict: tool({
          description: 'Submit the classification verdict.',
          inputSchema: jsonSchema({
            type: 'object',
            properties: {
              violated: { type: 'boolean' },
              category: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['violated', 'confidence'],
          }),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_verdict' },
    });
    // Swallow any late rejection if the timeout wins the race, so a provider
    // error that fires after the timeout doesn't surface as an unhandledRejection.
    providerPromise.catch(() => {});

    const result = await Promise.race([
      providerPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('judge-timeout')), JUDGE_TIMEOUT_MS)),
    ]) as { toolCalls: Array<{ toolName: string; args: any }> };

    const verdict = result.toolCalls?.[0]?.args ?? { violated: false, confidence: 0 };
    return { violated: !!verdict.violated, category: verdict.category, confidence: verdict.confidence ?? 0 };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ tenantId: ctx.tenantId, agentId: ctx.agentId, errorMessage: error.message }, 'Judge failed — failing open');
    return { violated: false, confidence: 0, degraded: true };
  }
}