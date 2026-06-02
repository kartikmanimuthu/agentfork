import type { WhatsAppRouter, RoutingContext, RoutingResult } from './router.interface';

export class TimeRouter implements WhatsAppRouter {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const now = new Date();
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDay = now.getDay();

    const activeRules = ctx.rules
      .filter((r) => r.isActive)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of activeRules) {
      const condition = rule.condition as {
        type: string;
        start: string;
        end: string;
        days?: number[];
      };
      if (condition.type !== 'time') continue;

      if (condition.days && !condition.days.includes(currentDay)) continue;

      if (currentHHMM >= condition.start && currentHHMM <= condition.end) {
        return { type: 'resolved', agentId: rule.agentId };
      }
    }

    if (ctx.routing.fallbackAgentId) {
      return { type: 'fallback', agentId: ctx.routing.fallbackAgentId, reason: 'no time rule matched' };
    }

    throw new Error('No time-based routing rule matched and no fallback agent configured');
  }
}
