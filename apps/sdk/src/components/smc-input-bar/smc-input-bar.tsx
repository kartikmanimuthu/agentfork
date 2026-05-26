import { Component, h, State, Element } from '@stencil/core';
import { state, addMessage, setStreaming, updateLastMessage, finalizeLastMessage, setKbSuggestions } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';
import { StreamService } from '../../services/stream.service';

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

  private handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    this.text = target.value;
    this.autoResize(target);

    if (state.config?.kbEnabled && state.session && state.apiKey) {
      if (this.kbDebounce) clearTimeout(this.kbDebounce);
      if (this.text.length >= 3) {
        this.kbDebounce = setTimeout(async () => {
          const baseUrl = window.location.origin;
          const api = new ApiService(baseUrl, state.apiKey!);
          const articles = await api.suggestKb(state.session!.id, this.text);
          setKbSuggestions(articles);
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

  private async send() {
    const content = this.text.trim();
    if (!content || this.sending || !state.session || !state.apiKey) return;

    this.text = '';
    this.sending = true;
    setKbSuggestions([]);

    if (this.textareaEl) {
      this.textareaEl.style.height = 'auto';
    }

    addMessage({
      id: `temp_${Date.now()}`,
      content,
      role: 'user',
      timestamp: new Date().toISOString(),
      status: 'sent',
    });

    addMessage({
      id: `stream_${Date.now()}`,
      content: '',
      role: 'assistant',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    });

    setStreaming(true);

    try {
      const baseUrl = window.location.origin;
      const api = new ApiService(baseUrl, state.apiKey);
      const response = await api.sendMessage(state.session.id, content);

      const streamService = new StreamService();
      let fullContent = '';

      for await (const event of streamService.parseSSE(response)) {
        if (event.type === 'token' && event.content) {
          fullContent += event.content;
          updateLastMessage(fullContent);
        } else if (event.type === 'done') {
          finalizeLastMessage(event.messageId ?? `msg_${Date.now()}`);
        } else if (event.type === 'error') {
          updateLastMessage('Sorry, something went wrong. Please try again.');
          finalizeLastMessage(`err_${Date.now()}`);
        }
      }
    } catch {
      updateLastMessage('Connection error. Please try again.');
      finalizeLastMessage(`err_${Date.now()}`);
    } finally {
      setStreaming(false);
      this.sending = false;
    }
  }

  private handleFileClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.doc,.docx,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !state.session || !state.apiKey) return;
      const baseUrl = window.location.origin;
      const api = new ApiService(baseUrl, state.apiKey);
      try {
        await api.uploadFile(state.session.id, file);
      } catch {
        // handled silently
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
