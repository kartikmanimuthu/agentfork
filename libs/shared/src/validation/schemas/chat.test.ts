import { describe, it, expect } from 'vitest';
import { createConversationSchema, updateConversationSchema, sendMessageSchema, messageQuerySchema } from './chat';

describe('createConversationSchema', () => {
  it('accepts empty object', () => {
    expect(createConversationSchema.safeParse({}).success).toBe(true);
  });

  it('accepts full data', () => {
    const result = createConversationSchema.safeParse({ title: 'Test', model: 'gpt-4' });
    expect(result.success).toBe(true);
  });
});

describe('updateConversationSchema', () => {
  it('accepts empty object', () => {
    expect(updateConversationSchema.safeParse({}).success).toBe(true);
  });

  it('accepts status update', () => {
    const result = updateConversationSchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = updateConversationSchema.safeParse({ status: 'deleted' });
    expect(result.success).toBe(false);
  });
});

describe('sendMessageSchema', () => {
  it('accepts valid message', () => {
    const result = sendMessageSchema.safeParse({ content: 'Hello world' });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = sendMessageSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects too long content', () => {
    const result = sendMessageSchema.safeParse({ content: 'a'.repeat(10001) });
    expect(result.success).toBe(false);
  });
});

describe('messageQuerySchema', () => {
  it('accepts valid query', () => {
    const result = messageQuerySchema.safeParse({ conversationId: 'conv-123' });
    expect(result.success).toBe(true);
  });

  it('rejects missing conversationId', () => {
    const result = messageQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts with limit', () => {
    const result = messageQuerySchema.safeParse({ conversationId: 'conv-123', limit: '10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });
});
