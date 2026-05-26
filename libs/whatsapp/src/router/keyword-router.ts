import type { WhatsAppRouter, RoutingContext, RoutingResult } from './router.interface';

export class KeywordRouter implements WhatsAppRouter {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const messageText = ctx.message.text?.body?.toLowerCase() ?? '';
    const activeRules = ctx.rules
      .filter((r) => r.isActive)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of activeRules) {
      const condition = rule.condition as { type: string; value: string; values?: string[] };
      if (condition.type !== 'keyword') continue;

      const keywords = condition.values ?? [condition.value];
      const matched = keywords.some((kw) => messageText.includes(kw.toLowerCase()));
      if (matched) {
        return { type: 'resolved', agentId: rule.agentId };
      }
    }

    if (ctx.routing.fallbackAgentId) {
      return { type: 'fallback', agentId: ctx.routing.fallbackAgentId, reason: 'no keyword matched' };
    }

    throw new Error('No routing rule matched and no fallback agent configured');
  }
}
