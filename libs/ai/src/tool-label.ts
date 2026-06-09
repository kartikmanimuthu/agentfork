const GERUND: Record<string, string> = {
  search: 'Searching', get: 'Getting', fetch: 'Fetching', list: 'Listing',
  create: 'Creating', update: 'Updating', delete: 'Deleting', send: 'Sending',
  generate: 'Generating', query: 'Querying', lookup: 'Looking up', find: 'Finding',
};

export function toolLabel(toolName: string): string {
  const words = toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'Working';
  const [first, ...rest] = words;
  const verb = GERUND[first];
  if (verb) return rest.length ? `${verb} ${rest.join(' ')}` : verb;
  return `Running ${words.join(' ')}`;
}
