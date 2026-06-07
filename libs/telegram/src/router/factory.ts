import type { TelegramRouter } from './router.interface';
import { KeywordRouter } from './keyword-router';

export function createRouter(strategy: string): TelegramRouter {
  switch (strategy) {
    case 'keyword':
      return new KeywordRouter();
    default:
      throw new Error(`Unknown routing strategy: ${strategy}`);
  }
}
