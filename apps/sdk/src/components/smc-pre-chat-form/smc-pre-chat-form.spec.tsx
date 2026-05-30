import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcPreChatForm } from './smc-pre-chat-form';
import { state, setConfig, setApiKey, reset } from '../../store/widget-store';
import type { SdkWidgetConfig } from '../../types';

const mockConfig: SdkWidgetConfig = {
  agentId: 'agent_1',
  apiKeyPrefix: 'smc_abc',
  theme: 'light',
  primaryColor: '#ff0000',
  secondaryColor: '#00ff00',
  position: 'right',
  headerText: 'Chat',
  headerIcon: null,
  botName: 'Bot',
  botAvatar: null,
  welcomeMessage: 'Hello!',
  inputPlaceholder: 'Ask me...',
  preChatForm: [
    { field: 'name', type: 'text', label: 'Name', required: true },
    { field: 'email', type: 'email', label: 'Email', required: true },
    { field: 'phone', type: 'phone', label: 'Phone', required: false },
    { field: 'topic', type: 'select', label: 'Topic', required: false, options: ['Sales', 'Support'] },
  ],
  quickReplies: null,
  proactiveRules: null,
  kbEnabled: false,
  fileUpload: false,
  csatEnabled: false,
  csatType: 'thumbs',
};

describe('SmcPreChatForm', () => {
  beforeEach(() => {
    reset();
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(document, 'querySelector').mockReturnValue({ sdkId: 'test_sdk_id' } as any);
  });

  it('renders welcome message and form fields', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-pre-chat-form />);

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.pre-chat')).toBeTruthy();
    expect(shadowRoot.querySelector('.pre-chat-header h3')!.textContent).toBe('Hello!');
    expect(shadowRoot.querySelectorAll('.field')).toHaveLength(4);
  });

  it('renders text, email, phone, select field types', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-pre-chat-form />);

    const shadowRoot = root.shadowRoot!;
    const inputs = shadowRoot.querySelectorAll('input');
    expect(inputs[0].type).toBe('text');
    expect(inputs[1].type).toBe('email');
    expect(inputs[2].type).toBe('tel');
    expect(shadowRoot.querySelector('select')).toBeTruthy();
  });

  it('shows validation error for required field left empty', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-pre-chat-form />);

    // Submit form directly via dispatchEvent on the form
    const form = root.shadowRoot!.querySelector('form')!;
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);

    await new Promise((r) => requestAnimationFrame(r));

    const error = root.shadowRoot!.querySelector('.error');
    expect(error).toBeTruthy();
    expect(error!.textContent).toBe('Required');
  });

  it('shows validation error for invalid email', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-pre-chat-form />);

    // Fill name and phone, but invalid email
    const inputs = root.shadowRoot!.querySelectorAll('input');
    inputs[0].value = 'John';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'not-an-email';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((r) => requestAnimationFrame(r));

    const form = root.shadowRoot!.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((r) => requestAnimationFrame(r));

    const errors = root.shadowRoot!.querySelectorAll('.error');
    expect(errors.length).toBeGreaterThan(0);
    if (errors.length > 0) {
      expect(errors[0].textContent).toBe('Invalid email');
    }
  });

  it('valid email passes validation', async () => {
    setConfig(mockConfig);
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'sess_1' }) });
    setApiKey('key123');

    const { root } = await render(<smc-pre-chat-form />);

    const inputs = root.shadowRoot!.querySelectorAll('input');
    inputs[0].value = 'John';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'john@example.com';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((r) => requestAnimationFrame(r));

    const form = root.shadowRoot!.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).toHaveBeenCalled();
    expect(state.preChatDone).toBe(true);
    expect(state.session).not.toBeNull();
  });

  it('shows form-level error on API failure', async () => {
    setConfig(mockConfig);
    (fetch as any).mockRejectedValue(new Error('Network error'));
    setApiKey('key123');

    const { root } = await render(<smc-pre-chat-form />);

    const inputs = root.shadowRoot!.querySelectorAll('input');
    inputs[0].value = 'John';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'john@example.com';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((r) => requestAnimationFrame(r));

    const form = root.shadowRoot!.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((r) => setTimeout(r, 50));

    const formError = root.shadowRoot!.querySelector('.form-error');
    expect(formError).toBeTruthy();
    expect(formError!.textContent).toBe('Failed to start chat. Please try again.');
  });

  it('submit button shows "Starting..." while submitting', async () => {
    setConfig(mockConfig);
    // Don't resolve to keep in submitting state
    (fetch as any).mockImplementation(() => new Promise(() => {}));
    setApiKey('key123');

    const { root } = await render(<smc-pre-chat-form />);

    const inputs = root.shadowRoot!.querySelectorAll('input');
    inputs[0].value = 'John';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'john@example.com';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((r) => requestAnimationFrame(r));

    const form = root.shadowRoot!.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Wait for Stencil to process the state change
    await new Promise((r) => requestAnimationFrame(r));

    const submitBtn = root.shadowRoot!.querySelector('.submit-btn')! as HTMLButtonElement;
    expect(submitBtn.textContent).toBe('Starting...');
    expect(submitBtn.disabled).toBe(true);
  });

  it('can fill form and submit without validation errors', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-pre-chat-form />);

    // Submit empty to trigger error
    const form = root.shadowRoot!.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => requestAnimationFrame(r));

    // Errors should be present
    expect(root.shadowRoot!.querySelectorAll('.error').length).toBeGreaterThan(0);

    // Re-render with a fresh component that has filled values
    const { root: root2 } = await render(<smc-pre-chat-form />);

    // Fill values and submit
    const inputs = root2.shadowRoot!.querySelectorAll('input');
    inputs[0].value = 'John';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'john@example.com';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));

    const form2 = root2.shadowRoot!.querySelector('form')!;
    form2.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => requestAnimationFrame(r));

    // With valid values, no per-field errors
    expect(root2.shadowRoot!.querySelectorAll('.error')).toHaveLength(0);
  });

  it('empty preChatForm array renders no fields', async () => {
    setConfig({ ...mockConfig, preChatForm: [] });

    const { root } = await render(<smc-pre-chat-form />);

    expect(root.shadowRoot!.querySelectorAll('.field')).toHaveLength(0);
  });
});
