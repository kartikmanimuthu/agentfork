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
  @Prop() partData!: { type: 'file'; name: string; mimeType: string; url: string; sizeBytes?: number };
  @State() failed = false;

  // Fetch the file as a blob so a genuine load failure is observable (an `error`
  // event never fires on a download anchor), surfacing the retry affordance.
  private handleDownload = async (e: MouseEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(this.partData.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = this.partData.name;
      a.click();
      URL.revokeObjectURL(objectUrl);
      this.failed = false;
    } catch (err) {
      console.error('[smc-widget] file download failed', err);
      this.failed = true;
    }
  };

  private retry = () => { this.failed = false; };

  render() {
    const k = kind(this.partData.mimeType);
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
          <span class="name">{this.partData.name}</span>
          {this.partData.sizeBytes ? <span class="size">{fmtSize(this.partData.sizeBytes)}</span> : null}
        </div>
        <a
          class="download"
          href={this.partData.url}
          download={this.partData.name}
          onClick={this.handleDownload}
          aria-label={`Download ${this.partData.name}`}
        >↓</a>
      </div>
    );
  }
}
