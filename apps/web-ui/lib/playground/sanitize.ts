export function sanitizeMarkdown(content: string): string {
  let result = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Fix markdown tables: ensure each table row starts on its own line.
  // Detect patterns like "| text | text | | text |" where rows run together.
  // A table row boundary is "|" preceded by non-newline content and followed by a space and another "|"
  result = result.replace(/\|\s*\n?\s*\|/g, (match) => {
    if (match.includes('\n')) return match;
    return '|\n|';
  });

  return result;
}
