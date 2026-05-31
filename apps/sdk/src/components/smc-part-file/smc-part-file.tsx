import { Component, Prop, State, h } from '@stencil/core';

const KB = 1024;

function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${(bytes / (KB * KB)).toFixed(1)} MB`;
}

function kind(mimeType: string): 'pdf' | 'sheet' | 'generic' {
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'sheet';
  return 'generic';
}

@Component({ tag: 'smc-part-file', styleUrl: 'smc-part-file.css', shadow: true })
export class SmcPartFile {
  @Prop() part!: { type: 'file'; name: string; mimeType: string; url: string; sizeBytes?: number };
  @State() failed = false;

  private onError = () => { this.failed = true; };
  private retry = () => { this.failed = false; };

  render() {
    const k = kind(this.part.mimeType);
    if (this.failed) {
      return (
        <div class="file error">
          <span class="msg">Couldn't load this file.</span>
          <button class="retry" onClick={this.retry}>Retry</button>
        </div>
      );
    }
    return (
      <div class="file">
        <span class={`icon ${k}`} aria-hidden="true"></span>
        <div class="meta">
          <span class="name">{this.part.name}</span>
          {this.part.sizeBytes ? <span class="size">{fmtSize(this.part.sizeBytes)}</span> : null}
        </div>
        <a
          class="download"
          href={this.part.url}
          download={this.part.name}
          onError={this.onError}
          aria-label={`Download ${this.part.name}`}
        >↓</a>
      </div>
    );
  }
}
