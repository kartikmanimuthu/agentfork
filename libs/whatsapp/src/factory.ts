import { getPrismaClient } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { MessageProcessor } from './processor/message-processor';
import { SessionManager } from './session/session-manager';
import { ContactLock, InMemoryLockProvider } from './concurrency/contact-lock';
import { CircuitBreaker } from './concurrency/circuit-breaker';
import { MetaWhatsAppClient } from './client/meta-api';
import { WhatsAppAgentExecutor } from './processor/agent-executor';
import { whatsappEnv } from './env';

let processorInstance: MessageProcessor | null = null;

export function createMessageProcessor(): MessageProcessor {
  if (processorInstance) return processorInstance;

  const prisma = getPrismaClient();
  const sessionManager = new SessionManager(prisma);
  const lockProvider = new InMemoryLockProvider();
  const contactLock = new ContactLock(lockProvider, 60_000);
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  const encryption = new EncryptionService();

  const agentExecutor = new WhatsAppAgentExecutor(prisma, (config) => {
    return {
      async chat(params) {
        // Placeholder: wire to actual LLM provider in production
        return { text: `[Agent response to: ${params.messages[params.messages.length - 1]?.content}]` };
      },
    };
  });

  const metaClientFactory = (accessToken: string, phoneNumberId: string) => {
    const decryptedToken = encryption.decrypt(accessToken);
    return new MetaWhatsAppClient({
      accessToken: decryptedToken,
      phoneNumberId,
      apiVersion: whatsappEnv.META_API_VERSION,
    });
  };

  processorInstance = new MessageProcessor({
    prisma,
    sessionManager,
    agentExecutor,
    contactLock,
    circuitBreaker,
    metaClientFactory,
  });

  return processorInstance;
}
