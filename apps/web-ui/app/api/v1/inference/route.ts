import { NextRequest } from 'next/server';
import {
  getPrismaClient,
  createLogger,
  QuotaService,
  ResponseCacheService,
  InferenceSessionService,
  LlmProviderService,
  TenantConfigService,
  WebhookService,
  S3Service,
  PausedExecutionService,
  WorkflowEngine,
  type WorkflowDefinition,
  type WorkflowCursor,
  type ResolveResult,
} from '@chatbot/shared';
import {
  streamChat,
  createLLMProvider,
  type TenantLLMConfig,
  ContentResolver,
  type MessageAttachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
  PartStreamEmitter,
  generateSpreadsheet,
  generatePdf,
  toSseFrame,
  type FileUploader,
  type StreamEvent,
  type MessagePart,
} from '@chatbot/ai';
import type { ToolSet } from 'ai';
import { jsonSchema } from 'ai';
import { validateInferenceApiKey } from './lib/auth';
import { z } from 'zod';

const logger = createLogger('api:inference');

const contentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('file'),
    fileId: z.string(),
    s3Key: z.string(),
    mimeType: z.string().optional(),
    fileName: z.string().optional(),
    size: z.number().optional(),
  }),
]);

const inferenceRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([z.string(), z.array(contentPartSchema)]).optional(),
  })).min(1),
  sessionId: z.string().optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  noCache: z.boolean().optional(),
  alias: z.string().optional(),
  versionId: z.string().optional(),
});

async function resolveProviderForModel(
  tenantId: string,
  modelId: string | undefined
): Promise<TenantLLMConfig | null> {
  if (!modelId) return null;
  const llmProviderService = new LlmProviderService(tenantId);
  const providers = await llmProviderService.list();
  for (const provider of providers) {
    const discovered = (provider.models as { models?: Array<{ id: string }> } | null)?.models ?? [];
    if (discovered.some((m) => m.id === modelId)) {
      return llmProviderService.getConfigById(provider.id);
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { tenantId, apiKeyId, agentId, apiKey: keyLimits } = authResult.auth;

  try {
    const db = getPrismaClient();
    const quotaService = new QuotaService(apiKeyId, db);
    const cacheService = new ResponseCacheService(db);
    const sessionService = new InferenceSessionService(db);
    const webhookService = new WebhookService();

    // Quota check (daily + sliding minute window)
    const quotaCheck = await quotaService.checkQuota({
      dailyReqLimit: keyLimits.dailyReqLimit,
      dailyTokenLimit: keyLimits.dailyTokenLimit,
      minuteReqLimit: keyLimits.minuteReqLimit,
    });

    if (!quotaCheck.allowed) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': String(keyLimits.dailyReqLimit),
        'X-RateLimit-Remaining': '0',
        'X-TokenLimit-Limit': String(keyLimits.dailyTokenLimit),
      };
      if (quotaCheck.retryAfter) {
        headers['Retry-After'] = String(quotaCheck.retryAfter);
      }

      return new Response(
        JSON.stringify({ error: { type: 'quota_exceeded', message: quotaCheck.reason } }),
        { status: 429, headers }
      );
    }

    const body = await req.json();
    const parsed = inferenceRequestSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn(
        { tenantId, apiKeyId, validationError: parsed.error.issues[0]?.message },
        'Inference request validation failed',
      );
      return new Response(
        JSON.stringify({ error: { type: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid request body' } }),
        { status: 400 }
      );
    }

    const {
      messages,
      sessionId,
      systemPrompt,
      temperature,
      maxTokens,
      stream = true,
      noCache = false,
      alias,
      versionId: requestedVersionId,
    } = parsed.data;

    // ─── Normalize content-parts messages ────────────────────────────────
    // Each message content may be a plain string or an array of content parts.
    // File metadata is extracted for session persistence; actual file resolution
    // happens later via ContentResolver before LLM invocation.
    const s3 = new S3Service();
    const contentResolver = new ContentResolver(s3);

    type NormalizedMessage = { role: string; content: string; attachments: MessageAttachment[] };
    const normalizedMessages: NormalizedMessage[] = [];

    let totalAttachments = 0;
    let rejectedAttachments = 0;

    for (const msg of messages) {
      if (typeof msg.content === 'string' || msg.content == null) {
        normalizedMessages.push({ role: msg.role, content: msg.content ?? '', attachments: [] });
        continue;
      }

      // Array content — split into text parts and file parts
      const textParts = msg.content.filter((p) => p.type === 'text').map((p) => p.text ?? '');
      const fileParts = msg.content.filter((p) => p.type === 'file');

      const validFileParts = fileParts.filter((p) => p.fileId && p.s3Key);
      const cappedFileParts = validFileParts.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);

      const attachments: MessageAttachment[] = cappedFileParts
        .map((p) => ({
          fileId: p.fileId!,
          s3Key: p.s3Key!,
          mimeType: p.mimeType ?? 'application/octet-stream',
          fileName: p.fileName ?? p.fileId!,
          size: p.size ?? 0,
        }))
        .filter((a) => a.s3Key.startsWith(`sdk-uploads/${tenantId}/`));

      const rejected = cappedFileParts.length - attachments.length;
      totalAttachments += attachments.length;
      rejectedAttachments += rejected;

      if (rejected > 0) {
        logger.warn(
          { tenantId, apiKeyId, sessionId, rejected, reason: 'tenant_prefix_mismatch' },
          'Attachments rejected — s3Key does not match tenant prefix',
        );
      }

      normalizedMessages.push({
        role: msg.role,
        content: textParts.join('\n').trim(),
        attachments,
      });
    }

    if (totalAttachments > 0) {
      logger.info(
        { tenantId, apiKeyId, sessionId, messageCount: messages.length, totalAttachments, rejectedAttachments },
        'Multimodal request normalized — attachments extracted from content-parts',
      );
    }

    // Fetch agent
    const agent = await db.agent.findFirst({ where: { id: agentId, tenantId } });
    if (!agent || agent.status !== 'active') {
      return new Response(
        JSON.stringify({ error: { type: 'agent_not_found', message: 'Agent not found or inactive' } }),
        { status: 404 }
      );
    }

    // Resolve version: explicit versionId > alias > default alias > latest published
    let version: { id: string; config: unknown; status: string } | null = null;

    if (requestedVersionId) {
      version = (await db.agentVersion.findFirst({
        where: { id: requestedVersionId, agentId },
      })) as { id: string; config: unknown; status: string };
    }

    if (!version && alias) {
      const aliasService = new (await import('@chatbot/agent-studio')).AgentAliasService(tenantId, db as any);
      try {
        const resolved = await aliasService.resolveAlias(agentId, alias);
        version = { id: resolved.versionId, config: resolved.config, status: 'published' };
      } catch {
        // alias not found — fall through
      }
    }

    if (!version) {
      const defaultAlias = await db.agentAlias.findFirst({
        where: { agentId, isDefault: true },
        include: { version: true },
      });
      if (defaultAlias) {
        version = defaultAlias.version as { id: string; config: unknown; status: string };
      }
    }

    if (!version) {
      version = (await db.agentVersion.findFirst({
        where: { agentId, status: 'published' },
        orderBy: { version: 'desc' },
      })) as { id: string; config: unknown; status: string };
    }

    if (!version) {
      return new Response(
        JSON.stringify({ error: { type: 'agent_not_found', message: 'No published version found for this agent' } }),
        { status: 404 }
      );
    }

    const config = (version.config as Record<string, unknown>) ?? {};
    const startedAt = new Date();

    // ─── Session loading (stateful flow) ─────────────────────────────────
    // For stateful calls (sessionId present): load prior messages, persist agentVersionId
    // on the session if not yet set, and append the incoming user turn(s).
    let priorMessages: Array<{ role: string; content: string; attachments: MessageAttachment[] }> = [];
    let sessionWorkflowCursor: WorkflowCursor | null = null;

    if (sessionId) {
      const session = await sessionService.findActiveById(sessionId);
      if (!session) {
        logger.warn({ tenantId, apiKeyId, sessionId }, 'Session not found or expired');
        return new Response(
          JSON.stringify({ error: { type: 'session_expired', message: 'Session not found, ended, or idle-expired' } }),
          { status: 410 }
        );
      }

      // Capture workflow cursor for this turn
      if (session.workflowState && typeof session.workflowState === 'object') {
        const ws = session.workflowState as Record<string, unknown>;
        if (typeof ws.nodeId === 'string') {
          sessionWorkflowCursor = { nodeId: ws.nodeId };
        }
      }

      priorMessages = (session.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        attachments: (m.attachments as MessageAttachment[]) ?? [],
      }));

      const priorAttachmentCount = priorMessages.reduce((sum, m) => sum + m.attachments.length, 0);
      logger.info(
        { sessionId, priorTurns: priorMessages.length, priorAttachmentCount },
        'Session loaded — prior messages retrieved',
      );

      // Lock the session to this agent version (idempotent)
      if (!session.agentVersionId) {
        await db.inferenceSession.update({
          where: { id: sessionId },
          data: { agentVersionId: version.id },
        });
      }

      // Append the inbound user turn(s) to the session before invoking the model
      for (const msg of normalizedMessages) {
        if (msg.role === 'user') {
          await sessionService.appendMessage(sessionId, {
            role: 'user',
            content: msg.content,
            ...(msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
          });
        }
      }
    }

    // Compose the prompt: prior session turns (if stateful) + the inbound turn(s).
    // Resolve multimodal content — files are fetched from S3 only for the current turn.
    const allMessages = sessionId ? [...priorMessages, ...normalizedMessages] : normalizedMessages;
    const currentTurnIndex = allMessages.length - 1;

    const storedMessages = allMessages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      attachments: m.attachments ?? [],
    }));

    logger.info(
      { tenantId, apiKeyId, sessionId, totalTurns: allMessages.length, currentTurnIndex },
      'Resolving multimodal content before LLM invocation',
    );

    const resolveStartTime = Date.now();
    const resolvedMessages = await contentResolver.resolve(storedMessages, currentTurnIndex);
    const resolveMs = Date.now() - resolveStartTime;

    const sessionMessages = resolvedMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map((p) => {
        if (p.type === 'text') return { type: 'text' as const, text: p.text };
        return { type: 'image' as const, image: p.image, mimeType: p.mimeType };
      }),
    }));

    const hasMultimodalContent = resolvedMessages.some((m) => Array.isArray(m.content));
    logger.info(
      { tenantId, apiKeyId, sessionId, resolveMs, hasMultimodalContent, resolvedTurns: resolvedMessages.length },
      'Content resolution complete — ready for LLM',
    );

    // Create execution row, linked to session for stateful runs
    const execution = await db.apiKeyExecution.create({
      data: {
        apiKeyId,
        tenantId,
        agentId,
        agentVersionId: version.id,
        sessionId: sessionId ?? null,
        status: 'running',
        input: { messages, sessionId, systemPrompt, temperature, maxTokens },
        startedAt,
        webhookUrl: keyLimits.webhookUrl,
      },
    });

    const executionId = execution.id;

    const deliverWebhook = async (
      status: string,
      output?: Record<string, unknown>,
      error?: string,
      tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number },
      latencyMs?: number
    ) => {
      if (!keyLimits.webhookUrl) return;

      const payload = {
        executionId,
        agentId,
        agentVersionId: version!.id,
        sessionId: sessionId ?? null,
        status,
        input: { messages, sessionId },
        output,
        error,
        tokenUsage,
        cacheHit: false,
        latencyMs,
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.deliver(
        keyLimits.webhookUrl,
        keyLimits.webhookSecret,
        payload
      );

      await db.apiKeyExecution.update({
        where: { id: executionId },
        data: {
          webhookStatus: result.success ? 'delivered' : 'failed',
          webhookDeliveredAt: result.success ? new Date() : null,
        },
      });
    };

    // ─── Simple Agent Execution ───────────────────────────────────────────
    if (agent.type === 'simple') {
      const simpleConfig = config as { model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number };
      const effectiveModel = simpleConfig.model ?? undefined;
      const effectiveTemperature = temperature ?? simpleConfig.temperature ?? 0.7;
      const effectiveMaxTokens = maxTokens ?? simpleConfig.maxTokens ?? 4096;

      const llmProviderService = new LlmProviderService(tenantId);
      const llmConfig =
        (await resolveProviderForModel(tenantId, effectiveModel)) ??
        (await llmProviderService.getDefaultConfig()) ??
        (await new TenantConfigService(tenantId).get<TenantLLMConfig>('llmConfig'));
      const provider = createLLMProvider(llmConfig);

      const coreMessages = sessionMessages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content ?? '',
      }));

      const lastUserContent = coreMessages.filter((m) => m.role === 'user').pop()?.content ?? '';
      const userQuery = typeof lastUserContent === 'string'
        ? lastUserContent
        : (lastUserContent as Array<{ type: string; text?: string }>).filter((p) => p.type === 'text').map((p) => p.text ?? '').join(' ');
      const kbContext = await buildKbContext(agentId, tenantId, userQuery, db);

      const { buildMcpToolsForAgent } = await import('@chatbot/agent-studio/server');
      const { tools: mcpTools, cleanup: mcpCleanup } = await buildMcpToolsForAgent(agentId, tenantId, db);
      const hasMcpTools = Object.keys(mcpTools).length > 0;

      let effectiveSystem = systemPrompt ?? simpleConfig.systemPrompt ?? 'You are a helpful assistant.';
      if (kbContext) {
        effectiveSystem = `${effectiveSystem}\n\nUse the following retrieved context to answer questions. If the context does not contain the answer, say so.\n\n${kbContext}`;
      }

      // Cache key (only relevant for stateless calls — stateful calls bypass cache below)
      const cacheKey = cacheService.generateCacheKey({
        agentVersionId: version.id,
        systemPrompt: effectiveSystem,
        messages: coreMessages as any,
        model: effectiveModel ?? 'default',
        temperature: effectiveTemperature,
      });

      // Cache is only consulted for stateless, non-MCP, non-noCache calls.
      // Stateful calls (sessionId present) always bypass — each turn is unique by definition.
      const cacheEligible = !noCache && !hasMcpTools && !sessionId;

      if (cacheEligible) {
        const cached = await cacheService.get(cacheKey);
        if (cached) {
          await mcpCleanup();
          await quotaService.incrementUsage(cached.usage.totalTokens);
          await db.apiKeyExecution.update({
            where: { id: executionId },
            data: {
              status: 'completed',
              output: { text: cached.text },
              tokenUsage: cached.usage as any,
              cacheHit: true,
              completedAt: new Date(),
            },
          });

          await deliverWebhook('completed', { text: cached.text }, undefined, cached.usage, 0);

          return new Response(
            JSON.stringify({
              id: executionId,
              content: cached.text,
              usage: cached.usage,
              cacheHit: true,
            }),
            {
              headers: {
                'Content-Type': 'application/json',
                'X-RateLimit-Limit': String(keyLimits.dailyReqLimit),
                'X-RateLimit-Remaining': String((quotaCheck.remainingRequests ?? 1) - 1),
                'X-TokenLimit-Limit': String(keyLimits.dailyTokenLimit),
                'X-TokenLimit-Remaining': String(
                  (quotaCheck.remainingTokens ?? cached.usage.totalTokens) - cached.usage.totalTokens
                ),
              },
            }
          );
        }
      }

      // Plain SSE format for SDK widget / custom clients
      const sseFormat = req.nextUrl.searchParams.get('format') === 'sse';

      if (stream && sseFormat) {
        const encoder = new TextEncoder();

        // ─── Workflow pre-check ───────────────────────────────────────────
        // If the agent has an active workflow, try to resolve this turn against it.
        // On match: stream scripted events, persist parts + cursor, done.
        // On miss (null): fall through to the LLM path below.
        const incomingValue = normalizedMessages.filter((m) => m.role === 'user').pop()?.content ?? '';
        let workflowResult: ResolveResult | null = null;

        try {
          const activeWorkflow = await db.agentWorkflow.findFirst({
            where: { agentId, isActive: true },
            orderBy: { version: 'desc' },
          });

          if (activeWorkflow) {
            const workflowEngine = new WorkflowEngine((ref) => {
              // Return the ref as-is; the widget renders file parts by URL.
              // Static file refs (s3://bucket/key) are resolved to a path the
              // client can fetch via the existing /api/v1/files endpoint.
              return ref.replace(/^s3:\/\/[^/]+\//, '/api/v1/files/');
            });

            const newMessageId = `wf-${Date.now()}`;
            workflowResult = workflowEngine.resolve(
              activeWorkflow.definition as WorkflowDefinition,
              incomingValue,
              sessionWorkflowCursor,
              newMessageId,
            );

            if (workflowResult) {
              logger.info(
                { tenantId, agentId, sessionId, nodeId: workflowResult.nextCursor?.nodeId ?? 'terminal' },
                'Workflow match — streaming scripted node events',
              );

              const { events: wfEvents, nextCursor } = workflowResult;

              // Persist workflow cursor
              if (sessionId) {
                await sessionService.setWorkflowState(sessionId, nextCursor);
              }

              // Build parts from workflow events for persistence
              const wfParts: MessagePart[] = [];
              for (const ev of wfEvents) {
                if (ev.type === 'part_start' && ev.part) {
                  wfParts.push(ev.part as unknown as MessagePart);
                } else if (ev.type === 'part_start' && ev.partType === 'text') {
                  wfParts.push({ type: 'text', text: '' });
                } else if (ev.type === 'token' && wfParts.length > 0) {
                  const last = wfParts[wfParts.length - 1];
                  if (last && last.type === 'text') {
                    (last as { type: 'text'; text: string }).text += ev.content ?? '';
                  }
                }
              }

              const wfText = wfParts.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; text: string }).text).join('');

              if (sessionId) {
                await sessionService.appendMessage(sessionId, {
                  role: 'assistant',
                  content: wfText,
                  parts: wfParts,
                });
              }

              const wfCompletedAt = new Date();
              const wfLatencyMs = wfCompletedAt.getTime() - startedAt.getTime();

              await db.apiKeyExecution.update({
                where: { id: executionId },
                data: { status: 'completed', output: { text: wfText }, cacheHit: false, latencyMs: wfLatencyMs, completedAt: wfCompletedAt },
              });

              await deliverWebhook('completed', { text: wfText }, undefined, undefined, wfLatencyMs);

              const wfReadable = new ReadableStream({
                start(controller) {
                  for (const ev of wfEvents) {
                    controller.enqueue(encoder.encode(toSseFrame(ev as StreamEvent)));
                  }
                  controller.close();
                },
              });

              return new Response(wfReadable, {
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive',
                  'X-Execution-Id': executionId,
                  ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
                },
              });
            }
          }
        } catch (wfErr) {
          const wfError = wfErr instanceof Error ? wfErr : new Error(String(wfErr));
          logger.warn(
            { tenantId, agentId, sessionId, errorMessage: wfError.message },
            'Workflow resolution error — falling back to LLM',
          );
          // Fall through to LLM path
        }

        // ─── LLM SSE path (PartStreamEmitter over fullStream) ────────────
        const s3Uploader = new S3Service();
        const fileUploader: FileUploader = {
          async upload(buffer, filename, mimeType) {
            const key = `generated/${tenantId}/${Date.now()}-${filename}`;
            await s3Uploader.uploadBuffer(key, buffer, mimeType);
            const url = await s3Uploader.getDownloadUrl(key, 3600);
            return { url, key };
          },
        };

        const fileGenTools: ToolSet = {};
        (fileGenTools as any)['generate_spreadsheet'] = {
          description: 'Generate a downloadable Excel spreadsheet from structured data',
          inputSchema: jsonSchema({
            type: 'object',
            properties: {
              filename: { type: 'string' },
              sheets: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    rows: { type: 'array', items: { type: 'object' } },
                  },
                  required: ['name', 'rows'],
                },
              },
            },
            required: ['sheets'],
          }),
          execute: async (args: any) => {
            const { filename, sheets } = args as { filename?: string; sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }> };
            try {
              return await generateSpreadsheet({ filename, sheets }, fileUploader);
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              logger.error({ tenantId, agentId, errorMessage: error.message }, 'generate_spreadsheet failed');
              return { error: error.message };
            }
          },
        };
        (fileGenTools as any)['generate_pdf'] = {
          description: 'Generate a downloadable PDF document',
          inputSchema: jsonSchema({
            type: 'object',
            properties: {
              filename: { type: 'string' },
              title: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['content'],
          }),
          execute: async (args: any) => {
            const { filename, title, content } = args as { filename?: string; title?: string; content: string };
            try {
              return await generatePdf({ filename, title, content }, fileUploader);
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              logger.error({ tenantId, agentId, errorMessage: error.message }, 'generate_pdf failed');
              return { error: error.message };
            }
          },
        };

        const allTools = { ...mcpTools, ...fileGenTools };
        const hasTools = Object.keys(allTools).length > 0;

        const readable = new ReadableStream({
          async start(controller) {
            const emitter = new PartStreamEmitter(executionId, { showThinking: (agent as any)?.showThinking !== false });
            try {
              const sseResult = streamChat({
                provider,
                messages: coreMessages as any,
                model: effectiveModel,
                system: effectiveSystem,
                temperature: effectiveTemperature,
                maxOutputTokens: effectiveMaxTokens,
                ...(hasTools ? { tools: allTools, maxSteps: 5 } : {}),
              });

              for await (const ev of emitter.run(sseResult.fullStream)) {
                controller.enqueue(encoder.encode(toSseFrame(ev)));
              }

              await mcpCleanup();
              const sseCompletedAt = new Date();
              const sseLatencyMs = sseCompletedAt.getTime() - startedAt.getTime();

              const sseTokenUsage = emitter.usage;
              const fullText = emitter.parts
                .filter((p) => p.type === 'text')
                .map((p) => (p as { type: 'text'; text: string }).text)
                .join('');

              if (sseTokenUsage) await quotaService.incrementUsage(sseTokenUsage.totalTokens);
              if (cacheEligible) await cacheService.set(cacheKey, { text: fullText, usage: sseTokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });

              if (sessionId) {
                await sessionService.appendMessage(sessionId, {
                  role: 'assistant',
                  content: fullText,
                  tokenCount: sseTokenUsage?.outputTokens,
                  parts: emitter.parts,
                });
              }

              await db.apiKeyExecution.update({
                where: { id: executionId },
                data: { status: 'completed', output: { text: fullText }, tokenUsage: (sseTokenUsage ?? null) as any, cacheHit: false, latencyMs: sseLatencyMs, completedAt: sseCompletedAt },
              });

              await deliverWebhook('completed', { text: fullText }, undefined, sseTokenUsage ?? undefined, sseLatencyMs);

              controller.close();
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              await mcpCleanup();
              await db.apiKeyExecution.update({
                where: { id: executionId },
                data: { status: 'failed', output: { error: error.message }, completedAt: new Date() },
              }).catch(() => {});
              await deliverWebhook('failed', undefined, error.message).catch(() => {});
              controller.enqueue(
                encoder.encode(toSseFrame({ type: 'error', messageId: executionId, message: error.message }))
              );
              controller.close();
            }
          },
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Execution-Id': executionId,
            ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
          },
        });
      }

      if (stream) {
        const result = streamChat({
          provider,
          messages: coreMessages as any,
          model: effectiveModel,
          system: effectiveSystem,
          temperature: effectiveTemperature,
          maxOutputTokens: effectiveMaxTokens,
          ...(hasMcpTools ? { tools: mcpTools, maxSteps: 5 } : {}),
          onFinish: async ({ text, usage }) => {
            await mcpCleanup();
            const completedAt = new Date();
            const latencyMs = completedAt.getTime() - startedAt.getTime();
            const tokenUsage = {
              inputTokens: usage?.inputTokens ?? 0,
              outputTokens: usage?.outputTokens ?? 0,
              totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
            };

            await quotaService.incrementUsage(tokenUsage.totalTokens);

            if (cacheEligible) {
              await cacheService.set(cacheKey, { text, usage: tokenUsage });
            }

            if (sessionId) {
              await sessionService.appendMessage(sessionId, {
                role: 'assistant',
                content: text,
                tokenCount: tokenUsage.outputTokens,
              });
            }

            await db.apiKeyExecution.update({
              where: { id: executionId },
              data: {
                status: 'completed',
                output: { text },
                tokenUsage: tokenUsage as any,
                cacheHit: false,
                latencyMs,
                completedAt,
              },
            });

            await deliverWebhook('completed', { text }, undefined, tokenUsage, latencyMs);
          },
        });

        return result.toUIMessageStreamResponse({
          headers: {
            'x-execution-id': executionId,
            ...(sessionId ? { 'x-session-id': sessionId } : {}),
          },
        });
      } else {
        const result = streamChat({
          provider,
          messages: coreMessages as any,
          model: effectiveModel,
          system: effectiveSystem,
          temperature: effectiveTemperature,
          maxOutputTokens: effectiveMaxTokens,
          ...(hasMcpTools ? { tools: mcpTools, maxSteps: 5 } : {}),
        });

        // Drain the plain text stream (NOT the UI message stream — that returns SSE frames).
        let text = '';
        for await (const chunk of result.textStream) {
          text += chunk;
        }

        // usage is a PromiseLike on the streamChat result; wrap so we can .catch.
        const usage = await Promise.resolve(result.usage).catch(() => undefined);
        const tokenUsage = usage
          ? {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            }
          : undefined;

        await mcpCleanup();
        const completedAt = new Date();
        const latencyMs = completedAt.getTime() - startedAt.getTime();

        if (tokenUsage) {
          await quotaService.incrementUsage(tokenUsage.totalTokens);
        }

        if (cacheEligible) {
          await cacheService.set(cacheKey, { text, usage: tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
        }

        if (sessionId) {
          await sessionService.appendMessage(sessionId, {
            role: 'assistant',
            content: text,
            tokenCount: tokenUsage?.outputTokens,
          });
        }

        await db.apiKeyExecution.update({
          where: { id: executionId },
          data: {
            status: 'completed',
            output: { text },
            tokenUsage: (tokenUsage ?? null) as any,
            cacheHit: false,
            latencyMs,
            completedAt,
          },
        });

        await deliverWebhook('completed', { text }, undefined, tokenUsage, latencyMs);

        return new Response(
          JSON.stringify({
            id: executionId,
            content: text,
            usage: tokenUsage,
            cacheHit: false,
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...(sessionId ? { 'x-session-id': sessionId } : {}),
            },
          }
        );
      }
    }

    // ─── Graph Agent Execution ────────────────────────────────────────────
    if (agent.type === 'graph') {
      const graphConfig = config as { nodes?: any[]; edges?: any[] };
      const graph = { nodes: graphConfig.nodes ?? [], edges: graphConfig.edges ?? [] };

      if (graph.nodes.length === 0) {
        return new Response(
          JSON.stringify({ error: { type: 'agent_not_configured', message: 'Graph has no nodes' } }),
          { status: 400 }
        );
      }

      const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');
      const pausedExecService = new PausedExecutionService(db);

      const llmProviderFn = async (providerId?: string, modelId?: string) => {
        const llmProviderService = new LlmProviderService(tenantId);
        const providerCfg = providerId
          ? await llmProviderService.getConfigById(providerId)
          : modelId
            ? await resolveProviderForModel(tenantId, modelId)
            : null;
        const cfg = providerCfg ?? (await llmProviderService.getDefaultConfig());
        return createLLMProvider(cfg);
      };

      const graphExecutor = new GraphExecutor({ llmProvider: llmProviderFn, prisma: db });
      for (const exec of createNodeExecutors()) graphExecutor.register(exec);

      // Use normalizedMessages (multimodal-aware) stripped to role+content for the graph executor
      const allMessages = sessionId ? [...priorMessages, ...normalizedMessages] : normalizedMessages;
      const inboxMessages = allMessages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      const graphStream = new ReadableStream({
        async start(controller) {
          const enc = (data: unknown) =>
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));

          try {
            let paused = false;

            const finalState = await graphExecutor.execute(
              graph,
              { messages: inboxMessages },
              { executionId, agentId, tenantId, userId: '' },
              {
                onEvent: (event) => enc(event),
                onPause: async (pauseInfo) => {
                  paused = true;
                  await pausedExecService.create({
                    tenantId,
                    agentId,
                    executionId,
                    graphState: pauseInfo.state,
                    prompt: pauseInfo.prompt,
                    outputChannel: pauseInfo.outputChannel,
                    nextNodeId: pauseInfo.nextNodeId,
                    resumeToken: pauseInfo.resumeToken,
                  });
                  await db.apiKeyExecution.update({
                    where: { id: executionId },
                    data: { status: 'paused' },
                  });
                },
              }
            );

            if (!paused) {
              const text = String((finalState.channels.__output as string) ?? '');
              const completedAt = new Date();
              await db.apiKeyExecution.update({
                where: { id: executionId },
                data: {
                  status: 'completed',
                  output: { text },
                  completedAt,
                  latencyMs: completedAt.getTime() - startedAt.getTime(),
                },
              });
              if (sessionId) {
                await sessionService.appendMessage(sessionId, { role: 'assistant', content: text });
              }
              await quotaService.incrementUsage(0);
              await deliverWebhook('completed', { text });
              enc({ type: 'done', text });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ executionId, agentId, tenantId, err: msg }, 'graph agent execution failed');
            await db.apiKeyExecution.update({
              where: { id: executionId },
              data: { status: 'failed', error: msg, completedAt: new Date() },
            });
            await deliverWebhook('failed', undefined, msg);
            enc({ type: 'error', message: msg });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(graphStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'x-execution-id': executionId,
          ...(sessionId ? { 'x-session-id': sessionId } : {}),
        },
      });
    }

    return new Response(JSON.stringify({ error: 'Unsupported agent type' }), { status: 400 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { err, errorMessage: err.message, errorStack: err.stack, agentId, tenantId },
      'Inference execution error'
    );
    return new Response(
      JSON.stringify({ error: { type: 'llm_error', message: 'Internal server error', detail: err.message } }),
      { status: 500 }
    );
  }
}

async function buildKbContext(
  agentId: string,
  tenantId: string,
  query: string,
  db: any
): Promise<string> {
  const attachments = await db.agentKnowledgeBase.findMany({
    where: { agentId },
    include: { knowledgeBase: true },
  });

  if (!attachments || attachments.length === 0) return '';

  const { RetrievalService } = await import('@chatbot/knowledge-base');
  const retrieval = new RetrievalService(tenantId);

  const contexts: string[] = [];
  for (const att of attachments) {
    const kb = att.knowledgeBase;
    if (kb.status !== 'active') continue;

    try {
      const results = await retrieval.query(query, {
        knowledgeBaseId: kb.id,
        topK: 5,
      });

      if (results.length > 0) {
        contexts.push(`--- From ${kb.name} ---\n${results.map((r: any) => r.content).join('\n\n')}`);
      }
    } catch {
      // Skip KBs that fail retrieval
    }
  }

  return contexts.join('\n\n');
}
