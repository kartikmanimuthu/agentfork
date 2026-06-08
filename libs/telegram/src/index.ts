export { telegramEnv } from './config/env';

export { TelegramBotApi } from './client/bot-api';
export type { TelegramBotApiConfig } from './client/bot-api';

export { validateWebhookSecret } from './webhook/signature';
export { parseWebhookBody } from './webhook/parser';
export type { TelegramWebhookEvent, TelegramUpdate, TelegramMessage, InlineKeyboardMarkup } from './webhook/types';

export { TelegramSessionManager } from './session/session-manager';
export { TelegramCommandHandler } from './session/command-handler';

export { ContactLock, InMemoryLockProvider } from './concurrency/contact-lock';
export type { LockProvider } from './concurrency/contact-lock';
export { InMemoryRateLimiter } from './concurrency/rate-limiter';
export { CircuitBreaker } from './concurrency/circuit-breaker';

export { TelegramMessageProcessor } from './processor/message-processor';
export type { AgentExecutor, MessageProcessorDeps } from './processor/message-processor';
export { TelegramAgentExecutorImpl } from './processor/agent-executor';

export { createMessageProcessor } from './factory';
