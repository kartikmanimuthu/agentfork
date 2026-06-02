import type { WhatsAppRouter, RoutingContext, RoutingResult } from './router.interface';

export class MenuRouter implements WhatsAppRouter {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const interactiveReply = ctx.message.interactive;
    if (interactiveReply) {
      const selectedId = interactiveReply.button_reply?.id ?? interactiveReply.list_reply?.id;
      if (selectedId) {
        const matchedRule = ctx.rules.find(
          (r) => r.isActive && (r.condition as { id: string }).id === selectedId
        );
        if (matchedRule) {
          return { type: 'resolved', agentId: matchedRule.agentId };
        }
      }
    }

    const menuConfig = ctx.routing.config as { bodyText?: string; buttonLabel?: string };
    const activeRules = ctx.rules.filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);

    if (activeRules.length <= 3) {
      return {
        type: 'prompt',
        interactiveMessage: {
          type: 'button',
          body: { text: menuConfig.bodyText ?? 'How can I help you today?' },
          action: {
            buttons: activeRules.map((rule) => ({
              type: 'reply' as const,
              reply: {
                id: (rule.condition as { id: string }).id,
                title: (rule.condition as { label: string }).label,
              },
            })),
          },
        },
      };
    }

    return {
      type: 'prompt',
      interactiveMessage: {
        type: 'list',
        body: { text: menuConfig.bodyText ?? 'How can I help you today?' },
        action: {
          button: menuConfig.buttonLabel ?? 'Choose',
          sections: [{
            title: 'Options',
            rows: activeRules.map((rule) => ({
              id: (rule.condition as { id: string }).id,
              title: (rule.condition as { label: string }).label,
              description: (rule.condition as { description?: string }).description,
            })),
          }],
        },
      },
    };
  }
}
