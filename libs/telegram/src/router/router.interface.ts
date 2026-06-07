import type { TelegramWebhookEvent } from '../webhook/types';

export interface RoutingContext {
  message: TelegramWebhookEvent;
  chatId: string;
  fromName: string;
  accountId: string;
  routing: {
    strategy: string;
    config: Record<string, unknown>;
    fallbackAgentId: string | null;
  };
  rules: Array<{
    agentId: string;
    priority: number;
    condition: Record<string, unknown>;
    isActive: boolean;
  }>;
}

export type RoutingResult =
  | { type: 'resolved'; agentId: string }
  | { type: 'fallback'; agentId: string; reason: string };

export interface TelegramRouter {
  route(ctx: RoutingContext): Promise<RoutingResult>;
}
