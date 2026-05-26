import { Component, h, State } from '@stencil/core';
import { state, setUiState, clearUnread } from '../../store/widget-store';

@Component({
  tag: 'smc-launcher',
  styleUrl: 'smc-launcher.css',
  shadow: true,
})
export class SmcLauncher {
  @State() proactiveMessage: string | null = null;

  private handleClick = () => {
    if (state.uiState.open) {
      setUiState({ open: false, minimized: false });
    } else {
      setUiState({ open: true, minimized: false });
      clearUnread();
      this.proactiveMessage = null;
    }
  };

  render() {
    const config = state.config;
    if (!config) return null;

    const isOpen = state.uiState.open;
    const unread = state.unreadCount;

    return (
      <div class="launcher-container">
        {this.proactiveMessage && !isOpen ? (
          <div class="proactive-bubble" onClick={this.handleClick}>
            <p>{this.proactiveMessage}</p>
            <button class="proactive-close" onClick={(e) => { e.stopPropagation(); this.proactiveMessage = null; }}>
              &times;
            </button>
          </div>
        ) : null}
        <button
          class={`launcher-btn ${isOpen ? 'open' : ''}`}
          onClick={this.handleClick}
          aria-label={isOpen ? 'Close chat' : 'Open chat'}
        >
          {isOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          )}
          {unread > 0 && !isOpen ? <span class="badge">{unread}</span> : null}
        </button>
      </div>
    );
  }
}
