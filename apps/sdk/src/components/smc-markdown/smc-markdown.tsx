import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-markdown',
  styleUrl: 'smc-markdown.css',
  shadow: true,
})
export class SmcMarkdown {
  @Prop() content!: string;

  private renderMarkdown(text: string): string {
    let html = this.escapeHtml(text);
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  render() {
    return <div class="markdown" innerHTML={this.renderMarkdown(this.content)}></div>;
  }
}
