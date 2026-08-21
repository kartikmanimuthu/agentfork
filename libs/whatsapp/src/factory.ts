import { getPrismaClient, EncryptionService, LlmProviderService, TenantConfigService } from '@chatbot/shared';
import { createLLMProvider } from '@chatbot/ai';
import { MessageProcessor } from './processor/message-processor';
import { SessionManager } from './session/session-manager';
import { ContactLock, InMemoryLockProvider } from './concurrency/contact-lock';
import { CircuitBreaker } from './concurrency/circuit-breaker';
import { MetaWhatsAppClient } from './client/meta-api';
import { NetcoreWhatsAppClient } from './client/netcore-api';
import { WhatsAppAgentExecutor } from './processor/agent-executor';
import { whatsappEnv } from './env';

let processorInstance: MessageProcessor | null = null;

async function resolveTenantLLMConfig(tenantId: string, modelId?: string) {
  if (!tenantId) return null;
  const llmProviderService = new LlmProviderService(tenantId);
  if (modelId) {
    const providers = await llmProviderService.list();
    for (const p of providers) {
      if (p.chatModel === modelId) {
        return await llmProviderService.getConfigById(p.id);
      }
      const models = (p.models as { models?: Array<{ id: string }> } | null)?.models ?? [];
      if (models.some((m) => m.id === modelId)) {
        return await llmProviderService.getConfigById(p.id);
      }
    }
  }
  return (await llmProviderService.getDefaultConfig()) ?? (await new TenantConfigService(tenantId).get('llmConfig'));
}

export function createMessageProcessor(): MessageProcessor {
  if (processorInstance) return processorInstance;

  const prisma = getPrismaClient();
  const sessionManager = new SessionManager(prisma);
  const lockProvider = new InMemoryLockProvider();
  const contactLock = new ContactLock(lockProvider, 60_000);
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  const encryption = new EncryptionService();

  const agentExecutor = new WhatsAppAgentExecutor(prisma, ({ model, temperature, tenantId }) => {
    return {
      async chat({ messages, maxTokens }) {
        const llmConfig = await resolveTenantLLMConfig(tenantId, model);
        const provider = createLLMProvider(llmConfig);
        const result = provider.streamChat({
          messages: messages as any,
          temperature,
          maxOutputTokens: maxTokens,
        });
        const text = await result.text;
        return { text };
      },
    };
  });

  const clientFactory = (account: { accessToken: string; phoneNumberId: string; provider: string }) => {
    const decryptedToken = encryption.decrypt(account.accessToken);

    if (account.provider === 'netcore') {
      return new NetcoreWhatsAppClient({
        accessToken: decryptedToken,
        phoneNumberId: account.phoneNumberId,
      });
    }

    return new MetaWhatsAppClient({
      accessToken: decryptedToken,
      phoneNumberId: account.phoneNumberId,
      apiVersion: whatsappEnv.META_API_VERSION,
    });
  };

  processorInstance = new MessageProcessor({
    prisma,
    sessionManager,
    agentExecutor,
    contactLock,
    circuitBreaker,
    clientFactory,
  });

  return processorInstance;
}
