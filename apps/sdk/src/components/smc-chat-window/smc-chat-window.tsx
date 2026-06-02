import { Component, h } from '@stencil/core';
import { state } from '../../store/widget-store';

@Component({
  tag: 'smc-chat-window',
  styleUrl: 'smc-chat-window.css',
  shadow: true,
})
export class SmcChatWindow {
  render() {
    const config = state.config;
    if (!config) return null;

    const showPreChat = config.preChatForm && config.preChatForm.length > 0 && !state.preChatDone;
    const showCsat = config.csatEnabled && state.csatPending && state.messages.length > 0;

    return (
      <div class="chat-window">
        <smc-header></smc-header>
        <div class="chat-body">
          {showPreChat ? (
            <smc-pre-chat-form></smc-pre-chat-form>
          ) : showCsat ? (
            [
              <smc-message-list></smc-message-list>,
              <smc-csat-survey></smc-csat-survey>,
            ]
          ) : (
            [
              <smc-message-list></smc-message-list>,
              state.kbSuggestions.length > 0 ? <smc-kb-suggestions></smc-kb-suggestions> : null,
              <smc-quick-replies></smc-quick-replies>,
              <smc-input-bar></smc-input-bar>,
            ]
          )}
        </div>
      </div>
    );
  }
}
