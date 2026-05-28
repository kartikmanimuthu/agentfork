import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcKbSuggestions } from './smc-kb-suggestions';
import { state, setKbSuggestions, reset } from '../../store/widget-store';

describe('SmcKbSuggestions', () => {
  beforeEach(() => {
    reset();
  });

  it('renders KB article cards when suggestions exist', async () => {
    setKbSuggestions([
      { id: '1', title: 'Help Article', snippet: 'How to get started...' },
    ]);

    const { root } = await render(<smc-kb-suggestions />, {
      components: [SmcKbSuggestions],
    });

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.kb-suggestions')).toBeTruthy();
    expect(shadowRoot.querySelector('.kb-title')!.textContent).toBe('Help Article');
    expect(shadowRoot.querySelector('.kb-snippet')!.textContent).toBe('How to get started...');
    expect(shadowRoot.querySelector('.kb-header span')!.textContent).toBe('Related articles');
  });

  it('does not render when kbSuggestions is empty', async () => {
    const { root } = await render(<smc-kb-suggestions />, {
      components: [SmcKbSuggestions],
    });

    expect(root.shadowRoot!.querySelector('.kb-suggestions')).toBeNull();
  });

  it('does not render when kbSuggestions is null', async () => {
    setKbSuggestions(null as any);
    const { root } = await render(<smc-kb-suggestions />, {
      components: [SmcKbSuggestions],
    });

    expect(root.shadowRoot!.querySelector('.kb-suggestions')).toBeNull();
  });

  it('renders multiple article cards', async () => {
    setKbSuggestions([
      { id: '1', title: 'First', snippet: 'Snippet 1' },
      { id: '2', title: 'Second', snippet: 'Snippet 2' },
      { id: '3', title: 'Third', snippet: 'Snippet 3' },
    ]);

    const { root } = await render(<smc-kb-suggestions />, {
      components: [SmcKbSuggestions],
    });

    const cards = root.shadowRoot!.querySelectorAll('.kb-card');
    expect(cards).toHaveLength(3);
  });

  it('dismiss button clears suggestions', async () => {
    setKbSuggestions([{ id: '1', title: 'Help', snippet: '...' }]);

    const { root } = await render(<smc-kb-suggestions />, {
      components: [SmcKbSuggestions],
    });

    const dismissBtn = root.shadowRoot!.querySelector('.dismiss')!;
    dismissBtn.click();

    expect(state.kbSuggestions).toEqual([]);
  });
});
