import { Component, Prop, State, h } from '@stencil/core';

@Component({ tag: 'smc-part-image', styleUrl: 'smc-part-image.css', shadow: true })
export class SmcPartImage {
  @Prop() part!: { type: 'image'; url: string; alt?: string };
  @State() broken = false;
  @State() enlarged = false;

  render() {
    if (this.broken) {
      return <div class="placeholder" aria-label="Image failed to load">🖼️</div>;
    }
    return (
      <img
        class={`img ${this.enlarged ? 'enlarged' : ''}`}
        src={this.part.url}
        alt={this.part.alt ?? 'Image'}
        loading="lazy"
        onError={() => (this.broken = true)}
        onClick={() => (this.enlarged = !this.enlarged)}
      />
    );
  }
}
