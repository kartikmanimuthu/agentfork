import { describe, it, expect } from 'vitest';
import { ChatBedrockConverse } from '@langchain/aws';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { createClawModel, deriveInputTokenBudget, requestTimeoutFor } from './model-factory';

describe('createClawModel', () => {
  it('builds a Bedrock model for provider "bedrock"', () => {
    const model = createClawModel({
      provider: 'bedrock', chatModel: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      region: 'ap-south-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    });
    expect(model).toBeInstanceOf(ChatBedrockConverse);
  });

  it('builds an Anthropic model for provider "anthropic"', () => {
    const model = createClawModel({ provider: 'anthropic', chatModel: 'claude-3-5', apiKey: 'sk-x' });
    expect(model).toBeInstanceOf(ChatAnthropic);
  });

  it('builds an OpenAI-compatible model for provider "openai_compatible"', () => {
    const model = createClawModel({ provider: 'openai_compatible', chatModel: 'llama3', baseUrl: 'http://localhost:1234/v1' });
    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it('appends /v1 to an Ollama base URL so chat hits the OpenAI-compatible route', () => {
    const model: any = createClawModel({
      provider: 'ollama', chatModel: 'gpt-oss:120b', baseUrl: 'https://ollama.com', apiKey: 'ollama-key',
    });
    expect(model).toBeInstanceOf(ChatOpenAI);
    expect(model.clientConfig.baseURL).toBe('https://ollama.com/v1');
    expect(model.clientConfig.apiKey).toBe('ollama-key');
  });

  it('leaves an Ollama base URL that already ends in /v1 untouched, trailing slash included', () => {
    const already: any = createClawModel({ provider: 'ollama', chatModel: 'kimi-k3', baseUrl: 'https://ollama.com/v1' });
    expect(already.clientConfig.baseURL).toBe('https://ollama.com/v1');
    const slashed: any = createClawModel({ provider: 'ollama', chatModel: 'kimi-k3', baseUrl: 'http://localhost:11434/' });
    expect(slashed.clientConfig.baseURL).toBe('http://localhost:11434/v1');
  });

  it('does not rewrite the base URL for other OpenAI-compatible providers', () => {
    const model: any = createClawModel({ provider: 'openai_compatible', chatModel: 'llama3', baseUrl: 'https://gw.example.com/v1' });
    expect(model.clientConfig.baseURL).toBe('https://gw.example.com/v1');
    const litellm: any = createClawModel({ provider: 'litellm', chatModel: 'llm-powerhouse-qwen-3-8', baseUrl: 'http://gateway:4000' });
    expect(litellm.clientConfig.baseURL).toBe('http://gateway:4000');
  });

  it('throws a typed error when chatModel is missing', () => {
    expect(() => createClawModel({ provider: 'bedrock' })).toThrow(/chatModel/i);
  });

  it('streams the main model, so the request timeout bounds time-to-first-token', () => {
    const litellm: any = createClawModel({ provider: 'litellm', chatModel: 'llm-powerhouse-qwen-3-8', baseUrl: 'http://gateway:4000' });
    expect(litellm.streaming).toBe(true);
    const bedrock: any = createClawModel({
      provider: 'bedrock', chatModel: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      region: 'ap-south-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    });
    expect(bedrock.streaming).toBe(true);
    const anthropic: any = createClawModel({ provider: 'anthropic', chatModel: 'claude-3-5', apiKey: 'sk-x' });
    expect(anthropic.streaming).toBe(true);
  });

  it('reports its own context window, so deepagents can size summarization for a self-hosted model', () => {
    // @langchain/openai's profile getter is a lookup table keyed by model id
    // (`PROFILES[this.model] ?? {}`), so a gateway-served model id resolves to {}
    // and deepagents' computeSummarizationDefaults silently falls back to
    // large-model defaults. Supplying maxInputTokens is what makes its DEFAULT
    // summarization middleware compact at the right size.
    const model: any = createClawModel({ provider: 'litellm', chatModel: 'llm-powerhouse-qwen-3-8', baseUrl: 'http://gateway:4000' });
    expect(model.profile.maxInputTokens).toBe(
      deriveInputTokenBudget({ provider: 'litellm', chatModel: 'llm-powerhouse-qwen-3-8' }),
    );
  });
});

describe('deriveInputTokenBudget', () => {
  it('sizes a self-hosted model from the 64k window the fleet actually serves', () => {
    // Measured from the deployment, not assumed: the llama.cpp services launch with
    // `--ctx-size 131072 --parallel 2`, and llama.cpp splits the KV cache across
    // parallel slots — so one request gets 65536, not 131072. The 16k default this
    // replaced under-budgeted the fleet by 4x and dropped integrations for no reason.
    expect(deriveInputTokenBudget({ provider: 'litellm', chatModel: 'q', maxTokens: 4096 })).toBe(65_536 - 4096 - 2_000);
  });

  it('gives Bedrock and Anthropic their real 200k window', () => {
    expect(deriveInputTokenBudget({ provider: 'bedrock', chatModel: 'q', maxTokens: 4096 })).toBe(200_000 - 4096 - 2_000);
    expect(deriveInputTokenBudget({ provider: 'anthropic', chatModel: 'q', maxTokens: 4096 })).toBe(200_000 - 4096 - 2_000);
  });

  it('treats an unknown provider as small rather than assuming a large window', () => {
    // The conservative default stays 16k: an unrecognised provider tells us nothing,
    // and over-budgeting a small model is the failure that costs a whole turn.
    expect(deriveInputTokenBudget({ provider: 'something_new', chatModel: 'q', maxTokens: 4096 })).toBe(16_000 - 4096 - 2_000);
  });

  it('never drops below a usable floor when the output reserve would eat the window', () => {
    expect(deriveInputTokenBudget({ provider: 'litellm', chatModel: 'q', maxTokens: 64_000 })).toBe(8_000);
  });

  it('honours CLAW_MODEL_CONTEXT_WINDOW so a real window can be declared per deployment', () => {
    const previous = process.env.CLAW_MODEL_CONTEXT_WINDOW;
    process.env.CLAW_MODEL_CONTEXT_WINDOW = '131072';
    try {
      // Declared as a WINDOW, so the same output reserve and margin still come off
      // it — an operator reading `--ctx-size` off their server can copy it directly.
      expect(deriveInputTokenBudget({ provider: 'litellm', chatModel: 'q', maxTokens: 4096 })).toBe(131_072 - 4096 - 2_000);
    } finally {
      if (previous === undefined) delete process.env.CLAW_MODEL_CONTEXT_WINDOW;
      else process.env.CLAW_MODEL_CONTEXT_WINDOW = previous;
    }
  });

  // These were one variable, and that coupling had a silent, severe failure mode:
  // the model budget also sizes the TOOL-SCHEMA budget (45% of it, in budgetTools).
  // An operator lowering WORKING_MEMORY_TOKEN_BUDGET to shrink memory recall would
  // have shrunk the schema limit too, dropping the browser, integration and web
  // tool groups wholesale — surfacing only as a log line, while the model simply
  // claimed it could not browse.
  it('is NOT affected by WORKING_MEMORY_TOKEN_BUDGET, which sizes memory recall only', () => {
    const previous = process.env.WORKING_MEMORY_TOKEN_BUDGET;
    process.env.WORKING_MEMORY_TOKEN_BUDGET = '8000';
    try {
      expect(deriveInputTokenBudget({ provider: 'litellm', chatModel: 'q', maxTokens: 4096 })).toBe(65_536 - 4096 - 2_000);
    } finally {
      if (previous === undefined) delete process.env.WORKING_MEMORY_TOKEN_BUDGET;
      else process.env.WORKING_MEMORY_TOKEN_BUDGET = previous;
    }
  });

  it('ignores a non-numeric or non-positive window override rather than trusting it', () => {
    const previous = process.env.CLAW_MODEL_CONTEXT_WINDOW;
    try {
      for (const bad of ['abc', '0', '-5', '']) {
        process.env.CLAW_MODEL_CONTEXT_WINDOW = bad;
        expect(deriveInputTokenBudget({ provider: 'litellm', chatModel: 'q', maxTokens: 4096 })).toBe(65_536 - 4096 - 2_000);
      }
    } finally {
      if (previous === undefined) delete process.env.CLAW_MODEL_CONTEXT_WINDOW;
      else process.env.CLAW_MODEL_CONTEXT_WINDOW = previous;
    }
  });
});

describe('requestTimeoutFor', () => {
  // The timeout bounds TIME TO FIRST TOKEN (streaming is on), not total
  // generation — so its job is "is this endpoint alive?", and the right value
  // differs by who is serving. A managed API that has not answered in 60s is
  // broken; a self-hosted llama.cpp server on one GPU may legitimately still be
  // ingesting a large prompt.
  it('gives self-hosted families room to process a large prompt', () => {
    for (const provider of ['litellm', 'ollama', 'vllm', 'lmstudio', 'openai_compatible']) {
      expect(requestTimeoutFor(provider)).toBe(180_000);
    }
  });

  it('keeps the tight guard for managed APIs, where a long silence means broken', () => {
    for (const provider of ['bedrock', 'anthropic', 'openai']) {
      expect(requestTimeoutFor(provider)).toBe(60_000);
    }
  });

  it('treats an unknown provider as managed rather than granting the long timeout', () => {
    expect(requestTimeoutFor('something_new')).toBe(60_000);
  });

  it('applies the self-hosted timeout to the model it builds', () => {
    const litellm: any = createClawModel({ provider: 'litellm', chatModel: 'q', baseUrl: 'http://gw:4000' });
    expect(litellm.timeout).toBe(180_000);
    const openai: any = createClawModel({ provider: 'openai', chatModel: 'gpt-4o', apiKey: 'sk-x' });
    expect(openai.timeout).toBe(60_000);
  });
});
