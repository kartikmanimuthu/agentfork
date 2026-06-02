import { Component, Prop, h, State } from '@stencil/core';
import { state } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';

@Component({
  tag: 'smc-feedback',
  styleUrl: 'smc-feedback.css',
  shadow: true,
})
export class SmcFeedback {
  @Prop() messageId!: string;
  @State() selected: 'up' | 'down' | null = null;

  private async handleFeedback(rating: 'up' | 'down') {
    if (this.selected === rating) return;
    this.selected = rating;

    if (state.session && state.apiKey) {
      const baseUrl = window.location.origin;
      const api = new ApiService(baseUrl, state.apiKey);
      await api.submitFeedback(state.session.id, this.messageId, rating);
    }
  }

  render() {
    return (
      <div class="feedback">
        <button
          class={`fb-btn ${this.selected === 'up' ? 'active' : ''}`}
          onClick={() => this.handleFeedback('up')}
          aria-label="Helpful"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={this.selected === 'up' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
          </svg>
        </button>
        <button
          class={`fb-btn ${this.selected === 'down' ? 'active' : ''}`}
          onClick={() => this.handleFeedback('down')}
          aria-label="Not helpful"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={this.selected === 'down' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
          </svg>
        </button>
      </div>
    );
  }
}
