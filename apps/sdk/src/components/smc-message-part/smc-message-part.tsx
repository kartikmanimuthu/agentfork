import { Component, Prop, h } from '@stencil/core';
import type { MessagePart } from '../../types';

@Component({ tag: 'smc-message-part', styleUrl: 'smc-message-part.css', shadow: true })
export class SmcMessagePart {
  @Prop() partData!: MessagePart;

  render() {
    const p = this.partData;
    switch (p.type) {
      case 'text':     return <smc-part-text partData={p}></smc-part-text>;
      case 'thinking': return <smc-part-thinking partData={p}></smc-part-thinking>;
      case 'menu':     return <smc-part-menu partData={p}></smc-part-menu>;
      case 'file':     return <smc-part-file partData={p}></smc-part-file>;
      case 'image':    return <smc-part-image partData={p}></smc-part-image>;
      case 'card':     return <smc-part-card partData={p}></smc-part-card>;
      default:         return null;
    }
  }
}
