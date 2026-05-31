import { Component, Prop, h } from '@stencil/core';
import type { MessagePart } from '../../types';

@Component({ tag: 'smc-message-part', styleUrl: 'smc-message-part.css', shadow: true })
export class SmcMessagePart {
  @Prop() part!: MessagePart;

  render() {
    const p = this.part;
    switch (p.type) {
      case 'text':     return <smc-part-text part={p}></smc-part-text>;
      case 'thinking': return <smc-part-thinking part={p}></smc-part-thinking>;
      case 'menu':     return <smc-part-menu part={p}></smc-part-menu>;
      case 'file':     return <smc-part-file part={p}></smc-part-file>;
      case 'image':    return <smc-part-image part={p}></smc-part-image>;
      case 'card':     return <smc-part-card part={p}></smc-part-card>;
      default:         return null;
    }
  }
}
