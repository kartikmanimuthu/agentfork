import { Component, Prop, h, State } from '@stencil/core';
import { state, setConfig, setApiKey, setSession, setMessages, setPreChatDone, setUiState } from '../../store/widget-store';
import { ConfigService } from '../../services/config.service';
import { ApiService } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';
import type { Message } from '../../types';

@Component({
  tag: 'smc-chat-widget',
  styleUrl: 'smc-chat-widget.css',
  shadow: true,
})
export class SmcChatWidget {
  @Prop() sdkId!: string;
  @Prop() apiUrl?: string;

  @State() ready = false;
  @State() bootError: string | null = null;

  private storage!: StorageService;
  private apiService!: ApiService;

  private getBaseUrl(): string {
    if (this.apiUrl) return this.apiUrl;
    const script = document.querySelector('script[src*="smc-chat-widget"]') as HTMLScriptElement;
    if (script) {
      const url = new URL(script.src);
      return url.origin;
    }
    return window.location.origin;
  }

  async componentWillLoad() {
    const baseUrl = this.getBaseUrl();
    this.storage = new StorageService(this.sdkId);

    try {
      const configService = new ConfigService(baseUrl);
      const config = await configService.fetchConfig(this.sdkId);
      setConfig(config);
      setApiKey(config.apiKeyPrefix);

      this.apiService = new ApiService(baseUrl, config.apiKeyPrefix);

      const existingSessionId = this.storage.getSessionId();
      if (existingSessionId) {
        const session = await this.apiService.getSession(existingSessionId);
        if (session && session.status === 'active') {
          setSession({ id: session.id, status: session.status, visitorId: this.storage.getVisitorId() });
          const messages: Message[] = session.messages.map((m) => ({
            id: m.id,
            content: m.content,
            role: m.role as 'user' | 'assistant',
            timestamp: m.createdAt,
            status: 'sent',
          }));
          setMessages(messages);
          setPreChatDone(true);
        } else {
          this.storage.clearSession();
        }
      }

      if (this.storage.getPreChatDone()) {
        setPreChatDone(true);
      }

      this.ready = true;
    } catch (err) {
      this.bootError = err instanceof Error ? err.message : 'Failed to load widget';
    }
  }

  render() {
    if (this.bootError || !this.ready) return null;

    const config = state.config;
    if (!config) return null;

    const cssVars = {
      '--smc-primary': config.primaryColor,
      '--smc-secondary': config.secondaryColor,
    };

    return (
      <div class={`smc-root position-${config.position}`} style={cssVars}>
        <smc-proactive-engine></smc-proactive-engine>
        {state.uiState.open && !state.uiState.minimized ? (
          <smc-chat-window></smc-chat-window>
        ) : null}
        <smc-launcher></smc-launcher>
      </div>
    );
  }
}
