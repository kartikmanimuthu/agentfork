import { Component, h, State } from '@stencil/core';
import { state, setCsatPending, setCsatSubmitted, setUiState, resetWidget } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';

@Component({
  tag: 'smc-csat-survey',
  styleUrl: 'smc-csat-survey.css',
  shadow: true,
})
export class SmcCsatSurvey {
  @State() rating: number | null = null;
  @State() submitted = false;

  private async handleRate(value: number) {
    this.rating = value;

    if (state.session && state.apiKey) {
      const api = new ApiService(state.baseUrl, state.apiKey);
      try {
        await api.submitCsat(state.session.id, value);
      } catch (err) {
        console.warn('[smc-csat] CSAT submission failed', err);
      }
    }

    this.submitted = true;
    setCsatSubmitted(true);

    // After a brief moment, close the widget and reset for a fresh start
    setTimeout(() => {
      setCsatPending(false);
      setUiState({ open: false, minimized: false, hidden: false });

      // Clear session storage so next chat starts fresh
      const widgetEl = document.querySelector('smc-chat-widget') as any;
      const sdkId = widgetEl?.sdkId;
      if (sdkId) {
        const storage = new StorageService(sdkId);
        storage.clearSession();
      }
      resetWidget();
    }, 1500);
  }

  render() {
    const config = state.config;
    if (!config?.csatEnabled) return null;

    if (this.submitted) {
      return (
        <div class="csat">
          <p class="thanks">Thank you for your feedback!</p>
        </div>
      );
    }

    return (
      <div class="csat">
        <p class="csat-prompt">How was your experience?</p>
        {config.csatType === 'thumbs' ? (
          <div class="thumbs">
            <button class={`thumb ${this.rating === 1 ? 'active' : ''}`} onClick={() => this.handleRate(1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={this.rating === 1 ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
              </svg>
            </button>
            <button class={`thumb ${this.rating === 0 ? 'active' : ''}`} onClick={() => this.handleRate(0)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={this.rating === 0 ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
                <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
              </svg>
            </button>
          </div>
        ) : (
          <div class="stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                class={`star ${this.rating !== null && star <= this.rating ? 'active' : ''}`}
                onClick={() => this.handleRate(star)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={this.rating !== null && star <= this.rating ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
}
