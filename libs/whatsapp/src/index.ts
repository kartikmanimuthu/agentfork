export { whatsappEnv } from './env';

export { MetaWhatsAppClient } from './client/meta-api';
export type { MetaClientConfig } from './client/meta-api';
export type {
  SendMessageRequest,
  SendMessageResponse,
  InteractiveMessage,
  InteractiveAction,
  MediaUrlResponse,
  UploadMediaResponse,
  TemplateComponent,
} from './client/types';

export { verifyWebhookSignature } from './webhook/signature';
export { parseWebhookPayload } from './webhook/parser';
export type { WebhookPayload, ParsedEvent, WebhookInboundMessage } from './webhook/types';

export { createRouter } from './router/factory';
export type { WhatsAppRouter, RoutingContext, RoutingResult } from './router/router.interface';

export { SessionManager } from './session/session-manager';
export { CommandHandler } from './session/command-handler';

export { MediaDownloader } from './media/downloader';
export type { S3Uploader, DownloadResult } from './media/downloader';
export { MediaUploader } from './media/uploader';

export { ContactLock, InMemoryLockProvider } from './concurrency/contact-lock';
export type { LockProvider } from './concurrency/contact-lock';
export { InMemoryRateLimiter } from './concurrency/rate-limiter';
export { CircuitBreaker } from './concurrency/circuit-breaker';

export { MessageProcessor } from './processor/message-processor';
export type { AgentExecutor, MessageProcessorDeps } from './processor/message-processor';
export { WhatsAppAgentExecutor } from './processor/agent-executor';

export { TemplateSyncService } from './templates/template-sync';
export { TemplateSender } from './templates/template-sender';
export type { SendTemplateInput } from './templates/template-sender';

export { createMessageProcessor } from './factory';
