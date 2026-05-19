import { createLogger } from '@chatbot/shared/workers';
import { stripHtml } from '../parsers/index';

const extractorLogger = createLogger('kb:web-crawler:extractor');

export interface ExtractResult {
  title: string;
  text: string;
  links: string[];
}

const REMOVE_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript'];

export class WebPageExtractor {
  extract(html: string): ExtractResult {
    try {
      let cleaned = html;
      for (const tag of REMOVE_TAGS) {
        cleaned = cleaned.replace(
          new RegExp(`<${tag}\\b[^<]*(?:(?!<\/${tag}>)<[^<]*)*<\/${tag}>`, 'gi'),
          ' '
        );
      }

      const titleMatch = cleaned.match(/<title>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? stripHtml(titleMatch[1]).trim() : '';

      let contentHtml = this.extractContentRegion(cleaned);
      const links = this.extractLinks(cleaned);
      const text = stripHtml(contentHtml).trim();

      extractorLogger.debug({ title, textLength: text.length, linkCount: links.length }, 'Extracted page content');
      return { title, text, links };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      extractorLogger.error({ htmlLength: html.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to extract page content');
      throw error;
    }
  }

  private extractContentRegion(html: string): string {
    const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (article) return article[1];

    const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (main) return main[1];

    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (body) return body[1];

    return html;
  }

  private extractLinks(html: string): string[] {
    const links: string[] = [];
    const regex = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const href = match[1].trim();
      if (href.startsWith('http:') || href.startsWith('https:')) {
        links.push(href);
      }
    }
    return [...new Set(links)];
  }
}
