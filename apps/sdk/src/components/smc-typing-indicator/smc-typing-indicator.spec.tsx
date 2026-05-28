import { describe, it, expect } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcTypingIndicator } from './smc-typing-indicator';

describe('SmcTypingIndicator', () => {
  it('renders three dots in shadow DOM', async () => {
    const { root } = await render(<smc-typing-indicator />, {
      components: [SmcTypingIndicator],
    });

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.typing')).toBeTruthy();
    const dots = shadowRoot.querySelectorAll('.dot');
    expect(dots).toHaveLength(3);
  });

  it('renders without error when no props provided', async () => {
    const { root } = await render(<smc-typing-indicator />, {
      components: [SmcTypingIndicator],
    });

    expect(root).toBeTruthy();
  });
});
