import { stripHtml } from '../parsers/index';

export interface ExtractResult {
  title: string;
  text: string;
  links: string[];
}

const REMOVE_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript'];

export class WebPageExtractor {
  extract(html: string): ExtractResult {
    // 1. Remove unwanted tags entirely
    let cleaned = html;
    for (const tag of REMOVE_TAGS) {
      cleaned = cleaned.replace(
        new RegExp(`<${tag}\\b[^<]*(?:(?!<\/${tag}>)<[^<]*)*<\/${tag}>`, 'gi'),
        ' '
      );
    }

    // 2. Extract title
    const titleMatch = cleaned.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).trim() : '';

    // 3. Extract text from preferred content area
    let contentHtml = this.extractContentRegion(cleaned);

    // 4. Extract absolute links before stripping tags
    const links = this.extractLinks(cleaned);

    // 5. Strip remaining HTML
    const text = stripHtml(contentHtml).trim();

    return { title, text, links };
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
