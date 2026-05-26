import type { WebhookInboundMessage } from '../webhook/types';
import type { InteractiveMessage } from '../client/types';

export interface RoutingContext {
  message: WebhookInboundMessage;
  contactPhone: string;
  contactName: string;
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
  | { type: 'prompt'; interactiveMessage: InteractiveMessage }
  | { type: 'fallback'; agentId: string; reason: string };

export interface WhatsAppRouter {
  route(ctx: RoutingContext): Promise<RoutingResult>;
}
