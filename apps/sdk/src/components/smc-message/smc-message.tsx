import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-message',
  styleUrl: 'smc-message.css',
  shadow: true,
})
export class SmcMessage {
  @Prop() content!: string;
  @Prop() role!: 'user' | 'assistant';
  @Prop() timestamp!: string;
  @Prop() messageId!: string;
  @Prop() status?: string;

  render() {
    const isUser = this.role === 'user';

    return (
      <div class={`message ${isUser ? 'user' : 'bot'}`}>
        <div class="bubble">
          {isUser ? (
            <span class="text">{this.content}</span>
          ) : (
            <smc-markdown content={this.content}></smc-markdown>
          )}
        </div>
        {!isUser && this.messageId && this.messageId !== 'welcome' && this.status === 'sent' ? (
          <smc-feedback messageId={this.messageId}></smc-feedback>
        ) : null}
      </div>
    );
  }
}
