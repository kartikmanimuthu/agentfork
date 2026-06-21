import { createLogger } from '../logging/logger';
import type { LLMProvider } from '@chatbot/ai';
import { streamChat } from '@chatbot/ai';
import { ScoreService, type ScoreDb, type ScoreTargetType, type ScoreValue } from './score-service';
import type { ScoreDataType } from './score-config-service';

const logger = createLogger('evaluator-runner-service');

export interface EvaluatorRunnerDb extends ScoreDb {
  evaluator: {
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<EvaluatorRow | null>;
  };
  inferenceSessionMessage: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<MessageTarget | null> };
  inferenceSession: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<SessionTarget | null> };
  apiKeyExecution: { findFirst(args: { where: Record<string, unknown> }): Promise<ExecutionTarget | null> };
}

interface EvaluatorRow {
  id: string;
  tenantId: string;
  name: string;
  prompt: string;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  scoreConfig: { id: string; dataType: ScoreDataType; categories: unknown };
}

interface MessageTarget {
  id: string;
  role: string;
  content: string;
  session: { tenantId: string };
}
interface SessionTarget {
  id: string;
  tenantId: string;
  messages?: Array<{ role: string; content: string }>;
}
interface ExecutionTarget {
  id: string;
  tenantId: string;
  input: unknown;
  output: unknown;
}

export interface RunEvaluatorInput {
  tenantId: string;
  evaluatorId: string;
  provider: LLMProvider;
  targetType: ScoreTargetType;
  targetId: string;
}

export class EvaluatorRunnerService {
  private readonly scoreService: ScoreService;

  constructor(private readonly db: EvaluatorRunnerDb) {
    this.scoreService = new ScoreService(db);
  }

  private async loadEvaluator(tenantId: string, evaluatorId: string): Promise<EvaluatorRow> {
    const evaluator = (await this.db.evaluator.findFirst({
      where: { id: evaluatorId, tenantId, isActive: true },
      include: { scoreConfig: { select: { id: true, dataType: true, categories: true } } },
    })) as EvaluatorRow | null;
    if (!evaluator) throw new Error('Evaluator not found or inactive');
    return evaluator;
  }

  private async resolveTargetContent(tenantId: string, targetType: ScoreTargetType, targetId: string): Promise<string> {
    if (targetType === 'MESSAGE') {
      const msg = await this.db.inferenceSessionMessage.findFirst({
        where: { id: targetId },
        include: { session: { select: { tenantId: true } } },
      });
      if (!msg || msg.session.tenantId !== tenantId) throw new Error('Target message not found');
      return `Role: ${msg.role}\nContent: ${msg.content}`;
    }
    if (targetType === 'SESSION') {
      const session = await this.db.inferenceSession.findFirst({
        where: { id: targetId, tenantId },
        include: { messages: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true } } },
      });
      if (!session) throw new Error('Target session not found');
      return (session.messages ?? []).map((m) => `${m.role}: ${m.content}`).join('\n');
    }
    const execution = await this.db.apiKeyExecution.findFirst({ where: { id: targetId, tenantId } });
    if (!execution) throw new Error('Target execution not found');
    return `Input:\n${JSON.stringify(execution.input, null, 2)}\n\nOutput:\n${JSON.stringify(execution.output, null, 2)}`;
  }

  private buildJsonInstruction(dataType: ScoreDataType): string {
    if (dataType === 'NUMERIC') return 'Respond with JSON: {"score": number, "reason": string}';
    if (dataType === 'CATEGORICAL') return 'Respond with JSON: {"label": string, "reason": string}';
    return 'Respond with JSON: {"passed": boolean, "reason": string}';
  }

  private parseResult(dataType: ScoreDataType, text: string): { value: ScoreValue; reason?: string } {
    const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch (err) {
      logger.error({ err, raw: text }, 'Failed to parse evaluator JSON response');
      throw new Error('Evaluator did not return valid JSON');
    }
    if (dataType === 'NUMERIC') return { value: Number(parsed.score), reason: typeof parsed.reason === 'string' ? parsed.reason : undefined };
    if (dataType === 'CATEGORICAL') return { value: String(parsed.label), reason: typeof parsed.reason === 'string' ? parsed.reason : undefined };
    return { value: Boolean(parsed.passed), reason: typeof parsed.reason === 'string' ? parsed.reason : undefined };
  }

  async run(input: RunEvaluatorInput): Promise<unknown> {
    try {
      const evaluator = await this.loadEvaluator(input.tenantId, input.evaluatorId);
      const targetContent = await this.resolveTargetContent(input.tenantId, input.targetType, input.targetId);
      const instruction = this.buildJsonInstruction(evaluator.scoreConfig.dataType);
      const fullPrompt = `${evaluator.prompt}\n\n---\n${instruction}\n\nTarget:\n${targetContent}`;

      logger.info({ tenantId: input.tenantId, evaluatorId: evaluator.id, targetType: input.targetType }, 'Running evaluator');

      const result = streamChat({
        provider: input.provider,
        model: evaluator.model ?? undefined,
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: evaluator.temperature ?? 0.7,
        maxOutputTokens: evaluator.maxTokens ?? 4096,
      });

      const text = await result.text;
      const { value, reason } = this.parseResult(evaluator.scoreConfig.dataType, text);

      return await this.scoreService.ingest({
        tenantId: input.tenantId,
        configId: evaluator.scoreConfig.id,
        targetType: input.targetType,
        targetId: input.targetId,
        value,
        comment: reason ? `Evaluator: ${evaluator.name}. ${reason}` : `Evaluator: ${evaluator.name}`,
        source: 'EVALUATOR',
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, evaluatorId: input.evaluatorId }, 'Failed to run evaluator');
      throw error;
    }
  }
}
