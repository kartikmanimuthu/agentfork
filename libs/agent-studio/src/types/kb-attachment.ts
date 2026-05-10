export interface AgentKnowledgeBaseAttachment {
  id: string;
  agentId: string;
  knowledgeBaseId: string;
  createdAt: Date;
}

export interface AttachedKnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  status: string;
  documentCount: number;
  chunkCount: number;
}
