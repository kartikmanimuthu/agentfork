import { Component, Prop, h } from '@stencil/core';

@Component({ tag: 'smc-part-text', styleUrl: 'smc-part-text.css', shadow: true })
export class SmcPartText {
  @Prop() partData!: { type: 'text'; text: string };

  render() {
    return <smc-markdown content={this.partData.text}></smc-markdown>;
  }
}
