import { getPrismaClient, EncryptionService } from '@chatbot/shared';
import { TelegramMessageProcessor } from './processor/message-processor';
import { TelegramSessionManager } from './session/session-manager';
import { ContactLock, InMemoryLockProvider } from './concurrency/contact-lock';
import { CircuitBreaker } from './concurrency/circuit-breaker';
import { TelegramBotApi } from './client/bot-api';
import { TelegramAgentExecutorImpl } from './processor/agent-executor';

let processorInstance: TelegramMessageProcessor | null = null;

export function createMessageProcessor(): TelegramMessageProcessor {
  if (processorInstance) return processorInstance;

  const prisma = getPrismaClient();
  const sessionManager = new TelegramSessionManager(prisma);
  const lockProvider = new InMemoryLockProvider();
  const contactLock = new ContactLock(lockProvider, 60_000);
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  const encryption = new EncryptionService();

  const agentExecutor = new TelegramAgentExecutorImpl(prisma, (config) => {
    return {
      async chat(params) {
        return { text: `[Agent response to: ${params.messages[params.messages.length - 1]?.content}]` };
      },
    };
  });

  const botApiFactory = (botToken: string) => {
    const decryptedToken = encryption.decrypt(botToken);
    return new TelegramBotApi({ botToken: decryptedToken });
  };

  processorInstance = new TelegramMessageProcessor({
    prisma,
    sessionManager,
    agentExecutor,
    contactLock,
    circuitBreaker,
    botApiFactory,
  });

  return processorInstance;
}
