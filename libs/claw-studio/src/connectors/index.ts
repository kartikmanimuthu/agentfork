export { maskSecret } from './mask';

export { ConnectorRegistry, getConnectorRegistry } from './registry';

export {
  ClawConnectorConfigService,
  ConnectorEncryptionUnavailableError,
  configKeyFor,
} from './config-service';
export type { MaskedConnectorConfig } from './config-service';

export { SlackConnector, SLACK_APPROVE_ACTION, SLACK_REJECT_ACTION } from './adapters/slack';
export { TelegramConnector, TELEGRAM_CALLBACK_PREFIX } from './adapters/telegram';
export { DiscordConnector, DISCORD_APPROVE_ACTION, DISCORD_REJECT_ACTION } from './adapters/discord';

export { SECRET_FIELDS } from './types';
export type {
  ChannelType,
  DeliveryMode,
  HilCapabilities,
  BaseConnectorConfig,
  SlackConnectorConfig,
  TelegramConnectorConfig,
  DiscordConnectorConfig,
  ConnectorConfig,
  VerifySuccess,
  VerifyFailure,
  VerifyResult,
  ChannelConnector,
} from './types';
