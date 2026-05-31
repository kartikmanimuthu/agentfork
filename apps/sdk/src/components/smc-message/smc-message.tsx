import { Component, Prop, Event, EventEmitter, h } from '@stencil/core';
import type { Message } from '../../types';

@Component({
  tag: 'smc-message',
  styleUrl: 'smc-message.css',
  shadow: true,
})
export class SmcMessage {
  @Prop() message!: Message;
  @Prop() showFeedback = false;
  @Event() messageRetry!: EventEmitter<string>;

  render() {
    const m = this.message;
    const isUser = m.role === 'user';

    return (
      <div class={`row ${isUser ? 'user' : 'bot'} status-${m.status}`}>
        <div class="bubble">
          {m.parts.map((part, i) => (
            <smc-message-part partData={part} key={i}></smc-message-part>
          ))}
          {m.status === 'error' ? (
            <button class="retry" type="button" onClick={() => this.messageRetry.emit(m.id)}>Retry</button>
          ) : null}
        </div>
        {!isUser && m.status === 'complete' && this.showFeedback ? (
          <smc-feedback messageId={m.id}></smc-feedback>
        ) : null}
      </div>
    );
  }
}
