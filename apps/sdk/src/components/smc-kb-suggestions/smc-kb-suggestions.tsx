import { Component, h } from '@stencil/core';
import { state, setKbSuggestions } from '../../store/widget-store';

@Component({
  tag: 'smc-kb-suggestions',
  styleUrl: 'smc-kb-suggestions.css',
  shadow: true,
})
export class SmcKbSuggestions {
  private handleDismiss = () => {
    setKbSuggestions([]);
  };

  render() {
    const articles = state.kbSuggestions;
    if (!articles || articles.length === 0) return null;

    return (
      <div class="kb-suggestions">
        <div class="kb-header">
          <span>Related articles</span>
          <button class="dismiss" onClick={this.handleDismiss}>&times;</button>
        </div>
        <div class="kb-list">
          {articles.map((article) => (
            <div class="kb-card">
              <div class="kb-title">{article.title}</div>
              <div class="kb-snippet">{article.snippet}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
}
