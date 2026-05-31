import { Component, Prop, Event, EventEmitter, h } from '@stencil/core';
import type { CardButton } from '../../types';

@Component({ tag: 'smc-part-card', styleUrl: 'smc-part-card.css', shadow: true })
export class SmcPartCard {
  @Prop() part!: { type: 'card'; title: string; description?: string; buttons?: CardButton[] };
  @Event() cardAction!: EventEmitter<string>;

  render() {
    return (
      <div class="card">
        <div class="title">{this.part.title}</div>
        {this.part.description ? <div class="desc">{this.part.description}</div> : null}
        {this.part.buttons?.length ? (
          <div class="actions">
            {this.part.buttons.map((b, i) =>
              b.url ? (
                <a class="btn" href={b.url} target="_blank" rel="noopener noreferrer" key={i}>{b.label}</a>
              ) : (
                <button class="btn" onClick={() => b.value && this.cardAction.emit(b.value)} key={i}>{b.label}</button>
              ),
            )}
          </div>
        ) : null}
      </div>
    );
  }
}
