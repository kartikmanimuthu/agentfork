import { describe, it, expect } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcMarkdown } from './smc-markdown';

function getHtml(root: HTMLElement) {
  return root.shadowRoot!.querySelector('.markdown')!.innerHTML;
}

describe('SmcMarkdown', () => {
  it('renders plain text escaped', async () => {
    const { root } = await render(<smc-markdown content="Hello world" />, {
      components: [SmcMarkdown],
    });

    expect(getHtml(root)).toContain('Hello world');
  });

  it('renders bold text', async () => {
    const { root } = await render(<smc-markdown content="Hello **world**" />, {
      components: [SmcMarkdown],
    });

    expect(getHtml(root)).toContain('<strong>world</strong>');
  });

  it('renders italic text', async () => {
    const { root } = await render(<smc-markdown content="Hello *world*" />, {
      components: [SmcMarkdown],
    });

    expect(getHtml(root)).toContain('<em>world</em>');
  });

  it('renders inline code', async () => {
    const { root } = await render(<smc-markdown content="Use `const x = 1` here" />, {
      components: [SmcMarkdown],
    });

    expect(getHtml(root)).toContain('<code>const x = 1</code>');
  });

  it('renders code blocks with language', async () => {
    const { root } = await render(
      <smc-markdown content={'```javascript\nconst x = 1;\n```'} />,
      { components: [SmcMarkdown] },
    );

    const result = getHtml(root);
    expect(result).toContain('<pre><code class="lang-javascript">');
    expect(result).toContain('const x = 1;');
  });

  it('renders links with target blank', async () => {
    const { root } = await render(
      <smc-markdown content="Click [here](https://example.com)" />,
      { components: [SmcMarkdown] },
    );

    const result = getHtml(root);
    expect(result).toContain('<a href="https://example.com" target="_blank" rel="noopener">here</a>');
  });

  it('renders unordered lists', async () => {
    const { root } = await render(<smc-markdown content={`- Item 1
- Item 2`} />, {
      components: [SmcMarkdown],
    });

    const result = getHtml(root);
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>Item 1</li>');
    expect(result).toContain('<li>Item 2</li>');
  });

  it('renders ordered lists', async () => {
    const { root } = await render(<smc-markdown content={`1. First
2. Second`} />, {
      components: [SmcMarkdown],
    });

    const result = getHtml(root);
    expect(result).toContain('<li>First</li>');
    expect(result).toContain('<li>Second</li>');
  });

  it('renders line breaks', async () => {
    const { root } = await render(<smc-markdown content={`Line 1
Line 2`} />, {
      components: [SmcMarkdown],
    });

    expect(getHtml(root)).toContain('<br>');
  });

  it('escapes HTML tags', async () => {
    const { root } = await render(
      <smc-markdown content={'<script>alert("xss")</script>'} />,
      { components: [SmcMarkdown] },
    );

    const result = getHtml(root);
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('handles empty string', async () => {
    const { root } = await render(<smc-markdown content="" />, {
      components: [SmcMarkdown],
    });

    expect(root.shadowRoot!.querySelector('.markdown')).toBeTruthy();
  });

  it('handles very long content', async () => {
    const long = 'A'.repeat(10000);
    const { root } = await render(<smc-markdown content={long} />, {
      components: [SmcMarkdown],
    });

    expect(getHtml(root)).toContain('A'.repeat(10000));
  });

  it('renders mixed markdown: bold inside link', async () => {
    const { root } = await render(
      <smc-markdown content="**[link](url)**" />,
      { components: [SmcMarkdown] },
    );

    const result = getHtml(root);
    expect(result).toContain('<strong>');
    expect(result).toContain('<a href="url"');
  });
});
