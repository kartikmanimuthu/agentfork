import { Component, Prop, Event, EventEmitter, h } from '@stencil/core';
import type { CardButton } from '../../types';

@Component({ tag: 'smc-part-card', styleUrl: 'smc-part-card.css', shadow: true })
export class SmcPartCard {
  @Prop() partData!: { type: 'card'; title: string; description?: string; buttons?: CardButton[] };
  @Event() cardAction!: EventEmitter<string>;

  render() {
    return (
      <div class="card">
        <div class="title">{this.partData.title}</div>
        {this.partData.description ? <div class="desc">{this.partData.description}</div> : null}
        {this.partData.buttons?.length ? (
          <div class="actions">
            {this.partData.buttons.map((b, i) =>
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
