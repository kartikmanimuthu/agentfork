export interface AgentAlias {
  id: string;
  agentId: string;
  name: string;
  versionId: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAliasInput {
  agentId: string;
  name: string;
  versionId: string;
  isDefault?: boolean;
}

export interface UpdateAliasInput {
  versionId?: string;
  isDefault?: boolean;
}
