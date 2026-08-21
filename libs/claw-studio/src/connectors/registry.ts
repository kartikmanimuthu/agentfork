/**
 * registry.ts — the connector registry.
 *
 * Adding a channel is one `register()` call here plus its adapter file; nothing
 * else in the stack needs to know the channel exists. Cached on globalThis so
 * dev-mode hot reload doesn't build a second registry per request (§2 of the
 * design reference), matching the pattern in agent/run-manager.ts.
 */

import { SlackConnector } from './adapters/slack';
import { TelegramConnector } from './adapters/telegram';
import { DiscordConnector } from './adapters/discord';
// Type-only, and gateway/types imports nothing back from here, so there is no cycle.
import type { ChannelAdapter } from '../gateway/types';
import type { ChannelType } from './types';

export class ConnectorRegistry {
  private readonly connectors = new Map<ChannelType, ChannelAdapter>();

  register(connector: ChannelAdapter): void {
    this.connectors.set(connector.channelType, connector);
  }

  has(channel: string): channel is ChannelType {
    return this.connectors.has(channel as ChannelType);
  }

  /** Throws for unregistered channels — callers should gate on has() first. */
  get(channel: ChannelType): ChannelAdapter {
    const connector = this.connectors.get(channel);
    if (!connector) {
      throw new Error(`No connector registered for channel "${channel}"`);
    }
    return connector;
  }

  list(): ChannelAdapter[] {
    return Array.from(this.connectors.values());
  }
}

const g = globalThis as typeof globalThis & {
  _clawConnectorRegistry?: ConnectorRegistry;
};

export function getConnectorRegistry(): ConnectorRegistry {
  if (!g._clawConnectorRegistry) {
    const registry = new ConnectorRegistry();
    registry.register(new SlackConnector());
    registry.register(new TelegramConnector());
    registry.register(new DiscordConnector());
    g._clawConnectorRegistry = registry;
  }
  return g._clawConnectorRegistry;
}
