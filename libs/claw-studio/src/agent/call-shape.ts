/**
 * Measures what a single model call is actually carrying, split into the part
 * summarization can shrink and the part it cannot.
 *
 * Compaction only ever trims message history. The system prompt (composed
 * workspace files, skills catalog, self-authoring section) and the tool schemas
 * (browser tools, every enabled integration, plus MCP tools) ride along on every
 * single call and are untouchable. If that fixed half already approaches the
 * model's input budget, no compaction setting can bring a call under the window
 * — which looks identical, from the outside, to "context grew too large", but has
 * a completely different fix: fewer tools, or a smaller prompt.
 *
 * Character counts with a chars/4 token estimate rather than a real tokenizer:
 * this runs on every model call, and loading a tokenizer per call to sharpen a
 * diagnostic would cost more than the diagnostic is worth. Orders of magnitude
 * are what matter here.
 */
export interface CallShape {
  systemChars: number;
  historyChars: number;
  toolSchemaChars: number;
  messageCount: number;
  estPromptTokens: number;
  estFixedTokens: number;
}

const CHARS_PER_TOKEN = 4;

interface ShapeMessage {
  _getType?: () => string;
  content?: unknown;
}

function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  // Multimodal messages carry an array of blocks; stringifying the array counts
  // the text without producing "[object Object]" for every image part.
  if (content == null) return 0;
  try {
    return JSON.stringify(content)?.length ?? 0;
  } catch {
    return 0;
  }
}

export function summarizeCallShape(messages: ShapeMessage[], tools: unknown[]): CallShape {
  let systemChars = 0;
  let historyChars = 0;

  for (const message of messages ?? []) {
    const chars = contentChars(message?.content);
    if (message?._getType?.() === 'system') systemChars += chars;
    else historyChars += chars;
  }

  let toolSchemaChars = 0;
  if (Array.isArray(tools) && tools.length > 0) {
    try {
      toolSchemaChars = JSON.stringify(tools)?.length ?? 0;
    } catch {
      toolSchemaChars = 0;
    }
  }

  const totalChars = systemChars + historyChars + toolSchemaChars;
  return {
    systemChars,
    historyChars,
    toolSchemaChars,
    messageCount: messages?.length ?? 0,
    estPromptTokens: Math.round(totalChars / CHARS_PER_TOKEN),
    estFixedTokens: Math.round((systemChars + toolSchemaChars) / CHARS_PER_TOKEN),
  };
}
