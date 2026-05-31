import { Component, h, State, Element } from '@stencil/core';
import {
  state,
  addMessage,
  setStreaming,
  appendPart,
  appendTokenToPart,
  upsertThinkingStep,
  completePart,
  finalizeLastMessage,
  markLastMessageError,
  setKbSuggestions,
  setSession,
} from '../../store/widget-store';
import { ApiService } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';
import { StreamService } from '../../services/stream.service';
import { MockTransport } from '../../services/mock-transport';
import type { ScenarioKey } from '../../services/mock-scenarios';
import type { MessagePart, StreamEvent } from '../../types';

@Component({
  tag: 'smc-input-bar',
  styleUrl: 'smc-input-bar.css',
  shadow: true,
})
export class SmcInputBar {
  @State() text = '';
  @State() sending = false;
  @Element() el!: HTMLElement;

  private textareaEl!: HTMLTextAreaElement;
  private kbDebounce: ReturnType<typeof setTimeout> | null = null;

  private onExternalSend = (e: Event) => {
    const detail = (e as CustomEvent<string>).detail;
    if (detail) void this.sendValue(detail);
  };

  connectedCallback() {
    // Outbound menu-option / card-button selections bubble up as a window event
    // (re-dispatched by the message list) and are sent as normal user messages.
    window.addEventListener('smc:send', this.onExternalSend);
  }

  disconnectedCallback() {
    window.removeEventListener('smc:send', this.onExternalSend);
  }

  private handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    this.text = target.value;
    this.autoResize(target);

    if (state.config?.kbEnabled && state.session && state.apiKey) {
      if (this.kbDebounce) clearTimeout(this.kbDebounce);
      if (this.text.length >= 3) {
        this.kbDebounce = setTimeout(async () => {
          try {
            const api = new ApiService(state.baseUrl, state.apiKey!);
            const articles = await api.suggestKb(state.session!.id, this.text);
            setKbSuggestions(articles);
          } catch (err) {
            console.error('[smc-widget] kb suggest failed', err);
          }
        }, 300);
      } else {
        setKbSuggestions([]);
      }
    }
  };

  private autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  };

  private resolveMockScenario(): ScenarioKey | null {
    const widgetEl = document.querySelector('smc-chat-widget') as any;
    const fromProp = widgetEl?.mockScenario as string | undefined;
    const fromUrl = new URLSearchParams(location.search).get('mock');
    const key = fromProp || (fromUrl ? 'thinking' : null);
    return (key as ScenarioKey) || null;
  }

  private send() {
    const content = this.text.trim();
    if (!content || this.sending) return;
    this.text = '';
    setKbSuggestions([]);
    if (this.textareaEl) this.textareaEl.style.height = 'auto';
    void this.sendValue(content);
  }

  private async sendValue(content: string) {
    if (!content || this.sending) return;
    this.sending = true;

    const mock = this.resolveMockScenario();

    // Real path needs an API key + a session; mock path needs neither.
    if (!mock) {
      if (!state.apiKey) {
        this.sending = false;
        return;
      }
      if (!state.session) {
        try {
          const widgetEl = document.querySelector('smc-chat-widget') as any;
          const sdkId = widgetEl?.sdkId;
          const storage = new StorageService(sdkId);
          const visitorId = storage.getVisitorId();
          const api = new ApiService(state.baseUrl, state.apiKey);
          const session = await api.createSession({ visitorId });
          storage.setSessionId(session.id);
          setSession({ id: session.id, status: 'active', visitorId });
        } catch (err) {
          console.error('[smc-widget] session create failed', err);
          this.sending = false;
          return;
        }
      }
    }

    const now = new Date().toISOString();
    addMessage({
      id: `u_${Date.now()}`,
      role: 'user',
      createdAt: now,
      status: 'complete',
      parts: [{ type: 'text', text: content }],
    });

    const assistantId = `a_${Date.now()}`;
    addMessage({
      id: assistantId,
      role: 'assistant',
      createdAt: now,
      status: 'streaming',
      parts: [],
    });

    setStreaming(true);

    try {
      const iterator: AsyncGenerator<StreamEvent> = mock
        ? new MockTransport(mock).parseSSE()
        : new StreamService().parseSSE(
            await new ApiService(state.baseUrl, state.apiKey!).sendMessage(state.session!.id, content),
          );

      for await (const ev of iterator) {
        this.applyEvent(assistantId, ev);
      }
    } catch (err) {
      console.error('[smc-widget] stream failed', err);
      markLastMessageError('Connection error. Please try again.');
    } finally {
      setStreaming(false);
      this.sending = false;
    }
  }

  // Maps an SSE event onto our local assistant placeholder. The transport's own
  // messageId is ignored — all events for this turn target `assistantId`.
  private applyEvent(assistantId: string, ev: StreamEvent) {
    if (ev.type === 'part_start') {
      const seed: MessagePart | null =
        ev.part ??
        (ev.partType === 'text'
          ? { type: 'text', text: '' }
          : ev.partType === 'thinking'
            ? { type: 'thinking', status: 'active', steps: [] }
            : null);
      if (seed) appendPart(assistantId, seed);
    } else if (ev.type === 'token' && ev.partIndex != null && ev.content) {
      appendTokenToPart(assistantId, ev.partIndex, ev.content);
    } else if (ev.type === 'thinking_step' && ev.partIndex != null && ev.step) {
      upsertThinkingStep(assistantId, ev.partIndex, ev.step);
    } else if (ev.type === 'part_complete' && ev.partIndex != null) {
      completePart(assistantId, ev.partIndex);
    } else if (ev.type === 'done') {
      finalizeLastMessage(ev.messageId ?? `msg_${Date.now()}`);
    } else if (ev.type === 'error') {
      markLastMessageError(ev.message);
    }
  }

  private handleFileClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.doc,.docx,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !state.session || !state.apiKey) return;
      const api = new ApiService(state.baseUrl, state.apiKey);
      try {
        await api.uploadFile(state.session.id, file);
      } catch (err) {
        console.error('[smc-widget] file upload failed', err);
      }
    };
    input.click();
  };

  render() {
    const config = state.config;

    return (
      <div class="input-bar">
        {config?.fileUpload ? (
          <button class="attach-btn" onClick={this.handleFileClick} aria-label="Attach file">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
            </svg>
          </button>
        ) : null}
        <textarea
          ref={(el) => (this.textareaEl = el as HTMLTextAreaElement)}
          class="input-field"
          placeholder={config?.inputPlaceholder ?? 'Write a message...'}
          value={this.text}
          onInput={this.handleInput}
          onKeyDown={this.handleKeyDown}
          rows={1}
          disabled={this.sending}
        ></textarea>
        <button
          class={`send-btn ${this.text.trim() ? 'active' : ''}`}
          onClick={() => this.send()}
          disabled={!this.text.trim() || this.sending}
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="19" x2="12" y2="5"></line>
            <polyline points="5 12 12 5 19 12"></polyline>
          </svg>
        </button>
      </div>
    );
  }
}
