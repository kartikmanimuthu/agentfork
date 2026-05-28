import { describe, it, expect } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcRichCard } from './smc-rich-card';

describe('SmcRichCard', () => {
  it('renders card with title, description, and buttons', async () => {
    const cardData = JSON.stringify({
      title: 'Hello',
      description: 'World',
      buttons: [{ label: 'Click me', url: 'https://example.com' }],
    });

    const { root } = await render(<smc-rich-card cardData={cardData} />, {
      components: [SmcRichCard],
    });

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.rich-card')).toBeTruthy();
    expect(shadowRoot.querySelector('.card-title')!.textContent).toBe('Hello');
    expect(shadowRoot.querySelector('.card-desc')!.textContent).toBe('World');
    expect(shadowRoot.querySelector('.card-btn')!.textContent).toBe('Click me');
    expect(shadowRoot.querySelector('.card-btn')!.getAttribute('href')).toBe('https://example.com');
  });

  it('renders card with only title', async () => {
    const cardData = JSON.stringify({ title: 'Just a title' });
    const { root } = await render(<smc-rich-card cardData={cardData} />, {
      components: [SmcRichCard],
    });

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.card-title')!.textContent).toBe('Just a title');
    expect(shadowRoot.querySelector('.card-desc')).toBeNull();
    expect(shadowRoot.querySelector('.card-buttons')).toBeNull();
  });

  it('renders card with only buttons', async () => {
    const cardData = JSON.stringify({ buttons: [{ label: 'Click', url: 'https://x.com' }] });
    const { root } = await render(<smc-rich-card cardData={cardData} />, {
      components: [SmcRichCard],
    });

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.card-title')).toBeNull();
    expect(shadowRoot.querySelector('.card-desc')).toBeNull();
    expect(shadowRoot.querySelector('.card-btn')!.textContent).toBe('Click');
  });

  it('returns null for invalid JSON', async () => {
    const { root } = await render(<smc-rich-card cardData="{not json}" />, {
      components: [SmcRichCard],
    });

    expect(root.shadowRoot!.querySelector('.rich-card')).toBeNull();
  });

  it('returns null for empty string', async () => {
    const { root } = await render(<smc-rich-card cardData="" />, {
      components: [SmcRichCard],
    });

    expect(root.shadowRoot!.querySelector('.rich-card')).toBeNull();
  });

  it('ignores unknown fields', async () => {
    const cardData = JSON.stringify({ title: 'Hi', extra: 'ignored' });
    const { root } = await render(<smc-rich-card cardData={cardData} />, {
      components: [SmcRichCard],
    });

    expect(root.shadowRoot!.querySelector('.card-title')!.textContent).toBe('Hi');
  });

  it('renders buttons without url safely', async () => {
    const cardData = JSON.stringify({ buttons: [{ label: 'No URL' }] });
    const { root } = await render(<smc-rich-card cardData={cardData} />, {
      components: [SmcRichCard],
    });

    const btn = root.shadowRoot!.querySelector('.card-btn')!;
    expect(btn.textContent).toBe('No URL');
    expect(btn.getAttribute('href')).toBeNull();
  });
});
