import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-timestamp',
  styleUrl: 'smc-timestamp.css',
  shadow: true,
})
export class SmcTimestamp {
  @Prop() timestamp!: string;

  private formatTime(ts: string): string {
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  render() {
    return (
      <div class="timestamp">
        <span>{this.formatTime(this.timestamp)}</span>
      </div>
    );
  }
}
