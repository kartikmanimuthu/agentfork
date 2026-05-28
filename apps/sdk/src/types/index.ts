export interface SdkWidgetConfig {
  agentId: string;
  apiKeyPrefix: string;
  theme: 'light' | 'dark' | 'auto';
  primaryColor: string;
  secondaryColor: string;
  position: 'left' | 'right';
  headerText: string;
  headerIcon: string | null;
  botName: string;
  botAvatar: string | null;
  welcomeMessage: string;
  inputPlaceholder: string;
  preChatForm: PreChatField[] | null;
  quickReplies: string[] | null;
  proactiveRules: ProactiveRule[] | null;
  kbEnabled: boolean;
  fileUpload: boolean;
  csatEnabled: boolean;
  csatType: 'thumbs' | 'stars' | 'nps';
}

export interface PreChatField {
  field: string;
  type: 'text' | 'email' | 'phone' | 'select';
  label?: string;
  required: boolean;
  options?: string[];
}

export interface ProactiveRule {
  trigger: 'time' | 'scroll' | 'url';
  delay?: number;
  scrollPercent?: number;
  urlPattern?: string;
  message: string;
}

export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: string;
  status?: 'sending' | 'sent' | 'error' | 'streaming';
  fileAttachment?: FileAttachment | null;
}

export interface FileAttachment {
  fileId: string;
  url: string;
  mimeType: string;
  fileName: string;
  size: number;
}

export interface KbArticle {
  id: string;
  title: string;
  snippet: string;
}

export interface StreamEvent {
  type: 'token' | 'done' | 'error';
  content?: string;
  messageId?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  message?: string;
}

export interface SessionInfo {
  id: string;
  status: string;
  visitorId: string;
}

export interface WidgetState {
  config: SdkWidgetConfig | null;
  apiKey: string | null;
  baseUrl: string;
  session: SessionInfo | null;
  messages: Message[];
  uiState: { open: boolean; minimized: boolean; hidden: boolean };
  streaming: { active: boolean; currentTokens: string };
  preChatDone: boolean;
  unreadCount: number;
  kbSuggestions: KbArticle[];
  error: string | null;
  csatPending: boolean;
  csatSubmitted: boolean;
}
