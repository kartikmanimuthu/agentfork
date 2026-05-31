import { Component, Prop, h, State, Element } from '@stencil/core';
import { state, setConfig, setApiKey, setBaseUrl, setSession, setMessages, setPreChatDone, setUiState } from '../../store/widget-store';
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
  @Prop() mockConfig?: string;
  /** When set, the widget streams from the mock transport using this scenario key
   *  (thinking | menu | files | image | error) instead of the real backend. */
  @Prop() mockScenario?: string;

  @Element() host!: HTMLElement;

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
    console.log('[smc-widget] Boot started', { sdkId: this.sdkId, baseUrl });
    this.storage = new StorageService(this.sdkId);

    try {
      let config;

      if (this.mockConfig) {
        config = JSON.parse(this.mockConfig);
        if (!config?.apiKeyPrefix) {
          throw new Error('[smc-widget] mockConfig is missing required field: apiKeyPrefix');
        }
        console.warn('[smc-widget] Using mock config', config);
      } else {
        const configService = new ConfigService(baseUrl);
        console.log('[smc-widget] Fetching config...');
        config = await configService.fetchConfig(this.sdkId);
        console.log('[smc-widget] Config loaded', config);
      }
      setConfig(config);
      setApiKey(config.apiKeyPrefix);
      setBaseUrl(baseUrl);

      // Apply theme as a host class so tokens.css :host(.theme-*) maps take effect.
      const theme = config.theme ?? 'auto';
      this.host.classList.remove('theme-light', 'theme-dark', 'theme-auto');
      this.host.classList.add(`theme-${theme}`);

      this.apiService = new ApiService(baseUrl, config.apiKeyPrefix);

      const existingSessionId = this.storage.getSessionId();
      if (existingSessionId) {
        console.log('[smc-widget] Resuming session', { sessionId: existingSessionId });
        const session = await this.apiService.getSession(existingSessionId);
        if (session && session.status === 'active') {
          setSession({ id: session.id, status: session.status, visitorId: this.storage.getVisitorId() });
          const messages: Message[] = session.messages.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            createdAt: m.createdAt,
            status: 'complete',
            parts: [{ type: 'text', text: m.content }],
          }));
          setMessages(messages);
          setPreChatDone(true);
          console.log('[smc-widget] Session resumed', { messageCount: messages.length });
        } else {
          console.log('[smc-widget] Session expired, clearing');
          this.storage.clearSession();
          this.storage.setPreChatDone(false);
        }
      }

      if (this.storage.getPreChatDone()) {
        setPreChatDone(true);
      }

      this.ready = true;
      console.log('[smc-widget] Boot complete, widget ready');
    } catch (err) {
      this.bootError = err instanceof Error ? err.message : 'Failed to load widget';
      console.error('[smc-widget] Boot failed', this.bootError, err);
    }
  }

  render() {
    if (this.bootError) {
      return (
        <div class="smc-root smc-error">
          <div class="error-badge" title={this.bootError}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
        </div>
      );
    }

    if (!this.ready) return null;

    const config = state.config;
    if (!config) return null;

    const cssVars = {
      '--smc-primary': config.primaryColor,
      '--smc-primary-hover': config.primaryColor,
      '--smc-primary-faint': `color-mix(in srgb, ${config.primaryColor} 8%, transparent)`,
      '--smc-primary-gradient': `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})`,
      '--smc-accent': config.secondaryColor,
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
