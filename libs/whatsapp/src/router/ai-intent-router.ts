import type { WhatsAppRouter, RoutingContext, RoutingResult } from './router.interface';

export class AiIntentRouter implements WhatsAppRouter {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const messageText = ctx.message.text?.body ?? '';
    if (!messageText) {
      if (ctx.routing.fallbackAgentId) {
        return { type: 'fallback', agentId: ctx.routing.fallbackAgentId, reason: 'no text to classify' };
      }
      throw new Error('Cannot classify intent without text content');
    }

    // AI classification will be wired in during integration
    if (ctx.routing.fallbackAgentId) {
      return { type: 'fallback', agentId: ctx.routing.fallbackAgentId, reason: 'ai_intent requires LLM integration' };
    }

    throw new Error('AI intent router requires fallback agent until LLM integration is complete');
  }
}
