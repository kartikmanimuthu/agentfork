import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { createLogger } from '@chatbot/shared/workers';

const extractLogger = createLogger('kb:web-crawler:extraction');

export interface ExtractionResult {
  title: string;
  markdown: string;
  textLength: number;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// Remove navigation, ads, and decorative elements before Readability sees them
const PRE_STRIP_SELECTORS = [
  'nav',
  'header',
  'footer',
  'aside',
  '.sidebar',
  '.advertisement',
  'script',
  'style',
  'noscript',
  'iframe',
  'form',
];

export function extractMarkdownFromHtml(html: string, url: string): ExtractionResult {
  try {
    // Strip <style> and <script> tags from raw HTML before JSDOM parsing.
    // JSDOM's internal CSS parser (cssom) throws noisy errors on modern
    // CSS syntax like @import URLs (e.g., Google Fonts), and since these
    // elements are removed post-parse anyway, pre-cleaning avoids the logs.
    const cleanedHtml = html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

    const dom = new JSDOM(cleanedHtml, { url });
    const doc = dom.window.document;

    // Pre-strip remaining noisy elements
    for (const selector of PRE_STRIP_SELECTORS) {
      for (const el of Array.from(doc.querySelectorAll(selector))) {
        el.remove();
      }
    }

    const reader = new Readability(doc, { debug: false });
    const article = reader.parse();

    if (!article) {
      extractLogger.warn({ url }, 'Readability could not extract article; falling back to body content');
      // Fallback: convert the cleaned body HTML to markdown
      const body = doc.body;
      if (!body) {
        return { title: '', markdown: '', textLength: 0 };
      }
      const markdown = turndown.turndown(body.innerHTML);
      return { title: doc.title ?? '', markdown, textLength: markdown.length };
    }

    const markdown = turndown.turndown(article.content ?? '');
    extractLogger.debug({ url, title: article.title, markdownLength: markdown.length }, 'Extracted markdown');

    return {
      title: article.title ?? '',
      markdown,
      textLength: markdown.length,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    extractLogger.error({ url, errorMessage: error.message, errorStack: error.stack }, 'Extraction failed');
    throw error;
  }
}
