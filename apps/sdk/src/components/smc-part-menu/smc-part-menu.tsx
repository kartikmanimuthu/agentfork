import { Component, Prop, State, Event, EventEmitter, h } from '@stencil/core';
import type { MenuOption } from '../../types';

@Component({ tag: 'smc-part-menu', styleUrl: 'smc-part-menu.css', shadow: true })
export class SmcPartMenu {
  @Prop() part!: { type: 'menu'; title?: string; options: MenuOption[] };
  @State() chosen: string | null = null;
  @Event() menuSelect!: EventEmitter<string>;

  private select(opt: MenuOption) {
    if (this.chosen) return;
    this.chosen = opt.value;
    this.menuSelect.emit(opt.value);
  }

  render() {
    return (
      <div class="menu">
        {this.part.title ? <div class="menu-title">{this.part.title}</div> : null}
        <div class="options">
          {this.part.options.map((o, i) => (
            <button
              class={`option ${this.chosen === o.value ? 'chosen' : ''} ${this.chosen && this.chosen !== o.value ? 'dimmed' : ''}`}
              style={{ '--i': String(i) }}
              disabled={!!this.chosen}
              onClick={() => this.select(o)}
              key={o.value}
            >
              {o.icon ? <span class="icon" aria-hidden="true">{o.icon}</span> : null}
              <span class="label">{o.label}</span>
              <span class="arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
}
