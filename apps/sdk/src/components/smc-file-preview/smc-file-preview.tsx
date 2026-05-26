import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-file-preview',
  styleUrl: 'smc-file-preview.css',
  shadow: true,
})
export class SmcFilePreview {
  @Prop() fileName!: string;
  @Prop() fileUrl!: string;
  @Prop() mimeType!: string;
  @Prop() fileSize!: number;

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private isImage(): boolean {
    return this.mimeType?.startsWith('image/');
  }

  render() {
    return (
      <div class="file-preview">
        {this.isImage() ? (
          <img class="preview-img" src={this.fileUrl} alt={this.fileName} loading="lazy" />
        ) : (
          <div class="file-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
        )}
        <div class="file-info">
          <a class="file-name" href={this.fileUrl} target="_blank" rel="noopener">{this.fileName}</a>
          <span class="file-size">{this.formatSize(this.fileSize)}</span>
        </div>
      </div>
    );
  }
}
