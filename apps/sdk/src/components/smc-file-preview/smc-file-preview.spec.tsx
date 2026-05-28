import { describe, it, expect } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcFilePreview } from './smc-file-preview';

describe('SmcFilePreview', () => {
  it('renders image preview for image mimeType', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="photo.png"
        fileUrl="https://example.com/photo.png"
        mimeType="image/png"
        fileSize={1024}
      />,
      { components: [SmcFilePreview] },
    );

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('img')).toBeTruthy();
    expect(shadowRoot.querySelector('img')!.getAttribute('src')).toBe('https://example.com/photo.png');
    expect(shadowRoot.querySelector('img')!.getAttribute('alt')).toBe('photo.png');
    expect(shadowRoot.querySelector('.file-icon')).toBeNull();
  });

  it('renders file icon for non-image mimeType', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="doc.pdf"
        fileUrl="https://example.com/doc.pdf"
        mimeType="application/pdf"
        fileSize={2048}
      />,
      { components: [SmcFilePreview] },
    );

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('img')).toBeNull();
    expect(shadowRoot.querySelector('.file-icon svg')).toBeTruthy();
  });

  it('formats file size: bytes', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="small.txt"
        fileUrl="https://example.com/small.txt"
        mimeType="text/plain"
        fileSize={512}
      />,
      { components: [SmcFilePreview] },
    );

    expect(root.shadowRoot!.querySelector('.file-size')!.textContent).toBe('512 B');
  });

  it('formats file size: 0 bytes', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="empty.txt"
        fileUrl="https://example.com/empty.txt"
        mimeType="text/plain"
        fileSize={0}
      />,
      { components: [SmcFilePreview] },
    );

    expect(root.shadowRoot!.querySelector('.file-size')!.textContent).toBe('0 B');
  });

  it('formats file size: KB boundary at 1024', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="doc.pdf"
        fileUrl="https://example.com/doc.pdf"
        mimeType="application/pdf"
        fileSize={1024}
      />,
      { components: [SmcFilePreview] },
    );

    expect(root.shadowRoot!.querySelector('.file-size')!.textContent).toBe('1.0 KB');
  });

  it('formats file size: KB', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="doc.pdf"
        fileUrl="https://example.com/doc.pdf"
        mimeType="application/pdf"
        fileSize={1536}
      />,
      { components: [SmcFilePreview] },
    );

    expect(root.shadowRoot!.querySelector('.file-size')!.textContent).toBe('1.5 KB');
  });

  it('formats file size: MB boundary at 1048576', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="big.pdf"
        fileUrl="https://example.com/big.pdf"
        mimeType="application/pdf"
        fileSize={1048576}
      />,
      { components: [SmcFilePreview] },
    );

    expect(root.shadowRoot!.querySelector('.file-size')!.textContent).toBe('1.0 MB');
  });

  it('formats file size: MB', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="big.pdf"
        fileUrl="https://example.com/big.pdf"
        mimeType="application/pdf"
        fileSize={2097152}
      />,
      { components: [SmcFilePreview] },
    );

    expect(root.shadowRoot!.querySelector('.file-size')!.textContent).toBe('2.0 MB');
  });

  it('formats very large file size in MB', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="huge.pdf"
        fileUrl="https://example.com/huge.pdf"
        mimeType="application/pdf"
        fileSize={10737418240}
      />,
      { components: [SmcFilePreview] },
    );

    expect(root.shadowRoot!.querySelector('.file-size')!.textContent).toBe('10240.0 MB');
  });

  it('renders file icon when mimeType is empty', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="unknown"
        fileUrl="https://example.com/unknown"
        mimeType=""
        fileSize={100}
      />,
      { components: [SmcFilePreview] },
    );

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('img')).toBeNull();
    expect(shadowRoot.querySelector('.file-icon svg')).toBeTruthy();
  });

  it('renders clickable file name link', async () => {
    const { root } = await render(
      <smc-file-preview
        fileName="doc.pdf"
        fileUrl="https://example.com/doc.pdf"
        mimeType="application/pdf"
        fileSize={1000}
      />,
      { components: [SmcFilePreview] },
    );

    const link = root.shadowRoot!.querySelector('.file-name')!;
    expect(link.getAttribute('href')).toBe('https://example.com/doc.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.textContent).toBe('doc.pdf');
  });
});
