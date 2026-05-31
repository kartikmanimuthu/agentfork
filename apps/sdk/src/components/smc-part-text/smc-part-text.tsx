import { Component, Prop, h } from '@stencil/core';

@Component({ tag: 'smc-part-text', styleUrl: 'smc-part-text.css', shadow: true })
export class SmcPartText {
  @Prop() part!: { type: 'text'; text: string };

  render() {
    return <smc-markdown content={this.part.text}></smc-markdown>;
  }
}
