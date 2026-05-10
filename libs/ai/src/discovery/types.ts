export type ModelCapability = 'chat' | 'embedding';

export interface DiscoveredModel {
  id: string;
  name: string;
  capabilities: ModelCapability[];
  contextWindow?: number;
}

export interface ModelDiscovery {
  discover(credentials: Record<string, string>, region?: string): Promise<DiscoveredModel[]>;
}
