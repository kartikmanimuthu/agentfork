import { Component, h } from '@stencil/core';
import { state, setUiState, setCsatPending } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';

@Component({
  tag: 'smc-header',
  styleUrl: 'smc-header.css',
  shadow: true,
})
export class SmcHeader {
  private handleMinimize = () => {
    setUiState({ open: false, minimized: true });
  };

  private handleClose = async () => {
    const config = state.config;
    const session = state.session;
    const apiKey = state.apiKey;

    // If CSAT is enabled and there's an active session with messages, trigger CSAT flow
    if (config?.csatEnabled && session && apiKey && state.messages.length > 0 && !state.csatSubmitted) {
      try {
        const api = new ApiService(state.baseUrl, apiKey);
        await api.endSession(session.id);
      } catch (err) {
        // silently fail — session may already be ended
        console.warn('[smc-header] Failed to end session', err);
      }
      setCsatPending(true);
      // Keep widget open so CSAT is visible; just clear the unread
      return;
    }

    // Normal close: just hide the chat window
    setUiState({ open: false, minimized: false, hidden: true });
  };

  render() {
    const config = state.config;
    if (!config) return null;

    return (
      <div class="header">
        <div class="header-left">
          {config.botAvatar ? (
            <img class="avatar" src={config.botAvatar} alt={config.botName} />
          ) : (
            <div class="avatar-placeholder">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </div>
          )}
          <div class="header-info">
            <span class="header-title">{config.headerText}</span>
            <span class="header-status">Online</span>
          </div>
        </div>
        <div class="header-actions">
          <button class="action-btn" onClick={this.handleMinimize} aria-label="Minimize">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button class="action-btn" onClick={this.handleClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    );
  }
}
