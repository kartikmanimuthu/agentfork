export type ConversationStatus = 'active' | 'archived';
export type MessageRole = 'user' | 'assistant' | 'system';
export type AuditSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
