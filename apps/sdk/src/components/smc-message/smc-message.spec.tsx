import { describe, it, expect } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcMessage } from './smc-message';
import { SmcMarkdown } from '../smc-markdown/smc-markdown';
import { SmcFeedback } from '../smc-feedback/smc-feedback';

describe('SmcMessage', () => {
  it('renders user message with plain text', async () => {
    const { root } = await render(
      <smc-message
        content="Hello"
        role="user"
        timestamp="2024-01-01T00:00:00.000Z"
        messageId="msg_1"
        status="sent"
      />,
      { components: [SmcMessage] },
    );

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.message.user')).toBeTruthy();
    expect(shadowRoot.querySelector('span.text')!.textContent).toBe('Hello');
    expect(shadowRoot.querySelector('smc-markdown')).toBeNull();
  });

  it('renders assistant message with markdown child', async () => {
    const { root } = await render(
      <smc-message
        content="Hello **world**"
        role="assistant"
        timestamp="2024-01-01T00:00:00.000Z"
        messageId="msg_2"
        status="sent"
      />,
      { components: [SmcMessage, SmcMarkdown] },
    );

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.message.bot')).toBeTruthy();
    expect(shadowRoot.querySelector('smc-markdown')).toBeTruthy();
  });

  it('renders feedback when assistant, messageId is truthy, not welcome, and status is sent', async () => {
    const { root } = await render(
      <smc-message
        content="Hello"
        role="assistant"
        timestamp="2024-01-01T00:00:00.000Z"
        messageId="msg_123"
        status="sent"
      />,
      { components: [SmcMessage, SmcMarkdown, SmcFeedback] },
    );

    expect(root.shadowRoot!.querySelector('smc-feedback')).toBeTruthy();
  });

  it('does not render feedback for welcome message', async () => {
    const { root } = await render(
      <smc-message
        content="Welcome!"
        role="assistant"
        timestamp="2024-01-01T00:00:00.000Z"
        messageId="welcome"
        status="sent"
      />,
      { components: [SmcMessage, SmcMarkdown, SmcFeedback] },
    );

    expect(root.shadowRoot!.querySelector('smc-feedback')).toBeNull();
  });

  it('does not render feedback for user messages', async () => {
    const { root } = await render(
      <smc-message
        content="Hello"
        role="user"
        timestamp="2024-01-01T00:00:00.000Z"
        messageId="msg_123"
        status="sent"
      />,
      { components: [SmcMessage, SmcMarkdown, SmcFeedback] },
    );

    expect(root.shadowRoot!.querySelector('smc-feedback')).toBeNull();
  });

  it('does not render feedback when status is streaming', async () => {
    const { root } = await render(
      <smc-message
        content="Loading..."
        role="assistant"
        timestamp="2024-01-01T00:00:00.000Z"
        messageId="msg_123"
        status="streaming"
      />,
      { components: [SmcMessage, SmcMarkdown, SmcFeedback] },
    );

    expect(root.shadowRoot!.querySelector('smc-feedback')).toBeNull();
  });

  it('does not render feedback when messageId is empty', async () => {
    const { root } = await render(
      <smc-message
        content="Hello"
        role="assistant"
        timestamp="2024-01-01T00:00:00.000Z"
        messageId=""
        status="sent"
      />,
      { components: [SmcMessage, SmcMarkdown, SmcFeedback] },
    );

    expect(root.shadowRoot!.querySelector('smc-feedback')).toBeNull();
  });

  it('does not render feedback when status is undefined', async () => {
    const { root } = await render(
      <smc-message
        content="Hello"
        role="assistant"
        timestamp="2024-01-01T00:00:00.000Z"
        messageId="msg_123"
      />,
      { components: [SmcMessage, SmcMarkdown, SmcFeedback] },
    );

    expect(root.shadowRoot!.querySelector('smc-feedback')).toBeNull();
  });
});
