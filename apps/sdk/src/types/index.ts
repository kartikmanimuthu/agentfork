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

export interface ThinkingStep {
  id: string;
  label: string;
  detail?: string;
  status: 'active' | 'done';
  data?: Record<string, string>;
}

export interface MenuOption {
  label: string;
  value: string; // sent to backend on selection
  icon?: string;
}

export interface CardButton {
  label: string;
  url?: string;
  value?: string; // if present, sends as a message instead of navigating
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; status: 'active' | 'done'; steps: ThinkingStep[] }
  | { type: 'menu'; title?: string; options: MenuOption[] }
  | { type: 'file'; name: string; mimeType: string; url: string; sizeBytes?: number }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'card'; title: string; description?: string; buttons?: CardButton[] };

export type MessagePartType = MessagePart['type'];

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  status: 'sending' | 'streaming' | 'complete' | 'error';
  parts: MessagePart[];
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
  type: 'part_start' | 'token' | 'thinking_step' | 'part_complete' | 'done' | 'error';
  messageId?: string;
  partIndex?: number;
  partType?: MessagePartType; // for part_start
  content?: string; // for token
  step?: ThinkingStep; // for thinking_step
  message?: string; // for error
  part?: MessagePart; // full payload delivered on part_start for non-streaming parts (file/image/card/menu)
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
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
