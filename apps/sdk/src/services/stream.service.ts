import type { StreamEvent } from '../types';

export class StreamService {
  async *parseSSE(response: Response): AsyncGenerator<StreamEvent> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: StreamEvent = JSON.parse(line.slice(6));
            yield event;
          } catch {
            // skip malformed events
          }
        }
      }
    }
  }
}
