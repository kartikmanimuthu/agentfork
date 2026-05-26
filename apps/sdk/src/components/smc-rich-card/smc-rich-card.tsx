import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-rich-card',
  styleUrl: 'smc-rich-card.css',
  shadow: true,
})
export class SmcRichCard {
  @Prop() cardData!: string;

  render() {
    let data: { title?: string; description?: string; buttons?: Array<{ label: string; url?: string }> };
    try {
      data = JSON.parse(this.cardData);
    } catch {
      return null;
    }

    return (
      <div class="rich-card">
        {data.title ? <div class="card-title">{data.title}</div> : null}
        {data.description ? <div class="card-desc">{data.description}</div> : null}
        {data.buttons?.length ? (
          <div class="card-buttons">
            {data.buttons.map((btn) => (
              <a class="card-btn" href={btn.url} target="_blank" rel="noopener">
                {btn.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
}
