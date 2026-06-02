import { Component, h, Element } from '@stencil/core';
import { state, onChange } from '../../store/widget-store';

@Component({
  tag: 'smc-message-list',
  styleUrl: 'smc-message-list.css',
  shadow: true,
})
export class SmcMessageList {
  @Element() el!: HTMLElement;
  private listEl!: HTMLDivElement;

  componentDidLoad() {
    this.scrollToBottom();
    onChange('messages', () => {
      requestAnimationFrame(() => this.scrollToBottom());
    });
  }

  private scrollToBottom() {
    if (this.listEl) {
      this.listEl.scrollTop = this.listEl.scrollHeight;
    }
  }

  private shouldShowTimestamp(prev: string | undefined, current: string): boolean {
    if (!prev) return true;
    const diff = new Date(current).getTime() - new Date(prev).getTime();
    return diff > 5 * 60 * 1000;
  }

  render() {
    const messages = state.messages;
    const config = state.config;

    return (
      <div class="message-list" ref={(el) => (this.listEl = el as HTMLDivElement)}>
        {config?.welcomeMessage && messages.length === 0 ? (
          <smc-message
            content={config.welcomeMessage}
            role="assistant"
            timestamp={new Date().toISOString()}
            messageId="welcome"
          ></smc-message>
        ) : null}
        {messages.map((msg, i) => {
          const showTimestamp = i === 0 || this.shouldShowTimestamp(messages[i - 1]?.timestamp, msg.timestamp);
          return [
            showTimestamp ? <smc-timestamp timestamp={msg.timestamp}></smc-timestamp> : null,
            <smc-message
              content={msg.content}
              role={msg.role}
              timestamp={msg.timestamp}
              messageId={msg.id}
              status={msg.status}
            ></smc-message>,
          ];
        })}
        {state.streaming.active ? <smc-typing-indicator></smc-typing-indicator> : null}
      </div>
    );
  }
}
