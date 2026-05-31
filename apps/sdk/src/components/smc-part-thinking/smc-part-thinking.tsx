import { Component, Prop, State, h } from '@stencil/core';
import type { ThinkingStep } from '../../types';

@Component({ tag: 'smc-part-thinking', styleUrl: 'smc-part-thinking.css', shadow: true })
export class SmcPartThinking {
  @Prop() part!: { type: 'thinking'; status: 'active' | 'done'; steps: ThinkingStep[] };
  @State() manualExpanded: boolean | null = null;

  private get expanded(): boolean {
    if (this.manualExpanded !== null) return this.manualExpanded;
    return this.part.status === 'active';
  }

  private toggle = () => { this.manualExpanded = !this.expanded; };

  render() {
    const { status, steps } = this.part;
    const label = status === 'active'
      ? 'Thinking…'
      : `Thought for ${steps.length} step${steps.length === 1 ? '' : 's'}`;

    return (
      <div class={`thinking ${status}`}>
        <button class="head" onClick={this.toggle} aria-expanded={String(this.expanded)}>
          <span class="spark" aria-hidden="true">✦</span>
          <span class="title">{label}</span>
          <span class={`chev ${this.expanded ? 'open' : ''}`} aria-hidden="true">⌄</span>
        </button>
        {this.expanded ? (
          <ol class="steps">
            {steps.map((s) => (
              <li class="step" key={s.id}>
                <span class={`dot ${s.status}`} aria-hidden="true"></span>
                <div class="body">
                  <span class="label">{s.label}</span>
                  {s.detail ? <span class="detail">{s.detail}</span> : null}
                  {s.data ? (
                    <div class="data">
                      {Object.entries(s.data).map(([k, v]) => (
                        <div class="kv" key={k}><span class="k">{k}</span><span class="v">{v}</span></div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  }
}
