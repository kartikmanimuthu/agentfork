import type { KbArticle, FileAttachment } from '../types';

export class ApiService {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createSession(params: {
    visitorId: string;
    visitorName?: string;
    visitorEmail?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/inference/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ channel: 'SDK', ...params }),
    });
    if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
    return res.json();
  }

  async getSession(sessionId: string): Promise<{ id: string; status: string; messages: Array<{ id: string; role: string; content: string; createdAt: string }> } | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}`, {
      headers: this.headers(),
    });
    if (res.status === 410) return null;
    if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
    return res.json();
  }

  async sendMessage(sessionId: string, content: string): Promise<Response> {
    return fetch(`${this.baseUrl}/api/v1/inference?format=sse`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ messages: [{ role: 'user', content }], sessionId, stream: true }),
    });
  }

  async submitFeedback(sessionId: string, messageId: string, rating: 'up' | 'down'): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}/chat/feedback`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ messageId, rating }),
    });
  }

  async submitCsat(sessionId: string, rating: number, comment?: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}/csat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ rating, comment }),
    });
  }

  async suggestKb(sessionId: string, query: string): Promise<KbArticle[]> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/inference/sessions/${sessionId}/kb/suggest?q=${encodeURIComponent(query)}`,
      { headers: this.headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.articles ?? [];
  }

  async uploadFile(sessionId: string, file: File): Promise<FileAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: formData,
    });
    if (!res.ok) throw new Error(`File upload failed: ${res.status}`);
    return res.json();
  }

  async endSession(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
  }
}
