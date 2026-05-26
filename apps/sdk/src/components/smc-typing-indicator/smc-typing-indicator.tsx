import { Component, h } from '@stencil/core';

@Component({
  tag: 'smc-typing-indicator',
  styleUrl: 'smc-typing-indicator.css',
  shadow: true,
})
export class SmcTypingIndicator {
  render() {
    return (
      <div class="typing">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    );
  }
}
