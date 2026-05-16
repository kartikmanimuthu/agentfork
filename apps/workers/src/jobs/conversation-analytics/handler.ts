import { getPrismaClient, LlmProviderService, TenantConfigService } from '@chatbot/shared/workers';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
import { createLogger } from '../../lib/logger.js';
import { z } from 'zod';

const log = createLogger('conversation-analytics');

const payloadSchema = z.object({
  conversationId: z.string(),
  tenantId: z.string(),
});

const analyticsResponseSchema = z.object({
  sentiment: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED']),
  sentimentScores: z.object({
    positive: z.number(),
    negative: z.number(),
    neutral: z.number(),
    mixed: z.number(),
  }),
  isResolved: z.boolean(),
  confidenceScore: z.number().min(0).max(1),
  emotionalTone: z.object({
    happy: z.number(),
    frustrated: z.number(),
    neutral: z.number(),
  }),
  summary: z.string(),
  firstUserQuery: z.string(),
  language: z.string(),
});

const SYSTEM_PROMPT = 'You are a conversation analyst. Analyze chatbot conversations and return structured JSON assessments.';

const ANALYSIS_PROMPT = `Analyze the following chatbot conversation and return a JSON object with these fields:

- sentiment: The overall sentiment of the user's messages. One of: "POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"
- sentimentScores: Confidence scores for each sentiment as decimals (0-1). Object with keys: positive, negative, neutral, mixed. Must sum to ~1.0.
- isResolved: Whether the user's query/issue was resolved by the end of the conversation. Boolean.
- confidenceScore: How confident you are in the resolution assessment (0.0 to 1.0).
- emotionalTone: The user's emotional state. Object with keys: happy, frustrated, neutral. Each 0.0-1.0, should sum to ~1.0.
- summary: A 1-3 sentence summary of what the conversation was about and the outcome.
- firstUserQuery: The user's first meaningful question or request (exclude greetings like "hi", "hello"). Max 200 chars.
- language: The primary language the user communicated in (ISO 639-1 code, e.g., "en", "hi", "ta").

Return ONLY valid JSON, no markdown, no explanation.

CONVERSATION:
`;

export async function handleConversationAnalytics(data: unknown): Promise<void> {
  const { conversationId, tenantId } = payloadSchema.parse(data);
  log.info('Analyzing conversation', { conversationId, tenantId });

  const prisma = getPrismaClient();

  const existing = await prisma.conversationAnalytics.findUnique({
    where: { conversationId },
  });
  if (existing) {
    log.info('Analytics already exist, skipping', { conversationId });
    return;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true, createdAt: true, messageCount: true },
  });
  if (!conversation) {
    log.warn('Conversation not found', { conversationId });
    return;
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });

  const userMessages = messages.filter((m) => m.role === 'user');
  if (userMessages.length === 0) {
    log.warn('No user messages to analyze', { conversationId });
    return;
  }

  const transcript = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const llmProviderService = new LlmProviderService(tenantId);
  const llmConfig = await llmProviderService.getDefaultConfig()
    ?? await new TenantConfigService(tenantId).get<TenantLLMConfig>('llmConfig');
  const provider = createLLMProvider(llmConfig);

  const result = streamChat({
    provider,
    messages: [
      { role: 'user', content: `${ANALYSIS_PROMPT}${transcript}` },
    ],
    system: SYSTEM_PROMPT,
    maxOutputTokens: 1024,
  });

  let responseText = '';
  for await (const chunk of result.textStream) {
    responseText += chunk;
  }

  let analysis;
  try {
    const parsed = JSON.parse(responseText.trim());
    analysis = analyticsResponseSchema.parse(parsed);
  } catch (err) {
    log.error('Failed to parse LLM response', {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
      response: responseText.slice(0, 500),
    });
    await prisma.conversationAnalytics.create({
      data: {
        conversationId,
        tenantId,
        messageCount: conversation.messageCount,
        createdAt: conversation.createdAt,
      },
    });
    return;
  }

  await prisma.conversationAnalytics.create({
    data: {
      conversationId,
      tenantId,
      sentiment: analysis.sentiment,
      sentimentScores: analysis.sentimentScores,
      isResolved: analysis.isResolved,
      confidenceScore: analysis.confidenceScore,
      emotionalTone: analysis.emotionalTone,
      summary: analysis.summary,
      firstUserQuery: analysis.firstUserQuery.slice(0, 200),
      language: analysis.language,
      messageCount: conversation.messageCount,
      createdAt: conversation.createdAt,
    },
  });

  log.info('Analytics stored', { conversationId, sentiment: analysis.sentiment });
}
