import { Component, h, Element, Listen } from '@stencil/core';
import { state, onChange } from '../../store/widget-store';
import type { Message } from '../../types';

@Component({
  tag: 'smc-message-list',
  styleUrl: 'smc-message-list.css',
  shadow: true,
})
export class SmcMessageList {
  @Element() el!: HTMLElement;
  private listEl!: HTMLDivElement;

  // Menu-option and card-button selections bubble up (Stencil events are composed)
  // from the part components. Re-dispatch them as a window event the input bar sends.
  @Listen('menuSelect')
  handleMenuSelect(e: CustomEvent<string>) {
    window.dispatchEvent(new CustomEvent('smc:send', { detail: e.detail }));
  }

  @Listen('cardAction')
  handleCardAction(e: CustomEvent<string>) {
    window.dispatchEvent(new CustomEvent('smc:send', { detail: e.detail }));
  }

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

    const welcomeMsg: Message | null =
      config?.welcomeMessage && messages.length === 0
        ? {
            id: 'welcome',
            role: 'assistant',
            createdAt: new Date().toISOString(),
            status: 'complete',
            parts: [{ type: 'text', text: config.welcomeMessage }],
          }
        : null;

    const last = messages[messages.length - 1];
    const awaitingFirstPart =
      state.streaming.active && last?.role === 'assistant' && last.parts.length === 0;

    return (
      <div class="message-list" ref={(el) => (this.listEl = el as HTMLDivElement)}>
        {welcomeMsg ? <smc-message message={welcomeMsg}></smc-message> : null}
        {messages.map((msg, i) => {
          const showTimestamp =
            i === 0 || this.shouldShowTimestamp(messages[i - 1]?.createdAt, msg.createdAt);
          return [
            showTimestamp ? <smc-timestamp timestamp={msg.createdAt}></smc-timestamp> : null,
            <smc-message message={msg} showFeedback={config?.csatEnabled ?? false}></smc-message>,
          ];
        })}
        {awaitingFirstPart ? <smc-typing-indicator></smc-typing-indicator> : null}
      </div>
    );
  }
}
