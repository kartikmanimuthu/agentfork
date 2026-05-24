export interface Message {
  content: string;
  sender: string;
  timestamp: string;
  isOptions?: boolean;
  status?: 'sending' | 'sent' | 'error';
}

export interface SessionConfig {
  [key: string]: string | Record<string, string>;
}

export interface ChatApiResponse {
  response: string;
  sessionId?: string;
  memoryId?: string | null;
}

export interface ChatHistoryResponse {
  chatHistory: {
    chatRole: 'user' | 'assistant';
    message: string;
    timestamp: string;
    createdAt: string;
  }[];
}
