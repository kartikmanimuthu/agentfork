import { StreamService } from '../stream.service';

function createMockResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) {
        ctrl.enqueue(encoder.encode(chunks[i++]));
      } else {
        ctrl.close();
      }
    },
  });
  return new Response(stream);
}

function createSingleChunkResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(text));
      ctrl.close();
    },
  });
  return new Response(stream);
}

describe('StreamService', () => {
  let service: StreamService;

  beforeEach(() => {
    service = new StreamService();
  });

  it('parses a single SSE token event', async () => {
    const response = createSingleChunkResponse('data: {"type":"token","content":"Hello"}\n\n');

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'token', content: 'Hello' });
  });

  it('parses multiple events in sequence', async () => {
    const response = createSingleChunkResponse(
      'data: {"type":"token","content":"Hello"}\n\ndata: {"type":"token","content":" world"}\n\ndata: {"type":"done","messageId":"msg_1"}\n\n',
    );

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('token');
    expect(events[1].type).toBe('token');
    expect(events[2]).toEqual({ type: 'done', messageId: 'msg_1' });
  });

  it('handles done event with usage data', async () => {
    const response = createSingleChunkResponse(
      'data: {"type":"done","messageId":"msg_1","usage":{"inputTokens":10,"outputTokens":20,"totalTokens":30}}\n\n',
    );

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  });

  it('handles error event', async () => {
    const response = createSingleChunkResponse(
      'data: {"type":"error","message":"Something went wrong"}\n\n',
    );

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'error', message: 'Something went wrong' });
  });

  it('yields nothing for an empty stream', async () => {
    const response = createSingleChunkResponse('');

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
  });

  it('skips malformed JSON in data lines', async () => {
    const response = createSingleChunkResponse(
      'data: {"type":"token","content":"good"}\n\ndata: {not valid json}\n\ndata: {"type":"done"}\n\n',
    );

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('token');
    expect(events[1].type).toBe('done');
  });

  it('handles partial chunks across reads', async () => {
    const response = createMockResponse([
      'data: {"type":"tok',
      'en","content":"Hello"}\n\n',
    ]);

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'token', content: 'Hello' });
  });

  it('handles multiple partial chunks', async () => {
    const response = createMockResponse([
      'data: {"type":"token","con',
      'tent":"Hello"}\n\ndata: {"ty',
      'pe":"token","content":"World"}',
      '\n\n',
    ]);

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].content).toBe('Hello');
    expect(events[1].content).toBe('World');
  });

  it('ignores comment lines starting with colon', async () => {
    const response = createSingleChunkResponse(
      ': this is a comment\n:heartbeat\n\ndata: {"type":"token","content":"Hi"}\n\n',
    );

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].content).toBe('Hi');
  });

  it('ignores data lines with empty body', async () => {
    const response = createSingleChunkResponse(
      'data: {"type":"token","content":"Hi"}\n\ndata:\n\ndata: {"type":"done"}\n\n',
    );

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
  });

  it('ignores data lines without space after colon', async () => {
    const response = createSingleChunkResponse(
      'data:{"type":"token","content":"skip"}\n\ndata: {"type":"done"}\n\n',
    );

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('done');
  });

  it('throws error when response has no body', async () => {
    const response = new Response(null);

    await expect(async () => {
      for await (const _ of service.parseSSE(response)) {
        // should throw before yielding
      }
    }).rejects.toThrow('No response body');
  });

  it('handles newline-only chunks', async () => {
    const response = createMockResponse(['\n\n\n', 'data: {"type":"done"}\n\n']);

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('done');
  });

  it('handles chunk ending mid-line-break', async () => {
    const response = createMockResponse([
      'data: {"type":"token","content":"A"}\n',
      '\ndata: {"type":"done"}\n\n',
    ]);

    const events = [];
    for await (const event of service.parseSSE(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
  });
});
