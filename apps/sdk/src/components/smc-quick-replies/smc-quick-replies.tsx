import { Component, h, Event, EventEmitter } from '@stencil/core';
import { state } from '../../store/widget-store';

@Component({
  tag: 'smc-quick-replies',
  styleUrl: 'smc-quick-replies.css',
  shadow: true,
})
export class SmcQuickReplies {
  @Event({ bubbles: true, composed: true }) smcQuickReply!: EventEmitter<{ text: string }>;

  private handleClick = (text: string) => {
    this.smcQuickReply.emit({ text });
  };

  render() {
    const replies = state.config?.quickReplies;
    if (!replies || replies.length === 0 || state.messages.length > 0) return null;

    return (
      <div class="quick-replies">
        {replies.map((text) => (
          <button class="chip" onClick={() => this.handleClick(text)}>
            {text}
          </button>
        ))}
      </div>
    );
  }
}
