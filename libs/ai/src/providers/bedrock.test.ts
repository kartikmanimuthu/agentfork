import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be hoisted before any imports that trigger the modules
vi.mock('ai', () => ({
  streamText: vi.fn().mockReturnValue({
    textStream: (async function* () {})(),
    text: Promise.resolve(''),
    usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  }),
  embed: vi.fn(),
  embedMany: vi.fn(),
}));

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => vi.fn(() => 'mock-bedrock-model')),
}));

const mockMantleChat = vi.fn(() => 'mock-mantle-chat-model');
const mockMantleClient = { chat: mockMantleChat };
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => mockMantleClient),
}));

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: vi.fn(() =>
    vi.fn(() => Promise.resolve({ accessKeyId: 'test-key', secretAccessKey: 'test-secret' }))
  ),
}));

vi.mock('../env', () => ({
  env: {
    AWS_REGION: 'ap-south-1',
    AWS_BEARER_TOKEN_BEDROCK: 'test-bedrock-token',
  },
}));

import { BedrockLLMProvider } from './bedrock';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

const MOCK_MESSAGES = [{ role: 'user' as const, content: 'hello' }];
const MOCK_TOOL = {
  myTool: {
    description: 'test tool',
    inputSchema: { type: 'object', properties: {} } as any,
    execute: async () => 'result',
  },
};

describe('BedrockLLMProvider — mantle routing', () => {
  let provider: BedrockLLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMantleChat.mockClear();
    provider = new BedrockLLMProvider({ provider: 'bedrock', region: 'us-east-1' });
  });

  it('uses Converse API (createAmazonBedrock) for Claude with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'anthropic.claude-3-haiku-20240307-v1:0',
      tools: MOCK_TOOL,
    });

    expect(createAmazonBedrock).toHaveBeenCalled();
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('uses Converse API for cross-region Claude with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'us.anthropic.claude-sonnet-4-6',
      tools: MOCK_TOOL,
    });

    expect(createAmazonBedrock).toHaveBeenCalled();
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('uses Converse API for Amazon Nova with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'amazon.nova-pro-v1:0',
      tools: MOCK_TOOL,
    });

    expect(createAmazonBedrock).toHaveBeenCalled();
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('uses bedrock-mantle (createOpenAI.chat) for deepseek with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'deepseek.v3.2',
      tools: MOCK_TOOL,
    });

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://bedrock-mantle.us-east-1.api.aws/v1',
        apiKey: 'test-bedrock-token',
      })
    );
    expect(mockMantleChat).toHaveBeenCalledWith('deepseek.v3.2');
    expect(createAmazonBedrock).toHaveBeenCalledTimes(1); // only called in constructor
  });

  it('uses bedrock-mantle for moonshotai (Kimi) with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'moonshotai.kimi-k2.5',
      tools: MOCK_TOOL,
    });

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://bedrock-mantle.us-east-1.api.aws/v1',
        apiKey: 'test-bedrock-token',
      })
    );
    expect(mockMantleChat).toHaveBeenCalledWith('moonshotai.kimi-k2.5');
  });

  it('uses Converse API for deepseek WITHOUT tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'deepseek.v3.2',
      // no tools — plain text, Converse API works fine
    });

    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('uses Converse API for moonshotai WITHOUT tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'moonshotai.kimi-k2.5',
    });

    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('passes tools and maxSteps to streamText when using mantle', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'deepseek.v3.2',
      tools: MOCK_TOOL,
      maxSteps: 3,
    });

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: MOCK_TOOL,
        maxSteps: 3,
      })
    );
  });
});
