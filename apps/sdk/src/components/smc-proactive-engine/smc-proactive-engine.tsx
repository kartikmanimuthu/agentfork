import { Component, h } from '@stencil/core';
import { state, incrementUnread } from '../../store/widget-store';
import { ProactiveService } from '../../services/proactive.service';

@Component({
  tag: 'smc-proactive-engine',
  shadow: true,
})
export class SmcProactiveEngine {
  private proactiveService = new ProactiveService();

  componentDidLoad() {
    const rules = state.config?.proactiveRules;
    if (rules && rules.length > 0 && !state.uiState.open) {
      this.proactiveService.evaluate(rules, (message) => {
        if (!state.uiState.open) {
          incrementUnread();
          const launcher = document.querySelector('smc-chat-widget')
            ?.shadowRoot?.querySelector('smc-launcher');
          if (launcher) {
            (launcher as any).proactiveMessage = message;
          }
        }
      });
    }
  }

  disconnectedCallback() {
    this.proactiveService.cleanup();
  }

  render() {
    return null;
  }
}
