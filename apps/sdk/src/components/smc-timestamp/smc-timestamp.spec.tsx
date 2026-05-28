import { describe, it, expect } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcTimestamp } from './smc-timestamp';

describe('SmcTimestamp', () => {
  it('renders timestamp element in shadow DOM', async () => {
    const { root } = await render(<smc-timestamp timestamp="2024-01-15T08:30:00.000Z" />, {
      components: [SmcTimestamp],
    });

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.timestamp')).toBeTruthy();
    expect(shadowRoot.querySelector('span')).toBeTruthy();
  });

  it('formats past date with date and time', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const ts = yesterday.toISOString();

    const { root } = await render(<smc-timestamp timestamp={ts} />, {
      components: [SmcTimestamp],
    });

    const text = root.shadowRoot!.querySelector('span')!.textContent!;
    expect(text).toMatch(/\w{3}\s\d{1,2},\s\d{1,2}:\d{2}/);
  });

  it('formats ISO 8601 timestamp without error', async () => {
    const { root } = await render(
      <smc-timestamp timestamp="2024-01-15T08:30:00.000Z" />,
      { components: [SmcTimestamp] },
    );

    const text = root.shadowRoot!.querySelector('span')!.textContent!;
    expect(text).toBeTruthy();
    expect(text).not.toBe('Invalid Date');
  });
});
