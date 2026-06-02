import type { WhatsAppRouter } from './router.interface';
import { KeywordRouter } from './keyword-router';
import { MenuRouter } from './menu-router';
import { TimeRouter } from './time-router';
import { AiIntentRouter } from './ai-intent-router';

export function createRouter(strategy: string): WhatsAppRouter {
  switch (strategy) {
    case 'keyword':
      return new KeywordRouter();
    case 'menu':
      return new MenuRouter();
    case 'time_based':
      return new TimeRouter();
    case 'ai_intent':
      return new AiIntentRouter();
    default:
      throw new Error(`Unknown routing strategy: ${strategy}`);
  }
}
